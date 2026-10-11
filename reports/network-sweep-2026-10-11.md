# Craft network: the seventh deep run (11 Oct 2026)

Run [38076204253](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38076204253), commit b16f324 (one
modifier, two effects; the state limit of the fully followed network at 200,000): deep, 16 runners with four processes
each, 325 minutes, the drawn scenarios, for the first time with the thirteen bases whose implicit changes the slot
counts, with bought starts and with items that are never given up.

## What came back

All 64 processes wrote a report, none ran out of memory, no job failed.

| | sixth run (0ac7075) | this run (b16f324) |
|---|---|---|
| Scenarios | 805 | 795 |
| Checked against the simulator | 778 | 752 |
| Agree | 751 (96.5%) | 721 (95.9%) |
| Do not agree | 27 | 31 |
| of those: cost off by more than 15% | 4 | 20 |
| Outside the network | 27 | 43: impossible 7, already done 13, not solved within ten minutes 23 |
| Old routes clearly cheaper | 0 of 111 | 0 of 88 |
| Crafts played | 44.7 million | 43.7 million |

The run is worse on paper than the sixth because it asked harder things: 16 of the 20 far-off scenarios are of the
new kind "only item" (the item is never given up), and one is a mistake that the commit before the run brought in.

## What does not agree, and why

- **An item that is never given up: the reported cost was too low** (Seastorm Mantle x10.7, Austere Garb x4.4, Gloam
  Ring x1.83, a dozen more between x1.13 and x1.37). The rule set and its values were right; the money a route is
  reported with is solved apart, and that solve started from nothing with the usual 200 passes. A route that never
  gives the item up repairs it in loops that cross the solver's blocks, and those settle slowly. Replayed here on a
  jewel (Time-Lost Sapphire, 1,622 nodes): 65,346 reported, 87,279 +- 1,262 when the model is played by its own
  chances, 82,488 +- 3,024 in the simulator. Fixed: the reported money starts from the rule set's own values, takes
  the passes it needs (ten seconds at most past the usual ones) and is checked against its own equations;
  `net.settled` covers it, the answer carries `settled`, and the page says when a route's numbers are rough. The
  jewel: 87,464 reported. The play no longer gives such an item up (it has no other one).
  Not solved: on a large request of that kind (a body armour with four targets and other modifiers: 26,811 nodes) the
  rule set's own values do not settle either; the route is the best found, its numbers are flagged as rough, and the
  solve takes over a minute. An aggregation step for the solver was tried and taken out again: it made the sweeps
  diverge.
- **Dueling Wand, three targets, from a Magic item: 287,117 promised, and no craft of forty ended.** Fire Damage
  (prefix) and a Chaos spell level (suffix) keep each other out by their tags. The commit before the run made "which
  twin is on the item" a state, but recorded what a twin keeps out only for targets that were not there at that
  moment: a target that was blocked by something else at the time looked free once that something was gone. Fixed:
  a node keeps, per target, whether a modifier of the other side that is itself a status there keeps it out (`xg`,
  a bit per target). With that the old path is gone and the request was "impossible", which it is not: Passion of
  Aldur, the first rune that serves a target, leads nowhere, but Betrayal of Aldur turns a Fire spell level into the
  Chaos one next to a fractured Fire Damage. The network now asks again without a rune that led nowhere, and a
  fractured target is not counted as harmed by a rune. The wand: 110,981 promised, 110,953 +- 6,930 played over 150
  crafts, every craft ends.
- **Permafrost Staff** (the sixth run's x1.93) was not among this run's far-off scenarios. With the new bookkeeping its
  fully followed network needs 207,000 states: the limit is 230,000 now. Here: 23,551 promised, 23,225 +- 1,237
  played, no detour.
- **Tenebrous Amulet with six targets x2.13, Grasping Mail with five x1.51**: no blocker followed (the route uses
  Omen of Whittling, and the network with level classes has no room for followed blockers at five and six targets),
  208 crafts each. Open.
- **Too careful**: Aegis Quarterstaff with six targets from white x0.72, Dueling Wand with three and a fractured
  target x0.81, with five x0.85. Open.
- Golden Targe as a bought start x1.16, Lament Amulet with five targets x1.16: not looked at yet.
- 45 uses of a bone that the rules refuse on a wand ("The Well of Souls would have no modifier to offer in the place
  of the Mark"): not looked at yet.
- **Not solved within ten minutes: 23 scenarios** (7 before). The larger networks of this commit take longer on the
  cloud's machines. Open; the limit of the fully followed network went up again after this run.

## The next run

Run [38106479469](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38106479469), started 11 Oct 2026
02:51 UTC on a0722c7.
