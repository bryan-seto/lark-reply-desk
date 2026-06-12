# Follow-Up-All Trust Pipeline Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make every desk draft trustworthy enough that one "Follow Up All" button sends them — by fixing today's diff findings deterministically, then auto-learning honorifics/timing/style from what Bryan actually sends and from unflag events.

**Architecture:** Three layers, cheapest-correct-layer first (layer-efficiency principle):
1. **Deterministic data + validators** (scripts, no LLM): honorifics roster JSON, post-draft scrub/validator, staleness demotion, timing stats. These run in the harvester/daemon and gate every draft.
2. **Capture + distill learning loop**: deterministic capture of (desk_draft vs bryan_actual_sent) pairs and unflag events into JSONL; a nightly distiller turns them into corrections (`flagged-desk-corrections.md`) and roster updates. Honorific learning is pure regex (deterministic); style/timing lessons go through the existing corrections→prompt wiring.
3. **Follow Up All button**: UI batch action gated by a deterministic trust-gate checklist per row, with a send-time freshness re-check in the daemon. Bryan confirms once; daemon sends sequentially; results feed back into the capture loop.

**Tech Stack:** Python 3 (daemons), Next.js/TypeScript (desk UI), lark-cli via `/tmp/lk.sh` wrapper, vitest + pytest-style test harnesses already in repo.

**Evidence base (2026-06-12 diff session):** 39 queue rows compared against live Lark. Findings:
- Desk used `ka @Fadel Rahman` / `ka @Radika Ihsan` — both are **pak**. (honorific gap)
- Desk always generated "circling back" nudge copy; Bryan sent substantive content same-day (offers, specific questions like "July / Aug / Sept?", decisions like "Okie means 24th"). (intent gap)
- Desk timing throttled to ~2-working-day waits; Bryan's rule is "if I have something to say, send now" — timers only for genuine waiting. (timing gap)
- Rows where `last_from: You` today were still shown "due now". (staleness gap)
- `pending_fix=True` rows where Bryan sent a warm thanks (Le Han 谢谢) still need the commitment-date status nudge — thanks ≠ closure. Desk got this right; keep it.

---

## TWO-REPO COMMIT RULE (NEMESIS-proven)

Daemon/state files live in repo **A**: `/Users/bryan.seto/.hermes/profiles/bryan/` (verify: `git -C /Users/bryan.seto/.hermes/profiles/bryan rev-parse --show-toplevel`).
UI files live in repo **B**: `/Users/bryan.seto/lark-reply-desk/`.
Every phase below has **separate commit blocks per repo**. Never `git add -A` across both.

## BUILD RULE

The launchd service runs `next start` (production bundle). After ANY UI change:
```bash
cd /Users/bryan.seto/lark-reply-desk && /Users/bryan.seto/.hermes/profiles/bryan/home/.local/bin/node node_modules/.bin/next build
launchctl kickstart -k gui/$(id -u)/com.bryan.lark-reply-desk
curl -s -o /dev/null -w "%{http_code}" http://localhost:3100   # expect 200
```
TypeScript check: `node node_modules/.bin/tsc --noEmit` (filter pre-existing `DraftComposer.test.tsx` errors). `npx` is NOT in PATH.

---

# Phase 0 — Capture Infrastructure (foundation, deterministic)

Everything later depends on capturing ground truth. Build this first so learning data starts accruing immediately.

### Task 0.1: Create the honorifics roster file

**File:** `/Users/bryan.seto/.hermes/profiles/bryan/state/honorifics.json` (new)

