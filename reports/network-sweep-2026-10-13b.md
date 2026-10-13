# Craft network: the thirteenth deep run (13 Oct 2026)

Run [38330594005](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38330594005), commit b16123d (the
play takes the next step first; Omen of Putrefaction's reveals; the Mark step's level class): deep, 16 runners with
four processes each, 325 minutes, the drawn scenarios. Replays below use the run's own prices, read from its log.

## What came back

All 64 processes wrote a report. None ran out of memory.

| | twelfth run (1ec6c90) | this run (b16123d) |
|---|---|---|
| Scenarios | 802 | 805 |
| Checked against the simulator | 780 | 786 |
| Agree | 741 (95.0%) | 733 (93.3%) |
| Do not agree | 39 | 53 |
| of those: cost off by more than 15% | 7 | **1** |
| Not solved within ten minutes | 3 | 1 |
| Scenarios with crafts valued by a route solved again | 106 | 18 |
| Old routes clearly cheaper | 0 of 89 | 0 of 89 |
| Crafts played | 48.1 million | 46.4 million |

With the play that takes the next step first, the cost agrees everywhere but in one scenario: the x1.2 to x1.5 of
the runs before were the measure. What the measure had hidden is the other number: 52 scenarios whose cost is in
line (x0.88 to x1.13) and where crafts did not end, nearly all of them four targets on an item that is never given
up, up to 2,537 of 100,000 crafts.

## What did not agree, and why

- **Crafts that never end on an item that is never given up.** Found. The items they are stuck with carry a
  fractured modifier that keeps a target out: a ring that wants "Adds # to # Cold damage to Attacks" at tier 3 had
  that modifier fractured at tier 5. Where the network does not follow a target's blockers, a modifier nobody
  asked for may be a lower tier of the target, one of its group, or one whose tags stop it; the Fracturing Orb's
  edge took it for any other modifier. A route solved from such an item says what is true: no way. (The same
  thing as the eleventh run's Flux, in general.) The orb's edge now counts the share of its uses that locks such a
  modifier as the item lost (a new base where there is one), and is no edge at all on an item that is never
  given up while a modifier may be in a target's way. As the sweep runs them, with the run's prices:

  | | in the run | now |
  |---|---|---|
  | Dusk Ring, only item | 344 crafts did not end | 3,000 of 3,000 end; 114,058 promised, 111,363 +- 2,231 played |
  | Runemastered Heavy Belt, only item | 2,537 did not end | 1,500 of 1,500 end; 95,731 promised, 97,238 +- 1,640 |
  | Golden Targe, only item | 72 did not end (x1.15 to x1.30 in the runs before) | 1,500 of 1,500 end; 167,424 promised, 163,659 +- 3,207 |
  | Fanatic Bow, five targets from a Magic item | x1.26 by the old measure | 185,270 promised, 186,457 +- 3,363 |

  The ring's steps that the route could not use on the item in hand went from 573,933 to 701 in 3,000 crafts: most
  of them were the loops around such a fractured modifier.
- **Grasping Mail with six targets, one fractured: 4.1 billion promised, values not settled.** The same here with
  the run's prices. A craft of that size is none: the chance that a white base gets there is one in a billion, and
  a value that is a cost divided by such a chance is not known to the digits it needs. The sweep classes a cost of
  a hundred million Exalted Orbs and more as out of reach.
- The play values a stuck item of a kind it has no route left to solve for (36 a scenario) as the kinds with as
  many targets on the item were valued on average.

## Still open

- Tenebrous Amulet with six targets: x1.16 here (the class of levels after an Orb of Annulment, see the report of
  the twelfth run).
- Level-class networks follow no blocker; the pools treat the pasted item's own other modifiers as unknown; six
  targets follow two targets' blockers; thin markets are taken at face value.

## The next run

Started after these changes: see the run list of the repository (the fourteenth run).
