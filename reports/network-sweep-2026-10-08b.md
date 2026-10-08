# Craft network: the second deep cloud sweep (8 October 2026) and what it led to

Run [37723531337](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/37723531337), started 8 Oct 03:36 UTC
on the code of commit d5c26c5: 16 runners, four processes each, 325 minutes, the drawn scenarios only (sets of two to
six targets on white, Magic and Rare items, and the special requests), every scenario played up to 100,000 times in
the simulator and compared with the cost the network promised.

## What came back

55 of the 64 processes printed their report. Seven jobs were stopped at the job's limit of 350 minutes: nine processes
had not ended by then, and a process wrote its results only at its end. (Since commit b63a4d3 every process writes
its results after every scenario, and a network that is not solved within ten minutes is given up as "out of time".)

| | |
|---|---|
| Scenarios | 701 |
| Checked against the simulator | 691 (10 had nothing to craft: 7 already done, 3 impossible) |
| Agree | 598 |
| Do not agree | 93 |
| Errors | 0 |
| Crafts played | 42.9 million (339 scenarios with all 100,000, 352 cut short at 40 minutes) |
| Played cost / promised cost, median per process | 1.002 in the middle (0.992 to 1.055) |
| Old planner routes simulated | 92; clearly cheaper than the network's route: 1 |

By class (scenarios, agree, do not agree): amulet 14, 9, 5 · belt 16, 16, 0 · body armour 94, 76, 17 · boots 97, 88, 8 ·
bow 10, 8, 2 · buckler 9, 9, 0 · crossbow 13, 8, 5 · focus 17, 17, 0 · gloves 80, 67, 11 · helmet 90, 80, 9 · jewel 97,
95, 2 · one hand mace 15, 12, 3 · quiver 16, 13, 3 · ring 9, 6, 3 · sceptre 13, 9, 4 · shield 44, 41, 1 · spear 15, 10, 4 ·
staff 10, 8, 0 · talisman 12, 7, 5 · two hand mace 8, 6, 2 · wand 13, 7, 6 · warstaff 9, 6, 3.

Of the disagreements that were listed, 54 had every craft finished, 49 had unfinished crafts (the step limit; their
average leaves the dearest crafts out), and 5 had crafts that left the network.

## The largest gaps, and where they came from

| Scenario | Promised | Played | Ratio | Cause | On the current code (short local play) |
|---|---|---|---|---|---|
| Grand Regalia, five targets, Magic | 53,447 | 388,238 | 7.26 | blockers, dominant group | 50,457 promised, 46,437 ± 3,943 played (0.92, 60 crafts) |
| Grand Regalia, three targets, Magic | 909 | 2,967 | 3.26 | the same | 2,241 promised, 2,251 ± 143 played (1.00) |
| Cryptic Crown, six targets, white | 326,089 | 902,492 | 2.77 | Omen of Whittling, lich omen on armour | 252,266 promised, 273,478 ± 18,650 played (1.08, 120 crafts) |
| Fanatic Bow, five targets, Magic | 417,974 | 1,119,456 | 2.68 | blockers | 183,697 promised, 174,017 ± 16,878 played (0.95, 60 crafts) |
| Maji Talisman, six targets, a target fractured | 702,606 | 1,729,744 | 2.46 | Omen of Whittling | 695,478 promised, 750,173 ± 69,176 played (1.08, 60 crafts), route without the omen |
| Grand Visage, four targets, white | 9,268 | 15,653 | 1.69 | blockers, dominant group | 1.05 (measured before the last changes) |
| Grand Cuisses, two targets, white | 651 | 781 | 1.20 | blockers | 955 promised, 987 ± 20 played (1.03, 2,500 crafts) |
| Dueling Wand, three targets, a target fractured | 12,670 | 16,629 | 1.31 | a target's own tags, twin of its group | 18,921 promised, 18,334 ± 824 played (0.97, 400 crafts) |
| Permafrost Staff, one target: Chaos Damage T1 | | | 0.95 | a twin of the target's group holds the group | 355.6 promised, 355.4 ± 7.9 played (1.00) |

What was wrong, each found with the gap measure (`scripts/selftest/network_gap.js`), which names the node and the
outcome that carry the difference:

1. **A modifier in a target's way was drawn anew at every roll.** A lower tier or a sister modifier of a target's group
   that rolls stays on the item and keeps the target out until it is removed. The network averaged over "is one
   there". Where one group is half of the pool (the local defences of the "Grand" bases) the promise was up to seven
   times too low. Now such a modifier is a state of its target (`net.track`), and so is a modifier of the other side
   that stops a target with its tags. The route can remove it on purpose: on Grand Regalia with three targets the
   played cost fell from 4,936 to 2,893.
2. **Omen of Whittling.** The levels of the modifiers nobody asked for were drawn from the whole pool at every use,
   and a target's level was the mean of its tiers. A modifier from a Perfect orb (level 50 or more) is rarely under a
   T1 target, so the omen took targets far more often than promised (8% promised, 37% played on the helmet). Now a
   target's level is one of its fitting tiers', and the lowest level of the other modifiers is a class of the node,
   per side. Where the classes do not fit into the network the omen is left out of the route.
3. **Steps the rules refuse.** The play did not ask the simulator's rules whether a step is allowed. It does now, and
   three kinds were found and mirrored in the network: lich omens on armour (the omens name weapon and jewellery
   desecration), a lich omen's bone on a side where that lich has nothing to offer, and an essence aimed away from
   its own full side. A refused step now counts as a disagreement in the sweep.
4. **Well of Souls.** A desecrated-only option of the target's own group ends the target's chance for that reveal (a
   wand's "#% increased Elemental Damage" and its Cold Damage); the network had it raise the chance instead (2.2%
   promised, 1.6% in the game data).
5. **Wands, staves, foci.** A target on the item that stops another target with its tags was read as "another modifier
   of the other side"; a twin of the target's own group (another element's damage prefix) holds that group.

## Crafts that left the network (five scenarios)

Drakeskin Boots and Corsair Coat with six targets, Time-Lost Ruby with the quality option, Emerald with a value
target, Aegis Quarterstaff with five targets. The first two and the jewel value target were replayed after commit
953d668 without a craft leaving (1.08, 1.03, 1.03); the other two are in the next run.

## One old route cheaper

`Time-Lost Diamond|set2|white|0`: network 4,843.6, old planner route 4,001.5 (`magicTier: greater, slamOnly`). Not
examined yet.

## New in the routes (from the crafters' videos the player supplied)

- A cheap Perfect essence aimed with an Omen of Crystallisation removes the unwanted Desecrated modifier, in place of
  Omen of Light with an Orb of Annulment (library claim k60). A bow that lacks only its Desecrated suffix: about 2,690
  Exalted Orbs before, 381 promised and 367 ± 24 played now.
- Essence of the Abyss, then a bone on its Mark (claim k59).

## The next run

Run [37803372648](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/37803372648) was started on commit
b63a4d3 and replaced by the run named in the next report: the fallback for requests where the level classes do not
fit (leave the omen out) came after it had started.
