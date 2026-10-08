# Craft network: the deep cloud sweep of 7–8 October 2026

Run [37688143124](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/37688143124), started 7 Oct 21:15 UTC on
the code of commit 23216cc: 16 runners, four processes each, 330 minutes, every scenario played 100,000 times in the
simulator and compared with the cost the network promised.

## What came back

Fifteen of the sixteen jobs were stopped at their time limit before their reports were printed: a scenario that
started just before the end of a process ran up to 40 minutes more. One job finished (four processes); the result
files of the processes that ended in time are kept with the run for 30 days (`sweep-0` … `sweep-13`, about 135 KB in
all; not read for this report).

The finished job, 193 scenarios, 17.4 million crafts played:

| Process | Scenarios | Agree | Do not | Played / promised: median | 5% | 95% | All 100,000 played | Cut short at 40 min |
|---|---|---|---|---|---|---|---|---|
| 49 of 64 | 48 | 47 | 1 | 0.997 | 0.908 | 1.003 | 42 | 6 |
| 50 of 64 | 46 | 44 | 2 | 1.000 | 0.953 | 1.030 | 41 | 5 |
| 51 of 64 | 52 | 50 | 2 | 0.997 | 0.890 | 1.023 | 46 | 6 |
| 52 of 64 | 47 | 45 | 2 | 1.000 | 0.962 | 1.007 | 40 | 7 |

Classes in it: body armour, gloves, boots, helmets, jewels, bow, crossbow, spear, staff, warstaff, one hand mace.
Nothing was outside the network and no process had an error. The planner's old routes were simulated on 17 scenarios:
none was clearly cheaper than the network's route.

## The scenarios that did not agree

| Scenario | Promised | Played | Ratio | On the current code (commit 78b163b, short local play) |
|---|---|---|---|---|
| Permafrost Staff, five targets, Rare with some of them | 70,160 | 45,467 | 0.65 | 28,578 promised, 28,916 ± 1,615 played (1.01) |
| Permafrost Staff, one target: Chaos Damage T1 | 822 | 1,001 | 1.22 | 411 promised, 399 ± 10 played (0.97) |
| Thane Mail, four targets, white | 32,625 | 29,103 | 0.89 | 15,893 promised, 14,411 ± 652 played (0.91), 6 of 250 crafts not finished |
| Feathered Raiment, four targets, Magic | 158,793 | 155,203 | 0.98 | (counted as "do not" only for 4 unfinished crafts) |
| Polished Bracers, four targets, white | 206,932 | 206,334 | 1.00 | (42 unfinished crafts) |
| Austere Garb, five targets, Magic | 267,955 | 272,103 | 1.02 | (5 unfinished crafts) |
| Austere Garb, three targets, Rare | 69,845 | 70,042 | 1.00 | (32 unfinished crafts) |

- The two staff scenarios are the errors found the same night with the gap measure (`scripts/selftest/network_gap.js`):
  tags a modifier gives the item keep others from rolling, also across sides, and on wands and staves a modifier takes
  its sister families out of the pool with it. Fixed in commit fb0e965; both agree now, and the routes are much cheaper
  (the network no longer rolls for a modifier that cannot come).
- Thane Mail: the played average leaves out the crafts that did not finish within the step limit, and those are the
  dearest ones; with 2% of the crafts cut, an average 9% under the promise is what that alone gives. Not a model error
  as far as this run shows; the next run tells with all crafts counted.
- The last four are agreement: a scenario is marked "do not" when any craft is left unfinished.

## What changed for the next run

- A scenario in play near the end of a process is cut to what is left of the run, the job's limit leaves room for it,
  and a step that always runs prints the reports (commit 78b163b).
- The sweep can start after the single modifiers (`--drawn`, workflow input `scenarios: drawn`), so that the drawn
  sets and the special requests (target by value, another element on the item, rune pool, Serle's Triumph, five
  modifiers on a jewel, two crafted-only modifiers) are reached.
- Run [37721726052](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/37721726052), started 8 Oct 03:13
  UTC on commit 78b163b: deep, 16 runners, 325 minutes, `scenarios: drawn`.
