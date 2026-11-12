/* The replay gate on the goal list (reports/roadmap.md phase 1, items 2-4; app/gate.js has the rules).
 *
 * For every goal of app/data/targets_0.5.5.json: the network is solved, its answer passes the first check (settled,
 * not negative), its route is played by the simulator, and the verdict is "recommend" only when the 95% confidence
 * interval of the played cost lies within 2% of the promise and that of the success chance within 0.5 points; else
 * "unsure" (and "refused" where the first check failed). The route is also set beside the known recipes: the
 * crafters' standard routes and the library's recipes for the class, simulated by the planner; a recipe that is
 * cheaper per finished item is a defect. Each result carries its stamp (the ledger's hash, the hash of every rule
 * the route uses, the price date).
 *
 *   node scripts/gate.js --crafts 2000 --goals "Fortified|Corsair" --out gate.jsonl     a few goals, small scale
 *   node scripts/gate.js --crafts 100000 --shard 3/20 --out shard3.jsonl                 the cloud (.github/workflows/gate.yml)
 *   node scripts/gate.js --stale old.jsonl --out new.jsonl                               only the goals whose rules changed
 *   node scripts/gate.js --report a.jsonl b.jsonl ... > reports/gate-<date>.md           the results added up
 *
 * Options: --max-nodes n (skip a goal whose network is larger: the local small scale), --minutes m (stop starting
 * goals after m minutes), --rivals 0 (no recipe comparison), --rival-trials n (1000).
 * Env as the diagnostics: POE2_OUT, POE2_PRICES (with POE2_PRICES_DATE: the date of those prices).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./selftest/lib.js');
const ROOT = L.ROOT;
const NW = require(path.join(ROOT, 'app', 'network.js'));
const G = require(path.join(ROOT, 'app', 'gate.js'));
const SW = require('./selftest/network_sweep.js');
const { play } = require('./selftest/network_check.js');
const P = L.P;

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; };
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'data', 'rules_ledger.json'), 'utf8'));
const GOALS = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'data', 'targets_0.5.5.json'), 'utf8')).goals;

/** The date of the prices in use: the price folder's, or POE2_PRICES_DATE (else that file's date) for a run's prices. */
function priceDate() {
  if (process.env.POE2_PRICES) return process.env.POE2_PRICES_DATE || fs.statSync(process.env.POE2_PRICES).mtime.toISOString();
  const snap = L.load().snap;
  return (snap.meta && (snap.meta.updatedAt || snap.meta.at)) || null;
}

const routeActions = G.routeActions;
const stepName = (a) => (a.op === 'lock' ? "Hinekora's Lock" : a.item || a.op);

function inputOf(sc) {
  const { ix, priceOf } = L.load();
  return { ix, item: sc.item, targets: sc.targets, locks: {}, priceOf, baseCost: 1, weights: L.weightsFor(sc.base), essences: SW.table(sc.base).essences,
    quality: sc.qualityMode, restart: sc.restart, itemCost: sc.itemCost };
}

/** The known recipes for the goal: the crafters' standard routes and the library's recipes of the class. */
function knownRecipe(sc, input, trials) {
  const { lib } = L.load();
  const more = [];
  for (const r of lib.recipes) {
    if (r.verdict === 'rejected' || r.verdict === 'outdated' || !(r.classes.includes(sc.cls))) continue;
    const p = P.recipeParams ? P.recipeParams(r) : null;
    if (p && Object.keys(p).length) more.push(Object.assign({ recipe: r.id }, p));
  }
  return SW.rivals(sc, input, more, trials);
}

function runGoal(g, crafts, opts) {
  const t0 = Date.now();
  const sc = SW.scenario(g.base, g.n);
  const out = { id: g.id, group: g.group, cls: g.cls, crafts };
  if (!sc || sc.id !== g.id) return Object.assign(out, { error: 'the sweep makes another scenario at this index: ' + (sc ? sc.id : 'none') });
  const input = inputOf(sc);
  const net = NW.route(Object.assign({ deadline: t0 + 10 * 60000 }, input));
  out.solveMs = Date.now() - t0;
  if (net.blocked || net.unsupported || net.impossible) return Object.assign(out, { verdict: 'outside', why: [net.blocked || net.unsupported || (net.impossible[0] || {}).why] });
  out.nodes = net.N;
  if (opts.maxNodes && net.N > opts.maxNodes) return Object.assign(out, { verdict: 'skipped', why: [`${net.N} nodes, over --max-nodes ${opts.maxNodes}`] });
  const ans = NW.answer(input, { solved: { net, charge: 0 } });
  const { acts, nodes: reach } = routeActions(net);
  const st0 = P.toState(net.ctx, input.item, {});
  const about = { cls: sc.cls, poolRune: net.goals.some((x) => x.rune) || (st0.tags || []).length > 0, fractured: st0.mods.some((m) => m.frac) };
  const rules = G.rulesOfRoute(acts, about, LEDGER);
  out.stamp = G.stamp(LEDGER, rules, opts.priceDate);
  out.rules = rules.map((r) => r.id + ':' + r.status);
  out.reach = reach;
  out.settled = net.settled;
  if (ans.refused) return Object.assign(out, { verdict: 'refused', why: ans.refused, promised: ans.promised, ms: Date.now() - t0 });
  out.promised = ans.meanCost;
  out.firstStep = ans.next && ans.next.names ? { names: ans.next.names, hit: ans.next.hit } : null;
  out.options = (ans.options || []).map((o) => ({ names: o.names, total: o.total }));
  // the steps of the route, with how often the network says each is used per craft
  out.materials = (ans.steps || []).map((m) => ({ name: m.names[0], uses: m.avg, price: m.cost }));
  const costs = [], steps = new Map();
  const stepsGuess = net.materials(net.start).reduce((x, m) => x + m.uses, 0);
  const got = play(net, input, crafts, sc.seed, Math.max(5000, Math.round(stepsGuess * 60)), opts.limitMs || 0, null, { again: { max: 36, per: 3, ms: 60000 }, costs, steps });
  const v = G.verdict({ cost: ans.meanCost, p: 1 }, { runs: got.runs, done: got.done, mean: got.mean, sd: got.sd, success: got.done }, rules);
  Object.assign(out, {
    verdict: v.label, why: v.why, cost: v.cost, p: v.p, weak: v.weak, unknown: v.unknown, runs: got.runs, done: got.done,
    spread: G.spread(costs), hist: G.histogram(costs, 24),
    steps: [...steps.entries()].map(([name, r]) => ({ name, uses: r.uses, gain: r.gain, loss: r.loss })).sort((a, b) => b.uses - a.uses),
    detours: got.detours, gaveUp: got.gaveUp, off: got.off, refusedSteps: got.refused, refusedWhy: got.why, valued: got.valued, endWhy: got.endWhy, detourWhy: got.detourWhy,
  });
  if (opts.rivals) {
    let best = null;
    try { best = knownRecipe(sc, input, opts.rivalTrials); } catch (e) { best = { error: String(e && e.message || e) }; }
    if (best && best.cps) {
      const ratio = best.cps / ans.meanCost;
      // (a recipe within 5% is a tie: 1,000 planner crafts do not tell 5% apart on most routes)
      out.recipe = { cps: best.cps, p: best.p, params: best.params, route: best.route, ratio, beats: ratio < 0.95 };
    } else out.recipe = best && best.error ? { error: best.error } : null;
  }
  out.ms = Date.now() - t0;
  return out;
}

