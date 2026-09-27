/* Self-test part 1: random walks through the rule engine with invariant checks after every step, a statistical
 * check of roll frequencies against the weights, and a parser round trip of the walked items. */
'use strict';
const { E, P, load, weightsFor, essencesFor, rng, renderItem } = require('./lib.js');

const TIERS = ['base', 'greater', 'perfect'];
const SIDES = [null, 'prefix', 'suffix'];
const LICH = [null, 'Kurgal', 'Amanamu', 'Ulaman'];

/** Every action variant the walk may try; validate() filters the ones that apply. */
function candidates(ctx, st, r) {
  const A = [];
  for (const tier of TIERS) {
    A.push({ op: 'transmute', tier }, { op: 'augment', tier });
    for (const side of SIDES) {
      A.push({ op: 'regal', tier, side }, { op: 'exalt', tier, side }, { op: 'chaos', tier, side });
      A.push({ op: 'exalt', tier, side, greater: true });
    }
    A.push({ op: 'chaos', tier, whittle: true });
    if (st.catQ > 0) A.push({ op: 'exalt', tier, catalyse: true });
  }
  for (const side of SIDES) A.push({ op: 'alchemy', side }, { op: 'annul', side }, { op: 'annul', side, greater: true });
  A.push({ op: 'annul', light: true }, { op: 'fracture' }, { op: 'divine' });
  for (const to of ['fire', 'cold', 'lightning']) A.push({ op: 'flux', to });
  for (const q of ['Gnawed', 'Preserved', 'Ancient']) {
    const side = SIDES[Math.floor(r() * 3)];
    A.push({ op: 'bone', quality: q, side, lich: LICH[Math.floor(r() * 4)], echoes: r() < 0.5 });
  }
  for (const e of ctx.essences) {
    if (e.liquid) A.push({ op: 'liquid', item: e.item, mod: e.mod });
    else if (e.kind === 'magic') A.push({ op: 'essence', item: e.item, mod: e.mod });
    else A.push({ op: 'pessence', item: e.item, mod: e.mod, side: SIDES[Math.floor(r() * 3)] });
  }
  return A.filter((a) => !P.validate(ctx, st, a));
}

const groupsOf = (st) => st.mods.flatMap((m) => m.grp || []);
const key = (m) => m.id + '|' + m.side;

/**
 * Check one applied step. Returns a list of failed check ids with detail.
 * Checks: slots, crafted, desecrated, groups, ilvl, fractured, floor, counts, sides, lich, pool, whittle, light, tags.
 */
