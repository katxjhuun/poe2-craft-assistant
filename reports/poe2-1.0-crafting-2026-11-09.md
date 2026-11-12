# Path of Exile 2 1.0: what is known about crafting (9 Nov 2026)

Revealed at ExileCon 2026 (6-7 Nov). Release: **11 December 2026**, when the game leaves Early Access. The full patch
notes come about **a week before** (around 4 December); the game data the knowledge base is built from comes with
the release. Until then the details below are from the reveal and the press, not from patch notes: names and rules
may still change.

## Crafting news

- **Conquerors of Wraeclast** (the 1.0 challenge league). Its crafting currency, named **Crimson Iron** in the press,
  comes from the league's reward chests. It **Forgemarks** one or more modifiers of an item.
- **Reforging Bench**: a Forgemarked item is put in it and reforged. Every Forgemarked modifier is replaced by a new,
  random one, and the new modifiers are **fractured** at once, at whatever value they roll.
  - An item can have **up to two fractured modifiers** (Game8).
  - A fractured item cannot be Forgemarked again.
- **High-tier endgame Forgemarks** give exclusive marks that are revealed as unique fractured modifiers, found only
  through this system (Game8).
- **Blood Vials** (endgame): they force what a reforge (the press also says "Runeforge") gives into a mod group.
  The one named is the **Bloodvial of Rithva** (the Rithva mod group). How they combine with Forgemarks is not
  stated yet.
- **Economy reset**: nothing from Early Access (characters, currency, gear) moves to 1.0.

## Datamined on poe2db (read 12 Nov 2026)

