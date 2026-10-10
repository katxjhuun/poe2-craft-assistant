# Craft network: the sixth deep run (10 Oct 2026, evening)

Run [38051531890](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38051531890), commit 0ac7075 (the
cheaper orb tier; the play asks the item instead of counting uses): deep, 16 runners with four processes each, 325
minutes, the drawn scenarios.

## What came back

All 64 processes wrote a report, none ran out of memory, and for the first time every job ended without an error.

| | fifth run (d924317) | this run (0ac7075) |
|---|---|---|
| Scenarios | 790 | 805 |
| Checked against the simulator | 768 | 778 |
| Agree | 715 (93%) | 751 (96.5%) |
| Do not agree | 53 | 27 |
| of those: cost off by more than 15% | 28 | 4 |
| Outside the network | 22 | 27: already done 14, impossible 6, not solved within ten minutes 7 |
| Old routes clearly cheaper | 2 of 108 | 0 of 111 |
| Crafts played | 44.6 million | 44.7 million |

The play's rule of the fifth run (an item given up after a step had been *used* often) is gone, and with it the
scenarios that played at two to seven times their promise. No old route is cheaper any more: the jewels that were
(Time-Lost Diamond, Sapphire) roll with the cheaper orb tier now.

## What does not agree, and why

- **Crafts that left the network after an alloy with Astrid's Creativity** (21 of the 27 scenarios, mostly a
  handful of crafts each; Siege Crossbow from white: 2,220 of 100,000; Aegis Quarterstaff: 370; Ancestral Tiara: 101).
  The costs agree (x0.94 to x1.08). Two crafted modifiers nobody asked for have one order in a node; the item's
  reader names them in the item's order, and the lookup did not put them in the node's order. Found by replaying
  the crossbow here (21 of 300 crafts). Fixed: the lookup orders them, and where the node differs only in whose the
  crafted modifiers are, that node is taken.
- **Permafrost Staff, four targets, another modifier fractured: played at x1.93** (26,508 promised; 376,761 detours,
  527 items given up). On a staff the Fire Damage prefix and the Freeze Buildup suffix keep each other out with
  their tags; the way to both is a Cold Damage prefix (the Fire target's twin, turned by a Rune of Aldur later) with
  Freeze Buildup beside it. Three things were wrong, each found by replaying the scenario here (22,050 promised,
  41,131 +- 2,608 played): a rolled modifier that is in one target's way and keeps a target of the other side out
  arrived with the first effect only; a twin of another element kept the other target out "on average" (a Lightning
  Damage twin does for good, a Cold Damage twin does not); and an item with a modifier in the way of a target the
  network does not follow fell back to the node that knows no blocker at all. Fixed in b16f324; the fully followed
  network of that request needs 175,000 states (the limit is 200,000 now). With it: 22,604 promised, 20,652 +- 846
  played over 200 crafts, no detour, no item given up.
- **Too careful**: Aegis Quarterstaff with six targets from white x0.76, Freebooter Cap with four x0.79, Dueling Wand
  with five x0.83 (the last with 149,757 detours: the play found something cheaper than the route's step on items
  whose blockers the node does not follow).
- Maji Talisman: 2 of 100,000 crafts did not end within 7,127 uses. Grasping Mail with six targets: values not
  settled, x0.99.
- Detours (the route's step is one the rules refuse on the item in hand, or one that can do nothing there): 4.26
  million uses in 143 scenarios, nearly all a Greater essence on an item that already has that modifier in a low tier
  (565,005 Greater Essence of the Infinite, 332,857 of Insulation, 261,651 of Enhancement), or an Exalted or Regal
  Orb for a target that a modifier on the item keeps out. Both come from blockers that a large network does not
  follow; the page builds the route again from the item after every step and does not have them.

## What was found outside the run, the same day

- **A side that holds four or five modifiers.** The bases whose implicit changes the slot counts (Absent Amulet 2 + 2,
  Dusk and Gloam 4 + 2, Penumbra and Tenebrous 5 + 1, thirteen bases) had never been in a sweep: the sweep's items
  were written without implicit lines, so those bases were played as 3 + 3. Played as they are, Tenebrous Amulet came
  out at x1.91 and x1.37. A node's key had room for three modifiers nobody asked for on a side; on a side of four or
  five, the item with four of them was the node of another item, and the route's step there was one the rules refuse.
  The same held for four suffixes with Serle's Triumph. Fixed (the key holds as many as the side can); Tenebrous
  Amulet with five targets: 135,323 promised, 142,498 +- 10,316 played. The sweep writes the implicit lines now and
  plays those thirteen bases.
- **An item no white base can replace** (a Genesis Tree modifier fractured on a bought ring): the request was called
  impossible. See README, "Eşyadan vazgeçmek ne demek".
- **The reader**, checked over every base and modifier: three errors, fixed (see the commit of the same day).

## Still open

- Six targets: the blockers of two targets at most are followed; with five targets on a wand the play still finds
  cheaper steps than the route on some items.
- Freebooter Cap with four targets and a fractured modifier that is no target: x0.79, no detour: the promise is too
  high.

## The next run

Run [38076204253](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38076204253), started 10 Oct 2026
18:32 UTC on b16f324, with the thirteen slot bases, bought starts and only-items among the scenarios.
