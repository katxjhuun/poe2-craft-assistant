/* Self-test scenarios: a start item (white, Magic or Rare) and goals on each test base, and the recipes of the library
 * as scenarios. Shared by the self-test (run.js) and the exhaustive sweep (sweep.js). */
'use strict';
const { E, P, load, weightsFor, essencesFor, renderItem, rng } = require('./lib.js');

// ---------------------------------------------------------------- scenarios
function whiteItem(base, ilvl) {
  const { ix, kb } = load();
  return E.parseItem(ix, renderItem({ base, cls: kb.bases[base].cls, rarity: 'Normal', ilvl, mods: [] }, rng(1), 'adv').text).item;
}
const labelOf = (id) => E.template(load().kb.mods[id].txt.split('\n')[0]);

/** Goal families of a base: per side a rare (low weight) and a common (high weight) family with a T1 at item level 82. */
function goalFamilies(base) {
  const { ix, kb } = load();
  const item = whiteItem(base, 82);
  const ctx = P.makeContext(ix, item, { weights: weightsFor(base) });
  const fams = {};
  for (const side of ['prefix', 'suffix']) {
    const byFam = new Map();
    for (const e of P.sidePool(ctx, side, 0)) {
      const f = byFam.get(e.fam) || { fam: e.fam, side, w: 0, best: e };
      f.w += e.w;
      if (e.tier < f.best.tier) f.best = e;
      byFam.set(e.fam, f);
    }
    const list = [...byFam.values()].filter((f) => f.best.tier === 1 && !/Essence/.test(f.fam)).sort((a, b) => b.w - a.w);
    fams[side] = list.length ? { common: list[Math.floor(list.length * 0.2)], rare: list[Math.floor(list.length * 0.75)] } : null;
  }
  const res = P.sidePool(ctx, 'suffix', 0).find((e) => e.fam === 'FireResistance') ? 'FireResistance' : null;
  const cls = kb.bases[base].cls;
  const ess = essencesFor(cls).find((r) => r.kind === 'magic' && ctx.pool.has(r.mod));
  const des = ctx.bone ? [...E.desecratedPoolFor(ix, base).entries()].map(([id, pe]) => ({ id, pe })).find((x) => x.pe.side === 'suffix' && !E.lichOf(kb.mods[x.id])) : null;
  return { ctx, fams, res, ess, des };
}

