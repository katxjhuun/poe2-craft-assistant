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
  const SANCT_LO = 0.78, SANCT_HI = 1.22; // Omen of Sanctification: every value times a random 78% to 122%
  const GAMMA = 1 - 1e-13; // keeps the equations solvable should a rule set never finish; the error is far below a cent
  const BIG = 1e15;
  // What a target is on the item. A target that is there came naturally, as the crafted modifier or as the Desecrated
  // one; NEAR + that: it is there with a value under the wanted one (a Divine Orb rolls it again).
  const ABSENT = 0, NATURAL = 1, CRAFTED = 2, DESECRATED = 3;
  const BLOCKED = 4;  // not there, and a modifier of its group is in the way
  const XBLOCKED = 9; // not there, and a modifier of the other side keeps it out with its tags (it takes no slot here)
  /** A modifier sits on the target's side for it: the target, a lower value, its twin or one of its group. */
  const there = (x) => x !== 0 && x !== XBLOCKED;
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
    if (item.rarity === 'Unique') return { blocked: 'Unique' };
    if (f.corrupted || f.sanctified) {
      // (finished: every target is on the item, as after a step of the route that locks it; false: it is lost)
      const out = { blocked: f.corrupted ? 'Corrupted' : 'Sanctified' };
      try {
        const c = P.makeContext(ix, item, { weights: input.weights || null, essences: input.essences || [] }), s = P.toState(c, item, input.locks);
        let gs = P.goalsFromTargets(c, input.targets).goals;
        if (gs.some((g) => g.required)) gs = gs.filter((g) => g.required);
        if (gs.length) out.finished = gs.every((g) => s.mods.some((m) => P.meets(m, g, g.tier)));
      } catch (e) { /* an item the planner cannot read: blocked, no more is said */ }
      return out;
    }
    const ctx = P.makeContext(ix, item, { weights: input.weights || null, essences: input.essences || [], catalystMult: input.catalystMult });
    const st0 = P.toState(ctx, item, input.locks);
    if (st0.rarity !== 'Normal' && st0.rarity !== 'Magic' && st0.rarity !== 'Rare') return { blocked: String(st0.rarity) };
    const gt = P.goalsFromTargets(ctx, input.targets);
    if (gt.unsupported.length) return { impossible: gt.unsupported.map((label) => ({ label, why: 'no essence, alloy or liquid emotion gives it on this item class' })) };
    let raw = gt.goals;
    if (raw.some((g) => g.required)) raw = raw.filter((g) => g.required);
    if (!raw.length) return { unsupported: 'no targets' };

    // a target this base and item level cannot have (the planner's own check) ends it here
    // (Omen of Sanctification multiplies every value by 78% to 122%: a value up to 22% over a tier's range can be
    // had that way. Only for a value that no tier's own range reaches do such tiers count for the target: there a
    // modifier under the value is one that nothing but the omen lifts. Where a tier does reach the value, a modifier
    // under it stays what it was, one that a Divine Orb lifts: the two kinds in one status would have the Divine Orb
    // used for ever on a tier it cannot lift.)
    const sanctOK = !!input.priceOf && input.priceOf('Omen of Sanctification') != null && input.priceOf('Divine Orb') != null && !ctx.legacy.has('Omen of Sanctification');
    // Of those tiers only the one with the highest range counts (g.stretchFrom): the omen's chance differs from tier
    // to tier, and a status that held two of them would promise each the average of both.
    raw.forEach((g) => { g.eff = g.tier; delete g.stretch; delete g.stretchFrom; });
    if (sanctOK) for (const g of raw) {
      if (g.minValue == null || !P.goalFeasible(ctx, st0, g)) continue;
      let top = -Infinity;
      const see = (id) => { const r = P.rangeOf(ctx, id); if (r && r[1] > top) top = r[1]; };
      for (const e of (g.des ? P.desPoolFor(ctx, g.side, 0, null) : g.rune ? P.runeSide(ctx, g.rune, g.side, 0) : P.sidePool(ctx, g.side, 0))) if (e.fam === g.fam) see(e.id);
      for (const y of g.ess || []) see(y.mod);
      if (top * SANCT_HI >= g.minValue) { g.stretch = SANCT_HI; g.stretchFrom = top; }
    }
    // A target that this base cannot roll (a Genesis Tree modifier, one that a Rune of Aldur transformed, a tier over
    // the item level) is no reason to refuse while the item carries it: it is `held`. Nothing brings it back once it
    // is gone, and no white base can take the item's place: see BOUND.
    for (const g of raw) {
      const why = P.goalFeasible(ctx, st0, g);
      if (!why || !/cannot roll|no tier reaches/.test(why)) continue;
      if (st0.mods.some((m) => m.id && P.meets(m, g, g.eff))) g.held = true;
      // (a modifier the base does not roll has no tier of the base's: the one on the item is the target as it is)
      else if (g.minValue == null && st0.mods.some((m) => m.id && !m.tier && m.fam === g.fam && (!g.des || m.des))) { g.held = true; g.tier = null; g.eff = null; }
    }
    const cannot = raw.filter((g) => !g.held).map((g) => ({ label: g.label, why: P.goalFeasible(ctx, st0, g) })).filter((x) => x.why);
    if (cannot.length) return { impossible: cannot };

    const priceOf = input.priceOf || (() => null);
    // What giving the item up means (input.restart): 'white', a white base at input.baseCost (the default); 'item',
    // another item like the pasted one at input.itemCost (a bought start); 'never', this item is the only one.
    // BOUND: a restart does not lead to a white base. An item that holds a target which a white base cannot get is
    // always bound. NONEW: there is no other item (never, or no price for one): every step that gives the item up
    // or can lose it is left out.
    const BOUND = input.restart === 'item' || input.restart === 'never' || raw.some((g) => g.held);
    const NONEW = BOUND && !(input.restart === 'item' && input.itemCost > 0);
    const baseCost = BOUND ? (NONEW ? 0 : +input.itemCost) : input.baseCost > 0 ? +input.baseCost : 0;
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
      if (!r || r[1] * (g.stretch || 1) < g.minValue || (g.stretchFrom != null && r[1] < g.stretchFrom)) return -1;
      const lo = r[0], hi = r[1];
      if (hi <= lo) return hi >= g.minValue ? 1 : 0;
      if (Number.isInteger(lo) && Number.isInteger(hi)) return Math.max(0, Math.min(1, (hi - Math.max(lo, Math.ceil(g.minValue)) + 1) / (hi - lo + 1)));
      return Math.max(0, Math.min(1, (hi - Math.max(lo, g.minValue)) / (hi - lo)));
    }
    const fits = (g, e) => (g.minValue != null ? reach(e.id, g) >= 0 : !g.tier || e.tier <= g.tier);

    // ---- the essence, alloy or liquid emotion that gives a goal's modifier: the cheapest priced one that meets it.
    // One that adds one of several modifiers (game table EssenceMods) hits with the share of the wanted one.
    // A Desecrated target comes from the Well of Souls only (a crafted modifier of the same family is not it), and a
    // source counts only when its modifier is of the target's side: on helmets an alloy adds Mana Cost Efficiency as a
    // crafted prefix, which is not the Desecrated suffix of that name.
    for (const g of goals) {
      const list = [];
      for (const r of g.kind === 'des' ? [] : g.ess || []) {
        const pr = price(r.item);
        if (pr == null) continue;
        const km = kb.mods[r.mod];
        if (!km || (km.gen === 'p' ? 0 : 1) !== g.si) continue;
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
      } else if (g.fam === 'ChaosResistance') {
        // Void Flux: every Fire, Cold and Lightning Resistance becomes the Chaos Resistance tier of the highest level
        // that is not above its own (planner.js chaosResFor); the sources are those that land on a tier the target takes
        const pr = price('Void Flux');
        if (pr == null) continue;
        const tiers = [...ctx.pool.entries()].filter(([id, pe]) => kb.mods[id].fam === 'ChaosResistance' && pe.side === g.side).map(([id, pe]) => ({ lvl: kb.mods[id].lvl, tier: pe.tier })).sort((a, b) => a.lvl - b.lvl);
        if (!tiers.length) continue;
        const src = new Set();
        for (const [id, pe] of ctx.pool) {
          const r = P.resElement(id), m = kb.mods[id];
          if (!r || pe.side !== g.side || goalFams.has(m.fam) || m.lvl > ctx.ilvl) continue;
          const fit = tiers.filter((t) => t.lvl <= m.lvl && t.lvl <= ctx.ilvl), got = fit.length ? fit[fit.length - 1] : tiers[0];
          if (!g.tier || got.tier <= g.tier) src.add(id);
        }
        if (src.size) conv[i] = { via: 'flux', to: 'chaos', item: 'Void Flux', price: pr, src };
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
    // (a rune the pasted item came with is there without a price; socketing it into a new base needs one)
    const AST = (() => { const n = P.runeFor(ctx, /additional Crafted Modifier/i); return n && ctx.craftedCap < 2 && (price(n) != null || st0.xCrafted) && (goals.filter((g) => g.magicEss || g.rareEss).length >= 2 || (!(input.lite | 0) && ctx.bone && priceOf('Essence of the Abyss') != null)) ? { item: n, price: price(n) } : null; })();
    const SER = (() => { const n = P.runeFor(ctx, /Suffix Modifiers? allowed/i); return n && (price(n) != null || st0.xSuffix) && goals.filter((g) => g.si === 1).length > LIM[1] ? { item: n, price: price(n) } : null; })();
    const pooled = goals.filter((g) => g.rune);
    if (new Set(pooled.map((g) => g.rune)).size > 1) return { impossible: pooled.map((g) => ({ label: g.label, why: 'needs its own rune, and an item takes one such rune' })) };
    const POOL = pooled.length ? { tag: pooled[0].rune, item: pooled[0].runeItem, price: price(pooled[0].runeItem) } : null;
    const hasPool = !!(POOL && (st0.tags || []).includes(POOL.tag));
    if (POOL && POOL.price == null && !hasPool) return { impossible: pooled.map((g) => ({ label: g.label, why: `needs the rune ${POOL.item}, which has no price` })) };
    /** Does crafted modifier `id` count for target g (its tier, or a value it can reach)? */
    const takes = (g, id) => (g.kind === 'ess' ? true : g.minValue != null ? reach(id, g) >= 0 : !g.tier || !!(ctx.pool.get(id) && ctx.pool.get(id).tier <= g.tier));
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
          return { mod: id, si: m.gen === 'p' ? 0 : 1, cap: cap ? (cap.prefix ? 0 : 1) : -1, goal: goals.findIndex((g) => g.kind !== 'des' && g.fam === m.fam && g.si === (m.gen === 'p' ? 0 : 1) && takes(g, id)) };
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
    // (a new base: the sockets of the pasted item, without the runes it came with)
    const FSN = RUNES ? Math.max(0, Math.min(3, P.freeSockets(ctx, { fresh: true, sockets: 0, socketed: 0 }))) : 0;
    const capOf = (S) => ctx.craftedCap + ((S.u & R_ASTRID) ? 1 : 0);
    // a rune the targets cannot do without needs a socket: a free one, or one an Artificer's Orb can add (it adds
    // none on jewellery)
    {
      const must = [];
      if (SER && !st0.xSuffix) must.push({ rune: SER.item, goals: goals.filter((g) => g.si === 1) });
      const crafted = goals.filter((g) => g.kind === 'ess');
      if (crafted.length > ctx.craftedCap && !st0.xCrafted) {
        if (!AST) return { impossible: crafted.map((g) => ({ label: g.label, why: `${crafted.length} crafted modifiers, and the item holds ${ctx.craftedCap}` })) };
        must.push({ rune: AST.item, goals: crafted });
      }
      if (POOL && !hasPool) must.push({ rune: POOL.item, goals: pooled });
      if (must.length > Math.max(FS0, FSN) + AD0) {
        const m = must[Math.min(must.length - 1, Math.max(FS0, FSN) + AD0)];
        return { impossible: m.goals.map((g) => ({ label: g.label, why: `needs ${m.rune} socketed, and the item has no free augment socket for it${artificer == null ? " (Artificer's Orb has no price)" : ''}` })) };
      }
    }

    // ---- pool numbers per side, minimum modifier level, catalyst boost and runes socketed
    const statCache = new Map(), statFloors = [], statMults = [];
    // Which natural targets have their blockers followed as states (see TRACK below). input.track: how many of them at
    // most (absent or true: all, 0 or false: none). Each one makes the network about 1.4 times larger, so where not all
    // fit, those whose group is the largest part of their side's pool come first: there an average over "is one of that
    // group on the item" is furthest off.
    const TMAX = (input.lite | 0) || input.track === false ? 0 : input.track == null || input.track === true ? G : Math.max(0, input.track | 0);
    const followed = (() => {
      const share = goals.map((g) => {
        if (g.kind !== 'nat') return -1;
        let W = 0, grp = 0;
        for (const e of P.sidePool(ctx, g.side, 0)) { W += e.w; if (e.fam === g.fam || (g.grp.length && e.grp.some((x) => g.grp.includes(x)))) grp += e.w; }
        return W > 0 ? grp / W : 0;
      });
      const first = goals.map((g, i) => i).filter((i) => share[i] >= 0).sort((a, b) => share[b] - share[a] || a - b).slice(0, TMAX);
      return goals.map((g, i) => first.includes(i));
    })();
    const TRACKED = followed.some(Boolean);
    let CAT = null;
    // ---- tags a modifier gives the item (game data adds_tags): modifiers whose spawn rule answers 0 to such a tag
    // cannot roll while it is there (a Fire spell damage prefix keeps the Cold one off a wand). Known for the targets
    // that are on the item (their tags thin the pool); a modifier nobody asked for is "in the way" of a target when its
    // tags stop every tier of that target.
    const goalTags = goals.map((g) => {
      const ids = g.kind === 'ess' ? [g.rareEss, g.magicEss].filter(Boolean).map((r) => r.mod)
        : (g.kind === 'des' ? P.desPoolFor(ctx, g.side, 0, null) : P.sidePool(ctx, g.side, 0)).filter((e) => e.fam === g.fam).map((e) => e.id);
      const set = new Set();
      for (const id of ids) for (const t of ((kb.mods[id] || {}).at || [])) set.add(t);
      return set.size ? set : null;
    });
    const tagIdx = [];
    for (let i = 0; i < G && tagIdx.length < 12; i++) if (goalTags[i]) tagIdx.push(i);
    /** Which of the tag-giving targets are on the item (a bit each). */
    const tagMask = (S) => { let m = 0; for (let k = 0; k < tagIdx.length; k++) { const x = S.g[tagIdx[k]]; if (x !== ABSENT && x !== BLOCKED && x !== TWIN && x !== XBLOCKED) m |= 1 << k; } return m; };
    const stopMemo = new Map();
    const fracBlocks = new Set(); // (filled from the pasted item, see nodeOf)
    // the pasted item's own other modifiers (not of a target's family): their groups, and whether those keep a
    // desecrated-only modifier off the Well's lists (only then is "they are all still there" worth a state)
    const OWN = new Set(), ownIds = [];
    for (const m of st0.mods) if (m.id && !m.unrevealed && !goals.some((g) => g.fam === m.fam)) { ownIds.push(m.id); for (const x of m.grp || []) OWN.add(x); }
    // its fractured modifier that is no target stays for the item's life: what it takes out of the pools is known
    // exactly (S.kf marks the items that come from the pasted one; a white base has none)
    const FRAC = (() => { const m = st0.mods.find((x) => x.frac && x.id && kb.mods[x.id] && !goals.some((g) => g.fam === x.fam)); return m ? { id: m.id, si: m.side === 'prefix' ? 0 : 1, grp: m.grp || [], fam: m.fam, crafted: !!m.crafted } : null; })();
    const ownMatters = ctx.bone && goals.some((g) => g.kind === 'des') && OWN.size > 0
      && [0, 1].some((si) => P.desPoolFor(ctx, SIDES[si], 0, null).some((e) => e.grp.some((x) => OWN.has(x))));
    /** Do the tags of modifier `id` stop every natural tier of target i? */
    function stops(id, i) {
      const at = kb.mods[id].at, g = goals[i];
      if (!at || g.kind !== 'nat') return false;
      const k = id + '|' + i;
      if (!stopMemo.has(k)) {
        const added = new Set(at), fam = P.sidePool(ctx, g.side, 0).filter((e) => e.fam === g.fam);
        stopMemo.set(k, fam.length > 0 && fam.every((e) => E.tagBlocked(kb.mods[e.id], ctx.baseTags, added)));
      }
      return stopMemo.get(k);
    }
    // Another element's twin of target i (what a Flux or a Rune of Aldur turns into it) has tags of its own: on a wand
    // a Fire or Lightning Damage prefix keeps "Freeze Buildup" off. Which element the twin is of is not known: the
    // share of the twins, by their weight, that stop target k.
    const twinStops = goals.map((g, i) => {
      if (!conv[i]) return null;
      const pool = P.sidePool(ctx, g.side, 0).filter((e) => conv[i].src.has(e.id));
      const tot = pool.reduce((x, e) => x + e.w, 0);
      if (!(tot > 0)) return null;
      const out = goals.map((_, k) => (k === i ? 0 : pool.reduce((x, e) => x + (stops(e.id, k) ? e.w : 0), 0) / tot));
      return out.some((x) => x > 0) ? out : null;
    });
    /**
     * mult: how much Omen of Catalysing Exaltation raises the weight of the catalyst's type of modifier (1: no omen).
     * bits: the runes socketed that change the rolls (a pool rune adds its pool; with a Rune of Aldur in, another
     * element's modifier can no longer be turned into the target).
     * tm: the tag-giving targets on the item (tagMask): what their tags stop is not in the pool.
     * pm: the targets of this side that are on the item (presentMask): their groups are not in the pool.
     * -> { W, ok, low, nearW, twin, block }: per goal the weight that meets it, that lands under its value, that is in
     * its way, and that is its twin of another element.
     */
    function stats(si, floor, mult, bits, tm, pm) {
      mult = mult > 1 ? mult : 1;
      bits = (bits || 0) & (R_POOL | R_ALDUR);
      tm = tm || 0; pm = pm || 0;
      let fi = statFloors.indexOf(floor), mi = statMults.indexOf(mult);
      if (fi < 0) fi = statFloors.push(floor) - 1;
      if (mi < 0) mi = statMults.push(mult) - 1;
      // (tm: at most 12 bits, pm: one bit per target)
      const key = ((((fi * 16 + mi) * 2 + si) * 16 + bits) * 4096 + tm) * 1024 + pm;
      let s = statCache.get(key);
      if (s) return s;
      let pool = P.sidePool(ctx, SIDES[si], floor);
      if (POOL && (bits & R_POOL)) pool = pool.concat(P.runeSide(ctx, POOL.tag, SIDES[si], floor));
      if (pm) {
        // pm: the targets of this side that are on the item (or have a modifier of their group in their way). What
        // is of their groups cannot roll, and no other modifier on the item can be of them either: they are out
        // of the pool before the rest is counted ("+# to Armour" takes the local defences, half of a body armour's
        // prefixes, with it).
        const fams = new Set(), grps = new Set();
        for (let i = 0; i < G; i++) if (pm & (1 << i)) { fams.add(goals[i].fam); for (const x of goals[i].grp) grps.add(x); }
        pool = pool.filter((e) => !fams.has(e.fam) && !e.grp.some((x) => grps.has(x)));
      }
      if (tm) {
        const added = new Set();
        for (let k = 0; k < tagIdx.length; k++) if (tm & (1 << k)) for (const t of goalTags[tagIdx[k]]) added.add(t);
        pool = pool.filter((e) => e.rune || !E.tagBlocked(kb.mods[e.id], ctx.baseTags, added)); // (a rune's pool is not stopped: planner.rollMod)
      }
      let W = 0;
      const ws = new Float64Array(pool.length);
      const ok = new Float64Array(G), low = new Float64Array(G), nearW = new Float64Array(G), twin = new Float64Array(G), cross = new Float64Array(G);
      // One modifier can be something for two targets of its side: a Cold Resistance of a high tier is the Cold target
      // and, for a Flux, the twin of the Fire and of the Chaos one; one of a low tier is in the Cold target's way and
      // may still be the twin of another. It is one modifier and gets one status (nodeOf: the target it meets, else a
      // twin, else in a target's way; of two alike the first target). multi: such entries, [[target, kind, weight,
      // weight under the value]] with kind 0 it meets the target, 2 its twin, 3 in its way; roll takes the doubles out.
      const multi = [];
      // lowX[i]: of what is in target i's way on this side, the weight that also keeps targets of the other side out,
      // by the set of those targets (a bit each): one modifier, two effects (a Shock suffix on a staff is in the
      // Freeze Buildup suffix's way and keeps the Fire Damage prefix off)
      const lowX = new Array(G).fill(null);
      // twinX[i]: the same for target i's twins. On a staff the Fire Damage prefix and the Freeze Buildup suffix keep
      // each other out; the way to both is a Cold Damage prefix (the Fire target's twin, turned by a Rune of Aldur
      // later) with Freeze Buildup beside it. A Lightning Damage twin keeps Freeze Buildup out for good: which twin
      // it is decides, and an average over the twins promised two thirds of the real cost there.
      const twinX = new Array(G).fill(null);
      for (let q = 0; q < pool.length; q++) {
        const e = pool[q];
        const w = mult > 1 && (kb.mods[e.id].mt || []).includes(CAT.tag) ? e.w * mult : e.w;
        W += w; ws[q] = w;
        let roles = null, xm = 0;
        const role = (i, kind, a, b) => { (roles || (roles = [])).push([i, kind, a, b || 0]); };
        for (let i = 0; i < G; i++) {
          const g = goals[i];
          // a target of the other side that this modifier keeps out: with its tags (a "+ to Level of all Fire Spell
          // Skills" suffix keeps the Chaos Damage prefix off a wand), or by being of its group (no group twice on an
          // item, whatever the side: a belt's Thorns prefix keeps the Desecrated "Thorns Critical Hit Chance" suffix off)
          if (g.si !== si) { if ((!e.rune && stops(e.id, i)) || (g.grp.length && e.fam !== g.fam && e.grp.some((x) => g.grp.includes(x)))) { cross[i] += w; xm |= 1 << i; } continue; }
          if (g.kind === 'nat' && e.fam === g.fam) {
            if (g.minValue != null) { const p = reach(e.id, g); if (p < 0) { low[i] += w; role(i, 3, w); } else { ok[i] += w * p; nearW[i] += w * (1 - p); role(i, 0, w * p, w * (1 - p)); } }
            else if (!g.tier || e.tier <= g.tier) { ok[i] += w; role(i, 0, w); } else { low[i] += w; role(i, 3, w); }
          } else if (conv[i] && conv[i].src.has(e.id)) {
            // (a Rune of Aldur transforms what is on the item when it is socketed: with it in, another element's
            // modifier that rolls later stays what it is, one more modifier nobody asked for)
            if (!(conv[i].via === 'aldur' && (bits & R_ALDUR))) { twin[i] += w; role(i, 2, w); }
          } else if (g.grp.length && e.grp.some((x) => g.grp.includes(x))) { low[i] += w; role(i, 3, w); } // of the target's group: it keeps the target out
          else if (!e.rune && stops(e.id, i)) { low[i] += w; role(i, 3, w); } // its tags keep the target out
        }
        if (roles && roles.length > 1) multi.push(roles);
        // (the status a modifier gets is its first: what meets a target or is its twin is not "in the way" here)
        if (xm && roles && roles[0][1] === 3) { const i = roles[0][0]; (lowX[i] || (lowX[i] = new Map())).set(xm, ((lowX[i] && lowX[i].get(xm)) || 0) + w); }
        if (xm && roles && roles[0][1] === 2) { const i = roles[0][0]; (twinX[i] || (twinX[i] = new Map())).set(xm, ((twinX[i] && twinX[i].get(xm)) || 0) + w); }
      }
      // What modifiers nobody asked for take out of the pools. They are picked by their weight, and a picked one leaves
      // with everything of its groups (its own family, and on wands, staves and foci its sister families) and with
      // what its tags stop, on its own side and on the other one (a "+ to Level of all Fire Spell Skills" suffix
      // takes the Cold and Lightning spell prefixes with it). Every pool entry is followed: with L left on the side, it
      // goes with the next modifier when that is of its groups (chance g / L) or stops it with its tags (t / J).
      // left[n], across[n]: the weight left on this side and on the other one next to n such modifiers of this side
      // (checked against drawn pools: within 0.6% on classes without such tags, 2.4% on wands and staves for n <= 3).
      const mine = new Set(goals.filter((g) => g.kind === 'nat' && g.si === si).map((g) => g.fam));
      const theirs = new Set(goals.filter((g) => g.kind === 'nat' && g.si !== si).map((g) => g.fam));
      const keysOf = (e) => (e.grp && e.grp.length ? e.grp : []).concat(['fam:' + e.fam]);
      // (with every blocker followed, what is of a target's group or stops it with its tags is not anonymous either)
      const sideNat = [];
      for (let i = 0; i < G; i++) if (goals[i].kind === 'nat' && goals[i].si === si) sideNat.push(i);
      const claimed = (e) => mine.has(e.fam) || (TRACKED && sideNat.some((i) => followed[i] && ((goals[i].grp.length && e.grp.some((x) => goals[i].grp.includes(x))) || (!e.rune && stops(e.id, i)))));
      const own = [];
      for (let q = 0; q < pool.length; q++) if (!claimed(pool[q])) own.push(q);
      // crossJ[k]: of the modifiers nobody asked for (the anonymous ones), the weight that keeps target k of the other
      // side out. (cross[k] counts every modifier of the side that does, also one that is in a followed target's way
      // here; that one arrives with both effects, see lowX, and must not be counted again among the anonymous.)
      const crossJ = new Float64Array(G);
      for (const q of own) {
        const e = pool[q];
        for (let i = 0; i < G; i++) { const g = goals[i]; if (g.si !== si && ((!e.rune && stops(e.id, i)) || (g.grp.length && e.fam !== g.fam && e.grp.some((x) => g.grp.includes(x))))) crossJ[i] += ws[q]; }
      }
      const byGrp = new Map();
      for (const q of own) for (const k of keysOf(pool[q])) { let l = byGrp.get(k); if (!l) byGrp.set(k, l = []); l.push(q); }
      const gw = new Float64Array(pool.length), tw = new Float64Array(pool.length);
      const mark = new Int32Array(pool.length).fill(-1);
      let J = 0;
      for (const q of own) {
        let X = 0;
        for (const k of keysOf(pool[q])) for (const o of byGrp.get(k)) if (mark[o] !== q) { mark[o] = q; X += ws[o]; }
        gw[q] = X; J += ws[q];
      }
      let other = null, tx = null; // the other side's pool, read only when a modifier of this side has tags
      for (const q of own) {
        const at = pool[q].rune ? null : kb.mods[pool[q].id].at;
        if (!at) continue;
        const added = new Set(at);
        const shares = new Set(keysOf(pool[q]).flatMap((k) => byGrp.get(k)));
        for (const o of own) if (!shares.has(o) && !pool[o].rune && E.tagBlocked(kb.mods[pool[o].id], ctx.baseTags, added)) tw[o] += ws[q];
        if (!other) { other = P.sidePool(ctx, SIDES[1 - si], floor).filter((o) => !theirs.has(o.fam)); tx = new Float64Array(other.length); }
        for (let o = 0; o < other.length; o++) if (E.tagBlocked(kb.mods[other[o].id], ctx.baseTags, added)) tx[o] += ws[q];
      }
      // what the pasted item's fractured modifier takes from this side: its groups (on its own side) and its tags
      let fracTake = 0;
      if (FRAC) {
        const at = kb.mods[FRAC.id].at, added = at ? new Set(at) : null;
        for (const q of own) {
          const e = pool[q];
          if ((FRAC.si === si && (e.fam === FRAC.fam || e.grp.some((x) => FRAC.grp.includes(x)))) || (added && !e.rune && E.tagBlocked(kb.mods[e.id], ctx.baseTags, added))) fracTake += ws[q];
        }
      }
      const NMAX = 7;
      const left = new Float64Array(NMAX + 1), across = new Float64Array(NMAX + 1).fill(1);
      left[0] = J;
      {
        const surv = new Float64Array(pool.length).fill(1);
        const sx = other ? new Float64Array(other.length).fill(1) : null;
        const X0 = other ? other.reduce((x, o) => x + o.w, 0) : 0;
        for (let n = 1; n <= NMAX; n++) {
          const L = left[n - 1];
          let f = 0;
          if (L > 0) for (const q of own) { surv[q] *= Math.max(0, 1 - Math.min(1, gw[q] / L) - tw[q] / J); f += ws[q] * surv[q]; }
          left[n] = f;
          if (other && X0 > 0) { let fx = 0; for (let o = 0; o < other.length; o++) { sx[o] *= Math.max(0, 1 - tx[o] / J); fx += other[o].w * sx[o]; } across[n] = fx / X0; }
        }
      }
      // The dominant group: one group that is a fifth or more of what nobody asked for (the local defences are half of
      // the prefixes on body armour and boots). Whether a modifier of it is on the item is followed as two cases
      // instead of an average: with one the pool is small and the targets of that group cannot roll, without one the
      // pool is large. leftR[n]: what is left of the rest next to n modifiers that are not of that group.
      let big = null, leftR = null;
      {
        const gsum = new Map();
        for (const q of own) for (const x of pool[q].grp || []) gsum.set(x, (gsum.get(x) || 0) + ws[q]);
        let best = null;
        for (const [k, w] of gsum) if (!best || w > best[1]) best = [k, w];
        if (best && J > 0 && best[1] / J >= 0.2 && best[1] < J) {
          const inB = (e) => (e.grp || []).includes(best[0]);
          let mineW = 0;
          const has = new Set();
          for (let q = 0; q < pool.length; q++) if (claimed(pool[q]) && inB(pool[q])) mineW += ws[q];
          for (let i = 0; i < G; i++) if (goals[i].si === si && goals[i].kind === 'nat' && goals[i].grp.includes(best[0])) has.add(i);
          big = { key: best[0], w: best[1], mineW, has };
          const rest = own.filter((q) => !inB(pool[q])), JR = J - best[1];
          leftR = new Float64Array(NMAX + 1);
          leftR[0] = JR;
          const surv = new Float64Array(pool.length).fill(1);
          for (let n = 1; n <= NMAX; n++) {
            const L = leftR[n - 1];
            let f = 0;
            if (L > 0) for (const q of rest) { surv[q] *= Math.max(0, 1 - Math.min(1, gw[q] / L) - tw[q] / J); f += ws[q] * surv[q]; }
            leftR[n] = f;
          }
        }
      }
      const anon = new Uint8Array(pool.length);
      for (const q of own) anon[q] = 1;
      s = { W, ok, low, lowX, twinX, nearW, twin, cross, crossJ, multi, J, left, across, fracTake, big, leftR, pool, ws, anon, takes: new Map() };
      statCache.set(key, s);
      return s;
    }
    // how often a Divine Orb leaves a value target at or over its value; the level a target's modifier has (for Omen
    // of Whittling); the levels of the other modifiers of a side
    const pv = new Float64Array(G).fill(1), goalLvl = new Float64Array(G), goalLv = [];
    for (let i = 0; i < G; i++) {
      const g = goals[i];
      const list = g.kind === 'des' ? P.desPoolFor(ctx, g.side, 0, null).filter((e) => e.fam === g.fam)
        : g.kind === 'ess' ? [g.rareEss, g.magicEss].filter(Boolean).map((r) => ({ id: r.mod, w: 1, lvl: kb.mods[r.mod].lvl, tier: null }))
          : P.sidePool(ctx, g.side, 0).concat(g.rune && POOL ? P.runeSide(ctx, POOL.tag, g.side, 0) : []).filter((e) => e.fam === g.fam);
      let w = 0, wOk = 0, wl = 0;
      const byLvl = new Map();
      for (const e of list) { if (!fits(g, e)) continue; const p = g.minValue != null ? Math.max(0, reach(e.id, g)) : 1; w += e.w; wOk += e.w * p; wl += e.w * e.lvl; byLvl.set(e.lvl, (byLvl.get(e.lvl) || 0) + e.w); }
      pv[i] = w > 0 ? wOk / w : 1;
      goalLvl[i] = w > 0 ? wl / w : 1;
      // goalLv: the levels the target's modifier can have on the item, [[level, share]] (its fitting tiers by weight)
      goalLv.push(w > 0 ? [...byLvl.entries()].sort((a, b) => a[0] - b[0]).map(([lvl, x]) => [lvl, x / w]) : [[1, 1]]);
    }
    const lvMemo = new Map();
    /** The levels of the modifiers nobody asked for on side si, as an orb with that minimum modifier level rolls them: {list: [[level, weight]], total}. */
    function levelsOf(si, floor) {
      const k = si * 1000 + floor;
      let L = lvMemo.get(k);
      if (!L) {
        const mine = new Set(goals.filter((g) => g.si === si).map((g) => g.fam)), by = new Map();
        let total = 0;
        for (const e of P.sidePool(ctx, SIDES[si], floor)) { if (mine.has(e.fam)) continue; by.set(e.lvl, (by.get(e.lvl) || 0) + e.w); total += e.w; }
        L = { list: [...by.entries()].sort((a, b) => a[0] - b[0]), total };
        lvMemo.set(k, L);
      }
      return L;
    }
    /** Share of them with a level of x or more. */
    function atLeast(si, floor, x) { const L = levelsOf(si, floor); if (!L.total) return 1; let w = 0; for (const e of L.list) if (e[0] >= x) w += e[1]; return w / L.total; }

    // A smaller network for a request with very many targets (see route): no Fracturing Orb, and an essence or the
    // Well of Souls as the source of a natural target only for the two hardest of them (lite 1) or for none (lite 2).
    const lite = input.lite | 0;
    // TRACK: every modifier that keeps a natural target out is followed as a state of that target (one of its group on
    // its side: BLOCKED; one of the other side that stops it with its tags: XBLOCKED), also when it rolls during the
    // craft. Without it only the pasted item's own blockers are, and a rolled one is a chance that is drawn anew at
    // every roll, though on the item it stays: where one group is half of the pool (local defences) that is 10% off.
    // More states: the full network only.
    // (also when no natural target is followed: a Desecrated or crafted-only target with modifiers of its group on
    // the other side. Bones are too dear to use on an item where it cannot come.)
    const XGRP = TMAX > 0 && goals.some((g) => g.kind !== 'nat' && g.grp.length && P.sidePool(ctx, SIDES[1 - g.si], 0).some((e) => e.fam !== g.fam && e.grp.some((x) => g.grp.includes(x))));
    const TRACK = TRACKED || XGRP;
    if (lite) {
      const nat = [];
      for (let i = 0; i < G; i++) if (goals[i].kind === 'nat' && !goals[i].kept) { const st = stats(goals[i].si, 0, 1, R_POOL | R_ALDUR); nat.push([i, (st.ok[i] + st.nearW[i]) / (st.W || 1)]); }
      nat.sort((a, b) => a[1] - b[1]);
      const keep = new Set(nat.slice(0, lite === 1 ? 2 : 0).map((x) => x[0]));
      for (const [i] of nat) if (!keep.has(i)) { goals[i].magicEss = goals[i].rareEss = null; goals[i].noWell = true; }
    }
    const floorOf = (op, tier) => { const fl = ctx.floors[op]; return !fl || tier === 'base' ? 0 : tier === 'greater' ? fl.Greater || 0 : fl.Perfect || 0; };
    /**
     * The orb tiers worth an edge: the priced ones that no other tier beats. A tier is beaten by one that costs no more
     * and gives every target at least its share of the pool (within 2%: a dearer orb for a hair more is not worth an
     * edge at every node). The cheaper orb is not always the lower one: with Greater Orbs of Transmutation at 0.96 and
     * plain ones at 1.51 the network rolled jewels with the plain orb, and the planner's old route with the Greater
     * one was a third cheaper (Time-Lost Diamond, two targets: 4,081 against 6,551).
     */
    function orbTiers(op) {
      let keep = [];
      for (let t = 0; t < TIERS.length; t++) {
        const name = ORB[op][t], pr = price(name);
        if (pr == null) continue;
        const floor = floorOf(op, TIERS[t]);
        const share = goals.map((g, i) => { if (g.kind !== 'nat') return 0; const s = stats(g.si, floor, 1, R_POOL | R_ALDUR); return (s.ok[i] + s.nearW[i] + s.twin[i]) / (s.W || 1); });
        const X = { tier: TIERS[t], name, price: pr, floor, share };
        const beats = (A, B) => A.price <= B.price && !B.share.some((x, i) => x > A.share[i] * 1.02);
        if (keep.some((Y) => beats(Y, X))) continue;
        keep = keep.filter((Y) => !beats(X, Y));
        keep.push(X);
      }
      return keep.map(({ tier, name, price: pr, floor }) => ({ tier, name, price: pr, floor }));
    }
    const T = { transmute: orbTiers('transmute'), augment: orbTiers('augment'), regal: orbTiers('regal'), exalt: orbTiers('exalt'), chaos: orbTiers('chaos') };
    const PR = {
      annul: price('Orb of Annulment'), fracture: lite ? null : price('Fracturing Orb'), alchemy: price('Orb of Alchemy'), divine: price('Divine Orb'),
      exaltSide: [price(OMEN.exalt.prefix), price(OMEN.exalt.suffix)], erasure: [price(OMEN.erasure.prefix), price(OMEN.erasure.suffix)],
      annulSide: [price(OMEN.annul.prefix), price(OMEN.annul.suffix)], light: price(OMEN.light),
      necro: [price(OMEN.necro.prefix), price(OMEN.necro.suffix)], echoes: price(OMEN.echoes),
      crystal: [price(OMEN.crystal.prefix), price(OMEN.crystal.suffix)], whittling: price(OMEN.whittling), greaterExalt: price(OMEN.greaterExalt),
    };
    const EXTRACT = price('Orb of Extraction');
    PR.vaal = price('Vaal Orb'); PR.putrefy = ctx.bone ? price(OMEN.putrefy) : null; PR.sanct = sanctOK ? price('Omen of Sanctification') : null;
    // ---- Omen of Whittling: the Chaos Orb removes the modifier of the lowest level.
    // Whether that is a modifier nobody asked for or a target is decided by levels that stay what they are for as long
    // as the modifiers are on the item. So the lowest level among the modifiers nobody asked for (and those in a
    // target's way) is a class of the node, one for the prefixes and one for the suffixes (S.fl = 3 x the prefixes'
    // class + the suffixes'): 0 under LCUT[0], the lowest level any target's modifier can have (the omen then takes
    // one of them for certain); then up to LCUT[1], a level near the targets' highest; then from there on. A modifier
    // that rolls arrives with the class of its level, which depends on the orb's minimum modifier level. Per side,
    // because steps that clear one side are common: what is left on the other side keeps its class.
    // The omen is an edge only where the classes tell for certain what it removes (see whittled). (Their levels once were drawn anew from the whole pool at every use, and a target's level was the mean
    // of its tiers: six T1 targets on a helmet were promised at two thirds of what they cost, because a modifier from
    // a Perfect orb is rarely under them.) The full network only.
    // The classes make the network about three times as large, and most routes never use the omen. So route() first
    // solves a network that has the omen at its best (input.whittle 'best': the player picks what it removes, one edge
    // per modifier, marked `ideal`) and no classes. No real omen is better than that, so a route that does not use it
    // there is the route with the real omen too, at the same cost. Only when it is used is the network built again with
    // the levels followed (input.classes: 3 or 2 classes a side, as many as fit). Where not even two fit, and in the
    // smaller networks, the omen is left out (input.whittle 'none'): without the classes its chances are wrong by a
    // factor (a talisman with six targets was promised at half of what it cost), and a route without the omen is a
    // true route.
    const WBEST = !lite && input.whittle === 'best';
    const WNONE = !!lite || input.whittle === 'none' || input.classes === 1;
    const WHIT = !WBEST && !WNONE && PR.whittling != null;
    const LCUT = (() => {
      if (!WHIT) return [];
      const all = [...new Set(goalLv.flatMap((l) => l.map((x) => x[0])))].sort((a, b) => a - b);
      if (!all.length) return [];
      const top = all[all.length - 1], t2 = all.find((x) => x > all[0] && x >= top - 8);
      const cuts = [];
      if (all[0] > 1) cuts.push(all[0]);
      if (t2 != null) cuts.push(t2);
      return input.classes === 2 ? cuts.slice(0, 1) : cuts;
    })();
    const NCLS = LCUT.length + 1;
    const clsOf = (lvl) => { let c = 0; while (c < LCUT.length && lvl >= LCUT[c]) c++; return c; };
    /** How many modifiers of a side the class is about: the plain other ones and those in a target's way. */
    const nSide = (S, si) => { let n = S.j[si]; for (let i = 0; i < G; i++) if (S.g[i] === BLOCKED && goals[i].si === si) n++; return n; };
    const clsAt = (S, si) => (si === 0 ? (S.fl / 3) | 0 : S.fl % 3);
    const setCls = (n, si, c) => { n.fl = si === 0 ? c * 3 + (n.fl % 3) : ((n.fl / 3) | 0) * 3 + c; };
    /** (a side without such a modifier: one node whatever its class was) */
    // Crafted modifiers nobody asked for: up to two (the second with Astrid's Creativity), each with its side (cx, cy)
    // and whose it is (ct, cu: 1 the aimed tool essence's of that side, 2 the unaimed one's, 0 not known). An essence
    // adds no second modifier of its group, so a tool whose own modifier is still there adds nothing. (One such
    // modifier was counted once, and a second taken for a plain one: that left room for a third crafted modifier,
    // which the rules refuse; then steps that leave a second were not offered, which cost a bow's route a sixth.)
    const ownOn = (S, si, kind) => (S.cx === si + 1 && S.ct === kind) || (S.cy === si + 1 && S.cu === kind);
    const addCrafted = (n, si, kind) => { if (!n.cx) { n.cx = si + 1; n.ct = kind; } else if (!n.cy) { n.cy = si + 1; n.cu = kind; } else n.j[si]++; };
    const canon = (n) => {
      if (!n.cx && n.cy) { n.cx = n.cy; n.ct = n.cu; n.cy = 0; }
      if (!n.cx) n.ct = 0;
      if (!n.cy) n.cu = 0;
      else if (n.cx * 3 + n.ct < n.cy * 3 + n.cu) { const a = n.cx, b = n.ct; n.cx = n.cy; n.ct = n.cu; n.cy = a; n.cu = b; } // (one order for the two)
      if (n.fl) { if (n.fl >= 3 && nSide(n, 0) === 0) n.fl %= 3; if (n.fl % 3 && nSide(n, 1) === 0) n.fl -= n.fl % 3; }
      // xg (bit of a side): a modifier of that side that is in a target's way there also keeps targets of the other
      // side out with its tags. When no such modifier is left on the side, what it kept out is free again; a bit
      // with nothing kept out says nothing.
      if (n.xg) for (let si = 0; si < 2; si++) {
        if (!((n.xg >> si) & 1)) continue;
        let holder = false, held = false;
        for (let i = 0; i < G; i++) { if (goals[i].si === si) { if (n.g[i] === BLOCKED || n.g[i] === TWIN) holder = true; } else if (n.g[i] === XBLOCKED && !fracBlocks.has(i)) held = true; }
        if (holder && held) continue;
        n.xg &= ~(1 << si);
        if (!holder) for (let i = 0; i < G; i++) if (goals[i].si !== si && n.g[i] === XBLOCKED && !fracBlocks.has(i) && !n.j[si]) n.g[i] = ABSENT;
      }
      return n;
    };
    const clsMemo = new Map();
    /** The class of a new modifier nobody asked for, rolled on side si at a minimum modifier level: the chance of each. */
    function clsDist(si, floor) {
      const k = si * 1000 + floor;
      let d = clsMemo.get(k);
      if (!d) {
        d = new Float64Array(NCLS);
        for (let c = 0; c < NCLS; c++) d[c] = (c === 0 ? 1 : atLeast(si, floor, LCUT[c - 1])) - (c === NCLS - 1 ? 0 : atLeast(si, floor, LCUT[c]));
        clsMemo.set(k, d);
      }
      return d;
    }
    /** One more modifier nobody asked for whose level is known (an essence's own): the class follows. */
    const junkAt = (n, si, lvl) => { const had = nSide(n, si) > 0; n.j[si]++; if (NCLS > 1) { const c = clsOf(lvl || 1); setCls(n, si, had ? Math.min(clsAt(n, si), c) : c); } };
    // ---- essences as tools (what crafters do instead of Omen of Light, 0.5.5):
    // TOOL[si]: the cheapest Perfect or special essence whose crafted modifier is of side si and of no target's group.
    // Aimed with an Omen of Crystallisation it takes the unwanted Desecrated modifier away, and its own modifier sits
    // there until a bone replaces it. ABYSS: Essence of the Abyss leaves the Mark of the Abyssal Lord, which the next
    // desecration replaces (no other modifier goes, also on a full item).
    // FILL[si]: the same without an omen, alloys too: where the side of its modifier is full, an essence or alloy
    // removes a modifier of that side (R_SWAP_REMOVAL), so on a side that holds one fractured modifier and the unwanted
    // Desecrated one it is sure to take the Desecrated one (amulets and rings with two prefixes or two suffixes).
    const TOOL = [null, null], FILL = [null, null];
    let ABYSS = null;
    // the lich omens work on weapons and jewellery only (game text; planner.js validate)
    const LICH_OK = P.lichOmenWorks(ctx);
    if (!lite) {
      const goalGroups = new Set(goals.flatMap((g) => g.grp || []));
      for (const r of ctx.essences) {
        if (r.kind !== 'rare' || r.liquid) continue;
        const m = kb.mods[r.mod], pr = price(r.item);
        if (!m || pr == null) continue;
        // (its Mark is a prefix or a suffix, even chances among the sides with room: kb.essence_outcomes)
        if (r.item === 'Essence of the Abyss') { if (!ABYSS) ABYSS = { item: r.item, mods: [null, null], price: pr }; ABYSS.mods[m.gen === 'p' ? 0 : 1] = r.mod; continue; }
        if (kb.essence_outcomes && kb.essence_outcomes[r.item]) continue; // (one of several modifiers: not a tool)
        if (goals.some((g) => g.fam === m.fam) || (m.grp || []).some((x) => goalGroups.has(x))) continue;
        const si = m.gen === 'p' ? 0 : 1;
        const t = { item: r.item, mod: r.mod, price: pr, si };
        if (!r.alloy && (!TOOL[si] || pr < TOOL[si].price)) TOOL[si] = t;
        if (!FILL[si] || pr < FILL[si].price) FILL[si] = t;
      }
    }
    // bones: the cheapest one without a floor that the item level allows, and the Ancient one (floor 40) when priced
    const bones = [];
    if (ctx.bone) {
      const exists = (q) => !!(kb.item_descriptions || {})[`${q} ${ctx.bone}`];
      // (an Altered Collarbone reveals like a Preserved one as far as the game data tells: its "otherworldly" modifiers
      // are not in the data, so it is a bone of its own price and nothing more)
      const plain = [['Gnawed', ctx.ilvl <= 64], ['Preserved', true], ['Altered', ctx.bone === 'Collarbone']].filter(([q, ok]) => ok && exists(q)).map(([q]) => ({ quality: q, floor: 0, price: price(`${q} ${q === 'Altered' ? 'Collarbone' : ctx.bone}`) }))
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
    const FLK = NCLS > 1 ? 9 : 1; // (the two classes of the lowest levels, see LCUT)
    // j, the modifiers of a side that nobody asked for: as many as a side holds at most. Three on most items; a
    // base's implicit raises it (Tenebrous Amulet: one prefix and five suffixes), and so do Serle's Triumph and a
    // jewel's allowance modifier. (The key had room for three: on a side of four or five, an item with four
    // modifiers nobody asked for there was the node of another item, and the route's step for it was one the rules
    // refuse; found on 10 Oct 2026 when the bases that change the slot counts were first played.)
    const JMAX = Math.max(3, LIM[0], LIM[1]) + (SER || st0.xSuffix ? 1 : 0); // (a jewel: two and the allowance modifier's one)
    const JK = JMAX + 1;
    const KEY_REST = 3 * JK * JK * 10 * 3 * 3 * 3 * 3 * 3 * 16 * 4 * 3 * 3 * 2 * 2 * FLK * 3 * 3 * 3 * 4;
    const KEY_NUM = Math.pow(10, G) * KEY_REST < 9e15; // (the two parts fit one number exactly)
    const keyOf = (S) => {
      let a = 0;
      for (let i = 0; i < G; i++) a = a * 10 + S.g[i];
      let k = S.r;
      if (S.j[0] > JMAX || S.j[1] > JMAX) throw new Error('more modifiers on a side than a node can count');
      k = k * JK + S.j[0]; k = k * JK + S.j[1]; k = k * 10 + (S.fg + 1); k = k * 3 + S.fj; k = k * 3 + S.cx; k = k * 3 + S.dj; k = k * 3 + S.du;
      k = k * 3 + S.q; k = k * 16 + S.u; k = k * 4 + S.fs; k = k * 3 + S.ad; k = k * 3 + S.aw; k = k * 2 + S.kx; k = k * 2 + S.kf; k = k * FLK + S.fl; k = k * 3 + S.ct; k = k * 3 + S.cy; k = k * 3 + S.cu; k = k * 4 + S.xg;
      return KEY_NUM ? a * KEY_REST + k : a + ':' + k;
    };
    const cp = (S) => ({ r: S.r, g: S.g.slice(), j: [S.j[0], S.j[1]], fg: S.fg, fj: S.fj, cx: S.cx, dj: S.dj, du: S.du, q: S.q, u: S.u, fs: S.fs, ad: S.ad, aw: S.aw, kx: S.kx, kf: S.kf, fl: S.fl, ct: S.ct, cy: S.cy, cu: S.cu, xg: S.xg });
    function idOf(S) {
      canon(S);
      const k = keyOf(S);
      let i = index.get(k);
      if (i === undefined) { i = states.length; index.set(k, i); states.push(S); }
      return i;
    }
    const others = (S, si) => S.j[si] + (S.fj === si + 1 ? 1 : 0) + (S.cx === si + 1 ? 1 : 0) + (S.cy === si + 1 ? 1 : 0) + (S.dj === si + 1 ? 1 : 0);
    // the allowance modifier: aw 1 "+1 Prefix Modifier allowed" (it is a suffix), aw 2 "+1 Suffix Modifier allowed" (a prefix)
    const awSide = (S) => (S.aw === 1 ? 1 : 0);
    function slots(S, si) {
      let n = others(S, si) + (S.du === si + 1 ? 1 : 0) + (S.aw && awSide(S) === si ? 1 : 0);
      for (let i = 0; i < G; i++) if (there(S.g[i]) && goals[i].si === si) n++;
      return n;
    }
    const limOf = (S, si) => (S.r === 2 ? LIM[si] + (si === 1 && (S.u & R_SERLE) ? 1 : 0) + (S.aw === si + 1 ? 1 : 0) : S.r === 1 ? 1 : 0);
    const open = (S, si) => Math.max(0, limOf(S, si) - slots(S, si));
    const done = (S) => { for (let i = 0; i < G; i++) if (!met(S.g[i])) return false; return true; };
    // (a crafted modifier that a Fracturing Orb locked still counts for "one crafted modifier per item": the pasted
    // item's is known, S.kf; the network makes no other, see the Fracturing Orb's edge)
    const craftedUsed = (S) => { let n = (S.cx ? 1 : 0) + (S.cy ? 1 : 0) + (S.aw ? 1 : 0) + (S.kf && FRAC && FRAC.crafted ? 1 : 0); for (let i = 0; i < G; i++) if (kindOf(S.g[i]) === CRAFTED) n++; return n; };
    const desUsed = (S) => { let n = (S.dj ? 1 : 0) + (S.du ? 1 : 0); for (let i = 0; i < G; i++) if (kindOf(S.g[i]) === DESECRATED) n++; return n; };
    /** A target the item does not have yet (nothing of it, or only its twin of another element). */
    const wanted = (x) => x === ABSENT || x === TWIN;

    /**
    /** The targets of side si that are on the item, or kept out by a modifier of their own group (a bit each). */
    // (a twin of the target's own group, as the element damage prefixes of a wand, staff or focus are, keeps that group
    // out of the pool like the target would; a twin of another group, as a resistance is, does not)
    const twinGrp = goals.map((g, i) => {
      if (!conv[i] || !g.grp.length) return false;
      const src = P.sidePool(ctx, g.side, 0).filter((e) => conv[i].src.has(e.id));
      return src.length > 0 && src.every((e) => e.grp.some((x) => g.grp.includes(x)));
    });
    const presentMask = (S, si) => { let m = 0; for (let i = 0; i < G; i++) if (goals[i].si === si && there(S.g[i]) && (S.g[i] !== TWIN || twinGrp[i])) m |= 1 << i; return m; };
    /** The modifiers nobody asked for and nobody knows, on side si (the pasted item's fractured one is known). */
    // A crafted or a Desecrated modifier nobody asked for is no draw from the pool like the others. The crafted one is
    // an essence's own modifier (the tool's, where there is one for that side: CXM), the Desecrated one mostly a
    // desecrated-only modifier (the option of the highest level is taken on a miss: DJD says whether that is mostly
    // a desecrated-only one). What they take out of the pool is their own groups (knownTake), which is mostly
    // nothing, where an average modifier takes a fifth of the pool with it: counted as average ones, a mace with the
    // tool's modifier on it was promised a tenth too cheap.
    // (S.ct says whose the crafted one is: 1 the aimed tool's of its side, 2 the unaimed one's, 0 not known)
    const CXM = (si, ct) => (ct === 1 && TOOL[si] ? kb.mods[TOOL[si].mod] : ct === 2 && FILL[si] ? kb.mods[FILL[si].mod] : null);
    const DJL = [0, 1].map((si) => (ctx.bone ? P.desPoolFor(ctx, SIDES[si], 0, null) : []));
    // PDV: the chance that the option taken on a miss is a desecrated-only one: one desecrated-only option of three
    // (80%), two (15%) or three, and the highest of the three is taken
    const PDV = [0, 1].map((si) => {
      if (!DJL[si].length) return 0;
      const pb = 1 - atLeast(si, 0, DJL[si].reduce((x, e) => Math.max(x, e.lvl), 0) + 1);
      return 0.8 * pb * pb + 0.15 * pb + 0.05;
    });
    const DJD = PDV.map((p) => p >= 0.5);
    const unknown = (S, si) => S.j[si] + (S.fj === si + 1 && !(S.kf && FRAC.si === si) ? 1 : 0) + (S.cx === si + 1 && !CXM(si, S.ct) ? 1 : 0) + (S.cy === si + 1 && !CXM(si, S.cu) ? 1 : 0) + (S.dj === si + 1 && !DJD[si] ? 1 : 0);
    /** What the crafted (kind 0) or the Desecrated (kind 1) modifier nobody asked for takes from the anonymous weight of side si in pool s. */
    function knownTake(s, si, kind, ct) {
      const key = 'k' + kind + (ct || '');
      let v = s.takes.get(key);
      if (v == null) {
        v = 0;
        if (kind === 0) { const m = CXM(si, ct); for (let q = 0; q < s.pool.length; q++) if (s.anon[q] && s.pool[q].grp.some((x) => m.grp.includes(x))) v += s.ws[q]; }
        else for (const e of DJL[si]) for (let q = 0; q < s.pool.length; q++) if (s.anon[q] && s.pool[q].grp.some((x) => e.grp.includes(x))) v += s.ws[q] / DJL[si].length;
        s.takes.set(key, v);
      }
      return v;
    }
    /** The share of side si's anonymous weight (J0 of it) that those two leave. */
    function knownLeft(S, si, s, J0) {
      let g = 1;
      if (!(J0 > 0)) return g;
      if (S.cx === si + 1 && CXM(si, S.ct)) g *= Math.max(0, 1 - knownTake(s, si, 0, S.ct) / J0);
      if (S.cy === si + 1 && CXM(si, S.cu)) g *= Math.max(0, 1 - knownTake(s, si, 0, S.cu) / J0);
      if (S.dj === si + 1 && DJD[si]) g *= Math.max(0, 1 - knownTake(s, si, 1) / J0);
      return g;
    }
    /** What the cases of a side's pool share: the tags of the other side, the pasted item's fractured modifier, the dominant group. */
    function mix(S, si, s, floor, tm) {
      const NM = s.left.length - 1;
      const n = Math.min(unknown(S, si), NM), m = unknown(S, 1 - si);
      // the other side's modifiers stop a share of this side's pool with their tags
      const share = m ? stats(1 - si, floor, 1, S.u, tm, presentMask(S, 1 - si)).across[Math.min(m, NM)] : 1;
      if (!s.big) return { NM, n, share, f: (S.kf && s.J > 0 ? Math.max(0, 1 - s.fracTake / s.J) : 1) * knownLeft(S, si, s, s.J), q: 1, fracIn: false };
      // the pasted item's fractured modifier is of the dominant group: that group is known to be on the item
      const fracIn = !!(S.kf && FRAC.si === si && FRAC.grp.includes(s.big.key));
      const JR = s.J - s.big.w;
      const f = (S.kf && !fracIn && JR > 0 ? Math.max(0, 1 - s.fracTake / JR) : 1) * knownLeft(S, si, s, JR);
      // q: none of the n modifiers is of the dominant group (each was drawn from what the ones before it left)
      let q = fracIn ? 0 : 1;
      for (let k = 0; k < n && q > 0; k++) q *= s.leftR[k] * f / (s.big.w + s.leftR[k] * f);
      return { NM, n, share, f, q, fracIn };
    }
    /** The pool of side si on item S as cases: [{p, pool, big}] (big: the dominant group can still roll). */
    function cases(S, si, s, floor, tm) {
      const x = mix(S, si, s, floor, tm), mineAll = s.W - s.J; // (mineAll: the entries of the targets still wanted here)
      if (!s.big) return [{ p: 1, pool: mineAll + s.left[x.n] * x.share * x.f, big: true }];
      const out = [];
      if (x.q > 1e-12) out.push({ p: x.q, pool: mineAll + (s.big.w + s.leftR[x.n] * x.f) * x.share, big: true });
      if (x.q < 1 - 1e-12) out.push({ p: 1 - x.q, pool: mineAll - s.big.mineW + s.leftR[x.fracIn ? x.n : Math.max(0, x.n - 1)] * x.f * x.share, big: false });
      return out;
    }
    /**
     * Chance that none of the modifiers nobody asked for keeps natural target i out: none of its own side is of its
     * group or stops it with its tags, and none of the other side stops it.
     */
    function unblocked(S, i, floor, ownIsCase) {
      // (the pool at the minimum modifier level of the orb in use: the modifiers on the item mostly came from orbs of
      // that tier. Measured on ten cheap scenarios against the level 0 pool: mean error 2.5% against 3.1%.)
      const g = goals[i], tm = tagMask(S);
      let p = 1;
      // (a followed target: its blockers on its own side are states. ownIsCase: the target is of the dominant group;
      // whether a modifier of that group is on the item is a case)
      const n = ownIsCase || followed[i] ? 0 : unknown(S, g.si);
      if (n) { const s0 = stats(g.si, floor || 0, 1, S.u, tm, presentMask(S, g.si)); if (s0.W > 0) p *= Math.pow(1 - Math.min(1, s0.low[i] / s0.W), n); }
      const m = TRACK ? 0 : unknown(S, 1 - g.si); // (with blockers followed, one of the other side is a state too)
      if (m) { const sx = stats(1 - g.si, floor || 0, 1, S.u, tm, presentMask(S, 1 - g.si)); if (sx.W > 0 && sx.cross[i] > 0) p *= Math.pow(1 - Math.min(1, sx.cross[i] / sx.W), m); }
      // another target's twin of another element on the item may stop this one with its tags
      for (let k = 0; k < G; k++) if (S.g[k] === TWIN && twinStops[k] && !(TRACK && goals[k].si !== g.si)) p *= 1 - twinStops[k][i];
      return p;
    }
    /** A random modifier for the open sides in `mask` (bit 0 prefix, bit 1 suffix): [[chance, goal index or -1, side, status]]. */
    function roll(S, mask, floor, mult) {
      const tm = tagMask(S), sides = [];
      for (let si = 0; si < 2; si++) {
        if (!(mask & (1 << si))) continue;
        const s = stats(si, floor, mult, S.u, tm, presentMask(S, si));
        const cs = cases(S, si, s, floor, tm).filter((c) => c.pool > 0);
        if (!cs.length) continue;
        // what can roll for a target on this side: [weight, target, status, of the dominant group]
        const ws = [], at = new Map(), betas = new Float64Array(G).fill(1);
        const put = (w, i, status, inBig) => { at.set(i * 16 + status, ws.length); ws.push([w, i, status, inBig]); };
        // what is in target i's way: the part that also keeps a wanted target of the other side out apart, with
        // those targets (xm), when blockers are followed across the sides
        const putLow = (i) => {
          let rest = s.low[i];
          const lx = TRACK ? s.lowX[i] : null;
          if (lx) for (const [m, w] of lx) {
            let live = 0;
            for (let k = 0; k < G; k++) if (((m >> k) & 1) && S.g[k] === ABSENT) live |= 1 << k;
            const ww = live ? Math.min(rest, w) : 0;
            if (ww > 0) { ws.push([ww, i, BLOCKED, false, live]); rest -= ww; }
          }
          if (rest > 0) put(rest, i, BLOCKED, false);
        };
        for (let i = 0; i < G; i++) {
          const g = goals[i];
          if (!wanted(S.g[i]) || g.si !== si) continue;
          // a rolled modifier of the group of a Desecrated or crafted-only target is known as such (bones, essences and alloys are too dear to waste)
          if (g.kind !== 'nat') { if (s.low[i] > 0) putLow(i); continue; }
          // an unknown modifier is of the target's group, or stops it with its tags, with some chance: then it cannot roll
          const inBig = !!(s.big && s.big.has.has(i));
          const beta = unblocked(S, i, floor, inBig);
          betas[i] = beta;
          if (s.ok[i] > 0) put(s.ok[i] * beta, i, NATURAL, inBig);
          if (s.nearW[i] > 0) put(s.nearW[i] * beta, i, NATURAL + NEAR, inBig);
          if (followed[i] && s.low[i] > 0) putLow(i);
          // (what keeps the target out keeps its twin of another element out as well: they are of one group)
          if (S.g[i] === ABSENT && s.twin[i] > 0) {
            let rest = s.twin[i];
            const tx = TRACK ? s.twinX[i] : null;
            if (tx) for (const [m, w] of tx) {
              let live = 0;
              for (let k = 0; k < G; k++) if (((m >> k) & 1) && S.g[k] === ABSENT) live |= 1 << k;
              const ww = live ? Math.min(rest, w) : 0;
              if (ww > 0) { ws.push([ww * beta, i, TWIN, false, live]); rest -= ww; }
            }
            if (rest > 0) put(rest * beta, i, TWIN, false);
          }
        }
        // a modifier that is something for two targets has one status: the others' weights lose it (see stats, multi)
        for (const roles of s.multi) {
          let win = -1;
          const live = roles.map(([i, kind], k) => {
            const g = goals[i];
            const on = wanted(S.g[i]) && (kind === 3 ? g.kind !== 'nat' || followed[i] : g.kind === 'nat' && (kind !== 2 || S.g[i] === ABSENT));
            if (on && (win < 0 || kind < roles[win][1])) win = k;
            return on;
          });
          for (let k = 0; k < roles.length; k++) {
            if (!live[k] || k === win) continue;
            const [i, kind, a, b] = roles[k];
            const cut = (status, w) => { const q = at.get(i * 16 + status); if (q !== undefined && w > 0) ws[q][0] = Math.max(0, ws[q][0] - w); };
            if (kind === 0) { cut(NATURAL, a * betas[i]); cut(NATURAL + NEAR, b * betas[i]); } else if (kind === 2) cut(TWIN, a * betas[i]); else cut(BLOCKED, a);
          }
        }
        // a modifier of this side that stops a wanted target of the other side: [share of the anonymous ones, target]
        const xs = [];
        if (TRACK && s.J > 0) for (let k = 0; k < G; k++) if (goals[k].si !== si && S.g[k] === ABSENT && s.crossJ[k] > 0) xs.push([Math.min(1, s.crossJ[k] / s.J), k]);
        sides.push({ si, cs, ws, xs });
      }
      if (!sides.length) return [];
      const acc = new Map();
      let sum = 0;
      // (xm: the targets of the other side that the modifier keeps out as well; it travels in the status, above its four bits)
      const add = (p, i, si, status, xm) => { if (!(p > 0)) return; sum += p; const k = i * 64 + si * 32 + status + (xm || 0) * 8192; const e = acc.get(k); if (e) e[0] += p; else acc.set(k, [p, i, si, status + (xm || 0) * 16]); };
      const A = sides[0], B = sides[1] || null;
      for (const ca of A.cs) for (const cb of B ? B.cs : [null]) {
        const pc = ca.p * (cb ? cb.p : 1), total = ca.pool + (cb ? cb.pool : 0);
        for (const [sd, c] of cb ? [[A, ca], [B, cb]] : [[A, ca]]) {
          let hit = 0;
          for (const [w0, i, status, inBig, xm] of sd.ws) {
            if (inBig && !c.big) continue;
            const w = Math.min(c.pool - hit, w0);
            if (w > 0) { add(pc * w / total, i, sd.si, status, xm); hit += w; }
          }
          // the rest is a modifier nobody asked for; some of those stop a target of the other side (-2 - k: target k)
          let rest = c.pool - hit, left = 1;
          for (const [share, k] of sd.xs) { const f = Math.min(left, share); if (f > 0) { add(pc * rest * f / total, -2 - k, sd.si, 0); left -= f; } }
          add(pc * rest * left / total, -1, sd.si, 0);
        }
      }
      return [...acc.values()].map(([p, i, si, status]) => [p / sum, i, si, status]);
    }
    /** cls: the class of the new modifier's level, when it is one nobody asked for or one in a target's way (see LCUT). */
    function addRolled(S, i, si, status, cls) {
      const n = cp(S);
      const xm = status >> 4; // (targets of the other side that this modifier, in target i's way, keeps out as well)
      status &= 15;
      let junk = -1; // the side that gets one more modifier its class is about
      if (i >= 0) {
        // the twin stays on the item as another modifier (of the target's own tier, so of about its level)
        if (n.g[i] === TWIN && status !== TWIN) junkAt(n, goals[i].si, goalLvl[i]);
        if (status === BLOCKED) junk = goals[i].si;
      } else junk = si;
      const had = junk >= 0 && nSide(n, junk) > 0;
      if (i < -1) { n.j[si]++; if (n.g[-2 - i] === ABSENT) n.g[-2 - i] = XBLOCKED; } // (it stops target -2 - i of the other side)
      else if (i < 0) n.j[si]++;
      else n.g[i] = status || NATURAL;
      if (junk >= 0 && NCLS > 1 && cls != null) setCls(n, junk, had ? Math.min(clsAt(n, junk), cls) : cls);
      if (xm && i >= 0) for (let k = 0; k < G; k++) if (((xm >> k) & 1) && n.g[k] === ABSENT) { n.g[k] = XBLOCKED; n.xg |= 1 << goals[i].si; }
      return n;
    }
    /** The modifiers a removal can take: [{w, k, i, si}] (w: how many of them). pred(side, desecrated). */
    /** Does a plain other modifier of side si keep a target of the other side out (XBLOCKED, and not by the fractured one)? */
    const xOn = (S, si) => { if (!S.j[si] || ((S.xg >> si) & 1)) return false; for (let i = 0; i < G; i++) if (S.g[i] === XBLOCKED && goals[i].si !== si && !fracBlocks.has(i)) return true; return false; };
    /** The plain others of a side as removal units: the one that keeps a target out ('jx') apart from the rest. */
    function plain(S, si) {
      if (!xOn(S, si)) return [{ w: S.j[si], k: 'j', si }];
      return S.j[si] > 1 ? [{ w: 1, k: 'jx', si }, { w: S.j[si] - 1, k: 'j', si }] : [{ w: 1, k: 'jx', si }];
    }
    function units(S, pred) {
      const out = [];
      for (let i = 0; i < G; i++) if (there(S.g[i]) && S.fg !== i && pred(goals[i].si, kindOf(S.g[i]) === DESECRATED)) out.push({ w: 1, k: 'g', i, si: goals[i].si });
      for (let si = 0; si < 2; si++) if (S.j[si] && pred(si, false)) out.push(...plain(S, si));
      if (S.cx && pred(S.cx - 1, false)) out.push({ w: 1, k: 'cx', si: S.cx - 1 });
      if (S.cy && pred(S.cy - 1, false)) out.push({ w: 1, k: 'cy', si: S.cy - 1 });
      if (S.dj && pred(S.dj - 1, true)) out.push({ w: 1, k: 'dj', si: S.dj - 1 });
      if (S.du && pred(S.du - 1, true)) out.push({ w: 1, k: 'du', si: S.du - 1 });
      if (S.aw && pred(awSide(S), false)) out.push({ w: 1, k: 'aw', si: awSide(S) });
      return out;
    }
    function removeUnit(S, u) {
      const n = cp(S);
      // (kx: the pasted item's own other modifiers are all still there; which one a removal took is not known)
      if (u.k !== 'du' && u.k !== 'aw' && !(u.k === 'g' && S.g[u.i] !== BLOCKED)) n.kx = 0;
      if (u.k === 'g') n.g[u.i] = ABSENT;
      else if (u.k === 'j') n.j[u.si]--;
      else if (u.k === 'jx') { n.j[u.si]--; for (let i = 0; i < G; i++) if (n.g[i] === XBLOCKED && goals[i].si !== u.si && !fracBlocks.has(i)) n.g[i] = ABSENT; }
      else n[u.k] = 0;
      return canon(n);
    }
    /**
     * Unit u of node S, one of the modifiers its side's class is about, is removed and others of that side are left:
     * the chance that the lowest of those is of the next class (the removed one was the only one of its class).
     * lowest: the removed one was the lowest of them (Omen of Whittling); else it was any of them.
     */
    function rise(S, u, lowest) {
      if (NCLS < 2 || !(u.k === 'j' || u.k === 'jx' || (u.k === 'g' && S.g[u.i] === BLOCKED))) return 0;
      const c = clsAt(S, u.si), n = nSide(S, u.si);
      if (c >= NCLS - 1 || n < 2) return 0;
      const sA = c === 0 ? 1 : atLeast(u.si, 0, LCUT[c - 1]), sB = atLeast(u.si, 0, LCUT[c]);
      const p = sA > 0 ? Math.max(0, Math.min(1, 1 - sB / sA)) : 0; // one of them is of this class, given that it is of this class or over
      if (!(p > 0) || p >= 1) return 0;
      const one = n * p * Math.pow(1 - p, n - 1) / (1 - Math.pow(1 - p, n)); // exactly one of them is of this class
      return Math.max(0, Math.min(1, lowest ? one : one / n));
    }
    /** Node S without unit u, by chance: [[chance, node]] (the class of the side may rise, see rise). */
    function without(S, u, lowest) {
      const S1 = removeUnit(S, u), up = rise(S, u, lowest);
      if (!(up > 0)) return [[1, S1]];
      const S2 = cp(S1);
      setCls(S2, u.si, clsAt(S, u.si) + 1);
      return [[1 - up, S1], [up, S2]];
    }
    const openMask = (S) => (open(S, 0) > 0 ? 1 : 0) | (open(S, 1) > 0 ? 2 : 0);
    /**
     * Chance that none of the unknown modifiers of the target's side is of its group (a crafted modifier is refused
     * then). 1 for a crafted-only target: its blockers are known as a state.
     */
    function clear(S, i) {
      const g = goals[i];
      if (g.kind !== 'nat' || followed[i]) return 1;
      const s0 = stats(g.si, 0, 1, S.u, tagMask(S), presentMask(S, g.si)), n = others(S, g.si);
      return n && s0.W > 0 ? Math.pow(1 - Math.min(1, s0.low[i] / s0.W), n) : 1;
    }
    /**
     * Omen of Whittling: the Chaos Orb removes the modifier of the lowest level. [[chance, unit]], and only where the
     * node tells who that is: a side holds a modifier nobody asked for whose class lies under every level the targets
     * on the item can have. The omen then takes one of those for certain (the way crafters use it: "it is a whittle
     * angle" when the lowest modifier is one to lose). Elsewhere the edge is not offered (null): within a class the
     * levels are not known, and a modifier that once survived the omen survives it again, which no chance drawn anew
     * at every use describes (a quiver's route that used the omen there was promised at an eighth of what it cost).
     * Also null with a hidden modifier (its level is not known).
     */
    const whitMemo = new Map();
    function levelsOn(i, x) {
      const g = goals[i];
      // (made by an essence: that essence's modifier)
      if (kindOf(x) === CRAFTED && (g.rareEss || g.magicEss)) { const l = [g.rareEss, g.magicEss].filter(Boolean).map((r) => kb.mods[r.mod].lvl); return l.map((lvl) => [lvl, 1 / l.length]); }
      return goalLv[i];
    }
    function whittled(S) {
      if (S.du || NCLS < 2) return null;
      let sig = S.fl + '|' + S.fg + '|';
      for (let i = 0; i < G; i++) sig += S.g[i];
      sig += '|' + S.j[0] + S.j[1] + (xOn(S, 0) ? 1 : 0) + (xOn(S, 1) ? 1 : 0);
      if (whitMemo.has(sig)) return whitMemo.get(sig);
      // the lowest level a target on the item can have (a fractured one is not removed: it does not count)
      let low = Infinity;
      const anon = [];
      for (let i = 0; i < G; i++) {
        const x = S.g[i];
        if (!there(x) || S.fg === i) continue;
        if (x === BLOCKED) anon.push({ k: 'g', i, si: goals[i].si, w: 1 });
        else for (const e of levelsOn(i, x)) if (e[0] < low) low = e[0];
      }
      for (let si = 0; si < 2; si++) if (S.j[si]) anon.push(...plain(S, si));
      // the sides whose lowest such modifier is surely under that level (with no target to lose, any of them)
      const sure = [0, 1].filter((si) => nSide(S, si) > 0 && (low === Infinity || (clsAt(S, si) < NCLS - 1 && LCUT[clsAt(S, si)] <= low)));
      let out = null;
      if (sure.length) {
        // (two such sides: the lowest of all is on either, by how many each holds)
        const us = anon.filter((u) => sure.includes(u.si)), tw = us.reduce((x, u) => x + u.w, 0);
        if (tw > 0) out = us.map((u) => [u.w / tw, u]);
      }
      whitMemo.set(sig, out);
      return out;
    }

    // ---- the Well of Souls: what the three options offer, and which one the player takes
    const desCache = new Map();
    function desList(si, floor, lich) {
      const k = si + '|' + floor + '|' + (lich || '');
      if (!desCache.has(k)) desCache.set(k, P.desPoolFor(ctx, SIDES[si], floor, lich || null));
      return desCache.get(k);
    }
    /** [[chance, goal index or -1, status]] for a desecrated modifier revealed on side si of S (S without the hidden modifier). */
    /**
     * The desecrated-only modifiers the Well can offer on this item: none of a group that is on it. Known for the
     * targets that are there and, while the pasted item's own other modifiers are all still there (S.kx), for those
     * (a quiver with a Critical Hit Chance suffix leaves Kurgal one suffix to offer, not two).
     */
    function desFor(S, si, floor, lich) {
      const list = desList(si, floor, lich);
      const tg = [];
      for (let i = 0; i < G; i++) if (there(S.g[i]) && S.g[i] !== TWIN && S.g[i] !== BLOCKED) for (const x of goals[i].grp) tg.push(x);
      if (!S.kx && !S.kf && !tg.length) return list;
      return list.filter((e) => !e.grp.some((x) => (S.kx && OWN.has(x)) || (S.kf && FRAC.grp.includes(x)) || tg.includes(x)));
    }
    const offMemo = new Map();
    /**
     * Chance that one unknown modifier of side si is of a desecrated-only modifier's group (and keeps it off the list).
     * Not counted: modifiers of the target's own group (grp): with one of those on the item the target is "in the way",
     * a state of its own, so here none is.
     */
    function offBy(e, si, grp) {
      const k = e.id + '|' + si + '|' + grp.join(',');
      if (!offMemo.has(k)) {
        const pool = P.sidePool(ctx, SIDES[si], 0);
        let w = 0, tot = 0;
        for (const o of pool) { if (o.grp.some((x) => grp.includes(x))) continue; tot += o.w; if (o.grp.some((x) => e.grp.includes(x))) w += o.w; }
        offMemo.set(k, tot > 0 ? w / tot : 0);
      }
      return offMemo.get(k);
    }
    /**
     * The Well's list next to n unknown modifiers, for a target with `hits` entries on it: {size: the list's expected
     * length, pick: the chance that one even draw from it is the target, kin: how many of the others are of the
     * target's own group (expected), kinShare: their share among the others}. Every other entry is there with its
     * own chance (none of the n is of its group); `pick` averages hits / (hits + how many others are there).
     */
    function listFor(list, isHit, si, n, grp, gone) {
      const stay = [];
      let hits = 0, kin = 0, all = 0;
      // (gone: desecrated-only modifiers that are on the item already, which ones is not known: each other entry is
      // off the list with the same chance)
      const others = list.reduce((x, e) => x + (isHit(e) ? 0 : 1), 0), keep = gone > 0 && others > 0 ? Math.max(0, 1 - gone / others) : 1;
      for (const e of list) {
        if (isHit(e)) { hits++; continue; }
        const p = (n > 0 ? Math.pow(1 - offBy(e, si, grp), n) : 1) * keep;
        stay.push(p); all += p;
        if (e.grp.some((x) => grp.includes(x))) kin += p; // of the target's own group: once it is an option, the target cannot be one
      }
      // how many of the others are there: the distribution of a sum of independent yes/no
      let dist = [1];
      for (const p of stay) { const d2 = new Array(dist.length + 1).fill(0); for (let k = 0; k < dist.length; k++) { d2[k] += dist[k] * (1 - p); d2[k + 1] += dist[k] * p; } dist = d2; }
      let pick = 0, size = hits;
      for (let k = 0; k < dist.length; k++) { if (hits) pick += dist[k] * hits / (hits + k); size += dist[k] * k; }
      return { size, pick, kin, kinShare: all > 0 ? kin / all : 0 };
    }
    // The target to take first when the Well of Souls offers several: a Desecrated one, then the base modifier that is
    // rarest in the pool (the one hardest to get any other way).
    const wellRank = goals.map((g, i) => { if (g.kind === 'des') return -1; if (g.kind !== 'nat') return Infinity; const s = stats(g.si, 0, 1, 0, 0, 0); return s.ok[i] + s.nearW[i]; });
    /**
     * The desecrated-only options next to a base modifier target of groups `grp`. They are drawn before the base
     * options and no two options share a group, so each of them is one of two things for the target: of its own group
     * (a wand's "#% increased Elemental Damage" is of the group of its Cold Damage), which ends the target's chance, or
     * of other groups, whose base modifiers it takes out of the pool ("+# to Strength and Dexterity" takes both
     * attributes). -> {kin: the chance of the first for one such option, take: the weight another one takes, of the
     * base modifiers that are in the pool s: those nobody knows are there with the share `surv`}.
     */
    function exNext(list, si, s, n, grp, surv) {
      if (!list.length) return { kin: 0, take: 0 };
      const key = list.length + '|' + (list[0].lich || '') + '|' + n + '|' + grp.join(',') + '|' + surv.toFixed(4);
      let r = s.takes.get(key);
      if (r) return r;
      let all = 0, kin = 0, take = 0;
      for (const e of list) {
        const p = n > 0 ? Math.pow(1 - offBy(e, si, grp), n) : 1; // (it is on the list: none of the n is of its group)
        all += p;
        if (e.grp.some((x) => grp.includes(x))) { kin += p; continue; }
        let w = 0;
        for (let q = 0; q < s.pool.length; q++) {
          const o = s.pool[q];
          if (o.grp.some((x) => grp.includes(x)) || !o.grp.some((x) => e.grp.includes(x))) continue;
          w += s.ws[q] * (s.anon[q] ? surv : 1);
        }
        take += p * w;
      }
      r = all > 0 ? { kin: kin / all, take: all - kin > 0 ? take / (all - kin) : 0 } : { kin: 0, take: 0 };
      s.takes.set(key, r);
      return r;
    }
    /**
     * Chance that a base modifier target is among `draws` base options of the Well. The options are drawn one after the
     * other and no two share a group: an option of the target's own group (a lower tier) ends its chance, an option of
     * the dominant group takes that group out, any other one leaves less for the next. gone: what the desecrated-only
     * options drawn before them took along.
     */
    function wellNat(S, si, s, floor, tm, wnt, draws, gone) {
      const x = mix(S, si, s, floor, tm), mineAll = s.W - s.J;
      const inBig = !!(s.big && s.big.has.has(wnt.i));
      // [chance that the target can still come, the dominant group is in the pool, modifiers and options that are not of it]
      let states = !s.big ? [[1, true, x.n]] : [[x.q, true, x.n]].concat(inBig ? [] : [[1 - x.q, false, x.fracIn ? x.n : Math.max(0, x.n - 1)]]);
      let off = 0;
      for (let t = 0; t < draws; t++) {
        const next = [];
        for (const [p, bigIn, k] of states) {
          if (!(p > 1e-15)) continue;
          const kk = Math.min(k, x.NM);
          const bw = s.big && bigIn ? s.big.w * x.share : 0;
          const rest = (s.big ? s.leftR[kk] : s.left[kk]) * x.f * x.share;
          const pool = mineAll - (s.big && !bigIn ? s.big.mineW : 0) + bw + rest - gone;
          if (!(pool > 0)) continue;
          const w = Math.min(pool, wnt.w);
          off += p * w / pool;
          const kill = inBig ? 0 : Math.min(pool - w, wnt.low);
          const bigDraw = s.big && bigIn ? Math.max(0, Math.min(pool - w - kill, bw + s.big.mineW - (inBig ? w : 0))) : 0;
          const other = pool - w - kill - bigDraw;
          if (bigDraw > 0 && !inBig) next.push([p * bigDraw / pool, false, k]);
          if (other > 0) next.push([p * other / pool, bigIn, k + 1]);
        }
        states = next;
      }
      return off;
    }
    function reveal(S, si, floor, lich, echoes) {
      // (S.px: the entries that the desecrated-only modifiers of an Omen of Putrefaction's earlier reveals took off
      // the list, by id: the list is known exactly then)
      const ex0 = desFor(S, si, floor, null), ex = S.px ? ex0.filter((e) => !S.px.has(e.id)) : ex0, ll = lich ? desFor(S, si, floor, lich) : null;
      // modifiers nobody knows on this side (the pasted item's own are known while S.kx: the lists are cut already)
      // (S.pd: of those, the desecrated-only ones of an Omen of Putrefaction: they take list entries, not base modifiers)
      const unk = S.kx ? 0 : Math.max(0, unknown(S, si) - (S.pd || 0));
      const s = stats(si, floor, 1, S.u & R_ALDUR, tagMask(S), presentMask(S, si)); // (the Well of Souls does not offer a rune's pool: open test t33)
      const tm = tagMask(S), tm0 = tm;
      const want = [];
      for (let i = 0; i < G; i++) {
        const g = goals[i];
        if (!wanted(S.g[i]) || g.si !== si || g.rune) continue;
        if (g.kind === 'des') {
          const hit = (e) => e.fam === g.fam && fits(g, e);
          const c = ex.filter(hit).length, cl = ll ? ll.filter(hit).length : 0;
          const gone = S.px ? 0 : S.pd || 0;
          // (xb: the chance that no modifier of the other side is of the target's group; with the sides followed that is a state)
          let xb = 1;
          if (!TRACK) { const m = unknown(S, 1 - si); if (m) { const sx = stats(1 - si, floor || 0, 1, S.u, tm0, presentMask(S, 1 - si)); if (sx.W > 0 && sx.cross[i] > 0) xb = Math.pow(1 - Math.min(1, sx.cross[i] / sx.W), m); } }
          if (c || cl) want.push({ i, des: true, c, cl, hit, grp: g.grp, xb, share: pv[i], all: listFor(ex, hit, si, unk, g.grp, gone), lich: ll ? listFor(ll, hit, si, unk, g.grp, gone) : null });
        } else if (g.kind === 'nat' && !g.noWell && s.ok[i] + s.nearW[i] > 0) {
          const beta = unblocked(S, i, floor, !!(s.big && s.big.has.has(i)));
          // (what is left of the modifiers nobody knows next to the ones on the item, as a share: see mix)
          const x = mix(S, si, s, floor, tm), surv = s.J > 0 ? Math.min(1, s.left[x.n] * x.f * x.share / s.J) : 0;
          want.push({ i, des: false, w: (s.ok[i] + s.nearW[i]) * beta, low: s.low[i] * beta, share: s.ok[i] / (s.ok[i] + s.nearW[i]),
            ex: exNext(ex, si, s, unk, g.grp, surv), exl: ll && ll.length ? exNext(ll, si, s, unk, g.grp, surv) : null });
        }
      }
      if (!want.length) return [[1, -1, 0]];
      // which target to take when the Well offers more than one: wellRank (the same order on every item)
      want.sort((a, b) => wellRank[a.i] - wellRank[b.i]);
      // Desecrated targets come first, and their options are drawn from one list: that the first is offered and that
      // the second is are no independent things (one draw of nine is either with a chance of two ninths, not of
      // 1 - (8/9)^2). So the chance is taken for the first k of them together (uni[k]: counted as one target with
      // all their entries), and the k-th has what that adds to the first k - 1.
      const uni = [];
      {
        const ds = want.filter((w) => w.des), gone = S.px ? 0 : S.pd || 0;
        for (let m = 1; m <= ds.length; m++) {
          if (m === 1) { uni.push(ds[0]); continue; }
          const part = ds.slice(0, m), hitU = (e) => part.some((w) => w.hit(e)), grpU = [...new Set(part.flatMap((w) => w.grp))];
          const all = listFor(ex, hitU, si, unk, grpU, gone), lich = ll ? listFor(ll, hitU, si, unk, grpU, gone) : null;
          // (an option of one target's group ends that target's chance, not the others': a share of them)
          all.kin /= m; if (lich) lich.kinShare /= m;
          uni.push({ c: part.reduce((x, w) => x + w.c, 0), all, lich });
        }
      }
      const pick = new Float64Array(G);
      let missAll = 0;
      const chances = ex.length ? P.DES_OPTIONS : [1];
      for (let k = 0; k < chances.length; k++) {
        // desecrated-only options and base modifier options among the three (planner.js revealOptions)
        const nEx = ex.length ? k + 1 : 0;
        // (a desecrated-only option that cannot be drawn any more, the list being used up, is a base modifier instead)
        const lichFirst = ll && ll.length ? 1 : 0;
        const exDraws = Math.min(Math.max(0, nEx - lichFirst), Math.max(0, ex.length - lichFirst));
        const normDraws = 3 - lichFirst - exDraws;
        let rem = 1, nd = 0, before = 0, took = 0;
        for (const wnt of want) {
          let off;
          if (wnt.des) {
            // The lich's option is drawn first and is one of the desecrated-only ones: it is gone for the draws after
            // it. No two options share a group: an option of the target's own group ends the target's chance.
            const u = uni[nd++], first = ll && ll.length ? 1 : 0;
            let alive = 1, any = 0;
            if (first) { any = u.lich.pick; alive = (1 - u.lich.pick) * (1 - u.lich.kinShare); }
            for (let t = 0; t < exDraws && alive > 0; t++) {
              const size = Math.max(u.c, 1, u.all.size - first - t);
              const p = Math.min(1, u.c / size), k = Math.min(1 - p, u.all.kin / size);
              any += alive * p;
              alive *= 1 - p - k;
            }
            // (one of the first nd is offered with chance `any`: this one is taken when none of those before it is)
            off = Math.max(0, any - before) * wnt.xb;
            pick[wnt.i] += chances[k] * off;
            before = Math.max(before, any);
            took += off;
            rem = 1 - took;
            continue;
          } else {
            // (the desecrated-only options are drawn before the base ones: one of the target's own group ends its
            // chance, another one takes the base modifiers of its groups along)
            let alive = 1, gone = 0;
            if (lichFirst && wnt.exl) { alive *= 1 - wnt.exl.kin; gone += wnt.exl.take; }
            for (let t = 0; t < exDraws; t++) { alive *= 1 - wnt.ex.kin; gone += wnt.ex.take; }
            off = alive > 0 ? alive * wellNat(S, si, s, floor, tm, wnt, normDraws, gone) : 0;
          }
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
    /** The share of target k's twins (by weight) that a Flux to element `to` turns: all but those of that element itself. */
    const turnedMemo = new Map();
    function turnedBy(k, to) {
      const key = k + '|' + to;
      if (!turnedMemo.has(key)) {
        const own = to === 'chaos' ? null : new RegExp('^' + to + 'resistance$', 'i');
        let all = 0, off = 0;
        for (const e of P.sidePool(ctx, goals[k].side, 0)) if (conv[k].src.has(e.id)) { all += e.w; if (!(own && own.test(e.fam))) off += e.w; }
        turnedMemo.set(key, all > 0 ? off / all : 1);
      }
      return turnedMemo.get(key);
    }
    const N0 = { r: 0, g: new Array(G).fill(ABSENT), j: [0, 0], fg: -1, fj: 0, cx: 0, dj: 0, du: 0, q: 0, u: 0, fs: FSN, ad: AD0, aw: 0, kx: 0, kf: 0, fl: 0, ct: 0, cy: 0, cu: 0, xg: 0 };
    const RESTART = -1; // edge target: a fresh white base (its value is solved as one number, see solve)
    let hasLost = false; // (some node has a step that locks the item: see lostArmed)
    // (a finished item that is locked: one node for all of them)
    const FINISHED = (() => { const n = cp(N0); n.r = 2; for (let i = 0; i < G; i++) n.g[i] = goals[i].kind === 'des' ? DESECRATED : NATURAL; return n; })();
    /** "A random modifier goes and a random one comes" (no minimum modifier level): [[chance, node]]. */
    function swapped(S) {
      const us = units(S, () => true).filter((u) => openMask(removeUnit(S, u)) !== 0), tw = us.reduce((x, u) => x + u.w, 0), out = [];
      for (const u of us) { const S1 = removeUnit(S, u); for (const [p, i, si, status] of roll(S1, openMask(S1), 0)) out.push([p * u.w / tw, addRolled(S1, i, si, status)]); }
      return out;
    }
    const afterMemo = new Map();
    const missing = (S) => { let n = 0; for (let i = 0; i < G; i++) if (!met(S.g[i])) n++; return n; };
    /** Chance that the item is finished after exactly n such swaps (it is not asked in between). */
    function after(S, n) {
      if (!n) return done(S) ? 1 : 0;
      // (a swap adds one modifier: more targets missing than swaps left cannot be made up. One too few can: the
      // swap may remove a modifier in a target's way and add the target)
      if (missing(S) > n) return 0;
      const k = keyOf(S) + '|' + n;
      let v = afterMemo.get(k);
      if (v === undefined) { v = 0; for (const [p, S1] of swapped(S)) if (p > 0) v += p * after(S1, n - 1); afterMemo.set(k, v); }
      return v;
    }
    const sanctMemo = new Map();
    /** Chance that target i's value is at or over the wanted one after Sanctification; low: it is under it now. */
    function sanctChance(i, low) {
      const k = i * 2 + (low ? 1 : 0);
      if (sanctMemo.has(k)) return sanctMemo.get(k);
      const g = goals[i], span = SANCT_HI - SANCT_LO;
      const list = g.kind === 'des' ? P.desPoolFor(ctx, g.side, 0, null).filter((e) => e.fam === g.fam)
        : g.kind === 'ess' ? [g.rareEss, g.magicEss].filter(Boolean).map((r) => ({ id: r.mod, w: 1 }))
          : P.sidePool(ctx, g.side, 0).concat(g.rune && POOL ? P.runeSide(ctx, POOL.tag, g.side, 0) : []).filter((e) => e.fam === g.fam);
      let num = 0, den = 0;
      for (const e of list) {
        if (reach(e.id, g) < 0) continue;
        const r = P.rangeOf(ctx, e.id);
        if (!r) continue;
        const whole = Number.isInteger(r[0]) && Number.isInteger(r[1]), n = whole ? r[1] - r[0] + 1 : 200;
        for (let q = 0; q < n; q++) {
          const v = whole ? r[0] + q : r[0] + (r[1] - r[0]) * (q + 0.5) / n;
          if ((v < g.minValue) !== !!low) continue;
          // (whole values are rounded to the nearest: planner.js)
          const need = (whole ? g.minValue - 0.5 : g.minValue) / v;
          num += e.w / n * Math.max(0, Math.min(1, (SANCT_HI - need) / span));
          den += e.w / n;
        }
      }
      const out = den > 0 ? num / den : 0;
      sanctMemo.set(k, out);
      return out;
    }
    /**
     * Omen of Putrefaction: the chance that every target is on the item afterwards. A fractured modifier stays; every
     * other slot is filled at the Well, the prefixes first, one reveal after the other (Abyssal Echoes: the first
     * reveal's options can be drawn again). A target only an essence or a rune's pool gives cannot come that way.
     */
    const putMemo = new Map();
    function putrefied(S, floor, echoes) {
      const mk = S.fg + '|' + (S.fg >= 0 ? S.g[S.fg] : 0) + '|' + S.fj + '|' + S.u + '|' + S.kf + '|' + floor + '|' + (echoes ? 1 : 0);
      if (!putMemo.has(mk)) putMemo.set(mk, putrefied0(S, floor, echoes));
      return putMemo.get(mk);
    }
    /**
     * No target among the three options of a Putrefaction's reveal on side si: what is taken, by the rule the player
     * is given. A desecrated-only option that is in no missing target's way, and of two the one whose groups take the
     * most entries off the Well's list (the side's next reveals draw from what is left); with none, a base modifier.
     * One desecrated-only option of three in four reveals of five, else two (three, one reveal in twenty, counted as
     * two). -> [[chance, the ids that leave the list, or null for a base modifier]].
     */
    function missTaken(S, si, list) {
      const n = list.length;
      if (!n) return [[1, null, null]];
      const lack = [];
      for (let i = 0; i < G; i++) if (goals[i].si === si && wanted(S.g[i])) lack.push(goals[i]);
      const share = (a, b) => a.grp.some((x) => b.grp.includes(x));
      const hit = list.map((e) => lack.some((g) => g.kind === 'des' && e.fam === g.fam && fits(g, e)));
      const way = list.map((e, k) => !hit[k] && lack.some((g) => e.fam === g.fam || e.grp.some((x) => (g.grp || []).includes(x))));
      const takes = list.map((e, k) => (hit[k] || way[k] ? 0 : list.reduce((c, f, q) => c + (!hit[q] && share(e, f) ? 1 : 0), 0)));
      let W = 0;
      for (const e of list) W += e.w;
      const one = new Float64Array(n + 1), two = new Float64Array(n + 1); // (index n: a base modifier)
      let m1 = 0, m2 = 0;
      for (let a = 0; a < n; a++) {
        if (hit[a]) continue;
        const pa = list[a].w / W;
        one[way[a] ? n : a] += pa; m1 += pa;
        let W2 = 0;
        for (let b = 0; b < n; b++) if (b !== a && !share(list[a], list[b])) W2 += list[b].w;
        if (!(W2 > 0)) { two[way[a] ? n : a] += pa; m2 += pa; continue; }
        for (let b = 0; b < n; b++) {
          if (b === a || hit[b] || share(list[a], list[b])) continue;
          const p = pa * list[b].w / W2;
          two[takes[b] > takes[a] ? b : takes[a] > 0 ? a : n] += p; m2 += p;
        }
      }
      const out = [];
      for (let k = 0; k <= n; k++) {
        const p = (m1 > 0 ? 0.8 * one[k] / m1 : 0) + (m2 > 0 ? 0.2 * two[k] / m2 : 0);
        if (p > 0) out.push([p, k === n ? null : list.filter((f) => share(list[k], f)).map((f) => f.id), k === n ? null : list[k].grp]);
      }
      const tot = out.reduce((x, o) => x + o[0], 0);
      return tot > 0 ? out.map(([p, ids, grp]) => [p / tot, ids, grp]) : [[1, null, null]];
    }
    function putrefied0(S, floor, echoes) {
      const base = cp(N0);
      base.r = 2; base.u = S.u; base.fs = S.fs; base.ad = S.ad; base.kf = S.kf; base.fj = S.fj;
      if (S.fg >= 0) { base.fg = S.fg; base.g[S.fg] = S.g[S.fg]; }
      for (let i = 0; i < G; i++) if (base.g[i] === ABSENT && (goals[i].kind === 'ess' || goals[i].rune || goals[i].noWell)) return 0;
      // What is followed of the Well's lists is kept as small as the answer allows. On an amulet (11 and 20 entries)
      // every item that differed in what its misses had taken off either list was a state of its own: a network of
      // 1,600 nodes took 19 seconds where it takes a fifth of one without the omen, and a large one neither ended
      // nor fitted in memory. So:
      //  - an item that cannot be finished any more (a target missing on a side with no reveal left for it) is
      //    dropped at once, and one that is finished is not revealed further;
      //  - the entries a miss takes off its own side's list are followed only while a target of that side is missing
      //    and another reveal of the side follows (S.px);
      //  - what a prefix takes off the suffixes' list (S.py) is all that the second side is told of the first.
      const other = desList(1, floor, null);
      const ids = (x) => (x && x.size ? [...x].sort().join(',') : '');
      const key = (S2) => keyOf(S2) + '|' + (S2.pd || 0) + '|' + ids(S2.px) + '|' + ids(S2.py);
      const lacks = (S2, si) => { let n = 0; for (let i = 0; i < G; i++) if (goals[i].si === si && !met(S2.g[i])) n++; return n; };
      const merged = (list, change) => { const m = new Map(); for (const [p, Sa] of list) { change(Sa); const k = key(Sa), old = m.get(k); if (old) old[0] += p; else m.set(k, [p, Sa]); } return m; };
      let dist = new Map([[key(base), [1, base]]]), first = true;
      for (let si = 0; si < 2; si++) {
        for (let guard = 0; guard < 6; guard++) {
          if (late()) return 0;
          const next = new Map();
          let any = false;
          const put = (p, S2) => { if (!(p > 0)) return; const k = key(S2), old = next.get(k); if (old) old[0] += p; else next.set(k, [p, S2]); };
          for (const [p, Sa] of dist.values()) {
            const room = open(Sa, si);
            if (room < 1 || done(Sa)) { put(p, Sa); continue; }
            any = true;
            const need = lacks(Sa, si), follow = need > 0 && room > 1;
            let taken = null;
            for (const [q, i, status] of reveal(Sa, si, floor, null, echoes && first)) {
              if (i >= 0) {
                const S2 = addRolled(Sa, i, si, status);
                S2.pd = Sa.pd || 0; S2.px = Sa.px; S2.py = Sa.py;
                if (lacks(S2, si) <= room - 1) put(p * q, S2);
                continue;
              }
              // no target among the three: a desecrated-only modifier that takes entries off the Well's list of this
              // side, or a base modifier (missTaken)
              if (need > room - 1) continue; // (the reveal was the last one a missing target of this side had)
              if (!taken) { const l0 = desFor(Sa, si, floor, null); taken = missTaken(Sa, si, Sa.px ? l0.filter((e) => !Sa.px.has(e.id)) : l0); }
              for (const [pm, off, grp] of taken) {
                const S2 = cp(Sa);
                S2.j[si]++;
                S2.pd = (Sa.pd || 0) + (off ? 1 : 0); S2.px = Sa.px; S2.py = Sa.py;
                if (off) {
                  if (follow) { S2.px = new Set(Sa.px || []); for (const id of off) S2.px.add(id); }
                  // (no group twice on an item, whatever the side: the other side's list loses its entries of these groups)
                  if (si === 0) for (const f of other) if (f.grp.some((x) => grp.includes(x)) && !(S2.py && S2.py.has(f.id))) { if (S2.py === Sa.py) S2.py = new Set(Sa.py || []); S2.py.add(f.id); }
                }
                put(p * q * pm, S2);
              }
            }
          }
          dist = next;
          if (!any) break;
          first = false;
          // (more kinds of item than can be followed: the lists are counted from here on, not followed: S.pd)
          if (dist.size > 3000) dist = merged(dist.values(), (Sa) => { Sa.px = null; });
        }
        // the other side: none of its modifiers is on the item yet; its list is without what the first side took off it
        dist = merged([...dist.values()].filter(([, Sa]) => lacks(Sa, si) <= open(Sa, si)), (Sa) => { Sa.pd = 0; Sa.px = Sa.py && Sa.py.size ? Sa.py : null; Sa.py = null; });
      }
      let p = 0;
      for (const [q, Sa] of dist.values()) if (done(Sa)) p += q;
      return p;
    }
    /** A socket for a rune: the node with one socket less and what it costs first (an Artificer's Orb), or null. */
    function socket(S) {
      if (S.fs > 0) { const n = cp(S); n.fs--; return { S: n, cost: 0, pre: null }; }
      if (S.ad > 0) { const n = cp(S); n.ad--; return { S: n, cost: artificer, pre: { op: 'artificer' } }; }
      return null;
    }
    // Memory: a network of 140,000 nodes has three and a half million edges. The step of an edge ({op, tier, side,
    // ...}) is one of a few hundred: every edge with the same step shares one object (`same`), and an edge that is
    // the same at every node (a new base, an Orb of Extraction, a Putrefaction with its chance) is one object for all
    // of them (`shared`). Ten of 64 processes of a deep run ended at their 3.5 GB.
    const stepPool = new Map(), edgePool = new Map();
    const same = (a) => { const k = JSON.stringify(a); let x = stepPool.get(k); if (!x) { stepPool.set(k, a); x = a; } return x; };
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
        list.push({ a: same(a), cost, out });
      };
      /** A rolled modifier's node: one nobody asked for, or one in a target's way, arrives with the class of its level (a node per class under the item's). */
      const arrive = (S1, p, i, si, status, floor, out) => {
        if (NCLS > 1 && (i < 0 || (status & 15) === BLOCKED)) {
          const sj = i >= 0 ? goals[i].si : si;
          const d = clsDist(sj, floor), top = nSide(S1, sj) > 0 ? clsAt(S1, sj) : NCLS - 1;
          let rest = 0;
          for (let c = 0; c < NCLS; c++) { if (c >= top) rest += d[c]; else if (d[c] > 0) out.push([p * d[c], addRolled(S1, i, si, status, c)]); }
          if (rest > 0) out.push([p * rest, addRolled(S1, i, si, status, top)]);
        } else out.push([p, addRolled(S1, i, si, status)]);
      };
      const rolled = (S1, mask, floor, pre, mult) => { const out = []; for (const [p, i, si, status] of roll(S1, mask, floor, mult)) arrive(S1, p * (pre == null ? 1 : pre), i, si, status, floor, out); return out; };
      /** Several random modifiers one after the other (Orb of Alchemy, Omen of Greater Exaltation): [[chance, state]]. */
      const rolledN = (S1, count, maskOf, floor) => {
        let dist = new Map([[keyOf(S1), [1, S1]]]);
        for (let k = 0; k < count; k++) {
          const next = new Map();
          const put = (p, S2) => { const key = keyOf(S2), old = next.get(key); if (old) old[0] += p; else next.set(key, [p, S2]); };
          for (const [p, Sa] of dist.values()) {
            const outs = roll(Sa, maskOf(Sa), floor);
            if (!outs.length) { put(p, Sa); continue; }
            const got = [];
            for (const [q, i, si, status] of outs) arrive(Sa, p * q, i, si, status, floor, got);
            for (const [q, S2] of got) put(q, S2);
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
      /** An edge that does not depend on the node: made once (make pushes it), then the same object for every node. */
      const shared = (key, make) => { const e = edgePool.get(key); if (e) { list.push(e); return; } const n = list.length; make(); if (list.length > n) edgePool.set(key, list[list.length - 1]); };
      if (!NONEW && keyOf(S) !== keyOf(BOUND ? startS : N0)) shared('newbase', () => push({ op: 'newbase' }, baseCost, [[1, RESTART]]));
      // ---- steps that lock the item (Corrupted or Sanctified): it is finished then, or lost and a new base is due.
      // `lost`: the step with the chance p of finishing; the base of the other case is in its cost and its counts.
      const lost = (a, cost, p) => {
        if (!(p > 1e-12) || (NONEW && p < 1)) return;
        hasLost = true;
        shared(JSON.stringify(a) + '|' + cost + '|' + p, () => push(Object.assign(a, { bases: 1 - p, also: [['New base', 1 - p]] }), cost + (1 - p) * baseCost, p < 1 ? [[p, FINISHED], [1 - p, RESTART]] : [[1, FINISHED]]));
      };
      if (S.r === 2) {
        // Vaal Orb: one of four things, each as likely: nothing, a corruption enchantment, a socket (a jewel: a
        // modifier added past the limit or one removed), or one to three times "a random modifier goes and a random
        // one comes" (planner.js vaalOutcome). The last can finish an item that is short of targets.
        if (PR.vaal != null) {
          let p = (after(S, 1) + after(S, 2) + after(S, 3)) / 3;
          if (jewel) { let add = 0; for (let si = 0; si < 2; si++) for (const [q, i, sj, status] of roll(S, 1 << si, 0)) if (i >= 0 && done(addRolled(S, i, sj, status))) add += 0.5 * q; p += 0.5 * add; }
          lost({ op: 'vaal' }, PR.vaal, p / 4);
        }
        // Omen of Sanctification with a Divine Orb: every value is multiplied by a random 78% to 122% and the item is
        // Sanctified. For targets by value, when every target is on the item: each must end at or over its value.
        if (PR.sanct != null && PR.divine != null && !S.du) {
          let p = 1, any = false;
          for (let i = 0; i < G && p > 0; i++) {
            const x = S.g[i];
            if (!(met(x) || near(x))) { p = 0; break; }
            if (goals[i].minValue == null) continue;
            if (S.fg === i) { if (near(x)) p = 0; continue; } // (a fractured modifier's value is not altered)
            any = true;
            p *= sanctChance(i, near(x));
          }
          if (any) lost({ op: 'divine', sanctify: true }, PR.divine + PR.sanct, p);
        }
        // Omen of Putrefaction with a bone: every modifier that is not fractured goes, every slot gets a Desecrated
        // modifier chosen at the Well of Souls (one of three each), and the item is Corrupted.
        if (PR.putrefy != null) for (const b of bones) for (const echoes of [false, true]) {
          if (echoes && PR.echoes == null) continue;
          lost(Object.assign({ op: 'bone', quality: b.quality, putrefy: true }, echoes ? { echoes: true } : null), b.price + PR.putrefy + (echoes ? PR.echoes : 0), putrefied(S, b.floor, echoes));
        }
      }
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
            if (r.pHit < 1) { const S2 = cp(S1); addCrafted(S2, g.si, 0); outs.push([free * (1 - r.pHit), S2]); }
            push({ op: 'essence', item: r.item, mod: r.mod }, r.price, outs);
          }
        }
        if (PR.annul != null) {
          const us = units(S, () => true), tw = us.reduce((x, u) => x + u.w, 0);
          if (tw) push({ op: 'annul' }, PR.annul, us.flatMap((u) => without(S, u, false).map(([q, S1]) => [q * u.w / tw, S1])));
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
        const spent = (msk, floor) => { const out = rolled(S, msk, floor, null, m); for (const o of out) o[1].q = 0; return out; };
        for (const t of T.exalt) {
          push({ op: 'exalt', tier: t.tier, catalyse: true }, t.price + CAT.omen, spent(mask, t.floor));
          if (mask === 3) for (let si = 0; si < 2; si++) if (PR.exaltSide[si] != null) push({ op: 'exalt', tier: t.tier, side: SIDES[si], catalyse: true }, t.price + CAT.omen + PR.exaltSide[si], spent(1 << si, t.floor));
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
          for (const u of us) for (const [q, S1] of without(S, u, false)) outs.push(...rolled(S1, openMask(S1), t.floor, q * u.w / tw));
          push(v < 0 ? { op: 'chaos', tier: t.tier } : { op: 'chaos', tier: t.tier, side: SIDES[v] }, t.price + (v < 0 ? 0 : PR.erasure[v]), outs);
        }
        if (PR.whittling != null && WBEST) {
          // the omen at its best: whichever modifier the player would have it remove (see WBEST)
          if (!S.du) for (const u of units(S, () => true)) {
            const S1 = removeUnit(S, u), m1 = openMask(S1);
            if (m1) push({ op: 'chaos', tier: t.tier, whittle: true, ideal: true }, t.price + PR.whittling, rolled(S1, m1, t.floor));
          }
        } else if (PR.whittling != null && !WNONE) {
          const ws = whittled(S);
          if (ws) {
            const outs = [];
            for (const [p, u] of ws) for (const [q, S1] of without(S, u, true)) outs.push(...rolled(S1, openMask(S1), t.floor, p * q));
            push({ op: 'chaos', tier: t.tier, whittle: true }, t.price + PR.whittling, outs);
          }
        }
      }
      if (PR.annul != null) {
        for (let v = -1; v < 2; v++) {
          if (v >= 0 && PR.annulSide[v] == null) continue;
          const us = units(S, (si) => v < 0 || si === v), tw = us.reduce((x, u) => x + u.w, 0);
          if (tw) push(v < 0 ? { op: 'annul' } : { op: 'annul', side: SIDES[v] }, PR.annul + (v < 0 ? 0 : PR.annulSide[v]), us.flatMap((u) => without(S, u, false).map(([q, S1]) => [q * u.w / tw, S1])));
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
          // (aimed at the other side while its own side is full, the essence cannot be used at all: planner.js validate.
          // The fourth deep run's play was refused 223 such uses of Essence of Hysteria.)
          if (v >= 0 && v !== g.si && open(S, g.si) < 1) continue;
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
            if (r.pHit < 1) { const S2 = cp(S1); addCrafted(S2, g.si, 0); outs.push([p * (1 - r.pHit), S2]); }
          };
          if (tw) for (const u of us) give(removeUnit(S, u), u.w / tw); else if (v < 0) give(S, 1);
          push(Object.assign({ op: 'pessence', item: r.item, mod: r.mod }, v >= 0 ? { side: SIDES[v] } : null), r.price + (v >= 0 ? PR.crystal[v] : 0), outs);
        }
      }
      // an essence as a tool against the unwanted Desecrated modifier: aimed at its side with an Omen of
      // Crystallisation it removes one modifier of that side, and its own crafted modifier comes where it has room
      if (S.dj && craftedUsed(S) < capOf(S)) for (const T of TOOL) {
        const v = S.dj - 1;
        if (!T || PR.crystal[v] == null) continue;
        // (an essence whose own side is full removes from that side: aimed elsewhere it cannot be used, planner.js validate)
        if (T.si !== v && open(S, T.si) < 1) continue;
        const us = units(S, (si) => si === v), tw = us.reduce((x, u) => x + u.w, 0);
        if (!tw) continue;
        const outs = [];
        for (const u of us) for (const [q, S1] of without(S, u, false)) {
          // (the tool's own modifier from an earlier use is still there, with Astrid's Creativity: an essence does not
          // add a second modifier of its group, so nothing comes)
          if (!ownOn(S1, T.si, 1) && open(S1, T.si) > 0) addCrafted(S1, T.si, 1);
          outs.push([q * u.w / tw, S1]);
        }
        push({ op: 'pessence', item: T.item, mod: T.mod, side: SIDES[v], tool: true }, T.price + PR.crystal[v], outs);
      }
      // the same without an omen where the unwanted Desecrated modifier's side is full: the essence or alloy of that
      // side removes a modifier of that side
      if (S.dj && craftedUsed(S) < capOf(S) && FILL[S.dj - 1] && open(S, S.dj - 1) === 0) {
        const T = FILL[S.dj - 1], v = S.dj - 1;
        const mine = TOOL[v] && TOOL[v].item === T.item ? 1 : 2; // (S.ct: whose modifier the crafted one then is)
        const us = units(S, (si) => si === v), tw = us.reduce((x, u) => x + u.w, 0);
        if (tw) {
          const outs = [];
          for (const u of us) for (const [q, S1] of without(S, u, false)) {
            if (!ownOn(S1, v, mine) && open(S1, v) > 0) addCrafted(S1, v, mine);
            outs.push([q * u.w / tw, S1]);
          }
          push({ op: 'pessence', item: T.item, mod: T.mod, tool: true }, T.price, outs);
        }
      }
      // Essence of the Abyss, then a bone on its Mark: one modifier of the aimed side goes, the Mark comes where there
      // is room (either side, even chances), and the desecration replaces the Mark
      if (ABYSS && bones.length && !desUsed(S) && craftedUsed(S) < capOf(S)) for (let v = 0; v < 2; v++) {
        if (PR.crystal[v] == null) continue;
        const us = units(S, (si) => si === v), tw = us.reduce((x, u) => x + u.w, 0);
        if (!tw) continue;
        // the step names the Mark of the aimed side (that side opens for certain); without one for this class, the
        // other side's, which needs room there (planner.js validate)
        const named = ABYSS.mods[v] ? v : open(S, 1 - v) > 0 ? 1 - v : -1;
        if (named < 0) continue;
        const land = [];
        for (const u of us) {
          const S1 = removeUnit(S, u), sides = [0, 1].filter((si) => ABYSS.mods[si] && open(S1, si) > 0);
          for (const si of sides) land.push([u.w / tw / sides.length, si, S1]);
        }
        if (!land.length) continue;
        const pre = { op: 'pessence', item: ABYSS.item, mod: ABYSS.mods[named], side: SIDES[v] };
        for (const b of bones) {
          const liches = [null];
          if (LICH_OK) for (let i = 0; i < G; i++) { const g = goals[i]; if (wanted(S.g[i]) && g.kind === 'des' && g.lich && price(OMEN.lich[g.lich]) != null && !liches.includes(g.lich)) liches.push(g.lich); }
          for (const lich of liches) for (const echoes of [false, true]) {
            if (echoes && PR.echoes == null) continue;
            // (the Mark's side is not the player's choice: a lich omen only where that lich has something to offer on
            // every side the Mark can come, else the Well would have nothing to reveal there)
            if (lich && !land.every(([, si, S1]) => desFor(S1, si, b.floor, lich).length > 0)) continue;
            const outs = [];
            let useful = false;
            for (const [p, si, S1] of land) for (const [q, i, status] of reveal(S1, si, b.floor, lich, echoes)) {
              if (i >= 0) useful = true;
              outs.push([p * q, revealed(S1, si, i, status)]);
            }
            if (useful) push(Object.assign({ op: 'bone', quality: b.quality, mark: true, pre }, lich ? { lich } : null, echoes ? { echoes: true } : null),
              ABYSS.price + PR.crystal[v] + b.price + (lich ? price(OMEN.lich[lich]) : 0) + (echoes ? PR.echoes : 0), outs);
          }
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
            const p = u.w / tw / fit.length;
            if (o.goal >= 0) {
              // a target by value arrives at or under its value
              const ok = Math.max(0, Math.min(1, reach(o.mod, goals[o.goal])));
              if (ok > 0) outs.push([p * ok, addRolled(S1, o.goal, o.si, CRAFTED)]);
              if (ok < 1) outs.push([p * (1 - ok), addRolled(S1, o.goal, o.si, CRAFTED + NEAR)]);
              continue;
            }
            const S2 = cp(S1);
            if (o.cap >= 0) S2.aw = o.cap + 1; else addCrafted(S2, o.si, 0);
            outs.push([p, S2]);
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
        // The twin kept for another resistance target is turned as well, unless it is of this Flux's own element (Void
        // Flux turns all three): it is then a second modifier of this Flux's resistance, one nobody asked for, and the
        // other target has no twin any more. (The route took the first Flux for one target and promised the second
        // one for the other: 48 ex promised where the item was worth 1,070.)
        let outs = [[1, S1]];
        for (let k = 0; k < G; k++) {
          if (S.g[k] !== TWIN || is.includes(k) || !conv[k] || conv[k].via !== 'flux' || S.fg === k) continue;
          const sh = turnedBy(k, to);
          if (!(sh > 0)) continue;
          const next = [];
          for (const [p, Sa] of outs) {
            const Sb = cp(Sa);
            Sb.g[k] = ABSENT; junkAt(Sb, goals[k].si, goalLvl[k]);
            next.push([p * sh, Sb]);
            if (sh < 1) next.push([p * (1 - sh), Sa]);
          }
          outs = next;
        }
        push({ op: 'flux', to }, conv[is[0]].price, outs);
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
          // (an essence's own modifier of another element is turned as well: it is no longer the tool's modifier the
          // node knew it as. A staff's "Gain % of Damage as Extra Cold Damage" became Extra Fire, and the finished
          // item had no node.)
          const turns = (si, kind) => { const m = kind === 1 && TOOL[si] ? TOOL[si].mod : kind === 2 && FILL[si] ? FILL[si].mod : null; if (!m) return false; const t = P.aldurTwin(ctx, m, ALD.to); return !!t && t !== m; };
          if (S1.cx && turns(S1.cx - 1, S1.ct)) S1.ct = 0;
          if (S1.cy && turns(S1.cy - 1, S1.cu)) S1.cu = 0;
          push(Object.assign({ op: 'aldur', item: ALD.rune }, sk.pre ? { pre: sk.pre } : null), ALD.price + sk.cost, [[1, canon(S1)]]);
        }
      }
      // Orb of Extraction: the item is destroyed and its augments come back, all but the socket-bound ones (Serle's
      // Triumph, the Runes of Aldur and the runes that open a pool stay in the socket for good: their game text).
      // Astrid's Creativity is the one the network sockets that comes back: giving the item up this way costs the orb
      // and returns the rune for the next base.
      if (EXTRACT != null && AST && AST.price != null && (S.u & R_ASTRID)) {
        if (!NONEW) shared('extraction', () => push({ op: 'extraction', bases: 1, also: [['New base', 1], [AST.item, -1]] }, EXTRACT + baseCost - AST.price, [[1, RESTART]]));
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
            for (const u of us) for (const [q, S1] of without(S, u, false)) land.push([q * u.w / tw, u.si, S1]);
          }
          if (!land.length) continue;
          const base = b.price + (v >= 0 ? PR.necro[v] : 0);
          const act = (extra) => Object.assign({ op: 'bone', quality: b.quality }, v >= 0 ? { side: SIDES[v] } : null, extra);
          // left hidden: it counts as a modifier and cannot be fractured, the reveal comes later
          // (a hair dearer than revealing at once, so it is chosen only where the hidden modifier earns something)
          if (b === bones[0] && PR.fracture != null && S.fg < 0 && !S.fj) push(act({ hide: true }), base + 1e-6, land.map(([p, si, S1]) => { const S2 = cp(S1); S2.du = si + 1; return [p, S2]; }));
          const liches = [null];
          if (LICH_OK) for (let i = 0; i < G; i++) { const g = goals[i]; if (wanted(S.g[i]) && g.kind === 'des' && g.lich && price(OMEN.lich[g.lich]) != null && !liches.includes(g.lich)) liches.push(g.lich); }
          for (const lich of liches) for (const echoes of [false, true]) {
            if (echoes && PR.echoes == null) continue;
            const outs = [];
            let useful = false;
            // (with a lich omen the modifier lands only on a side where that lich has something to offer: planner.js desSides)
            const at = lich ? land.filter(([, si, S1]) => desFor(S1, si, b.floor, lich).length > 0) : land;
            const tot = at.reduce((x, e) => x + e[0], 0);
            if (!(tot > 0)) continue;
            for (const [p, si, S1] of at) for (const [q, i, status] of reveal(S1, si, b.floor, lich, echoes)) {
              if (i >= 0) useful = true;
              outs.push([p / tot * q, revealed(S1, si, i, status)]);
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
      // Fracturing Orb: one of the modifiers that are not desecrated, each as likely; it needs four modifiers in all.
      // Not on an item with a crafted modifier nobody asked for: locked by the orb it would stay crafted and keep
      // counting for the crafted limit, and a node cannot tell a fractured crafted modifier from another fractured
      // one. (The fifth deep run's play was refused "Only one crafted modifier per item" 440 times on such items.)
      if (PR.fracture != null && S.fg < 0 && !S.fj && !S.cx && !S.cy && slots(S, 0) + slots(S, 1) >= 4) {
        const outs = [];
        let n = 0;
        for (let i = 0; i < G; i++) if (there(S.g[i]) && kindOf(S.g[i]) !== DESECRATED) { const S2 = cp(S); S2.fg = i; outs.push([1, S2]); n++; }
        for (let si = 0; si < 2; si++) if (S.j[si]) { const S2 = cp(S); S2.j[si]--; S2.fj = si + 1; outs.push([S.j[si], S2]); n += S.j[si]; }
        if (n) push({ op: 'fracture' }, PR.fracture, outs.map(([w, S2]) => [w / n, S2]));
      }
    }

    // ---- the item as a node
    /**
     * known: also mark a modifier that stands in a natural target's way (the pasted item's own; rolled ones are averaged
     * unless they are followed). known 3: only for the targets whose blockers the network follows (the states its
     * rolls lead to: an item with a modifier in an unfollowed target's way is then the node that has that modifier as
     * one nobody asked for, and still knows the rest; without this such an item fell back to the node that knows no
     * blocker at all, 13% of a staff's items in the sixth deep run's worst scenario). known 2: as true, but a modifier
     * that is in one target's way is not looked at for what its tags stop on the other side.
     */
    function nodeOf(st, known) {
      const S = cp(N0);
      const role = new Map(); // modifier -> 1 a target or its twin, 2 in a target's way
      const lowest = [Infinity, Infinity]; // per side, the lowest level among the modifiers nobody asked for and those in a target's way
      S.r = st.rarity === 'Rare' ? 2 : st.rarity === 'Magic' ? 1 : 0;
      S.q = CAT && st.catTag === CAT.tag && st.catQ > 0 ? (st.catQ >= 20 ? 2 : 1) : 0;
      if (RUNES) {
        S.u = (AST && st.xCrafted ? R_ASTRID : 0) | (SER && st.xSuffix ? R_SERLE : 0) | (POOL && (st.tags || []).includes(POOL.tag) ? R_POOL : 0) | (ALD && st.aldur ? R_ALDUR : 0);
        S.fs = Math.max(0, Math.min(3, P.freeSockets(ctx, st)));
        S.ad = Math.max(0, Math.min(2, canAdd - (st.sockets || 0)));
      }
      // (a modifier that meets a target first: after a Flux an item can hold two of one family, and the lower one must
      // not be read as "in the way" of a target that is on the item)
      const meetsOne = (m) => !m.unrevealed && goals.some((g) => g.side === m.side && P.meets(m, g, g.tier));
      const inOrder = st.mods.filter(meetsOne).concat(st.mods.filter((m) => !meetsOne(m)));
      for (const m of inOrder) {
        const si = m.side === 'prefix' ? 0 : 1;
        const free = (k) => wanted(S.g[k]) && goals[k].si === si;
        const kind = m.des ? DESECRATED : m.crafted ? CRAFTED : NATURAL;
        const i = m.unrevealed ? -1 : goals.findIndex((g, k) => free(k) && P.meets(m, g, g.tier));
        const v = i >= 0 || m.unrevealed ? -1 : goals.findIndex((g, k) => free(k) && P.nearMiss(m, g));
        const t = i >= 0 || v >= 0 || m.unrevealed || m.des || m.crafted ? -1 : goals.findIndex((g, k) => S.g[k] === ABSENT && goals[k].si === si && conv[k] && conv[k].src.has(m.id) && !(conv[k].via === 'aldur' && st.aldur));
        // not the target, but of its group (a lower tier, a sister modifier) or with tags that stop it: it stands in the target's way
        const b = i >= 0 || v >= 0 || t >= 0 || m.unrevealed || m.des || m.crafted ? -1 : goals.findIndex((g, k) => S.g[k] === ABSENT && goals[k].si === si && (g.kind !== 'nat' || (known && (known !== 3 || followed[k]))) && (m.fam === g.fam || (g.grp.length && (m.grp || []).some((x) => g.grp.includes(x))) || (m.id && kb.mods[m.id] && stops(m.id, k))));
        const set = (k, x) => { if (S.g[k] === TWIN) { S.j[si]++; lowest[si] = Math.min(lowest[si], goalLvl[k]); } S.g[k] = x; if (m.frac) S.fg = k; role.set(m, x === BLOCKED ? 2 : x === TWIN ? 3 : 1); if (x === BLOCKED) lowest[si] = Math.min(lowest[si], m.lvl || 1); };
        if (i >= 0) set(i, kind);
        else if (v >= 0) set(v, kind + NEAR);
        else if (t >= 0) set(t, TWIN);
        else if (b >= 0) set(b, BLOCKED);
        else if (m.id && ctx.capMods.get(m.id) && !m.frac) S.aw = ctx.capMods.get(m.id).prefix ? 1 : 2;
        else if (m.frac) S.fj = si + 1;
        else if (m.unrevealed) S.du = si + 1;
        else if (m.des) S.dj = si + 1;
        else if (m.crafted && (!S.cx || !S.cy)) addCrafted(S, si, TOOL[si] && m.id === TOOL[si].mod ? 1 : FILL[si] && m.id === FILL[si].mod ? 2 : 0);
        else { S.j[si]++; lowest[si] = Math.min(lowest[si], m.lvl || 1); }
      }
      if (NCLS > 1) for (let si = 0; si < 2; si++) if (nSide(S, si) > 0) setCls(S, si, clsOf(lowest[si] === Infinity ? 1 : lowest[si]));
      if (known && ownMatters && ownIds.every((id) => st.mods.some((m) => m.id === id))) S.kx = 1;
      if (known && FRAC && S.fj === FRAC.si + 1 && st.mods.some((m) => m.frac && m.id === FRAC.id)) S.kf = 1;
      // a modifier whose tags stop a target of the other side (known for the pasted item; rolled ones are averaged or
      // followed). Not a target that is on the item: what its tags stop is out of the pools while it is there
      // (tagMask), and what a twin stops is counted with the twin (twinStops).
      // (and one that is of a target's group: no group twice on an item, whatever the side)
      if (known) for (const m of st.mods) {
        if (!m.id || !kb.mods[m.id] || m.unrevealed) continue;
        if (role.get(m) === 1 || (known === 2 && role.get(m) === 2)) continue;
        const si = m.side === 'prefix' ? 0 : 1, tags = !!kb.mods[m.id].at;
        for (let k = 0; k < G; k++) if (S.g[k] === ABSENT && goals[k].si !== si && ((tags && stops(m.id, k)) || (goals[k].grp.length && m.fam !== goals[k].fam && (m.grp || []).some((x) => goals[k].grp.includes(x))))) {
          S.g[k] = XBLOCKED;
          if (role.get(m) === 2 || role.get(m) === 3) S.xg |= 1 << si; // (held by a modifier that is in a target's way on its own side, or by a twin: see canon)
        }
      }
      return S;
    }
    // targets that the pasted item's fractured modifier keeps out: for good on this item
    for (const m of st0.mods) if (m.frac && m.id && kb.mods[m.id] && kb.mods[m.id].at) for (let k = 0; k < G; k++) if (goals[k].si !== (m.side === 'prefix' ? 0 : 1) && stops(m.id, k)) fracBlocks.add(k);
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
    // (n0: the node a restart leads to: a white base, or with BOUND the item as it was pasted)
    const start = idOf(startS), n0 = BOUND ? start : idOf(cp(N0));
    for (const e of entries) e.id = idOf(e.S);
    // input.deadline (a time in ms, for the sweeps: a process must end on time): past it there is no answer
    const late = () => input.deadline > 0 && Date.now() > input.deadline;
    for (let q = 0; q < states.length; q++) {
      if (states.length > (input.maxStates || MAX_STATES)) return { unsupported: 'too many item states', states: states.length };
      if ((q & 1023) === 0 && late()) return { unsupported: 'out of time', states: states.length };
      expand(q);
    }
    const N = states.length;
    timing.expand = Date.now() - tick; tick = Date.now();
    // (the tables that only the edges were made from: hundreds of megabytes on a large network)
    statCache.clear(); afterMemo.clear(); putMemo.clear(); offMemo.clear(); stepPool.clear(); edgePool.clear();

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
    const luCache = blocks.map(() => null), luStale = new Uint8Array(blocks.length);
    function luOf(bi) {
      const b = blocks[bi], m = b.length, c = luCache[bi];
      if (c && !luStale[bi]) { let same = true; for (let li = 0; li < m; li++) if (c.pol[li] !== pol[b[li]]) { same = false; break; } if (same) return c; }
      luStale[bi] = 0;
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
    // How many times the blocks are gone through for exact values, at most. A loop that crosses blocks (a target is
    // lost and rolled again) settles by its chance per turn, so a craft of very many turns needs many passes: with
    // 600 a quiver's route of 25,000 white bases was valued a fifth too low, its values not yet settled.
    // After them the values of the nodes a route reaches are settled by accelerated sweeps (see anderson).
    const EXACT_PASSES = input.passes || 200;
    /**
     * The fixed point of `sweep` (it turns the vector X into the next one in place), for when the passes over the
     * blocks ran out before the values settled. A loop that crosses blocks (a target is lost and rolled again,
     * hundreds of times in a craft that costs a fortune) settles by its chance per turn, far too slowly for passes
     * alone: a quiver's route was valued a fifth too low after 600 of them and was not settled after 5,000. Here the
     * last few sweeps' changes are combined so that the slow loops' share of the error leaves at once (Anderson
     * acceleration: the least-squares mix of the last steps that would have made this sweep's change smallest).
     * mask: the nodes whose values must settle (those a route reaches; null: all). Somewhere no route goes a rule set
     * may never finish, and such nodes have no values to settle on.
     * True when it settled.
     */
    function anderson(X, mask, sweep) {
      const M = 10, dX = [], dF = [];
      const start = Float64Array.from(X);
      let x = Float64Array.from(X), xPrev = null, fPrev = null, done = false, sweeps = 0, best = Infinity, bestAt = 0;
      // (a rule set that never finishes somewhere has no values to settle on: when eighty sweeps bring nothing, stop)
      for (let it = 0; it < 800 && !done && it - bestAt <= 80; it++) {
        if (late()) break;
        X.set(x);
        sweep(); sweeps++;
        // f: what the sweep changed; settled when that is nothing next to the values (and next to the largest of them:
        // a chance of 1e-20 somewhere in the network need not be right to ten digits)
        const f = new Float64Array(N);
        let err = 0, big = 0;
        for (let i = 0; i < N; i++) { if (mask && !mask[i]) continue; const a = Math.abs(X[i]); if (a > big && a < BIG / 2) big = a; }
        const floor = 1e-14 * big + 1e-300;
        for (let i = 0; i < N; i++) { const g = X[i]; f[i] = g - x[i]; if (mask && !mask[i]) continue; const a = Math.abs(f[i]); if (a > 1e-300) { const e = a / (Math.abs(g) + floor); if (e > err) err = e; } }
        if (err <= 1e-10) { done = true; break; }
        if (err < best * 0.5) { best = err; bestAt = it; }
        if (fPrev) {
          const a = new Float64Array(N), b = new Float64Array(N);
          for (let i = 0; i < N; i++) { a[i] = x[i] - xPrev[i]; b[i] = f[i] - fPrev[i]; }
          dX.push(a); dF.push(b);
          if (dX.length > M) { dX.shift(); dF.shift(); }
        }
        const next = new Float64Array(N);
        for (let i = 0; i < N; i++) next[i] = x[i] + f[i];
        const m = dF.length;
        if (m) {
          // gamma = argmin |f - dF gamma|: the normal equations, m by m
          const G = new Float64Array(m * m), c = new Float64Array(m);
          for (let p = 0; p < m; p++) {
            const u = dF[p];
            for (let q = p; q < m; q++) { const w = dF[q]; let v = 0; for (let i = 0; i < N; i++) v += u[i] * w[i]; G[p * m + q] = G[q * m + p] = v; }
            let v = 0;
            for (let i = 0; i < N; i++) v += u[i] * f[i];
            c[p] = v;
          }
          let tr = 0;
          for (let p = 0; p < m; p++) tr += G[p * m + p];
          for (let p = 0; p < m; p++) G[p * m + p] += 1e-12 * tr / m + 1e-300;
          luSolve(G, luFactor(G, m), c, m, 1, new Float64Array(m));
          let ok = true;
          for (let p = 0; p < m; p++) if (!isFinite(c[p])) ok = false;
          if (ok) for (let p = 0; p < m; p++) { const g = c[p], a = dX[p], b = dF[p]; for (let i = 0; i < N; i++) next[i] -= g * (a[i] + b[i]); }
          else { dX.length = 0; dF.length = 0; }
        }
        xPrev = x; fPrev = f; x = next;
      }
      timing.sweeps = (timing.sweeps || 0) + sweeps;
      if (done) timing.settledBy = (timing.settledBy || 0) + 1; else { timing.gaveUp = (timing.gaveUp || 0) + 1; X.set(start); }
      return done;
    }
    /** maxPasses, tol: a rough answer is enough while the rule set still changes a lot (see solve). */
    function evaluate(rhs, maxPasses, tol) {
      const K = rhs.length;
      maxPasses = maxPasses || EXACT_PASSES; tol = tol || 1e-11;
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
        timing.passes = pass + 1;
      }
      // (blocks that were still changing when the passes ran out: the values are not settled; see anderson)
      timing.unsettled = left;
      if (left > 0 && maxPasses >= EXACT_PASSES) {
        const R1 = new Float64Array(maxBlock), Y1 = new Float64Array(maxBlock), mask = reached();
        for (let k = 0; k < K; k++) {
          const r = rhs[k], d = r.d, Xk = X[k], bnd = r.bnd || 0, term = r.term || 0, stuck = r.stuck || 0;
          const ok = anderson(Xk, mask, () => {
            for (let bi = 0; bi < blocks.length; bi++) {
              const b = blocks[bi], m = b.length;
              for (let li = 0; li < m; li++) {
                const s = b[li];
                if (pol[s] < 0) { R1[li] = pol[s] === -1 ? term : stuck; continue; }
                let v = (d ? d[s] : 0) + back[s] * bnd;
                for (let t = row[s], e = row[s + 1]; t < e; t++) v += val[t] * Xk[col[t]];
                R1[li] = v;
              }
              const f = luOf(bi);
              luSolve(f.A, f.perm, R1, m, 1, Y1);
              for (let li = 0; li < m; li++) Xk[b[li]] = R1[li];
            }
          });
          if (ok && k === K - 1) timing.unsettled = 0;
          if (!ok) break;
        }
      }
      return X;
    }
    /**
     * Expected visits to every node from node s0 under the rule set, until the item is finished or given up for a new
     * base: row s0 of the inverse that `evaluate` applies, with the same blocks, transposed.
     */
    function visitsFrom(s0) {
      // the rule set's edges that enter a block from outside, by the node they point at
      const at = new Int32Array(N + 1);
      const each = (fn) => { for (let s = 0; s < N; s++) { if (pol[s] < 0) continue; const o = acts[s][pol[s]].out, bi = blockOf[s]; for (let t = 0; t < o.length; t += 2) { const s2 = o[t + 1]; if (s2 !== RESTART && blockOf[s2] !== bi) fn(s, s2, GAMMA * o[t], bi); } } };
      each((s, s2) => { at[s2 + 1]++; });
      for (let s = 0; s < N; s++) at[s + 1] += at[s];
      const src = new Int32Array(at[N]), val = new Float64Array(at[N]), fill = at.slice(0, N);
      const next = blocks.map(() => new Set());
      each((s, s2, p, bi) => { const q = fill[s2]++; src[q] = s; val[q] = p; next[bi].add(blockOf[s2]); });
      const nu = new Float64Array(N), R = new Float64Array(maxBlock), Y = new Float64Array(maxBlock);
      const dirty = new Uint8Array(blocks.length);
      dirty[blockOf[s0]] = 1;
      let left = 1;
      for (let pass = 0; pass < 600 && left > 0; pass++) {
        // (the blocks in the order opposite to evaluate's: what flows into a block comes from the blocks before it)
        for (let bi = blocks.length - 1; bi >= 0; bi--) {
          if (!dirty[bi]) continue;
          dirty[bi] = 0; left--;
          const b = blocks[bi], m = b.length;
          for (let li = 0; li < m; li++) { const t = b[li]; let v = t === s0 ? 1 : 0; for (let q = at[t], e = at[t + 1]; q < e; q++) v += val[q] * nu[src[q]]; R[li] = v; }
          const f = luOf(bi);
          luSolveT(f.A, f.perm, R, m, Y);
          let delta = 0;
          for (let li = 0; li < m; li++) { const v = R[li], old = nu[b[li]], ch = Math.abs(v - old); if (ch > 1e-300) { const dv = ch / (Math.abs(v) + 1e-300); if (dv > delta) delta = dv; } nu[b[li]] = v; }
          if (delta > 1e-11) for (const bj of next[bi]) if (!dirty[bj]) { dirty[bj] = 1; left++; }
        }
      }
      if (left > 0) anderson(nu, null, () => {
        for (let bi = blocks.length - 1; bi >= 0; bi--) {
          const b = blocks[bi], m = b.length;
          for (let li = 0; li < m; li++) { const t = b[li]; let v = t === s0 ? 1 : 0; for (let q = at[t], e = at[t + 1]; q < e; q++) v += val[q] * nu[src[q]]; R[li] = v; }
          const f = luOf(bi);
          luSolveT(f.A, f.perm, R, m, Y);
          for (let li = 0; li < m; li++) nu[b[li]] = R[li];
        }
      });
      return nu;
    }
    const V = new Float64Array(N);
    let x = 0;
    // what a new base costs in the equations: its price, plus a charge that keeps the craft within the number of bases
    // the player will use (see fitBases). The charge is not money: costs are reported without it.
    let charge = 0;
    // (a.bases: the new bases a step takes besides a plain "New base": one for an Orb of Extraction, the chance of
    // losing the item for a step that locks it; the charge on bases is on those too)
    const costOf = (act) => (act.a.op === 'newbase' ? act.cost + charge : act.a.bases ? act.cost + charge * act.a.bases : act.cost);
    const qOf = (s, act) => { let c = costOf(act); const o = act.out; for (let t = 0; t < o.length; t += 2) c += o[t] * (o[t + 1] === RESTART ? x : V[o[t + 1]]); return c; };
    // the first rule set: one that always ends
    const essOnly = new Set(goals.filter((g) => g.kind === 'ess').flatMap((g) => [g.rareEss, g.magicEss].filter(Boolean).map((r) => r.mod)));
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
        if (a < 0) a = find((e) => e.op === 'divine' && !e.sanctify);
        // (an essence for a target that only an essence gives; for the other targets a swap by essence would go round
        // for ever where a new base is the way out: a start whose white base is worth 1e15 leaves the first rounds
        // nothing to compare)
        if (a < 0) a = find((e) => e.op === 'pessence' && !e.side && !e.tool && essOnly.has(e.mod));
        if (a < 0) a = find((e) => e.op === 'bone' && !e.hide && !e.putrefy);
      }
      if (a < 0) a = find((e) => e.op === 'newbase');
      if (a < 0 && S.r === 2) a = find((e) => e.op === 'pessence' && !e.side);
      pol[s] = a < 0 ? 0 : a;
    }
    let Fv = new Float64Array(N), Av = null, rounds = 0, sol = null;
    // the search for the base charge holds a white base's value still while it probes (see fitBases)
    let holdX = false, timedOut = false, fitted = false;
    /**
     * New bases from node s on average. An item ends finished or given up for a new base, so the item in hand is given
     * up with chance 1 - F(s), and every white base after it with chance 1 - F(N0): (1 - F(s)) / F(N0) bases in all.
     */
    const basesAt = (s) => (Fv[n0] > 1e-250 ? (1 - Fv[s]) / Fv[n0] : Infinity);
    /** The currency items a step uses, in the order they are used. */
    const actNames = (a) => (a.op === 'reveal' ? (a.echoes ? [OMEN.echoes] : []) : (a.pre ? P.actionNames(a.pre, ctx) : []).concat(P.actionNames(a, ctx)));
    // ---- Hinekora's Lock: "Allows an item to foresee the result of the next Currency item used on it. Modifying the
    // item in any way removes the ability to foresee."
    // With the lock on the item the player looks at what each currency would do and uses the one whose result is
    // worth most: the step costs the lock plus E[min over the currencies of (its price + the value of its result)],
    // where without the lock it is min over the currencies of E[...]. The results of different currency items are
    // taken to be drawn apart; of the steps that use the same currency item (with and without an omen) only one is
    // looked at, since whether an omen changes the result that is shown or draws another is not known. What a lock
    // does not show: a bone's modifier (it is chosen at the Well of Souls afterwards), the reveal there, a rune. Those
    // can still be used, unseen, and so can a new base. When nothing shown is worth using and no target goes by
    // value, a Divine Orb changes the item without changing what it is: the lock is spent and can be used again.
    // The lock can win at most what the item is worth, so it is no edge at all while it costs more than giving the
    // item up does (LOCK >= base + charge + a white base's value: at 517,000 Exalted Orbs nearly every craft).
    const LOCK = input.lock === false ? null : price("Hinekora's Lock");
    const BURN = LOCK != null && PR.divine != null && goals.every((g) => g.minValue == null) ? PR.divine : null;
    const SEEN = new Set(['transmute', 'augment', 'regal', 'alchemy', 'exalt', 'chaos', 'annul', 'essence', 'pessence', 'liquid', 'fracture', 'divine', 'vaal']);
    const lockAt = LOCK != null ? new Int32Array(N).fill(-1) : null;
    const FIN = index.get(keyOf(FINISHED));
    /** The new bases an edge takes: its outcomes that lose the item have paid for one each. */
    const nbOf = (a) => (a.op === 'newbase' ? 1 : a.bases || 0);
    /** What an edge costs when its result is known: its price, and a base only where the item is lost. */
    const seenCost = (act, to) => act.cost - nbOf(act.a) * baseCost + (to === RESTART ? baseCost : 0);
    /**
     * The lock's edge at node s for the values as they stand, put into acts[s] when it beats `limit` (the best the
     * node has without it; qs: every edge's cost in all). -> null, or {moved: the edge is not what it was}.
     */
    function lockEdge(s, qs, limit) {
      const list = acts[s], li = lockAt[s];
      const cand = new Map();
      let cap = Infinity, capK = -1;
      for (let k = 0; k < list.length; k++) {
        if (k === li) continue;
        const act = list[k], q = qs[k];
        // a step whose result is not shown is worth what it is worth on average: the best of them is what is left
        // to do when nothing shown is better
        if (!SEEN.has(act.a.op) || act.a.ideal) { if (q < cap) { cap = q; capK = k; } continue; }
        const names = actNames(act.a), key = names[names.length - 1], old = cand.get(key);
        if (!old || q < old[1]) cand.set(key, [k, q]);
      }
      if (!cand.size) return null;
      if (BURN != null && BURN + V[s] < cap) { cap = BURN + V[s]; capK = -2; }
      const add = (m, key, v) => m.set(key, (m.get(key) || 0) + v);
      /** The edge when the steps `ks` are looked at (one per currency item): {q: its cost in all, cost, flat: its outcomes, a}, or null when it cannot beat the limit. */
      const make = (ks) => {
        const ent = [], mass = new Map();
        let floor = cap;
        for (const k of ks) {
          const act = list[k], o = act.out;
          mass.set(k, 1);
          for (let t = 0; t < o.length; t += 2) { const to = o[t + 1], y = seenCost(act, to) + (to === RESTART ? charge + x : V[to]); ent.push([y, o[t], k, to]); if (y < floor) floor = y; }
        }
        // (the lock cannot do better than the best single result)
        if (!(LOCK + floor < limit)) return null;
        ent.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
        // the results from the best down: one is used when every other currency shows something worse
        let q = LOCK, cost = LOCK, bases = 0, left = 1;
        const out = new Map(), also = new Map(), plan = [];
        for (const [y, p, k, to] of ent) {
          if (!(y < cap)) break;
          let pr = p;
          for (const [k2, m2] of mass) if (k2 !== k) pr *= m2;
          mass.set(k, Math.max(0, mass.get(k) - p));
          if (!(pr > 0)) { if (mass.get(k) <= 1e-15) break; continue; }
          const act = list[k];
          q += pr * y; cost += pr * seenCost(act, to); left -= pr;
          add(out, to, pr);
          if (to === RESTART) { bases += pr; add(also, 'New base', pr); }
          for (const n of actNames(act.a)) add(also, n, pr * (act.a.count || 1));
          for (const [n, c] of act.a.also || []) if (n !== 'New base') add(also, n, pr * c);
          if (plan.length < 24) plan.push([k, to, pr]);
          if (mass.get(k) <= 1e-15) break; // (this currency always shows something at least as good as what is left)
        }
        left = Math.max(0, left);
        if (left > 1e-15) {
          if (capK === -1) return null; // (nothing to fall back on: cannot be, a new base is always there)
          q += left * cap;
          if (capK === -2) { cost += left * BURN; add(out, s, left); add(also, 'Divine Orb', left); }
          else {
            const act = list[capK], o = act.out;
            cost += left * act.cost; bases += left * nbOf(act.a);
            for (let t = 0; t < o.length; t += 2) add(out, o[t + 1], left * o[t]);
            for (const n of actNames(act.a)) add(also, n, left * (act.a.count || 1));
            for (const [n, c] of act.a.also || []) add(also, n, left * c);
          }
        }
        if (!(q < limit)) return null;
        const flat = [];
        for (const [to, p] of out) flat.push(p, to);
        const a = { op: 'lock', item: "Hinekora's Lock", bases, also: [...also], cand: [...mass.keys()], cap: capK, capY: cap, rest: left, plan };
        if (list.some((e, k) => k !== li && e.a.ideal && (k === capK || mass.has(k)))) a.ideal = true;
        return { q, cost, flat, a };
      };
      // Which step of a currency item is looked at: the one that is cheapest on average. For the lock another one may
      // be better (the best of several results asks for spread, not for a good average), so an edge that stands is
      // also made again with the steps it has: the better of the two. An edge made again is then never worse than
      // the one it replaces, which is what keeps every round's rule set one that ends.
      const old = li >= 0 ? list[li] : null;
      let got = make([...cand.values()].map((c) => c[0]));
      if (old && pol[s] === li) { const alt = make(old.a.cand); if (alt && (!got || alt.q < got.q)) got = alt; }
      if (!got) return null;
      const { cost, flat, a } = got;
      let moved = !old || old.out.length !== flat.length || Math.abs(old.cost - cost) > 1e-9 * (1 + Math.abs(cost));
      if (!moved) for (let t = 0; t < flat.length; t += 2) if (old.out[t + 1] !== flat[t + 1] || Math.abs(old.out[t] - flat[t]) > 1e-7) { moved = true; break; }
      // (the edge is kept as the values make it now, also when its chances have not moved: what is left to do when
      // nothing shown is worth using is told by a value, capY, and that one moves with every round)
      if (old && !moved) { old.a = a; return { moved: false }; }
      const act = { a, cost, out: flat };
      if (li < 0) { lockAt[s] = list.length; list.push(act); } else list[li] = act;
      luStale[blockOf[s]] = 1;
      return { moved: true };
    }
    // The lock comes in only once the rule set without it has settled. Against the first rounds' values (a white
    // base worth 1e13 before the rule set has taken shape) a lock for half a million looks cheap everywhere, and the
    // rule set it makes then, "spend the lock with a Divine Orb until a currency shows the perfect result", is one
    // that the rounds after it take for ever to leave.
    let lockArmed = false;
    // The steps that lock an item (Vaal Orb, Sanctification, Putrefaction: the item is finished or lost) come in once
    // the rule set without them has settled roughly, for the same reason. While the first rounds' values are far
    // off, "lose the item nearly always, for a few Exalted Orbs" can look better than every other edge: a bow's rule
    // set became one that finishes an item once in 1e15 tries, and stayed there.
    let lostArmed = false;
    const locks = (a) => a.bases != null && a.op !== 'extraction' && a.op !== 'lock' && a.op !== 'newbase';
    /** Improve the rule set until no node has a cheaper edge (it starts from the rule set of the last solve). */
    function solve(exact) {
      if (exact !== false && hasLost && !lostArmed) { improve(exact, true); lostArmed = true; }
      improve(exact);
      if (exact !== false && LOCK != null && !lockArmed && !timedOut && LOCK < baseCost + charge + x) { lockArmed = true; improve(exact); }
      sol = null;
    }
    function improve(exact, roughOnly) {
      // exact === false: a probe of the search for the base charge. It only has to tell on which side of the limit the
      // charge lands, so it stops when the roughly valued rule set has all but settled.
      // While many nodes still change their edge, the rule set is valued roughly (a few passes over the blocks) and
      // improved again; the exact values come once it has settled, and it must stand unchanged against those.
      let rough = true, last = N;
      // With the lock in the rule set every round's values are exact, and a round whose values did not settle ends
      // the search: the rule set goes back to the last one that was valued exactly (`snap`). The lock's edge takes
      // the best of many results, so against values that are too low somewhere it takes just those: on a quiver a
      // round valued four thousandths off was followed by a rule set that went round in circles for ever.
      let snap = null;
      const take = () => { const locks = []; for (let s = 0; s < N; s++) if (lockAt[s] >= 0 && pol[s] === lockAt[s]) { const e = acts[s][lockAt[s]]; locks.push([s, e, e.a]); } return { pol: Int32Array.from(pol), locks, A: Av, F: Fv, x, v: V[start] }; };
      const back = (k) => {
        pol.set(k.pol);
        for (const [s, e, a] of k.locks) { e.a = a; acts[s][lockAt[s]] = e; }
        Av = k.A; Fv = k.F; x = k.x;
        for (let s = 0; s < N; s++) V[s] = Math.min(BIG, Av[s] + (1 - Fv[s]) * x);
        luStale.fill(1); timing.unsettled = 0;
      };
      for (let it = 0; it < 400; it++, rounds++) {
        if (late()) { timedOut = true; break; }
        const locking = lockArmed && exact !== false && LOCK < baseCost + charge + x;
        if (locking) rough = false;
        const d = new Float64Array(N);
        for (let s = 0; s < N; s++) if (pol[s] >= 0) d[s] = costOf(acts[s][pol[s]]);
        const passes = !rough ? EXACT_PASSES : last > N / 20 ? 3 : last > N / 300 ? 8 : 24;
        const [A, F] = evaluate([{ d, bnd: 0, stuck: BIG, x0: Av }, { bnd: 0, term: 1, x0: Av ? Fv : null }], passes, rough ? 1e-7 : 1e-11);
        if (!holdX) x = F[n0] > 1e-250 ? A[n0] / F[n0] : BIG;
        for (let s = 0; s < N; s++) V[s] = Math.min(BIG, A[s] + (1 - F[s]) * x);
        Fv = F; Av = A;
        if (locking) {
          if (timing.unsettled && unsolved() > 1e-7) { if (snap) back(snap); break; }
          // (no cheaper than the last round, for the item and for a white base: the search is over)
          if (snap && !(x < snap.x * (1 - 1e-7)) && !(V[start] < snap.v * (1 - 1e-7))) { if (x > snap.x || V[start] > snap.v) back(snap); break; }
          snap = take();
        }
        let changed = 0;
        // (Hinekora's Lock is an edge only where it can pay at all: see LOCK)
        const lockOn = lockArmed && LOCK < baseCost + charge + x;
        for (let s = 0; s < N; s++) {
          const list = acts[s];
          if (list.length < 2) continue;
          const li = lockAt ? lockAt[s] : -1;
          if (li < 0 && !lockOn) {
            let best = pol[s], bq = qOf(s, list[pol[s]]);
            // against rough values an edge must be clearly cheaper to be taken (else the rule set flutters)
            const slack = (rough ? 1e-6 : 1e-9) * (1 + Math.abs(bq));
            for (let a = 0; a < list.length; a++) { if (a === pol[s] || (!lostArmed && locks(list[a].a))) continue; const v = qOf(s, list[a]); if (v < bq - slack) { bq = v; best = a; } }
            if (best !== pol[s]) { pol[s] = best; changed++; }
            continue;
          }
          // with the lock: the best edge without it first, then the lock's edge as the values make it now
          const held = pol[s] === li, qs = new Float64Array(list.length);
          let best = held ? -1 : pol[s], bq = held ? Infinity : qOf(s, list[pol[s]]);
          const slack = (rough ? 1e-6 : 1e-9) * (1 + Math.abs(held ? V[s] : bq));
          for (let a = 0; a < list.length; a++) {
            if (a === li || (!lostArmed && a !== pol[s] && locks(list[a].a))) continue;
            const v = a === pol[s] ? bq : qOf(s, list[a]);
            qs[a] = v;
            if (a !== pol[s] && v < bq - (best < 0 ? 0 : slack)) { bq = v; best = a; }
          }
          const lk = lockOn ? lockEdge(s, qs, held ? bq + slack : bq - slack) : null;
          if (lk) { if (!held) { pol[s] = lockAt[s]; changed++; } else if (lk.moved) changed++; }
          else if (best !== pol[s]) { pol[s] = best; changed++; }
        }
        last = changed;
        if (exact === false && changed <= N / 2000) break;
        if (!changed) { if (!rough || roughOnly) break; rough = false; }
      }
    }
    /**
     * The base limit of a large network, from the price of giving up (z) that a smaller network of the request needed.
     * The rule set depends on the charge and on a white base's value only through their sum with the base's price, so
     * it can be solved for that sum before either is known. A large network solved free first and then searched took a
     * minute and a half: its rule set went from thousands of bases to a few and back. Here it is solved at z from the
     * start, z is moved in small steps while the craft from node s is over the limit or far under it (a cheaper route
     * may still keep to it), and the values are made exact once, with the charge that puts giving up at that price.
     */
    function heldFit(s, z, max) {
      const log = (timing.fit = []), STEP = 1.15;
      holdX = true;
      let on = 0;
      const probe = (zz) => { const t0 = Date.now(); on = zz; x = Math.max(0, zz - baseCost); solve(false); const b = basesAt(s); log.push(['probe', Date.now() - t0, b]); return b; };
      // (a probe that lands over the limit is taken back: the rule set and its values as they were, at no cost)
      const keep = () => ({ pol: Int32Array.from(pol), A: Av, F: Fv, V: Float64Array.from(V), x, on });
      const back = (k) => { pol.set(k.pol); Av = k.A; Fv = k.F; V.set(k.V); x = k.x; on = k.on; sol = null; };
      let hi = z, lo = 0, over = Infinity, at = probe(z);
      if (at > max) for (let k = 0; k < 24 && at > max && !timedOut; k++) { lo = hi; over = at; hi *= STEP; at = probe(hi); }
      // well under the limit: a cheaper route may still keep to it
      else for (let k = 0; k < 5 && at < 0.85 * max && !timedOut; k++) {
        const was = keep(), b = probe(hi / STEP);
        if (b > max) { lo = hi / STEP; over = b; back(was); break; }
        hi /= STEP; at = b;
      }
      // between a price that keeps to the limit and one that does not, unless the route jumps there (from tens of
      // bases to a thousand: another kind of route, with nothing in between to find)
      for (let k = 0; k < 2 && lo > 0 && over <= 4 * max && at < 0.85 * max && hi / lo > 1.03 && !timedOut; k++) {
        const was = keep(), mid = Math.sqrt(lo * hi), b = probe(mid);
        if (b <= max) { hi = mid; at = b; } else { lo = mid; over = b; back(was); }
      }
      if (on !== hi) probe(hi);
      // (every item given up has paid the base's price: what is left of A is the cost without bases)
      const F0 = Fv[n0], A0 = Av[n0] - (1 - F0) * baseCost;
      charge = Math.max(0, F0 * hi - baseCost - A0);
      holdX = false;
      let t0 = Date.now();
      solve();
      log.push(['exact', Date.now() - t0, basesAt(s)]);
      // the exact values can sit a little over the rough ones: one step up when they break the limit
      for (let k = 0; k < 4 && charge > 0 && basesAt(s) > max * 1.02 && !timedOut; k++) { t0 = Date.now(); charge *= 1.25; solve(); log.push(['up', Date.now() - t0, basesAt(s)]); }
      fitted = basesAt(s) <= max * 1.02;
    }
    /** The nodes a route reaches under the rule set: from the item, from a white base, from the starts a player can buy. */
    function reached() {
      const seen = new Uint8Array(N), q = [];
      const add = (k) => { if (!seen[k]) { seen[k] = 1; q.push(k); } };
      add(start); add(n0);
      for (const e of entries) add(e.id);
      while (q.length) {
        const k = q.pop();
        if (pol[k] < 0) continue;
        const o = acts[k][pol[k]].out;
        for (let t = 1; t < o.length; t += 2) if (o[t] !== RESTART) add(o[t]);
      }
      return seen;
    }
    /** How far the values of the nodes the route reaches are from their own equations, at worst (relative). */
    function unsolved() {
      const seen = new Uint8Array(N), q = [start];
      seen[start] = 1;
      if (!seen[n0]) { seen[n0] = 1; q.push(n0); }
      let worst = 0;
      while (q.length) {
        const k = q.pop();
        if (pol[k] < 0) continue;
        const act = acts[k][pol[k]], o = act.out;
        let v = costOf(act);
        for (let t = 0; t < o.length; t += 2) { const to = o[t + 1]; if (to === RESTART) v += o[t] * x; else { v += o[t] * V[to]; if (!seen[to]) { seen[to] = 1; q.push(to); } } }
        const r = Math.abs(v - V[k]) / Math.max(1, Math.abs(V[k]));
        if (r > worst) worst = r;
      }
      return worst;
    }
    // input.giveUp, input.maxBases: the price of giving an item up (see fitBases) at which a smaller network of the same
    // request kept to maxBases new bases. This one starts there.
    if (input.giveUp > 0 && input.maxBases > 0 && !done(startS)) heldFit(start, +input.giveUp, +input.maxBases); else solve();
    timing.solve = Date.now() - tick;
    if (timedOut) return { unsupported: 'out of time', states: N };
    // no rule set ends with the targets (nothing the network knows brings this item, or a white base, to them)
    if (!done(startS) && !(V[start] < BIG / 1000)) {
      // (an item that is the only one: every way to the targets can lose a modifier that must stay)
      if (NONEW) return { impossible: [{ label: goals.map((g) => g.label).join(' + '), why: 'every way to these targets can lose a modifier that must stay, and no white base can take this item\'s place. Give the price of another item like this one (Plan options, "If given up") and the route can take the risk' }] };
      return { impossible: [{ label: goals.map((g) => g.label).join(' + '), why: 'no currency with a price brings this item to all of these targets' }] };
    }

    // ---- what the rule set uses: every currency's expected count, and how far the cost spreads
    /** Expected counts of every currency and the cost's second moment, for the rule set as it stands. */
    function solution() {
      if (sol) return sol;
      const nameSet = new Map();
      // (a.also: what a step uses or returns besides its own currency, [[name, count]]: an Orb of Extraction takes a
      // new base and returns a rune)
      for (let s = 0; s < N; s++) if (pol[s] >= 0) { const a = acts[s][pol[s]].a; for (const n of actNames(a).concat((a.also || []).map((x) => x[0]))) if (!nameSet.has(n)) nameSet.set(n, nameSet.size); }
      const names = [...nameSet.keys()];
      // money only: the cost and its second moment (M = c^2 + 2 c E[V'] + E[M']) leave the charge on bases out
      const cost = new Float64Array(N);
      for (let s = 0; s < N; s++) if (pol[s] >= 0) cost[s] = acts[s][pol[s]].cost;
      const X = evaluate([{ d: cost, bnd: 0 }]);
      // Every currency's count from a node: the visits to each node from it until the item is finished or given up
      // (visitsFrom: one solve), times what the step there uses. (A solve per currency, thirty of them, took most of
      // an answer's time on a large network.)
      const counts = new Map();
      const countsFrom = (s0) => {
        let c = counts.get(s0);
        if (!c) {
          c = new Float64Array(names.length);
          const nu = visitsFrom(s0);
          for (let t = 0; t < N; t++) { if (!(nu[t] > 0) || pol[t] < 0) continue; const a = acts[t][pol[t]].a; for (const n of actNames(a)) c[nameSet.get(n)] += nu[t] * (a.count || 1); for (const [n, k] of a.also || []) c[nameSet.get(n)] += nu[t] * k; }
          counts.set(s0, c);
        }
        return c;
      };
      const whole = (k, s) => countsFrom(s)[k] + (1 - Fv[s]) * (Fv[n0] > 1e-250 ? countsFrom(n0)[k] / Fv[n0] : 0);
      const money = new Float64Array(N);
      for (let s = 0; s < N; s++) money[s] = X[0][s] + (1 - Fv[s]) * (Fv[n0] > 1e-250 ? X[0][n0] / Fv[n0] : 0);
      const moneyBase = Fv[n0] > 1e-250 ? X[0][n0] / Fv[n0] : BIG;
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
    const net = {
      ctx, goals, states, acts, pol, start, n0, N, timing, lite,
      // (bound: a restart is not a white base: another item like the pasted one, or none; held: the targets that no white base can get)
      bound: BOUND ? { mode: NONEW ? 'never' : 'item', held: raw.filter((g) => g.held).map((g) => g.label), cost: baseCost } : null,
      track: followed.filter(Boolean).length, classes: NCLS, whittle: WBEST ? 'best' : WNONE ? 'none' : 'levels', wellRank, catalyst: CAT ? { tag: CAT.tag, name: CAT.name } : null,
      get rounds() { return rounds; },
      /** Did the last valuation settle (see anderson)? A route whose values did not is not to be trusted. */
      get settled() { return !timing.unsettled || unsolved() <= 1e-7; },
      get base() { return solution().money[n0]; },
      nodeOf(st) {
        // the node with what is known to be in the way, when the network has it (the pasted item and what follows from it)
        // (canon: two crafted modifiers nobody asked for have one order in a node; the item's reader names them in
        // the item's order. Without it an item with two of them had no node whenever the reader's order was the
        // other one: in the sixth deep run 2% of a crossbow's crafts left the network after an alloy with Astrid's
        // Creativity, and a few crafts of twenty other scenarios.)
        let i;
        for (const known of [true, 3, 2, false]) { i = index.get(keyOf(canon(nodeOf(st, known)))); if (i !== undefined) return i; }
        // A crafted modifier nobody asked for that the item's reader knows as a tool essence's own, where the edge
        // that left it knew only "some crafted modifier" (an essence for a target that gave its other modifier), or
        // the other way round: the node that differs only in whose the crafted modifiers are. (In the fifth deep run
        // 2% of a body armour's crafts had no node after a Perfect Essence of Seeking for that reason.)
        for (const known of [true, 3, 2, false]) {
          const S0 = nodeOf(st, known);
          if (!S0.cx && !S0.cy) continue;
          for (const a of [S0.ct, 0, 1, 2]) for (const b of [S0.cu, 0, 1, 2]) {
            const S = cp(S0);
            if (S.cx) S.ct = a;
            if (S.cy) S.cu = b;
            i = index.get(keyOf(canon(S)));
            if (i !== undefined) return i;
          }
        }
        return -1;
      },
      /** Is every target on this item (whatever else is on it, and whether the network has a node for it)? */
      finished: (st) => done(nodeOf(st, true)),
      /** For the checks: 0 the node was found with everything known, 1 without what a blocker's tags stop, 2 without blockers, -1 not at all. */
      mapping(st) { return index.has(keyOf(canon(nodeOf(st, true)))) ? 0 : index.has(keyOf(canon(nodeOf(st, 3)))) || index.has(keyOf(canon(nodeOf(st, 2)))) ? 1 : index.has(keyOf(canon(nodeOf(st, false)))) ? 2 : -1; },
      done: (s) => done(states[s]),
      /** The step to use at node s: {a, names, cost, out}, or null when done or stuck. */
      step(s) { return pol[s] >= 0 ? Object.assign({ names: actNames(acts[s][pol[s]].a) }, acts[s][pol[s]]) : null; },
      /** Hinekora's Lock at node s: the steps to look at with it, one per currency item ([{k, a, names}]), or null. */
      lockSteps(s) {
        const e = pol[s] >= 0 ? acts[s][pol[s]] : null;
        return e && e.a.op === 'lock' ? e.a.cand.map((k) => ({ k, a: acts[s][k].a, names: actNames(acts[s][k].a) })) : null;
      },
      /**
       * What is used after looking: seen = [[k, the item as step k would leave it]] -> {k, cost} for the result that is
       * worth most, or {rest: the step to use unseen, cost} / {burn: true, cost} when nothing shown is worth using.
       * cost: the lock and what is used (a base too where the item is lost).
       */
      lockUse(s, seen) {
        const e = acts[s][pol[s]], list = acts[s];
        let bestY = e.a.capY, pick = null;
        for (const [k, st] of seen) {
          const act = list[k];
          let to;
          if (st.corrupted || st.sanctified) to = done(nodeOf(st, true)) ? FIN : RESTART;
          else { to = net.nodeOf(st); if (to < 0) continue; }
          const y = seenCost(act, to) + (to === RESTART ? charge + x : V[to]);
          if (y < bestY) { bestY = y; pick = { k, to, cost: LOCK + seenCost(act, to) }; }
        }
        // (y: what the item is worth after the choice, with what the choice costs; want: the same as the edge has it on average. For the checks.)
        const out = pick || (e.a.cap === -2 ? { burn: true, cost: LOCK + BURN } : { rest: Object.assign({ names: actNames(list[e.a.cap].a) }, list[e.a.cap]), cost: LOCK + list[e.a.cap].cost });
        out.y = bestY; out.want = qOf(s, e) - LOCK;
        return out;
      },
      /** The same as lines for a player: what to use for which result, best first ([{names, to: 'done' | 'lost' | what the item is then, share}]), and what is left to do. */
      lockList(s, max) {
        const e = pol[s] >= 0 ? acts[s][pol[s]] : null;
        if (!e || e.a.op !== 'lock') return null;
        const list = acts[s];
        return {
          look: e.a.cand.map((k) => actNames(list[k].a)),
          lines: e.a.plan.slice(0, max || 10).map(([k, to, p]) => ({ names: actNames(list[k].a), to: to === RESTART ? 'lost' : done(states[to]) ? 'done' : describe(states[to]), share: p })),
          rest: e.a.rest > 1e-9 ? { names: e.a.cap === -2 ? ['Divine Orb'] : actNames(list[e.a.cap].a), burn: e.a.cap === -2, share: e.a.rest } : null,
        };
      },
      /**
       * Targets that cannot come on this very item though its node has them as simply missing: a modifier nobody asked
       * for that is of the target's family (another tier), of its group (on either side), or that stops it with its
       * tags. The network follows the blockers of some targets only, and does not know what a fractured or a crafted
       * modifier nobody asked for is; whoever holds the item sees it. -> target indices.
       */
      hiddenBlocks(st, s) {
        const S = states[s], out = [];
        for (let k = 0; k < G; k++) {
          if (S.g[k] !== ABSENT) continue; // (met, under its value, in the way, a twin, kept out from the other side: the node knows)
          const g = goals[k];
          for (const m of st.mods) {
            if (m.unrevealed || !m.fam || goals.some((q) => P.meets(m, q, q.tier) || P.nearMiss(m, q))) continue;
            // (another target's twin is a status of that target: what it stops is counted with it)
            if (goals.some((q, j) => S.g[j] === TWIN && conv[j] && m.id && conv[j].src.has(m.id))) continue;
            if (m.fam === g.fam || (g.grp.length && (m.grp || []).some((x) => g.grp.includes(x))) || (m.id && kb.mods[m.id] && stops(m.id, k))) { out.push(k); break; }
          }
        }
        return out;
      },
      /** The targets an edge of node s can add (out: the edge's outcomes). */
      adds(s, out) {
        const S = states[s], got = new Set();
        for (let t = 1; t < out.length; t += 2) { if (out[t] === RESTART) continue; const T = states[out[t]]; for (let i = 0; i < G; i++) if (met(T.g[i]) && !met(S.g[i])) got.add(i); }
        return [...got];
      },
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
          .filter((m) => Math.abs(m.uses) > 1e-6).sort((a, b) => b.cost - a.cost);
      },
      /** White bases the craft from node s takes on average (the one in hand not counted). */
      bases: (s) => usesOf(s, 'New base'),
      /**
       * Keep the craft from node s within `max` new bases on average: a charge per base is raised until the rule set
       * that is cheapest with it needs no more. Returns the charge (0 when the limit never bound).
       */
      fitBases(s, max) {
        if (charge) { const t0 = Date.now(); charge = 0; solve(); (timing.fit0 = Date.now() - t0); }
        const free = basesAt(s);
        if (!(max >= 0) || free <= max || !(x < BIG)) return 0;
        // For the rule set a charge on bases and a white base's own value come to one number: what giving the item up
        // costs (z = base price + charge + the value of a white base). The search moves z with the base's value held
        // still, so a probe has nothing to settle but the rule set; the probes are valued roughly.
        const z0 = baseCost + x;
        holdX = true;
        let on = 0;
        const log = (timing.fit = []);
        const probe = (z) => { const t0 = Date.now(); charge = z - z0; on = z; solve(false); log.push(['probe', Date.now() - t0, basesAt(s)]); return basesAt(s); };
        let lo = z0, hi = z0 * Math.min(3, Math.max(1.3, Math.sqrt(free / Math.max(0.5, max)))), at = Infinity;
        for (let k = 0; k < 40; k++) { at = probe(hi); if (at <= max) break; lo = hi; hi *= 1.6; }
        // back down while the route is far under the limit (a cheaper one may still keep to it); a very large
        // network gets fewer of these steps (the large ones of a request start from a smaller one's answer: heldFit)
        for (let k = 0, steps = N > 60000 ? 3 : 8; k < steps && at < 0.75 * max && hi / lo > 1.02; k++) {
          const mid = Math.sqrt(lo * hi), b = probe(mid);
          if (b <= max) { hi = mid; at = b; } else lo = mid;
        }
        if (on !== hi) probe(hi);
        // the charge that puts giving up at this price when a white base has its own value again, and the exact route
        const F0 = Fv[n0], A0 = Av[n0] - (1 - F0) * (baseCost + charge);
        charge = Math.max(0, F0 * hi - baseCost - A0);
        holdX = false;
        let t0 = Date.now();
        solve();
        log.push(['exact', Date.now() - t0, basesAt(s)]);
        // the exact values can sit a little over the rough ones: one step up when they break the limit
        for (let k = 0; k < 4 && basesAt(s) > max * 1.02; k++) { t0 = Date.now(); charge *= 1.25; solve(); log.push(['up', Date.now() - t0, basesAt(s)]); }
        return charge;
      },
      /** The charge on a new base that the values are solved with (0: none). */
      get charge() { return charge; },
      /** What giving an item up costs in the equations: the base's price, the charge, a white base's value. */
      get giveUp() { return baseCost + charge + x; },
      /** Built from a smaller network's price of giving up (input.giveUp), and within the base limit with it. */
      get fitted() { return fitted; },
      /** Every edge of node s with what the craft costs in all when it is used there and the route's rules after it (cheapest first). */
      /** Does the route, from the pasted item on, use an edge this network only has at its best (input.whittle 'best')? */
      usesIdeal() {
        if (!WBEST) return false;
        const seen = new Uint8Array(N), q = [start];
        seen[start] = 1;
        while (q.length) {
          const k = q.pop();
          if (pol[k] < 0) continue;
          const e = acts[k][pol[k]];
          if (e.a.ideal) return true;
          for (let t = 0; t < e.out.length; t += 2) { const to = e.out[t + 1] === RESTART ? n0 : e.out[t + 1]; if (!seen[to]) { seen[to] = 1; q.push(to); } }
        }
        return false;
      },
      options(s) {
        const so = solution();
        const total = (act) => { let c = act.cost; const o = act.out; for (let t = 0; t < o.length; t += 2) c += o[t] * (o[t + 1] === RESTART ? so.moneyBase : so.money[o[t + 1]]); return c; };
        // (not the omen at its best: that is no step a player can take)
        // (nor a lock's edge the route does not use: it is what earlier values made of it)
        return acts[s].map((act, i) => ({ a: act.a, names: actNames(act.a), cost: act.cost, out: act.out, total: total(act), best: i === pol[s] })).filter((o) => !o.a.ideal && (o.best || o.a.op !== 'lock')).sort((a, b) => (b.best - a.best) || (a.total - b.total));
      },
      /** What buying a starting point is worth: the price up to which it beats rolling it from a white base. */
      entries() {
        const so = solution();
        return entries.map((e) => ({ kind: e.kind, goal: goals[e.goal], cost: so.money[e.id], worth: baseCost + so.moneyBase - so.money[e.id] })).filter((e) => e.worth > 0.005);
      },
      /**
       * The rule set as lines, from node s along every outcome that is not rare: [{node, share, when, names, a, cost,
       * done, fresh}]. After "New base" the lines go on from the white base (fresh: true).
       */
      rules(s, max) {
        const seen = new Set([s]), q = [[s, 1, false]], out = [];
        while (q.length && out.length < (max || 16)) {
          const [n, p, fresh] = q.shift();
          const st = net.step(n);
          out.push({ node: n, share: p, when: describe(states[n]), names: st ? st.names : [], a: st ? st.a : null, cost: solution().money[n], done: done(states[n]), fresh });
          if (!st) continue;
          const o = st.out, next = [];
          for (let t = 0; t < o.length; t += 2) { const to = o[t + 1] === RESTART ? n0 : o[t + 1]; if (!seen.has(to) && o[t] >= 0.02) next.push([to, p * o[t], fresh || o[t + 1] === RESTART]); }
          next.sort((a, b) => b[1] - a[1]);
          for (const e of next) { seen.add(e[0]); q.push(e); }
        }
        return out;
      },
      describe: (s) => describe(states[s]),
      price,
      /** The node's state an item would have, whether the network has that node or not (for the checks). */
      stateOf: (st, known) => nodeOf(st, known !== false),
      /** The pool numbers of a side (for the checks): stats(side index, minimum modifier level, catalyst boost, rune bits, tag mask, present mask). */
      poolStats: stats,
    };
    function describe(S) {
      const has = [], miss = [], inWay = [], low = [], twin = [], across = [];
      const junk = [0, 1].map((si) => S.j[si] + (S.cx === si + 1 ? 1 : 0) + (S.cy === si + 1 ? 1 : 0) + (S.dj === si + 1 ? 1 : 0) + (S.fj === si + 1 ? 1 : 0));
      for (let i = 0; i < G; i++) {
        const x = S.g[i], g = goals[i];
        const how = (S.fg === i ? ' (fractured)' : '') + (kindOf(x) === CRAFTED ? ' (crafted)' : kindOf(x) === DESECRATED ? ' (desecrated)' : '');
        if (met(x)) has.push(g.label + how);
        else if (near(x)) { has.push(g.label + how); low.push(g.label); }
        else {
          miss.push(g.label);
          if (x === BLOCKED) { inWay.push(g.label + (S.fg === i ? ' (fractured)' : '')); junk[g.si]++; }
          if (x === XBLOCKED) across.push(g.label);
          if (x === TWIN) { twin.push(g.label); junk[g.si]++; }
        }
      }
      const runes = [];
      if (S.u & R_ASTRID) runes.push(AST.item);
      if (S.u & R_SERLE) runes.push(SER.item);
      if ((S.u & R_POOL) && POOL) runes.push(POOL.item);
      if (S.u & R_ALDUR) runes.push(ALD.rune);
      if (S.aw) junk[awSide(S)]++;
      return { rarity: ['Normal', 'Magic', 'Rare'][S.r], has, miss, inWay, across, low, twin, runes, allowance: S.aw ? SIDES[S.aw - 1] : null, otherPrefixes: junk[0], otherSuffixes: junk[1], hidden: S.du ? SIDES[S.du - 1] : null,
        fracturedOther: S.fj ? SIDES[S.fj - 1] : null, desecratedOther: S.dj ? SIDES[S.dj - 1] : null,
        // the lowest level among the modifiers nobody asked for (Omen of Whittling takes the lowest of all): from, under
        lowestOther: NCLS > 1 ? [0, 1].map((si) => { const c = clsAt(S, si); return nSide(S, si) > 0 ? { side: SIDES[si], from: c > 0 ? LCUT[c - 1] : null, under: c < NCLS - 1 ? LCUT[c] : null } : null; }).filter(Boolean) : [] };
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

  /** The transposed system with the same factors: R (m numbers) becomes y, where (the matrix)^T y = R. Y: room for m numbers. */
  function luSolveT(A, perm, R, m, Y) {
    for (let i = 0; i < m; i++) { let v = R[i]; for (let j = 0; j < i; j++) v -= A[j * m + i] * Y[j]; Y[i] = v / A[i * m + i]; }
    for (let i = m - 1; i >= 0; i--) { let v = Y[i]; for (let j = i + 1; j < m; j++) v -= A[j * m + i] * Y[j]; Y[i] = v; }
    for (let i = 0; i < m; i++) R[perm[i]] = Y[i];
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
   * The network for a request, always: the full one with the blockers of every natural target followed (net.track: how
   * many are), with those of fewer targets where that does not fit, and for requests with so many targets that the
   * full one would not fit at all, a smaller one (net.lite 1 or 2: see build). The route of a smaller network is a
   * route of the full one, perhaps not its cheapest.
   */
  const FOLLOW6 = 2;
  function route(input) { return routeFit(input, 0).net; }
  /** The same, with the charge on white bases fitted to a limit of bases per finished item: {net, charge}. */
  function routeFit(input, baseLimit) {
    const nT = Object.values(input.targets || {}).filter((t) => t && t.fam).length, many = nT >= 7;
    const fit = (net) => (baseLimit > 0 && !net.done(net.start) ? net.fitBases(net.start, +baseLimit) : 0);
    const bad = (net) => net.unsupported || net.impossible || net.blocked;
    // (200,000 states for the fully followed network: a staff with two targets that keep each other out by their
    // tags needs 175,000, about 1.5 GB and a minute and a half; with fewer it followed two of three targets and
    // played at one and a half times its promise)
    // [lite, targets followed at most, states at most]. Up to five targets fit with all of them followed; with six the
    // two with the largest groups are (a try that does not fit is time lost, so none is made that is known not to).
    const tries = many ? [[1, 0, 150000], [2, 0, 1000000]] : (nT <= 5 ? [[0, 8, 200000]] : []).concat(nT > FOLLOW6 ? [[0, FOLLOW6, 160000]] : [], [[0, 0, 150000], [1, 0, 400000], [2, 0, 1000000]]);
    /** The largest network that fits, with the omen as `whittle` says. */
    const full = (whittle, hint) => {
      let n = null;
      for (const [lite, track, maxStates] of tries) {
        n = build(Object.assign({}, input, { lite, track, maxStates, whittle, giveUp: hint, maxBases: baseLimit }));
        if (n.unsupported !== 'too many item states') break;
      }
      return n;
    };
    // (hint: the price of giving up at which a smaller network of the request kept to the base limit, 0: none. A
    // network built from it is fitted already; one that could not keep to the limit that way is searched in full.)
    const done = (net) => (bad(net) ? { net, charge: 0 } : { net, charge: net.fitted ? net.charge : fit(net) });
    /**
     * The route leans on Omen of Whittling: the network with the levels followed, in as many classes and with as many
     * targets' blockers followed as fit (each class and each followed target has its known share of the size; from:
     * a network of the request without classes). null when nothing fits.
     */
    const withLevels = (from, hint) => {
      const base = from.N / Math.pow(1.4, from.track), seen = new Set(), plans = [];
      for (const classes of [3, 2]) for (const track of [from.track, Math.min(from.track, 2), 0]) {
        const k = classes + '|' + track;
        if (seen.has(k)) continue;
        seen.add(k);
        // (three classes a side make the network about six times as large, two about two and a half times; 65,000
        // nodes at most: such a network takes a quarter of a minute to solve and as long again to fit to a base limit)
        const size = base * Math.pow(1.4, track) * (classes === 3 ? 6 : 2.6);
        if (size <= 65000) plans.push({ classes, track, size });
      }
      // the first that should fit, and when it does not after all, the smallest (a try that does not fit costs as
      // much time as one that does: no more than two)
      const order = plans.length > 1 ? [plans[0], plans.slice().sort((a, b) => a.size - b.size)[0]] : plans;
      for (let k = 0; k < order.length; k++) {
        if (k && order[k] === order[0]) break;
        const n2 = build(Object.assign({}, input, { lite: 0, track: order[k].track, maxStates: 100000, whittle: 'levels', classes: order[k].classes, giveUp: hint, maxBases: baseLimit }));
        if (n2.unsupported !== 'too many item states') return done(n2);
      }
      return null;
    };
    // Omen of Whittling is first solved at its best (see WBEST in build): most routes do not use it even then, and a
    // route that does not is the route with the real omen too.
    if (!many && nT >= 4) {
      // Four targets or more: the networks are large (a minute to solve and fit), so the small one (no blockers
      // followed) says whether the omen is worth having, also under the base limit, where more is repaired. If it is,
      // the levels are followed in as large a network as fits; if not, the large network is solved without the omen.
      // (The small one is let go before the next is built: both at once were more than a process's memory.)
      let pre = build(Object.assign({}, input, { lite: 0, track: 0, maxStates: 150000, whittle: 'best' }));
      if (!bad(pre)) {
        let hint = 0, uses = pre.usesIdeal();
        if (baseLimit > 0 && !pre.done(pre.start)) { hint = fit(pre) > 0 ? pre.giveUp : 0; uses = uses || pre.usesIdeal(); }
        const from = { N: pre.N, track: pre.track };
        pre = null;
        const got = uses ? withLevels(from, hint) : null;
        return got || done(full('none', hint));
      }
      pre = null;
    }
    let net = full('best');
    if (bad(net)) return { net, charge: 0 };
    // (a route that uses the omen is solved again: fitting the base limit to this network first would be time lost)
    let hint = 0;
    if (!net.usesIdeal()) { const c = fit(net); if (!net.usesIdeal()) return { net, charge: c }; hint = c > 0 ? net.giveUp : 0; }
    const from = { N: net.N, track: net.track };
    net = null;
    return withLevels(from, hint) || done(full('none', hint));
  }

  /**
   * The route for a request as plain data: what the page shows (it can cross a worker's boundary).
   * opts: {budget: the player's ceiling in Exalted Orbs (0: none), baseLimit: white bases per finished item at most}.
   * Returns {blocked} for an item no currency works on, {impossible: [text]} for a target the item cannot have,
   * {unsupported: reason} when there is nothing to solve (no targets, unknown base), else the route.
   */
  function answer(input, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const { net, charge } = routeFit(input, opts.baseLimit > 0 ? +opts.baseLimit : 0);
    if (net.blocked) return { net: true, label: 'Route', blocked: net.blocked, finished: net.finished };
    if (net.unsupported) return { net: true, label: 'Route', unsupported: net.unsupported };
    if (net.impossible) return { net: true, label: 'Route', impossible: net.impossible.map((x) => `${x.label}: ${x.why}`), steps: null };
    const s = net.start, done = net.done(s);
    // an item that is the only one and that every way to the targets can lose: no route can promise it
    if (net.bound && net.bound.mode === 'never' && !done && !(net.cost(s) < 1e11)) {
      return { net: true, label: 'Route', steps: null, impossible: [`${net.bound.held.length ? net.bound.held.join(', ') + ': no white base can get ' + (net.bound.held.length > 1 ? 'them' : 'it') + ', and ' : ''}every way to the targets can lose a modifier that must stay. Give the price of another item like this one (Plan options, "If given up") and the route can take the risk.`] };
    }
    const step = net.step(s), B = opts.budget > 0 ? +opts.budget : 0;
    // Omen of Sanctification as the step to use now: the chance for the values this very item has (the route's own
    // number is for a value anywhere under the wanted one: a node does not know the value)
    let sanctNow = null;
    if (step && step.a.sanctify) {
      const st = P.toState(net.ctx, input.item, input.locks);
      sanctNow = 1;
      for (const g of net.goals) {
        if (g.minValue == null) continue;
        const m = st.mods.find((x) => x.fam === g.fam && (!g.des || x.des) && x.v != null);
        if (!m) { sanctNow = null; break; }
        if (m.frac) { if (m.v < g.minValue) sanctNow = 0; continue; }
        const need = (Number.isInteger(m.v) ? g.minValue - 0.5 : g.minValue) / m.v;
        sanctNow *= Math.max(0, Math.min(1, (SANCT_HI - need) / (SANCT_HI - SANCT_LO)));
      }
    }
    const well = (names) => (names.length ? names : ['Well of Souls']);
    const plain = (g) => { const o = {}; for (const k of Object.keys(g)) { const v = g[k]; if (v == null || typeof v !== 'object' || (Array.isArray(v) && v.every((e) => e == null || typeof e !== 'object'))) o[k] = v; } return o; };
    const seen = new Set();
    return {
      net: true, label: 'Route', goals: net.goals.map(plain), params: null, nodes: net.N, lite: net.lite, track: net.track, ms: Date.now() - t0, timing: net.timing,
      meanCost: net.cost(s), sd: net.sd(s), budget: B, p: B > 0 ? net.within(s, B) : null, bases: net.bases(s), charge, bound: net.bound,
      next: done ? { done: true } : step ? Object.assign({}, step.a, { names: well(step.names), hit: net.hit(s) }, step.a.op === 'lock' ? { look: net.lockList(s, 10), plan: null, also: null } : null, sanctNow != null ? { ends: sanctNow } : step.a.bases != null && step.a.op !== 'extraction' ? { ends: 1 - step.a.bases } : null)
        : { fail: 'No currency brings this item to the targets.' },
      // the materials of the whole craft
      steps: done ? [] : net.materials(s).map((m) => ({ names: [m.name], avg: m.uses, ok: m.uses, cost: m.price })),
      // other first steps, one per kind of currency, with what the whole craft then costs
      options: done ? [] : net.options(s).filter((o) => { const k = o.names.join('+') + (o.a.hide ? '|hide' : ''); if (o.best || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4)
        .map((o) => ({ names: well(o.names), total: o.total, hide: !!o.a.hide })),
      entries: net.entries().sort((a, b) => b.worth - a.worth).slice(0, 4).map((e) => ({ kind: e.kind, label: e.goal.label, tier: e.goal.tier, worth: e.worth })),
      rules: net.rules(s, 14).map((r) => ({ share: r.share, when: r.when, names: r.names.length ? r.names : r.a ? ['Well of Souls'] : [], op: r.a ? r.a.op : null, hide: !!(r.a && r.a.hide), done: r.done, fresh: r.fresh })),
      missingPrices: [],
    };
  }

  return { build, route, answer, gammaP };
});
