/* Where the gap between the promised and the played cost of a route comes from, node by node.
 *
 * played - promised = the sum over the network's nodes of (visits per craft) x (what the step leads to in play - what
 * the network says it leads to), both valued with the network's own costs. So every node's share of the gap is exact,
 * and the outcome that carries it can be named: this is how a wrong chance in the network is found (on wands the
 * network once promised half of what a craft costs; this measure pointed at the modifier the other side's tags stop).
 *
 *   node scripts/selftest/network_gap.js "<base>" <k | nK> [crafts] [seconds] [rows]
 *
 * <k>: the k-th special request of the sweep for that base (0 value, 1 another element, 2 rune pool, 3 four suffixes,
 * 4 five modifiers on a jewel, 5 two crafted-only modifiers); n<K>: its K-th drawn scenario (network_sweep.js);
 * id:<scenario id>: the scenario a sweep report names (as it was drawn before the special requests);
 * fams:<family>[@tier],...: a white base and these natural modifiers (family names as the sweep reports print them).
 * A single process and a few hundred crafts: fine next to the game. Many crafts belong in the cloud workflow.
 */
'use strict';
const path = require('path');
const { ROOT, E, load, weightsFor, rng, renderItem } = require('./lib.js');
const { labelOf } = require('./scenarios.js');
const NW = require(path.join(ROOT, 'app', 'network.js'));
const SW = require('./network_sweep.js');
const { play } = require('./network_check.js');
const { ix, priceOf } = load();
const [base, kStr, runsStr, secStr, rowsStr] = process.argv.slice(2);
const t = SW.table(base);
const singles = t.nat.prefix.length + t.nat.suffix.length + t.des.prefix.length + t.des.suffix.length;
let sc = null;
if (/^id:/.test(kStr)) { for (let n = 0; n < 600 && !sc; n++) { let x = null; try { x = SW.scenario(base, n, true); } catch (e) { x = null; } if (x && x.id === kStr.slice(3)) sc = x; } }
else if (/^fams:/.test(kStr)) {
  const targets = {};
  kStr.slice(5).split(',').forEach((x, k) => {
    const [fam, tier] = x.split('@'), f = t.nat.prefix.concat(t.nat.suffix).find((y) => y.fam === fam);
    if (!f) { console.log(`no natural family ${fam} on ${base}`); console.log('prefixes:', t.nat.prefix.map((y) => y.fam).join(' ')); console.log('suffixes:', t.nat.suffix.map((y) => y.fam).join(' ')); process.exit(1); }
    targets[f.side + '-' + k] = { fam, group: f.side, minTier: tier ? +tier : f.tiers[0], required: true, label: labelOf(f.ids[f.tiers[0]]) };
  });
  sc = { id: base + '|' + kStr, kind: 'named families, white', seed: 7, targets, item: E.parseItem(ix, renderItem({ base, cls: t.cls, rarity: 'Normal', ilvl: 82, mods: [] }, rng(7), 'adv').text).item };
} else sc = SW.scenario(base, /^n/.test(kStr) ? singles + +kStr.slice(1) : singles + 6 * (+kStr) + 5);
if (!sc) { console.log('no such scenario'); process.exit(1); }
const input = { ix, item: sc.item, targets: sc.targets, locks: {}, priceOf, baseCost: 1, weights: weightsFor(base), essences: t.essences, quality: sc.qualityMode };
const net = NW.route(input);
const s = net.start, want = net.cost(s);
console.log(sc.id, '|', sc.kind);
console.log('targets:', net.goals.map((g) => `${g.label} [${g.side}, ${g.kind}${g.tier ? ', T' + g.tier : ''}${g.minValue != null ? ', >=' + g.minValue : ''}]`).join(' | '));
console.log('item:', sc.item.rarity, sc.item.mods.map((m) => `${m.slot[0]}:${m.fam || m.text}${m.fractured ? '(F)' : ''}${m.desecrated ? '(D)' : ''}`).join(', '));
const steps = net.materials(s).reduce((x, m) => x + m.uses, 0);
const audit = new Map();
const got = play(net, input, +runsStr || 200, sc.seed, Math.max(5000, Math.round(steps * 60)), (+secStr || 60) * 1000, audit);
console.log(`${net.N} nodes | promised ${want.toFixed(1)} | played ${isFinite(got.mean) ? got.mean.toFixed(1) : '-'} ±${(got.se || 0).toFixed(1)} (x${(got.mean / want).toFixed(3)}) over ${got.runs}${got.off ? ', OFF ' + got.off : ''}${got.done < got.runs ? ', unfinished ' + (got.runs - got.done) : ''}`);
const d = (k) => {
  if (k < 0) return 'OFF NETWORK';
  const w = net.describe(k);
  return `${w.rarity} has[${w.has.join('; ')}]${w.low.length ? ' low[' + w.low.join(';') + ']' : ''}${w.twin.length ? ' twin[' + w.twin.join(';') + ']' : ''}${w.inWay.length ? ' inWay[' + w.inWay.join(';') + ']' : ''}${(w.across || []).length ? ' across[' + w.across.join(';') + ']' : ''}${w.runes.length ? ' runes[' + w.runes.join(';') + ']' : ''}${(w.lowestOther || []).map((x) => ' low ' + x.side[0] + '[' + (x.from == null ? '' : x.from) + '..' + (x.under == null ? '' : x.under) + ')').join('')} others ${w.otherPrefixes}/${w.otherSuffixes}${w.hidden ? ' hidden ' + w.hidden : ''}${w.desecratedOther ? ' desOther ' + w.desecratedOther : ''}${w.fracturedOther ? ' fracOther' : ''}${w.allowance ? ' allowance' : ''}${net.done(k) ? ' DONE' : ''}`;
};
const V = (k) => (k < 0 ? NaN : net.cost(k));
const rows = [];
let total = 0;
for (const [node, rec] of audit) {
  const step = net.step(node);
  if (!step) continue;
  const model = new Map();
  for (let q = 0; q < step.out.length; q += 2) { const k = step.out[q + 1] === -1 ? net.n0 : step.out[q + 1]; model.set(k, (model.get(k) || 0) + step.out[q]); }
  let gap = 0;
  const parts = [];
  for (const k of new Set([...model.keys(), ...rec.to.keys()])) {
    const m = model.get(k) || 0, g = (rec.to.get(k) || 0) / rec.n;
    if (k < 0) continue;
    const c = (g - m) * V(k);
    gap += c;
    parts.push({ k, m, g, c });
  }
  const share = gap * rec.n / got.runs;
  total += share;
  rows.push({ node, n: rec.n, share, step, parts });
}
console.log(`gap played - promised: ${(got.mean - want).toFixed(1)}; explained by the nodes below: ${total.toFixed(1)}`);
if (audit.refused && audit.refused.length) {
  console.log(`steps the simulator's rules refuse: ${audit.refused.length}`);
  const seenR = new Set();
  for (const x of audit.refused) { const k = JSON.stringify(x.a) + x.why; if (seenR.has(k) || seenR.size >= 5) continue; seenR.add(k); console.log(`   ${JSON.stringify(x.a)}: ${x.why}
      on ${x.item}`); }
}
if (audit.maps && (audit.maps[1] || audit.maps[2])) console.log(`items the network placed without what a blocker's tags stop: ${audit.maps[1]}, without their blockers: ${audit.maps[2]}, of ${audit.maps[0] + audit.maps[1] + audit.maps[2]}`);
// crafts that left the network: the node, the step and the item the network has no node for
if (audit.offs && audit.offs.length) {
  console.log(`
${audit.offs.length} craft(s) left the network:`);
  const seen = new Set();
  for (const o of audit.offs) { const k = o.from + '|' + JSON.stringify(o.a); if (seen.has(k) || seen.size >= 6) continue; seen.add(k); console.log(`   from ${d(o.from)}
     by ${JSON.stringify(o.a)}
     to an item with ${o.item}
     its state: ${o.state}
     the node it came from: ${JSON.stringify(net.states[o.from])}`); const st = net.step(o.from); if (st) { const rows = []; for (let q = 0; q < st.out.length; q += 2) rows.push([st.out[q], st.out[q + 1]]); rows.sort((x, y) => y[0] - x[0]); for (const [p, k2] of rows.slice(0, 8)) console.log(`        the network: ${(p * 100).toFixed(2)}% ${k2 < 0 ? 'NEW BASE' : d(k2)}`); } }
}
rows.sort((a, b) => Math.abs(b.share) - Math.abs(a.share));
for (const x of rows.slice(0, +rowsStr || 8)) {
  console.log(`\n${x.share >= 0 ? '+' : ''}${x.share.toFixed(1)}  (${(x.n / got.runs).toFixed(1)} visits per craft)  ${d(x.node)} -> ${x.step.names.join(' + ') || x.step.a.op}${x.step.a.hide ? ' (hide)' : ''}  ${JSON.stringify(x.step.a)}`);
  x.parts.sort((a, b) => Math.abs(b.g - b.m) - Math.abs(a.g - a.m));
  for (const p of x.parts.slice(0, 6)) console.log(`      model ${(p.m * 100).toFixed(2).padStart(6)}%  played ${(p.g * 100).toFixed(2).padStart(6)}%  value ${V(p.k).toFixed(0).padStart(7)}  -> ${d(p.k)}`);
}
