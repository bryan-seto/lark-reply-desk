# Unflag Fix Implementation Plan

> **Implementation note:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix two confirmed bugs in the Lark Reply Desk unflag flow — `unflag_message()` returns `False` on partial success (causing the UI to not drop the row), and the UI drops unflag commands silently on network error.

**Architecture:**
- **Bug A (daemon/Python):** `unflag_message()` in `lark-draft-pusher.py` calls `lark-cli im +flag-cancel` which performs a double-cancel (message layer + feed layer). The message layer succeeds but the feed layer fails with `"feed flag user no permission"`. The daemon trusts `returncode != 0` and returns `False`, making the daemon write `status: error` to results. Root fix: parse the JSON response and return `True` if at least the `message` layer result has `status: ok`.
- **Bug B (UI/TypeScript):** `doUnflag()` in `app/page.tsx` does not call `dropCurrentRow()` when status is `"error"`, so the row stays visible even though Lark removed the flag. Fix: treat `"error"` the same as `"queued"` — drop the row with a soft toast.

**Tech Stack:** Python 3.11 (`python3`), pytest, Next.js 14 (App Router), TypeScript, lark-cli 1.0.47

**Key Files:**
- `/Users/user.seto/.hermes/profiles/user/daemons/lark-draft-pusher.py` — Bug A (daemon repo: `/Users/user.seto/.hermes/profiles/user/`)
- `/Users/user.seto/.hermes/profiles/user/daemons/test_unflag_fix.py` — new test file (daemon repo)
- `/Users/user.seto/.hermes/profiles/user/daemons/test_date_helpers.py` — existing Python test harness
- `/Users/user.seto/lark-reply-desk/app/page.tsx` — Bug B (`doUnflag` at line 270, lark-reply-desk repo)
- `/Users/user.seto/.hermes/profiles/user/state/lark-reply-desk-commands.jsonl` — command queue (append-only)
- `/Users/user.seto/.hermes/profiles/user/state/lark-reply-desk-results.jsonl` — result records
- `/Users/user.seto/.hermes/profiles/user/logs/lark-draft-pusher.log` — daemon logs

**IMPORTANT — Two separate git repos:**
- Daemon files live in git repo at: `/Users/user.seto/.hermes/profiles/user/`
- UI files live in git repo at: `/Users/user.seto/lark-reply-desk/`
- Never run `git -C /Users/user.seto/lark-reply-desk add <daemon-path>` — git will reject it with `fatal: outside repository`.

**IMPORTANT — `python` vs `python3`:** `python` is not in PATH on this machine. Always use `python3`.

**IMPORTANT — `npm` path:** `npm` is not in PATH. Always use `/Users/user.seto/.nvm/versions/node/v24.13.1/bin/npm`.

---

## Confirmed Evidence (from live debugging session, 2026-06-07)

### Bug A — exact CLI output:
```json
{
  "data": {
    "results": [
      { "flag_type": "message", "status": "ok" },
      { "flag_type": "feed", "status": "failed", "error": "feed flag user no permission" }
    ]
  }
}
```
Exit code = 1. Current code: `return r.returncode == 0` → always False.

The **correct** success check: JSON data has at least one result with `flag_type == "message"` and `status == "ok"`.

### Bug B — confirmed via commands log:
Four unflag commands were queued across a session, all returned `status: error`.
After an unflag returns `error`, `doUnflag()` shows a toast but **does not call `dropCurrentRow()`** — so the row stays in the UI list despite Lark actually removing the flag.

---

## Task 1: TDD Engineer — Write failing tests for `unflag_message()` partial-success logic

**File to create:** `/Users/user.seto/.hermes/profiles/user/daemons/test_unflag_fix.py`

**Context for implementer:**
The `unflag_message(message_id)` function is at line 153 of `lark-draft-pusher.py`. It runs:
```python
r = subprocess.run(
    [LARK_CLI, "im", "+flag-cancel", "--message-id", message_id,
     "--as", "user", "--format", "json"],
    capture_output=True, text=True, timeout=30, env=env)
if r.returncode != 0:
    log(f"unflag rc={r.returncode}: {(r.stderr or r.stdout)[:160]}")
return r.returncode == 0
```

