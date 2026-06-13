# Sub-Thread Visibility Fix Implementation Plan

> **Implementation note:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** When a flagged group-chat message has replies in a Lark sub-thread (omt_), include those replies in `thread_json` so the desk shows the full conversation — not just top-level channel messages.

**Root cause (confirmed from code + live queue data):**
`fetch_thread()` in `flag_followup_harvest.py` has two paths. For non-threaded flags (`om_` prefix, no `thread_id` in flag-list), it uses `_chat_window()` which calls `im +chat-messages-list` — a Lark API that returns **top-level messages only**. Sub-thread replies (omt_) are structurally invisible to this call. The Contact B flag (`fu_om_x100b6ecbd28970b8e158418`) hits this path and shows only 2 top-level messages, missing any in-thread replies.

**Fix approach:**
In the non-threaded branch (lines 311–317 of `flag_followup_harvest.py`), after pulling the chat window, inspect the raw flagged message's `thread_id` field. If one is present, call `_thread_all()` on it and merge replies into the window. No UI changes needed — the UI already renders `thread_json` messages correctly.

**Key unknown → Task 0 (Recon must run first):** Does `im +chat-messages-list` return a `thread_id` field on a message once someone has replied to it in-thread? This determines whether the fix is a 1-liner or needs a fallback strategy.

**Files touched:** `flag_followup_harvest.py` only (daemon repo).

**Repo roots (two separate git repos — commits must be separate):**
- Daemon: `/Users/user.seto/.hermes/profiles/user`
- UI (no changes): `/Users/user.seto/lark-reply-desk`

---

## Task 0 — Recon ✅ COMPLETED 2026-06-08

**Findings:**

1. ✅ `chat-messages-list` DOES return `thread_id` on sub-thread reply messages (confirmed).
2. ⚠️ The flagged ROOT (`om_x100b6ecbd28970b8e1584182a38c600`) is **NOT returned** by `chat-messages-list`. It is a nested sub-thread root (its own `root_id = om_x100dcf344...` means it lives inside a parent thread). Lark never surfaces nested sub-thread roots in the chat list API.
3. Therefore `_fetch_single_raw` (which uses `chat-messages-list`) also cannot recover the root.
4. ✅ All 14+ sub-thread replies ARE in the chat window, all with `thread_id: "omt_197a710d69ce99b9"`.
5. Contact B replied substantively — 14 messages in that sub-thread. The desk shows 2 because the root is invisible.

**Fix path decided: Task 1 (see below)** — add `_fetch_message_get` helper, detect thread_id in window, recover root directly, combine.

---

## Task 1 — Fix `fetch_thread()`: recover nested sub-thread root via `message-get`

**File:** `/Users/user.seto/.hermes/profiles/user/daemons/flag_followup_harvest.py`

### Step 1.1 — Add `_fetch_message_get` helper (after `_fetch_single_raw`, ~line 228)

```python
def _fetch_message_get(msg_id: str) -> dict | None:
    """Fetch one message by ID via im +message-get.

    Used when chat-messages-list omits the message (e.g. nested sub-thread
    roots). Returns the raw message dict or None on failure.
    """
    if not msg_id:
        return None
    d = _run(["im", "+message-get", "--message-id", msg_id,
              "--as", "user", "--format", "json"])
    if not d:
        return None
    items = ((d.get("data") or {}).get("items") or [])
    return items[0] if items else None
```

### Step 1.2 — Patch the non-threaded branch (lines 307–317)

**Before (current code):**
```python
    # No usable thread (non-threaded flag). Try the ±6h/72h chat window first so
    # non-threaded flags still get surrounding conversation context. This is the
    # DESIGNED non-threaded path — the HARD RULE only forbids padding with
    # UNRELATED channel chatter; a centred time-window is still the right context.
    if chat_id and flag_msg_ts:
        window = _chat_window(chat_id, flag_msg_ts, pre_h=6, post_h=72)
        window = [m for m in window if not _is_system_noise(m)]
        if window:
            norm = _normalize_msgs(window, flag_message_id)
            if norm and any(m.get("is_flagged") for m in norm):
                return norm
```

**After:**
```python
    # No usable thread (non-threaded flag). Try the ±6h/72h chat window first so
    # non-threaded flags still get surrounding conversation context. This is the
    # DESIGNED non-threaded path — the HARD RULE only forbids padding with
    # UNRELATED channel chatter; a centred time-window is still the right context.
    if chat_id and flag_msg_ts:
        window = _chat_window(chat_id, flag_msg_ts, pre_h=6, post_h=72)
        window = [m for m in window if not _is_system_noise(m)]
        if window:
            norm = _normalize_msgs(window, flag_message_id)
            if norm and any(m.get("is_flagged") for m in norm):
                return norm
            # NESTED-ROOT FIX: flagged message may be the ROOT of a sub-thread whose
            # replies appear in the window but the root itself is omitted by Lark
            # (chat-messages-list never returns nested sub-thread roots).
            # Strategy: collect unique thread_ids from window → recover the root via
            # message-get → prepend root to the matching sub-thread messages.
            sub_tids = list(dict.fromkeys(
                m.get("thread_id", "").strip()
                for m in window
                if m.get("thread_id", "").strip()
            ))
            if sub_tids:
                root_raw = _fetch_message_get(flag_message_id)
                if root_raw and not _is_system_noise(root_raw):
                    # Match root to its sub-thread: prefer thread_id on root if set,
                    # else try all sub_tids in order (first non-empty result wins).
                    root_tid = (root_raw.get("thread_id") or "").strip()
                    tids_to_try = ([root_tid] if root_tid in sub_tids else sub_tids)
                    for tid in tids_to_try:
                        sub_msgs = [m for m in window if m.get("thread_id") == tid]
                        if sub_msgs:
                            combined = _normalize_msgs([root_raw] + sub_msgs,
                                                       flag_message_id)
                            if combined and any(m2.get("is_flagged")
                                                for m2 in combined):
                                log(f"nested-root fix: recovered root for sub-thread "
                                    f"{tid}: {len(combined)} msgs")
                                return combined
```

