/* PoE2 Craft Assistant — self-test (F6).
 *
 *   node scripts/selftest/run.js [--quick] [--workers N]
 *
 * 1. Rule checks: random walks through every operator with invariant checks after each step, roll frequencies
 *    against the weights, and a parser round trip (Alt+Ctrl+C and Ctrl+C text) of the walked items.
 * 2. Strategy mining: every strategy the planner knows, on scenarios built from each test base (start item x goals).
 * 3. Knowledge: technique pros and cons with evidence, best and shortest routes, and a before/after comparison with
 *    the recipe library (and with the previous self-test run, when there is one).
 * Writes app/data/insights_0.5.5.json (read by the page) and reports/selftest-<date>.json (full results).
 * The self-test checks that the simulator follows the data and the rules; it cannot prove how the game behaves.
 */
'use strict';
const { Worker, isMainThread, parentPort } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

if (!isMainThread) {
  const walk = require('./walk.js');
  const mine = require('./mine.js');
  parentPort.on('message', (t) => {
    let res;
    try {
      if (t.type === 'walk') res = walk.walkBase(t.base, t.opts);
      else if (t.type === 'freq') res = walk.frequencyTest(t.base, t.seed, t.n);
      else res = mine.mineScenario(t.sc, t.opts);
    } catch (e) { res = { error: String(e && e.stack || e), task: t }; }
    parentPort.postMessage({ id: t.id, type: t.type, res });
  });
  return;
}

const { E, P, ROOT, load, weightsFor, essencesFor, renderItem, rng, testBases, flaskBases } = require('./lib.js');
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const WORKERS = +(args[args.indexOf('--workers') + 1] || 0) || Math.max(2, Math.min(30, os.cpus().length - 2));
const CFG = QUICK
  ? { walks: 4, steps: 40, freqN: 5000, trials: 80, maxSteps: 200, bases: 8 }
  : { walks: 200, steps: 100, freqN: 60000, trials: 300, maxSteps: 400, bases: 999 };

// ---------------------------------------------------------------- scenarios
function whiteItem(base, ilvl) {
  const { ix, kb } = load();
  return E.parseItem(ix, renderItem({ base, cls: kb.bases[base].cls, rarity: 'Normal', ilvl, mods: [] }, rng(1), 'adv').text).item;
}
const labelOf = (id) => E.template(load().kb.mods[id].txt.split('\n')[0]);

/** Goal families of a base: per side a rare (low weight) and a common (high weight) family with a T1 at item level 82. */
function goalFamilies(base) {
  const { ix, kb } = load();
  const item = whiteItem(base, 82);
  const ctx = P.makeContext(ix, item, { weights: weightsFor(base) });
  const fams = {};
  for (const side of ['prefix', 'suffix']) {
    const byFam = new Map();
    for (const e of P.sidePool(ctx, side, 0)) {
      const f = byFam.get(e.fam) || { fam: e.fam, side, w: 0, best: e };
      f.w += e.w;
      if (e.tier < f.best.tier) f.best = e;
      byFam.set(e.fam, f);
    }
    const list = [...byFam.values()].filter((f) => f.best.tier === 1 && !/Essence/.test(f.fam)).sort((a, b) => b.w - a.w);
    fams[side] = list.length ? { common: list[Math.floor(list.length * 0.2)], rare: list[Math.floor(list.length * 0.75)] } : null;
  }
  const res = P.sidePool(ctx, 'suffix', 0).find((e) => e.fam === 'FireResistance') ? 'FireResistance' : null;
  const cls = kb.bases[base].cls;
  const ess = essencesFor(cls).find((r) => r.kind === 'magic' && ctx.pool.has(r.mod));
  const des = ctx.bone ? [...E.desecratedPoolFor(ix, base).entries()].map(([id, pe]) => ({ id, pe })).find((x) => x.pe.side === 'suffix' && !E.lichOf(kb.mods[x.id])) : null;
  return { ctx, fams, res, ess, des };
}

