// Item texts of the kinds that are not gear, for the price check's tests.
//
// These were WRITTEN from the layout the game's copy text has (header, sections between dashed lines, the property
// names the trade tools read), not copied from the game: the reader is tested to find what it looks for in them, and a
// text copied in game may still differ in what surrounds those lines. Replace an entry with a real copy when one is
// at hand (the reader only looks for: the name lines, "Stack Size:", "Level:", "Quality:", "Sockets:", "Item Level:",
// "Area Level:", "Waystone Tier:", the status lines, and modifier lines).
const T = (lines) => lines.join('\n');
module.exports = {
  currency: T(['Item Class: Stackable Currency', 'Rarity: Currency', 'Exalted Orb', '--------', 'Stack Size: 7/20', '--------',
    'Augments a Rare item with a new random modifier', '--------', 'Right click this item then left click a rare item to apply it.']),
  bigStack: T(['Item Class: Stackable Currency', 'Rarity: Currency', 'Regal Shard', '--------', 'Stack Size: 1,250/5,000', '--------', 'A stack of 10 shards becomes a Regal Orb.']),
  rune: T(['Item Class: Socketable', 'Rarity: Currency', 'Adept Rune', '--------', 'Stack Size: 3/10', '--------',
    'Martial Weapons: +80 to Accuracy Rating', 'Armour: +15 to Spirit', '--------', 'Place into an empty Rune Socket in a Martial Weapon or Armour to apply its effect to that item.']),
  omen: T(['Item Class: Omen', 'Rarity: Currency', 'Omen of Homogenising Exaltation', '--------', 'Stack Size: 1/10', '--------',
    'While this item is active in your inventory your next Exalted Orb will add a modifier of the same type as an existing modifier']),
  wombgift: T(['Item Class: Wombgifts', 'Rarity: Currency', 'Banded Wombgift', '--------', 'Item Level: 80', '--------', 'Can be grown in the Genesis Tree.']),
  skillGem: T(['Item Class: Skill Gems', 'Rarity: Gem', 'Spark', '--------', 'Spell, Projectile, Lightning, Duration', 'Level: 19', 'Mana Cost: 31', 'Cast Time: 0.70 sec',
    'Quality: +20% (augmented)', '--------', 'Requires: Level 90, 201 Int', '--------', 'Sockets: G G G G', '--------',
    'Launches a spray of sparking Projectiles that travel erratically along the ground until they hit an enemy or expire.', '--------', 'Corrupted']),
  lowGem: T(['Item Class: Skill Gems', 'Rarity: Gem', 'Lightning Conduit', '--------', 'Spell, AoE, Lightning', 'Level: 7', 'Mana Cost: 14', '--------', 'Requires: Level 22, 52 Int', '--------',
    'Sockets: G G', '--------', 'Call down a bolt of lightning.']),
  supportGem: T(['Item Class: Support Gems', 'Rarity: Gem', 'Immolate', '--------', 'Support, Fire', '--------', 'Requires: 5 Str', '--------', 'Supports Attacks, causing them to deal extra Fire damage to Ignited enemies.']),
  lineageSupport: T(['Item Class: Support Gems', 'Rarity: Gem', "Breachlord's Amalgam", '--------', 'Support, Lineage', '--------', 'Supports any Skill.']),
  uncutGem: T(['Item Class: Uncut Skill Gems', 'Rarity: Currency', 'Uncut Skill Gem', '--------', 'Level: 19', '--------', 'Creates a Skill Gem or Level an existing gem to level 19', '--------',
    'Right Click to engrave a Skill Gem.']),
  waystone: T(['Item Class: Waystones', 'Rarity: Rare', 'Grim Passage', 'Waystone (Tier 15)', '--------', 'Waystone Tier: 15', 'Revives Available: 1', 'Monster Pack Size: +12% (augmented)',
    'Rare Monsters: +21% (augmented)', 'Item Rarity: +38% (augmented)', 'Waystone Drop Chance: +105% (augmented)', '--------', 'Item Level: 80', '--------',
    '{ Prefix Modifier "Abundant" (Tier: 1) }', '32(30-40)% increased Quantity of Waystones found in Map', '{ Suffix Modifier "of the Horde" (Tier: 1) }', '18(15-20)% increased number of Monster Packs', '--------',
    'Can be used in a Map Device, allowing you to enter a Map. Waystones can only be used once.']),
  plainWaystone: T(['Item Class: Waystones', 'Rarity: Normal', 'Waystone (Tier 4)', '--------', 'Waystone Tier: 4', 'Revives Available: 5', '--------', 'Item Level: 68', '--------',
    'Can be used in a Map Device, allowing you to enter a Map. Waystones can only be used once.']),
  tablet: T(['Item Class: Tablet', 'Rarity: Magic', 'Teeming Breach Tablet of the Hunt', '--------', 'Item Level: 79', '--------', 'Adds an Otherworldy Breach to a Map (implicit)', '10 uses remaining (implicit)', '--------',
    'Breaches in Map have 15% increased Pack Size', '18% increased Quantity of Items found in Map', '--------', 'Can be used in a completed Tower on your Atlas to influence surrounding Maps.']),
  relic: T(['Item Class: Relics', 'Rarity: Magic', 'Stalwart Urn Relic of Suffusion', '--------', 'Item Level: 80', '--------', '+12% to Honour Resistance', '18% increased quantity of Relics dropped by Monsters', '--------',
    'Place this item on the Relic Altar at the start of the Trial of the Sekhemas']),
  charm: T(['Item Class: Charms', 'Rarity: Magic', 'Thawing Charm of Plenty', '--------', 'Lasts 3 Seconds', 'Consumes 40 of 40 Charges on use', 'Currently has 40 Charges', 'Used when you become Frozen',
    'Grants Immunity to Freeze', '--------', 'Requires: Level 12', '--------', 'Item Level: 70', '--------', '38% increased Duration', '27% increased Charges gained']),
  uniqueCharm: T(['Item Class: Charms', 'Rarity: Unique', 'Nascent Hope', 'Thawing Charm', '--------', 'Lasts 3 Seconds', 'Consumes 40 of 40 Charges on use', 'Currently has 40 Charges', '--------', 'Requires: Level 12', '--------',
    'Item Level: 81', '--------', '25% increased Charges gained', 'Energy Shield Recharge starts when you use this Charm']),
  barya: T(['Item Class: Trial Coins', 'Rarity: Normal', 'Djinn Barya', '--------', 'Area Level: 75', 'Number of Trials: 4', '--------', 'Item Level: 75', '--------',
    'Take this item to the Relic Altar at the Trial of the Sekhemas to enter the Trial.']),
  ultimatum: T(['Item Class: Inscribed Ultimatum', 'Rarity: Normal', 'Inscribed Ultimatum', '--------', 'Area Level: 78', 'Number of Trials: 10', '--------', 'Item Level: 78', '--------',
    'Take this item to The Temple of Chaos to participate in a Trial of Chaos.']),
  logbook: T(['Item Class: Expedition Logbooks', 'Rarity: Normal', 'Expedition Logbook', '--------', 'Area Level: 80', '--------', 'Item Level: 80', '--------', 'Take this item to Dannig in your Hideout to open portals to an expedition.']),
  unknown: T(['Item Class: Something New', 'Rarity: Normal', 'Brand New Thing', '--------', 'Item Level: 80']),
  staffWithSkill: T(['Item Class: Staves', 'Rarity: Rare', 'Doom Spire', 'Ashen Staff', '--------', 'Requires: Level 58, 133 Int', '--------', 'Item Level: 80', '--------', 'Grants Skill: Level 18 Firebolt', '--------',
    '{ Prefix Modifier "Flaming" (Tier: 3) }', '85% increased Spell Damage', '{ Suffix Modifier "of the Mind" (Tier: 2) }', '+25 to Intelligence']),
};
