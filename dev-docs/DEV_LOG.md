# Development Log

Chronological log of the Pi Telegram extension development.

## 2026-03-16: Initial Development

### Phase 1: Research & Planning
- **Time:** ~11:54 AM - 12:00 PM
- **Activities:**
  - Read Pi extension documentation
  - Studied OpenClaw's Telegram tool implementation
  - Reviewed Pi extension examples
  - Identified key APIs: `pi.on()`, `pi.registerTool()`, `pi.sendUserMessage()`

### Phase 2: Extension Structure
- **Time:** ~12:00 PM - 12:15 PM
- **Activities:**
  - Created directory structure
  - Set up package.json with dependencies
  - Created tsconfig.json
  - Initial scaffold in src/index.ts
- **Delegated to Pi:** Task 1 (directory structure)

### Phase 3: Core Implementation
- **Time:** ~12:15 PM - 12:30 PM
- **Activities:**
  - Implemented Telegram bot initialization
  - Added message polling
  - Created `telegram_send` tool
  - Added `/telegram_chats` command
- **Delegated to Pi:** Task 2 (implementation)

### Phase 4: Build & Install
- **Time:** ~12:30 PM - 12:45 PM
- **Activities:**
  - Installed npm dependencies
  - Built TypeScript
  - Installed extension to Pi's extension directory
  - Restarted Pi
- **Delegated to Pi:** Tasks 3 & 4
- **First test:** Bot connected successfully (@trout_pi_bot)

### Phase 5: Debugging Response Flow
- **Time:** ~12:45 PM - 1:00 PM
- **Problem:** Pi received messages but didn't respond on Telegram
- **Root cause:** Pi (Qwen3.5:9B) wasn't using the `telegram_send` tool
- **Attempted fixes:**
  1. Added system prompt instructions (failed)
  2. Modified message format to include chatId (failed)
  3. Used `before_agent_start` event (failed)
- **Lesson:** Smaller models don't consistently follow tool-use instructions

### Phase 6: Auto-Reply Implementation
- **Time:** ~1:00 PM - 1:15 PM
- **Solution:** Use `agent_end` event to auto-capture and send responses
- **Implementation:**
  - Store chat ID when message arrives
  - On `agent_end`, extract Pi's text response
  - Automatically send to Telegram
  - Clear chat ID after sending
- **Result:** ✅ Working!

### Phase 7: Build Issues
- **Time:** ~1:15 PM - 1:30 PM
- **Problems discovered:**
  1. Built files not copied to extension directory
  2. node_modules not in extension directory
  3. Old session state causing wrong chat ID usage
- **Fixes applied:**
  1. Copy dist after build: `cp dist/index.js ~/.pi/agent/extensions/...`
  2. Copy node_modules: `cp -r node_modules ~/.pi/agent/extensions/...`
  3. Clear sessions: `rm -rf ~/.pi/agent/sessions/*`

### Phase 8: Final Testing
- **Time:** ~1:30 PM - 1:45 PM
- **Result:** Two-way messaging working
- **Verified:**
  - Messages from Telegram → Pi ✓
  - Pi responses → Telegram ✓
  - Auto-reply mechanism ✓

## Key Decisions Made

1. **Auto-reply vs Tool-based:** Chose auto-reply because Qwen3.5:9B doesn't consistently use tools
2. **Module-level state:** Used simple variable for chat ID tracking (acceptable for 1:1)
3. **Hardcoded token:** Acceptable for prototype; should use env vars in production
4. **RPC mode:** Pi runs in RPC mode for programmatic interaction

## Files Created

- `/home/ben/pi-telegram-extension/package.json`
- `/home/ben/pi-telegram-extension/tsconfig.json`
- `/home/ben/pi-telegram-extension/src/index.ts`
- `/home/ben/pi-telegram-extension/dist/index.js`
- `/home/ben/pi-telegram-extension/dist/index.d.ts`

## Documentation Created

- `README.md` - Architecture and overview
- `LESSONS_LEARNED.md` - Key insights from development
- `GOTCHAS.md` - Common issues and solutions
- `SETUP.md` - Step-by-step setup instructions
- `index.ts` - Source code backup
- `DEV_LOG.md` - This file

## Total Development Time

Approximately 2 hours from start to working implementation.

## Phase 9: Slash Commands (/new and /stop)

### 2026-03-16: Command Implementation
- **Time:** ~1:45 PM - 2:00 PM
- **Features added:**
  - `/new` command - Creates new Pi session
  - `/stop` command - Aborts current execution
  - Command filtering - Messages starting with `/` are not forwarded as regular text
- **Implementation approach:**
  - Used `bot.onText()` regex handlers for Telegram commands
  - `/new` triggers Pi's built-in `/new` command via `sendUserMessage()`
  - `/stop` triggers custom `/telegram_stop` Pi command that calls `ctx.abort()`
  - Added `telegram_stop` command registration in Pi
- **Key constraint discovered:** `ctx.newSession()` and `ctx.abort()` only available in command handlers, not event handlers
- **Solution:** Use `sendUserMessage()` to trigger Pi commands
- **Delegated to Pi:** Tasks 7.1, 7.2, 7.3 (implementation)
- **Result:** ✅ Both commands working!

### Command Testing
- `/new` - Successfully creates new session with confirmation message
- `/stop` - Successfully aborts execution with confirmation message

## Total Development Time

Approximately 2.5 hours from start to working implementation with slash commands.

## Next Steps (If Continuing)

1. Add persistent storage for chat history
2. Support media messages (images, documents)
3. Add rate limiting
4. Move bot token to environment variables
5. Add more commands (/start, /help, /status)
6. Support group chats
