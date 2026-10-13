# Craft network: the twelfth deep run (13 Oct 2026)

Run [38288605560](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38288605560), commit 1ec6c90 (a Flux
turns every resistance; the price job prints its prices): deep, 16 runners with four processes each, 325 minutes, the
drawn scenarios.

## What came back

All 64 processes wrote a report. None ran out of memory.

| | eleventh run (6952592) | this run (1ec6c90) |
|---|---|---|
| Scenarios | 804 | 802 |
| Checked against the simulator | 780 | 780 |
| Agree | 741 (95.0%) | 741 (95.0%) |
| Do not agree | 39 | 39 |
| of those: cost off by more than 15% | 9 | 7 |
| Not solved within ten minutes | 3 | 3 |
| Old routes clearly cheaper | 0 of 89 | 0 of 89 |
| Crafts played | 47.7 million | 48.1 million |

The Gloam Ring that never ended (x8.21) is in line. **The run's prices could be read back from its log** (672
prices), so for the first time every scenario below was replayed here with the promise the run made.

## What did not agree, and why

- **The measure itself: Fanatic Bow with five targets x1.26, Tenebrous Amulet with six x1.52, Siege Crossbow and
  Golden Targe as only items x1.26 and x1.15, Tenebrous Amulet as a bought start x1.17, Grasping Mail with five
  x1.20.** Since the ninth run the play ends a craft at an item its node does not know with what a route solved
  again from that item promises, as the page would. That route is the small network's (no blocker followed, no
  Omen of Whittling), an upper bound, and it was taken at the first such step, before any other step was tried.
  In these scenarios most crafts ended that way (5,454 of the bow's 6,272, 1,208 of the amulet's 2,224, 74,903 of
  the crossbow's 100,000), valued by a route without the omen their own route leans on. Replayed here without
  it, with the run's prices and the run's promise: the bow 200,941 promised, 200,412 +- 2,921 played over 2,500
  crafts (x1.00). The play now takes the next step first, as before the ninth run, and ends a craft by such a
  route only where its one network has come back to the same node six times, and only when that is less than
  giving the item up. The bow as the sweep runs it: x0.98, no craft valued, three items given up.
- **Permafrost Staff, "Critical Spell Damage Bonus" at 58 or more, from a white base: x1.20.** A real one, and it
  showed in no node's share of the gap, because the play's record kept every step's outcome except a locking
  step's. With that kept: Omen of Putrefaction finished 0.26% of its uses where 0.40% were promised. Its reveals
  fill the prefixes, then the suffixes, and what they left on the item was counted as modifiers nobody knows:
  three prefixes drawn by weight stop a fifth of a staff's suffixes with their tags (the highest option, which the
  player is told to take, stops none of them), and every desecrated-only suffix made the pool a sixth smaller.
  The target's share grew with each reveal: 0.39%, 0.46%, 0.54%, where the simulator has 0.30% three times.
  Desecrated-only modifiers are not counted as unknown ones now, and the base modifiers taken at the Well are
  taken by the rule (the highest of the options). Here: 2,068 promised, 2,067 +- 38 played; with the right chance
  the route no longer uses the omen there.
- **Tenebrous Amulet with six targets, one fractured: x1.22 here over 500 crafts (the run: x1.52 with the measure
  above).** One cause is fixed: the step "Essence of the Abyss, then a bone on its Mark" removes a modifier, and
  the side's class of levels was left as it stood (the modifier that goes may have been the lowest: the class
  rises, and the Omen of Whittling loops that follow cost more from there). The model had the lowest suffix under
  level 60 after that step every time, the play half of the time. With it: 1,510,530 promised, 1,751,639 +- 79,942
  played (x1.16). What is left is the same kind and open: after an Orb of Annulment the model lets the lowest
  class rise 21% of the time where the play has 51%. The classes of the modifiers that stay are drawn as if they
  had been rolled without a level floor, and this route rolls them with Greater and Perfect Exalted Orbs.
- **Grasping Mail with six targets, one fractured: 7.4 million promised, 2.9 million played, values not settled.**
  Not looked at yet; replayable now.

## Also in this change

- The play's record keeps what a locking step led to (finished or lost), and counts what the locked items were
  (finished, with the target's modifier under its tier or value, without it): `network_gap.js` prints it.

## Still open

- The class of levels after a removal (above): six targets with Omen of Whittling.
- Grasping Mail with six targets (values not settled in the cloud).
- Level-class networks follow no blocker; the pools treat the pasted item's own other modifiers as unknown; six
  targets follow two targets' blockers; thin markets are taken at face value.

## The next run

Started after these changes: see the run list of the repository (the thirteenth run).
