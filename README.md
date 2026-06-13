# Lark Reply Desk

A local cockpit for reviewing, editing, and sending AI-drafted Lark replies.  
Two panes: message list (left) + original thread above an editable draft (right).  
Mac/Notion-clean aesthetic, dark-mode toggle.

The UI is a thin front-end over a local daemon process. The UI **never** calls
lark-cli directly — the daemon (which holds the macOS keychain token) executes
sends. The UI only reads/writes JSONL state files.

---

## Run it

```bash
cd lark-reply-desk
PORT=3100 npm run dev      # http://localhost:3100
```

Production:

```bash
npm run build
PORT=3100 npm run start
```

---

## Architecture

### State files

The UI and daemon communicate through three JSONL files in a shared state directory
(configurable via `STATE_DIR` in `lib/state.ts` and `lib/followups.ts`):

| File | Direction | Purpose |
|---|---|---|
| `lark-reply-desk-queue.jsonl` | Daemon writes, UI reads | One row per drafted reply |
| `lark-reply-desk-commands.jsonl` | UI appends | `{id, handle, action:"send", sent_text}` — daemon executes |
| `lark-reply-desk-results.jsonl` | Daemon writes, UI polls | `{id, handle, status:"sent"\|"error", detail}` |
| `lark-followup-queue.jsonl` | Harvester writes, UI reads | Flagged follow-up rows |

On send: the UI appends a command, polls results up to ~12 s. If the daemon hasn't
run its cycle yet, the UI shows "Queued" and the command still runs on the next
daemon cycle.

### Source files

- `app/page.tsx` — two-pane UI (single client component)
- `app/api/inbox/route.ts` — GET pending/sent drafts
- `app/api/send/route.ts` — POST a send command, poll for result
- `app/api/followup-all/route.ts` — batch send endpoint for Follow Up All
- `lib/state.ts` — JSONL read/write helpers (server-only)
- `lib/followups.ts` — follow-up queue reader (server-only)
- `lib/trustGate.ts` — deterministic gate logic for Follow Up All
- `lib/larkDeepLink.ts` — deep link helpers for "Open in Lark"
- `app/globals.css` — Notion/Mac palette (one blue accent), light + dark

---

## Two-tab UI

**Reply tab** — AI-drafted replies to flagged direct messages.

**Flagged tab** — Follow-up queue: flagged group-chat threads that need action,
with a suggested follow-up date, urgency badge, and per-row "Open in Lark" link.

---

## Follow Up All

One-click batch send for all due rows. Rows are gated by a deterministic trust
checklist (`lib/trustGate.ts`) before being shown as sendable:

- Row must be `pending`
- Draft must be non-empty
- Suggested date must be today or earlier
- `followup_basis` must not be `"closed"`
- `is_monitoring` rows are excluded (check numbers yourself first)
- Validation must pass (honorific, placeholder, intent checks run by the daemon)

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `J` / `K` or arrows | Move between drafts |
| `Cmd/Ctrl + Enter` | Send current draft |
| `◐` (top of sidebar) | Toggle dark mode (persists to localStorage) |

---

## Tech stack

- [Next.js](https://nextjs.org/) App Router (TypeScript)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/) button primitive
- [Vitest](https://vitest.dev/) for unit tests
- Lark (Feishu) as the messaging backend

---

## Configuration

Before running, set `STATE_DIR` in `lib/state.ts` and `lib/followups.ts` to the
directory where your daemon writes its JSONL files.

For the harvest script, set `LARK_USER_ID` to your Lark `open_id`
(run `lark-cli im +me` to find it).
