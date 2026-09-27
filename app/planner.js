/* PoE2 Craft Assistant — rule engine, simulator and planner (F2).
 * Pure, deterministic given a seed. Depends on the engine (PoE2Engine) for pools and slot limits.
 * Probabilities use equal weights for every eligible mod tier unless a weights table is passed
 * (the game client has no real roll weights) — every probability is an estimate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.PoE2Planner = factory(root.PoE2Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  // ---------------------------------------------------------------- names
  const TIERS = ['base', 'greater', 'perfect'];
  const ORB = {
    transmute: ['Orb of Transmutation', 'Greater Orb of Transmutation', 'Perfect Orb of Transmutation'],
    augment: ['Orb of Augmentation', 'Greater Orb of Augmentation', 'Perfect Orb of Augmentation'],
    regal: ['Regal Orb', 'Greater Regal Orb', 'Perfect Regal Orb'],
    exalt: ['Exalted Orb', 'Greater Exalted Orb', 'Perfect Exalted Orb'],
    chaos: ['Chaos Orb', 'Greater Chaos Orb', 'Perfect Chaos Orb'],
  };
  const OMEN = {
    exalt: { prefix: 'Omen of Sinistral Exaltation', suffix: 'Omen of Dextral Exaltation' },
    greaterExalt: 'Omen of Greater Exaltation',
    erasure: { prefix: 'Omen of Sinistral Erasure', suffix: 'Omen of Dextral Erasure' },
    whittling: 'Omen of Whittling',
    annul: { prefix: 'Omen of Sinistral Annulment', suffix: 'Omen of Dextral Annulment' },
    greaterAnnul: 'Omen of Greater Annulment',
    light: 'Omen of Light',
    coronation: { prefix: 'Omen of Sinistral Coronation', suffix: 'Omen of Dextral Coronation' },
    alchemy: { prefix: 'Omen of Sinistral Alchemy', suffix: 'Omen of Dextral Alchemy' },
    necro: { prefix: 'Omen of Sinistral Necromancy', suffix: 'Omen of Dextral Necromancy' },
    echoes: 'Omen of Abyssal Echoes',
    lich: { Kurgal: 'Omen of the Blackblooded', Amanamu: 'Omen of the Liege', Ulaman: 'Omen of the Sovereign' },
    crystal: { prefix: 'Omen of Sinistral Crystallisation', suffix: 'Omen of Dextral Crystallisation' },
    catalyse: 'Omen of Catalysing Exaltation',
  };
  const WEAPON = ['Sceptre', 'Wand', 'Staff', 'Warstaff', 'Bow', 'Crossbow', 'Spear', 'One Hand Mace', 'Two Hand Mace', 'Talisman', 'Quiver',
    'One Hand Sword', 'Two Hand Sword', 'One Hand Axe', 'Two Hand Axe', 'Dagger', 'Flail'];
  const ARMOUR = ['Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield', 'Buckler', 'Focus'];
  const JEWELLERY = ['Ring', 'Amulet', 'Belt'];
  function boneFor(cls) {
    if (WEAPON.includes(cls)) return 'Jawbone';
    if (ARMOUR.includes(cls)) return 'Rib';
    if (JEWELLERY.includes(cls)) return 'Collarbone';
    if (cls === 'Jewel') return 'Cranium';
    return null;
  }
  const CASTER = ['Wand', 'Staff', 'Sceptre'];
  const MARTIAL = WEAPON.filter((c) => !CASTER.includes(c) && c !== 'Quiver');
  const SIDES = ['prefix', 'suffix'];
  const other = (s) => (s === 'prefix' ? 'suffix' : 'prefix');

  // Flux (game text): "Transforms all <A> and <B> Resistance modifiers on an item to equivalent <C> Resistance modifiers".
  // Fire, Cold and Lightning resistance tiers share their value ranges, so "equivalent" is taken as the same tier number.
  // Void Flux (to Chaos) is listed but not planned: Chaos resistance tiers have other ranges.
  const RES = { fire: 'FireResist', cold: 'ColdResist', lightning: 'LightningResist' };
  const FLUX = { fire: 'Blazing Flux', cold: 'Chilling Flux', lightning: 'Crackling Flux' };
  /** A base whose implicit says "Catalysts can be applied to this item" (Grasping Mail and its Runeforged forms). */
  function catalystBase(base) { return !!(base && (base.imp || []).includes('Catalysts can be applied to this item')); }
  function resElement(id) {
    const m = /^(Fire|Cold|Lightning)Resist(\d+)$/.exec(id || '');
    return m ? { el: m[1].toLowerCase(), n: +m[2] } : null;
  }
  // Catalyst quality type (as the item text writes it, "Quality (Life Modifiers)") -> mod tag it favours.
  const CATALYST_TAG = { life: 'life', mana: 'mana', defence: 'defences', defences: 'defences', physical: 'physical', fire: 'fire', cold: 'cold',
    lightning: 'lightning', chaos: 'chaos', attack: 'attack', caster: 'caster', speed: 'speed', attribute: 'attribute', minion: 'minion' };
  /** Default boost of Omen of Catalysing Exaltation at 20% quality (single community source, guide log decision 21). */
  const CATALYST_DEFAULT = 5;
  function catalystTag(qualityType) {
    const w = String(qualityType || '').trim().split(/\s+/)[0].toLowerCase();
    return CATALYST_TAG[w] || null;
  }

  /** Currency names an action consumes (omens first, as they are activated first in game). */
  function actionNames(a, ctx) {
    const t = TIERS.indexOf(a.tier || 'base');
    switch (a.op) {
      case 'transmute': case 'augment': return [ORB[a.op][t]];
      case 'regal': return [...(a.side ? [OMEN.coronation[a.side]] : []), ORB.regal[t]];
      case 'alchemy': return [...(a.side ? [OMEN.alchemy[a.side]] : []), 'Orb of Alchemy'];
      case 'exalt': return [...(a.side ? [OMEN.exalt[a.side]] : []), ...(a.greater ? [OMEN.greaterExalt] : []), ...(a.catalyse ? [OMEN.catalyse] : []), ORB.exalt[t]];
      case 'chaos': return [...(a.whittle ? [OMEN.whittling] : a.side ? [OMEN.erasure[a.side]] : []), ORB.chaos[t]];
      case 'annul': return [...(a.light ? [OMEN.light] : a.side ? [OMEN.annul[a.side]] : []), ...(a.greater ? [OMEN.greaterAnnul] : []), 'Orb of Annulment'];
      case 'bone': return [...(a.side ? [OMEN.necro[a.side]] : []), ...(a.lich ? [OMEN.lich[a.lich]] : []), ...(a.echoes ? [OMEN.echoes] : []),
        `${a.quality} ${ctx ? ctx.bone : 'bone'}`];
      case 'newbase': return ['New base'];
      case 'fracture': return ['Fracturing Orb'];
      case 'divine': return ['Divine Orb'];
      case 'essence': return [a.item || 'Essence'];
      case 'pessence': return [...(a.side ? [OMEN.crystal[a.side]] : []), a.item || 'Perfect Essence'];
      case 'alloy': return ['Runic Alloy'];
      case 'flux': return [FLUX[a.to] || 'Flux'];
      default: return a.item ? [a.item] : [a.op];
    }
  }

  /**
   * Leave out optional omens that have no price (no market price and none set by the player): the plan could not
   * say what they cost (they would count as free and win every comparison), and an omen nobody traded may not be
   * buyable. Only omens that aim a step or add to it are dropped; the step stays legal without them. Omen of Light
   * and the lich omens change what a step does and stay. priced(name) -> bool; skipped collects the dropped names.
   */
  function withoutUnpriced(a, priced, skipped) {
    if (!a || a.done || a.fail) return a;
    const drop = (name) => { if (priced(name)) return false; if (skipped) skipped.add(name); return true; };
    const b = Object.assign({}, a);
    switch (a.op) {
      case 'regal': if (a.side && drop(OMEN.coronation[a.side])) b.side = null; break;
      case 'alchemy': if (a.side && drop(OMEN.alchemy[a.side])) b.side = null; break;
      case 'exalt':
        if (a.side && drop(OMEN.exalt[a.side])) b.side = null;
        if (a.greater && drop(OMEN.greaterExalt)) b.greater = false;
        if (a.catalyse && drop(OMEN.catalyse)) b.catalyse = false;
        break;
      case 'chaos':
        if (a.whittle && drop(OMEN.whittling)) b.whittle = false;
        if (!b.whittle && b.side && drop(OMEN.erasure[b.side])) b.side = null;
        break;
      case 'annul':
        if (!a.light && a.side && drop(OMEN.annul[a.side])) b.side = null;
        if (a.greater && drop(OMEN.greaterAnnul)) b.greater = false;
        break;
      case 'bone':
        if (a.side && drop(OMEN.necro[a.side])) b.side = null;
        if (a.echoes && drop(OMEN.echoes)) b.echoes = false;
        break;
      default: return a;
    }
    return b;
  }

  // ---------------------------------------------------------------- context

  function floorsFrom(kb) {
    const f = {};
    for (const op of kb.crafting_ops || []) if (op.min_mod_level) f[op.id] = op.min_mod_level;
    return f;
  }

  /**
   * Build the simulation context for one item.
   * opts: { weights?: {modId: w}, essences?: [], catalystMult?: number }
   * catalystMult: how much Omen of Catalysing Exaltation multiplies the weight of matching mods at 20% catalyst
   * quality (scaled down linearly below 20%). The game gives no number. Default 5: the knowledge base's guide log
   * (decision 21) records "about 5x at 20% quality" from a single community source; the player can change it.
   */
  /**
   * Essence records for this item class (from poe2db): {item, mod, gen, lvl, kind: 'magic'|'rare', alloy}.
   * 'magic' essences turn a Magic item Rare and add their mod; 'rare' ones (Perfect, special, alloys) remove a
   * random mod from a Rare item and add theirs. Both use the item's single crafted slot.
   */
  function makeContext(ix, item, opts) {
    opts = opts || {};
    const kb = ix.kb;
    const base = kb.bases[item.base];
    if (!base) throw new Error('unknown base');
    const ilvl = item.ilvl == null ? 100 : item.ilvl;
    const pool = E.poolForItem(ix, item); // Medved's Tending adds the Soul modifiers
    const desPool = E.desecratedPoolFor(ix, item.base);
    const ctx = {
      ix, kb, item, base, cls: base.cls, ilvl, pool, desPool, weights: opts.weights || null,
      floors: floorsFrom(kb), bone: boneFor(base.cls), slotDelta: item.slotDelta || { prefix: 0, suffix: 0 },
      _side: new Map(), _des: new Map(), imputed: new Set(),
      essences: essencesForBase(ix, base, (opts.essences || []).filter((r) => !r.liquid)).concat(liquidFor(kb, item.base)),
      catalystMult: opts.catalystMult > 0 ? +opts.catalystMult : CATALYST_DEFAULT,
      capMods: ix._capMods || (ix._capMods = new Map(Object.entries(kb.mods).filter(([, m]) => m.cap).map(([id, m]) => [id, m.cap]))),
      baseTags: new Set((base.tags || []).concat(E.runeRules(item).soul ? ['soul'] : [])),
      craftedCap: 1 + E.runeRules(item).extraCrafted, // Astrid's Creativity socketed: one more crafted modifier
    };
    return ctx;
  }

  /**
   * Liquid emotions for one jewel base (game table LiquidEmotionOutcomes, kb.liquid_emotions), as records like the
   * Perfect essences' ones: {item, mod, gen, lvl, kind: 'rare', liquid: true}. Potent Liquid Ferocity and Contempt list a
   * prefix and a suffix mod per jewel and add one of them.
   */
  function liquidFor(kb, baseName) {
    const out = [];
    for (const [item, e] of Object.entries(kb.liquid_emotions || {})) {
      for (const id of (e.by_base || {})[baseName] || []) {
        const m = kb.mods[id];
        if (m) out.push({ item, mod: id, gen: m.gen, lvl: m.lvl || 1, kind: 'rare', liquid: true });
      }
    }
    return out;
  }

  /**
   * poe2db lists some essences twice for a class, e.g. Greater Essence of Battle as both the global and the weapon-local
   * Accuracy modifier on Gloves (found by the self-test). A record whose modifier cannot spawn on this base is dropped
   * when the same essence has a record that can; essence-only modifiers (no spawn tags) are kept.
   */
  function essencesForBase(ix, base, list) {
    const tags = new Set(base.tags || []);
    const fits = (r) => E.swEligible(ix.kb.mods[r.mod], tags);
    const ok = list.filter((r) => ix.kb.mods[r.mod] && ix.kb.mods[r.mod].txt);
    return ok.filter((r) => fits(r) || !ok.some((o) => o !== r && o.item === r.item && fits(o)));
  }

  /** Roll weight of a natural mod: the weights table (poe2db) when given, else equal weights.
   *  A mod missing from the table takes the lowest weight of its family (or the table median). */
  function weightOf(ctx, id) {
    const W = ctx.weights;
    if (!W) return 1;
    if (W[id] != null) return W[id];
    const fam = ctx.kb.mods[id].fam;
    if (!ctx._famW) ctx._famW = new Map();
    if (!ctx._famW.has(fam)) {
      const ws = (ctx.ix.famMods.get(fam) || []).map((x) => W[x]).filter((x) => x != null);
      if (!ctx._median) { const all = Object.values(W).sort((a, b) => a - b); ctx._median = all[Math.floor(all.length / 2)] || 500; }
      ctx._famW.set(fam, ws.length ? Math.min(...ws) : ctx._median);
    }
    ctx.imputed.add(id);
    return ctx._famW.get(fam);
  }

  /** Natural pool for one side and floor, with the "family keeps its best legal tier" fallback. */
  function sidePool(ctx, side, floor) {
    const key = side + '|' + floor;
    if (ctx._side.has(key)) return ctx._side.get(key);
    const byFam = new Map();
    for (const [id, pe] of ctx.pool) {
      if (pe.side !== side) continue;
      const m = ctx.kb.mods[id];
      if (m.lvl > ctx.ilvl) continue;
      if (!byFam.has(m.fam)) byFam.set(m.fam, []);
      byFam.get(m.fam).push({ id, fam: m.fam, grp: m.grp, lvl: m.lvl, tier: pe.tier, side, w: weightOf(ctx, id) });
    }
    const out = [];
    for (const list of byFam.values()) {
      const keep = list.filter((e) => e.lvl >= floor);
      if (keep.length) out.push(...keep);
      else { list.sort((a, b) => b.lvl - a.lvl); out.push(Object.assign({}, list[0], { fallback: true })); }
    }
    ctx._side.set(key, out);
    return out;
  }

  /**
   * Sides where a bone can place its desecrated modifier: a desecrated modifier of this bone (floor, lich omen) can roll
   * there, and the side has room, or the item is full and the side has a modifier the desecration may remove.
   */
  function desSides(ctx, st, a) {
    const floor = a.quality === 'Ancient' ? 40 : 0;
    const full = open(ctx, st, 'prefix') + open(ctx, st, 'suffix') === 0;
    const taken = groupsOf(st);
    // on a full item the removal must open the side: a side over its limit (see open) stays full after losing one mod
    const opens = (s) => count(st, s) <= limits(ctx, st)[s] && st.mods.some((m) => removable(m) && m.side === s);
    return (a.side ? [a.side] : SIDES).filter((s) => (full ? opens(s) : open(ctx, st, s) > 0)
      && desPoolFor(ctx, s, floor, a.lich || null).some((e) => !e.grp.some((g) => taken.has(g))));
  }

  function desPoolFor(ctx, side, floor, lich) {
    const key = side + '|' + floor + '|' + (lich || '');
    if (ctx._des.has(key)) return ctx._des.get(key);
    const out = [];
    for (const [id, pe] of ctx.desPool) {
      if (pe.side !== side) continue;
      const m = ctx.kb.mods[id];
      if (m.lvl > ctx.ilvl) continue;
      if (lich && E.lichOf(m) !== lich) continue;
      out.push({ id, fam: m.fam, grp: m.grp, lvl: m.lvl, tier: pe.tier, side, w: 1, des: true, lich: E.lichOf(m) });
    }
    // Game text (Minimum Modifier Level): a family with no tier at the floor keeps its best tier instead of dropping out.
    const best = new Map();
    for (const e of out) if (!best.has(e.fam) || e.lvl > best.get(e.fam).lvl) best.set(e.fam, e);
    const kept = out.filter((e) => e.lvl >= floor || (best.get(e.fam) === e && best.get(e.fam).lvl < floor));
    out.length = 0;
    out.push(...kept);
    ctx._des.set(key, out);
    return out;
  }

  // ---------------------------------------------------------------- state

  /** Simulation state from a parsed item. locks: {side-index: true}. */
  function toState(ctx, item, locks) {
    const mods = [];
    const counters = { prefix: 0, suffix: 0 };
    for (const m of item.mods) {
      if (m.slot !== 'prefix' && m.slot !== 'suffix') continue;
      const idx = counters[m.slot]++;
      const kbm = m.modId ? ctx.kb.mods[m.modId] : null;
      mods.push({
        id: m.modId || null, fam: m.fam || null, side: m.slot, lvl: kbm ? kbm.lvl : 0, grp: kbm ? kbm.grp : [],
        tier: m.tier || null, frac: !!m.fractured, des: !!m.desecrated, crafted: !!m.crafted,
        lock: !!(locks && locks[m.slot + '-' + idx]), unrevealed: !!m.unrevealed,
        v: m.values && m.values.length ? Math.abs(m.values[0]) : null, hi: m.modId && rangeOf(ctx, m.modId) ? rangeOf(ctx, m.modId)[1] : null,
      });
    }
    const f = item.flags || {};
    const catTag = ['Ring', 'Amulet'].includes(ctx.cls) || ctx.cls === 'Jewel' || catalystBase(ctx.base) ? catalystTag(item.qualityType) : null;
    return {
      rarity: item.rarity, mods,
      corrupted: !!f.corrupted, sanctified: !!f.sanctified, mirrored: !!f.mirrored, unidentified: !!f.unidentified,
      quality: item.quality || 0, catTag, catQ: catTag ? item.quality || 0 : 0,
      corruptEnchant: (item.implicits || []).some((m) => m.corruption), foresight: false,
    };
  }

  function cloneState(s) { return Object.assign({}, s, { mods: s.mods.map((m) => Object.assign({}, m)) }); }

  function limits(ctx, st) {
    const c = ctx._lim || (ctx._lim = {});
    const lim = c[st.rarity] || (c[st.rarity] = E.slotLimits({ rarity: st.rarity, slotDelta: ctx.slotDelta }, ctx.cls));
    if (st.rarity !== 'Rare' || !ctx.capMods || !ctx.capMods.size) return lim;
    let p = 0, s = 0;
    for (const m of st.mods) {
      const cap = ctx.capMods.get(m.id);
      if (cap) { p += cap.prefix || 0; s += cap.suffix || 0; }
    }
    return p || s ? { prefix: lim.prefix + p, suffix: lim.suffix + s } : lim;
  }
  const sideOf = (m) => (m.gen === 'p' ? 'prefix' : 'suffix');
  /**
   * Which side a "remove a random modifier, add a guaranteed one" currency (Perfect essence, liquid emotion) removes from
   * (R_SWAP_REMOVAL): the omen's side when one is used; the new mod's side when that side is full; otherwise any side (null).
   */
  function swapSide(ctx, st, sides, omenSide) {
    if (omenSide) return omenSide;
    return sides.some((s) => open(ctx, st, s) > 0) ? null : sides.length === 1 ? sides[0] : null;
  }
  function count(st, side) { let n = 0; for (const m of st.mods) if (m.side === side) n++; return n; }
  // Never below 0: a side can sit over its limit (a removed "+1 Suffix Modifier allowed" leaves 3 suffixes on a jewel),
  // and sums of both sides must not let that hide a free slot on the other side.
  function open(ctx, st, side) { return Math.max(0, limits(ctx, st)[side] - count(st, side)); }
  const removable = (m) => !m.frac;

  // ---------------------------------------------------------------- rules

  /** Returns an error string when the action is not allowed on this state, else null. */
  function validate(ctx, st, a) {
    const cls = ctx.cls;
    const R = st.rarity;
    // Currency made for corrupted items (R_CORRUPTED_LOCK) is checked first; everything else needs an uncorrupted item.
    if (a.op === 'sacrifice') {
      if (!st.corrupted) return 'Orbs of Sacrifice work on corrupted items with a Corruption Enchantment.';
      if (R !== 'Rare') return 'Orbs of Sacrifice need a Rare item.';
      if (!st.corruptEnchant) return 'The item has no Corruption Enchantment to upgrade.';
      const want = sacrificeFor(cls);
      if (!want) return 'No Orb of Sacrifice works on this item class.';
      if (a.item && a.item !== want) return `${a.item} does not work on ${cls}; use ${want}.`;
      return st.mods.some(removable) ? null : 'No removable modifier.';
    }
    if (a.op === 'architect') {
      if (!st.corrupted) return "Architect's Orb needs a corrupted item.";
      return cls === 'Jewel' || WEAPON.includes(cls) || ARMOUR.includes(cls) || JEWELLERY.includes(cls) ? null : "Architect's Orb works on equipment and jewels.";
    }
    if (a.op === 'cultivation') return R === 'Unique' ? null : 'Vaal Cultivation Orb works on Unique items.';
    if (st.mirrored) return 'Mirrored items cannot be modified.';
    if (st.corrupted) return 'Corrupted items only accept corrupted-item currency (Architect\'s Orb, Orbs of Sacrifice, Vaal Cultivation Orb).';
    if (st.sanctified) return 'Sanctified items cannot be crafted further.';
    const hasCrafted = st.mods.filter((m) => m.crafted).length >= (ctx.craftedCap || 1);
    const hasDes = st.mods.some((m) => m.des);
    // Game text (keyword "Minimum Modifier Level"): currency with a Minimum Modifier Level cannot be used on items with
    // an item level below it.
    const minLvl = a.op === 'bone' ? (a.quality === 'Ancient' ? 40 : 0) : a.tier && a.tier !== 'base' && ORB[a.op] ? floorFor(ctx, a.op, a.tier) : 0;
    if (minLvl > ctx.ilvl) return `${a.op === 'bone' ? 'Ancient bones' : ORB[a.op][a.tier === 'greater' ? 1 : 2]} cannot be used on items below item level ${minLvl} (Minimum Modifier Level ${minLvl}).`;
    switch (a.op) {
      case 'transmute':
        return R === 'Normal' ? null : 'Orb of Transmutation needs a Normal item.';
      case 'augment':
        if (R !== 'Magic') return 'Orb of Augmentation needs a Magic item.';
        return open(ctx, st, 'prefix') + open(ctx, st, 'suffix') > 0 ? null : 'The Magic item has no open affix.';
      case 'regal':
        if (R !== 'Magic') return 'Regal Orb needs a Magic item.';
        return null;
      case 'alchemy':
        return R === 'Normal' || R === 'Magic' ? null : 'Orb of Alchemy needs a Normal or Magic item.';
      case 'exalt': {
        if (R !== 'Rare') return 'Exalted Orb needs a Rare item.';
        const n = a.greater ? 2 : 1;
        const room = a.side ? open(ctx, st, a.side) : open(ctx, st, 'prefix') + open(ctx, st, 'suffix');
        if (room < n) return a.side ? `No room: the item already has ${count(st, a.side)} ${a.side}es.` : 'No open affix for Exalted Orb.';
        return null;
      }
      case 'chaos': {
        if (R !== 'Rare') return 'Chaos Orb needs a Rare item.';
        const pool = st.mods.filter((m) => removable(m) && (!a.side || m.side === a.side));
        return pool.length ? null : 'No removable modifier on that side (fractured mods cannot be removed).';
      }
      case 'annul': {
        if (R !== 'Rare' && R !== 'Magic') return 'Orb of Annulment needs a Magic or Rare item.';
        if (a.light) return st.mods.some((m) => m.des && removable(m)) ? null : 'Omen of Light needs a Desecrated modifier to remove.';
        const pool = st.mods.filter((m) => removable(m) && (!a.side || m.side === a.side));
        return pool.length >= (a.greater ? 2 : 1) ? null : 'Not enough removable modifiers.';
      }
      case 'bone': {
        if (R !== 'Rare') return 'Desecration needs a Rare item.';
        if (!ctx.bone) return 'No bone matches this item class.';
        if (hasDes) return 'Only one Desecrated modifier per item (0.5+). Remove it first with Omen of Light + Orb of Annulment.';
        if (a.quality === 'Gnawed' && ctx.ilvl > 64) return 'Gnawed bones only work on item level 64 or lower.';
        if (a.lich && !(WEAPON.includes(ctx.cls) || JEWELLERY.includes(ctx.cls))) return `${OMEN.lich[a.lich]} only works on weapon or jewellery desecration.`;
        // Game text: if modifiers are full, a random modifier is also removed.
        const full = open(ctx, st, 'prefix') + open(ctx, st, 'suffix') === 0;
        if (full && !st.mods.some((m) => removable(m) && (!a.side || m.side === a.side))) return 'The item is full and no modifier there can be removed.';
        if (!full && a.side && open(ctx, st, a.side) < 1) return `No room: the item already has ${count(st, a.side)} ${a.side}es.`;
        if (!desSides(ctx, st, a).length) return `The game data has no desecrated modifier that can roll here${a.lich ? ' with this lich omen' : ''} (desecrated equipment modifiers are level 65).`;
        return null;
      }
      case 'fracture':
        if (R !== 'Rare') return 'Fracturing Orb needs a Rare item.';
        if (st.mods.length < 4) return 'Fracturing Orb needs at least 4 modifiers.';
        return st.mods.some((m) => m.frac) ? 'Fracturing Orb cannot be used on Fractured items.' : null;
      case 'divine':
        if (R !== 'Magic' && R !== 'Rare' && R !== 'Unique') return 'Divine Orb needs an item with modifiers.';
        return st.mods.some((m) => m.id) ? null : 'Divine Orb needs a modifier with values.';
      case 'essence': case 'alloy': case 'pessence': {
        if (hasCrafted) return 'Only one crafted modifier per item (0.5+); this item already has one.';
        if (a.op === 'essence' && R !== 'Magic') return 'Lesser, normal and Greater essences need a Magic item.';
        if (a.op === 'pessence' && R !== 'Rare') return 'Perfect and special essences need a Rare item.';
        const m = a.mod && ctx.kb.mods[a.mod];
        if (!m) return null;
        const taken = groupsOf(st);
        if (a.op === 'essence' && m.grp.some((g) => taken.has(g))) return 'The item already has a modifier of this type; the essence would fail.';
        if (a.op === 'pessence') {
          const mside = sideOf(m);
          // Game text: Omens of Crystallisation act on "your next Perfect or Corrupted Essence"; Runic Alloys are not essences.
          if (a.side && isAlloy(ctx, a)) return 'Omens of Crystallisation work with Perfect and Corrupted essences, not with Runic Alloys.';
          if (a.side && a.side !== mside && open(ctx, st, mside) < 1) return `The essence adds a ${mside} and the ${mside}es are full; the omen would remove a ${a.side}.`;
          const from = swapSide(ctx, st, [mside], a.side);
          if (!st.mods.some((x) => removable(x) && (!from || x.side === from))) return 'No removable modifier on that side.';
        }
        return null;
      }
      case 'newbase':
        return null;
      case 'chance':
        // game table Chanceableitemclasses: jewels, for one, are not among the classes an Orb of Chance works on
        if (ctx.kb.chanceable_classes && !ctx.kb.chanceable_classes.includes(cls)) return `An Orb of Chance cannot be used on ${cls === 'Jewel' ? 'jewels' : cls + ' items'}.`;
        return R === 'Normal' ? null : 'Orb of Chance needs a Normal item.';
      case 'vaal':
        return null;
      case 'hinekora':
        return st.foresight ? "The item already foresees its next currency (Hinekora's Lock)." : null;
      case 'mirror':
        return null;
      case 'rune_rule': {
        const rune = ctx.kb.augments && ctx.kb.augments[a.item];
        return rune && rune.by_class[cls] ? null : `${a.item || 'This rune'} does not go on ${cls} items.`;
      }
      case 'aldur': {
        const rune = ctx.kb.augments && ctx.kb.augments[a.item];
        return rune && rune.by_class[cls] ? null : `${a.item || 'This rune'} does not go on ${cls} items.`;
      }
      case 'verisium': {
        const vu = R === 'Unique' ? ((ctx.kb.verisium_unique_upgrades || {})[ctx.item.name] || []).filter((u) => u.from === ctx.item.base)
          : (ctx.kb.verisium_upgrades || {})[ctx.item.base] || [];
        return vu.length ? null : 'The Verisium Anvil has no upgrade for this item.';
      }
      case 'artificer':
        return MARTIAL.includes(cls) || cls === 'Wand' || cls === 'Staff' || ARMOUR.includes(cls) ? null : "Artificer's Orb works on martial weapons, wands, staves and armour.";
      case 'catalyst':
        if (a.refined) return cls === 'Jewel' ? null : 'Refined catalysts work on jewels.';
        return cls === 'Ring' || cls === 'Amulet' || catalystBase(ctx.base) ? null : 'Catalysts work on rings and amulets (Refined ones on jewels).';
      case 'quality': {
        const want = qualityCurrencyFor(cls);
        if (!want) return 'No quality currency works on this item class.';
        if (a.item && a.item !== want) return `${a.item} does not work on ${cls}; use ${want}.`;
        return st.quality >= 20 ? 'Quality is already at 20%, the normal maximum. A Vaal Infuser can go past it.' : null;
      }
      case 'infuser': {
        const want = infuserFor(cls);
        if (!want) return 'No Vaal Infuser works on this item class.';
        return a.item && a.item !== want ? `${a.item} does not work on ${cls}; use ${want}.` : null;
      }
      case 'flux': {
        if (a.to === 'chaos') return st.mods.some((m) => resElement(m.id) && !m.frac) ? null : 'Void Flux needs a Fire, Cold or Lightning Resistance modifier that is not fractured.';
        const src = st.mods.filter((m) => { const r = resElement(m.id); return r && r.el !== a.to && !m.frac; });
        if (!src.length) return `${FLUX[a.to] || 'This Flux'} needs a resistance modifier of another element.`;
        // Two mods of one element would result (the self-test found this); what the game does then is not known (t20).
        const target = RES[a.to];
        if (src.length > 1 || st.mods.some((m) => (m.id || '').startsWith(target))) return `The item would end up with two ${a.to} resistance modifiers; what Flux does then is not known (verify in game).`;
        return null;
      }
      case 'liquid': {
        if (cls !== 'Jewel' || R !== 'Rare') return 'Liquid emotions work on Rare jewels.';
        const timeLost = /^Time-Lost/.test(ctx.item.base || '');
        const e = a.item && ctx.kb.liquid_emotions ? ctx.kb.liquid_emotions[a.item] : null;
        const ancient = e ? e.time_lost : a.ancient;
        if (ancient !== undefined && ancient !== timeLost) return ancient ? 'Ancient liquid emotions work on Time-Lost jewels.' : 'This liquid emotion works on Basic Jewels; Time-Lost jewels need an Ancient one.';
        if (hasCrafted) return 'Only one crafted modifier per item (0.5+); this item already has one.';
        const outs = liquidOutcomes(ctx, a);
        if (e && !outs.length) return `The game data gives ${a.item} no modifier for a ${ctx.item.base} jewel.`;
        const from = outs.length ? swapSide(ctx, st, [...new Set(outs.map((id) => sideOf(ctx.kb.mods[id])))], null) : null;
        return st.mods.some((m) => removable(m) && (!from || m.side === from)) ? null : 'No removable modifier.';
      }
      default:
        return 'Unknown action.';
    }
  }
  function sacrificeFor(cls) {
    return JEWELLERY.includes(cls) ? "Kamasa's Orb of Sacrifice" : ARMOUR.includes(cls) ? "Kopec's Orb of Sacrifice"
      : WEAPON.includes(cls) ? "Yaomac's Orb of Sacrifice" : cls === 'Jewel' ? "Yugul's Orb of Sacrifice" : null;
  }
  function qualityCurrencyFor(cls) {
    return ARMOUR.includes(cls) ? "Armourer's Scrap" : CASTER.includes(cls) ? "Arcanist's Etcher" : MARTIAL.includes(cls) ? "Blacksmith's Whetstone" : null;
  }
  function infuserFor(cls) {
    return ARMOUR.includes(cls) ? "Vaal Armourer's Infuser" : CASTER.includes(cls) ? "Vaal Arcanist's Infuser" : MARTIAL.includes(cls) ? "Vaal Blacksmith's Infuser"
      : cls === 'Ring' || cls === 'Amulet' ? 'Vaal Catalysing Infuser' : null;
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---------------------------------------------------------------- randomness

  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function groupsOf(st) {
    const g = new Set();
    for (const m of st.mods) for (const x of m.grp) g.add(x);
    return g;
  }

  /** Pick one eligible mod for the allowed sides, honouring mod groups. Returns null when nothing fits. */
  function rollMod(ctx, st, sides, floor, rng, boost) {
    const taken = groupsOf(st);
    const added = E.addedTags(ctx.kb, st.mods.map((m) => m.id));
    const lists = sides.map((s) => sidePool(ctx, s, floor));
    const cands = [], ws = [];
    let total = 0;
    for (const l of lists) for (const e of l) {
      if (e.grp.some((g) => taken.has(g))) continue;
      if (added && E.tagBlocked(ctx.kb.mods[e.id], ctx.baseTags, added)) continue;
      const w = boost && ctx.kb.mods[e.id].mt.includes(boost.tag) ? e.w * boost.mult : e.w;
      cands.push(e); ws.push(w); total += w;
    }
    if (!total) return null;
    let r = rng() * total;
    for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }
  /** Weight boost of Omen of Catalysing Exaltation: the player's multiplier at 20% quality, linear below it. */
  function catalystBoost(ctx, st) {
    if (!st.catTag || !(st.catQ > 0)) return null;
    return { tag: st.catTag, mult: 1 + (ctx.catalystMult - 1) * Math.min(1, st.catQ / 20) };
  }

  function addRolled(ctx, st, e, extra, rng) {
    const m = Object.assign({ id: e.id, fam: e.fam, side: e.side, lvl: e.lvl, grp: e.grp, tier: e.tier, frac: false, des: !!e.des, crafted: false, lock: false }, extra || {});
    if (ctx.needValues) { const r = rangeOf(ctx, e.id); m.hi = r ? r[1] : null; m.v = r ? rollValue(r, rng) : null; }
    st.mods.push(m);
  }

  /** Displayed range of a mod's first number (absolute values, low to high), from the KB text. */
  function rangeOf(ctx, id) {
    if (!ctx._rng) ctx._rng = new Map();
    if (ctx._rng.has(id)) return ctx._rng.get(id);
    const m = id && ctx.kb.mods[id];
    const r = m && m.txt ? E.templateRanges(m.txt.split('\n')[0])[0] : null;
    const out = r ? [Math.min(Math.abs(r[0]), Math.abs(r[1])), Math.max(Math.abs(r[0]), Math.abs(r[1]))] : null;
    ctx._rng.set(id, out);
    return out;
  }
  /** A roll inside the range: whole numbers when both ends are whole, else two decimals (uniform; the game publishes no value weights). */
  function rollValue(r, rng) {
    const [lo, hi] = r;
    if (Number.isInteger(lo) && Number.isInteger(hi)) return lo + Math.floor(rng() * (hi - lo + 1));
    return Math.round((lo + rng() * (hi - lo)) * 100) / 100;
  }

  function openSides(ctx, st, only) {
    return (only ? [only] : SIDES).filter((s) => open(ctx, st, s) > 0);
  }

  function floorFor(ctx, op, tier) {
    const f = ctx.floors[op];
    if (!f || !tier || tier === 'base') return 0;
    return tier === 'greater' ? f.Greater || 0 : f.Perfect || 0;
  }

  /**
   * The mod an essence adds. Most essences have one; some add one of several (game table EssenceMods.OutcomeMods, in
   * kb.essence_outcomes): roll among the ones this base can take, by the table's weights, or evenly when the table has
   * none (the files do not say more).
   */
  function essenceOutcome(ctx, a, rng, st) {
    const o = ctx.kb.essence_outcomes && ctx.kb.essence_outcomes[a.item];
    if (!o || !rng) return a.mod;
    // only outcomes the item can take now: this base, a free group, room on the mod's side
    const taken = groupsOf(st);
    const fit = o.mods.map((id, i) => ({ id, w: o.weights ? o.weights[i] : 1 }))
      .filter((x) => ctx.essences.some((r) => r.item === a.item && r.mod === x.id))
      .filter((x) => { const m = ctx.kb.mods[x.id]; return !m.grp.some((g) => taken.has(g)) && open(ctx, st, m.gen === 'p' ? 'prefix' : 'suffix') > 0; });
    if (fit.length < 2) return a.mod;
    let r = rng() * fit.reduce((t, x) => t + x.w, 0);
    for (const x of fit) { r -= x.w; if (r <= 0) return x.id; }
    return fit[fit.length - 1].id;
  }

  /** Is this swap a Runic Alloy (not an essence)? */
  function isAlloy(ctx, a) {
    return /Alloy$/.test(a.item || '') || ctx.essences.some((r) => r.item === a.item && r.alloy);
  }
  /** Knowledge base mods a liquid emotion adds on this jewel base (one, or a prefix and a suffix). */
  function liquidOutcomes(ctx, a) {
    const e = a.item && ctx.kb.liquid_emotions ? ctx.kb.liquid_emotions[a.item] : null;
    return ((e && e.by_base[ctx.item.base]) || []).filter((id) => ctx.kb.mods[id]);
  }

  function removeRandom(st, pred, rng) {
    const idx = [];
    st.mods.forEach((m, i) => { if (pred(m)) idx.push(i); });
    if (!idx.length) return null;
    const i = idx[Math.floor(rng() * idx.length)];
    return st.mods.splice(i, 1)[0];
  }

  /**
   * Apply an action. Returns { state, removed: [mods], added: [mods] } — the input state is not changed.
   * pick(options) chooses the revealed desecrated mod (default: highest level).
   */
  function apply(ctx, st0, a, rng, pick) {
    const st = cloneState(st0);
    const removed = [], added = [];
    const tier = a.tier || 'base';
    const boost = a.op === 'exalt' && a.catalyse ? catalystBoost(ctx, st) : null;
    const addOne = (sides, floor) => {
      const e = rollMod(ctx, st, sides, floor, rng, boost);
      if (e) { addRolled(ctx, st, e, null, rng); added.push(st.mods[st.mods.length - 1]); }
      return e;
    };
    switch (a.op) {
      case 'newbase':
        st.rarity = 'Normal'; st.mods = [];
        break;
      case 'transmute':
        st.rarity = 'Magic';
        addOne(openSides(ctx, st), floorFor(ctx, 'transmute', tier));
        break;
      case 'augment':
        addOne(openSides(ctx, st), floorFor(ctx, 'augment', tier));
        break;
      case 'regal':
        st.rarity = 'Rare';
        addOne(openSides(ctx, st, a.side), floorFor(ctx, 'regal', tier));
        break;
      case 'alchemy': {
        st.rarity = 'Rare';
        const lim = limits(ctx, st);
        // Omen: the item gets the maximum number of that side (3) and the rest on the other side.
        const plan = [];
        if (a.side) {
          const want = { [a.side]: Math.min(lim[a.side], 3), [other(a.side)]: 1 };
          for (const s of SIDES) for (let i = count(st, s); i < want[s]; i++) plan.push(s);
        }
        while (st.mods.length + plan.length < 4) plan.push(null);
        for (const s of plan) { if (st.mods.length >= 4) break; addOne(s ? openSides(ctx, st, s) : openSides(ctx, st), 0); }
        break;
      }
      case 'exalt': {
        const n = a.greater ? 2 : 1;
        for (let i = 0; i < n; i++) addOne(openSides(ctx, st, a.side), floorFor(ctx, 'exalt', tier));
        if (a.catalyse) st.catQ = 0; // the omen consumes all catalyst quality
        break;
      }
      case 'chaos': {
        let r;
        if (a.whittle) {
          const cands = st.mods.filter(removable);
          const low = Math.min(...cands.map((m) => m.lvl));
          r = removeRandom(st, (m) => removable(m) && m.lvl === low, rng);
        } else r = removeRandom(st, (m) => removable(m) && (!a.side || m.side === a.side), rng);
        if (r) removed.push(r);
        addOne(openSides(ctx, st), floorFor(ctx, 'chaos', tier));
        break;
      }
      case 'annul': {
        const n = a.greater ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const r = removeRandom(st, (m) => removable(m) && (a.light ? m.des : !a.side || m.side === a.side), rng);
          if (r) removed.push(r);
        }
        break;
      }
      case 'bone': {
        const floor = a.quality === 'Ancient' ? 40 : 0;
        if (open(ctx, st, 'prefix') + open(ctx, st, 'suffix') === 0) {
          // The game text does not say which side loses the mod: take it from a side that can hold a desecrated mod.
          const fit = desSides(ctx, st, a);
          const r = removeRandom(st, (m) => removable(m) && fit.includes(m.side), rng);
          if (r) removed.push(r);
        }
        const sides = openSides(ctx, st, a.side);
        const draw = () => {
          const pool = [];
          for (const s of sides) pool.push(...desPoolFor(ctx, s, floor, a.lich || null));
          const taken = groupsOf(st);
          const ok = pool.filter((e) => !e.grp.some((g) => taken.has(g)));
          const opts = [];
          const bag = ok.slice();
          while (opts.length < 3 && bag.length) {
            let total = bag.reduce((t, e) => t + e.w, 0), r = rng() * total, k = 0;
            for (; k < bag.length; k++) { r -= bag[k].w; if (r <= 0) break; }
            opts.push(bag.splice(Math.min(k, bag.length - 1), 1)[0]);
          }
          return opts;
        };
        let opts = draw();
        let choice = pick ? pick(opts, false) : null;
        if (a.echoes && !choice) { opts = draw(); choice = pick ? pick(opts, true) : null; }
        if (!choice) choice = opts.slice().sort((x, y) => y.lvl - x.lvl)[0] || null;
        if (choice) { addRolled(ctx, st, choice, { des: true }, rng); added.push(st.mods[st.mods.length - 1]); }
        break;
      }
      case 'essence': case 'pessence': {
        if (a.op === 'essence') st.rarity = 'Rare';
        else {
          const em = a.mod && ctx.kb.mods[a.mod];
          const from = swapSide(ctx, st, em ? [sideOf(em)] : [], a.side);
          const r = removeRandom(st, (m) => removable(m) && (!from || m.side === from), rng);
          if (r) removed.push(r);
        }
        const id = essenceOutcome(ctx, a, rng, st);
        const m = ctx.kb.mods[id];
        const side = m.gen === 'p' ? 'prefix' : 'suffix';
        const taken = groupsOf(st);
        if (!m.grp.some((g) => taken.has(g)) && open(ctx, st, side) > 0) {
          const pe = ctx.pool.get(id);
          addRolled(ctx, st, { id, fam: m.fam, side, lvl: m.lvl, grp: m.grp, tier: pe ? pe.tier : null }, { crafted: true }, rng);
          added.push(st.mods[st.mods.length - 1]);
        }
        break;
      }
      case 'fracture': {
        const cands = st.mods.filter((m) => !m.frac);
        if (cands.length) cands[Math.floor(rng() * cands.length)].frac = true;
        break;
      }
      case 'divine':
        // Game text: randomises the numeric values of modifiers; a Fractured Modifier cannot be removed or altered.
        for (const m of st.mods) { const r = m.id && !m.frac && rangeOf(ctx, m.id); if (r) { m.v = rollValue(r, rng); m.hi = r[1]; } }
        break;
      case 'flux': {
        // Every resistance mod of the other two elements becomes the same tier of the target element.
        // Fractured mods stay as they are (R_FRACTURED_LOCK: they cannot be changed).
        for (const m of st.mods) {
          const r = resElement(m.id);
          if (!r || r.el === a.to || a.to === 'chaos' || m.frac) continue;
          const id = RES[a.to] + r.n;
          const km = ctx.kb.mods[id];
          if (!km) continue;
          const pe = ctx.pool.get(id);
          removed.push(Object.assign({}, m));
          Object.assign(m, { id, fam: km.fam, grp: km.grp, lvl: km.lvl, tier: pe ? pe.tier : m.tier });
          if (ctx.needValues) { const rg = rangeOf(ctx, id); m.hi = rg ? rg[1] : m.hi; }
          added.push(m);
        }
        break;
      }
      case 'catalyst':
        if (a.tag) { st.catTag = a.tag; } // replaces other quality types; the amount per catalyst is not modelled
        break;
      case 'hinekora':
        break;
      case 'mirror':
        st.mirrored = true;
        break;
      case 'vaal': case 'architect': case 'cultivation':
        st.corrupted = true; st.unpredictable = true;
        break;
      case 'chance':
        st.unpredictable = true;
        break;
      case 'sacrifice': {
        const r = removeRandom(st, removable, rng);
        if (r) removed.push(r);
        st.unpredictable = true; // the upgraded enchantment is not modelled
        break;
      }
      case 'liquid': {
        // Game text: "Removes a random modifier and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier";
        // the modifier per jewel is in the game table LiquidEmotionOutcomes. Two outcomes (a prefix and a suffix): one that fits.
        const outs = liquidOutcomes(ctx, a);
        const from = outs.length ? swapSide(ctx, st, [...new Set(outs.map((id) => sideOf(ctx.kb.mods[id])))], null) : null;
        const r = removeRandom(st, (m) => removable(m) && (!from || m.side === from), rng);
        if (r) removed.push(r);
        if (!outs.length) { st.unpredictable = true; break; } // no emotion named: its mod is not known
        const taken = groupsOf(st);
        const fit = outs.filter((id) => { const m = ctx.kb.mods[id]; return !m.grp.some((g) => taken.has(g)) && open(ctx, st, sideOf(m)) > 0; });
        if (fit.length) {
          const id = fit.length === 1 ? fit[0] : fit[Math.floor(rng() * fit.length)];
          const m = ctx.kb.mods[id];
          const pe = ctx.pool.get(id);
          addRolled(ctx, st, { id, fam: m.fam, side: sideOf(m), lvl: m.lvl, grp: m.grp, tier: pe ? pe.tier : null }, { crafted: true }, rng);
          added.push(st.mods[st.mods.length - 1]);
        }
        break;
      }
      default:
        break;
    }
    // "Modifying the item in any way removes the ability to foresee" (Hinekora's Lock game text).
    st.foresight = a.op === 'hinekora';
    return { state: st, removed, added };
  }

  // ---------------------------------------------------------------- goals

  /**
   * Goals from UI targets. targets: { 'prefix-0': {fam, group, minTier, required, label} }.
   * Returns { goals, unsupported: [labels] }.
   */
  function goalsFromTargets(ctx, targets) {
    const goals = [], unsupported = [];
    for (const [key, t] of Object.entries(targets || {})) {
      if (!t || !t.fam) continue;
      const slotSide = key.split('-')[0];
      if (t.group === 'prefix' || t.group === 'suffix' || t.group === 'desecrated') {
        const des = t.group === 'desecrated';
        const side = des ? slotSide : t.group;
        let lich = null;
        if (des) {
          const ids = (ctx.ix.famMods.get(t.fam) || []).filter((id) => ctx.kb.mods[id].dom === 'd');
          lich = ids.length ? E.lichOf(ctx.kb.mods[ids[0]]) : null;
        }
        const any = (ctx.ix.famMods.get(t.fam) || [])[0];
        const grp = any ? ctx.kb.mods[any].grp : [];
        const minValue = t.minValue > 0 ? +t.minValue : null;
        if (minValue != null) ctx.needValues = true;
        goals.push({ key, fam: t.fam, side, des, grp, tier: minValue != null ? null : t.minTier || null, minValue, required: !!t.required, label: t.label, lich, ess: essencesFor(ctx, t.fam) });
      } else if ((t.group === 'essence' || t.group === 'alloy' || t.group === 'liquid') && essencesFor(ctx, t.fam).length) {
        const rec = essencesFor(ctx, t.fam)[0];
        const m = ctx.kb.mods[rec.mod];
        goals.push({ key, fam: t.fam, side: m.gen === 'p' ? 'prefix' : 'suffix', des: false, grp: m.grp, tier: null, required: !!t.required,
          label: t.label, lich: null, ess: essencesFor(ctx, t.fam), essenceOnly: true });
      } else unsupported.push(t.label);
    }
    goals.sort((a, b) => (b.required - a.required));
    return { goals, unsupported };
  }

  /** Essence records whose guaranteed mod belongs to this family. */
  function essencesFor(ctx, fam) {
    return ctx.essences.filter((r) => ctx.kb.mods[r.mod].fam === fam);
  }
  /** Essences (of a kind) whose mod satisfies the goal at its effective tier, weakest first (cheapest). */
  function essenceOptions(ctx, g, kind) {
    return (g.ess || []).filter((r) => r.kind === kind).filter((r) => {
      const pe = ctx.pool.get(r.mod);
      const tier = pe ? pe.tier : null;
      return (!g.eff || (tier && tier <= g.eff)) && reaches(ctx, r.mod, g);
    }).sort((a, b) => a.lvl - b.lvl);
  }

  function meets(m, g, tier) {
    if (m.fam !== g.fam || !!m.des !== g.des) return false;
    if (g.minValue != null) return m.v != null && m.v >= g.minValue;
    const want = tier === undefined ? g.tier : tier;
    return !want || !!(m.tier && m.tier <= want);
  }
  /** Right mod, value too low, but its tier can roll the value: a Divine Orb can fix it (not a fractured one). */
  function nearMiss(m, g) {
    return g.minValue != null && !m.frac && m.fam === g.fam && !!m.des === g.des && m.v != null && m.v < g.minValue && m.hi != null && m.hi >= g.minValue;
  }
  function goalMet(st, g) { return st.mods.some((m) => meets(m, g, g.eff)); }
  function useful(m, goals) { return m.lock || goals.some((g) => meets(m, g, g.eff) || nearMiss(m, g)); }
  /** Can this mod id reach the goal's value (always true without a value goal)? */
  function reaches(ctx, id, g) {
    if (g.minValue == null) return true;
    const r = rangeOf(ctx, id);
    return !!r && r[1] >= g.minValue;
  }

  /** Is the goal reachable at all on this base, item level and effective tier? */
  function goalFeasible(ctx, st, g) {
    if (g.des) {
      if (!ctx.bone) return 'no bone for this item class';
      return desPoolFor(ctx, g.side, 0, null).some((e) => e.fam === g.fam && (!g.eff || e.tier <= g.eff) && reaches(ctx, e.id, g)) ? null
        : g.minValue != null ? `no tier reaches ${g.minValue} at this item level` : 'cannot roll at this item level';
    }
    if (g.essenceOnly) {
      if (st.mods.filter((m) => m.crafted && !meets(m, g, g.eff)).length >= (ctx.craftedCap || 1)) return 'the crafted slot is already used';
      return (g.ess || []).length ? null : 'no essence gives this mod on this item class';
    }
    const viaEssence = essenceOptions(ctx, g, 'magic').length + essenceOptions(ctx, g, 'rare').length > 0;
    const ok = sidePool(ctx, g.side, 0).some((e) => e.fam === g.fam && (!g.eff || e.tier <= g.eff) && reaches(ctx, e.id, g)) || viaEssence;
    if (!ok) return g.minValue != null ? `no tier reaches ${g.minValue} at this item level` : 'this tier cannot roll at this item level';
    const blocker = st.mods.find((m) => (m.frac || m.lock) && !meets(m, g, g.eff) && m.grp.some((x) => (g.grp || []).includes(x)));
    if (blocker) return 'blocked by a kept or fractured mod of the same group';
    const stopper = st.mods.find((m) => (m.frac || m.lock) && !meets(m, g, g.eff) && tagStops(ctx, m, g));
    return stopper ? 'a kept or fractured mod stops it from rolling (the game keeps other elements\' spell modifiers off)' : null;
  }

  // ---------------------------------------------------------------- policy

  /**
   * One strategy. params:
   *  tier: 'base'|'greater'|'perfect'  orb tier for exalt/chaos (and transmute/augment/regal)
   *  sideOmens: bool   Sinistral/Dextral omens to aim at the goal's side
   *  greaterExalt: bool  Omen of Greater Exaltation when two slots on the goal side are open
   *  removal: 'chaos'|'erasure'|'whittle'|'annul'
   *  start: 'alchemy'|'transmute'  from a Normal item
   *  restart: bool     Magic chain: a miss on the first mod means a new base
   *  pair: bool        with restart: the Magic item must carry a goal mod on each side that has goals before it turns
   *                    Rare; an Augmentation that misses such a side means a new base (cheap orbs instead of costly
   *                    removals on the Rare item later)
   *  slamOnly: bool    with restart: on the Rare item, fill the open slots and start over on a new base when a goal's
   *                    side is full of unwanted mods, instead of paying for removals that may hit a finished goal
   *  bone: 'Gnawed'|'Preserved'|'Ancient', echoes: bool, lich: bool
   *  essence: bool     use an essence when one guarantees an unmet goal (and the crafted slot is free)
   */
  function makePolicy(ctx, goals, params) {
    const unmet = (st) => goals.filter((g) => !goalMet(st, g));
    const resGoal = (g) => !g.des && /^(Fire|Cold|Lightning)Resistance$/.test(g.fam || '');
    /** Flux when it finishes an unmet resistance goal from one mod of another element and keeps every finished goal. */
    function fluxStep(st, left) {
      if (params.flux === false || (st.rarity !== 'Magic' && st.rarity !== 'Rare')) return null;
      for (const g of left) {
        if (!resGoal(g) || st.mods.some((m) => m.fam === g.fam)) continue;
        const to = g.fam.replace('Resistance', '').toLowerCase();
        const src = st.mods.filter((m) => { const r = resElement(m.id); return r && r.el !== to && !m.frac; });
        if (src.length !== 1) continue; // two sources would become two mods of one group: not modelled
        const a = { op: 'flux', to };
        if (validate(ctx, st, a)) continue;
        const after = apply(ctx, st, a, () => 0.5).state;
        if (goalMet(after, g) && goals.every((x) => !goalMet(st, x) || goalMet(after, x))) return a;
      }
      return null;
    }
    return function next(st) {
      const left = unmet(st);
      if (!left.length) return { done: true };
      if (st.corrupted || st.sanctified) return { fail: 'item is locked' };
      const fx = fluxStep(st, left);
      if (fx) return fx;
      const R = st.rarity;
      const sideNeed = (s) => left.filter((g) => g.side === s).length;
      const lean = sideNeed('prefix') > sideNeed('suffix') ? 'prefix' : sideNeed('suffix') > sideNeed('prefix') ? 'suffix' : null;
      const craftedFree = st.mods.filter((m) => m.crafted).length < (ctx.craftedCap || 1);
      const taken = groupsOf(st);
      const magicEss = params.essence && craftedFree
        ? left.map((g) => ({ g, r: essenceOptions(ctx, g, 'magic').find((r) => !ctx.kb.mods[r.mod].grp.some((x) => taken.has(x))) })).find((x) => x.r)
        : null;
      if (R === 'Normal') {
        if (params.start === 'alchemy' && !magicEss) return { op: 'alchemy', side: params.sideOmens ? lean : null };
        return { op: 'transmute', tier: params.magicTier || params.tier };
      }
      if (R === 'Magic') {
        // An essence turns the Magic item Rare with a guaranteed goal mod; keep a useful first mod for it.
        if (magicEss) {
          const junkOnly = st.mods.length === 1 && !useful(st.mods[0], goals) && !st.mods[0].frac;
          if (!(params.restart && junkOnly && left.length > 1)) return { op: 'essence', item: magicEss.r.item, mod: magicEss.r.mod };
        }
        const anyHit = st.mods.some((m) => useful(m, goals));
        if (params.start === 'transmute' && params.restart && st.mods.length === 1 && !anyHit && !st.mods[0].frac) return { op: 'newbase' };
        if (params.pair && params.restart && st.mods.length === 2) {
          const junk = st.mods.find((m) => !useful(m, goals) && !m.frac);
          if (junk && left.some((x) => x.side === junk.side && !x.des && !x.essenceOnly)) return { op: 'newbase' };
        }
        if (open(ctx, st, 'prefix') + open(ctx, st, 'suffix') > 0 && st.mods.length < 2) return { op: 'augment', tier: params.magicTier || params.tier };
        return { op: 'regal', tier: params.magicTier || params.tier, side: params.sideOmens ? lean : null };
      }
      if (R !== 'Rare') return { fail: 'unsupported rarity' };
      const desJunk = st.mods.find((m) => m.des && !useful(m, goals) && !m.frac);
      // Fracture (a plan variant): with 4 mods and a finished goal among them (or 5 and two), lock one at random.
      if (params.fracture && !st.mods.some((m) => m.frac)) {
        const keep = st.mods.filter((m) => goals.some((x) => meets(m, x, x.eff)));
        if (keep.length && (st.mods.length === 4 || (st.mods.length === 5 && keep.length >= 2))) return { op: 'fracture' };
      }
      // Values come last: when every goal left only needs a better roll on a mod that is already there, reroll values.
      if (left.every((x) => st.mods.some((m) => nearMiss(m, x)))) return { op: 'divine' };
      // Work on a goal that can be slammed into an open slot first; removals come after.
      const blocks = (g) => st.mods.some((m) => removable(m) && !useful(m, goals) && blocksGoal(ctx, m, g));
      const ready = (g) => !blocks(g) && open(ctx, st, g.side) > 0 && (!g.des || !st.mods.some((m) => m.des));
      const g = left.find((x) => x.required && ready(x)) || left.find((x) => x.required) || left.find(ready) || left[0];
      // Perfect/special essence: removes a random mod (side chosen with Crystallisation) and adds the goal mod.
      if (params.essence && craftedFree) {
        for (const eg of left) {
          const r = essenceOptions(ctx, eg, 'rare').find((x) => !ctx.kb.mods[x.mod].grp.some((y) => taken.has(y)));
          if (!r) continue;
          const mside = ctx.kb.mods[r.mod].gen === 'p' ? 'prefix' : 'suffix';
          const junkSide = (s) => st.mods.some((m) => m.side === s && removable(m) && !useful(m, goals));
          const cleanSide = (s) => st.mods.filter((m) => m.side === s && removable(m)).every((m) => !useful(m, goals));
          let side = null;
          if (junkSide(mside) && cleanSide(mside)) side = mside;
          else if (open(ctx, st, mside) > 0 && junkSide(other(mside)) && cleanSide(other(mside))) side = other(mside);
          else if (junkSide(mside)) side = mside;
          if (r.liquid) {
            // No omen picks the side: a full side of the new mod loses one of its own mods, else any mod can go (R_SWAP_REMOVAL).
            if (open(ctx, st, mside) < 1 ? junkSide(mside) : st.mods.some((m) => removable(m) && !useful(m, goals))) return { op: 'liquid', item: r.item, mod: r.mod };
            continue;
          }
          // A full essence side loses one of its own mods without an omen (R_SWAP_REMOVAL): the omen only helps the other way.
          // Runic Alloys take no omen (Crystallisation names Perfect and Corrupted essences): they go only where any removal is safe.
          if (r.alloy) {
            if (open(ctx, st, mside) < 1 ? junkSide(mside) && cleanSide(mside) : st.mods.every((m) => !removable(m) || !useful(m, goals))) return { op: 'pessence', item: r.item, mod: r.mod, side: null };
            continue;
          }
          if (side) return { op: 'pessence', item: r.item, mod: r.mod, side: params.sideOmens && !(side === mside && open(ctx, st, mside) < 1) ? side : null };
        }
      }
      if (g.essenceOnly) return { fail: 'needs an essence (none applies now)' };
      if (g.des) {
        if (desJunk) return { op: 'annul', light: true };
        if (st.mods.some((m) => m.des)) return { fail: 'a kept Desecrated mod blocks the desecrated goal' };
        if (open(ctx, st, g.side) > 0) {
          return {
            op: 'bone', quality: params.bone || 'Preserved', side: params.sideOmens ? g.side : null,
            lich: params.lich && g.lich && (WEAPON.includes(ctx.cls) || JEWELLERY.includes(ctx.cls)) ? g.lich : null,
            echoes: !!params.echoes,
          };
        }
        return removal(st, g.side, desJunk);
      }
      // A junk mod from the goal's group (e.g. a lower tier of the same stat) must go first.
      const blocking = st.mods.find((m) => removable(m) && !useful(m, goals) && blocksGoal(ctx, m, g));
      if (blocking) return removal(st, blocking.side, desJunk, blocking);
      if (open(ctx, st, g.side) > 0) {
        const two = params.greaterExalt && open(ctx, st, g.side) >= 2 && left.filter((x) => x.side === g.side && !x.des).length >= 2;
        const catalyse = !!(params.catalyse && st.catQ > 0 && st.catTag && famHasTag(ctx, g.fam, st.catTag));
        return { op: 'exalt', tier: params.exaltTier || params.tier, side: params.sideOmens ? g.side : null, greater: two, catalyse };
      }
      if (params.slamOnly && params.restart && !g.des && !st.mods.some((m) => m.frac || m.lock)) return { op: 'newbase' };
      return removal(st, g.side, desJunk);
    };

    function removal(st, side, desJunk, target) {
      const junk = st.mods.filter((m) => m.side === side && removable(m) && !useful(m, goals));
      if (!junk.length) {
        return { fail: st.mods.some((m) => m.side === side && m.lock && !goals.some((g) => meets(m, g, g.eff))) ? `${side} slots are full of kept mods` : `${side} slots are full` };
      }
      if (desJunk && desJunk.side === side) return { op: 'annul', light: true };
      const rm = params.removal;
      if (rm === 'whittle') {
        const cands = st.mods.filter(removable);
        const low = Math.min(...cands.map((m) => m.lvl));
        const lows = cands.filter((m) => m.lvl === low);
        if (lows.every((m) => !useful(m, goals)) && (!target || lows.includes(target))) return { op: 'chaos', tier: params.chaosTier || params.tier, whittle: true };
        return { op: 'chaos', tier: params.chaosTier || params.tier, side };
      }
      if (rm === 'erasure') return { op: 'chaos', tier: params.chaosTier || params.tier, side };
      if (rm === 'annul') return { op: 'annul', side: params.sideOmens ? side : null };
      return { op: 'chaos', tier: params.chaosTier || params.tier };
    }
  }

  /** Do the tags this mod gives the item (adds_tags) stop every natural tier of the goal's family on this base? */
  function tagStops(ctx, m, g) {
    const at = m.id && ctx.kb.mods[m.id] && ctx.kb.mods[m.id].at;
    if (!at || g.des || g.essenceOnly) return false;
    const k = m.id + '|' + g.fam + '|' + g.side;
    if (!ctx._stops) ctx._stops = new Map();
    if (!ctx._stops.has(k)) {
      const added = new Set(at);
      const fam = sidePool(ctx, g.side, 0).filter((e) => e.fam === g.fam);
      ctx._stops.set(k, fam.length > 0 && fam.every((e) => E.tagBlocked(ctx.kb.mods[e.id], ctx.baseTags, added)));
    }
    return ctx._stops.get(k);
  }
  /**
   * Can this goal never share the item with another one? Every natural tier of the other goal's family gives the item tags
   * that stop this family (a Fire spell damage prefix keeps the Cold one off, game data adds_tags).
   */
  function goalClash(ctx, goals, g) {
    for (const o of goals) {
      if (o === g || o.des || o.essenceOnly || g.des || g.essenceOnly) continue;
      const fam = sidePool(ctx, o.side, 0).filter((e) => e.fam === o.fam);
      if (fam.length && fam.every((e) => tagStops(ctx, { id: e.id }, g))) return `cannot roll together with "${o.label}" (the game keeps other elements' spell modifiers off)`;
    }
    return null;
  }
  /** Must this mod go before the goal can roll: same group, or its tags stop the goal's family? */
  function blocksGoal(ctx, m, g) {
    return m.grp.some((x) => (g.grp || []).includes(x)) || tagStops(ctx, m, g);
  }

  /** Does this mod family carry the tag a catalyst favours (e.g. 'life')? */
  function famHasTag(ctx, fam, tag) {
    const k = fam + '|' + tag;
    if (!ctx._famTag) ctx._famTag = new Map();
    if (!ctx._famTag.has(k)) ctx._famTag.set(k, (ctx.ix.famMods.get(fam) || []).some((id) => (ctx.kb.mods[id].mt || []).includes(tag)));
    return ctx._famTag.get(k);
  }

  function pickFor(goals, ctx) {
    return function (opts) {
      for (const g of goals) {
        if (!g.des) continue;
        const hit = opts.find((o) => o.fam === g.fam && (g.minValue != null ? reaches(ctx, o.id, g) : !g.eff || o.tier <= g.eff));
        if (hit) return hit;
      }
      return null;
    };
  }

  // ---------------------------------------------------------------- simulation

  function actionKey(a, ctx) { return actionNames(a, ctx).join(' + '); }

  /**
   * Monte Carlo of one strategy from the current state.
   * opts: { trials, seed, maxSteps, budget, priceOf(name)->ex|null, baseCost }
   * createRun() lets callers run the trials in slices (see simulateAsync).
   *
   * Every run ends in exactly one outcome:
   *   success    all goals reached
   *   dead end   the item can no longer reach the goals (a kept or fractured mod blocks it, a rule stops the next step)
   *   budget     the next step would pass the budget
   *   unfinished still going after maxSteps uses (reported apart; with 600 uses this is rare)
   * White and Magic items restart on fresh bases with cheap orbs, which can take thousands of uses: those uses (new
   * base, Transmutation, Augmentation, Alchemy, Regal on a Normal or Magic item) count against maxMagicSteps (default
   * 30,000) instead, so a cheap long loop is not mistaken for a failure. The result counts the white bases a finished
   * item takes (basesPerSuccess), so the profiles can keep to the player's limit (opts.baseLimit).
   */
  function createRun(ctx, st0, goals, params, opts) {
    if (goals.some((g) => g.minValue != null)) ctx.needValues = true;
    const rng = rngFrom(opts.seed || 1);
    const policy = makePolicy(ctx, goals, params);
    const skipped = new Set();
    const next = opts.priceOf ? (st) => withoutUnpriced(policy(st), (n) => opts.priceOf(n) != null, skipped) : policy;
    const pick = pickFor(goals, ctx);
    const maxSteps = opts.maxSteps || 600;
    const maxMagicSteps = opts.maxMagicSteps || 30000;
    const baseLimit = opts.baseLimit > 0 ? opts.baseLimit : null;
    const costCache = new Map();
    const missing = new Set();
    const costOf = (a) => {
      const k = actionKey(a, ctx);
      if (costCache.has(k)) return costCache.get(k);
      let c = 0;
      for (const n of actionNames(a, ctx)) {
        const p = n === 'New base' ? (opts.baseCost || 0) : opts.priceOf ? opts.priceOf(n) : null;
        if (p == null) missing.add(n); else c += p;
      }
      costCache.set(k, c);
      return c;
    };
    const required = goals.filter((g) => g.required);
    const acc = { n: 0, succ: 0, partial: 0, lost: 0, stepsSum: 0, costs: [], fails: new Map(), uses: new Map(), order: new Map(), hits: new Map(),
      out: { dead: 0, budget: 0, unfinished: 0 }, doneAt: [], basesSum: 0 };
    const metCount = (s) => { let n = 0; for (const g of goals) if (goalMet(s, g)) n++; return n; };
    // Steps are listed by where they first come in a run (averaged), so restart loops do not scramble the order.
    let seen = null;
    const book = (k, a, n, first, hits) => {
      if (!n) return;
      acc.uses.set(k, (acc.uses.get(k) || 0) + n);
      let o = acc.order.get(k);
      if (!o) acc.order.set(k, (o = { sum: 0, n: 0, action: a }));
      if (!seen.has(k)) { seen.add(k); o.sum += first; o.n++; }
      if (hits) acc.hits.set(k, (acc.hits.get(k) || 0) + hits);
    };
    const NEWBASE = { op: 'newbase' };
    const keepTables = new Map();
    /**
     * Which first mods of a Transmutation on this white base the strategy keeps, by weight: {q, kept, junk}, where q is
     * the chance a Transmutation is kept and kept/junk are the two weighted lists of pool entries. Built once per action.
     */
    function keepTable(white, a) {
      const k = actionKey(a, ctx);
      if (keepTables.has(k)) return keepTables.get(k);
      const probe = cloneState(white);
      probe.rarity = 'Magic';
      const floor = floorFor(ctx, 'transmute', a.tier || 'base');
      const kept = { list: [], ws: [], total: 0 }, junk = { list: [], ws: [], total: 0 };
      for (const side of openSides(ctx, probe)) for (const e of sidePool(ctx, side, floor)) {
        const s1 = cloneState(probe);
        addRolled(ctx, s1, e, null, null);
        const into = next(s1).op === 'newbase' ? junk : kept;
        into.list.push(e); into.ws.push(e.w); into.total += e.w;
      }
      const all = kept.total + junk.total;
      const tab = all > 0 ? { q: kept.total / all, kept, junk } : null;
      keepTables.set(k, tab);
      return tab;
    }
    /**
     * A white base that the strategy throws away whenever its first mod does not help: transmute it, and while the
     * policy asks for a new base, pay for one and transmute again. The same uses and outcomes as the general loop, booked
     * in bulk, because such loops can run thousands of times per run. run: {cost, steps, early}, updated in place.
     */
    function restartLoop(run, white, a) {
      const kT = actionKey(a, ctx), kB = actionKey(NEWBASE, ctx), cT = costOf(a), cB = costOf(NEWBASE);
      const tab = !opts.budget && !ctx.needValues ? keepTable(white, a) : null;
      if (tab) {
        // Draw the number of Transmutations until one is kept (geometric), then the kept mod by weight.
        const room = Math.ceil((maxMagicSteps - run.early + 1) / 2); // Transmutations before the Magic-stage limit
        let n = tab.q >= 1 ? 1 : tab.q <= 0 ? Infinity : 1 + Math.floor(Math.log(1 - rng()) / Math.log(1 - tab.q));
        const stop = n > room ? 'limit' : null;
        if (stop) n = room;
        const pool = stop ? tab.junk : tab.kept;
        let r = rng() * pool.total, e = pool.list[pool.list.length - 1];
        for (let i = 0; i < pool.list.length; i++) { r -= pool.ws[i]; if (r <= 0) { e = pool.list[i]; break; } }
        const kept = cloneState(white);
        kept.rarity = 'Magic';
        if (e) addRolled(ctx, kept, e, null, rng);
        const s0 = run.steps;
        run.cost += n * cT + (n - 1) * cB; run.steps += 2 * n - 1; run.early += 2 * n - 1; run.bases += n - 1;
        book(kT, a, n, s0 + 1, !stop && metCount(kept) > 0 ? 1 : 0);
        book(kB, NEWBASE, n - 1, s0 + 2, 0);
        return { kept, stop };
      }
      let tries = 0, bases = 0, firstT = 0, firstB = 0, kept = null, stop = null;
      for (;;) {
        if (opts.budget && run.cost + cT > opts.budget) { stop = 'budget'; break; }
        run.cost += cT; run.steps++; run.early++; tries++; if (!firstT) firstT = run.steps;
        const r = apply(ctx, white, a, rng, pick);
        const b = next(r.state);
        if (b.op !== 'newbase') { kept = r.state; break; }
        if (run.early >= maxMagicSteps) { kept = r.state; stop = 'limit'; break; }
        if (opts.budget && run.cost + cB > opts.budget) { kept = r.state; stop = 'budget'; break; }
        run.cost += cB; run.steps++; run.early++; run.bases++; bases++; if (!firstB) firstB = run.steps;
      }
      book(kT, a, tries, firstT, kept && metCount(kept) > 0 ? 1 : 0);
      book(kB, NEWBASE, bases, firstB, 0);
      return { kept, stop };
    }
    function one() {
      let st = st0, cost = 0, steps = 0, early = 0, bases = 0, fail = null, kind = null, lostGoal = false;
      seen = new Set();
      for (;;) {
        const a = next(st);
        if (a.done) break;
        if (a.fail) { fail = a.fail; kind = 'dead'; break; }
        const err = validate(ctx, st, a);
        if (err) { fail = err; kind = 'dead'; break; }
        if (a.op === 'transmute' && st.rarity === 'Normal' && params.restart) {
          const run = { cost, steps, early, bases };
          const { kept, stop } = restartLoop(run, st, a);
          cost = run.cost; steps = run.steps; early = run.early; bases = run.bases;
          if (kept) st = kept;
          if (stop === 'budget') { fail = 'over budget'; kind = 'budget'; break; }
          if (stop === 'limit') { fail = `no fitting Magic item within ${maxMagicSteps} uses`; kind = 'unfinished'; break; }
          continue;
        }
        const c = costOf(a);
        if (opts.budget && cost + c > opts.budget) { fail = 'over budget'; kind = 'budget'; break; }
        cost += c; steps++;
        if (a.op === 'newbase') bases++;
        const magicStage = a.op === 'newbase' || st.rarity === 'Normal' || st.rarity === 'Magic';
        if (magicStage) early++;
        const k = actionKey(a, ctx);
        book(k, a, 1, steps, 0);
        const before = metCount(st);
        const r = apply(ctx, st, a, rng, pick);
        if (r.removed.some((m) => goals.some((g) => meets(m, g, g.eff)))) lostGoal = true;
        st = r.state;
        if (metCount(st) > before) acc.hits.set(k, (acc.hits.get(k) || 0) + 1);
        if (steps - early >= maxSteps && !goals.every((g) => goalMet(st, g))) { fail = `not finished within ${maxSteps} uses`; kind = 'unfinished'; break; }
        if (early >= maxMagicSteps && !goals.every((g) => goalMet(st, g))) { fail = `no fitting Magic item within ${maxMagicSteps} uses`; kind = 'unfinished'; break; }
      }
      if (kind) acc.out[kind]++;
      const ok = !fail && goals.every((g) => goalMet(st, g));
      if (ok) { acc.succ++; acc.doneAt.push(steps); }
      else if (required.length && required.every((g) => goalMet(st, g))) acc.partial++;
      if (fail) acc.fails.set(fail, (acc.fails.get(fail) || 0) + 1);
      if (lostGoal) acc.lost++;
      acc.stepsSum += steps;
      acc.basesSum += bases;
      acc.costs.push(cost);
      acc.n++;
    }
    return {
      step(n) { for (let i = 0; i < n; i++) one(); },
      get done() { return acc.n; },
      result() {
        const N = acc.n;
        const costs = acc.costs.slice().sort((a, b) => a - b);
        const q = (p) => costs[Math.min(costs.length - 1, Math.floor(p * costs.length))];
        const mean = costs.reduce((a, b) => a + b, 0) / N;
        const p = acc.succ / N;
        const se = Math.sqrt(Math.max(p * (1 - p), 1e-9) / N);
        const steps = [...acc.uses.entries()].map(([k, n]) => {
          const o = acc.order.get(k);
          return { key: k, names: k.split(' + '), avg: n / N, cost: costCache.get(k), order: o.sum / o.n, action: o.action, hit: (acc.hits.get(k) || 0) / n };
        }).sort((a, b) => a.order - b.order);
        return {
          params, trials: N, p, pLow: Math.max(0, p - 1.96 * se), pHigh: Math.min(1, p + 1.96 * se), maxSteps,
          pFail: 1 - p, failDead: acc.out.dead / N, failBudget: acc.out.budget / N, unfinished: acc.out.unfinished / N,
          meanBases: acc.basesSum / N, basesPerSuccess: p > 0 ? acc.basesSum / N / p : Infinity, baseLimit,
          // P(all goals reached within n uses) from the same runs, so per-use and whole-plan chances line up
          finishWithin: [1, 3, 5, 10, 25, 50, 100, 250, 600].map((n) => ({ n, p: acc.doneAt.filter((x) => x <= n).length / N })),
          partial: acc.partial / N, lost: acc.lost / N, meanCost: mean, p10: q(0.1), p50: q(0.5), p90: q(0.9),
          costPerSuccess: p > 0 ? mean / p : Infinity, meanSteps: acc.stepsSum / N, steps,
          fails: [...acc.fails.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => ({ reason: r, share: n / N })),
          missingPrices: [...missing], skippedUnpriced: [...skipped], weighted: !!ctx.weights, imputed: ctx.imputed.size,
        };
      },
    };
  }

  function simulate(ctx, st0, goals, params, opts) {
    const run = createRun(ctx, st0, goals, params, opts);
    run.step(opts.trials || 2000);
    return run.result();
  }

  /** Same as simulate, yielding to the page every `slice` trials so the UI stays responsive. */
  async function simulateAsync(ctx, st0, goals, params, opts) {
    const run = createRun(ctx, st0, goals, params, opts);
    const total = opts.trials || 2000, slice = opts.slice || 200;
    const t0 = Date.now();
    while (run.done < total) {
      if (opts.cancelled && opts.cancelled()) throw new Error('cancelled');
      run.step(Math.min(slice, total - run.done));
      const f = run.done / total;
      if (opts.onSlice) opts.onSlice(opts.timeBudgetMs ? Math.max(f, (Date.now() - t0) / opts.timeBudgetMs) : f);
      // Long plans (hundreds of uses per run) stop at the time budget once enough runs are in.
      if (opts.timeBudgetMs && Date.now() - t0 > opts.timeBudgetMs && run.done >= (opts.minTrials || 1000)) break;
      await tick();
    }
    return run.result();
  }

  // ---------------------------------------------------------------- profiles

  /** Does the plan keep to the player's limit of white bases per finished item? */
  const fits = (r) => !(r.baseLimit > 0 && r.basesPerSuccess > r.baseLimit);
  const PROFILES = {
    cheap: {
      label: 'Cheap',
      goals: (gs) => gs.filter((g) => g.required).map((g) => Object.assign({}, g, { eff: g.tier ? Math.max(g.tier, 3) : null })),
      grid: () => cross({ tier: ['base', 'greater'], sideOmens: [false, true], greaterExalt: [false], removal: ['chaos', 'erasure', 'annul'],
        start: ['alchemy', 'transmute'], restart: [true], bone: ['Preserved'], echoes: [false], lich: [false], essence: [false, true] }),
      // cheapest per success among strategies that succeed at least one run in five (else the most likely one)
      score: (r) => (!fits(r) ? 1e16 + r.basesPerSuccess : r.p >= 0.2 ? r.costPerSuccess : 1e15 * (2 - r.p)),
    },
    balanced: {
      label: 'Balanced',
      goals: (gs) => gs.map((g) => Object.assign({}, g, { eff: !g.tier ? null : g.required ? (g.tier === 1 ? 2 : g.tier) : Math.max(g.tier, 3) })),
      grid: () => cross({ tier: ['greater', 'perfect'], sideOmens: [true], greaterExalt: [false, true], removal: ['chaos', 'erasure', 'whittle', 'annul'],
        start: ['transmute', 'alchemy'], restart: [true], bone: ['Preserved'], echoes: [true], lich: [true], essence: [false, true] }),
      // cost per success, weighed by the chance to finish; strategies that fail more often than not only as a last resort
      score: (r) => (!fits(r) ? 1e16 + r.basesPerSuccess : r.p >= 0.5 ? r.costPerSuccess * (1 + 0.6 * (1 - r.p)) : 1e15 * (2 - r.p)),
    },
    premium: {
      label: 'Premium',
      goals: (gs) => gs.map((g) => Object.assign({}, g, { eff: g.tier || null })),
      grid: () => cross({ tier: ['perfect', 'greater'], sideOmens: [true], greaterExalt: [false, true], removal: ['whittle', 'erasure', 'annul'],
        start: ['transmute'], restart: [true], bone: ['Ancient', 'Preserved'], echoes: [true], lich: [true], essence: [false, true] }),
      // Highest success first, but a 10x cost must buy at least 5 points of success; near-certain (98%+) strategies
      // compare on cost alone.
      score: (r) => (!fits(r) ? 10 + r.basesPerSuccess / 1e9 : -(Math.min(r.p, 0.98) - 0.05 * Math.log10(1 + r.costPerSuccess))),
    },
  };

  function cross(spec) {
    let out = [{}];
    for (const [k, vals] of Object.entries(spec)) {
      const nx = [];
      for (const o of out) for (const v of vals) nx.push(Object.assign({}, o, { [k]: v }));
      out = nx;
    }
    return out;
  }

  // ---------------------------------------------------------------- candidate generation (master prompt 7.4)
  // Candidates come from (a) the profile's grid of strategies, (b) recipes of the library whose goals overlap the
  // player's, turned into strategy settings, and (c) a bounded beam search that changes one setting at a time from the
  // best candidates (width 6, depth up to 8, with a time limit). Every candidate is simulated and scored by the profile.

  /** The strategy settings the beam search moves along, one at a time. */
  const SPACE = {
    exaltTier: TIERS, chaosTier: TIERS, magicTier: TIERS, sideOmens: [false, true], greaterExalt: [false, true],
    removal: ['chaos', 'erasure', 'whittle', 'annul'], start: ['transmute', 'alchemy'], restart: [true, false], pair: [false, true], slamOnly: [false, true],
    essence: [false, true], fracture: [false, true], catalyse: [false, true], flux: [true, false],
    bone: ['Gnawed', 'Preserved', 'Ancient'], echoes: [false, true], lich: [false, true],
  };
  const BEAM_WIDTH = 6, BEAM_DEPTH = 8;
  /** A complete strategy: the per-operation orb tiers filled from `tier`, every setting present. */
  function expandStrategy(p) {
    const t = p.tier || 'base';
    const out = Object.assign({ exaltTier: t, chaosTier: t, magicTier: t, sideOmens: false, greaterExalt: false, removal: 'chaos', start: 'transmute',
      restart: true, pair: false, slamOnly: false, essence: false, fracture: false, catalyse: false, flux: true, bone: 'Preserved', echoes: false, lich: false }, p);
    delete out.tier;
    return out;
  }
  /** Settings that can change the result on this item and these goals. */
  function relevantKeys(st, goals) {
    const keys = st.rarity !== 'Rare' ? ['slamOnly', 'pair', 'magicTier', 'start', 'restart'] : [];
    keys.push('exaltTier', 'chaosTier', 'sideOmens', 'greaterExalt', 'removal', 'flux');
    if (goals.some((g) => (g.ess || []).length)) keys.push('essence');
    if (goals.length >= 2) keys.push('fracture');
    if (st.catTag && st.catQ > 0) keys.push('catalyse');
    if (goals.some((g) => g.des)) keys.push('bone', 'echoes', 'lich');
    return keys;
  }
  /**
   * Strategy settings a recipe's steps imply (the currency and omens it names). Settings it does not name are left
   * to the search. Returns {} when nothing maps.
   */
  function recipeParams(r) {
    const txt = (r.steps || []).map((x) => `${x.text || ''} ${(x.names || []).join(' ')}`).join(' ');
    const f = {};
    if (/Sinistral|Dextral/.test(txt)) f.sideOmens = true;
    if (/Omen of Greater Exaltation/.test(txt)) f.greaterExalt = true;
    if (/Whittling/.test(txt)) f.removal = 'whittle'; else if (/Erasure/.test(txt)) f.removal = 'erasure'; else if (/Annulment/.test(txt) && !/Omen of Light/.test(txt)) f.removal = 'annul';
    if (/Perfect (Exalted|Chaos|Regal|Orb of)/.test(txt)) f.tier = 'perfect'; else if (/Greater (Exalted|Chaos|Regal|Orb of)/.test(txt)) f.tier = 'greater';
    if (/Orb of Alchemy/.test(txt)) f.start = 'alchemy'; else if (/Transmutation/.test(txt)) f.start = 'transmute';
    if (/Essence/.test(txt)) f.essence = true;
    if (/Fracturing/.test(txt)) f.fracture = true;
    return f;
  }

  /**
   * From a white or Magic item, the restart strategies too: for each orb tier, essence and side-omen choice of
   * the profile's transmute strategies, start over instead of paying for removals on the Rare item (slamOnly), with or
   * without keeping only Magic items that carry the goals (pair). They trade cheap orbs and many bases for costly omens.
   */
  function withRestarts(st, grid) {
    if (st.rarity === 'Rare') return grid;
    const seen = new Set(), extra = [];
    for (const p of grid) {
      if (p.start !== 'transmute' || !p.restart) continue;
      const k = [p.tier, p.essence, p.sideOmens].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      for (const v of [{ pair: true, slamOnly: true }, { slamOnly: true }]) extra.push(Object.assign({}, p, v));
    }
    return grid.concat(extra);
  }

  /**
   * A route past the player's white-base limit that costs less than half per finished item and meets the profile's
   * success floor; of those, the one that needs the fewest bases (the smallest step up). {bases, cps, p} from the
   * screening runs, so approximate; null when there is none.
   */
  function moreBasesHint(prof, candidates, plan) {
    const ok = (r) => r && r.p > 0 && !fits(r) && r.costPerSuccess < 0.5 * plan.costPerSuccess && prof.score(Object.assign({}, r, { baseLimit: null })) < 1e15;
    let alt = null;
    for (const r of candidates) if (ok(r) && (!alt || r.basesPerSuccess < alt.basesPerSuccess)) alt = r;
    const old = plan.moreBases && { costPerSuccess: plan.moreBases.cps, basesPerSuccess: plan.moreBases.bases, p: plan.moreBases.p, baseLimit: plan.baseLimit };
    if (old && ok(old) && (!alt || old.basesPerSuccess < alt.basesPerSuccess)) alt = old;
    return alt ? { bases: Math.ceil(alt.basesPerSuccess), cps: alt.costPerSuccess, p: alt.p } : null;
  }

  /** Screening runs of one profile: every candidate simulated once, identical ones (on this item) shared. */
  function makeScreen(ctx, st, pg, input) {
    const keys = relevantKeys(st, pg);
    const sigOf = (p) => JSON.stringify(keys.map((k) => p[k]));
    const evaluated = new Map();
    const opts = { trials: input.screenTrials || 200, priceOf: input.priceOf, baseCost: input.baseCost, budget: input.budget, cancelled: input.cancelled,
      baseLimit: input.baseLimit, maxSteps: 250, timeBudgetMs: 400, minTrials: 60 };
    async function screen(p, from) {
      const full = expandStrategy(p);
      const sig = sigOf(full);
      if (evaluated.has(sig)) return evaluated.get(sig);
      const r = await simulateAsync(ctx, st, pg, full, Object.assign({ seed: 7 + evaluated.size }, opts));
      r.from = from || null;
      evaluated.set(sig, r);
      return r;
    }
    return { keys, sigOf, evaluated, screen };
  }
  /** Beam search (width 6, depth up to 8, time limit): change one setting of the best candidates at a time. */
  async function beamSearch(sc, prof, budgetMs, onProgress) {
    const rank = () => [...sc.evaluated.values()].filter((r) => r.p > 0).sort((a, b) => prof.score(a) - prof.score(b)).slice(0, BEAM_WIDTH);
    let beam = rank(), depth = 0;
    const t0 = Date.now();
    while (beam.length && depth < BEAM_DEPTH && Date.now() - t0 < budgetMs) {
      const before = beam.map((r) => sc.sigOf(r.params)).join('|');
      for (const r of beam) for (const k of sc.keys) for (const v of SPACE[k]) {
        if (r.params[k] === v || Date.now() - t0 >= budgetMs) continue;
        await sc.screen(Object.assign({}, r.params, { [k]: v }), r.from && r.from.recipe ? r.from : { search: true });
        if (onProgress) onProgress(Math.min(1, (Date.now() - t0) / budgetMs));
      }
      depth++;
      beam = rank();
      if (beam.map((r) => sc.sigOf(r.params)).join('|') === before) break; // no better neighbour: converged
    }
    return { best: beam[0] || null, depth };
  }

  /**
   * Build the three plans.
   * input: { ix, item, targets, locks, priceOf, baseCost, budget, trials, screenTrials, weights, essences, catalystMult,
   *          recipes: [{id, title, params}], beamBudgetMs (0 = no search here; see improvePlan), onProgress, cancelled }
   */
  async function buildPlans(input) {
    const ctx = makeContext(input.ix, input.item, { weights: input.weights, essences: input.essences, catalystMult: input.catalystMult });
    const st = toState(ctx, input.item, input.locks);
    const { goals, unsupported } = goalsFromTargets(ctx, input.targets);
    const out = { unsupported, goals, profiles: {}, estimate: !input.weights };
    if (st.corrupted || st.sanctified) { out.blocked = st.corrupted ? 'Corrupted' : 'Sanctified'; return out; }
    if (!goals.length) { out.empty = true; return out; }
    const names = Object.keys(PROFILES);
    const grids = names.map((n) => withRestarts(st, PROFILES[n].grid().filter((p) => st.rarity === 'Normal' || p.start === 'transmute' || !p.start)));
    const total = grids.reduce((a, g) => a + g.length, 0) + names.length;
    let done = 0;
    for (let i = 0; i < names.length; i++) {
      const prof = PROFILES[names[i]];
      const pg = prof.goals(goals);
      const infeasible = pg.map((g) => ({ g, why: goalFeasible(ctx, st, g) || goalClash(ctx, pg, g) })).filter((x) => x.why);
      if (!pg.length) { out.profiles[names[i]] = { label: prof.label, none: 'No required goals. Mark at least one target as Required.' }; done += grids[i].length + 1; continue; }
      if (infeasible.length) { out.profiles[names[i]] = { label: prof.label, impossible: infeasible.map((x) => `${x.g.label}: ${x.why}`) }; done += grids[i].length + 1; continue; }
      const sc = makeScreen(ctx, st, pg, input);
      // (a) the grid
      for (const params of grids[i]) {
        await sc.screen(params, { grid: true });
        done++;
        if (input.onProgress) input.onProgress(done / total);
      }
      // (b) recipes whose goals overlap: the recipe's settings on top of the profile's first strategy
      for (const rc of input.recipes || []) await sc.screen(Object.assign({}, grids[i][0], rc.params), { recipe: rc.id, title: rc.title });
      // (c) beam search from the best candidates (the page runs it later with improvePlan, after showing the plans)
      const budget = input.beamBudgetMs == null ? 2500 : input.beamBudgetMs;
      const { best: found, depth } = budget > 0 ? await beamSearch(sc, prof, budget) : { best: null, depth: 0 };
      const ranked = [...sc.evaluated.values()].filter((r) => r.p > 0).sort((a, b) => prof.score(a) - prof.score(b));
      const best = found || ranked[0] || null;
      if (!best) {
        const r = simulate(ctx, st, pg, expandStrategy(grids[i][0]), { trials: 400, seed: 3, priceOf: input.priceOf, baseCost: input.baseCost, budget: input.budget, baseLimit: input.baseLimit });
        out.profiles[names[i]] = { label: prof.label, noSuccess: true, fails: r.fails };
        done++;
        continue;
      }
      const final = await simulateAsync(ctx, st, pg, best.params, {
        trials: input.trials || 4000, seed: 99, priceOf: input.priceOf, baseCost: input.baseCost, budget: input.budget, cancelled: input.cancelled,
        baseLimit: input.baseLimit, timeBudgetMs: input.timeBudgetMs || 2500, minTrials: Math.min(input.trials || 4000, 800),
        onSlice: (f) => input.onProgress && input.onProgress((done + f) / total),
      });
      final.label = prof.label;
      final.profile = names[i];
      final.goals = pg;
      final.dropped = goals.filter((g) => !pg.some((x) => x.key === g.key));
      final.from = best.from;
      final.seeds = ranked.slice(0, BEAM_WIDTH).map((r) => ({ params: r.params, from: r.from }));
      final.search = { candidates: sc.evaluated.size, beamDepth: depth, recipes: (input.recipes || []).length, searched: budget > 0 };
      final.moreBases = moreBasesHint(prof, sc.evaluated.values(), final);
      out.profiles[names[i]] = final;
      done++;
      if (input.onProgress) input.onProgress(done / total);
      await tick();
    }
    return out;
  }

  /**
   * Beam search from a plan's best screened candidates; returns a better plan (final run of the new best strategy)
   * or the same plan marked as searched. input as for buildPlans (beamBudgetMs: time for this profile).
   */
  async function improvePlan(input, plan, onProgress) {
    if (!plan || !plan.steps || !plan.seeds || !plan.profile) return plan;
    const prof = PROFILES[plan.profile];
    const ctx = makeContext(input.ix, input.item, { weights: input.weights, essences: input.essences, catalystMult: input.catalystMult });
    const st = toState(ctx, input.item, input.locks);
    const sc = makeScreen(ctx, st, plan.goals, input);
    for (const s0 of plan.seeds) await sc.screen(s0.params, s0.from);
    const { best, depth } = await beamSearch(sc, prof, input.beamBudgetMs == null ? 2500 : input.beamBudgetMs, onProgress);
    const search = { candidates: sc.evaluated.size + (plan.search ? plan.search.candidates : 0), beamDepth: depth, recipes: plan.search ? plan.search.recipes : 0, searched: true };
    if (!best || sc.sigOf(best.params) === sc.sigOf(plan.params)) return Object.assign({}, plan, { search, moreBases: moreBasesHint(prof, sc.evaluated.values(), plan) });
    const final = await simulateAsync(ctx, st, plan.goals, best.params, {
      trials: input.trials || 4000, seed: 99, priceOf: input.priceOf, baseCost: input.baseCost, budget: input.budget, cancelled: input.cancelled,
      baseLimit: input.baseLimit, timeBudgetMs: input.timeBudgetMs || 2500, minTrials: Math.min(input.trials || 4000, 800),
    });
    // keep the search's pick only when the full run agrees it is better
    if (prof.score(final) >= prof.score(plan)) return Object.assign({}, plan, { search, moreBases: moreBasesHint(prof, sc.evaluated.values(), plan) });
    Object.assign(final, { label: plan.label, profile: plan.profile, goals: plan.goals, dropped: plan.dropped, from: best.from, seeds: plan.seeds, search, moreBases: plan.moreBases });
    final.moreBases = moreBasesHint(prof, sc.evaluated.values(), final);
    return final;
  }

  /** Re-run a finished plan with more trials (same strategy, goals and seed family). */
  async function refinePlan(input, plan, trials, onProgress) {
    const ctx = makeContext(input.ix, input.item, { weights: input.weights, essences: input.essences, catalystMult: input.catalystMult });
    const st = toState(ctx, input.item, input.locks);
    const r = await simulateAsync(ctx, st, plan.goals, plan.params, {
      trials: trials || 20000, seed: 1234, priceOf: input.priceOf, baseCost: input.baseCost, budget: input.budget, onSlice: onProgress, cancelled: input.cancelled,
      baseLimit: input.baseLimit,
      timeBudgetMs: input.refineBudgetMs || 6000, minTrials: Math.min(3000, trials || 20000),
    });
    Object.assign(r, { label: plan.label, profile: plan.profile, goals: plan.goals, dropped: plan.dropped, from: plan.from, seeds: plan.seeds, search: plan.search, moreBases: plan.moreBases });
    r.moreBases = moreBasesHint(PROFILES[plan.profile] || PROFILES.balanced, [], r);
    return r;
  }

  /**
   * One use of `action` on the current item: success = at least one more goal done (and none lost),
   * damage = a finished goal mod is removed, miss = everything else. Returns {success, miss, damage}.
   */
  function stepOutcome(ix, item, locks, goals, action, weights, n, essences, extra) {
    const ctx = makeContext(ix, item, { weights, essences, catalystMult: extra && extra.catalystMult });
    if (goals.some((g) => g.minValue != null)) ctx.needValues = true;
    const st = toState(ctx, item, locks);
    if (validate(ctx, st, action)) return null;
    const rng = rngFrom(4242);
    const pick = pickFor(goals, ctx);
    const before = goals.filter((g) => goalMet(st, g));
    let succ = 0, dmg = 0;
    const N = n || 4000;
    for (let i = 0; i < N; i++) {
      const r = apply(ctx, st, action, rng, pick);
      const after = goals.filter((g) => goalMet(r.state, g));
      const lost = before.some((g) => !after.includes(g));
      if (lost) dmg++;
      else if (after.length > before.length) succ++;
    }
    return { success: succ / N, damage: dmg / N, miss: (N - succ - dmg) / N };
  }

  /**
   * What one use of `action` can do to the current item, for the tooltip preview.
   * Returns { n, adds: [{fam, id, side, des, p, tMin, tMax, goal}], removes: [{id, side, p}], fracture: [{id, p}],
   *           success, damage, miss } or null when the action is not allowed. p = share of simulated uses.
   */
  function stepPreview(ix, item, locks, goals, action, weights, n, essences, extra) {
    const ctx = makeContext(ix, item, { weights, essences, catalystMult: extra && extra.catalystMult });
    if (goals.some((g) => g.minValue != null)) ctx.needValues = true;
    const st = toState(ctx, item, locks);
    if (validate(ctx, st, action)) return null;
    const rng = rngFrom(4242);
    const pick = pickFor(goals, ctx);
    const unmetBefore = goals.filter((g) => !goalMet(st, g));
    const before = goals.length - unmetBefore.length;
    const adds = new Map(), removes = new Map(), fracs = new Map();
    let succ = 0, dmg = 0;
    const N = n || 3000;
    const key = (m) => (m.id || '?') + '|' + m.side;
    for (let i = 0; i < N; i++) {
      const r = apply(ctx, st, action, rng, pick);
      for (const m of r.added) {
        const k = m.fam + (m.des ? '|d' : '');
        const e = adds.get(k) || { fam: m.fam, id: m.id, side: m.side, des: !!m.des, c: 0, tMin: m.tier, tMax: m.tier, goal: 0 };
        e.c++;
        if (m.tier && (!e.tMin || m.tier < e.tMin)) { e.tMin = m.tier; e.id = m.id; }
        if (m.tier && (!e.tMax || m.tier > e.tMax)) e.tMax = m.tier;
        if (unmetBefore.some((g) => meets(m, g, g.eff))) e.goal++;
        adds.set(k, e);
      }
      for (const m of r.removed) removes.set(key(m), (removes.get(key(m)) || 0) + 1);
      if (action.op === 'fracture') for (const m of r.state.mods) if (m.frac && !st.mods.some((x) => x.frac && key(x) === key(m))) fracs.set(key(m), (fracs.get(key(m)) || 0) + 1);
      const after = goals.filter((g) => goalMet(r.state, g)).length;
      const lost = goals.some((g) => goalMet(st, g) && !goalMet(r.state, g));
      if (lost) dmg++; else if (after > before) succ++;
    }
    const split = (k) => { const i = k.lastIndexOf('|'); return { id: k.slice(0, i), side: k.slice(i + 1) }; };
    return {
      n: N, success: succ / N, damage: dmg / N, miss: (N - succ - dmg) / N,
      adds: [...adds.values()].map((e) => ({ fam: e.fam, id: e.id, side: e.side, des: e.des, p: e.c / N, tMin: e.tMin, tMax: e.tMax, goal: e.goal / N }))
        .sort((a, b) => b.goal - a.goal || b.p - a.p),
      removes: [...removes.entries()].map(([k, c]) => Object.assign(split(k), { p: c / N })).sort((a, b) => b.p - a.p),
      fracture: [...fracs.entries()].map(([k, c]) => Object.assign(split(k), { p: c / N })).sort((a, b) => b.p - a.p),
    };
  }

  /** Chance that one use of `action` on the current item completes at least one more goal. */
  function stepChance(ix, item, locks, goals, action, weights, n) {
    const ctx = makeContext(ix, item, { weights });
    if (goals.some((g) => g.minValue != null)) ctx.needValues = true;
    const st = toState(ctx, item, locks);
    if (validate(ctx, st, action)) return null;
    const rng = rngFrom(4242);
    const pick = pickFor(goals, ctx);
    const before = goals.filter((g) => goalMet(st, g)).length;
    let hit = 0;
    const N = n || 4000;
    for (let i = 0; i < N; i++) {
      const r = apply(ctx, st, action, rng, pick);
      if (goals.filter((g) => goalMet(r.state, g)).length > before) hit++;
    }
    return hit / N;
  }

  /** The next action of a strategy for the current state (null when all goals are met). priceOf: as the plan was
   *  built with, so the step leaves out the same unpriced omens. */
  function nextAction(ix, item, locks, goals, params, priceOf) {
    const ctx = makeContext(ix, item);
    const st = toState(ctx, item, locks);
    const a0 = makePolicy(ctx, goals, params)(st);
    const a = priceOf ? withoutUnpriced(a0, (n) => priceOf(n) != null) : a0;
    if (a.done || a.fail) return a;
    return Object.assign({}, a, { names: actionNames(a, ctx), error: validate(ctx, st, a) });
  }

  /**
   * Compare the item before and after one applied action.
   * Returns { verdict: 'expected'|'acceptable'|'deviation', notes: [] }.
   */
  function evaluateStep(ix, before, after, goals, action) {
    const notes = [];
    if (!before || !after || before.base !== after.base) return { verdict: 'acceptable', notes: ['A different base was pasted; starting a new chain.'] };
    const ctx = makeContext(ix, after);
    const b = toState(ctx, before), a = toState(ctx, after);
    const metB = goals.filter((g) => goalMet(b, g)), metA = goals.filter((g) => goalMet(a, g));
    const lostG = metB.filter((g) => !metA.includes(g));
    const newG = metA.filter((g) => !metB.includes(g));
    const key = (m) => (m.id || '?') + (m.des ? 'd' : '');
    const bk = b.mods.map(key), ak = a.mods.map(key);
    const added = ak.filter((k) => !bk.includes(k)).length, removedN = bk.filter((k) => !ak.includes(k)).length;
    if (lostG.length) notes.push('Lost: ' + lostG.map((g) => g.label).join(', '));
    if (newG.length) notes.push('Hit: ' + newG.map((g) => g.label).join(', '));
    let consistent = true;
    if (action) {
      const op = action.op;
      if (op === 'exalt' && added < (action.greater ? 2 : 1)) consistent = false;
      if (op === 'chaos' && (added < 1 || removedN < 1)) consistent = false;
      if (op === 'annul' && removedN < 1) consistent = false;
      if (op === 'bone' && !a.mods.some((m) => m.des)) consistent = false;
      if (op === 'regal' && a.rarity !== 'Rare') consistent = false;
      if (op === 'transmute' && a.rarity !== 'Magic') consistent = false;
      if (op === 'alchemy' && a.rarity !== 'Rare') consistent = false;
      if (op === 'fracture' && a.mods.filter((m) => m.frac).length <= b.mods.filter((m) => m.frac).length) consistent = false;
      if (op === 'divine' && (added || removedN)) consistent = false;
      if (op === 'flux' && !a.mods.some((m) => m.fam && m.fam.toLowerCase() === action.to + 'resistance')) consistent = false;
      if ((op === 'vaal' || op === 'architect') && !a.corrupted) consistent = false;
      if (action.side && op === 'exalt') {
        const newOnSide = a.mods.filter((m) => m.side === action.side).length - b.mods.filter((m) => m.side === action.side).length;
        if (newOnSide < 1) consistent = false;
      }
    }
    if (!consistent) notes.push('The item did not change the way this step should change it. Check that the omens were active.');
    const verdict = lostG.length || !consistent ? 'deviation' : newG.length ? 'expected' : 'acceptable';
    return { verdict, notes };
  }

  // ---------------------------------------------------------------- what can be used now (7.2, data-driven)

  const SPECIAL_ESS = 'Essence of (the Abyss|the Breach|Delirium|Horror|Hysteria|Insanity)$';
  /** Currency and omens that change an item for good (7.5), with what they do. */
  const IRREVERSIBLE_NAMES = {
    'Fracturing Orb': 'Locks one random modifier for good.',
    'Vaal Orb': 'Corrupts the item: normal currency no longer works on it.',
    'Omen of Sanctification': 'The Divine Orb sanctifies the item: it cannot be crafted further.',
    'Omen of Putrefaction': 'Replaces the modifiers with unrevealed Desecrated ones and corrupts the item.',
    "Architect's Orb": 'Can destroy the item.',
    'Orb of Chance': 'Can destroy the item unless Omen of Chance is active.',
    'Mirror of Kalandra': 'The copy is Mirrored and can never be changed.',
    "Kamasa's Orb of Sacrifice": 'Removes a random modifier.', "Kopec's Orb of Sacrifice": 'Removes a random modifier.',
    "Yaomac's Orb of Sacrifice": 'Removes a random modifier.', "Yugul's Orb of Sacrifice": 'Removes a random modifier.',
    'Vaal Cultivation Orb': 'Changes the Unique for good.',
    "Vaal Arcanist's Infuser": 'May corrupt the item.', "Vaal Armourer's Infuser": 'May corrupt the item.',
    "Vaal Blacksmith's Infuser": 'May corrupt the item.', 'Vaal Catalysing Infuser': 'May corrupt the item.',
  };

  /**
   * Operators that apply to this item now, built from the crafting_ops records and the rules in validate().
   * Each entry: { id, title, cur: [names], omens: [names], blocked: [{name, reason}], cat?, match?: {include, exclude},
   *   label?, planned, conf, ok, reason }. planned = the simulator can plan it; the others are listed with their game text.
   * opts: { league, all } — all: also return operators that do not apply (ok: false, reason).
   */
  function availableOps(ix, item, opts) {
    opts = opts || {};
    if (!item || !ix.kb.bases[item.base]) return [];
    const ctx = makeContext(ix, item);
    const st = toState(ctx, item);
    const cls = ctx.cls, R = st.rarity;
    const kbOp = (id) => (ix.kb.crafting_ops || []).find((o) => o.id === id) || {};
    const out = [];
    const add = (id, title, action, e) => {
      const why = typeof action === 'string' ? action : action ? validate(ctx, st, action) : null;
      if (why && !opts.all) return;
      out.push(Object.assign({ id, title, cur: [], omens: [], blocked: [], planned: false, conf: kbOp(id).conf || null, ok: !why, reason: why || null }, e));
    };
    const des = st.mods.some((m) => m.des);
    const openP = open(ctx, st, 'prefix'), openS = open(ctx, st, 'suffix');
    // Normal
    add('transmute', 'Make Magic', { op: 'transmute' }, { cur: ORB.transmute.slice(), planned: true });
    add('alchemy', 'Make Rare with 4 mods', { op: 'alchemy' }, { cur: ['Orb of Alchemy'], omens: [OMEN.alchemy.prefix, OMEN.alchemy.suffix], planned: true });
    add('chance', 'Gamble for a Unique', { op: 'chance' }, { cur: ['Orb of Chance'], omens: ['Omen of Chance', 'Omen of the Ancients'] });
    // Magic
    add('augment', 'Add a mod', { op: 'augment' }, { cur: ORB.augment.slice(), planned: true });
    add('regal', 'Make Rare, add a mod', { op: 'regal' }, { cur: ORB.regal.slice(), omens: [OMEN.coronation.prefix, OMEN.coronation.suffix], planned: true });
    add('essence_upgrade', 'Make Rare with a guaranteed mod', { op: 'essence' },
      { cat: 'Essences', match: { include: '^(Lesser |Greater )?Essence of', exclude: SPECIAL_ESS }, label: 'Essences', planned: true });
    // Rare
    const exOmens = [], exBlocked = [];
    if (openP > 0) exOmens.push(OMEN.exalt.prefix); else exBlocked.push({ name: OMEN.exalt.prefix, reason: 'no open prefix' });
    if (openS > 0) exOmens.push(OMEN.exalt.suffix); else exBlocked.push({ name: OMEN.exalt.suffix, reason: 'no open suffix' });
    if (openP + openS >= 2) exOmens.push(OMEN.greaterExalt);
    if (cls === 'Ring' || cls === 'Amulet') {
      if (st.catTag && st.catQ > 0) exOmens.push(OMEN.catalyse); else exBlocked.push({ name: OMEN.catalyse, reason: 'needs catalyst quality on the item' });
    }
    add('exalt', 'Add a mod', { op: 'exalt' }, { cur: ORB.exalt.slice(), omens: exOmens, blocked: exBlocked, planned: true });
    add('chaos', 'Swap one mod', { op: 'chaos' }, { cur: ORB.chaos.slice(), omens: [OMEN.erasure.prefix, OMEN.erasure.suffix, OMEN.whittling], planned: true });
    add('annul', 'Remove a mod', { op: 'annul' }, { cur: ['Orb of Annulment'],
      omens: R === 'Rare' ? [OMEN.annul.prefix, OMEN.annul.suffix, OMEN.greaterAnnul].concat(des ? [OMEN.light] : []) : [], planned: true });
    add('essence_replace', 'Swap a mod for an essence mod', R === 'Rare' ? { op: 'pessence' } : 'Perfect and special essences need a Rare item.',
      { omens: [OMEN.crystal.prefix, OMEN.crystal.suffix], cat: 'Essences', match: { include: '^Perfect Essence|' + SPECIAL_ESS }, label: 'Perfect and special essences', planned: true });
    if (ctx.bone) {
      const bone = ctx.bone, bones = [], blocked = [];
      if (ctx.ilvl <= 64) bones.push('Gnawed ' + bone); else blocked.push({ name: 'Gnawed ' + bone, reason: 'item level 64 or lower only' });
      bones.push('Preserved ' + bone);
      // game text: Minimum Modifier Level 40, and such currency cannot be used below that item level
      if (ctx.ilvl >= 40) bones.push('Ancient ' + bone); else blocked.push({ name: 'Ancient ' + bone, reason: 'item level 40 or higher only' });
      if (bone === 'Collarbone') bones.push('Altered Collarbone');
      const omens = [OMEN.necro.prefix, OMEN.necro.suffix, OMEN.echoes, 'Omen of Putrefaction'];
      const lich = [OMEN.lich.Kurgal, OMEN.lich.Amanamu, OMEN.lich.Ulaman];
      // lich modifiers are level 65 (game data), so they cannot roll below item level 65
      if (!(WEAPON.includes(cls) || JEWELLERY.includes(cls))) lich.forEach((n) => blocked.push({ name: n, reason: 'weapon or jewellery desecration only' }));
      else if (ctx.ilvl < 65) lich.forEach((n) => blocked.push({ name: n, reason: 'lich modifiers need item level 65 or higher' }));
      else omens.push(...lich);
      add('desecrate', 'Desecrate: hidden mod, pick 1 of 3', { op: 'bone', quality: 'Preserved' }, { cur: bones, omens, blocked, planned: true });
    }
    add('fracture', 'Lock one mod', { op: 'fracture' }, { cur: ['Fracturing Orb'], planned: true });
    if (cls === 'Jewel') add('catalyst', 'Add catalyst quality', { op: 'catalyst', refined: true }, { cat: 'Catalysts', match: { include: '^Refined' }, label: 'Refined catalysts' });
    else if (cls === 'Ring' || cls === 'Amulet') add('catalyst', 'Add catalyst quality', { op: 'catalyst' }, { cat: 'Catalysts', match: { include: 'Catalyst$', exclude: '^Refined' }, label: 'Catalysts' });
    else if (catalystBase(ctx.base)) add('catalyst', 'Add catalyst quality', { op: 'catalyst' }, { cat: 'Catalysts', match: { include: 'Catalyst$', exclude: '^Refined' }, label: 'Catalysts',
      note: 'The base says "Catalysts can be applied to this item". Which catalysts it takes is in-game test t29; the planner assumes the ring and amulet ones.' });
    const alloyWhy = R !== 'Rare' ? 'Runic Alloys need a Rare item.' : { op: 'alloy' };
    add('alloy', 'Swap a mod for an alloy mod', alloyWhy, { cat: 'Verisium', match: { include: 'Alloy' }, label: 'Runic Alloys', planned: true });
    if (cls === 'Jewel') {
      const ancient = /^Time-Lost/.test(item.base);
      add('liquid_emotion', 'Swap a mod for a crafted jewel mod', { op: 'liquid', ancient },
        { cat: 'Delirium', match: ancient ? { include: '^Ancient .*Liquid' } : { include: 'Liquid ', exclude: '^Ancient' }, label: ancient ? 'Ancient liquid emotions' : 'Liquid emotions', planned: true });
    }
    // Any rarity
    const hasValues = item.mods.some((m) => m.modId || m.slot === 'unique') || (item.implicits || []).length;
    add('divine', 'Reroll values', hasValues ? { op: 'divine' } : 'The item has no modifier values to reroll.',
      { cur: ['Divine Orb'], omens: ['Omen of the Blessed'].concat(R === 'Rare' ? ['Omen of Sanctification'] : []), planned: true });
    if (qualityCurrencyFor(cls)) add('quality', 'Add quality', { op: 'quality' }, { cur: [qualityCurrencyFor(cls)] });
    if (infuserFor(cls)) add('infuser', 'Quality past the maximum', { op: 'infuser' }, { cur: [infuserFor(cls)] });
    add('artificer', 'Add an augment socket', { op: 'artificer' }, { cur: ["Artificer's Orb"] });
    // Runes that change crafting (game data augments): listed, not planned
    const RUNE_NOTES = {
      "Astrid's Creativity": 'The item can then have 2 crafted modifiers (essences, alloys, liquid emotions); the planner counts it once the rune is on the item. Once socketed it cannot be taken out, but another augment can replace it.',
      "Serle's Triumph": 'It raises the suffix limit and the modifier total by 1. Once socketed it cannot be taken out or replaced.',
      "Medved's Tending": 'The body armour can then roll the Soul modifiers ("Medved\'s" prefixes and "of the Soul" suffixes, level 65); the planner rolls them once the rune is on the item. Once socketed it cannot be taken out or replaced.',
    };
    for (const [rune, why] of Object.entries(RUNE_NOTES)) {
      const r = ix.kb.augments && ix.kb.augments[rune];
      if (!r || !r.by_class[cls]) continue;
      add('rune_rule', `${r.by_class[cls].txt.join(' ')} (${rune})`, { op: 'rune_rule', item: rune }, { cur: [rune], note: 'Socket it in an augment socket. ' + why });
    }
    // Runes of Aldur: socketed, they turn the other elements' modifiers into their element (rune texts). Listed, not planned.
    for (const rune of ['Passion of Aldur', 'Breath of Aldur', 'Ire of Aldur', 'Betrayal of Aldur']) {
      const r = ix.kb.augments && ix.kb.augments[rune];
      if (!r || !r.by_class[cls]) continue;
      add('aldur', `Transform element modifiers (${rune})`, { op: 'aldur', item: rune }, {
        cur: [rune], note: `${r.by_class[cls].txt.join(' ')}. It takes an augment socket and works while socketed; fractured modifiers stay as they are. `
          + 'Transformed lines show no tier when the base cannot roll them. The planner does not plan it.',
      });
    }
    // Verisium Anvil (game tables Expedition2VerisiumCrafts, ArmourTypes): listed, not planned
    const defs = (d) => ['Armour', 'Evasion', 'EnergyShield'].filter((k) => d.from[k] || d.to[k])
      .map((k) => `${k === 'EnergyShield' ? 'Energy Shield' : k} ${d.from[k]}${d.to[k] !== d.from[k] ? ' -> ' + d.to[k] : ''}`).join(', ');
    const upgrades = R === 'Unique' ? ((ix.kb.verisium_unique_upgrades || {})[item.name] || []).filter((u) => u.from === item.base)
      : (ix.kb.verisium_upgrades || {})[item.base] || [];
    for (const u of upgrades) {
      const b = ix.kb.bases[u.to] || {};
      add('verisium', `Runeforge: ${u.to} (Verisium Anvil)`, { op: 'verisium', to: u.to }, {
        cur: Object.keys(u.cost), note: `Costs ${Object.entries(u.cost).map(([n, c]) => c + ' ' + n).join(' and ')}. `
          + (u.def ? `Base: ${defs(u.def)}, Runic Ward +${u.def.to.Ward - u.def.from.Ward}. ` : '')
          + (R === 'Unique' ? 'The item stays the same unique on the new base. ' : 'The modifiers stay (fractured ones too). ')
          + (b.imp && b.imp.length ? `The new base has: ${b.imp.join('; ')}. ` : '') + 'The planner does not plan it.',
      });
    }
    const fluxes = ['fire', 'cold', 'lightning'].filter((to) => !validate(ctx, st, { op: 'flux', to })).map((to) => FLUX[to]);
    if (!validate(ctx, st, { op: 'flux', to: 'chaos' })) fluxes.push('Void Flux');
    add('flux', 'Change a resistance element', fluxes.length ? { op: 'flux', to: 'chaos' } : 'The item has no Fire, Cold or Lightning Resistance modifier.',
      { cur: fluxes, planned: true, note: 'Blazing, Chilling and Crackling Flux are planned (same tier of the new element). Void Flux is listed only: Chaos tiers have other values.' });
    // Corruption Enhancements this base can get (game data: kb.pools[sig].corrupted); the outcome chances are not in the files.
    const enh = ((ix.kb.pools[ctx.base.sig] || {}).corrupted || []).map((id) => ix.kb.mods[id].txt.replace(/\n/g, ' / '));
    add('vaal', 'Corrupt', { op: 'vaal' }, { cur: ['Vaal Orb'],
      note: enh.length ? `Can add one of ${enh.length} Corruption Enhancements on this base (game data), e.g. ${enh.slice(0, 3).join('; ')}. How often each outcome happens is not in the game files.` : null });
    add('hinekora', 'Preview the next currency', { op: 'hinekora' }, { cur: ["Hinekora's Lock"] });
    add('mirror', 'Copy the item', { op: 'mirror' }, { cur: ['Mirror of Kalandra'] });
    // Corrupted items
    add('sacrifice', 'Upgrade corruption, remove a mod', { op: 'sacrifice' }, { cur: sacrificeFor(cls) ? [sacrificeFor(cls)] : [] });
    add('architect', 'Unpredictable change or destroy', { op: 'architect' }, { cur: ["Architect's Orb"] });
    add('cultivation', 'Change a Unique', { op: 'cultivation' }, { cur: ['Vaal Cultivation Orb'] });
    return out;
  }

  return {
    ORB, OMEN, TIERS, boneFor, actionNames, makeContext, toState, validate, apply, rngFrom, sidePool, desPoolFor,
    goalsFromTargets, goalMet, meets, nearMiss, rangeOf, makePolicy, simulate, simulateAsync, buildPlans, refinePlan, nextAction, stepChance, stepOutcome, stepPreview, evaluateStep, PROFILES,
    availableOps, IRREVERSIBLE_NAMES, resElement, catalystTag, FLUX, goalFeasible, goalClash, essencesForBase, liquidFor, CATALYST_DEFAULT,
    expandStrategy, recipeParams, relevantKeys, SPACE, improvePlan,
  };
});
