# Knowledge base completeness plan (started 27 Sept 2026)

Goal (user, 27 Sept 2026): a knowledge base that knows every stat of every craftable item class in scope, with its
weight, every stat that can come from outside the default pool (with its weight, how it is obtained, its limits and
conditions) and how each currency and omen works on it, every fact verified; then plans come from millions of
simulated crafts on that data. Keep going across sessions until every row below is done.

Scope: Helmet, Body Armour, Gloves, Boots, all weapon classes (maces, spears, bows, crossbows, quarterstaves,
wands, staves, sceptres, talismans; swords, axes, daggers and flails are not obtainable in 0.5.x), off hands
(Shield, Buckler, Focus, Quiver), Ring, Amulet, Belt, Jewel. Out of scope: flasks and charms (user decision);
their stats on other items are ordinary stats.

## What "verified" can mean

| Level | Meaning |
|---|---|
| game data | read from the game's own files (RePoE exports, raw tables, game texts): exact for 0.5.5 |
| official data | GGG's official Currency Exchange or patch notes |
| cross-checked estimate | not in the game files; two independent community sources agree |
| estimate | one community source |
| open | only an in-game test can settle it (list in the page's In-game tests) |

Roll weights are **not in the game files** (Mods table: SpawnWeight_Values holds 0/1 eligibility only, checked on
the raw 0.5.5 table). Craft of Exile says its PoE2 weights come from Recombinator data (community, Prohibited Library)
and, for bases without it, from trade listings; the Recombinator was disabled in 0.5.0. So weights can reach
"cross-checked estimate" at best, unless the page learns them from logged in-game results.

## Work list

| # | Area | Source | Target level | Status |
|---|---|---|---|---|
| 1 | Natural mod pools per base: tiers, levels, groups, tags, texts, value ranges | RePoE mods.json (have); cross-check RePoE mods_by_base.json | game data | **verified**: all 1,617 in-scope bases (22 classes) identical to RePoE's per-base game-data lists (scripts/kb_verify.py). Jewels keep poe2db ids and in-game radius wording; texts and ranges match the game data; the Small/Notable split of radius mods is verified against Mods.RadiusJewelType (77 Small, 79 Notable, all identical; user OK for the download) |
| 2 | Roll weights of natural mods | poe2db DropChance | estimate (community) | **coverage fixed**: 99.8% of base-mod pairs have a poe2db weight (was 92.9%); the matcher gave one-hand/two-hand twins and same-number mods each other's weights. 445 of 239,511 pairs (Grasping Mail's Genesis Tree mods, a few specials) take their family's lowest weight. Craft of Exile skipped (user, 27 Sept 2026: same Recombinator source) |
| 3 | Essence mods per item class | game tables EssenceMods, Essences, EssenceTargetItemCategories | game data | **verified**: all 1,168 essence/alloy -> class -> mod pairs identical (scripts/essences_from_gamedata.py). The 9 essences that give one of several mods are in kb.essence_outcomes (game table; Abyss 50/50 and Perfect Infinite 50/50/50 weights, others none) and the planner rolls among the outcomes the item can take |
| 4 | Desecrated mods per class, levels, lich tags, reveal rules | RePoE desecrated domain + keywords | game data | done (all equipment desecrated mods are level 65; none on sceptres) |
| 5 | Corruption (Vaal Orb) outcomes and corrupted implicits | RePoE mods generation_type corrupted | game data (list); outcome chances open | **verified**: 119 Corruption Enhancements in the KB (dom 'c'; equipment item-domain, jewels misc-domain), per-base lists identical to RePoE for all 1,617 bases; shown under Vaal Orb. Outcome chances: not in the files |
| 6 | Runes, soul cores, talismans (augments) per item class | game tables SoulCores, SoulCoreStats, SoulCoreStatCategories, SoulCoreLimits / RePoE augments.json | game data | **done**: 313 augments in kb.augments with stats per item class (categories resolved with the game tables); a target row shows the augments that give the same stat |
| 7 | Runic Alloy mods | EssenceMods (alloys are essences in the game tables) | game data | **verified** with row 3 (same table) |
| 8 | Liquid emotions (jewels) | game table LiquidEmotionOutcomes | game data | **verified**: all 26 emotions in kb.liquid_emotions with the crafted mod they add per jewel (Potent Ferocity and Contempt: a prefix or a suffix one; Diamond only takes 4 of them); 16 crafted-only mods added (e.g. "+1 Prefix Modifier allowed", which raises the limit). Planned like Perfect essences; which of the two Potent outcomes comes in is test t26 |
| 9 | Catalyst quality types and the mods they favour | game table AlternateQualityTypes | game data | **verified**: 26 quality types (13 catalysts for rings and amulets, 13 Refined for jewels) in kb.catalyst_qualities; each maps to a mod tag the planner favours (test). Jewel mods now carry the game's mod tags and stats (all 320 linked to their game mod) |
| 10 | Currency and omen rules (conditions, limits, tiers) | item texts, keywords, TieredCurrency, CurrencyPerItemClassConditions | game data | **verified**: Greater/Perfect minimum modifier levels identical to TieredCurrency (10 of 10; the build asserts it). CurrencyPerItemClassConditions: columns not identified, not used. Rare jewels 2 + 2 (community source, test t24): the engine used 3 + 3 before, fixed. Removal side of Perfect essences and liquid emotions (players' reports, test t25) |
| 12 | Tags that mods and implicits give the item (game data adds_tags) | RePoE mods.json adds_tags + spawn weights | game data | **verified**: 168 mods carry them (kb mod.at). Elemental spell prefixes, spell skill level suffixes and ailment suffixes on wands, staves and foci keep the other elements' spell modifiers off (cross-side too); the planner rolls with them, the picker says "blocked by", clashing targets are reported. Implicit "Can roll Ring Modifiers" (Grasping Mail and its Runeforged forms) adds ring: their pools grew from 203 to 407 mods (RePoE's per-base lists leave this out; kb_verify computes it) |
| 13 | Unique items (all classes but flasks and charms) | RePoE uniques.json, EE2 bases, poe2db unique pages, game unique mods | game data + poe2db | **done**: 423 of 423 in kb.uniques (scripts/unique_items.py, reports/uniques.md); all 2,479 lines match a game mod, vary per item or are item properties (Unmodifiable, hidden sockets). Pasted uniques read their lines with ranges. Jewels cannot be chanced (Chanceableitemclasses), so unique jewels only drop |
| 15 | Runes of Aldur (element transform) | rune texts (augments), two trade staves | game data + confirmed | **done**: Passion/Breath/Ire/Betrayal of Aldur turn the other elements' modifiers into Fire/Cold/Lightning/Chaos ones while socketed; fractured ones stay; listed under What you can use now (t30) |
| 14 | Verisium Anvil (Runeforging) | Expedition2VerisiumCrafts, ArmourTypes, Words; player; runeforging guides | game data + confirmed | **done**: 387 base upgrades with Armour/Evasion/ES and Runic Ward before and after (bases from level 55 give up about 12-20% of their defence; all get Ward), 269 uniques moved to their Runeforged/Runemastered base with crests. Modifiers stay (player; fractured ones too since 0.5.1) |
| 11 | Mechanics that the files do not state | in-game tests (page) | open until tested | 12 open of 30 (t1, t3, t8, t12, t14, t18, t20-t25); 15 confirmed, 3 refuted |

