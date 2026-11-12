/* The goal list: the craft goals every recommended route is checked on (reports/definition-of-done.md, measure 1).
 * Until the 1.0 trade demand gives the real list, it is made of the sweep's own scenarios (network_sweep.js): the ones
 * the deep runs found wrong or that are the pasted-item kind, and drawn sets of three targets or more spread over the
 * classes, in a fixed order, so the list does not change while the code does.
 *
 *   node scripts/targets.js            write app/data/targets_0.5.5.json (100 goals)
 *   node scripts/targets.js --check    every goal of the file is still made by the sweep as it was (same id, same targets)
 *
 * A goal is {id, base, n, cls, group, targets}: n is the sweep's index for the base (network_sweep.js scenario(base, n)),
 * targets a short description to see when the sweep's drawing changes under it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { testBases } = require('./selftest/lib.js');
const SW = require('./selftest/network_sweep.js');

const FILE = path.join(ROOT, 'app', 'data', 'targets_0.5.5.json');
const SIZE = 100;
const PER_CLASS = 6;

// The goals the nineteenth and seventeenth deep runs named (reports/network-sweep-2026-11-12.md): the networks whose
// values did not settle or promised a negative cost, the pasted-item kind ("rare, other modifiers, only item"), and the
// scenarios phase 1 replays through workflow B.
const NAMED = [
  ['unsettled', 'Fortified Hammer|set4|rare, other modifiers|only item|2'],
  ['unsettled', 'Grasping Mail|set6|rare, a target fractured|4'],
  ['unsettled', 'Seastorm Mantle|set4|rare, other modifiers|only item|2'],
  ['unsettled', 'Aegis Quarterstaff|set4|rare, other modifiers|only item|2'],
  ['unsettled', 'Corsair Coat|set4|rare, other modifiers|only item|2'],
  ['unsettled', 'Grand Manchettes|set4|rare, other modifiers|only item|2'],
  ['promise too high', 'Blacksteel Sabatons|or3|IncreasedLife+LocalBaseArmourAndEvasionRating+IncreasedMana|8'],
  ['refused bone steps', 'Dueling Wand|set5|rare, an unwanted desecrated modifier|13'],
  ['never ended (run 17)', 'Wrath Sceptre|set4|rare, other modifiers|only item|2'],
  ...['Adherent Cuffs', 'Austere Garb', 'Drakeskin Boots', 'Fanatic Bow', 'Feathered Raiment', 'Grand Cuisses', 'Grand Regalia', 'Grand Spear',
    'Grasping Mail', 'Grinning Mask', 'Massive Mitts', 'Permafrost Staff', 'Polished Bracers', 'Sirenscale Gloves', 'Tasalian Focus', 'Thane Mail']
    .map((b) => ['pasted item', `${b}|set4|rare, other modifiers|only item|2`]),
];
// The classes of the definition of done first (weapons, body armour, rings, amulets, belts, jewels), then the rest.
const FIRST = /Wand|Staff|Sceptre|Bow|Crossbow|Mace|Spear|Quarterstaff|Claw|Dagger|Sword|Axe|Flail|Body Armour|Ring|Amulet|Belt|Jewel/;

function describe(sc) {
  return Object.values(sc.targets).map((t) => `${t.label || t.fam}${t.minTier ? ' T' + t.minTier : ''}${t.des ? ' (D)' : ''}`).join('; ');
}
function find(base, id) {
  for (let n = 0; n < 900; n++) {
    let sc = null;
    try { sc = SW.scenario(base, n); } catch (e) { sc = null; }
    if (sc && sc.id === base + '|' + id.slice(base.length + 1)) return { sc, n };
  }
  return null;
}
const firstDrawn = (base) => { const t = SW.table(base); return t.nat.prefix.length + t.nat.suffix.length + t.des.prefix.length + t.des.suffix.length; };

function make() {
  const out = [], ids = new Set();
  for (const [group, id] of NAMED) {
    const base = id.split('|')[0], got = find(base, id);
    if (!got) throw new Error('not made by the sweep any more: ' + id);
    out.push({ id, base, n: got.n, cls: got.sc.cls, group, targets: describe(got.sc) });
    ids.add(id);
  }
  // drawn sets of three targets or more, a base at a time in turn, the definition-of-done classes first
  const bases = testBases().map((b) => ({ b, cls: SW.table(b).cls })).sort((x, y) => (FIRST.test(y.cls) - FIRST.test(x.cls)) || x.b.localeCompare(y.b));
  for (let round = 0; out.length < SIZE && round < 200; round++) {
    for (const { b } of bases) {
      if (out.length >= SIZE) break;
      const n = firstDrawn(b) + round;
      let sc = null;
      try { sc = SW.scenario(b, n); } catch (e) { sc = null; }
      if (!sc || ids.has(sc.id) || Object.keys(sc.targets).length < 3) continue;
      // (a base gives one drawn goal a round; at most PER_CLASS drawn goals of a class, so that a class with many
      // weight pages, body armour, does not fill the list; the definition-of-done classes until they run out)
      if (out.filter((g) => g.group === 'drawn' && g.cls === sc.cls).length >= PER_CLASS) continue;
      if (!FIRST.test(sc.cls) && out.filter((g) => g.group === 'drawn' && !FIRST.test(g.cls)).length >= 20) continue;
      out.push({ id: sc.id, base: b, n, cls: sc.cls, group: 'drawn', targets: describe(sc) });
      ids.add(sc.id);
    }
  }
  return out;
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8')).goals;
    let bad = 0;
    for (const g of list) {
      let sc = null;
      try { sc = SW.scenario(g.base, g.n); } catch (e) { sc = null; }
      if (!sc || sc.id !== g.id || describe(sc) !== g.targets) { bad++; console.log('changed:', g.id, '->', sc ? sc.id : 'none'); }
    }
    console.log(`${list.length} goals, ${bad} changed`);
    process.exit(bad ? 1 : 0);
  }
  const goals = make();
  const byGroup = {}, byCls = {};
  for (const g of goals) { byGroup[g.group] = (byGroup[g.group] || 0) + 1; byCls[g.cls] = (byCls[g.cls] || 0) + 1; }
  fs.writeFileSync(FILE, JSON.stringify({ meta: { made: 'node scripts/targets.js', patch: '0.5.5', note: 'Until the 1.0 trade demand: the sweep\'s own scenarios (see scripts/targets.js).', size: goals.length, groups: byGroup, classes: byCls }, goals }, null, 1) + '\n');
  console.log(`${FILE}: ${goals.length} goals`, JSON.stringify(byGroup), JSON.stringify(byCls));
}
module.exports = { FILE, make };
