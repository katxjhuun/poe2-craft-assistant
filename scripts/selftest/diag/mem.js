// Where a scenario's network memory goes: heap before and after the build, edges and outcomes.
// node --expose-gc mem.js <base> <id> [track] [maxStates]
const { NW, need, inputOf } = require('./common.js');
const [base, id, track, maxStates] = process.argv.slice(2);
const sc = need(base, id), input = inputOf(sc);
const mb = () => { if (global.gc) global.gc(); const m = process.memoryUsage(); return `heap ${(m.heapUsed / 1e6).toFixed(0)} MB, buffers ${((m.external + m.arrayBuffers) / 1e6).toFixed(0)} MB, rss ${(m.rss / 1e6).toFixed(0)} MB`; };
console.log('before:', mb());
const t0 = Date.now();
const net = NW.build(Object.assign({}, input, { lite: 0, track: track == null ? 8 : +track, maxStates: +maxStates || 400000, whittle: 'none' }));
if (net.unsupported || net.impossible) { console.log(net.unsupported || 'impossible', net.states || ''); process.exit(0); }
console.log('built', net.N, 'nodes in', ((Date.now() - t0) / 1000).toFixed(0), 's, timing', JSON.stringify(net.timing));
console.log('after:', mb());
let edges = 0, outs = 0;
const distinct = new Set();
for (let s = 0; s < net.N; s++) for (const e of net.acts[s]) { edges++; if (!distinct.has(e)) { distinct.add(e); outs += e.out.length / 2; } }
console.log('edges', edges, 'distinct', distinct.size, 'outcomes', outs, '| per node: edges', (edges / net.N).toFixed(1), 'outcomes', (outs / net.N).toFixed(1), '| heap per node', (process.memoryUsage().heapUsed / net.N / 1024).toFixed(1), 'KB');
