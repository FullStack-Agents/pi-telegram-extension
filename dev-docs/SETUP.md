# Setup Guide

Step-by-step instructions for setting up the Pi Telegram extension.

## Prerequisites

- Pi (coding agent) installed and running
- Node.js 18+ installed
- Telegram Bot API token
- Access to the Pi server (192.168.0.129)

## Step 1: Create the Extension Directory

```bash
mkdir -p /home/ben/pi-telegram-extension/src
```

## Step 2: Create package.json

Create `/home/ben/pi-telegram-extension/package.json`:

```json
{
  "name": "pi-telegram-extension",
  "version": "1.0.0",
  "description": "Telegram integration for Pi coding agent",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@mariozechner/pi-coding-agent": "^0.58.3",
    "@sinclair/typebox": "^0.34.0",
    "node-telegram-bot-api": "^0.66.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/node-telegram-bot-api": "^0.64.0",
    "typescript": "^5.0.0"
  },
  "pi": {
    "extensions": ["./dist/index.js"]
  }
}
```

## Step 3: Create tsconfig.json

Create `/home/ben/pi-telegram-extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Step 4: Create the Extension Code

Create `/home/ben/pi-telegram-extension/src/index.ts` with the full implementation (see README.md for the complete code).

**Key points:**
- Set `TELEGRAM_BOT_TOKEN` (and optionally `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_ALLOWED_GROUP_CHAT_IDS`, `TELEGRAM_ALLOWLIST_ENABLED`) in the environment before starting Pi
- Use `agent_end` event for auto-reply
- Store chat ID in module-level variable

## Step 5: Install Dependencies

```bash
cd /home/ben/pi-telegram-extension
npm install
```

## Step 6: Build the Extension

```bash
npm run build
```

This creates `dist/index.js` and `dist/index.d.ts`.

## Step 7: Install to Pi

```bash
# Create Pi extensions directory
mkdir -p ~/.pi/agent/extensions

# Copy extension
cp -r /home/ben/pi-telegram-extension ~/.pi/agent/extensions/

# Verify installation
ls ~/.pi/agent/extensions/pi-telegram-extension/dist/
```

## Step 8: Restart Pi

```bash
# Kill existing Pi session
tmux kill-session -t pi-bot 2>/dev/null

# Clear old sessions (optional but recommended)
rm -rf ~/.pi/agent/sessions/*

# Start Pi with RPC mode
tmux new-session -d -s pi-bot "cd /home/ben && pi --mode rpc"
```

## Step 9: Verify Installation

Check that the bot connected:

```bash
tmux capture-pane -t pi-bot -p | grep "Telegram bot connected"
```

You should see:
```
Telegram bot connected: @trout_pi_bot
```

## Step 10: Test

1. Open Telegram
2. Message @trout_pi_bot
3. Wait for response
4. Response should arrive within seconds

### Testing Commands

**Test /new:**
```
/new
```
Expected: "🔄 Creating new Pi session..."

**Test /stop:**
1. Ask Pi to do something long-running
2. Send `/stop`
Expected: "🛑 Stopping current execution..."

## Updating the Extension

When making changes:

```bash
# 1. Edit source code
cd /home/ben/pi-telegram-extension
# ... make changes to src/index.ts ...

# 2. Rebuild
npm run build

# 3. Copy to extension directory
cp dist/index.js ~/.pi/agent/extensions/pi-telegram-extension/dist/

# 4. Restart Pi
tmux kill-session -t pi-bot
rm -rf ~/.pi/agent/sessions/*
tmux new-session -d -s pi-bot "cd /home/ben && pi --mode rpc"
```

## Uninstalling

```bash
# Remove extension
rm -rf ~/.pi/agent/extensions/pi-telegram-extension

# Restart Pi
tmux kill-session -t pi-bot
tmux new-session -d -s pi-bot "cd /home/ben && pi --mode rpc"
```

## Troubleshooting

See GOTCHAS.md for common issues and solutions.
