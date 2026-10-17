---
name: craft-network
description: Workflow, tools and rules for working on the PoE2 Craft Assistant's craft network (app/network.js) and its checks against the simulator — reading a finished cloud sweep ("deep run", "bulut taraması"), replaying a scenario whose promise and play disagree, finding where the network's chances or its reading of an item differ from the game rules, making the network faster or larger, then testing, committing and publishing. Use it whenever a task touches app/network.js, app/planner.js's simulator, scripts/selftest/network_*.js, a scenario id like "Warlord Cuirass|set4|white|7", promised-vs-played ratios, or the speed, memory or honesty of routes — and give it to every sub-worker that takes a part of that work.
---

# Craft network work

The craft network (`app/network.js`, `PoE2Network`) is a stochastic shortest-path model: every item state the request
can reach is a node, every currency use an edge with its chances, and the route is the solved policy. Its promise is
`net.cost(net.start)`. The simulator (`app/planner.js` `P.apply`, played by `scripts/selftest/network_check.js`
`play`) uses the game rules modifier by modifier. **A route is only worth showing when the simulator plays it at its
promise**: every finding below is a place where the two disagreed.

## Rules, and why they exist

- **Heavy simulation runs in the cloud** (GitHub Actions on the public repo: free). The player plays PoE2 on this PC.
  Before running anything local, check `tasklist | grep -i PathOfExile`: while it runs, one node process at a time;
  otherwise a few at most, and keep at least 4 GB of RAM free (a network of 150,000 nodes takes 1.5 to 3 GB).
- **Never start a cloud run while one runs.** The workflow's concurrency group cancels the running one, and hours of
  results are lost. Only the coordinating session starts runs; a sub-worker never does.
- **No paid services.** Downloading a run's artifacts needs the player's yes each time; job logs read with
  `gh run view <run> --job <id> --log` need none. No screenshots of the player's screen, no keys sent to the game.
- **Honest promises before cheap ones.** A network that does not follow the modifiers that keep a target out
  (`track` 0, the old levels networks) promised 40 to 75% too little on all-tier-1 requests (a staff: 43,615 promised,
  68,864 played; with every blocker followed 44,265 and 41,693). Never prefer such a route because its number is lower.
- **Game facts come from the game data** (the knowledge base, poe2db text). What the player says is checked against
  it; a conflict is said out loud, not silently followed.
- The old Cheap / Balanced / Premium plans and the simulated planner are gone for good: no fallback to them.

## Tools (`scripts/selftest/diag/`)

| Tool | Use |
|---|---|
| `bash fetch_run.sh <run> <dir>` | a finished run's 16 job logs and its prices (`<dir>/prices.json`) |
| `python read_run.py <dir> 70 330` | the run added up: agreement, disagreements by size, detours, errors |
| `node replay.js <base> <id> [crafts]` | a scenario's network: settled, residual, promise, played, the model by its own chances |
| `node transitions.js <base> <id> <crafts> [top]` | per node: where played items went vs the network's chances (largest gaps first) |
| `node step_probe.js <base> <id> <node> [n]` | one step from a real item at that node: which rolled modifier lands on which node |
| `node stuck.js <base> <id> [runs] [maxUses]` | crafts that never end on an item that is never given up: the item it is stuck with |
| `node sizes.js <base> <id> [crafts] [classes:track,...]` | the same request in networks of different size, with plays |
| `node play_sweep.js <crafts> <k> <regex> <bases...>` | the sweep's scenarios of some bases matching a pattern, run as the sweep runs them |
| `node run_one.js <base> <id> [crafts] [deep]` | one scenario exactly as the sweep runs it |
| `node --expose-gc mem.js <base> <id> [track]` | where a network's memory goes (edges, outcomes, heap per node) |

Environment: `POE2_PRICES=<file>` replays with a run's prices (the run promised with them); `NWFILE=<file>` runs another
`network.js` (the code before a change, for before/after); `POE2_OUT=<folder>` points at a price folder.

Kept for these tools in the main checkout (git-ignored): `.kb_cache/run-prices/runNN.json` (the prices of run NN) and
`.kb_cache/runs/runNN/` (its job logs).

## Workflow A: a finished cloud run

