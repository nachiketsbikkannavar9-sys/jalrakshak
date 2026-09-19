#!/usr/bin/env bash
# Cron watchdog for the localhost.run relay. Runs every minute from cron; if
# the relay script is not running it relaunches it. The last known tunnel URL
# is used to seed state so a fresh start with the same hostname is a no-op
# redeploy-wise; a changed hostname triggers the normal auto-redeploy.
if ! pgrep -f "scripts/tunnel-relay" > /dev/null 2>&1; then
  setsid -f env INITIAL_TUNNEL_URL="$(cat /tmp/opencode/last-tunnel-url 2>/dev/null)" \
    /home/abhilash/flood/scripts/tunnel-relay.sh \
    > /tmp/opencode/tunnel-relay.out 2>&1 < /dev/null &
  echo "$(date -u) watchdog: relay was down, restarted" >> /tmp/opencode/tunnel-relay.log
fi