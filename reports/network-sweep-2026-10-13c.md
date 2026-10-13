# Craft network: the fourteenth deep run (13 Oct 2026)

Run [38383028909](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38383028909), commit e9656b4 (a
Fracturing Orb can lock a modifier that keeps a target out): deep, 16 runners with four processes each, 325 minutes,
the drawn scenarios. Replays below use the run's own prices, read from its log.

## What came back

63 of the 64 processes wrote a report (one was cut at its job's limit). None ran out of memory.

| | thirteenth run (b16123d) | this run (e9656b4) |
|---|---|---|
| Scenarios | 805 | 783 |
| Checked against the simulator | 786 | 761 |
| Agree | 733 (93.3%) | 729 (95.8%) |
| Do not agree | 53 | 32 |
| of those: cost off by more than 15% | 1 | **0** |
| Not solved within ten minutes | 1 | 2 |
| Old routes clearly cheaper | 0 of 89 | 0 of 86 |
| Crafts played | 46.4 million | 44.8 million |

For the first time no scenario's cost is off by more than 15%. The 32 that do not agree all have the cost in line
(x0.93 to x1.07); they are crafts that did not end or left the network.

## What did not agree, and why

- **Fortified Hammer and Aegis Quarterstaff as only items: 1,572 and 679 crafts left the network** ("Rare 3/3
  crafted 1 fractured astrid"). New with the run's change, and found: the Fracturing Orb had locked a target's
  twin (a Lightning Damage that a Rune of Aldur would turn into the wanted Cold Damage; a fractured modifier is not
  turned). When the Cold Damage itself rolled beside it, the network counted the twin as a plain modifier and the
  target as the fractured one; the item, whose fractured modifier is the twin, was no node. The twin is a fractured
  modifier nobody asked for now. The hammer here, with the run's prices: no craft leaves the network.
- **Crafts that do not end on an item that is never given up**: fewer than in the run before (Runemastered Heavy
  Belt 2,537 -> none listed, Dusk Ring 344 -> none listed), not gone: Grand Cuisses 283, Drakeskin Boots 147,
  Blacksteel Sabatons 120, Thane Mail 111 of up to 100,000. The same kind as before (the network with level
  classes follows no blocker); what is left is items stuck after a bone or a reveal, to be looked at with
  `stuck_item.js`.

## Also in this change: one of several stats for a slot

Asked by the player on 13 Oct 2026: an "or" box beside a target's stat list. Ticked, small stat lists open under
the row, with an Add button for more; any one of the slot's stats on the item fills the slot.

- In the network the stats of one slot are goals of one group. While one of them is on the item the others are not
  wanted (a status of its own); a second one that is on the item as well is one more modifier nobody asked for; a
  group asks for one slot. A stat of a group that cannot be had is left out while another of the slot can.
- A ring from a white base: Fire Resistance T1 and Mana T2 cost 208.5; Fire or Cold or Lightning Resistance with
  Mana 181.2 (played 179.9 +- 4.4); with Mana or Life as well 114.8 (played 113.4 +- 2.5).
- The sweep draws such a request every twelfth scenario of a base. Six of them here, as the sweep runs them: all
  agree (x0.97 to x1.05), every craft ends.

## Still open

- Crafts that do not end on four-target only items (above); Tenebrous Amulet with six targets x1.16 (the class of
  levels after an Orb of Annulment); level-class networks follow no blocker; the pools treat the pasted item's own
  other modifiers as unknown; six targets follow two targets' blockers; thin markets are taken at face value.
- Saved target templates keep a slot's own stat only, not its alternatives.

## The next run

Started after these changes: see the run list of the repository (the fifteenth run).
