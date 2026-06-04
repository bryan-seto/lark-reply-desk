# Lark Reply Desk

Local MVP cockpit for reviewing, editing, and sending the Lark draft daemon's
suggested replies. Two panes: message list (left) + original thread above an
editable draft (right). Mac/Notion-clean, dark-mode toggle.

It is a thin front-end over the existing `lark-draft-pusher` daemon. The UI
NEVER calls lark-cli; the daemon (which holds the macOS keychain) executes
sends. The UI only reads/writes JSONL state files.

## Run it

```bash
export PATH="/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin:$PATH"
cd /Users/bryan.seto/lark-reply-desk
PORT=3100 npm run dev      # http://localhost:3100
```

(Production: `npm run build && PORT=3100 npm run start`.)

## How it connects to the daemon

State files in `/Users/bryan.seto/.hermes/profiles/bryan/state/`:

| File | Direction | Purpose |
|---|---|---|
| `lark-reply-desk-queue.jsonl` | UI reads | one row per drafted reply (`handle, chat_name, sender_name, thread_json[], draft_text, drafted_at, status`) |
| `lark-reply-desk-commands.jsonl` | UI appends | `{id, handle, action:"send", sent_text}` — the daemon executes |
| `lark-reply-desk-results.jsonl` | UI polls | `{id, handle, status:"sent"|"error", detail}` |

On send: the UI appends a command, polls results up to ~12s. If the daemon
hasn't run its cycle yet, the UI shows "Queued" and the command still runs on
the next daemon cycle. Every send writes a `(draft, sent_text, edited)` label to
`lark-reply-labels.jsonl` — the ground-truth corpus for the send-grounded
optimizer.

## Files

- `app/page.tsx` — the two-pane UI (single client component)
- `app/api/inbox/route.ts` — GET pending/sent drafts
- `app/api/send/route.ts` — POST a send command, poll for the result
- `lib/state.ts` — JSONL read/write helpers (server-only)
- `app/globals.css` — Notion/Mac palette (one blue accent), light + dark

## MVP scope (deliberate)

Two panes, single Needs-reply/Done toggle, one whisper line under the composer
("matches your style" -> "edited - saved as your style signal"). No search,
multi-account, snooze, "why this draft", or learning dashboard. The optimizer
runs invisibly in the 03:00 friction loop.

## Keyboard

- `J`/`K` or arrows: move between drafts
- `Cmd/Ctrl + Enter`: send
- `◐` (top of sidebar): toggle dark mode (persists to localStorage)