poe2db already has the 1.0 items from the game files (the patch notes are not out). Its
[Conquerors of Wraeclast items](https://poe2db.tw/us/Conquerors_of_Wraeclast_items) page lists six league crafting
items, all with stack size 20, in three item groups that match the desecration bones (Jawbone / Rib / Collarbone):

| Item | Game text | Limit |
|---|---|---|
| **Crimson Iron** | Applies a Forgemark in place of a modifier of your choice on a Rare Weapon or Quiver | Maximum Item Level 64 |
| **Scarlet Hide** | ... on a Rare Armour or Belt | Maximum Item Level 64 |
| **Vermilion Gold** | ... on a Rare Amulet or Ring | Maximum Item Level 64 |
| **Bloodvial of Komaki** | Applies a Bloodmark in place of a suffix modifier of your choice on a Rare Weapon or Quiver | Minimum Modifier Level 65 |
| **Bloodvial of Eldra** | ... suffix ... on a Rare Armour or Belt | Minimum Modifier Level 65 |
| **Bloodvial of Rithva** | ... suffix ... on a Rare Amulet or Ring | Minimum Modifier Level 65 |

How to read the limits: the Gnawed Jawbone carries the same "Maximum Item Level: 64" and works only on items of item
level 64 or lower; the Ancient bones carry a "Minimum Modifier Level". So:
- **Forgemark** (Crimson Iron, Scarlet Hide, Vermilion Gold): the player chooses **any modifier** (prefix or suffix) on a
  Rare item of **item level 64 or lower**; it becomes a Forgemark. Several can be applied before reforging (Maxroll:
  "one or multiple").
- **Bloodmark** (the three Bloodvials): the player chooses a **suffix**; the new modifier is a suffix of **modifier level
  65 or more**, from the vial's own mod group (Maxroll: Rithva forces a modifier "from the Rithva mod group"). Which
  modifiers are in the Komaki, Eldra and Rithva groups is not on poe2db yet; Game8's "unique fractured modifiers" are
  probably these.
- **Reforge**: each marked modifier becomes a new random modifier, **fractured** at once; a fractured item cannot be
  marked again (Maxroll). Up to two fractured modifiers (Game8); poe2db has no number.
- poe2db's [Reforging Bench](https://poe2db.tw/us/Reforging_Bench) page today shows only the existing hideout bench
  (three-to-one recipes for runes, essences, liquid emotions, waystones); no "Forgemark" or "Bloodmark" keyword or page
  yet (both 404), no metadata ids, no modifier lists.
- No item text names jewels: jewels get no marks.
- Not in the datamined items: changes to existing currencies, omens, essences, bones, runes, affix limits.
- poe2db's game help text confirms the rule the self-test now checks: desecrating an item with the Mark of the Abyssal
  Lord always removes that modifier.

### Other 1.0 content that touches the knowledge base

- **Swords and daggers**: the Duelist (swords) and Shadow (daggers) come with 1.0. poe2db's 16 Conquerors uniques include
  One Hand Swords (Commander Sword, Sickle Sword) and Two Hand Swords (Vampiric Longsword, Twilight Longsword). The KB
  marks swords `unconfirmed_class` today; with 1.0 they become real bases and need pools, tiers and prices.
- **200+ new base types** (one with an extra jewel socket, one granting Curse Immunity), **40+ new and 70+ reworked
  uniques** (Maxroll, poe2db Version_1.0.0).
- **Passive tree**: the 18 jewel sockets on attribute paths move behind notables, about 60 in all (Maxroll).
- **Support gems** adapt to the skill they support (no crafting effect).

## Plan for the assistant (12 Nov)

What can be built before the patch notes, from the datamined text above:
1. Engine: the six items as operators (choose modifier(s) -> mark -> reforge into a fractured random modifier;
   Forgemark: any side, item level <= 64; Bloodmark: suffix, level >= 65, mod group), a limit of two fractured modifiers,
   no marking on a fractured item. Hidden until the 1.0 game data confirms them.
   **Done 12 Nov:** `reforge` operator in app/planner.js (`{ op: 'reforge', marks: [{ id, blood }] }`, `markItemFor`),
   on when the knowledge base has the 1.0 items (patch 1.x or a Crimson Iron description) or with `opts.v1`; until the
   mod groups are known a Bloodmark draws from every suffix of level 65 or more. Test in app/tests/planner.test.js;
   self-test walk tries it with `POE2_V1=1`. Not yet in routes (the network and the strategies do not use it).
2. Network: a second fractured modifier and the mark/reforge edges.
3. At release: KB build from the 1.0 game data (mod groups, swords/daggers, new bases), prices for the new league.
Open: the mod groups' contents; whether a Forgemark reforge rolls from the normal pool at item level <= 64; whether two
is the fractured cap; whether the existing Fracturing Orb still needs four modifiers and works next to Forgemarks.

### Added 12 Nov 2026 (press after the reveal; still no patch notes)

- **Item classes**: Crimson Iron works on **rare weapons and quivers** (Elyxir). Settled by poe2db above: Scarlet Hide
  and Vermilion Gold cover armour/belts and amulets/rings.
- **Level**: the revealed Crimson Iron has a **level-64 limit** (Elyxir). Settled by poe2db above: item level 64 or
  lower, like a Gnawed bone; the "high-tier endgame" ones are the Bloodvials (modifier level 65 or more).
- **Fractured count**: Game8 says up to two fractured modifiers, Maxroll "multiple". Two is the working number.
- **Sides**: one Indonesian article saw it only on suffixes and had not tried prefixes. Single source, not used.
- **Jewels**: Elyxir writes that five-modifier jewels (Rune of Aldur, Forbidden Rites) are "removed from the announced
  1.0 crafting options". Unclear whether that means the mechanic leaves the game; wait for the patch notes.
- One shop article (SSE Gold) calls the Reforging Bench a tier upgrade; it contradicts every other source, not used.

Sources: [Elyxir: 1.0 class, crafting and combat changes](https://www.elyxir.gg/news/path-of-exile-2/path-of-exile-2-10-key-class-crafting-and-combat-changes-explained),
[Maxroll](https://maxroll.gg/poe2/news/everything-new-in-path-of-exile-2-1-0),
[Sportskeeda](https://www.sportskeeda.com/mmo/everything-revealed-path-exile-2-1-0-exilecon-summary).

Nothing was said yet about changes to the existing currencies, omens, essences, runes, bones, the Well of Souls,
affix counts or the crafted-modifier limit: that waits for the patch notes.

## What the Craft Assistant needs for 1.0

1. **Read the patch notes (around 4 Dec)**: every change to existing crafting, the exact names and rules of the new
   currencies. Check them against the game data at release (the rules go by the game's own text).
2. **The knowledge base (at release)**: a new build from the 1.0 game data (kb_update.py; its downloads need the
   player's yes). The new currencies, their mod groups (Rithva and the others), and the item and modifier changes.
3. **The craft network**: new edges.
   - Forgemark + reforge: one or more chosen modifiers rerolled and fractured at once, up to two fractured modifiers.
     The network today knows one fractured modifier (`fg`/`fj`), so this needs a second one.
   - Blood Vials: an outcome drawn from one mod group.
   - Unique fractured modifiers: possible targets that only this system gives.
4. **Prices**: the new league's name in the price pipeline and the page (league list, rules league), and the new
   items' prices once the exchange trades them. The first days have thin markets.
5. **The sweep**: new scenario kinds (Forgemark routes, two fractured modifiers) before the network is trusted with
   them.

Sources: [Maxroll: Everything New In Path Of Exile 2 1.0](https://maxroll.gg/poe2/news/everything-new-in-path-of-exile-2-1-0),
[Game8: 1.0 summary](https://game8.co/games/Path-of-Exile-2/archives/493190),
[Game8: Conquerors of Wraeclast](https://game8.co/games/Path-of-Exile-2/archives/637865),
[pathofexile.com: Path of Exile 2 Fully Releases on December 11](https://www.pathofexile.com/forum/view-thread/3999366),
[pathofexile.com: 1.0 Full Reveal, ExileCon 2026](https://www.pathofexile.com/forum/view-thread/4012155),
press coverage (Sportskeeda's ExileCon summary, PC Gamer, Wccftech).