function scenarios(bases) {
  const { kb } = load();
  const out = [];
  let seed = 100;
  const add = (base, group, start, targets) => out.push({ id: `${base}|${group}|${start}`, base, ilvl: 82, start, group, targets, seed: seed++ });
  const T = (key, fam, group, minTier, label) => ({ [key]: { fam, group, minTier, required: true, label } });
  for (const base of bases) {
    const g = goalFamilies(base);
    const p = g.fams.prefix, s = g.fams.suffix;
    if (p) {
      add(base, 'single-prefix-rare-T1', 'white', T('prefix-0', p.rare.fam, 'prefix', 1, labelOf(p.rare.best.id)));
      add(base, 'single-prefix-rare-T1', 'rare', T('prefix-0', p.rare.fam, 'prefix', 1, labelOf(p.rare.best.id)));
      add(base, 'single-prefix-rare-T1', 'rare-low', T('prefix-0', p.rare.fam, 'prefix', 1, labelOf(p.rare.best.id)));
      add(base, 'single-prefix-common-T2', 'rare', T('prefix-0', p.common.fam, 'prefix', 2, labelOf(p.common.best.id)));
    }
    if (s) {
      add(base, 'single-suffix-rare-T1', 'white', T('suffix-0', s.rare.fam, 'suffix', 1, labelOf(s.rare.best.id)));
      add(base, 'single-suffix-rare-T1', 'rare', T('suffix-0', s.rare.fam, 'suffix', 1, labelOf(s.rare.best.id)));
      add(base, 'single-suffix-rare-T1', 'rare-low', T('suffix-0', s.rare.fam, 'suffix', 1, labelOf(s.rare.best.id)));
      add(base, 'single-suffix-common-T2', 'rare', T('suffix-0', s.common.fam, 'suffix', 2, labelOf(s.common.best.id)));
    }
    if (g.res) {
      add(base, 'resistance-T2', 'white', T('suffix-0', 'FireResistance', 'suffix', 2, '+#% to Fire Resistance'));
      add(base, 'resistance-T2', 'rare', T('suffix-0', 'FireResistance', 'suffix', 2, '+#% to Fire Resistance'));
    }
    if (g.ess) {
      const m = kb.mods[g.ess.mod], side = m.gen === 'p' ? 'prefix' : 'suffix';
      const tier = g.ctx.pool.get(g.ess.mod).tier;
      add(base, 'essence-reachable', 'white', T(side + '-0', m.fam, side, tier, labelOf(g.ess.mod)));
      add(base, 'essence-reachable', 'magic', T(side + '-0', m.fam, side, tier, labelOf(g.ess.mod)));
    }
    if (p && s) {
      const two = Object.assign(T('prefix-0', p.rare.fam, 'prefix', 2, labelOf(p.rare.best.id)), T('suffix-0', s.common.fam, 'suffix', 2, labelOf(s.common.best.id)));
      add(base, 'pair-prefix-suffix-T2', 'white', two);
      add(base, 'pair-prefix-suffix-T2', 'rare', two);
    }
    if (s && g.res && s.rare.fam !== 'FireResistance') {
      const two = Object.assign(T('suffix-0', s.rare.fam, 'suffix', 2, labelOf(s.rare.best.id)), T('suffix-1', 'FireResistance', 'suffix', 3, '+#% to Fire Resistance'));
      add(base, 'pair-two-suffixes', 'rare', two);
    }
    // Rings and amulets with 20% catalyst quality of the goal's type (Omen of Catalysing Exaltation)
    if (['Ring', 'Amulet'].includes(kb.bases[base].cls)) {
      const life = P.sidePool(g.ctx, 'prefix', 0).concat(P.sidePool(g.ctx, 'suffix', 0)).filter((e) => (kb.mods[e.id].mt || []).includes('life') && !/Essence/.test(e.fam)).sort((a, b) => a.tier - b.tier)[0];
      if (life) {
        out.push({ id: `${base}|catalyst-life|rare`, base, ilvl: 82, start: 'rare', group: 'catalyst-life', seed: seed++, quality: 20, qualityType: 'Life Modifiers',
          targets: T(life.side + '-0', life.fam, life.side, 2, labelOf(life.id)) });
      }
    }
    if (g.des) add(base, 'desecrated', 'rare', { 'suffix-2': { fam: kb.mods[g.des.id].fam, group: 'desecrated', minTier: null, required: true, label: labelOf(g.des.id) } });
  }
  return out;
}

