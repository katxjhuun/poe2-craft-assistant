#!/bin/sh
# Progress of a sweep as a text bar: one line at every 5% of the work or every 40 scenarios (whichever comes first),
# with the time left at the pace seen since this watch started, errors as they appear, and the end of the run with the
# last lines of its log.
#   sh scripts/selftest/watch.sh reports/sweep-progress.txt <file that gets "exit N" when the run ends> <log>
PROG="$1"; DONE="$2"; LOG="$3"
last=-1; lastd=-1000; lasterr=0; t0=$(date +%s); d0=""; p0=""
while true; do
  line=$(cat "$PROG" 2>/dev/null)
  pct=${line%% *}; rest=${line#* }
  p=${pct%%.*}; [ -z "$p" ] && p=0
  d=$(printf '%s' "$line" | grep -oE '[0-9]+/[0-9]+' | head -1 | cut -d/ -f1); [ -z "$d" ] && d=0
  all=$(printf '%s' "$line" | grep -oE '[0-9]+/[0-9]+' | head -1 | cut -d/ -f2); [ -z "$all" ] && all=1
  [ -z "$d0" ] && d0=$d
  step=$(( p / 5 ))
  if [ "$step" -ne "$last" ] || [ $((d - lastd)) -ge 40 ]; then
    el=$(( $(date +%s) - t0 ))
    if [ $((d - d0)) -ge 10 ] && [ "$el" -gt 120 ]; then
      eta=$(( (all - d) * el / (d - d0) / 60 ))
      left="about ${eta} min left at the pace of the last $((el / 60)) min"
    else
      left="pace not measured yet"
    fi
    bar=$(printf '%*s' "$step" '' | tr ' ' '#')$(printf '%*s' $((20 - step)) '' | tr ' ' '-')
    echo "sweep [$bar] $pct% of the work, $d/$all scenarios — $left; $(printf '%s' "$rest" | grep -oE '[0-9]+ errors')"
    last=$step; lastd=$d
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
