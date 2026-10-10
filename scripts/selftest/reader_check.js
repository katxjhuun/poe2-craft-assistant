/* Reader check: every base of the knowledge base, and every modifier it can carry, written as item text in both copy
 * formats (Alt+Ctrl+C and Ctrl+C) and read back.
 *
 *   node scripts/selftest/reader_check.js [--class "Body Armour"] [--base "Grand Regalia"] [--limit N] [--json out.json]
 *
 * For each tag signature (bases that roll the same modifiers) one base carries every natural modifier of every tier,
 * every Desecrated modifier, every modifier an essence / alloy / liquid emotion can add there and every rune-pool
 * modifier; every other base is read with a few items (header, base name, class, item level and its own lines).
 * A modifier counts as read when the reader names exactly it, with its side, its marks and (Alt+Ctrl+C) its tier.
 * Ctrl+C text has no tier and no side: there the reader may name the modifier as one of several candidates
 * ("flagged"), which the page shows as a question; a wrong modifier without a flag is an error in either format.
 * Single process, a few minutes. */
const fs = require('fs');
const { E, P, load, essencesFor, rng, renderItem } = require('./lib');

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const onlyCls = arg('class'), onlyBase = arg('base'), limit = +(arg('limit') || 0), jsonOut = arg('json');

const { ix, kb } = load();
const ILVL = 86;
const sideOf = (m) => (m.gen === 'p' ? 'prefix' : 'suffix');

/** Every modifier this base can carry: [{id, side, tier, des, crafted}] (one entry per way it can be marked). */
function carried(base, b) {
  const item = { base, cls: b.cls, rarity: 'Rare', ilvl: ILVL, mods: [] };
  const ctx = P.makeContext(ix, item, { essences: essencesFor(b.cls) });
  const out = [], seen = new Set();
  const add = (id, side, tier, mark, rune) => {
    const k = id + '|' + (mark || '');
    if (seen.has(k) || !kb.mods[id] || !kb.mods[id].txt) return;
    seen.add(k);
    out.push({ id, side, tier: tier || 0, des: mark === 'des', crafted: mark === 'crafted', fam: kb.mods[id].fam, rune: rune || null });
  };
  for (const [id, pe] of ctx.pool) add(id, pe.side, pe.tier, null);
  for (const [id, pe] of ctx.desPool) add(id, pe.side, pe.tier, 'des');
  for (const r of ctx.essences) {
    const m = kb.mods[r.mod];
    if (!m) continue;
    const pe = ctx.pool.get(r.mod);
    add(r.mod, pe ? pe.side : sideOf(m), pe ? pe.tier : 0, 'crafted');
  }
  // the pools that a socketed rune opens (their modifiers show like natural ones)
  for (const p of E.runePoolsOn(ix, base)) for (const [id, pe] of p.mods) if (!ctx.pool.has(id)) add(id, pe.side, pe.tier, null, p.rune);
  return { ctx, mods: out };
}

/** Pack modifiers into items the game could show: distinct groups, the side limits, one crafted and one Desecrated. */
function pack(ctx, mods, cls) {
  const lim = cls === 'Jewel' ? 2 : 3;
  const items = [];
  const left = mods.slice();
  while (left.length) {
    const it = { mods: [], n: { prefix: 0, suffix: 0 }, grp: new Set(), txt: new Set(), des: 0, crafted: 0, rune: null };
    for (let i = 0; i < left.length;) {
      const m = left[i], km = kb.mods[m.id];
      const g = (km.grp && km.grp.length ? km.grp : [km.fam]);
      const tpl = E.template(km.txt);
      const blocks = (x, y) => { const at = E.addedTags(kb, [x.id]); return !!at && !!kb.mods[y.id].sw && E.tagBlocked(kb.mods[y.id], ctx.baseTags, at); };
      const tagged = it.mods.some((x) => blocks(x, m) || blocks(m, x));
      if (it.n[m.side] >= lim || g.some((x) => it.grp.has(x)) || it.txt.has(tpl) || (m.des && it.des) || (m.crafted && it.crafted) || tagged || (m.rune && it.rune && it.rune !== m.rune)) { i++; continue; }
      it.mods.push(m); it.n[m.side]++; g.forEach((x) => it.grp.add(x)); it.txt.add(tpl);
      if (m.rune) it.rune = m.rune;
      if (m.des) it.des = 1;
      if (m.crafted) it.crafted = 1;
      left.splice(i, 1);
      if (it.n.prefix >= lim && it.n.suffix >= lim) break;
    }
    if (!it.mods.length) { // (a modifier that fits beside nothing: alone)
      const m = left.shift();
      it.mods.push(m);
    }
    items.push(it.mods);
  }
  return items;
}