## Log

- 27 Sept 2026: Workbench. A bone use shows the three Desecrated modifiers the Well of Souls offers; the player keeps
  any of them (the same use replays from its seed), Omen of Abyssal Echoes rerolls the three once, lich omens can be
  chosen. New Strategy simulator (as Craft of Exile's): the player's own steps with rules (a requirement group -> next,
  repeat, new base, stop or step N), stats, open slots and rarity as requirements, the Calculator's groups as the goal;
  2,000 runs report success, cost per run and per finished item, uses per step and how the runs ended.

- 27 Sept 2026: unique lines 2,339 -> 2,479 of 2,479 verified. The rest differed only in how poe2db writes them: negative
  ranges ("(-20--10)%" for the game's "-(20-10)%"), ranges across zero ("(-25-25)% reduced" for "(-25-25)% increased",
  no "+" before "(-10-10)"), one multi-line game mod shown as separate lines, grey stat lines inside a block, and
  item properties (Unmodifiable, hidden sockets). A pasted unique with such a range reads both "increased" and "reduced".

- 27 Sept 2026: Craft of Exile beta reviewed (user's suggestion). Its visible modpool weights for a STR body armour match ours
  on all 19 families (tiers and totals). It showed three runes that change crafting, confirmed in the game data: Medved's
  Tending (Soul modifiers on body armour), Astrid's Creativity (a second crafted modifier), Serle's Triumph (+1 suffix and
  +1 modifier total). The planner rolls Soul modifiers and counts the second crafted slot when the rune is on the item.

- 27 Sept 2026: all uniques (422) in the KB; pasted uniques match their known lines. t30 solved: both trade staves carry Passion
  of Aldur runes, which turn Cold and Lightning modifiers into Fire ones (fractured ones stay). The Recombinator was removed
  with 0.5.0 (player + guides).

- 27 Sept 2026: weights. The poe2db matcher picked the first of several KB mods with the same group and level, so two-hand
  weapons got the one-hand twins' weights (Staff 71% of pairs without weight, Crossbow/Two Hand Mace/Warstaff/Talisman
  ~40%), and "reduced Bleeding duration" went to the Ignite mod with the same numbers. Now: the class's own pool first, then
  text + ranges (reversed ranges and hybrid line order normalised), weight to every same-class twin, merged class pages
  for bases without a page, Rings page for Grasping Mail. Pairs without weight: 17,060 -> 445.

- 27 Sept 2026: t27 from the player's trade searches: wands never carry two elements' spell modifiers (0 results for three
  pairs, the check pair found), so natural rolls follow the adds_tags rule. Two staves do carry such pairs, each with something
  normal rolling cannot make: a fractured Cold spell level suffix (Ghoul Beam), and Fire lines on a Gelid Staff whose own base
  tags forbid them, shown without a tier (Mind Roar). The route (Recombinator? Expedition is core again in 0.5.5) and whether
  a fractured mod still stops others are test t30. The four items are parser fixtures.

- 27 Sept 2026: two trade jewels from the player (Blight Joy, Loath Ornament) read cleanly: with a Potent Liquid Contempt
  allowance mod a jewel holds 4 regular mods + the crafted one (3 + 2 or 2 + 3). They showed a real bug: poe2db's jewel
  families are mod groups, so different stats shared one family (Damage with Maces/Quarterstaves/Spears; 9 families) and
  got tiers T2, T3; jewel mods now use the game's mod type as family (tiers T1 as in game) and keep the group in grp.

- 27 Sept 2026: player facts checked. Potent Ferocity/Contempt placement (side the removal opened) confirmed by the player, the
  game data sides and the MMOexp guide (t26). Runeforging confirmed by the game tables (Ward on all 402 upgraded bases,
  defence loss from base level 55) and a guide (t28). Grasping Mail takes jewellery catalysts (t29, player). Jewel total:
  the player says a Rare jewel never has more than 4 modifiers; the game data raises one side by 1 without lowering the
  other and two guides describe 5-modifier jewels, so t24 stays open with the exact test. Orb of Chance does not work
  on jewels (game table), found while collecting the unique jewels.

- 27 Sept 2026: full self-test on the new data (about 1.07 million checked steps, 213,000 parser round trips, 46,190
  strategy runs per run) found five problems, all fixed: a side over its limit hid a free slot (bones removed a mod they
  should not), the stopping by added tags is one-way (the check now follows arrival order), frequency expectations
  ignored stopped mods, crafted liquid mods on jewels were read as other classes' essence mods (essence preference is
  now per item class), and three-line plain-text hybrids that also read as separate mods were not flagged.

