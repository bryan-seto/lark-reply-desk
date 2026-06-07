# Reply Desk — 5-Bug Fix Plan

> **For Hermes:** Implement task-by-task. Each task is a self-contained patch with verification.

**Goal:** Fix five confirmed bugs in the Lark Reply Desk flagged-follow-up system — wrong date on Kexin, slow unflag UX, 1-msg Fajrin stub, "team" identity mystery, and Sunday nudges.

**Architecture:**
- `flag_followup_harvest.py` — Python harvester that reads flags + calls Claude → writes `lark-followup-queue.jsonl`
- `draft_engine.py` — Claude wrapper that extracts `analyze_thread` metadata (timing, explicit_date, etc.)
- `lark-draft-pusher.py` — daemon that consumes a cmd queue; handles unflag via `im +flag-cancel`
- `lark-reply-desk/lib/state.ts` — Next.js helper that writes cmd queue + polls for results
- `lark-reply-desk/app/page.tsx` — UI with unflag popover + follow-up date display

**Tech Stack:** Python 3.12, TypeScript/Next.js, lark-cli, `lark-followup-queue.jsonl` as data store

---

## Bug Map (confirmed from queue + code inspection)

| # | Bug | Root cause | Files |
|---|-----|-----------|-------|
| 1 | Kexin says "revert by today" — should be mid-June | `analyze_thread` returns `timing_tokens:[]`, `explicit_date:""` even though prompt says to resolve "mid june ish". Row is stale (`last_activity` 32d ago) so the cache reuse path fires — BUT `explicit_date` was never stored in the original harvest (field absent, not empty string), so the cache serves empty explicit_date and the heuristic stamps today. | `flag_followup_harvest.py` cache path + `_SUMMARY_PROMPT` + re-harvest Kexin |
| 2 | Unflag spins forever | `unflagViaDaemon` has a 12 s timeout; the daemon's `POLL_INTERVAL` is 60 s — the UI always hits the deadline and shows "queued" with no feedback on when it'll actually resolve. | `lib/state.ts` — increase timeout to 90 s; `app/page.tsx` — show "queued" banner instead of spinner |
| 3 | Fajrin shows 1-msg stub | Flag is non-threaded (`thread_id:""`); `_fetch_single_raw` is called for the flagged msg (ok), but no surrounding context is fetched. The HARD RULE added 2026-06-05 says "never pad with channel window" — but we should still use the chat-window fallback when the thread_id is empty, which is the designed path. Bug: `thread_id` is empty and `_fetch_single_raw` returns 1 msg, then `fetch_thread` returns just that 1 msg because it fell past the `if thread_id:` block. The chat window (`_chat_window` with ±72h) is never called for non-threaded flags. | `flag_followup_harvest.py` `fetch_thread()` non-threaded branch |
| 4 | "team" / no name — "who is this person?" | `from_raw` is `None` on all thread messages because the chat window (`_chat_window`) returns messages whose `sender` dict is absent or `{}` on some Lark endpoints. `_normalize_msgs` does `sender.get("name") or "?"` which gives `"?"`. `derive_person` skips `"?"`. `chat_name` fallback is `oc_42050afcab15768` (raw ID, unresolved). | `flag_followup_harvest.py` — add a `lark-cli im chat-info` lookup to resolve `chat_name` when it's an opaque `oc_` ID, so `person` gets a real name |
| 5 | Sunday nudges | `suggest_followup_date` fallback: when overdue, sets `target = today` unconditionally. `_add_working_days(start, 0)` already skips to Monday when start is a weekend — just need to run overdue `today` through it. One-liner fix. | `flag_followup_harvest.py` `suggest_followup_date()` |

---

## Pre-flight Checks (already done)

- [x] Confirmed queue row: `Kexin.explicit_date = ""`, `timing_tokens = []`, `followup_basis = "their_commitment"`, `last_activity` = 32d ago → cache path fires
- [x] Confirmed: `unflagViaDaemon` timeout = 12 000 ms, daemon `POLL_INTERVAL` = 60 s → always queued
- [x] Confirmed: Fajrin `thread_id = ""`, `thread_len = 1` → non-threaded, 1-msg stub
- [x] Confirmed: Call-scheduling `from_raw = None` on all msgs, `chat_name = "oc_42050afcab15768"`
- [x] Confirmed: `_add_working_days(today, 0)` returns next working day → one-liner fixes Sunday

