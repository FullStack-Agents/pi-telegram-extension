import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs-extra";
import path from "path";
import os from "os";

function parseAllowlistEnabled(): boolean {
  const v = process.env.TELEGRAM_ALLOWLIST_ENABLED;
  if (v === undefined || v.trim() === "") return true;
  const lower = v.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(lower);
}

function parseAllowedUserIds(): Set<number> {
  const raw = process.env.TELEGRAM_ALLOWED_USER_IDS ?? "";
  const set = new Set<number>();
  for (const part of raw.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n)) set.add(n);
  }
  return set;
}

function parseAllowedGroupChatIds(): Set<number> {
  const raw = process.env.TELEGRAM_ALLOWED_GROUP_CHAT_IDS ?? "";
  const set = new Set<number>();
  for (const part of raw.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n)) set.add(n);
  }
  return set;
}

function getBotToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t?.trim()) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not set. Set it in the environment before starting Pi."
    );
  }
  return t.trim();
}

const allowlistEnabled = parseAllowlistEnabled();
const allowedUserIds = parseAllowedUserIds();
const allowedGroupChatIds = parseAllowedGroupChatIds();

/** Chat IDs we have accepted an inbound message from while allowlist is on (outbound allowlist). */
const allowedOutboundChatIds = new Set<number>();

// Store active chat IDs and their associated Pi sessions
const activeChats = new Map<
  number,
  {
    username?: string;
    firstName?: string;
    lastName?: string;
  }
>();

// Track the current Telegram chat for auto-reply
let currentTelegramChatId: number | null = null;

function isAllowedTelegramMessage(msg: TelegramBot.Message): boolean {
  if (!allowlistEnabled) return true;
  if (allowedGroupChatIds.has(msg.chat.id)) return true;
  const userId = msg.from?.id;
  return typeof userId === "number" && allowedUserIds.has(userId);
}

function canSendToTelegramChat(chatId: number): boolean {
  if (!allowlistEnabled) return true;
  if (allowedGroupChatIds.has(chatId)) return true;
  return allowedOutboundChatIds.has(chatId);
}

function recordAllowedInboundChat(msg: TelegramBot.Message): void {
  const chatId = msg.chat.id;
  if (!allowlistEnabled) return;
  if (allowedGroupChatIds.has(chatId)) {
    allowedOutboundChatIds.add(chatId);
    return;
  }
  const userId = msg.from?.id;
  if (typeof userId === "number" && allowedUserIds.has(userId)) {
    allowedOutboundChatIds.add(chatId);
  }
}