function report(files) {
  const rows = [];
  for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line));
  const by = (k) => rows.filter((r) => r.verdict === k).length;
  const fmt = (x) => (x == null || !isFinite(x) ? '-' : x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1));
  const lines = [`# Replay gate`, '', `Ledger \`${LEDGER.hash}\`; ${rows.length} goals: ${by('recommend')} recommend, ${by('unsure')} unsure, ${by('refused')} refused, ${by('outside')} outside, ${by('skipped')} skipped, ${rows.filter((r) => r.error).length} errors.`, '',
    '| Goal | Verdict | Promised | Played (95% CI) | Success | Median / P90 / worst | Known recipe | Why |', '|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const c = r.cost || {}, s = r.spread || {};
    lines.push(`| ${r.id} | ${r.verdict || 'error'} | ${fmt(r.promised)} | ${c.mean != null ? `${fmt(c.mean)} (${fmt(c.lo)} to ${fmt(c.hi)})` : '-'} | ${r.p ? (100 * r.p.hat).toFixed(2) + '%' : '-'} | ${s.n ? `${fmt(s.median)} / ${fmt(s.p90)} / ${fmt(s.worst)}` : '-'} | ${r.recipe && r.recipe.cps ? `x${r.recipe.ratio.toFixed(2)}${r.recipe.beats ? ' **beats**' : ''}` : '-'} | ${(r.why || [r.error || '']).join('; ').replace(/\|/g, '/')} |`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  if (process.argv.includes('--report')) { console.log(report(process.argv.slice(process.argv.indexOf('--report') + 1))); process.exit(0); }
  const crafts = +arg('crafts', 2000), minutes = +arg('minutes', 0), maxNodes = +arg('max-nodes', 0);
  const [shard, shards] = String(arg('shard', '0/1')).split('/').map(Number);
  const re = arg('goals', null) ? new RegExp(arg('goals')) : null;
  const outFile = arg('out', null);
  const opts = { maxNodes, rivals: arg('rivals', '1') !== '0', rivalTrials: +arg('rival-trials', 1000), priceDate: priceDate(), limitMs: +arg('limit-minutes', 0) * 60000 };
  // --stale: the goals whose stamp names a rule that changed since (or that have no result) run again; the rest are copied
  let keep = new Map();
  if (arg('stale', null)) for (const line of fs.readFileSync(arg('stale'), 'utf8').split('\n')) if (line.trim()) { const r = JSON.parse(line); if (r.stamp && !G.staleRules(r, LEDGER).length) keep.set(r.id, r); }
  const deadline = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  const list = GOALS.filter((g, i) => i % shards === shard && (!re || re.test(g.id)));
  if (outFile) fs.writeFileSync(outFile, '');
  let n = 0;
  for (const g of list) {
    if (deadline && Date.now() > deadline) { console.log('time is up; left:', list.length - n); break; }
    n++;
    let r;
    if (keep.has(g.id)) r = Object.assign({}, keep.get(g.id), { kept: true });
    else { try { r = runGoal(g, crafts, opts); } catch (e) { r = { id: g.id, error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; } }
    if (outFile) fs.appendFileSync(outFile, JSON.stringify(r) + '\n');
    const c = r.cost || {};
    console.log(`${(r.verdict || 'error').padEnd(9)} ${g.id}  ${r.nodes || '-'} nodes  promised ${r.promised != null ? Math.round(r.promised) : '-'}  played ${c.mean != null ? Math.round(c.mean) : '-'}  ${r.kept ? '(kept)' : ''} ${(r.why || [r.error || '']).join('; ').slice(0, 200)}`);
  }
}
module.exports = { runGoal, report };
