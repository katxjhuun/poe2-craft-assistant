/* PoE2 Craft Assistant: the verification gate (reports/definition-of-done.md, reports/roadmap.md phase 1).
 *
 * A route is offered only when its network's promise can be trusted (network.js answer: settled, not negative), and it
 * is a recommendation only when the simulator keeps that promise: over the replayed crafts the 95% confidence
 * interval of the played cost lies within 2% of the promised cost, and that of the success chance within 0.5 points
 * of the promised chance. A route that cannot be shown to do that is listed as "unsure", as is one that rests on a
 * rule the ledger marks unknown. Each result carries a stamp: the ledger's hash, the hash of every rule the route
 * uses, and the price date, so that a rule change reruns only the routes that use that rule.
 *
 * Plain functions on plain data: the page (its short simulation of the player's item) and scripts/gate.js (the goal
 * list, 100,000 crafts each) use the same ones.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PoE2Gate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BOUNDS = { cost: 0.02, p: 0.005, z: 1.959963984540054, crafts: 100000 };

  /** FNV-1a, 32 bits, as 8 hex digits: the same in Node and the page (no crypto there that is synchronous). */
  function hash(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  /** A rule's hash: what it says and how sure it is (a status change is a rule change too). */
  const ruleHash = (r) => hash(`${r.id}|${r.status}|${r.rule}`);

  /** Why a promise is no route's ({meanCost, settled}: an answer of network.js), or null when it can be trusted. */
  function promiseFault(r) {
    if (!r || r.refused) return r && r.refused ? r.refused.join(' ') : 'no answer';
    if (r.settled === false) return 'values not settled';
    if (!(typeof r.meanCost === 'number' && isFinite(r.meanCost))) return 'no number';
    if (r.meanCost < 0) return 'negative promise';
    return null;
  }

  /** Wilson score interval of k successes in n at z. */
  function wilson(k, n, z) {
    if (!(n > 0)) return [0, 1];
    const p = k / n, z2 = z * z, d = 1 + z2 / n;
    const mid = (p + z2 / (2 * n)) / d, half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / d;
    return [Math.max(0, mid - half), Math.min(1, mid + half)];
  }

  /**
   * Median, P90 and the worst of a list of costs (a copy is sorted). P90: the cost nine crafts in ten stay under.
   */
  function spread(costs) {
    const c = Float64Array.from(costs).sort();
    const q = (f) => (c.length ? c[Math.min(c.length - 1, Math.max(0, Math.ceil(f * c.length) - 1))] : NaN);
    return { n: c.length, median: q(0.5), p90: q(0.9), worst: c.length ? c[c.length - 1] : NaN, best: c.length ? c[0] : NaN };
  }
  /** A histogram of costs in `bins` equal steps up to the P99 (the rest in the last bin), for the expert view. */
  function histogram(costs, bins) {
    const c = Float64Array.from(costs).sort();
    if (!c.length) return { edges: [], counts: [] };
    const hi = c[Math.min(c.length - 1, Math.floor(0.99 * c.length))] || c[c.length - 1], lo = 0, w = (hi - lo) / bins || 1;
    const counts = new Array(bins).fill(0);
    for (const x of c) counts[Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / w)))]++;
    return { edges: counts.map((_, i) => lo + i * w), width: w, counts, over: c.length - c.filter((x) => x <= hi).length };
  }

  /**
   * The verdict on a route.
   * promised: {cost, p} (p: the promised success chance, 1 when the route always ends; with a budget, within it).
   * played: {runs, done, mean, sd, success} (success: crafts that met the targets, within the budget when there is one).
   * rules: optional [{id, status}] the route rests on.
   * Returns {label: 'recommend' | 'unsure', why: [...], cost: {mean, lo, hi, rel}, p: {hat, lo, hi}, weak: [ids], unknown: [ids]}.
   */
  function verdict(promised, played, rules, bounds) {
    const B = Object.assign({}, BOUNDS, bounds || {});
    const why = [];
    const c = promised && promised.cost, p0 = promised && promised.p != null ? promised.p : 1;
    if (!(c >= 0 && isFinite(c))) why.push('no trusted promise');
    const n = played ? played.runs | 0 : 0, done = played ? played.done | 0 : 0;
    const se = done > 1 ? played.sd / Math.sqrt(done) : Infinity;
    const lo = played ? played.mean - B.z * se : NaN, hi = played ? played.mean + B.z * se : NaN;
    const cost = { mean: played ? played.mean : NaN, lo, hi, rel: c > 0 ? (played.mean - c) / c : NaN, bound: B.cost };
    if (!(n > 0)) why.push('not replayed');
    else {
      // (the interval must lie inside promise x (1 +- 2%): with few crafts it is wide and the route stays unsure)
      if (!(lo >= c * (1 - B.cost) && hi <= c * (1 + B.cost))) why.push(`cost: ${fmtPct(cost.rel)} off, interval ${fmtPct((lo - c) / c)} to ${fmtPct((hi - c) / c)} (bound +-${fmtPct(B.cost)})`);
    }
    const k = played ? (played.success != null ? played.success : done) : 0;
    const [plo, phi] = wilson(k, n, B.z);
    const pq = { hat: n ? k / n : NaN, lo: plo, hi: phi, promised: p0, bound: B.p };
    if (n > 0 && !(plo >= p0 - B.p && phi <= p0 + B.p)) why.push(`success: ${(100 * pq.hat).toFixed(2)}% played, ${(100 * p0).toFixed(2)}% promised, interval ${(100 * plo).toFixed(2)} to ${(100 * phi).toFixed(2)}%`);
    const unknown = (rules || []).filter((r) => r.status === 'unknown').map((r) => r.id);
    const weak = (rules || []).filter((r) => r.status === 'weak').map((r) => r.id);
    if (unknown.length) why.push('rests on unknown rules: ' + unknown.join(', '));
    return { label: why.length ? 'unsure' : 'recommend', why, cost, p: pq, weak, unknown, crafts: n };
  }
  const fmtPct = (x) => (isFinite(x) ? (x >= 0 ? '+' : '') + (100 * x).toFixed(2) + '%' : '?');

  /** The crafts needed for the cost bound, from a pilot's coefficient of variation (sd / mean): n = (z cv / bound)^2. */
  const craftsFor = (cv, bounds) => { const B = Object.assign({}, BOUNDS, bounds || {}); return Math.ceil(Math.pow((B.z * cv) / B.cost, 2)); };

  /**
   * The rules a step rests on, by what the step does. a: an edge's action ({op, item, greater, tier, putrefy, mark,
   * sanctify, catalyse, ...}); about: {cls, poolRune, fractured} of the item the route is for.
   * Every route rests on the rules of rarity slots, item level, groups and the roll weights.
   */
  const ALWAYS = ['R_RARITY_SLOTS', 'R_ILVL_GATE', 'R_MOD_GROUP', 'A_WEIGHTS', 'k13'];
  function rulesOfStep(a, about) {
    about = about || {};
    const out = [];
    const name = String(a.item || '');
    switch (a.op) {
      case 'essence': case 'pessence':
        out.push('A_ESSENCE_EVEN', 'R_ONE_CRAFTED');
        if (/Abyss/.test(name)) out.push('k59');
        break;
      case 'bone': case 'reveal':
        out.push('R_ONE_DESECRATED', 'A_DESECRATE_SIDE', 'A_DES_WEIGHTS');
        if (a.putrefy) out.push('k63');
        if (a.mark) out.push('k59');
        // (the Well of Souls offers a socketed rune's pool, t33; how often is not known: no recommendation on it)
        if (about.poolRune) out.push('A_RUNE_POOL_WEIGHT');
        break;
      case 'lock': out.push('k62'); break;
      case 'liquid':
        out.push('R_ONE_CRAFTED');
        if (/Contempt/.test(name)) { out.push('k56'); if (about.fractured) out.push('t32'); }
        break;
      case 'catalyst':
        if (about.cls && !/^(Ring|Amulet|Jewel)$/.test(about.cls)) out.push('A_CATALYST_RING');
        break;
      case 'flux': out.push('A_FLUX_TIER'); break;
      case 'vaal': out.push('A_ENCHANT_EVEN'); break;
      case 'artificer': out.push('R_EXCEPTIONAL'); break;
      default: break;
    }
    if (a.catalyse) out.push('k53');
    if (a.sanctify) out.push('k20', 'A_SANCTIFY_EVEN');
    // Greater and Perfect orbs: their modifier level floors (35 and 50) are community numbers
    if (a.tier && a.tier !== 'base' && /^(exalt|chaos|regal|transmute|augment)$/.test(a.op)) out.push('k24');
    if (/Greater|Perfect/.test(name) && /Orb/.test(name)) out.push('k24');
    return out;
  }
  /** The rules of a route: its steps' and the ones every route has, with the ledger's status and hash. */
  function rulesOfRoute(actions, about, ledger) {
    const ids = new Set(ALWAYS);
    for (const a of actions) for (const id of rulesOfStep(a, about)) ids.add(id);
    return [...ids].sort().map((id) => {
      const r = ledger && ledger.rules ? ledger.rules[id] : null;
      return { id, status: r ? r.status : 'missing', hash: r ? r.hash : null };
    });
  }

  /** The stamp a result carries: the ledger it used, its rules' hashes, the price date. */
  function stamp(ledger, rules, priceDate) {
    const by = {};
    for (const r of rules) by[r.id] = r.hash;
    return { ledger: ledger ? ledger.hash : null, rules: by, prices: priceDate || null };
  }
  /** The rules whose hash changed since the result was made (an empty list: the result still stands). */
  function staleRules(result, ledger) {
    const s = result && result.stamp;
    if (!s || !s.rules) return ['(no stamp)'];
    return Object.keys(s.rules).filter((id) => !ledger.rules[id] || ledger.rules[id].hash !== s.rules[id]);
  }

  /** Every step the route can take: the policy's steps over the nodes it reaches from the start (a lock's looks too). */
  function routeActions(net) {
    const acts = [], seen = new Set([net.start]), q = [net.start];
    while (q.length) {
      const s = q.pop();
      if (net.done(s)) continue;
      const step = net.step(s);
      if (!step) continue;
      acts.push(step.a);
      if (step.a.pre) acts.push(step.a.pre);
      if (step.a.op === 'lock' && net.lockSteps) for (const c of net.lockSteps(s)) acts.push(c.a);
      // (an outcome below 0 is a new start: the route goes on from the network's start node n0, which is not the
      // pasted item's node; without it a wand's bone steps after a restart were left out of its rules)
      for (let t = 0; t < step.out.length; t += 2) { const o = step.out[t + 1], to = o < 0 ? net.n0 : o; if (to >= 0 && !seen.has(to)) { seen.add(to); q.push(to); } }
    }
    return { acts, nodes: seen.size };
  }

  return { routeActions, BOUNDS, hash, ruleHash, promiseFault, wilson, spread, histogram, verdict, craftsFor, rulesOfStep, rulesOfRoute, stamp, staleRules, ALWAYS };
});