The fix will change the return logic to parse the JSON stdout and return `True` if any result entry has `"flag_type": "message"` AND `"status": "ok"`.

**IMPORTANT — Import pattern:**
The file is named `lark-draft-pusher.py` (hyphens). Normal Python import fails. Use `importlib`:
```python
import importlib.util, pathlib

_spec = importlib.util.spec_from_file_location(
    "lark_draft_pusher",
    pathlib.Path(__file__).parent / "lark-draft-pusher.py"
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
unflag_message = _mod.unflag_message
```

**IMPORTANT — Smoke-test the import first:**
Before writing any test, run:
```bash
cd /Users/user.seto/.hermes/profiles/user/daemons && python3 -c "
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location('lp', 'lark-draft-pusher.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print('import ok, unflag_message:', mod.unflag_message)
" 2>&1
```
Expected: `import ok, unflag_message: <function unflag_message at 0x...>`
If this fails, report the error — do NOT proceed with the test file.

**IMPORTANT — Mock path:** `subprocess` is imported as `import subprocess` at the module level. The correct mock path is `"subprocess.run"`.

**TDD steps:**
1. Run the smoke-test import (above) — confirm it prints `import ok`
2. Create `/Users/user.seto/.hermes/profiles/user/daemons/test_unflag_fix.py` with the import block above, then write 4 test cases using `unittest.mock.patch("subprocess.run")`:
   - `test_full_success` — both message + feed return ok, returncode=0 → returns True
   - `test_partial_success_message_ok_feed_fails` — message ok, feed fails, returncode=1 → **must return True** (this is the bug; test will FAIL before the fix)
   - `test_full_fail_both_layers` — both failed, returncode=1 → returns False
   - `test_empty_message_id` — empty string → returns False (no subprocess call made)

3. Run: `cd /Users/user.seto/.hermes/profiles/user/daemons && python3 -m pytest test_unflag_fix.py -v`
4. **Verify at least `test_partial_success_message_ok_feed_fails` FAILS** — this confirms the test catches the real bug

**Expected failing output (before fix):**
```
FAILED test_unflag_fix.py::test_partial_success_message_ok_feed_fails
```

**Commit (daemon repo):**
```bash
git -C /Users/user.seto/.hermes/profiles/user add daemons/test_unflag_fix.py
git -C /Users/user.seto/.hermes/profiles/user commit -m "test(unflag): add failing tests for partial-success logic"
```

---

## Task 2: Code Engineer — Fix Bug A in `unflag_message()`

**File to edit:** `/Users/user.seto/.hermes/profiles/user/daemons/lark-draft-pusher.py`
**Lines to change:** 165–167 (the `if r.returncode != 0: ... return r.returncode == 0` block)

**Verify the exact current code first:**
```bash
sed -n '153,170p' /Users/user.seto/.hermes/profiles/user/daemons/lark-draft-pusher.py
```

**Old code (lines 165–167):**
```python
        if r.returncode != 0:
            log(f"unflag rc={r.returncode}: {(r.stderr or r.stdout)[:160]}")
        return r.returncode == 0
```

**New code (replace those 3 lines exactly):**
```python
        # Partial success: message layer ok, feed layer may fail with permission error.
        # Treat as success if at least the message bookmark was removed.
        try:
            payload = json.loads(r.stdout or "{}")
            results = (payload.get("data") or {}).get("results") or []
            message_ok = any(
                res.get("flag_type") == "message" and res.get("status") == "ok"
                for res in results
            )
        except Exception:
            message_ok = False
        if not message_ok and r.returncode != 0:
            log(f"unflag rc={r.returncode}: {(r.stderr or r.stdout)[:160]}")
        elif r.returncode != 0:
            log(f"unflag partial ok (message layer removed, feed layer: permission denied) for {message_id}")
        return message_ok or r.returncode == 0
```

**Note:** `json` is already imported at line 24 (`import json, os, re, subprocess, sys, time`). Do NOT add a duplicate import.

