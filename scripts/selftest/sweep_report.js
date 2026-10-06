/* Report of an exhaustive sweep (see sweep.js).
 *
 *   node scripts/selftest/sweep_report.js [reports/sweep-latest.json | reports/sweep-partial.jsonl] [--planner <check.json>]
 *
 * Reads the saved scenarios and writes reports/sweep-latest.md and reports/sweep-summary.json: how the verified picks
 * of the three profiles came out, how the page planner's picks compare with them, which settings the verified picks
 * use, and where the planner misses. With --planner the planner's side comes from a later planner check
 * (sweep_planner.js) instead of the picks saved with the sweep.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, P } = require('./lib.js');

const NAMES = ['cheap', 'balanced', 'premium'];
const DEFAULTS = P.expandStrategy({});

function load(file) {
  const txt = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) return { meta: null, scenarios: txt.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) };
  const rep = JSON.parse(txt);
  return { meta: rep.meta, scenarios: rep.scenarios };
}

/**
 * Settings of a class without the ones that cannot change anything on these scenarios: a Gnawed bone is refused above
 * item level 64 (every scenario is item level 82 or more), so "bones for base modifiers" with a Gnawed bone is the plain
 * strategy; settings left at their default are dropped.
 */
function canon(params, hasDes) {
  const p = Object.assign({}, params);
  if (p.bone === 'Gnawed' && !hasDes) { delete p.bone; delete p.echoes; delete p.desSlam; }
  for (const k of Object.keys(p)) if (p[k] === DEFAULTS[k]) delete p[k];
  return p;
}
/** Settings where two classes really differ: read by both with other values, or used (not default) by only one. */
function differs(a, b) {
  const out = [];
  for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
    if (a[k] === b[k]) continue;
    out.push(`${k}: ${a[k] === undefined ? 'default' : a[k]} → ${b[k] === undefined ? 'default' : b[k]}`);
  }
  return out;
}
const q = (arr, p) => { const a = arr.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };
const pc = (n, d) => (d ? Math.round(100 * n / d) + '%' : '-');
const num = (n) => (n == null ? '-' : Math.round(n).toLocaleString('en-US'));

function analyse(scenarios, plannerCheck) {
  const per = {};
  for (const n of NAMES) per[n] = { verified: 0, replaced: 0, cheaperLeft: 0, saferLeft: 0, unstable: 0, planner: { same: 0, equal: 0, better: 0, worse: 0, none: 0 }, byStart: {}, ratios: [], dps: [],
    patterns: {}, uses: {}, worse: [] };
  const tot = { scenarios: scenarios.length, sets: 0, skipped: 0, classes: 0, combinations: 0, sims: 0, capped: 0, sameAll: 0, withAll: 0 };
  for (const sc of scenarios) {
    tot.sims += sc.sims || 0;
    if (sc.skip) { tot.skipped++; continue; }
    const picksOf = {};
    for (const set of sc.sets) {
      if (set.skip || set.noSuccess) { tot.skipped++; continue; }
      tot.sets++; tot.classes += set.classes || 0; tot.combinations += set.combinations || 0; if (set.capped) tot.capped++;
      const hasDes = set.goals.some((g) => g.des);
      for (const [n, pk] of Object.entries(set.picks)) {
        const x = per[n];
        x.verified++;
        if (pk.assignedFromB === 'replaced') x.replaced++;
        if (pk.cheaperExists) x.cheaperLeft++;
        if (pk.saferExists) x.saferLeft++;
        if (!pk.recheck.stable) x.unstable++;
        const best = canon(pk.pick.params, hasDes);
        picksOf[n] = JSON.stringify(best) + '|' + JSON.stringify(set.goals.map((g) => g.eff));
        for (const [k, v] of Object.entries(best)) { const u = x.uses[k] || (x.uses[k] = {}); u[v] = (u[v] || 0) + 1; }
        // the planner's side: saved with the sweep, or from a later planner check
        let pl = pk.planner;
        const chk = plannerCheck && plannerCheck[sc.id] && plannerCheck[sc.id][n];
        if (chk) pl = chk;
        const bs = x.byStart[sc.start] || (x.byStart[sc.start] = { same: 0, equal: 0, better: 0, worse: 0, none: 0 });
        x.planner[pl.verdict]++; bs[pl.verdict]++;
        if (pl.verdict === 'worse') {
          x.ratios.push(pl.costRatio); x.dps.push(pl.dp);
          const d = pl.pick ? differs(canon(pl.pick.params, hasDes), best) : [];
          for (const k of d) x.patterns[k] = (x.patterns[k] || 0) + 1;
          x.worse.push({ id: sc.id, costRatio: pl.costRatio, dp: pl.dp, differs: d, planner: pl.pick && { p: pl.pick.p, cps: pl.pick.cps }, best: { p: pk.pick.p, cps: pk.pick.cps } });
        }
      }
    }
    if (NAMES.every((n) => picksOf[n])) { tot.withAll++; if (picksOf.cheap === picksOf.balanced && picksOf.balanced === picksOf.premium) tot.sameAll++; }
  }
  for (const n of NAMES) {
    const x = per[n];
    x.ratio = { p50: q(x.ratios, 0.5), p90: q(x.ratios, 0.9), max: q(x.ratios, 1) };
    x.dp = { p50: q(x.dps, 0.5), p10: q(x.dps, 0.1) };
    x.patterns = Object.entries(x.patterns).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([change, c]) => ({ change, n: c }));
    x.worse.sort((a, b) => (b.costRatio || 0) - (a.costRatio || 0));
    x.worseExamples = x.worse.slice(0, 20);
    delete x.worse; delete x.ratios; delete x.dps;
  }
  return { totals: tot, profiles: per };
}

