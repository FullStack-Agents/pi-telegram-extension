import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import TelegramBot from "node-telegram-bot-api";

// Telegram Bot API token
const TELEGRAM_BOT_TOKEN = "8347300929:AAEfef-yMZSBXJIfeWeiGuZKX-JGamOs8cM";

// Store active chat IDs and their associated Pi sessions
const activeChats = new Map<number, {
  username?: string;
  firstName?: string;
  lastName?: string;
}>();

// Track the current Telegram chat for auto-reply
let currentTelegramChatId: number | null = null;

export default function (pi: ExtensionAPI) {
  let bot: TelegramBot | null = null;

  // Initialize bot on session start
  pi.on("session_start", async (_event, ctx) => {
    try {
      // Create bot without polling initially to avoid conflicts
      bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
      
      // Get bot info to verify connection
      const botInfo = await bot.getMe();
      ctx.ui.notify(`Telegram bot connected: @${botInfo.username}`, "info");
      
      // Start polling for messages
      bot.startPolling();
      
      // Handle incoming messages
      bot.on("message", async (msg) => {
        if (!msg.text) return;
        
        const chatId = msg.chat.id;
        const username = msg.from?.username;
        const firstName = msg.from?.first_name;
        const lastName = msg.from?.last_name;
        
        // Store chat info
        if (!activeChats.has(chatId)) {
          activeChats.set(chatId, { username, firstName, lastName });
        }
        
        // Set current chat ID for auto-reply
        currentTelegramChatId = chatId;
        
        // Format the incoming message for Pi with clear instructions to use telegram_send
        const userInfo = username ? `@${username}` : `${firstName || ""} ${lastName || ""}`.trim();
        const formattedMessage = `[Telegram from ${userInfo}]: ${msg.text}\n\nTo reply, use: telegram_send with chatId=${chatId}`;
        
        // Send to Pi as a user message
        pi.sendUserMessage(formattedMessage);
      });
      
      // Handle errors
      bot.on("error", (error) => {
        console.error("Telegram bot error:", error);
      });
      
      // Handle polling errors
      bot.on("polling_error", (error) => {
        console.error("Telegram polling error:", error);
      });
      
    } catch (error) {
      ctx.ui.notify(`Failed to start Telegram bot: ${error}`, "warning");
      console.error(error);
    }

    // Inject context about how to respond to Telegram messages
    pi.on("before_agent_start", async (event, ctx) => {
      // Check if this is a Telegram message
      if (event.prompt.includes("[Telegram from")) {
        // Extract chatId from the prompt
        const chatIdMatch = event.prompt.match(/chatId=(\d+)/);
        if (chatIdMatch) {
          const chatId = parseInt(chatIdMatch[1], 10);
          
          // Store the current chatId for this turn (already set by message handler)
          (ctx as any).currentTelegramChatId = chatId;
          
          // Append instructions to system prompt
          return {
            systemPrompt: event.systemPrompt + "\n\nIMPORTANT: You received a message from Telegram. To respond, you MUST use the 'telegram_send' tool with the chatId provided in the message. Do not just reply with text - use the tool to send the message back to Telegram."
          };
        }
      }
      return {};
    });
  });

  // Auto-send Pi's text responses back to Telegram (only if not already handled by tool)
  pi.on("agent_end", async (event, ctx) => {
    // Only auto-reply if we have a current Telegram chat ID in context
    const telegramChatId = (ctx as any).currentTelegramChatId;
    
    if (!telegramChatId || !bot) {
      return;
    }
    
    // Get the last assistant message
    const messages = event.messages;
    const lastAssistantMsg = messages.filter(m => m.role === "assistant").pop();
    
    if (!lastAssistantMsg || !lastAssistantMsg.content) {
      (ctx as any).currentTelegramChatId = null;
      return;
    }
    
    // Extract text content
    let responseText = "";
    for (const content of lastAssistantMsg.content) {
      if (content.type === "text") {
        responseText += content.text;
      }
    }
    
    // Skip if no text or if it's just a tool result message
    if (!responseText.trim()) {
      (ctx as any).currentTelegramChatId = null;
      return;
    }
    
    // Skip if the response already mentions sending or is just about sending (avoid double-send)
    if (responseText.includes("Message sent to chat") || 
        responseText.includes("telegram_send tool") ||
        responseText.includes("I've answered")) {
      return;
    }
    
    try {
      // Send the response back to Telegram
      await bot.sendMessage(telegramChatId, responseText);
      ctx.ui.notify(`Auto-replied to Telegram chat ${telegramChatId}`, "info");
    } catch (error) {
      console.error("Failed to auto-reply to Telegram:", error);
    }
    
    // Clear current chat ID after replying
    (ctx as any).currentTelegramChatId = null;
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async () => {
    if (bot) {
      bot.stopPolling();
      bot = null;
    }
  });

  // Register tool to send messages back to Telegram (manual fallback)
  pi.registerTool({
    name: "telegram_send",
    label: "Send Telegram Message",
    description: "Send a message to a Telegram user or chat",
    parameters: Type.Object({
      chatId: Type.Number({ description: "Telegram chat ID to send message to" }),
      message: Type.String({ description: "Message text to send" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!bot) {
        throw new Error("Telegram bot not initialized");
      }
      
      const { chatId, message } = params as { chatId: number; message: string };
      
      try {
        await bot.sendMessage(chatId, message);
        return {
          content: [{ type: "text", text: `Message sent to chat ${chatId}` }],
          details: { chatId, message },
        };
      } catch (error) {
        throw new Error(`Failed to send message: ${error}`);
      }
    },
  });

  // Register command to list active chats
  pi.registerCommand("telegram_chats", {
    description: "List active Telegram chats",
    handler: async (_args, ctx) => {
      if (activeChats.size === 0) {
        ctx.ui.notify("No active Telegram chats", "info");
        return;
      }
      
      const chatList = Array.from(activeChats.entries()).map(([chatId, info]) => {
        const userInfo = info.username ? `@${info.username}` : `${info.firstName || ""} ${info.lastName || ""}`.trim();
        return `${chatId}: ${userInfo}`;
      }).join("\n");
      
      ctx.ui.notify(`Active Telegram chats:\n${chatList}`, "info");
    },
  });
}