- 27 Sept 2026: other sources checked. Incursion2Crafting (Vaal temple benches, 23): bench versions of existing currency
  (quality, augment socket, corruption, Exalted/Regal/Alchemy workbenches, extraction), no new modifier source.
  SoulInfluence mods (22, "Medved's"/"of the Soul", spawn tag soul): craftable on a body armour with the rune Medved's
  Tending socketed (found via Craft of Exile, confirmed by the rune's game text; see R_SOUL_MODS). poe2db lists desecrated and
  corruption mods with DropChance 1 (no real weights), so desecrated options stay equally likely. "Catalysts can be
  applied to this item" (Grasping Mail forms) now takes catalyst quality (test t29). Verisium Anvil upgrades listed
  (387, kb.verisium_upgrades; test t28).

- 27 Sept 2026: currency/omen audit against the planner found the adds_tags mechanism (row 12) and the Verisium Anvil
  (game table Expedition2VerisiumCrafts: 718 base transformations into Runeforged/Runemastered/Runefather's bases with
  Verisium, Exceptional Verisium and crests; the bases are in the KB, the transformation is not modelled yet).

- 27 Sept 2026: rows 8-10 done (scripts/gamedata_extras.py, reports/gamedata-extras.md). Liquid emotions are planned from
  the game table; Rare jewels are limited to 2 + 2 (the engine allowed 3 + 3); Perfect essences no longer buy an Omen of
  Crystallisation when the essence side is full (players report the game removes from that side, test t25).

- 27 Sept 2026: augments (runes, soul cores, talismans, idols) added from the game data; target rows show them.

- 27 Sept 2026: multi-outcome essences modelled from the game table (planner test added).

- 27 Sept 2026: essences and alloys verified against EssenceMods (1,168/1,168). Found the multi-outcome essences (OutcomeMods).

- 27 Sept 2026: corruption enhancements added and verified (all bases); jewel texts verified against the game data.

- 27 Sept 2026: downloaded the game tables (scripts/fetch_gamedata.py, user OK). kb_verify: natural pools identical to RePoE for all non-jewel classes; corruption mods per class found (4-15), not in the KB yet.

- 27 Sept 2026: plan written. Findings so far: real weights are server-side; RePoE keywords.json added (game texts);
  alloys trade in every league; desecrated equipment mods are level 65 only.
