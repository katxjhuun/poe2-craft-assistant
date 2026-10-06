# Exhaustive strategy sweep

Source: `reports/sweep-latest.json`, 2026-10-06 02:49 UTC, 366 min on 25 workers.

- Scenarios: 784 (1803 goal sets; 0 skipped as impossible or without success)
- Strategy combinations covered: 12,941,918,208, in 15,652,314 classes that behave differently
- Simulations: 17,418,758
- Scenarios where Cheap, Balanced and Premium ask for the same goals and end on the same strategy: 104 of 784

## Verification of the assigned strategies

Each profile's strategy was assigned from 300-trial runs, then checked against the challengers with fresh random numbers (1,000 trials) and once more against the runner-up (4,000 trials).

| Profile | Verified | Replaced by the check | A cheaper one left | A safer one left | Order changed on the last recheck |
|---|---|---|---|---|---|
| cheap | 784 | 45 | 0 | 15 | 31 |
| balanced | 784 | 76 | 0 | 19 | 42 |
| premium | 784 | 77 | 79 | 17 | 5 |

"A cheaper one left" and "a safer one left" are trades the profile makes on purpose: Premium keeps a strategy that finishes more often although a cheaper one exists, Cheap keeps the cheapest although another finishes more often.

## The page planner against the verified best

| Profile | Same strategy | Equal result | Better | Worse | Worse: cost x (median / 90% / max) |
|---|---|---|---|---|---|
| cheap | 336 (43%) | 164 (21%) | 3 | 280 (36%) | x1.33 / x3.13 / x138.9 |
| balanced | 257 (33%) | 197 (25%) | 1 | 329 (42%) | x1.43 / x3.91 / x152.8 |
| premium | 168 (21%) | 59 (8%) | 3 | 554 (71%) | x6.42 / x25.27 / x12725.9 |

"Equal result": another strategy within 5% of the cost and the same chance to finish. "Better": the planner found a strategy the sweep's screening had dropped.

By start item (same + equal / worse):

| Profile | white | magic | rare | rare-low |
|---|---|---|---|---|
| cheap | 178 / 82 | 48 / 0 | 166 / 197 | 111 / 1 |
| balanced | 178 / 82 | 48 / 0 | 171 / 193 | 58 / 54 |
| premium | 160 / 100 | 48 / 0 | 22 / 342 | 0 / 112 |

### cheap: what the verified best does differently where the planner is worse

- 189× homog: default → true
- 102× exaltTier: default → greater
- 65× sideOmens: default → true
- 60× removal: default → annul
- 56× sideOmens: true → default
- 45× chaosTier: greater → default
- 28× magicTier: default → greater
- 27× slamOnly: default → true
- 20× start: default → alchemy
- 16× catalyse: default → true
- 14× bone: default → Ancient
- 14× echoes: default → true
- 13× magicTier: greater → default
- 11× greaterExalt: default → true

### balanced: what the verified best does differently where the planner is worse

- 265× homog: default → true
- 190× sideOmens: true → default
- 128× chaosTier: greater → default
- 108× removal: default → annul
- 44× slamOnly: default → true
- 36× bone: default → Ancient
- 31× desSlam: default → true
- 30× echoes: default → true
- 26× exaltTier: default → greater
- 20× exaltTier: greater → default
- 18× pair: true → default
- 18× start: default → alchemy
- 16× magicTier: greater → default
- 14× catalyse: default → true

### premium: what the verified best does differently where the planner is worse

- 348× homog: default → true
- 247× exaltTier: perfect → greater
- 197× sideOmens: true → default
- 129× removal: annul → default
- 102× chaosTier: perfect → default
- 98× exaltTier: default → greater
- 93× chaosTier: greater → default
- 83× desSlam: true → default
- 83× echoes: true → default
- 76× removal: erasure → annul
- 75× desSlam: default → true
- 72× echoes: default → true
- 64× bone: default → Ancient
- 63× slamOnly: default → true

## Settings the verified strategies use (other than the defaults)

| Setting | Cheap | Balanced | Premium |
|---|---|---|---|
| essence | true 163 | true 97 | true 89 |
| exaltTier | greater 305, perfect 7 | greater 413, perfect 14 | greater 396, perfect 47 |
| removal | annul 75, whittle 4, erasure 1 | annul 131, whittle 11, erasure 5 | annul 191, whittle 14, erasure 6 |
| homog | true 268 | true 339 | true 362 |
| sideOmens | true 183 | true 214 | true 211 |
| magicTier | greater 205, perfect 6 | greater 206, perfect 11 | greater 185, perfect 34 |
| slamOnly | true 75 | true 79 | true 84 |
| catalyse | true 17 | true 20 | true 20 |
| greaterExalt | true 11 | true 8 | true 10 |
| flux | false 74 | false 16 | false 16 |
| fracture | true 11 | true 12 | true 12 |
| pair | true 30 | true 11 | true 18 |
| desSlam | true 11 | true 32 | true 76 |
| chaosTier | greater 20, perfect 2 | greater 31, perfect 10 | greater 48, perfect 10 |
| start | alchemy 99 | alchemy 90 | alchemy 91 |
| restart | false 46 | false 46 | false 54 |
| bone | Ancient 15 | Ancient 37 | Ancient 73 |
| echoes | true 15 | true 38 | true 81 |
| runes | - | - | false 1 |

