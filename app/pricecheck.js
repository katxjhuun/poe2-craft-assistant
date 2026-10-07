/* PoE2 Craft Assistant — price check: the official trade search for an item, built the way Exiled Exchange 2 builds it.
 *
 * Adapted from Exiled Exchange 2 (https://github.com/Kvan7/Exiled-Exchange-2, MIT License, Copyright (c) 2020 Alexander
 * Drozdov and contributors): renderer/src/web/price-check/filters (create-presets, create-item-filters,
 * create-stat-filters, pseudo rules, item properties) and trade/pathofexile-trade.ts (createTradeRequest). Ported to
 * the assistant's parsed items and knowledge base (stat_index holds Exiled Exchange 2's trade stat ids).
 *
 * Kept as in Exiled Exchange 2: the presets (a "pseudo" search for finished Magic/Rare/Unique items and a "base item"
 * search for Normal items and crafting bases), the item filters (category or base type, rarity, item level, corrupted,
 * mirrored, sanctified, fractured, rune sockets, quality, required level), the pseudo totals (resistances, attributes,
 * life, mana, energy shield, movement speed), armour and weapon properties at 20% quality, the +-10% search range
 * (a share of the roll range on uniques), the "# Empty Modifier" count, and the trade request body.
 * Adapted for this tool: the page cannot fetch the trade site (and GGG's terms forbid automated searches), so the
 * search opens on the official site; Corruption Enchantments are on by default (twice-corrupted items are priced by
 * them); a sanctified item searches sanctified ones; unrevealed Desecrated modifiers count as such.
 * Runs in the browser (window.PoE2PriceCheck) and in Node (module.exports) for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PoE2PriceCheck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // item class -> trade category (CATEGORY_TO_TRADE_ID)
  const CATEGORY = {
    Amulet: 'accessory.amulet', Belt: 'accessory.belt', Ring: 'accessory.ring', 'Body Armour': 'armour.chest', Boots: 'armour.boots',
    Gloves: 'armour.gloves', Helmet: 'armour.helmet', Quiver: 'armour.quiver', Shield: 'armour.shield', Focus: 'armour.focus', Buckler: 'armour.buckler',
    Bow: 'weapon.bow', Claw: 'weapon.claw', Dagger: 'weapon.dagger', 'One Hand Axe': 'weapon.oneaxe', 'One Hand Mace': 'weapon.onemace',
    'One Hand Sword': 'weapon.onesword', Sceptre: 'weapon.sceptre', Staff: 'weapon.staff', 'Two Hand Axe': 'weapon.twoaxe',
    'Two Hand Mace': 'weapon.twomace', 'Two Hand Sword': 'weapon.twosword', Wand: 'weapon.wand', Warstaff: 'weapon.warstaff',
    Crossbow: 'weapon.crossbow', Spear: 'weapon.spear', Flail: 'weapon.flail', Talisman: 'weapon.talisman', Jewel: 'jewel',
  };
  const ARMOUR = new Set(['Body Armour', 'Boots', 'Gloves', 'Helmet', 'Shield', 'Focus', 'Buckler']);
  const WEAPON = new Set(['Bow', 'Claw', 'Dagger', 'One Hand Axe', 'One Hand Mace', 'One Hand Sword', 'Sceptre', 'Staff', 'Two Hand Axe',
    'Two Hand Mace', 'Two Hand Sword', 'Wand', 'Warstaff', 'Crossbow', 'Spear', 'Flail', 'Talisman']);
  // isPdpsImportant
  const PDPS_IMPORTANT = new Set(['One Hand Axe', 'Two Hand Axe', 'One Hand Sword', 'Two Hand Sword', 'One Hand Mace', 'Two Hand Mace', 'Bow',
    'Warstaff', 'Crossbow', 'Spear', 'Flail']);
  const SEARCH_RANGE = 10; // Exiled Exchange 2's default "searchStatRange" (%)

  // ------------------------------------------------------------------ util.ts
  function decimalPlaces(value, dp) {
    if (typeof dp === 'number') return dp;
    if (!dp || Math.abs(value) >= 10) return 0;
    return Math.abs(value) < 2.3 ? 2 : 1;
  }
  function roundRoll(value, dp) { const r = Math.pow(10, decimalPlaces(value, dp)); return Math.trunc(value * r) / r; }
  function percentRoll(value, p, method, dp) {
    const res = value + (Math.abs(value) * p) / 100;
    const r = Math.pow(10, decimalPlaces(value, dp));
    return method((res + Number.EPSILON) * r) / r;
  }
  function percentRollDelta(value, delta, p, method, dp) {
    const res = value + (delta * p) / 100;
    const r = Math.pow(10, decimalPlaces(value, dp));
    return method((res + Number.EPSILON) * r) / r;
  }
  function maxUsefulItemLevel(cls) { return cls === 'Wand' || cls === 'Staff' ? 81 : cls === 'Jewel' ? 1 : 82; }

  // ------------------------------------------------------------------ the item's stats (statsByType)
  const NUM = /-?\d+(?:\.\d+)?/g;
  /**
   * Every stat line of the item with its trade ids, value and roll range, summed by (stat, type) as Exiled Exchange 2's
   * sumStatsByModType does. type: explicit | implicit | enchant (Corruption Enchantments) | rune | fractured |
   * desecrated | crafted; unrevealed Desecrated modifiers are counted apart (veiled).
   */
  function statsOf(ix, E, item) {
    const out = new Map();
    const add = (line, type, rangeLine, meta) => {
      const st = ix.statByNorm.get(E.normalize(line));
      if (!st || !st.ids) return false;
      // signed values ("-10% to Cold Resistance" counts against a resistance total); a "reduced" line shows a positive
      // number for a negative stat, as the trade site stores it
      const nums = E.lineValues(line);
      // "Adds # to #": the average of the two, like the trade site
      const value = nums.length === 2 && /# to #/.test(st.r) ? (nums[0] + nums[1]) / 2 : nums.length ? nums[0] : null;
      // without a known range the search range is not clamped
      let min = value == null ? null : value - Math.abs(value), max = value == null ? null : value + Math.abs(value);
      if (rangeLine) {
        const rs = E.templateRanges(rangeLine).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
        const flip = /\breduced\b/.test(line) !== /\breduced\b/.test(rangeLine); // "(-25-25)% reduced" on poe2db, "12% increased" in game
        if (rs.length === 2 && /# to #/.test(st.r)) { min = (rs[0][0] + rs[1][0]) / 2; max = (rs[0][1] + rs[1][1]) / 2; }
        else if (rs.length) { min = flip ? -rs[0][1] : rs[0][0]; max = flip ? -rs[0][0] : rs[0][1]; }
        if (value != null && rs.length && (value < min || value > max) && rs[0][0] >= 0) { min = Math.min(min, value); max = Math.max(max, value); }
      }
      const key = st.r + '|' + type;
      const cur = out.get(key);
      if (cur) {
        if (value != null) { cur.value = (cur.value || 0) + value; cur.min = (cur.min || 0) + min; cur.max = (cur.max || 0) + max; }
        cur.sources.push(meta);
      } else out.set(key, { ref: st.r, ids: st.ids, type, value, min, max, text: line, sources: [meta], dp: /\./.test(line) });
      return true;
    };
    const kbLine = (id, i) => (id && ix.kb.mods[id] ? (ix.kb.mods[id].txt || '').split('\n')[i] : null);
    for (const m of item.mods || []) {
      if (m.unrevealed) continue;
      const type = m.slot === 'prefix' || m.slot === 'suffix'
        ? (m.fractured ? 'fractured' : m.desecrated ? 'desecrated' : m.crafted ? 'crafted' : 'explicit') : 'explicit';
      const lines = m.text.split('\n');
      lines.forEach((l, i) => add(l, type, m.uniqueLine ? m.uniqueLine : kbLine(m.modId, i), { slot: m.slot, tier: m.tier, modId: m.modId }));
    }
    // implicit ranges from the base's implicit text (kb.bases[base].imp), or the unique's own implicit
    const u = item.rarity === 'Unique' && ix.kb.uniques && ix.kb.uniques[item.name];
    const impLines = [].concat(...((ix.kb.bases[item.base] || {}).imp || []).map((l) => l.split('\n')),
      ...(u ? u.variants.map((v) => v.implicit || []) : []));
    const impRange = (t) => impLines.find((l) => E.normalize(l) === E.normalize(t)) || null;
    // Corruption Enchantment ranges from the knowledge base's corruption modifiers (dom 'c')
    const encRange = (t) => { const id = (ix.corruptionMods || []).find((x) => E.normalize(ix.kb.mods[x].txt) === E.normalize(t)); return id ? ix.kb.mods[id].txt : null; };
    for (const x of item.implicits || []) add(x.text, x.corruption ? 'enchant' : 'implicit', x.corruption ? encRange(x.text) : impRange(x.text), { corruption: !!x.corruption });
    for (const r of item.runes || []) add(r.text, r.kind === 'enchant' ? 'enchant' : 'rune', null, { rune: true });
    return [...out.values()];
  }

  // ------------------------------------------------------------------ pseudo rules (pseudo/index.ts)
  const RES = [
    ['+#% to all Elemental Resistances', ['fire', 'cold', 'lightning']], ['+#% to Fire Resistance', ['fire']], ['+#% to Cold Resistance', ['cold']],
    ['+#% to Lightning Resistance', ['lightning']], ['+#% to Fire and Lightning Resistances', ['fire', 'lightning']],
    ['+#% to Fire and Cold Resistances', ['fire', 'cold']], ['+#% to Cold and Lightning Resistances', ['cold', 'lightning']],
  ];
  const CHAOS_RES = ['+#% to Chaos Resistance', '+#% to Fire and Chaos Resistances', '+#% to Cold and Chaos Resistances', '+#% to Lightning and Chaos Resistances', '+#% to All Resistances'];
  const ATTR = [['+# to all Attributes', ['str', 'dex', 'int']], ['+# to Strength', ['str']], ['+# to Dexterity', ['dex']], ['+# to Intelligence', ['int']],
    ['+# to Strength and Intelligence', ['str', 'int']], ['+# to Strength and Dexterity', ['str', 'dex']], ['+# to Dexterity and Intelligence', ['dex', 'int']]];
  function pseudoRules() {
    return [
      { pseudo: '#% total Elemental Resistance', disabled: false, stats: RES.map(([r, el]) => ({ ref: r, multiplier: el.length })) },
      ...['fire', 'cold', 'lightning'].map((el) => ({ pseudo: `#% total to ${el[0].toUpperCase() + el.slice(1)} Resistance`, group: 'to_x_ele_res',
        stats: RES.filter(([, e]) => e.includes(el)).map(([r]) => ({ ref: r })) })),
      { pseudo: '#% total to Chaos Resistance', chaos: true, stats: CHAOS_RES.map((r) => ({ ref: r })) },
      { pseudo: '+# total to all Attributes', group: 'to_all_attrs', stats: [{ ref: '+# to all Attributes' }] },
      ...[['str', 'Strength'], ['dex', 'Dexterity'], ['int', 'Intelligence']].map(([a, n]) => ({ pseudo: `+# total to ${n}`, group: 'to_x_attr',
        stats: ATTR.filter(([, at]) => at.includes(a)).map(([r]) => ({ ref: r })) })),
      { pseudo: '+# total maximum Life', disabled: false, stats: [{ ref: '+# to maximum Life', required: true }, ...ATTR.filter(([, at]) => at.includes('str')).map(([r]) => ({ ref: r, multiplier: 2 }))] },
      { pseudo: '+# total maximum Mana', stats: [{ ref: '+# to maximum Mana', required: true }, ...ATTR.filter(([, at]) => at.includes('int')).map(([r]) => ({ ref: r, multiplier: 2 }))] },
      { pseudo: '#% total increased maximum Energy Shield', stats: [{ ref: '#% increased maximum Energy Shield' }] },
      { pseudo: '+# total maximum Energy Shield', stats: [{ ref: '+# to maximum Energy Shield' }] },
      { pseudo: '#% increased Movement Speed', movement: true, stats: [{ ref: '#% increased Movement Speed' }] },
    ];
  }

  // ------------------------------------------------------------------ filters of one stat (calculatedStatToFilter)
  function statFilter(calc, item, percent, tag, disabled) {
    const f = { id: calc.ids[calc.type === 'pseudo' ? 'pseudo' : calc.type] || calc.ids.explicit || null, ids: calc.ids, ref: calc.ref, type: calc.type,
      text: calc.text, tag: tag || calc.type, disabled: disabled !== false, hidden: null, roll: null, sources: calc.sources || [] };
    if (!f.id && calc.type !== 'veiled') return null;
    if (calc.value == null) return f;
    const unique = item.rarity === 'Unique';
    let p = percent;
    // a perfect roll on a unique, or a fixed value: search that exact value
    if (unique && calc.max > calc.min && calc.value >= calc.max) p = 0;
    const dp = !!calc.dp;
    const bounds = { min: percentRoll(calc.min, -0, Math.floor, dp), max: percentRoll(calc.max, 0, Math.ceil, dp) };
    const def = unique
      ? { min: percentRollDelta(calc.value, calc.max - calc.min, -p, Math.floor, dp), max: percentRollDelta(calc.value, calc.max - calc.min, +p, Math.ceil, dp) }
      : { min: percentRoll(calc.value, -p, Math.floor, dp), max: percentRoll(calc.value, +p, Math.ceil, dp) };
    def.min = Math.max(def.min, bounds.min);
    def.max = Math.min(def.max, bounds.max);
    f.roll = { value: roundRoll(calc.value, dp), min: def.min, max: undefined, default: def, bounds: unique && calc.min !== calc.max ? bounds : undefined };
    // hideNotVariableStat: a fixed line of a unique is not a search filter
    if (unique && (f.tag === 'explicit' || f.tag === 'implicit') && !f.roll.bounds) { f.hidden = 'fixed'; f.roll.min = undefined; }
    return f;
  }

  /** Pseudo totals from the item's stats (filterPseudo); the stats they cover leave the list. */
  function applyPseudo(ix, E, stats, item, percent) {
    const refOf = (t) => { const s = ix.statByNorm.get(E.normalize(t)); return s ? s.r : t; };
    const out = [], byGroup = new Map(), used = new Set();
    for (const rule of pseudoRules()) {
      const want = rule.stats.map((x) => Object.assign({}, x, { ref: refOf(x.ref) }));
      let value = 0, min = 0, max = 0, any = false, srcTypes = new Set();
      const sources = [];
      for (const s of stats) {
        const w = want.find((x) => x.ref === s.ref);
        if (!w || s.value == null) continue;
        any = true; srcTypes.add(s.type); sources.push(...(s.sources || []));
        const k = w.multiplier || 1;
        value += s.value * k; min += s.min * k; max += s.max * k;
      }
      if (!any) continue;
      if (want.some((x) => x.required && !stats.some((s) => s.ref === x.ref))) continue;
      const pseudo = ix.statByNorm.get(E.normalize(rule.pseudo));
      if (!pseudo) continue;
      const f = statFilter({ ref: pseudo.r, ids: pseudo.ids, type: 'pseudo', value, min, max, text: rule.pseudo.replace('#', roundRoll(value, false)), sources }, item, percent, 'pseudo', rule.disabled === false ? false : true);
      if (rule.chaos) f.disabled = srcTypes.size === 1 && srcTypes.has('rune'); // chaos from a rune alone: hidden in Exiled Exchange 2
      if (rule.movement) f.disabled = srcTypes.size === 1 && srcTypes.has('implicit');
      for (const x of want) used.add(x.ref);
      out.push(f);
      if (rule.group) (byGroup.get(rule.group) || byGroup.set(rule.group, []).get(rule.group)).push(f);
    }
    // to_x_ele_res: keep only the highest single resistance (hidden, off)
    const res = byGroup.get('to_x_ele_res');
    let drop = new Set();
    if (res) {
      res.sort((a, b) => b.roll.value - a.roll.value);
      const top = res[0] && res[1] && res[0].roll.value === res[1].roll.value ? null : res[0];
      if (top) top.hidden = 'single resistance';
      drop = new Set(res.filter((f) => f !== top));
    }
    // to_x_attr: with all three the same and "to all" present, the three go
    const attrs = byGroup.get('to_x_attr');
    if (attrs && attrs.length === 3 && byGroup.get('to_all_attrs') && attrs.every((f) => f.roll.value === attrs[0].roll.value)) for (const f of attrs) drop.add(f);
    return { filters: out.filter((f) => !drop.has(f)), rest: stats.filter((s) => !used.has(s.ref)) };
  }

  // ------------------------------------------------------------------ armour and weapon properties (item-property.ts)
  function propLines(item) { return (item.props || []).flat(); }
  function propNum(item, re) { for (const l of propLines(item)) { const m = re.exec(l); if (m) return m; } return null; }
  /**
   * A defence at 20% quality. Quality multiplies the value the item shows, on top of its local "increased" modifiers:
   * ten listed body armours (7 Oct 2026, 0.5.5), nine of them with such a modifier, all carry the trade site's own
   * quality-20 value (extended.ar, .ev, .es) within 1 of shown x 1.2, and up to 8% above the value with quality
   * added to the modifiers (Exiled Exchange 2's propAt20Quality, which this file followed before).
   */
  function defenceAtQ20(value, item) {
    const q = item.quality || 0;
    return q >= 20 || !value ? value : Math.round(value * 120 / (100 + q));
  }
  /** A physical damage value at 20% quality (propAt20Quality): the local "increased" mods stay. */
  function atQ20(value, item, incrRe) {
    const q = item.quality || 0;
    if (q >= 20 || !value) return value;
    let incr = 0;
    for (const m of item.mods || []) for (const l of m.text.split('\n')) { const k = incrRe.exec(l); if (k) incr += +k[1]; }
    return Math.round(value * (100 + incr + 20) / (100 + incr + q));
  }
  function propFilters(item, cls, percent) {
    const out = [];
    const prop = (ref, tradeId, value, disabled, dp, hidden) => {
      if (!value) return;
      // the roll bounds of a property are not known here (Exiled Exchange 2 derives them from the mods): +-100% keeps the search range free
      const f = statFilter({ ref, ids: { pseudo: [tradeId] }, type: 'pseudo', value, min: 0, max: value * 2, text: ref.replace('#', value), dp }, item, percent, 'property', disabled);
      f.prop = tradeId; if (hidden) f.hidden = hidden;
      out.push(f);
    };
    if (ARMOUR.has(cls)) {
      const ar = propNum(item, /^Armour:\s*(\d+)/), ev = propNum(item, /^Evasion Rating:\s*(\d+)/), es = propNum(item, /^Energy Shield:\s*(\d+)/);
      if (ar) prop('Armour: #', 'item.armour', defenceAtQ20(+ar[1], item), false);
      if (ev) prop('Evasion Rating: #', 'item.evasion_rating', defenceAtQ20(+ev[1], item), false);
      if (es) prop('Energy Shield: #', 'item.energy_shield', defenceAtQ20(+es[1], item), false);
      const bl = propNum(item, /^Block chance:\s*(\d+)%/i); if (bl) prop('Block: #%', 'item.block', +bl[1], true);
      const rw = propNum(item, /^Runic Ward:\s*(\d+)/i); if (rw) prop('Runic Ward: #', 'item.runic_ward', +rw[1], true);
    }
    if (WEAPON.has(cls)) {
      const ph = propNum(item, /^Physical Damage:\s*(\d+)-(\d+)/);
      const aps = propNum(item, /^Attacks per Second:\s*([\d.]+)/);
      const crit = propNum(item, /^Critical Hit Chance:\s*([\d.]+)%/);
      let ele = 0;
      for (const l of propLines(item)) {
        const m = /^(?:Elemental|Fire|Cold|Lightning) Damage:\s*(.+)$/.exec(l);
        if (m) for (const r of m[1].matchAll(/(\d+)-(\d+)/g)) ele += (+r[1] + +r[2]) / 2;
      }
      const speed = aps ? +aps[1] : 0;
      const phys = ph ? atQ20((+ph[1] + +ph[2]) / 2, item, /^(\d+)% increased Physical Damage$/) : 0;
      const pdps = Math.round(phys * speed * 10) / 10, edps = Math.round(ele * speed * 10) / 10, dps = Math.round((pdps + edps) * 10) / 10;
      if (ele) {
        prop('Total DPS: #', 'item.total_dps', dps, false);
        prop('Elemental DPS: #', 'item.elemental_dps', edps, edps / dps < 0.15, false, edps / dps < 0.15 ? 'little elemental' : null);
      }
      if (ph) prop('Physical DPS: #', 'item.physical_dps', pdps, !PDPS_IMPORTANT.has(cls) || pdps / (dps || pdps) < 0.67, false, pdps / (dps || pdps) < 0.67 ? 'little physical' : null);
      if (aps) prop('Attacks per Second: #', 'item.aps', speed, true, true);
      if (crit) prop('Critical Hit Chance: #%', 'item.crit', +crit[1], true, true);
      const rl = propNum(item, /^Reload Time:\s*([\d.]+)/); if (rl) prop('Reload Time: #', 'item.reload_time', +rl[1], true, true);
      const sp = propNum(item, /^Spirit:\s*(\d+)/); if (sp) prop('Spirit: #', 'item.spirit', +sp[1], false);
    }
    return out;
  }

  // ------------------------------------------------------------------ presets (create-presets.ts)
  /**
   * The searches Exiled Exchange 2 offers for this item: a "pseudo" one for Magic, Rare and Unique items (finished
   * items), and a "base item" one (exact) for Normal items and Magic/Rare items worth something as crafting bases.
   * Returns {active, presets: [{id, label, filters, stats}]}.
   */
  function createPresets(ix, E, item, opts) {
    opts = opts || {};
    const base = item.base && ix.kb.bases[item.base];
    const cls = base ? base.cls : null;
    const exact = () => ({ id: 'exact', label: 'Base item', filters: createFilters(ix, item, cls, true), stats: exactStats(ix, E, item, cls) });
    if (item.rarity === 'Normal' || item.flags && item.flags.unidentified) return { active: 'exact', presets: [exact()] };
    const pseudo = { id: 'pseudo', label: 'Pseudo', filters: createFilters(ix, item, cls, false), stats: pseudoStats(ix, E, item, cls) };
    if (likelyFinished(item) || !hasCraftingValue(item, cls)) return { active: 'pseudo', presets: [pseudo] };
    return { active: 'pseudo', presets: [pseudo, exact()] };
  }
  function modifiable(item) { const f = item.flags || {}; return !f.corrupted && !f.mirrored && !f.sanctified; }
  function likelyFinished(item) {
    return item.rarity === 'Unique' || (item.mods || []).some((m) => m.crafted) || (item.quality === 20 && !item.qualityType) || !modifiable(item);
  }
  function hasCraftingValue(item, cls) {
    return modifiable(item) && ((item.mods || []).some((m) => m.fractured) || (cls === 'Jewel' && item.rarity === 'Magic')
      || (item.ilvl || 0) >= maxUsefulItemLevel(cls) - 15 || (item.quality || 0) > 20);
  }

  /** Item filters (createFilters). exact: the "base item" preset. */
  function createFilters(ix, item, cls, exact) {
    const f = { status: 'securable', search: {}, category: null };
    const flags = item.flags || {};
    if (item.rarity === 'Unique' && item.name) {
      f.search = { name: item.name, type: (ix.kb.uniques && ix.kb.uniques[item.name] && ix.kb.uniques[item.name].trade_base) || item.base };
    } else {
      f.search = { type: item.base };
      if (cls && CATEGORY[cls]) f.category = { id: CATEGORY[cls], disabled: exact };
    }
    if ((item.quality || 0) > 20 && (ARMOUR.has(cls) || WEAPON.has(cls))) f.quality = { value: item.quality, disabled: item.rarity === 'Rare' };
    const sockets = (item.sockets || []).length;
    // augment sockets a base normally has (two-handed weapons and body armour 2, other gear 1): more is "exceptional"
    const normalSockets = !cls ? null : cls === 'Body Armour' || /^Two Hand|^(Bow|Staff|Warstaff|Crossbow|Talisman)$/.test(cls) ? 2 : ARMOUR.has(cls) || WEAPON.has(cls) ? 1 : 0;
    if (sockets && (normalSockets == null || sockets > normalSockets || flags.corrupted)) f.runeSockets = { value: sockets, disabled: normalSockets != null && sockets <= normalSockets && !flags.corrupted };
    const adornedJewel = item.rarity === 'Magic' && cls === 'Jewel';
    if (['Normal', 'Magic', 'Rare', 'Unique'].includes(item.rarity)) f.corrupted = { value: !!flags.corrupted, exact: adornedJewel };
    if (adornedJewel) f.rarity = 'magic';
    else if (item.rarity === 'Normal' && exact) f.rarity = 'normal';
    else if (item.rarity === 'Magic' && exact) f.rarity = 'magic';
    else if (['Normal', 'Magic', 'Rare'].includes(item.rarity)) f.rarity = 'nonunique';
    if (flags.mirrored) f.mirrored = { disabled: false };
    if (flags.sanctified) f.sanctified = { disabled: false };
    if (!(item.mods || []).some((m) => m.fractured) && exact) f.fractured = { value: false };
    if (item.ilvl && item.rarity !== 'Unique' && maxUsefulItemLevel(cls) !== 1) f.itemLevel = { value: Math.min(item.ilvl, maxUsefulItemLevel(cls)), disabled: !exact };
    const req = propNum(item, /^Requires:.*?Level\s*(\d+)/);
    if (req && item.rarity === 'Rare' && !exact && +req[1] <= 75 && (item.ilvl || 0) <= 75) f.requiresLevel = { value: +req[1], disabled: true };
    if ((item.mods || []).some((m) => m.unrevealed)) f.veiled = { count: item.mods.filter((m) => m.unrevealed).length, disabled: item.rarity !== 'Unique' };
    return f;
  }

  /** Stats of the pseudo preset (initUiModFilters): properties, pseudo totals, then the rest. */
  function pseudoStats(ix, E, item, cls) {
    const percent = item.rarity === 'Normal' ? 100 : SEARCH_RANGE;
    let stats = statsOf(ix, E, item);
    // fractured, desecrated and crafted modifiers search as explicit ones when the trade site has that explicit stat
    const merged = new Map();
    for (const s of stats) {
      const t = (s.type === 'fractured' || s.type === 'desecrated' || s.type === 'crafted') && s.ids.explicit ? 'explicit' : s.type;
      const k = s.ref + '|' + t;
      const cur = merged.get(k);
      if (cur && s.value != null) { cur.value += s.value; cur.min += s.min; cur.max += s.max; cur.sources.push(...s.sources); }
      else merged.set(k, Object.assign({}, s, { type: t, sources: s.sources.slice() }));
    }
    stats = [...merged.values()];
    const out = propFilters(item, cls, percent);
    // properties take their stats out (removeUsedStats), then pseudo totals (not on uniques with sockets)
    let rest = stats;
    if (out.length) rest = rest.filter((s) => !PROP_STATS.test(s.ref));
    if (item.rarity !== 'Unique' || !(item.sockets || []).length) {
      const p = applyPseudo(ix, E, rest, item, percent);
      out.push(...p.filters);
      rest = p.rest;
    }
    for (const s of rest) {
      const f = statFilter(s, item, percent, s.type === 'enchant' ? 'corrupted' : s.type, true);
      if (!f) continue;
      if (s.type === 'enchant' && (item.flags || {}).corrupted) f.disabled = false; // adapted: Corruption Enchantments price twice-corrupted items
      out.push(f);
    }
    finalTweaks(item, cls, out);
    return out;
  }
  const PROP_STATS = /^(#% increased Armour|#% increased Evasion Rating|#% increased Energy Shield|# to Armour|# to Evasion Rating|# to maximum Energy Shield|#% increased Armour and|#% increased Evasion and|#% increased Armour, Evasion|#% increased Physical Damage|Adds # to # (Physical|Fire|Cold|Lightning) Damage|#% increased Attack Speed|#% to Critical Hit Chance|#% increased Spirit|#% increased Block chance)/;

  /** Stats of the base item preset (createExactStatFilters). */
  function exactStats(ix, E, item, cls) {
    const range = Math.min(2, SEARCH_RANGE);
    const keep = new Set(['pseudo', 'fractured', 'desecrated', 'crafted', 'enchant', 'rune']);
    const fractured = (item.mods || []).some((m) => m.fractured);
    if (!fractured) keep.add('implicit');
    const explicit = (item.mods || []).filter((m) => m.slot === 'prefix' || m.slot === 'suffix').length;
    if (item.rarity === 'Magic' || (item.rarity === 'Rare' && explicit < 5)) keep.add('explicit');
    const out = [];
    for (const s of statsOf(ix, E, item)) {
      if (!keep.has(s.type)) continue;
      const f = statFilter(s, item, range, s.type === 'enchant' ? 'corrupted' : s.type, true);
      if (!f) continue;
      if (fractured && s.type === 'explicit') { out.push(f); continue; }
      // explicit: on when a tier 1 or 2 modifier gives it; the rest on
      f.disabled = s.type === 'explicit' ? !s.sources.some((x) => x.tier != null && x.tier <= 2) : false;
      out.push(f);
    }
    const empty = emptyModifier(item, cls);
    if (empty) out.push(empty);
    return out;
  }

  /** "# Empty Modifier" (showHasEmptyModifier): how many prefixes, suffixes or affixes are free on a Magic or Rare item. */
  function emptyModifier(item, cls, hidden) {
    if (!modifiable(item) || (item.rarity !== 'Rare' && item.rarity !== 'Magic')) return null;
    const mods = (item.mods || []).filter((m) => m.slot === 'prefix' || m.slot === 'suffix');
    const p = mods.filter((m) => m.slot === 'prefix').length, s = mods.filter((m) => m.slot === 'suffix').length, total = p + s;
    const base = item.rarity === 'Magic' ? 1 : cls === 'Jewel' ? 2 : 3;
    const d = item.slotDelta || { prefix: 0, suffix: 0 };
    const maxP = Math.max(0, base + (d.prefix || 0)), maxS = Math.max(0, base + (d.suffix || 0));
    if (total === maxP + maxS || total === 0) return null;
    const kind = s === maxS ? 'prefix' : p === maxP ? 'suffix' : 'any';
    const n = kind === 'prefix' ? maxP - p : kind === 'suffix' ? maxS - s : maxP + maxS - total;
    const ref = kind === 'prefix' ? '# Empty Prefix Modifiers' : kind === 'suffix' ? '# Empty Suffix Modifiers' : '# Empty Modifiers';
    return { id: 'item.has_empty_modifier', ref, emptyKind: kind, text: ref.replace('#', n), tag: 'pseudo', disabled: !!hidden || !hidden && false,
      hidden: hidden ? 'empty modifier' : null, roll: { value: n, min: n, max: undefined, default: { min: n, max: n } } };
  }

  function finalTweaks(item, cls, filters) {
    const e = emptyModifier(item, cls, true);
    if (e) { e.disabled = true; filters.push(e); }
    // uniques: with three lines or fewer to choose, all on
    if (item.rarity === 'Unique' && filters.filter((f) => !f.hidden).length <= 3) for (const f of filters) if (!f.hidden) f.disabled = false;
  }

  // ------------------------------------------------------------------ the trade request (createTradeRequest)
  function setPath(obj, path, value) {
    if (value === undefined) return;
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] || (o[keys[i]] = {});
    o[keys[keys.length - 1]] = value;
  }
  // stat refs of "# Empty ..." count stats (TOTAL_MODS_TEXT) -> trade pseudo ids, resolved through the stat index
  function tradeRequest(ix, E, preset, item) {
    const { filters, stats } = preset;
    const body = { query: { status: { option: filters.status || 'securable' }, stats: [{ type: 'and', filters: [] }], filters: {} }, sort: { price: 'asc' } };
    const q = body.query;
    if (filters.search.name) q.name = filters.search.name;
    if (filters.category && !filters.category.disabled) setPath(q.filters, 'type_filters.filters.category.option', filters.category.id);
    else if (filters.search.type) q.type = filters.search.type;
    if (filters.search.name && filters.search.type) q.type = filters.search.type;
    if (filters.rarity) setPath(q.filters, 'type_filters.filters.rarity.option', filters.rarity);
    if (filters.itemLevel && !filters.itemLevel.disabled) setPath(q.filters, 'type_filters.filters.ilvl.min', filters.itemLevel.value);
    if (filters.requiresLevel && !filters.requiresLevel.disabled) setPath(q.filters, 'req_filters.filters.lvl.max', filters.requiresLevel.value);
    if (filters.quality && !filters.quality.disabled) setPath(q.filters, 'type_filters.filters.quality.min', filters.quality.value);
    if (filters.runeSockets && !filters.runeSockets.disabled) setPath(q.filters, 'equipment_filters.filters.rune_sockets.min', filters.runeSockets.value);
    const sanct = filters.sanctified && !filters.sanctified.disabled;
    if (filters.corrupted && (filters.corrupted.value === false || filters.corrupted.exact || filters.corrupted.force != null) && !sanct) {
      setPath(q.filters, 'misc_filters.filters.corrupted.option', String(filters.corrupted.force != null ? filters.corrupted.force : filters.corrupted.value));
    }
    if (filters.fractured && filters.fractured.value === false) setPath(q.filters, 'misc_filters.filters.fractured_item.option', 'false');
    if (filters.mirrored) { if (filters.mirrored.disabled) setPath(q.filters, 'misc_filters.filters.mirrored.option', 'false'); }
    else if (['Normal', 'Magic', 'Rare'].includes(item.rarity)) setPath(q.filters, 'misc_filters.filters.mirrored.option', 'false');
    if (filters.sanctified || (filters.corrupted && filters.corrupted.value === true && !filters.corrupted.exact)) {
      if (filters.sanctified && filters.sanctified.disabled) setPath(q.filters, 'misc_filters.filters.sanctified.option', 'false');
      else if (sanct) setPath(q.filters, 'misc_filters.filters.sanctified.option', 'true'); // adapted: sanctified items against sanctified ones
    } else if (['Normal', 'Magic', 'Rare'].includes(item.rarity)) setPath(q.filters, 'misc_filters.filters.sanctified.option', 'false');
    if (filters.veiled && !filters.veiled.disabled) setPath(q.filters, 'misc_filters.filters.veiled.option', 'true');
    const range = (roll) => (roll ? { min: typeof roll.min === 'number' ? roll.min : undefined, max: typeof roll.max === 'number' ? roll.max : undefined } : {});
    const PROP_PATH = { 'item.armour': 'ar', 'item.evasion_rating': 'ev', 'item.energy_shield': 'es', 'item.runic_ward': 'ward', 'item.block': 'block',
      'item.total_dps': 'dps', 'item.physical_dps': 'pdps', 'item.elemental_dps': 'edps', 'item.crit': 'crit', 'item.aps': 'aps', 'item.spirit': 'spirit', 'item.reload_time': 'reload_time' };
    for (const s of stats) {
      if (s.id === 'item.has_empty_modifier') {
        const st = ix.statByNorm.get(E.normalize(s.ref));
        if (st && st.ids && st.ids.pseudo) q.stats.push({ type: 'count', value: { min: 1, max: 1 }, disabled: s.disabled, filters: [{ id: st.ids.pseudo[0], value: range(s.roll), disabled: s.disabled }] });
        continue;
      }
      if (s.disabled) continue;
      if (s.prop) {
        const r = range(s.roll);
        setPath(q.filters, `equipment_filters.filters.${PROP_PATH[s.prop]}.min`, r.min);
        setPath(q.filters, `equipment_filters.filters.${PROP_PATH[s.prop]}.max`, r.max);
        continue;
      }
      const ids = s.ids[s.type === 'corrupted' ? 'enchant' : s.type] || (s.type === 'pseudo' ? s.ids.pseudo : null) || s.ids.explicit || [];
      if (!ids.length) continue;
      if (ids.length === 1) q.stats[0].filters.push({ id: ids[0], value: range(s.roll), disabled: false });
      else q.stats.push({ type: 'count', value: { min: 1 }, disabled: false, filters: ids.map((id) => ({ id, value: range(s.roll), disabled: false })) });
    }
    if (filters.veiled && !filters.veiled.disabled) {
      const st = ix.statByNorm.get(E.normalize('# Unrevealed Modifiers'));
      if (st && st.ids && st.ids.pseudo) q.stats[0].filters.push({ id: st.ids.pseudo[0], value: { min: filters.veiled.count }, disabled: false });
    }
    return body;
  }
  function tradeUrl(league, body) {
    return `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(league || 'Standard')}?q=${encodeURIComponent(JSON.stringify(body))}`;
  }

  // ------------------------------------------------------------------ listed items (the trade site's own records)
  /** A text of the trade site without its link marks: "[Resistances|Fire Resistance]" -> "Fire Resistance", "[Quality]" -> "Quality". */
  function plain(t) { return String(t == null ? '' : t).replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2').replace(/\[([^\]|]*)\]/g, '$1'); }
  const RARITY = ['Normal', 'Magic', 'Rare', 'Unique'];
  /**
   * A listed item (the "item" of a listing) in the shape the rest of this file reads: modifiers, implicits, runes and
   * properties as the game's own lines. The same totals can then be worked out for it as for the player's item.
   */
  function listedItem(raw) {
    raw = raw || {};
    // a line is a record {description, domain, mods: [{name, tier: "P7", level, magnitudes}]}; older answers gave plain text
    const list = (k) => (Array.isArray(raw[k]) ? raw[k] : []).map((m) => {
      if (m && typeof m === 'object') return { text: plain(m.description).trim(), domain: m.domain || '', from: Array.isArray(m.mods) ? m.mods : [] };
      return { text: plain(m).trim(), domain: '', from: [] };
    }).filter((m) => m.text);
    const line = (p) => {
      const name = plain(p && p.name), vals = (p && Array.isArray(p.values) ? p.values : []).map((v) => plain(Array.isArray(v) ? v[0] : v));
      if (!name) return vals.join(', ');
      if (/\{\d\}/.test(name)) return name.replace(/\{(\d)\}/g, (m, i) => (vals[+i] != null ? vals[+i] : ''));
      if (!vals.length) return name;
      return p.displayMode === 1 ? `${vals.join(', ')} ${name}` : `${name}: ${vals.join(', ')}`;
    };
    const props = (Array.isArray(raw.properties) ? raw.properties : []).map(line).filter(Boolean);
    const req = (Array.isArray(raw.requirements) ? raw.requirements : []).map((p) => {
      const name = plain(p && p.name), vals = (p && Array.isArray(p.values) ? p.values : []).map((v) => plain(Array.isArray(v) ? v[0] : v));
      return p && p.displayMode === 1 ? `${vals.join(' ')} ${name}` : `${name} ${vals.join(' ')}`;
    }).filter((x) => x.trim());
    const mods = [];
    const add = (k, kind) => {
      for (const m of list(k)) {
        // "P7": a prefix of tier 7; a line two modifiers add up to names both ("P5 P5")
        const tiers = m.from.map((x) => String(x.tier || '')).filter((t) => /^[PS]\d+$/.test(t));
        const k2 = ['fractured', 'desecrated', 'crafted'].includes(m.domain) ? m.domain : kind;
        const slot = tiers.length ? (tiers[0][0] === 'P' ? 'prefix' : 'suffix') : k2 === 'explicit' ? 'explicit' : 'prefix';
        const o = { slot, text: m.text, kind: k2, tier: tiers.length ? +tiers[0].slice(1) : null, tiers, names: m.from.map((x) => x.name).filter(Boolean) };
        if (k2 !== 'explicit') o[k2] = true; // the totals take fractured, desecrated and crafted lines apart
        mods.push(o);
      }
    };
    add('fracturedMods', 'fractured');
    add('explicitMods', 'explicit');
    add('desecratedMods', 'desecrated');
    add('craftedMods', 'crafted');
    const q = /^Quality[^:]*:\s*\+?(\d+)%/.exec(props.find((l) => /^Quality/.test(l)) || '');
    const rarity = RARITY.includes(raw.rarity) ? raw.rarity : RARITY[raw.frameType] || 'Normal';
    return {
      name: rarity === 'Rare' || rarity === 'Unique' ? plain(raw.name) : '', base: plain(raw.baseType || raw.typeLine), typeLine: plain(raw.typeLine || raw.baseType),
      rarity, ilvl: raw.ilvl || null, props: [props], requires: req.length ? 'Requires: ' + req.join(', ') : '', quality: q ? +q[1] : 0,
      sockets: Array.isArray(raw.sockets) ? raw.sockets.map(() => 'S') : [],
      mods,
      implicits: list('implicitMods').map((m) => ({ text: m.text })).concat(list('enchantMods').map((m) => ({ text: m.text, corruption: true }))),
      runes: list('runeMods').map((m) => ({ text: m.text, kind: 'rune' })),
      skills: (Array.isArray(raw.grantedSkills) ? raw.grantedSkills : []).map(line).filter(Boolean),
      flags: { corrupted: !!raw.corrupted, sanctified: !!raw.sanctified, mirrored: !!(raw.mirrored || raw.duplicated), unidentified: raw.identified === false },
    };
  }
  /**
   * The lines of the player's search against a listed item: for every line the listed item's value of the same
   * stat (null when it has none) and the difference. stats: the search's lines; mine: the player's item; theirs: a
   * listedItem. The same rules give both sides their totals, so "total maximum Life" means the same on both.
   */
  function compare(ix, E, stats, mine, theirs) {
    const base = mine && mine.base && ix.kb.bases[mine.base];
    const cls = base ? base.cls : null;
    let other = [];
    // a unique with sockets gets no totals here (see pseudoStats): both sides by the player's item
    try { other = pseudoStats(ix, E, Object.assign({}, theirs, { sockets: (mine && mine.sockets) || [], rarity: (mine && mine.rarity) || theirs.rarity, name: (mine && mine.name) || theirs.name }), cls); } catch (e) { other = []; }
    const by = new Map(other.map((f) => [f.ref + '|' + f.tag, f]));
    const rows = [];
    for (const st of stats || []) {
      if (st.hidden === 'fixed' || st.id === 'item.has_empty_modifier' || !st.roll || typeof st.roll.value !== 'number') continue;
      const o = by.get(st.ref + '|' + st.tag);
      const v = o && o.roll && typeof o.roll.value === 'number' ? o.roll.value : null;
      const d = v == null ? null : Math.round((v - st.roll.value) * 100) / 100;
      rows.push({ ref: st.ref, tag: st.tag, text: st.text, mine: st.roll.value, theirs: v, delta: d, used: !st.disabled, hidden: !!st.hidden });
    }
    // a difference counts from one whole step (a hundredth on lines with decimals)
    const step = (r) => (/\./.test(String(r.mine)) || /\./.test(String(r.theirs)) ? 0.01 : 1);
    const shown = rows.filter((r) => !r.hidden || r.used);
    return {
      rows,
      up: shown.filter((r) => r.delta != null && r.delta >= step(r)).length,
      down: shown.filter((r) => (r.delta != null && r.delta <= -step(r)) || (r.theirs == null && !r.used)).length,
      known: shown.filter((r) => r.theirs != null).length,
    };
  }

  return { createPresets, createFilters, statsOf, pseudoStats, exactStats, tradeRequest, tradeUrl, CATEGORY, percentRoll, percentRollDelta, SEARCH_RANGE, plain, listedItem, compare };
});
