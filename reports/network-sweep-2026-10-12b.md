# Craft network: the tenth deep run (12 Oct 2026)

Run [38181538856](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38181538856), commit 6eb30a6 (the Flux
of an earlier target, a class that could not rise, the own-modifiers flag; the play values an item its node does not
know with the small network): deep, 16 runners with four processes each, 325 minutes, the drawn scenarios.

## What came back

63 of the 64 processes wrote a report; one did not end before its job's limit. None ran out of memory.

| | ninth run (70b0ea9) | this run (6eb30a6) |
|---|---|---|
| Scenarios | 795 | 820 |
| Checked against the simulator | 740 | 766 |
| Agree | 703 (95.0%) | 733 (95.7%) |
| Do not agree | 37 | 33 |
| of those: cost off by more than 15% | 6 | 6 |
| Outside the network | 55 | 54: impossible 10, already done 14, not solved within ten minutes 30 |
| Old routes clearly cheaper | 0 of 86 | 0 of 88 |
| Crafts played | 43.5 million | 46.5 million |

27 of the 33 are again items that are never given up whose cost agrees (x0.97 to x1.03) and where a few crafts did not
end. The play now values an item its node does not know by the route solved again from it, as the page would (2 to 3
scenarios a process, up to 36 routes each), and the crafts that did not end are fewer, not gone: past the 36 routes
the play goes on with the one network it has.

## The prices are the day's

The cloud fetches the prices of the day; the copy on this computer was of 27 Sept. In two weeks a Divine Orb went
from 492 to 761 Exalted Orbs and the omens doubled (Omen of Whittling 5,101 -> 10,060, Hinekora's Lock 517,000 ->
1,263,000), so a scenario replayed here had another promise than the run's and sometimes another route. The local
prices are refreshed now (`python scripts/fetch_prices.py`), and two tests that leaned on the old ones are fixed (a
play of 400 crafts where one craft costs as much again as the average).

Seen on the way: essences that hardly trade are quoted at one Divine Orb (Essence of the Mind 761 ex at 6 units a
day, Essence of Ice 761 ex at 18). The page marks such markets as thin; the routes take the number as it is.

## What did not agree, and why

- **Gloam Ring as an only item: x2.19, values not settled.** Not the values: the rule set itself never settled. A
  round of the search valued it with a few passes over the blocks; an item that is never given up is repaired in
  loops that cross the blocks, which a few passes do not value, and the rule set went round in circles for all 400
  rounds (300 of 11,000 nodes changing their edge every round). Under one rule set every node has one edge, and the
  network falls into strongly connected parts that are small (the largest of 73,000 nodes on boots: 412). The
  solver now solves a rule set part by part, each part exactly, after the parts it leads to: nothing is iterated,
  so a round is a true step of the search. Where a part is too large for that (over 2,000 nodes), the passes stay,
  and rough rounds that go round in circles for twenty rounds are valued exactly. The ring: settled, 152,885
  promised, 152,013 +- 8,412 played, in 5.6 s where it took 12.4 s.
- **Golden Targe as a bought start, another modifier fractured: x1.17.** The fractured Fire Resistance of the pasted
  item takes its group out of the pools; that was counted for the modifiers nobody asked for only. The Chaos
  Resistance target's twins (another element's resistance, for a Void Flux) were still counted for three elements
  where two can roll. The pasted item's fractured modifier now leaves every pool before anything is counted. Here:
  13,566 promised, 13,723 +- 566 played.
- **Dusk Amulet as a bought start with catalyst quality: x1.16 in the ninth run, x1.18 here.** Omen of Catalysing
  Exaltation boosts the roll, and the boosted weights were also used for what the modifiers already on the item
  are: an unknown prefix was taken for "% Energy Shield" or "% Armour" nine times in ten, those left the pool, and
  the Evasion target was promised at 43% where it rolls at 32%. What is on the item goes by the plain weights now.
  Here: 141,245 promised, 142,601 +- 5,948 played.
- **Dueling Wand: x0.80 with a fractured target, x0.81 from a white base** (too careful, as in the two runs before).
  A target's twin is a modifier too: beside the Cold Damage prefix that is the Chaos Damage target's twin (for a Rune
  of Aldur) no Ignite or Shock suffix rolls, and the network rolled them as modifiers in the Freeze Buildup target's
  way (16% of the suffixes, the play none). The tags that all twins of the kind share are applied now. Here: 11,650
  promised, 11,446 +- 282 played (the promise was 14,122); from the white base 7,197 promised, 7,396 +- 182 played
  (was 8,742); with five targets 93,869 promised, 88,712 +- 4,035 played.
- **Tenebrous Amulet with six targets, one fractured: x1.62; Fanatic Bow with five from a Magic item: x1.21.** Not
  found again here at the prices of 12 Oct: 998,147 promised, 1,053,794 +- 30,014 played over 1,200 crafts (x1.06),
  and 178,351 promised, 175,774 +- 4,975 played (x0.99). One thing was wrong on the amulet's way and is fixed: a
  modifier in a target's way arrived with the levels of any modifier of its side, not of its own tiers (a
  "+# to Strength" in the way of a Desecrated "+# to Strength and Intelligence" has no tier of level 75; the model
  let 3% of the rolls land in that class, the play none). The next run tells.