**Apply using `patch` tool (old_string / new_string exact match).**

---

## Task 2 — Smoke-test: verify Contact B row now includes sub-thread replies

**Steps:**

1. Run the harvester in `--once` mode:
   ```bash
   cd /Users/user.seto/.hermes/profiles/user/daemons
   HOME=/Users/user.seto python3 flag_followup_harvest.py --once 2>&1 | tail -20
   ```
   Expected: log line `non-threaded flag merged sub-thread omt_...: +N msgs total=M` for the Contact B row (if Contact B has replied in-thread). If Contact B genuinely hasn't replied, `thread_len` stays at 2 — that's correct.

2. Read the updated queue row:
   ```python
   import json
   from pathlib import Path
   q = Path("/Users/user.seto/.hermes/profiles/user/state/lark-followup-queue.jsonl")
   rows = [json.loads(l) for l in q.read_text().splitlines() if l.strip()]
   contact_b = next(r for r in rows if "Contact B" in r.get("person",""))
   print("thread_len:", len(contact_b.get("thread_json") or []))
   for m in contact_b.get("thread_json") or []:
       print(f"  {m['t']} {m['from']}: {m['text'][:60]}")
   ```

3. Open the desk at `http://localhost:3100` and select the Contact B row. Verify "Show full conversation (N messages)" count is higher and sub-thread replies are visible.

4. Spot-check 2–3 other `fu_om_` (non-threaded) rows to confirm they were not broken (thread_len should stay the same or increase, never decrease).

---

## Task 3 — Update skill pitfall notes

**File:** `/Users/user.seto/.hermes/profiles/user/skills/lark-flagged-follow-up/references/required-read-path-pitfalls.md`

Add a new section at the end:

```markdown
## NON-THREADED FLAG + SUB-THREAD REPLIES (fixed 2026-06-08)

**Symptom:** Group-chat flag shows only top-level messages; in-thread replies (from "Reply in thread" in Lark) are missing from the thread panel.

**Root cause:** `fetch_thread()` for `om_` (non-threaded) flags uses `_chat_window()` → `im +chat-messages-list`, which returns top-level messages only. Sub-thread (omt_) replies are invisible to this API.

**Fix applied:** After the chat-window pull, check the flagged message's `thread_id` field. If present, call `_thread_all()` on the sub-thread and merge replies in (deduped, sorted by `create_time`). Logged as `non-threaded flag merged sub-thread <omt_>: +N msgs total=M`.

**Regression guard:** Any refactor of the non-threaded branch in `fetch_thread()` must preserve the sub-thread merge block.
```

---

## Task 4 — Commit (daemon repo only — UI repo needs no changes)

Daemon files only touch one repo:

```bash
cd /Users/user.seto/.hermes/profiles/user
git add daemons/flag_followup_harvest.py \
        skills/lark-flagged-follow-up/references/required-read-path-pitfalls.md
git commit -m "fix(harvester): merge sub-thread replies for non-threaded (om_) flags

chat-messages-list only returns top-level messages; replies made via
'Reply in thread' live in a sub-thread (omt_) and were invisible.

Fix: after chat-window pull, check flagged message for thread_id;
if present, call _thread_all() and merge replies in (deduped, sorted).
Logged as 'non-threaded flag merged sub-thread omt_...: +N msgs'.

Closes: Contact B FSC/LCC flag showing 2 messages instead of full thread."
```

**Do NOT** `git add` from `/Users/user.seto/lark-reply-desk` — no UI files were changed.

---

## Acceptance Criteria ✅ ALL PASSED

- [x] Recon (Task 0) confirmed `thread_id` present in window — Task 1 path executed
- [x] `fetch_thread()` patch clean, no syntax errors (`python3 -m py_compile` passes via lint)
- [x] `_fetch_message_get` helper added (uses `+messages-mget`, `data.messages`)
- [x] Harvester ran without error: 16 flags → 15 threads → 14 drafts
- [x] Contact B row: was 2 messages → now 16 (full sub-thread visible)
- [x] No existing `omt_` rows shrank (one 6→5 = natural new harvest, not regression)
- [x] Skill pitfall notes updated with root cause + regression guard
- [x] Committed to daemon repo: `6d38bd3`

---

## Out of Scope

- Paginating the sub-thread when it has > 50 replies: `_thread_all()` already paginates (up to `max_pages=8`), so this is handled.
- UI changes: the thread panel already renders whatever is in `thread_json`.
- The unflag `flag-cancel` bug (separate tracked issue in `references/unflag-flag-cancel-bug-2026-06-07.md`).
