/* Profit crafts of the recipe library (recipes with a "profit" block): checks them and works out what the craft
 * network says about the ones that carry a goal.
 *
 *   node scripts/profit_recipes.js            check only (exit code 1 when a name or a label does not resolve)
 *   node scripts/profit_recipes.js --write    also writes goal.item (the entry item as Alt+Ctrl+C text) and goal.model
 *                                             (the network's route cost from that item at the latest prices) back
 *
 * A profit block: said (when the source gave its numbers), per (what one attempt is), buy {div|ex: [low, high]},
 * uses [{name, n}] (the currency of one attempt), outcomes [{label, div: [low, high], hit?, chance?}], note,
 * goal {entry: {base, ilvl, rarity, mods: [{id | fam + tier, frac?}]}, targets: [{stat, minTier, required}]}.
 * The page adds up "uses" at the prices of the moment; the sale prices are the source's and dated. */
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, E, load, weightsFor, essencesFor, rng, renderItem } = require('./selftest/lib.js');
const NW = require(path.join(ROOT, 'app', 'network.js'));
const P = require(path.join(ROOT, 'app', 'planner.js'));
const FILE = path.join(ROOT, 'app', 'data', 'recipes_0.5.5.json');
const write = process.argv.includes('--write');
const { ix, kb, priceOf, league } = load();
const lib = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const errors = [];
const known = new Set(Object.keys(kb.currency_metadata_ids || {}));

/** The entry item of a goal as the game would copy it. */
function entryItem(entry) {
  const b = kb.bases[entry.base];
  if (!b) throw new Error(`unknown base ${entry.base}`);
  const pool = E.poolFor(ix, b.sig);
  const mods = entry.mods.map((m) => {
    let id = m.id;
    if (!id) { const hit = [...pool].find(([x, pe]) => kb.mods[x].fam === m.fam && pe.tier === m.tier); if (!hit) throw new Error(`no ${m.fam} T${m.tier} on ${entry.base}`); id = hit[0]; }
    const km = kb.mods[id];
    if (!km) throw new Error(`unknown modifier ${id}`);
    const pe = pool.get(id);
    return { id, side: km.gen === 'p' ? 'prefix' : 'suffix', tier: pe ? pe.tier : 0, frac: !!m.frac };
  });
  const text = renderItem({ base: entry.base, cls: b.cls, rarity: entry.rarity, ilvl: entry.ilvl, name: 'Bought Item', mods, implicits: b.imp || [] }, rng(7), 'adv').text;
  return { text, item: E.parseItem(ix, text).item, cls: b.cls };
}

/** Targets as the page's "Use as goals" makes them. */
function targetsFor(item, list) {
  const out = {};
  const lim = E.itemLimits(ix, Object.assign({}, item, { rarity: 'Rare' }));
  const sideMods = (side) => item.mods.filter((m) => m.slot === side);
  for (const t of list) {
    const fam = E.resolveTemplateTarget(ix, item, t.stat);
    if (!fam) throw new Error(`"${t.stat}" is not a modifier of ${item.base}`);
    const side = fam.side;
    const present = item.mods.find((m) => m.fam === fam.fam);
    let slot = null;
    if (present) slot = side + '-' + sideMods(side).indexOf(present);
    else for (let i = 0; i < lim[side] && !slot; i++) if (!sideMods(side)[i] && !out[side + '-' + i]) slot = side + '-' + i;
    if (!slot) throw new Error(`no free ${side} slot for "${t.stat}" on ${item.base}`);
    const tier = fam.tiers.find((x) => x.tier === t.minTier && x.ok) || fam.tiers.find((x) => x.ok);
    out[slot] = { key: fam.key, fam: fam.fam, group: fam.group, label: fam.label, minTier: tier ? tier.tier : t.minTier, minValue: null, valueMode: false, required: t.required !== false };
  }
  return out;
}

