import os from "node:os";
import path from "node:path";

export interface TelegramConfig {
	allowlistEnabled: boolean;
	allowedUserIds: ReadonlySet<number>;
	allowedGroupChatIds: ReadonlySet<number>;
	downloadDir: string;
	/** Executable plus optional arguments. The media file path is appended. */
	transcribeCommand: string | undefined;
}

function parseIdSet(raw: string | undefined): Set<number> {
	const set = new Set<number>();
	for (const part of (raw ?? "").split(",")) {
		const n = Number(part.trim());
		if (Number.isInteger(n)) set.add(n);
	}
	return set;
}

export function parseAllowlistEnabled(raw: string | undefined): boolean {
	if (raw === undefined || raw.trim() === "") return true;
	return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

export function loadTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
	const downloadDir = env.TELEGRAM_DOWNLOAD_DIR?.trim();
	const transcribeCommand = env.TELEGRAM_TRANSCRIBE_COMMAND?.trim();
	return {
		allowlistEnabled: parseAllowlistEnabled(env.TELEGRAM_ALLOWLIST_ENABLED),
		allowedUserIds: parseIdSet(env.TELEGRAM_ALLOWED_USER_IDS),
		allowedGroupChatIds: parseIdSet(env.TELEGRAM_ALLOWED_GROUP_CHAT_IDS),
		downloadDir: downloadDir || path.join(os.tmpdir(), "pi-telegram"),
		transcribeCommand: transcribeCommand || undefined,
	};
}

export function getBotToken(env: NodeJS.ProcessEnv = process.env): string {
	const token = env.TELEGRAM_BOT_TOKEN?.trim();
	if (!token) {
		throw new Error("TELEGRAM_BOT_TOKEN is not set. Set it in the environment before starting Pi.");
	}
	return token;
}

export function isAllowedSender(config: TelegramConfig, chatId: number, userId: number | undefined): boolean {
	if (!config.allowlistEnabled) return true;
	if (config.allowedGroupChatIds.has(chatId)) return true;
	return typeof userId === "number" && config.allowedUserIds.has(userId);
}

/**
 * Outbound sends are allowed to configured group chats, and to chats that an
 * allowlisted user has already contacted. Direct-message chat ids match the
 * user id, so those are allowed up front.
 */
export function createOutboundAllowlist(config: TelegramConfig): Set<number> {
	return new Set(config.allowedUserIds);
}

export function canSendToChat(config: TelegramConfig, outbound: ReadonlySet<number>, chatId: number): boolean {
	if (!config.allowlistEnabled) return true;
	if (config.allowedGroupChatIds.has(chatId)) return true;
	return outbound.has(chatId);
}

export function rememberInboundChat(
	config: TelegramConfig,
	outbound: Set<number>,
	chatId: number,
	userId: number | undefined,
): void {
	if (!config.allowlistEnabled) return;
	if (config.allowedGroupChatIds.has(chatId) || (typeof userId === "number" && config.allowedUserIds.has(userId))) {
		outbound.add(chatId);
	}
}