### cheap: largest gaps

| Scenario | Planner (chance, cost) | Verified best | Cost x | Difference |
|---|---|---|---|---|
| Grasping Mail|single-prefix-rare-T1|white | 8%, 52,248,256 ex | 14%, 376,023 ex | x138.95 | start: alchemy → default, removal: erasure → annul, chaosTier: greater → default, exaltTier: greater → perfect, magicTier: default → perfect, restart: default → false, pair: default → true, catalyse: default → true, slamOnly: default → true, homog: default → true |
| Grasping Mail|resistance-T2|rare | 47%, 4,727,469 ex | 99%, 43,816 ex | x107.894 | exaltTier: greater → perfect, removal: erasure → annul, chaosTier: greater → default, catalyse: default → true, homog: default → true |
| Grasping Mail|single-prefix-rare-T1|rare | 8%, 53,644,724 ex | 22%, 1,119,005 ex | x47.94 | exaltTier: greater → perfect, removal: erasure → annul, chaosTier: greater → default, catalyse: default → true, sideOmens: default → true, homog: default → true |
| Grasping Mail|pair-prefix-suffix-T2|white | 8%, 51,597,135 ex | 15%, 1,627,182 ex | x31.71 | start: alchemy → default, exaltTier: greater → perfect, removal: erasure → annul, chaosTier: greater → default, magicTier: default → perfect, homog: default → true, catalyse: default → true |
| Time-Lost Diamond|pair-prefix-suffix-T2|rare | 100%, 946,785 ex | 35%, 92,759 ex | x10.207 | removal: erasure → default, chaosTier: greater → default, fracture: default → true |
| Ancestral Tiara|single-suffix-rare-T1|white | 100%, 92 ex | 100%, 9 ex | x10.024 | sideOmens: true → default, chaosTier: greater → default, exaltTier: greater → default, pair: default → true |
| Siege Crossbow|pair-prefix-suffix-T2|white | 91%, 44,573 ex | 100%, 4,931 ex | x9.039 | magicTier: greater → perfect, chaosTier: greater → default, sideOmens: default → true, slamOnly: default → true |
| Grand Cuisses|pair-prefix-suffix-T2|white | 100%, 2,149 ex | 100%, 293 ex | x7.334 | sideOmens: true → default, pair: default → true, exaltTier: default → greater, homog: default → true |
| recipe|c3 | 100%, 834 ex | 100%, 121 ex | x6.881 | essence: true → default, slamOnly: default → true |
| Diamond|desecrated|rare | 100%, 47,585 ex | 100%, 7,061 ex | x6.739 | sideOmens: true → default, bone: default → Ancient, echoes: default → true |
| Emerald|desecrated|rare | 100%, 47,585 ex | 100%, 7,061 ex | x6.739 | sideOmens: true → default, bone: default → Ancient, echoes: default → true |
| Ruby|desecrated|rare | 100%, 47,585 ex | 100%, 7,061 ex | x6.739 | sideOmens: true → default, bone: default → Ancient, echoes: default → true |

### balanced: largest gaps

