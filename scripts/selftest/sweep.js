/* PoE2 Craft Assistant — exhaustive strategy sweep (F7).
 *
 *   node scripts/selftest/sweep.js [--workers N] [--only <regex on scenario id>] [--limit N] [--quick] [--fresh]
 *
 * A full run saves each finished scenario to reports/sweep-partial.jsonl and picks up from there when started again
 * (--fresh starts over).
 *
 * For every self-test scenario (a start item and goals on a test base) and every goal set the three profiles use:
 *
 *  A. Every combination of the strategy settings (planner SPACE plus runes on/off, about 10.6 million) is covered.
 *     Combinations that behave the same are simulated once: the planner reads the settings through a proxy that records
 *     which ones it looks at, and with the same random numbers two strategies that agree on every setting read make the
 *     same moves and get the same results. The space is split only on settings that were read (a decision tree over the
 *     settings), so each leaf ("class") stands for all the combinations it covers. Every class gets a short screening
 *     run (same random numbers for all, so they compare fairly); the best by an optimistic estimate go on.
 *  B. The promising classes (best for each profile's score, and the cost / success frontier) run again with more trials,
 *     in two rounds (a class splits again when a longer run reads a setting the short one had not).
 *  C. Assignment: Cheap = the lowest cost per finished item, Balanced = cost weighed by the chance to finish, Premium = the
 *     most likely to finish (the page's profile scores), and the frontier is split into three cost bands.
 *  D. Verification: each assigned strategy, the page planner's own pick and the challengers run again with fresh random
 *     numbers and many trials. Is there a cheaper one that finishes as often? Is there one that finishes more often at no
 *     more cost? If so the assignment is replaced and checked again; the final picks are run once more with other random
 *     numbers to confirm the order.
 *
 * Writes reports/sweep-latest.json, reports/sweep-<date>.json and reports/sweep-latest.md, and a one-line progress file
 * (reports/sweep-progress.txt) for a progress bar while it runs.
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const QUICK = args.includes('--quick');
const CFG = QUICK
  ? { tA: 4, stepsA: 200, tA2: 16, keepA2: 60, tB: 100, tC: 600, tD: 600, keepScore: 8, keepFront: 20, verifyScore: 4, verifyFront: 10, maxClasses: 50000, maxSteps: 400 }
  : { tA: 6, stepsA: 300, tA2: 30, keepA2: 300, tB: 300, tC: 1000, tD: 4000, keepScore: 25, keepFront: 40, verifyScore: 6, verifyFront: 15, maxClasses: 400000, maxSteps: 600 };
const SEEDS = { A: 5101, A2: 5151, B: 5202, C: 5303, D: 5404 };
const BASE_COST = 1, BASE_LIMIT = 100; // the page's defaults

// ---------------------------------------------------------------- worker
if (!isMainThread && workerData === 'sweep') {
  parentPort.on('message', async (t) => {
    let res;
    try { res = await sweepScenario(t.sc, t.opts); } catch (e) { res = { id: t.sc.id, error: String(e && e.stack || e) }; }
    parentPort.postMessage({ id: t.id, res });
  });
}

function lazy() {
  const lib = require('./lib.js');
  const G = require(path.join(lib.ROOT, 'app', 'guide.js'));
  const { startItem } = require('./mine.js');
  return Object.assign({ G, startItem }, lib);
}

/** The settings of the sweep: the planner's search space and the rune switch. */
function sweepSpace(P) { return Object.assign({}, P.SPACE, { runes: [true, false] }); }

function summary(r, lean) {
  // screening runs keep only what ranking needs (hundreds of thousands of classes per goal set)
  // missingPrices: the profile scores rank a strategy that uses something without a price behind the priced ones
  const missingPrices = r.missingPrices && r.missingPrices.length ? r.missingPrices : undefined;
  if (lean) return { p: r.p, trials: r.trials, meanCost: r.meanCost, costPerSuccess: r.costPerSuccess, basesPerSuccess: r.basesPerSuccess, baseLimit: r.baseLimit, meanBases: r.meanBases, p90: r.p90, meanSteps: r.meanSteps, missingPrices };
  return {
    meanBases: r.meanBases, missingPrices,
    p: r.p, pLow: r.pLow, pHigh: r.pHigh, trials: r.trials, meanCost: r.meanCost, costPerSuccess: r.costPerSuccess,
    p50: r.p50, p90: r.p90, meanSteps: r.meanSteps, basesPerSuccess: r.basesPerSuccess, baseLimit: r.baseLimit,
    failDead: r.failDead, unfinished: r.unfinished,
    route: r.steps.slice(0, 6).map((s) => ({ k: s.key, n: +s.avg.toFixed(2) })),
  };
}

