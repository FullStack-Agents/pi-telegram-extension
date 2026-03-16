# Gotchas & Troubleshooting

Common issues and their solutions.

## Gotcha 1: Pi Doesn't Respond to Telegram Messages

**Symptoms:**
- Message sent to @trout_pi_bot
- No response received
- Pi shows activity (nvtop) but nothing happens

**Checklist:**
1. Is the bot connected?
   ```bash
   tmux capture-pane -t pi-bot -p | grep "Telegram bot connected"
   ```

2. Is the extension loaded?
   ```bash
   ls ~/.pi/agent/extensions/pi-telegram-extension/dist/index.js
   ```

3. Check for errors:
   ```bash
   tmux capture-pane -t pi-bot -p | tail -50
   ```

**Common causes:**
- Extension not built: `cd /home/ben/pi-telegram-extension && npm run build`
- dist not copied: `cp dist/index.js ~/.pi/agent/extensions/pi-telegram-extension/dist/`
- node_modules missing: `cp -r node_modules ~/.pi/agent/extensions/pi-telegram-extension/`

---

## Gotcha 2: Pi Responds But Message Never Reaches Telegram

**Symptoms:**
- Pi generates a response (visible in tmux output)
- No message received on Telegram

**Causes:**

### Wrong Chat ID
Pi might be using an old/wrong chat ID from session history.

**Fix:**
```bash
rm -rf ~/.pi/agent/sessions/*
tmux kill-session -t pi-bot
tmux new-session -d -s pi-bot "cd /home/ben && pi --mode rpc"
```

### Extension Not Built
The `agent_end` handler might not be in the compiled code.

**Check:**
```bash
grep "agent_end" ~/.pi/agent/extensions/pi-telegram-extension/dist/index.js
```

**Fix:**
```bash
cd /home/ben/pi-telegram-extension
npm run build
cp dist/index.js ~/.pi/agent/extensions/pi-telegram-extension/dist/
```

---

## Gotcha 3: Extension Loads But Bot Doesn't Connect

**Symptoms:**
- No "Telegram bot connected" notification
- No error messages

**Check:**
1. Is the bot token valid?
   ```bash
   curl -s "https://api.telegram.org/bot8347300929:AAEfef-yMZSBXJIfeWeiGuZKX-JGamOs8cM/getMe"
   ```

2. Is another instance running?
   - Only one bot instance can poll at a time
   - Kill other Pi sessions: `tmux kill-session -t pi-bot`

---

## Gotcha 4: Changes Not Taking Effect

**Symptoms:**
- Modified source code
- Rebuilt extension
- Behavior hasn't changed

**Causes:**

### Pi Using Old Session
Pi might be restoring from a saved session.

**Fix:**
```bash
rm -rf ~/.pi/agent/sessions/*
```

### Wrong Build Directory
Built in `/home/ben/pi-telegram-extension/` but Pi loads from `~/.pi/agent/extensions/`.

**Fix:**
```bash
cp /home/ben/pi-telegram-extension/dist/index.js \
   ~/.pi/agent/extensions/pi-telegram-extension/dist/
```

### Extension Not Reloaded
Pi only loads extensions on startup or `/reload`.

**Fix:**
Restart Pi or use `/reload` command in Pi.

---

## Gotcha 5: Pi Gets Stuck in Loops

**Symptoms:**
- Pi keeps processing indefinitely
- High CPU usage (nvtop shows activity)
- No response or partial response

**Causes:**

### Old Task Files
Pi might be processing old task files that were left in `/home/ben/`.

**Fix:**
```bash
rm -f /home/ben/pi-telegram-task-*.md
```

### Conflicting Instructions
Multiple task files or conflicting prompts.

**Fix:**
Kill Pi and start fresh:
```bash
tmux kill-session -t pi-bot
rm -rf ~/.pi/agent/sessions/*
tmux new-session -d -s pi-bot "cd /home/ben && pi --mode rpc"
```

---

## Gotcha 6: Module Not Found Errors

**Error:**
```
Cannot find module 'node-telegram-bot-api'
```

**Causes:**

### node_modules Not Copied
Extension directory doesn't have dependencies.

**Fix:**
```bash
cp -r /home/ben/pi-telegram-extension/node_modules \
  ~/.pi/agent/extensions/pi-telegram-extension/
```

### Build From Wrong Directory
Built from extension directory without node_modules.

**Fix:**
Always build from source directory:
```bash
cd /home/ben/pi-telegram-extension
npm run build
```

---

## Gotcha 7: Chat ID Issues

**Problem:**
Pi sends to wrong chat ID or gets "chat not found" error.

**Understanding Chat IDs:**
- Your Telegram user ID: `649043967`
- Chat ID for direct messages: same as user ID
- Chat ID for groups: negative number (e.g., `-123456789`)

**Debug:**
Add logging to see what chat ID is being used:
```typescript
console.log("Current chat ID:", currentTelegramChatId);
```

---

## Gotcha 8: Rate Limiting

**Error:**
```
ETELEGRAM: 429 Too Many Requests
```

**Fix:**
Add delay between messages:
```typescript
await new Promise(resolve => setTimeout(resolve, 1000));
```

Or use exponential backoff for retries.

---

## Quick Diagnostic Commands

### Check extension is loaded
```bash
tmux capture-pane -t pi-bot -p | grep -i telegram
```

### Check bot connection
```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```

### View Pi's recent output
```bash
tmux capture-pane -t pi-bot -p | tail -100
```

### Full restart
```bash
tmux kill-session -t pi-bot
rm -rf ~/.pi/agent/sessions/*
tmux new-session -d -s pi-bot "cd /home/ben && pi --mode rpc"
```

---

## When All Else Fails

1. **Kill everything:**
   ```bash
   tmux kill-session -t pi-bot
   rm -rf ~/.pi/agent/sessions/*
   rm -f /home/ben/pi-telegram-task-*.md
   ```

2. **Rebuild from scratch:**
   ```bash
   cd /home/ben/pi-telegram-extension
   npm run build
   cp -r dist ~/.pi/agent/extensions/pi-telegram-extension/
   cp -r node_modules ~/.pi/agent/extensions/pi-telegram-extension/
   ```

3. **Start fresh:**
   ```bash
   tmux new-session -d -s pi-bot "cd /home/ben && pi --mode rpc"
   ```

4. **Test:**
   Send message to @trout_pi_bot on Telegram
