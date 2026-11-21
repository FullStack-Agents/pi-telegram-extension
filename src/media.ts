import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type TelegramBot from "node-telegram-bot-api";

const execFileAsync = promisify(execFile);

export interface InboundContent {
	text: string;
	attachmentInfo: string;
}

export function splitCommand(input: string): string[] {
	const args: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const match of input.matchAll(re)) {
		args.push(match[1] ?? match[2] ?? match[3] ?? "");
	}
	return args.filter((part) => part.length > 0);
}

function safeFileName(name: string | undefined, fallback: string): string {
	const base = path.basename(name ?? "").replace(/[^A-Za-z0-9._-]+/g, "_");
	if (!base || base === "." || base === ".." || base === "_") return fallback;
	return base.slice(0, 120);
}

async function downloadTo(url: string, dest: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download Telegram file: ${response.status} ${response.statusText}`);
	}
	await mkdir(path.dirname(dest), { recursive: true });
	await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

async function transcribe(command: string, filePath: string): Promise<string> {
	const parts = splitCommand(command);
	const bin = parts[0];
	if (!bin) throw new Error("TELEGRAM_TRANSCRIBE_COMMAND is empty");
	const { stdout } = await execFileAsync(bin, [...parts.slice(1), filePath], {
		timeout: 60_000,
		maxBuffer: 10 * 1024 * 1024,
	});
	return stdout.trim();
}

async function saveFile(
	bot: TelegramBot,
	fileId: string,
	dest: string,
): Promise<{ localPath: string } | { remoteUrl: string; error: unknown }> {
	const remoteUrl = await bot.getFileLink(fileId);
	try {
		await downloadTo(remoteUrl, dest);
		return { localPath: dest };
	} catch (error) {
		return { remoteUrl, error };
	}
}

/**
 * Turn a Telegram update into text for the agent.
 * Voice messages and video notes are transcribed only when
 * `transcribeCommand` is set. Otherwise they are saved like any other file.
 */
export async function readInboundMessage(
	bot: TelegramBot,
	msg: TelegramBot.Message,
	options: { downloadDir: string; transcribeCommand?: string },
): Promise<InboundContent> {
	let text = msg.text || msg.caption || "";
	let attachmentInfo = "";
	const { downloadDir, transcribeCommand } = options;

	const noteSaved = (label: string, localPath: string) => {
		attachmentInfo = `\n[${label}: ${localPath}]`;
	};
	const noteFailed = (label: string, remoteUrl: string) => {
		attachmentInfo = `\n[${label}: ${remoteUrl}] (local save failed)`;
	};

	if (msg.photo) {
		const photo = msg.photo[msg.photo.length - 1];
		if (photo) {
			const dest = path.join(downloadDir, safeFileName(undefined, `tg_photo_${photo.file_id}.jpg`));
			const saved = await saveFile(bot, photo.file_id, dest);
			if ("localPath" in saved) noteSaved("Image", saved.localPath);
			else noteFailed("Image", saved.remoteUrl);
		}
	} else if (msg.document) {
		const doc = msg.document;
		const dest = path.join(downloadDir, safeFileName(doc.file_name, `tg_doc_${doc.file_id}`));
		const saved = await saveFile(bot, doc.file_id, dest);
		if ("localPath" in saved) {
			attachmentInfo = `\n[Document: ${path.basename(saved.localPath)} (${saved.localPath})]`;
		}
		else noteFailed(`Document: ${doc.file_name || "unknown"}`, saved.remoteUrl);
	} else if (msg.video) {
		const dest = path.join(downloadDir, `tg_video_${msg.video.file_id}.mp4`);
		const saved = await saveFile(bot, msg.video.file_id, dest);
		if ("localPath" in saved) noteSaved("Video", saved.localPath);
		else noteFailed("Video", saved.remoteUrl);
	} else if (msg.video_note || msg.voice) {
		const kind = msg.video_note ? "video note" : "voice";
		const fileId = msg.video_note?.file_id ?? msg.voice?.file_id;
		const extension = msg.video_note ? "mp4" : "ogg";
		if (fileId) {
			const dest = path.join(downloadDir, `tg_${kind.replace(" ", "_")}_${fileId}.${extension}`);
			const saved = await saveFile(bot, fileId, dest);
			const label = kind === "video note" ? "Video message" : "Voice";
			if ("localPath" in saved) {
				const spoken = await transcribeSavedFile(saved.localPath, label, transcribeCommand);
				if (spoken.text) text = spoken.text;
				attachmentInfo = spoken.attachmentInfo;
			} else {
				noteFailed(label, saved.remoteUrl);
			}
		}
	} else if (msg.audio) {
		const fileName = (msg.audio as { file_name?: string }).file_name;
		const dest = path.join(downloadDir, safeFileName(fileName, `tg_audio_${msg.audio.file_id}.mp3`));
		const saved = await saveFile(bot, msg.audio.file_id, dest);
		if ("localPath" in saved) noteSaved("Audio", saved.localPath);
		else noteFailed("Audio", saved.remoteUrl);
	}

	return { text, attachmentInfo };
}

async function transcribeSavedFile(
	localPath: string,
	label: string,
	transcribeCommand: string | undefined,
): Promise<{ text?: string; attachmentInfo: string }> {
	if (!transcribeCommand) {
		return { attachmentInfo: `\n[${label}: ${localPath}]` };
	}
	try {
		const transcript = await transcribe(transcribeCommand, localPath);
		if (!transcript) return { attachmentInfo: `\n[${label}: ${localPath}] (empty transcription)` };
		return { text: transcript, attachmentInfo: "" };
	} catch (error) {
		console.error(`Error transcribing Telegram ${label}:`, error);
		return { attachmentInfo: `\n[${label}: ${localPath}] (transcription failed)` };
	}
}
