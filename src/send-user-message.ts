import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

/** sendUserMessage options (expandPromptTemplates missing from pi-coding-agent 0.74 types). */
export type SendUserMessageOptions = {
	deliverAs?: "steer" | "followUp";
	expandPromptTemplates?: boolean;
};

export function sendUserMessage(
	pi: ExtensionAPI,
	content: string | (TextContent | ImageContent)[],
	options?: SendUserMessageOptions,
): void {
	pi.sendUserMessage(content, options as Parameters<ExtensionAPI["sendUserMessage"]>[1]);
}
