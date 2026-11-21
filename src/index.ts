import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";
import path from "node:path";
import TelegramBot from "node-telegram-bot-api";
import {
	canSendToChat,
	createOutboundAllowlist,
	getBotToken,
	isAllowedSender,
	loadTelegramConfig,
	rememberInboundChat,
	type TelegramConfig,
} from "./config.js";
import { readInboundMessage } from "./media.js";

const TELEGRAM_TOOLS = new Set(["telegram_send", "telegram_send_photo"]);

interface ChatInfo {
	username?: string;
	firstName?: string;
	lastName?: string;
}

interface PollingState {
	_lastUpdate?: number;
}

export default function (pi: ExtensionAPI) {
	const config = loadTelegramConfig();
	const outboundChatIds = createOutboundAllowlist(config);
	const activeChats = new Map<number, ChatInfo>();
	let currentTelegramChatId: number | null = null;
	let bot: TelegramBot | undefined;
	let pollingStarted = false;
	let watchdog: ReturnType<typeof setInterval> | undefined;

	const allowMessage = (msg: TelegramBot.Message) => isAllowedSender(config, msg.chat.id, msg.from?.id);
	const allowSend = (chatId: number) => canSendToChat(config, outboundChatIds, chatId);

	const stopWatchdog = () => {
		if (!watchdog) return;
		clearInterval(watchdog);
		watchdog = undefined;
	};

	/**
	 * node-telegram-bot-api 0.x updates `_polling._lastUpdate` on each getUpdates.
	 * If that timestamp goes stale, restart polling in place. A wedged long-poll
	 * otherwise leaves the process running and silent.
	 */
	const startWatchdog = () => {
		stopWatchdog();
		const startedAt = Date.now();
		watchdog = setInterval(async () => {
			try {
				if (!bot || !pollingStarted) return;
				if (Date.now() - startedAt < 120_000) return;
				const polling = (bot as TelegramBot & { _polling?: PollingState })._polling;
				const lastUpdate = polling?._lastUpdate ?? 0;
				const ageMs = Date.now() - lastUpdate;
				if (ageMs <= 150_000) return;
				console.error(
					`Telegram watchdog: poller stale (${Math.round(ageMs / 1000)}s with no getUpdates) — restarting polling.`,
				);
				await bot.stopPolling();
				bot.startPolling();
			} catch (error) {
				console.error("Telegram watchdog error:", error);
			}
		}, 60_000);
		watchdog.unref?.();
	};

	pi.on("session_shutdown", async () => {
		stopWatchdog();
		if (!bot) return;
		await bot.stopPolling({ cancel: true });
		pollingStarted = false;
		bot = undefined;
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			if (bot && pollingStarted) {
				await bot.stopPolling({ cancel: true });
				pollingStarted = false;
			}

			const token = getBotToken();
			const telegram = new TelegramBot(token, { polling: false });
			bot = telegram;

			const botInfo = await telegram.getMe();
			ctx.ui.notify(`Telegram bot connected: @${botInfo.username}`, "info");
			notifyAllowlist(ctx, config);

			telegram.startPolling();
			pollingStarted = true;
			startWatchdog();

			telegram.on("message", async (msg) => {
				if (!allowMessage(msg)) return;
				rememberInboundChat(config, outboundChatIds, msg.chat.id, msg.from?.id);

				const chatId = msg.chat.id;
				const username = msg.from?.username;
				const firstName = msg.from?.first_name;
				const lastName = msg.from?.last_name;
				if (!activeChats.has(chatId)) {
					activeChats.set(chatId, { username, firstName, lastName });
				}
				currentTelegramChatId = chatId;

				const userInfo = username ? `@${username}` : `${firstName || ""} ${lastName || ""}`.trim();
				const inbound = await readInboundMessage(telegram, msg, {
					downloadDir: config.downloadDir,
					transcribeCommand: config.transcribeCommand,
				});
				if (!inbound.text && !inbound.attachmentInfo) return;
				if (inbound.text.startsWith("/")) return;

				const formattedMessage = `[Telegram from ${userInfo}]: ${inbound.text}${inbound.attachmentInfo}\n\nTo reply, use: telegram_send with chatId=${chatId}`;
				pi.sendUserMessage(formattedMessage, { deliverAs: "steer" });
			});

			telegram.on("error", (error) => {
				console.error("Telegram bot error:", error);
			});

			telegram.on("polling_error", (error) => {
				console.error("Telegram polling error:", error);
				const errMsg = String(error);
				if (!errMsg.includes("409") && !errMsg.includes("Conflict")) return;
				console.error("Telegram polling conflict (409). Stopping polling so another getUpdates client can own the bot.");
				void telegram.stopPolling();
				pollingStarted = false;
			});

			telegram.onText(/^\/newsession\s*$/, async (msg) => {
				if (!allowMessage(msg)) return;
				rememberInboundChat(config, outboundChatIds, msg.chat.id, msg.from?.id);
				await telegram.sendMessage(msg.chat.id, "Creating new session...");
				await telegram.stopPolling({ cancel: true });
				pollingStarted = false;
				await consumePendingUpdates(telegram);
				pi.sendUserMessage("/newsession", { expandPromptTemplates: true });
			});

			telegram.onText(/\/stop/, async (msg) => {
				if (!allowMessage(msg)) return;
				rememberInboundChat(config, outboundChatIds, msg.chat.id, msg.from?.id);
				await telegram.sendMessage(msg.chat.id, "Stopping current execution...");
				pi.sendUserMessage("/telegram_stop", { expandPromptTemplates: true });
			});
		} catch (error) {
			console.error("Failed to start Telegram bot:", error);
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (event.messageType !== "user" || !event.prompt.includes("[Telegram from")) return {};
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nIMPORTANT: You received a message from Telegram. To respond, you MUST use the 'telegram_send' tool with the chatId provided in the message. Do not just reply with text — use the tool to send the message back to Telegram.",
		};
	});

	pi.on("agent_end", async (event) => {
		const chatId = currentTelegramChatId;
		currentTelegramChatId = null;
		if (chatId === null || !bot || !pollingStarted) return;
		if (!allowSend(chatId)) return;
		if (turnCalledTelegramTool(event.messages)) return;

		const responseText = lastAssistantText(event.messages);
		if (!responseText.trim()) return;

		try {
			await bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
		} catch (markdownError) {
			try {
				await bot.sendMessage(chatId, responseText);
			} catch (error) {
				console.error("Failed to auto-reply to Telegram:", markdownError, error);
			}
		}
	});

	pi.registerTool({
		name: "telegram_send",
		label: "Send Telegram Message",
		description: "Send a message or image to a Telegram chat that is allowed to receive bot messages",
		parameters: Type.Object({
			chatId: Type.Number({ description: "Telegram chat ID to send the message to" }),
			message: Type.String({ description: "Message text to send" }),
			imagePath: Type.Optional(Type.String({ description: "Optional path to an image file to send" })),
		}),
		async execute(_toolCallId, params) {
			if (!bot) throw new Error("Telegram bot not initialized");
			const { chatId, message, imagePath } = params as { chatId: number; message: string; imagePath?: string };
			assertCanSend(allowSend, chatId);

			if (imagePath) {
				return sendPhotoFile(bot, chatId, imagePath, message);
			}
			return sendText(bot, chatId, message);
		},
	});

	pi.registerTool({
		name: "telegram_send_photo",
		label: "Send Telegram Photo",
		description: "Send a local image file to a Telegram chat that is allowed to receive bot messages",
		parameters: Type.Object({
			chatId: Type.Number({ description: "Telegram chat ID to send the photo to" }),
			photoPath: Type.String({ description: "Local file path of the photo" }),
			caption: Type.Optional(Type.String({ description: "Optional caption" })),
		}),
		async execute(_toolCallId, params) {
			if (!bot) throw new Error("Telegram bot not initialized");
			const { chatId, photoPath, caption } = params as { chatId: number; photoPath: string; caption?: string };
			assertCanSend(allowSend, chatId);

			const resolvedPath = path.resolve(photoPath);
			let photo: Buffer;
			try {
				photo = await readFile(resolvedPath);
			} catch {
				throw new Error(`Photo file not found: ${resolvedPath}`);
			}
			try {
				await bot.sendPhoto(chatId, photo, {
					caption: caption || undefined,
					parse_mode: caption ? "Markdown" : undefined,
				});
			} catch (markdownError) {
				if (!caption) throw new Error(`Failed to send photo: ${markdownError}`);
				await bot.sendPhoto(chatId, photo, { caption });
			}
			return {
				content: [{ type: "text" as const, text: `Photo sent to chat ${chatId}` }],
				details: { chatId, photoPath, caption },
			};
		},
	});

	pi.registerCommand("telegram_chats", {
		description: "List Telegram chats that have messaged this bot during the current process",
		handler: async (_args, ctx) => {
			if (activeChats.size === 0) {
				ctx.ui.notify("No active Telegram chats", "info");
				return;
			}
			const chatList = Array.from(activeChats.entries())
				.map(([chatId, info]) => {
					const userInfo = info.username
						? `@${info.username}`
						: `${info.firstName || ""} ${info.lastName || ""}`.trim();
					return `${chatId}: ${userInfo}`;
				})
				.join("\n");
			ctx.ui.notify(`Active Telegram chats:\n${chatList}`, "info");
		},
	});

	pi.registerCommand("telegram_stop", {
		description: "Stop the current agent turn (also used by the Telegram /stop command)",
		handler: async (_args, ctx) => {
			ctx.abort();
			ctx.ui.notify("Execution stopped via Telegram", "info");
		},
	});

	pi.registerCommand("newsession", {
		description: "Start a new Pi session (also used by the Telegram /newsession command)",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			if (bot && pollingStarted) {
				await bot.stopPolling({ cancel: true });
				pollingStarted = false;
			}
			await ctx.newSession({
				withSession: async (newCtx) => {
					newCtx.ui.notify("New session started.", "info");
				},
			});
		},
	});
}