/** Scenarios for the recipes of the library, so the simulation can confirm or improve them. */
function recipeScenarios(bases) {
  const { ix, kb, lib } = load();
  const out = [], skipped = [];
  for (const r of lib.recipes) {
    if (!r.target || !r.target.length || r.classes.includes('*')) { skipped.push({ id: r.id, why: 'a general technique (no item class or goals to simulate)' }); continue; }
    // The self-test starts from a white base; recipes that start from a prepared item or use alloys are not comparable.
    const txt = r.steps.map((x) => x.text).join(' ');
    if (/^\s*Fractured\b|\bstart (from|with) an? (item|base) (that|with)\b/i.test(r.steps[0] ? r.steps[0].text : '') || /\bAlloy\b/.test(txt)) {
      skipped.push({ id: r.id, why: 'starts from a prepared item or uses Runic Alloys; the self-test simulates routes from a white base' }); continue;
    }
    // The recipe's required goals (nice-to-have ones are a checkpoint, not the recipe's promise), on the first test
    // base of its classes where every goal can roll.
    const want = r.target.filter((t) => t.required !== false);
    let base = null, targets = null, miss = null;
    for (const b of bases.filter((x) => r.classes.includes(kb.bases[x].cls))) {
      const item = whiteItem(b, Math.max(82, r.min_ilvl || 1));
      const tg = {}, count = { prefix: 0, suffix: 0 };
      miss = null;
      for (const t of want) {
        const f = E.resolveTemplateTarget(ix, item, t.stat);
        if (!f) { miss = `"${t.stat}" does not roll on ${b}`; break; }
        tg[f.side + '-' + count[f.side]++] = { fam: f.fam, group: f.group, minTier: t.minTier || null, required: true, label: f.label };
      }
      if (!miss) { base = b; targets = tg; break; }
    }
    if (!base) { skipped.push({ id: r.id, why: miss || 'no test base of ' + r.classes.join('/') }); continue; }
    out.push({ id: `recipe|${r.id}`, base, ilvl: Math.max(82, r.min_ilvl || 1), start: 'white', group: 'recipe', recipe: r.id, targets, seed: 900 + out.length });
  }
  return { out, skipped };
}

// ---------------------------------------------------------------- worker pool
function runPool(tasks, onDone) {
  return new Promise((resolve) => {
    let next = 0, done = 0;
    const workers = [];
    const t0 = Date.now();
    const feed = (w) => {
      if (next >= tasks.length) { w.terminate(); return; }
      const t = tasks[next++];
      w.postMessage(t);
    };
    for (let i = 0; i < Math.min(WORKERS, tasks.length); i++) {
      const w = new Worker(__filename);
      w.on('message', (m) => {
        onDone(m);
        done++;
        if (done % 25 === 0 || done === tasks.length) process.stdout.write(`\r  ${done}/${tasks.length} tasks, ${((Date.now() - t0) / 1000).toFixed(0)} s   `);
        if (done === tasks.length) { process.stdout.write('\n'); resolve(); }
        feed(w);
      });
      w.on('error', (e) => { console.error('worker error', e); });
      workers.push(w);
      feed(w);
    }
  });
}

// ---------------------------------------------------------------- analysis
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (x) => Math.round(x * 100);

function describe(p, withStart) {
  const parts = [];
  parts.push(p.tier === 'perfect' ? 'Perfect orbs' : p.tier === 'greater' ? 'Greater orbs' : 'basic orbs');
  if (p.sideOmens) parts.push('side omens');
  if (p.greaterExalt) parts.push('Greater Exaltation');
  parts.push({ chaos: 'Chaos Orb', erasure: 'Chaos + Erasure', whittle: 'Chaos + Whittling', annul: 'Annulment' }[p.removal] || p.removal);
  if (withStart && p.start) parts.push(p.start === 'alchemy' ? 'start with Alchemy' : 'start with Transmutation' + (p.restart ? ', new base on a miss' : ''));
  if (p.essence) parts.push('essences');
  if (p.fracture) parts.push('fracture');
  if (p.catalyse) parts.push('catalysing');
  if (p.flux === false) parts.push('no flux');
  return parts.join(', ');
}

/**
 * Best result of a scenario: cheapest per success. Cost per success already charges the runs that did not finish
 * within the use limit, so cheap but long loops compete fairly; runs under 20% success are left out as too noisy.
 */
function best(sc) {
  const ok = sc.results.filter((r) => r.p >= 0.2 && r.cps != null);
  // equal results: the plain strategy, not a variant that changed nothing (fracture, no flux...)
  if (ok.length) return ok.sort((a, b) => a.cps - b.cps || b.p - a.p || (a.tag ? 1 : 0) - (b.tag ? 1 : 0))[0];
  return sc.results.slice().sort((a, b) => b.p - a.p || (a.cps || 1e18) - (b.cps || 1e18))[0] || null;
}
function shortest(sc) {
  const ok = sc.results.filter((r) => r.p >= 0.8);
  return ok.length ? ok.sort((a, b) => a.steps - b.steps)[0] : null;
}

