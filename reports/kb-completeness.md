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
| 1 | Natural mod pools per base: tiers, levels, groups, tags, texts, value ranges | RePoE mods.json (have); cross-check RePoE mods_by_base.json | game data | **verified**: all 1,617 in-scope bases (22 classes) identical to RePoE's per-base game-data lists (scripts/kb_verify.py). Jewels keep poe2db ids and in-game radius wording; texts and ranges match the game data; the Small/Notable split of radius mods still needs Mods.RadiusJewelType (raw Mods table, 7.4 MB, not downloaded yet) |
| 2 | Roll weights of natural mods | poe2db DropChance (have); Craft of Exile | cross-checked estimate | poe2db only; comparison pending |
| 3 | Essence mods per item class | game tables EssenceMods, Essences, EssenceTargetItemCategories | game data | **verified**: all 1,168 essence/alloy -> class -> mod pairs identical (scripts/essences_from_gamedata.py). The 9 essences that give one of several mods are in kb.essence_outcomes (game table; Abyss 50/50 and Perfect Infinite 50/50/50 weights, others none) and the planner rolls among the outcomes the item can take |
| 4 | Desecrated mods per class, levels, lich tags, reveal rules | RePoE desecrated domain + keywords | game data | done (all equipment desecrated mods are level 65; none on sceptres) |
| 5 | Corruption (Vaal Orb) outcomes and corrupted implicits | RePoE mods generation_type corrupted | game data (list); outcome chances open | **verified**: 119 Corruption Enhancements in the KB (dom 'c'; equipment item-domain, jewels misc-domain), per-base lists identical to RePoE for all 1,617 bases; shown under Vaal Orb. Outcome chances: not in the files |
| 6 | Runes, soul cores, talismans (augments) per item class | game tables SoulCores, SoulCoreStats, SoulCoreStatCategories, SoulCoreLimits / RePoE augments.json | game data | **done**: 313 augments in kb.augments with stats per item class (categories resolved with the game tables); a target row shows the augments that give the same stat |
| 7 | Runic Alloy mods | EssenceMods (alloys are essences in the game tables) | game data | **verified** with row 3 (same table) |
| 8 | Liquid emotions (jewels) | game table LiquidEmotionOutcomes | game data | **verified**: all 26 emotions in kb.liquid_emotions with the crafted mod they add per jewel (Potent Ferocity and Contempt: a prefix or a suffix one; Diamond only takes 4 of them); 16 crafted-only mods added (e.g. "+1 Prefix Modifier allowed", which raises the limit). Planned like Perfect essences; which of the two Potent outcomes comes in is test t26 |
| 9 | Catalyst quality types and the mods they favour | game table AlternateQualityTypes | game data | **verified**: 26 quality types (13 catalysts for rings and amulets, 13 Refined for jewels) in kb.catalyst_qualities; each maps to a mod tag the planner favours (test). Jewel mods now carry the game's mod tags and stats (all 320 linked to their game mod) |
| 10 | Currency and omen rules (conditions, limits, tiers) | item texts, keywords, TieredCurrency, CurrencyPerItemClassConditions | game data | **verified**: Greater/Perfect minimum modifier levels identical to TieredCurrency (10 of 10; the build asserts it). CurrencyPerItemClassConditions: columns not identified, not used. Rare jewels 2 + 2 (community source, test t24): the engine used 3 + 3 before, fixed. Removal side of Perfect essences and liquid emotions (players' reports, test t25) |
| 12 | Tags that mods and implicits give the item (game data adds_tags) | RePoE mods.json adds_tags + spawn weights | game data | **verified**: 168 mods carry them (kb mod.at). Elemental spell prefixes, spell skill level suffixes and ailment suffixes on wands, staves and foci keep the other elements' spell modifiers off (cross-side too); the planner rolls with them, the picker says "blocked by", clashing targets are reported. Implicit "Can roll Ring Modifiers" (Grasping Mail and its Runeforged forms) adds ring: their pools grew from 203 to 407 mods (RePoE's per-base lists leave this out; kb_verify computes it) |
| 11 | Mechanics that the files do not state | in-game tests (page) | open until tested | 18 open (see In-game tests; t24-t29 added) |

## Log

- 27 Sept 2026: other sources checked. Incursion2Crafting (Vaal temple benches, 23): bench versions of existing currency
  (quality, augment socket, corruption, Exalted/Regal/Alchemy workbenches, extraction), no new modifier source.
  SoulInfluence mods (22, "Medved's"/"of the Soul", spawn tag soul that no base or mod gives): drop-only from the
  Runes of Aldur Expedition content, in the KB and read by the parser, not craftable. poe2db lists desecrated and
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
