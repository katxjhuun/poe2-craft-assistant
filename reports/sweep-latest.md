# Exhaustive strategy sweep

Source: `reports/sweep-latest.json`, 2026-10-06 08:33 UTC, 283 min on 25 workers.

- Scenarios: 784 (1803 goal sets; 0 skipped as impossible or without success)
- Strategy combinations covered: 12,941,918,208, in 8,366,607 classes that behave differently
- Simulations: 9,576,460
- Scenarios where Cheap, Balanced and Premium ask for the same goals and end on the same strategy: 104 of 784

## Verification of the assigned strategies

Each profile's strategy was assigned from 300-trial runs, then checked against the challengers with fresh random numbers (1,000 trials) and once more against the runner-up (4,000 trials).

| Profile | Verified | Replaced by the check | A cheaper one left | A safer one left | Order changed on the last recheck |
|---|---|---|---|---|---|
| cheap | 784 | 58 | 0 | 14 | 56 |
| balanced | 784 | 94 | 0 | 18 | 93 |
| premium | 784 | 116 | 79 | 21 | 11 |

"A cheaper one left" and "a safer one left" are trades the profile makes on purpose: Premium keeps a strategy that finishes more often although a cheaper one exists, Cheap keeps the cheapest although another finishes more often.

## The page planner against the verified best

| Profile | Same strategy | Equal result | Better | Worse | Worse: cost x (median / 90% / max) |
|---|---|---|---|---|---|
| cheap | 551 (70%) | 171 (22%) | 4 | 57 (7%) | x1.07 / x1.21 / x12.3 |
| balanced | 505 (64%) | 187 (24%) | 13 | 79 (10%) | x1.07 / x2.15 / x4.5 |
| premium | 502 (64%) | 182 (23%) | 9 | 90 (11%) | x1.08 / x2.23 / x101.5 |

"Equal result": another strategy within 5% of the cost and the same chance to finish. "Better": the planner found a strategy the sweep's screening had dropped.

By start item (same + equal / worse):

| Profile | white | magic | rare | rare-low |
|---|---|---|---|---|
| cheap | 251 / 9 | 48 / 0 | 315 / 48 | 112 / 0 |
| balanced | 242 / 18 | 48 / 0 | 317 / 47 | 98 / 14 |
| premium | 233 / 27 | 48 / 0 | 319 / 44 | 93 / 19 |

### cheap: what the verified best does differently where the planner is worse

- 24× sideOmens: default → true
- 16× sideOmens: true → default
- 9× exaltTier: default → greater
- 8× exaltTier: greater → default
- 7× fracture: default → true
- 5× chaosTier: default → greater
- 4× chaosTier: greater → default
- 4× desSlam: default → true
- 4× echoes: default → true
- 3× slamOnly: default → true
- 3× removal: annul → default
- 3× bone: default → Ancient
- 2× start: default → alchemy
- 2× catalyse: default → true

### balanced: what the verified best does differently where the planner is worse

- 28× sideOmens: true → default
- 26× sideOmens: default → true
- 15× exaltTier: greater → default
- 11× exaltTier: default → greater
- 11× bone: default → Ancient
- 8× desSlam: default → true
- 8× chaosTier: default → greater
- 7× echoes: default → true
- 5× fracture: default → true
- 5× exaltTier: perfect → greater
- 5× removal: annul → default
- 4× chaosTier: perfect → default
- 4× exaltTier: perfect → default
- 3× pair: default → true

### premium: what the verified best does differently where the planner is worse

- 28× sideOmens: true → default
- 22× desSlam: default → true
- 22× echoes: default → true
- 21× sideOmens: default → true
- 16× exaltTier: greater → default
- 16× exaltTier: default → greater
- 12× bone: default → Ancient
- 10× start: alchemy → default
- 10× restart: default → false
- 8× chaosTier: greater → default
- 8× chaosTier: perfect → default
- 6× slamOnly: default → true
- 6× removal: default → erasure
- 5× removal: whittle → annul

## Settings the verified strategies use (other than the defaults)

| Setting | Cheap | Balanced | Premium |
|---|---|---|---|
| magicTier | greater 210, perfect 6 | greater 200, perfect 18 | greater 180, perfect 44 |
| exaltTier | greater 286, perfect 1 | greater 371, perfect 13 | greater 337, perfect 45 |
| slamOnly | true 55 | true 76 | true 69 |
| essence | true 163 | true 97 | true 89 |
| flux | false 75 | false 16 | false 16 |
| pair | true 40 | true 13 | true 13 |
| catalyse | true 15 | true 19 | true 24 |
| fracture | true 21 | true 13 | true 17 |
| desSlam | true 11 | true 29 | true 101 |
| sideOmens | true 194 | true 236 | true 254 |
| echoes | true 16 | true 35 | true 108 |
| start | alchemy 51 | alchemy 45 | alchemy 39 |
| chaosTier | greater 42, perfect 3 | greater 65, perfect 7 | greater 132, perfect 10 |
| removal | annul 13, whittle 3, erasure 2 | annul 34, whittle 8, erasure 7 | annul 65, erasure 20, whittle 11 |
| bone | Ancient 6 | Ancient 21 | Ancient 82 |
| restart | false 1 | false 3 | false 10 |