```json
{
  "_comment": "Per-person honorific roster. source: seed|learned. Counts updated by honorific_learner.",
  "people": {
    "Fadel Rahman":          {"honorific": "pak", "source": "seed-2026-06-12", "counts": {"pak": 1}},
    "Radika Ihsan":          {"honorific": "pak", "source": "seed-2026-06-12", "counts": {"pak": 1}},
    "Astra Lindi":           {"honorific": "bu",  "source": "seed-2026-06-12", "counts": {}},
    "Monica":                {"honorific": "bu",  "source": "seed-2026-06-12", "counts": {}},
    "Arnold Pramudita":      {"honorific": "pak", "source": "seed-2026-06-12", "full_name_required": true, "counts": {}},
    "Oris":                  {"honorific": "adik","source": "seed-2026-06-12", "counts": {}},
    "Louis Supit":           {"honorific": "pak", "source": "seed-2026-06-12", "counts": {}},
    "Andro Situmorang":      {"honorific": "pak", "source": "seed-2026-06-12", "counts": {}},
    "Taufiq Salim":          {"honorific": "pak", "source": "seed-2026-06-12", "counts": {}},
    "Stevania Junitasari":   {"honorific": "bu",  "source": "seed-2026-06-12", "counts": {}},
    "Christie Valentina":    {"honorific": "bu",  "source": "seed-2026-06-12", "counts": {}},
    "Symphony Cellis Zaana Saraaya": {"honorific": "bu", "source": "seed-2026-06-12", "counts": {}},
    "Shandy Darmawan":       {"honorific": "ka",  "source": "seed-2026-06-12", "counts": {}},
    "Christyana Henrietta":  {"honorific": "",    "source": "seed-2026-06-12", "alias": "Anna", "counts": {}},
    "Le Han":                {"honorific": "",    "source": "seed-2026-06-12", "counts": {}},
    "Muhammad Fachri":       {"honorific": "pak", "source": "seed-2026-06-12", "counts": {}},
    "Kexin Yang":            {"honorific": "bu",  "source": "seed-2026-06-12", "counts": {}}
  },
  "banned": ["mas"],
  "default": ""
}
```

Seed values: pak for Fadel/Radika confirmed from Bryan's live sends today; others from `bryan-lark-style` honorifics table + `flight-stakeholder-intelligence` roster. **Recon step for implementer:** before writing, grep `bryan-lark-style` skill (`skills/domain/bryan-lark-style/`) for its honorifics table and copy every person it lists. Empty string = no honorific (plain name is correct).

**Verify:** `python3 -c "import json; json.load(open('/Users/bryan.seto/.hermes/profiles/bryan/state/honorifics.json'))"` → no error.

### Task 0.2: Write the draft-vs-sent capture in the harvester

**File:** `/Users/bryan.seto/.hermes/profiles/bryan/daemons/flag_followup_harvest.py`
**New output:** `/Users/bryan.seto/.hermes/profiles/bryan/state/draft-vs-sent.jsonl`

Logic (deterministic, runs inside the existing merge step where old queue rows meet fresh thread pulls): when a previously-drafted row's fresh thread contains a NEW message from "You" with timestamp > `drafted_at`, and the row had a non-empty `draft_text`, append one capture record:

```python
CAPTURE_PATH = STATE_DIR / "draft-vs-sent.jsonl"

def capture_draft_vs_sent(old_row: dict, fresh_thread: list[dict]) -> None:
    """Record (desk draft, what Bryan actually sent) pairs for the learning loop."""
    drafted_at = old_row.get("drafted_at")
    draft = (old_row.get("draft_text") or "").strip()
    if not drafted_at or not draft:
        return
    new_you = [m for m in fresh_thread
               if m.get("from") == "You"
               and _parse_ts(m.get("t", "")) and _parse_ts(m["t"]).timestamp() > drafted_at]
    if not new_you:
        return
    rec = {
        "captured_at": time.time(),
        "handle": old_row.get("handle"),
        "person": old_row.get("person"),
        "chat_name": old_row.get("chat_name"),
        "basis": old_row.get("followup_basis"),
        "pending_fix": old_row.get("pending_fix", False),
        "waiting_state": old_row.get("waiting_state"),
        "suggested_date": old_row.get("suggested_date"),
        "desk_draft": draft,
        "bryan_sent": [m["text"] for m in new_you],
        "bryan_sent_at": new_you[0]["t"],
        "distilled": False,
    }
    with open(CAPTURE_PATH, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
```

