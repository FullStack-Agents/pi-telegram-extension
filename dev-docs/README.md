# Pi Telegram Extension

A Pi extension that enables two-way communication between Pi (the coding agent) and Telegram users.

## Overview

This extension allows Pi to:
- Receive messages from Telegram users
- Automatically send responses back to Telegram
- Track active conversations

## Architecture

```
┌─────────────────┐     Telegram Bot API      ┌──────────────────┐
│  Telegram User  │ ◄──────────────────────► │  Pi Extension    │
│  (@christroutner)│                           │  (this code)     │
└─────────────────┘                           └────────┬─────────┘
                                                       │
                                                       │ sendUserMessage()
                                                       │ agent_end event
                                                       ▼
                                              ┌──────────────────┐
                                              │  Pi (Qwen3.5:9B) │
                                              │  - Receives msg  │
                                              │  - Generates reply│
                                              │  - Auto-sent back │
                                              └──────────────────┘
```

## How It Works

### Message Flow (Incoming)
1. Telegram user sends message to @trout_pi_bot
2. Extension receives message via `node-telegram-bot-api` polling
3. Extension stores the chat ID in `currentTelegramChatId`
4. Extension formats message and sends to Pi via `pi.sendUserMessage()`

### Message Flow (Outgoing - Auto-Reply)
1. Pi processes the message and generates a text response
2. `agent_end` event fires after Pi finishes
3. Extension captures Pi's response from the last assistant message
4. Extension sends response to Telegram using stored `currentTelegramChatId`
5. Chat ID is cleared to prevent accidental replies

## Key Design Decisions

### Why Auto-Reply Instead of Tool-Based Response?

**Problem:** Smaller models (like Qwen3.5:9B) don't consistently follow system prompt instructions to use tools. When we tried adding "Use telegram_send tool to respond" to the system prompt, Pi would often just output text instead of calling the tool.

**Solution:** Use the `agent_end` event to automatically capture Pi's text response and send it to Telegram. This works regardless of whether Pi uses the tool or not.

**Trade-offs:**
- ✅ Works with smaller models that struggle with tool-use instructions
- ✅ No need to modify Pi's behavior or training
- ✅ Simple and reliable
- ❌ Pi doesn't know its response was sent to Telegram (could be confusing in some contexts)
- ❌ All text responses are sent, even if Pi generates multiple messages

### Why Store Chat ID in Module-Level Variable?

The `currentTelegramChatId` is stored as a module-level variable rather than in the extension context because:
- The message handler and `agent_end` handler need to share state
- Pi sessions are ephemeral (RPC mode)
- Simpler than implementing a persistent store for this use case

**Gotcha:** If multiple Telegram messages arrive before Pi responds, only the last chat ID is used. This is acceptable for 1:1 conversations but would need reworking for group chats or high-volume scenarios.

## File Structure

```
pi-telegram-extension/
├── package.json          # Extension metadata and dependencies
├── tsconfig.json         # TypeScript configuration
├── src/
│   └── index.ts          # Main extension code
└── dist/
    └── index.js          # Compiled JavaScript (loaded by Pi)
```

## Installation Location

The extension is installed at:
```
~/.pi/agent/extensions/pi-telegram-extension/
```

Pi auto-discovers extensions from this directory.

## Dependencies

- `@earendil-works/pi-coding-agent` — Pi extension API and types (npm scope may change with upstream releases; see root `package.json`)
- `@sinclair/typebox` — JSON schema validation for tool parameters
- `fs-extra` — optional file helpers for downloaded media
- `node-telegram-bot-api` — Telegram Bot API client

## Configuration

Configure via environment variables (see the project `README.md`):

- `TELEGRAM_BOT_TOKEN` (required)
- `TELEGRAM_ALLOWLIST_ENABLED` — default `true`; set to `false` / `0` / `no` / `off` to allow any Telegram user (legacy behavior)
- `TELEGRAM_ALLOWED_USER_IDS` — comma-separated numeric user IDs when the allowlist is enabled

## Extension API Usage

### Events Used

| Event | Purpose |
|-------|---------|
| `session_start` | Initialize Telegram bot, start polling |
| `agent_end` | Capture Pi's response and auto-send to Telegram |
| `session_shutdown` | Clean up bot polling |

### Tools Registered

| Tool | Purpose |
|------|---------|
| `telegram_send` | Manual fallback for sending messages to specific chat IDs |

### Commands Registered

| Command | Purpose |
|---------|---------|
| `/telegram_chats` | List active Telegram conversations |
| `/telegram_stop` | Stop current execution (triggered from Telegram `/stop`) |
| `/newsession` | Start a new Pi session (same entry point as `pi.sendUserMessage("/newsession")` from Telegram) |

### Telegram Bot Commands

The extension handles these Telegram slash commands directly (they are **not** forwarded as normal Telegram text to the model):

| Command | Description |
|---------|-------------|
| `/newsession` | New Pi session (clears context window) |
| `/stop` | Immediately stop current Pi execution |

**How they work:**

- `/newsession` — Telegram sends a confirmation message, then `pi.sendUserMessage("/newsession")` runs the extension’s `registerCommand("newsession")` handler (which uses `ExtensionCommandContext`: `waitForIdle()` then `newSession()`). You cannot call `newSession()` from `session_start` / `bot.on("message")` context; that `ctx` is only `ExtensionContext`.
- `/stop` — Sends confirmation, then `pi.sendUserMessage("/telegram_stop")` runs the `/telegram_stop` command (`ctx.abort()`).

## Message Format

Incoming messages are formatted as:
```
[Telegram from @username]: Message text here
```

Or if no username:
```
[Telegram from FirstName LastName]: Message text here
```

## Limitations & Future Improvements

### Current Limitations

1. **No message history** — Extension does not persist chat history across Pi restarts
2. **Single chat tracking** — Only one `currentTelegramChatId` at a time for auto-reply (last Telegram message wins)
3. **No rate limiting** — High volume could hit Telegram API limits

### Potential Improvements

1. **Persistent storage** — Store chat history in SQLite or JSON file
2. **Multi-chat support** — Map Pi turns to Telegram `chat_id` instead of a single module variable
3. **Rate limiting** — Exponential backoff for Telegram sends
4. **Reply threading** — Support Telegram reply-to-message feature
5. **Command parsing** — Handle `/start`, `/help`, etc.

## Debugging

### Check if extension is loaded
```bash
tmux capture-pane -t pi-bot -p | grep "Telegram bot connected"
```

### View recent messages
```bash
tmux capture-pane -t pi-bot -p | grep "Telegram from"
```

### Check for errors
```bash
tmux capture-pane -t pi-bot -p | grep -i error
```

### Restart Pi with fresh session
```bash
tmux kill-session -t pi-bot
rm -rf ~/.pi/agent/sessions/*
tmux new-session -d -s pi-bot "cd /home/ben && pi --mode rpc"
```

## Related Documentation

- [Pi Extension API](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