const TECH = [
  { id: 'sideOmens', label: 'Sinistral/Dextral omens (aim the side)', a: { sideOmens: false }, b: { sideOmens: true } },
  { id: 'greaterExalt', label: 'Omen of Greater Exaltation (two mods at once)', a: { greaterExalt: false }, b: { greaterExalt: true } },
  { id: 'erasure', label: 'Erasure omen on Chaos Orbs (vs plain Chaos)', a: { removal: 'chaos' }, b: { removal: 'erasure' } },
  { id: 'whittle', label: 'Omen of Whittling (vs Erasure)', a: { removal: 'erasure' }, b: { removal: 'whittle' } },
  { id: 'annul', label: 'Annulment instead of Chaos + Erasure', a: { removal: 'erasure' }, b: { removal: 'annul' } },
  { id: 'greater', label: 'Greater orbs (vs basic)', a: { tier: 'base' }, b: { tier: 'greater' } },
  { id: 'perfect', label: 'Perfect orbs (vs Greater)', a: { tier: 'greater' }, b: { tier: 'perfect' } },
  { id: 'alchemy', label: 'Start with Orb of Alchemy (vs Transmutation)', a: { start: 'transmute' }, b: { start: 'alchemy' } },
  { id: 'essence', label: 'Essences when one guarantees a goal', a: { essence: false }, b: { essence: true } },
  { id: 'fracture', label: 'Fracture a finished goal', a: { fracture: undefined }, b: { fracture: true } },
  { id: 'catalyse', label: 'Omen of Catalysing Exaltation', a: { catalyse: undefined }, b: { catalyse: true } },
  { id: 'flux', label: 'Flux shortcut for resistances', a: { flux: false }, b: { flux: undefined } },
];

/** Compare pairs of strategies that differ only in one technique, per scenario, and sum up cost and success apart. */
function techniques(mined) {
  const out = [];
  for (const t of TECH) {
    const k = Object.keys(t.a)[0];
    const norm = (p) => { const o = Object.assign({}, p); delete o[k]; for (const x of Object.keys(o)) if (o[x] === undefined) delete o[x]; return JSON.stringify(o, Object.keys(o).sort()); };
    const is = (v, want) => v === want || (want === undefined && v === undefined);
    const rows = [];
    let scenarios = 0;
    for (const sc of mined) {
      const A = new Map(), B = new Map();
      for (const r of sc.results) {
        if (is(r.params[k], t.a[k])) A.set(norm(r.params), r);
        else if (is(r.params[k], t.b[k])) B.set(norm(r.params), r);
      }
      let used = false;
      for (const [key, a] of A) {
        const b = B.get(key);
        if (!b || (a.p === b.p && a.cost === b.cost)) continue; // the technique never came into play here
        used = true;
        const ratio = a.cps && b.cps ? b.cps / a.cps : null;
        rows.push({ sc, tier: a.params.tier, ratio, dp: b.p - a.p, dlost: b.lost - a.lost });
      }
      if (used) scenarios++;
    }
    if (!rows.length) { out.push({ id: t.id, label: t.label, scenarios: 0, comparisons: 0, verdict: 'no effect', text: 'Never changed a result in these scenarios.' }); continue; }
    const withRatio = rows.filter((r) => r.ratio != null);
    const share = (f, list) => (list.length ? list.filter(f).length / list.length : 0);
    const cheaper = share((r) => r.ratio < 0.95, withRatio), costlier = share((r) => r.ratio > 1.05, withRatio);
    const likelier = share((r) => r.dp > 0.05, rows), lessLikely = share((r) => r.dp < -0.05, rows);
    const ratio = median(withRatio.map((r) => r.ratio)), dp = median(rows.map((r) => r.dp)), dlost = median(rows.map((r) => r.dlost));
    let verdict = 'mixed';
    if (cheaper >= 0.66 && dp >= -0.02) verdict = 'pro';
    else if (costlier >= 0.66 && dp <= 0.02) verdict = 'con';
    else if (costlier >= 0.5 && likelier >= 0.3) verdict = 'trade-off';
    if (withRatio.length < 30) verdict = 'too little data'; // a handful of comparisons is not evidence
    const group = (key) => {
      const g = {};
      for (const r of withRatio) (g[key(r)] = g[key(r)] || []).push(r.ratio);
      return Object.entries(g).filter(([, v]) => v.length >= 5).map(([name, v]) => ({ name, n: v.length, ratio: +median(v).toFixed(3), cheaper: +share((x) => x < 0.95, v.map((x) => ({ ratio: x })).map((x) => x.ratio)).toFixed(2) }));
    };
    const byTier = group((r) => r.tier || 'base').sort((a, b) => a.name.localeCompare(b.name));
    const byGroup = group((r) => r.sc.group + ' · ' + r.sc.start);
    const fmtR = (x) => (x == null ? '?' : x >= 10 ? Math.round(x) : x.toFixed(2));
    out.push({
      id: t.id, label: t.label, scenarios, comparisons: rows.length, verdict,
      cheaper: +cheaper.toFixed(2), costlier: +costlier.toFixed(2), likelier: +likelier.toFixed(2), lessLikely: +lessLikely.toFixed(2),
      medianCostRatio: ratio != null ? +ratio.toFixed(3) : null, medianSuccessDelta: dp != null ? +dp.toFixed(3) : null, medianLostDelta: dlost != null ? +dlost.toFixed(3) : null,
      byTier, helpsMost: byGroup.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 3), hurtsMost: byGroup.slice().sort((a, b) => b.ratio - a.ratio).slice(0, 3),
      text: `Cheaper per success in ${pct(cheaper)}% of ${withRatio.length} comparisons (median x${fmtR(ratio)}), more likely to finish in ${pct(likelier)}%, less likely in ${pct(lessLikely)}%`
        + (byTier.length > 1 ? `. By orb tier: ${byTier.map((x) => `${x.name} x${fmtR(x.ratio)}`).join(', ')}` : '') + '.',
    });
  }
  return out;
}