Dedup guard: keep a set of `(handle, bryan_sent_at)` already captured (scan the file's last ~500 lines at startup) so re-harvests don't duplicate.

**Test first:** `daemons/tests/test_capture_draft_vs_sent.py` — 3 cases: (a) new You msg after drafted_at → 1 record; (b) You msg before drafted_at → no record; (c) empty draft → no record. Run with the repo's existing test pattern (`python3 daemons/tests/test_capture_draft_vs_sent.py`).

### Task 0.3: Write the unflag-event capture

**File:** same harvester. **New output:** `/Users/bryan.seto/.hermes/profiles/bryan/state/unflag-events.jsonl`

The harvester already detects flags that disappeared from `+flag-list` (it drops rows). At the drop point, instead of silently discarding, append:

```python
def capture_unflag_event(row: dict, reason: str) -> None:
    """reason: 'unflagged' (gone from flag-list) | 'parked' | 'sent_via_desk'"""
    rec = {
        "captured_at": time.time(),
        "handle": row.get("handle"),
        "person": row.get("person"),
        "chat_name": row.get("chat_name"),
        "basis": row.get("followup_basis"),
        "pending_fix": row.get("pending_fix", False),
        "next_action_at_unflag": row.get("next_action"),
        "suggested_date": row.get("suggested_date"),
        "desk_draft": (row.get("draft_text") or "")[:500],
        "last_from": row.get("last_from"),
        "last_activity": row.get("last_activity"),
        "thread_tail": [
            {"t": m.get("t"), "from": m.get("from"), "text": (m.get("text") or "")[:200]}
            for m in (row.get("thread_json") or [])[-5:]
        ],
        "reason": reason,
        "distilled": False,
    }
    with open(STATE_DIR / "unflag-events.jsonl", "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
```

Semantics this captures: an unflag where `last_from == You` ≈ "Bryan considered his own last message the closer"; unflag where `pending_fix=True` ≈ "Bryan closed despite pending fix" (timing lesson: he trusts the commitment). The distiller (Phase 2) interprets; capture stays dumb and deterministic.

**Test:** `daemons/tests/test_capture_unflag.py` — drop path calls capture with reason="unflagged"; park path with reason="parked".

### Task 0.4: Commit Phase 0 (repo A only)

```bash
cd /Users/bryan.seto/.hermes/profiles/bryan
git add state/honorifics.json daemons/flag_followup_harvest.py daemons/tests/test_capture_draft_vs_sent.py daemons/tests/test_capture_unflag.py
git commit -m "capture: draft-vs-sent pairs + unflag events + honorifics roster (trust pipeline phase 0)"
```

---

# Phase 1 — Immediate Deterministic Fixes (today's diff findings)

### Task 1.1: Post-draft validator module (the trust gate, Python side)

**File:** `/Users/bryan.seto/.hermes/profiles/bryan/daemons/draft_validator.py` (new)

Pure functions, no LLM, no network. This is the single source of truth for "is this draft auto-sendable"; the TS mirror (Task 3.2) only reads its OUTPUT stored on the queue row.

```python
"""Deterministic draft validation. Every check returns (ok, reason)."""
import json, re
from pathlib import Path

STATE = Path("/Users/bryan.seto/.hermes/profiles/bryan/state")
_HON = json.loads((STATE / "honorifics.json").read_text())

PLACEHOLDER_RE = re.compile(
    r"\((?:hermes|TODO|fill|confirm)[^)]*\)|\[(?:confirm|placeholder|fill|TODO)[^\]]*\]",
    re.IGNORECASE)
EMDASH_RE = re.compile(r"[—–]")
MARKDOWN_RE = re.compile(r"\*\*|^#+\s", re.MULTILINE)
RAW_ID_RE = re.compile(r"\b(?:oc_|om_|omt_)[a-f0-9]{8,}")
HONORIFIC_RE = re.compile(r"\b(pak|bu|ka|kak|adik|mas)\s+@?([A-Z][\w()\u4e00-\u9fff]*(?:\s+[A-Z][\w()\u4e00-\u9fff]*)*)", re.IGNORECASE)

def check_honorifics(draft: str) -> tuple[bool, str]:
    people = _HON["people"]
    for m in HONORIFIC_RE.finditer(draft):
        used, name = m.group(1).lower(), m.group(2).strip()
        if used in _HON.get("banned", []):
            return False, f"banned honorific '{used}' used for {name}"
        # match roster by first-token prefix (draft may tag short name)
        for full, info in people.items():
            if full.lower().startswith(name.lower().split()[0]) or name.lower().split()[0] in full.lower():
                expected = info.get("honorific", "")
                if expected and used != expected:
                    return False, f"'{used} {name}' but roster says '{expected} {full}'"
                break
    return True, ""

def scrub(draft: str) -> str:
    """Mechanical fixes that never change meaning."""
    return EMDASH_RE.sub(", ", draft).replace("**", "")

def validate(draft: str) -> dict:
    """Returns {'ok': bool, 'failures': [...], 'scrubbed': str}."""
    failures = []
    if not draft.strip():
        failures.append("empty draft")
    if PLACEHOLDER_RE.search(draft):
        failures.append("placeholder text present")
    if RAW_ID_RE.search(draft):
        failures.append("raw lark id leaked")
    ok_h, why = check_honorifics(draft)
    if not ok_h:
        failures.append(f"honorific: {why}")
    scrubbed = scrub(draft)
    if MARKDOWN_RE.search(scrubbed):
        failures.append("markdown formatting present")
    return {"ok": not failures, "failures": failures, "scrubbed": scrubbed}
```

**Test first:** `daemons/tests/test_draft_validator.py` — cases: (a) `"hi ka @Fadel Rahman"` → fail with honorific reason; (b) `"hi pak @Fadel Rahman"` → pass; (c) em-dash gets scrubbed and passes; (d) `"(hermes should summarise context here)"` → fail; (e) `"Mas Andro"` → fail banned; (f) empty → fail. Run, see fail, implement, see pass.

### Task 1.2: Wire validator into draft_engine output path

**File:** `/Users/bryan.seto/.hermes/profiles/bryan/daemons/draft_engine.py`

In `draft_reply` and `draft_followup`, after `_extract_draft()` / `_has_placeholder` and before returning: run `draft_validator.validate(text)`. If `ok` → return `scrubbed` text. If only mechanical failures (em-dash/markdown) → return scrubbed. If honorific/placeholder failure → ONE retry through the existing fallback path with the failure reason appended to the prompt ("fix: roster says pak Fadel Rahman"); if still failing → return None (blank draft box beats wrong draft). Store the validation result so the harvester can persist it (next task).

### Task 1.3: Persist `validation` + staleness demotion on queue rows

**File:** `flag_followup_harvest.py`

a) When writing each row, add fields:
```python
row["validation"] = draft_validator.validate(row.get("draft_text") or "")
row["validation"]["checked_at"] = time.time()
```
b) **Staleness demotion (today's gap #4):** after the thread pull, if the latest thread message is from "You" AND its timestamp > `drafted_at` (or no draft yet) AND `followup_basis` in `("they_owe_reply", "waiting_no_commitment")` → the ball is in THEIR court because Bryan just spoke. Force `suggested_date` to at least `last_you_ts + nudge_window(basis)` and set `next_action` to `"You replied {when} — waiting on {person}; nudge {date} if silent."` This kills the false "due now" rows.
c) **pending_fix + Bryan-thanked rule (keep what worked):** when `pending_fix=True` and Bryan's latest message is a pure ack/thanks (≤ 60 chars, matches `re.compile(r"thank|thanks|谢谢|辛苦|🙏|okie|noted", re.I)`), do NOT close; keep the commitment-date nudge and set `next_action` to `"Thanks sent. Fix still pending — confirm it ships by {date}."`

