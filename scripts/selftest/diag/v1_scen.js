// PoE2 1.0 scenarios, small and local: a sweep scenario on an item of item level 64 (Forgemarks work up to 64), the
// network with 1.0 on (input.v1) beside the same network with it off, the route's reforge steps, and the play of the
// 1.0 route: does it keep its promise?
//   node v1_scen.js <crafts> <base> <n> [<n> ...]        (env: POE2_OUT; V1_ILVL, default 64)
// The Forgemark items have no price before the exchange trades them (app/data/leagues.json): the run assumes one,
// V1_FORGE_PRICE Exalted Orbs (default: the Fracturing Orb's price), and says so. Each result notes the rules (planner
// V1_RULES) and the price date it used.
const { L, NW, SW, play, inputOf, targetsAt } = require('./common.js');
// (V1_FORGE_PRICE defaults to the Fracturing Orb's price; 1.0 prices are unknown)
const [crafts, base, ...ns] = process.argv.slice(2);
const { P, priceOf, snap } = Object.assign({ P: require('../../../app/planner.js') }, L.load());
const ILVL = +(process.env.V1_ILVL || 64);
const FORGE = process.env.V1_FORGE_PRICE != null ? +process.env.V1_FORGE_PRICE : priceOf('Fracturing Orb');
const items = ['Crimson Iron', 'Scarlet Hide', 'Vermilion Gold'];
const pricedV1 = (n) => (items.includes(n) ? FORGE : priceOf(n));
console.log(`rules ${JSON.stringify(P.V1_RULES)} | prices ${snap.meta.updatedAt || snap.source} | assumed: ${items.join(', ')} = ${FORGE} ex (unpriced) | item level ${ILVL}`);
for (const n of ns) {
  let sc = null;
  try { sc = SW.scenario(base, +n, true); } catch (e) { sc = null; }
  if (!sc) { console.log(n, 'no scenario'); continue; }
  const item = Object.assign({}, sc.item, { ilvl: ILVL });
  const targets = targetsAt(sc, ILVL);
  const input = inputOf(sc, { item, priceOf: pricedV1, targets });
  const t0 = Date.now();
  const off = NW.build(Object.assign({}, input));
  const t1 = Date.now();
  const on = NW.build(Object.assign({}, input, { v1: true }));
  const t2 = Date.now();
  const bad = (x) => !x || x.unsupported || x.impossible || x.blocked;
  if (bad(off) || bad(on)) { console.log(sc.id, 'not built:', JSON.stringify((on && (on.unsupported || on.impossible || on.blocked)) || (off && (off.unsupported || off.impossible || off.blocked)))); continue; }
  // how many nodes have a second fractured modifier, and how many nodes' best step is a reforge
  let two = 0, best = 0;
  for (let s = 0; s < on.N; s++) { const S = on.states[s]; if (S.fh >= 0 || S.fk) two++; const a = (on.step(s) || {}).a; if (a && a.op === 'reforge') best++; }
  const first = (() => { let s = on.start; for (let k = 0; k < 60; k++) { const st = on.step(s); if (!st) return null; if (st.a.op === 'reforge') return st.a; let b = -1, bp = -1; const e = on.acts[s].find((x) => x.a === st.a); if (!e) return null; for (let q = 0; q < e.out.length; q += 2) if (e.out[q] > bp && e.out[q + 1] >= 0) { bp = e.out[q]; b = e.out[q + 1]; } if (b < 0) return null; s = b; } return null; })();
  console.log(`n ${n} ${sc.id}: off ${off.cost(off.start).toFixed(2)} (${off.N} nodes, ${t1 - t0} ms) | on ${on.cost(on.start).toFixed(2)} (${on.N} nodes, ${t2 - t1} ms) | reforge best at ${best} nodes, two fractured at ${two} | on the likely path: ${first ? JSON.stringify(first.marks) : 'none'}`);
  if (+crafts > 0) {
    const r = play(on, input, +crafts, 4242, +(process.env.V1_MAXSTEPS || 4000), 1800000, null, {});
    const promise = on.cost(on.start);
    if (process.env.V1_PLAY_OFF === '1') {
      const r0 = play(off, input, +crafts, 4242, +(process.env.V1_MAXSTEPS || 4000), 1800000, null, {});
      console.log(`  play off ${r0.done}/${r0.runs} done, mean ${r0.mean.toFixed(2)} ± ${(1.96 * r0.se).toFixed(2)}, promise ${off.cost(off.start).toFixed(2)}, ratio ${(r0.mean / off.cost(off.start)).toFixed(3)}, refused ${r0.refused}, detours ${r0.detours} ${JSON.stringify(r0.detourWhy)}, off-network ${r0.off}, ends ${JSON.stringify(r0.endWhy)}`);
    }
    console.log(`  detours on ${JSON.stringify(r.detourWhy)} ends ${JSON.stringify(r.endWhy)} gave up ${r.gaveUp}`);
    console.log(`  play ${r.done}/${r.runs} done, mean ${r.mean.toFixed(2)} ± ${(1.96 * r.se).toFixed(2)} (95%), promise ${promise.toFixed(2)}, ratio ${(r.mean / promise).toFixed(3)}, refused ${r.refused} ${JSON.stringify(r.why)}, detours ${r.detours}, off-network ${r.off}`);
  }
}
