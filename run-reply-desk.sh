#!/bin/bash
# Lark Reply Desk — launchd run wrapper.
# Serves the production Next.js build on localhost:3100, kept alive by launchd
# (restarts on crash/login). Plain local Node — no tokens, no cloud, $0.
set -euo pipefail

# Adjust this to point at your Node installation (nvm, brew, etc.)
export PATH="${HOME}/.nvm/versions/node/$(node --version 2>/dev/null | tr -d v || echo 'v20.0.0')/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="${HOME}"
export PORT="${PORT:-3100}"
export NODE_ENV=production

cd "$(dirname "$0")"

# If no production build exists yet, build once before serving.
if [ ! -d ".next" ]; then
  npm run build
fi

exec npm run start