function scenarios(bases) {
  const { kb } = load();
  const out = [];
  let seed = 100;
  const add = (base, group, start, targets) => out.push({ id: `${base}|${group}|${start}`, base, ilvl: 82, start, group, targets, seed: seed++ });
  const T = (key, fam, group, minTier, label) => ({ [key]: { fam, group, minTier, required: true, label } });
  for (const base of bases) {
    const g = goalFamilies(base);
    const p = g.fams.prefix, s = g.fams.suffix;
    if (p) {
      add(base, 'single-prefix-rare-T1', 'white', T('prefix-0', p.rare.fam, 'prefix', 1, labelOf(p.rare.best.id)));
      add(base, 'single-prefix-rare-T1', 'rare', T('prefix-0', p.rare.fam, 'prefix', 1, labelOf(p.rare.best.id)));
      add(base, 'single-prefix-rare-T1', 'rare-low', T('prefix-0', p.rare.fam, 'prefix', 1, labelOf(p.rare.best.id)));
      add(base, 'single-prefix-common-T2', 'rare', T('prefix-0', p.common.fam, 'prefix', 2, labelOf(p.common.best.id)));
    }
    if (s) {
      add(base, 'single-suffix-rare-T1', 'white', T('suffix-0', s.rare.fam, 'suffix', 1, labelOf(s.rare.best.id)));
      add(base, 'single-suffix-rare-T1', 'rare', T('suffix-0', s.rare.fam, 'suffix', 1, labelOf(s.rare.best.id)));
      add(base, 'single-suffix-rare-T1', 'rare-low', T('suffix-0', s.rare.fam, 'suffix', 1, labelOf(s.rare.best.id)));
      add(base, 'single-suffix-common-T2', 'rare', T('suffix-0', s.common.fam, 'suffix', 2, labelOf(s.common.best.id)));
    }
    if (g.res) {
      add(base, 'resistance-T2', 'white', T('suffix-0', 'FireResistance', 'suffix', 2, '+#% to Fire Resistance'));
      add(base, 'resistance-T2', 'rare', T('suffix-0', 'FireResistance', 'suffix', 2, '+#% to Fire Resistance'));
    }
    if (g.ess) {
      const m = kb.mods[g.ess.mod], side = m.gen === 'p' ? 'prefix' : 'suffix';
      const tier = g.ctx.pool.get(g.ess.mod).tier;
      add(base, 'essence-reachable', 'white', T(side + '-0', m.fam, side, tier, labelOf(g.ess.mod)));
      add(base, 'essence-reachable', 'magic', T(side + '-0', m.fam, side, tier, labelOf(g.ess.mod)));
    }
    if (p && s) {
      const two = Object.assign(T('prefix-0', p.rare.fam, 'prefix', 2, labelOf(p.rare.best.id)), T('suffix-0', s.common.fam, 'suffix', 2, labelOf(s.common.best.id)));
      add(base, 'pair-prefix-suffix-T2', 'white', two);
      add(base, 'pair-prefix-suffix-T2', 'rare', two);
    }
    if (s && g.res && s.rare.fam !== 'FireResistance') {
      const two = Object.assign(T('suffix-0', s.rare.fam, 'suffix', 2, labelOf(s.rare.best.id)), T('suffix-1', 'FireResistance', 'suffix', 3, '+#% to Fire Resistance'));
      add(base, 'pair-two-suffixes', 'rare', two);
    }
    // Rings and amulets with 20% catalyst quality of the goal's type (Omen of Catalysing Exaltation)
    if (['Ring', 'Amulet'].includes(kb.bases[base].cls)) {
      const life = P.sidePool(g.ctx, 'prefix', 0).concat(P.sidePool(g.ctx, 'suffix', 0)).filter((e) => (kb.mods[e.id].mt || []).includes('life') && !/Essence/.test(e.fam)).sort((a, b) => a.tier - b.tier)[0];
      if (life) {
        out.push({ id: `${base}|catalyst-life|rare`, base, ilvl: 82, start: 'rare', group: 'catalyst-life', seed: seed++, quality: 20, qualityType: 'Life Modifiers',
          targets: T(life.side + '-0', life.fam, life.side, 2, labelOf(life.id)) });
      }
    }
    if (g.des) add(base, 'desecrated', 'rare', { 'suffix-2': { fam: kb.mods[g.des.id].fam, group: 'desecrated', minTier: null, required: true, label: labelOf(g.des.id) } });
  }
  return out;
}

/** Scenarios for the recipes of the library, so the simulation can confirm or improve them. */
function recipeScenarios(bases) {
  const { ix, kb, lib } = load();
  const out = [], skipped = [];
  for (const r of lib.recipes) {
    if (!r.target || !r.target.length || r.classes.includes('*')) { skipped.push({ id: r.id, why: 'a general technique (no item class or goals to simulate)' }); continue; }
    // The self-test starts from a white base; recipes that start from a prepared item or use alloys are not comparable.
    const txt = r.steps.map((x) => x.text).join(' ');
    if (/^\s*Fractured\b|\bstart (from|with) an? (item|base) (that|with)\b/i.test(r.steps[0] ? r.steps[0].text : '') || /\bAlloy\b/.test(txt)) {
      skipped.push({ id: r.id, why: 'starts from a prepared item or uses Runic Alloys; the self-test simulates routes from a white base' }); continue;
    }
    // The recipe's required goals (nice-to-have ones are a checkpoint, not the recipe's promise), on the first test
    // base of its classes where every goal can roll.
    const want = r.target.filter((t) => t.required !== false);
    let base = null, targets = null, miss = null;
    for (const b of bases.filter((x) => r.classes.includes(kb.bases[x].cls))) {
      const item = whiteItem(b, Math.max(82, r.min_ilvl || 1));
      const tg = {}, count = { prefix: 0, suffix: 0 };
      miss = null;
      for (const t of want) {
        const f = E.resolveTemplateTarget(ix, item, t.stat);
        if (!f) { miss = `"${t.stat}" does not roll on ${b}`; break; }
        tg[f.side + '-' + count[f.side]++] = { fam: f.fam, group: f.group, minTier: t.minTier || null, required: true, label: f.label };
      }
      if (!miss) { base = b; targets = tg; break; }
    }
    if (!base) { skipped.push({ id: r.id, why: miss || 'no test base of ' + r.classes.join('/') }); continue; }
    out.push({ id: `recipe|${r.id}`, base, ilvl: Math.max(82, r.min_ilvl || 1), start: 'white', group: 'recipe', recipe: r.id, targets, seed: 900 + out.length });
  }
  return { out, skipped };
}

module.exports = { whiteItem, labelOf, goalFamilies, scenarios, recipeScenarios };
