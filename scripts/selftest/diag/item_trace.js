// Hand-made items in a scenario's network: the node each item is read as (and what that node does not know), the
// cheapest steps there, two walks by the network's own chances from it, and 30 plays from it (do they end?).
// node item_trace.js <base> <id> '[[["p"|"s", family, tier, "F|D|C"], ...], ...]'   (one list per item; F fractured,
// D desecrated, C crafted; the families as in stuck.js's items). It found the reader that took a modifier in a
// target's way for nobody's where the target's twin came first on the item (a sceptre's Fracturing Orb then locked it).
const { L, NW, SW, play, need, inputOf, words } = require('./common.js');
const P = L.P, E = L.E;
const [base, id, spec] = process.argv.slice(2);
const sc = need(base, id), input = inputOf(sc), { ix, kb } = L.load(), t = SW.table(base);
const t0 = Date.now();
const net = NW.route(input);
console.log(sc.id, '| nodes', net.N, 'track', net.track, 'promised', Math.round(net.cost(net.start)), Math.round((Date.now() - t0) / 1000), 's');
const short = (k) => { if (k < 0) return 'RESTART'; const w = net.describe(k); return `#${k} has[${w.has.length}] inWay[${w.inWay.join(';')}] twin[${w.twin.join(';')}] o${w.otherPrefixes}/${w.otherSuffixes}${w.desecratedOther ? ' dO' : ''}${w.fracturedOther ? ' fO' : ''}${w.hidden ? ' hid' : ''} v${Math.round(net.cost(k))}`; };
const r = L.rng(5);
for (const items of JSON.parse(spec)) {
  const mods = items.map(([s, fam, tier, fl]) => {
    const side = s === 'p' ? 'prefix' : 'suffix', f = t.nat[side].concat(t.des[side]).find((x) => x.fam === fam);
    if (!f) throw new Error('no family ' + fam);
    const tr = tier || f.tiers[0];
    return { id: f.ids[tr], side, tier: tr, frac: /F/.test(fl || ''), des: /D/.test(fl || ''), crafted: /C/.test(fl || '') };
  });
  const text = L.renderItem({ base, cls: kb.bases[base].cls, rarity: 'Rare', ilvl: 82, name: 'Item In Hand', implicits: kb.bases[base].imp || [], mods }, L.rng(11), 'adv').text;
  const item = E.parseItem(ix, text).item;
  const st = P.toState(net.ctx, item, {});
  const node = net.nodeOf(st);
  console.log('\nITEM', items.map((x) => x.join(' ')).join(', '));
  console.log(' node', node, 'mapping', net.mapping(st), node >= 0 ? words(net, node).slice(0, 400) : '', '| hiddenBlocks', node >= 0 ? JSON.stringify(net.hiddenBlocks(st, node)) : '');
  if (node < 0) continue;
  console.log(' options:', net.options(node).slice(0, 6).map((o) => `${o.best ? '*' : ''}${o.names.join('+')} ${Math.round(o.total)}`).join(' | '));
  // (a walk by the network's own chances: where the network believes the item goes)
  for (let w = 0; w < 2; w++) {
    let s = node; const path = [];
    for (let i = 0; i < 400 && s >= 0 && !net.done(s); i++) {
      const step = net.step(s); if (!step) { path.push('NO STEP'); break; }
      let u = r(), to = step.out[step.out.length - 1];
      for (let q = 0; q < step.out.length; q += 2) { u -= step.out[q]; if (u <= 0) { to = step.out[q + 1]; break; } }
      if (to !== s) path.push(`${step.a.op}${step.a.side ? ':' + step.a.side : ''}${step.a.item ? ':' + step.a.item : ''} -> ${short(to)}`);
      s = to;
    }
    console.log(' walk', w, (net.done(s) ? 'DONE' : 'not done'), 'in', path.length, 'changes:\n   ' + path.slice(0, 14).join('\n   '));
  }
  const got = play(net, Object.assign({}, input, { item }), 30, 7, 4000, 120000, null, { keep: 3999 });
  console.log(' play from it: done', got.done + '/' + got.runs, 'mean', Math.round(got.mean), 'stuck', (got.kept || []).filter((c) => !c.ended).length, 'endWhy', JSON.stringify(got.endWhy));
  for (const c of (got.kept || []).filter((x) => !x.ended).slice(0, 1)) console.log('  stuck at', c.item, c.at.map(([k, n]) => k + ' x' + n + ' ' + short(k)).join(' ; '));
}
