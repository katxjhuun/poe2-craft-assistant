# Craft network: the sixteenth deep run (14 Oct 2026)

Run [38486752609](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38486752609), commit 139b9e4 ("or"
stats and the network's size, two stats of one modifier group): deep, 16 runners with four processes each, 325
minutes, the drawn scenarios. Replays below use the run's own prices, read from its log.

## What came back

62 of the 64 processes wrote a report (two jobs were cut at GitHub's time limit). None ran out of memory, no
scenario ended in an error.

| | fifteenth run (5ff3104) | this run (139b9e4) |
|---|---|---|
| Scenarios | 897 | 888 |
| Checked against the simulator | 860 | 851 |
| Agree | 828 (96.3%) | 817 (96.0%) |
| Do not agree | 32 | 34 |
| of those: cost off by more than 15% | 3 | 2 |
| Not solved within ten minutes | 8 | 5 |
| Old routes clearly cheaper | 0 of 92 | 0 of 89 |
| Crafts played | 54.9 million | 56.6 million |

## What did not agree, and why

- **Drakeskin Boots, Evasion Rating or Movement Speed with Stun Threshold: 62.8 promised, 74.4 played (x1.18).**
  Not the network: the play. At the Well of Souls it took the targets off the item as it was before the step, and
  after an Omen of Putrefaction (which takes every modifier away) a slot that had been filled looked filled still,
  so its stats were never picked: from such items no craft was finished that way, where the network counts 12.3%.
  The play reads the item at each reveal now (and a plain bone hands it over too). Replayed: 63 promised, 62 played.
- **Feathered Raiment, Cold Resistance or Chaos Resistance or Intelligence: 357.3 promised, 413.5 played
  (x1.16).** The network: a roll and the reader of an item took the same item for two nodes. With Intelligence in
  the slot, a Cold Resistance that rolled was "nobody's", while the reader made it the slot's stat and the
  Intelligence nobody's; a Fire Resistance beside the filled slot was the Lightning Resistance target's twin for a
  roll and the twin of the slot's Chaos Resistance (so nobody's) for the reader. Now a stat of a filled slot that
  rolls is that stat and canon keeps the first of the slot's list, as the reader does, and the reader takes nothing
  as near, a twin or in the way of a filled slot's other stats. Replayed: 358 promised, 359 played. Every "or"
  request of nine bases (27): x0.93 to x1.06, every craft ends.

## Also: the networks with level classes follow the blockers (the fifteenth run's Warlord Cuirass)

A request of four targets or more first solves a small network with no blocker followed; when it shows that Omen
of Whittling is worth having, a network with level classes is solved. That network took the small one's number of
followed targets, none, also where all of them fit, and its size estimate was more than twice too large. The
cuirass (four targets from a white base, the fifteenth run's x1.43):

| level classes network | nodes | promised | played (800 to 1,000 crafts) |
|---|---|---|---|
| no blocker followed (before) | 25,002 | 53,602 | 77,645 +- 2,170 (x1.45) |
| two followed | 54,880 | 53,324 | 73,846 +- 2,046 (x1.39) |
| all four followed (now) | 116,694 | 53,321 | 55,410 +- 1,160 (x1.04) |

Up to five targets a levels network must now follow every target's blockers, like the full network; where none
fits, the full network without the omen is the route. The estimate is 1.5 a followed target and 2.5 (three
classes) or 1.6 (two), the limit 150,000 states, three tries at most.

## Still open

- A full network that does not fit with the blockers followed falls to one that follows none (a five-target staff
  of this kind played at x1.13 locally): the network needs less memory per state. The same limit leaves "or"
  stats out of five-slot requests of tier-1 stats.
- Crafts that do not end on four-target only items (Massive Mitts 1,242, Grand Cuisses 627 of up to 100,000; the
  costs in line); thin markets are taken at face value; saved templates keep a slot's own stat only.

## The next run

Started 14 Oct 2026 on the commit with these changes (see the README for its link).
