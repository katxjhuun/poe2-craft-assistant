// The sweep's scenarios of some bases whose id matches a pattern (up to k a base), run as the sweep runs them.
// node play_sweep.js <crafts> <k> <regex> <base> [base ...]
//   e.g. node play_sweep.js 2000 3 "\|or\d\|" "Dusk Ring" "Feathered Raiment"     (the "or" requests)
//        node play_sweep.js 1500 2 "\|set[45]\|white\|" "Warlord Cuirass"          (four or five targets, white)
const { SW } = require('./common.js');
const runs = +process.argv[2] || 2000, k = +process.argv[3] || 3, re = new RegExp(process.argv[4] || '\\|set[45]\\|white\\|'), bases = process.argv.slice(5);
for (const base of bases) {
  let got = 0;
  for (let n = 0; n < 800 && got < k; n++) {
    let sc = null; try { sc = SW.scenario(base, n, false); } catch (e) { sc = null; }
    if (!sc || !re.test(sc.id)) continue;
    got++;
    const t0 = Date.now(), res = SW.runOne(sc, runs, false, false, 12 * 60000);
    console.log(JSON.stringify({ id: res.id, nodes: res.nodes, track: res.track, whittle: res.whittle, network: res.network && +res.network.toFixed(1), played: res.played && +res.played.toFixed(1), se: res.se && +res.se.toFixed(1), ratio: res.ratio && +res.ratio.toFixed(3), done: res.done, runs: res.runs, gaveUp: res.gaveUp, off: res.off, refused: res.refused, skipped: res.skipped, error: res.error && String(res.error).slice(0, 160) }), Math.round((Date.now() - t0) / 1000) + ' s');
  }
}
