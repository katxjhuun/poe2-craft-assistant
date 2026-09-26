// Real items from the user's screenshots, transcribed into the format the screenshot reader outputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../engine.js');
const SCREENS = require('./fixtures/screens.js');
const ix = E.buildIndex(require(process.env.POE2_KB || path.join(__dirname, '..', '..', 'poe2_kb_0.5.5.json')));

for (const f of SCREENS) {
  test(`screenshot item: ${f.id}`, () => {
    const { item, warnings } = E.parseItem(ix, f.text);
    const x = f.expect;
    const count = (p) => item.mods.filter(p).length;
    assert.equal(item.base, x.base);
    assert.equal(item.rarity, x.rarity);
    assert.equal(count((m) => m.desecrated), x.des, 'desecrated');
    assert.equal(count((m) => m.fractured), x.frac, 'fractured');
    assert.equal(count((m) => m.crafted), x.crafted, 'crafted');
    assert.equal(count((m) => m.unrevealed), x.unrevealed, 'unrevealed');
    if (x.corrupted) assert.ok(item.flags.corrupted);
    if (x.sanctified) assert.ok(item.flags.sanctified);
    if (x.mirrored) assert.ok(item.flags.mirrored);
    if (x.vaal) assert.equal(count((m) => m.vaal), x.vaal, 'vaal');
    if (x.runes) assert.equal(item.runes.filter((r) => r.kind === 'rune').length, x.runes, 'runes');
    if (x.enchants) assert.equal(item.runes.filter((r) => r.kind === 'enchant').length, x.enchants, 'enchants');
    if (x.implicits) assert.equal(item.implicits.length, x.implicits, 'implicits');
    if (x.limits) assert.deepEqual(E.slotLimits(item), x.limits);
    if (x.grants) assert.ok((item.props || []).flat().some((l) => /^Grants Skill/.test(l)));
    if (x.flavour) assert.ok(item.flavour && item.flavour.length, 'flavour text');
    assert.ok(!warnings.some((w) => w.level === 'error'), warnings.filter((w) => w.level === 'error').map((w) => w.msg).join(' | '));
    if (item.rarity !== 'Unique') assert.ok(item.mods.every((m) => m.modId || m.unrevealed), 'every mod matched');
  });
}

// 10.3: the text and a screenshot reading of the same item converge; differences are listed.
test('10.3 text and screenshot readings: identical -> no differences; misreads are listed', () => {
  const text = SCREENS[0].text;
  const a = E.parseItem(ix, text).item;
  assert.deepEqual(E.diffItems(a, E.parseItem(ix, text).item), []);
  const ocr = text
    .replace('18(15-18)% increased Rarity', '16(15-18)% increased Rarity')         // misread digit
    .replace('{ Crafted Suffix Modifier (Tier: 3) }', '{ Suffix Modifier (Tier: 3) }') // missed the crafted marker
    .replace('Item Level: 80', 'Item Level: 86');
  const d = E.diffItems(a, E.parseItem(ix, ocr).item);
  assert.ok(d.some((x) => x.kind === 'field' && x.text === 'Item level' && x.a === 80 && x.b === 86), 'item level');
  assert.ok(d.some((x) => x.kind === 'value' && /Rarity of Items/.test(x.text) && x.a === '18' && x.b === '16'), 'value');
  assert.ok(d.some((x) => x.kind === 'flag' && /Cold Resistance: crafted/.test(x.text)), 'crafted flag');
  assert.ok(!d.some((x) => x.kind === 'only-a' || x.kind === 'only-b'), 'mods still pair up');
});

test('5.1 an unreadable item level (?) stays unknown instead of a wrong number', () => {
  const r = E.parseItem(ix, SCREENS[0].text.replace('Item Level: 80', 'Item Level: 8?'));
  assert.equal(r.item.ilvl, null);
  assert.ok(r.warnings.some((w) => /item level could not be read/.test(w.msg)));
  assert.ok(!r.warnings.some((w) => w.level === 'error'), 'no false tier errors');
});

test('plain Ctrl+C: a three-line hybrid is read as one modifier (self-test finding)', () => {
  const text = ['Item Class: Body Armours', 'Rarity: Rare', 'Test Subject', 'Austere Garb', '--------', 'Item Level: 82', '--------',
    '11% increased Evasion and Energy Shield', '+2 to Evasion Rating', '+3 to maximum Energy Shield'].join('\n');
  const { item } = E.parseItem(ix, text);
  assert.equal(item.mods.length, 1);
  assert.match(item.mods[0].modId, /^LocalIncreasedEvasionAndEnergyShieldAndBase/);
});
