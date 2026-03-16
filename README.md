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
| `/new` | Create a new Pi session (clears context) |
| `/stop` | Stop current Pi execution immediately |

### /new Command
Creates a fresh Pi session with an empty context window. Useful when you want to start a new conversation without restarting Pi.

**Usage:** Send `/new` in Telegram

**Response:** "🔄 Creating new Pi session..."

### /stop Command
Immediately aborts any ongoing Pi execution. Use this when Pi goes off the rails or gets stuck in a loop.

**Usage:** Send `/stop` in Telegram

**Response:** "🛑 Stopping current execution..."

## License

MIT