---

## Task 1 — Fix Sunday nudges (1-line, safest, verify first)

**Objective:** Overdue items never land on Sat/Sun — push to next Monday.

**File:** `/Users/bryan.seto/.hermes/profiles/bryan/daemons/flag_followup_harvest.py`

**Lines ~548–550:**
```python
# BEFORE
if target < today:
    target = today
    reason = "overdue; follow up today"

# AFTER
if target < today:
    target = _add_working_days(today, 0)   # skip Sat/Sun → Mon
    reason = "overdue; follow up today" if target == today else f"overdue; follow up {_human_date(target, today)}"
```

**Verify:**
```python
import datetime as dt
# simulate being today = Sunday Jun 8
fake_today = dt.date(2026, 6, 8)  # Sunday
# _add_working_days(fake_today, 0) should return Mon Jun 9
```
Expected: `2026-06-09`

---

## Task 2 — Fix Fajrin 1-msg stub (non-threaded chat window)

**Objective:** Non-threaded flags get surrounding chat context, not just the lone message.

**File:** `flag_followup_harvest.py`

**Where:** `fetch_thread()` function, the `else` branch at the bottom (lines ~289–296):
```python
# BEFORE (no-thread fallback — only returns the single flagged message)
root = _fetch_single_raw(chat_id, flag_message_id, flag_msg_ts)
if root and not _is_system_noise(root):
    norm = _normalize_msgs([root], flag_message_id)
    if norm:
        return norm
return []

# AFTER — try the ±72h chat window first (the designed non-threaded path)
# Only use single-msg as last resort
if chat_id and flag_msg_ts:
    window = _chat_window(chat_id, flag_msg_ts, pre_h=6, post_h=72)
    window = [m for m in window if not _is_system_noise(m)]
    if window:
        norm = _normalize_msgs(window, flag_message_id)
        if norm and any(m.get("is_flagged") for m in norm):
            return norm
# Final fallback: just the flagged message alone (honest, not channel chatter)
root = _fetch_single_raw(chat_id, flag_message_id, flag_msg_ts)
if root and not _is_system_noise(root):
    norm = _normalize_msgs([root], flag_message_id)
    if norm:
        return norm
return []
```

**Verify:** After patch, do a targeted re-harvest of Fajrin's handle:
```bash
cd /Users/bryan.seto/.hermes/profiles/bryan/daemons
HOME=/Users/bryan.seto python3 -c "
import flag_followup_harvest as h
# Print the thread for Fajrin's chat
msgs = h._chat_window('oc_470b43c6691c55e', 1748944480000, pre_h=6, post_h=72)
print(len(msgs), 'msgs in window')
for m in msgs[:5]: print(m.get('create_time','')[:10], m.get('sender',{}).get('name','?'), str(m.get('content',''))[:60])
"
```
Expected: >1 message in window.

---

## Task 3 — Fix "team" identity — resolve `oc_` chat names

**Objective:** When `chat_name` is an opaque `oc_XXXX` ID, resolve it to a human-readable name so the `person` field isn't "team".

**File:** `flag_followup_harvest.py`

**Where:** In the main harvest loop, where `chat_name` is set from the prior row (line ~750). Add a resolver function and call it when `chat_name` looks like a raw ID.

**Step 1 — Add `_resolve_chat_name()` helper after `_fetch_single_raw`:**
```python
def _resolve_chat_name(chat_id: str, fallback: str) -> str:
    """Resolve an opaque oc_ chat ID to a human name via lark-cli im chat-info.
    Returns fallback on any failure (safe — never raises)."""
    if not chat_id or not chat_id.startswith("oc_"):
        return fallback
    # Only bother if fallback looks like a raw ID (no spaces or real words)
    if fallback and not re.match(r'^oc_[0-9a-f]+$', fallback):
        return fallback  # already resolved
    try:
        d = _run(["im", "chat-info", "--chat-id", chat_id, "--as", "user", "--format", "json"])
        name = ((d or {}).get("data", {}) or {}).get("name", "") or ""
        return name.strip() or fallback
    except Exception:
        return fallback
```

