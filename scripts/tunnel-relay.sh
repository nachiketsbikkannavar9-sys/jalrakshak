#!/usr/bin/env bash
# Keeps a localhost.run relay alive for the Jalrakshak backend and re-deploys
# the Vercel SPA whenever the relay's public hostname changes (the anonymous
# tunnel hands out a NEW subdomain on every reconnect, and VITE_API_BASE is
# baked into the static build).
#
# localhost.run anonymous tunnels can SILENTLY stop routing without closing
# the socket, so this also health-checks the tunnel's own /api/stations and
# force-reconnects (killing ssh) after repeated failures. Reconnect -> new
# hostname -> single serialised `vercel deploy --build-env VITE_API_BASE=<url>`.
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
  local url="$1" current="$2"
  if [ "$url" = "$current" ]; then return 0; fi
  # Clear a stale lock from a crashed previous deploy.
  [ -d "$LOCK" ] && find "$LOCK" -maxdepth 0 -mmin +10 -exec rm -rf {} \; 2>/dev/null
  if ! mkdir "$LOCK" 2>/dev/null; then return 0; fi
  log "relay -> $url (was: ${current:-none})"
  echo "$url" > "$STATE"
  cd /home/abhilash/flood || { rmdir "$LOCK" 2>/dev/null; return 1; }
  vercel deploy --prod --yes --build-env "VITE_API_BASE=$url" >> "$LOG" 2>&1
  log "redeploy finished"
  rmdir "$LOCK" 2>/dev/null
}

while true; do
  rm -f /tmp/opencode/tunnel.log
  log "connecting relay..."
  ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
    -R 80:localhost:4000 nokey@localhost.run > /tmp/opencode/tunnel.log 2>&1 &
  ssh_pid=$!
  url=""
  failures=0
  connected=false

  while kill -0 "$ssh_pid" 2>/dev/null; do
    next="$(grep -oE 'https://[a-z0-9]+\.lhr\.life' /tmp/opencode/tunnel.log 2>/dev/null | head -1)"
    if [ -n "$next" ] && [ "$next" != "$url" ]; then
      url="$next"
      if "$connected"; then log "session re-keyed to $url"; fi
      deploy_for "$url" "$(cat "$STATE" 2>/dev/null)"
    fi
    if [ -n "$url" ]; then
      if curl -sf --max-time 8 "https://$url/api/stations" -o /dev/null 2>&1; then
        failures=0
        if [ "$connected" = false ]; then log "relay healthy at $url"; connected=true; fi
      else
        failures=$((failures + 1))
        log "health check failed ($failures/3) at $url"
      fi
      if [ "$failures" -ge 3 ]; then
        log "tunnel unhealthy, forcing reconnect"
        kill "$ssh_pid" 2>/dev/null
        break
      fi
    fi
    sleep 20
  done

  wait "$ssh_pid" 2>/dev/null
  log "tunnel ended, reconnecting in 3s"
  sleep 3
done