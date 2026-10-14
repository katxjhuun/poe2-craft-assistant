// One sweep scenario exactly as the sweep runs it (deep: items valued by a route solved again from them).
// node run_one.js <base> <id> [crafts] [deep]
const { SW, need } = require('./common.js');
const [base, id, runs, deep] = process.argv.slice(2);
const sc = need(base, id), t0 = Date.now();
const res = SW.runOne(sc, +runs || 100, false, deep === 'deep', 20 * 60000);
console.log(JSON.stringify({ id: res.id, nodes: res.nodes, track: res.track, whittle: res.whittle, network: res.network && Math.round(res.network), played: res.played && Math.round(res.played), se: res.se && Math.round(res.se), ratio: res.ratio && +res.ratio.toFixed(3), runs: res.runs, done: res.done, detours: res.detours, gaveUp: res.gaveUp, valued: res.valued, solves: res.solves, endWhy: (res.endWhy || []).slice(0, 2), skipped: res.skipped }), Math.round((Date.now() - t0) / 1000), 's');