**Step 2 — Call it when initializing `chat_name` for a row** (line ~750, inside the per-flag loop):
```python
# BEFORE
chat_name = (prior or {}).get("chat_name") or chat_id[:18]

# AFTER
chat_name = (prior or {}).get("chat_name") or ""
if not chat_name or re.match(r'^oc_[0-9a-f]+$', chat_name):
    chat_name = _resolve_chat_name(chat_id, chat_name or chat_id[:18])
```

**Verify:**
```bash
HOME=/Users/bryan.seto python3 -c "
import sys; sys.path.insert(0,'/Users/bryan.seto/.hermes/profiles/bryan/daemons')
import flag_followup_harvest as h
print(h._resolve_chat_name('oc_42050afcab15768', 'oc_42050afcab15768'))
"
```
Expected: a real chat/group name (not the raw ID).

---

## Task 4 — Fix Kexin explicit_date not extracted (cache miss + prompt tuning)

**Objective:** The Kexin row's `explicit_date` is blank because the stale cache reuse path fires (last_activity unchanged at 32d) and the original row never had `explicit_date` populated (field absent → `""` on read). Fix has two parts:

**Part A — Cache path must preserve `explicit_date`** (line ~784, the `if prior and prior.get("summary")` cache reuse block):
```python
# BEFORE — missing explicit_date in cache struct
meta = {
    "summary": prior.get("summary", ""),
    "subject": prior.get("about_subject", ""),
    "about_owner": prior.get("about_owner", ""),
    "followup_basis": prior.get("followup_basis", ""),
    "timing_quote": prior.get("timing_quote", ""),
    "timing_tokens": prior.get("timing_tokens", []) or [],
    "who_committed": prior.get("who_committed", ""),
    "is_monitoring": prior.get("is_monitoring", False),
    "pending_fix": prior.get("pending_fix", False),
}

# AFTER — add explicit_date
meta = {
    "summary": prior.get("summary", ""),
    "subject": prior.get("about_subject", ""),
    "about_owner": prior.get("about_owner", ""),
    "followup_basis": prior.get("followup_basis", ""),
    "timing_quote": prior.get("timing_quote", ""),
    "timing_tokens": prior.get("timing_tokens", []) or [],
    "explicit_date": prior.get("explicit_date", ""),    # ← add this
    "who_committed": prior.get("who_committed", ""),
    "is_monitoring": prior.get("is_monitoring", False),
    "pending_fix": prior.get("pending_fix", False),
}
```

**Part B — Force re-analyze Kexin's row** by touching the cache guard.
The cache fires when `prior.get("summary")` is non-empty AND `prior.get("last_activity") == latest["t"]`. Since Kexin's thread has no new messages, the re-analyze won't auto-trigger.

Fix: bust the cache for rows where `explicit_date` is blank but `timing_quote` contains a month-reference phrase. Add this guard just before the cache-reuse `if`:
```python
# Bust the cache if prior has no explicit_date but the timing_quote implies one
# (so a fresh analyze_thread can resolve it). Only triggers when both are true.
_MONTH_PHRASES = ("mid ", "end of ", "early ", "week of ", "by the ")
if (prior and prior.get("summary")
        and not (prior.get("explicit_date") or "").strip()
        and any(ph in (prior.get("timing_quote") or "").lower() for ph in _MONTH_PHRASES)):
    prior = None   # force re-analyze
```

**Verify after patching + re-harvesting Kexin row:**
```bash
HOME=/Users/bryan.seto python3 \
  /Users/bryan.seto/.hermes/profiles/bryan/daemons/flag_followup_harvest.py --once 2>&1 | grep -i kexin
```
Then check queue:
```bash
python3 -c "
import json
with open('/Users/bryan.seto/.hermes/profiles/bryan/state/lark-followup-queue.jsonl') as f:
    for line in f:
        r = json.loads(line)
        if 'Kexin' in (r.get('person') or ''):
            print('explicit_date:', r.get('explicit_date'))
            print('suggested_label:', r.get('suggested_label'))
            print('suggested_reason:', r.get('suggested_reason'))
"
```
Expected: `explicit_date: "2026-06-16"` (or similar mid-June), `suggested_label: "Tue, Jun 16"` (or later), reason referencing the commitment, not "overdue".

