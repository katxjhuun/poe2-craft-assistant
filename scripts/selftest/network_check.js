/* Check of the craft network (app/network.js) against the simulator.
 *
 * The network promises a cost from equations over item states that do not know which modifiers the "other" ones are.
 * Here its rule set is played on real items with planner.js, which knows every modifier, and the promise is compared
 * with what the played crafts cost on average. A scenario passes when the two agree within the tolerance or within
 * three standard errors of the played mean.
 *
 *   node scripts/selftest/network_check.js [--runs 2000] [--limit 40] [--tolerance 0.15] [--json out.json] [--seed 7]
 *
 * One process, one core: light enough to run next to the game; the full list is meant for the cloud workflow.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { ROOT, E, P, load, weightsFor, testBases, rng, renderItem } = require('./lib.js');
const NW = require(path.join(ROOT, 'app', 'network.js'));
const { scenarios } = require('./scenarios.js');
const { startItem } = require('./mine.js');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; };

function inputFor(sc) {
  const { ix, kb, W, priceOf } = load();
  const item = startItem(sc);
  const cls = kb.bases[item.base].cls;
  return { ix, item, targets: sc.targets, locks: {}, priceOf, baseCost: 1, weights: weightsFor(item.base), essences: (W.essences || {})[cls] || [],
    quality: sc.qualityMode || (sc.quality ? 'use' : 'lock') };
}

// (play is in app/replay.js since 12 Nov 2026: the page plays the route on the player's item with it too)
const { play } = require(path.join(ROOT, 'app', 'replay.js')).make({ E, P, NW, rng, renderItem });

function check(sc, runs, seed, tol) {
  const input = inputFor(sc);
  const t0 = Date.now();
  const net = NW.build(input);
  const ms = Date.now() - t0;
  if (net.unsupported || net.impossible) return { id: sc.id, skipped: net.unsupported || 'impossible', ms };
  const s = net.start;
  const want = net.cost(s);
  if (net.done(s)) return { id: sc.id, skipped: 'already done', ms };
  // a craft that takes very many uses is played fewer times
  const stepsGuess = net.materials(s).reduce((t, m) => t + m.uses, 0);
  const n = Math.max(200, Math.min(runs, Math.round(4e6 / Math.max(1, stepsGuess))));
  const got = play(net, input, n, seed, Math.max(5000, Math.round(stepsGuess * 60)));
  const ratio = got.mean / want;
  const z = (got.mean - want) / (got.se || 1);
  const pass = got.done === n && got.off === 0 && (Math.abs(ratio - 1) <= tol || Math.abs(z) <= 3);
  return { id: sc.id, nodes: net.N, ms, runs: n, network: want, played: got.mean, se: got.se, ratio, z, sdNet: net.sd(s), sdPlayed: got.sd, done: got.done, off: got.off, uses: got.steps, pass };
}

if (require.main === module) {
  const runs = +arg('runs', 2000), limit = +arg('limit', 0), tol = +arg('tolerance', 0.15), seed = +arg('seed', 7);
  const only = arg('only', null);
  let list = scenarios(testBases());
  if (only) list = list.filter((sc) => sc.id.includes(only));
  if (limit) { const step = Math.max(1, Math.floor(list.length / limit)); list = list.filter((_, i) => i % step === 0).slice(0, limit); }
  const out = [];
  const t0 = Date.now();
  for (const sc of list) {
    let r;
    try { r = check(sc, runs, seed, tol); } catch (e) { r = { id: sc.id, error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
    out.push(r);
    const f = (x, d) => (x == null || isNaN(x) ? '—' : x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(d == null ? 1 : d));
    if (r.error) console.log(`ERROR ${r.id}: ${r.error}`);
    else if (r.skipped) console.log(`skip  ${r.id}: ${r.skipped}`);
    else console.log(`${r.pass ? 'ok   ' : 'FAIL '} ${r.id.padEnd(58)} net ${f(r.network).padStart(9)}  played ${f(r.played).padStart(9)} ±${f(r.se)}  x${f(r.ratio, 3)}  ${r.nodes} nodes ${r.ms} ms${r.off ? '  off-network ' + r.off : ''}${r.done < r.runs ? '  unfinished ' + (r.runs - r.done) : ''}`);
  }
  const done = out.filter((r) => r.pass != null);
  const bad = done.filter((r) => !r.pass);
  const ratios = done.map((r) => r.ratio).filter((x) => isFinite(x)).sort((a, b) => a - b);
  console.log(`\n${done.length} checked, ${done.length - bad.length} agree, ${bad.length} do not, ${out.filter((r) => r.skipped).length} skipped, ${out.filter((r) => r.error).length} errors; `
    + `played/network median ${ratios.length ? ratios[Math.floor(ratios.length / 2)].toFixed(3) : '—'}, range ${ratios.length ? ratios[0].toFixed(3) + ' to ' + ratios[ratios.length - 1].toFixed(3) : '—'}; ${Math.round((Date.now() - t0) / 1000)} s`);
  const json = arg('json', null);
  if (json) fs.writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), runs, tolerance: tol, results: out }, null, 1));
  process.exitCode = bad.length || out.some((r) => r.error) ? 1 : 0;
}
module.exports = { check, play, inputFor };