let n = 0;
for (const r of lib.recipes) {
  const p = r.profit;
  if (!p) continue;
  n++;
  for (const u of p.uses || []) {
    if (!(u.n > 0)) errors.push(`${r.id}: "${u.name}" has no count`);
    if (priceOf(u.name) == null) (known.size && !known.has(u.name) ? errors : []).push(`${r.id}: "${u.name}" is not a currency item of the knowledge base`);
    if (priceOf(u.name) == null) console.log(`  ${r.id}: no price for ${u.name} right now`);
  }
  for (const st of r.steps || []) for (const name of st.names || []) if (priceOf(name) == null && known.size && !known.has(name)) errors.push(`${r.id}: step names "${name}", which is not a currency item`);
  for (const o of p.outcomes || []) if (!Array.isArray(o.div) || !(o.div[0] <= o.div[1])) errors.push(`${r.id}: outcome "${o.label}" needs div: [low, high]`);
  const mats = (p.uses || []).reduce((s, u) => s + u.n * (priceOf(u.name) || 0), 0);
  const div = priceOf('Divine Orb');
  let line = `${r.id} ${r.title}\n  materials ${mats.toFixed(0)} ex (${(mats / div).toFixed(2)} div)`;
  if (p.goal) {
    try {
      const e = entryItem(p.goal.entry);
      const targets = targetsFor(e.item, p.goal.targets);
      const t0 = Date.now();
      // (goal.restart: 'item' = a miss is another bought item at the buy price; 'never' = the item is finished whatever comes)
      const buyEx = p.buy ? (p.buy.ex ? (p.buy.ex[0] + p.buy.ex[1]) / 2 : (p.buy.div[0] + p.buy.div[1]) / 2 * div) : 0;
      const input = { ix, item: e.item, targets, locks: {}, priceOf, baseCost: 1, restart: p.goal.restart || 'never', itemCost: buyEx, weights: weightsFor(p.goal.entry.base),
        essences: P.essencesForBase(ix, kb.bases[p.goal.entry.base], essencesFor(e.cls)).concat(P.liquidFor(kb, p.goal.entry.base)) };
      const a = NW.answer(input, { baseLimit: 100 });
      if (!a || !a.steps || !a.steps.length) throw new Error('the network gives no route: ' + JSON.stringify(a && (a.impossible || a.blocked || a.unsupported || a.done)).slice(0, 200));
      const first = a.steps[0];
      p.goal.item = e.text;
      p.goal.model = { ex: Math.round(a.meanCost), items: +(1 + (a.bases || 0)).toFixed(2), hit: a.next && a.next.hit > 0 ? +a.next.hit.toFixed(4) : null, uses: a.steps.filter((s) => s.avg >= 0.05).slice(0, 8).map((s) => ({ name: s.names.join(' + '), n: +s.avg.toFixed(s.avg < 10 ? 2 : 0) })) };
      line += `\n  goal (${input.restart}): ${a.meanCost.toFixed(0)} ex (${(a.meanCost / div).toFixed(1)} div) from the entry item, ${(1 + (a.bases || 0)).toFixed(2)} items, ${p.goal.model.uses.map((u) => u.n + ' x ' + u.name).join(', ')}  [${Date.now() - t0} ms]`;
    } catch (err) { errors.push(`${r.id}: goal: ${err.message}`); }
  }
  console.log(line);
}
console.log(`${n} profit crafts`);
if (errors.length) { console.log('ERRORS\n' + errors.map((e) => '  ' + e).join('\n')); process.exitCode = 1; }
// (profitModel.at: the day of the prices the models were made with)
else if (write) { lib.meta.profitModel = { at: String(league.updatedAt || new Date(league.hourTo * 1000).toISOString()).slice(0, 10), divine: Math.round(priceOf('Divine Orb')) }; fs.writeFileSync(FILE, JSON.stringify(lib, null, 1)); console.log('written'); }
