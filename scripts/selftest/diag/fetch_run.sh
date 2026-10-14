#!/usr/bin/env bash
# Fetch a cloud sweep run's job logs (no download of artifacts: the logs are read with gh) and its prices.
# bash fetch_run.sh <run id> <folder>    then: python read_run.py <folder> 70 330
#                                              POE2_PRICES=<folder>/prices.json node replay.js ...
set -e
RUN="$1"; DIR="$2"; REPO=katxjhuun/poe2-craft-assistant
mkdir -p "$DIR"
for j in $(gh run view "$RUN" -R "$REPO" --json jobs --jq '.jobs[] | select(.name | startswith("deep")) | .databaseId'); do
  gh run view "$RUN" -R "$REPO" --job "$j" --log > "$DIR/job-$j.log" 2> "$DIR/err-$j.txt" || true
done
P=$(gh run view "$RUN" -R "$REPO" --json jobs --jq '.jobs[] | select(.name=="prices") | .databaseId')
gh run view "$RUN" -R "$REPO" --job "$P" --log > "$DIR/prices.log" 2>/dev/null || true
node "$(dirname "$0")/../prices_from_log.js" "$DIR/prices.log" "$DIR/prices.json"
ls "$DIR"/job-*.log | wc -l
