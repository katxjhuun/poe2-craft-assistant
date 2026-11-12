// Shared by the diagnostics in this folder: a sweep scenario by its id, and the input the sweep gives the network.
// Env: NWFILE (another network.js, e.g. the code before a change), POE2_PRICES (a cloud run's prices, see
// prices_from_log.js), POE2_OUT (a price folder; from a git worktree: the main checkout's .kb_cache/out).
const path = require('path');
const L = require('../lib.js');
const ROOT = L.ROOT;
const NW = require(process.env.NWFILE ? path.resolve(process.env.NWFILE) : path.join(ROOT, 'app', 'network.js'));
// (the sweep and the play require app/network.js themselves: with NWFILE they get the other one too, else run_one.js
// and play_sweep.js ran the current network whatever NWFILE said)
if (process.env.NWFILE) require.cache[require.resolve(path.join(ROOT, 'app', 'network.js'))] = require.cache[require.resolve(path.resolve(process.env.NWFILE))];
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
/**
 * The network's input for a scenario, as the sweep makes it. POE2_V1=1: with PoE2 1.0 (Forgemarks, reforge, a second
 * fractured modifier); V1_ILVL: the item at that item level (Forgemarks work up to 64); V1_FORGE_PRICE: a price for the
 * Forgemark items, which have none before the exchange trades them (an assumption the caller states).
 */
function inputOf(sc, more) {
  const { ix, priceOf: own } = L.load();
  const v1 = process.env.POE2_V1 === '1';
  const forge = v1 && process.env.V1_FORGE_PRICE != null ? +process.env.V1_FORGE_PRICE : null;
  const priceOf = forge != null ? (n) => (n === 'Crimson Iron' || n === 'Scarlet Hide' || n === 'Vermilion Gold' ? forge : own(n)) : own;
  const item = process.env.V1_ILVL ? Object.assign({}, sc.item, { ilvl: +process.env.V1_ILVL }) : sc.item;
  return Object.assign({ ix, item, v1, targets: item === sc.item ? sc.targets : targetsAt(sc, item.ilvl), locks: {}, priceOf, baseCost: 1, weights: L.weightsFor(sc.base), essences: SW.table(sc.base).essences,
    quality: sc.qualityMode, restart: sc.restart, itemCost: sc.itemCost }, more);
}
/**
 * The scenario's targets on an item of a lower item level: each asks for the best tier of its family that rolls there
 * (the sweep's targets ask for the top tiers, which need item level 65 and more; Forgemarks work up to 64).
 */
function targetsAt(sc, ilvl) {
  const { ix, kb } = L.load();
  const top = new Map();
  for (const [id, pe] of L.E.poolFor(ix, kb.bases[sc.base].sig)) { const m = kb.mods[id]; if (m.lvl <= ilvl) top.set(m.fam, Math.min(top.get(m.fam) || 99, pe.tier || 99)); }
  const out = {};
  for (const [k, t] of Object.entries(sc.targets)) out[k] = t.minTier != null && top.has(t.fam) ? Object.assign({}, t, { minTier: Math.max(t.minTier, top.get(t.fam)) }) : t;
  return out;
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
module.exports = { L, ROOT, NW, SW, play, scenarioById, inputOf, targetsAt, need, words };
