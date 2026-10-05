#!/bin/sh
# Progress of a sweep as a text bar: one line at every 5% step (with the time left), errors as they appear, and the
# end of the run with the last lines of its log.
#   sh scripts/selftest/watch.sh reports/sweep-progress.txt <file that gets "exit N" when the run ends> <log>
PROG="$1"; DONE="$2"; LOG="$3"
last=-1; lasterr=0
while true; do
  line=$(cat "$PROG" 2>/dev/null)
  pct=${line%% *}; rest=${line#* }
  p=${pct%%.*}; [ -z "$p" ] && p=0
  step=$(( p / 5 ))
  if [ "$step" -ne "$last" ]; then
    bar=$(printf '%*s' "$step" '' | tr ' ' '#')$(printf '%*s' $((20 - step)) '' | tr ' ' '-')
    echo "sweep [$bar] $pct% — $rest"
    last=$step
  fi
  err=$(printf '%s' "$rest" | grep -oE '[0-9]+ errors' | grep -oE '[0-9]+')
  if [ -n "$err" ] && [ "$err" -gt "$lasterr" ]; then
    echo "sweep: $err scenario errors so far (see the log)"
    lasterr=$err
  fi
  if grep -qE '^exit [0-9]+' "$DONE" 2>/dev/null; then
    echo "sweep ended: $(grep -oE '^exit [0-9]+' "$DONE" | tail -1)"
    tail -n 30 "$LOG" 2>/dev/null
    exit 0
  fi
  sleep 30
done
