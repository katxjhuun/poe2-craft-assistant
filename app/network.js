/* PoE2 Craft Assistant: the craft network.
 *
 * The item is a node: which targets it has, how many other modifiers sit on each side, what is fractured, crafted or
 * desecrated, which runes the route socketed. Every currency is an edge with its outcomes, their chances (from the
 * roll weights) and its price. The route is the cheapest way through the network on average: for every node, the step
 * to use there ("if the item looks like this, use that"). No crafts are simulated: the costs are solved from the
 * equations, so the answer is there at once and follows the prices and the item as they change.
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
  const MAX_STATES = 150000;
  const GAMMA = 1 - 1e-13; // keeps the equations solvable should a rule set never finish; the error is far below a cent
  const BIG = 1e15;
  // What a target is on the item. A target that is there came naturally, as the crafted modifier or as the Desecrated
  // one; NEAR + that: it is there with a value under the wanted one (a Divine Orb rolls it again).
  const ABSENT = 0, NATURAL = 1, CRAFTED = 2, DESECRATED = 3;
  const BLOCKED = 4;  // not there, and a modifier of its group is in the way
  const NEAR = 4;     // added to NATURAL, CRAFTED, DESECRATED: 5, 6, 7
  const TWIN = 8;     // not there, but the same modifier of another element is: a Flux or a Rune of Aldur turns it into the target
  const met = (x) => x >= 1 && x <= 3;
  const near = (x) => x >= 5 && x <= 7;
  const kindOf = (x) => (near(x) ? x - NEAR : met(x) ? x : 0);
  // runes the route can socket (bits of a node's `u`)
  const R_ASTRID = 1, R_SERLE = 2, R_POOL = 4, R_ALDUR = 8;

  /**
   * input: { ix, item, targets, locks, priceOf(name) -> Exalted Orbs or null, baseCost, weights, essences, catalystMult,
   *          quality?: 'lock' | 'use' | 'raise' (catalyst quality: leave it alone, the default; let Omen of Catalysing
   *          Exaltation use up what the item has; or also add catalysts for it),
   *          lite?: 0 | 1 | 2, maxStates? (see route: a smaller network for requests with very many targets) }
   * Returns a solved network; { blocked } for an item no currency changes; { impossible: [{label, why}] } for targets
   * the item cannot have; { unsupported: reason } for what is left outside.
   */
  function build(input) {
    const { ix, item } = input;
    const kb = ix.kb;
    if (!item || !item.base || !kb.bases[item.base]) return { unsupported: 'unknown base' };
    const f = item.flags || {};
    if (f.mirrored) return { blocked: 'Mirrored' };
    if (f.corrupted) return { blocked: 'Corrupted' };
    if (f.sanctified) return { blocked: 'Sanctified' };
    if (item.rarity === 'Unique') return { blocked: 'Unique' };
    const ctx = P.makeContext(ix, item, { weights: input.weights || null, essences: input.essences || [], catalystMult: input.catalystMult });
    const st0 = P.toState(ctx, item, input.locks);
    if (st0.rarity !== 'Normal' && st0.rarity !== 'Magic' && st0.rarity !== 'Rare') return { blocked: String(st0.rarity) };
    const gt = P.goalsFromTargets(ctx, input.targets);
    if (gt.unsupported.length) return { impossible: gt.unsupported.map((label) => ({ label, why: 'no essence, alloy or liquid emotion gives it on this item class' })) };
    let raw = gt.goals;
    if (raw.some((g) => g.required)) raw = raw.filter((g) => g.required);
    if (!raw.length) return { unsupported: 'no targets' };

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
        des: false, label: 'kept modifier', kept: true, ess: [], lich: null, minValue: null });
    }
    const G = goals.length;
    if (G > 8) return { unsupported: 'too many targets' };
    const jewel = ctx.cls === 'Jewel';
    const LIM = (() => { const l = E.slotLimits({ rarity: 'Rare', slotDelta: ctx.slotDelta }, ctx.cls); return [l.prefix, l.suffix]; })();

    // ---- a target by value: which rolls of a modifier reach it
    /** Chance that this modifier's rolled value reaches the goal's value; -1 when its range cannot. 1 for a goal by tier. */
    function reach(id, g) {
      if (g.minValue == null) return 1;
      const r = P.rangeOf(ctx, id);
      if (!r || r[1] < g.minValue) return -1;
      const lo = r[0], hi = r[1];
      if (hi <= lo) return 1;
      if (Number.isInteger(lo) && Number.isInteger(hi)) return Math.min(1, (hi - Math.max(lo, Math.ceil(g.minValue)) + 1) / (hi - lo + 1));
      return Math.min(1, (hi - Math.max(lo, g.minValue)) / (hi - lo));
    }
    const fits = (g, e) => (g.minValue != null ? reach(e.id, g) >= 0 : !g.tier || e.tier <= g.tier);

    // ---- the essence, alloy or liquid emotion that gives a goal's modifier: the cheapest priced one that meets it.
    // One that adds one of several modifiers (game table EssenceMods) hits with the share of the wanted one.
    for (const g of goals) {
      const list = [];
      for (const r of g.ess || []) {
        const pr = price(r.item);
        if (pr == null) continue;
        const pe = ctx.pool.get(r.mod);
        if (g.minValue != null ? reach(r.mod, g) < 0 : !(!g.tier || g.kind === 'ess' || (pe && pe.tier <= g.tier))) continue;
        const o = kb.essence_outcomes && kb.essence_outcomes[r.item];
        let pHit = 1;
        if (o) {
          const fit = o.mods.map((id, k) => ({ id, w: o.weights ? o.weights[k] : 1 })).filter((x) => ctx.essences.some((y) => y.item === r.item && y.mod === x.id));
          const tw = fit.reduce((x, y) => x + y.w, 0), mine = fit.find((x) => x.id === r.mod);
          if (fit.length > 1) pHit = mine && tw > 0 ? mine.w / tw : 0;
        }
        if (pHit > 0) list.push(Object.assign({}, r, { price: pr, pHit, pOK: Math.max(0, reach(r.mod, g)) }));
      }
      list.sort((a, b) => a.price / a.pHit - b.price / b.pHit);
      g.magicEss = list.find((r) => r.kind === 'magic') || null;
      g.rareEss = list.find((r) => r.kind === 'rare') || null;
    }

    // ---- what turns another element's modifier into a target: a Flux (resistances), a Rune of Aldur (the rest)
    const conv = new Array(G).fill(null);
    const goalFams = new Set(goals.map((g) => g.fam));
    for (let i = 0; i < G; i++) {
      const g = goals[i];
      if (g.kind !== 'nat' || g.kept || g.minValue != null) continue;
      const res = /^(Fire|Cold|Lightning)Resistance$/.exec(g.fam || '');
      if (res) {
        const to = res[1].toLowerCase(), name = P.FLUX[to], pr = name ? price(name) : null;
        if (pr == null) continue;
        const src = new Set();
        for (const [id, pe] of ctx.pool) {
          const r = P.resElement(id), m = kb.mods[id];
          if (!r || r.el === to || pe.side !== g.side || goalFams.has(m.fam) || m.lvl > ctx.ilvl) continue;
          const twin = (to.charAt(0).toUpperCase() + to.slice(1)) + 'Resist' + r.n, tp = ctx.pool.get(twin); // the same tier of the target's element
          if (tp && (!g.tier || tp.tier <= g.tier)) src.add(id);
        }
        if (src.size) conv[i] = { via: 'flux', to, item: name, price: pr, src };
      }
    }
    // Runes of Aldur: one rune an item, so the one that serves the most targets
    let ALD = null;
    {
      let best = null;
      for (const [rune, to] of Object.entries(P.ALDUR_ELEMENT)) {
        const pr = price(rune), cls = ((kb.augments[rune] || {}).by_class || {})[ctx.cls];
        if (pr == null || !cls) continue;
        const per = new Array(G).fill(null);
        let n = 0;
        for (let i = 0; i < G; i++) {
          const g = goals[i];
          if (g.kind !== 'nat' || g.kept || g.minValue != null || conv[i]) continue;
          const src = new Set();
          for (const [id, pe] of ctx.pool) {
            const m = kb.mods[id];
            if (pe.side !== g.side || m.fam === g.fam || goalFams.has(m.fam) || m.lvl > ctx.ilvl) continue;
            const twin = P.aldurTwin(ctx, id, to);
            if (!twin || twin === id || kb.mods[twin].fam !== g.fam) continue;
            const tp = ctx.pool.get(twin);
            if (tp && (!g.tier || tp.tier <= g.tier)) src.add(id);
          }
          if (src.size) { per[i] = src; n++; }
        }
        // a target the rune would itself turn into something else cannot stay next to it
        const harms = goals.map((g) => (ix.famMods.get(g.fam) || []).some((id) => { const t = ctx.pool.has(id) ? P.aldurTwin(ctx, id, to) : null; return !!t && t !== id; }));
        if (n && (!best || n > best.n)) best = { rune, to, price: pr, per, n, harms };
      }
      if (best) { ALD = best; for (let i = 0; i < G; i++) if (best.per[i]) conv[i] = { via: 'aldur', to: best.to, item: best.rune, price: best.price, src: best.per[i] }; }
    }

    // ---- runes that change what the item can hold or roll, and the sockets for them
    const AST = (() => { const n = P.runeFor(ctx, /additional Crafted Modifier/i); return n && ctx.craftedCap < 2 && price(n) != null && goals.filter((g) => g.magicEss || g.rareEss).length >= 2 ? { item: n, price: price(n) } : null; })();
    const SER = (() => { const n = P.runeFor(ctx, /Suffix Modifiers? allowed/i); return n && price(n) != null && goals.filter((g) => g.si === 1).length > LIM[1] ? { item: n, price: price(n) } : null; })();
    const pooled = goals.filter((g) => g.rune);
    if (new Set(pooled.map((g) => g.rune)).size > 1) return { impossible: pooled.map((g) => ({ label: g.label, why: 'needs its own rune, and an item takes one such rune' })) };
    const POOL = pooled.length ? { tag: pooled[0].rune, item: pooled[0].runeItem, price: price(pooled[0].runeItem) } : null;
    const hasPool = !!(POOL && (st0.tags || []).includes(POOL.tag));
    if (POOL && POOL.price == null && !hasPool) return { impossible: pooled.map((g) => ({ label: g.label, why: `needs the rune ${POOL.item}, which has no price` })) };
    // ---- liquid emotions (jewels): each adds its crafted modifier on a prefix or on a suffix. Potent Liquid Contempt
    // adds "+1 Suffix Modifier allowed" as a prefix or "+1 Prefix Modifier allowed" as a suffix: with it a side takes
    // a third modifier, which stays when the allowance is removed again (rules R_JEWEL_SLOTS, R_NO_SPACE; recipe c15).
    const EMO = [];
    const over = [0, 1].map((si) => goals.filter((g) => g.si === si).length > LIM[si]);
    if (jewel) {
      const by = new Map();
      for (const r of ctx.essences) if (r.liquid && kb.mods[r.mod]) { if (!by.has(r.item)) by.set(r.item, []); by.get(r.item).push(r.mod); }
      for (const [name, mods] of by) {
        const pr = price(name);
        if (pr == null) continue;
        const outs = mods.map((id) => {
          const m = kb.mods[id], cap = ctx.capMods.get(id);
          return { mod: id, si: m.gen === 'p' ? 0 : 1, cap: cap ? (cap.prefix ? 0 : 1) : -1, goal: goals.findIndex((g) => g.kind !== 'des' && g.fam === m.fam && g.si === (m.gen === 'p' ? 0 : 1)) };
        });
        if (outs.some((o) => o.goal >= 0 || (o.cap >= 0 && over[o.cap]))) EMO.push({ item: name, price: pr, outs });
      }
    }
    const allowance = [0, 1].map((si) => EMO.some((e) => e.outs.some((o) => o.cap === si)));
    if (over[0] && over[1]) return { impossible: goals.map((g) => ({ label: g.label, why: 'three targets on both sides: a jewel takes a third modifier on one side only' })) };
    for (let si = 0; si < 2; si++) {
      const n = goals.filter((g) => g.si === si).length, room = LIM[si] + (si === 1 && SER ? 1 : 0) + (allowance[si] ? 1 : 0);
      if (n > room) return { impossible: goals.filter((g) => g.si === si).map((g) => ({ label: g.label, why: `${n} ${SIDES[si]} targets, and the item holds ${room}` })) };
    }
    const RUNES = !!(AST || SER || POOL || ALD);
    const artificer = price("Artificer's Orb");
    const canAdd = RUNES && artificer != null && P.validate(ctx, st0, { op: 'artificer' }) === null ? Math.max(0, E.maxSockets(ctx.cls) - P.socketsOf(ctx, st0)) : 0;
    const FS0 = RUNES ? Math.max(0, Math.min(3, P.freeSockets(ctx, st0))) : 0, AD0 = Math.min(2, canAdd);
    const capOf = (S) => ctx.craftedCap + ((S.u & R_ASTRID) ? 1 : 0);

    // ---- pool numbers per side, minimum modifier level, catalyst boost and runes socketed
    const statCache = new Map();
    let CAT = null;
    /**
     * mult: how much Omen of Catalysing Exaltation raises the weight of the catalyst's type of modifier (1: no omen).
     * bits: the runes socketed that change the rolls (a pool rune adds its pool; a Rune of Aldur makes another
     * element's modifier arrive as the target).
     * -> { W, ok, low, nearW, twin, block }: per goal the weight that meets it, that lands under its value, that is in
     * its way, and that is its twin of another element.
     */
    function stats(si, floor, mult, bits) {
      mult = mult > 1 ? mult : 1;
      bits = (bits || 0) & (R_POOL | R_ALDUR);
      const key = si + '|' + floor + '|' + mult + '|' + bits;
      let s = statCache.get(key);
      if (s) return s;
      let pool = P.sidePool(ctx, SIDES[si], floor);
      if (POOL && (bits & R_POOL)) pool = pool.concat(P.runeSide(ctx, POOL.tag, SIDES[si], floor));
      let W = 0;
      const famW = new Map();
      const ok = new Float64Array(G), low = new Float64Array(G), nearW = new Float64Array(G), twin = new Float64Array(G);
      for (const e of pool) {
        const w = mult > 1 && (kb.mods[e.id].mt || []).includes(CAT.tag) ? e.w * mult : e.w;
        W += w;
        famW.set(e.fam, (famW.get(e.fam) || 0) + w);
        for (let i = 0; i < G; i++) {
          const g = goals[i];
          if (g.si !== si) continue;
          if (g.kind === 'nat' && e.fam === g.fam) {
            if (g.minValue != null) { const p = reach(e.id, g); if (p < 0) low[i] += w; else { ok[i] += w * p; nearW[i] += w * (1 - p); } }
            else if (!g.tier || e.tier <= g.tier) ok[i] += w; else low[i] += w;
          } else if (conv[i] && conv[i].src.has(e.id)) {
            if (conv[i].via === 'aldur' && (bits & R_ALDUR)) ok[i] += w; else twin[i] += w;
          } else if (g.grp.length && e.grp.some((x) => g.grp.includes(x))) low[i] += w; // of the target's group: it keeps the target out
        }
      }
      // what one modifier nobody asked for takes out of the pool on average: families are picked by their weight, and a
      // picked family leaves with all of it
      const mine = new Set(goals.filter((g) => g.kind === 'nat' && g.si === si).map((g) => g.fam));
      let J = 0, sq = 0;
      for (const [fam, w] of famW) if (!mine.has(fam)) { J += w; sq += w * w; }
      s = { W, ok, low, nearW, twin, block: J > 0 ? sq / J : 0 };
      statCache.set(key, s);
      return s;
    }
    // how often a Divine Orb leaves a value target at or over its value; the level a target's modifier has (for Omen
    // of Whittling); the levels of the other modifiers of a side
    const pv = new Float64Array(G).fill(1), goalLvl = new Float64Array(G);
    for (let i = 0; i < G; i++) {
      const g = goals[i];
      const list = g.kind === 'des' ? P.desPoolFor(ctx, g.side, 0, null).filter((e) => e.fam === g.fam)
        : g.kind === 'ess' ? [g.rareEss, g.magicEss].filter(Boolean).map((r) => ({ id: r.mod, w: 1, lvl: kb.mods[r.mod].lvl, tier: null }))
          : P.sidePool(ctx, g.side, 0).concat(g.rune && POOL ? P.runeSide(ctx, POOL.tag, g.side, 0) : []).filter((e) => e.fam === g.fam);
      let w = 0, wOk = 0, wl = 0;
      for (const e of list) { if (!fits(g, e)) continue; const p = g.minValue != null ? Math.max(0, reach(e.id, g)) : 1; w += e.w; wOk += e.w * p; wl += e.w * e.lvl; }
      pv[i] = w > 0 ? wOk / w : 1;
      goalLvl[i] = w > 0 ? wl / w : 1;
    }
    const lvls = [0, 1].map((si) => {
      const mine = new Set(goals.filter((g) => g.si === si).map((g) => g.fam));
      const list = P.sidePool(ctx, SIDES[si], 0).filter((e) => !mine.has(e.fam)).map((e) => [e.lvl, e.w]).sort((a, b) => a[0] - b[0]);
      return { list, total: list.reduce((x, e) => x + e[1], 0) };
    });
    /** Chance that an unknown modifier of side si has a level under `lvl`. */
    function under(si, lvl) {
      const L = lvls[si];
      if (!L.total) return 0;
      let w = 0;
      for (const e of L.list) { if (e[0] >= lvl) break; w += e[1]; }
      return w / L.total;
    }

    // A smaller network for a request with very many targets (see route): no Fracturing Orb, and an essence or the
    // Well of Souls as the source of a natural target only for the two hardest of them (lite 1) or for none (lite 2).
    const lite = input.lite | 0;
    if (lite) {
      const nat = [];
      for (let i = 0; i < G; i++) if (goals[i].kind === 'nat' && !goals[i].kept) { const st = stats(goals[i].si, 0, 1, R_POOL | R_ALDUR); nat.push([i, (st.ok[i] + st.nearW[i]) / (st.W || 1)]); }
      nat.sort((a, b) => a[1] - b[1]);
      const keep = new Set(nat.slice(0, lite === 1 ? 2 : 0).map((x) => x[0]));
      for (const [i] of nat) if (!keep.has(i)) { goals[i].magicEss = goals[i].rareEss = null; goals[i].noWell = true; }
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
        const share = goals.map((g, i) => { if (g.kind !== 'nat') return 0; const s = stats(g.si, floor, 1, R_POOL | R_ALDUR); return (s.ok[i] + s.nearW[i] + s.twin[i]) / (s.W || 1); });
        if (best && !share.some((x, i) => x > best[i] * 1.02)) continue;
        if (!best && t > 0 && !share.some((x) => x > 0)) continue;
        out.push({ tier: TIERS[t], name, price: pr, floor });
        best = best ? best.map((x, i) => Math.max(x, share[i])) : share;
      }
      return out;
    }
    const T = { transmute: orbTiers('transmute'), augment: orbTiers('augment'), regal: orbTiers('regal'), exalt: orbTiers('exalt'), chaos: orbTiers('chaos') };
    const PR = {
      annul: price('Orb of Annulment'), fracture: lite ? null : price('Fracturing Orb'), alchemy: price('Orb of Alchemy'), divine: price('Divine Orb'),
      exaltSide: [price(OMEN.exalt.prefix), price(OMEN.exalt.suffix)], erasure: [price(OMEN.erasure.prefix), price(OMEN.erasure.suffix)],
      annulSide: [price(OMEN.annul.prefix), price(OMEN.annul.suffix)], light: price(OMEN.light),
      necro: [price(OMEN.necro.prefix), price(OMEN.necro.suffix)], echoes: price(OMEN.echoes),
      crystal: [price(OMEN.crystal.prefix), price(OMEN.crystal.suffix)], whittling: price(OMEN.whittling), greaterExalt: price(OMEN.greaterExalt),
    };
    // bones: the cheapest one without a floor that the item level allows, and the Ancient one (floor 40) when priced
    const bones = [];
    if (ctx.bone) {
      const exists = (q) => !!(kb.item_descriptions || {})[`${q} ${ctx.bone}`];
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
    if (canCat && qMode !== 'lock' && price(OMEN.catalyse) != null) {
      const famTag = (fam, tag) => (ix.famMods.get(fam) || []).some((id) => (kb.mods[id].mt || []).includes(tag));
      const helps = (tag) => goals.filter((g) => g.kind === 'nat' && !g.kept && famTag(g.fam, tag));
      const nameOf = (tag) => (jewel ? 'Refined ' : '') + P.CATALYST_NAME[tag];
      const own = st0.catTag && st0.catQ > 0 ? st0.catTag : null;
      let tag = own && helps(own).length ? own : null;
      if (!tag && qMode === 'raise') {
        // the catalyst of the type that covers the hardest targets
        let best = 0;
        for (const t of Object.keys(P.CATALYST_NAME)) {
          if (price(nameOf(t)) == null) continue;
          const score = helps(t).reduce((x, g) => { const st = stats(g.si, 0), i = goals.indexOf(g); return x + (st.ok[i] > 0 ? st.W / st.ok[i] : 0); }, 0);
          if (score > best) { best = score; tag = t; }
        }
      }
      if (tag) CAT = { tag, name: nameOf(tag), price: qMode === 'raise' ? price(nameOf(tag)) : null, omen: price(OMEN.catalyse), q0: own === tag ? Math.min(20, st0.catQ) : 0, per: ctx.ilvl < 50 ? 2 : 1 };
    }
    const multOf = (q) => (!CAT || !q ? 1 : q === 2 ? ctx.catalystMult : 1 + (ctx.catalystMult - 1) * Math.min(1, CAT.q0 / 20));

    // ---- nodes
    const states = [], index = new Map(), acts = [];
    // a node's key as one number: the targets' statuses in base 9, then the small fields (it stays under 2^53)
    const keyOf = (S) => {
      let k = 0;
      for (let i = 0; i < G; i++) k = k * 9 + S.g[i];
      k = k * 3 + S.r; k = k * 4 + S.j[0]; k = k * 4 + S.j[1]; k = k * 10 + (S.fg + 1); k = k * 3 + S.fj; k = k * 3 + S.cx; k = k * 3 + S.dj; k = k * 3 + S.du;
      k = k * 3 + S.q; k = k * 16 + S.u; k = k * 4 + S.fs; k = k * 3 + S.ad; k = k * 3 + S.aw;
      return k;
    };
    const cp = (S) => ({ r: S.r, g: S.g.slice(), j: [S.j[0], S.j[1]], fg: S.fg, fj: S.fj, cx: S.cx, dj: S.dj, du: S.du, q: S.q, u: S.u, fs: S.fs, ad: S.ad, aw: S.aw });
    function idOf(S) {
      const k = keyOf(S);
      let i = index.get(k);
      if (i === undefined) { i = states.length; index.set(k, i); states.push(S); }
      return i;
    }
    const others = (S, si) => S.j[si] + (S.fj === si + 1 ? 1 : 0) + (S.cx === si + 1 ? 1 : 0) + (S.dj === si + 1 ? 1 : 0);
    // the allowance modifier: aw 1 "+1 Prefix Modifier allowed" (it is a suffix), aw 2 "+1 Suffix Modifier allowed" (a prefix)
    const awSide = (S) => (S.aw === 1 ? 1 : 0);
    function slots(S, si) {
      let n = others(S, si) + (S.du === si + 1 ? 1 : 0) + (S.aw && awSide(S) === si ? 1 : 0);
      for (let i = 0; i < G; i++) if (S.g[i] && goals[i].si === si) n++;
      return n;
    }
    const limOf = (S, si) => (S.r === 2 ? LIM[si] + (si === 1 && (S.u & R_SERLE) ? 1 : 0) + (S.aw === si + 1 ? 1 : 0) : S.r === 1 ? 1 : 0);
    const open = (S, si) => Math.max(0, limOf(S, si) - slots(S, si));
    const done = (S) => { for (let i = 0; i < G; i++) if (!met(S.g[i])) return false; return true; };
    const craftedUsed = (S) => { let n = (S.cx ? 1 : 0) + (S.aw ? 1 : 0); for (let i = 0; i < G; i++) if (kindOf(S.g[i]) === CRAFTED) n++; return n; };
    const desUsed = (S) => { let n = (S.dj ? 1 : 0) + (S.du ? 1 : 0); for (let i = 0; i < G; i++) if (kindOf(S.g[i]) === DESECRATED) n++; return n; };
    /** A target the item does not have yet (nothing of it, or only its twin of another element). */
    const wanted = (x) => x === ABSENT || x === TWIN;

    /** A random modifier for the open sides in `mask` (bit 0 prefix, bit 1 suffix): [[chance, goal index or -1, side, status]]. */
    function roll(S, mask, floor, mult) {
      const parts = [];
      let total = 0;
      for (let si = 0; si < 2; si++) {
        if (!(mask & (1 << si))) continue;
        const s = stats(si, floor, mult, S.u), s0 = floor || mult > 1 ? stats(si, 0, 1, S.u) : s;
        const n = others(S, si);
        // a target that is there, or has a modifier in its way, is out of the pool with its group (of a group with
        // several families, half is taken to be left)
        let present = 0;
        for (let i = 0; i < G; i++) {
          const x = S.g[i];
          if (!x || x === TWIN || goals[i].si !== si) continue;
          present += s.ok[i] + s.nearW[i] + (x === BLOCKED ? s.low[i] / 2 : s.low[i]);
        }
        const avail = Math.max(0, s.W - present - n * s.block);
        if (avail <= 0) continue;
        let hit = 0;
        const hits = [];
        const take = (w, i, status) => { w = Math.min(avail - hit, w); if (w > 0) { hits.push([w, i, si, status]); hit += w; } };
        for (let i = 0; i < G; i++) {
          const g = goals[i];
          if (!wanted(S.g[i]) || g.si !== si) continue;
          // a rolled modifier of the group of a Desecrated or crafted-only target is known as such (bones, essences and alloys are too dear to waste)
          if (g.kind !== 'nat') { take(s.low[i], i, BLOCKED); continue; }
          // an unknown modifier of this side is of the target's group with this chance, and then the target cannot roll
          const beta = n && s0.W > 0 ? Math.pow(1 - Math.min(1, s0.low[i] / s0.W), n) : 1;
          take(s.ok[i] * beta, i, NATURAL);
          take(s.nearW[i] * beta, i, NATURAL + NEAR);
          if (S.g[i] === ABSENT) take(s.twin[i], i, TWIN);
        }
        parts.push(...hits, [avail - hit, -1, si, 0]);
        total += avail;
      }
      return total > 0 ? parts.filter((x) => x[0] > 0).map(([w, i, si, status]) => [w / total, i, si, status]) : [];
    }
    function addRolled(S, i, si, status) {
      const n = cp(S);
      if (i < 0) n.j[si]++;
      else {
        if (n.g[i] === TWIN && status !== TWIN) n.j[goals[i].si]++; // the twin stays on the item as another modifier
        n.g[i] = status || NATURAL;
      }
      return n;
    }
    /** The modifiers a removal can take: [{w, k, i, si}] (w: how many of them). pred(side, desecrated). */
    function units(S, pred) {
      const out = [];
      for (let i = 0; i < G; i++) if (S.g[i] && S.fg !== i && pred(goals[i].si, kindOf(S.g[i]) === DESECRATED)) out.push({ w: 1, k: 'g', i, si: goals[i].si });
      for (let si = 0; si < 2; si++) if (S.j[si] && pred(si, false)) out.push({ w: S.j[si], k: 'j', si });
      if (S.cx && pred(S.cx - 1, false)) out.push({ w: 1, k: 'cx', si: S.cx - 1 });
      if (S.dj && pred(S.dj - 1, true)) out.push({ w: 1, k: 'dj', si: S.dj - 1 });
      if (S.du && pred(S.du - 1, true)) out.push({ w: 1, k: 'du', si: S.du - 1 });
      if (S.aw && pred(awSide(S), false)) out.push({ w: 1, k: 'aw', si: awSide(S) });
      return out;
    }
    function removeUnit(S, u) {
      const n = cp(S);
      if (u.k === 'g') n.g[u.i] = ABSENT; else if (u.k === 'j') n.j[u.si]--; else n[u.k] = 0;
      return n;
    }
    const openMask = (S) => (open(S, 0) > 0 ? 1 : 0) | (open(S, 1) > 0 ? 2 : 0);
    /**
     * Chance that none of the unknown modifiers of the target's side is of its group (a crafted modifier is refused
     * then). 1 for a crafted-only target: its blockers are known as a state.
     */
    function clear(S, i) {
      const g = goals[i];
      if (g.kind !== 'nat') return 1;
      const s0 = stats(g.si, 0, 1, S.u), n = others(S, g.si);
      return n && s0.W > 0 ? Math.pow(1 - Math.min(1, s0.low[i] / s0.W), n) : 1;
    }
    /**
     * Omen of Whittling: the Chaos Orb removes the modifier of the lowest level. [[chance, unit]]: the targets' levels
     * are known, the others' are drawn from the pool. null with a hidden modifier (its level is not known).
     */
    function whittled(S) {
      if (S.du) return null;
      const known = [], unk = [];
      for (let i = 0; i < G; i++) {
        const x = S.g[i];
        if (!x || S.fg === i) continue;
        if (x === BLOCKED) unk.push({ k: 'g', i, si: goals[i].si, w: 1 }); else known.push({ k: 'g', i, si: goals[i].si, w: 1, lvl: goalLvl[i] });
      }
      for (let si = 0; si < 2; si++) if (S.j[si]) unk.push({ k: 'j', si, w: S.j[si] });
      if (S.cx) unk.push({ k: 'cx', si: S.cx - 1, w: 1 });
      if (S.dj) unk.push({ k: 'dj', si: S.dj - 1, w: 1 });
      if (S.aw) unk.push({ k: 'aw', si: awSide(S), w: 1 });
      if (!known.length && !unk.length) return null;
      const lmin = known.length ? Math.min(...known.map((u) => u.lvl)) : Infinity;
      const below = (si) => (lmin === Infinity ? 1 : under(si, lmin));
      let none = 1;
      for (const u of unk) none *= Math.pow(1 - below(u.si), u.w);
      const out = [];
      if (known.length && none > 0) { const low = known.filter((u) => u.lvl <= lmin + 1e-9); for (const u of low) out.push([none / low.length, u]); }
      if (unk.length && none < 1) {
        const ws = unk.map((u) => u.w * below(u.si)), tw = ws.reduce((x, y) => x + y, 0);
        unk.forEach((u, k) => { if (ws[k] > 0) out.push([(1 - none) * ws[k] / tw, u]); });
      }
      return out.length ? out : null;
    }

    // ---- the Well of Souls: what the three options offer, and which one the player takes
    const desCache = new Map();
    function desList(si, floor, lich) {
      const k = si + '|' + floor + '|' + (lich || '');
      if (!desCache.has(k)) desCache.set(k, P.desPoolFor(ctx, SIDES[si], floor, lich || null));
      return desCache.get(k);
    }
    /** [[chance, goal index or -1, status]] for a desecrated modifier revealed on side si of S (S without the hidden modifier). */
    function reveal(S, si, floor, lich, echoes) {
      const ex = desList(si, floor, null), ll = lich ? desList(si, floor, lich) : null;
      const s = stats(si, floor, 1, S.u & R_ALDUR), s0 = floor ? stats(si, 0, 1, S.u & R_ALDUR) : s; // (the Well of Souls does not offer a rune's pool: open test t33)
      const n = others(S, si);
      let present = 0;
      for (let i = 0; i < G; i++) { const x = S.g[i]; if (x && x !== TWIN && goals[i].si === si) present += s.ok[i] + s.nearW[i] + (x === BLOCKED ? s.low[i] / 2 : s.low[i]); }
      const avail = Math.max(1e-9, s.W - present - n * s.block);
      const want = [];
      for (let i = 0; i < G; i++) {
        const g = goals[i];
        if (!wanted(S.g[i]) || g.si !== si || g.rune) continue;
        if (g.kind === 'des') {
          const hit = (e) => e.fam === g.fam && fits(g, e);
          const c = ex.filter(hit).length, cl = ll ? ll.filter(hit).length : 0;
          if (c || cl) want.push({ i, des: true, c, cl, share: pv[i] });
        } else if (g.kind === 'nat' && !g.noWell && s.ok[i] + s.nearW[i] > 0) {
          const beta = n && s0.W > 0 ? Math.pow(1 - Math.min(1, s0.low[i] / s0.W), n) : 1;
          want.push({ i, des: false, w: Math.min(avail, (s.ok[i] + s.nearW[i]) * beta), share: s.ok[i] / (s.ok[i] + s.nearW[i]) });
        }
      }
      if (!want.length) return [[1, -1, 0]];
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
      for (const wnt of want) {
        const p = pick[wnt.i] * again;
        if (!(p > 0)) continue;
        // a target by value arrives at or under its value
        if (wnt.share > 0) out.push([p * wnt.share, wnt.i, DESECRATED]);
        if (wnt.share < 1) out.push([p * (1 - wnt.share), wnt.i, DESECRATED + NEAR]);
      }
      out.push([echoes ? missAll * missAll : missAll, -1, 0]);
      return out;
    }
    const revealed = (S1, si, i, status) => { const S2 = addRolled(S1, i, si, status); if (i < 0) { S2.j[si]--; S2.dj = si + 1; } return S2; };

    // ---- edges
    const N0 = { r: 0, g: new Array(G).fill(ABSENT), j: [0, 0], fg: -1, fj: 0, cx: 0, dj: 0, du: 0, q: 0, u: 0, fs: FS0, ad: AD0, aw: 0 };
    const RESTART = -1; // edge target: a fresh white base (its value is solved as one number, see solve)
    /** A socket for a rune: the node with one socket less and what it costs first (an Artificer's Orb), or null. */
    function socket(S) {
      if (S.fs > 0) { const n = cp(S); n.fs--; return { S: n, cost: 0, pre: null }; }
      if (S.ad > 0) { const n = cp(S); n.ad--; return { S: n, cost: artificer, pre: { op: 'artificer' } }; }
      return null;
    }
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
      const rolled = (S1, mask, floor, pre, mult) => roll(S1, mask, floor, mult).map(([p, i, si, status]) => [p * (pre == null ? 1 : pre), addRolled(S1, i, si, status)]);
      /** Several random modifiers one after the other (Orb of Alchemy, Omen of Greater Exaltation): [[chance, state]]. */
      const rolledN = (S1, count, maskOf, floor) => {
        let dist = new Map([[keyOf(S1), [1, S1]]]);
        for (let k = 0; k < count; k++) {
          const next = new Map();
          const put = (p, S2) => { const key = keyOf(S2), old = next.get(key); if (old) old[0] += p; else next.set(key, [p, S2]); };
          for (const [p, Sa] of dist.values()) {
            const outs = roll(Sa, maskOf(Sa), floor);
            if (!outs.length) { put(p, Sa); continue; }
            for (const [q, i, si, status] of outs) put(p * q, addRolled(Sa, i, si, status));
          }
          dist = next;
        }
        return [...dist.values()];
      };

      if (S.r === 0) {
        for (const t of T.transmute) { const S1 = cp(S); S1.r = 1; push({ op: 'transmute', tier: t.tier }, t.price, rolled(S1, 3, t.floor)); }
        if (PR.alchemy != null) { const R0 = cp(S); R0.r = 2; push({ op: 'alchemy' }, PR.alchemy, rolledN(R0, 4, openMask, 0)); } // Rare with four modifiers
        return;
      }
      if (keyOf(S) !== keyOf(N0)) push({ op: 'newbase' }, baseCost, [[1, RESTART]]);
      // a value under the wanted one: a Divine Orb rolls every value again (not a fractured modifier's)
      if (PR.divine != null) {
        const vs = [];
        for (let i = 0; i < G; i++) if (goals[i].minValue != null && (met(S.g[i]) || near(S.g[i])) && S.fg !== i) vs.push(i);
        if (vs.some((i) => near(S.g[i]))) {
          const outs = [];
          for (let m = 0; m < (1 << vs.length); m++) {
            let p = 1;
            const S2 = cp(S);
            vs.forEach((i, k) => { const good = !!(m & (1 << k)); p *= good ? pv[i] : 1 - pv[i]; S2.g[i] = kindOf(S.g[i]) + (good ? 0 : NEAR); });
            outs.push([p, S2]);
          }
          push({ op: 'divine' }, PR.divine, outs);
        }
      }
      if (S.r === 1) {
        const mask = openMask(S);
        if (mask) for (const t of T.augment) push({ op: 'augment', tier: t.tier }, t.price, rolled(S, mask, t.floor));
        for (const t of T.regal) { const S1 = cp(S); S1.r = 2; push({ op: 'regal', tier: t.tier }, t.price, rolled(S1, openMask(S1), t.floor)); }
        if (craftedUsed(S) < capOf(S)) for (let i = 0; i < G; i++) {
          const g = goals[i], r = g.magicEss;
          if (!wanted(S.g[i]) || !r) continue;
          const S1 = cp(S); S1.r = 2;
          if (open(S1, g.si) > 0 || S.g[i] === TWIN) {
            const outs = [], free = clear(S1, i);
            if (free < 1) outs.push([1 - free, S1]);
            if (r.pOK > 0) outs.push([free * r.pHit * r.pOK, addRolled(S1, i, g.si, CRAFTED)]);
            if (r.pOK < 1) outs.push([free * r.pHit * (1 - r.pOK), addRolled(S1, i, g.si, CRAFTED + NEAR)]);
            if (r.pHit < 1) { const S2 = cp(S1); if (!S2.cx) S2.cx = g.si + 1; else S2.j[g.si]++; outs.push([free * (1 - r.pHit), S2]); }
            push({ op: 'essence', item: r.item, mod: r.mod }, r.price, outs);
          }
        }
        if (PR.annul != null) {
          const us = units(S, () => true), tw = us.reduce((x, u) => x + u.w, 0);
          if (tw) push({ op: 'annul' }, PR.annul, us.map((u) => [u.w / tw, removeUnit(S, u)]));
        }
        return;
      }
      // ---- Rare
      const mask = openMask(S);
      if (mask) for (const t of T.exalt) {
        push({ op: 'exalt', tier: t.tier }, t.price, rolled(S, mask, t.floor));
        if (mask === 3) for (let si = 0; si < 2; si++) if (PR.exaltSide[si] != null) push({ op: 'exalt', tier: t.tier, side: SIDES[si] }, t.price + PR.exaltSide[si], rolled(S, 1 << si, t.floor));
        // Omen of Greater Exaltation: two modifiers from one orb (with a side omen, both on that side)
        if (PR.greaterExalt != null && open(S, 0) + open(S, 1) >= 2) {
          push({ op: 'exalt', tier: t.tier, greater: true }, t.price + PR.greaterExalt, rolledN(S, 2, openMask, t.floor));
          for (let si = 0; si < 2; si++) if (PR.exaltSide[si] != null && open(S, si) >= 2 && open(S, 1 - si) > 0) push({ op: 'exalt', tier: t.tier, side: SIDES[si], greater: true }, t.price + PR.greaterExalt + PR.exaltSide[si], rolledN(S, 2, () => 1 << si, t.floor));
        }
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
          const us = units(S, (si) => v < 0 || si === v).filter((u) => openMask(removeUnit(S, u)) !== 0), tw = us.reduce((x, u) => x + u.w, 0);
          if (!tw) continue;
          const outs = [];
          for (const u of us) { const S1 = removeUnit(S, u); outs.push(...rolled(S1, openMask(S1), t.floor, u.w / tw)); }
          push(v < 0 ? { op: 'chaos', tier: t.tier } : { op: 'chaos', tier: t.tier, side: SIDES[v] }, t.price + (v < 0 ? 0 : PR.erasure[v]), outs);
        }
        if (PR.whittling != null) {
          const ws = whittled(S);
          if (ws) {
            const outs = [];
            for (const [p, u] of ws) { const S1 = removeUnit(S, u); outs.push(...rolled(S1, openMask(S1), t.floor, p)); }
            push({ op: 'chaos', tier: t.tier, whittle: true }, t.price + PR.whittling, outs);
          }
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
      if (craftedUsed(S) < capOf(S)) for (let i = 0; i < G; i++) {
        const g = goals[i], r = g.rareEss;
        if (!wanted(S.g[i]) || !r || r.liquid) continue;
        // Crystallisation omens aim Perfect and Corrupted Essences only: not alloys (game text; the player, 8 Oct 2026), not liquid emotions
        const aim = r.alloy ? [-1] : [-1, 0, 1];
        for (const v of aim) {
          if (v >= 0 && PR.crystal[v] == null) continue;
          const from = v >= 0 ? v : open(S, g.si) === 0 ? g.si : -1; // R_SWAP_REMOVAL
          const us = units(S, (si) => from < 0 || si === from), tw = us.reduce((x, u) => x + u.w, 0);
          const outs = [];
          const give = (S1, p) => {
            if (!wanted(S1.g[i]) || !(open(S1, g.si) > 0 || S1.g[i] === TWIN)) { outs.push([p, S1]); return; }
            const free = clear(S1, i);
            if (free < 1) outs.push([p * (1 - free), S1]);
            p *= free;
            if (r.pOK > 0) outs.push([p * r.pHit * r.pOK, addRolled(S1, i, g.si, CRAFTED)]);
            if (r.pOK < 1) outs.push([p * r.pHit * (1 - r.pOK), addRolled(S1, i, g.si, CRAFTED + NEAR)]);
            if (r.pHit < 1) { const S2 = cp(S1); if (!S2.cx) S2.cx = g.si + 1; else S2.j[g.si]++; outs.push([p * (1 - r.pHit), S2]); }
          };
          if (tw) for (const u of us) give(removeUnit(S, u), u.w / tw); else if (v < 0) give(S, 1);
          push(Object.assign({ op: 'pessence', item: r.item, mod: r.mod }, v >= 0 ? { side: SIDES[v] } : null), r.price + (v >= 0 ? PR.crystal[v] : 0), outs);
        }
      }
      // a liquid emotion: a modifier goes, and its crafted modifier comes on the side that opened (one of two for some)
      if (craftedUsed(S) < capOf(S)) for (const em of EMO) {
        if (!em.outs.some((o) => (o.goal >= 0 && wanted(S.g[o.goal])) || (o.cap >= 0 && over[o.cap] && !S.aw))) continue;
        const sides = [...new Set(em.outs.map((o) => o.si))];
        const from = sides.some((si) => open(S, si) > 0) ? -1 : sides.length === 1 ? sides[0] : -1; // R_SWAP_REMOVAL
        const fitAt = (S1) => em.outs.filter((o) => open(S1, o.si) > 0 && (o.goal < 0 || wanted(S1.g[o.goal])));
        const us = units(S, (si) => from < 0 || si === from).filter((u) => fitAt(removeUnit(S, u)).length), tw = us.reduce((x, u) => x + u.w, 0);
        if (!tw) continue;
        const outs = [];
        for (const u of us) {
          const S1 = removeUnit(S, u), fit = fitAt(S1);
          for (const o of fit) {
            let S2;
            if (o.goal >= 0) S2 = addRolled(S1, o.goal, o.si, CRAFTED);
            else { S2 = cp(S1); if (o.cap >= 0) S2.aw = o.cap + 1; else if (!S2.cx) S2.cx = o.si + 1; else S2.j[o.si]++; }
            outs.push([u.w / tw / fit.length, S2]);
          }
        }
        push({ op: 'liquid', item: em.item }, em.price, outs);
      }
      // another element's modifier becomes the target: a Flux for resistances, a Rune of Aldur for the rest
      const fluxes = new Map();
      for (let i = 0; i < G; i++) if (S.g[i] === TWIN && conv[i] && conv[i].via === 'flux' && S.fg !== i) { if (!fluxes.has(conv[i].to)) fluxes.set(conv[i].to, []); fluxes.get(conv[i].to).push(i); }
      for (const [to, is] of fluxes) {
        // it turns every resistance of the other elements: a finished resistance target of another element would go with it
        let harm = false;
        for (let k = 0; k < G; k++) { const m = /^(Fire|Cold|Lightning)Resistance$/.exec(goals[k].fam || ''); if (m && m[1].toLowerCase() !== to && (met(S.g[k]) || near(S.g[k]))) harm = true; }
        if (harm) continue;
        const S1 = cp(S);
        for (const i of is) S1.g[i] = NATURAL;
        push({ op: 'flux', to }, conv[is[0]].price, [[1, S1]]);
      }
      if (ALD && !(S.u & R_ALDUR)) {
        const is = [];
        for (let i = 0; i < G; i++) if (S.g[i] === TWIN && conv[i] && conv[i].via === 'aldur' && S.fg !== i) is.push(i);
        let harm = false;
        for (let k = 0; k < G; k++) if (ALD.harms[k] && (met(S.g[k]) || near(S.g[k])) && !is.includes(k)) harm = true;
        const sk = is.length && !harm ? socket(S) : null;
        if (sk) {
          const S1 = sk.S;
          S1.u |= R_ALDUR;
          for (const i of is) S1.g[i] = NATURAL;
          push(Object.assign({ op: 'aldur', item: ALD.rune }, sk.pre ? { pre: sk.pre } : null), ALD.price + sk.cost, [[1, S1]]);
        }
      }
      // runes that open a slot or a pool
      for (const [R, bit] of [[AST, R_ASTRID], [SER, R_SERLE], [POOL, R_POOL]]) {
        if (!R || (S.u & bit) || R.price == null) continue;
        const sk = socket(S);
        if (!sk) continue;
        sk.S.u |= bit;
        push(Object.assign({ op: 'rune_rule', item: R.item }, sk.pre ? { pre: sk.pre } : null), R.price + sk.cost, [[1, sk.S]]);
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
            // only from a side the removal opens (one over its limit stays full)
            const us = units(S, (si) => (v < 0 || si === v) && slots(S, si) <= limOf(S, si)), tw = us.reduce((x, u) => x + u.w, 0);
            for (const u of us) land.push([u.w / tw, u.si, removeUnit(S, u)]);
          }
          if (!land.length) continue;
          const base = b.price + (v >= 0 ? PR.necro[v] : 0);
          const act = (extra) => Object.assign({ op: 'bone', quality: b.quality }, v >= 0 ? { side: SIDES[v] } : null, extra);
          // left hidden: it counts as a modifier and cannot be fractured, the reveal comes later
          // (a hair dearer than revealing at once, so it is chosen only where the hidden modifier earns something)
          if (b === bones[0] && PR.fracture != null && S.fg < 0 && !S.fj) push(act({ hide: true }), base + 1e-6, land.map(([p, si, S1]) => { const S2 = cp(S1); S2.du = si + 1; return [p, S2]; }));
          const liches = [null];
          for (let i = 0; i < G; i++) { const g = goals[i]; if (wanted(S.g[i]) && g.kind === 'des' && g.lich && price(OMEN.lich[g.lich]) != null && !liches.includes(g.lich)) liches.push(g.lich); }
          for (const lich of liches) for (const echoes of [false, true]) {
            if (echoes && PR.echoes == null) continue;
            const outs = [];
            let useful = false;
            for (const [p, si, S1] of land) for (const [q, i, status] of reveal(S1, si, b.floor, lich, echoes)) {
              if (i >= 0) useful = true;
              outs.push([p * q, revealed(S1, si, i, status)]);
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
          push({ op: 'reveal', echoes }, echoes ? PR.echoes : 0, reveal(S1, si, 0, null, echoes).map(([q, i, status]) => [q, revealed(S1, si, i, status)]));
        }
      }
      // Fracturing Orb: one of the modifiers that are not desecrated, each as likely; it needs four modifiers in all
      if (PR.fracture != null && S.fg < 0 && !S.fj && slots(S, 0) + slots(S, 1) >= 4) {
        const outs = [];
        let n = 0;
        for (let i = 0; i < G; i++) if (S.g[i] && kindOf(S.g[i]) !== DESECRATED) { const S2 = cp(S); S2.fg = i; outs.push([1, S2]); n++; }
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
      if (RUNES) {
        S.u = (AST && st.xCrafted ? R_ASTRID : 0) | (SER && st.xSuffix ? R_SERLE : 0) | (POOL && (st.tags || []).includes(POOL.tag) ? R_POOL : 0) | (ALD && st.aldur ? R_ALDUR : 0);
        S.fs = Math.max(0, Math.min(3, P.freeSockets(ctx, st)));
        S.ad = Math.max(0, Math.min(2, canAdd - (st.sockets || 0)));
      }
      for (const m of st.mods) {
        const si = m.side === 'prefix' ? 0 : 1;
        const free = (k) => wanted(S.g[k]) && goals[k].si === si;
        const kind = m.des ? DESECRATED : m.crafted ? CRAFTED : NATURAL;
        const i = m.unrevealed ? -1 : goals.findIndex((g, k) => free(k) && P.meets(m, g, g.tier));
        const v = i >= 0 || m.unrevealed ? -1 : goals.findIndex((g, k) => free(k) && P.nearMiss(m, g));
        const t = i >= 0 || v >= 0 || m.unrevealed || m.des || m.crafted ? -1 : goals.findIndex((g, k) => S.g[k] === ABSENT && goals[k].si === si && conv[k] && conv[k].src.has(m.id) && !(conv[k].via === 'aldur' && st.aldur));
        // not the target, but of its group (a lower tier, a sister modifier): it stands in the target's way
        const b = i >= 0 || v >= 0 || t >= 0 || m.unrevealed || m.des || m.crafted ? -1 : goals.findIndex((g, k) => S.g[k] === ABSENT && goals[k].si === si && (g.kind !== 'nat' || known) && (m.fam === g.fam || (g.grp.length && (m.grp || []).some((x) => g.grp.includes(x)))));
        const set = (k, x) => { if (S.g[k] === TWIN) S.j[si]++; S.g[k] = x; if (m.frac) S.fg = k; };
        if (i >= 0) set(i, kind);
        else if (v >= 0) set(v, kind + NEAR);
        else if (t >= 0) set(t, TWIN);
        else if (b >= 0) set(b, BLOCKED);
        else if (m.id && ctx.capMods.get(m.id) && !m.frac) S.aw = ctx.capMods.get(m.id).prefix ? 1 : 2;
        else if (m.frac) S.fj = si + 1;
        else if (m.unrevealed) S.du = si + 1;
        else if (m.des) S.dj = si + 1;
        else if (m.crafted && !S.cx) S.cx = si + 1;
        else S.j[si]++;
      }
      return S;
    }
    const startS = nodeOf(st0, true);
    // entry points a player can buy instead of rolling: a Magic base that has one target, a Rare with one target
    // fractured and nothing else. Solved with the rest so their worth can be told.
    const entries = [];
    for (let i = 0; i < G; i++) {
      if (goals[i].kind !== 'nat' || goals[i].kept || goals[i].rune) continue;
      const M = cp(N0); M.r = 1; M.g[i] = NATURAL;
      const F = cp(N0); F.r = 2; F.g[i] = NATURAL; F.fg = i;
      entries.push({ kind: 'magic', goal: i, S: M }, { kind: 'fractured', goal: i, S: F });
    }
    const timing = { expand: 0, solve: 0 };
    let tick = Date.now();
    const start = idOf(startS), n0 = idOf(cp(N0));
    for (const e of entries) e.id = idOf(e.S);
    for (let q = 0; q < states.length; q++) {
      if (states.length > (input.maxStates || MAX_STATES)) return { unsupported: 'too many item states', states: states.length };
      expand(q);
    }
    const N = states.length;
    timing.expand = Date.now() - tick; tick = Date.now();

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
    let maxBlock = 0;
    for (const b of blocks) if (b.length > maxBlock) maxBlock = b.length;
    /** maxPasses, tol: a rough answer is enough while the rule set still changes a lot (see solve). */
    function evaluate(rhs, maxPasses, tol) {
      const K = rhs.length;
      maxPasses = maxPasses || 600; tol = tol || 1e-11;
      const X = rhs.map((r) => { if (r.x0) return Float64Array.from(r.x0); const a = new Float64Array(N); if (r.term) for (let s = 0; s < N; s++) if (pol[s] === -1) a[s] = r.term; return a; });
      // the rule set's edges that leave their block, as flat rows (what stays inside a block is in its factors)
      const row = new Int32Array(N + 1);
      let nnz = 0;
      for (let s = 0; s < N; s++) { row[s] = nnz; if (pol[s] >= 0) nnz += acts[s][pol[s]].out.length >> 1; }
      row[N] = nnz;
      const col = new Int32Array(nnz), val = new Float64Array(nnz), back = new Float64Array(N);
      nnz = 0;
      for (let s = 0; s < N; s++) {
        row[s] = nnz;
        if (pol[s] < 0) continue;
        const o = acts[s][pol[s]].out, bi = blockOf[s];
        for (let t = 0; t < o.length; t += 2) {
          const s2 = o[t + 1];
          if (s2 === RESTART) back[s] += GAMMA * o[t];
          else if (blockOf[s2] !== bi) { col[nnz] = s2; val[nnz++] = GAMMA * o[t]; }
        }
      }
      row[N] = nnz;
      const R = new Float64Array(maxBlock * K), Y = new Float64Array(maxBlock * K);
      // a block is solved again only while something it reads has changed
      const dirty = new Uint8Array(blocks.length).fill(1);
      let left = blocks.length;
      for (let pass = 0; pass < maxPasses && left > 0; pass++) {
        for (let bi = 0; bi < blocks.length; bi++) {
          if (!dirty[bi]) continue;
          dirty[bi] = 0; left--;
          const b = blocks[bi], m = b.length;
          for (let k = 0; k < K; k++) {
            const r = rhs[k], d = r.d, Xk = X[k], bnd = r.bnd || 0, term = r.term || 0, stuck = r.stuck || 0;
            for (let li = 0; li < m; li++) {
              const s = b[li];
              if (pol[s] < 0) { R[li * K + k] = pol[s] === -1 ? term : stuck; continue; }
              let v = (d ? d[s] : 0) + back[s] * bnd;
              for (let t = row[s], e = row[s + 1]; t < e; t++) v += val[t] * Xk[col[t]];
              R[li * K + k] = v;
            }
          }
          const f = luOf(bi);
          luSolve(f.A, f.perm, R, m, K, Y);
          let delta = 0;
          for (let k = 0; k < K; k++) {
            const Xk = X[k];
            for (let li = 0; li < m; li++) {
              const v = R[li * K + k], old = Xk[b[li]], ch = Math.abs(v - old);
              if (ch > 1e-300) { const dv = ch / (Math.abs(v) + 1e-300); if (dv > delta) delta = dv; }
              Xk[b[li]] = v;
            }
          }
          if (delta > tol) { const rl = readerList[bi]; for (let i = 0; i < rl.length; i++) if (!dirty[rl[i]]) { dirty[rl[i]] = 1; left++; } }
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
        // a modifier can still come for a target: one of the natural ones is missing on a side with room
        let rollable = false;
        for (let i = 0; i < G; i++) if (wanted(S.g[i]) && goals[i].kind === 'nat' && open(S, goals[i].si) > 0) rollable = true;
        if (S.du) a = find((e) => e.op === 'reveal');
        if (a < 0) a = find((e) => e.op === 'flux' || e.op === 'aldur');
        if (a < 0) a = find((e) => e.op === 'rune_rule');
        if (a < 0 && rollable) a = find((e) => e.op === 'exalt' && !e.side && !e.greater && !e.catalyse);
        if (a < 0) a = find((e) => e.op === 'divine');
        if (a < 0) a = find((e) => e.op === 'pessence' && !e.side);
        if (a < 0) a = find((e) => e.op === 'bone' && !e.hide);
      }
      if (a < 0) a = find((e) => e.op === 'newbase');
      pol[s] = a < 0 ? 0 : a;
    }
    let Fv = new Float64Array(N), Av = null, rounds = 0, sol = null;
    // the search for the base charge holds a white base's value still while it probes (see fitBases)
    let holdX = false;
    /** Improve the rule set until no node has a cheaper edge (it starts from the rule set of the last solve). */
    function solve(exact) {
      // exact === false: a probe of the search for the base charge. It only has to tell on which side of the limit the
      // charge lands, so it stops when the roughly valued rule set has all but settled.
      // While many nodes still change their edge, the rule set is valued roughly (a few passes over the blocks) and
      // improved again; the exact values come once it has settled, and it must stand unchanged against those.
      let rough = true, last = N;
      for (let it = 0; it < 400; it++, rounds++) {
        const d = new Float64Array(N);
        for (let s = 0; s < N; s++) if (pol[s] >= 0) d[s] = costOf(acts[s][pol[s]]);
        const passes = !rough ? 600 : last > N / 20 ? 3 : last > N / 300 ? 8 : 24;
        const [A, F] = evaluate([{ d, bnd: 0, stuck: BIG, x0: Av }, { bnd: 0, term: 1, x0: Av ? Fv : null }], passes, rough ? 1e-7 : 1e-11);
        if (!holdX) x = F[n0] > 1e-250 ? A[n0] / F[n0] : BIG;
        for (let s = 0; s < N; s++) V[s] = Math.min(BIG, A[s] + (1 - F[s]) * x);
        Fv = F; Av = A;
        let changed = 0;
        for (let s = 0; s < N; s++) {
          const list = acts[s];
          if (list.length < 2) continue;
          let best = pol[s], bq = qOf(s, list[pol[s]]);
          // against rough values an edge must be clearly cheaper to be taken (else the rule set flutters)
          const slack = (rough ? 1e-6 : 1e-9) * (1 + Math.abs(bq));
          for (let a = 0; a < list.length; a++) { if (a === pol[s]) continue; const v = qOf(s, list[a]); if (v < bq - slack) { bq = v; best = a; } }
          if (best !== pol[s]) { pol[s] = best; changed++; }
        }
        last = changed;
        if (exact === false && changed <= N / 2000) break;
        if (!changed) { if (!rough) break; rough = false; }
      }
      sol = null;
    }
    solve();
    timing.solve = Date.now() - tick;

    // ---- what the rule set uses: every currency's expected count, and how far the cost spreads
    const actNames = (a) => (a.op === 'reveal' ? (a.echoes ? [OMEN.echoes] : []) : (a.pre ? P.actionNames(a.pre, ctx) : []).concat(P.actionNames(a, ctx)));
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
    /**
     * New bases from node s on average. An item ends finished or given up for a new base, so the item in hand is given
     * up with chance 1 - F(s), and every white base after it with chance 1 - F(N0): (1 - F(s)) / F(N0) bases in all.
     */
    const basesAt = (s) => (Fv[n0] > 1e-250 ? (1 - Fv[s]) / Fv[n0] : Infinity);

    const net = {
      ctx, goals, states, acts, pol, start, n0, N, timing, lite, catalyst: CAT ? { tag: CAT.tag, name: CAT.name } : null,
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
        if (!(max >= 0) || free <= max || !(x < BIG)) return 0;
        // For the rule set a charge on bases and a white base's own value come to one number: what giving the item up
        // costs (z = base price + charge + the value of a white base). The search moves z with the base's value held
        // still, so a probe has nothing to settle but the rule set; the probes are valued roughly.
        const z0 = baseCost + x;
        holdX = true;
        let on = 0;
        const probe = (z) => { charge = z - z0; on = z; solve(false); return basesAt(s); };
        let lo = z0, hi = z0 * Math.min(3, Math.max(1.3, Math.sqrt(free / Math.max(0.5, max)))), at = Infinity;
        for (let k = 0; k < 40; k++) { at = probe(hi); if (at <= max) break; lo = hi; hi *= 1.6; }
        // back down while the route is far under the limit (a cheaper one may still keep to it); a very large
        // network gets fewer of these steps
        for (let k = 0, steps = N > 25000 ? 3 : 8; k < steps && at < 0.75 * max && hi / lo > 1.02; k++) {
          const mid = Math.sqrt(lo * hi), b = probe(mid);
          if (b <= max) { hi = mid; at = b; } else lo = mid;
        }
        if (on !== hi) probe(hi);
        // the charge that puts giving up at this price when a white base has its own value again, and the exact route
        const F0 = Fv[n0], A0 = Av[n0] - (1 - F0) * (baseCost + charge);
        charge = Math.max(0, F0 * hi - baseCost - A0);
        holdX = false;
        solve();
        // the exact values can sit a little over the rough ones: one step up when they break the limit
        for (let k = 0; k < 4 && basesAt(s) > max * 1.02; k++) { charge *= 1.25; solve(); }
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
      const has = [], miss = [], inWay = [], low = [], twin = [];
      const junk = [S.j[0] + (S.cx === 1 ? 1 : 0) + (S.dj === 1 ? 1 : 0) + (S.fj === 1 ? 1 : 0), S.j[1] + (S.cx === 2 ? 1 : 0) + (S.dj === 2 ? 1 : 0) + (S.fj === 2 ? 1 : 0)];
      for (let i = 0; i < G; i++) {
        const x = S.g[i], g = goals[i];
        const how = (S.fg === i ? ' (fractured)' : '') + (kindOf(x) === CRAFTED ? ' (crafted)' : kindOf(x) === DESECRATED ? ' (desecrated)' : '');
        if (met(x)) has.push(g.label + how);
        else if (near(x)) { has.push(g.label + how); low.push(g.label); }
        else {
          miss.push(g.label);
          if (x === BLOCKED) { inWay.push(g.label + (S.fg === i ? ' (fractured)' : '')); junk[g.si]++; }
          if (x === TWIN) { twin.push(g.label); junk[g.si]++; }
        }
      }
      const runes = [];
      if (S.u & R_ASTRID) runes.push(AST.item);
      if (S.u & R_SERLE) runes.push(SER.item);
      if ((S.u & R_POOL) && POOL) runes.push(POOL.item);
      if (S.u & R_ALDUR) runes.push(ALD.rune);
      if (S.aw) junk[awSide(S)]++;
      return { rarity: ['Normal', 'Magic', 'Rare'][S.r], has, miss, inWay, low, twin, runes, allowance: S.aw ? SIDES[S.aw - 1] : null, otherPrefixes: junk[0], otherSuffixes: junk[1], hidden: S.du ? SIDES[S.du - 1] : null,
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
  /** Solve with the factors: R (m x K) becomes x. Y: room for m x K numbers. */
  function luSolve(A, perm, R, m, K, Y) {
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
    for (let i = 0, n = m * K; i < n; i++) R[i] = Y[i];
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

  /**
   * The network for a request, always: the full one, and for requests with so many targets that it would not fit, a
   * smaller one (net.lite 1 or 2: see build). The route of a smaller network is a route of the full one, perhaps not
   * its cheapest.
   */
  function route(input) {
    const many = Object.values(input.targets || {}).filter((t) => t && t.fam).length >= 7;
    let net = null;
    for (const [lite, maxStates] of many ? [[1, 150000], [2, 1000000]] : [[0, 60000], [1, 150000], [2, 1000000]]) {
      net = build(Object.assign({}, input, { lite, maxStates }));
      if (net.unsupported !== 'too many item states') return net;
    }
    return net;
  }

  return { build, route, gammaP };
});
