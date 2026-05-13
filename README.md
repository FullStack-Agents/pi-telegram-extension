# Pi Telegram Extension

A Pi extension that enables two-way communication between Pi (the coding agent) and Telegram users.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Install to Pi
mkdir -p ~/.pi/agent/extensions
cp -r . ~/.pi/agent/extensions/pi-telegram-extension

# Restart Pi
```

## Configuration (environment variables)

Set these in the same environment that launches Pi (e.g. your shell profile, systemd unit, or wrapper script).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from [@BotFather](https://t.me/BotFather). |
| `TELEGRAM_ALLOWLIST_ENABLED` | No | `true` (on) | Set to `false`, `0`, `no`, or `off` to disable the user allowlist and allow anyone to use the bot (legacy behavior). |
| `TELEGRAM_ALLOWED_USER_IDS` | When allowlist on | — | Comma-separated numeric Telegram user IDs that may DM the bot and receive replies. Ignored when the allowlist is disabled. |
| `TELEGRAM_ALLOWED_GROUP_CHAT_IDS` | When allowlist on | — | Comma-separated numeric Telegram **chat** IDs for groups/supergroups where anyone may message the bot and receive replies. Use the negative ID Telegram reports for the group (e.g. `-5017058965`). Ignored when the allowlist is disabled. |

With the allowlist **enabled** (default), only listed users (in DMs or any chat) or anyone in an allowlisted group can trigger `/newsession`, `/stop`, and normal messages. Outbound sends (`telegram_send` and auto-reply) are allowed to allowlisted group chat IDs, and to other `chat_id` values the bot has already seen from an allowlisted user (e.g. that user’s DM or a group after they used a command).

With the allowlist **disabled**, behavior matches the previous open setup: any Telegram user can interact with the bot, and `telegram_send` may target any chat ID.

## Documentation

- [Setup Guide](dev-docs/SETUP.md) - Step-by-step installation
- [Architecture](dev-docs/README.md) - Design decisions and API usage
- [Lessons Learned](dev-docs/LESSONS_LEARNED.md) - Key insights from development
- [Gotchas](dev-docs/GOTCHAS.md) - Common issues and troubleshooting
- [Development Log](dev-docs/DEV_LOG.md) - Chronological development history

## How It Works

1. Telegram user sends message to @trout_pi_bot
2. Extension receives message and forwards to Pi via `sendUserMessage()`
3. Pi generates a response
4. Extension captures response via `agent_end` event
5. Extension automatically sends response back to Telegram

## Telegram Bot Commands

The extension supports the following slash commands:

| Command | Description |
|---------|-------------|
| `/newsession` | Create a new Pi session (clears context via extension command) |
| `/stop` | Stop current Pi execution immediately |

### `/newsession`

Dispatches the extension-registered Pi command `/newsession` (which calls `ctx.newSession()` after `ctx.waitForIdle()`). It is not forwarded as normal user text to the model.

**Usage:** Send `/newsession` in Telegram.

**Response:** "🔄 Creating new session..."

### /stop Command
Immediately aborts any ongoing Pi execution. Use this when Pi goes off the rails or gets stuck in a loop.

**Usage:** Send `/stop` in Telegram

**Response:** "🛑 Stopping current execution..."

## License

MIT
