# Nineteenth deep run (read 12 Nov 2026)

Run 42532075834 on 7ca329a (before 84d2c77 and the salvaged nodeOf fix of 12 Nov), 19 runners, prices of the run in
`.kb_cache/run-prices/run19.json`. Read only for defects of routes the assistant offers (roadmap phase 0); no new run.

76 of 76 processes reported, none died of memory. 1,053 scenarios, 1,016 checked, **986 agree (97.0%)**, 30 do not,
37 outside (17 already done, 20 impossible), no errors. 67 million crafts played.

## What matters for offered routes

| Scenario | Promised | Played | Note |
|---|---|---|---|
| Fortified Hammer, set4, rare with other modifiers, only item | **-936,020,251** | 5,314,114 | values not settled; 863 crafts never ended. A negative promise is a defect whatever else: no route may show one. |
| Grasping Mail, set6, rare, a target fractured | 4,610,281 | 1,963,840 (x0.43) | values not settled |
| Blacksteel Sabatons, or3 (Life / Armour+Evasion / Mana) | 247.3 | 208.1 (x0.84) | promise too high |
| The pasted-item kind (`rare, other modifiers, only item`), 18 scenarios | | | costs within 4%, but up to 30 million detours and up to 237 crafts that never end per scenario (Grand Cuisses, Thane Mail): the twin/blocker reading fixed on 12 Nov |

Also: Dueling Wand (unwanted desecrated modifier) had 148 bone steps the rules refuse ("The Well of Souls would have no
modifier to offer in the place of the Mark"); Seastorm Mantle (a target fractured) 56 crafts left the network through
a Flux.

## Before / after the fixes of 12 Nov

The seventeenth run's Wrath Sceptre (`set4|rare, other modifiers|only item|2`, 52 crafts never ended within 67,550
uses) replayed with run 17's prices on main after both fixes (`run_one.js ... 2000 deep`): **2,000 of 2,000 crafts
finished**, promised 160,081, played 155,929 (se 2,520, x0.974), 2,854 detours, none given up. The replay's network had
34,952 nodes where the run's had 97,330, so it is not the same condition; 2,000 crafts are also too few for the ±2%
bound. The exact check is the phase 1 gate.

## Open, for phase 1 (verification gate)

1. The negative and unsettled promises (Fortified Hammer, Grasping Mail, Seastorm Mantle, Aegis Quarterstaff, Corsair
   Coat): an unsettled network must never offer a route; the gate needs that check before anything else.
2. The pasted-item scenarios replayed after the 12 Nov fixes: detours and unfinished crafts should fall to near zero.
3. Blacksteel Sabatons (x0.84) and Dueling Wand's refused bone steps through workflow B.