/** Item, context, goals and the planner input of a scenario, with the page's defaults and the library's recipes. */
function setup(sc) {
  const { E, P, G, load, weightsFor, essencesFor, startItem } = lazy();
  const { ix, kb, lib, priceOf } = load();
  const item = startItem(sc);
  const cls = kb.bases[sc.base].cls;
  const weights = weightsFor(sc.base), essences = essencesFor(cls);
  const ctx = P.makeContext(ix, item, { weights, essences, catalystMult: P.CATALYST_DEFAULT });
  const st = P.toState(ctx, item);
  const { goals } = P.goalsFromTargets(ctx, sc.targets);
  const L = G.effectiveLibrary(lib, {});
  const fams = new Set(goals.map((g) => g.fam));
  const recipes = G.recipesFor(L, cls, 'Forbidden Rites')
    .filter((r) => r.inLeague && (r.verdict === 'verified' || r.verdict === 'plausible') && r.target.length && r.steps.length)
    .filter((r) => r.target.some((t) => { const f = E.resolveTemplateTarget(ix, item, t.stat); return f && fams.has(f.fam); }))
    .map((r) => ({ id: r.id, title: r.title, params: P.recipeParams(r) })).filter((x) => Object.keys(x.params).length);
  const input = { ix, item, targets: sc.targets, priceOf, baseCost: BASE_COST, budget: 0, baseLimit: BASE_LIMIT, weights, essences,
    catalystMult: P.CATALYST_DEFAULT, recipes };
  return { P, priceOf, cls, ctx, st, goals, input };
}

/** The three plans as the page builds them: the first plans, then the search for a better strategy for each. */
async function runPlanner(P, input) {
  const planned = await P.buildPlans(Object.assign({}, input, { beamBudgetMs: 0 }));
  for (const k of Object.keys(planned.profiles || {})) {
    const pl = planned.profiles[k];
    if (pl && pl.steps && pl.seeds) planned.profiles[k] = await P.improvePlan(Object.assign({}, input, { beamBudgetMs: P.SEARCH.budgetMs }), pl);
  }
  return planned;
}

/** Goal sets of the profiles: profiles that ask for the same goals share one. */
function goalSets(P, goals) {
  const sets = new Map();
  for (const [name, prof] of Object.entries(P.PROFILES)) {
    const pg = prof.goals(goals);
    const key = JSON.stringify(pg.map((g) => [g.key, g.eff, !!g.required]));
    if (!sets.has(key)) sets.set(key, { pg, profiles: [] });
    sets.get(key).profiles.push(name);
  }
  return [...sets.values()];
}

/** One simulation of a full strategy that records the settings the planner reads (in the order it first reads them). */
function tracked(P, ctx, st, pg, params, opts, keys) {
  const reads = [], seenK = new Set();
  const px = new Proxy(params, { get(t, k) { if (typeof k === 'string' && !seenK.has(k)) { seenK.add(k); reads.push(k); } return t[k]; } });
  const r = P.simulate(ctx, st, pg, px, opts);
  return { r, reads: reads.filter((k) => k in keys) };
}

