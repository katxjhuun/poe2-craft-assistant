# Craft network: the fifteenth deep run (13 Oct 2026, read 14 Oct)

Run [38431521706](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38431521706), commit 5ff3104 (one
of several stats for a slot; a fractured twin): deep, 16 runners with four processes each, 325 minutes, the drawn
scenarios. It is the first run with requests that take one of several stats for a slot ("or").

## What came back

All 64 processes wrote a report. None ran out of memory, no scenario ended in an error.

| | fourteenth run (e9656b4) | this run (5ff3104) |
|---|---|---|
| Scenarios | 783 | 897 |
| Checked against the simulator | 761 | 860 |
| Agree | 729 (95.8%) | 828 (96.3%) |
| Do not agree | 32 | 32 |
| of those: cost off by more than 15% | 0 | 3 |
| Not solved within ten minutes | 2 | 8 |
| Old routes clearly cheaper | 0 of 86 | 0 of 92 |
| Crafts played | 44.8 million | 54.9 million |

## What did not agree

- **Three scenarios with the cost off by more than 15%.**
  - Warlord Cuirass, four targets from a white base: 53,602 promised, 76,513 played (x1.43), 14,327 items given
    up on the way. A network that follows no modifier in a target's way (the one with level classes): the same
    thing the player's staff showed on 13 Oct 2026 (43,615 promised and 68,864 played with no blocker followed;
    44,265 and 41,693 with every blocker followed). Open.
  - Two requests with "or" stats: Drakeskin Boots x1.18 and Feathered Raiment x1.16 (a third, Secured Wraps, at
    x1.15). This run's code counted a slot's "or" stats as targets when it chose the network, and knew nothing of
    two stats of one modifier group. Both are changed in 139b9e4 (below); the next run plays them again.
- **Crafts that do not end on an item that is never given up**, four targets: the same list as before (Grand
  Cuisses 307, Massive Mitts 327, Thane Mail 89, Drakeskin Boots 70 of up to 100,000), costs in line (x0.98 to
  x1.05). Open.
- Grasping Mail with six targets, one fractured: the values did not settle and the promise is no number.

## Changed since this run's commit (139b9e4, the player's test of 13 Oct 2026)

- "Many targets" goes by the slots, not by the "or" stats; more than eight stats leave "or" stats out instead of
  having no route; up to five slots keep "or" stats only while the network follows every natural stat's blockers.
- Two stats of one modifier group are never on one item: two slots that nothing else fills are not possible, an
  "or" stat of another slot's group is left out.
- The page says what an Orb of Extraction is for, and that the materials are no order of steps.

## Still open

- Networks that follow no blocker promise too little on requests whose targets are all of a high tier (the
  cuirass above; the level-class networks; six targets follow two targets' blockers).
- "Or" stats on a five-slot request of tier-1 stats do not fit the followed network (230,000 states): they are
  left out, and the page says so.
- Crafts that do not end on four-target only items; thin markets are taken at face value; saved templates keep a
  slot's own stat only.

## The next run

Run [38486752609](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38486752609), started 13 Oct 2026
23:55 UTC on commit 139b9e4: the first with the changes above.