/** Most common best route per scenario group, with median cost and uses. */
function routes(mined) {
  const groups = {};
  for (const sc of mined) {
    const b = best(sc);
    if (!b) continue;
    const g = sc.group + ' · ' + sc.start;
    const x = groups[g] || (groups[g] = { group: g, n: 0, costs: [], steps: [], routes: {}, success: [] });
    x.n++; x.costs.push(b.cps || b.cost); x.steps.push(b.steps); x.success.push(b.p);
    const d = describe(b.params, sc.start === 'white');
    x.routes[d] = (x.routes[d] || 0) + 1;
  }
  return Object.values(groups).map((x) => {
    const top = Object.entries(x.routes).sort((a, b) => b[1] - a[1]);
    return { group: x.group, scenarios: x.n, bestRoute: top[0][0], share: +(top[0][1] / x.n).toFixed(2), runnerUp: top[1] ? top[1][0] : null,
      medianCostPerSuccess: +median(x.costs).toFixed(1), medianUses: +median(x.steps).toFixed(1), medianSuccess: +median(x.success).toFixed(3) };
  }).sort((a, b) => a.group.localeCompare(b.group));
}

/** Short, near-certain routes (at most 3 uses on average, 90%+ success): the "clever shortcuts". */
function shortcuts(mined) {
  const out = [];
  for (const sc of mined) {
    const s = shortest(sc);
    if (!s || s.steps > 3 || s.p < 0.9) continue;
    out.push({ cls: sc.cls, base: sc.base, start: sc.start, goals: sc.goals.map((g) => `${g.label}${g.tier ? ' T' + g.tier : ''}`).join(' + '),
      route: s.route.map((x) => x.k).join(' > '), uses: s.steps, success: s.p, cost: s.cost });
  }
  const seen = new Set();
  return out.filter((x) => { const k = x.cls + x.goals + x.route; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.cost - b.cost).slice(0, 60);
}

/** Recipe techniques read from its step names, to find the simulated strategy that is closest to the recipe. */
function recipeFeatures(r) {
  const txt = r.steps.map((s) => s.text + ' ' + (s.names || []).join(' ')).join(' ');
  const f = {};
  if (/Sinistral|Dextral/.test(txt)) f.sideOmens = true;
  if (/Omen of Greater Exaltation/.test(txt)) f.greaterExalt = true;
  if (/Whittling/.test(txt)) f.removal = 'whittle'; else if (/Erasure/.test(txt)) f.removal = 'erasure'; else if (/Annulment/.test(txt) && !/Omen of Light/.test(txt)) f.removal = 'annul';
  if (/Perfect (Exalted|Chaos|Regal|Orb of)/.test(txt)) f.tier = 'perfect'; else if (/Greater (Exalted|Chaos|Regal|Orb of)/.test(txt)) f.tier = 'greater';
  if (/Alchemy/.test(txt)) f.start = 'alchemy'; else if (/Transmutation/.test(txt)) f.start = 'transmute';
  if (/Essence/.test(txt)) f.essence = true;
  if (/Fracturing/.test(txt)) f.fracture = true;
  return f;
}
function compareRecipes(mined, recipeSkips, maxSteps) {
  const { lib } = load();
  const out = [];
  for (const r of lib.recipes) {
    const sc = mined.find((x) => x.recipe === r.id);
    const skip = recipeSkips.find((x) => x.id === r.id);
    if (skip || !sc || !sc.results.length) {
      out.push({ id: r.id, title: r.title, before: r.verdict, after: 'not simulated', note: skip ? skip.why : sc && sc.skip ? sc.skip : 'no result' });
      continue;
    }
    const f = recipeFeatures(r);
    const keys = Object.keys(f);
    const score = (res) => keys.filter((k) => res.params[k] === f[k]).length;
    const top = Math.max(...sc.results.map(score));
    // the recipe's route: among the strategies closest to its steps, the cheapest per success (same rule as best())
    const like = best({ results: sc.results.filter((x) => score(x) === top) });
    const b = best(sc);
    const ratio = like.cps && b.cps ? like.cps / b.cps : null;
    const after = ratio != null && ratio <= 1.15 ? 'confirmed' : like.p < 0.2 ? 'weak' : 'improvable';
    const slow = like.p < 0.5;
    out.push({
      id: r.id, title: r.title, base: sc.base, before: r.verdict, after, recipeFeatures: f, matched: `${top}/${keys.length}`,
      recipeRoute: describe(like.params, true), recipeCostPerSuccess: like.cps, recipeSuccess: like.p,
      bestRoute: describe(b.params, true), bestCostPerSuccess: b.cps, bestSuccess: b.p, ratio: ratio != null ? +ratio.toFixed(2) : null,
      slow,
      note: after === 'confirmed' ? `The cheapest simulated route per success follows the recipe (within 15%).${slow ? ` It is slow: ${pct(like.p)}% of runs finish within ${maxSteps} uses; the rest are charged as abandoned.` : ''}`
        : after === 'weak' ? `The recipe's route rarely finishes: ${pct(like.p)}% of runs within ${maxSteps} uses. Cheapest instead: ${describe(b.params, true)} (${pct(b.p)}%).`
        : `A route ${ratio != null ? ratio.toFixed(1) + 'x' : ''} cheaper per success: ${describe(b.params, true)}.`,
    });
  }
  return out;
}

/** What changed since the previous run (technique verdicts and route winners). */
function diffPrevious(prev, now) {
  if (!prev) return null;
  const changes = [];
  for (const t of now.techniques) {
    const p = (prev.techniques || []).find((x) => x.id === t.id);
    if (!p) { changes.push(`New technique measured: ${t.label} (${t.verdict}).`); continue; }
    if (p.verdict !== t.verdict) changes.push(`${t.label}: ${p.verdict} -> ${t.verdict}.`);
    else if (p.medianCostRatio && t.medianCostRatio && Math.abs(Math.log(t.medianCostRatio / p.medianCostRatio)) > 0.2) changes.push(`${t.label}: cost ratio x${p.medianCostRatio} -> x${t.medianCostRatio}.`);
  }
  for (const r of now.routes) {
    const p = (prev.routes || []).find((x) => x.group === r.group);
    if (p && p.bestRoute !== r.bestRoute) changes.push(`${r.group}: best route "${p.bestRoute}" -> "${r.bestRoute}".`);
  }
  return { previous: prev.meta && prev.meta.date, changes };
}

// ---------------------------------------------------------------- main
/** Checks that count flagged ambiguities of the copy formats, not errors: the paste shows them for a decision. */
const EXPECTED = {
  'parse-adv-flagged': 'same text as a local and a global mod; the paste shows a Pick with the right one listed',
  'parse-simple-exact': 'plain Ctrl+C has no tiers and overlapping ranges fit more than one; the paste marks these lines',
};
function printSummary(now) {
  const hard = now.checks.filter((c) => c.fail && !EXPECTED[c.id]);
  console.log(`done in ${now.meta.seconds} s: ${now.meta.walkSteps} checked steps, ${now.meta.roundTrips} parser round trips, ${now.meta.strategyRuns} strategy runs, ${now.meta.errors} errors`);
  console.log(`prices: ${now.meta.prices.league}, ${now.meta.prices.feed || '24h median'} to ${now.meta.prices.hourTo ? new Date(now.meta.prices.hourTo * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '?'} (${now.meta.prices.source || 'build copy'})`);
  console.log(`\nRULES AND PARSER: ${hard.length ? hard.length + ' CHECK(S) FAILED' : 'all checks passed'}`);
  for (const c of now.checks) {
    const res = !c.fail ? 'ok' : EXPECTED[c.id] ? `flagged ${c.fail} (expected: ${EXPECTED[c.id]})` : `FAIL ${c.fail}  e.g. ${c.examples[0]}`;
    console.log(`  ${c.id.padEnd(20)} ${String(c.n).padStart(8)}  ${res}`);
  }
  console.log(`  ${'frequencies'.padEnd(20)} ${String(now.freq.tests).padStart(8)}  ${now.freq.failed ? 'FAIL ' + now.freq.failed : 'ok'} (${now.freq.families} families, largest deviation ${now.freq.maxZ} sd, limit 4.5)`);
  console.log('\nTECHNIQUES (pro = cheaper per success, con = costs more, mixed = depends)');
  for (const t of now.techniques) console.log(`  ${t.verdict.padEnd(15)} ${t.label}: ${t.text}`);
  console.log('\nRECIPES: library verdict -> simulation');
  for (const r of now.recipes) console.log(`  ${r.id.padEnd(5)} ${String(r.before).padEnd(9)} -> ${r.after.padEnd(13)} ${r.note}`);
  const since = now.sincePrevious;
  console.log(`\nSINCE THE PREVIOUS RUN${since && since.previous ? ' (' + since.previous.slice(0, 16).replace('T', ' ') + ' UTC)' : ''}: ${since && since.changes.length ? '' : 'no conclusion changed'}`);
  if (since) for (const c of since.changes) console.log('  ' + c);
  console.log('\nFull results: reports/selftest-latest.json. The page shows them after the next build and publish.');
}

(async () => {
  const t0 = Date.now();
  const { kb, snap, W, lib, league } = load();
  // --reanalyze <report.json>: recompute the knowledge part from a saved run without simulating again
  const ri = args.indexOf('--reanalyze');
  if (ri >= 0) {
    const file = args[ri + 1];
    const rep = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mined = rep.mined;
    delete rep.mined;
    const main = mined.filter((x) => x.group !== 'recipe' && x.results.length);
    const rs = recipeScenarios(testBases());
    Object.assign(rep, { techniques: techniques(main), routes: routes(main), shortcuts: shortcuts(main), recipes: compareRecipes(mined, rs.skipped, rep.meta.maxSteps) });
    rep.meta.reanalyzed = new Date().toISOString();
    const ai = args.indexOf('--against');
    if (ai >= 0) rep.sincePrevious = diffPrevious(JSON.parse(fs.readFileSync(args[ai + 1], 'utf8')), rep);
    fs.writeFileSync(file, JSON.stringify(Object.assign({}, rep, { mined })));
    if (args.includes('--publish')) {
      fs.writeFileSync(path.join(ROOT, 'reports', 'selftest-latest.json'), JSON.stringify(rep, null, 1));
      fs.writeFileSync(path.join(ROOT, 'app', 'data', 'insights_0.5.5.json'), JSON.stringify(rep, null, 1));
    }
    printSummary(rep);
    process.exit(0);
  }
  let bases = testBases();
  if (QUICK) bases = bases.filter((b, i) => i % Math.ceil(bases.length / CFG.bases) === 0);
  const flasks = flaskBases(); // rule checks only: they stay Magic, the strategy mining compares Rare techniques
  console.log(`self-test: ${bases.length} bases + ${flasks.length} flasks/charms, ${WORKERS} workers${QUICK ? ' (quick)' : ''}; prices to ${snap.meta && snap.meta.hourTo ? new Date(snap.meta.hourTo * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '?'} from ${snap.source}`);

  // 1. rule checks
  const checked = bases.concat(flasks);
  const walkTasks = checked.map((base, i) => ({ id: 'w' + i, type: 'walk', base, opts: { walks: CFG.walks, steps: CFG.steps, seed: 1000 + i } }));
  const freqTasks = checked.map((base, i) => ({ id: 'f' + i, type: 'freq', base, seed: 2000 + i, n: CFG.freqN }));
  const walks = [], freqs = [], errors = [];
  console.log('1/3 rule checks');
  await runPool(walkTasks.concat(freqTasks), (m) => { if (m.res.error) errors.push(m.res); else (m.type === 'walk' ? walks : freqs).push(m.res); });
  const checks = {};
  for (const w of walks) for (const [id, c] of Object.entries(w.checks)) {
    const x = checks[id] || (checks[id] = { id, n: 0, fail: 0, examples: [] });
    x.n += c.n; x.fail += c.fail; for (const e of c.examples) if (x.examples.length < 5) x.examples.push(e);
  }
  const ops = {};
  for (const w of walks) for (const [op, n] of Object.entries(w.ops)) ops[op] = (ops[op] || 0) + n;
  const freq = { tests: freqs.reduce((a, f) => a + f.tests.length, 0), failed: freqs.reduce((a, f) => a + f.tests.filter((t) => t.fail).length, 0),
    maxZ: Math.max(...freqs.flatMap((f) => f.tests.map((t) => t.maxZ))), families: freqs.reduce((a, f) => a + f.tests.reduce((b, t) => b + t.fams, 0), 0),
    failures: freqs.flatMap((f) => f.tests.filter((t) => t.fail).map((t) => `${f.base} ${t.tier}: ${t.fail} families off`)).slice(0, 10) };

  // --checks-only: rerun part 1 and update the published results (after a parser or rule fix)
  if (args.includes('--checks-only')) {
    const latest = path.join(ROOT, 'reports', 'selftest-latest.json');
    const rep = JSON.parse(fs.readFileSync(latest, 'utf8'));
    Object.assign(rep, { checks: Object.values(checks), ops, freq });
    Object.assign(rep.meta, { walkSteps: walks.reduce((a, w) => a + w.steps, 0), roundTrips: walks.reduce((a, w) => a + w.trips, 0), flasks: flasks.length, checksRun: new Date().toISOString() });
    fs.writeFileSync(latest, JSON.stringify(rep, null, 1));
    fs.writeFileSync(path.join(ROOT, 'app', 'data', 'insights_0.5.5.json'), JSON.stringify(rep, null, 1));
    printSummary(rep);
    process.exit(0);
  }

  // 2. strategy mining
  const scs = scenarios(bases);
  const rs = recipeScenarios(testBases());
  const all = scs.concat(rs.out);
  console.log(`2/3 strategy mining: ${scs.length} scenarios + ${rs.out.length} recipe scenarios`);
  const mined = [];
  await runPool(all.map((sc, i) => ({ id: 'm' + i, type: 'mine', sc, opts: { trials: CFG.trials, maxSteps: CFG.maxSteps } })),
    (m) => { if (m.res.error) errors.push(m.res); else mined.push(m.res); });

  // 3. knowledge
  console.log('3/3 knowledge');
  const main = mined.filter((x) => x.group !== 'recipe' && x.results.length);
  const now = {
    meta: {
      date: new Date().toISOString(), quick: QUICK, bases: bases.length, flasks: flasks.length, scenarios: main.length, recipeScenarios: rs.out.length,
      strategyRuns: mined.reduce((a, x) => a + x.results.length, 0), trials: CFG.trials, maxSteps: CFG.maxSteps,
      walkSteps: walks.reduce((a, w) => a + w.steps, 0), roundTrips: walks.reduce((a, w) => a + w.trips, 0),
      prices: { league: 'Forbidden Rites', hourTo: league.hourTo || (snap.meta && snap.meta.hourTo), source: snap.source, feed: league.source || null },
      weights: W.meta && W.meta.fetched,
      workers: WORKERS, seconds: Math.round((Date.now() - t0) / 1000), skipped: mined.filter((x) => x.skip).map((x) => ({ id: x.id, why: x.skip })).slice(0, 40),
      errors: errors.length,
    },
    checks: Object.values(checks), ops, freq,
    techniques: techniques(main), routes: routes(main), shortcuts: shortcuts(main),
    recipes: compareRecipes(mined, rs.skipped, CFG.maxSteps),
  };
  const reports = path.join(ROOT, 'reports');
  fs.mkdirSync(reports, { recursive: true });
  const latest = path.join(reports, 'selftest-latest.json');
  const prev = fs.existsSync(latest) ? JSON.parse(fs.readFileSync(latest, 'utf8')) : null;
  now.sincePrevious = diffPrevious(prev, now);
  if (errors.length) now.errorExamples = errors.slice(0, 5).map((e) => String(e.error).split('\n').slice(0, 3).join(' | '));
  const stamp = now.meta.date.slice(0, 16).replace(/[:T]/g, '-');
  if (!QUICK) fs.writeFileSync(path.join(reports, `selftest-${stamp}.json`), JSON.stringify(Object.assign({}, now, { mined }), null, 0)); // quick runs only print
  if (!QUICK) fs.writeFileSync(latest, JSON.stringify(now, null, 1));
  if (!QUICK) fs.writeFileSync(path.join(ROOT, 'app', 'data', 'insights_0.5.5.json'), JSON.stringify(now, null, 1));
  printSummary(now);
  process.exit(0);
})();