**TDD steps:**
1. Apply the patch to `lark-draft-pusher.py` lines 165–167
2. Run: `cd /Users/user.seto/.hermes/profiles/user/daemons && python3 -m pytest test_unflag_fix.py -v`
3. **Verify ALL 4 tests PASS**
4. Verify no regression: `python3 -m pytest test_date_helpers.py -v` — must all still pass
5. Commit (daemon repo):
   ```bash
   git -C /Users/user.seto/.hermes/profiles/user add daemons/lark-draft-pusher.py
   git -C /Users/user.seto/.hermes/profiles/user commit -m "fix(daemon): unflag_message returns True on partial success (message layer ok, feed permission denied)"
   ```

---

## Task 3: Code Engineer — Fix Bug B in `doUnflag()` (`app/page.tsx`)

**File to edit:** `/Users/user.seto/lark-reply-desk/app/page.tsx`
**Lines to change:** `doUnflag()` function at lines 270–297

**Verify the exact current code first:**
```bash
sed -n '270,297p' /Users/user.seto/lark-reply-desk/app/page.tsx
```

**Old code (lines 270–297):**
```typescript
async function doUnflag() {
  if (unflagging || !fuCur) return;
  const activeHandle = fuCur.handle;
  setUnflagging(true);
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: activeHandle, action: "unflag", note: unflagNote, link: linkedChat }),
    });
    const r = await res.json();
    if (r.status === "unflagged") {
      showToast(linkedChat ? "Unflagged · linked" : "Unflagged");
      setUnflagOpen(false);
      dropCurrentRow(activeHandle);
    } else if (r.status === "queued") {
      showToast("Queued — Lark will remove the flag within ~60s");
      setUnflagOpen(false);
      dropCurrentRow(activeHandle);
    } else {
      showToast(`Unflag failed: ${r.detail || "unknown"}`);
    }
  } catch {
    showToast("Unflag failed: network");
  } finally {
    setUnflagging(false);
  }
}
```

**New code (replace lines 270–297 exactly):**
```typescript
async function doUnflag() {
  if (unflagging || !fuCur) return;
  const activeHandle = fuCur.handle;
  setUnflagging(true);
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: activeHandle, action: "unflag", note: unflagNote, link: linkedChat }),
    });
    const r = await res.json();
    if (r.status === "unflagged") {
      showToast(linkedChat ? "Unflagged · linked" : "Unflagged");
      setUnflagOpen(false);
      dropCurrentRow(activeHandle);
    } else if (r.status === "queued") {
      showToast("Queued — Lark will remove the flag within ~60s");
      setUnflagOpen(false);
      dropCurrentRow(activeHandle);
    } else if (r.status === "error") {
      // Flag-cancel partial success: message layer likely removed even if daemon
      // reported error. Drop the row to avoid stuck UI; next harvest will confirm.
      showToast("Unflagged — Lark may take a moment to confirm");
      setUnflagOpen(false);
      dropCurrentRow(activeHandle);
    } else {
      showToast(`Unflag failed: ${r.detail || "unknown"}`);
    }
  } catch {
    showToast("Unflag failed — check connection and retry");
  } finally {
    setUnflagging(false);
  }
}
```

**Verification steps:**
1. `grep -n "dropCurrentRow(activeHandle)" /Users/user.seto/lark-reply-desk/app/page.tsx`
   — Expected: **3 matches** (unflagged, queued, error branches). Was 2 before fix.
2. `grep -n "Removed locally" /Users/user.seto/lark-reply-desk/app/page.tsx`
   — Expected: 1 match.
3. Build check (TypeScript):
   ```bash
   /Users/user.seto/.nvm/versions/node/v24.13.1/bin/npm run build --prefix /Users/user.seto/lark-reply-desk 2>&1 | tail -20
   ```
   Expected: no errors, build succeeds.
4. Commit (lark-reply-desk repo):
   ```bash
   git -C /Users/user.seto/lark-reply-desk add app/page.tsx
   git -C /Users/user.seto/lark-reply-desk commit -m "fix(ui): drop row on error status + clearer network-error toast in doUnflag"
   ```

---

## Task 4: QA — End-to-end verification

**Run all checks in order, report each as PASS/FAIL:**

