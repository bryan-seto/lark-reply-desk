#!/bin/bash
# Flagged Follow-up Desk — weekday 6am harvest + ping wrapper.
# Order (PRD v2): confirm app is live -> harvest flags into the queue -> THEN
# self-DM Bryan the link, so clicking lands on a ready, populated page.
# $0: plain local python + lark-cli OAuth (launchd GUI agent = keychain-OK).
set -uo pipefail

export PATH="/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="/Users/bryan.seto"
LARK_CLI="/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin/lark-cli"
BRYAN_OPEN_ID="ou_18e15beecf4878ba9c8357613c2b4ad8"
DAEMONS="/Users/bryan.seto/.hermes/profiles/bryan/daemons"
QUEUE="/Users/bryan.seto/.hermes/profiles/bryan/state/lark-followup-queue.jsonl"

# 1) Confirm the Reply Desk app is live (launchd KeepAlive should keep it up;
#    we do NOT start it here, only verify). Retry briefly in case of cold boot.
APP_OK=0
for i in 1 2 3 4 5 6; do
  if curl -fsS -o /dev/null --max-time 4 http://localhost:3100/; then APP_OK=1; break; fi
  sleep 5
done

# 2) Harvest flags -> queue (the two-call read: flag-list + per-thread).
/usr/bin/python3 "$DAEMONS/flag_followup_harvest.py" --once

# 3) Count pending follow-ups for the ping text.
N=$(/usr/bin/python3 -c "
import json
try:
    rows=[json.loads(l) for l in open('$QUEUE') if l.strip()]
    print(sum(1 for r in rows if r.get('status','pending')=='pending'))
except Exception:
    print(0)
")

# 4) Ping Bryan's self-DM with the LITERAL link (only if there's something + app up).
if [ "$N" -gt 0 ] && [ "$APP_OK" -eq 1 ]; then
  MSG="morning ya 🌅 $N flagged follow-ups ready to review -> http://localhost:3100/ (Follow-ups tab)"
  "$LARK_CLI" im +messages-send --as user --user-id "$BRYAN_OPEN_ID" \
    --msg-type text --text "$MSG" >/dev/null 2>&1
elif [ "$N" -gt 0 ] && [ "$APP_OK" -eq 0 ]; then
  # App down at ping time: still tell him, but flag that he may need to wait a moment.
  MSG="morning ya 🌅 $N flagged follow-ups harvested. open http://localhost:3100/ (Follow-ups tab) - give it a few sec if it's cold"
  "$LARK_CLI" im +messages-send --as user --user-id "$BRYAN_OPEN_ID" \
    --msg-type text --text "$MSG" >/dev/null 2>&1
fi
# N==0: stay silent (nothing to follow up on).