export default function (pi: ExtensionAPI) {
  let bot: TelegramBot;
  let pollingStarted = false;

  pi.on("session_shutdown", async () => {
    if (bot) {
      bot.stopPolling();
      pollingStarted = false;
      bot = null as any;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      const token = getBotToken();
      bot = new TelegramBot(token, { polling: false });

      const botInfo = await bot.getMe();
      ctx.ui.notify(`Telegram bot connected: @${botInfo.username}`, "info");

      if (allowlistEnabled) {
        if (allowedUserIds.size === 0 && allowedGroupChatIds.size === 0) {
          ctx.ui.notify(
            "Telegram allowlist is enabled but TELEGRAM_ALLOWED_USER_IDS and TELEGRAM_ALLOWED_GROUP_CHAT_IDS are empty — no one can use the bot.",
            "warning"
          );
        } else {
          const parts: string[] = [];
          if (allowedUserIds.size > 0) {
            parts.push(`${allowedUserIds.size} allowlisted user(s)`);
          }
          if (allowedGroupChatIds.size > 0) {
            parts.push(`${allowedGroupChatIds.size} allowlisted group chat(s)`);
          }
          ctx.ui.notify(`Telegram allowlist enabled (${parts.join(", ")}).`, "info");
        }
      } else {
        ctx.ui.notify(
          "Telegram user allowlist is disabled — any user may message the bot.",
          "warning"
        );
      }

      bot.startPolling();
      pollingStarted = true;

      bot.on("message", async (msg) => {
        if (!isAllowedTelegramMessage(msg)) return;

        recordAllowedInboundChat(msg);

        const chatId = msg.chat.id;
        const username = msg.from?.username;
        const firstName = msg.from?.first_name;
        const lastName = msg.from?.last_name;

        if (!activeChats.has(chatId)) {
          activeChats.set(chatId, { username, firstName, lastName });
        }

        currentTelegramChatId = chatId;

        const userInfo = username
          ? `@${username}`
          : `${firstName || ""} ${lastName || ""}`.trim();

        let text = msg.text || msg.caption || "";
        let attachmentInfo = "";

        const tmpDir = path.join(os.homedir(), "tmp");
        await fs.ensureDir(tmpDir);

        if (msg.photo) {
          const photo = msg.photo[msg.photo.length - 1];
          if (!photo) return;
          const filePath = await bot.getFileLink(photo.file_id);
          const fileName = `tg_photo_${photo.file_id}.jpg`;
          const localPath = path.join(tmpDir, fileName);
          
          try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            await fs.writeFile(localPath, Buffer.from(arrayBuffer));
            attachmentInfo = `\n[Image: ${localPath}]`;
          } catch (e) {
            console.error("Error downloading telegram photo:", e);
            attachmentInfo = `\n[Image: ${filePath}] (local save failed)`;
          }
        } else if (msg.document) {
          const doc = msg.document;
          const filePath = await bot.getFileLink(doc.file_id);
          const fileName = doc.file_name || `tg_doc_${doc.file_id}`;
          const localPath = path.join(tmpDir, fileName);

          try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`Failed to fetch document: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            await fs.writeFile(localPath, Buffer.from(arrayBuffer));
            attachmentInfo = `\n[Document: ${fileName} (${localPath})]`;
          } catch (e) {
            console.error("Error downloading telegram document:", e);
            attachmentInfo = `\n[Document: ${doc.file_name || "unknown"} (${filePath})]`;
          }
        } else if (msg.video) {
          const filePath = await bot.getFileLink(msg.video.file_id);
          const fileName = `tg_video_${msg.video.file_id}.mp4`;
          const localPath = path.join(tmpDir, fileName);

          try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            await fs.writeFile(localPath, Buffer.from(arrayBuffer));
            attachmentInfo = `\n[Video: ${localPath}]`;
          } catch (e) {
            console.error("Error downloading telegram video:", e);
            attachmentInfo = `\n[Video: ${filePath}]`;
          }
        } else if (msg.voice) {
          const filePath = await bot.getFileLink(msg.voice.file_id);
          const fileName = `tg_voice_${msg.voice.file_id}.ogg`;
          const localPath = path.join(tmpDir, fileName);

          try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`Failed to fetch voice: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            await fs.writeFile(localPath, Buffer.from(arrayBuffer));
            attachmentInfo = `\n[Voice: ${localPath}]`;
          } catch (e) {
            console.error("Error downloading telegram voice:", e);
            attachmentInfo = `\n[Voice: ${filePath}]`;
          }
        } else if (msg.audio) {
          const filePath = await bot.getFileLink(msg.audio.file_id);
          const fileName = (msg.audio as any).file_name || `tg_audio_${msg.audio.file_id}.mp3`;
          const localPath = path.join(tmpDir, fileName);

          try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            await fs.writeFile(localPath, Buffer.from(arrayBuffer));
            attachmentInfo = `\n[Audio: ${localPath}]`;
          } catch (e) {
            console.error("Error downloading telegram audio:", e);
            attachmentInfo = `\n[Audio: ${filePath}]`;
          }
        }

        if (!text && !attachmentInfo) return;
        if (text.startsWith("/")) return;

        const formattedMessage = `[Telegram from ${userInfo}]: ${text}${attachmentInfo}\n\nTo reply, use: telegram_send with chatId=${chatId}`;

        pi.sendUserMessage(formattedMessage);
      });

      bot.on("error", (error) => {
        console.error("Telegram bot error:", error);
      });

      bot.on("polling_error", (error) => {
        console.error("Telegram polling error:", error);
      });

      bot.onText(/\/new/, async (msg) => {
        if (!isAllowedTelegramMessage(msg)) return;

        recordAllowedInboundChat(msg);

        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, "🔄 Creating new Pi session...");
        pi.sendUserMessage("/new");
      });

      bot.onText(/\/stop/, async (msg) => {
        if (!isAllowedTelegramMessage(msg)) return;

        recordAllowedInboundChat(msg);

        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, "🛑 Stopping current execution...");
        pi.sendUserMessage("/telegram_stop");
      });
    } catch (error) {
      console.error("Failed to start Telegram bot:", error);
    }

    pi.on("before_agent_start", async (event, ctx) => {
      const anyCtx = ctx as any;

      if (event.prompt.includes("[Telegram from")) {
        const chatIdMatch = event.prompt.match(/chatId=(-?\d+)/);
        if (chatIdMatch) {
          const chatId = parseInt(chatIdMatch[1], 10);

          anyCtx.currentTelegramChatId = chatId;

          return {
            systemPrompt:
              event.systemPrompt +
              "\n\nIMPORTANT: You received a message from Telegram. To respond, you MUST use the 'telegram_send' tool with the chatId provided in the message. Do not just reply with text - use the tool to send the message back to Telegram.",
          };
        }
      }
      return {};
    });
  });

  pi.on("agent_end", async (event, ctx) => {
    const anyCtx = ctx as any;

    const telegramChatId = anyCtx.currentTelegramChatId;

    if (!telegramChatId || !bot || !pollingStarted) {
      return;
    }

    if (!canSendToTelegramChat(telegramChatId)) {
      anyCtx.currentTelegramChatId = null;
      return;
    }

    try {
      const messages = event.messages;
      const lastAssistantMsg = messages.filter((m) => m.role === "assistant").pop();

      if (!lastAssistantMsg || !lastAssistantMsg.content) {
        anyCtx.currentTelegramChatId = null;
        return;
      }

      let responseText = "";
      for (const content of lastAssistantMsg.content) {
        if (content.type === "text") {
          responseText += content.text;
        }
      }

      if (!responseText.trim()) {
        anyCtx.currentTelegramChatId = null;
        return;
      }

      if (
        responseText.includes("Message sent to chat") ||
        responseText.includes("telegram_send tool") ||
        responseText.includes("I've answered")
      ) {
        return;
      }

      try {
        await bot.sendMessage(telegramChatId, responseText, { parse_mode: "Markdown" });
      } catch {
        // If Markdown parsing fails, fall back to plain text
        await bot.sendMessage(telegramChatId, responseText, { parse_mode: undefined });
      }
    } catch (error) {
      console.error("Failed to auto-reply to Telegram:", error);
    } finally {
      anyCtx.currentTelegramChatId = null;
    }
  });

  pi.registerTool({
    name: "telegram_send",
    label: "Send Telegram Message",
    description: "Send a message to a Telegram user or chat",
    parameters: Type.Object({
      chatId: Type.Number({ description: "Telegram chat ID to send message to" }),
      message: Type.String({ description: "Message text to send" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!bot) {
        throw new Error("Telegram bot not initialized");
      }

      const { chatId, message } = params as { chatId: number; message: string };

      if (!canSendToTelegramChat(chatId)) {
        throw new Error(
          `Refused: chat ${chatId} is not allowed for outbound Telegram messages. With the allowlist enabled, only allowlisted group chats, or chats that have already messaged this bot from an allowlisted user, may be targeted.`
        );
      }

      try {
        await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        return {
          content: [{ type: "text", text: `Message sent to chat ${chatId}` }],
          details: { chatId, message },
        };
      } catch (_markdownErr) {
        // If Markdown parsing fails (e.g. unescaped underscores), fall back to plain text.
        try {
          await bot.sendMessage(chatId, message, { parse_mode: undefined });
          return {
            content: [{ type: "text", text: `Message sent to chat ${chatId} (plain text fallback)` }],
            details: { chatId, message },
          };
        } catch (error) {
          throw new Error(`Failed to send message: ${error}`);
        }
      }
    },
  });

  pi.registerCommand("telegram_chats", {
    description: "List active Telegram chats",
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
    description: "Stop current execution (triggered from Telegram)",
    handler: async (_args, ctx) => {
      ctx.abort();
      ctx.ui.notify("Execution stopped via Telegram", "info");
    },
  });

  pi.registerCommand("new", {
    description: "Start a new session (triggered from Telegram)",
    handler: async (_args, ctx) => {
      await ctx.newSession();
    },
  });
}