function notifyAllowlist(
	ctx: { ui: { notify: (message: string, level: "info" | "warning") => void } },
	config: TelegramConfig,
): void {
	if (!config.allowlistEnabled) {
		ctx.ui.notify("Telegram user allowlist is disabled — any user may message the bot.", "warning");
		return;
	}
	if (config.allowedUserIds.size === 0 && config.allowedGroupChatIds.size === 0) {
		ctx.ui.notify(
			"Telegram allowlist is enabled but TELEGRAM_ALLOWED_USER_IDS and TELEGRAM_ALLOWED_GROUP_CHAT_IDS are empty — no one can use the bot.",
			"warning",
		);
		return;
	}
	const parts: string[] = [];
	if (config.allowedUserIds.size > 0) parts.push(`${config.allowedUserIds.size} allowlisted user(s)`);
	if (config.allowedGroupChatIds.size > 0) parts.push(`${config.allowedGroupChatIds.size} allowlisted group chat(s)`);
	ctx.ui.notify(`Telegram allowlist enabled (${parts.join(", ")}).`, "info");
}

function assertCanSend(allowSend: (chatId: number) => boolean, chatId: number): void {
	if (allowSend(chatId)) return;
	throw new Error(
		`Refused: chat ${chatId} is not allowed for outbound Telegram messages. With the allowlist enabled, only allowlisted group chats, or chats that have already messaged this bot from an allowlisted user, may be targeted.`,
	);
}