async function sweepScenario(sc, opts) {
  const { P, priceOf, cls, ctx, st, goals, input } = setup(sc);
  const SPACE = sweepSpace(P);
  const KEYS = Object.keys(SPACE);
  const DEFAULTS = P.expandStrategy({});
  const sigOf = (p) => KEYS.map((k) => String(p[k])).join('|');
  const out = { id: sc.id, base: sc.base, cls, start: sc.start, group: sc.group, sets: [], sims: 0 };
  if (!goals.length) { out.skip = 'no goal resolves on this base'; return out; }
  const t0 = Date.now();

  // the page planner's picks (same inputs as the page: recipes of the library, the search after the first plans)
  const planned = await runPlanner(P, input);
  out.plannerMs = Date.now() - t0;

  for (const { pg, profiles } of goalSets(P, goals)) {
    const set = { profiles, goals: pg.map((g) => ({ label: g.label, side: g.side, tier: g.tier, eff: g.eff, des: !!g.des })), picks: {} };
    out.sets.push(set);
    if (!pg.length) { set.skip = 'no required goals'; continue; }
    const bad = pg.map((g) => P.goalFeasible(ctx, st, g) || P.goalClash(ctx, pg, g)).filter(Boolean);
    if (bad.length) { set.skip = bad[0]; continue; }

    const simOpts = (trials, seed, steps) => ({ trials, seed, priceOf, baseCost: BASE_COST, baseLimit: BASE_LIMIT, maxSteps: steps || CFG.maxSteps });
    /** One simulation of a full strategy, recording the settings the planner reads (in the order it first reads them). */
    const track = (params, trials, seed, steps, lean) => {
      const { r, reads } = tracked(P, ctx, st, pg, params, simOpts(trials, seed, steps), SPACE);
      out.sims++;
      return { res: summary(r, lean), reads };
    };
    /** Classes under `root` (fixed settings): split on the first setting read that is not fixed yet, until none is left. */
    const enumerate = (root, trials, seed, memo, cap, steps, lean) => {
      const leaves = [], stack = [root];
      let capped = false;
      while (stack.length) {
        const fixed = stack.pop();
        const rep = Object.assign({}, DEFAULTS, fixed);
        const s = sigOf(rep);
        let r = memo.get(s);
        if (!r) { r = track(rep, trials, seed, steps, lean); memo.set(s, r); }
        const free = r.reads.find((k) => !(k in fixed));
        if (!free) { leaves.push({ fixed, params: rep, res: r.res, reads: r.reads }); continue; }
        if (memo.size >= cap) { capped = true; leaves.push({ fixed, params: rep, res: r.res, reads: r.reads, open: true }); continue; }
        for (const v of SPACE[free]) stack.push(Object.assign({}, fixed, { [free]: v }));
      }
      return { leaves, capped };
    };
    const covered = (fixed) => KEYS.reduce((n, k) => n * (k in fixed ? 1 : SPACE[k].length), 1);
    const classSig = (c) => c.reads.map((k) => k + '=' + c.params[k]).join(',');

    // A: every class. A pasted Rare item is the item to finish: strategies that throw it away for new white bases
    // (slamOnly) are left out there, as the page does; from a white or Magic item starting over is part of the method.
    const root = st.rarity === 'Rare' ? { slamOnly: false } : {};
    if (st.rarity === 'Rare') set.pinned = { slamOnly: false, why: 'a Rare start is finished, not thrown away for new bases' };
    const tm = Date.now();
    const A = enumerate(root, CFG.tA, SEEDS.A, new Map(), CFG.maxClasses, CFG.stepsA, true);
    set.combinations = covered(root);
    set.classes = A.leaves.length;
    set.capped = A.capped;
    set.settingsRead = [...new Set(A.leaves.flatMap((c) => c.reads))];

    const scoreOf = (name, res) => P.PROFILES[name].score(res);
    // equal results (strategies that made the same moves in these runs): the one with the fewest settings off default
    const plain = (c) => c.reads.reduce((n, k) => n + (c.params[k] !== DEFAULTS[k] ? 1 : 0), 0);
    const byScore = (name) => (a, b) => scoreOf(name, a.res) - scoreOf(name, b.res) || plain(a) - plain(b);
    const frontier = (cands, n) => {
      const ok = cands.filter((c) => c.res.p > 0 && isFinite(c.res.costPerSuccess)).sort((a, b) => a.res.costPerSuccess - b.res.costPerSuccess || b.res.p - a.res.p);
      const f = [];
      let bestP = -1;
      for (const c of ok) if (c.res.p > bestP + 1e-9) { f.push(c); bestP = c.res.p; }
      return thin(f, n);
    };
    /** n entries spread evenly over the list (both ends kept). */
    const thin = (list, n) => { if (list.length <= n) return list; if (n < 2) return list.slice(0, n); const o = []; for (let i = 0; i < n; i++) o.push(list[Math.round(i * (list.length - 1) / (n - 1))]); return [...new Set(o)]; };
    // Screening ranks by an optimistic estimate (upper Wilson bound of the chance at one standard error), so a class that
    // was unlucky in a few trials still gets its longer run.
    const wilsonUp = (p, n) => Math.min(1, (p + 1 / (2 * n) + Math.sqrt(p * (1 - p) / n + 1 / (4 * n * n))) / (1 + 1 / n));
    const optimistic = (c) => {
      const pu = wilsonUp(c.res.p, c.res.trials);
      return { fixed: c.fixed, params: c.params, reads: c.reads, orig: c, res: Object.assign({}, c.res, { p: pu, costPerSuccess: c.res.meanCost / pu, basesPerSuccess: c.res.meanBases / pu }) };
    };
    const pickTop = (cands, keepScore, keepFront, opt) => {
      const list = opt ? cands.map(optimistic) : cands;
      const chosen = new Map();
      for (const name of Object.keys(P.PROFILES)) {
        if (!profiles.includes(name)) continue;
        list.filter((c) => c.res.p > 0).sort((a, b) => scoreOf(name, a.res) - scoreOf(name, b.res)).slice(0, keepScore).forEach((c) => chosen.set(classSig(c), c.orig || c));
      }
      frontier(list, keepFront).forEach((c) => chosen.set(classSig(c), c.orig || c));
      return [...chosen.values()];
    };

    // B: promising classes with more trials, in two rounds (a class splits again if the longer run reads a setting it had not)
    const memoA2 = new Map();
    const A2 = [];
    for (const c of pickTop(A.leaves, CFG.keepA2, CFG.keepA2, true)) A2.push(...enumerate(c.fixed, CFG.tA2, SEEDS.A2, memoA2, Infinity, CFG.maxSteps, true).leaves);
    set.screened = A2.length;
    set.msA = Date.now() - tm;
    const memoB = new Map();
    const B = [];
    for (const c of pickTop(A2, CFG.keepScore, CFG.keepFront, true)) B.push(...enumerate(c.fixed, CFG.tB, SEEDS.B, memoB, Infinity).leaves);
    set.refined = B.length;
    set.msB = Date.now() - tm - set.msA;
    if (!B.some((c) => c.res.p > 0)) { set.noSuccess = true; continue; }

    // C: assignment from B
    const assigned = {};
    for (const name of profiles) assigned[name] = B.filter((c) => c.res.p > 0).sort(byScore(name))[0];

    // D: verification with fresh random numbers
    const memoC = new Map();
    const C = new Map();
    const addC = (c) => { const ls = enumerate(c.fixed, CFG.tC, SEEDS.C, memoC, Infinity).leaves; for (const leaf of ls) C.set(classSig(leaf), leaf); return ls; };
    for (const c of pickTop(B, CFG.verifyScore, CFG.verifyFront)) addC(c);
    const assignedC = {};
    for (const name of profiles) assignedC[name] = addC(assigned[name]).filter((c) => c.res.p > 0).sort(byScore(name))[0] || null;
    // the planner's picks: full strategies, placed in their class by the same tracking
    const plannerC = {};
    for (const name of profiles) {
      const pl = planned.profiles && planned.profiles[name];
      if (!pl || !pl.params) { plannerC[name] = { none: pl ? (pl.impossible ? 'impossible' : pl.noSuccess ? 'no success' : pl.none ? 'no goals' : 'none') : 'none' }; continue; }
      const params = Object.assign({}, DEFAULTS, pl.params);
      const r = track(params, CFG.tC, SEEDS.C);
      const leaf = { fixed: Object.fromEntries(r.reads.map((k) => [k, params[k]])), params, res: r.res, reads: r.reads };
      plannerC[name] = leaf;
      if (!C.has(classSig(leaf))) C.set(classSig(leaf), leaf);
    }
    // challengers are fully priced strategies (one that uses something without a price is no proof of a cheaper way)
    const cands = [...C.values()].filter((c) => c.res.p > 0);
    const priced = (c) => !c.res.missingPrices;
    const tolP = (a, b) => 1.96 * Math.sqrt(a.p * (1 - a.p) / a.trials + b.p * (1 - b.p) / b.trials) + 0.005;
    const floorOk = (name, r) => scoreOf(name, r) < 1e15;
    const verify = (name, pick) => {
      const a = pick.res;
      const cheaper = cands.filter((x) => priced(x) && x.res.costPerSuccess < a.costPerSuccess * 0.95 && x.res.p >= a.p - tolP(a, x.res) && floorOk(name, x.res))
        .sort((x, y) => x.res.costPerSuccess - y.res.costPerSuccess)[0] || null;
      const safer = cands.filter((x) => priced(x) && x.res.p > a.p + tolP(a, x.res) && x.res.costPerSuccess <= a.costPerSuccess * 1.02)
        .sort((x, y) => y.res.p - x.res.p)[0] || null;
      return { cheaper, safer };
    };
    const brief = (c) => c && ({ params: settingsOf(c), p: +c.res.p.toFixed(4), cps: isFinite(c.res.costPerSuccess) ? +c.res.costPerSuccess.toFixed(2) : null,
      p90: +c.res.p90.toFixed(2), bases: isFinite(c.res.basesPerSuccess) ? +c.res.basesPerSuccess.toFixed(1) : null, steps: +c.res.meanSteps.toFixed(1), route: c.res.route,
      missing: c.res.missingPrices,
      covers: covered(c.fixed) });
    const settingsOf = (c) => Object.fromEntries(c.reads.map((k) => [k, c.params[k]]));

    for (const name of profiles) {
      // the assigned strategy, or an equal one with fewer settings off default
      const bestC = cands.slice().sort(byScore(name))[0];
      const mine = assignedC[name];
      const first = !mine ? bestC : scoreOf(name, mine.res) === scoreOf(name, bestC.res) && plain(bestC) < plain(mine) ? bestC : mine;
      const firstScore = scoreOf(name, first.res);
      let pick = first, rounds = 0;
      const history = [];
      for (;;) {
        const v = verify(name, pick);
        history.push({ pick: classSig(pick), cheaper: v.cheaper && brief(v.cheaper), safer: v.safer && brief(v.safer) });
        if (!v.cheaper && !v.safer) break;
        if (++rounds > 4) break;
        // replace by the profile's best at this depth of trials, then check that one the same way
        const next = cands.slice().sort(byScore(name))[0];
        if (classSig(next) === classSig(pick)) break; // the score prefers it despite the challenger (a trade the score accepts)
        pick = next;
      }
      const v = verify(name, pick);
      // once more with other random numbers: does the pick still beat the runner-up?
      // the runner-up: the best strategy that did not make the same moves as the pick
      const runner = cands.filter((x) => classSig(x) !== classSig(pick) && scoreOf(name, x.res) !== scoreOf(name, pick.res)).sort(byScore(name))[0] || null;
      const reD = (c) => { const r = track(Object.assign({}, c.params), CFG.tD, SEEDS.D); return { res: r.res }; };
      const dPick = reD(pick), dRun = runner ? reD(runner) : null;
      const sp = scoreOf(name, dPick.res), sr = dRun ? scoreOf(name, dRun.res) : Infinity;
      const stable = !dRun || sp <= sr + 0.02 * Math.abs(sr);
      const pc = plannerC[name];
      let planner = null;
      if (pc && pc.res) {
        const same = classSig(pc) === classSig(pick);
        const ratio = pc.res.costPerSuccess / pick.res.costPerSuccess;
        const dp = pc.res.p - pick.res.p;
        const close = same || (Math.abs(ratio - 1) <= 0.05 && Math.abs(dp) <= tolP(pc.res, pick.res));
        const better = !same && scoreOf(name, pc.res) < scoreOf(name, pick.res);
        planner = { verdict: same ? 'same' : close ? 'equal' : better ? 'better' : 'worse', costRatio: isFinite(ratio) ? +ratio.toFixed(3) : null, dp: +dp.toFixed(4), pick: brief(pc),
          differs: same ? [] : KEYS.filter((k) => (k in pick.fixed || k in pc.fixed) && pick.params[k] !== pc.params[k]) };
      } else planner = { verdict: 'none', why: pc && pc.none };
      set.picks[name] = {
        assignedFromB: scoreOf(name, pick.res) === firstScore || Object.entries(assigned[name].fixed).every(([k, x]) => pick.params[k] === x) ? 'kept' : 'replaced',
        pick: brief(pick), recheck: { p: +dPick.res.p.toFixed(4), cps: isFinite(dPick.res.costPerSuccess) ? +dPick.res.costPerSuccess.toFixed(2) : null, stable, runnerUp: brief(runner) },
        cheaperExists: v.cheaper ? brief(v.cheaper) : null, saferExists: v.safer ? brief(v.safer) : null, rounds: history.length, planner,
      };
    }
    // cost bands of the verified frontier (the player's view: low, middle and high cost per finished item)
    const f = frontier(cands, 1e9);
    if (f.length) {
      const lo = Math.log(f[0].res.costPerSuccess || 1e-9), hi = Math.log(f[f.length - 1].res.costPerSuccess || 1e-9);
      const band = (c) => (hi - lo < 1e-9 ? 0 : Math.min(2, Math.floor(3 * (Math.log(c.res.costPerSuccess || 1e-9) - lo) / (hi - lo + 1e-12))));
      set.bands = [0, 1, 2].map((b) => {
        const inB = f.filter((c) => band(c) === b);
        return inB.length ? { cheapest: brief(inB[0]), likeliest: brief(inB[inB.length - 1]), n: inB.length } : null;
      });
      set.frontier = f.length;
    }
    set.verified = C.size;
    set.msC = Date.now() - tm - set.msA - set.msB;
  }
  out.ms = Date.now() - t0;
  return out;
}

