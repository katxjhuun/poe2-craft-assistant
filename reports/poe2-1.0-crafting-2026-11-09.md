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
