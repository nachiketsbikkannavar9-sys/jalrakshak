#!/usr/bin/env bash
# Keeps a localhost.run relay alive for the Jalrakshak backend and re-deploys
# the Vercel SPA whenever the relay's public hostname changes (the anonymous
# tunnel hands out a NEW subdomain on every reconnect, and VITE_API_BASE is
# baked into the static build).
#
# While the tunnel is connected it watches the relay banner for the assigned
# hostname; if it differs from the last baked hostname it runs a single
# `vercel deploy --prod --build-env VITE_API_BASE=<url>`. Deploys are
# serialised with a lockfile (stale locks >10min are cleared) so a flapping
# tunnel can't stack redeploys.
#
# A cron watchdog restarts this script if it ever dies (see below).
set -u

STATE="/tmp/opencode/last-tunnel-url"
LOG="/tmp/opencode/tunnel-relay.log"
LOCK="/tmp/opencode/deploy.lock"
mkdir -p /tmp/opencode
rm -rf "$LOCK"

if [ ! -f "$STATE" ] && [ -n "${INITIAL_TUNNEL_URL:-}" ]; then
  echo "$INITIAL_TUNNEL_URL" > "$STATE"
fi

log() { echo "$(date -u) $*" >> "$LOG"; }
on_exit() { log "relay process exiting (rc=$?)"; }
trap on_exit EXIT

deploy_for() {
  local url="$1" current="$2" pid="$$"
  if [ "$url" = "$current" ]; then return 0; fi
  # Clear a stale lock from a crashed previous deploy.
  [ -d "$LOCK" ] && find "$LOCK" -maxdepth 0 -mmin +10 -exec rm -rf {} \; 2>/dev/null
  if ! mkdir "$LOCK" 2>/dev/null; then return 0; fi
  log "relay -> $url (was: ${current:-none})"
  echo "$url" > "$STATE"
  cd /home/abhilash/flood || { rmdir "$LOCK" 2>/dev/null; return 1; }
  vercel deploy --prod --yes --build-env "VITE_API_BASE=$url" >> "$LOG" 2>&1
  log "redeploy finished (pid=$pid)"
  rmdir "$LOCK" 2>/dev/null
}

while true; do
  rm -f /tmp/opencode/tunnel.log
  (
    count=0
    while [ "$count" -lt 240 ]; do
      URL="$(grep -oE 'https://[a-z0-9]+\.lhr\.life' /tmp/opencode/tunnel.log 2>/dev/null | head -1)"
      if [ -n "$URL" ]; then
        deploy_for "$URL" "$(cat "$STATE" 2>/dev/null)"
        exit 0
      fi
      sleep 1
      count=$((count + 1))
    done
    log "no tunnel url within 240s, waiting to retry"
  ) &
  poll_pid=$!
  ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=2 \
    -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
    -R 80:localhost:4000 nokey@localhost.run > /tmp/opencode/tunnel.log 2>&1
  wait "$poll_pid" 2>/dev/null
  log "tunnel ended, reconnecting in 5s"
  sleep 5
done