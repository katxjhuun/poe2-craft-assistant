// Shared by the diagnostics in this folder: a sweep scenario by its id, and the input the sweep gives the network.
// Env: NWFILE (another network.js, e.g. the code before a change), POE2_PRICES (a cloud run's prices, see
// prices_from_log.js), POE2_OUT (a price folder; from a git worktree: the main checkout's .kb_cache/out).
const path = require('path');
const L = require('../lib.js');
const ROOT = L.ROOT;
const NW = require(process.env.NWFILE ? path.resolve(process.env.NWFILE) : path.join(ROOT, 'app', 'network.js'));
const SW = require('../network_sweep.js');
const { play } = require('../network_check.js');
/** The sweep's scenario with this id ("Base|kind|...|n"), or null. */
function scenarioById(base, id) {
  for (const plain of [true, false]) for (let n = 0; n < 800; n++) {
    let x = null;
    try { x = SW.scenario(base, n, plain); } catch (e) { x = null; }
    if (x && x.id === id) return x;
  }
  return null;
}
/** The network's input for a scenario, as the sweep makes it. */
function inputOf(sc, more) {
  const { ix, priceOf } = L.load();
  return Object.assign({ ix, item: sc.item, targets: sc.targets, locks: {}, priceOf, baseCost: 1, weights: L.weightsFor(sc.base), essences: SW.table(sc.base).essences,
    quality: sc.qualityMode, restart: sc.restart, itemCost: sc.itemCost }, more);
}
/** argv: base and id; exits with a message when the scenario is not there. */
function need(base, id) {
  const sc = scenarioById(base, id);
  if (!sc) { console.log('no scenario', id, 'for', base, '(ids look like "Base|set4|white|7"; the sweep log has them)'); process.exit(1); }
  return sc;
}
/** A node in words. */
function words(net, k) {
  if (k < 0) return 'NEW BASE';
  const w = net.describe(k);
  return `${w.rarity} has[${w.has.join('; ')}] miss[${w.miss.join('; ')}]${w.inWay.length ? ' inWay[' + w.inWay.join('; ') + ']' : ''}${w.twin.length ? ' twin[' + w.twin.join(';') + ']' : ''} others ${w.otherPrefixes}/${w.otherSuffixes}${w.desecratedOther ? ' desOther ' + w.desecratedOther : ''}${w.fracturedOther ? ' fracOther' : ''}${w.runes.length ? ' runes[' + w.runes.join(';') + ']' : ''}${w.hidden ? ' hidden ' + w.hidden : ''}`;
}
module.exports = { L, ROOT, NW, SW, play, scenarioById, inputOf, need, words };