function checkStep(ctx, before, a, r) {
  const { kb } = load();
  const after = r.state;
  const bad = [];
  const fail = (id, msg) => bad.push({ id, msg });
  // limits: rarity and item class (Rare jewels 2 + 2), plus "+1 Prefix/Suffix Modifier allowed" mods on the item
  const limOf = (s) => {
    const l = E.slotLimits({ rarity: s.rarity, slotDelta: ctx.slotDelta }, ctx.cls);
    if (s.rarity === 'Rare') for (const m of s.mods) { const c = m.id && kb.mods[m.id] && kb.mods[m.id].cap; if (c) { l.prefix += c.prefix || 0; l.suffix += c.suffix || 0; } }
    return l;
  };
  const lim = limOf(after);
  const cnt = (s, side) => s.mods.filter((m) => m.side === side).length;
  if (after.rarity === 'Normal' && after.mods.length) fail('slots', 'Normal item with modifiers');
  // a side over its limit is legal only when it did not grow (removing a "+1 Prefix Modifier allowed" mod leaves it over)
  const over = (side) => cnt(after, side) > lim[side] && cnt(after, side) > cnt(before, side);
  if (over('prefix') || over('suffix')) fail('slots', `${cnt(after, 'prefix')}p/${cnt(after, 'suffix')}s on ${after.rarity}`);
  if (after.mods.filter((m) => m.crafted).length > 1) fail('crafted', 'two crafted modifiers');
  if (after.mods.filter((m) => m.des).length > 1) fail('desecrated', 'two desecrated modifiers');
  const g = groupsOf(after);
  if (new Set(g).size !== g.length) fail('groups', 'two modifiers of one group: ' + g.filter((x, i) => g.indexOf(x) !== i).join(','));
  // Natural and desecrated mods need their level <= item level. Essence (crafted) mods are left out: whether essences
  // check item level is not in the data (open question t18); the self-test counts them separately.
  for (const m of after.mods) if (m.id && !m.crafted && kb.mods[m.id].lvl > ctx.ilvl) fail('ilvl', `${m.id} level ${kb.mods[m.id].lvl} > item level ${ctx.ilvl}`);
  if (a.op !== 'newbase') {
    for (const m of before.mods) if (m.frac && !after.mods.some((x) => x.frac && key(x) === key(m))) fail('fractured', `fractured ${m.id} removed or changed by ${a.op}`);
    if (r.removed.some((m) => m.frac)) fail('fractured', 'a fractured modifier was removed');
  }
  // Greater/Perfect floors (a family whose every legal tier is below the floor keeps its best one)
  const floorOps = { transmute: 'transmute', augment: 'augment', regal: 'regal', exalt: 'exalt', chaos: 'chaos' };
  if (floorOps[a.op] && a.tier && a.tier !== 'base') {
    const f = (ctx.floors[a.op] || {})[a.tier === 'greater' ? 'Greater' : 'Perfect'] || 0;
    for (const m of r.added) {
      const lvl = kb.mods[m.id].lvl;
      if (lvl >= f) continue;
      const fam = [...ctx.pool.entries()].filter(([id, pe]) => kb.mods[id].fam === m.fam && pe.side === m.side && kb.mods[id].lvl <= ctx.ilvl);
      if (fam.some(([id]) => kb.mods[id].lvl >= f)) fail('floor', `${a.tier} ${a.op} added ${m.id} (level ${lvl}) under the floor ${f}`);
    }
  }
  // what each operator does to the modifier count
  const dn = after.mods.length - before.mods.length;
  const limB = limOf(before);
  const fullBefore = cnt(before, 'prefix') >= limB.prefix && cnt(before, 'suffix') >= limB.suffix;
  const n = a.greater ? 2 : 1;
  const expect = {
    transmute: () => after.rarity === 'Magic' && after.mods.length <= 1,
    augment: () => dn <= 1 && r.removed.length === 0,
    regal: () => after.rarity === 'Rare' && dn <= 1 && r.removed.length === 0,
    alchemy: () => after.rarity === 'Rare' && after.mods.length <= 4 && r.removed.length === 0,
    exalt: () => r.removed.length === 0 && r.added.length <= n && dn === r.added.length,
    chaos: () => r.removed.length === 1 && r.added.length <= 1,
    annul: () => r.added.length === 0 && r.removed.length >= 1 && r.removed.length <= n,
    essence: () => after.rarity === 'Rare' && r.added.length === 1 && r.added[0].crafted,
    pessence: () => r.removed.length === 1 && r.added.length <= 1 && r.added.every((m) => m.crafted),
    // game text: removes a random modifier and adds the guaranteed crafted modifier the game lists for this jewel
    liquid: () => r.removed.length === 1 && r.added.length <= 1 && r.added.every((m) => m.crafted
      && (kb.liquid_emotions[a.item].by_base[ctx.item.base] || []).includes(m.id)),
    // game text: desecrating a full item also removes a random modifier
    bone: () => r.added.length === 1 && r.added[0].des && r.removed.length === (fullBefore ? 1 : 0),
    fracture: () => after.mods.filter((m) => m.frac).length === before.mods.filter((m) => m.frac).length + 1,
    divine: () => dn === 0 && r.added.length === 0 && after.mods.every((m, i) => m.id === before.mods[i].id && (!m.frac || m.v === before.mods[i].v)),
    flux: () => dn === 0 && r.added.length === r.removed.length,
  }[a.op];
  if (expect && !expect()) fail('effect', `${a.op} ${JSON.stringify(a)}: ${before.mods.length} -> ${after.mods.length} mods, +${r.added.length} -${r.removed.length}`);
  // omen side restrictions
  if (a.side && ['exalt', 'regal'].includes(a.op) && r.added.some((m) => m.side !== a.side)) fail('side', `${a.op} with a ${a.side} omen added a ${r.added.find((m) => m.side !== a.side).side}`);
  if (a.side && ['chaos', 'annul', 'pessence'].includes(a.op) && r.removed.some((m) => m.side !== a.side)) fail('side', `${a.op} with a ${a.side} omen removed a ${r.removed.find((m) => m.side !== a.side).side}`);
  // R_SWAP_REMOVAL: without an omen, a full side of the one new mod loses one of its own mods
  if (!a.side && (a.op === 'pessence' || a.op === 'liquid')) {
    const ids = a.op === 'liquid' ? kb.liquid_emotions[a.item].by_base[ctx.item.base] || [] : [a.mod];
    const sides = [...new Set(ids.map((id) => (kb.mods[id].gen === 'p' ? 'prefix' : 'suffix')))];
    if (sides.length === 1 && cnt(before, sides[0]) >= limB[sides[0]] && r.removed.some((m) => m.side !== sides[0])) fail('side', `${a.op} removed a ${r.removed[0].side} although its ${sides[0]}es were full`);
  }
  if (a.op === 'alchemy' && a.side && cnt(after, a.side) < Math.min(3, lim[a.side]) && after.mods.length === 4) fail('side', `alchemy with a ${a.side} omen gave ${cnt(after, a.side)} ${a.side}es`);
  if (a.op === 'bone' && a.lich && r.added.some((m) => E.lichOf(kb.mods[m.id]) !== a.lich)) fail('lich', `lich omen ${a.lich} gave ${r.added[0].id}`);
  // a natural mod that came in must not be one the item's other mods stop (game data adds_tags, e.g. no_cold_spell_mods)
  for (const m of r.added) {
    if (m.crafted || m.des || a.op === 'flux') continue;
    const others = E.addedTags(kb, after.mods.filter((x) => x !== m).map((x) => x.id));
    if (E.tagBlocked(kb.mods[m.id], new Set(kb.bases[ctx.item.base].tags), others)) fail('tags', `${m.id} came in although another mod on the item stops it`);
  }
  // added modifiers must be able to spawn on this base
  for (const m of r.added) {
    if (m.crafted || a.op === 'flux') continue;
    if (m.des ? !ctx.desPool.has(m.id) : !ctx.pool.has(m.id)) fail('pool', `${m.id} cannot spawn on ${ctx.item.base}`);
  }
  if (a.whittle && r.removed.length) {
    const low = Math.min(...before.mods.filter((m) => !m.frac).map((m) => m.lvl));
    if (r.removed[0].lvl !== low) fail('whittle', `whittling removed level ${r.removed[0].lvl}, lowest was ${low}`);
  }
  if (a.light && r.removed.some((m) => !m.des)) fail('light', 'Omen of Light removed a non-desecrated modifier');
  // Ancient bones (Minimum Modifier Level 40): a family with no tier at 40 or above keeps its best tier (game text)
  if (a.op === 'bone' && a.quality === 'Ancient') for (const m of r.added) {
    if (kb.mods[m.id].lvl >= 40) continue;
    const fam = [...ctx.desPool.entries()].filter(([id, pe]) => kb.mods[id].fam === m.fam && pe.side === m.side && kb.mods[id].lvl <= ctx.ilvl);
    if (fam.some(([id]) => kb.mods[id].lvl >= 40)) fail('floor', `Ancient bone added ${m.id} (level ${kb.mods[m.id].lvl}) below level 40`);
  }
  return bad;
}