**Test:** `daemons/tests/test_staleness_demotion.py` — (a) Bryan replied after draft → date pushed out; (b) other person replied last → unchanged; (c) pending_fix + 谢谢 → date stays at commitment date, action text says confirm-ships.

### Task 1.4: Encode today's stance lessons in the corrections file (reaches prompts via existing wiring)

**File:** `/Users/bryan.seto/.hermes/profiles/bryan/state/flagged-desk-corrections.md` — append:

```markdown
## 2026-06-12 — diff session lessons (desk draft vs Bryan's live sends, 39 rows)
- INTENT: Bryan does not send "circling back / keeping it on ur radar" filler when he has
  something substantive. Prefer: a concrete offer ("would u need any more info from me or
  Jenny?"), a specific scoped question ("estimated month — July / Aug / Sept?"), or a
  decision ("Okie means 24th should be able to finish"). "Circling back" is ONLY for true
  silence after the nudge window.
- TIMING: if Bryan has new info or a sharper question, the right time is NOW, not +2 working
  days. The 2-day window applies only when there is genuinely nothing new to add.
- HONORIFICS: Fadel Rahman = pak. Radika Ihsan = pak. Never "ka" for either.
- CLOSING: a warm thanks (incl. 谢谢 / 辛苦了) on a pending_fix row is relationship-correct but
  does NOT close the loop — keep the commitment-date confirm-it-shipped nudge.
```

