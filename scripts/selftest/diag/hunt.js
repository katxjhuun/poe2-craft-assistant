// Many sweep scenarios played with the audit of transitions.js, and only the nodes where the played items go
// elsewhere than the network's chances say, beyond what the number of visits explains. A gap at a busy node can
// hide behind a scenario's average (a body armour's "or" slot read two ways played at x1.16; boots whose Well of
// Souls picks read the item before an Omen of Putrefaction at x1.18).
//   node hunt.js <crafts> <maxNodes> <base>::<id> [<base>::<id> ...]       (or a file of such lines: @list.txt)
// Flags: a node of at least 500 visits whose gap is at least 3% and clearly over the noise (chi-square z > 4), and
// any node whose played items reach a node the network gives no chance (or miss one it gives a fair chance).
// excess: what each node's gap adds to a craft's played cost, sum over its visits of V(played next) - E[V(next)];
// over all nodes it is the played cost less the promise (less what detours and nodes of under 50 visits add).
// (The reader may know more than a roll: an item with a modifier in an unfollowed target's way goes to the node that
// knows it when the network has one. Such gaps are the reader's, and cost nothing.)
// Env as the other tools (POE2_OUT, POE2_PRICES, NWFILE); a line per scenario, JSON.
const fs = require('fs');
const { NW, play, scenarioById, inputOf, words } = require('./common.js');
const runs = +process.argv[2] || 3000, maxNodes = +process.argv[3] || 120000;
let list = process.argv.slice(4);
if (list.length === 1 && list[0].startsWith('@')) list = fs.readFileSync(list[0].slice(1), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
for (const line of list) {
  const [base, id, crafts] = line.split('::');
  const sc = scenarioById(base, id);
  if (!sc) { console.log(JSON.stringify({ id, error: 'no such scenario' })); continue; }
  const t0 = Date.now(), input = inputOf(sc);
  let net;
  try { net = NW.route(Object.assign({ deadline: Date.now() + 8 * 60000 }, input)); } catch (e) { console.log(JSON.stringify({ id, error: String(e).slice(0, 200) })); continue; }
  if (net.unsupported || net.impossible || net.blocked) { console.log(JSON.stringify({ id, skipped: net.unsupported || net.blocked || 'impossible' })); continue; }
  if (net.done(net.start) || !(net.cost(net.start) < 1e8)) { console.log(JSON.stringify({ id, skipped: 'done or out of reach' })); continue; }
  if (net.N > maxNodes) { console.log(JSON.stringify({ id, skipped: 'nodes ' + net.N })); continue; }
  const ms = Date.now() - t0;
  const audit = new Map();
  const got = play(net, input, +crafts || runs, sc.seed, 200000, 15 * 60000, audit);
  const want = net.cost(net.start);
  const flags = [], excess = [];
  let worst = { gap: 0, node: -1, n: 0 };
  for (const [node, a] of audit) {
    if (typeof node !== 'number') continue;
    const st = net.step(node); if (!st || a.n < 50) continue;
    // (every finished item is one end, whichever node holds it: a Vaal Orb's finished items are counted at the
    // network's end node, the play reads them into the node of what is on them)
    const key = (k) => (k === -2 || (k >= 0 && net.done(k)) ? 'done' : k);
    const model = new Map(), to = new Map();
    for (let t = 0; t < st.out.length; t += 2) { const k = key(st.out[t + 1] < 0 ? net.n0 : st.out[t + 1]); model.set(k, (model.get(k) || 0) + st.out[t]); }
    for (const [k, c] of a.to) to.set(key(k), (to.get(key(k)) || 0) + c);
    let tv = 0, tv0 = 0, zero = 0, missing = 0, chi = 0, df = -1, restE = 0, restO = 0;
    for (const k of new Set([...model.keys(), ...to.keys()])) {
      const p = model.get(k) || 0, o = to.get(k) || 0;
      tv += Math.abs(p - o / a.n);
      tv0 += Math.sqrt(2 * p * (1 - p) / (Math.PI * a.n));
      if (p <= 1e-12) { zero += o; continue; }
      if (o === 0 && a.n * p >= 15) missing += a.n * p;
      if (a.n * p < 5) { restE += a.n * p; restO += o; continue; }
      chi += (o - a.n * p) ** 2 / (a.n * p); df++;
    }
    if (restE > 0) { chi += (restO - restE) ** 2 / Math.max(restE, 1); df++; }
    tv /= 2; tv0 /= 2;
    const z = df > 0 ? (chi - df) / Math.sqrt(2 * df) : 0;
    // what the node's gap adds to the played cost: the played next nodes' values against the network's (the played cost
    // less the promise is the sum of these over every visit: V(s) = c + sum p V(next) telescopes along a craft)
    let exc = 0;
    for (const k of new Set([...model.keys(), ...to.keys()])) { if (k !== 'done' && !(k >= 0)) continue; exc += ((to.get(k) || 0) - a.n * (model.get(k) || 0)) * (k === 'done' ? 0 : net.cost(k)); }
    excess.push({ node, n: a.n, exc, step: (st.names || []).join('+') || st.a.op, what: words(net, node) });
    if (a.n >= 500 && tv > worst.gap) worst = { gap: tv, node, n: a.n, noise: tv0, z };
    const bigGap = a.n >= 500 && tv >= 0.03 && z > 4;
    const odd = zero >= Math.max(5, 0.002 * a.n) || missing > 0;
    if (bigGap || odd) flags.push({ node, n: a.n, gap: +(tv * 100).toFixed(1), noise: +(tv0 * 100).toFixed(1), z: +z.toFixed(1), zero, missing: Math.round(missing), step: (st.names || []).join('+') || st.a.op, what: words(net, node),
      top: [...new Set([...model.keys(), ...to.keys()])].map((k) => [k, model.get(k) || 0, (to.get(k) || 0) / a.n]).sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2])).slice(0, 4)
        .map(([k, p, o]) => `${(p * 100).toFixed(1)}%->${(o * 100).toFixed(1)}% ${k}`) });
  }
  flags.sort((x, y) => y.n * y.gap - x.n * x.gap);
  excess.sort((x, y) => Math.abs(y.exc) - Math.abs(x.exc));
  const R = got.runs, exTot = excess.reduce((x, y) => x + y.exc, 0) / R;
  const det = audit.detours ? [...audit.detours.values()].reduce((x, y) => x + y, 0) : 0;
  console.log(JSON.stringify({ id, nodes: net.N, track: net.track, whittle: net.whittle, ms, promised: +want.toFixed(1), played: +got.mean.toFixed(1), se: +got.se.toFixed(1), ratio: +(got.mean / want).toFixed(3),
    done: got.done, runs: got.runs, off: got.off, refused: got.refused, detours: det, detourWhy: got.detourWhy, refusedWhy: got.why, gaveUp: got.gaveUp, maps: audit.maps, worst: { gap: +(worst.gap * 100).toFixed(1), noise: +((worst.noise || 0) * 100).toFixed(1), z: +(worst.z || 0).toFixed(1), node: worst.node, n: worst.n }, excess: { total: +exTot.toFixed(1), top: excess.slice(0, 4).map((x) => ({ node: x.node, n: x.n, perCraft: +(x.exc / R).toFixed(1), step: x.step, what: x.what })) }, flags: flags.slice(0, 6) }));
}
