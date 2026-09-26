/* PoE2 Craft Assistant — item value estimate from logged prices.
 * There is no public sales history for rare items and the trade site must not be queried automatically,
 * so the estimate is built from prices the player logs (their own sales and trade listings they looked at):
 *   - similar items: weighted median of the closest logged items of the same class (mod family + tier)
 *   - mod model: with 8+ prices for a class, a ridge regression of log(price) on the mods gives each mod
 *     a share of the value; used for projected changes ("if this target lands").
 * Deterministic; no language model numbers.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PoE2Value = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Tier quality 0..1: T1 = 1, each tier down -0.18, unknown tier counts as mid. */
  function quality(t) { return t ? Math.max(0.1, 1 - (t - 1) * 0.18) : 0.45; }

  /** Value-relevant features of an item: its explicit mods by family and tier. */
  function features(item) {
    return (item.mods || []).filter((m) => (m.slot === 'prefix' || m.slot === 'suffix') && m.fam)
      .map((m) => ({ fam: m.fam, tier: m.tier || null, des: !!m.desecrated, frac: !!m.fractured, crafted: !!m.crafted, text: m.text }));
  }

  /** Similarity of two feature lists (0..1): matched families weighted by tier closeness. */
  function similarity(a, b) {
    if (!a.length && !b.length) return 1;
    let score = 0;
    const used = new Set();
    for (const f of a) {
      let best = 0, bi = -1;
      b.forEach((g, i) => {
        if (used.has(i) || g.fam !== f.fam) return;
        const s = f.tier && g.tier ? Math.max(0, 1 - 0.22 * Math.abs(f.tier - g.tier)) : 0.6;
        if (s > best) { best = s; bi = i; }
      });
      if (bi >= 0) used.add(bi);
      score += best;
    }
    return score / Math.max(a.length, b.length);
  }

  function wquantile(pts, q) {
    const s = pts.slice().sort((x, y) => x[0] - y[0]);
    const tot = s.reduce((t, p) => t + p[1], 0);
    let acc = 0;
    for (const [v, w] of s) { acc += w; if (acc >= q * tot) return v; }
    return s.length ? s[s.length - 1][0] : null;
  }

  /** Estimate from the most similar logged items. obs: [{cls, feats, ex}] */
  function similarEstimate(feats, obs, k) {
    const scored = obs.map((o) => ({ o, s: similarity(feats, o.feats) })).filter((x) => x.s >= 0.35).sort((x, y) => y.s - x.s).slice(0, k || 6);
    if (!scored.length) return null;
    const pts = scored.map((x) => [x.o.ex, x.s * x.s]);
    return {
      method: 'similar', value: wquantile(pts, 0.5), low: wquantile(pts, 0.2), high: wquantile(pts, 0.8),
      n: scored.length, match: scored.reduce((t, x) => t + x.s, 0) / scored.length,
    };
  }

  /** Solve (A + lambda I) x = b by Gaussian elimination (small systems). */
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c] || 1e-9;
      for (let j = c; j <= n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map((row) => row[n]);
  }

  /** Ridge regression of log(price) on per-family tier quality. Needs 8+ prices. */
  function fitModel(obs, lambda) {
    if (obs.length < 8) return null;
    const fams = [...new Set(obs.flatMap((o) => o.feats.map((f) => f.fam)))];
    const idx = new Map(fams.map((f, i) => [f, i + 1]));
    const d = fams.length + 1;
    const X = obs.map((o) => {
      const row = new Array(d).fill(0); row[0] = 1;
      for (const f of o.feats) row[idx.get(f.fam)] = Math.max(row[idx.get(f.fam)], quality(f.tier));
      return row;
    });
    const y = obs.map((o) => Math.log(Math.max(o.ex, 0.01)));
    const L = lambda == null ? 1 : lambda;
    const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => X.reduce((t, r) => t + r[i] * r[j], 0) + (i === j && i > 0 ? L : 0)));
    const b = Array.from({ length: d }, (_, i) => X.reduce((t, r, k) => t + r[i] * y[k], 0));
    const w = solve(A, b);
    const res = X.map((r, k) => y[k] - r.reduce((t, v, i) => t + v * w[i], 0));
    const sd = Math.sqrt(res.reduce((t, e) => t + e * e, 0) / Math.max(1, obs.length - 1));
    const weights = {};
    fams.forEach((f, i) => { weights[f] = w[i + 1]; });
    return { b0: w[0], weights, sd, n: obs.length };
  }

  function predictLog(model, feats) {
    let v = model.b0;
    for (const f of feats) if (model.weights[f.fam] != null) v += model.weights[f.fam] * quality(f.tier);
    return v;
  }

  /**
   * Value estimate for an item. obs = logged prices of the same class and league.
   * Returns {method, value, low, high, n, confidence, contributions?} or null when nothing is known.
   */
  function estimate(item, obs, model) {
    const feats = Array.isArray(item) ? item : features(item);
    if (model) {
      const lv = predictLog(model, feats);
      const contributions = feats.map((f) => ({ fam: f.fam, text: f.text, tier: f.tier, share: model.weights[f.fam] != null ? model.weights[f.fam] * quality(f.tier) : 0 }))
        .sort((a, b) => b.share - a.share);
      const sim = similarEstimate(feats, obs);
      return {
        method: 'model', value: Math.exp(lv), low: Math.exp(lv - model.sd), high: Math.exp(lv + model.sd), n: model.n,
        confidence: model.n >= 25 && model.sd < 0.6 ? 'medium' : 'low', contributions, near: sim,
      };
    }
    const sim = similarEstimate(feats, obs);
    if (!sim) return null;
    return Object.assign(sim, { confidence: sim.n >= 4 && sim.match > 0.7 ? 'medium' : 'low' });
  }

  /** The item's features with one mod replaced (or added) — for "if this target lands". */
  function withTarget(feats, replaceText, target) {
    const out = feats.filter((f) => f.text !== replaceText);
    out.push({ fam: target.fam, tier: target.tier || null, des: !!target.des, frac: false, crafted: !!target.crafted, text: target.label || target.fam });
    return out;
  }

  /** Observation record for logging a price. */
  function observation(item, ex, meta) {
    return Object.assign({
      cls: item.itemClass, base: item.base, ilvl: item.ilvl, rarity: item.rarity, feats: features(item),
      corrupted: !!(item.flags && item.flags.corrupted), ex: +ex,
    }, meta || {});
  }

  return { quality, features, similarity, similarEstimate, fitModel, estimate, withTarget, observation };
});
