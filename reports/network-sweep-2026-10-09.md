# Craft network: the third deep run (9 Oct 2026)

Run [37851539057](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/37851539057), commit 709fcd0 (two
crafted slots, the steps that lock an item, Hinekora's Lock): deep, 16 runners with four processes each, 325 minutes,
the drawn scenarios, every scenario played up to 100,000 times.

## What came back

56 of the 64 processes wrote a report. Four ran out of memory (3.3 GB) and four did not end before their job's limit:
the same cause, see below.

| | |
|---|---|
| Scenarios | 713 |
| Checked against the simulator | 690 |
| Agree | 621 (90%) |
| Do not agree | 69 |
| Outside the network | 23: already done 9, not solved within ten minutes 9, impossible 5 |
| Crafts played | 42,823,136 |
| Old routes simulated | 96, one clearly cheaper (Time-Lost Diamond, set of two, from white: 4,635 against 6,741) |

Played cost over promised cost: the 69 that do not agree are 16 with the cost off by more than 15%, 22 with steps the
simulator's rules refuse (cost within 15%) and 31 where some crafts left the network or did not end (cost within 15%).

## Causes found, and fixed in the commit that follows this report

- **Omen of Putrefaction on long Well lists** (the eight processes that were lost). What the reveals of a Putrefaction
  take off the Well's lists was followed item by item across both sides. On a ring's seven entries that is nothing; on
  an amulet (11 and 20), a body armour (7 and 22) or a jewel (29) every different pair of misses was a state of its
  own. A network of 1,600 nodes took 19 seconds to build where it takes a fifth of a second without the omen; a large
  one filled the memory or never ended. The lists are followed only as far as the answer needs: an item that can no
  longer be finished is dropped, a finished one is not revealed further, a side's own list only while a target of that
  side is missing and another reveal follows, and of the first side only what it takes off the second side's list.
  The chances agree with the simulator as before (amulet, one Desecrated target: 33.2% against 33.1%; body armour,
  two: 10.8% against 11.3%), the amulet's network builds in 0.2 seconds.
- **One twin for two targets** (most of the 16 with the cost far off: Gladiatorial Helm x5.0, Golden Targe x2.7,
  Thane Mail x2.1, Grinning Mask x2.0, Grand Cuisses x1.8, Heavy Belt x1.7, Ancestral Tiara x1.6, Feathered Raiment
  x1.3, Grand Regalia x1.2: every one asks for Chaos Resistance and an elemental resistance). With Void Flux in the
  network a Cold Resistance of a high tier is the twin of the Chaos target and, by Blazing Flux, of the Fire target.
  It is one modifier: it was counted for both when it rolled, and after the first Flux the route still had the "second
  twin", which that Flux had turned as well. Now a modifier that is something for two targets has one status (the
  target it meets, else a twin, else in a target's way; of two alike the first target), and a Flux leaves the other
  target without its twin. Grand Cuisses, three targets: 1,239 promised and 2,611 played before, 2,173 against
  2,159 +- 99 after.
- **A group mate on the other side.** No group is twice on an item, whatever the side: a belt's Thorns prefix keeps the
  Desecrated suffix "Thorns Critical Hit Chance" out, and the route took bone after bone on such items. A modifier of
  the other side that is of a target's group is a state of that target now, like one that stops it with its tags.
  Runemastered Heavy Belt, two targets: 786 against 1,211 before, 835 against 835 +- 12 after.
- **A Rune of Aldur turns a crafted modifier too.** A staff's "Gain % of Damage as Extra Cold Damage", left by a tool
  essence, became Extra Fire Damage: the finished item was no node of the network (Aegis Quarterstaff, set of three:
  157 of 300 crafts "left the network" on their last step). The node no longer claims to know whose the crafted
  modifier is after the rune, and the play counts an item that has every target as finished whatever else is on it.
- **The solver could stay in a rule set that never finishes.** While the first rounds' values are far off, "lose the
  item nearly always, for a few Exalted Orbs" (a Putrefaction with a chance of 1e-15) can look better than every other
  edge. The steps that lock an item come in once the rule set without them has settled roughly, as Hinekora's Lock
  does. A bow's network of 64,000 nodes: not solved after 100 seconds before, 14 seconds after.
- **Steps the rules refuse where the node does not know the blocker.** In a network too large for every target's
  blockers to be followed, the route's step for a node can be one the rules refuse on the item in hand (a Greater
  Essence of Enhancement on a Magic item that has a low tier of that very modifier). A player sees the item: the play
  now takes the next cheapest step the rules allow and counts it as a detour, with the reason, and the report lists
  them. Refused steps that have no allowed alternative still fail a scenario.
- A craft of very many uses was played 2,000 times before the clock was read for the first time: the clock is read
  every 16 crafts from the 200th on.

## Still open

- The 22 scenarios with refused steps were not all replayed: the next run's report names the reasons.
- Dueling Wand with four and five targets plays 10 to 17% under its promise (the network is too careful there).
- Six targets: the networks follow the blockers of two targets at most, and several rows sit between 0.76 and 1.33.
- Time-Lost Diamond, set of two, from white: an old planner route is cheaper (slam only, Greater orbs).
- Putrefaction for base modifier targets with Abyssal Echoes is promised 3 to 5% too often; Hinekora's Lock where the
  blockers are not followed may be valued a little high.

## The next run

Started after this commit: see the run list of the repository (deep, 16 runners, 325 minutes, drawn scenarios).