const T0 = () => ({ exact: 0, same: 0, flagged: 0, wrong: 0 });
const tally = { adv: T0(), simple: T0(), 'adv, rune gone': T0(), 'simple, rune gone': T0(), header: 0, items: 0, parses: 0 };
const wrong = new Map(); // "mode|mod id|read as" -> { n, bases: [..3] }
const note = (mode, kind, base, id, msg) => {
  const k = mode + '|' + kind + '|' + id + '|' + msg;
  const w = wrong.get(k) || { mode, kind, id, msg, n: 0, bases: [] };
  w.n++;
  if (w.bases.length < 3) w.bases.push(base);
  wrong.set(k, w);
};

function check(base, b, mods, r) {
  const rarity = mods.length > 2 || mods.filter((m) => m.side === 'prefix').length > 1 || mods.filter((m) => m.side === 'suffix').length > 1 ? 'Rare' : 'Magic';
  const rune = (mods.find((m) => m.rune) || {}).rune || null;
  tally.items++;
  // (a modifier of a rune's pool: once with its rune socketed, once with the rune gone, another one put over it)
  for (const [mode, gone] of rune ? [['adv', 0], ['simple', 0], ['adv', 1], ['simple', 1]] : [['adv', 0], ['simple', 0]]) {
    // every second item: its first plain modifier is fractured, and the item is Corrupted
    const fi = tally.items % 2 ? mods.findIndex((m) => !m.des && !m.crafted) : -1;
    const item = { base, cls: b.cls, rarity, ilvl: ILVL, runes: rune && !gone ? [rune] : [], corrupted: tally.items % 4 === 1,
      mods: mods.map((m, k) => ({ id: m.id, side: m.side, tier: m.tier, des: m.des, crafted: m.crafted, frac: k === fi })) };
    const T = tally[mode + (gone ? ', rune gone' : '')];
    const tag = mode + (gone ? ' (rune gone)' : '');
    const t = renderItem(item, r, mode);
    let p;
    try { p = E.parseItem(ix, t.text).item; } catch (e) { p = null; note(tag, 'threw', base, '-', String(e.message || e).slice(0, 80)); }
    tally.parses++;
    if (!p || p.base !== base || p.rarity !== rarity || p.ilvl !== ILVL || p.itemClass == null || !!p.flags.corrupted !== !!item.corrupted) {
      tally.header++;
      note(tag, 'header', base, '-', p ? `base ${p.base} / ${p.rarity} / ${p.ilvl}` : 'not read');
      continue;
    }
    const got = p.mods.slice();
    if (got.length !== mods.length && !got.some((x) => x.hybridAlt)) note(tag, 'count', base, mods.map((m) => m.id).join('+'), `${mods.length} modifiers written, ${got.length} read`);
    for (const m of item.mods.map((x, k) => Object.assign({}, mods[k], { frac: x.frac }))) {
      const i = got.findIndex((x) => x.modId === m.id);
      if (i >= 0 && !!got[i].fractured !== !!m.frac) { T.wrong++; note(tag, 'wrong', base, m.id, `fractured mark differs (read ${!!got[i].fractured})`); got.splice(i, 1); continue; }
      if (i >= 0) {
        const x = got.splice(i, 1)[0];
        const twin = mods.some((y) => y !== m && E.template(kb.mods[y.id].txt) === E.template(kb.mods[m.id].txt));
        let bad = '';
        if (x.slot !== m.side) bad = `side ${x.slot}, is ${m.side}`;
        else if ((mode === 'adv' || !twin) && (!!x.desecrated !== !!m.des || !!x.crafted !== !!m.crafted)) bad = `marks differ (read ${x.desecrated ? 'desecrated ' : ''}${x.crafted ? 'crafted' : ''})`;
        else if (mode === 'adv' && m.tier && !m.crafted && x.tier !== m.tier) bad = `tier ${x.tier}, is ${m.tier}`;
        if (bad) { T.wrong++; note(tag, 'wrong', base, m.id, bad); } else T.exact++;
        continue;
      }
      // (read as separate modifiers, with the hybrid named as the other reading: asked)
      const asAlt = got.find((x) => x.hybridAlt === m.id);
      if (asAlt) { T.flagged++; const n = kb.mods[m.id].txt.split('\n').length; got.splice(got.indexOf(asAlt), n); continue; }
      const near = got.find((x) => (x.candidates || []).some((c) => c.id === m.id)) || got.find((x) => (x.splitAlt || []).includes(m.id)) || got.find((x) => x.fam === m.fam);
      const listed = !!(near && ((near.candidates || []).some((c) => c.id === m.id) || (near.splitAlt || []).includes(m.id)));
      if (near) got.splice(got.indexOf(near), 1);
      // the same modifier under another id: one text, one family, one side, one kind, the same marks (two game
      // records of one Desecrated modifier, a lich's version of it): nothing a craft could tell apart
      const km = kb.mods[m.id], kn = near && near.modId ? kb.mods[near.modId] : null;
      if (kn && kn.fam === km.fam && kn.gen === km.gen && kn.dom === km.dom && E.template(kn.txt) === E.template(km.txt) && near.slot === m.side
        && !!near.desecrated === !!m.des && !!near.crafted === !!m.crafted && (mode === 'simple' || !m.tier || near.tier === m.tier || kn.dom === 'd')) { T.same++; continue; }
      // Ctrl+C has no tier: overlapping ranges of one family's tiers fit the value alike (the reader says so)
      if (listed && (near.ambiguous || (mode === 'simple' && near.tierAmbiguous && kn && kn.fam === km.fam && near.slot === m.side))) { T.flagged++; continue; }
      T.wrong++;
      note(tag, 'wrong', base, m.id, near ? `read as ${near.modId}${near.ambiguous ? ' (flagged, right one not listed)' : listed ? ' (right one listed, not flagged)' : ''}` : 'not read');
    }
  }
}