if (isMainThread && require.main === module) main();

// ---------------------------------------------------------------- main
function main() {
  const { ROOT, testBases, load } = require('./lib.js');
  const { scenarios, recipeScenarios } = require('./scenarios.js');
  const WORKERS = +argv('--workers', 0) || Math.max(2, Math.min(25, os.cpus().length - 4));
  const reports = path.join(ROOT, 'reports');
  fs.mkdirSync(reports, { recursive: true });
  const progressFile = path.join(reports, 'sweep-progress.txt');
  let bases = testBases();
  let all = scenarios(bases).concat(recipeScenarios(bases).out);
  const only = argv('--only', null);
  if (only) all = all.filter((s) => new RegExp(only).test(s.id));
  const limit = +argv('--limit', 0);
  if (limit) { const step = Math.max(1, Math.floor(all.length / limit)); all = all.filter((s, i) => i % step === 0).slice(0, limit); }
  // relative run time (measured on the first full run); long ones first, so the pool does not wait on a slow one at the end
  const weight = (s) => { const pair = Object.keys(s.targets).length > 1, white = s.start === 'white'; return pair && white ? 8 : pair ? 2.5 : white ? 2 : 1; };
  all.sort((a, b) => weight(b) - weight(a));
  const t0 = Date.now();
  const results = [], errors = [];
  const totalUnits = all.reduce((a, s) => a + weight(s), 0);
  // a full run keeps what it finished, so a stopped run can go on where it was
  const partial = !only && !limit ? path.join(reports, `sweep-partial${QUICK ? '-quick' : ''}.jsonl`) : null;
  if (partial && args.includes('--fresh') && fs.existsSync(partial)) fs.unlinkSync(partial);
  const ids = new Set(all.map((s) => s.id));
  if (partial && fs.existsSync(partial)) {
    for (const line of fs.readFileSync(partial, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (ids.has(r.id) && !results.some((x) => x.id === r.id)) results.push(r); } catch (e) { /* a line cut off by a stop */ }
    }
  }
  const already = new Set(results.map((r) => r.id));
  const resumedUnits = all.filter((s) => already.has(s.id)).reduce((a, s) => a + weight(s), 0);
  const todo = all.filter((s) => !already.has(s.id));
  let done = results.length, next = 0, workUnits = resumedUnits;
  const writeProgress = () => {
    const f = workUnits / totalUnits;
    const el = (Date.now() - t0) / 1000;
    const fNew = (workUnits - resumedUnits) / Math.max(1, totalUnits - resumedUnits);
    const eta = fNew > 0.02 ? Math.round(el / fNew - el) : null;
    const fmt = (s) => (s == null ? '?' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`);
    fs.writeFileSync(progressFile, `${(f * 100).toFixed(1)} ${done}/${all.length} scenarios, ${fmt(el)} elapsed, about ${fmt(eta)} left, ${errors.length} errors\n`);
  };
  console.log(`sweep: ${all.length} scenarios, ${WORKERS} workers${QUICK ? ' (quick)' : ''}${results.length ? `; ${results.length} already done in ${path.basename(partial)}` : ''}`);
  writeProgress();
  const workers = [];
  const finish = () => {
    const rep = analyse(all, results, errors, { workers: WORKERS, seconds: Math.round((Date.now() - t0) / 1000), quick: QUICK, cfg: CFG, prices: load().snap.source });
    const stamp = rep.meta.date.slice(0, 16).replace(/[:T]/g, '-');
    if (!only && !limit) {
      fs.writeFileSync(path.join(reports, `sweep-${stamp}.json`), JSON.stringify(Object.assign({}, rep, { scenarios: results })));
      fs.writeFileSync(path.join(reports, 'sweep-latest.json'), JSON.stringify(Object.assign({}, rep, { scenarios: results }), null, 1));
      fs.writeFileSync(path.join(reports, 'sweep-latest.md'), markdown(rep, results));
    } else fs.writeFileSync(path.join(reports, 'sweep-sample.json'), JSON.stringify(Object.assign({}, rep, { scenarios: results }), null, 1));
    fs.writeFileSync(progressFile, `100.0 ${done}/${all.length} scenarios, finished in ${Math.round((Date.now() - t0) / 60000)} min, ${errors.length} errors\n`);
    if (partial && !errors.length && fs.existsSync(partial)) fs.renameSync(partial, partial.replace('.jsonl', '-done.jsonl'));
    console.log(printable(rep));
    process.exit(0);
  };
  const feed = (w) => {
    if (next >= todo.length) { w.cur = null; w.terminate(); return; }
    const sc = todo[next++];
    w.cur = sc;
    w.postMessage({ id: sc.id, sc, opts: {} });
  };
  const settle = (sc) => {
    done++;
    workUnits += weight(sc);
    writeProgress();
    if (done === all.length) finish();
  };
  const spawn = () => {
    const w = new Worker(__filename, { argv: process.argv.slice(2), workerData: 'sweep' });
    w.on('message', (m) => {
      if (m.res.error) errors.push(m.res); else { results.push(m.res); if (partial) fs.appendFileSync(partial, JSON.stringify(m.res) + '\n'); }
      const sc = w.cur;
      if (done + 1 < all.length) feed(w);
      settle(sc);
    });
    // a worker that dies (out of memory) loses its scenario: count it as an error and carry on with a new worker
    w.on('error', (e) => {
      console.error('worker error', e);
      const sc = w.cur;
      if (!sc) return;
      errors.push({ id: sc.id, error: String(e && e.stack || e) });
      w.cur = null;
      feed(spawn());
      settle(sc);
    });
    workers.push(w);
    return w;
  };
  if (!todo.length) { finish(); return; }
  for (let i = 0; i < Math.min(WORKERS, todo.length); i++) feed(spawn());
}

// ---------------------------------------------------------------- analysis
function analyse(all, results, errors, meta) {
  const names = ['cheap', 'balanced', 'premium'];
  const per = {};
  for (const n of names) per[n] = { verified: 0, replaced: 0, cheaperLeft: 0, saferLeft: 0, unstable: 0, planner: { same: 0, equal: 0, worse: 0, better: 0, none: 0 }, worse: [] };
  let classes = 0, combos = 0, sims = 0, sets = 0, capped = 0, skipped = 0;
  const readCount = {};
  for (const sc of results) {
    sims += sc.sims || 0;
    if (sc.skip) { skipped++; continue; }
    for (const set of sc.sets) {
      if (set.skip || set.noSuccess) { skipped++; continue; }
      sets++; classes += set.classes || 0; combos += set.combinations || 0; if (set.capped) capped++;
      for (const k of set.settingsRead || []) readCount[k] = (readCount[k] || 0) + 1;
      for (const [n, pk] of Object.entries(set.picks)) {
        const x = per[n];
        x.verified++;
        if (pk.assignedFromB === 'replaced') x.replaced++;
        if (pk.cheaperExists) x.cheaperLeft++;
        if (pk.saferExists) x.saferLeft++;
        if (!pk.recheck.stable) x.unstable++;
        x.planner[pk.planner.verdict] = (x.planner[pk.planner.verdict] || 0) + 1;
        if (pk.planner.verdict === 'worse') x.worse.push({ id: sc.id, costRatio: pk.planner.costRatio, dp: pk.planner.dp, differs: pk.planner.differs, planner: pk.planner.pick && pk.planner.pick.params, best: pk.pick.params });
      }
    }
  }
  // what the planner's misses have in common: the settings where its pick differs from the verified best
  for (const n of names) {
    const diff = {};
    for (const w of per[n].worse) for (const k of w.differs) { const key = `${k}: ${w.planner ? w.planner[k] : '?'} -> ${w.best[k]}`; diff[key] = (diff[key] || 0) + 1; }
    per[n].missPatterns = Object.entries(diff).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, c]) => ({ change: k, n: c }));
    per[n].worse.sort((a, b) => (b.costRatio || 0) - (a.costRatio || 0));
    per[n].worse = per[n].worse.slice(0, 40);
  }
  return {
    meta: Object.assign({ date: new Date().toISOString(), scenarios: all.length, done: results.length, errors: errors.length, goalSets: sets, skipped, classes, combinations: combos, simulations: sims, capped }, meta),
    settingsRead: readCount, profiles: per, errorExamples: errors.slice(0, 5).map((e) => String(e.error).split('\n').slice(0, 4).join(' | ')),
  };
}

function printable(rep) {
  const m = rep.meta;
  const L = [];
  L.push(`done in ${Math.round(m.seconds / 60)} min: ${m.done}/${m.scenarios} scenarios, ${m.goalSets} goal sets, ${m.errors} errors`);
  L.push(`${m.combinations.toLocaleString('en-US')} strategy combinations covered by ${m.classes.toLocaleString('en-US')} classes that behave differently; ${m.simulations.toLocaleString('en-US')} simulations${m.capped ? `; ${m.capped} goal sets hit the class cap` : ''}`);
  for (const [n, x] of Object.entries(rep.profiles)) {
    const pl = x.planner;
    L.push(`${n.padEnd(9)} verified ${x.verified}: first assignment replaced ${x.replaced}, cheaper still found ${x.cheaperLeft}, safer still found ${x.saferLeft} (trades the profile accepts), order changed on recheck ${x.unstable}`);
    L.push(`${''.padEnd(9)} page planner: same ${pl.same}, equal ${pl.equal}, better ${pl.better}, worse ${pl.worse}, none ${pl.none}`);
    for (const mp of x.missPatterns.slice(0, 6)) L.push(`${''.padEnd(12)}${mp.n}x ${mp.change}`);
  }
  if (rep.errorExamples.length) L.push('errors: ' + rep.errorExamples.join('\n  '));
  return L.join('\n');
}

function markdown(rep, results) {
  const m = rep.meta;
  const L = ['# Exhaustive strategy sweep', '', `${m.date.slice(0, 16).replace('T', ' ')} UTC, ${Math.round(m.seconds / 60)} min on ${m.workers} workers.`, '',
    `- Scenarios: ${m.done} of ${m.scenarios} (${m.goalSets} goal sets; ${m.skipped} skipped as impossible or without success)`,
    `- Strategy combinations covered: ${m.combinations.toLocaleString('en-US')}, in ${m.classes.toLocaleString('en-US')} classes that behave differently`,
    `- Simulations: ${m.simulations.toLocaleString('en-US')}; trials per stage ${m.cfg.tA} / ${m.cfg.tB} / ${m.cfg.tC} / ${m.cfg.tD}`, '',
    '| Profile | Verified | Replaced after the first check | Cheaper left | Safer left | Page planner same / equal / better / worse |', '|---|---|---|---|---|---|'];
  for (const [n, x] of Object.entries(rep.profiles)) L.push(`| ${n} | ${x.verified} | ${x.replaced} | ${x.cheaperLeft} | ${x.saferLeft} | ${x.planner.same} / ${x.planner.equal} / ${x.planner.better} / ${x.planner.worse} |`);
  L.push('', '"Cheaper left" and "safer left" are trades the profile accepts on purpose (for example a cheaper route that finishes less often for Premium).', '');
  for (const [n, x] of Object.entries(rep.profiles)) {
    if (!x.worse.length) continue;
    L.push(`## ${n}: where the page planner missed the verified best`, '', '| Scenario | Planner cost / best | Chance difference | Settings that differ |', '|---|---|---|---|');
    for (const w of x.worse.slice(0, 25)) L.push(`| ${w.id} | x${w.costRatio} | ${(w.dp * 100).toFixed(1)} pts | ${w.differs.map((k) => `${k}: ${w.planner ? w.planner[k] : '?'} → ${w.best[k]}`).join(', ')} |`);
    L.push('');
  }
  return L.join('\n');
}

module.exports = { setup, runPlanner, goalSets, tracked, sweepSpace, summary, CFG, SEEDS, BASE_COST, BASE_LIMIT };
