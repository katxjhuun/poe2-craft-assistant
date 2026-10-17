// Where a scenario's network memory goes: heap before and after the build, edges and outcomes.
// node --expose-gc mem.js <base> <id> [track] [maxStates]
// (The edges are flat typed arrays since 17 Oct 2026: their memory is counted under "buffers", not "heap".)
const { NW, need, inputOf } = require('./common.js');
const [base, id, track, maxStates] = process.argv.slice(2);
const sc = need(base, id), input = inputOf(sc);
const use = () => { if (global.gc) global.gc(); return process.memoryUsage(); };
const mb = (m) => `heap ${(m.heapUsed / 1e6).toFixed(0)} MB, buffers ${(m.external / 1e6).toFixed(0)} MB, rss ${(m.rss / 1e6).toFixed(0)} MB`;
const m0 = use();
console.log('before:', mb(m0));
const t0 = Date.now();
const net = NW.build(Object.assign({}, input, { lite: 0, track: track == null ? 8 : +track, maxStates: +maxStates || 400000, whittle: 'none' }));
if (net.unsupported || net.impossible) { console.log(net.unsupported || 'impossible', net.states || ''); process.exit(0); }
console.log('built', net.N, 'nodes in', ((Date.now() - t0) / 1000).toFixed(0), 's, timing', JSON.stringify(net.timing));
// (the chunks a build filled are freed a little after it: a second look once they are gone)
setTimeout(() => { use(); setTimeout(() => report(), 300); }, 300);
function report() {
const m1 = use();
console.log('after:', mb(m1), '| peak rss', (process.resourceUsage().maxRSS / 1024).toFixed(0), 'MB');
let edges = 0, distinct = 0, outs = 0, flat = '';
if (net.storage) { const st = net.storage(); edges = st.edges; distinct = st.distinct; outs = st.outcomes; flat = ` | flat edge arrays ${(st.bytes / 1e6).toFixed(0)} MB`; }
else {
  const seen = new Set();
  for (let s = 0; s < net.N; s++) for (const e of net.acts[s]) { edges++; if (!seen.has(e)) { seen.add(e); outs += e.out.length / 2; } }
  distinct = seen.size;
}
const per = (b) => (b / net.N / 1024).toFixed(1) + ' KB';
const all = (m) => m.heapUsed + m.external; // (external: the typed arrays and other memory outside the heap)
console.log('edges', edges, 'distinct', distinct, 'outcomes', outs, '| per node: edges', (edges / net.N).toFixed(1), 'outcomes', (outs / net.N).toFixed(1),
  '| heap per node', per(m1.heapUsed), '| heap and buffers per node', per(all(m1)), '(the network:', per(all(m1) - all(m0)) + ')' + flat);
}
