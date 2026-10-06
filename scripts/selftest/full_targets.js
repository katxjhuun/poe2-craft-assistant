/* Full-target coverage: can the planner build a route when every modifier slot of the item is a target?
 *
 *   node scripts/selftest/full_targets.js [--workers N] [--only <regex on scenario id>] [--limit N] [--seven]
 *
 * --seven: the classes that take the rune Serle's Triumph (+1 Suffix Modifier allowed) with a socket for it: three
 * prefixes and four suffixes. Writes reports/full-targets-seven.*.
 *
 * For every test base, from a white and from a Rare start, the targets fill the item: three prefixes and three
 * suffixes on gear, five on a jewel (three suffixes, a prefix and the liquid emotion modifier: recipe c15). The plans
 * are built as the page builds them. Writes reports/full-targets.json and reports/full-targets.md: per class, how
 * often each profile has a route, its chance to finish and cost, and how long the planner took.
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');
const S = require('./sweep.js');

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

if (!isMainThread && workerData === 'full-targets') {
  parentPort.on('message', async (sc) => {
    let res;
    try { res = await run(sc); } catch (e) { res = { id: sc.id, error: String(e && e.stack || e) }; }
    parentPort.postMessage({ id: sc.id, res });
  });
}

/** Targets that fill the item: families spread over the weights of each side (a common, a middle and a rarer one). */
function fullTargets(base, seven) {
  const { load } = require('./lib.js');
  const { goalFamilies, labelOf } = require('./scenarios.js');
  const { kb } = load();
  const { P } = S.setup({ base, ilvl: 82, start: 'white', targets: {}, seed: 1 });
  const g = goalFamilies(base);
  const cls = kb.bases[base].cls;
  const spread = (side, n, skipGroups) => {
    const byFam = new Map();
    for (const e of P.sidePool(g.ctx, side, 0)) {
      const f = byFam.get(e.fam) || { fam: e.fam, w: 0, best: e };
      f.w += e.w;
      if (e.tier < f.best.tier) f.best = e;
      byFam.set(e.fam, f);
    }
    const list = [], groups = new Set(skipGroups || []);
    for (const f of [...byFam.values()].filter((x) => !/Essence/.test(x.fam)).sort((a, b) => b.w - a.w)) {
      const grp = kb.mods[f.best.id].grp;
      if (grp.some((x) => groups.has(x))) continue;
      grp.forEach((x) => groups.add(x));
      list.push(f);
    }
    return Array.from({ length: Math.min(n, list.length) }, (x, i) => list[Math.floor(i * list.length / Math.max(n, 1) * 0.9)]).filter((f, i, a) => a.indexOf(f) === i);
  };
  const targets = {};
  const put = (side, fams) => fams.forEach((f, i) => { targets[`${side}-${i}`] = { fam: f.fam, group: side, minTier: Math.max(2, f.best.tier), required: true, label: labelOf(f.best.id) }; });
  if (cls === 'Jewel') {
    // the liquid emotion modifier of the other side: "increased Effect of Suffixes", or the larger radius on a Time-Lost jewel
    const liquid = g.ctx.essences.filter((r) => r.liquid && r.gen === 'p' && /SuffixEffect|RadiusExtraLarge/.test(r.mod))[0];
    put('suffix', spread('suffix', 3));
    put('prefix', spread('prefix', 1, liquid ? kb.mods[liquid.mod].grp : null)); // not of the liquid modifier's group
    if (liquid) targets['prefix-1'] = { fam: kb.mods[liquid.mod].fam, group: 'liquid', minTier: null, required: true, label: labelOf(liquid.mod) };
  } else {
    put('prefix', spread('prefix', 3));
    put('suffix', spread('suffix', seven ? 4 : 3));
  }
  return targets;
}

