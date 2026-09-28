// Price check: Exiled Exchange 2's trade search built for every kind of item (app/pricecheck.js).
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');
const PC = require('../pricecheck.js');
const kb = require(process.env.POE2_KB || '../../poe2_kb_0.5.5.json');
const ix = E.buildIndex(kb);

const parse = (lines) => E.parseItem(ix, lines.join('\n')).item;
const presets = (it) => PC.createPresets(ix, E, it);
const body = (it, id) => { const pr = presets(it); const p = pr.presets.find((x) => x.id === (id || pr.active)); return PC.tradeRequest(ix, E, p, it); };
const ids = (b) => b.query.stats[0].filters.map((f) => f.id);

const RARE = ['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Quality: +12% (augmented)', 'Armour: 402 (augmented)', '--------',
  'Item Level: 82', '--------', '{ Prefix Modifier "" (Tier: 5) }', '+120 to maximum Life', '{ Prefix Modifier "" (Tier: 7) }', '35% increased Armour',
  '{ Suffix Modifier "" (Tier: 4) }', '+30% to Fire Resistance', '{ Suffix Modifier "" (Tier: 5) }', '+25% to Cold Resistance', '{ Suffix Modifier "" (Tier: 6) }', '+20 to Strength'];

test('rare item: category search with the pseudo totals and armour at 20% quality, as Exiled Exchange 2 builds it', () => {
  const it = parse(RARE);
  const pr = presets(it);
  assert.deepEqual(pr.presets.map((p) => p.id), ['pseudo', 'exact']);
  const b = body(it);
  assert.equal(b.query.filters.type_filters.filters.category.option, 'armour.chest');
  assert.equal(b.query.type, undefined);
  assert.equal(b.query.filters.type_filters.filters.rarity.option, 'nonunique');
  assert.deepEqual(ids(b), ['pseudo.pseudo_total_elemental_resistance', 'pseudo.pseudo_total_life']);
  // 55% total elemental resistance, -10%; life 120 + 2 per Strength
  assert.equal(b.query.stats[0].filters[0].value.min, 49);
  assert.equal(pr.presets[0].stats.find((s) => s.ref === '+# total maximum Life').roll.value, 160);
  // armour at 20% quality: 402 x (100 + 35 + 20) / (100 + 35 + 12)
  assert.equal(b.query.filters.equipment_filters.filters.ar.min, Math.floor(Math.round(402 * 155 / 147) * 0.9));
  assert.deepEqual(b.query.filters.misc_filters.filters, { corrupted: { option: 'false' }, mirrored: { option: 'false' }, sanctified: { option: 'false' } });
  assert.equal(b.query.status.option, 'securable');
  assert.deepEqual(b.sort, { price: 'asc' });
  assert.match(PC.tradeUrl('Forbidden Rites', b), /^https:\/\/www\.pathofexile\.com\/trade2\/search\/poe2\/Forbidden%20Rites\?q=/);
  // base item preset: the base type, item level, not fractured
  const x = body(it, 'exact');
  assert.equal(x.query.type, 'Heavy Plate');
  assert.equal(x.query.filters.type_filters.filters.ilvl.min, 82);
  assert.equal(x.query.filters.misc_filters.filters.fractured_item.option, 'false');
});

test('unique: name and base, variable lines with a share of their range; normal base: exact search', () => {
  const u = parse(["Item Class: Rings", "Rarity: Unique", "Ventor's Gamble", "Gold Ring", "--------", "Item Level: 82", "--------", "12% increased Rarity of Items found (implicit)",
    "--------", "+40 to maximum Life", "12% increased Rarity of Items found", "+20% to Fire Resistance", "-10% to Cold Resistance", "+35% to Lightning Resistance"]);
  const b = body(u);
  assert.equal(b.query.name, "Ventor's Gamble");
  assert.equal(b.query.type, 'Gold Ring');
  assert.equal(b.query.filters.type_filters, undefined, 'no rarity or category on a unique');
  const res = presets(u).presets[0].stats.find((s) => s.ref === '#% total Elemental Resistance');
  assert.equal(res.roll.value, 45, 'a negative resistance counts against the total');
  const w = parse(['Item Class: Body Armours', 'Rarity: Normal', 'Heavy Plate', '--------', 'Armour: 300', '--------', 'Item Level: 82']);
  const pw = presets(w);
  assert.deepEqual(pw.presets.map((p) => p.id), ['exact']);
  const bw = body(w);
  assert.equal(bw.query.type, 'Heavy Plate');
  assert.equal(bw.query.filters.type_filters.filters.rarity.option, 'normal');
  assert.equal(bw.query.filters.type_filters.filters.ilvl.min, 82);
});

test('corrupted, twice corrupted, sanctified, desecrated and Magic jewels', () => {
  const twice = parse(['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '{ Corruption Implicit Modifier }', '+35 to maximum Life', '{ Corruption Implicit Modifier }', '+1% to all Maximum Elemental Resistances', '--------',
    '{ Prefix Modifier "" (Tier: 5) }', '+120 to maximum Life', '{ Suffix Modifier "" (Tier: 4) }', '+30% to Fire Resistance', '--------', 'Corrupted']);
  const bt = body(twice);
  assert.equal(bt.query.filters.misc_filters.filters.corrupted, undefined, 'a corrupted item searches corrupted and uncorrupted ones (Exiled Exchange 2)');
  assert.ok(ids(bt).some((id) => /^enchant\./.test(id)), 'the Corruption Enchantments are searched');
  assert.equal(presets(twice).presets[0].stats.find((s) => s.ref === '+# total maximum Life').roll.value, 155, 'the enchantment life counts in the total');
  const sanct = parse(['Item Class: Rings', 'Rarity: Rare', 'Test', 'Ruby Ring', '--------', 'Item Level: 82', '--------', '+60 to maximum Life', '+30% to Cold Resistance', '--------', 'Sanctified']);
  assert.equal(body(sanct).query.filters.misc_filters.filters.sanctified.option, 'true');
  const des = parse(['Item Class: Rings', 'Rarity: Rare', 'Test', 'Ruby Ring', '--------', 'Item Level: 82', '--------', '{ Prefix Modifier "" (Tier: 1) }', '+60(55-64) to maximum Life',
    '{ Desecrated Suffix Modifier "" (Tier: 1) }', '+12(9-15) to Strength and Intelligence']);
  // pseudo: the desecrated Strength and Intelligence joins the totals; base item: it searches as a desecrated stat
  assert.equal(presets(des).presets[0].stats.find((s) => s.ref === '+# total maximum Life').roll.value, 84);
  assert.ok(presets(des).presets[1].stats.some((s) => s.type === 'desecrated' && /^desecrated\./.test(s.ids.desecrated[0])));
  const jewel = parse(['Item Class: Jewels', 'Rarity: Magic', 'Sharp Emerald of Test', 'Emerald', '--------', 'Item Level: 80', '--------', '12% increased Attack Speed']);
  const bj = body(jewel);
  assert.equal(bj.query.filters.type_filters.filters.rarity.option, 'magic');
  assert.equal(bj.query.filters.type_filters.filters.category.option, 'jewel');
});