const t0 = Date.now();
const names = Object.keys(kb.bases).filter((n) => {
  const b = kb.bases[n];
  if (/Flask|Charm/.test(b.cls) || b.unconfirmed_class) return false;
  if (onlyCls && b.cls !== onlyCls) return false;
  if (onlyBase && n !== onlyBase) return false;
  return true;
});
const fullDone = new Set();
let nb = 0, full = 0;
for (const base of names) {
  if (limit && nb >= limit) break;
  nb++;
  const b = kb.bases[base];
  const r = rng(1 + nb);
  let c;
  try { c = carried(base, b); } catch (e) { note('-', 'threw', base, '-', 'pool: ' + String(e.message || e).slice(0, 80)); continue; }
  const key = b.cls + '|' + b.sig + '|' + (b.imp || []).join(',');
  const items = pack(c.ctx, c.mods, b.cls);
  if (!fullDone.has(key)) { fullDone.add(key); full++; for (const it of items) check(base, b, it, r); }
  else for (let i = 0; i < Math.min(4, items.length); i++) check(base, b, items[Math.floor(r() * items.length)], r);
  if (nb % 200 === 0) console.error(`${nb}/${names.length} bases, ${tally.parses} texts, ${Math.round((Date.now() - t0) / 1000)} s`);
}

const rows = [...wrong.values()].sort((a, b) => b.n - a.n);
const sum = (m) => tally[m].exact + tally[m].same + tally[m].flagged + tally[m].wrong;
const LABEL = { adv: 'Alt+Ctrl+C', simple: 'Ctrl+C', 'adv, rune gone': 'Alt+Ctrl+C, rune gone', 'simple, rune gone': 'Ctrl+C, rune gone' };
console.log(`bases ${nb} (every modifier on ${full} of them, a sample on the rest), items ${tally.items}, texts read ${tally.parses}, ${Math.round((Date.now() - t0) / 1000)} s`);
console.log(`headers not read: ${tally.header}`);
for (const m of Object.keys(LABEL)) console.log(`${LABEL[m]}: ${sum(m)} modifiers, exact ${tally[m].exact}, the same modifier under another id ${tally[m].same}, asked (flagged, the right one listed) ${tally[m].flagged}, wrong ${tally[m].wrong}`);
const kinds = {};
for (const w of rows) kinds[w.mode + ' ' + w.kind] = (kinds[w.mode + ' ' + w.kind] || 0) + w.n;
console.log('by kind:', JSON.stringify(kinds));
for (const w of rows.slice(0, 60)) console.log(`  ${w.mode} ${w.kind} x${w.n}  ${w.id}: ${w.msg}  [${w.bases.join('; ')}]`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ tally, rows }, null, 1));
process.exitCode = tally.header || Object.keys(LABEL).some((m) => tally[m].wrong) || rows.some((w) => w.kind === 'threw') ? 1 : 0;
