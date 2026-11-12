// The same sweep scenarios in two network.js files: the promise net.cost(start) and the node count of each, to the
// last digit. For a change that must not change results (PoE2 1.0 off: the second fractured modifier and the reforge
// edges add nothing then). The other file must lie in app/ beside engine.js and planner.js (or its own copies).
//   node same_cost.js <other network.js> <n per base> <base> [<base> ...]   (env: POE2_OUT, POE2_PRICES)
//   extra input: SAME_INPUT='{"v1":true}' (merged into both builds)
const path = require('path');
const { L, ROOT, SW, inputOf } = require('./common.js');
const [other, per, ...bases] = process.argv.slice(2);
const A = require(path.join(ROOT, 'app', 'network.js'));
const B = require(path.resolve(other));
const more = process.env.SAME_INPUT ? JSON.parse(process.env.SAME_INPUT) : {};
let same = 0, diff = 0, tA = 0, tB = 0;
const STRIDE = +(process.env.SAME_STRIDE || 1);
for (const base of bases) for (let n = 0; n < +per * STRIDE; n += STRIDE) {
  let sc = null;
  try { sc = SW.scenario(base, n, n % 2 === 0); } catch (e) { sc = null; }
  if (!sc) continue;
  const input = inputOf(sc, more);
  const run = (NW) => {
    const t0 = Date.now();
    const net = NW.build(Object.assign({}, input));
    const ms = Date.now() - t0;
    if (!net || net.unsupported || net.impossible || net.blocked) return { c: 'none:' + JSON.stringify(net && (net.unsupported || net.blocked || 'impossible')), N: 0, ms };
    return { c: net.done(net.start) ? 0 : net.cost(net.start), N: net.N, ms };
  };
  const b = run(B), a = run(A);
  tA += a.ms; tB += b.ms;
  const ok = a.c === b.c && a.N === b.N;
  if (ok) same++; else diff++;
  console.log(ok ? 'same' : 'DIFF', sc.id, 'new', a.c, a.N, a.ms + 'ms', '| old', b.c, b.N, b.ms + 'ms');
}
console.log(`same ${same}, different ${diff}; time new ${(tA / 1000).toFixed(1)} s, old ${(tB / 1000).toFixed(1)} s`);
