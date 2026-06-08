# Plan: "Open in Lark" Deep Link Button

**Date:** 2026-06-09
**Feature:** Add an "Open in Lark" link to each card in the Reply Desk so Bryan can jump directly to the flagged message/chat in Lark with one click.

---

## Problem

When Bryan needs context (especially P2P), he has to manually navigate to Lark, find the chat, and scroll to the message. The desk has `flag_message_id` and `chat_id` on every row — enough to build a direct deep link.

---

## Deep Link Format (Lark global applink)

Bryan's org is on Lark global (larksuite.com) — confirmed from `mom_pipeline/executors.py`.

- **Specific message:** `https://applink.larksuite.com/client/message_link/open?messageId={flag_message_id}`  
  (works when `flag_message_id` is present, `om_...` format)
- **Chat fallback:** `https://applink.larksuite.com/client/chat_link/open?openChatId={chat_id}`  
  (used when `flag_message_id` is absent)

Opens in a new browser tab (`target="_blank"`). On macOS desktop Lark this applink opens the native app directly.

---

## Scope

Two files:
- `/Users/bryan.seto/lark-reply-desk/app/page.tsx` — link placements only (no helper function here)
- `/Users/bryan.seto/lark-reply-desk/lib/larkDeepLink.ts` — **new file**, exports the pure helper function (required for testability)

No backend changes. No API changes. No queue schema changes.

---

## Tasks

### Task 1 — New file `lib/larkDeepLink.ts`
Create `/Users/bryan.seto/lark-reply-desk/lib/larkDeepLink.ts`:

```ts
export type DeepLinkRow = {
  flag_message_id?: string | null;
  chat_id: string;
};

export function larkDeepLink(row: DeepLinkRow): string {
  if (row.flag_message_id) {
    return `https://applink.larksuite.com/client/message_link/open?messageId=${encodeURIComponent(row.flag_message_id)}`;
  }
  return `https://applink.larksuite.com/client/chat_link/open?openChatId=${encodeURIComponent(row.chat_id)}`;
}
```

### Task 2 — "↗ Open" button in the detail panel brief card
In `page.tsx`, import `larkDeepLink` at the top. In the brief card header (around line 592), add an `<a>` element AFTER the "⚑ Unflag" button (last in the header row — it's a navigation utility, not a workflow action):

```tsx
import { larkDeepLink } from "@/lib/larkDeepLink";

// After ⚑ Unflag button, last element in the brief card header:
<a
  href={larkDeepLink(fuCur)}
  target="_blank"
  rel="noopener noreferrer"
  className="flex-none rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--primary)]"
  title={fuCur.flag_message_id ? "Jump to flagged message in Lark" : "Open chat in Lark"}
  aria-label={fuCur.flag_message_id ? "Jump to flagged message in Lark" : "Open chat in Lark"}
>
  <span aria-hidden="true">↗</span> Open
</a>
```

### Task 3 — Link icon in list sidebar rows (both Flagged and Parked tabs)

**IMPORTANT — Invalid HTML constraint:** The list rows in both tabs use `<button>` as the outer wrapper. Nesting `<a>` inside `<button>` is invalid HTML (interactive content nesting). Fix: convert the outer `<button>` to `<div role="button" tabIndex={0} className="... group"` with `onClick` and `onKeyDown` handlers. This is a mechanical transformation — behaviour is identical.

`onKeyDown` handler (required for accessibility):
```tsx
onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFu(r); /* or the parked tab equivalent */ } }}
```

**Note:** The `group` className on the outer div is required for the hover-only ↗ icon visibility (see below).

After converting to `<div role="button" ... group>`, wrap the badge + ↗ link in a single `ml-auto` container so layout is consistent whether or not the badge is present:

```tsx
<div className="flex items-center gap-2">
  {/* avatar + person name (unchanged) */}
  <div className="ml-auto flex items-center gap-1">
    {/* existing badge here — remove its ml-auto since the wrapper div handles that */}
    <a
      href={larkDeepLink(r)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex-none rounded p-0.5 text-[11px] text-[var(--faint)] opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-[var(--hover)] hover:text-[var(--primary)]"
      aria-label="Open this thread in Lark"
      title="Open this thread in Lark"
      tabIndex={-1}
    >
      ↗
    </a>
  </div>
</div>
```

**Badge `ml-auto` removal:** The existing badge spans in both tabs have `ml-auto`. Remove `ml-auto` from each badge span — the wrapper `div` now owns the right-alignment.
- Parked tab (line ~472): remove `ml-auto` from the `replied` badge span
- Flagged tab (line ~539): remove `ml-auto` from the `suggested_label` span

---

## Test Plan (for REX / TDD)

Write tests in `/Users/bryan.seto/lark-reply-desk/__tests__/larkDeepLink.test.ts` using vitest:

1. `larkDeepLink` returns message link when `flag_message_id` is present
2. `larkDeepLink` falls back to chat link when `flag_message_id` is absent/null/undefined
3. The generated URL contains the correct message ID
4. The generated URL contains the correct chat ID in fallback case

No UI rendering tests needed — the logic lives entirely in the helper function.

---

## Acceptance Criteria

- [ ] `larkDeepLink` helper function exists and passes all 4 unit tests (green bar)
- [ ] "↗ Open" link appears in the detail panel brief card header
- [ ] "↗" icon appears on each row in the Flagged and Parked list sidebar
- [ ] Clicking the link opens the correct Feishu applink in a new tab
- [ ] Clicking the icon in the list does NOT select that row (stopPropagation works)
- [ ] No TypeScript errors (`npm run build` passes)
- [ ] Existing buttons (Fix, Park, Unflag) still work after the change

---

## Assumptions

1. Bryan's org is on Lark global (larksuite.com) — confirmed from `mom_pipeline/executors.py`. Applink base: `https://applink.larksuite.com/`
2. `flag_message_id` is **optional** on queue rows — some rows will have it absent. The chat-link fallback handles those. `parent_message_id` (always present) is intentionally skipped as fallback — it may point to a different message context; chat-level fallback is safer.
3. The change is purely cosmetic/UI — no daemon or API changes required
4. Dev server at :3100 remains the QA target

---

## Files touched

| File | Change |
|------|--------|
| `app/page.tsx` | Add import + 3 link insertions + convert list `<button>` → `<div role="button">` |
| `lib/larkDeepLink.ts` | **New file** — exported pure helper + DeepLinkRow type |
| `__tests__/larkDeepLink.test.ts` | New test file (vitest) |
