// A sweep scenario played by the simulator: per node, where the items went against where the network says they go
// (the nodes with the largest visits x gap first). A gap is a place where the network's chances or its reading of an
// item differ from the game rules. node transitions.js <base> <id> <crafts> [top]
const { NW, play, need, inputOf, words } = require('./common.js');
const [base, id, runs, topN] = process.argv.slice(2);
const sc = need(base, id), input = inputOf(sc);
console.log('targets:', JSON.stringify(sc.targets).slice(0, 600));
const net = NW.route(input);
console.log('nodes', net.N, 'track', net.track, 'promised', net.cost(net.start).toFixed(1));
const audit = new Map();
const got = play(net, input, +runs || 5000, sc.seed, 200000, 900000, audit);
console.log('played', got.mean.toFixed(1), 'x' + (got.mean / net.cost(net.start)).toFixed(3), 'done', got.done + '/' + got.runs);
const rows = [];
for (const [node, a] of audit) {
  if (typeof node !== 'number') continue;
  const st = net.step(node); if (!st || a.n < 50) continue;
  const model = new Map();
  for (let t = 0; t < st.out.length; t += 2) { const to = st.out[t + 1] < 0 ? net.n0 : st.out[t + 1]; model.set(to, (model.get(to) || 0) + st.out[t]); }
  let tv = 0;
  for (const k of new Set([...model.keys(), ...a.to.keys()])) tv += Math.abs((model.get(k) || 0) - (a.to.get(k) || 0) / a.n);
  rows.push({ node, n: a.n, tv: tv / 2, st, model, a });
}
rows.sort((x, y) => y.n * y.tv - x.n * x.tv);
for (const r of rows.slice(0, +topN || 6)) {
  console.log(`\nnode ${r.node} visits ${r.n} | gap ${(r.tv * 100).toFixed(1)}% | ${words(net, r.node)} | step ${(r.st.names || []).join('+') || r.st.a.op} ${JSON.stringify(r.st.a).slice(0, 120)}`);
  const keys = [...new Set([...r.model.keys(), ...r.a.to.keys()])].sort((x, y) => (r.a.to.get(y) || 0) / r.n + (r.model.get(y) || 0) - (r.a.to.get(x) || 0) / r.n - (r.model.get(x) || 0));
  for (const k of keys.slice(0, 8)) console.log(`   model ${((r.model.get(k) || 0) * 100).toFixed(1)}%  played ${(((r.a.to.get(k) || 0) / r.n) * 100).toFixed(1)}%  -> ${k} ${words(net, k)}`);
}
