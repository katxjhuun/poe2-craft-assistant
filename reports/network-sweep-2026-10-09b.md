# Craft network: the fourth deep run (9 Oct 2026, evening)

Run [37957162421](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/37957162421), commit e934e3f (what the
third run found: Putrefaction's lists, one twin for two targets, a group mate across the sides): deep, 16 runners with
four processes each, 325 minutes, the drawn scenarios.

## What came back

54 of the 64 processes wrote a report; ten ended at their memory limit (3.5 GB). None ran past its job's time.

| | third run (709fcd0) | this run (e934e3f) |
|---|---|---|
| Scenarios | 713 | 696 |
| Checked against the simulator | 690 | 667 |
| Agree | 621 (90%) | 633 (95%) |
| Do not agree | 69 | 34 |
| of those: cost off by more than 15% | 16 | 5 |
| of those: steps the rules refuse | 22 | 0 |
| Outside the network | 23 | 29: already done 11, not solved within ten minutes 12, impossible 6 |
| Old routes clearly cheaper | 1 of 96 | 0 of 97 |
| Crafts played | 42.8 million | 39.6 million |

The 34 that do not agree: five with the cost far off (Permafrost Staff, four targets with another modifier fractured,
x0.57; Ruination Maul, four targets, x0.68 with a sixth of its crafts leaving the network; Aegis Quarterstaff, six
targets, x0.78; Dueling Wand, four and five targets, x0.84 and x0.89), and 29 whose cost is within 8% but where a few
crafts in 100,000 did not end or left the network.

Where the rules refused the route's step on the item in hand, the play took the next cheapest allowed step (a detour).
The reasons, over all scenarios:

- "The item already has a modifier of this type; the essence would fail" (a Greater essence on a Magic item whose one
  modifier is a low tier of the very modifier, which a node that does not follow that target's blockers cannot know):
  nearly all of them, about 195,000 uses in three scenarios.
- "The essence adds a prefix and the prefixes are full; the omen would remove a suffix" (Essence of Hysteria): 223.
- "Only one crafted modifier per item; this item already has one" (alloys, two Perfect essences): about 90.

## Causes found, and fixed in the commit that follows this report

- **Memory.** A network of 138,000 nodes has three and a half million edges and kept 1,528 MB (11.3 KB a node). Every
  edge held its own copy of its step ({op, tier, side, ...}), of which a network has a few hundred different ones;
  an edge that is the same at every node (a new base, an Orb of Extraction, a Putrefaction with its chance: 560,000 of
  them) was made again at every node; the tables the edges are built from stayed after the build; and the small network
  that decides about Omen of Whittling was kept while the large one was built. Steps and such edges are shared now,
  the tables are cleared before the solve, and a network is let go before the next is built: 1,116 MB for the same
  network (8.3 KB a node), peak 1.6 GB where it was 2.0 GB, and never two networks at once.
- **Crafts that never end** (most of the 29). A network that does not follow every target's blockers can bring the
  play to an item with a modifier in a target's way that its node does not know (a ring with "+# to all Attributes"
  of a tier under the wanted one). The route takes a bone, the Well cannot offer the target, Omen of Light takes the
  miss away, and so on for ever: 4 of 500 crafts on that ring. The page builds the route again from every pasted
  item and sees the modifier; the play keeps one network. It now gives an item up for a new base when a step that
  should have added a target with all but one chance in ten thousand has not, and counts it: 16 items in 3,000 crafts
  on the ring, every craft ends, 83,302 +- 1,366 played against 80,418 promised.
- The report says why a craft did not end or left the network (the last step and what the item looked like), and lists
  the items given up as futile.

## Still open

- Permafrost Staff and Ruination Maul with four targets, Aegis Quarterstaff with six, Dueling Wand with four and five:
  the play is cheaper than the promise by 11 to 43%. With the prices on this computer the Ruination Maul scenario
  agrees (10,431 promised, 11,199 +- 635 played): the run's own prices gave another route, so the next run's reasons
  are needed.
- The two rule mismatches behind the rarer detours (Essence of Hysteria aimed away from its full side; a crafted
  modifier the node does not count) are not found yet.
- Twelve scenarios were not solved within ten minutes.

## The next run

Started after this commit: see the run list of the repository (deep, 16 runners, 325 minutes, drawn scenarios).
