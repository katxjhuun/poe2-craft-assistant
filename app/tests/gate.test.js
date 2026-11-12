// node --test app/tests/gate.test.js
// The verification gate (phase 1 of reports/roadmap.md): a route is offered only when its network's promise can be
// trusted, and recommended only when 100,000 replayed crafts keep it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../engine.js');
const NW = require('../network.js');
const kb = require(process.env.POE2_KB || path.join(__dirname, '..', '..', 'poe2_kb_0.5.5.json'));
const W = require('../data/weights_0.5.5.json');
const ix = E.buildIndex(kb);

const PRICES = { 'Orb of Transmutation': 0.2, 'Orb of Augmentation': 0.3, 'Regal Orb': 1, 'Exalted Orb': 1, 'Chaos Orb': 60, 'Orb of Annulment': 340 };
const priceOf = (n) => (PRICES[n] != null ? PRICES[n] : null);
const boots = (lines) => E.parseItem(ix, ['Item Class: Boots', ...lines].join('\n')).item;
const WHITE = ['Rarity: Normal', 'Totemic Greaves', '--------', 'Item Level: 82'];
function famOf(base, re, side) {
  for (const [id, pe] of E.poolFor(ix, kb.bases[base].sig)) { const m = kb.mods[id]; if (pe.side === side && re.test(m.txt.replace(/\n/g, ' / '))) return [m.fam, m.txt.split('\n')[0]]; }
  throw new Error('no family for ' + re);
}
function inputFor(item, wants) {
  const targets = {};
  wants.forEach(([side, re, tier], k) => { const [fam, label] = famOf(item.base, re, side); targets[side + '-' + k] = { fam, group: side, minTier: tier, required: true, label }; });
  const page = W.base_page[item.base];
  return { ix, item, targets, locks: {}, priceOf, baseCost: 1, weights: page && W.pages[page] ? W.pages[page].weights : null, essences: [] };
}
const MS = ['prefix', /increased Movement Speed$/, 3], FIRE = ['suffix', /to Fire Resistance$/, 3];

/** The same solved network, with its promise or its "settled" replaced (the cases the nineteenth deep run found). */
function variant(net, over) {
  const v = Object.create(net);
  if ('settled' in over) Object.defineProperty(v, 'settled', { get: () => over.settled });
  if ('cost' in over) v.cost = () => over.cost;
  return v;
}

test('gate: a network whose values did not settle, or that promises a negative or no number, offers no route', () => {
  const input = inputFor(boots(WHITE), [MS, FIRE]);
  const net = NW.route(input);
  assert.ok(net.settled && net.cost(net.start) > 0, 'the real network is settled and promises a cost');
  const ok = NW.answer(input, { solved: { net, charge: 0 } });
  assert.ok(ok.meanCost > 0 && ok.steps && ok.steps.length && ok.next && ok.next.names, 'the real network offers its route');
  assert.ok(!ok.refused);
  // Fortified Hammer, set4, "rare with other modifiers, only item" in the nineteenth deep run: -936,020,251 promised,
  // values not settled. Grasping Mail (x0.43), Seastorm Mantle, Aegis Quarterstaff, Corsair Coat: not settled.
  const cases = [
    ['negative and not settled (Fortified Hammer)', { cost: -936020250.9, settled: false }],
    ['negative, settled', { cost: -1 }],
    ['not settled, positive (Grasping Mail)', { cost: 4610280.8, settled: false }],
    ['no number', { cost: NaN }],
    ['infinite', { cost: Infinity }],
  ];
  for (const [what, over] of cases) {
    const a = NW.answer(input, { solved: { net: variant(net, over), charge: 0 } });
    assert.ok(a.refused && a.refused.length, what + ': refused');
    assert.equal(a.steps, null, what + ': no materials');
    assert.ok(!a.next && !(a.options && a.options.length) && !(a.rules && a.rules.length), what + ': no step, option or rule is shown');
    assert.ok(!(a.meanCost >= 0), what + ': no cost is shown as the route\'s');
  }
});