/** Parse the rendered text of a state and compare it with the state. */
function roundTrip(ctx, st, r) {
  const { ix, kb } = load();
  const out = [];
  if (st.rarity === 'Normal' || st.mods.some((m) => !m.id)) return out;
  const item = { base: ctx.item.base, cls: ctx.cls, rarity: st.rarity, ilvl: ctx.ilvl, mods: st.mods };
  for (const mode of ['adv', 'simple']) {
    const t = renderItem(item, r, mode);
    const p = E.parseItem(ix, t.text).item;
    if (!p || p.base !== item.base || p.rarity !== item.rarity || p.ilvl !== item.ilvl) { out.push({ id: 'parse-' + mode, msg: 'header differs' }); continue; }
    const got = p.mods.slice();
    for (const m of st.mods) {
      // A Ctrl+C line carries one marker: a mod that is both fractured and crafted/desecrated cannot round-trip there.
      if (mode === 'simple' && [m.frac, m.des, m.crafted].filter(Boolean).length > 1) { out.push({ id: 'parse-simple-limit', msg: `${m.id} has two markers` }); const j = got.findIndex((x) => x.modId === m.id); if (j >= 0) got.splice(j, 1); continue; }
      const i = got.findIndex((x) => x.modId === m.id);
      if (i < 0) {
        const near = got.find((x) => x.fam === m.fam) || got.find((x) => (x.candidates || []).some((c) => c.id === m.id)) || got.find((x) => (x.splitAlt || []).includes(m.id));
        // the right mod offered as a candidate, or the hybrid-or-two-mods warning, is a flagged ambiguity, not a misread
        const listed = !!(near && ((near.candidates || []).some((c) => c.id === m.id) || (near.splitAlt || []).includes(m.id)));
        out.push({ id: 'parse-' + mode, msg: `${m.id} read as ${near ? near.modId + (near.ambiguous ? ' (ambiguous)' : '') + (listed ? ', right mod listed as a candidate' : '') : 'nothing'}`,
          ambiguous: !!(near && near.ambiguous), sameFam: !!near && near.fam === m.fam, listed });
        continue;
      }
      const x = got.splice(i, 1)[0];
      if (x.slot !== m.side) out.push({ id: 'parse-' + mode, msg: `${m.id} side ${x.slot} != ${m.side}` });
      // A Ctrl+C line carries one marker, so a mod that is both fractured and crafted (or desecrated) cannot round-trip.
      const flags = [m.frac, m.des, m.crafted].filter(Boolean).length;
      // two mods with the same text (a prefix and a suffix version) can swap lines in plain text, markers included
      const twin = st.mods.some((y) => y !== m && y.id && E.template(kb.mods[y.id].txt) === E.template(kb.mods[m.id].txt));
      if ((mode === 'adv' || (flags <= 1 && !twin)) && (!!x.fractured !== !!m.frac || !!x.desecrated !== !!m.des || !!x.crafted !== !!m.crafted)) out.push({ id: 'parse-' + mode, msg: `${m.id} flags differ` });
      if (mode === 'adv' && m.tier && x.tier !== m.tier) out.push({ id: 'parse-' + mode, msg: `${m.id} tier ${x.tier} != ${m.tier}` });
    }
  }
  return out;
}

