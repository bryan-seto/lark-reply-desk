#!/bin/bash
# Flagged Follow-up Desk — weekday morning harvest + ping wrapper.
# Order: confirm app is live -> harvest flags into the queue -> self-DM the link,
# so clicking lands on a ready, populated page.
# $0: plain local python + lark-cli OAuth (launchd GUI agent = keychain-OK).
set -uo pipefail

export PATH="${HOME}/.nvm/versions/node/$(node --version 2>/dev/null | tr -d v || echo 'v20.0.0')/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="${HOME}"
LARK_CLI="$(which lark-cli 2>/dev/null || echo 'lark-cli')"

# Your Lark open_id for self-DM (run: lark-cli im +me to find yours)
LARK_USER_ID="${LARK_USER_ID:-}"

DAEMONS="${HERMES_DAEMONS:-${HOME}/.hermes/profiles/default/daemons}"
QUEUE="${HERMES_STATE:-${HOME}/.hermes/profiles/default/state}/lark-followup-queue.jsonl"

# 1) Confirm the Reply Desk app is live (launchd KeepAlive should keep it up;
#    we do NOT start it here, only verify). Retry briefly in case of cold boot.
APP_OK=0
for i in 1 2 3 4 5 6; do
  if curl -fsS -o /dev/null --max-time 4 http://localhost:3100/; then APP_OK=1; break; fi
  sleep 5
done

# 2) Harvest flags -> queue (the two-call read: flag-list + per-thread).
#    On a stale user token the harvester EXITS 3 and leaves the queue
#    intact. Re-mint the token non-interactively and retry once.
/usr/bin/python3 "$DAEMONS/flag_followup_harvest.py" --once
HARVEST_RC=$?
if [ "$HARVEST_RC" -eq 3 ]; then
  # Exit 3 = fetch_failed: transient network blip OR dead user token.
  # Device flow needs browser consent — cannot re-mint unattended.
  # Alert is sent out-of-band by the reauth watch script.
  sleep 3
  /usr/bin/python3 "$DAEMONS/flag_followup_harvest.py" --once
  HARVEST_RC=$?
fi

# 3) Count pending follow-ups for the ping text.
N=$(/usr/bin/python3 -c "
import json
try:
    rows=[json.loads(l) for l in open('$QUEUE') if l.strip()]
    print(sum(1 for r in rows if r.get('status','pending')=='pending'))
except Exception:
    print(0)
")

# 4) Self-DM with the desk link (only if there's something + app is up).
#    QUIET=1 (set by the periodic refresh job) skips the ping.
if [ "${QUIET:-0}" = "1" ]; then
  exit 0
fi
if [ "$N" -gt 0 ] && [ "$APP_OK" -eq 1 ] && [ -n "$LARK_USER_ID" ]; then
  MSG="morning 🌅 $N flagged follow-ups ready -> http://localhost:3100/ (Flagged tab)"
  "$LARK_CLI" im +messages-send --as user --user-id "$LARK_USER_ID" \
    --msg-type text --text "$MSG" >/dev/null 2>&1
elif [ "$N" -gt 0 ] && [ "$APP_OK" -eq 0 ] && [ -n "$LARK_USER_ID" ]; then
  MSG="morning 🌅 $N flagged follow-ups ready (desk still starting up, give it a moment) -> http://localhost:3100/ (Flagged tab)"
  "$LARK_CLI" im +messages-send --as user --user-id "$LARK_USER_ID" \
    --msg-type text --text "$MSG" >/dev/null 2>&1
fi