### cheap: largest gaps

| Scenario | Planner (chance, cost) | Verified best | Cost x | Difference |
|---|---|---|---|---|
| Grasping Mail|single-prefix-rare-T1|white | 3%, 137,869,799 ex | 16%, 11,231,611 ex | x12.275 | sideOmens: default → true, catalyse: default → true, desSlam: default → true, bone: default → Ancient, echoes: default → true, exaltTier: default → greater |
| Diamond|pair-prefix-suffix-T2|white | 100%, 452,470 ex | 36%, 85,359 ex | x5.301 | magicTier: greater → default, removal: whittle → default, start: default → alchemy, slamOnly: default → true, fracture: default → true |
| Time-Lost Diamond|pair-prefix-suffix-T2|white | 100%, 461,956 ex | 35%, 89,290 ex | x5.174 | removal: erasure → default, start: default → alchemy, slamOnly: default → true, fracture: default → true |
| Grasping Mail|pair-prefix-suffix-T2|white | 8%, 51,595,750 ex | 9%, 15,133,498 ex | x3.409 | start: alchemy → default, exaltTier: greater → default, removal: erasure → whittle, chaosTier: greater → perfect, restart: default → false, desSlam: default → true, sideOmens: default → true, echoes: default → true, fracture: default → true |
| Fanatic Bow|pair-prefix-suffix-T2|white | 85%, 58,852 ex | 100%, 35,196 ex | x1.672 | magicTier: greater → perfect, exaltTier: greater → default, desSlam: default → true, bone: default → Ancient, echoes: default → true, slamOnly: default → true |
| Time-Lost Sapphire|pair-prefix-suffix-T2|white | 72%, 29,206 ex | 76%, 24,153 ex | x1.209 | fracture: true → default, catalyse: default → true |
| Feathered Raiment|single-prefix-common-T2|rare | 100%, 2,036 ex | 100%, 1,720 ex | x1.184 | sideOmens: default → true |
| Cryptic Leggings|single-prefix-common-T2|rare | 100%, 1,259 ex | 100%, 1,066 ex | x1.181 | sideOmens: default → true |
| Permafrost Staff|pair-prefix-suffix-T2|rare | 90%, 36,974 ex | 93%, 31,519 ex | x1.173 | removal: annul → default, chaosTier: default → greater |
| Warlord Cuirass|single-prefix-rare-T1|rare | 100%, 1,610 ex | 100%, 1,413 ex | x1.139 | sideOmens: default → true |
| Imperial Greathelm|pair-two-suffixes|rare | 100%, 6,763 ex | 100%, 6,042 ex | x1.119 | sideOmens: default → true |
| Austere Garb|single-prefix-rare-T1|rare | 100%, 1,516 ex | 100%, 1,360 ex | x1.115 | sideOmens: default → true |

### balanced: largest gaps

| Scenario | Planner (chance, cost) | Verified best | Cost x | Difference |
|---|---|---|---|---|
| Grasping Mail|single-prefix-rare-T1|white | 9%, 65,719,049 ex | 13%, 14,466,135 ex | x4.543 | removal: erasure → whittle, chaosTier: perfect → default, exaltTier: perfect → greater, slamOnly: default → true, restart: default → false, desSlam: default → true, bone: default → Ancient, echoes: default → true |
| Grasping Mail|pair-prefix-suffix-T2|white | 9%, 67,254,097 ex | 12%, 16,546,605 ex | x4.065 | start: alchemy → default, exaltTier: perfect → default, chaosTier: perfect → default, restart: default → false, pair: default → true, desSlam: default → true, bone: default → Ancient, echoes: default → true |
| Grand Visage|pair-prefix-suffix-T2|white | 100%, 1,952 ex | 100%, 536 ex | x3.643 | magicTier: perfect → greater |
| Grasping Mail|single-suffix-rare-T1|white | 16%, 28,958,665 ex | 21%, 8,772,651 ex | x3.301 | start: alchemy → default, exaltTier: perfect → default, removal: erasure → annul, chaosTier: perfect → default, magicTier: default → perfect, restart: default → false, desSlam: default → true, bone: default → Ancient, echoes: default → true, slamOnly: default → true, pair: default → true |
| Aegis Quarterstaff|pair-prefix-suffix-T2|white | 94%, 435,897 ex | 53%, 145,165 ex | x3.003 | desSlam: true → default, echoes: true → default, exaltTier: perfect → greater, removal: whittle → default, chaosTier: perfect → greater, fracture: default → true |
| Grasping Mail|resistance-T2|white | 37%, 10,709,419 ex | 38%, 4,315,487 ex | x2.482 | chaosTier: perfect → greater, desSlam: default → true, bone: default → Ancient, echoes: default → true |
| Ruination Maul|pair-prefix-suffix-T2|white | 91%, 482,977 ex | 56%, 224,198 ex | x2.154 | sideOmens: true → default, exaltTier: perfect → greater, removal: annul → default, bone: default → Ancient, fracture: default → true, chaosTier: default → greater |
| Fortified Hammer|pair-prefix-suffix-T2|white | 91%, 482,977 ex | 56%, 224,198 ex | x2.154 | sideOmens: true → default, exaltTier: perfect → greater, removal: annul → default, bone: default → Ancient, fracture: default → true, chaosTier: default → greater |
| Maji Talisman|pair-prefix-suffix-T2|white | 92%, 447,938 ex | 100%, 274,656 ex | x1.631 | bone: default → Ancient |
| Fanatic Bow|pair-prefix-suffix-T2|white | 93%, 430,807 ex | 100%, 268,838 ex | x1.602 | removal: erasure → annul, chaosTier: perfect → default, bone: default → Ancient |
| Grand Spear|pair-prefix-suffix-T2|white | 93%, 417,057 ex | 100%, 277,758 ex | x1.502 | exaltTier: perfect → default, bone: default → Ancient |
| Grand Regalia|pair-prefix-suffix-T2|white | 100%, 3,551 ex | 100%, 2,458 ex | x1.445 | magicTier: perfect → greater, sideOmens: default → true, desSlam: default → true, echoes: default → true |

