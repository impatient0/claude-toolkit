#!/usr/bin/env bash
# Send one command to the browser-driver REPL, wait for it to finish, print only its output.
#   send.sh '<driver command>' [timeout-seconds]   (default 20)
#   send.sh --wait-ready [timeout-seconds]          block until the driver shows its prompt
# The driver answers a tagged line with `<<done <id>>>` (see driver.mjs's runLine), so the cut
# is exact: no fixed sleep, and no earlier command's output re-read from scrollback.
# Env: DRIVER_SESSION / PATIENT_DRIVER_SESSION (tmux session, default browser-driver),
#      SEND_MAX_LINES (default 80; longer output is cut with a footer saying how much).
set -u
SESSION=${DRIVER_SESSION:-${PATIENT_DRIVER_SESSION:-browser-driver}}
MAX_LINES=${SEND_MAX_LINES:-80}

tmux has-session -t "$SESSION" 2>/dev/null || { echo "send.sh: no tmux session '$SESSION' (see SKILL.md, Run)" >&2; exit 2; }
pane() { tmux capture-pane -t "$SESSION" -p -J -S -; }

if [ "${1:-}" = --wait-ready ]; then
  deadline=$((SECONDS + ${2:-20}))
  until pane | grep -v '^$' | tail -1 | grep -q '^driver> *$'; do
    [ $SECONDS -ge $deadline ] && { echo "send.sh: driver not ready after ${2:-20}s; pane tail:" >&2; pane | grep -v '^$' | tail -8 >&2; exit 124; }
    sleep 0.1
  done
  exit 0
fi

[ $# -ge 1 ] || { echo "usage: send.sh '<driver command>' [timeout-seconds] | --wait-ready [timeout-seconds]" >&2; exit 2; }
cmd=$1
deadline=$((SECONDS + ${2:-20}))
id="$(date +%s)$RANDOM"

tmux send-keys -t "$SESSION" -l -- "#$id $cmd "
tmux send-keys -t "$SESSION" Enter

until pane | grep -q "^<<done $id>>"; do
  if [ $SECONDS -ge $deadline ]; then
    echo "TIMEOUT after ${2:-20}s waiting for: $cmd — it may still be running; its output will not be shown by the next call. Pane tail:"
    pane | grep -v '^$' | tail -15
    exit 124
  fi
  sleep 0.1
done

pane | awk -v id="$id" -v max="$MAX_LINES" '
  { line[NR] = $0 }
  END {
    for (i = NR; i >= 1; i--) if (line[i] == "<<done " id ">>") { done = i; break }
    for (i = done - 1; i >= 1; i--) if (line[i] ~ /^<<done /) { prev = i; break }
    for (i = done - 1; i > prev; i--) if (index(line[i], "#" id " ")) { last = i; break }
    for (i = prev + 1; i < done; i++) if (index(line[i], "#" id " ")) { first = i; break }
    if (!last) { first = prev + 1; last = prev }
    for (i = prev + 1; i < first; i++) if (line[i] ~ /^(browser|patient) driver — /) prev = i
    n = 0
    if (prev) for (i = prev + 1; i < first; i++) {
      s = line[i]; sub(/^driver> */, "", s)
      if (s != "") out[++n] = s
    }
    for (i = last + 1; i < done; i++) out[++n] = line[i]
    while (n > 0 && out[n] == "") n--
    s = 1
    while (s <= n && out[s] == "") s++
    shown = 0
    for (i = s; i <= n; i++) {
      if (shown == max) { printf "… (%d more lines cut; narrow it with a selector, or set SEND_MAX_LINES)\n", n - i + 1; break }
      print out[i]; shown++
    }
  }'
