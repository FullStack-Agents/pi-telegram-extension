# Lessons Learned

This document captures key lessons from developing the Pi Telegram extension.

## Lesson 1: Smaller Models Don't Follow Tool-Use Instructions

**What we tried:**
- Adding explicit instructions to the system prompt: "You MUST use the telegram_send tool to respond"
- Including the chat ID in the message format
- Using `before_agent_start` to inject context

**What happened:**
Pi (Qwen3.5:9B) consistently output text responses instead of calling the tool. It would acknowledge the instruction in its thinking but still output plain text.

**What worked:**
Using the `agent_end` event to automatically capture Pi's text response and send it to Telegram. This bypasses the need for Pi to use tools.

**Key insight:**
Don't fight the model's tendencies. If it prefers to output text, design the system to work with text output rather than forcing tool use.

---

## Lesson 2: Build Output Must Be Copied to Extension Directory

**What went wrong:**
The extension is installed at `~/.pi/agent/extensions/pi-telegram-extension/` but we were building from `/home/ben/pi-telegram-extension/`. The compiled `dist/index.js` wasn't being copied to the extension directory.

**Symptom:**
Pi would load old code even after rebuilding. Changes didn't take effect.

**Solution:**
Always copy the built output:
```bash
cd /home/ben/pi-telegram-extension
npm run build
cp dist/index.js ~/.pi/agent/extensions/pi-telegram-extension/dist/
```

**Better approach:**
Build directly in the extension directory or use a symlink.

---

## Lesson 3: Session State Can Confuse the Model

**What happened:**
After updating the message format to remove `chatId=XXX` from the prompt, Pi was still trying to use the old chat ID (7421830) from previous session history.

**Why:**
Pi's session history contained the old message format with the wrong chat ID. The model was extracting the chat ID from its context rather than using the correct one.

**Solution:**
Clear Pi's sessions when making changes to message format:
```bash
rm -rf ~/.pi/agent/sessions/*
```

---

## Lesson 4: Node Modules Must Be in Extension Directory

**What went wrong:**
After copying the extension to `~/.pi/agent/extensions/`, Pi couldn't find `node-telegram-bot-api`.

**Error:**
```
Cannot find module 'node-telegram-bot-api'
```

**Why:**
Pi loads the extension from `~/.pi/agent/extensions/` but node_modules were only in the original build directory.

**Solution:**
Copy node_modules to the extension directory:
```bash
cp -r /home/ben/pi-telegram-extension/node_modules \
  ~/.pi/agent/extensions/pi-telegram-extension/
```

---

## Lesson 5: Pi's RPC Mode Behavior

**Observation:**
Pi runs in RPC mode (`pi --mode rpc`) for programmatic interaction. In this mode:
- Extensions load on session start
- Events fire as expected
- UI notifications work via `ctx.ui.notify()`

**Important:**
The `session_start` event only fires when a new session is created. If Pi is already running, use `/reload` or restart Pi to load new extensions.

---

## Lesson 6: Event Handler Ordering Matters

**What we learned:**
The `agent_end` event fires after Pi finishes generating a response. This is the perfect time to:
1. Capture the last assistant message
2. Extract text content
3. Send to Telegram
4. Clean up state

**Code pattern:**
```typescript
pi.on("agent_end", async (event, ctx) => {
  const messages = event.messages;
  const lastAssistantMsg = messages
    .filter(m => m.role === "assistant")
    .pop();
  
  // Extract and send text...
});
```

---

## Lesson 7: Module-Level State is Acceptable for Simple Cases

**Decision:**
We used a module-level variable `currentTelegramChatId` to track the current conversation.

**Trade-offs:**
- ✅ Simple, no external dependencies
- ✅ Works for 1:1 conversations
- ❌ Doesn't scale to multiple concurrent chats
- ❌ Lost on Pi restart

**When to upgrade:**
If you need to support group chats or multiple concurrent users, replace with a Map or persistent store.

---

## Lesson 8: Test with Real Messages Early

**What we did wrong:**
Spent time trying to get Pi to use the tool before testing the full flow.

**What we should have done:**
Test the message reception and sending separately before integrating.

**Testing approach:**
1. Verify bot receives Telegram messages (console.log)
2. Verify Pi receives messages via sendUserMessage()
3. Verify Pi generates responses
4. Verify responses are sent back to Telegram

---

## Lesson 9: The `sendUserMessage()` Delivery Mode

**Important:**
When calling `pi.sendUserMessage()` from an event handler, it triggers immediately if Pi is idle. If Pi is busy, you need to specify `deliverAs: "steer"` or `deliverAs: "followUp"`.

**In our case:**
The Telegram message handler calls `sendUserMessage()` when a message arrives. Since Pi is typically idle in RPC mode waiting for input, this works fine.

---

## Lesson 11: `ExtensionContext` vs `ExtensionCommandContext` (session control)

**What went wrong:**
Code in a Telegram callback (or any handler that only receives `ExtensionContext`) called `ctx.newSession()` or used `(ctx as any).newSession()`. That throws because `newSession` is not on `ExtensionContext`.

**What works:**
- Register `pi.registerCommand("newsession", { handler })` and call `await ctx.waitForIdle(); await ctx.newSession();` inside that handler.
- From Telegram (or any place that only has `ExtensionContext` / `ExtensionAPI`), use `pi.sendUserMessage("/newsession")` so the command handler runs with a real `ExtensionCommandContext`.

**Related:** Pi’s `sendUserMessage` must dispatch leading `/name` as an extension command when appropriate (idle path). That behavior is present in recent `@earendil-works/pi-coding-agent` releases used with this extension.

---

## Lesson 10: Error Handling for Telegram API

**Common errors:**
- `ETELEGRAM: 400 Bad Request: chat not found` - Wrong chat ID
- `ETELEGRAM: 429 Too Many Requests` - Rate limiting
- `ETELEGRAM: 401 Unauthorized` - Invalid bot token

**Our approach:**
Basic try/catch with console.error logging. For production, add:
- Exponential backoff for retries
- User-friendly error messages
- Alerting for persistent failures