/**
 * Random walks on one base. opts: { walks, steps, seed, ilvl }.
 * Returns { steps, checks: {id: {n, fail, examples}}, ops: {op: n} }.
 */
function walkBase(base, opts) {
  const { ix, kb } = load();
  const r = rng(opts.seed || 1);
  const cls = kb.bases[base].cls;
  const res = { base, steps: 0, checks: {}, ops: {}, trips: 0 };
  const note = (id, ok, msg) => {
    const c = res.checks[id] || (res.checks[id] = { n: 0, fail: 0, examples: [] });
    c.n++;
    if (!ok) { c.fail++; if (c.examples.length < (opts.maxExamples || 3)) c.examples.push(base + ': ' + msg); }
  };
  const ALL = ['slots', 'crafted', 'desecrated', 'groups', 'ilvl', 'fractured', 'floor', 'effect', 'side', 'lich', 'pool', 'whittle', 'light', 'tags'];
  for (let w = 0; w < opts.walks; w++) {
    const ilvl = opts.ilvl || [82, 75, 64, 45][w % 4];
    const white = E.parseItem(ix, renderItem({ base, cls, rarity: 'Normal', ilvl, mods: [] }, r, 'adv').text).item;
    // a Rare with catalyst quality sometimes, so the catalysing omen is exercised on rings, amulets and jewels
    if ((cls === 'Ring' || cls === 'Amulet' || cls === 'Jewel') && r() < 0.5) { white.quality = 20; white.qualityType = 'Life Modifiers'; }
    const ctx = P.makeContext(ix, white, { weights: weightsFor(base), essences: essencesFor(cls), catalystMult: 3 });
    let st = P.toState(ctx, white);
    for (let s = 0; s < opts.steps; s++) {
      const A = candidates(ctx, st, r);
      if (!A.length || r() < 0.03) { st = P.apply(ctx, st, { op: 'newbase' }, r).state; continue; }
      const a = A[Math.floor(r() * A.length)];
      let out;
      try { out = P.apply(ctx, st, a, r); } catch (e) { note('crash', false, `${a.op}: ${e.message}`); break; }
      note('crash', true);
      res.ops[a.op] = (res.ops[a.op] || 0) + 1;
      const bad = checkStep(ctx, st, a, out);
      for (const id of ALL) { const b = bad.find((x) => x.id === id); note(id, !b, b ? b.msg : ''); }
      st = out.state;
      res.steps++;
      if (s % 5 === 4) {
        const trip = roundTrip(ctx, st, r);
        res.trips++;
        for (const mode of ['adv', 'simple']) {
          const t = trip.filter((x) => x.id === 'parse-' + mode);
          // Ctrl+C text has no tiers or sides: an ambiguous read of the right family is expected, not a failure
          // Ctrl+C text has no tiers or sides: a read of the right family, or a read that lists the right mod as a
          // candidate (shown to the player as "Pick"), is an expected ambiguity, not a misread.
          // Alt+Ctrl+C: a read flagged ambiguous that lists the right mod (same text, local and global versions) is shown
          // to the player as "Pick", so it counts under its own check.
          const soft = (x) => (mode === 'simple' ? x.sameFam || x.listed : x.ambiguous && x.listed);
          const hard = t.filter((x) => !soft(x));
          note('parse-' + mode, !hard.length, hard.map((x) => x.msg).join('; '));
          if (mode === 'adv') note('parse-adv-flagged', !t.length, t.map((x) => x.msg).join('; '));
          if (mode === 'simple') note('parse-simple-exact', !t.length, t.map((x) => x.msg).join('; '));
        }
      }
    }
  }
  return res;
}