### 4a. Python unit tests (daemon repo)
```bash
cd /Users/user.seto/.hermes/profiles/user/daemons
python3 -m pytest test_unflag_fix.py test_date_helpers.py -v
```
Expected: all green, 4 new + all existing tests pass.

### 4b. Build check (lark-reply-desk repo)
```bash
/Users/user.seto/.nvm/versions/node/v24.13.1/bin/npm run build --prefix /Users/user.seto/lark-reply-desk 2>&1 | tail -30
```
Expected: no TypeScript errors.

### 4c. Daemon process check
```bash
pgrep -f lark-draft-pusher && echo "daemon running" || echo "daemon NOT running"
```
Expected: daemon running.

### 4d. Log tail (no new errors since fix)
```bash
tail -5 /Users/user.seto/.hermes/profiles/user/logs/lark-draft-pusher.log
```
Expected: no error lines since fix was applied.

### 4e. Dry-run unflag logic check (verifies the JSON parsing)
```bash
python3 - <<'EOF'
import json

# Simulate the exact lark-cli output that was failing before the fix
fake_stdout = json.dumps({
    "ok": True,
    "data": {
        "results": [
            {"flag_type": "message", "item_id": "om_x100b6d128f772ca0e2c3dadddaa9727", "status": "ok"},
            {"flag_type": "feed", "item_id": "om_x100b6d128f772ca0e2c3dadddaa9727", "status": "failed",
             "error": "process feed flag failed, feed flag user no permission"}
        ]
    }
})

payload = json.loads(fake_stdout or "{}")
results = (payload.get("data") or {}).get("results") or []
message_ok = any(
    res.get("flag_type") == "message" and res.get("status") == "ok"
    for res in results
)
print(f"message_ok={message_ok}")
assert message_ok is True, "BUG: partial success not detected"
print("PASS — fix logic is correct")
EOF
```
Expected: `message_ok=True` and `PASS`.

### 4f. Git log check (two repos)
```bash
echo "=== lark-reply-desk ===" && git -C /Users/user.seto/lark-reply-desk log --oneline -5
echo "=== hermes daemon ===" && git -C /Users/user.seto/.hermes/profiles/user log --oneline -3
```
Expected: top commit of `lark-reply-desk` is `fix(ui): drop row on error status...`; top 2 commits of hermes repo are the test + daemon fix commits. (Other pre-existing commits below are normal.)

**QA output format:**
```
Task 4a: PASS/FAIL — [X/Y tests passed]
Task 4b: PASS/FAIL — [any TS errors?]
Task 4c: PASS/FAIL — [daemon running?]
Task 4d: PASS/FAIL — [last log line]
Task 4e: PASS/FAIL — [message_ok=True/False]
Task 4f: PASS/FAIL — [top commits from each repo]
Overall: GREEN / RED
```

---

## PM + Designer Review Criteria (Task 5)

### PM checklist
- [ ] Both bugs are addressed (A: daemon partial success; B: UI drop-on-error)
- [ ] No regression on existing send flows (`sendViaDaemon`, `test_date_helpers.py` all pass)
- [ ] All 4 new Python tests pass
- [ ] Commit messages follow `type(scope): description` convention (3 commits: 1 per task)
- [ ] The previously stuck items (Stefanie, Open Search Banner, `fu_omt_19470ddbcc4e1980`) will disappear from the desk on next harvest — queue row count confirms ≤ 17

### Designer checklist
- [ ] Toast copy is clear and non-technical: "Removed locally — Lark sync may take a moment" ✓ (not "flag-cancel partial success")
- [ ] Network error toast is actionable: "Unflag failed — check connection and retry" ✓ (was "Unflag failed: network")
- [ ] No new spinner states introduced — `setUnflagging(false)` still fires in `finally` block
- [ ] Unflag modal closes on ALL 3 success-path branches (unflagged/queued/error all call `setUnflagOpen(false)`)

---

## Out of Scope
- Fixing the root cause of feed-layer permission error (Lark API permissioning, not a desk issue)
- Installing a JS test framework (Jest/Playwright) — deferred
- The "9 commands not queued" issue — confirmed transient dev-server restart; fix above addresses the UI state inconsistency for future occurrences
