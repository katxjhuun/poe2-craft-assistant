// node --test app/tests
// The craft network (app/network.js): its bookkeeping, and its costs against the simulator on a few items.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../engine.js');
const P = require('../planner.js');
const NW = require('../network.js');
const kb = require(process.env.POE2_KB || path.join(__dirname, '..', '..', 'poe2_kb_0.5.5.json'));
const W = require('../data/weights_0.5.5.json');
const ix = E.buildIndex(kb);

// prices of a test world (Exalted Orbs): cheap basics, dear omens
const PRICES = {
  'Orb of Transmutation': 0.2, 'Greater Orb of Transmutation': 1, 'Perfect Orb of Transmutation': 20, 'Orb of Augmentation': 0.3, 'Greater Orb of Augmentation': 4,
  'Perfect Orb of Augmentation': 100, 'Regal Orb': 1, 'Greater Regal Orb': 5, 'Perfect Regal Orb': 20, 'Exalted Orb': 1, 'Greater Exalted Orb': 5, 'Perfect Exalted Orb': 1000,
  'Chaos Orb': 60, 'Greater Chaos Orb': 180, 'Perfect Chaos Orb': 2000, 'Orb of Annulment': 340, 'Fracturing Orb': 3400, 'Omen of Light': 3600,
  'Omen of Sinistral Exaltation': 300, 'Omen of Dextral Exaltation': 300, 'Omen of Sinistral Erasure': 5000, 'Omen of Dextral Erasure': 5000,
  'Omen of Sinistral Annulment': 5000, 'Omen of Dextral Annulment': 5000, 'Omen of Sinistral Necromancy': 1, 'Omen of Dextral Necromancy': 3,
  'Omen of Abyssal Echoes': 90, 'Preserved Rib': 7, 'Ancient Rib': 2800, 'Preserved Collarbone': 7, 'Preserved Jawbone': 7,
};
const priceOf = (n) => (PRICES[n] != null ? PRICES[n] : null);
const boots = (lines) => E.parseItem(ix, ['Item Class: Boots', ...lines].join('\n')).item;
const WHITE = ['Rarity: Normal', 'Totemic Greaves', '--------', 'Item Level: 82'];
function famOf(base, re, side) {
  for (const [id, pe] of E.poolFor(ix, kb.bases[base].sig)) { const m = kb.mods[id]; if (pe.side === side && re.test(m.txt.replace(/\n/g, ' / '))) return [m.fam, m.txt.split('\n')[0]]; }
  throw new Error('no family for ' + re);
}
function inputFor(item, wants, extra) {
  const targets = {};
  wants.forEach(([side, re, tier], k) => { const [fam, label] = famOf(item.base, re, side); targets[side + '-' + k] = { fam, group: side, minTier: tier, required: true, label }; });
  const page = W.base_page[item.base];
  return Object.assign({ ix, item, targets, locks: {}, priceOf, baseCost: 1, weights: page && W.pages[page] ? W.pages[page].weights : null, essences: [] }, extra);
}
const MS = ['prefix', /increased Movement Speed$/, 3], LIFE = ['prefix', /to maximum Life$/, 3], FIRE = ['suffix', /to Fire Resistance$/, 3];

test('network: the materials add up to the cost, and a larger budget is never less likely to hold', () => {
  const net = NW.build(inputFor(boots(WHITE), [MS, FIRE]));
  const s = net.start;
  const sum = net.materials(s).reduce((t, m) => t + m.cost, 0);
  assert.ok(Math.abs(sum - net.cost(s)) < 1e-6 * net.cost(s), `${sum} vs ${net.cost(s)}`);
  let last = 0;
  for (const b of [1, 10, 100, 1000, 1e5]) { const p = net.within(s, b); assert.ok(p >= last - 1e-12 && p <= 1); last = p; }
  assert.ok(last > 0.999);
  assert.ok(net.step(s).names[0].includes('Transmutation'));
});