| Scenario | Planner (chance, cost) | Verified best | Cost x | Difference |
|---|---|---|---|---|
| Grasping Mail|resistance-T2|rare | 39%, 9,776,057 ex | 96%, 63,985 ex | x152.787 | removal: erasure → annul, chaosTier: perfect → default, catalyse: default → true, homog: default → true |
| Grasping Mail|single-prefix-rare-T1|rare | 8%, 74,557,161 ex | 10%, 1,092,567 ex | x68.24 | sideOmens: true → default, removal: erasure → annul, chaosTier: perfect → default, catalyse: default → true, desSlam: default → true, bone: default → Ancient, echoes: default → true, homog: default → true |
| Grand Regalia|pair-prefix-suffix-T2|white | 100%, 24,007 ex | 100%, 926 ex | x25.917 | magicTier: perfect → greater, exaltTier: perfect → greater, chaosTier: perfect → default, homog: default → true |
| Siege Crossbow|pair-prefix-suffix-T2|white | 94%, 963,227 ex | 100%, 44,764 ex | x21.518 | exaltTier: perfect → default, removal: annul → whittle, homog: default → true, desSlam: default → true, bone: default → Ancient, echoes: default → true, slamOnly: default → true, chaosTier: default → greater |
| Maji Talisman|single-prefix-rare-T1|white | 99%, 290,984 ex | 98%, 15,224 ex | x19.114 | exaltTier: perfect → greater, chaosTier: perfect → default, desSlam: default → true, echoes: default → true |
| Time-Lost Sapphire|pair-prefix-suffix-T2|rare | 100%, 322,141 ex | 72%, 29,176 ex | x11.041 | removal: whittle → default, chaosTier: greater → default |
| Sapphire|pair-prefix-suffix-T2|rare | 100%, 297,168 ex | 74%, 27,669 ex | x10.74 | removal: whittle → default |
| Aegis Quarterstaff|single-prefix-rare-T1|rare-low | 93%, 696,182 ex | 83%, 66,620 ex | x10.45 | chaosTier: perfect → greater, exaltTier: perfect → greater |
| Time-Lost Ruby|pair-prefix-suffix-T2|rare | 100%, 285,960 ex | 98%, 27,783 ex | x10.293 | removal: whittle → annul, chaosTier: greater → default, homog: default → true |
| Runemastered Veridical Chain|single-suffix-rare-T1|rare-low | 96%, 34,209 ex | 99%, 3,549 ex | x9.639 | chaosTier: greater → default, sideOmens: true → default, catalyse: default → true, removal: default → annul, homog: default → true |
| Emerald|pair-prefix-suffix-T2|rare | 100%, 392,305 ex | 59%, 44,079 ex | x8.9 | removal: whittle → default, chaosTier: greater → default, fracture: default → true |
| Grand Cuisses|pair-prefix-suffix-T2|white | 87%, 47,855 ex | 100%, 5,383 ex | x8.89 | magicTier: greater → perfect, sideOmens: true → default, chaosTier: greater → default, homog: default → true, slamOnly: default → true |

### premium: largest gaps

| Scenario | Planner (chance, cost) | Verified best | Cost x | Difference |
|---|---|---|---|---|
| Runemastered Veridical Chain|single-suffix-rare-T1|white | 12%, 38,051,178 ex | 100%, 2,990 ex | x12725.859 | magicTier: perfect → default, restart: false → default, exaltTier: perfect → greater, removal: whittle → default, chaosTier: perfect → default, start: default → alchemy, slamOnly: default → true, homog: default → true |
| Time-Lost Diamond|single-prefix-rare-T1|white | 100%, 486,954 ex | 100%, 141 ex | x3460.729 | removal: erasure → default, chaosTier: greater → default, slamOnly: default → true |
| Diamond|single-prefix-rare-T1|white | 100%, 487,405 ex | 100%, 147 ex | x3311.462 | removal: erasure → default, chaosTier: greater → default, slamOnly: default → true |
| Diamond|single-suffix-rare-T1|white | 100%, 440,782 ex | 100%, 188 ex | x2350.139 | magicTier: greater → default, restart: false → default, exaltTier: greater → default, removal: erasure → default, chaosTier: greater → default, start: default → alchemy, slamOnly: default → true |
| Time-Lost Diamond|single-suffix-rare-T1|white | 100%, 439,126 ex | 100%, 188 ex | x2330.641 | removal: erasure → default, chaosTier: greater → default, slamOnly: default → true |
| Grasping Mail|single-prefix-rare-T1|rare-low | 5%, 115,128,093 ex | 4%, 524,358 ex | x219.56 | removal: erasure → annul, chaosTier: perfect → default, sideOmens: true → default, catalyse: default → true, homog: default → true |
| Grasping Mail|resistance-T2|rare | 39%, 9,776,057 ex | 96%, 63,985 ex | x152.787 | removal: erasure → annul, chaosTier: perfect → default, catalyse: default → true, homog: default → true |
| Grasping Mail|single-suffix-rare-T1|rare | 6%, 48,017,325 ex | 3%, 454,846 ex | x105.568 | sideOmens: true → default, removal: erasure → annul, chaosTier: greater → default, catalyse: default → true, homog: default → true |
| Grasping Mail|single-prefix-rare-T1|rare | 5%, 112,879,585 ex | 6%, 1,302,879 ex | x86.639 | exaltTier: greater → perfect, sideOmens: true → default, removal: erasure → annul, chaosTier: perfect → default, catalyse: default → true, desSlam: default → true, homog: default → true |
| Sirenscale Gloves|single-prefix-rare-T1|white | 100%, 257,522 ex | 99%, 3,869 ex | x66.562 | sideOmens: true → default, exaltTier: perfect → greater, removal: whittle → default, chaosTier: perfect → default, homog: default → true |
| Adherent Cuffs|single-prefix-rare-T1|white | 100%, 256,597 ex | 100%, 3,907 ex | x65.68 | sideOmens: true → default, exaltTier: perfect → greater, removal: whittle → default, chaosTier: perfect → default, homog: default → true |
| Massive Mitts|single-prefix-rare-T1|white | 100%, 258,423 ex | 99%, 4,059 ex | x63.663 | sideOmens: true → default, exaltTier: perfect → greater, removal: whittle → default, chaosTier: perfect → default, homog: default → true |
