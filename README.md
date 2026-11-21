# Pi Telegram extension

A [Pi](https://github.com/earendil-works/pi) extension that connects a Telegram bot to the coding agent. [trout-pi-agent](../trout-pi-agent) loads `dist/index.js` from this directory (`PI_TELEGRAM_EXTENSION_ROOT`, default `../pi-telegram-extension`).

No bot token, chat id, or machine path is stored in this repository. Configuration is environment variables.

## Setup

Requires Node.js 22.19 or newer.

```bash
npm install
npm run build
```

Set the variables in the environment that starts Pi (for trout-pi-agent, that is its `.env`). Copy [`.env.example`](.env.example).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Token from [@BotFather](https://t.me/BotFather). |
| `TELEGRAM_ALLOWLIST_ENABLED` | No | `true` | Set to `false`, `0`, `no`, or `off` to accept messages from any Telegram user. |
| `TELEGRAM_ALLOWED_USER_IDS` | When the allowlist is on | — | Comma-separated numeric user ids. |
| `TELEGRAM_ALLOWED_GROUP_CHAT_IDS` | No | — | Comma-separated group chat ids. Group ids are negative, for example `-1001234567890`. |
| `TELEGRAM_DOWNLOAD_DIR` | No | OS temp dir `/pi-telegram` | Directory for photos, documents, audio, and voice files. |
| `TELEGRAM_TRANSCRIBE_COMMAND` | No | unset | Optional command that transcribes a voice message or video note. The media path is appended as the last argument. stdout is the transcript. |

With the allowlist on, only listed users and listed group chats can talk to the bot. Outbound `telegram_send` and the automatic reply are limited to those group chats and to chats an allowlisted user has already used. With the allowlist off, any chat id can be targeted.

Do not commit a real `.env`. It is gitignored.

## What the bot does

1. Someone messages the bot.
2. The extension forwards the text to Pi with `sendUserMessage`.
3. When the turn ends, the last assistant text is sent back to that chat.
4. If the turn already called `telegram_send` or `telegram_send_photo`, the automatic reply is skipped.

Photos, documents, video, and audio are downloaded and the local path is included in the prompt. Voice messages and video notes are downloaded too. They are transcribed only when `TELEGRAM_TRANSCRIBE_COMMAND` is set. The command receives the file as its last argument (`.ogg` for voice, `.mp4` for a video note) and prints the transcript on stdout.

One chat is tracked at a time. A newer Telegram message replaces the chat that receives the automatic reply.

A polling conflict (Telegram 409, another client calling `getUpdates` for the same bot) stops polling and leaves the agent process running.

## Commands

| Telegram command | Effect |
|------------------|--------|
| `/newsession` | Starts a new Pi session. |
| `/stop` | Aborts the current turn. |

Pi commands in the same process: `/telegram_chats`, `/telegram_stop`, `/newsession`.

## Tools

| Tool | Purpose |
|------|---------|
| `telegram_send` | Send text, or an image when `imagePath` is set. |
| `telegram_send_photo` | Send a local image file. |

## License

MIT
