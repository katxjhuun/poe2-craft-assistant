// The user's in-game screenshots (September 2026, Forbidden Rites), transcribed by hand into the
// Alt+Ctrl+C format the screenshot reader produces. Gutter labels became headers: green tier label =
// Desecrated, tan text = Fractured, pale blue with tier or "C" = Crafted, red "V" = Vaal.
const D = '—';
module.exports = [
  {
    id: 'loath-vise', expect: { base: 'Sirenscale Gloves', rarity: 'Rare', des: 1, frac: 0, crafted: 1, unrevealed: 0 },
    text: `Item Class: Gloves
Rarity: Rare
Loath Vise
Sirenscale Gloves
--------
Energy Shield: 108 (augmented)
--------
Requires: Level 80, 101 Int
--------
Item Level: 80
--------
{ Prefix Modifier (Tier: 1) }
100(92-100)% increased Energy Shield
{ Prefix Modifier (Tier: 4) }
Adds 12(11-13) to 19(18-21) Cold damage to Attacks
{ Prefix Modifier (Tier: 5) }
+152(124-167) to Accuracy Rating
{ Suffix Modifier (Tier: 1) }
18(15-18)% increased Rarity of Items found
{ Desecrated Suffix Modifier (Tier: 1) }
22(15-25)% chance for Attack Hits to apply Incision
{ Crafted Suffix Modifier (Tier: 3) }
+34(31-35)% to Cold Resistance`,
  },
  {
    id: 'vortex-barrier', expect: { base: 'Tasalian Focus', rarity: 'Rare', des: 6, frac: 0, crafted: 0, unrevealed: 0, corrupted: true },
    text: `Item Class: Foci
Rarity: Rare
Vortex Barrier
Tasalian Focus
--------
Quality: +20% (augmented)
Energy Shield: 403 (augmented)
--------
Requires: Level 80, 115 Int
--------
Item Level: 82
--------
{ Desecrated Prefix Modifier (Tier: 1) }
+164(150-164) to maximum Mana
{ Desecrated Prefix Modifier (Tier: 2) }
+77(74-80) to maximum Energy Shield
{ Desecrated Prefix Modifier (Tier: 1) }
100(92-100)% increased Energy Shield
{ Desecrated Suffix Modifier (Tier: 3) }
42(40-46)% increased Critical Hit Chance for Spells
{ Desecrated Suffix Modifier (Tier: 5) }
+22(21-25)% to Cold Resistance
{ Desecrated Suffix Modifier (Tier: 3) }
+32(31-35)% to Fire Resistance
--------
Corrupted`,
  },
  {
    id: 'rift-pile', expect: { base: 'Pyrophyte Staff', rarity: 'Rare', des: 1, frac: 1, crafted: 0, unrevealed: 1, grants: true },
    text: `Item Class: Staves
Rarity: Rare
Rift Pile
Pyrophyte Staff
--------
Requires: Level 64, 20 (augmented) Int
--------
Item Level: 82
--------
Grants Skill: Level 19 Solar Orb
--------
{ Prefix Modifier (Tier: 1) }
238(209-238)% increased Spell Damage
{ Fractured Suffix Modifier (Tier: 2) }
+28(28-30) to Intelligence
{ Suffix Modifier (Tier: 1) }
35% reduced Attribute Requirements
{ Desecrated Suffix Modifier }
Unrevealed Desecrated Modifier`,
  },
  {
    id: 'sorrow-song', expect: { base: 'Warmonger Bow', rarity: 'Rare', des: 0, frac: 0, crafted: 0, unrevealed: 0, sanctified: true },
    text: `Item Class: Bows
Rarity: Rare
Sorrow Song
Warmonger Bow
--------
Physical Damage: 78-123 (augmented)
Elemental Damage: 37-59 (augmented), 37-62 (augmented)
Critical Hit Chance: 8.45% (augmented)
Attacks per Second: 1.20
--------
Requires: Level 77, 163 (unmet) Dex
--------
Item Level: 81
--------
{ Prefix Modifier (Tier: 3) }
Adds 22(16-24) to 39(28-42) Physical Damage
{ Prefix Modifier (Tier: 4) }
Adds 37(31-38) to 62(47-59) Cold Damage
{ Prefix Modifier (Tier: 5) }
Adds 37(25-33) to 59(38-54) Fire Damage
{ Suffix Modifier (Tier: 3) }
+3.45(3.11-3.8)% to Critical Hit Chance
{ Suffix Modifier (Tier: 1) }
Gain 50(36-45) Mana per enemy killed
{ Suffix Modifier (Tier: 2) }
+140(125-150)% Surpassing chance to fire an additional Arrow
--------
Sanctified`,
  },
  {
    id: 'atziris-rule', expect: { base: 'Reflecting Staff', rarity: 'Unique', des: 0, frac: 0, crafted: 0, unrevealed: 0, corrupted: true, vaal: 1, runes: 3, flavour: true },
    text: `Item Class: Staves
Rarity: Unique
Atziri's Rule
Reflecting Staff
--------
Quality: +20% (augmented)
--------
Requires: Level 70, 114 Int
--------
Item Level: 82
--------
+60 to maximum Energy Shield (rune)
40% less Mana Regeneration Rate (rune)
Mana Recovery from Regeneration is also applied to Runic Ward (rune)
--------
Grants Skill: Level 20 Mirror of Refraction
--------
{ Unique Modifier }
11(10-20)% increased maximum Life
{ Unique Modifier }
+5(3-5) to Level of all Corrupted Spell Skill Gems
{ Unique Modifier }
14(10-20)% increased Cast Speed
{ Vaal Unique Modifier }
15(10-25)% chance for Spell Skills to fire 2 additional Projectiles
{ Unique Modifier }
Spells which cost Life Gain 125(80-120)% of Damage as Extra Physical Damage
--------
Corrupted
--------
Bow before her... or suffer the most gruelling death imaginable.`,
  },
  {
    id: 'vortex-braid', expect: { base: 'Gold Amulet', rarity: 'Rare', des: 1, frac: 0, crafted: 1, unrevealed: 0, enchants: 1, implicits: 1 },
    text: `Item Class: Amulets
Rarity: Rare
Vortex Braid
Gold Amulet
--------
Quality (Caster Modifiers): +40% (augmented)
--------
Requires: Level 60
--------
Item Level: 78
--------
{ Enchant Modifier }
Allocates Thaumaturgic Generator ${D} Unscalable Value
--------
{ Implicit Modifier }
20(12-20)% increased Rarity of Items found
--------
{ Prefix Modifier (Tier: 3) }
9(8-11)% increased Rarity of Items found
{ Desecrated Prefix Modifier (Tier: 5) }
+30(30-33) to Spirit
{ Crafted Prefix Modifier }
24(20-30)% increased Global Armour, Evasion and Energy Shield
{ Suffix Modifier (Tier: 6) }
12(9-12)% increased Cast Speed
{ Suffix Modifier (Tier: 1) }
+3 to Level of all Spell Skills
{ Suffix Modifier (Tier: 2) }
13(11-14)% increased Rarity of Items found`,
  },
  {
    id: 'brood-clasp', expect: { base: 'Absent Amulet', rarity: 'Rare', des: 1, frac: 1, crafted: 0, unrevealed: 0, limits: { prefix: 2, suffix: 2 }, flavour: true },
    text: `Item Class: Amulets
Rarity: Rare
Brood Clasp
Absent Amulet
--------
Quality (Caster Modifiers): +50% (augmented)
--------
Requires: Level 60
--------
Item Level: 81
--------
{ Enchant Modifier }
Allocates Invocated Efficiency ${D} Unscalable Value
--------
Grants Skill: Level 20 Archmage
--------
{ Implicit Modifier }
-1 Prefix Modifier allowed
-1 Suffix Modifier allowed
--------
{ Fractured Prefix Modifier (Tier: 1) }
+50(47-50) to Spirit
{ Prefix Modifier (Tier: 1) }
8(7-8)% increased maximum Mana
{ Suffix Modifier (Tier: 1) }
+3 to Level of all Spell Skills
{ Desecrated Suffix Modifier (Tier: 1) }
27(25-28)% increased Cast Speed
--------
We grasp the eternal unborn...`,
  },
  {
    id: 'gloom-post', expect: { base: 'Sinister Quarterstaff', rarity: 'Rare', des: 1, frac: 1, crafted: 0, unrevealed: 0, mirrored: true, runes: 2, limits: { prefix: 3, suffix: 4 } },
    text: `Item Class: Quarterstaves
Rarity: Rare
Gloom Post
Sinister Quarterstaff
--------
Quality: +30% (augmented)
Physical Damage: 541-936 (augmented)
Critical Hit Chance: 17.00% (augmented)
Attacks per Second: 1.80
--------
Requires: Level 67, 104 (unmet) Dex, 41 Int
--------
Item Level: 82
--------
+1 Suffix Modifier allowed (rune)
36% increased Physical Damage (rune)
--------
{ Prefix Modifier (Tier: 1) }
174(170-179)% increased Physical Damage
{ Prefix Modifier (Tier: 1) }
79(75-79)% increased Physical Damage
+179(175-200) to Accuracy Rating
{ Prefix Modifier (Tier: 1) }
Adds 52(37-55) to 94(63-94) Physical Damage
{ Fractured Suffix Modifier (Tier: 1) }
+5(4.41-5)% to Critical Hit Chance
{ Suffix Modifier (Tier: 1) }
28(26-28)% increased Attack Speed
{ Suffix Modifier (Tier: 1) }
+25(23-25)% to Critical Damage Bonus
{ Desecrated Suffix Modifier (Tier: 1) }
+5 to Level of all Melee Skills
--------
Mirrored`,
  },
];
