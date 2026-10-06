/* Planner check against the exhaustive sweep.
 *
 *   node scripts/selftest/sweep_planner.js [--workers N] [--limit N] [--only <regex on scenario id>] [--tag name]
 *
 * For every scenario of reports/sweep-latest.json the three plans are built as the page builds them, each plan's
 * strategy is simulated with the sweep's verification random numbers, and the result is compared with the sweep's
 * verified best for that profile: same strategy, equal result (within 5% of the cost and the same chance), better or
 * worse. A planner change is measured with this in minutes instead of running the sweep again.
 * Writes reports/sweep-planner[-tag].json (sweep_report.js --planner reads it) and a progress file.
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');
const S = require('./sweep.js');

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

if (!isMainThread && workerData === 'planner-check') {
  parentPort.on('message', async (t) => {
    let res;
    try { res = await check(t.sc, t.best); } catch (e) { res = { id: t.sc.id, error: String(e && e.stack || e) }; }
    parentPort.postMessage({ id: t.sc.id, res });
  });
}

async function check(sc, best) {
  const { canon } = require('./sweep_report.js');
  const { P, priceOf, ctx, st, goals, input } = S.setup(sc);
  const SPACE = S.sweepSpace(P);
  const DEFAULTS = P.expandStrategy({});
  const out = { id: sc.id, start: sc.start, group: sc.group, profiles: {} };
  if (!goals.length) return out;
  const t0 = Date.now();
  const planned = await S.runPlanner(P, input);
  out.plannerMs = Date.now() - t0;
  const n = S.CFG.tC;
  const tol = (a, b) => 1.96 * Math.sqrt(a * (1 - a) / n + b * (1 - b) / n) + 0.005;
  for (const { pg, profiles } of S.goalSets(P, goals)) {
    const hasDes = pg.some((g) => g.des);
    for (const name of profiles) {
      const b = best[name];
      if (!b) continue; // the sweep had no verified pick here (impossible goals or no success)
      const pl = planned.profiles && planned.profiles[name];
      if (!pl || !pl.params) { out.profiles[name] = { verdict: 'none' }; continue; }
      const params = Object.assign({}, DEFAULTS, pl.params);
      const { r, reads } = S.tracked(P, ctx, st, pg, params, { trials: n, seed: S.SEEDS.C, priceOf, baseCost: S.BASE_COST, baseLimit: S.BASE_LIMIT, maxSteps: S.CFG.maxSteps }, SPACE);
      const mine = Object.fromEntries(reads.map((k) => [k, params[k]]));
      const score = (x) => P.PROFILES[name].score(x);
      const bestRes = { p: b.p, costPerSuccess: b.cps == null ? Infinity : b.cps, basesPerSuccess: b.bases == null ? Infinity : b.bases, baseLimit: S.BASE_LIMIT, missingPrices: b.missing };
      const same = JSON.stringify(canon(mine, hasDes)) === JSON.stringify(canon(b.params, hasDes));
      const ratio = r.costPerSuccess / bestRes.costPerSuccess, dp = r.p - b.p;
      const close = same || (Math.abs(ratio - 1) <= 0.05 && Math.abs(dp) <= tol(r.p, b.p));
      const better = !same && score(r) < score(bestRes);
      out.profiles[name] = {
        verdict: same ? 'same' : close ? 'equal' : better ? 'better' : 'worse', costRatio: isFinite(ratio) ? +ratio.toFixed(3) : null, dp: +dp.toFixed(4),
        pick: { params: mine, p: +r.p.toFixed(4), cps: isFinite(r.costPerSuccess) ? +r.costPerSuccess.toFixed(2) : null, steps: +r.meanSteps.toFixed(1), missing: r.missingPrices.length ? r.missingPrices : undefined },
        candidates: pl.search ? pl.search.candidates : null,
      };
    }
  }
  return out;
}

if (isMainThread && require.main === module) {
  const { ROOT } = require('./lib.js');
  const { scenarios, recipeScenarios } = require('./scenarios.js');
  const { testBases } = require('./lib.js');
  const reports = path.join(ROOT, 'reports');
  const sweep = JSON.parse(fs.readFileSync(path.join(reports, 'sweep-latest.json'), 'utf8'));
  const bestOf = {};
  for (const sc of sweep.scenarios) {
    const b = bestOf[sc.id] = {};
    for (const set of sc.sets || []) for (const [n, pk] of Object.entries(set.picks || {})) b[n] = { params: pk.pick.params, p: pk.pick.p, cps: pk.pick.cps, bases: pk.pick.bases, missing: pk.pick.missing };
  }
  const bases = testBases();
  let all = scenarios(bases).concat(recipeScenarios(bases).out).filter((s) => bestOf[s.id] && Object.keys(bestOf[s.id]).length);
  const only = argv('--only', null);
  if (only) all = all.filter((s) => new RegExp(only).test(s.id));
  const limit = +argv('--limit', 0);
  if (limit && limit < all.length) { const step = all.length / limit; all = Array.from({ length: limit }, (x, i) => all[Math.floor(i * step)]); }
  const WORKERS = +argv('--workers', 0) || Math.max(2, Math.min(25, os.cpus().length - 4));
  const tag = argv('--tag', '');
  const outFile = path.join(reports, `sweep-planner${tag ? '-' + tag : ''}.json`);
  const progressFile = path.join(reports, 'sweep-progress.txt');
  const t0 = Date.now();
  const results = {}, errors = [];
  let done = 0, next = 0;
  const fmt = (s) => (s == null ? '?' : `${Math.round(s / 60)} min`);
  const progress = () => {
    const f = done / all.length, el = (Date.now() - t0) / 1000;
    fs.writeFileSync(progressFile, `${(f * 100).toFixed(1)} ${done}/${all.length} scenarios, ${fmt(el)} elapsed, about ${f > 0.03 ? fmt(el / f - el) : '?'} left, ${errors.length} errors\n`);
  };
  console.log(`planner check: ${all.length} scenarios, ${WORKERS} workers`);
  progress();
  const finish = () => {
    const NAMES = ['cheap', 'balanced', 'premium'];
    const q = (arr, p) => { const a = arr.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
    const ms = Object.values(results).map((r) => r.plannerMs);
    const rep = { meta: { date: new Date().toISOString(), scenarios: all.length, errors: errors.length, seconds: Math.round((Date.now() - t0) / 1000), workers: WORKERS, tag,
      plannerSeconds: { p50: +(q(ms, 0.5) / 1000).toFixed(1), p90: +(q(ms, 0.9) / 1000).toFixed(1), max: +(q(ms, 1) / 1000).toFixed(1) } }, summary: {}, scenarios: {} };
    for (const [id, r] of Object.entries(results)) rep.scenarios[id] = r.profiles;
    const L = [`planner check${tag ? ' ' + tag : ''}: ${all.length} scenarios in ${Math.round((Date.now() - t0) / 60000)} min, ${errors.length} errors; planner time per item ${rep.meta.plannerSeconds.p50} s median, ${rep.meta.plannerSeconds.p90} s at 90%, ${rep.meta.plannerSeconds.max} s max`];
    for (const n of NAMES) {
      const c = { same: 0, equal: 0, better: 0, worse: 0, none: 0 }, ratios = [], byStart = {};
      for (const r of Object.values(results)) {
        const x = r.profiles[n];
        if (!x) continue;
        c[x.verdict]++;
        const bs = byStart[r.start] || (byStart[r.start] = { ok: 0, worse: 0 });
        if (x.verdict === 'worse') { ratios.push(x.costRatio); bs.worse++; } else bs.ok++;
      }
      const tot = c.same + c.equal + c.better + c.worse;
      rep.summary[n] = Object.assign({}, c, { ratio50: q(ratios, 0.5), ratio90: q(ratios, 0.9), byStart });
      L.push(`${n.padEnd(9)} same ${c.same} equal ${c.equal} better ${c.better} worse ${c.worse} (${tot ? Math.round(100 * c.worse / tot) : 0}%)${ratios.length ? `, worse costs x${q(ratios, 0.5).toFixed(2)} median, x${q(ratios, 0.9).toFixed(2)} at 90%` : ''} | worse by start: ${Object.entries(byStart).map(([s, b]) => `${s} ${b.worse}/${b.ok + b.worse}`).join(', ')}`);
    }
    if (errors.length) L.push('errors: ' + errors.slice(0, 3).map((e) => String(e.error).split('\n').slice(0, 3).join(' | ')).join('\n  '));
    fs.writeFileSync(outFile, JSON.stringify(rep, null, 1));
    fs.writeFileSync(progressFile, `100.0 ${done}/${all.length} scenarios, finished in ${Math.round((Date.now() - t0) / 60000)} min, ${errors.length} errors\n`);
    console.log(L.join('\n'));
    process.exit(0);
  };
  const feed = (w) => {
    if (next >= all.length) { w.cur = null; w.terminate(); return; }
    const sc = all[next++];
    w.cur = sc;
    w.postMessage({ sc, best: bestOf[sc.id] });
  };
  const settle = () => { done++; progress(); if (done === all.length) finish(); };
  const spawn = () => {
    const w = new Worker(__filename, { argv: process.argv.slice(2), workerData: 'planner-check' });
    w.on('message', (m) => { if (m.res.error) errors.push(m.res); else results[m.id] = m.res; feed(w); settle(); });
    w.on('error', (e) => { const sc = w.cur; if (!sc) return; errors.push({ id: sc.id, error: String(e && e.stack || e) }); w.cur = null; feed(spawn()); settle(); });
    return w;
  };
  for (let i = 0; i < Math.min(WORKERS, all.length); i++) feed(spawn());
}
