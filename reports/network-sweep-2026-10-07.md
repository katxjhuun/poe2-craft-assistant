# Craft network sweep in the cloud, 7 Oct 2026

Run: GitHub Actions, workflow "Craft network sweep", run 37682501370 (commit 3f76066), started by hand. One price job
and six check jobs of 17 minutes each: about 109 of the month's 2,000 free minutes. Nothing ran on the player's
computer.

## What was checked

`scripts/selftest/network_sweep.js`: one base per gear class and weight page (56 bases, 22 classes; no uniques), every
single modifier of each base first, then drawn sets of two to six targets, with start items that are white, Magic,
Rare with other modifiers, with targets already there, with a fractured modifier (a target or not), with an unwanted
Desecrated one, and with catalyst quality in each quality mode. For every scenario the network's promised cost is
compared with the simulator playing the network's rules.

## Result

| | Scenarios | Promise and play agree | Do not | Outside the network |
|---|---|---|---|---|
| Five broad jobs (up to 1,200 plays a scenario) | 2,291 | 2,225 | 39 | 27 |
| One job, every scenario played 100,000 times | 24 | 24 | 0 | 0 |

- Played cost over promised cost: median 0.99 in every broad job (5% of scenarios under 0.90, 5% over 1.05). In the
  100,000-play job: median 0.998, from 0.997 to 1.000.
- By class (scenarios / agree / do not / outside): Amulet 41/41/0/0, Belt 41/39/2/0, Body Armour 331/317/5/9, Boots
  292/279/8/5, Bow 42/42/0/0, Buckler 42/40/0/2, Crossbow 41/41/0/0, Focus 40/39/1/0, Gloves 288/282/5/1, Helmet
  291/287/1/3, Jewel 327/327/0/0, One Hand Mace 41/38/2/1, Quiver 41/38/1/2, Ring 41/41/0/0, Sceptre 40/36/0/4, Shield
  126/125/1/0, Spear 41/39/2/0, Staff 41/36/5/0, Talisman 41/41/0/0, Two Hand Mace 41/41/0/0, Wand 43/37/6/0, Warstaff
  43/43/0/0.
- The planner's old routes were simulated on 152 scenarios: clearly cheaper than the network's route on 2.

## What the sweep found

1. **Desecrated targets** are 27 of the 39 disagreements. The three options of the Well of Souls come from short lists
   (a lich's list has two to five modifiers on a side), and a modifier the item already has can take another option
   out of the list, which raises the target's chance: on one quiver the simulator revealed the target every time where
   the network said 52%. The network averages over modifiers it does not know; for the pasted item it should use the
   item's own modifiers. Open.
2. **Two steps the old routes have and the network lacks**: a Flux (Grasping Mail, Lightning Resistance: 153 against
   226 Exalted Orbs) and a Rune of Aldur that turns other elements' modifiers into the wanted one (Fortified Hammer,
   fire damage: 206 against 403). Open.
3. **Elemental spell prefixes on wands and staves** (6 + 5 disagreements, up to 29% off): a modifier of one element keeps
   the other elements' spell modifiers out (adds_tags); the network does not know that rule. Open.
4. **Too many item states** (26 scenarios, five and six targets): from the version of that commit, which tracked every
   modifier in a target's way. The next commit (05c4c01) tracks them only where they are known and is four times
   smaller; not run in the cloud yet.
5. One Focus scenario left the network (a played item that matched no node). Open.

## What 100,000 plays cost

24 scenarios in 17 minutes on one runner, all single modifiers from a white base (the cheapest kind to play). A set of
six targets takes thousands of uses a craft: 100,000 crafts of one such scenario are about an hour of one runner. Every
class with drawn sets at 100,000 plays is of the order of a thousand runner hours: far more than a private repository's
free minutes, and free only on a public repository.