- **Dusk Amulet as an only item: values not settled.** Settled by the solver's change: 156,760 promised, 147,808 +-
  7,678 played, every craft ended.

## Time

The report of a process now names the requests that were not solved in ten minutes and the slowest that were. A
sweep of 168 scenarios on this computer (six processes, 25 minutes) showed where the time goes: the median request
is solved in one or two seconds, the slowest of the ordinary ones in 32 (90,000 nodes), and every request over a
minute is of one kind: **four targets on an item that is never given up** (40,000 to 90,000 nodes with level
classes, most of them one strongly connected part). Seven of those were not solved in ten minutes.

What changed in the solver:

- The blocks (rarity, targets, fracture) are split into their strongly connected parts over every edge, each solved
  after the parts it leads to: the same exact block solve at the sum of the parts' squares.
- **A block is no longer one full matrix.** Under one rule set a node has one edge, and with those edges alone a
  block falls into parts of its own that are far smaller: on a bracer that is never given up, 3,085 blocks of up to
  1,562 nodes are 39,484 parts of up to 102, and their squares add up to a sixtieth. The parts are solved one after
  the other, with factors only for those of more than one node. Two thirds of that request's time went into the
  full matrices.
- A rule set is valued part by part over the whole network where that is cheap (above), in the rough rounds too.
- Where the passes stay, they stop as soon as their rate says they will not settle the values in time, and the
  parts or the accelerated sweeps take over: 200 passes were made first, every exact round and for every number of
  the report.
- Exact rounds that make neither the item nor a white base cheaper (nodes go on changing between edges worth the
  same, or where no route goes) end the search after four in a row: on a coat that is never given up 250 such
  rounds were most of two minutes.

| request | before (6eb30a6) | now |
|---|---|---|
| Totemic Greaves, three targets, white | 2.8 s | 2.5 s |
| Totemic Greaves, four targets, white (73,000 nodes) | 19.8 s | 16.6 s |
| Totemic Greaves, five targets, white (level classes) | 68.7 s | 23.1 s |
| Gloam Ring, four targets, only item | 12.4 s, not settled | 5.6 s, settled |
| Polished Bracers, four targets, only item (61,000 nodes) | 340 s | 34 s |
| Corsair Coat, four targets, only item (46,000 nodes) | 482 s (in the first sweep here) | 44 s |
| the network tests | several minutes | one minute |

The costs are the same to the last digit where the rule set had settled before. What is left of the time is the
expansion (a tenth of a millisecond a node) and the search's own rounds (every edge of every node, every round).

## Checked here before the next run

The player was away for two hours and let the computer be used: three sweeps of the drawn scenarios in five or six
processes (1,500 crafts a scenario), each with more of the changes above.

| | first (the split blocks, the fractured modifier, the first part-by-part solve) | third (everything above; stopped when the player came back) |
|---|---|---|
| Scenarios | 168 | 149 |
| Agree | 153 of 160 | 139 of 148 |
| Not solved within ten minutes | 7 | 0 |
| Time to solve: 90% under / longest | 113 s / 610 s | 43 s / 165 s |
| The 135 scenarios in both, time to solve in all | 2,733 s | 1,190 s |

Of the scenarios in both, three promises moved by more than 0.3%: the two wands and staves with a twin (Dueling Wand
with three targets from a Magic item 114,905 -> 101,743, played x0.91 -> x1.03) and the Golden Targe that is never
given up (settled now). Every disagreement of the three sweeps is of one kind, see below.

## Still open

- **Four targets on an item that is never given up** is the one kind of request the sweeps here still disagree on
  (all 13 of 186 in the second sweep). The network with level classes is built without following blockers, and an
  item that is never given up keeps every modifier that is in a target's way until the route removes it: the play,
  which keeps one network for the whole craft, takes other steps thousands of times and a few crafts in a hundred do
  not end. The cost mostly agrees all the same (x0.93 to x1.09; Golden Targe: 199,339 promised, 203,030 +- 7,510
  played over the 574 of 600 crafts that ended). The page solves again from every pasted item, so its step is right
  for the item in hand. Tried and taken back: letting that network follow two targets' blockers where the size
  estimate says it fits. It did not fit (the estimate is too low for it), and the fallback was a smaller network than
  today's.
- The pasted item's own other modifiers are known, but the pools treat them as unknown ones (an amulet's first
  step: the Evasion family at 34% where the simulator has 32%).
- Six targets follow two targets' blockers.
- Essences and runes that hardly trade carry prices that mean little (above).

## The next run

Run [38244603317](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38244603317), started 12 Oct 2026
11:44 UTC on commit 6952592 (these changes).