function markdown(rep, meta, source) {
  const t = rep.totals;
  const L = ['# Exhaustive strategy sweep', '',
    `Source: \`${source}\`${meta ? `, ${meta.date.slice(0, 16).replace('T', ' ')} UTC, ${Math.round(meta.seconds / 60)} min on ${meta.workers} workers` : ''}.`, '',
    `- Scenarios: ${t.scenarios} (${t.sets} goal sets; ${t.skipped} skipped as impossible or without success)`,
    `- Strategy combinations covered: ${t.combinations.toLocaleString('en-US')}, in ${t.classes.toLocaleString('en-US')} classes that behave differently${t.capped ? ` (${t.capped} goal sets hit the class cap)` : ''}`,
    `- Simulations: ${t.sims.toLocaleString('en-US')}`,
    `- Scenarios where Cheap, Balanced and Premium ask for the same goals and end on the same strategy: ${t.sameAll} of ${t.withAll}`, '',
    '## Verification of the assigned strategies', '',
    'Each profile\'s strategy was assigned from 300-trial runs, then checked against the challengers with fresh random numbers (1,000 trials) and once more against the runner-up (4,000 trials).', '',
    '| Profile | Verified | Replaced by the check | A cheaper one left | A safer one left | Order changed on the last recheck |', '|---|---|---|---|---|---|'];
  for (const n of NAMES) { const x = rep.profiles[n]; L.push(`| ${n} | ${x.verified} | ${x.replaced} | ${x.cheaperLeft} | ${x.saferLeft} | ${x.unstable} |`); }
  L.push('', '"A cheaper one left" and "a safer one left" are trades the profile makes on purpose: Premium keeps a strategy that finishes more often although a cheaper one exists, Cheap keeps the cheapest although another finishes more often.', '',
    '## The page planner against the verified best', '',
    '| Profile | Same strategy | Equal result | Better | Worse | Worse: cost x (median / 90% / max) |', '|---|---|---|---|---|---|');
  for (const n of NAMES) {
    const x = rep.profiles[n], pl = x.planner, tot = pl.same + pl.equal + pl.better + pl.worse;
    L.push(`| ${n} | ${pl.same} (${pc(pl.same, tot)}) | ${pl.equal} (${pc(pl.equal, tot)}) | ${pl.better} | ${pl.worse} (${pc(pl.worse, tot)}) | ${x.ratio.p50 == null ? '-' : `x${x.ratio.p50.toFixed(2)} / x${x.ratio.p90.toFixed(2)} / x${x.ratio.max.toFixed(1)}`} |`);
  }
  L.push('', '"Equal result": another strategy within 5% of the cost and the same chance to finish. "Better": the planner found a strategy the sweep\'s screening had dropped.', '');
  L.push('By start item (same + equal / worse):', '', '| Profile | ' + ['white', 'magic', 'rare', 'rare-low'].join(' | ') + ' |', '|---|---|---|---|---|');
  for (const n of NAMES) L.push(`| ${n} | ` + ['white', 'magic', 'rare', 'rare-low'].map((s) => { const b = rep.profiles[n].byStart[s]; return b ? `${b.same + b.equal + b.better} / ${b.worse}` : '-'; }).join(' | ') + ' |');
  L.push('');
  for (const n of NAMES) {
    const x = rep.profiles[n];
    if (!x.patterns.length) continue;
    L.push(`### ${n}: what the verified best does differently where the planner is worse`, '', x.patterns.map((p) => `- ${p.n}× ${p.change}`).join('\n'), '');
  }
  L.push('## Settings the verified strategies use (other than the defaults)', '', '| Setting | Cheap | Balanced | Premium |', '|---|---|---|---|');
  const keys = [...new Set(NAMES.flatMap((n) => Object.keys(rep.profiles[n].uses)))];
  for (const k of keys) L.push(`| ${k} | ` + NAMES.map((n) => { const u = rep.profiles[n].uses[k]; return u ? Object.entries(u).sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v} ${c}`).join(', ') : '-'; }).join(' | ') + ' |');
  L.push('');
  for (const n of NAMES) {
    const x = rep.profiles[n];
    if (!x.worseExamples.length) continue;
    L.push(`### ${n}: largest gaps`, '', '| Scenario | Planner (chance, cost) | Verified best | Cost x | Difference |', '|---|---|---|---|---|');
    for (const w of x.worseExamples.slice(0, 12)) L.push(`| ${w.id} | ${w.planner ? `${Math.round(w.planner.p * 100)}%, ${num(w.planner.cps)} ex` : '-'} | ${Math.round(w.best.p * 100)}%, ${num(w.best.cps)} ex | x${w.costRatio} | ${w.differs.join(', ')} |`);
    L.push('');
  }
  return L.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--planner');
  const plannerCheck = pi >= 0 ? JSON.parse(fs.readFileSync(args[pi + 1], 'utf8')).scenarios : null;
  const file = args.find((a, i) => !a.startsWith('--') && (pi < 0 || i !== pi + 1)) || path.join(ROOT, 'reports', 'sweep-latest.json');
  const { meta, scenarios } = load(file);
  const rep = analyse(scenarios, plannerCheck);
  const reports = path.join(ROOT, 'reports');
  fs.writeFileSync(path.join(reports, 'sweep-latest.md'), markdown(rep, meta, path.relative(ROOT, file).replace(/\\/g, '/')));
  fs.writeFileSync(path.join(reports, 'sweep-summary.json'), JSON.stringify(Object.assign({ meta }, rep), null, 1));
  const t = rep.totals;
  console.log(`${t.scenarios} scenarios, ${t.sets} goal sets, ${t.classes.toLocaleString('en-US')} classes for ${t.combinations.toLocaleString('en-US')} combinations, ${t.sims.toLocaleString('en-US')} simulations`);
  for (const n of NAMES) {
    const x = rep.profiles[n], pl = x.planner;
    console.log(`${n.padEnd(9)} verified ${x.verified}, replaced ${x.replaced}, cheaper left ${x.cheaperLeft}, safer left ${x.saferLeft}, unstable ${x.unstable} | planner same ${pl.same} equal ${pl.equal} better ${pl.better} worse ${pl.worse}${x.ratio.p50 != null ? ` (cost x${x.ratio.p50.toFixed(2)} median, x${x.ratio.p90.toFixed(2)} at 90%)` : ''}`);
    for (const p of x.patterns.slice(0, 8)) console.log(`            ${p.n}x ${p.change}`);
  }
}

module.exports = { analyse, markdown, canon, differs, load };
