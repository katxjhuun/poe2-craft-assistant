// A craft that does not end where the item is never given up: the item it is stuck with, and what a route solved from
// that item says. node stuck.js <base> <id> [runs] [maxUses]
const path = require('path');
const { L, ROOT, NW, play, need, inputOf } = require('./common.js');
const E = require(path.join(ROOT, 'app', 'engine.js'));
const [base, id, runs, maxUses] = process.argv.slice(2);
const sc = need(base, id), input = inputOf(sc), { ix } = L.load(), kb = ix.kb;
const net = NW.route(input);
console.log(sc.id, '| nodes', net.N, 'track', net.track, 'whittle', net.whittle, 'promised', net.cost(net.start).toFixed(0));
console.log('targets:', net.goals.map((g, i) => `${i}: ${g.label} [${g.side}, ${g.kind}${g.tier ? ', T' + g.tier : ''}] fam ${g.fam}`).join(' | '));
const got = play(net, input, +runs || 600, sc.seed, +maxUses || 20000, 200000, null, { keep: (+maxUses || 20000) - 1 });
console.log('done', got.done + '/' + got.runs, 'kept', (got.kept || []).length);
for (const c of (got.kept || []).filter((x) => !x.ended).slice(0, 3)) {
  console.log('\nstuck with:', c.item);
  const top = c.at[0];
  if (top && top[0] >= 0) { const d = net.describe(top[0]), st = net.step(top[0]); console.log('  most uses at:', top[1], 'x', JSON.stringify({ has: d.has, miss: d.miss, inWay: d.inWay, others: d.otherPrefixes + '/' + d.otherSuffixes, des: d.desecratedOther, hidden: d.hidden }), '| step', st ? JSON.stringify(st.a).slice(0, 120) : null); }
  if (c.state.mods.some((m) => !m.id || m.unrevealed)) { console.log('  (a hidden modifier: not rendered)'); continue; }
  const text = L.renderItem({ base, cls: kb.bases[base].cls, rarity: c.state.rarity, ilvl: input.item.ilvl, name: 'Item In Hand', implicits: kb.bases[base].imp || [], mods: c.state.mods.map((m) => ({ id: m.id, side: m.side, tier: m.tier, frac: m.frac, des: m.des, crafted: m.crafted })) }, L.rng(11), 'adv').text;
  const item = E.parseItem(ix, text).item;
  for (const [name, opts] of [['no blocker followed, no omen', { lite: 0, track: 0, whittle: 'none', maxStates: 120000 }], ['all blockers followed, no omen', { lite: 0, track: 8, whittle: 'none', maxStates: 230000 }]]) {
    const t0 = Date.now(), n2 = NW.build(Object.assign({}, input, { item }, opts));
    console.log('  ' + name + ':', n2.unsupported || (n2.impossible ? 'IMPOSSIBLE: ' + n2.impossible[0].why.slice(0, 110) : 'cost ' + n2.cost(n2.start).toFixed(0) + ' nodes ' + n2.N + ' next ' + JSON.stringify((n2.step(n2.start) || {}).a).slice(0, 100)), Date.now() - t0, 'ms');
  }
}