### premium: largest gaps

| Scenario | Planner (chance, cost) | Verified best | Cost x | Difference |
|---|---|---|---|---|
| recipe|c4a | 86%, 2,485,502 ex | 90%, 24,476 ex | x101.548 | removal: erasure → default, chaosTier: perfect → greater, sideOmens: default → true, catalyse: default → true, exaltTier: default → perfect, slamOnly: default → true |
| recipe|c1a | 98%, 1,317,697 ex | 100%, 13,145 ex | x100.241 | removal: erasure → default, chaosTier: perfect → greater, sideOmens: default → true, desSlam: default → true, echoes: default → true, exaltTier: default → greater, slamOnly: default → true |
| Grasping Mail|single-prefix-rare-T1|white | 9%, 10,276,216 ex | 3%, 630,723 ex | x16.293 | sideOmens: true → default, slamOnly: true → default, exaltTier: perfect → greater, removal: whittle → annul, chaosTier: perfect → default, catalyse: default → true |
| recipe|c2a | 100%, 106,024 ex | 98%, 28,472 ex | x3.724 | bone: Ancient → default |
| Grand Visage|pair-prefix-suffix-T2|white | 100%, 1,952 ex | 100%, 536 ex | x3.643 | magicTier: perfect → greater |
| Fanatic Bow|single-prefix-rare-T1|white | 62%, 2,081,381 ex | 93%, 860,796 ex | x2.418 | chaosTier: perfect → default, slamOnly: default → true, restart: default → false, removal: default → erasure, desSlam: default → true, bone: default → Ancient, echoes: default → true, exaltTier: default → perfect |
| Fanatic Bow|single-suffix-rare-T1|rare | 1%, 8,560,224 ex | 1%, 3,706,723 ex | x2.309 | chaosTier: greater → default |
| Siege Crossbow|single-prefix-rare-T1|white | 62%, 2,042,092 ex | 92%, 893,431 ex | x2.286 | start: alchemy → default, chaosTier: perfect → default, exaltTier: greater → perfect, magicTier: default → perfect, restart: default → false, sideOmens: default → true, removal: default → whittle, desSlam: default → true, bone: default → Ancient, echoes: default → true |
| Aegis Quarterstaff|single-prefix-rare-T1|white | 61%, 2,100,168 ex | 91%, 939,633 ex | x2.235 | start: alchemy → default, chaosTier: perfect → default, magicTier: default → perfect, restart: default → false, desSlam: default → true, bone: default → Ancient, echoes: default → true, removal: default → erasure |
| Maji Talisman|single-prefix-rare-T1|white | 61%, 2,085,833 ex | 91%, 953,996 ex | x2.186 | start: alchemy → default, chaosTier: perfect → default, magicTier: default → greater, restart: default → false, desSlam: default → true, bone: default → Ancient, echoes: default → true, exaltTier: default → greater, removal: default → whittle |
| Grasping Mail|pair-prefix-suffix-T2|white | 11%, 36,134,073 ex | 12%, 16,546,605 ex | x2.184 | start: alchemy → default, exaltTier: perfect → default, removal: whittle → erasure, chaosTier: perfect → default, restart: default → false, pair: default → true |
| Grand Spear|single-prefix-rare-T1|white | 63%, 1,988,079 ex | 93%, 911,884 ex | x2.18 | start: alchemy → default, chaosTier: perfect → greater, exaltTier: greater → perfect, restart: default → false, desSlam: default → true, bone: default → Ancient, echoes: default → true, slamOnly: default → true |
