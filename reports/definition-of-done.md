# Definition of done (12 Nov 2026; the route bound is the player's, the other numbers are proposals)

Agreed with the player on 12 Nov 2026 after a look at why the work kept restarting (rules found during simulations,
questions asked late, a goal that drifted from "a good route for my item" to "the network agrees with the simulator
everywhere"). The numbers marked *proposal* wait for the player's yes.

## The product, in the player's words

A player picks the stats they want, pastes the item they have, and the assistant recommends a route: from a
simulation, or from a known route whose result is known and which was corrected by it.

**Who it is for** (the player, 12 Nov 2026): not the average player. It is for someone who knows the game and its
crafting very well, and who still wants to see the best scenario. So:
- No teaching, no hand-holding: crafting terms are used as they are, nothing is explained that such a player knows.
- The value is the comparison: the cheapest route next to the next best ones, with expected cost, the spread (a bad
  run, not only the average), the chance of each step and where it can brick.
- Every number is the real one: what a route rests on (weights, assumptions, `weak` rules) is visible, so the player
  can disagree with it. A route that is only "probably fine" says so.
- "Best" is by the player's own measure (expected cost, worst case, or fewest steps), with their own prices.

## Done means

| # | Measure | Target | How it is checked |
|---|---|---|---|
| 1 | **Coverage** | The craft goals players actually make: *proposal* the 30 most common goals at the 1.0 launch (weapons, body armour, rings, amulets, belts, jewels), picked from trade demand in the first week; until then the scenarios already in the sweep | a fixed list in the repo |
| 2 | **Near-perfect routes** | Every route the assistant offers keeps its promise: the simulator plays its expected cost within **±2%** and its success chance within **0.5 points** (the player asked for tighter than ±5% / 1 point on 12 Nov 2026), measured on 100,000 replayed crafts so that the 95% confidence interval of the play lies inside the bound (±2% on a heavy-tailed cost needs about 10,000 to 40,000 crafts, 0.5 points about 38,000). A route that cannot be shown to do that is not offered as a recommendation (it may be listed, marked unsure) | replay (`scripts/selftest/diag`) of every offered route on the list |
| 2b | **Better than the known recipe** | On every goal of the list the recommended route is at least as cheap as the best recipe crafters use for it (route library), and the page shows by how much. A goal where a known recipe beats it is a defect to fix, not a pass | route library vs recommendation, per goal |
| 3 | **Speed** | An answer within *proposal* 10 seconds after the paste, on the player's PC | page timing |
| 4 | **Rules shown** | Every route says which rules it rests on; a `weak` rule shows as a warning; a route that needs an `unknown` rule is not offered | `reports/rules-ledger.md` |
| 5 | **Prices** | Prices of the player's league, not older than *proposal* 24 hours | the price job |

The player, 12 Nov 2026: "I already have this recipe for this item" would make the assistant useless; route success
has to be near-perfect or the project is worthless. So the bar is high where the player looks (the routes offered),
and the restarts are stopped by the process below, not by lowering the bar.

When 1-5 hold, the work is done. A disagreement on a route the assistant never offers (outside the list, or a state no
recommended route passes through) is not a reason to start again.

## What stops

- No more sweeps on 0.5.5 data: it is replaced on 11 Dec 2026.
- The network does not have to agree with the simulator in states no offered route uses. It is the way to find routes
  better than the known recipes; every route it offers is replayed before it is shown. Where the network is missing or
  unsure, the simulator answers and the route says it was not checked as closely.
- A new rule enters through the rules ledger (`node scripts/rules_ledger.js`), never in the middle of a run.

## How a piece of work runs

1. **Rules first.** Regenerate the ledger. List what the work touches that is `unknown` or `weak`.
2. **Questions once.** Ask them in one message at the start. No simulation before the answers.
3. **Then simulate**, only the goals the change touches. Each result notes the ledger and the price date it used, so
   a later rule change reruns only what uses that rule.
4. **Check against 1-5** and stop.

## 1.0 day-one list

1. ~4 Dec: patch notes → the ledger's PoE2 1.0 section and every changed rule; questions to the player in one message.
2. 11 Dec: knowledge base from the 1.0 game data (downloads with the player's yes) → ledger again.
3. The goal list (#1) from the first days' trade demand; prices for the new league.
4. Simulations for the goal list only; publish when 1-5 hold. Thin markets in the first days are expected.