async function sendText(bot: TelegramBot, chatId: number, message: string) {
	try {
		await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
		return {
			content: [{ type: "text" as const, text: `Message sent to chat ${chatId}` }],
			details: { chatId, message },
		};
	} catch {
		await bot.sendMessage(chatId, message);
		return {
			content: [{ type: "text" as const, text: `Message sent to chat ${chatId} (plain text fallback)` }],
			details: { chatId, message },
		};
	}
}

async function sendPhotoFile(bot: TelegramBot, chatId: number, imagePath: string, message: string) {
	try {
		await bot.sendPhoto(chatId, imagePath, { caption: message, parse_mode: "Markdown" });
		return {
			content: [{ type: "text" as const, text: `Image sent to chat ${chatId}` }],
			details: { chatId, message, imagePath },
		};
	} catch {
		await bot.sendPhoto(chatId, imagePath, { caption: message });
		return {
			content: [{ type: "text" as const, text: `Image sent to chat ${chatId} (plain text caption fallback)` }],
			details: { chatId, message, imagePath },
		};
	}
}

async function consumePendingUpdates(bot: TelegramBot): Promise<void> {
	try {
		const updates = await bot.getUpdates({ timeout: 0 });
		if (!updates?.length) return;
		const maxUpdateId = updates.reduce((max, update) => Math.max(max, update.update_id), 0);
		await bot.getUpdates({ offset: maxUpdateId + 1, timeout: 0 });
	} catch (error) {
		console.error("Failed to consume pending Telegram updates:", error);
	}
}

function messageContent(message: unknown): unknown {
	if (!message || typeof message !== "object" || !("content" in message)) return undefined;
	return message.content;
}

function turnCalledTelegramTool(messages: readonly unknown[]): boolean {
	for (const message of messages) {
		const content = messageContent(message);
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const call = part as { type?: string; name?: string };
			if (call.type === "toolCall" && call.name && TELEGRAM_TOOLS.has(call.name)) return true;
		}
	}
	return false;
}

function lastAssistantText(messages: readonly unknown[]): string {
	const last = [...messages].reverse().find((message) => {
		return !!message && typeof message === "object" && "role" in message && message.role === "assistant";
	});
	const content = messageContent(last);
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as { type?: string; text?: string };
		if (block.type === "text" && block.text) text += block.text;
	}
	return text;
}