async function run(sc) {
  const { P, input, goals } = S.setup(sc);
  const out = { id: sc.id, base: sc.base, cls: sc.cls, start: sc.start, goals: goals.length, labels: Object.values(sc.targets).map((t) => t.label), profiles: {} };
  const t0 = Date.now();
  const planned = await S.runPlanner(P, input);
  out.plannerMs = Date.now() - t0;
  for (const k of Object.keys(P.PROFILES)) {
    const pl = planned.profiles && planned.profiles[k];
    if (!pl) { out.profiles[k] = { status: 'none' }; continue; }
    if (pl.impossible) { out.profiles[k] = { status: 'impossible', why: pl.impossible.slice(0, 2) }; continue; }
    if (pl.noSuccess) { out.profiles[k] = { status: 'no success', why: (pl.fails || []).slice(0, 2).map((f) => `${f.reason} ${Math.round(f.share * 100)}%`) }; continue; }
    if (pl.none) { out.profiles[k] = { status: 'none', why: [pl.none] }; continue; }
    out.profiles[k] = { status: 'route', goals: pl.goals.length, p: +pl.p.toFixed(4), cps: isFinite(pl.costPerSuccess) ? Math.round(pl.costPerSuccess) : null, uses: +pl.meanSteps.toFixed(0),
      unfinished: +pl.unfinished.toFixed(3), dead: +pl.failDead.toFixed(3), missing: pl.missingPrices.length ? pl.missingPrices : undefined,
      route: pl.steps.slice(0, 8).map((s) => `${s.key} x${s.avg.toFixed(1)}`) };
  }
  return out;
}