1. `bash scripts/selftest/diag/fetch_run.sh <run> .kb_cache/runs/runNN`, copy its `prices.json` to
   `.kb_cache/run-prices/runNN.json`, then `python scripts/selftest/diag/read_run.py .kb_cache/runs/runNN 70 330`.
2. Look first at the scenarios whose cost is off by more than 15%, then at crafts that left the network, refused steps
   and errors. A disagreement under that is usually noise of few crafts; check `se` before chasing it.
3. Each one goes through workflow B. Write `reports/network-sweep-<date>.md` (the table against the previous run,
   what disagreed and why, what changed, what is still open, the next run's link).

## Workflow B: a scenario whose promise and play disagree

1. `POE2_PRICES=... node replay.js <base> <id> 3000` reproduces it. If "the model by its own chances" equals the
   promise, the equations are fine and the chances or the reading of items differ from the rules.
2. `transitions.js` names the node and step where played items go elsewhere than the network says; `step_probe.js`
   at that node names the rolled modifier. Two kinds of cause were found so far:
   - the network's chances or its reading of an item are wrong (fix `network.js`: e.g. the reader `nodeOf` and a
     roll took one item for two nodes);
   - the play is wrong (fix `network_check.js` or `planner.js`: e.g. the Well of Souls picks read the item before an
     Omen of Putrefaction had taken its modifiers).
3. Fix, then replay again, then `play_sweep.js` on similar scenarios of several bases, so the fix holds beyond one item.
4. Add a test that fails on the code before the fix (`NWFILE` or a copy) and passes after.

## Workflow C: speed, memory, size

- Measure first (`mem.js`, `sizes.js`, the network's `timing`). A 210,636-node network is 1.82 GB of heap: 4.94 M edges
  and 34.9 M outcomes held as small JS objects and arrays.
- A change that should not change results must give the same `net.cost` on many scenarios to the last digits
  (compare old and new with `NWFILE`) and the same test results; only then measure the gain.
- Hinekora's Lock edges are rewritten while the network is solved (`acts[s][lockAt[s]] = e`): storage that is fixed
  after the build needs a place for them.

## Tests

`node --test --test-concurrency=1 app/tests/*.test.js` (all of them, about ten minutes; the directory form fails).
One test: `--test-name-pattern="<part of its name>"`. Tests that play crafts take time; keep new ones to rings and
other small networks where they can.

## Commit, publish (the coordinating session only)

- Commit messages: plain English, what was found and what changed, with the measured numbers; written to a file and
  committed with `git commit -F <file>`; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  Push: `git -c credential.helper= -c "credential.helper=!'C:/Program Files/GitHub CLI/gh.exe' auth git-credential" push -q origin main`.
- Page: `node app/build.js`, copy `app/dist/index.html` to `desktop/out/app/`, publish `app/dist/index.html` to the
  artifact https://claude.ai/artifact/7N2pMNG8ZhbqRjqy2mQmhH. Page text is English only.
- README: a bullet in Turkish under the run reports. Cloud run, at the full free limit (the player's wish):
  `gh workflow run network.yml -R katxjhuun/poe2-craft-assistant -f mode=deep -f minutes=315 -f jobs=19 -f scenarios=drawn -f from=<n>`
  (after checking that none runs). `from`: 0 when the network code changed since the last run (its results compare
  with the last run's); otherwise where the last run ended (its "rounds: N per base", added up), so it plays new
  scenarios instead of the same ones again. The cloud should not sit idle: when nothing changed, a run on new
  scenarios is still worth starting.
- "afk" from the player: the PC may be used too until they say "dur" (still at most 90% CPU, 4 GB RAM free).

## Sub-workers on a git worktree

A worktree has no `.kb_cache` and no `app/dist`. Set
`POE2_OUT=C:/Users/PC1/Desktop/poe2craftassist/.kb_cache/out` (and `POE2_PRICES=` a run's prices for replays) on
every node command; build the page in the worktree only if a test needs it. Commit on the worktree's branch; do not
push to main, publish, or start cloud runs. End with a short report: what changed and why, the numbers before and
after, which tests ran and their result, and what is left open.

## Code style

Match the surrounding code: comments are plain sentences that say why, with the measured case that led to the rule
("a staff with five slots ... 225,216 where its own five stats cost 41,219"); asides in parentheses. Patch scripts
that contain backslashes are written with the Write tool, not shell heredocs (heredocs ate them more than once).