/**
 * Roll frequencies against the weights: many Exalted Orbs (base and Perfect) on one Rare state with 2 mods.
 * Expected share of each family = its weight / total weight of what can roll (sides, groups, floor).
 * Returns { base, tests: [{tier, fams, maxZ, fail}] } (fail = families outside 4.5 standard deviations).
 */
function frequencyTest(base, seed, n) {
  const { ix, kb } = load();
  const r = rng(seed);
  const cls = kb.bases[base].cls;
  const item = E.parseItem(ix, renderItem({ base, cls, rarity: 'Normal', ilvl: 82, mods: [] }, r, 'adv').text).item;
  const ctx = P.makeContext(ix, item, { weights: weightsFor(base) });
  let st = P.toState(ctx, item);
  st = P.apply(ctx, st, { op: 'transmute' }, r).state;
  st = P.apply(ctx, st, { op: 'regal' }, r).state;
  const out = { base, tests: [] };
  for (const tier of ['base', 'perfect']) {
    const f = tier === 'base' ? 0 : ctx.floors.exalt.Perfect;
    const taken = new Set(groupsOf(st));
    const sides = ['prefix', 'suffix'].filter((s) => P.validate(ctx, st, { op: 'exalt', side: s }) === null);
    const exp = new Map();
    let total = 0;
    for (const s of sides) for (const e of P.sidePool(ctx, s, f)) {
      if (e.grp.some((g) => taken.has(g))) continue;
      exp.set(e.fam + '|' + s, (exp.get(e.fam + '|' + s) || 0) + e.w); total += e.w;
    }
    const obs = new Map();
    for (let i = 0; i < n; i++) {
      const a = P.apply(ctx, st, { op: 'exalt', tier }, r);
      for (const m of a.added) obs.set(m.fam + '|' + m.side, (obs.get(m.fam + '|' + m.side) || 0) + 1);
    }
    let maxZ = 0, fails = 0, fams = 0;
    for (const [k, w] of exp) {
      const p = w / total, e = p * n;
      if (e < 20) continue;
      fams++;
      const z = Math.abs((obs.get(k) || 0) - e) / Math.sqrt(e * (1 - p));
      maxZ = Math.max(maxZ, z);
      if (z > 4.5) fails++;
    }
    for (const k of obs.keys()) if (!exp.has(k)) fails++; // rolled something that should not roll
    out.tests.push({ tier, fams, maxZ: +maxZ.toFixed(2), fail: fails });
  }
  return out;
}

module.exports = { walkBase, frequencyTest, checkStep, candidates, roundTrip };