---

## Task 5 — Fix unflag UX: timeout mismatch → banner feedback

**Objective:** Unflag no longer spins forever. The UI shows a clear "queued — will resolve in ~60s" message when the 12 s poll misses the daemon cycle.

**Part A — Increase `unflagViaDaemon` timeout to 90 s** (`lib/state.ts` line ~98):
```typescript
// BEFORE
const { note, link, timeoutMs = 12000 } = opts;

// AFTER
const { note, link, timeoutMs = 90000 } = opts;
```

**Part B — Show a non-blocking "queued" banner in `doUnflag`** (`app/page.tsx`, `doUnflag` function, line ~289):
```typescript
// BEFORE
if (r.status === "unflagged" || r.status === "queued") {
  showToast(linkedChat ? "Unflagged · linked" : "Unflagged");
  setUnflagOpen(false);
  dropCurrentRow(activeHandle);
}

// AFTER
if (r.status === "unflagged") {
  showToast(linkedChat ? "Unflagged · linked" : "Unflagged");
  setUnflagOpen(false);
  dropCurrentRow(activeHandle);
} else if (r.status === "queued") {
  showToast("Queued — Lark will remove the flag within ~60s");
  setUnflagOpen(false);
  dropCurrentRow(activeHandle);   // remove from UI immediately, daemon handles Lark
}
```

**Verify:** Click Unflag on any row. Either:
- Fast path (daemon caught it): toast "Unflagged", row drops immediately.
- Slow path: toast "Queued — Lark will remove the flag within ~60s", row still drops from UI, daemon processes on next cycle.

**Rebuild Next.js after TS changes:**
```bash
cd /Users/bryan.seto/lark-reply-desk
npm run build
```
Then restart the dev server (or launchd service picks it up via `run-reply-desk.sh`).

---

## Task 6 — Re-harvest + smoke-test all 5 fixes

**Objective:** Confirm all 5 bugs are resolved in the live queue.

```bash
# 1. Run a fresh harvest
HOME=/Users/bryan.seto python3 \
  /Users/bryan.seto/.hermes/profiles/bryan/daemons/flag_followup_harvest.py --once

# 2. Verify Kexin — should show mid-June, not today
python3 -c "
import json
with open('/Users/bryan.seto/.hermes/profiles/bryan/state/lark-followup-queue.jsonl') as f:
    for line in f:
        r = json.loads(line)
        if 'Kexin' in (r.get('person') or ''):
            print('Kexin label:', r.get('suggested_label'))
            print('Kexin reason:', r.get('suggested_reason'))
"

# 3. Verify Fajrin — thread_len should be > 1
python3 -c "
import json
with open('/Users/bryan.seto/.hermes/profiles/bryan/state/lark-followup-queue.jsonl') as f:
    for line in f:
        r = json.loads(line)
        if 'Fajrin' in (r.get('person') or ''):
            print('Fajrin thread_len:', len(r.get('thread_json', [])))
"

# 4. Verify Call-scheduling — person should not be 'team' (or chat_name should be resolved)
python3 -c "
import json
with open('/Users/bryan.seto/.hermes/profiles/bryan/state/lark-followup-queue.jsonl') as f:
    for line in f:
        r = json.loads(line)
        if 'Call scheduling' in (r.get('about_subject') or ''):
            print('person:', r.get('person'))
            print('chat_name:', r.get('chat_name'))
"

# 5. Sunday fix — simulate: no easy live test today (it IS Sunday); check code manually
grep -A4 "target = _add_working_days" \
  /Users/bryan.seto/.hermes/profiles/bryan/daemons/flag_followup_harvest.py | head -8
```

---

## Commit

```bash
cd /Users/bryan.seto/.hermes/profiles/bryan/daemons
git add flag_followup_harvest.py
git commit -m "fix: 5 reply-desk bugs — sunday nudge, Fajrin stub, chat name, Kexin date cache, unflag UX"

cd /Users/bryan.seto/lark-reply-desk
git add lib/state.ts app/page.tsx
git commit -m "fix: unflag UX — raise timeout to 90s, show queued banner instead of infinite spinner"
```
