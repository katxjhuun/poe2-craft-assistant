// A sweep scenario's networks by how many targets' blockers they follow and how many level classes they have: size,
// promise and (with crafts) play. node sizes.js <base> <id> [crafts] [classes:track,...]  (classes 1: no levels network)
const { NW, play, need, inputOf } = require('./common.js');
const [base, id, crafts, which] = process.argv.slice(2);
const sc = need(base, id), input = inputOf(sc);
const t0 = Date.now();
const pre = NW.build(Object.assign({}, input, { lite: 0, track: 0, maxStates: 150000, whittle: 'best' }));
if (pre.unsupported || pre.impossible) console.log('small network:', pre.unsupported || JSON.stringify(pre.impossible).slice(0, 200));
else console.log('small network (no blocker, omen at its best):', pre.N, 'nodes, natural targets', pre.goals.filter((g) => g.kind === 'nat').length, 'uses the omen', pre.usesIdeal(), 'cost', Math.round(pre.cost(pre.start)), ((Date.now() - t0) / 1000).toFixed(0) + ' s');
for (const [classes, track] of (which || '1:0,1:8,3:0,3:8').split(',').map((x) => x.split(':').map(Number))) {
  const t1 = Date.now();
  const n = NW.build(Object.assign({}, input, classes > 1 ? { lite: 0, track, maxStates: 400000, whittle: 'levels', classes } : { lite: 0, track, maxStates: 400000, whittle: 'none' }));
  if (n.unsupported || n.impossible) { console.log(classes, track, n.unsupported || 'impossible', n.states || ''); continue; }
  let line = `classes ${classes} track ${track} (followed ${n.track}): nodes ${n.N} promised ${Math.round(n.cost(n.start))} ${((Date.now() - t1) / 1000).toFixed(0)} s`;
  if (+crafts) { const got = play(n, input, +crafts, sc.seed, 200000, 900000); line += ` | played ${Math.round(got.mean)} +- ${Math.round(got.se)} x${(got.mean / n.cost(n.start)).toFixed(3)} done ${got.done}/${got.runs} gaveUp ${got.gaveUp}`; }
  console.log(line);
}
