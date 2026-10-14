// A sweep scenario's network: is it settled, do its values satisfy their own equations, and what does the simulator
// play? node replay.js <base> <id> [crafts] [restart]
const { L, NW, play, need, inputOf } = require('./common.js');
const [base, id, runs, restart] = process.argv.slice(2);
const sc = need(base, id), input = inputOf(sc, restart ? { restart } : null);
const t0 = Date.now();
const net = NW.route(input);
if (net.unsupported || net.impossible) { console.log(net.unsupported || JSON.stringify(net.impossible)); process.exit(0); }
console.log('nodes', net.N, 'track', net.track, 'whittle', net.whittle, 'classes', net.classes, 'lite', net.lite, 'settled', net.settled, 'timing', JSON.stringify(net.timing), Date.now() - t0, 'ms');
const V = (s) => net.cost(s);
let worst = 0, at = -1;
const seen = new Set([net.start]), q = [net.start];
while (q.length) {
  const s = q.pop(); if (net.done(s)) continue;
  const step = net.step(s); if (!step) continue;
  let v = step.cost;
  for (let t = 0; t < step.out.length; t += 2) { const to = step.out[t + 1]; v += step.out[t] * V(to < 0 ? net.n0 : to); if (to >= 0 && !seen.has(to)) { seen.add(to); q.push(to); } }
  const d = Math.abs(v - V(s)) / Math.max(1, V(s));
  if (d > worst) { worst = d; at = s; }
}
console.log('reached', seen.size, 'worst relative residual', worst.toExponential(2), 'at', at, '| promised', V(net.start).toFixed(1));
if (+runs) {
  const got = play(net, input, +runs, sc.seed, 200000, 900000);
  console.log('played', got.mean.toFixed(1), '+-', got.se.toFixed(1), 'x' + (got.mean / V(net.start)).toFixed(3), 'done', got.done + '/' + got.runs, 'detours', got.detours, 'gaveUp', got.gaveUp, 'off', got.off, 'refused', got.refused,
    JSON.stringify([...(got.detourWhy || [])].slice(0, 3)).slice(0, 400), JSON.stringify([...(got.gaveUpWhy || [])].slice(0, 3)).slice(0, 300));
}
// the model played by its own chances: its mean must be the promise when the values satisfy their equations
{
  const r = L.rng(77); let sum = 0, cut = 0; const n = 3000;
  for (let k = 0; k < n; k++) {
    let s = net.start, c = 0, i = 0;
    for (; i < 400000 && !net.done(s); i++) {
      const step = net.step(s); if (!step) break;
      c += step.cost;
      let u = r(), to = -2;
      for (let t = 0; t < step.out.length; t += 2) { u -= step.out[t]; if (u <= 0) { to = step.out[t + 1]; break; } }
      if (to === -2) to = step.out[step.out.length - 1];
      s = to < 0 ? net.n0 : to;
    }
    if (!net.done(s)) cut++;
    sum += c;
  }
  console.log('the model by its own chances:', (sum / n).toFixed(1), 'cut', cut, '| promised', V(net.start).toFixed(1));
}
