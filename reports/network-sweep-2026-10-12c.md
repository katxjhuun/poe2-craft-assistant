# Craft network: the eleventh deep run (12 Oct 2026)

Run [38244603317](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38244603317), commit 6952592 (a rule
set is solved part by part; a fractured modifier's group, the catalyst's boost, a twin's tags): deep, 16 runners with
four processes each, 325 minutes, the drawn scenarios.

## What came back

All 64 processes wrote a report, for the first time: none was cut at its job's limit, none ran out of memory.

| | tenth run (6eb30a6) | this run (6952592) |
|---|---|---|
| Processes that reported | 63 of 64 | 64 of 64 |
| Scenarios | 820 | 804 |
| Checked against the simulator | 766 | 780 |
| Agree | 733 (95.7%) | 741 (95.0%) |
| Do not agree | 33 | 39 |
| of those: cost off by more than 15% | 6 | 9 |
| Not solved within ten minutes | 30 | 3 |
| Old routes clearly cheaper | 0 of 88 | 0 of 89 |
| Crafts played | 46.5 million | 47.7 million |

The requests that were out of time before are solved now, and most of them are of the one kind the play cannot
follow well (four targets on an item that is never given up): 28 of the 39 are those, with the cost in line (x0.93 to
x1.12) and a few crafts in a hundred that did not end. The report names what was not solved: Seastorm Mantle as an
only item, Siege Crossbow and Maji Talisman with six targets. The slowest that were solved took 4 to 9 minutes on a
runner (100,000 to 220,000 nodes, five or six targets); the same requests take a fifth of that on the player's
computer.

## What did not agree, and why

- **Gloam Ring as an only item: x8.21, 205 of 100,000 crafts never ended.** Found, and it is a rule of the Flux the
  network did not know. A Flux turns every resistance of the other elements on the item, not the target's twin
  alone: a low Lightning Resistance nobody asked for became a low Cold Resistance beside the Cold Resistance the
  twin became. A Fracturing Orb two steps later picked that one; when the target was lost, a fractured modifier of
  its family stood in its way for good, and the route went on with Chaos Orbs for ever (use 343: Flux, use 345:
  Fracturing Orb, 200,000 uses without an end). The crafts that got out late are the x8. A node now says that a
  second modifier of a target's family may be on the item (a Flux sets it by the chance that a modifier nobody
  asked for was a resistance it turns; a pasted item says it itself); with it the Fracturing Orb is no edge, and
  the target lost leaves the second one in its way. Here: all 600 of 600 crafts end, 154,073 promised, 161,275 +-
  9,184 played.
- **Values not settled, the promise far from the play: Grasping Mail with six targets (31.7 million promised, 5.3
  played), Dusk Ring with six (2.8 million, 1.8 played), Aegis Quarterstaff as an only item (5.9 million, 2.8
  played).** Not found again here: the ring settles in 33 s at 778,882. Two things are done. A deadline that passes
  while the base limit is fitted, or while the route's numbers are made, is "out of time" now (the solves after it
  were cut short, and such a network was reported with what it had). And the run's price job prints its prices in
  its log, so that a scenario can be replayed with the promise the run made: the run's prices were two hours newer
  than the copy here, thin markets move by factors in that time, and with other prices the route is another one.
- **Fanatic Bow, Dueling Wand and Grasping Mail with five targets from a Magic item: x1.21 to x1.29**, with hundreds
  of detours and items given up. Five targets with Omen of Whittling are solved in the network with level classes,
  which follows no blocker. The same below.
- **Tenebrous Amulet with six targets, one fractured: x1.69**, as in the run before (x1.62) and not here (x1.06 over
  1,200 crafts at the prices of the morning). With the run's own prices in the log the next run can be replayed.
- **Golden Targe, Grand Cuisses, Grinning Mask as only items: x1.11 to x1.21**: the kind above.

## Tried: blockers in the network with level classes

Golden Targe as an only item, four targets (the page's network: three classes, no blocker followed, 39,872 nodes,
199,339 promised; the play ends 287 of 300 crafts at x0.97 with 2.5 million detours):

- one target's blockers followed: 63,896 nodes (1.6 times as many), 195,764 promised, four times the time to solve;
- two targets' blockers followed: more than 100,000 nodes, and the network finds no route that is sure to end (its
  answer: "every way to these targets can lose a modifier that must stay").

So the size estimate of 1.4 a followed target is too low for these networks, and with more of the blockers known
the network does not promise what the small one promises for an item that is never given up. Which of the two is
right is not known yet. Not changed; it needs its own look.

## Also in this change

- The play can keep the crafts that take very many uses, with the nodes they spent them at and what the Fracturing
  Orb and the Fluxes did to the item (`play(..., { keep: uses })`): this is how the ring's cause was found.

## Still open

- Level-class networks follow no blocker (above): five targets from a Magic item x1.2 to x1.3, four targets on an
  item that is never given up with a few crafts in a hundred unfinished.
- The scenarios whose values did not settle in the cloud: to be replayed with the next run's prices.
- The pasted item's own other modifiers are treated as unknown by the pools; six targets follow two targets'
  blockers; thin markets are taken at face value.

## The next run

Run [38288605560](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38288605560), started 12 Oct 2026
18:05 UTC on commit 1ec6c90 (these changes). Its price job prints the prices it uses.
