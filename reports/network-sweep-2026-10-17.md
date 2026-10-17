# Craft network: the seventeenth deep run (read 17 Oct 2026)

Run [38581433087](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38581433087), commit 82a3425 (one
reading of a slot's stats, the play reads the item at each reveal, levels networks follow the blockers): deep, 16
runners with four processes each, 325 minutes, the drawn scenarios. Replays below use the run's own prices.

## What came back

All 64 processes wrote a report; no job was cut at the time limit, none ran out of memory, no scenario ended in an
error.

| | sixteenth run (139b9e4) | this run (82a3425) |
|---|---|---|
| Scenarios | 888 | 897 |
| Checked against the simulator | 851 | 848 |
| Agree | 817 (96.0%) | 821 (96.8%) |
| Do not agree | 34 | 27 |
| of those: cost off by more than 15% | 2 | 4 |
| Not solved within ten minutes | 5 | 16 |
| Old routes clearly cheaper | 0 of 89 | 0 of 94 |
| Crafts played | 56.6 million | 55.1 million |

The two "or" requests of the run before (x1.18, x1.16) agree now.

## What did not agree, and why

- **Gloam Ring, four targets on a bought ring with a fractured modifier of another element: 66,858 promised,
  78,584 played (x1.18).** The reader of an item took the fractured Lightning Resistance for the Fire Resistance
  target's twin, as if a Flux could turn it; a Flux and a Rune of Aldur leave fractured modifiers as they are, and a
  roll had made it a fractured modifier nobody asked for. One item, two nodes. Now a fractured modifier is never a
  twin (the reader, and the Fracturing Orb's edge when it locks a twin). Replayed: 68,642 promised, 68,200 played
  (x0.99), no detour (222 before).
- **Three that promise too much**: Seastorm Mantle, an item never given up, x0.64 (its values did not settle in the
  time a route may take: the number is rough); Aegis Quarterstaff, six targets from a white base, x0.77; Grasping
  Mail, six targets on a rare, x0.84. A promise over the play is the safe side, but it can steer to a dearer start.
  Open (six targets follow two targets' blockers).
- **Not solved within ten minutes: 16 (5 before).** The levels networks of 82a3425 follow every target's blockers; on
  items that are never given up their values settle slowly where nothing restarts: a Grasping Mail took 434 s
  (134,382 nodes) where it took 44 s (47,012 nodes). There the network that follows no blocker had played at its
  promise (the sixteenth run's only-item scenarios: x0.97 to x1.03), so such items keep it; the Warlord Cuirass of
  the fifteenth run (a new base each time) keeps the followed one. Grasping Mail now 35 s.
- **Steps the game refuses**: the play took another step 552,864 times where the route asked for "Greater Essence of
  Abrasion" on an item that already has a modifier of its type (and 604,593 times for Greater Essence of the
  Infinite, 41,515 for Insulation). The costs agreed, but the route named a step the game refuses: given to the
  sub-worker that hunts such gaps.

## Also since this run

- The sweep uses 19 runners (the player asked for the free limit to be used to the full) and 315 minutes, and can
  start where the last run ended (`from`), so a run on unchanged code plays new scenarios.
- The craft-network work is done with a project skill (`.claude/skills/craft-network/`) and sub-workers on git
  worktrees: network memory, crafts that never end, network-vs-simulator gaps.

## The next run

Run [38997650636](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38997650636), started 17 Oct 2026
03:08 UTC on commit a490d4e (19 runners, from round 13: new scenarios on the code of this run; the fixes above come
after it).