Verify `_load_corrections()` is injected into BOTH `analyze_thread()` and `draft_followup()` (skill says fixed 2026-06-09 — confirm with grep, don't assume).

### Task 1.5: Update `bryan-lark-style` skill honorifics table

Patch the skill's honorifics table (it feeds the hermes -z primary path) with: Fadel Rahman = pak, Radika Ihsan = pak. Use `skill_manage(action='patch')` on `domain/bryan-lark-style`. The engine reads skills live, so this self-propagates — that is the whole point of Path B.

### Task 1.6: Commit Phase 1 (repo A)

```bash
cd /Users/bryan.seto/.hermes/profiles/bryan
git add daemons/draft_validator.py daemons/draft_engine.py daemons/flag_followup_harvest.py daemons/tests/ state/flagged-desk-corrections.md
git commit -m "trust gate: deterministic draft validator + staleness demotion + 2026-06-12 lessons"
```

Restart daemons: `launchctl kickstart -k gui/$(id -u)/com.bryan.lark-followup-harvest` and same for `com.bryan.lark-draft-pusher`. Verify next cycle log shows rows gaining `validation` fields:
```bash
tail -1 /Users/bryan.seto/.hermes/profiles/bryan/state/lark-followup-queue.jsonl | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('validation'))"
```

---

# Phase 2 — Auto-Learning Loops

### Task 2.1: Deterministic honorific learner (pure regex, no LLM)

**File:** `/Users/bryan.seto/.hermes/profiles/bryan/daemons/honorific_learner.py` (new)

Reads `draft-vs-sent.jsonl` records where `distilled=False`, extracts honorific usages from `bryan_sent` texts with the same `HONORIFIC_RE`, increments `counts` in `honorifics.json`, and flips `honorific` when a learned form reaches **3 observations AND a majority** (protects against one-off typos). Never overrides a `seed-*` entry downward to empty; logs every flip to stderr. ~40 lines. Called at the end of each harvester cycle (cheap) — no new daemon.

**Test first:** `daemons/tests/test_honorific_learner.py` — (a) 3× "pak @NewPerson" → roster gains NewPerson=pak; (b) 1× "ka @Fadel" does NOT flip seed pak; (c) counts accumulate across runs.

### Task 2.2: Deterministic timing tuner

**File:** `/Users/bryan.seto/.hermes/profiles/bryan/daemons/timing_tuner.py` (new)
**Output:** `/Users/bryan.seto/.hermes/profiles/bryan/state/timing-windows.json`

From `draft-vs-sent.jsonl` + `unflag-events.jsonl`, per `followup_basis`, compute the median delta between `suggested_date` and when Bryan actually acted (`bryan_sent_at` / unflag `captured_at`). Write per-basis nudge windows:

```json
{"they_owe_reply": {"days": 2, "n": 14}, "waiting_no_commitment": {"days": 1, "n": 6},
 "their_commitment": {"days": 0, "n": 9, "note": "anchor to commitment date, not window"}}
```

Harvester's date suggestion reads this file (fallback to current hardcoded 2-working-days when `n < 5`). Today's evidence says Bryan acts ~same-day when he has content — expect these windows to shrink where the data supports it.

**Test:** synthetic capture file with known deltas → expected medians.

### Task 2.3: Nightly LLM distiller (style/intent lessons only — the bits regex can't do)

**Mechanism:** Hermes cron job (`cronjob action=create`), daily 21:30, `enabled_toolsets=["file","terminal"]`, prompt self-contained:

> Read /Users/bryan.seto/.hermes/profiles/bryan/state/draft-vs-sent.jsonl and unflag-events.jsonl; process only records with "distilled": false. For each pair, compare desk_draft vs bryan_sent and extract GENERALIZABLE lessons (tone, intent, structure, when-to-stay-silent) — not one-off content. Append max 5 new bullet lessons to state/flagged-desk-corrections.md under a dated heading, deduplicating against lessons already present. Mark processed records distilled:true (rewrite the JSONL). If a lesson contradicts an existing one, replace the old bullet and note the supersession. Do NOT edit any skill; corrections file only. Deliver a 3-line summary.

Guard inside corrections file growth: distiller must also COMPACT — when the file exceeds 120 lines, merge near-duplicate bullets (it gets injected into every draft prompt; unbounded growth = token bleed + dilution).

Skill edits (e.g. new honorific table rows in `bryan-lark-style`) stay HUMAN-gated: distiller proposes in its summary; Bryan approves; a follow-up session patches the skill. Rationale: skills feed every hermes -z draft — a bad auto-edit poisons everything silently.

### Task 2.4: Unflag-reason micro-prompt in the desk UI (optional but high-signal)

**Files (repo B):** `app/page.tsx` (Unflag popover), `app/api/send/route.ts`, daemon `lark-draft-pusher.py`

When Bryan clicks Unflag, show three one-tap reasons: `done` / `they'll handle it` / `not important`. POST includes `unflag_reason`; daemon writes it onto the matching `unflag-events.jsonl` record. One tap turns an ambiguous signal into labeled training data. Skippable (default `done` after 3s). Keep it ONE tap — anything heavier and Bryan won't use it.

### Task 2.5: Commits (both repos, separately)

```bash
cd /Users/bryan.seto/.hermes/profiles/bryan
git add daemons/honorific_learner.py daemons/timing_tuner.py daemons/tests/ state/
git commit -m "learning loop: honorific learner + timing tuner (deterministic) + distiller cron"

cd /Users/bryan.seto/lark-reply-desk
git add app/page.tsx app/api/send/route.ts
git commit -m "unflag reason micro-prompt (labeled training signal)"
```
Then UI rebuild + kickstart (BUILD RULE).

---

# Phase 3 — "Follow Up All" Button

### Task 3.1: Define auto-sendable criteria (the contract)

A row is **auto-sendable** iff ALL of:
1. `status == "pending"` and `suggested_date <= today`
2. `followup_basis NOT IN ("closed",)` and `is_monitoring == false` (monitoring rows need Bryan's own data check — never auto-send)
3. `validation.ok == true` (Phase 1 gate: honorifics, placeholders, ids, scrubbed)
4. `draft_text` non-empty
5. NOT stale: `last_from != "You"` OR `pending_fix == true` (a pending-fix confirm nudge is valid even after Bryan's thanks)
6. Send-time freshness re-check passes (Task 3.4 — daemon-side, the UI gate alone is never enough because drafts freeze at harvest time)

Rows failing 1–5 appear in the review modal under "excluded" with the literal failure reason. Nothing is hidden.

### Task 3.2: `lib/trustGate.ts` + tests (repo B)

Pure function mirroring criteria 1–5 (reads the `validation` object the daemon stored — TS never re-implements the honorific regex; single source of truth stays in Python):

```typescript
// lib/trustGate.ts
export interface GateResult { sendable: boolean; reasons: string[] }
export function trustGate(row: FollowupRow, today: string): GateResult {
  const reasons: string[] = [];
  if (row.status !== "pending") reasons.push("not pending");
  if (!row.draft_text?.trim()) reasons.push("no draft");
  if ((row.suggested_date ?? "9999") > today) reasons.push(`not due until ${row.suggested_date}`);
  if (row.followup_basis === "closed") reasons.push("looks closed");
  if (row.is_monitoring) reasons.push("monitoring row, needs your data check");
  if (!row.validation?.ok) reasons.push(...(row.validation?.failures ?? ["unvalidated"]));
  if (row.last_from === "You" && !row.pending_fix) reasons.push("you replied last, ball in their court");
  return { sendable: reasons.length === 0, reasons };
}
```

**Test first:** `__tests__/trustGate.test.ts` (vitest) — one case per criterion + one fully-green row. Pure helper in `lib/` per repo convention (page.tsx helpers fail the NEMESIS gate).

### Task 3.3: Follow Up All UI — review modal, never blind-send (repo B)

**Files:** `app/page.tsx` (header button next to the Flagged count), new `components/FollowUpAllModal.tsx`

Button "⚡ Follow up all (N)" where N = sendable count. Click → modal:
- **Will send (N):** per row: person · chat · full draft text (editable inline textarea, pre-scrubbed) · per-row checkbox (default checked)
- **Excluded (M):** person · subject · reasons from trustGate (read-only)
- Footer: "Send N follow-ups" + Cancel.

Confirm → POST `/api/followup-all` with `[{handle, draft_text}]` (the possibly-edited texts). This is one human confirmation for the batch — matches Bryan's existing approval model (review once, then it executes).

### Task 3.4: Batch send API + daemon processing with send-time freshness re-check

**Files:** `app/api/followup-all/route.ts` (new, repo B) — appends one command per item to the existing commands JSONL: `{"action": "send", "handle": ..., "draft_text": ..., "batch_id": "fua_<ts>", "freshness_check": true}`.

**Daemon (`lark-draft-pusher.py`, repo A):** for commands with `freshness_check`:
1. Pull thread head (last 5 msgs) via existing `_thread_all`/`_chat_window` helpers through `/tmp/lk.sh`.
2. If any message exists with ts > row's `last_activity` snapshot → DO NOT SEND; mark row `status="stale_skipped"`, record in batch result.
3. Else send via existing send path (lark-cli `code==0` = success), mark `sent`, and append a `draft-vs-sent.jsonl` record with `bryan_sent=[draft_text]`, `source="followup_all"` (auto-sends are training data too).
4. Write batch summary to `state/followup-batch-results.jsonl`; UI polls and toasts "7 sent · 1 skipped (thread moved: Zhou Yijia)".

Throttle: 1 send per 2s (don't machine-gun Lark). Partial failure: continue the batch, report per-row.

**Test:** `daemons/tests/test_followup_all_freshness.py` — mock thread fetch: (a) no new msgs → send called; (b) new msg from them → skipped + stale_skipped status; (c) lark-cli nonzero → row marked error, batch continues.

### Task 3.5: Trust dial (phased rollout of autonomy)

Config key in `state/desk-config.json`: `"followup_all_mode": "review" | "auto_due_today"`.
- **review** (ship default): button + modal as above.
- **auto_due_today** (later, only after ≥2 weeks of batch results show ~0 bad sends): a morning cron runs gate+freshness and sends without the modal, then DMs Bryan the summary in self-DM. DO NOT build the cron yet — just keep the gate logic callable headless (it already is: daemon-side). YAGNI on the cron until the trust data exists.

### Task 3.6: Commits (both repos) + build + verify

```bash
cd /Users/bryan.seto/lark-reply-desk
git add lib/trustGate.ts __tests__/trustGate.test.ts components/FollowUpAllModal.tsx app/page.tsx app/api/followup-all/route.ts
git commit -m "Follow Up All: trust-gated batch send with review modal"

cd /Users/bryan.seto/.hermes/profiles/bryan
git add daemons/lark-draft-pusher.py daemons/tests/test_followup_all_freshness.py
git commit -m "Follow Up All: daemon batch processing with send-time freshness re-check"
```
Then BUILD RULE (next build + kickstart + curl 200). Verify UI via `browser_navigate` to localhost:3100 and read the DOM snapshot (NOT vision screenshots) — button present, count matches `trustGate` math against the live queue file.

---

# Verification — end-to-end acceptance

1. **Validator live:** queue rows carry `validation` objects; a deliberately bad draft (`ka @Fadel`) injected via test harness gets rejected/retried.
2. **Staleness:** rows where Bryan replied today no longer show "due now"; desk "due now" count drops from 22 to the true waiting set.
3. **Capture flowing:** after Bryan's next few replies in flagged threads, `draft-vs-sent.jsonl` grows; after next unflag, `unflag-events.jsonl` grows.
4. **Learning:** after ~a week, `honorifics.json` counts populate; distiller cron appends dated lessons; corrections stay ≤120 lines.
5. **Follow Up All:** with ≥3 due sendable rows, button shows correct N; modal exclusions list honest reasons; confirmed batch sends appear in Lark (Bryan eyeballs 2–3); skipped-stale rows reported.
6. **Trust metric (the real goal):** weekly, % of desk drafts Bryan sends unedited via the modal. When it's ≥80% for 2 weeks → discuss flipping `auto_due_today`.

# NEMESIS notes (pre-execute critique, resolved into the plan)

- **Ordering:** Phase 0 before Phase 1 (validator reads honorifics.json). Task 1.3 needs 1.1. Phase 3 needs Phase 1's `validation` field on rows. No parallel workstream writes state another reads mid-flight.
- **Two repos:** every commit block above targets one repo. Probe before first commit: `git -C ... rev-parse --show-toplevel` for both dirs.
- **Single source of truth:** honorific logic lives ONLY in Python validator; TS reads stored results. Prevents the engine-vs-skill drift class of bug recurring in a third place.
- **Corrections-file token bleed:** distiller compaction rule is mandatory, not optional (file is injected into every draft prompt).
- **Auto-send blast radius:** monitoring rows and Bryan-replied-last rows are hard-excluded; freshness re-check is daemon-side at send time, not just UI-side at render time — drafts freeze at harvest, threads don't.
- **Don't auto-edit skills:** distiller writes corrections file only; skill patches stay human-approved.
- **lark-cli quirk:** all daemon lark calls via `/tmp/lk.sh` wrapper, `+messages-mget` not `+message-get`, unflag feed-layer "error" ≠ failure (already-known pitfalls; implementer must read `references/required-read-path-pitfalls.md` before touching the read path).
