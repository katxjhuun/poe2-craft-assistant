/* PoE2 Craft Assistant: the craft network.
 *
 * The item is a node: which targets it has, how many other modifiers sit on each side, what is fractured, crafted or
 * desecrated. Every currency is an edge with its outcomes, their chances (from the roll weights) and its price. The
 * route is the cheapest way through the network on average: for every node, the step to use there ("if the item looks
 * like this, use that"). No crafts are simulated: the costs are solved from the equations, so the answer is there at
 * once and follows the prices and the item as they change.
 *
 * What a node does not know is which modifiers the "other" ones are. They are averaged: each takes the pool share an
 * average rolled modifier takes, and is of a target's group (a lower tier of it, a sister modifier) with the chance
 * that a rolled modifier is, which keeps the target from rolling. Two cases are known exactly instead, as a state of
 * the target ("in the way"): a modifier of its group that the pasted item has, and any such modifier for a
 * Desecrated target (a bone is too dear to spend on an item that cannot take the target). The simulator in planner.js
 * knows every modifier and is the check (scripts/selftest/network_check.js, network_sweep.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./planner.js'));
  else root.PoE2Network = factory(root.PoE2Engine, root.PoE2Planner);
})(typeof self !== 'undefined' ? self : this, function (E, P) {
  'use strict';

  const SIDES = ['prefix', 'suffix'];
  const TIERS = P.TIERS, ORB = P.ORB, OMEN = P.OMEN;
  const MAX_STATES = 40000;
  const GAMMA = 1 - 1e-13; // keeps the equations solvable should a rule set never finish; the error is far below a cent
  const BIG = 1e15;
  // goal status
  const ABSENT = 0, NATURAL = 1, CRAFTED = 2, DESECRATED = 3, BLOCKED = 4; // BLOCKED: a modifier of the target's group is in the way
  const met = (x) => x === NATURAL || x === CRAFTED || x === DESECRATED;

  /**
   * input: { ix, item, targets, locks, priceOf(name) -> Exalted Orbs or null, baseCost, weights, essences, catalystMult,
   *          quality?: 'lock' | 'use' | 'raise' (catalyst quality: leave it alone, the default; let Omen of Catalysing
   *          Exaltation use up what the item has; or also add catalysts for it) }
   * Returns a solved network, or { unsupported: reason } when the item or the targets are outside what it models.
   */
  function build(input) {
    const { ix, item } = input;
    if (!item || !item.base || !ix.kb.bases[item.base]) return { unsupported: 'unknown base' };
    const f = item.flags || {};
    if (f.corrupted || f.sanctified || f.mirrored) return { unsupported: 'locked item' };
    const ctx = P.makeContext(ix, item, { weights: input.weights || null, essences: input.essences || [], catalystMult: input.catalystMult });
    const st0 = P.toState(ctx, item, input.locks);
    if (st0.rarity !== 'Normal' && st0.rarity !== 'Magic' && st0.rarity !== 'Rare') return { unsupported: 'rarity' };
    const gt = P.goalsFromTargets(ctx, input.targets);
    if (gt.unsupported.length) return { unsupported: 'targets without a source: ' + gt.unsupported.join(', ') };
    let raw = gt.goals;
    if (raw.some((g) => g.required)) raw = raw.filter((g) => g.required);
    if (!raw.length) return { unsupported: 'no targets' };
    if (raw.some((g) => g.minValue != null)) return { unsupported: 'value targets' };
    if (raw.some((g) => g.rune)) return { unsupported: 'rune pool targets' };
    if (ctx.cls === 'Jewel' && raw.length > 4) return { unsupported: 'five modifier jewel' };
    if (st0.xSuffix || (st0.tags && st0.tags.length)) return { unsupported: 'socketed rune that changes the modifiers' };

    // a target this base and item level cannot have (the planner's own check) ends it here
    raw.forEach((g) => { g.eff = g.tier; });
    const cannot = raw.map((g) => ({ label: g.label, why: P.goalFeasible(ctx, st0, g) })).filter((x) => x.why);
    if (cannot.length) return { impossible: cannot };

    const priceOf = input.priceOf || (() => null);
    const baseCost = input.baseCost > 0 ? +input.baseCost : 0;
    const price = (name) => {
      if (name === 'New base') return baseCost;
      if (ctx.legacy.has(name)) return null;
      const v = priceOf(name);
      return v != null && isFinite(v) && v >= 0 ? +v : null;
    };

    // ---- goals: the targets, and the modifiers the player marked to keep (they must still be there at the end)
    const goals = raw.map((g) => Object.assign({}, g, { si: g.side === 'prefix' ? 0 : 1, kind: g.essenceOnly ? 'ess' : g.des ? 'des' : 'nat' }));
    for (const m of st0.mods) {
      if (!m.lock || !m.fam || goals.some((g) => P.meets(m, g, g.tier))) continue;
      goals.push({ fam: m.fam, side: m.side, si: m.side === 'prefix' ? 0 : 1, kind: m.des && !ctx.pool.has(m.id) ? 'des' : 'nat', grp: m.grp || [], tier: m.tier || null,
        des: false, label: 'kept modifier', kept: true, ess: [], lich: null });
    }
    const G = goals.length;
    if (G > 7) return { unsupported: 'too many targets' };
    // the essence, alloy or liquid emotion that gives a goal's modifier: the cheapest priced one that meets the tier
    const multi = (r) => { const o = ctx.kb.essence_outcomes && ctx.kb.essence_outcomes[r.item]; return !!o && o.mods.filter((id) => ctx.essences.some((x) => x.item === r.item && x.mod === id)).length > 1; };
    for (const g of goals) {
      const fit = (g.ess || []).filter((r) => {
        if (multi(r)) return false;
        const pe = ctx.pool.get(r.mod);
        return !g.tier || g.kind === 'ess' || (pe && pe.tier <= g.tier);
      }).map((r) => Object.assign({}, r, { price: price(r.item) })).filter((r) => r.price != null).sort((a, b) => a.price - b.price);
      g.magicEss = fit.find((r) => r.kind === 'magic') || null;
      g.rareEss = fit.find((r) => r.kind === 'rare') || null;
    }
    const jewel = ctx.cls === 'Jewel';
    const LIM = (() => { const l = E.slotLimits({ rarity: 'Rare', slotDelta: ctx.slotDelta }, ctx.cls); return [l.prefix, l.suffix]; })();
    const CAP_CRAFTED = ctx.craftedCap;

    // ---- pool numbers per side and minimum modifier level
    const statCache = new Map();
    /** mult: how much Omen of Catalysing Exaltation raises the weight of the modifiers of the catalyst's type (1: no omen). */
    function stats(si, floor, mult) {
      mult = mult > 1 ? mult : 1;
      const key = si + '|' + floor + '|' + mult;
      let s = statCache.get(key);
      if (s) return s;
      const pool = P.sidePool(ctx, SIDES[si], floor);
      let W = 0;
      const famW = new Map();
      const met = new Float64Array(G), low = new Float64Array(G); // (shadows the status test: weights here)
      for (const e of pool) {
        const w = mult > 1 && (ix.kb.mods[e.id].mt || []).includes(CAT.tag) ? e.w * mult : e.w;
        W += w;
        famW.set(e.fam, (famW.get(e.fam) || 0) + w);
        for (let i = 0; i < G; i++) {
          const g = goals[i];
          if (g.si !== si || g.kind === 'ess') continue;
          if (g.kind === 'nat' && e.fam === g.fam) { if (!g.tier || e.tier <= g.tier) met[i] += w; else low[i] += w; }
          else if (g.grp.length && e.grp.some((x) => g.grp.includes(x))) low[i] += w; // of the target's group: it keeps the target out
        }
      }
      // what one modifier nobody asked for takes out of the pool on average: families are picked by their weight, and a
      // picked family leaves with all of it
      const goalFams = new Set(goals.filter((g) => g.kind === 'nat' && g.si === si).map((g) => g.fam));
      let J = 0, sq = 0;
      for (const [fam, w] of famW) if (!goalFams.has(fam)) { J += w; sq += w * w; }
      s = { W, met, low, block: J > 0 ? sq / J : 0 };
      statCache.set(key, s);
      return s;
    }
    const floorOf = (op, tier) => { const fl = ctx.floors[op]; return !fl || tier === 'base' ? 0 : tier === 'greater' ? fl.Greater || 0 : fl.Perfect || 0; };
    /** The orb tiers worth a node: priced, and a higher one only where its floor raises some target's share of the pool. */
    function orbTiers(op) {
      const out = [];
      let best = null;
      for (let t = 0; t < TIERS.length; t++) {
        const name = ORB[op][t], pr = price(name);
        if (pr == null) continue;
        const floor = floorOf(op, TIERS[t]);
        const share = goals.map((g, i) => (g.kind === 'nat' ? stats(g.si, floor).met[i] / (stats(g.si, floor).W || 1) : 0));
        if (best && !share.some((x, i) => x > best[i] * 1.02)) continue;
        if (!best && t > 0 && !share.some((x) => x > 0)) continue;
        out.push({ tier: TIERS[t], name, price: pr, floor });
        best = best ? best.map((x, i) => Math.max(x, share[i])) : share;
      }
      return out;
    }
    const T = { transmute: orbTiers('transmute'), augment: orbTiers('augment'), regal: orbTiers('regal'), exalt: orbTiers('exalt'), chaos: orbTiers('chaos') };
    const PR = {
      annul: price('Orb of Annulment'), fracture: price('Fracturing Orb'), alchemy: price('Orb of Alchemy'),
      exaltSide: [price(OMEN.exalt.prefix), price(OMEN.exalt.suffix)], erasure: [price(OMEN.erasure.prefix), price(OMEN.erasure.suffix)],
      annulSide: [price(OMEN.annul.prefix), price(OMEN.annul.suffix)], light: price(OMEN.light),
      necro: [price(OMEN.necro.prefix), price(OMEN.necro.suffix)], echoes: price(OMEN.echoes),
      crystal: [price(OMEN.crystal.prefix), price(OMEN.crystal.suffix)],
    };
    // bones: the cheapest one without a floor that the item level allows, and the Ancient one (floor 40) when priced
    const bones = [];
    if (ctx.bone) {
      const exists = (q) => !!(ctx.kb.item_descriptions || {})[`${q} ${ctx.bone}`];
      const plain = [['Gnawed', ctx.ilvl <= 64], ['Preserved', true]].filter(([q, ok]) => ok && exists(q)).map(([q]) => ({ quality: q, floor: 0, price: price(`${q} ${ctx.bone}`) }))
        .filter((b) => b.price != null).sort((a, b) => a.price - b.price)[0];
      if (plain) bones.push(plain);
      if (exists('Ancient') && ctx.ilvl >= 40 && price(`Ancient ${ctx.bone}`) != null) bones.push({ quality: 'Ancient', floor: 40, price: price(`Ancient ${ctx.bone}`) });
    }

    // ---- catalyst quality (rings, amulets, jewels, bases that take catalysts). The player says what the route may do
    // with it: nothing ('lock'), use up what the item has with Omen of Catalysing Exaltation ('use'), or also add
    // catalysts for that ('raise'). A node knows the quality as none, the item's own, or full (20%).
    const qMode = input.quality === 'use' || input.quality === 'raise' ? input.quality : 'lock';
    const canCat = jewel || ctx.cls === 'Ring' || ctx.cls === 'Amulet' || (ctx.base.imp || []).includes('Catalysts can be applied to this item');
    let CAT = null;
    if (canCat && qMode !== 'lock' && price(OMEN.catalyse) != null) {
      const famTag = (fam, tag) => (ix.famMods.get(fam) || []).some((id) => (ix.kb.mods[id].mt || []).includes(tag));
      const helps = (tag) => goals.filter((g) => g.kind === 'nat' && !g.kept && famTag(g.fam, tag));
      const nameOf = (tag) => (jewel ? 'Refined ' : '') + P.CATALYST_NAME[tag];
      const own = st0.catTag && st0.catQ > 0 ? st0.catTag : null;
      let tag = own && helps(own).length ? own : null;
      if (!tag && qMode === 'raise') {
        // the catalyst of the type that covers the hardest targets
        let best = 0;
        for (const t of Object.keys(P.CATALYST_NAME)) {
          if (price(nameOf(t)) == null) continue;
          const score = helps(t).reduce((x, g) => { const st = stats(g.si, 0), i = goals.indexOf(g); return x + (st.met[i] > 0 ? st.W / st.met[i] : 0); }, 0);
          if (score > best) { best = score; tag = t; }
        }
      }
      if (tag) CAT = { tag, name: nameOf(tag), price: qMode === 'raise' ? price(nameOf(tag)) : null, omen: price(OMEN.catalyse), q0: own === tag ? Math.min(20, st0.catQ) : 0, per: ctx.ilvl < 50 ? 2 : 1 };
    }
    const multOf = (q) => (!CAT || !q ? 1 : q === 2 ? ctx.catalystMult : 1 + (ctx.catalystMult - 1) * Math.min(1, CAT.q0 / 20));

    // ---- nodes
    const states = [], index = new Map(), acts = [];
    const keyOf = (S) => S.r + '|' + S.g.join('') + '|' + S.j[0] + S.j[1] + '|' + S.fg + '|' + S.fj + S.cx + S.dj + S.du + S.q;
    const cp = (S) => ({ r: S.r, g: S.g.slice(), j: [S.j[0], S.j[1]], fg: S.fg, fj: S.fj, cx: S.cx, dj: S.dj, du: S.du, q: S.q });
    function idOf(S) {
      const k = keyOf(S);
      let i = index.get(k);
      if (i === undefined) { i = states.length; index.set(k, i); states.push(S); }
      return i;
    }
    const others = (S, si) => S.j[si] + (S.fj === si + 1 ? 1 : 0) + (S.cx === si + 1 ? 1 : 0) + (S.dj === si + 1 ? 1 : 0);
    function slots(S, si) {
      let n = others(S, si) + (S.du === si + 1 ? 1 : 0);
      for (let i = 0; i < G; i++) if (S.g[i] && goals[i].si === si) n++;
      return n;
    }
    const limOf = (S, si) => (S.r === 2 ? LIM[si] : S.r === 1 ? 1 : 0);
    const open = (S, si) => Math.max(0, limOf(S, si) - slots(S, si));
    const done = (S) => { for (let i = 0; i < G; i++) if (!met(S.g[i])) return false; return true; };
    const craftedUsed = (S) => { let n = S.cx ? 1 : 0; for (let i = 0; i < G; i++) if (S.g[i] === CRAFTED) n++; return n; };
    const desUsed = (S) => { let n = (S.dj ? 1 : 0) + (S.du ? 1 : 0); for (let i = 0; i < G; i++) if (S.g[i] === DESECRATED) n++; return n; };

    /** A random modifier for the open sides in `mask` (bit 0 prefix, bit 1 suffix): [[chance, goal index or -1, side]]. */
    function roll(S, mask, floor, mult) {
      const parts = [];
      let total = 0;
      for (let si = 0; si < 2; si++) {
        if (!(mask & (1 << si))) continue;
        const s = stats(si, floor, mult), s0 = floor || mult > 1 ? stats(si, 0) : s;
        const n = others(S, si);
        // a target that is there, or has a modifier in its way, is out of the pool with its group (of a group with
        // several families, half is taken to be left)
        let present = 0;
        for (let i = 0; i < G; i++) if (S.g[i] && goals[i].si === si) present += S.g[i] === BLOCKED ? s.met[i] + s.low[i] / 2 : s.met[i] + s.low[i];
        const avail = Math.max(0, s.W - present - n * s.block);
        if (avail <= 0) continue;
        let hit = 0;
        const hits = [];
        for (let i = 0; i < G; i++) {
          const g = goals[i];
          if (S.g[i] || g.si !== si) continue;
          if (g.kind === 'des') {
            // a rolled modifier of a Desecrated target's group is known as such
            const b = Math.min(avail - hit, s.low[i]);
            if (b > 0) { hits.push([b, i, si, BLOCKED]); hit += b; }
            continue;
          }
          // an unknown modifier of this side is of the target's group with this chance, and then the target cannot roll
          const beta = n && s0.W > 0 ? Math.min(1, s0.low[i] / s0.W) : 0;
          const w = Math.min(avail - hit, s.met[i] * Math.pow(1 - beta, n));
          if (w > 0) { hits.push([w, i, si, NATURAL]); hit += w; }
        }
        parts.push(...hits, [avail - hit, -1, si, 0]);
        total += avail;
      }
      return total > 0 ? parts.filter((x) => x[0] > 0).map(([w, i, si, status]) => [w / total, i, si, status]) : [];
    }
    function addRolled(S, i, si, status) {
      const n = cp(S);
      if (i >= 0) n.g[i] = status || NATURAL; else n.j[si]++;
      return n;
    }
    /** The modifiers a removal can take: [{w, k, i, si}] (w: how many of them). pred(side, desecrated). */
    function units(S, pred) {
      const out = [];
      for (let i = 0; i < G; i++) if (S.g[i] && S.fg !== i && pred(goals[i].si, S.g[i] === DESECRATED)) out.push({ w: 1, k: 'g', i, si: goals[i].si });
      for (let si = 0; si < 2; si++) if (S.j[si] && pred(si, false)) out.push({ w: S.j[si], k: 'j', si });
      if (S.cx && pred(S.cx - 1, false)) out.push({ w: 1, k: 'cx', si: S.cx - 1 });
      if (S.dj && pred(S.dj - 1, true)) out.push({ w: 1, k: 'dj', si: S.dj - 1 });
      if (S.du && pred(S.du - 1, true)) out.push({ w: 1, k: 'du', si: S.du - 1 });
      return out;
    }
    function removeUnit(S, u) {
      const n = cp(S);
      if (u.k === 'g') n.g[u.i] = ABSENT; else if (u.k === 'j') n.j[u.si]--; else n[u.k] = 0;
      return n;
    }
    const openMask = (S) => (open(S, 0) > 0 ? 1 : 0) | (open(S, 1) > 0 ? 2 : 0);

    // ---- the Well of Souls: what the three options offer, and which one the player takes
    const desCache = new Map();
    function desList(si, floor, lich) {
      const k = si + '|' + floor + '|' + (lich || '');
      if (!desCache.has(k)) desCache.set(k, P.desPoolFor(ctx, SIDES[si], floor, lich || null));
      return desCache.get(k);
    }
    /** [[chance, goal index or -1]] for a desecrated modifier revealed on side si of S (S without the hidden modifier). */
    function reveal(S, si, floor, lich, echoes) {
      const ex = desList(si, floor, null), ll = lich ? desList(si, floor, lich) : null;
      const s = stats(si, floor), s0 = floor ? stats(si, 0) : s;
      const n = others(S, si);
      let present = 0;
      for (let i = 0; i < G; i++) if (S.g[i] && goals[i].si === si) present += S.g[i] === BLOCKED ? s.met[i] + s.low[i] / 2 : s.met[i] + s.low[i];
      const avail = Math.max(1e-9, s.W - present - n * s.block);
      const want = [];
      for (let i = 0; i < G; i++) {
        const g = goals[i];
        if (S.g[i] || g.si !== si) continue;
        if (g.kind === 'des') {
          const fits = (e) => e.fam === g.fam && (!g.tier || e.tier <= g.tier);
          const c = ex.filter(fits).length, cl = ll ? ll.filter(fits).length : 0;
          if (c || cl) want.push({ i, des: true, c, cl });
        } else if (g.kind === 'nat' && s.met[i] > 0) {
          const beta = n && s0.W > 0 ? Math.min(1, s0.low[i] / s0.W) : 0;
          want.push({ i, des: false, w: Math.min(avail, s.met[i] * Math.pow(1 - beta, n)) });
        }
      }
      if (!want.length) return [[1, -1]];
      want.sort((a, b) => (b.des - a.des) || ((a.w || 0) - (b.w || 0)));
      const pick = new Float64Array(G);
      let missAll = 0;
      const chances = ex.length ? P.DES_OPTIONS : [1];
      for (let k = 0; k < chances.length; k++) {
        // desecrated-only options and base modifier options among the three (planner.js revealOptions)
        const nEx = ex.length ? k + 1 : 0;
        const exDraws = ll && ll.length ? Math.max(0, nEx - 1) : nEx;
        const normDraws = 3 - (ll && ll.length ? 1 : 0) - exDraws;
        let rem = 1;
        for (const wnt of want) {
          let off;
          if (wnt.des) {
            let none = 1;
            for (let t = 0; t < exDraws; t++) none *= Math.max(0, 1 - wnt.c / Math.max(1, ex.length - t));
            if (ll && ll.length) none *= 1 - wnt.cl / ll.length;
            off = 1 - none;
          } else off = 1 - Math.pow(1 - Math.min(1, wnt.w / avail), Math.max(0, normDraws));
          pick[wnt.i] += chances[k] * rem * off;
          rem *= 1 - off;
        }
        missAll += chances[k] * rem;
      }
      const out = [];
      const again = echoes ? 1 + missAll : 1;
      for (const wnt of want) if (pick[wnt.i] > 0) out.push([pick[wnt.i] * again, wnt.i]);
      out.push([echoes ? missAll * missAll : missAll, -1]);
      return out;
    }

    // ---- edges
    const N0 = { r: 0, g: new Array(G).fill(ABSENT), j: [0, 0], fg: -1, fj: 0, cx: 0, dj: 0, du: 0, q: 0 };
    const RESTART = -1; // edge target: a fresh white base (its value is solved as one number, see solve)
    function expand(sIdx) {
      const S = states[sIdx];
      const list = [];
      acts[sIdx] = list;
      if (done(S)) return;
      const push = (a, cost, outs) => {
        // outs: [[chance, state]]; the same node reached twice is one edge
        const m = new Map();
        let tot = 0;
        for (const [p, S2] of outs) { if (!(p > 0)) continue; const t = S2 === RESTART ? RESTART : idOf(S2); m.set(t, (m.get(t) || 0) + p); tot += p; }
        if (!m.size) return;
        const out = [];
        for (const [t, p] of m) out.push(p / tot, t);
        if (out.length === 2 && out[1] === sIdx) return; // changes nothing
        list.push({ a, cost, out });
      };
      const rolled = (S1, mask, floor, pre) => roll(S1, mask, floor).map(([p, i, si, status]) => [p * (pre == null ? 1 : pre), addRolled(S1, i, si, status)]);

      if (S.r === 0) {
        for (const t of T.transmute) { const S1 = cp(S); S1.r = 1; push({ op: 'transmute', tier: t.tier }, t.price, rolled(S1, 3, t.floor)); }
        if (PR.alchemy != null) {
          // Orb of Alchemy: Rare with four modifiers, one after the other
          const R0 = cp(S); R0.r = 2;
          let dist = new Map([[keyOf(R0), [1, R0]]]);
          for (let k = 0; k < 4; k++) {
            const next = new Map();
            for (const [p, S1] of dist.values()) {
              const outs = roll(S1, openMask(S1), 0);
              if (!outs.length) { const key = keyOf(S1); next.set(key, [(next.get(key) || [0])[0] + p, S1]); continue; }
              for (const [q, i, si, status] of outs) { const S2 = addRolled(S1, i, si, status), key = keyOf(S2); next.set(key, [(next.get(key) || [0])[0] + p * q, S2]); }
            }
            dist = next;
          }
          push({ op: 'alchemy' }, PR.alchemy, [...dist.values()]);
        }
        return;
      }
      if (keyOf(S) !== keyOf(N0)) push({ op: 'newbase' }, baseCost, [[1, RESTART]]);
      if (S.r === 1) {
        const mask = openMask(S);
        if (mask) for (const t of T.augment) push({ op: 'augment', tier: t.tier }, t.price, rolled(S, mask, t.floor));
        for (const t of T.regal) { const S1 = cp(S); S1.r = 2; push({ op: 'regal', tier: t.tier }, t.price, rolled(S1, openMask(S1), t.floor)); }
        if (craftedUsed(S) < CAP_CRAFTED) for (let i = 0; i < G; i++) {
          const g = goals[i];
          if (S.g[i] || !g.magicEss) continue;
          const S1 = cp(S); S1.r = 2;
          if (open(S1, g.si) > 0) { S1.g[i] = CRAFTED; push({ op: 'essence', item: g.magicEss.item, mod: g.magicEss.mod }, g.magicEss.price, [[1, S1]]); }
        }
        if (PR.annul != null) {
          const us = units(S, () => true), tw = us.reduce((x, u) => x + u.w, 0);
          if (tw) push({ op: 'annul' }, PR.annul, us.map((u) => [u.w / tw, removeUnit(S, u)]));
        }
        return;
      }
      // Rare
      const mask = openMask(S);
      if (mask) for (const t of T.exalt) {
        push({ op: 'exalt', tier: t.tier }, t.price, rolled(S, mask, t.floor));
        if (mask === 3) for (let si = 0; si < 2; si++) if (PR.exaltSide[si] != null) push({ op: 'exalt', tier: t.tier, side: SIDES[si] }, t.price + PR.exaltSide[si], rolled(S, 1 << si, t.floor));
      }
      if (CAT && S.q && mask) {
        // the omen uses up all the catalyst quality and favours the catalyst's type of modifier
        const m = multOf(S.q);
        const spent = (S1, i, si, status) => { const n = addRolled(S1, i, si, status); n.q = 0; return n; };
        for (const t of T.exalt) {
          push({ op: 'exalt', tier: t.tier, catalyse: true }, t.price + CAT.omen, roll(S, mask, t.floor, m).map(([p, i, si, status]) => [p, spent(S, i, si, status)]));
          if (mask === 3) for (let si = 0; si < 2; si++) if (PR.exaltSide[si] != null) push({ op: 'exalt', tier: t.tier, side: SIDES[si], catalyse: true }, t.price + CAT.omen + PR.exaltSide[si], roll(S, 1 << si, t.floor, m).map(([p, i, sj, status]) => [p, spent(S, i, sj, status)]));
        }
      }
      if (CAT && CAT.price != null && S.q < 2) {
        const count = Math.ceil((20 - (S.q === 1 ? CAT.q0 : 0)) / CAT.per);
        const S1 = cp(S);
        S1.q = 2;
        push({ op: 'catalyst', tag: CAT.tag, item: CAT.name, refined: jewel, count }, count * CAT.price, [[1, S1]]);
      }
      for (const t of T.chaos) {
        for (let v = -1; v < 2; v++) {
          if (v >= 0 && PR.erasure[v] == null) continue;
          const us = units(S, (si) => v < 0 || si === v), tw = us.reduce((x, u) => x + u.w, 0);
          if (!tw) continue;
          const outs = [];
          for (const u of us) { const S1 = removeUnit(S, u); outs.push(...rolled(S1, openMask(S1), t.floor, u.w / tw)); }
          push(v < 0 ? { op: 'chaos', tier: t.tier } : { op: 'chaos', tier: t.tier, side: SIDES[v] }, t.price + (v < 0 ? 0 : PR.erasure[v]), outs);
        }
      }
      if (PR.annul != null) {
        for (let v = -1; v < 2; v++) {
          if (v >= 0 && PR.annulSide[v] == null) continue;
          const us = units(S, (si) => v < 0 || si === v), tw = us.reduce((x, u) => x + u.w, 0);
          if (tw) push(v < 0 ? { op: 'annul' } : { op: 'annul', side: SIDES[v] }, PR.annul + (v < 0 ? 0 : PR.annulSide[v]), us.map((u) => [u.w / tw, removeUnit(S, u)]));
        }
        if (PR.light != null) {
          const us = units(S, (si, des) => des), tw = us.reduce((x, u) => x + u.w, 0);
          if (tw) push({ op: 'annul', light: true }, PR.annul + PR.light, us.map((u) => [u.w / tw, removeUnit(S, u)]));
        }
      }
      // a Perfect essence, an alloy or a liquid emotion: one modifier goes, the target comes as the crafted modifier
      if (craftedUsed(S) < CAP_CRAFTED) for (let i = 0; i < G; i++) {
        const g = goals[i], r = g.rareEss;
        if (S.g[i] || !r) continue;
        // Crystallisation omens aim Perfect and Corrupted Essences only: not alloys (game text; the player, 8 Oct 2026), not liquid emotions
        const aim = r.liquid || r.alloy ? [-1] : [-1, 0, 1];
        for (const v of aim) {
          if (v >= 0 && PR.crystal[v] == null) continue;
          const from = v >= 0 ? v : open(S, g.si) === 0 ? g.si : -1; // R_SWAP_REMOVAL
          const us = units(S, (si) => from < 0 || si === from), tw = us.reduce((x, u) => x + u.w, 0);
          const outs = [];
          const give = (S1, p) => { if (open(S1, g.si) > 0) { const S2 = cp(S1); S2.g[i] = CRAFTED; outs.push([p, S2]); } else outs.push([p, S1]); };
          if (tw) for (const u of us) give(removeUnit(S, u), u.w / tw); else if (v < 0) give(S, 1);
          push(Object.assign({ op: 'pessence', item: r.item, mod: r.mod }, v >= 0 ? { side: SIDES[v] } : null), r.price + (v >= 0 ? PR.crystal[v] : 0), outs);
        }
      }
      // desecration
      if (!desUsed(S) && bones.length) {
        const full = mask === 0;
        for (const b of bones) for (let v = -1; v < 2; v++) {
          if (v >= 0 && PR.necro[v] == null) continue;
          // where the hidden modifier lands, and what the item is without what it replaced (R_DESECRATE_FULL)
          const land = [];
          if (!full) {
            const c = (v < 0 ? [0, 1] : [v]).filter((si) => open(S, si) > 0);
            for (const si of c) land.push([1 / c.length, si, S]);
          } else {
            const us = units(S, (si) => v < 0 || si === v), tw = us.reduce((x, u) => x + u.w, 0);
            for (const u of us) land.push([u.w / tw, u.si, removeUnit(S, u)]);
          }
          if (!land.length) continue;
          const base = b.price + (v >= 0 ? PR.necro[v] : 0);
          const act = (extra) => Object.assign({ op: 'bone', quality: b.quality }, v >= 0 ? { side: SIDES[v] } : null, extra);
          // left hidden: it counts as a modifier and cannot be fractured, the reveal comes later
          // (a hair dearer than revealing at once, so it is chosen only where the hidden modifier earns something)
          if (b === bones[0] && PR.fracture != null && S.fg < 0 && !S.fj) push(act({ hide: true }), base + 1e-6, land.map(([p, si, S1]) => { const S2 = cp(S1); S2.du = si + 1; return [p, S2]; }));
          const liches = [null];
          for (let i = 0; i < G; i++) { const g = goals[i]; if (!S.g[i] && g.kind === 'des' && g.lich && price(OMEN.lich[g.lich]) != null && !liches.includes(g.lich)) liches.push(g.lich); }
          for (const lich of liches) for (const echoes of [false, true]) {
            if (echoes && PR.echoes == null) continue;
            const outs = [];
            let useful = false;
            for (const [p, si, S1] of land) for (const [q, i] of reveal(S1, si, b.floor, lich, echoes)) {
              const S2 = cp(S1);
              if (i >= 0) { S2.g[i] = DESECRATED; useful = true; } else S2.dj = si + 1;
              outs.push([p * q, S2]);
            }
            if (useful) push(act(Object.assign({}, lich ? { lich } : null, echoes ? { echoes: true } : null)), base + (lich ? price(OMEN.lich[lich]) : 0) + (echoes ? PR.echoes : 0), outs);
          }
        }
      }
      if (S.du) {
        const si = S.du - 1, S1 = cp(S);
        S1.du = 0;
        for (const echoes of [false, true]) {
          if (echoes && PR.echoes == null) continue;
          push({ op: 'reveal', echoes }, echoes ? PR.echoes : 0, reveal(S1, si, 0, null, echoes).map(([q, i]) => { const S2 = cp(S1); if (i >= 0) S2.g[i] = DESECRATED; else S2.dj = si + 1; return [q, S2]; }));
        }
      }
      // Fracturing Orb: one of the modifiers that are not desecrated, each as likely; it needs four modifiers in all
      if (PR.fracture != null && S.fg < 0 && !S.fj && slots(S, 0) + slots(S, 1) >= 4) {
        const outs = [];
        let n = 0;
        for (let i = 0; i < G; i++) if (S.g[i] === NATURAL || S.g[i] === CRAFTED || S.g[i] === BLOCKED) { const S2 = cp(S); S2.fg = i; outs.push([1, S2]); n++; }
        for (let si = 0; si < 2; si++) if (S.j[si]) { const S2 = cp(S); S2.j[si]--; S2.fj = si + 1; outs.push([S.j[si], S2]); n += S.j[si]; }
        if (S.cx) { const S2 = cp(S); S2.fj = S.cx; S2.cx = 0; outs.push([1, S2]); n++; }
        if (n) push({ op: 'fracture' }, PR.fracture, outs.map(([w, S2]) => [w / n, S2]));
      }
    }

    // ---- the item as a node
    /** known: also mark a modifier that stands in a natural target's way (the pasted item's own; rolled ones are averaged). */
    function nodeOf(st, known) {
      const S = cp(N0);
      S.r = st.rarity === 'Rare' ? 2 : st.rarity === 'Magic' ? 1 : 0;
      S.q = CAT && st.catTag === CAT.tag && st.catQ > 0 ? (st.catQ >= 20 ? 2 : 1) : 0;
      for (const m of st.mods) {
        const si = m.side === 'prefix' ? 0 : 1;
        const i = goals.findIndex((g, k) => !S.g[k] && g.si === si && P.meets(m, g, g.tier));
        // not the target, but of its group (a lower tier, a sister modifier): it stands in the target's way
        const b = i >= 0 || m.unrevealed || m.des || m.crafted ? -1 : goals.findIndex((g, k) => !S.g[k] && g.si === si && (g.kind === 'des' || (known && g.kind === 'nat')) && (m.fam === g.fam || (g.grp.length && (m.grp || []).some((x) => g.grp.includes(x)))));
        if (i >= 0 && !m.unrevealed) { S.g[i] = m.des ? DESECRATED : m.crafted ? CRAFTED : NATURAL; if (m.frac) S.fg = i; }
        else if (b >= 0) { S.g[b] = BLOCKED; if (m.frac) S.fg = b; }
        else if (m.frac) S.fj = si + 1;
        else if (m.unrevealed) S.du = si + 1;
        else if (m.des) S.dj = si + 1;
        else if (m.crafted) S.cx = si + 1;
        else S.j[si]++;
      }
      return S;
    }
    const startS = nodeOf(st0, true);
    // entry points a player can buy instead of rolling: a Magic base that has one target, a Rare with one target
    // fractured and nothing else. Solved with the rest so their worth can be told.
    const entries = [];
    for (let i = 0; i < G; i++) {
      if (goals[i].kind !== 'nat' || goals[i].kept) continue;
      const M = cp(N0); M.r = 1; M.g[i] = NATURAL;
      const F = cp(N0); F.r = 2; F.g[i] = NATURAL; F.fg = i;
      entries.push({ kind: 'magic', goal: i, S: M }, { kind: 'fractured', goal: i, S: F });
    }
    const start = idOf(startS), n0 = idOf(cp(N0));
    for (const e of entries) e.id = idOf(e.S);
    for (let q = 0; q < states.length; q++) {
      if (states.length > MAX_STATES) return { unsupported: 'too many item states', states: states.length };
      expand(q);
    }
    const N = states.length;

    // ---- solve: for every node the cheapest edge on average
    // Nodes are solved in blocks that share rarity stage, targets and fracture: the long loops (roll, miss, roll again)
    // stay inside one block and are solved exactly there. A fresh white base is one number x: every value is
    // A + (1 - F) x, with A the cost until the item is done or given up and F the chance that it gets done, and
    // x = A(N0) / F(N0). The rule set starts as "add while a target can come, else a new base", which always ends, and
    // is improved node by node until no node has a cheaper edge.
    const blockKey = (S) => (S.r < 2 ? 'early' : S.g.join('') + '|' + S.fg + '|' + S.fj);
    const bmap = new Map();
    for (let s = 0; s < N; s++) { const k = blockKey(states[s]); if (!bmap.has(k)) bmap.set(k, []); bmap.get(k).push(s); }
    const metN = (S) => { let n = 0; for (let i = 0; i < G; i++) if (met(S.g[i])) n++; return n; };
    const blocks = [...bmap.values()].sort((a, b) => (states[b[0]].r - states[a[0]].r) || (metN(states[b[0]]) - metN(states[a[0]])));
    const blockOf = new Int32Array(N), local = new Int32Array(N);
    blocks.forEach((b, bi) => b.forEach((s, li) => { blockOf[s] = bi; local[s] = li; }));
    const pol = new Int32Array(N).fill(-1);

    /**
     * Solve x = d + P x under pol for several d at once. rhs: [{d, bnd, term}]: bnd is the value of a white base
     * (RESTART), term the value of a finished item.
     */
    // which blocks read a block's values (over every edge, whatever the rule set): they are solved again when it changes
    const readers = blocks.map(() => new Set());
    for (let s = 0; s < N; s++) for (const act of acts[s]) { const o = act.out; for (let t = 1; t < o.length; t += 2) if (o[t] !== RESTART && blockOf[o[t]] !== blockOf[s]) readers[blockOf[o[t]]].add(blockOf[s]); }
    const readerList = readers.map((x) => [...x]);
    // a block's matrix changes only when its part of the rule set does: its factors are kept until then
    const luCache = blocks.map(() => null);
    function luOf(bi) {
      const b = blocks[bi], m = b.length, c = luCache[bi];
      if (c) { let same = true; for (let li = 0; li < m; li++) if (c.pol[li] !== pol[b[li]]) { same = false; break; } if (same) return c; }
      const A = new Float64Array(m * m), mine = new Int32Array(m);
      for (let li = 0; li < m; li++) {
        const s = b[li];
        mine[li] = pol[s];
        A[li * m + li] = 1;
        if (pol[s] < 0) continue;
        const o = acts[s][pol[s]].out;
        for (let t = 0; t < o.length; t += 2) if (o[t + 1] !== RESTART && blockOf[o[t + 1]] === bi) A[li * m + local[o[t + 1]]] -= GAMMA * o[t];
      }
      return (luCache[bi] = { A, perm: luFactor(A, m), pol: mine });
    }
    function evaluate(rhs) {
      const K = rhs.length;
      const X = rhs.map((r) => { if (r.x0) return Float64Array.from(r.x0); const a = new Float64Array(N); if (r.term) for (let s = 0; s < N; s++) if (pol[s] === -1) a[s] = r.term; return a; });
      // a block is solved again only while something it reads has changed
      const dirty = new Uint8Array(blocks.length).fill(1);
      let left = blocks.length;
      for (let pass = 0; pass < 600 && left > 0; pass++) {
        for (let bi = 0; bi < blocks.length; bi++) {
          if (!dirty[bi]) continue;
          dirty[bi] = 0; left--;
          const b = blocks[bi], m = b.length;
          const R = new Float64Array(m * K);
          for (let li = 0; li < m; li++) {
            const s = b[li];
            if (pol[s] < 0) { for (let k = 0; k < K; k++) R[li * K + k] = pol[s] === -1 ? rhs[k].term || 0 : rhs[k].stuck || 0; continue; }
            const o = acts[s][pol[s]].out;
            for (let k = 0; k < K; k++) R[li * K + k] = rhs[k].d ? rhs[k].d[s] : 0;
            for (let t = 0; t < o.length; t += 2) {
              const p = GAMMA * o[t], s2 = o[t + 1];
              if (s2 === RESTART) { for (let k = 0; k < K; k++) R[li * K + k] += p * rhs[k].bnd; }
              else if (blockOf[s2] !== bi) for (let k = 0; k < K; k++) R[li * K + k] += p * X[k][s2];
            }
          }
          const f = luOf(bi);
          luSolve(f.A, f.perm, R, m, K);
          let delta = 0;
          for (let li = 0; li < m; li++) for (let k = 0; k < K; k++) {
            const v = R[li * K + k], old = X[k][b[li]];
            const dv = Math.abs(v - old) / (Math.abs(v) + 1e-300);
            if (dv > delta && Math.abs(v - old) > 1e-300) delta = dv;
            X[k][b[li]] = v;
          }
          if (delta > 1e-11) for (const r of readerList[bi]) if (!dirty[r]) { dirty[r] = 1; left++; }
        }
      }
      return X;
    }
    const V = new Float64Array(N);
    let x = 0;
    // what a new base costs in the equations: its price, plus a charge that keeps the craft within the number of bases
    // the player will use (see fitBases). The charge is not money: costs are reported without it.
    let charge = 0;
    const costOf = (act) => (act.a.op === 'newbase' ? act.cost + charge : act.cost);
    const qOf = (s, act) => { let c = costOf(act); const o = act.out; for (let t = 0; t < o.length; t += 2) c += o[t] * (o[t + 1] === RESTART ? x : V[o[t + 1]]); return c; };
    // the first rule set: one that always ends
    for (let s = 0; s < N; s++) {
      const S = states[s], list = acts[s];
      if (!list.length) { pol[s] = done(S) ? -1 : -2; continue; }
      const find = (pred) => list.findIndex((e) => pred(e.a));
      let a = -1;
      if (S.r === 0) a = find((e) => e.op === 'transmute');
      else if (S.r === 1) { a = find((e) => e.op === 'essence'); if (a < 0) a = find((e) => e.op === 'regal'); }
      else {
        if (S.du) a = find((e) => e.op === 'reveal');
        if (a < 0) a = find((e) => e.op === 'exalt' && !e.side);
        if (a < 0) a = find((e) => e.op === 'pessence' && !e.side);
        if (a < 0) a = find((e) => e.op === 'bone' && !e.hide);
      }
      if (a < 0) a = find((e) => e.op === 'newbase');
      pol[s] = a < 0 ? 0 : a;
    }
    let Fv = new Float64Array(N), Av = null, rounds = 0, sol = null;
    /** Improve the rule set until no node has a cheaper edge (it starts from the rule set of the last solve). */
    function solve() {
      for (let it = 0; it < 100; it++, rounds++) {
        const d = new Float64Array(N);
        for (let s = 0; s < N; s++) if (pol[s] >= 0) d[s] = costOf(acts[s][pol[s]]);
        const [A, F] = evaluate([{ d, bnd: 0, stuck: BIG, x0: Av }, { bnd: 0, term: 1, x0: Av ? Fv : null }]);
        x = F[n0] > 1e-250 ? A[n0] / F[n0] : BIG;
        for (let s = 0; s < N; s++) V[s] = Math.min(BIG, A[s] + (1 - F[s]) * x);
        Fv = F; Av = A;
        let changed = 0;
        for (let s = 0; s < N; s++) {
          const list = acts[s];
          if (!list.length) continue;
          let best = pol[s], bq = qOf(s, list[pol[s]]);
          for (let a = 0; a < list.length; a++) { if (a === pol[s]) continue; const v = qOf(s, list[a]); if (v < bq - 1e-9 * (1 + Math.abs(bq))) { bq = v; best = a; } }
          if (best !== pol[s]) { pol[s] = best; changed++; }
        }
        if (!changed) break;
      }
      sol = null;
    }
    solve();

    // ---- what the rule set uses: every currency's expected count, and how far the cost spreads
    const actNames = (a) => (a.op === 'reveal' ? (a.echoes ? [OMEN.echoes] : []) : P.actionNames(a, ctx));
    /** Expected counts of every currency and the cost's second moment, for the rule set as it stands. */
    function solution() {
      if (sol) return sol;
      const nameSet = new Map();
      for (let s = 0; s < N; s++) if (pol[s] >= 0) for (const n of actNames(acts[s][pol[s]].a)) if (!nameSet.has(n)) nameSet.set(n, nameSet.size);
      const names = [...nameSet.keys()];
      const rhs = names.map(() => ({ d: new Float64Array(N), bnd: 0 }));
      // money only: the cost and its second moment (M = c^2 + 2 c E[V'] + E[M']) leave the charge on bases out
      const cost = new Float64Array(N);
      for (let s = 0; s < N; s++) if (pol[s] >= 0) { const act = acts[s][pol[s]]; cost[s] = act.cost; for (const n of actNames(act.a)) rhs[nameSet.get(n)].d[s] += act.a.count || 1; }
      rhs.push({ d: cost, bnd: 0 });
      const X = evaluate(rhs);
      const whole = (k, s) => X[k][s] + (1 - Fv[s]) * (Fv[n0] > 1e-250 ? X[k][n0] / Fv[n0] : 0);
      const K = names.length;
      const money = new Float64Array(N);
      for (let s = 0; s < N; s++) money[s] = whole(K, s);
      const moneyBase = Fv[n0] > 1e-250 ? X[K][n0] / Fv[n0] : BIG;
      const d2 = new Float64Array(N);
      for (let s = 0; s < N; s++) if (pol[s] >= 0) {
        const act = acts[s][pol[s]], o = act.out;
        let next = 0;
        for (let t = 0; t < o.length; t += 2) next += o[t] * (o[t + 1] === RESTART ? moneyBase : money[o[t + 1]]);
        d2[s] = act.cost * act.cost + 2 * act.cost * next;
      }
      const M = evaluate([{ d: d2, bnd: 0 }])[0];
      const m2 = (s) => M[s] + (1 - Fv[s]) * (Fv[n0] > 1e-250 ? M[n0] / Fv[n0] : 0);
      sol = { names, uses: (s, k) => whole(k, s), money, moneyBase, m2 };
      return sol;
    }
    const usesOf = (s, name) => { const so = solution(), k = so.names.indexOf(name); return k < 0 ? 0 : so.uses(s, k); };
    /** New bases from node s on average, without the rest of the solution (the search of the charge asks often). */
    function basesAt(s) {
      const d = new Float64Array(N);
      let any = false;
      for (let t = 0; t < N; t++) if (pol[t] >= 0 && acts[t][pol[t]].a.op === 'newbase') { d[t] = 1; any = true; }
      if (!any) return 0;
      const X = evaluate([{ d, bnd: 0 }])[0];
      return X[s] + (1 - Fv[s]) * (Fv[n0] > 1e-250 ? X[n0] / Fv[n0] : 0);
    }

    const net = {
      ctx, goals, states, acts, pol, start, n0, N, catalyst: CAT ? { tag: CAT.tag, name: CAT.name } : null,
      get rounds() { return rounds; },
      get base() { return solution().money[n0]; },
      nodeOf(st) {
        // the node with what is known to be in the way, when the network has it (the pasted item and what follows from it)
        let i = index.get(keyOf(nodeOf(st, true)));
        if (i === undefined) i = index.get(keyOf(nodeOf(st, false)));
        return i === undefined ? -1 : i;
      },
      done: (s) => done(states[s]),
      /** The step to use at node s: {a, names, cost, out}, or null when done or stuck. */
      step(s) { return pol[s] >= 0 ? Object.assign({ names: actNames(acts[s][pol[s]].a) }, acts[s][pol[s]]) : null; },
      /** Chance that the step at node s adds a target the item does not have. */
      hit(s) {
        if (pol[s] < 0) return 0;
        const o = acts[s][pol[s]].out, n = metN(states[s]);
        let p = 0;
        for (let t = 0; t < o.length; t += 2) if (o[t + 1] !== RESTART && metN(states[o[t + 1]]) > n) p += o[t];
        return p;
      },
      /** Expected cost from node s (Exalted Orbs). */
      cost: (s) => solution().money[s],
      /** Standard deviation of the cost from node s. */
      sd(s) { const so = solution(); return Math.sqrt(Math.max(0, so.m2(s) - so.money[s] * so.money[s])); },
      /** Chance that the craft from node s costs at most `budget` (a gamma curve through the mean and the spread). */
      within(s, budget) {
        const so = solution(), mean = so.money[s], v = Math.max(0, so.m2(s) - mean * mean);
        if (!(mean > 0)) return 1;
        if (!(v > 1e-9 * mean * mean)) return budget >= mean ? 1 : 0;
        return gammaP(mean * mean / v, budget * mean / v);
      },
      /** Materials of the whole craft from node s: [{name, uses, price, cost}], largest cost first. */
      materials(s) {
        const so = solution();
        return so.names.map((name, k) => { const uses = so.uses(s, k), pr = price(name) || 0; return { name, uses, price: pr, cost: uses * pr }; })
          .filter((m) => m.uses > 1e-6).sort((a, b) => b.cost - a.cost);
      },
      /** White bases the craft from node s takes on average (the one in hand not counted). */
      bases: (s) => usesOf(s, 'New base'),
      /**
       * Keep the craft from node s within `max` new bases on average: a charge per base is raised until the rule set
       * that is cheapest with it needs no more. Returns the charge (0 when the limit never bound).
       */
      fitBases(s, max) {
        if (charge) { charge = 0; solve(); }
        const free = basesAt(s);
        if (!(max >= 0) || free <= max) return 0;
        // a first guess from how far over the limit the free route is, then up until it holds
        let lo = 0, hi = Math.max(1, baseCost) * Math.max(2, free / Math.max(0.5, max)), at = Infinity;
        for (let k = 0; k < 30; k++) { charge = hi; solve(); at = basesAt(s); if (at <= max) break; lo = hi; hi *= 3; }
        // back down while the route is far under the limit (a cheaper one may still keep to it)
        for (let k = 0; k < 6 && at < 0.6 * max; k++) {
          const mid = Math.sqrt(Math.max(lo, hi * 0.02) * hi);
          charge = mid; solve();
          const b = basesAt(s);
          if (b <= max) { hi = mid; at = b; } else { lo = mid; charge = hi; solve(); if (hi / lo < 1.3) break; }
        }
        if (charge !== hi) { charge = hi; solve(); }
        return charge;
      },
      /** Every edge of node s with what the craft costs in all when it is used there and the route's rules after it (cheapest first). */
      options(s) {
        const so = solution();
        const total = (act) => { let c = act.cost; const o = act.out; for (let t = 0; t < o.length; t += 2) c += o[t] * (o[t + 1] === RESTART ? so.moneyBase : so.money[o[t + 1]]); return c; };
        return acts[s].map((act, i) => ({ a: act.a, names: actNames(act.a), cost: act.cost, total: total(act), best: i === pol[s] })).sort((a, b) => (b.best - a.best) || (a.total - b.total));
      },
      /** What buying a starting point is worth: the price up to which it beats rolling it from a white base. */
      entries() {
        const so = solution();
        return entries.map((e) => ({ kind: e.kind, goal: goals[e.goal], cost: so.money[e.id], worth: baseCost + so.moneyBase - so.money[e.id] })).filter((e) => e.worth > 0.005);
      },
      /** The rule set as lines, from node s along every outcome that is not rare: [{node, share, when, names, a, cost}]. */
      rules(s, max) {
        const seen = new Set([s]), q = [[s, 1]], out = [];
        while (q.length && out.length < (max || 16)) {
          const [n, p] = q.shift();
          const st = net.step(n);
          out.push({ node: n, share: p, when: describe(states[n]), names: st ? st.names : [], a: st ? st.a : null, cost: solution().money[n], done: done(states[n]) });
          if (!st) continue;
          const o = st.out, next = [];
          for (let t = 0; t < o.length; t += 2) if (o[t + 1] !== RESTART && !seen.has(o[t + 1]) && o[t] >= 0.02) next.push([o[t + 1], p * o[t]]);
          next.sort((a, b) => b[1] - a[1]);
          for (const e of next) { seen.add(e[0]); q.push(e); }
        }
        return out;
      },
      describe: (s) => describe(states[s]),
      price,
    };
    function describe(S) {
      const has = [], miss = [];
      const inWay = [];
      for (let i = 0; i < G; i++) {
        if (S.g[i] === BLOCKED) { inWay.push(goals[i].label + (S.fg === i ? ' (fractured)' : '')); miss.push(goals[i].label); }
        else (S.g[i] ? has : miss).push(goals[i].label + (S.fg === i ? ' (fractured)' : S.g[i] === CRAFTED ? ' (crafted)' : S.g[i] === DESECRATED ? ' (desecrated)' : ''));
      }
      const junk = [S.j[0] + (S.cx === 1 ? 1 : 0) + (S.dj === 1 ? 1 : 0) + (S.fj === 1 ? 1 : 0), S.j[1] + (S.cx === 2 ? 1 : 0) + (S.dj === 2 ? 1 : 0) + (S.fj === 2 ? 1 : 0)];
      for (let i = 0; i < G; i++) if (S.g[i] === BLOCKED) junk[goals[i].si]++;
      return { rarity: ['Normal', 'Magic', 'Rare'][S.r], has, miss, inWay, otherPrefixes: junk[0], otherSuffixes: junk[1], hidden: S.du ? SIDES[S.du - 1] : null,
        fracturedOther: S.fj ? SIDES[S.fj - 1] : null, desecratedOther: S.dj ? SIDES[S.dj - 1] : null };
    }
    return net;
  }

  /** LU with partial pivoting in place; returns the row order. */
  function luFactor(A, m) {
    const perm = new Int32Array(m);
    for (let i = 0; i < m; i++) perm[i] = i;
    for (let c = 0; c < m; c++) {
      let piv = c, best = Math.abs(A[c * m + c]);
      for (let r = c + 1; r < m; r++) { const v = Math.abs(A[r * m + c]); if (v > best) { best = v; piv = r; } }
      if (piv !== c) {
        for (let k = 0; k < m; k++) { const t = A[c * m + k]; A[c * m + k] = A[piv * m + k]; A[piv * m + k] = t; }
        const t = perm[c]; perm[c] = perm[piv]; perm[piv] = t;
      }
      const d = A[c * m + c] || (A[c * m + c] = 1e-300);
      for (let r = c + 1; r < m; r++) {
        const f = A[r * m + c] / d;
        A[r * m + c] = f;
        if (f) for (let k = c + 1; k < m; k++) A[r * m + k] -= f * A[c * m + k];
      }
    }
    return perm;
  }
  /** Solve with the factors: R (m x K) becomes x. */
  function luSolve(A, perm, R, m, K) {
    const Y = new Float64Array(m * K);
    for (let i = 0; i < m; i++) for (let k = 0; k < K; k++) Y[i * K + k] = R[perm[i] * K + k];
    for (let i = 1; i < m; i++) for (let j = 0; j < i; j++) { const f = A[i * m + j]; if (f) for (let k = 0; k < K; k++) Y[i * K + k] -= f * Y[j * K + k]; }
    for (let i = m - 1; i >= 0; i--) {
      const d = A[i * m + i];
      for (let k = 0; k < K; k++) {
        let v = Y[i * K + k];
        for (let j = i + 1; j < m; j++) v -= A[i * m + j] * Y[j * K + k];
        Y[i * K + k] = v / d;
      }
    }
    R.set(Y);
  }

  /** Regularised lower incomplete gamma P(a, x). */
  function gammaP(a, x) {
    if (!(x > 0)) return 0;
    const lg = logGamma(a);
    if (x < a + 1) {
      let sum = 1 / a, term = sum;
      for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-13) break; }
      return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - lg));
    }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-13) break;
    }
    return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - lg) * h);
  }
  function logGamma(z) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let x = z, y = z, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  return { build, gammaP };
});
