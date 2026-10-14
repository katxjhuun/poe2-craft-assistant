// One step of a sweep scenario from an item the play reaches at a node: which rolled modifier leads to which node,
// against the network's outcomes. node step_probe.js <base> <id> <node> [n]
const path = require('path');
const { L, ROOT, NW, play, need, inputOf, words } = require('./common.js');
const P = require(path.join(ROOT, 'app', 'planner.js'));
const [base, id, nodeArg, nArg] = process.argv.slice(2);
const sc = need(base, id), input = inputOf(sc), net = NW.route(input), ctx = net.ctx, node = +nodeArg;
let found = null;
const orig = net.nodeOf;
net.nodeOf = (st) => { const k = orig(st); if (k === node && !found) found = { ...st, mods: st.mods.map((m) => ({ ...m })) }; return k; };
play(net, input, 400, 3, 200000, 60000);
net.nodeOf = orig;
if (!found) { console.log('no item reached node', node); process.exit(0); }
console.log('item at node', node, ':', found.rarity, found.mods.map((m) => `${m.side[0]}:${m.fam}${m.tier ? ' T' + m.tier : ''}`).join(', '));
const st = net.step(node);
console.log('step', JSON.stringify(st.a));
const model = new Map();
for (let t = 0; t < st.out.length; t += 2) model.set(st.out[t + 1], (model.get(st.out[t + 1]) || 0) + st.out[t]);
const r = L.rng(5), N = +nArg || 20000, got = new Map(), why = new Map();
for (let k = 0; k < N; k++) {
  const res = P.apply(ctx, { ...found, mods: found.mods.map((m) => ({ ...m })) }, st.a, r).state;
  const to = net.nodeOf(res);
  got.set(to, (got.get(to) || 0) + 1);
  const added = res.mods.filter((m) => !found.mods.some((o) => o.id === m.id)).map((m) => `${m.fam} T${m.tier}`).join('+') || '(none)';
  why.set(to + '|' + added, (why.get(to + '|' + added) || 0) + 1);
}
const keys = [...new Set([...model.keys(), ...got.keys()])].sort((a, b) => (got.get(b) || 0) / N + (model.get(b) || 0) - (got.get(a) || 0) / N - (model.get(a) || 0));
for (const k of keys.slice(0, 12)) {
  console.log(`model ${((model.get(k) || 0) * 100).toFixed(2)}%  sim ${(((got.get(k) || 0) / N) * 100).toFixed(2)}%  -> ${k} ${words(net, k)}`);
  const ex = [...why.entries()].filter(([key]) => +key.split('|')[0] === k).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, c]) => `${key.split('|')[1]} ${(c / N * 100).toFixed(2)}%`);
  if (ex.length) console.log('      ' + ex.join(' | '));
}
