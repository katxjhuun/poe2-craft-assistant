/* Self-test part 2: strategy mining. For one scenario (base, item level, start item, goals) every strategy the
 * planner knows is simulated, so techniques can be compared on equal terms across many scenarios. */
'use strict';
const { E, P, load, weightsFor, essencesFor, rng, renderItem } = require('./lib.js');

/** Every strategy of the three profiles (deduplicated). */
function allStrategies() {
  const seen = new Map();
  for (const prof of Object.values(P.PROFILES)) for (const p of prof.grid()) seen.set(JSON.stringify(p, Object.keys(p).sort()), p);
  return [...seen.values()];
}

/** Junk mods for a start item: random natural mods of the base, none of the goal families or their groups. */
function junk(ctx, goalFams, sideCounts, r) {
  const { kb } = load();
  const out = [];
  const taken = new Set();
  for (const g of goalFams) for (const id of ctx.ix.famMods.get(g) || []) for (const x of kb.mods[id].grp) taken.add(x);
  for (const [side, n] of Object.entries(sideCounts)) {
    const pool = [...ctx.pool.entries()].filter(([id, pe]) => pe.side === side && kb.mods[id].lvl <= ctx.ilvl && !goalFams.includes(kb.mods[id].fam));
    for (let i = 0; i < n && pool.length; i++) {
      const ok = pool.filter(([id]) => !kb.mods[id].grp.some((x) => taken.has(x)));
      if (!ok.length) break;
      const [id, pe] = ok[Math.floor(r() * ok.length)];
      kb.mods[id].grp.forEach((x) => taken.add(x));
      out.push({ id, side, tier: pe.tier });
    }
  }
  return out;
}

/**
 * Build the start item of a scenario and parse it like pasted text.
 * sc: { base, ilvl, start: 'white'|'magic'|'rare'|'rare-low', targets, seed, lowTier? }
 */
function startItem(sc) {
  const { ix, kb } = load();
  const r = rng(sc.seed);
  const cls = kb.bases[sc.base].cls;
  const white = E.parseItem(ix, renderItem({ base: sc.base, cls, rarity: 'Normal', ilvl: sc.ilvl, mods: [] }, r, 'adv').text).item;
  if (sc.start === 'white') return white;
  const ctx = P.makeContext(ix, white);
  const fams = Object.values(sc.targets).map((t) => t.fam);
  let mods;
  if (sc.start === 'magic') mods = junk(ctx, fams, { prefix: 1, suffix: 0 }, r);
  else mods = junk(ctx, fams, { prefix: 2, suffix: 2 }, r);
  if (sc.start === 'rare-low') {
    // the first goal is already there, a few tiers too low
    const t = Object.values(sc.targets)[0];
    const ids = (ix.famMods.get(t.fam) || []).filter((id) => ctx.pool.has(id) && kb.mods[id].lvl <= sc.ilvl).map((id) => ({ id, pe: ctx.pool.get(id) }));
    const low = ids.filter((x) => x.pe.tier >= (t.minTier || 1) + 2).sort((a, b) => a.pe.tier - b.pe.tier)[0];
    if (low) {
      const side = low.pe.side;
      const same = mods.filter((m) => m.side === side);
      if (same.length >= 2) mods.splice(mods.indexOf(same[0]), 1);
      mods.push({ id: low.id, side, tier: low.pe.tier });
    }
  }
  const rarity = sc.start === 'magic' ? 'Magic' : 'Rare';
  return E.parseItem(ix, renderItem({ base: sc.base, cls, rarity, ilvl: sc.ilvl, mods, quality: sc.quality || 0, qualityType: sc.qualityType || null }, r, 'adv').text).item;
}

/** Strategy signature without the parameters that cannot matter here (as buildPlans does). */
function relevant(params, st, goals) {
  const hasDes = goals.some((g) => g.des);
  const hasEss = goals.some((g) => (g.ess || []).length);
  return Object.assign({}, params,
    st.rarity === 'Rare' ? { start: null, restart: null } : {},
    hasDes || params.desSlam ? {} : { bone: null, echoes: null, lich: null },
    hasEss ? {} : { essence: null });
}

/**
 * Simulate every strategy for one scenario. opts: { trials, maxSteps }.
 * Returns { id, base, cls, start, goals: [{label, side, tier, des}], results: [{params, p, cost, cps, steps, lost, p90, dead, route}] }.
 */
function mineScenario(sc, opts) {
  const { ix, kb, priceOf } = load();
  const item = startItem(sc);
  const cls = kb.bases[sc.base].cls;
  const ctx = P.makeContext(ix, item, { weights: weightsFor(sc.base), essences: essencesFor(cls) });
  const st = P.toState(ctx, item);
  const { goals } = P.goalsFromTargets(ctx, sc.targets);
  goals.forEach((g) => { g.eff = g.tier; });
  const out = { id: sc.id, base: sc.base, cls, ilvl: sc.ilvl, start: sc.start, group: sc.group, recipe: sc.recipe || null,
    goals: goals.map((g) => ({ fam: g.fam, label: g.label, side: g.side, tier: g.tier, des: g.des, ess: (g.ess || []).length > 0 })), results: [] };
  if (!goals.length) { out.skip = 'no goal resolves on this base'; return out; }
  const bad = goals.map((g) => P.goalFeasible(ctx, st, g)).filter(Boolean);
  if (bad.length) { out.skip = bad[0]; return out; }
  const seen = new Set();
  const run = (params, tag) => {
    const sig = JSON.stringify(relevant(params, st, goals));
    if (seen.has(sig)) return null;
    seen.add(sig);
    const r = P.simulate(ctx, st, goals, params, { trials: opts.trials, seed: 17, priceOf, baseCost: 1, maxSteps: opts.maxSteps });
    const res = {
      params: Object.assign({}, params), tag: tag || null, p: +r.p.toFixed(4), cost: +r.meanCost.toFixed(2),
      cps: r.p > 0 ? +(r.meanCost / r.p).toFixed(2) : null, steps: +r.meanSteps.toFixed(2), lost: +r.lost.toFixed(4),
      p90: +r.p90.toFixed(2), dead: +r.failDead.toFixed(4),
      route: r.steps.slice(0, 5).map((s) => ({ k: s.key, n: +s.avg.toFixed(2) })),
    };
    out.results.push(res);
    return res;
  };
  for (const p of allStrategies()) run(p);
  // variants of the three best strategies: fracture a finished goal, catalysing exaltation, and flux switched off
  const ok = out.results.filter((x) => x.p > 0).sort((a, b) => a.cps - b.cps).slice(0, 3);
  for (const b of ok) {
    run(Object.assign({}, b.params, { fracture: true }), 'fracture');
    if (st.catTag && st.catQ > 0) run(Object.assign({}, b.params, { catalyse: true }), 'catalyse');
    run(Object.assign({}, b.params, { flux: false }), 'no-flux');
    // bones for base-modifier goals: pick the goal's modifier at the Well of Souls
    if (P.boneFor(cls)) run(Object.assign({}, b.params, { desSlam: true }), 'des-slam');
  }
  return out;
}

module.exports = { mineScenario, startItem, allStrategies, relevant };
