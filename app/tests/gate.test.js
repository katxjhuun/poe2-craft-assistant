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

const G = require('../gate.js');
const LEDGER = require('../data/rules_ledger.json');

test('gate: a route is recommended only when the 95% interval of 100,000 crafts lies within 2% and 0.5 points', () => {
  // (cost sd 50 on a promise of 100: se 0.16 over 100,000 crafts, the interval +-0.31%)
  const ok = G.verdict({ cost: 100, p: 1 }, { runs: 100000, done: 100000, mean: 100.5, sd: 50 });
  assert.equal(ok.label, 'recommend', ok.why.join('; '));
  // the same spread over 2,000 crafts: the interval is +-2.2%, wider than the bound
  const few = G.verdict({ cost: 100, p: 1 }, { runs: 2000, done: 2000, mean: 100, sd: 50 });
  assert.equal(few.label, 'unsure');
  // played 3% over the promise, however many crafts
  assert.equal(G.verdict({ cost: 100, p: 1 }, { runs: 100000, done: 100000, mean: 103, sd: 50 }).label, 'unsure');
  // 0.7% of the crafts never end where the route promises they all do
  const lost = G.verdict({ cost: 100, p: 1 }, { runs: 100000, done: 99300, mean: 100, sd: 50 });
  assert.equal(lost.label, 'unsure');
  assert.ok(lost.why.some((w) => /success/.test(w)));
  // a route on a rule nobody knows is never a recommendation; a weak rule is a warning
  const unk = G.verdict({ cost: 100, p: 1 }, { runs: 100000, done: 100000, mean: 100, sd: 50 }, [{ id: 'A_RUNE_POOL_WEIGHT', status: 'unknown' }, { id: 'k24', status: 'weak' }]);
  assert.equal(unk.label, 'unsure');
  assert.deepEqual(unk.weak, ['k24']);
  // no trusted promise: never
  assert.equal(G.verdict({ cost: -936020250.9, p: 1 }, { runs: 100000, done: 100000, mean: 5314114, sd: 1 }).label, 'unsure');
  assert.ok(G.craftsFor(0.5) > 2000 && G.craftsFor(0.5) < 3000, 'cv 0.5: (1.96 x 0.5 / 0.02)^2 = 2,401 crafts');
});

test('gate: median, P90 and worst of the played costs; the stamp names the rules a route uses', () => {
  const s = G.spread([5, 1, 4, 2, 3, 10, 6, 7, 8, 9]);
  assert.deepEqual([s.median, s.p90, s.worst, s.best], [5, 9, 10, 1]);
  // a bone on an item with a pool rune rests on the unknown weight of the rune's pool at the Well of Souls (t33)
  const rules = G.rulesOfRoute([{ op: 'exalt', tier: 'greater' }, { op: 'bone', putrefy: true }], { cls: 'Wand', poolRune: true }, LEDGER);
  const ids = rules.map((r) => r.id);
  for (const id of ['R_RARITY_SLOTS', 'k24', 'A_DESECRATE_SIDE', 'k63', 'A_RUNE_POOL_WEIGHT']) assert.ok(ids.includes(id), id);
  assert.equal(rules.find((r) => r.id === 'A_RUNE_POOL_WEIGHT').status, 'unknown');
  assert.ok(rules.every((r) => r.status !== 'missing'), 'every rule is in the ledger');
  // a rule change makes only the results that use the rule stale
  const result = { stamp: G.stamp(LEDGER, rules, '2026-11-09') };
  assert.deepEqual(G.staleRules(result, LEDGER), []);
  const changed = JSON.parse(JSON.stringify(LEDGER));
  changed.rules.k63.status = 'verified';
  changed.rules.k63.hash = G.ruleHash({ id: 'k63', status: 'verified', rule: 'x' });
  changed.rules.k56.hash = '00000000';
  assert.deepEqual(G.staleRules(result, changed), ['k63']);
});

test('gate: the rules of a route include the steps after a new start (a wand\'s bone after a restart)', () => {
  // a pasted item (node 0) whose only step gives it up (outcome -1: the network's start n0 = 2), where a bone is used
  const steps = { 0: { a: { op: 'chaos' }, out: [1, -1] }, 2: { a: { op: 'bone', mark: true }, out: [1, 3] } };
  const net = { start: 0, n0: 2, done: (s) => s === 3, step: (s) => steps[s] || null };
  const ops = G.routeActions(net).acts.map((a) => a.op);
  assert.deepEqual(ops.sort(), ['bone', 'chaos']);
  const ids = G.rulesOfRoute(G.routeActions(net).acts, { cls: 'Wand' }, LEDGER).map((r) => r.id);
  assert.ok(ids.includes('k59') && ids.includes('A_DESECRATE_SIDE'));
});
