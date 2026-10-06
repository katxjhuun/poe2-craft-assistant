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
    putrefy: 'Omen of Putrefaction',
    homogExalt: 'Omen of Homogenising Exaltation',
    homogRegal: 'Omen of Homogenising Coronation',
    corruption: 'Omen of Corruption',
    chance: 'Omen of Chance',
    ancients: 'Omen of the Ancients',
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
  /**
   * Default boost of Omen of Catalysing Exaltation at 20% quality. The player's test (28 Sept 2026, test t8): four rings
   * with "+# to all Attributes" and 20% Adaptive Catalyst quality, each Catalysing Exaltation gave another attribute
   * modifier. Without the omen that chance is 16-19% on such rings; four of four fits any boost from about x6 (95%) and
   * x25 is the middle estimate (four of four then happens half the time). Replaces the earlier single-source x5.
   */
  const CATALYST_DEFAULT = 25;
  function catalystTag(qualityType) {
    const w = String(qualityType || '').trim().split(/\s+/)[0].toLowerCase();
    return CATALYST_TAG[w] || null;
  }

  /** Currency names an action consumes (omens first, as they are activated first in game). */
  function actionNames(a, ctx) {
    const t = TIERS.indexOf(a.tier || 'base');
    switch (a.op) {
      case 'transmute': case 'augment': return [ORB[a.op][t]];
      case 'regal': return [...(a.side ? [OMEN.coronation[a.side]] : []), ...(a.homog ? [OMEN.homogRegal] : []), ORB.regal[t]];
      case 'alchemy': return [...(a.side ? [OMEN.alchemy[a.side]] : []), 'Orb of Alchemy'];
      case 'exalt': return [...(a.side ? [OMEN.exalt[a.side]] : []), ...(a.greater ? [OMEN.greaterExalt] : []), ...(a.catalyse ? [OMEN.catalyse] : []), ...(a.homog ? [OMEN.homogExalt] : []), ORB.exalt[t]];
      case 'chaos': return [...(a.whittle ? [OMEN.whittling] : a.side ? [OMEN.erasure[a.side]] : []), ORB.chaos[t]];
      case 'annul': return [...(a.light ? [OMEN.light] : a.side ? [OMEN.annul[a.side]] : []), ...(a.greater ? [OMEN.greaterAnnul] : []), 'Orb of Annulment'];
      case 'bone': return [...(a.side ? [OMEN.necro[a.side]] : []), ...(a.lich ? [OMEN.lich[a.lich]] : []), ...(a.echoes ? [OMEN.echoes] : []),
        ...(a.putrefy ? [OMEN.putrefy] : []), `${a.quality} ${a.quality === 'Altered' ? 'Collarbone' : ctx ? ctx.bone : 'bone'}`];
      case 'vaal': return [...(a.omen ? [OMEN.corruption] : []), 'Vaal Orb'];
      case 'chance': return [...(a.ancients ? [OMEN.ancients] : a.omen ? [OMEN.chance] : []), 'Orb of Chance'];
      case 'architect': return ["Architect's Orb"];
      case 'cultivation': return ['Vaal Cultivation Orb'];
      case 'sacrifice': return [a.item || 'Orb of Sacrifice'];
      case 'catalyst': return [a.item || 'Catalyst'];
      case 'rune_rule': case 'aldur': return [a.item || 'Rune'];
      case 'verisium': return ['Verisium Anvil'];
      case 'artificer': return ["Artificer's Orb"];
      case 'extraction': return ['Orb of Extraction'];
      case 'newbase': return ['New base'];
      case 'fracture': return ['Fracturing Orb'];
      case 'divine': return ['Divine Orb'];
      case 'essence': return [a.item || 'Essence'];
      case 'pessence': return [...(a.side ? [OMEN.crystal[a.side]] : []), a.item || 'Perfect Essence'];
      case 'alloy': return ['Runic Alloy'];
      case 'flux': return [a.to === 'chaos' ? 'Void Flux' : FLUX[a.to] || 'Flux'];
      default: return a.item ? [a.item] : [a.op];
    }
  }

  /**
   * Leave out optional omens that have no price (no market price and none set by the player): the plan could not
   * say what they cost (they would count as free and win every comparison), and an omen nobody traded may not be
   * buyable. Only omens that aim a step or add to it are dropped; the step stays legal without them. Omen of Light
   * and the lich omens change what a step does and stay. priced(name) -> bool; skipped collects the dropped names.
   */
  function withoutUnpriced(a, priced, skipped, gone) {
    if (!a || a.done || a.fail) return a;
    const drop = (name) => { if (gone && gone.has(name)) return true; if (priced(name)) return false; if (skipped) skipped.add(name); return true; };
    const b = Object.assign({}, a);
    switch (a.op) {
      case 'regal':
        if (a.side && drop(OMEN.coronation[a.side])) b.side = null;
        if (a.homog && drop(OMEN.homogRegal)) b.homog = false;
        break;
      case 'alchemy': if (a.side && drop(OMEN.alchemy[a.side])) b.side = null; break;
      case 'exalt':
        if (a.side && drop(OMEN.exalt[a.side])) b.side = null;
        if (a.greater && drop(OMEN.greaterExalt)) b.greater = false;
        if (a.catalyse && drop(OMEN.catalyse)) b.catalyse = false;
        if (a.homog && drop(OMEN.homogExalt)) b.homog = false;
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
      case 'pessence': if (a.side && drop(OMEN.crystal[a.side])) b.side = null; break;
      default: return a;
    }
    return b;
  }

  /**
   * The materials a route may use, by what one of them costs (the player's wish, 6 Oct 2026: Cheap with what the early
   * game gives, Balanced the mid game, Premium the end game): early up to the price of one Chaos Orb each, mid up to
   * one Divine Orb each, end anything. A material a step cannot do without (its base orb, the only essence or bone for
   * a goal, a rune a goal needs) is used at any price.
   */
  const MATERIAL_CAP = { early: 'Chaos Orb', mid: 'Divine Orb', end: null };
  function capOf(level, priceOf) { const n = MATERIAL_CAP[level]; const v = n && priceOf ? priceOf(n) : null; return v > 0 ? v : Infinity; }
  /** null when the level has no cap; else name -> may the route use it (it has a price at or below the cap). */
  function materialOk(level, priceOf) {
    const cap = capOf(level, priceOf);
    return cap < Infinity ? (n) => { const v = priceOf(n); return v != null && v <= cap; } : null;
  }
  /**
   * A strategy within a level's materials: orb tiers, bone quality and the settings that stand for one omen or orb come
   * down to what the level allows (omens that only aim a step are dropped per step, withoutUnpriced). Sets p.mat.
   */
  function clampStrategy(p, level, ctx, priceOf) {
    const out = Object.assign({}, p, { mat: level });
    const ok = materialOk(level, priceOf);
    if (!ok) return out;
    const memo = ctx._clamp || (ctx._clamp = new Map());
    let T = memo.get(level);
    if (!T) {
      // the highest tier at or below the asked one whose orbs the level allows (the base orb in any case)
      const down = (lists) => { const m = {}; TIERS.forEach((t, i) => { let j = i; while (j > 0 && !lists.every((l) => ok(l[j]))) j--; m[t] = TIERS[j]; }); return m; };
      const order = ['Ancient', 'Preserved', 'Gnawed'].filter((q) => boneExists(ctx, q));
      const bone = {};
      for (const q of ['Gnawed', 'Preserved', 'Ancient']) {
        const from = order.indexOf(q);
        bone[q] = (from < 0 ? null : order.slice(from).find((x) => ok(`${x} ${ctx.bone}`) && (x !== 'Gnawed' || ctx.ilvl <= 64))) || (boneExists(ctx, 'Preserved') ? 'Preserved' : q);
      }
      T = { exalt: down([ORB.exalt]), chaos: down([ORB.chaos]), magic: down([ORB.transmute, ORB.augment, ORB.regal]), bone,
        greaterExalt: ok(OMEN.greaterExalt), erasure: ok(OMEN.erasure.prefix) && ok(OMEN.erasure.suffix), whittle: ok(OMEN.whittling), annul: ok('Orb of Annulment'),
        echoes: ok(OMEN.echoes), lich: Object.values(OMEN.lich).some(ok), catalyse: ok(OMEN.catalyse), fracture: ok('Fracturing Orb'), flux: Object.values(FLUX).every(ok) };
      memo.set(level, T);
    }
    if (out.exaltTier) out.exaltTier = T.exalt[out.exaltTier] || out.exaltTier;
    if (out.chaosTier) out.chaosTier = T.chaos[out.chaosTier] || out.chaosTier;
    if (out.magicTier) out.magicTier = T.magic[out.magicTier] || out.magicTier;
    if (out.bone) out.bone = T.bone[out.bone] || out.bone;
    if ((out.removal === 'erasure' && !T.erasure) || (out.removal === 'whittle' && !T.whittle) || (out.removal === 'annul' && !T.annul)) out.removal = 'chaos';
    for (const k of ['greaterExalt', 'echoes', 'lich', 'catalyse', 'fracture']) if (out[k] && !T[k]) out[k] = false;
    if (out.flux !== false && !T.flux) out.flux = false;
    return out;
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
  /** Items the game files list but the game does not have (kb.legacy_or_disabled, e.g. Omen of Homogenising Exaltation). */
  const LEGACY = new WeakMap();
  function legacyItems(kb) {
    if (!LEGACY.has(kb)) LEGACY.set(kb, new Set((kb.legacy_or_disabled || []).flatMap((l) => l.items || [])));
    return LEGACY.get(kb);
  }
  /** Is there such a bone? Jewels only have the Preserved Cranium (no Gnawed or Ancient one in the game data). */
  const boneExists = (ctx, quality) => !!(ctx.kb.item_descriptions || {})[`${quality} ${quality === 'Altered' ? 'Collarbone' : ctx.bone}`];

  function makeContext(ix, item, opts) {
    opts = opts || {};
    const kb = ix.kb;
    const base = kb.bases[item.base];
    if (!base) throw new Error('unknown base');
    const ilvl = item.ilvl == null ? 100 : item.ilvl;
    // the base's natural pool; the pools of socketed runes come in with the state (st.tags, rollPool, R_RUNE_POOLS)
    const pool = E.poolFor(ix, base.sig);
    const desPool = E.desecratedPoolFor(ix, item.base);
    const ctx = {
      ix, kb, item, base, cls: base.cls, ilvl, pool, desPool, weights: opts.weights || null,
      floors: floorsFrom(kb), bone: boneFor(base.cls), slotDelta: item.slotDelta || { prefix: 0, suffix: 0 },
      _side: new Map(), _des: new Map(), imputed: new Set(), legacy: legacyItems(kb),
      essences: essencesForBase(ix, base, (opts.essences || []).filter((r) => !r.liquid)).concat(liquidFor(kb, item.base)),
      catalystMult: opts.catalystMult > 0 ? +opts.catalystMult : CATALYST_DEFAULT,
      capMods: ix._capMods || (ix._capMods = new Map(Object.entries(kb.mods).filter(([, m]) => m.cap).map(([id, m]) => [id, m.cap]))),
      baseTags: new Set(base.tags || []),
      craftedCap: 1 + E.runeRules(item).extraCrafted, // Astrid's Creativity socketed: one more crafted modifier
      opts,
    };
    return ctx;
  }
  /** The context modifiers roll from. */
  function poolCtx(ctx) { return ctx; }

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

  /** The modifier pools a rune can open on this base (E.runePoolsOn): Marksman and Decay on gloves, Soul on body armour... */
  function runePoolsFor(ctx) { return ctx._rp || (ctx._rp = E.runePoolsOn(ctx.ix, ctx.item.base)); }
  /**
   * One side of a rune's pool at a floor, like sidePool. The weights table has no entry for these modifiers, so weightOf
   * gives them their family's lowest weight or the table median (an estimate, counted in ctx.imputed).
   */
  function runeSide(ctx, tag, side, floor) {
    const key = 'rune|' + tag + '|' + side + '|' + floor;
    if (ctx._side.has(key)) return ctx._side.get(key);
    const p = runePoolsFor(ctx).find((x) => x.tag === tag);
    const byFam = new Map();
    if (p) for (const [id, pe] of p.mods) {
      const m = ctx.kb.mods[id];
      if (pe.side !== side || ctx.pool.has(id) || m.lvl > ctx.ilvl) continue;
      if (!byFam.has(m.fam)) byFam.set(m.fam, []);
      byFam.get(m.fam).push({ id, fam: m.fam, grp: m.grp, lvl: m.lvl, tier: pe.tier, side, w: weightOf(ctx, id), rune: tag });
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
  /** What can roll on a side of the item as it is: the natural pool, and the pools of the runes socketed (st.tags). */
  function rollPool(ctx, st, side, floor) {
    const base = sidePool(ctx, side, floor);
    return st && st.tags && st.tags.length ? base.concat(...st.tags.map((t) => runeSide(ctx, t, side, floor))) : base;
  }
  /** The rune pool a family belongs to on this side, when it is not a natural modifier of the base: {tag, rune} or null. */
  function runePoolOf(ctx, fam, side) {
    if (sidePool(ctx, side, 0).some((e) => e.fam === fam)) return null;
    for (const p of runePoolsFor(ctx)) if (p.fams.has(fam) && [...p.mods].some(([id, pe]) => pe.side === side && ctx.kb.mods[id].fam === fam)) return { tag: p.tag, rune: p.rune };
    return null;
  }

  /**
   * Sides where a bone can place its desecrated modifier: the Well of Souls has something to offer there (see
   * revealPool), and the side has room, or the item is full and the side has a modifier the desecration may remove.
   */
  function desSides(ctx, st, a) {
    const floor = a.quality === 'Ancient' ? 40 : 0;
    const full = open(ctx, st, 'prefix') + open(ctx, st, 'suffix') === 0;
    // on a full item the removal must open the side: a side over its limit (see open) stays full after losing one mod
    const opens = (s) => count(st, s) <= limits(ctx, st)[s] && st.mods.some((m) => removable(m) && m.side === s);
    return (a.side ? [a.side] : SIDES).filter((s) => (full ? opens(s) : open(ctx, st, s) > 0) && revealPool(ctx, st, s, floor, a.lich || null).any);
  }

  // How many of the three Well of Souls options are desecrated-only: 1, 2 or 3 with these chances (Craft of Exile's
  // desecrationModSpawnRate; test t31). The rest are base modifiers of the side.
  const DES_OPTIONS = [0.8, 0.15, 0.05];

  /**
   * What the Well of Souls can offer for a desecrated modifier on this side: the side's desecrated-only modifiers, the
   * base modifiers that could roll there, and with a lich omen that lich's. poe2db: "Reveal desecrated modifiers may
   * include base modifiers. Unless you use Omen to guarantee named modifiers"; Game8, Sift and Craft of Exile agree, and
   * two of the player's staves carry a Desecrated base modifier (T1 "Gain % of Damage as Extra Fire Damage"). Groups on the
   * item and the tags its mods add are respected; the bone's floor applies to every kind.
   */
  function revealPool(ctx, st, side, floor, lich) {
    const taken = groupsOf(st);
    const added = E.addedTags(ctx.kb, st.mods.map((m) => m.id));
    const free = (e) => !e.grp.some((g) => taken.has(g));
    const excl = desPoolFor(ctx, side, floor, null).filter(free);
    const lichList = lich ? desPoolFor(ctx, side, floor, lich).filter(free) : null;
    // the item's own modifiers only: whether the Well of Souls also offers the modifiers of a socketed rune's pool is
    // not known (in-game test t33), so no plan counts on it
    const norm = sidePool(ctx, side, floor).filter((e) => free(e) && !(added && E.tagBlocked(ctx.kb.mods[e.id], ctx.baseTags, added)));
    return { excl, norm, lichList, any: lich ? lichList.length > 0 : excl.length + norm.length > 0 };
  }
  /**
   * The three modifiers the Well of Souls offers, as Craft of Exile draws them: 1, 2 or 3 desecrated-only ones (DES_OPTIONS)
   * and base modifiers for the rest; with a lich omen the first is that lich's ("will guarantee a random Kurgal modifier").
   * Base modifiers by their spawn weight, desecrated-only ones evenly (Craft of Exile gives them all weight 1). No two share
   * a group. Without a desecrated-only modifier (sceptres, equipment below item level 65) all three are base modifiers.
   */
  function revealOptions(ctx, st, side, floor, lich, rng) {
    const { excl, norm, lichList } = revealPool(ctx, st, side, floor, lich);
    const opts = [], used = new Set();
    const take = (list) => {
      const ok = list.filter((e) => !e.grp.some((g) => used.has(g)));
      let total = 0;
      for (const e of ok) total += e.w;
      if (!total) return null;
      let r = rng() * total, e = ok[ok.length - 1];
      for (const x of ok) { r -= x.w; if (r <= 0) { e = x; break; } }
      for (const g of e.grp) used.add(g);
      opts.push(Object.assign({}, e, { des: true }));
      return e;
    };
    let nEx = 1;
    for (let r = rng(), acc = 0, i = 0; i < DES_OPTIONS.length; i++) { acc += DES_OPTIONS[i]; if (r <= acc) { nEx = i + 1; break; } }
    if (lichList && !take(lichList)) return opts;
    for (let k = opts.length; k < 3; k++) {
      const wantExcl = excl.length > 0 && k < nEx;
      if (!(wantExcl ? take(excl) : take(norm)) && !(wantExcl ? take(norm) : take(excl))) break;
    }
    return opts;
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
      tags: E.runeRules(item).pools, // modifier pools the socketed runes open ("Can roll Marksman modifiers")
    };
  }

  function cloneState(s) { return Object.assign({}, s, { mods: s.mods.map((m) => Object.assign({}, m)) }); }

  function limits(ctx, st) {
    if (st.xSuffix && st.rarity === 'Rare') { const l = limitsBase(ctx, st); return { prefix: l.prefix, suffix: l.suffix + st.xSuffix }; }
    return limitsBase(ctx, st);
  }
  function limitsBase(ctx, st) {
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
    // Omens that are in the game files but not in the game (kb.legacy_or_disabled): no step can use them.
    if (ctx.legacy.size && (a.homog || a.greater || a.side || a.omen)) for (const n of actionNames(a, ctx)) if (ctx.legacy.has(n)) return `${n} is not in the game (the game files list it, but it cannot be found or traded).`;
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
      if ((st.enchantCount || (st.corruptEnchant ? 1 : 0)) >= 2) return 'The item already has two Corruption Enchantments.';
      return cls === 'Jewel' || WEAPON.includes(cls) || ARMOUR.includes(cls) || JEWELLERY.includes(cls) ? null : "Architect's Orb works on equipment and jewels.";
    }
    if (a.op === 'cultivation') {
      if (R !== 'Unique') return 'Vaal Cultivation Orb works on Unique items.';
      return st.corrupted && !/^Vaal /.test(ctx.item.name || '') ? null : st.corrupted ? null : 'Vaal Cultivation Orb works on corrupted uniques (a Vaal unique, or any unique it replaces).';
    }
    if (st.destroyed) return 'The item was destroyed.';
    if (st.mirrored) return 'Mirrored items cannot be modified.';
    if (st.corrupted) return 'Corrupted items only accept corrupted-item currency (Architect\'s Orb, Orbs of Sacrifice, Vaal Cultivation Orb).';
    if (st.sanctified) return 'Sanctified items cannot be crafted further.';
    const hasCrafted = st.mods.filter((m) => m.crafted).length >= (ctx.craftedCap || 1) + (st.xCrafted || 0);
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
        if (a.homog && !homogTypes(ctx, st)) return 'Omen of Homogenising Coronation needs a modifier with a type on the item.';
        return null;
      case 'alchemy':
        return R === 'Normal' || R === 'Magic' ? null : 'Orb of Alchemy needs a Normal or Magic item.';
      case 'exalt': {
        if (R !== 'Rare') return 'Exalted Orb needs a Rare item.';
        const n = a.greater ? 2 : 1;
        const room = a.side ? open(ctx, st, a.side) : open(ctx, st, 'prefix') + open(ctx, st, 'suffix');
        if (room < n) return a.side ? `No room: the item already has ${count(st, a.side)} ${a.side}es.` : 'No open affix for Exalted Orb.';
        if (a.homog && !homogTypes(ctx, st)) return 'Omen of Homogenising Exaltation needs a modifier with a type on the item.';
        return null;
      }
      case 'chaos': {
        if (R !== 'Rare') return 'Chaos Orb needs a Rare item.';
        const pool = st.mods.filter((m) => removable(m) && (!a.side || m.side === a.side));
        if (!pool.length) return 'No removable modifier on that side (fractured mods cannot be removed).';
        // the new modifier needs a slot (R_NO_SPACE); Whittling takes the lowest-level modifier or nothing
        const low = a.whittle ? Math.min(...st.mods.filter(removable).map((m) => m.lvl)) : null;
        const ok = swapCandidates(ctx, st, (m) => removable(m) && (a.whittle ? m.lvl === low : !a.side || m.side === a.side), anyOpen(ctx));
        return ok.length ? null : 'Item has no space for more modifiers: the item is over its limit on a side, and the modifier this would remove leaves no slot for a new one.';
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
        if (a.quality === 'Altered' && ctx.bone !== 'Collarbone') return 'Altered Collarbones desecrate Rare amulets, rings and belts.';
        if (!boneExists(ctx, a.quality)) return `There is no ${a.quality} ${ctx.bone} in the game${ctx.bone === 'Cranium' ? ' (jewels take the Preserved Cranium only)' : ''}.`;
        if (a.putrefy) return null; // Omen of Putrefaction replaces every modifier; the one-Desecrated rule does not apply (claim k11)
        if (hasDes) return 'Only one Desecrated modifier per item (0.5+). Remove it first with Omen of Light + Orb of Annulment.';
        if (a.quality === 'Gnawed' && ctx.ilvl > 64) return 'Gnawed bones only work on item level 64 or lower.';
        if (a.lich && !(WEAPON.includes(ctx.cls) || JEWELLERY.includes(ctx.cls))) return `${OMEN.lich[a.lich]} only works on weapon or jewellery desecration.`;
        // Game text: if modifiers are full, a random modifier is also removed.
        const full = open(ctx, st, 'prefix') + open(ctx, st, 'suffix') === 0;
        if (full && !st.mods.some((m) => removable(m) && (!a.side || m.side === a.side))) return 'The item is full and no modifier there can be removed.';
        if (!full && a.side && open(ctx, st, a.side) < 1) return `No room: the item already has ${count(st, a.side)} ${a.side}es.`;
        if (!desSides(ctx, st, a).length) return a.lich ? `No ${a.lich} modifier can roll here (lich modifiers on equipment are level 65).` : 'The Well of Souls would have no modifier to offer on a side with room.';
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
        if (R !== 'Normal') return 'Orb of Chance needs a Normal item.';
        return chanceUniques(ctx, a).length ? null : 'No unique uses this base.';
      case 'vaal':
        return null;
      case 'hinekora':
        return st.foresight ? "The item already foresees its next currency (Hinekora's Lock)." : null;
      case 'mirror':
        return null;
      case 'rune_rule': {
        const rune = ctx.kb.augments && ctx.kb.augments[a.item];
        if (!rune || !rune.by_class[cls]) return `${a.item || 'This rune'} does not go on ${cls} items.`;
        const opens = (rune.by_class[cls].txt || []).map((t) => /Can roll (\w+) modifiers/i.exec(t)).find(Boolean);
        if (opens && (st.tags || []).some((t) => t !== opens[1].toLowerCase())) return 'One rune that opens a modifier pool per item: another one is socketed already.';
        const has = (st.runes || []).includes(a.item) || (ctx.item.runes || []).some((r) => (rune.by_class[cls].txt || []).includes(r.text));
        if (has && rune.limit === '1') return `${a.item} is already socketed (one per item).`;
        return freeSockets(ctx, st) < 1 ? NO_SOCKET : null;
      }
      case 'aldur': {
        const rune = ctx.kb.augments && ctx.kb.augments[a.item];
        if (!rune || !rune.by_class[cls]) return `${a.item || 'This rune'} does not go on ${cls} items.`;
        if (st.aldur) return 'A Rune of Aldur is already socketed.';
        return freeSockets(ctx, st) < 1 ? NO_SOCKET : null;
      }
      case 'verisium': {
        const vu = R === 'Unique' ? ((ctx.kb.verisium_unique_upgrades || {})[ctx.item.name] || []).filter((u) => u.from === ctx.item.base)
          : (ctx.kb.verisium_upgrades || {})[ctx.item.base] || [];
        return vu.length ? null : 'The Verisium Anvil has no upgrade for this item.';
      }
      case 'artificer': {
        if (!(MARTIAL.includes(cls) || cls === 'Wand' || cls === 'Staff' || ARMOUR.includes(cls))) return "Artificer's Orb works on martial weapons, wands, staves and armour.";
        if (socketsOf(ctx, st) > maxSockets(cls)) return `The item has ${socketsOf(ctx, st)} augment sockets, one more than ${cls} usually gets (an exceptional base, or a Vaal Orb's socket). Artificer's Orb adds none past the usual number.`;
        return socketsOf(ctx, st) >= maxSockets(cls) ? `The item already has ${socketsOf(ctx, st)} augment socket${socketsOf(ctx, st) === 1 ? '' : 's'}, the most Artificer's Orb gives ${cls}. Only a Vaal Orb can add one more.` : null;
      }
      case 'extraction':
        if (!(WEAPON.includes(cls) || ARMOUR.includes(cls) || JEWELLERY.includes(cls) || cls === 'Quiver')) return 'Orb of Extraction works on equipment.';
        return (ctx.item.runes || []).length || (st.runes || []).length ? null : 'No augment is socketed in the item.';
      case 'catalyst':
        if (a.refined ? cls !== 'Jewel' : !(cls === 'Ring' || cls === 'Amulet' || catalystBase(ctx.base))) return a.refined ? 'Refined catalysts work on jewels.' : 'Catalysts work on rings and amulets (Refined ones on jewels).';
        return a.tag && st.catTag === a.tag && st.catQ >= 20 ? 'The catalyst quality is already 20%.' : null;
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
        // Two mods of one element can result (poe2wiki, u4n guide: every source mod converts, the item can end with
        // several resistance modifiers of the same type); t20.
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
        if (!st.mods.some((m) => removable(m) && (!from || m.side === from))) return 'No removable modifier.';
        return !outs.length || swapCandidates(ctx, st, (m) => removable(m) && (!from || m.side === from), liquidFits(ctx, outs)).length ? null
          : 'Item has no space for the crafted modifier: no removable modifier leaves a slot on its side.';
      }
      default:
        return 'Unknown action.';
    }
  }
  /** Can one of a liquid emotion's crafted modifiers go on what is left of the item (its group free, a slot on its side)? */
  const liquidFits = (ctx, outs) => (rest) => {
    const taken = groupsOf(rest);
    return outs.some((id) => { const m = ctx.kb.mods[id]; return !m.grp.some((g) => taken.has(g)) && open(ctx, rest, sideOf(m)) > 0; });
  };
  /**
   * The rune that adds a suffix slot on this item (Serle's Triumph), when a plan could socket it: the class takes it, the
   * item does not have it yet, and a socket is free or an Artificer's Orb can add one. null otherwise.
   */
  function suffixRune(ix, item) {
    if (!item || !ix.kb.bases[item.base] || item.rarity === 'Unique') return null;
    const ctx = makeContext(ix, item);
    const name = runeFor(ctx, /Suffix Modifiers? allowed/i);
    if (!name || (item.runes || []).some((r) => /Suffix Modifiers? allowed/i.test(r.text))) return null;
    const st = toState(ctx, item);
    return freeSockets(ctx, st) > 0 || !validate(ctx, st, { op: 'artificer' }) ? name : null;
  }
  /**
   * Rune pools no plan can open on this item: {tag: reason}. A pool rune needs a free augment socket, or one an
   * Artificer's Orb can add; with another pool rune socketed (they are socket-bound) no second pool opens.
   */
  function runeBlocks(ix, item) {
    const out = {};
    if (!item || !ix.kb.bases[item.base]) return out;
    const ctx = makeContext(ix, item);
    const st = toState(ctx, item);
    const on = st.tags || [];
    for (const p of runePoolsFor(ctx)) {
      if (on.includes(p.tag)) continue;
      if (on.length) { out[p.tag] = 'another pool rune is socketed (one per item)'; continue; }
      const room = freeSockets(ctx, st) > 0 || validate(ctx, st, { op: 'artificer' }) === null;
      if (!room) out[p.tag] = `needs the rune ${p.rune}: no free augment socket`;
    }
    return out;
  }
  /** Augment sockets the item has now, and the most a base of the class gets without corruption. */
  function socketsOf(ctx, st) { return (ctx.item.sockets || []).length + (st.sockets || 0); }
  /**
   * Free augment sockets: the item's sockets (at least one per rune it came with, when the text has no Sockets line) and
   * the ones an Artificer's Orb added, less the runes it came with and the ones socketed since.
   */
  function freeSockets(ctx, st) {
    const came = (ctx.item.runes || []).length;
    return Math.max((ctx.item.sockets || []).length, came) + (st.sockets || 0) - came - (st.socketed || 0);
  }
  const NO_SOCKET = "No free augment socket: an Artificer's Orb adds one where the item class takes it.";
  const maxSockets = E.maxSockets;
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

  let tickFn = () => new Promise((r) => setTimeout(r, 0));
  const tick = () => tickFn();
  /** Replace the pause the long loops take between slices (a worker passes one that timers' throttling does not touch). */
  function setTick(fn) { tickFn = fn; }

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
  function rollMod(ctx0, st, sides, floor, rng, boost, homog) {
    const ctx = poolCtx(ctx0, st);
    const taken = groupsOf(st);
    const added = E.addedTags(ctx.kb, st.mods.map((m) => m.id));
    const lists = sides.map((s) => rollPool(ctx, st, s, floor));
    const cands = [], ws = [];
    let total = 0;
    for (const l of lists) for (const e of l) {
      if (e.grp.some((g) => taken.has(g))) continue;
      if (homog && !typesOf(ctx, e.id).some((t) => homog.has(t))) continue;
      if (added && !e.rune && E.tagBlocked(ctx.kb.mods[e.id], ctx.baseTags, added)) continue;
      const w = boost && ctx.kb.mods[e.id].mt.includes(boost.tag) ? e.w * boost.mult : e.w;
      cands.push(e); ws.push(w); total += w;
    }
    if (!total) return null;
    let r = rng() * total;
    for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }
  // Modifier types for the Homogenising omens ("a Modifier of the same type as an existing Modifier"): the mod's game tags
  // that Craft of Exile also uses as types (it ignores 'drop'); tags it does not have, like 'resource', are left out.
  const HOMOG_TYPES = new Set(['ailment', 'armour', 'attack', 'attribute', 'aura', 'bleed', 'caster', 'caster_critical', 'caster_speed', 'chaos',
    'chaos_damage', 'chaos_resistance', 'cold', 'cold_resistance', 'critical', 'curse', 'damage', 'defences', 'elemental', 'elemental_resistance',
    'energy_shield', 'evasion', 'fire', 'fire_resistance', 'gem', 'gem_level', 'life', 'flat_life_regen', 'lightning', 'lightning_resistance', 'mana',
    'minion', 'minion_damage', 'minion_resistance', 'minion_speed', 'physical', 'physical_damage', 'poison', 'resistance', 'runic_ward', 'speed']);
  function typesOf(ctx, id) { const m = id && ctx.kb.mods[id]; return m ? (m.mt || []).filter((t) => HOMOG_TYPES.has(t)) : []; }
  /** The types of the modifiers on the item (Homogenising omens), or null when none has one. */
  function homogTypes(ctx, st) {
    const s = new Set();
    for (const m of st.mods) for (const t of typesOf(ctx, m.id)) s.add(t);
    return s.size ? s : null;
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

  /**
   * The modifiers a "remove one, add one" currency can take (R_NO_SPACE): the new modifier needs a slot once the old one
   * is gone, and the game refuses the use otherwise ("Item has no space for more modifiers", nothing is spent). That
   * only bites on an item over its limit on a side, e.g. a jewel left with three suffixes after its "+1 Suffix
   * Modifier allowed" was removed: with both prefixes in place a Chaos Orb can only swap a prefix, so the suffixes are safe.
   * pred(m): the modifiers the currency may remove; fits(rest): is there room for what it adds on the item without m.
   */
  function swapCandidates(ctx, st, pred, fits) {
    const lim = limits(ctx, st);
    const over = count(st, 'prefix') > lim.prefix || count(st, 'suffix') > lim.suffix;
    const caps = ctx.capMods && ctx.capMods.size ? ctx.capMods : null;
    return st.mods.filter((m, i) => {
      if (!pred(m)) return false;
      if (!over && !(caps && caps.has(m.id))) return true; // within the limits, the freed slot is always there
      return fits(Object.assign({}, st, { mods: st.mods.filter((x, j) => j !== i) }));
    });
  }
  const anyOpen = (ctx) => (rest) => SIDES.some((s) => open(ctx, rest, s) > 0);
  function removeOneOf(st, cands, rng) {
    if (!cands.length) return null;
    const m = cands[Math.floor(rng() * cands.length)];
    return st.mods.splice(st.mods.indexOf(m), 1)[0];
  }

  function removeRandom(st, pred, rng) {
    const idx = [];
    st.mods.forEach((m, i) => { if (pred(m)) idx.push(i); });
    if (!idx.length) return null;
    const i = idx[Math.floor(rng() * idx.length)];
    return st.mods.splice(i, 1)[0];
  }

  /** A Corruption Enchantment of this base's corrupted pool (kb pools) the item does not have yet, evenly (no weights are published). */
  function corruptionEnchant(ctx, st, rng) {
    const pool = ((ctx.kb.pools[ctx.base.sig] || {}).corrupted || []).filter((id) => !(st.enchants || []).includes(id));
    return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  }
  /**
   * Vaal Orb (Maxroll corruption table; Game8 and Gamerant: about 25% each; not in the game files): nothing, 1-3 modifiers
   * randomised (a modifier removed and a random one added, like a Chaos Orb, once to three times), a Corruption Enchantment,
   * or +1 socket (wands and staves: quality up to 23%); on jewels the last is a modifier added or removed ignoring the
   * limits. Omen of Corruption: "your next Vaal Orb will always result in change".
   */
  function vaalOutcome(ctx, st, a, rng, removed, added) {
    const jewel = ctx.cls === 'Jewel';
    const outs = ['nothing', 'reroll', 'enchant', jewel ? 'addremove' : 'socket'].filter((o) => !(a.omen && o === 'nothing'));
    const o = outs[Math.floor(rng() * outs.length)];
    st.corrupted = true; st.outcome = o;
    if (o === 'reroll' && st.mods.some(removable)) {
      const n = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const r = removeRandom(st, removable, rng);
        if (!r) break;
        removed.push(r);
        const e = rollMod(ctx, st, openSides(ctx, st), 0, rng);
        if (e) { addRolled(ctx, st, e, null, rng); added.push(st.mods[st.mods.length - 1]); }
      }
    } else if (o === 'enchant') {
      const id = corruptionEnchant(ctx, st, rng);
      if (id) { st.enchants = (st.enchants || []).concat([id]); st.corruptEnchant = true; st.enchantCount = (st.enchantCount || 0) + 1; }
    } else if (o === 'socket') {
      if (ctx.cls === 'Wand' || ctx.cls === 'Staff') st.quality = Math.min(23, Math.max(st.quality || 0, 20) + 1 + Math.floor(rng() * 3));
      else st.sockets = (st.sockets || 0) + 1;
    } else if (o === 'addremove') {
      if (rng() < 0.5 && st.mods.some(removable)) { const r = removeRandom(st, removable, rng); if (r) removed.push(r); }
      else {
        const s = SIDES[Math.floor(rng() * 2)];
        const e = rollMod(ctx, st, [s], 0, rng); // ignores the limits
        if (e) { addRolled(ctx, st, e, null, rng); added.push(st.mods[st.mods.length - 1]); }
      }
    }
  }
  /**
   * Omen of Putrefaction: "replace all modifiers on the item creating an item with up to 6 Unrevealed modifiers and
   * Corrupting the item". Every modifier that can be removed goes (fractured ones stay, R_FRACTURED_LOCK); each open slot
   * gets a desecrated modifier revealed like any other (the player's focus: six, three a side). Omen of Abyssal Echoes
   * rerolls the first reveal's options.
   */
  function putrefy(ctx, st, a, rng, pick, removed, added) {
    for (const m of st.mods.slice()) if (removable(m)) { removed.push(m); st.mods.splice(st.mods.indexOf(m), 1); }
    const floor = a.quality === 'Ancient' ? 40 : 0;
    let first = true;
    for (const side of SIDES) {
      while (open(ctx, st, side) > 0) {
        let opts = revealOptions(ctx, st, side, floor, null, rng);
        if (!opts.length) break;
        let choice = pick ? pick(opts, false) : null;
        if (first && a.echoes && !choice) { opts = revealOptions(ctx, st, side, floor, null, rng); choice = pick ? pick(opts, true) : null; }
        first = false;
        if (!choice) choice = opts.slice().sort((x, y) => y.lvl - x.lvl)[0];
        addRolled(ctx, st, choice, { des: true }, rng);
        added.push(st.mods[st.mods.length - 1]);
      }
    }
    st.corrupted = true;
  }
  /** Void Flux: the Chaos Resistance tier of the highest level not above the converted modifier's (else the lowest). */
  function chaosResFor(ctx, lvl) {
    const tiers = [...ctx.pool.entries()].filter(([id]) => ctx.kb.mods[id].fam === 'ChaosResistance').map(([id]) => id)
      .sort((x, y) => ctx.kb.mods[x].lvl - ctx.kb.mods[y].lvl);
    if (!tiers.length) return null;
    const fit = tiers.filter((id) => ctx.kb.mods[id].lvl <= lvl && ctx.kb.mods[id].lvl <= ctx.ilvl);
    return fit.length ? fit[fit.length - 1] : tiers[0];
  }
  /** The rune (kb.augments) for this item class whose text matches, e.g. Medved's Tending for "Can roll Soul modifiers". */
  function runeFor(ctx, re) {
    const memo = ctx._runeFor || (ctx._runeFor = new Map());
    if (memo.has(re.source)) return memo.get(re.source);
    let hit = null;
    for (const [name, a] of Object.entries(ctx.kb.augments || {})) {
      const c = (a.by_class || {})[ctx.cls];
      if (c && (c.txt || []).some((t) => re.test(t)) && !/of Aldur$/.test(name)) { hit = name; break; }
    }
    memo.set(re.source, hit);
    return hit;
  }
  // catalyst per modifier tag (item texts: Flesh = Life, Neural = Mana, ...); Refined ones for jewels
  const CATALYST_NAME = { life: 'Flesh Catalyst', mana: 'Neural Catalyst', defences: 'Carapace Catalyst', physical: "Uul-Netol's Catalyst",
    fire: "Xoph's Catalyst", cold: "Tul's Catalyst", lightning: "Esh's Catalyst", chaos: "Chayula's Catalyst", attack: 'Reaver Catalyst',
    caster: 'Sibilant Catalyst', speed: 'Skittering Catalyst', attribute: 'Adaptive Catalyst', minion: 'Necrotic Catalyst' };
  const ALDUR_ELEMENT = { 'Passion of Aldur': 'Fire', 'Breath of Aldur': 'Cold', 'Ire of Aldur': 'Lightning', 'Betrayal of Aldur': 'Chaos' };
  const ELEMENT_WORDS = ['Fire', 'Cold', 'Lightning', 'Chaos'];
  /** The modifier a Rune of Aldur turns this one into: its id with the element named the rune's way (same tier), if it exists. */
  function aldurTwin(ctx, id, to) {
    // the same answer for a modifier and an element every time: kept per context (the policy asks on every step)
    const memo = ctx._twin || (ctx._twin = new Map());
    const key = id + '|' + to;
    if (!memo.has(key)) memo.set(key, aldurTwinOf(ctx, id, to));
    return memo.get(key);
  }
  function aldurTwinOf(ctx, id, to) {
    const m = ctx.kb.mods[id];
    const pe = ctx.pool.get(id);
    for (const el of ELEMENT_WORDS) {
      if (el === to || !id.includes(el)) continue;
      // the same tier of the family named the other way on this base; when that family has fewer tiers, its lowest one
      // (ids are not parallel across elements: LocalAddedChaosDamage1 is level 83, LocalAddedFireDamage1 level 1)
      const fam = m && m.fam ? m.fam.split(el).join(to) : null;
      const same = fam && pe ? [...ctx.pool.entries()].filter(([x, e]) => ctx.kb.mods[x].fam === fam && e.side === pe.side) : [];
      if (same.length) {
        const hit = same.find(([, e]) => e.tier === pe.tier) || same.sort((a, b) => ctx.kb.mods[a[0]].lvl - ctx.kb.mods[b[0]].lvl)[0];
        return hit[0];
      }
      const twin = id.split(el).join(to); // not on this base's pool: the twin by id
      if (ctx.kb.mods[twin]) return twin;
    }
    return null;
  }
  /** Uniques an Orb of Chance can make from this base (kb.uniques variants on it); Omen of the Ancients: any of the class. */
  function chanceUniques(ctx, a) {
    const U = ctx.kb.uniques || {};
    return Object.keys(U).filter((n) => a && a.ancients ? U[n].cls === ctx.cls : (U[n].variants || []).some((v) => v.base === ctx.item.base) || U[n].trade_base === ctx.item.base);
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
        // a fresh white base: nothing socketed, no catalyst quality, not runeforged
        st.rarity = 'Normal'; st.mods = []; st.runes = []; st.tags = []; st.socketed = 0; st.sockets = 0; st.xCrafted = 0; st.xSuffix = 0; st.aldur = null;
        st.catQ = 0; st.catTag = null; st.quality = 0; st.verisium = false;
        break;
      case 'transmute':
        st.rarity = 'Magic';
        addOne(openSides(ctx, st), floorFor(ctx, 'transmute', tier));
        break;
      case 'augment':
        addOne(openSides(ctx, st), floorFor(ctx, 'augment', tier));
        break;
      case 'regal': {
        const homog = a.homog ? homogTypes(ctx, st) : null;
        st.rarity = 'Rare';
        const e = rollMod(ctx, st, openSides(ctx, st, a.side), floorFor(ctx, 'regal', tier), rng, null, homog);
        if (e) { addRolled(ctx, st, e, null, rng); added.push(st.mods[st.mods.length - 1]); }
        break;
      }
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
        const homog = a.homog ? homogTypes(ctx, st) : null; // types of the modifiers already there (Craft of Exile's rule)
        for (let i = 0; i < n; i++) {
          const e = rollMod(ctx, st, openSides(ctx, st, a.side), floorFor(ctx, 'exalt', tier), rng, boost, homog);
          if (e) { addRolled(ctx, st, e, null, rng); added.push(st.mods[st.mods.length - 1]); }
        }
        if (a.catalyse) st.catQ = 0; // the omen consumes all catalyst quality
        break;
      }
      case 'chaos': {
        let r;
        if (a.whittle) {
          const cands = st.mods.filter(removable);
          const low = Math.min(...cands.map((m) => m.lvl));
          r = removeOneOf(st, swapCandidates(ctx, st, (m) => removable(m) && m.lvl === low, anyOpen(ctx)), rng);
        } else r = removeOneOf(st, swapCandidates(ctx, st, (m) => removable(m) && (!a.side || m.side === a.side), anyOpen(ctx)), rng);
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
        const fit = desSides(ctx, st, a);
        let side = null;
        if (open(ctx, st, 'prefix') + open(ctx, st, 'suffix') === 0) {
          // The game text does not say which side loses the mod: take it from a side that can hold a desecrated mod.
          const r = removeRandom(st, (m) => removable(m) && fit.includes(m.side), rng);
          if (r) { removed.push(r); side = r.side; }
        } else {
          // The side is set when the bone is used (an unrevealed mod already reads "Desecrated Suffix Modifier"): the
          // omen's side, else one of the sides with room at random (Sift: 50/50).
          const cand = fit.filter((x) => open(ctx, st, x) > 0);
          side = cand.length ? cand[Math.floor(rng() * cand.length)] : null;
        }
        if (a.putrefy) { putrefy(ctx, st, a, rng, pick, removed, added); break; }
        if (!side) break;
        const draw = () => revealOptions(ctx, st, side, floor, a.lich || null, rng);
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
          if (!r || r.el === a.to || m.frac) continue;
          const id = a.to === 'chaos' ? chaosResFor(ctx, m.lvl) : RES[a.to] + r.n;
          const km = ctx.kb.mods[id];
          if (!km) continue;
          const pe = ctx.pool.get(id);
          removed.push(Object.assign({}, m));
          // same tier, the value rolled again inside it (poe2wiki, u4n guide); flux: it may share its group with another mod
          Object.assign(m, { id, fam: km.fam, grp: km.grp, lvl: km.lvl, tier: pe ? pe.tier : m.tier, flux: true });
          if (ctx.needValues) { const rg = rangeOf(ctx, id); m.hi = rg ? rg[1] : m.hi; m.v = rg ? rollValue(rg, rng) : m.v; }
          added.push(m);
        }
        break;
      }
      case 'catalyst':
        // "Adds quality that enhances X modifiers ... Replaces other quality types"; guides: 1-2% per catalyst, more on low
        // item levels (Gamerant, Timesaver). Modelled as 1% per catalyst (2% below item level 50), up to 20%.
        if (a.tag) {
          if (st.catTag !== a.tag) { st.catTag = a.tag; st.catQ = 0; }
          st.catQ = Math.min(20, (st.catQ || 0) + (a.per || (ctx.ilvl < 50 ? 2 : 1)));
          st.quality = st.catQ;
        }
        break;
      case 'rune_rule': {
        // runes that change crafting (game data augments): Astrid's Creativity allows one more crafted modifier, Serle's
        // Triumph one more suffix, a "Can roll ... modifiers" rune opens its pool (R_RUNE_POOLS)
        const txt = ((ctx.kb.augments[a.item] || {}).by_class || {})[ctx.cls];
        const t = txt ? (txt.txt || []).join('\n') : '';
        st.runes = (st.runes || []).concat([a.item]);
        st.socketed = (st.socketed || 0) + 1;
        const opens = /Can roll (\w+) modifiers/i.exec(t);
        if (opens) st.tags = (st.tags || []).concat([opens[1].toLowerCase()]);
        if (/additional Crafted Modifier/i.test(t)) st.xCrafted = (st.xCrafted || 0) + 1;
        const sx = /\+(\d+) Suffix Modifiers? allowed/i.exec(t);
        if (sx) st.xSuffix = (st.xSuffix || 0) + +sx[1];
        break;
      }
      case 'aldur': {
        // "Transforms all Cold and Lightning modifiers on the item into equivalent Fire modifiers" while socketed; fractured
        // ones stay (t30). Equivalent: the same modifier with the element named the other way, same tier.
        const to = ALDUR_ELEMENT[a.item];
        st.aldur = to;
        st.socketed = (st.socketed || 0) + 1;
        for (const m of st.mods) {
          if (m.frac || !m.id) continue;
          const id = aldurTwin(ctx, m.id, to);
          if (!id || id === m.id) continue;
          const km = ctx.kb.mods[id], pe = ctx.pool.get(id);
          removed.push(Object.assign({}, m));
          Object.assign(m, { id, fam: km.fam, grp: km.grp, lvl: km.lvl, tier: pe ? pe.tier : m.tier, aldur: true });
          added.push(m);
        }
        break;
      }
      case 'verisium':
        st.verisium = true; // the base becomes its Runeforged form; modifiers stay (t28)
        break;
      case 'hinekora':
        break;
      case 'mirror':
        st.mirrored = true;
        break;
      case 'vaal':
        vaalOutcome(ctx, st, a, rng, removed, added);
        break;
      case 'artificer':
        st.sockets = (st.sockets || 0) + 1; st.outcome = 'socketed';
        break;
      case 'extraction':
        st.destroyed = true; st.outcome = 'extracted';
        break;
      case 'architect': {
        // Maxroll: 50/50, a second Corruption Enchantment or the item is destroyed
        if (rng() < 0.5) { st.destroyed = true; st.outcome = 'destroyed'; break; }
        const id = corruptionEnchant(ctx, st, rng);
        if (id) { st.enchants = (st.enchants || []).concat([id]); st.enchantCount = (st.enchantCount || (st.corruptEnchant ? 1 : 0)) + 1; st.corruptEnchant = true; }
        st.outcome = 'enchant2';
        break;
      }
      case 'cultivation':
        st.corrupted = true; st.outcome = 'cultivation';
        break;
      case 'chance': {
        // Orb of Chance: a unique that uses this base, or the base is destroyed (Omen of Chance: kept instead). The odds
        // per base are not in the data; a.success (the player's estimate) or unknown.
        const list = chanceUniques(ctx, a);
        if (a.success == null) { st.unpredictable = true; break; }
        if (rng() < a.success) { st.rarity = 'Unique'; st.unique = list[Math.floor(rng() * list.length)]; st.mods = []; }
        else if (!a.omen && !a.ancients) st.destroyed = true;
        break;
      }
      case 'sacrifice': {
        const r = removeRandom(st, removable, rng);
        if (r) removed.push(r);
        st.enchantUpgraded = true; // "Upgrades a Corruption Enchantment": the upgraded value is not in the data
        break;
      }
      case 'liquid': {
        // Game text: "Removes a random modifier and Augments a Rare Basic Jewel with a new guaranteed Crafted modifier";
        // the modifier per jewel is in the game table LiquidEmotionOutcomes. Two outcomes (a prefix and a suffix): one that fits.
        const outs = liquidOutcomes(ctx, a);
        const from = outs.length ? swapSide(ctx, st, [...new Set(outs.map((id) => sideOf(ctx.kb.mods[id])))], null) : null;
        // the modifier that goes is one that leaves room for the crafted one (R_NO_SPACE)
        const r = outs.length ? removeOneOf(st, swapCandidates(ctx, st, (m) => removable(m) && (!from || m.side === from), liquidFits(ctx, outs)), rng)
          : removeRandom(st, (m) => removable(m) && (!from || m.side === from), rng);
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
      if (t.group === 'prefix' || t.group === 'suffix' || t.group === 'desecrated' || t.group === 'rune') {
        const des = t.group === 'desecrated';
        const side = des || t.group === 'rune' ? slotSide : t.group;
        const rp = des ? null : runePoolOf(ctx, t.fam, side); // a modifier a rune opens: the rune is socketed for it
        let lich = null;
        if (des) {
          const ids = (ctx.ix.famMods.get(t.fam) || []).filter((id) => ctx.kb.mods[id].dom === 'd');
          lich = ids.length ? E.lichOf(ctx.kb.mods[ids[0]]) : null;
        }
        const any = (ctx.ix.famMods.get(t.fam) || [])[0];
        const grp = any ? ctx.kb.mods[any].grp : [];
        const minValue = t.minValue > 0 ? +t.minValue : null;
        if (minValue != null) ctx.needValues = true;
        goals.push({ key, fam: t.fam, side, des, grp, tier: minValue != null ? null : t.minTier || null, minValue, required: !!t.required, label: t.label, lich, ess: essencesFor(ctx, t.fam),
          rune: rp ? rp.tag : null, runeItem: rp ? rp.rune : null });
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
    // a Desecrated base modifier is the same stat, so it meets a base-modifier goal; a desecrated goal needs a desecrated one
    if (m.fam !== g.fam || (g.des && !m.des)) return false;
    if (g.minValue != null) return m.v != null && m.v >= g.minValue;
    const want = tier === undefined ? g.tier : tier;
    return !want || !!(m.tier && m.tier <= want);
  }
  /** Right mod, value too low, but its tier can roll the value: a Divine Orb can fix it (not a fractured one). */
  function nearMiss(m, g) {
    return g.minValue != null && !m.frac && m.fam === g.fam && (!g.des || m.des) && m.v != null && m.v < g.minValue && m.hi != null && m.hi >= g.minValue;
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
      const astrid = runeFor(ctx, /additional Crafted Modifier/i) ? 1 : 0; // Astrid's Creativity can add a crafted slot
      if (st.mods.filter((m) => m.crafted && !meets(m, g, g.eff)).length >= (ctx.craftedCap || 1) + astrid) return 'the crafted slot is already used';
      return (g.ess || []).length ? null : 'no essence gives this mod on this item class';
    }
    const viaEssence = essenceOptions(ctx, g, 'magic').length + essenceOptions(ctx, g, 'rare').length > 0;
    if (g.rune && (st.tags || []).some((t) => t !== g.rune)) return `needs the rune ${g.runeItem}, but the rune on the item opens another pool (one per item)`;
    const ok = (g.rune ? runeSide(ctx, g.rune, g.side, 0) : sidePool(ctx, g.side, 0)).some((e) => e.fam === g.fam && (!g.eff || e.tier <= g.eff) && reaches(ctx, e.id, g)) || viaEssence;
    if (!ok) {
      const onBase = viaEssence || (g.rune ? runeSide(ctx, g.rune, g.side, 0) : sidePool(ctx, g.side, 0)).some((e) => e.fam === g.fam);
      if (!onBase) return 'this modifier cannot roll on this base';
      return g.minValue != null ? `no tier reaches ${g.minValue} at this item level` : 'this tier cannot roll at this item level';
    }
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
   *  desSlam: bool     on the Rare item, a bone instead of an Exalted Orb for a base-modifier goal while the item has no
   *                    desecrated modifier and no desecrated goal is left: the Well of Souls offers base modifiers of
   *                    the side too, and the one the goal asks for is kept (echoes: reroll the three once)
   *  essence: bool     use an essence when one guarantees an unmet goal (and the crafted slot is free)
   */
  function makePolicy(ctx, goals, params, priced, matOk) {
    /** Essences for a goal within the route's materials (matOk); all of them when none is, so the goal stays possible. */
    const essFor = (g, kind) => {
      const all = essenceOptions(ctx, g, kind);
      if (!matOk || !all.length) return all;
      const ok = all.filter((r) => matOk(r.item));
      return ok.length ? ok : all;
    };
    // Each setting is read only where its value can change the move (state checks come first). The exhaustive sweep
    // (scripts/selftest/sweep.js) records which settings a run reads to group strategies that behave the same.
    const unmet = (st) => goals.filter((g) => !goalMet(st, g));
    /** A goal from a rune's pool while that rune is not socketed: nothing can roll it yet. */
    const shut = (st, g) => !!g.rune && !(st.tags || []).includes(g.rune);
    /** The strategy's bone quality, or Preserved where the item class has no such bone (jewels). */
    const boneQ = (q) => (q && boneExists(ctx, q) ? q : 'Preserved');
    const resGoal = (g) => !g.des && /^(Fire|Cold|Lightning)Resistance$/.test(g.fam || '');
    /** Flux when it finishes an unmet resistance goal from one mod of another element and keeps every finished goal. */
    function fluxStep(st, left) {
      if (st.rarity !== 'Magic' && st.rarity !== 'Rare') return null;
      for (const g of left) {
        if (!resGoal(g)) continue;
        const to = g.fam.replace('Resistance', '').toLowerCase();
        const a = { op: 'flux', to };
        if (validate(ctx, st, a)) continue;
        const after = apply(ctx, st, a, () => 0.5).state;
        if (goalMet(after, g) && goals.every((x) => !goalMet(st, x) || goalMet(after, x))) return params.flux === false ? null : a;
      }
      return null;
    }
    /** Runes that change crafting, socketed when a goal needs them (game data augments; test t30 for Aldur). */
    function runeStep(st, left) {
      const r = runeCandidate(st, left);
      return r && params.runes !== false ? r : null;
    }
    // The same on every step of a run: the goals' counts, and the families a Rune of Aldur would have to produce.
    const nEssGoals = goals.filter((g) => g.essenceOnly).length;
    const nSuffixGoals = goals.filter((g) => g.side === 'suffix').length;
    const anyPooled = goals.some((g) => g.rune);
    const goalFams = new Set(goals.map((g) => g.fam));
    const ALDUR_RUNES = Object.keys(ALDUR_ELEMENT);
    /**
     * The Runes of Aldur that turn this modifier into one of a goal's family (only such a rune can finish a goal), or
     * null. Worked out once per modifier: the policy asks on every step.
     */
    const aldurMemo = new Map();
    function aldurOf(id) {
      let v = aldurMemo.get(id);
      if (v === undefined) {
        const list = ALDUR_RUNES.filter((item) => { const t = aldurTwin(ctx, id, ALDUR_ELEMENT[item]); return !!t && t !== id && goalFams.has(ctx.kb.mods[t].fam); });
        v = list.length ? list : null;
        aldurMemo.set(id, v);
      }
      return v;
    }
    function runeCandidate(st, left) {
      // a rune goes into a free augment socket; where none is free an Artificer's Orb adds one first (if the class takes it)
      const socket = (a) => {
        const err = validate(ctx, st, a);
        if (!err) return a;
        return err === NO_SOCKET && !validate(ctx, st, { op: 'artificer' }) ? { op: 'artificer' } : null;
      };
      // A goal from a pool that a rune opens ("Can roll Marksman modifiers"): the rune goes in once the goals that roll
      // from the item's own pool are finished. While it is socketed its modifiers roll as well, so every Exalted or
      // Chaos Orb for the other goals would hit less often; and a base that is thrown away before costs no rune.
      const pooled = anyPooled ? left.find((g) => shut(st, g)) : null;
      if (pooled && !left.some((g) => !g.rune && !g.des && !g.essenceOnly)) {
        const a = socket({ op: 'rune_rule', item: pooled.runeItem });
        if (a) return a;
      }
      // Astrid's Creativity: more crafted-modifier goals than crafted slots
      const cap = (ctx.craftedCap || 1) + (st.xCrafted || 0);
      if (nEssGoals > cap) {
        const r = runeFor(ctx, /additional Crafted Modifier/i);
        const a = r && socket({ op: 'rune_rule', item: r });
        if (a) return a;
      }
      // Serle's Triumph (+1 Suffix Modifier allowed): a fourth suffix goal. It is socketed once the Rare item's suffix
      // slots all hold goals, so a base that is thrown away before that costs no rune.
      const sLim = limitsBase(ctx, st.rarity === 'Rare' ? st : { rarity: 'Rare', mods: st.mods }).suffix + (st.xSuffix || 0);
      if (st.rarity === 'Rare' && nSuffixGoals > sLim && left.some((g) => g.side === 'suffix')) {
        const onS = st.mods.filter((m) => m.side === 'suffix');
        if (onS.length >= sLim && onS.every((m) => useful(m, goals))) {
          const r = runeFor(ctx, /Suffix Modifiers? allowed/i);
          const a = r && socket({ op: 'rune_rule', item: r });
          if (a) return a;
        }
      }
      // a Rune of Aldur that finishes element goals from the other elements' modifiers, keeping every finished goal.
      // Sockets go to the runes that open a slot first: with one socket (a spear, a one-hand mace) and a fourth suffix
      // goal, an Aldur rune would leave no socket for Serle's Triumph.
      if (st.aldur || !(st.rarity === 'Magic' || st.rarity === 'Rare')) return null;
      // only the runes that can produce a goal's family are worth the checks below (they copy the item to try the rune)
      let found = null;
      for (const m of st.mods) {
        if (m.frac || !m.id) continue;
        const v = aldurOf(m.id);
        if (v) { if (!found) found = new Set(); for (const x of v) found.add(x); }
      }
      if (!found) return null;
      const helps = ALDUR_RUNES.filter((item) => found.has(item)); // tried in their usual order
      const reserve = (anyPooled && goals.some((g) => shut(st, g)) ? 1 : 0)
        + (nSuffixGoals > sLim && runeFor(ctx, /Suffix Modifiers? allowed/i) ? 1 : 0)
        + (nEssGoals > cap && runeFor(ctx, /additional Crafted Modifier/i) ? 1 : 0);
      const canAdd = validate(ctx, Object.assign({}, st, { sockets: 0 }), { op: 'artificer' }) === null || socketsOf(ctx, st) < maxSockets(ctx.cls)
        ? Math.max(0, maxSockets(ctx.cls) - socketsOf(ctx, st)) : 0;
      const spare = freeSockets(ctx, st) + (MARTIAL.includes(ctx.cls) || ctx.cls === 'Wand' || ctx.cls === 'Staff' || ARMOUR.includes(ctx.cls) ? canAdd : 0) - reserve;
      if (spare > 0) {
        for (const item of helps) {
          const a = { op: 'aldur', item };
          if (validate(ctx, st, a) === NO_SOCKET) { // the rune would finish a goal: an Artificer's Orb for its socket first
            const art = { op: 'artificer' };
            if (validate(ctx, st, art) || validate(ctx, Object.assign({}, st, { sockets: (st.sockets || 0) + 1 }), a)) continue;
            const after1 = apply(ctx, Object.assign({}, st, { sockets: (st.sockets || 0) + 1 }), a, () => 0.5).state;
            if (left.some((g) => goalMet(after1, g)) && goals.every((x) => !goalMet(st, x) || goalMet(after1, x))) return art;
            continue;
          }
          if (validate(ctx, st, a)) continue;
          const after = apply(ctx, st, a, () => 0.5).state;
          if (left.some((g) => goalMet(after, g)) && goals.every((x) => !goalMet(st, x) || goalMet(after, x))) return a;
        }
      }
      return null;
    }
    /** Catalyst quality for Omen of Catalysing Exaltation: a catalyst of a tag an unmet goal's family carries, up to 20%. */
    function catalystStep(st, left) {
      if (st.rarity !== 'Rare') return null;
      const jewel = ctx.cls === 'Jewel';
      if (!(jewel || ctx.cls === 'Ring' || ctx.cls === 'Amulet' || catalystBase(ctx.base))) return null;
      for (const g of left) {
        if (g.des || g.essenceOnly || open(ctx, st, g.side) < 1) continue;
        const tag = Object.keys(CATALYST_NAME).find((t) => famHasTag(ctx, g.fam, t));
        if (!tag || (st.catTag === tag && st.catQ >= 20)) continue;
        return params.catalyse ? { op: 'catalyst', tag, refined: jewel, item: (jewel ? 'Refined ' : '') + CATALYST_NAME[tag] } : null;
      }
      return null;
    }
    /**
     * Five-modifier jewel (recipe c15, rules R_JEWEL_SLOTS and R_NO_SPACE): three goals on one side of a jewel, which
     * holds two a side. The route, as a rule for the item as it is now:
     *   1. two of the three on the item (the usual way for two goals of a side);
     *   2. both slots of the other side filled, then Potent Liquid Contempt for "+1 Suffix (Prefix) Modifier allowed",
     *      which sits on the other side (the wrong one of its two outcomes takes a goal: back to 1);
     *   3. the third by desecration, kept at the Well of Souls (a wrong one comes off with Omen of Light);
     *   4. the allowance modifier removed with the side omen of its side: the three stay, over the limit;
     *   5. the other side filled at once with Exalted Orbs (with a free slot there a Chaos Orb can still take one of the three);
     *   6. the other side's goals with Chaos Orbs, which can only swap that side now, and the liquid emotion of a
     *      crafted goal ("increased Effect of Suffixes") last: it replaces one of the two, half the time the wanted one.
     * Returns a function (st, left) -> action, or null when the goals are not of this kind.
     */
    function jewelFive() {
      if (ctx.cls !== 'Jewel' || !ctx.bone) return null;
      const natural = (g) => !g.des && !g.essenceOnly && sidePool(ctx, g.side, 0).some((e) => e.fam === g.fam);
      const L = SIDES.find((s) => goals.filter((g) => g.side === s).length === 3 && goals.filter((g) => g.side === s).every(natural));
      if (!L) return null;
      const O = other(L);
      const Lg = goals.filter((g) => g.side === L), Og = goals.filter((g) => g.side === O);
      const liquidOf = (g) => (g.ess || []).find((r) => r.liquid);
      const crafted = Og.filter((g) => !natural(g) && liquidOf(g)), plainO = Og.filter(natural);
      if (Og.length > 2 || crafted.length > 1 || crafted.length + plainO.length !== Og.length) return null;
      // the liquid emotion whose modifier raises the limit of side L (it sits on side O), and its other outcome
      const allow = ctx.essences.find((r) => r.liquid && ((ctx.capMods.get(r.mod) || {})[L] || 0) > 0);
      if (!allow) return null;
      const wrong = ctx.essences.find((r) => r.liquid && r.item === allow.item && r.mod !== allow.mod);
      const quiet = Object.create(params, { desSlam: { value: false }, essence: { value: false } }); // the first two the plain way
      const pairs = new Map();
      const pairPolicy = (two) => {
        const k = two.map((g) => g.key).join('|');
        if (!pairs.has(k)) pairs.set(k, makePolicy(ctx, two, quiet, priced));
        return pairs.get(k);
      };
      const met = (st, g) => goalMet(st, g);
      const isJunk = (m) => removable(m) && !useful(m, goals);
      return function (st, left) {
        if (st.rarity !== 'Rare') return null; // a white or Magic jewel first becomes Rare the usual way
        const onL = st.mods.filter((m) => m.side === L), onO = st.mods.filter((m) => m.side === O);
        const metL = Lg.filter((g) => met(st, g));
        const hasAllow = st.mods.some((m) => m.id === allow.mod);
        const craftedMod = st.mods.find((m) => m.crafted);
        // A fractured modifier that is no goal takes a slot the five need: from a white base start over, else no way on.
        if (st.mods.some((m) => m.frac && !useful(m, goals))) {
          return ctx.item.rarity === 'Normal' && params.restart ? { op: 'newbase' } : { fail: 'a fractured modifier that is not a goal takes a slot the five modifiers need' };
        }
        if (metL.length === 3) {
          // 4. the allowance modifier goes; 5. the other side is filled; 6. its goals
          if (hasAllow) return { op: 'annul', side: O };
          if (open(ctx, st, O) > 0) return { op: 'exalt', tier: 'base' };
          const plainLeft = plainO.filter((g) => !met(st, g));
          if (plainLeft.length) return { op: 'chaos', tier: params.chaosTier || params.tier };
          const c = crafted.find((g) => !met(st, g));
          if (!c) return null;
          if (craftedMod) return { op: 'chaos', tier: params.chaosTier || params.tier }; // another crafted modifier is in the way
          const r = liquidOf(c);
          return { op: 'liquid', item: r.item, mod: r.mod };
        }
        if (metL.length === 2 && onL.length === 3) {
          // the third slot holds something else: a desecrated one comes off with Omen of Light, another one only by chance
          const des = onL.find((m) => m.des && isJunk(m));
          if (des) return { op: 'annul', light: true };
          return { op: 'annul', side: L };
        }
        if (metL.length === 2 && onL.length === 2) {
          if (hasAllow) {
            // 3. the third by desecration (the only free slot is on side L once the other side is full)
            const des = st.mods.find((m) => m.des);
            if (des && isJunk(des)) return { op: 'annul', light: true };
            // a goal that is itself desecrated uses the one desecrated slot: the third comes from an aimed Exalted Orb then
            if (des) return { op: 'exalt', tier: params.exaltTier || params.tier, side: L };
            return { op: 'bone', quality: 'Preserved', side: open(ctx, st, O) > 0 ? L : null, echoes: !!params.echoes };
          }
          // 2. fill the other side, then the liquid emotion
          if (craftedMod) return { op: 'annul', side: craftedMod.side };
          if (open(ctx, st, O) > 0) return { op: 'exalt', tier: 'base' };
          return { op: 'liquid', item: allow.item };
        }
        // 1. two of the three: the ones already there first
        const two = Lg.slice().sort((a, b) => met(st, b) - met(st, a)).slice(0, 2);
        const a = pairPolicy(two)(st);
        return a.done ? null : a;
      };
    }
    const five = jewelFive();
    return function next(st) {
      const left = unmet(st);
      if (!left.length) return { done: true };
      if (st.corrupted || st.sanctified) return { fail: 'item is locked' };
      if (five) { const a = five(st, left); if (a) return a; }
      const rs = runeStep(st, left);
      if (rs) return rs;
      const fx = fluxStep(st, left);
      if (fx) return fx;
      const cs = catalystStep(st, left);
      if (cs) return cs;
      const R = st.rarity;
      const sideNeed = (s) => left.filter((g) => g.side === s).length;
      const lean = sideNeed('prefix') > sideNeed('suffix') ? 'prefix' : sideNeed('suffix') > sideNeed('prefix') ? 'suffix' : null;
      const craftedFree = st.mods.filter((m) => m.crafted).length < (ctx.craftedCap || 1);
      const taken = groupsOf(st);
      const essHere = R !== 'Rare' && craftedFree
        ? left.map((g) => ({ g, r: essFor(g, 'magic').find((r) => !ctx.kb.mods[r.mod].grp.some((x) => taken.has(x))) })).find((x) => x.r)
        : null;
      const magicEss = essHere && params.essence ? essHere : null;
      if (R === 'Normal') {
        if (params.start === 'alchemy' && !magicEss) return { op: 'alchemy', side: lean && !ctx.legacy.has(OMEN.alchemy[lean]) && params.sideOmens ? lean : null };
        return { op: 'transmute', tier: params.magicTier || params.tier };
      }
      if (R === 'Magic') {
        // An essence turns the Magic item Rare with a guaranteed goal mod; keep a useful first mod for it.
        if (magicEss) {
          const junkOnly = st.mods.length === 1 && !useful(st.mods[0], goals) && !st.mods[0].frac;
          if (!(junkOnly && left.length > 1 && params.restart)) return { op: 'essence', item: magicEss.r.item, mod: magicEss.r.mod };
        }
        const anyHit = st.mods.some((m) => useful(m, goals));
        if (st.mods.length === 1 && !anyHit && !st.mods[0].frac && params.start === 'transmute' && params.restart) return { op: 'newbase' };
        if (st.mods.length === 2) {
          const junk = st.mods.find((m) => !useful(m, goals) && !m.frac);
          if (junk && left.some((x) => x.side === junk.side && !x.des && !x.essenceOnly) && params.pair && params.restart) return { op: 'newbase' };
        }
        if (open(ctx, st, 'prefix') + open(ctx, st, 'suffix') > 0 && st.mods.length < 2) return { op: 'augment', tier: params.magicTier || params.tier };
        return { op: 'regal', tier: params.magicTier || params.tier, side: lean && !ctx.legacy.has(OMEN.coronation[lean]) && params.sideOmens ? lean : null, homog: homogHelps(st, left.filter((x) => !x.des && !x.essenceOnly), OMEN.homogRegal) };
      }
      if (R !== 'Rare') return { fail: 'unsupported rarity' };
      const desJunk = st.mods.find((m) => m.des && !useful(m, goals) && !m.frac);
      // Fracture (a plan variant): with 4 mods and a finished goal among them (or 5 and two), lock one at random.
      if (!st.mods.some((m) => m.frac)) {
        const keep = st.mods.filter((m) => goals.some((x) => meets(m, x, x.eff)));
        if (keep.length && (st.mods.length === 4 || (st.mods.length === 5 && keep.length >= 2)) && params.fracture) return { op: 'fracture' };
      }
      // Values come last: when every goal left only needs a better roll on a mod that is already there, reroll values.
      if (left.every((x) => st.mods.some((m) => nearMiss(m, x)))) return { op: 'divine' };
      // Work on a goal that can be slammed into an open slot first; removals come after.
      const blocks = (g) => st.mods.some((m) => removable(m) && !useful(m, goals) && blocksGoal(ctx, m, g));
      const ready = (g) => !shut(st, g) && !blocks(g) && open(ctx, st, g.side) > 0 && (!g.des || !st.mods.some((m) => m.des));
      const g = left.find((x) => x.required && ready(x)) || left.find((x) => x.required && !shut(st, x)) || left.find(ready) || left.find((x) => !shut(st, x)) || left[0];
      if (shut(st, g)) return { fail: `needs the rune ${g.runeItem} (no free augment socket)` };
      // Perfect/special essence: removes a random mod (side chosen with Crystallisation) and adds the goal mod.
      if (craftedFree) {
        for (const eg of left) {
          const r = essFor(eg, 'rare').find((x) => !ctx.kb.mods[x.mod].grp.some((y) => taken.has(y)));
          if (!r) continue;
          if (!params.essence) break;
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
          if (side) return { op: 'pessence', item: r.item, mod: r.mod, side: !(side === mside && open(ctx, st, mside) < 1) && params.sideOmens ? side : null };
        }
      }
      if (g.essenceOnly) return { fail: 'needs an essence (none applies now)' };
      if (g.des) {
        if (desJunk) return { op: 'annul', light: true };
        if (st.mods.some((m) => m.des)) return { fail: 'a kept Desecrated mod blocks the desecrated goal' };
        if (open(ctx, st, g.side) > 0) {
          return {
            op: 'bone', quality: boneQ(params.bone), side: params.sideOmens ? g.side : null,
            lich: g.lich && (WEAPON.includes(ctx.cls) || JEWELLERY.includes(ctx.cls)) && params.lich ? g.lich : null,
            echoes: !!params.echoes,
          };
        }
        return removal(st, g.side, desJunk);
      }
      // A junk mod from the goal's group (e.g. a lower tier of the same stat) must go first.
      const blocking = st.mods.find((m) => removable(m) && !useful(m, goals) && blocksGoal(ctx, m, g));
      if (blocking) return removal(st, blocking.side, desJunk, blocking);
      if (open(ctx, st, g.side) > 0) {
        if (ctx.bone && !g.rune && !st.mods.some((m) => m.des) && !left.some((x) => x.des) && params.desSlam) {
          const b = { op: 'bone', quality: boneQ(params.bone), side: params.sideOmens ? g.side : null, echoes: !!params.echoes };
          if (!validate(ctx, st, b)) return b;
        }
        const two = open(ctx, st, g.side) >= 2 && left.filter((x) => x.side === g.side && !x.des).length >= 2 && !!params.greaterExalt;
        const catalyse = !!(st.catQ > 0 && st.catTag && famHasTag(ctx, g.fam, st.catTag) && params.catalyse);
        return { op: 'exalt', tier: params.exaltTier || params.tier, side: params.sideOmens ? g.side : null, greater: two, catalyse, homog: homogHelps(st, [g], OMEN.homogExalt) };
      }
      if (!g.des && !st.mods.some((m) => m.frac || m.lock) && params.slamOnly && params.restart) return { op: 'newbase' };
      return removal(st, g.side, desJunk);
    };

    /** Omen of Homogenising: when every goal the slam is for shares a modifier type with the item, the pool narrows to those types. */
    function homogHelps(st, gs, omen) {
      if (!gs.length || ctx.legacy.has(omen) || (priced && !priced(omen))) return false;
      const have = homogTypes(ctx, st);
      return !!have && gs.every((g) => (ctx.ix.famMods.get(g.fam) || []).some((id) => typesOf(ctx, id).some((t) => have.has(t)))) && !!params.homog;
    }
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
  /**
   * More goals than the item can hold? A jewel takes five modifiers at most, three on one side (recipe c15); other
   * items hold their Rare limits (a rune that adds a suffix slot counts where the class takes it).
   */
  function slotClash(ctx, goals) {
    const n = { prefix: goals.filter((g) => g.side === 'prefix').length, suffix: goals.filter((g) => g.side === 'suffix').length };
    if (ctx.cls === 'Jewel') {
      const lim = E.slotLimits({ rarity: 'Rare', slotDelta: { prefix: 0, suffix: 0 } }, 'Jewel');
      if (n.prefix > lim.prefix + 1 || n.suffix > lim.suffix + 1 || (n.prefix > lim.prefix && n.suffix > lim.suffix))
        return 'a jewel takes five modifiers at most: three on one side and two on the other';
      return null;
    }
    const lim = E.slotLimits({ rarity: 'Rare', slotDelta: ctx.slotDelta }, ctx.cls);
    // Sockets for runes: the free ones, and the ones an Artificer's Orb can still add (up to the class's usual number;
    // an exceptional base that dropped with one more keeps it, and only a Vaal Orb adds beyond)
    const st0 = { rarity: 'Rare', mods: [], sockets: 0, socketed: 0 };
    const room = freeSockets(ctx, st0) + (validate(ctx, st0, { op: 'artificer' }) === null ? Math.max(0, maxSockets(ctx.cls) - socketsOf(ctx, st0)) : 0);
    // a rune that opens a modifier pool: one per item
    const pools = [...new Set(goals.filter((g) => g.rune).map((g) => g.rune))];
    if (pools.length > 1) return `targets from two rune pools (${goals.filter((g) => g.rune).map((g) => g.runeItem).filter((x, i, a) => a.indexOf(x) === i).join(' and ')}): one rune that opens a pool per item`;
    const onItem = E.runeRules(ctx.item).pools;
    const needPool = pools.length && !onItem.includes(pools[0]) ? 1 : 0;
    if (needPool && onItem.length) return `the ${goals.find((g) => g.rune).label} target needs the rune ${goals.find((g) => g.rune).runeItem}, and the item carries another pool rune already (socket-bound, one per item)`;
    // Serle's Triumph adds a suffix slot where the class takes the rune
    const hasRune = (ctx.item.runes || []).some((r) => /Suffix Modifiers? allowed/i.test(r.text));
    const extra = !hasRune && runeFor(ctx, /Suffix Modifiers? allowed/i) && room - needPool > 0 ? 1 : 0;
    if (n.prefix > lim.prefix) return `more prefix targets (${n.prefix}) than a Rare item of this class holds (${lim.prefix})`;
    if (n.suffix > lim.suffix + extra) {
      return needPool && room === 1 && runeFor(ctx, /Suffix Modifiers? allowed/i) && !hasRune && n.suffix === lim.suffix + 1
        ? `a fourth suffix needs the rune Serle's Triumph and the ${goals.find((g) => g.rune).label} target the rune ${goals.find((g) => g.rune).runeItem}: two augment sockets, and this item can have one (an exceptional base with one more socket has room for both)`
        : `more suffix targets (${n.suffix}) than a Rare item of this class holds (${lim.suffix + extra})`;
    }
    if (needPool > room) return `the ${goals.find((g) => g.rune).label} target needs the rune ${goals.find((g) => g.rune).runeItem}, and the item has no free augment socket for it`;
    return null;
  }
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

  /** At the Well of Souls: an offered modifier a desecrated goal asks for, else one a base-modifier goal asks for. */
  function pickFor(goals, ctx) {
    return function (opts) {
      for (const des of [true, false]) for (const g of goals) {
        if (!!g.des !== des || g.essenceOnly) continue;
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
    const hasPrice = opts.priceOf ? (n) => opts.priceOf(n) != null : () => true;
    const matOk = materialOk(params.mat, opts.priceOf);
    const policy = makePolicy(ctx, goals, params, hasPrice, matOk);
    const skipped = new Set();
    // optional omens go when they have no price (noted in skipped) or cost more than the route's materials allow
    const usable = matOk ? (n) => hasPrice(n) && matOk(n) : hasPrice;
    const noted = matOk ? { add: (n) => { if (!hasPrice(n)) skipped.add(n); } } : skipped;
    const next = (st) => withoutUnpriced(policy(st), usable, noted, ctx.legacy);
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
      out: { dead: 0, budget: 0, unfinished: 0 }, doneAt: [], basesSum: 0, okCosts: [], okUses: new Map() };
    const metCount = (s) => { let n = 0; for (const g of goals) if (goalMet(s, g)) n++; return n; };
    // Steps are listed by where they first come in a run (averaged), so restart loops do not scramble the order.
    let seen = null;
    // uses of the run in progress: the runs that finish the item are also counted on their own (okUses, okCosts), for
    // what a finished craft takes
    let cur = null;
    const book = (k, a, n, first, hits) => {
      if (!n) return;
      acc.uses.set(k, (acc.uses.get(k) || 0) + n);
      cur.set(k, (cur.get(k) || 0) + n);
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
      for (const side of openSides(ctx, probe)) for (const e of rollPool(ctx, probe, side, floor)) {
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
      // every new base needs the runes the plan socketed on the white base again
      const runeCost = (white.runes || []).reduce((t, n) => t + ((opts.priceOf && opts.priceOf(n)) || 0), 0);
      const kT = actionKey(a, ctx), kB = actionKey(NEWBASE, ctx), cT = costOf(a), cB = costOf(NEWBASE) + runeCost;
      const tab = !ctx.needValues ? keepTable(white, a) : null;
      if (tab) {
        // Draw the number of Transmutations until one is kept (geometric), then the kept mod by weight.
        const room = Math.ceil((maxMagicSteps - run.early + 1) / 2); // Transmutations before the Magic-stage limit
        let n = tab.q >= 1 ? 1 : tab.q <= 0 ? Infinity : 1 + Math.floor(Math.log(1 - rng()) / Math.log(1 - tab.q));
        let stop = n > room ? 'limit' : null;
        if (stop) n = room;
        // with a budget: only the Transmutations (and the bases between them) the money left pays for
        let lastBase = 0;
        if (opts.budget && cT + cB > 0) {
          const afford = Math.floor((opts.budget - run.cost + cB) / (cT + cB));
          if (afford < 1) return { kept: null, stop: 'budget' };
          if (n > afford) {
            n = afford; stop = 'budget';
            if (run.cost + n * cT + n * cB <= opts.budget) lastBase = 1; // one more base, and nothing left to use on it
          }
        }
        const pool = stop ? tab.junk : tab.kept;
        let r = rng() * pool.total, e = pool.list[pool.list.length - 1];
        for (let i = 0; i < pool.list.length; i++) { r -= pool.ws[i]; if (r <= 0) { e = pool.list[i]; break; } }
        const kept = cloneState(white);
        kept.rarity = 'Magic';
        if (e) addRolled(ctx, kept, e, null, rng);
        const s0 = run.steps;
        const nb = n - 1 + lastBase;
        run.cost += n * cT + nb * cB; run.steps += n + nb; run.early += n + nb; run.bases += nb;
        book(kT, a, n, s0 + 1, !stop && metCount(kept) > 0 ? 1 : 0);
        book(kB, NEWBASE, nb, s0 + 2, 0);
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
      cur = new Map();
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
      if (ok) {
        acc.succ++; acc.doneAt.push(steps); acc.okCosts.push(cost);
        for (const [k, n] of cur) acc.okUses.set(k, (acc.okUses.get(k) || 0) + n);
      }
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
          return { key: k, names: k.split(' + '), avg: n / N, ok: acc.succ ? (acc.okUses.get(k) || 0) / acc.succ : null, cost: costCache.get(k), order: o.sum / o.n, action: o.action, hit: (acc.hits.get(k) || 0) / n };
        }).sort((a, b) => a.order - b.order);
        // the runs that finish the item: what one finished craft costs (the steps' ok uses times their prices add up to its mean)
        const okSorted = acc.okCosts.slice().sort((a, b) => a - b);
        const okQ = (x) => okSorted[Math.min(okSorted.length - 1, Math.floor(x * okSorted.length))];
        const okCost = okSorted.length ? { mean: okSorted.reduce((a, b) => a + b, 0) / okSorted.length, p10: okQ(0.1), p50: okQ(0.5), p90: okQ(0.9), n: okSorted.length } : null;
        return {
          params, trials: N, p, pLow: Math.max(0, p - 1.96 * se), pHigh: Math.min(1, p + 1.96 * se), maxSteps,
          pFail: 1 - p, failDead: acc.out.dead / N, failBudget: acc.out.budget / N, unfinished: acc.out.unfinished / N,
          meanBases: acc.basesSum / N, basesPerSuccess: p > 0 ? acc.basesSum / N / p : Infinity, baseLimit,
          // P(all goals reached within n uses) from the same runs, so per-use and whole-plan chances line up
          finishWithin: [1, 3, 5, 10, 25, 50, 100, 250, 600].map((n) => ({ n, p: acc.doneAt.filter((x) => x <= n).length / N })),
          partial: acc.partial / N, lost: acc.lost / N, meanCost: mean, okCost, p10: q(0.1), p50: q(0.5), p90: q(0.9),
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
    const total = opts.trials || 2000;
    const t0 = Date.now();
    // slices of about 50 ms: runs of plans with many goals take hundreds of uses each
    let slice = opts.slice || 25;
    while (run.done < total) {
      if (opts.cancelled && opts.cancelled()) throw new Error('cancelled');
      const s0 = Date.now();
      run.step(Math.min(slice, total - run.done));
      const took = Date.now() - s0;
      if (!opts.slice) slice = Math.max(5, Math.min(400, Math.round(slice * 50 / Math.max(took, 1))));
      const f = run.done / total;
      if (opts.onSlice) opts.onSlice(opts.timeBudgetMs ? Math.max(f, (Date.now() - t0) / opts.timeBudgetMs) : f);
      // Long plans (hundreds of uses per run) stop at the time budget once enough runs are in, and at four times the
      // budget in any case once 100 runs are in (a plan for six goals can take a second for a few runs).
      const el = Date.now() - t0;
      if (opts.timeBudgetMs && el > opts.timeBudgetMs && (run.done >= (opts.minTrials || 1000) || (el > 4 * opts.timeBudgetMs && run.done >= 100))) break;
      await tick();
    }
    return run.result();
  }

  // ---------------------------------------------------------------- profiles

  /** Does the plan keep to the player's limit of white bases per finished item? */
  const fits = (r) => !(r.baseLimit > 0 && r.basesPerSuccess > r.baseLimit);
  /**
   * A plan that needs something without a price (a bone or an essence nobody listed) counts it at 0, so its cost is not
   * known: such plans rank behind every fully priced plan in each profile, and the page marks them.
   */
  const unpriced = (r) => (r.missingPrices && r.missingPrices.length ? 1e17 : 0);
  function profileGoals(gs, slack) {
    const n = slack > 1 ? Math.min(3, Math.floor(slack)) : 1;
    return gs.map((g) => Object.assign({}, g, { eff: g.tier ? Math.max(g.tier, n) : null }));
  }
  const PROFILES = {
    cheap: {
      label: 'Cheap',
      // Every profile works on the same goals: the tiers the player asked for, or with the range the player picked
      // (slack 2: T2 or better is accepted, 3: T3 or better). The profiles differ in the materials they use (mat).
      mat: 'early',
      goals: profileGoals,
      grid: () => cross({ tier: ['base', 'greater'], sideOmens: [false, true], greaterExalt: [false], removal: ['chaos', 'erasure', 'annul'],
        start: ['alchemy', 'transmute'], restart: [true], bone: ['Preserved'], echoes: [false], lich: [false], essence: [false, true] }),
      // cheapest per success among strategies that succeed at least one run in five (else the most likely one)
      score: (r) => unpriced(r) + (!fits(r) ? 1e16 + r.basesPerSuccess : r.p >= 0.2 ? r.costPerSuccess : 1e15 * (2 - r.p)),
    },
    balanced: {
      label: 'Balanced',
      mat: 'mid',
      goals: profileGoals,
      grid: () => cross({ tier: ['greater', 'perfect'], sideOmens: [true], greaterExalt: [false, true], removal: ['chaos', 'erasure', 'whittle', 'annul'],
        start: ['transmute', 'alchemy'], restart: [true], bone: ['Preserved'], echoes: [true], lich: [true], essence: [false, true] }),
      // cost per success, weighed by the chance to finish; strategies that fail more often than not only as a last resort
      score: (r) => unpriced(r) + (!fits(r) ? 1e16 + r.basesPerSuccess : r.p >= 0.5 ? r.costPerSuccess * (1 + 0.6 * (1 - r.p)) : 1e15 * (2 - r.p)),
    },
    premium: {
      label: 'Premium',
      mat: 'end',
      goals: profileGoals,
      grid: () => cross({ tier: ['perfect', 'greater'], sideOmens: [true], greaterExalt: [false, true], removal: ['whittle', 'erasure', 'annul'],
        start: ['transmute'], restart: [true], bone: ['Ancient', 'Preserved'], echoes: [true], lich: [true], essence: [false, true] }),
      // Highest success first: cost only separates strategies within a point of success of each other (a 10x cost
      // must buy that point); near-certain (98%+) strategies compare on cost alone.
      score: (r) => unpriced(r) + (!fits(r) ? 10 + r.basesPerSuccess / 1e9 : -(Math.min(r.p, 0.98) - 0.01 * Math.log10(1 + r.costPerSuccess))),
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
  // best candidates (width 3, depth up to 8, with a time limit). Every candidate is simulated and scored by the profile.
  // The exhaustive sweep (scripts/selftest/sweep.js) measures how often this search ends on the verified best strategy.

  /** The strategy settings the beam search moves along, one at a time. */
  const SPACE = {
    exaltTier: TIERS, chaosTier: TIERS, magicTier: TIERS, sideOmens: [false, true], greaterExalt: [false, true],
    removal: ['chaos', 'erasure', 'whittle', 'annul'], start: ['transmute', 'alchemy'], restart: [true, false], pair: [false, true], slamOnly: [false, true],
    essence: [false, true], fracture: [false, true], catalyse: [false, true], flux: [true, false],
    bone: ['Gnawed', 'Preserved', 'Ancient'], echoes: [false, true], lich: [false, true], desSlam: [false, true], homog: [false, true],
  };
  const BEAM_WIDTH = 3, BEAM_DEPTH = 8;
  /** Uses a run when no strategy finishes within the usual 600 (plans for many goals on a large pool). */
  const LONG_USES = 3000;
  /**
   * The search's run lengths (trials) with their time limits, how many short runs get a long one (keepSeeds after the
   * seeds, keep per round of the beam search), the shared random seed, the default time for the beam search of one
   * profile (budgetMs), and the time the pick may spend on settings that only matter on rare paths (tailMs).
   */
  const SEARCH = { lo: 40, hi: 200, top: 800, loMs: 150, hiMs: 400, topMs: 1200, keep: 6, keepSeeds: 10, seed: 7, budgetMs: 6000, tailMs: 2500 };
  /** Settings in the order the pick tries them on rare paths: the ones that leave an expensive dead end first. */
  const TAIL_ORDER = ['pair', 'slamOnly', 'chaosTier', 'removal', 'exaltTier', 'homog', 'sideOmens', 'desSlam', 'greaterExalt', 'catalyse', 'bone', 'echoes', 'fracture', 'flux'];
  /** The order the search tries settings in: the ones that most often separate the best strategy in the exhaustive sweep first. */
  const SEARCH_ORDER = ['exaltTier', 'sideOmens', 'chaosTier', 'removal', 'essence', 'magicTier', 'slamOnly', 'start', 'pair', 'desSlam', 'bone', 'echoes',
    'catalyse', 'fracture', 'flux', 'greaterExalt', 'homog', 'restart', 'lich'];
  /** A complete strategy: the per-operation orb tiers filled from `tier`, every setting present. */
  function expandStrategy(p) {
    const t = p.tier || 'base';
    const out = Object.assign({ exaltTier: t, chaosTier: t, magicTier: t, sideOmens: false, greaterExalt: false, removal: 'chaos', start: 'transmute',
      restart: true, pair: false, slamOnly: false, essence: false, fracture: false, catalyse: false, flux: true, bone: 'Preserved', echoes: false, lich: false, desSlam: false, homog: false, runes: true }, p);
    delete out.tier;
    return out;
  }
  /** Settings that can change the result on this item and these goals. */
  function relevantKeys(st, goals) {
    const keys = st.rarity !== 'Rare' ? ['slamOnly', 'pair', 'magicTier', 'start', 'restart'] : [];
    keys.push('exaltTier', 'chaosTier', 'sideOmens', 'greaterExalt', 'removal', 'flux');
    if (goals.some((g) => (g.ess || []).length)) keys.push('essence');
    if (goals.length >= 2) keys.push('fracture');
    // catalysts can be added during the plan on rings, amulets, jewels and catalyst bases
    if (st.catTag && st.catQ > 0 || goals.some((g) => !g.des && !g.essenceOnly)) keys.push('catalyse');
    if (goals.some((g) => !g.des && !g.essenceOnly)) keys.push('homog');
    if (goals.some((g) => g.des)) keys.push('bone', 'echoes', 'lich');
    // bones for base-modifier goals (the Well of Souls offers base modifiers too)
    if (goals.some((g) => !g.des && !g.essenceOnly)) keys.push('desSlam', ...(goals.some((g) => g.des) ? [] : ['bone', 'echoes']));
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
      // From a white base an Orb of Alchemy too, alone and with a new base when the Rare item's sides fill up with
      // unwanted mods: the second is one in eight of the best routes from a white base in the exhaustive sweep, and the
      // search cannot reach it by changing one setting at a time (Alchemy alone is usually worse).
      if (st.rarity === 'Normal') for (const v of [{ start: 'alchemy', slamOnly: true }, { start: 'alchemy' }]) extra.push(Object.assign({}, p, v));
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

  /**
   * The search of one profile. Strategies are simulated with the same random numbers, and the settings a run reads are
   * recorded: two strategies that agree on every setting read make the same moves, so they share one run (a "class").
   * Runs come in three lengths (SEARCH.lo, .hi, .top trials); a class is continued, never started again, when it gets a
   * longer run. Decisions use classes with the long run; the short one only decides who gets a long run, by an
   * optimistic estimate, so a few unlucky trials do not drop a good strategy.
   */
  function makeScreen(ctx, st, pg, input) {
    const rank = (k) => { const i = SEARCH_ORDER.indexOf(k); return i < 0 ? SEARCH_ORDER.length : i; };
    const keys = relevantKeys(st, pg).sort((a, b) => rank(a) - rank(b));
    const ALL = Object.keys(SPACE).concat('runes');
    const sigOf = (p) => ALL.map((k) => p[k]).join('|');
    const hi = input.screenTrials || SEARCH.hi, lo = Math.min(SEARCH.lo, hi);
    const LEVELS = [{ n: lo, ms: SEARCH.loMs, min: Math.min(12, lo) }, { n: hi, ms: SEARCH.hiMs, min: Math.min(60, hi) }, { n: Math.max(SEARCH.top, hi), ms: SEARCH.topMs, min: hi }];
    const base = { seed: SEARCH.seed, priceOf: input.priceOf, baseCost: input.baseCost, budget: input.budget, baseLimit: input.baseLimit, maxSteps: input.maxSteps };
    const classes = [], bySig = new Map();
    function find(full, sig) {
      const hit = bySig.get(sig);
      if (hit) return hit;
      for (const c of classes) {
        if (!c.run.done) continue;
        let same = true;
        for (const k of c.reads) if (full[k] !== c.params[k]) { same = false; break; }
        if (same) { c.members.push({ sig, full }); bySig.set(sig, c); return c; }
      }
      return null;
    }
    function create(full, sig, from) {
      const reads = [], seen = new Set();
      const px = new Proxy(full, { get(t, k) { if (typeof k === 'string' && !seen.has(k)) { seen.add(k); if (k in SPACE || k === 'runes') reads.push(k); } return t[k]; } });
      const c = { params: full, sig, reads, known: 0, run: createRun(ctx, st, pg, px, base), r: null, from: from || null, members: [], split: [], level: -1, expanded: false };
      classes.push(c); bySig.set(sig, c);
      return c;
    }
    /** Continue a class to the run length of `level` (or its time limit). */
    async function raise(c, level) {
      if (c.level >= level) return c;
      const L = LEVELS[level];
      const t0 = Date.now();
      let last = t0;
      while (c.run.done < L.n) {
        if (input.cancelled && input.cancelled()) throw new Error('cancelled');
        c.run.step(Math.min(10, L.n - c.run.done));
        const now = Date.now();
        if (now - t0 > L.ms && c.run.done >= L.min) break;
        if (now - last > 30) { await tick(); last = Date.now(); }
      }
      c.level = level;
      const r = c.run.result();
      r.params = c.params; r.from = c.from;
      c.r = r;
      // a setting read for the first time splits the class: members that differ there are on their own again
      if (c.reads.length > c.known) {
        const fresh = c.reads.slice(c.known);
        c.known = c.reads.length;
        const seenSplit = new Set();
        c.members = c.members.filter((m) => {
          if (fresh.every((k) => m.full[k] === c.params[k])) return true;
          bySig.delete(m.sig);
          // one of each combination of the new settings is enough: the rest of their settings were not read
          const combo = fresh.map((k) => m.full[k]).join('|');
          if (!seenSplit.has(combo)) { seenSplit.add(combo); c.split.push(m); }
          return false;
        });
      }
      return c;
    }
    /**
     * Strategies that shared a class's run until a longer run read another setting get a run of their own (up to 8 per
     * class): the one that split off may be the better one, for example the cheaper orb tier on a path that is rare.
     */
    async function adopt(c, level) {
      for (const m of c.split.splice(0).slice(0, 8)) await ensure(m.full, level, c.from);
    }
    /** The class of a strategy with at least the run of `level`. */
    async function ensure(p, level, from) {
      const full = input.mat ? clampStrategy(expandStrategy(p), input.mat, ctx, input.priceOf) : expandStrategy(p);
      const sig = sigOf(full);
      for (;;) {
        const c = find(full, sig) || create(full, sig, from);
        await raise(c, level);
        if (bySig.get(sig) === c) return c;
      }
    }
    const optimistic = (r) => {
      const n = r.trials, pu = Math.min(1, (r.p + 1 / (2 * n) + Math.sqrt(r.p * (1 - r.p) / n + 1 / (4 * n * n))) / (1 + 1 / n));
      return Object.assign({}, r, { p: pu, costPerSuccess: r.meanCost / pu, basesPerSuccess: r.meanBases / pu });
    };
    const top = (prof, level) => classes.filter((c) => c.level >= level && c.r.p > 0).sort((a, b) => prof.score(a.r) - prof.score(b.r));
    /** Long runs for the classes that only had the short one and may (optimistically) beat `bar`; at most n of them. */
    async function promote(prof, n, bar) {
      const cands = classes.filter((c) => c.level === 0).map((c) => ({ c, s: prof.score(optimistic(c.r)) })).sort((a, b) => a.s - b.s);
      let done = 0;
      for (const { c, s } of cands) {
        if (done >= n || (bar != null && s >= bar)) break;
        if (c.level !== 0) continue;
        await raise(c, 1);
        await adopt(c, 0);
        done++;
      }
    }
    /** Seeds: every candidate with the short run, the best of them with the long one. */
    async function seed(cands, prof, onEach, keep) {
      for (const x of cands) { await ensure(x.p, 0, x.from); if (onEach) onEach(); }
      await promote(prof, keep || SEARCH.keepSeeds, null);
    }
    /**
     * Beam search: from the best classes, change one setting at a time (short runs); neighbours that may beat the
     * beam get the long run; stop when the best classes have all been expanded, at the depth limit or the time limit.
     */
    async function beam(prof, budgetMs, onProgress) {
      const t0 = Date.now();
      const left = () => budgetMs - (Date.now() - t0);
      let depth = 0;
      while (depth < BEAM_DEPTH && left() > 0) {
        const front = top(prof, 1).slice(0, BEAM_WIDTH).filter((c) => !c.expanded);
        if (!front.length) break;
        for (const c of front) {
          let whole = true;
          const from = c.from && c.from.recipe ? c.from : { search: true };
          const moves = [];
          for (const k of keys) for (const v of SPACE[k]) {
            if (c.params[k] === v) continue;
            if (left() <= 0) { whole = false; break; }
            const n = await ensure(Object.assign({}, c.params, { [k]: v }), 0, from);
            if (n !== c) moves.push({ k, v, s: prof.score(optimistic(n.r)) });
            if (onProgress) onProgress(Math.min(1, (Date.now() - t0) / budgetMs));
          }
          // two changes that each look better than the class are tried together as well (the best three, in pairs)
          const own = prof.score(optimistic(c.r));
          const good = [];
          for (const m of moves.filter((x) => x.s < own).sort((a, b) => a.s - b.s)) if (!good.some((g) => g.k === m.k)) { good.push(m); if (good.length === 3) break; }
          for (let i = 0; i < good.length; i++) for (let j = i + 1; j < good.length; j++) {
            if (left() <= 0) break;
            await ensure(Object.assign({}, c.params, { [good[i].k]: good[i].v, [good[j].k]: good[j].v }), 0, from);
          }
          if (whole) c.expanded = true;
        }
        const beamNow = top(prof, 1).slice(0, BEAM_WIDTH);
        await promote(prof, SEARCH.keep, beamNow.length >= BEAM_WIDTH ? prof.score(beamNow[beamNow.length - 1].r) : null);
        depth++;
      }
      return depth;
    }
    /** The pick: the best class by its long run; `deep` runs the best three once more, longer, and picks among those. */
    async function pick(prof, deep) {
      if (!deep) return top(prof, 1)[0] || null;
      const t0 = Date.now();
      const tail = (k) => { const i = TAIL_ORDER.indexOf(k); return i < 0 ? TAIL_ORDER.length : i; };
      // until the best three have all had the longest run
      for (let round = 0; round < 3; round++) {
        const best = top(prof, 1).slice(0, 3).filter((c) => c.level < 2);
        if (!best.length) break;
        for (const c of best) {
          const before = c.reads.length;
          await raise(c, 2);
          c.split.length = 0;
          // A setting the longest run read for the first time only matters on a rare path, but such a path can carry much
          // of the cost (a dead end that takes hundreds of Chaos Orbs): its other values get the longest run too.
          const fresh = c.reads.slice(before).filter((k) => keys.includes(k)).sort((a, b) => tail(a) - tail(b));
          for (const k of fresh) for (const v of SPACE[k]) {
            if (v === c.params[k] || Date.now() - t0 > SEARCH.tailMs) continue;
            const full = expandStrategy(Object.assign({}, c.params, { [k]: v }));
            const sig = sigOf(full);
            let d = bySig.get(sig);
            if (!d || d.sig !== sig) { // not on its own yet: it shared a shorter run with another class
              if (d) d.members = d.members.filter((m) => m.sig !== sig);
              d = create(full, sig, { search: true });
            }
            await raise(d, 2);
          }
        }
      }
      return top(prof, 2)[0] || top(prof, 1)[0] || null;
    }
    return {
      keys, ensure, seed, beam, pick, top, classes,
      count: () => bySig.size,
      results: () => classes.filter((c) => c.r).map((c) => c.r),
      same: (a, b) => { const fa = expandStrategy(a), fb = expandStrategy(b); const ca = find(fa, sigOf(fa)); return !!ca && ca === find(fb, sigOf(fb)); },
    };
  }
  /**
   * Routes the exhaustive sweep found best most often (scripts/selftest/sweep.js, reports/sweep-latest.md), as settings on
   * top of the defaults: the lists below cover about nine in ten of its verified best strategies. Several pay off only
   * together, such as an Orb of Alchemy with a new base on a miss, or an Ancient bone with Abyssal Echoes and side omens
   * for a base modifier; a search that changes one setting at a time does not reach those, so every profile starts from
   * these routes as well as from its own grid.
   */
  const ROUTES_RARE = [
    {}, { exaltTier: 'greater' }, { sideOmens: true }, { exaltTier: 'greater', sideOmens: true },
    { chaosTier: 'greater' }, { chaosTier: 'greater', sideOmens: true }, { exaltTier: 'greater', chaosTier: 'greater' }, { exaltTier: 'greater', chaosTier: 'greater', sideOmens: true },
    { exaltTier: 'greater', removal: 'annul' }, { exaltTier: 'perfect', removal: 'annul' }, { removal: 'annul', sideOmens: true, echoes: true },
    { desSlam: true, bone: 'Ancient', echoes: true, sideOmens: true },
    { desSlam: true, bone: 'Ancient', echoes: true, sideOmens: true, exaltTier: 'greater', removal: 'annul' },
    { desSlam: true, bone: 'Ancient', echoes: true, sideOmens: true, exaltTier: 'perfect', removal: 'annul' },
    { fracture: true }, { fracture: true, sideOmens: true },
  ];
  /** From a white or Magic item: how the item gets its first mods, each with the main ways to finish the Rare item. */
  const ROUTES_START = [
    { magicTier: 'greater' }, {}, { magicTier: 'perfect' }, { pair: true }, { magicTier: 'greater', pair: true },
    { magicTier: 'greater', slamOnly: true }, { magicTier: 'perfect', slamOnly: true }, { start: 'alchemy' }, { start: 'alchemy', slamOnly: true },
  ];
  const ROUTES_FINISH = [{}, { exaltTier: 'greater' }, { sideOmens: true }, { exaltTier: 'greater', sideOmens: true }];
  /**
   * Five-modifier jewel (three goals on one side, recipe c15): the first of the three is fractured before the Chaos
   * Orbs for the second (from a white base a wrong fracture means a new base), and Abyssal Echoes shows a second set
   * of three at the Well of Souls for the third.
   */
  const ROUTES_JEWEL_FIVE = [
    { fracture: true, echoes: true }, { fracture: true, echoes: true, tier: 'greater' }, { fracture: true, echoes: true, magicTier: 'greater' },
    { fracture: true, echoes: true, pair: true, magicTier: 'greater' }, { echoes: true }, { echoes: true, removal: 'annul' }, { fracture: true },
  ];
  /**
   * Four or more goals: the removals that spare what is finished (Omen of Whittling takes the lowest-level modifier,
   * the Erasure omens one side) with aimed Exalted Orbs, and bones for base modifiers. These are the routes the
   * full-target runs end on (scripts/selftest/full_targets.js); the profile grids do not all hold them.
   */
  const ROUTES_MANY = [
    { removal: 'whittle', sideOmens: true, exaltTier: 'greater', chaosTier: 'greater' }, { removal: 'whittle', sideOmens: true, exaltTier: 'perfect', chaosTier: 'perfect' },
    { removal: 'erasure', sideOmens: true, exaltTier: 'greater', chaosTier: 'greater' }, { removal: 'erasure', sideOmens: true, exaltTier: 'perfect', chaosTier: 'perfect' },
    { removal: 'annul', sideOmens: true, exaltTier: 'perfect', desSlam: true, bone: 'Ancient', echoes: true },
  ];
  /** The sweep's routes for this start item, with and without the settings that only matter on some items. */
  function verifiedRoutes(st, goals, ctx) {
    const out = [];
    if (ctx && ctx.cls === 'Jewel' && SIDES.some((s) => goals.filter((g) => g.side === s).length === 3)) out.push(...ROUTES_JEWEL_FIVE);
    else if (goals.length >= 4) {
      for (const r of ROUTES_MANY) {
        if (st.rarity === 'Rare') out.push(r);
        else for (const a of [{ magicTier: 'greater' }, { magicTier: 'greater', slamOnly: true }]) out.push(Object.assign({}, a, r));
      }
    }
    const extras = [{}];
    if (goals.some((g) => (g.ess || []).length)) extras.push({ essence: true });
    if (goals.some((g) => !g.des && /^(Fire|Cold|Lightning)Resistance$/.test(g.fam || ''))) for (const e of extras.slice()) extras.push(Object.assign({ flux: false }, e));
    const core = st.rarity === 'Rare' ? ROUTES_RARE : [].concat(...ROUTES_START.map((a) => ROUTES_FINISH.map((b) => Object.assign({}, a, b))));
    for (const r of core) for (const e of extras) {
      if (st.rarity !== 'Normal' && r.start) continue;
      out.push(Object.assign({}, r, e));
      // catalyst quality for Omen of Catalysing Exaltation, where the route exalts on a base that takes catalysts
      if (st.rarity === 'Rare' && r.exaltTier && !r.desSlam) out.push(Object.assign({ catalyse: true }, r, e));
    }
    return out;
  }

  /** The screens of finished plans, so the search that follows (improvePlan) goes on where the first plans stopped. */
  const SCREENS = new WeakMap();

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
    const wanted = (i) => !input.only || names[i] === input.only; // input.only: one profile (the page plans each in a worker)
    const total = grids.reduce((a, g, i) => a + (wanted(i) ? g.length + 1 : 0), 0);
    let done = 0;
    for (let i = 0; i < names.length; i++) {
      if (!wanted(i)) continue;
      const prof = PROFILES[names[i]];
      const pg = prof.goals(goals, input.tiers);
      const pin = profileInput(input, names[i]); // the profile's materials and what it may spend on one craft
      const infeasible = pg.map((g) => ({ g, why: goalFeasible(ctx, st, g) || goalClash(ctx, pg, g) })).filter((x) => x.why);
      if (!pg.length) { out.profiles[names[i]] = { label: prof.label, none: 'No required goals. Mark at least one target as Required.' }; done += grids[i].length + 1; continue; }
      const tooMany = slotClash(ctx, pg);
      if (tooMany) { out.profiles[names[i]] = { label: prof.label, impossible: [tooMany.charAt(0).toUpperCase() + tooMany.slice(1) + '.'] }; done += grids[i].length + 1; continue; }
      if (infeasible.length) { out.profiles[names[i]] = { label: prof.label, impossible: infeasible.map((x) => `${x.g.label}: ${x.why}`) }; done += grids[i].length + 1; continue; }
      const sc = makeScreen(ctx, st, pg, pin);
      // (a) the grid and (b) recipes whose goals overlap: the recipe's settings on top of the profile's first strategy
      const cands = grids[i].map((p) => ({ p, from: { grid: true } }))
        .concat((input.recipes || []).map((rc) => ({ p: Object.assign({}, grids[i][0], rc.params), from: { recipe: rc.id, title: rc.title } })))
        .concat(verifiedRoutes(st, pg, ctx).map((p) => ({ p, from: { sweep: true } })));
      let seeded = 0;
      await sc.seed(cands, prof, () => { if (++seeded <= grids[i].length) { done++; if (input.onProgress) input.onProgress(done / total); } });
      // (c) beam search from the best candidates (the page runs it later with improvePlan, after showing the plans)
      const budget = input.beamBudgetMs == null ? SEARCH.budgetMs : input.beamBudgetMs;
      const depth = budget > 0 ? await sc.beam(prof, budget) : 0;
      let best = await sc.pick(prof, budget > 0);
      let uses = input.maxSteps || null, screen = sc;
      if (!best && !input.maxSteps && !pin.budget) {
        // No run finished within the usual 600 uses (many goals on a large pool): the routes once more with runs of
        // 3,000 uses, a few short runs each, so that the player still gets a route and what it costs.
        uses = LONG_USES;
        screen = makeScreen(ctx, st, pg, Object.assign({}, pin, { maxSteps: LONG_USES, screenTrials: 24 }));
        await screen.seed(verifiedRoutes(st, pg, ctx).slice(0, 10).map((p) => ({ p, from: { sweep: true } })), prof, null, 3);
        best = await screen.pick(prof, false);
      }
      if (!best) {
        const r = simulate(ctx, st, pg, clampStrategy(expandStrategy(grids[i][0]), prof.mat, ctx, input.priceOf), { trials: 400, seed: 3, priceOf: input.priceOf, baseCost: input.baseCost, budget: pin.budget, baseLimit: input.baseLimit });
        out.profiles[names[i]] = { label: prof.label, noSuccess: true, fails: r.fails, spend: pin.spend, tried: r.steps.map((x) => ({ names: x.names, avg: x.avg })) };
        done++;
        continue;
      }
      const final = await simulateAsync(ctx, st, pg, best.params, {
        trials: input.trials || 4000, seed: 99, priceOf: input.priceOf, baseCost: input.baseCost, budget: pin.budget, cancelled: input.cancelled,
        baseLimit: input.baseLimit, timeBudgetMs: input.timeBudgetMs || 2500, minTrials: Math.min(input.trials || 4000, 800), maxSteps: uses || undefined,
        onSlice: (f) => input.onProgress && input.onProgress((done + f) / total),
      });
      final.label = prof.label;
      final.spend = pin.spend;
      final.profile = names[i];
      final.goals = pg;
      final.dropped = goals.filter((g) => !pg.some((x) => x.key === g.key));
      final.from = best.from;
      final.seeds = screen.top(prof, 1).slice(0, BEAM_WIDTH * 2).map((c) => ({ params: c.params, from: c.from }));
      final.search = { candidates: sc.count() + (screen === sc ? 0 : screen.count()), beamDepth: depth, recipes: (input.recipes || []).length, searched: budget > 0 };
      final.moreBases = moreBasesHint(prof, screen.results(), final);
      SCREENS.set(final, screen);
      out.profiles[names[i]] = final;
      done++;
      if (input.onProgress) input.onProgress(done / total);
      await tick();
    }
    return out;
  }

  /**
   * The search for a better strategy than a finished plan's: beam search from the plan's best candidates, then the best
   * three run once more and the best of those is the pick. Returns a better plan (final run of the new strategy) or the
   * same plan marked as searched. input as for buildPlans (beamBudgetMs: time for this profile).
   */
  async function improvePlan(input, plan, onProgress) {
    if (!plan || !plan.steps || !plan.seeds || !plan.profile) return plan;
    input = profileInput(input, plan.profile);
    const prof = PROFILES[plan.profile];
    const ctx = makeContext(input.ix, input.item, { weights: input.weights, essences: input.essences, catalystMult: input.catalystMult });
    const st = toState(ctx, input.item, input.locks);
    const long = plan.maxSteps > 600 ? plan.maxSteps : undefined; // a plan from the long runs (buildPlans) stays on them
    let sc = SCREENS.get(plan);
    if (!sc) {
      const pin = Object.assign({}, input, { mat: prof.mat });
      sc = makeScreen(ctx, st, plan.goals, long ? Object.assign({}, pin, { maxSteps: long, screenTrials: 24 }) : pin);
      for (const s0 of plan.seeds) await sc.ensure(s0.params, 1, s0.from);
    }
    const depth = await sc.beam(prof, input.beamBudgetMs == null ? SEARCH.budgetMs : input.beamBudgetMs, onProgress);
    const best = await sc.pick(prof, true);
    const search = { candidates: sc.count(), beamDepth: depth, recipes: plan.search ? plan.search.recipes : 0, searched: true };
    const keep = () => { const same = Object.assign({}, plan, { search, moreBases: moreBasesHint(prof, sc.results(), plan) }); SCREENS.set(same, sc); return same; };
    if (!best || sc.same(best.params, plan.params)) return keep();
    const final = await simulateAsync(ctx, st, plan.goals, best.params, {
      trials: input.trials || 4000, seed: 99, priceOf: input.priceOf, baseCost: input.baseCost, budget: input.budget, cancelled: input.cancelled,
      baseLimit: input.baseLimit, timeBudgetMs: input.timeBudgetMs || 2500, minTrials: Math.min(input.trials || 4000, 800), maxSteps: long,
    });
    // keep the search's pick only when the full run agrees it is better
    if (prof.score(final) >= prof.score(plan)) return keep();
    Object.assign(final, { label: plan.label, profile: plan.profile, spend: plan.spend, goals: plan.goals, dropped: plan.dropped, from: best.from, seeds: plan.seeds, search, moreBases: plan.moreBases });
    final.moreBases = moreBasesHint(prof, sc.results(), final);
    SCREENS.set(final, sc);
    return final;
  }

  /**
   * What a profile may spend on one craft: Cheap up to one Divine Orb, Balanced from 1 to 10, Premium from 10 to 100;
   * Premium with a "big pocket" has no limit. The player asked for such ranges and left the numbers to the planner
   * (6 Oct 2026). They follow what verified routes cost in the exhaustive sweep (780 routes from white bases): costs
   * spread over factors of ten. One target at T1: 54% of routes under 1 Divine Orb, 35% from 1 to 10, 2% from 10 to
   * 100, 10% above; two targets at T2: 39%, 30%, 6%, 24%. The upper end is a hard limit: a simulated craft stops when
   * its next step would pass it and counts as failed, so no finished craft costs more. The lower end only names the
   * range: a craft that finishes for less is not made dearer. Used when input.spendLimits is set (the page sets it).
   */
  const SPEND = { cheap: { hi: ['Divine Orb', 1] }, balanced: { lo: ['Divine Orb', 1], hi: ['Divine Orb', 10] }, premium: { lo: ['Divine Orb', 10], hi: ['Divine Orb', 100] } };
  function spendOf(name, input) {
    if (!input.spendLimits) return null;
    if (name === 'premium' && input.bigPocket) return { lo: null, hi: null, big: true };
    const s = SPEND[name] || {};
    const ex = (x) => { const v = x && input.priceOf ? input.priceOf(x[0]) : null; return v > 0 ? v * x[1] : null; };
    return { lo: ex(s.lo), hi: ex(s.hi) };
  }
  /** The input of one profile's runs: its materials, and its spending limit (or the player's own budget when lower). */
  function profileInput(input, name) {
    const sp = spendOf(name, input);
    const own = input.budget > 0 ? +input.budget : null;
    const hi = sp && sp.hi != null ? sp.hi : null;
    return Object.assign({}, input, { mat: PROFILES[name].mat, budget: hi != null && own != null ? Math.min(hi, own) : hi != null ? hi : own || 0, spend: sp });
  }

  /**
   * One profile from start to finish, as the page runs it: the first routes, the search for a better one, the final
   * simulation. The page runs the three profiles at the same time, each in a worker. hooks: { runs, onStage(stage) }
   * with stage 0, 1, 2. Returns { out, plan }: buildPlans' result without its profiles, and the profile's plan.
   */
  async function planProfile(input, name, hooks) {
    hooks = hooks || {};
    const at = (s) => { if (hooks.onStage) hooks.onStage(s); };
    at(0);
    const out = await buildPlans(Object.assign({}, input, { only: name, beamBudgetMs: 0, onProgress: null }));
    let plan = out.profiles[name] || null;
    delete out.profiles;
    if (plan && plan.steps && plan.steps.length) {
      at(1);
      plan = await improvePlan(Object.assign({}, input, { beamBudgetMs: SEARCH.budgetMs }), plan);
      at(2);
      const runs = hooks.runs || 20000;
      plan = await refinePlan(Object.assign({}, input, { refineBudgetMs: Math.round(runs * 0.3) }), plan, runs);
    }
    return { out, plan };
  }
  /**
   * The three finished plans work on the same goals, and a profile's materials include those of the profiles before
   * it (early, mid, end game). So a profile takes the plan it scores best among its own and the earlier ones: Balanced
   * cost weighed by the chance to finish, Premium the highest success (the cheaper one among those within half a point
   * of it). Cheap keeps its own: only early-game materials.
   */
  function rankProfiles(profiles) {
    const names = Object.keys(PROFILES);
    const usable = (p) => p && p.steps && p.steps.length && p.p > 0;
    if (names.filter((n) => usable(profiles[n])).length < 2) return profiles;
    const sig = (p) => JSON.stringify(p.goals.map((g) => [g.key, g.eff, g.minValue, g.required]));
    const first = names.map((n) => profiles[n]).find(usable);
    if (!names.every((n) => !usable(profiles[n]) || sig(profiles[n]) === sig(first))) return profiles;
    const out = Object.assign({}, profiles);
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      const own = profiles[n];
      if (!usable(own)) continue;
      const done = names.slice(0, i + 1).map((x) => profiles[x]).filter(usable);
      let best;
      if (n === 'premium') {
        const top = Math.max(...done.map((p) => p.p));
        best = done.filter((p) => p.p >= top - 0.005).sort((a, b) => a.costPerSuccess - b.costPerSuccess)[0];
      } else best = done.slice().sort((a, b) => PROFILES[n].score(a) - PROFILES[n].score(b))[0];
      out[n] = best === own ? own : Object.assign({}, best, { label: PROFILES[n].label, profile: n, spend: own.spend });
    }
    return out;
  }

  /** Re-run a finished plan with more trials (same strategy, goals and seed family). */
  async function refinePlan(input, plan, trials, onProgress) {
    if (plan.profile && PROFILES[plan.profile]) input = profileInput(input, plan.profile);
    const ctx = makeContext(input.ix, input.item, { weights: input.weights, essences: input.essences, catalystMult: input.catalystMult });
    const st = toState(ctx, input.item, input.locks);
    const r = await simulateAsync(ctx, st, plan.goals, plan.params, {
      trials: trials || 20000, seed: 1234, priceOf: input.priceOf, baseCost: input.baseCost, budget: input.budget, onSlice: onProgress, cancelled: input.cancelled,
      baseLimit: input.baseLimit, maxSteps: plan.maxSteps > 600 ? plan.maxSteps : undefined,
      timeBudgetMs: input.refineBudgetMs || 6000, minTrials: Math.min(3000, trials || 20000),
    });
    Object.assign(r, { label: plan.label, profile: plan.profile, spend: plan.spend, goals: plan.goals, dropped: plan.dropped, from: plan.from, seeds: plan.seeds, search: plan.search, moreBases: plan.moreBases });
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

  // ---------------------------------------------------------------- workbench: emulator, calculator, family chances

  const CLASS_TEXT = { Staff: 'Staves', Focus: 'Foci', Warstaff: 'Quarterstaves', 'Body Armour': 'Body Armours', Gloves: 'Gloves', Boots: 'Boots' };
  const RE_RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;
  /** A value inside (a-b): whole numbers when both ends are whole (the game publishes no value weights: uniform). */
  function rollIn(a, b, rng) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (Number.isInteger(lo) && Number.isInteger(hi)) return lo + Math.floor(rng() * (hi - lo + 1));
    return Math.round((lo + rng() * (hi - lo)) * 100) / 100;
  }
  /** Mod text lines with rolled values, Alt+Ctrl+C style "7(5-8)". */
  function rolledLines(txt, rng) {
    return txt.split('\n').map((line) => line.replace(RE_RANGE, (all, a, b) => `${rollIn(+a, +b, rng)}(${a}-${b})`));
  }

  /**
   * Emulator: one use of `action` on the item, as the game would show it. Modifiers that stay keep their lines and
   * values; new ones roll inside their range; a Divine Orb rolls every value but fractured ones again.
   * opts: {weights, essences, catalystMult, locks, rng, seed, reveal}. seed replays the same use, so the page can take
   * another of the offered Desecrated modifiers. reveal (bones): {choose: index of the three offered, reroll: true to
   * reroll the first three with Omen of Abyssal Echoes}; without a choice the highest level one is taken, as the planner
   * does. Returns {text, added: [texts], removed: [texts], seed, reveal?} or {reason}; reveal: {options: [{text, lvl,
   * tier, side, only: desecrated-only, not a base modifier}], chosen, canReroll, rerolled, first: the three before the reroll}.
   */
  function emulate(ix, item, action, opts) {
    opts = opts || {};
    const ctx = makeContext(ix, item, { weights: opts.weights, essences: opts.essences, catalystMult: opts.catalystMult });
    const st = toState(ctx, item, opts.locks);
    const src = item.mods.filter((m) => m.slot === 'prefix' || m.slot === 'suffix');
    st.mods.forEach((m, i) => { m.src = i; });
    const why = validate(ctx, st, action);
    if (why) return { reason: why };
    const seed = opts.seed != null ? opts.seed : (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const rng = opts.rng || rngFrom(seed);
    // Well of Souls: three Desecrated modifiers are offered and one is kept; Omen of Abyssal Echoes rerolls the three once
    const want = opts.reveal || {};
    let reveal = null;
    const show = (list) => list.map((e) => ({ text: ctx.kb.mods[e.id].txt.replace(/\n/g, ' / '), lvl: e.lvl, tier: e.tier || null, side: e.side, only: ctx.kb.mods[e.id].dom === 'd' }));
    const pick = action.op === 'bone' ? (list, second) => {
      if (!second && action.echoes && want.reroll) { reveal = { first: show(list) }; return null; }
      const best = list.reduce((b, e, i) => (e.lvl > list[b].lvl ? i : b), 0);
      const i = want.choose != null && want.choose >= 0 && want.choose < list.length ? want.choose : best;
      reveal = Object.assign(reveal || {}, { options: show(list), chosen: list.length ? i : null, rerolled: !!second, canReroll: !!action.echoes && !second });
      return list[i] || null;
    } : undefined;
    const r = apply(ctx, st, action, rng, pick);
    const S2 = r.state;
    if (action.op === 'chance' && S2.unpredictable) {
      const list = chanceUniques(ctx, action);
      return { reason: `Orb of Chance: the base becomes one of ${list.length} unique${list.length === 1 ? '' : 's'} (${list.slice(0, 8).join(', ')}${list.length > 8 ? ', ...' : ''})`
        + `${action.omen || action.ancients ? '' : ' or is destroyed'}. The odds per base are not in the game data or Craft of Exile, so the emulator does not pick one.` };
    }
    if (S2.unpredictable) return { reason: 'The planner does not model what this does to the item, so the emulator cannot show it.' };
    const txt = (m) => (m.id && ctx.kb.mods[m.id] ? ctx.kb.mods[m.id].txt.replace(/\n/g, ' / ') : '?');
    const outcome = OUTCOME_TEXT[S2.outcome] || null;
    if (S2.destroyed && action.op === 'extraction') {
      // the augments that come back: every socketed one but the socket-bound (the rune's text: "cannot be retrieved or replaced")
      const bound = (t) => Object.values(ctx.kb.augments || {}).some((au) => au.bound && (((au.by_class || {})[ctx.cls] || {}).txt || []).includes(t));
      const lines = (item.runes || []).filter((x) => x.kind !== 'enchant').map((x) => x.text);
      const back = lines.filter((t) => !bound(t)), lost = lines.filter(bound);
      return { destroyed: true, text: null, added: [], removed: [], seed,
        outcome: `${outcome} Back to you: ${back.length ? back.join('; ') : 'nothing'}${lost.length ? `. Lost (socket-bound): ${lost.join('; ')}` : ''}.` };
    }
    if (S2.destroyed) return { destroyed: true, text: null, added: [], removed: [], seed, outcome: outcome || 'The item was destroyed.' };
    if (S2.unique || (action.op === 'cultivation')) {
      const name = S2.unique || cultivate(ctx, rng);
      if (!name) return { reason: 'Vaal Cultivation Orb: the modifiers it replaces on a Vaal unique are not in the data.' };
      return { text: uniqueText(ctx, name, rng, S2.corrupted), added: [name], removed: [], seed, outcome: action.op === 'chance' ? `Became ${name}.` : `Replaced by ${name}, corrupted.` };
    }
    // the base after the Verisium Anvil: its Runeforged (or Runemastered) form, with that base's implicits
    const upg = S2.verisium ? (((ctx.kb.verisium_upgrades || {})[item.base] || [])[0] || null) : null;
    const baseName = upg ? upg.to : item.base;
    const out = [`Item Class: ${CLASS_TEXT[ctx.cls] || ctx.cls + 's'}`, `Rarity: ${S2.rarity}`];
    if (S2.rarity === 'Rare' || S2.rarity === 'Unique') out.push(item.name || 'Emulated Item');
    out.push(baseName, '--------');
    // catalyst quality names its modifier type, "Quality (Life Modifiers)"
    const qType = S2.catTag ? `${S2.catTag === 'defences' ? 'Defence' : S2.catTag[0].toUpperCase() + S2.catTag.slice(1)} Modifiers` : item.qualityType;
    if (S2.quality) out.push(`Quality${qType ? ` (${qType})` : ''}: +${S2.quality}% (augmented)`, '--------');
    const sockets = (item.sockets || []).length + (S2.sockets || 0);
    if (sockets) out.push(`Sockets: ${Array(sockets).fill('S').join(' ')}`, '--------');
    out.push(`Item Level: ${item.ilvl == null ? 82 : item.ilvl}`);
    const pre = [];
    for (const x of item.runes || []) pre.push(`${x.text} (${x.kind === 'enchant' ? 'enchant' : 'rune'})`);
    for (const name of S2.runes || []) for (const t of (((ctx.kb.augments[name] || {}).by_class || {})[ctx.cls] || {}).txt || []) pre.push(`${t} (rune)`);
    if (S2.aldur) pre.push(`Forged by the ${Object.keys(ALDUR_ELEMENT).find((k) => ALDUR_ELEMENT[k] === S2.aldur).replace(' of Aldur', '')} of Aldur (rune)`);
    if (upg) for (const l of (ctx.kb.bases[baseName] || {}).imp || []) for (const t of l.split('\n')) pre.push(`${t} (implicit)`);
    for (const x of item.implicits || []) {
      if (x.corruption) pre.push('{ Corruption Implicit Modifier }', x.text);
      else if (!upg) pre.push(`${x.text} (implicit)`);
    }
    for (const id of S2.enchants || []) pre.push('{ Corruption Implicit Modifier }', ...rolledLines(ctx.kb.mods[id].txt, rng));
    if (pre.length) out.push('--------', ...pre);
    const reroll = action.op === 'divine';
    const lines = [];
    const order = r.state.mods.slice().sort((a, b) => (a.side === b.side ? 0 : a.side === 'prefix' ? -1 : 1));
    for (const m of order) {
      const km = m.id && ctx.kb.mods[m.id];
      const kind = (m.frac ? 'Fractured ' : '') + (m.des ? 'Desecrated ' : '') + (m.crafted ? 'Crafted ' : '') + (m.side === 'prefix' ? 'Prefix' : 'Suffix');
      lines.push(`{ ${kind} Modifier ""${m.tier ? ` (Tier: ${m.tier})` : ''} }`);
      const keep = m.src != null && src[m.src] && src[m.src].modId === m.id && !(reroll && !m.frac);
      lines.push(...(keep || !km ? src[m.src].text.split('\n') : rolledLines(km.txt, rng)));
    }
    // unique and other lines the planner does not track stay as they were
    for (const m of item.mods.filter((x) => x.slot !== 'prefix' && x.slot !== 'suffix')) lines.push(...m.text.split('\n'));
    if (lines.length) out.push('--------', ...lines);
    if (S2.mods.some((m) => m.frac)) out.push('--------', 'Fractured Item');
    if (S2.corrupted) out.push('--------', 'Corrupted');
    if (S2.sanctified) out.push('--------', 'Sanctified');
    const extra = [outcome, S2.enchantUpgraded ? 'The Corruption Enchantment is upgraded; the upgraded value is not in the data, so its line stays as it was.' : null,
      (S2.enchants || []).length ? 'Added Corruption Enchantment: ' + S2.enchants.map((id) => txt({ id })).join('; ') : null].filter(Boolean);
    return Object.assign({ text: out.join('\n'), added: r.added.map(txt), removed: r.removed.map(txt), seed }, reveal ? { reveal } : {}, extra.length ? { outcome: extra.join(' ') } : {});
  }
  const OUTCOME_TEXT = {
    nothing: 'Vaal Orb: nothing changed; the item is corrupted.', reroll: 'Vaal Orb: 1-3 modifiers randomised.', enchant: 'Vaal Orb: a Corruption Enchantment was added.',
    socket: 'Vaal Orb: +1 socket (wands and staves: quality).', addremove: 'Vaal Orb: a modifier added or removed, ignoring the limits.',
    destroyed: "Architect's Orb destroyed the item.", extracted: 'Orb of Extraction destroyed the item.', socketed: "Artificer's Orb: +1 augment socket.", enchant2: "Architect's Orb: a second Corruption Enchantment was added.",
  };
  /** Vaal Cultivation Orb on a non-Vaal unique: another unique of the same class (game text); a Vaal unique: null (not modelled). */
  function cultivate(ctx, rng) {
    if (/^Vaal /.test(ctx.item.name || '')) return null;
    const U = ctx.kb.uniques || {};
    const list = Object.keys(U).filter((n) => U[n].cls === ctx.cls && n !== ctx.item.name);
    return list.length ? list[Math.floor(rng() * list.length)] : null;
  }
  /** Item text of a unique from kb.uniques (the variant on this base when there is one), values rolled inside their ranges. */
  function uniqueText(ctx, name, rng, corrupted) {
    const u = ctx.kb.uniques[name];
    const v = u.variants.find((x) => x.base === ctx.item.base) || u.variants[0];
    const out = [`Item Class: ${CLASS_TEXT[ctx.cls] || ctx.cls + 's'}`, 'Rarity: Unique', name, v.base || u.trade_base || ctx.item.base, '--------',
      `Item Level: ${ctx.item.ilvl == null ? 82 : ctx.item.ilvl}`];
    const plain = (l) => l.replace(RE_RANGE, (all, lo, hi) => String(rollIn(+lo, +hi, rng)));
    if ((v.implicit || []).length) out.push('--------', ...v.implicit.map((l) => `${plain(l)} (implicit)`));
    const lines = [];
    for (const m of v.mods) lines.push(...rolledLines(m.txt, rng).map((l) => l.replace(/(-?\d+(?:\.\d+)?)\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, '$1')));
    if (lines.length) out.push('--------', ...lines);
    if (corrupted) out.push('--------', 'Corrupted');
    return out.join('\n');
  }

  /**
   * Calculator: the chance that one use of `action` leaves the item meeting every requirement group.
   * groups: [{type: 'and'|'or'|'not'|'count', n, reqs: [{fam, side, minTier, des}]}]; a requirement is met by a mod of
   * that family and side at that tier or better. Returns {p, before, n} or {reason}.
   */
  function chanceOf(ix, item, action, groups, opts) {
    opts = opts || {};
    const ctx = makeContext(ix, item, { weights: opts.weights, essences: opts.essences, catalystMult: opts.catalystMult });
    const st = toState(ctx, item, opts.locks);
    const why = validate(ctx, st, action);
    if (why) return { reason: why };
    const ok = (s) => groupsMet(ctx, s, groups);
    const rng = rngFrom(opts.seed || 777);
    const N = opts.n || 10000;
    let k = 0, unpredictable = false;
    for (let i = 0; i < N; i++) {
      const r = apply(ctx, st, action, rng);
      if (r.state.unpredictable) unpredictable = true;
      if (ok(r.state)) k++;
    }
    if (unpredictable) return { reason: 'The planner does not model what this does to the item.' };
    return { p: k / N, before: ok(st), n: N };
  }

  /**
   * Requirement groups (calculator, strategy rules and goal) on a state. A requirement is a modifier {fam, side,
   * minTier, des}, or {kind: 'open', side} (a free slot on that side), or {kind: 'rarity', value}.
   */
  function reqMet(ctx, s, q) {
    if (q.kind === 'open') return open(ctx, s, q.side) > 0;
    if (q.kind === 'rarity') return s.rarity === q.value;
    return s.mods.some((m) => m.fam === q.fam && m.side === q.side && !!m.des === !!q.des && (!q.minTier || (m.tier && m.tier <= q.minTier)));
  }
  function groupsMet(ctx, s, groups) {
    return groups.every((g) => {
      const c = g.reqs.filter((q) => reqMet(ctx, s, q)).length;
      return g.type === 'or' ? c > 0 : g.type === 'not' ? c === 0 : g.type === 'count' ? c >= (g.n || 1) : c === g.reqs.length;
    });
  }

  /**
   * Strategy simulator: the player's own steps, run many times (as Craft of Exile's simulator). A run starts from the
   * item and uses the steps in order. After each use it ends when the item meets the goal; otherwise the step's rules are
   * checked in order and the first that holds says where to go, else the step's `otherwise` (default 'next').
   *   strategy: {steps: [{action, rules: [{groups, go}], otherwise, unusable, max}], goal: groups}
   *   go: 'next' | 'repeat' (this step again) | 'restart' (the item as it was, paying opts.baseCost) | 'stop' | {step: i}
   *   unusable: where to go when the step's currency cannot be used on the item (default 'next'); max: uses of the step
   *   per run, after which a 'repeat' goes on to the next step.
   * A run also ends past the last step, at opts.maxUses uses (default 2000) or at opts.budget. At the Well of Souls it
   * keeps an offered Desecrated modifier the goal or a rule asks for; with none, Omen of Abyssal Echoes rerolls the
   * three, and then the highest level one is kept.
   * opts: {trials (2000), seed, maxUses, budget, priceOf(name) -> ex|null, baseCost, weights, essences, catalystMult, locks}.
   * Returns {trials, p, pLow, pHigh, meanCost, costPerSuccess, p50, p90, meanUses, meanRestarts, steps: [{i, names, avg,
   * cost}], ends: [{reason, share}], missingPrices} or {reason}.
   */
  function runStrategy(ix, item, strategy, opts) {
    const run = strategyRun(ix, item, strategy, opts || {});
    if (run.reason) return run;
    run.step((opts && opts.trials) || 2000);
    return run.result();
  }
  /**
   * The same, yielding to the page between slices of runs. opts.onProgress(fraction); opts.timeBudgetMs stops early once
   * opts.minTrials runs are in (the result says how many ran); opts.cancelled() -> true stops with an error.
   */
  async function runStrategyAsync(ix, item, strategy, opts) {
    opts = opts || {};
    const run = strategyRun(ix, item, strategy, opts);
    if (run.reason) return run;
    const total = opts.trials || 2000, t0 = Date.now();
    while (run.done < total) {
      if (opts.cancelled && opts.cancelled()) throw new Error('cancelled');
      const s0 = Date.now();
      let k = 0;
      while (run.done < total && Date.now() - s0 < 40) { run.step(Math.min(10, total - run.done)); k++; }
      if (run.reason) return run;
      if (opts.onProgress) opts.onProgress(opts.timeBudgetMs ? Math.max(run.done / total, (Date.now() - t0) / opts.timeBudgetMs) : run.done / total);
      if (opts.timeBudgetMs && Date.now() - t0 > opts.timeBudgetMs && run.done >= (opts.minTrials || 200)) break;
      await tick();
    }
    return run.result();
  }
  function strategyRun(ix, item, strategy, opts) {
    const steps = strategy.steps || [];
    const goal = (strategy.goal || []).filter((g) => g.reqs && g.reqs.length);
    if (!steps.length) return { reason: 'Add at least one step.' };
    const ctx = makeContext(ix, item, { weights: opts.weights, essences: opts.essences, catalystMult: opts.catalystMult });
    const st0 = toState(ctx, item, opts.locks);
    const rng = rngFrom(opts.seed || 2024);
    const maxUses = opts.maxUses || 2000;
    const missing = new Set();
    const costs = steps.map((s) => actionNames(s.action, ctx).reduce((t, n) => {
      const p = opts.priceOf ? opts.priceOf(n) : null;
      if (p == null) { missing.add(n); return t; }
      return t + p;
    }, 0));
    // the Desecrated modifiers the goal or a rule asks for: kept when offered
    const wanted = new Set();
    const want = (groups) => { for (const g of groups || []) if (g.type !== 'not') for (const q of g.reqs) if (q.des && q.fam) wanted.add(q.side + '|' + q.fam); };
    want(goal);
    for (const s of steps) for (const r of s.rules || []) want(r.groups);
    const pick = (list) => list.find((e) => wanted.has(e.side + '|' + e.fam)) || null;
    const target = (go, i) => (go && typeof go === 'object' ? go.step : go === 'repeat' ? i : go === 'restart' ? 'restart' : go === 'stop' ? 'stop' : i + 1);
    const uses = steps.map(() => 0), endCount = new Map(), runCosts = [];
    let succ = 0, useSum = 0, restartSum = 0, N = 0, bad = null;
    const end = (why) => endCount.set(why, (endCount.get(why) || 0) + 1);
    function one() {
      let s = st0, i = 0, cost = 0, n = 0, restarts = 0, why = null, loops = 0;
      const per = steps.map(() => 0);
      for (;;) {
        if (goal.length && groupsMet(ctx, s, goal)) { why = 'goal met'; break; }
        if (++loops > 4 * maxUses + steps.length) { why = 'the steps go round without using anything'; break; }
        if (i >= steps.length) { why = 'past the last step'; break; }
        if (n >= maxUses) { why = `${maxUses} uses without the goal`; break; }
        const step = steps[i];
        const err = validate(ctx, s, step.action);
        let go;
        if (err) {
          go = step.unusable || 'next';
          if (go === 'stop') { why = `step ${i + 1} could not be used: ${err}`; break; }
          if (go === 'repeat') go = 'next'; // nothing would change
        } else {
          if (opts.budget && cost + costs[i] > opts.budget) { why = 'over budget'; break; }
          const r = apply(ctx, s, step.action, rng, pick);
          if (r.state.unpredictable) { bad = `The planner does not model what step ${i + 1} does to the item.`; return; }
          if (r.state.destroyed) { s = r.state; cost += costs[i]; n++; per[i]++; uses[i]++; why = `the item was destroyed at step ${i + 1}`; break; }
          s = r.state; cost += costs[i]; n++; per[i]++; uses[i]++;
          if (goal.length && groupsMet(ctx, s, goal)) { why = 'goal met'; break; }
          const rule = (step.rules || []).find((r2) => r2.groups && r2.groups.length && groupsMet(ctx, s, r2.groups.filter((g) => g.reqs.length)));
          go = rule ? rule.go : step.otherwise || 'next';
          if (go === 'repeat' && step.max && per[i] >= step.max) go = 'next';
        }
        const to = target(go, i);
        if (to === 'stop') { why = `stopped at step ${i + 1}`; break; }
        if (to === 'restart') {
          if (opts.budget && cost + (opts.baseCost || 0) > opts.budget) { why = 'over budget'; break; }
          s = st0; cost += opts.baseCost || 0; restarts++; i = 0; per.fill(0);
          continue;
        }
        i = Math.max(0, to);
      }
      const ok = why === 'goal met' || (!goal.length && why === 'past the last step');
      if (ok) succ++;
      end(ok ? 'goal met' : why);
      runCosts.push(cost); useSum += n; restartSum += restarts; N++;
    }
    return {
      step(k) { for (let t = 0; t < k && !bad; t++) one(); },
      get done() { return N; },
      get reason() { return bad; },
      result() {
        if (bad) return { reason: bad };
        const costs2 = runCosts.slice().sort((a, b) => a - b);
        const q = (p) => costs2[Math.min(N - 1, Math.floor(p * N))];
        const meanCost = costs2.reduce((a, b) => a + b, 0) / N;
        const p = succ / N, se = Math.sqrt(Math.max(p * (1 - p), 1e-9) / N);
        return {
          trials: N, maxUses, p, pLow: Math.max(0, p - 1.96 * se), pHigh: Math.min(1, p + 1.96 * se), meanCost, costPerSuccess: p > 0 ? meanCost / p : Infinity,
          p50: q(0.5), p90: q(0.9), meanUses: useSum / N, meanRestarts: restartSum / N, missingPrices: [...missing],
          steps: steps.map((x, i) => ({ i, names: actionNames(x.action, ctx), avg: uses[i] / N, cost: costs[i] })),
          ends: [...endCount.entries()].sort((a, b) => b[1] - a[1]).map(([reason, k]) => ({ reason, share: k / N })),
        };
      },
    };
  }

  /**
   * Stat picker: the share of each natural family among the next random modifier, from the item as it is (groups taken,
   * tags its mods add, item level, weights). exclude: the mod id a slot would replace. Returns
   * {side: {prefix: {fam: share}, suffix: {...}}, any: {'prefix|fam': share}, des: {prefix: {...}, suffix: {...}}, weighted}.
   */
  function familyChances(ix, item, opts) {
    opts = opts || {};
    const ctx = makeContext(ix, item, { weights: opts.weights });
    const st = toState(ctx, item);
    if (opts.exclude) { const i = st.mods.findIndex((m) => m.id === opts.exclude); if (i >= 0) st.mods.splice(i, 1); }
    const taken = groupsOf(st);
    const added = E.addedTags(ctx.kb, st.mods.map((m) => m.id));
    const out = { side: { prefix: {}, suffix: {} }, any: {}, des: { prefix: {}, suffix: {} }, weighted: !!opts.weights };
    const tot = { prefix: 0, suffix: 0 };
    for (const side of SIDES) for (const e of rollPool(ctx, st, side, 0)) {
      if (e.grp.some((g) => taken.has(g))) continue;
      if (added && !e.rune && E.tagBlocked(ctx.kb.mods[e.id], ctx.baseTags, added)) continue;
      out.side[side][e.fam] = (out.side[side][e.fam] || 0) + e.w;
      tot[side] += e.w;
    }
    for (const side of SIDES) for (const f of Object.keys(out.side[side])) {
      out.any[side + '|' + f] = out.side[side][f] / ((tot.prefix + tot.suffix) || 1);
      out.side[side][f] /= tot[side] || 1;
    }
    // desecrated options: equal weights (none published); the share among the side's desecrated families
    for (const side of SIDES) {
      const list = desPoolFor(ctx, side, 0, null).filter((e) => !e.grp.some((g) => taken.has(g)));
      for (const e of list) out.des[side][e.fam] = (out.des[side][e.fam] || 0) + 1 / list.length;
    }
    return out;
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
    const matOk = materialOk(params && params.mat, priceOf);
    const a0 = makePolicy(ctx, goals, params, undefined, matOk)(st);
    const has = priceOf ? (n) => priceOf(n) != null : () => true;
    const a = withoutUnpriced(a0, matOk ? (n) => has(n) && matOk(n) : has, null, ctx.legacy);
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
    const inGame = (n) => !ctx.legacy.has(n);
    const openP = open(ctx, st, 'prefix'), openS = open(ctx, st, 'suffix');
    // Normal
    add('transmute', 'Make Magic', { op: 'transmute' }, { cur: ORB.transmute.slice(), planned: true });
    add('alchemy', 'Make Rare with 4 mods', { op: 'alchemy' }, { cur: ['Orb of Alchemy'], omens: [OMEN.alchemy.prefix, OMEN.alchemy.suffix].filter(inGame), planned: true });
    add('chance', 'Gamble for a Unique', { op: 'chance' }, { cur: ['Orb of Chance'], omens: ['Omen of Chance', 'Omen of the Ancients'] });
    // Magic
    add('augment', 'Add a mod', { op: 'augment' }, { cur: ORB.augment.slice(), planned: true });
    add('regal', 'Make Rare, add a mod', { op: 'regal' }, { cur: ORB.regal.slice(), omens: [OMEN.coronation.prefix, OMEN.coronation.suffix].filter(inGame), planned: true });
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
      omens: R === 'Rare' ? [OMEN.annul.prefix, OMEN.annul.suffix, OMEN.greaterAnnul].filter(inGame).concat(des ? [OMEN.light] : []) : [], planned: true });
    add('essence_replace', 'Swap a mod for an essence mod', R === 'Rare' ? { op: 'pessence' } : 'Perfect and special essences need a Rare item.',
      { omens: [OMEN.crystal.prefix, OMEN.crystal.suffix], cat: 'Essences', match: { include: '^Perfect Essence|' + SPECIAL_ESS }, label: 'Perfect and special essences', planned: true });
    if (ctx.bone) {
      const bone = ctx.bone, bones = [], blocked = [];
      // jewels: only the Preserved Cranium is in the game
      if (boneExists(ctx, 'Gnawed')) { if (ctx.ilvl <= 64) bones.push('Gnawed ' + bone); else blocked.push({ name: 'Gnawed ' + bone, reason: 'item level 64 or lower only' }); }
      bones.push('Preserved ' + bone);
      // game text: Minimum Modifier Level 40, and such currency cannot be used below that item level
      if (boneExists(ctx, 'Ancient')) { if (ctx.ilvl >= 40) bones.push('Ancient ' + bone); else blocked.push({ name: 'Ancient ' + bone, reason: 'item level 40 or higher only' }); }
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
    add('artificer', 'Add an augment socket', { op: 'artificer' }, { cur: ["Artificer's Orb"], note: 'Game text: "Adds an Augment Socket to a Martial Weapon, wand, staff or Armour". Up to the base\'s usual number (2 on body armour and two-handed weapons, else 1). An exceptional base can drop with one more; past the usual number only a Vaal Orb adds a socket.' });
    add('extraction', 'Destroy the item for its runes', { op: 'extraction' }, { cur: ['Orb of Extraction'],
      note: 'Game text: "Destroys an Equipment item, returning any non Socket-Bound Augments socketed in it". Socket-bound ones are lost.' });
    // Runes that change crafting (game data augments): the plans socket one when a goal needs it
    const RUNE_NOTES = {
      "Astrid's Creativity": 'The item can then have 2 crafted modifiers (essences, alloys, liquid emotions); the planner counts it once the rune is on the item. Once socketed it cannot be taken out, but another augment can replace it.',
      "Serle's Triumph": 'It raises the suffix limit and the modifier total by 1. Once socketed it cannot be taken out or replaced.',
    };
    for (const [rune, why] of Object.entries(RUNE_NOTES)) {
      const r = ix.kb.augments && ix.kb.augments[rune];
      if (!r || !r.by_class[cls]) continue;
      add('rune_rule', `${r.by_class[cls].txt.join(' ')} (${rune})`, { op: 'rune_rule', item: rune }, { cur: [rune], note: 'Socket it in an augment socket. ' + why, planned: true });
    }
    // Runes that open a modifier pool: socket-bound, one per item; the plans socket one for a target from its pool
    for (const p of runePoolsFor(ctx)) {
      add('rune_rule', `Can roll ${p.label} modifiers (${p.rune})`, { op: 'rune_rule', item: p.rune }, { cur: [p.rune], planned: true,
        note: `Socket it in an augment socket: ${p.mods.size} more modifiers can roll on the item (pick them as targets). Once socketed it cannot be taken out or replaced; one such rune per item.` });
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
    // (the Verisium Anvil is outside this tool, user 28 Sept 2026)
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
    emulate, chanceOf, familyChances, runStrategy, runStrategyAsync, groupsMet, revealOptions, desSides, DES_OPTIONS,
    planProfile, rankProfiles, setTick, clampStrategy, materialOk,
    expandStrategy, recipeParams, relevantKeys, SPACE, SEARCH, improvePlan, searchOf: (plan) => SCREENS.get(plan), legacyItems, suffixRune, runeBlocks,
  };
});
