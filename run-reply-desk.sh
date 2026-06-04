#!/bin/bash
# Lark Reply Desk — launchd run wrapper.
# Serves the production Next.js build on localhost:3100, kept alive by launchd
# (restarts on crash/login). Plain local Node — no tokens, no cloud, $0.
set -euo pipefail

export PATH="/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="/Users/bryan.seto"
export PORT=3100
export NODE_ENV=production

cd /Users/bryan.seto/lark-reply-desk

# If no production build exists yet, build once before serving.
if [ ! -d ".next" ]; then
  npm run build
fi

exec npm run start