if (isMainThread && require.main === module) {
  const { ROOT, testBases, load } = require('./lib.js');
  const { kb, priceOf } = load();
  const reports = path.join(ROOT, 'reports');
  const progressFile = path.join(reports, 'sweep-progress.txt');
  let all = [];
  let seed = 700;
  const SEVEN = args.includes('--seven');
  for (const base of testBases()) {
    if (SEVEN) {
      // only where a plan can socket the rune: the class takes it and an Artificer's Orb can add a socket
      const { P, input } = S.setup({ base, ilvl: 82, start: 'white', targets: {}, seed: 1 });
      if (!P.suffixRune(input.ix, input.item)) continue;
    }
    const targets = fullTargets(base, SEVEN);
    for (const start of ['white', 'rare']) all.push({ id: `${base}|full${SEVEN ? '7' : ''}|${start}`, base, cls: kb.bases[base].cls, ilvl: 82, start, group: 'full', targets, seed: seed++ });
  }
  const only = argv('--only', null);
  if (only) all = all.filter((s) => new RegExp(only).test(s.id));
  const limit = +argv('--limit', 0);
  if (limit && limit < all.length) { const step = all.length / limit; all = Array.from({ length: limit }, (x, i) => all[Math.floor(i * step)]); }
  const WORKERS = +argv('--workers', 0) || Math.max(2, Math.min(25, os.cpus().length - 4));
  const t0 = Date.now();
  const results = [], errors = [];
  let done = 0, next = 0;
  const fmt = (s) => `${Math.round(s / 60)} min`;
  const progress = () => {
    const f = done / all.length, el = (Date.now() - t0) / 1000;
    fs.writeFileSync(progressFile, `${(f * 100).toFixed(1)} ${done}/${all.length} scenarios, ${fmt(el)} elapsed, about ${f > 0.03 ? fmt(el / f - el) : '?'} left, ${errors.length} errors\n`);
  };
  console.log(`full targets: ${all.length} scenarios, ${WORKERS} workers`);
  progress();
  const finish = () => {
    const div = priceOf('Divine Orb') || 1;
    const NAMES = ['cheap', 'balanced', 'premium'];
    const q = (arr, p) => { const a = arr.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
    const groups = {};
    for (const r of results) {
      const k = `${r.cls === 'Jewel' ? (/^Time-Lost/.test(r.base) ? 'Jewel (Time-Lost)' : 'Jewel') : 'Gear'} | ${r.start}`;
      (groups[k] = groups[k] || []).push(r);
    }
    const L = ['# Full-target coverage', '', `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. ${results.length} scenarios (${errors.length} errors): every modifier slot is a target (gear: 3 prefixes + 3 suffixes; jewel: 3 suffixes, a prefix and the liquid emotion modifier), from a white and from a Rare start, item level 82. Costs in Divine Orbs (1 = ${Math.round(div)} ex).`, '',
      '| Items | Profile | Route | No route | Chance to finish (median) | Cost per finished item (median) | Uses per run (median) |', '|---|---|---|---|---|---|---|'];
    const lines = [];
    for (const [k, rs] of Object.entries(groups).sort()) {
      for (const n of NAMES) {
        const ok = rs.filter((r) => r.profiles[n] && r.profiles[n].status === 'route');
        const row = `| ${k} (${rs.length}) | ${n} | ${ok.length} | ${rs.length - ok.length} | ${ok.length ? Math.round(q(ok.map((r) => r.profiles[n].p), 0.5) * 100) + '%' : '-'} | ${ok.length ? Math.round(q(ok.map((r) => r.profiles[n].cps), 0.5) / div).toLocaleString('en-US') + ' div' : '-'} | ${ok.length ? q(ok.map((r) => r.profiles[n].uses), 0.5) : '-'} |`;
        L.push(row); lines.push(row);
      }
    }
    const ms = results.map((r) => r.plannerMs);
    L.push('', `Planner time per item (three plans): ${(q(ms, 0.5) / 1000).toFixed(0)} s median, ${(q(ms, 0.9) / 1000).toFixed(0)} s at 90%, ${(q(ms, 1) / 1000).toFixed(0)} s at most (25 runs side by side).`, '');
    const bad = results.filter((r) => NAMES.some((n) => !r.profiles[n] || r.profiles[n].status !== 'route'));
    if (bad.length) {
      L.push('## Without a route', '', '| Scenario | Profile | Why |', '|---|---|---|');
      for (const r of bad) for (const n of NAMES) if (!r.profiles[n] || r.profiles[n].status !== 'route') L.push(`| ${r.id} | ${n} | ${r.profiles[n] ? r.profiles[n].status + ': ' + (r.profiles[n].why || []).join('; ') : 'none'} |`);
      L.push('');
    }
    const low = results.filter((r) => NAMES.some((n) => r.profiles[n] && r.profiles[n].status === 'route' && r.profiles[n].p < 0.5));
    if (low.length) {
      L.push('## Routes that finish in fewer than half of the runs (600 uses a run)', '', '| Scenario | Profile | Chance | Cost | Not finished | Dead end |', '|---|---|---|---|---|---|');
      for (const r of low) for (const n of NAMES) { const x = r.profiles[n]; if (x && x.status === 'route' && x.p < 0.5) L.push(`| ${r.id} | ${n} | ${Math.round(x.p * 100)}% | ${Math.round(x.cps / div).toLocaleString('en-US')} div | ${Math.round(x.unfinished * 100)}% | ${Math.round(x.dead * 100)}% |`); }
      L.push('');
    }
    const tag = SEVEN ? '-seven' : '';
    fs.writeFileSync(path.join(reports, `full-targets${tag}.md`), L.join('\n').replace('gear: 3 prefixes + 3 suffixes', SEVEN ? "gear with the rune Serle's Triumph: 3 prefixes + 4 suffixes" : 'gear: 3 prefixes + 3 suffixes'));
    fs.writeFileSync(path.join(reports, `full-targets${tag}.json`), JSON.stringify({ date: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), results, errors }, null, 1));
    fs.writeFileSync(progressFile, `100.0 ${done}/${all.length} scenarios, finished in ${Math.round((Date.now() - t0) / 60000)} min, ${errors.length} errors\n`);
    console.log(`full targets: ${results.length} scenarios in ${Math.round((Date.now() - t0) / 60000)} min, ${errors.length} errors; planner time ${(q(ms, 0.5) / 1000).toFixed(0)} s median, ${(q(ms, 0.9) / 1000).toFixed(0)} s at 90%`);
    console.log(lines.join('\n'));
    console.log(`without a route in some profile: ${bad.length}; under 50% in some profile: ${low.length}`);
    if (errors.length) console.log('errors: ' + errors.slice(0, 3).map((e) => String(e.error).split('\n').slice(0, 3).join(' | ')).join('\n  '));
    process.exit(0);
  };
  const feed = (w) => { if (next >= all.length) { w.cur = null; w.terminate(); return; } w.cur = all[next++]; w.postMessage(w.cur); };
  const settle = () => { done++; progress(); if (done === all.length) finish(); };
  const spawn = () => {
    const w = new Worker(__filename, { argv: process.argv.slice(2), workerData: 'full-targets' });
    w.on('message', (m) => { if (m.res.error) errors.push(m.res); else results.push(m.res); feed(w); settle(); });
    w.on('error', (e) => { const sc = w.cur; if (!sc) return; errors.push({ id: sc.id, error: String(e && e.stack || e) }); w.cur = null; feed(spawn()); settle(); });
    return w;
  };
  for (let i = 0; i < Math.min(WORKERS, all.length); i++) feed(spawn());
}

module.exports = { fullTargets };
