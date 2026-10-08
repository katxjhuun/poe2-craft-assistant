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

## After this report was first written (the same day)

- Where the level classes do not fit into the network, the route is the one without Omen of Whittling (the talisman
  row above). The omen is in a route only when its levels are followed.
- A crafted modifier nobody asked for (the tool essence's own) and the Desecrated modifier of a miss take their own
  groups out of the pool, which is mostly nothing; they were counted as average modifiers. Fortified Hammer with two
  targets: 4,687 promised against 4,104 played before, 3,996 promised and 4,009 +- 29 played after (4,000 crafts).
- On a miss at the Well of Souls the play takes an option that is in no target's way, and the page says so.

- The page was measured with five T1 targets on boots and a limit of 100 bases: no answer after 160 seconds. The count
  of every currency now comes from one transposed solve in place of a solve per currency, the small network decides
  whether the omen is worth having before a large one is solved, and the base limit's search starts from the small
  network's charge: 37 seconds in the browser (48, 87 and 36 seconds for T1, T2 and T3 in a single process).
- Replayed after that: Cryptic Crown with six targets 177,272 promised, 178,519 +- 16,650 played (60 crafts); Fanatic
  Bow with five targets 0.95; Grand Regalia with five targets 0.98.
- `Time-Lost Diamond|set2|white|0` at today's prices: network 6,588 promised, 7,075 +- 448 played, old planner route
  6,139 over 300 trials (not clearly cheaper; the next run measures it with more plays).

## Found the same evening by replaying more six-target scenarios

- **The solver's values were not settled on crafts of very many turns.** A loop that crosses the solver's blocks (a
  target is lost and rolled again) settles by its chance per turn. With 600 passes a quiver's route of 25,000 white
  bases was valued at 508,446 while its own equations were a thousandth off; it plays at 646,000. After the passes
  the nodes a route reaches are now settled by accelerated sweeps (656,662). This under-valued the dearest routes and
  is the likeliest cause of the many six-target rows between 1.2 and 2.8 in this run.
- **Omen of Whittling only where it is certain.** Within a class the levels are not known, and a modifier that once
  survived the omen survives it again: the omen is an edge only where a side holds a modifier whose class lies under
  every level the targets on the item can have. Visceral Quiver with six targets: 377,975 promised against 3,017,716
  played before, 656,662 against 645,882 +- 62,154 after.
- **An exact crafted count.** With Astrid's Creativity a second crafted modifier nobody asked for was taken for a
  plain one, which left room for a third that the rules refuse (Sirenscale Gloves: 8 refused steps in 60 crafts, none
  now). Steps that would leave a second one are not offered; a route that needs both an aimed essence and an alloy
  as tools is dearer than it could be (a bow: 667 where 565 was possible).
- Maji Talisman with six targets: 392,753 promised, 342,941 +- 29,771 played (it was 702,606 against 1,729,744).

## Later that night: the limit lifted, the last currencies added

- **"A bow: 667 where 565 was possible" was wrong.** The 565 ex route left a third crafted modifier on the item: 22 of
  its steps in 300 crafts were refused by the rules. The node now holds two crafted modifiers nobody asked for, each
  with whose it is, and with both the cheapest legal route is 667 ex (played 624 +- 47, nothing refused).
- **Steps that finish an item or lose it** are edges, each checked by using the step on one item many times: Vaal Orb
  (1.43% on a full boot, the simulator counts 1.44%), Omen of Sanctification with a Divine Orb (a value two over the
  top of T1: 31.2% against 31.2%), Omen of Putrefaction with a bone (a bow, one Desecrated target: 45.1% against
  44.9%; with Abyssal Echoes 53.7% against 53.9%). For Desecrated targets alone Putrefaction is mostly the route: a bow
  with two costs 50 ex, played 50.4 +- 2.3.
- **Found on the way.** Several Desecrated targets of one side were taken for independent in a reveal (one draw of nine
  is either with two ninths, not 1 - (8/9)^2): low for every reveal. The runes of the pasted item (Astrid's Creativity,
  Serle's Triumph) were in every new base for nothing. A target by value was never taken at the Well in the play.
- **Hinekora's Lock** is an edge: the lock plus the expected best of what the currencies show. It is no edge while it
  costs more than giving the item up does, so at 517,000 ex the route of nearly every craft is the one without it; the
  667,000 ex quiver does not use it either. With the lock at 3 ex a boot's craft is promised 268.1 and plays at
  266.1 +- 5.6.
- Still a little off: Putrefaction for base-modifier targets with Abyssal Echoes (23.2% against 22.1%), and the lock
  where the blockers of the targets are not followed (the currencies' results share them).

## The next run

Run [37851539057](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/37851539057), started 8 Oct 22:08 UTC
on commit 709fcd0: deep, 16 runners, 325 minutes, the drawn scenarios. It replaced run 37825276057 (commit 9f48c52),
whose code it no longer checks; three runs started earlier the same day (37803372648, 37807771485 and 37815332074)
were each replaced the same way.
