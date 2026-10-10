# Craft network: the fifth deep run (10 Oct 2026)

Run [38000973652](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38000973652), commit d924317 (a quarter
less memory; the play gives up an item on which a step has become futile): deep, 16 runners with four processes each,
325 minutes, the drawn scenarios.

## What came back

63 of the 64 processes wrote a report. **None ran out of memory** (ten did in the run before); one did not end before
its job's limit.

| | fourth run (e934e3f) | this run (d924317) |
|---|---|---|
| Scenarios | 696 | 790 |
| Checked against the simulator | 667 | 768 |
| Agree | 633 (95%) | 715 (93%) |
| Do not agree | 34 | 53 |
| of those: cost off by more than 15% | 5 | 28 |
| Outside the network | 29 | 22: already done 11, impossible 7, not solved within ten minutes 4 |
| Old routes clearly cheaper | 0 of 97 | 2 of 108 |
| Crafts played | 39.6 million | 44.6 million |

## The play's new rule was wrong, and it made this run look worse than the network is

The commit before this run let the play give an item up "when a step that should have added a target with all but one
chance in ten thousand has not". It counted how often a node's step was **used** on an item, not how often it had
**failed**: a Flux that worked eight times on an item that kept losing and regaining its twin was "futile" at the
eighth use, and so was a bone at a node the item came back to after every success. 239 scenarios had items given up,
some of them thousands (Diamond with four targets: 135,925 items in its crafts), and an item given up is a valuable
item thrown away: of the 28 scenarios with the cost far off, 25 play dearer than promised and all of those gave items
up (Permafrost Staff x6.8 with 6,125, Visceral Quiver x3.4 with 2,603, Siege Crossbow x1.75 with 25,065). The crafts
that "did not end within 14,796 uses" on their last transmute or new base are the same thing: one base after another
thrown away.

The rule is replaced by one that asks the item, not a count:

- `net.hiddenBlocks(item, node)`: the targets that cannot come on this very item though its node has them as simply
  missing: a modifier nobody asked for that is of the target's family in another tier, of its group on either side, or
  that stops it with its tags.
- A step is taken in the route's place only when everything it could add is among those targets and it removes no
  modifier (an Exalted Orb for Life on an item with a Life prefix of too low a tier; a bone whose reveal can only bring
  a target that a modifier of its group keeps out). The play then takes the node's next cheapest step that can still
  do something, and counts a detour with the reason. At the sixth time at one node on one item it takes a new base.
- The ring that showed the problem (four targets, no blockers followed, the omen's levels): 80,418 promised,
  81,466 +- 1,235 played over 3,000 crafts, every craft ends, 2.6 detours a craft, one item given up.

## What this run did find

- **The cheaper orb tier is not always the lower one.** The network kept a higher orb tier only where its floor raises
  a target's share of the pool. On the run's market a Greater Orb of Transmutation costs less than a plain one, and on
  jewels (whose modifiers have one tier) the floor changes nothing: the network rolled with the dearer orb. The old
  planner's route was cheaper on Time-Lost Diamond with two targets (4,081 against 6,551, open since the second run)
  and on Sapphire with two (775 against 925). A tier is now left out only when another one costs no more and gives
  every target at least its share. With Greater Orbs of Transmutation at 0.37 the Diamond is promised 4,302 and plays
  at 4,434 +- 114.
- **An item whose node did not exist.** A Perfect essence for a target can give its other modifier; the edge knew that
  as "a crafted modifier nobody asked for", and the item's reader recognised it as the tool essence's own: no such
  node (Warlord Cuirass, four targets: 1,946 of 100,000 crafts; Siege Crossbow from white: 1,768). An item whose exact
  node is missing is now also looked up without whose its crafted modifiers are.
- **Detours where the rules refuse a step**: 512,000 uses in 25 scenarios, nearly all "The item already has a modifier
  of this type; the essence would fail" (a Greater essence on a Magic item that has a low tier of that very modifier,
  in a network that does not follow that target's blockers). 348 uses of Essence of Hysteria aimed away from its full
  side (fixed in bc61466, after this run started) and about 440 of "Only one crafted modifier per item".

## Still open

- "Only one crafted modifier per item; this item already has one": the node does not count a crafted modifier that is
  on the item. Not found yet; the suspicion is a crafted modifier that a Fracturing Orb locked.
- Dueling Wand with four targets from white and Freebooter Cap with four play 15 to 24% under their promise, with no
  detour and no item given up: the network is too careful there.
- Six targets: the blockers of two targets at most are followed.

## The next run

Started after this commit: see the run list of the repository (deep, 16 runners, 325 minutes, drawn scenarios).
