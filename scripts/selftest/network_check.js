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
const { ROOT, E, P, load, weightsFor, testBases, rng } = require('./lib.js');
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

/** Play the network's rule set on the item `runs` times (fewer when `limitMs` runs out). Returns { mean, se, done, steps, off, runs }. */
function play(net, input, runs, seed, maxSteps, limitMs) {
  const until = limitMs > 0 ? Date.now() + limitMs : 0;
  let played = 0;
  const ctx = net.ctx;
  const r = rng(seed);
  const lim = E.slotLimits({ rarity: 'Rare', slotDelta: ctx.slotDelta }, ctx.cls);
  const count = (st, side) => st.mods.filter((m) => m.side === side).length;
  const open = (st, side) => Math.max(0, lim[side] - count(st, side));
  const goals = net.goals.slice().sort((a, b) => (b.kind === 'des') - (a.kind === 'des'));
  const wanted = (st) => (opts) => {
    for (const g of goals) {
      if (P.goalMet(st, g)) continue;
      const o = opts.find((e) => e.side === g.side && P.meets({ fam: e.fam, tier: e.tier, des: true }, g, g.tier));
      if (o) return o;
    }
    return null;
  };
  const desMod = (e) => ({ id: e.id, fam: e.fam, side: e.side, lvl: e.lvl, grp: e.grp, tier: e.tier, frac: false, des: true, crafted: false, lock: false });
  const st0 = P.toState(ctx, input.item, input.locks);
  let sum = 0, sq = 0, done = 0, steps = 0, off = 0;
  for (let n = 0; n < runs; n++) {
    if (until && (n & 255) === 0 && n >= 2000 && Date.now() > until) break;
    if (n === 40 && done === 0) break; // not one of forty crafts ends: the rules and the simulator disagree, more plays say nothing
    played++;
    let st = { ...st0, mods: st0.mods.map((m) => ({ ...m })) };
    let cost = 0, k = 0, ok = false;
    for (; k < maxSteps; k++) {
      const node = net.nodeOf(st);
      if (node < 0) { off++; break; }
      if (net.done(node)) { ok = true; break; }
      const step = net.step(node);
      if (!step) break;
      cost += step.cost;
      const a = step.a;
      if (a.op === 'reveal') {
        const i = st.mods.findIndex((m) => m.unrevealed);
        const side = st.mods[i].side;
        st.mods.splice(i, 1);
        const pick = wanted(st);
        let opts = P.revealOptions(ctx, st, side, 0, null, r), choice = pick(opts);
        if (!choice && a.echoes) { opts = P.revealOptions(ctx, st, side, 0, null, r); choice = pick(opts); }
        if (!choice) choice = opts.slice().sort((x, y) => y.lvl - x.lvl)[0];
        if (choice) st.mods.push(desMod(choice));
      } else if (a.op === 'bone' && a.hide) {
        // as the simulator places a desecrated modifier, but left hidden
        let side = null;
        if (open(st, 'prefix') + open(st, 'suffix') === 0) {
          const c = st.mods.filter((m) => !m.frac && (!a.side || m.side === a.side));
          if (c.length) { const m = c[Math.floor(r() * c.length)]; st.mods.splice(st.mods.indexOf(m), 1); side = m.side; }
        } else {
          const c = (a.side ? [a.side] : ['prefix', 'suffix']).filter((s) => open(st, s) > 0);
          side = c.length ? c[Math.floor(r() * c.length)] : null;
        }
        if (side) st.mods.push({ id: null, fam: null, side, lvl: 0, grp: [], tier: null, frac: false, des: true, crafted: false, lock: false, unrevealed: true });
      } else if (a.op === 'catalyst') {
        for (let i = 0; i < a.count; i++) st = P.apply(ctx, st, a, r).state;
      } else {
        const pick = wanted(st);
        st = P.apply(ctx, st, a, r, (opts) => pick(opts)).state;
      }
    }
    if (ok) { done++; sum += cost; sq += cost * cost; }
    steps += k;
  }
  const mean = done ? sum / done : NaN;
  const sd = done > 1 ? Math.sqrt(Math.max(0, sq / done - mean * mean)) : 0;
  return { mean, se: done ? sd / Math.sqrt(done) : NaN, sd, done, steps: steps / Math.max(1, played), off, runs: played };
}

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
