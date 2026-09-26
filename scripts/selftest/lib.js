/* Self-test shared helpers: data loading, item rendering (Alt+Ctrl+C and Ctrl+C text), scenario building. */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const E = require(path.join(ROOT, 'app', 'engine.js'));
const P = require(path.join(ROOT, 'app', 'planner.js'));

let cache = null;
/**
 * Newest prices on this computer: .kb_cache/out (written by scripts/fetch_prices.py or the local price server)
 * when it is there, else the copy in the last page build.
 */
function latestPrices() {
  const fs = require('fs');
  const out = path.join(ROOT, '.kb_cache', 'out');
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
    const leagues = {};
    for (const l of meta.leagues) {
      const f = path.join(out, 'league-' + l.slug + '.json');
      if (fs.existsSync(f)) leagues[l.slug] = JSON.parse(fs.readFileSync(f, 'utf8'));
    }
    if (leagues['forbidden-rites']) return { meta, leagues, source: '.kb_cache/out' };
  } catch (e) { /* fall back to the build copy */ }
  return Object.assign(require(path.join(ROOT, 'app', 'dist', 'data', 'prices-snapshot.json')), { source: 'app/dist/data/prices-snapshot.json' });
}
/** Knowledge base, index, poe2db weights, essence lists, prices (Forbidden Rites snapshot) and the recipe library. */
function load() {
  if (cache) return cache;
  const kb = require(process.env.POE2_KB || path.join(ROOT, 'poe2_kb_0.5.5.json')); // POE2_KB: a candidate KB
  const ix = E.buildIndex(kb);
  const W = require(path.join(ROOT, 'app', 'data', 'weights_0.5.5.json'));
  ix.essenceMods = new Set(Object.values(W.essences || {}).flat().map((r) => r.mod)); // as the page does
  const snap = latestPrices();
  const lib = require(path.join(ROOT, 'app', 'data', 'recipes_0.5.5.json'));
  const league = snap.leagues['forbidden-rites'];
  const priceByName = {};
  for (const r of Object.values(league.items)) if (r[2] != null) priceByName[r[0]] = r[2];
  cache = { kb, ix, W, snap, lib, league, priceByName, priceOf: (n) => (priceByName[n] != null ? priceByName[n] : null) };
  return cache;
}

function weightsFor(base) {
  const { W } = load();
  const page = W.base_page[base];
  return page && W.pages[page] ? W.pages[page].weights : null;
}
function essencesFor(cls) {
  const { W } = load();
  return ((W.essences || {})[cls] || []).filter((r) => !r.alloy);
}

const CLASS_TEXT = { Staff: 'Staves', Focus: 'Foci', Warstaff: 'Quarterstaves', 'Body Armour': 'Body Armours', Gloves: 'Gloves', Boots: 'Boots' };
const classText = (cls) => CLASS_TEXT[cls] || cls + 's';

/** Seeded RNG (mulberry32), same as the planner's. */
function rng(seed) { return P.rngFrom(seed); }

/** A rolled value inside "(a-b)" (whole numbers when both ends are whole). */
function roll(a, b, r) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (Number.isInteger(lo) && Number.isInteger(hi)) return lo + Math.floor(r() * (hi - lo + 1));
  return Math.round((lo + r() * (hi - lo)) * 100) / 100;
}
const NUM = '-?\\d+(?:\\.\\d+)?';
const RANGE = new RegExp(`\\((${NUM})-(${NUM})\\)`, 'g');
/** KB mod text with rolled values: advanced "7(5-8)" or simple "7". Returns { lines, values }. */
function rollText(txt, r, advanced) {
  const values = [];
  const lines = txt.split('\n').map((line) => line.replace(RANGE, (all, a, b) => {
    const v = roll(+a, +b, r);
    values.push(v);
    return advanced ? `${v}(${a}-${b})` : String(v);
  }));
  return { lines, values };
}

/**
 * Item text from a simulation-like state.
 * item: { base, cls, rarity, ilvl, name?, mods: [{id, side, tier, frac, des, crafted}], corrupted? }
 * mode: 'adv' (Alt+Ctrl+C with headers and ranges) or 'simple' (Ctrl+C with markers).
 */
function renderItem(item, r, mode) {
  const { kb } = load();
  const adv = mode !== 'simple';
  const out = [`Item Class: ${classText(item.cls)}`, `Rarity: ${item.rarity}`];
  if (item.rarity === 'Rare') out.push(item.name || 'Test Subject');
  out.push(item.base, '--------');
  if (item.quality) out.push(`Quality${item.qualityType ? ` (${item.qualityType})` : ''}: +${item.quality}% (augmented)`, '--------');
  out.push(`Item Level: ${item.ilvl}`);
  const rolled = [];
  if (item.mods.length) {
    out.push('--------');
    const order = item.mods.slice().sort((a, b) => (a.side === b.side ? 0 : a.side === 'prefix' ? -1 : 1));
    for (const m of order) {
      const km = kb.mods[m.id];
      const t = rollText(km.txt, r, adv);
      rolled.push({ id: m.id, values: t.values });
      if (adv) {
        const kind = (m.frac ? 'Fractured ' : '') + (m.des ? 'Desecrated ' : '') + (m.crafted ? 'Crafted ' : '') + (m.side === 'prefix' ? 'Prefix' : 'Suffix');
        out.push(`{ ${kind} Modifier${m.tier ? ` (Tier: ${m.tier})` : ''} }`);
        out.push(...t.lines);
      } else {
        const mark = m.frac ? ' (fractured)' : m.des ? ' (desecrated)' : m.crafted ? ' (crafted)' : '';
        out.push(...t.lines.map((l) => l + mark));
      }
    }
  }
  if (item.corrupted) out.push('--------', 'Corrupted');
  return { text: out.join('\n'), rolled };
}

/** Bases to test: per class the highest drop level base, and for armour one per attribute page (weights differ). */
function testBases() {
  const { kb, W } = load();
  const byKey = new Map();
  for (const [name, b] of Object.entries(kb.bases)) {
    if (/Flask|Charm/.test(b.cls) || b.unconfirmed_class) continue;
    if (!b.tl && b.cls !== 'Jewel') continue;
    const page = W.base_page[name] || b.cls;
    const key = b.cls + '|' + page;
    const cur = byKey.get(key);
    if (!cur || b.lvl > kb.bases[cur].lvl) byKey.set(key, name);
  }
  return [...byKey.values()].sort();
}

module.exports = { ROOT, E, P, load, weightsFor, essencesFor, classText, rng, roll, rollText, renderItem, testBases };