test('network: one target by transmute alone is a closed form (cost per try over chance)', () => {
  // only the two cheapest orbs have a price: every miss is a new base, so cost = (transmute + base) / p - base
  const only = (n) => (n === 'Orb of Transmutation' ? 1 : null);
  const net = NW.build(inputFor(boots(WHITE), [MS], { priceOf: only, baseCost: 2 }));
  const s = net.start, st = net.step(s);
  const p = net.hit(s);
  assert.equal(st.a.op, 'transmute');
  assert.ok(p > 0 && p < 1);
  assert.ok(Math.abs(net.cost(s) - ((1 + 2) / p - 2)) < 1e-6 * net.cost(s));
  assert.ok(Math.abs(net.bases(s) - (1 / p - 1)) < 1e-6 / p);
});

test('network: an item that has every target costs nothing; an impossible tier is named', () => {
  const have = boots(['Rarity: Magic', 'Totemic Greaves', '--------', 'Item Level: 82', '--------', '{ Prefix Modifier "Hellion\'s" (Tier: 1) — Speed }', '35(35-35)% increased Movement Speed']);
  const net = NW.build(inputFor(have, [MS]));
  assert.ok(net.done(net.start));
  assert.equal(net.cost(net.start), 0);
  const low = boots(['Rarity: Normal', 'Totemic Greaves', '--------', 'Item Level: 60']);
  const no = NW.build(inputFor(low, [['prefix', /increased Movement Speed$/, 1]]));
  assert.ok(no.impossible && /item level/.test(no.impossible[0].why));
});

test('network: fewer bases cost more, and the route then repairs instead of starting over', () => {
  const net = NW.build(inputFor(boots(WHITE), [MS, LIFE, FIRE]));
  const s = net.start;
  const free = net.cost(s), bases = net.bases(s);
  assert.ok(bases > 5);
  net.fitBases(s, 3);
  assert.ok(net.bases(s) <= 3 + 1e-6);
  assert.ok(net.cost(s) > free);
  const sum = net.materials(s).reduce((t, m) => t + m.cost, 0);
  assert.ok(Math.abs(sum - net.cost(s)) < 1e-6 * net.cost(s));
  net.fitBases(s, 1e9);
  assert.ok(Math.abs(net.cost(s) - free) < 1e-6 * free);
});

test('network: a fractured target is never removed, and buying a start is worth something', () => {
  const frac = boots(['Rarity: Rare', 'Test', 'Totemic Greaves', '--------', 'Item Level: 82', '--------',
    '{ Fractured Prefix Modifier "Hellion\'s" (Tier: 1) — Speed }', '35(35-35)% increased Movement Speed',
    '{ Suffix Modifier "of the Whelpling" (Tier: 8) — Elemental, Fire, Resistance }', '+8(6-10)% to Fire Resistance']);
  const net = NW.build(inputFor(frac, [['prefix', /increased Movement Speed$/, 1], ['suffix', /to Fire Resistance$/, 2]]));
  const d = net.describe(net.start);
  assert.ok(d.has.some((x) => /fractured/.test(x)));
  // (lines after "New base" are about the white base that replaces the item)
  for (const r of net.rules(net.start, 40)) assert.ok(r.done || r.fresh || r.when.has.some((x) => /Movement Speed/.test(x)), 'the fractured target stays on every node of the route');
  const white = NW.build(inputFor(boots(WHITE), [['prefix', /increased Movement Speed$/, 1], ['suffix', /to Fire Resistance$/, 2]]));
  assert.ok(white.entries().some((e) => e.kind === 'magic' && e.worth > 0));
});

test('network: its promise matches the simulator (two items, played 600 times each)', () => {
  const { play } = require('../../scripts/selftest/network_check.js');
  for (const wants of [[MS], [LIFE, FIRE]]) {
    const input = inputFor(boots(WHITE), wants);
    const net = NW.build(input);
    const got = play(net, input, 600, 11, 20000);
    assert.equal(got.done, 600);
    assert.equal(got.off, 0);
    assert.ok(Math.abs(got.mean - net.cost(net.start)) <= 4 * got.se + 0.05 * net.cost(net.start), `${got.mean} ± ${got.se} vs ${net.cost(net.start)}`);
  }
});
