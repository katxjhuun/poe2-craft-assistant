/* Check of the craft network (app/network.js) against the simulator.
 *
 * The network promises a cost from equations over item states that do not know which modifiers the "other" ones are.
 * Here its rule set is played on real items with planner.js, which knows every modifier, and the promise is compared
 * with what the played crafts cost on average. A scenario passes when the two agree within the tolerance or within
 * three standard errors of the played mean.
 *
 *   node scripts/selftest/network_check.js [--runs 2000] [--limit 40] [--tolerance 0.15] [--json out.json] [--seed 7]
 *
 * One process, one core: light enough to run next to the game; the full list is meant for the cloud workflow.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { ROOT, E, P, load, weightsFor, testBases, rng } = require('./lib.js');
const NW = require(path.join(ROOT, 'app', 'network.js'));
const { scenarios } = require('./scenarios.js');
const { startItem } = require('./mine.js');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; };

function inputFor(sc) {
  const { ix, kb, W, priceOf } = load();
  const item = startItem(sc);
  const cls = kb.bases[item.base].cls;
  return { ix, item, targets: sc.targets, locks: {}, priceOf, baseCost: 1, weights: weightsFor(item.base), essences: (W.essences || {})[cls] || [],
    quality: sc.qualityMode || (sc.quality ? 'use' : 'lock') };
}

/** Play the network's rule set on the item `runs` times (fewer when `limitMs` runs out). Returns { mean, se, done, steps, off, runs }. */
function play(net, input, runs, seed, maxSteps, limitMs, audit) {
  // audit: a Map that collects, per node passed, where the simulator's item went: node -> { n, to: Map(next node -> count) }
  let from = -1;
  const until = limitMs > 0 ? Date.now() + limitMs : 0;
  let played = 0;
  const ctx = net.ctx;
  const r = rng(seed);
  const lim = E.slotLimits({ rarity: 'Rare', slotDelta: ctx.slotDelta }, ctx.cls);
  const count = (st, side) => st.mods.filter((m) => m.side === side).length;
  const open = (st, side) => Math.max(0, lim[side] + (side === 'suffix' ? st.xSuffix || 0 : 0) - count(st, side)); // Serle's Triumph: one more suffix
  // (the order in which targets are taken at the Well of Souls is the network's: net.wellRank)
  const goals = net.goals.map((g, i) => [g, net.wellRank ? net.wellRank[i] : g.kind === 'des' ? -1 : 0]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  // The option to take at the Well of Souls: a target when one is offered (an offered modifier is never of a group
  // that is on the item, so a target that is offered is one the item lacks: also the one a bone has just replaced on
  // a full item). A smaller network (net.lite) takes the Well only for some of the natural targets: its rules do not
  // take the others there, so the play does not either.
  // (a target by value: an option whose tier can have the value, as the network counts it; the value is rolled when
  // the modifier is taken, and one under the wanted value is lifted afterwards)
  const fitsGoal = (e, g) => e.side === g.side && (g.minValue != null ? e.fam === g.fam && P.reaches(ctx, e.id, g) : P.meets({ fam: e.fam, tier: e.tier, des: true }, g, g.tier));
  const wanted = () => (opts) => {
    for (const g of goals) {
      if (g.kind === 'nat' && g.noWell) continue;
      const o = opts.find((e) => fitsGoal(e, g));
      if (o) return o;
    }
    return null;
  };
  // no target among the options: the highest one that is no target at all (the network counts it as an unwanted
  // Desecrated modifier)
  // (failing that, one of a target's family that does not meet it; only when all three are targets is one taken)
  // Not one that is in a target's way, though: a modifier of a target's group (a hybrid of it, a lower tier) keeps the
  // target out for as long as it is there, and no two options share a group, so another option is nearly always
  // there. The network counts the unwanted Desecrated modifier as one that blocks nothing; a player picks that way.
  const inWay = (e) => goals.some((g) => g.kind === 'nat' && e.side === g.side && (e.fam === g.fam || (g.grp || []).some((x) => (e.grp || []).includes(x))));
  const dull = (opts) => {
    const l = opts.slice().sort((x, y) => y.lvl - x.lvl);
    return l.find((e) => !inWay(e)) || l.find((e) => !goals.some((g) => e.fam === g.fam)) || l.find((e) => !goals.some((g) => fitsGoal(e, g))) || l[0] || null;
  };
  // Omen of Putrefaction, no target among the options: a desecrated-only option that is in no missing target's way,
  // the one whose groups take the most entries off the Well's list of the side (its next reveals draw from a shorter
  // list); with none, the highest base modifier that is in no missing target's way (network.js missTaken).
  const spare = (opts, st, side, floor) => {
    const live = P.revealPool(ctx, st, side, floor, null).excl;
    const lack = goals.filter((g) => g.side === side && !st.mods.some((m) => P.meets(m, g, g.tier) || P.nearMiss(m, g)));
    const way = (e) => lack.some((g) => e.fam === g.fam || (g.grp || []).some((x) => (e.grp || []).includes(x)));
    const isT = (e) => lack.some((g) => g.kind === 'des' && fitsGoal(e, g));
    let best = null, most = 0;
    for (const o of opts) {
      if (!live.some((e) => e.id === o.id) || way(o)) continue;
      const n = live.filter((e) => !isT(e) && e.grp.some((x) => o.grp.includes(x))).length;
      if (n > most) { most = n; best = o; }
    }
    return best || dull(opts.filter((o) => !way(o))) || dull(opts);
  };
  const desMod = (e) => ({ id: e.id, fam: e.fam, side: e.side, lvl: e.lvl, grp: e.grp, tier: e.tier, frac: false, des: true, crafted: false, lock: false });
  const st0 = P.toState(ctx, input.item, input.locks);
  let sum = 0, sq = 0, done = 0, steps = 0, off = 0, refused = 0;
  for (let n = 0; n < runs; n++) {
    if (until && (n & 255) === 0 && n >= 2000 && Date.now() > until) break;
    if (n === 40 && done === 0) break; // not one of forty crafts ends: the rules and the simulator disagree, more plays say nothing
    played++;
    let st = { ...st0, mods: st0.mods.map((m) => ({ ...m })) };
    let cost = 0, k = 0, ok = false, lastA = null;
    from = -1;
    for (; k < maxSteps; k++) {
      // a locked item (Corrupted or Sanctified) is finished when every target is on it, else it is lost: a new base
      // (which the step that locked it has paid for)
      if (st.corrupted || st.sanctified) {
        if (net.finished && net.finished(st)) { ok = true; break; }
        st = P.apply(ctx, st, { op: 'newbase' }, r).state;
        st.corrupted = false; st.sanctified = false; st.destroyed = false;
        from = -1;
      }
      const node = net.nodeOf(st);
      // (for the audit: how much of the item the network knew: everything, not what a blocker's tags stop, not the blockers)
      if (audit && net.mapping && node >= 0) { const lv = net.mapping(st); (audit.maps = audit.maps || [0, 0, 0])[lv < 0 ? 2 : lv]++; }
      if (audit && from >= 0) { const rec = audit.get(from) || { n: 0, to: new Map() }; rec.n++; rec.to.set(node, (rec.to.get(node) || 0) + 1); audit.set(from, rec); }
      // (an item the network has no node for: kept with the step that led to it, for the audit)
      if (node < 0 && audit && from >= 0) (audit.offs = audit.offs || []).push({ from, a: lastA, state: net.stateOf ? JSON.stringify(net.stateOf(st, false)) : '', item: st.rarity + ' ' + st.mods.map((m) => `${m.side[0]}:${m.unrevealed ? '(hidden)' : m.fam}${m.tier ? ' T' + m.tier : ''}${m.frac ? '(F)' : ''}${m.des ? '(D)' : ''}${m.crafted ? '(C)' : ''}`).join(', ') });
      from = node;
      if (node < 0) { off++; break; }
      if (net.done(node)) { ok = true; break; }
      const step = net.step(node);
      if (!step) break;
      cost += step.cost;
      const a = step.a;
      lastA = a;
      if (a.op === 'reveal') {
        const i = st.mods.findIndex((m) => m.unrevealed);
        const side = st.mods[i].side;
        st.mods.splice(i, 1);
        const pick = wanted(st);
        let opts = P.revealOptions(ctx, st, side, 0, null, r), choice = pick(opts);
        if (!choice && a.echoes) { opts = P.revealOptions(ctx, st, side, 0, null, r); choice = pick(opts); }
        if (!choice) choice = dull(opts);
        if (choice) st.mods.push(desMod(choice));
      } else if (a.op === 'bone' && a.hide) {
        // as the simulator places a desecrated modifier, but left hidden
        let side = null;
        if (open(st, 'prefix') + open(st, 'suffix') === 0) {
          const c = st.mods.filter((m) => !m.frac && (!a.side || m.side === a.side));
          if (c.length) { const m = c[Math.floor(r() * c.length)]; st.mods.splice(st.mods.indexOf(m), 1); side = m.side; }
        } else {
          const c = (a.side ? [a.side] : ['prefix', 'suffix']).filter((s) => open(st, s) > 0);
          side = c.length ? c[Math.floor(r() * c.length)] : null;
        }
        if (side) st.mods.push({ id: null, fam: null, side, lvl: 0, grp: [], tier: null, frac: false, des: true, crafted: false, lock: false, unrevealed: true });
      } else if (a.op === 'catalyst') {
        for (let i = 0; i < a.count; i++) st = P.apply(ctx, st, a, r).state;
      } else {
        // (a step the simulator's rules refuse is a disagreement between the network and the rules: counted, and kept for the audit)
        const refuse = (x) => { const why = P.validate(ctx, st, x); if (why) { refused++; if (audit) (audit.refused = audit.refused || []).push({ from: node, a: x, why, item: st.rarity + ' ' + st.mods.map((m) => `${m.side[0]}:${m.unrevealed ? '(hidden)' : m.fam}${m.frac ? '(F)' : ''}${m.des ? '(D)' : ''}${m.crafted ? '(C)' : ''}`).join(', ') }); } };
        if (a.pre) { refuse(a.pre); st = P.apply(ctx, st, a.pre, r).state; }
        refuse(a);
        const pick = wanted(st);
        // (with Abyssal Echoes the first three options are declined when no target is among them: `again` is the reroll)
        st = P.apply(ctx, st, a, r, (opts, again, at, side) => pick(opts) || (a.echoes && !again ? null : a.putrefy ? spare(opts, at, side, a.quality === 'Ancient' ? 40 : 0) : dull(opts))).state;
        // (an Orb of Extraction destroys the item: the craft goes on with a new base, which the step's cost includes)
        if (a.op === 'extraction') { st = P.apply(ctx, st, { op: 'newbase' }, r).state; st.destroyed = false; }
      }
    }
    if (ok) { done++; sum += cost; sq += cost * cost; }
    steps += k;
  }
  const mean = done ? sum / done : NaN;
  const sd = done > 1 ? Math.sqrt(Math.max(0, sq / done - mean * mean)) : 0;
  return { mean, se: done ? sd / Math.sqrt(done) : NaN, sd, done, steps: steps / Math.max(1, played), off, refused, runs: played };
}

function check(sc, runs, seed, tol) {
  const input = inputFor(sc);
  const t0 = Date.now();
  const net = NW.build(input);
  const ms = Date.now() - t0;
  if (net.unsupported || net.impossible) return { id: sc.id, skipped: net.unsupported || 'impossible', ms };
  const s = net.start;
  const want = net.cost(s);
  if (net.done(s)) return { id: sc.id, skipped: 'already done', ms };
  // a craft that takes very many uses is played fewer times
  const stepsGuess = net.materials(s).reduce((t, m) => t + m.uses, 0);
  const n = Math.max(200, Math.min(runs, Math.round(4e6 / Math.max(1, stepsGuess))));
  const got = play(net, input, n, seed, Math.max(5000, Math.round(stepsGuess * 60)));
  const ratio = got.mean / want;
  const z = (got.mean - want) / (got.se || 1);
  const pass = got.done === n && got.off === 0 && (Math.abs(ratio - 1) <= tol || Math.abs(z) <= 3);
  return { id: sc.id, nodes: net.N, ms, runs: n, network: want, played: got.mean, se: got.se, ratio, z, sdNet: net.sd(s), sdPlayed: got.sd, done: got.done, off: got.off, uses: got.steps, pass };
}

if (require.main === module) {
  const runs = +arg('runs', 2000), limit = +arg('limit', 0), tol = +arg('tolerance', 0.15), seed = +arg('seed', 7);
  const only = arg('only', null);
  let list = scenarios(testBases());
  if (only) list = list.filter((sc) => sc.id.includes(only));
  if (limit) { const step = Math.max(1, Math.floor(list.length / limit)); list = list.filter((_, i) => i % step === 0).slice(0, limit); }
  const out = [];
  const t0 = Date.now();
  for (const sc of list) {
    let r;
    try { r = check(sc, runs, seed, tol); } catch (e) { r = { id: sc.id, error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
    out.push(r);
    const f = (x, d) => (x == null || isNaN(x) ? '—' : x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(d == null ? 1 : d));
    if (r.error) console.log(`ERROR ${r.id}: ${r.error}`);
    else if (r.skipped) console.log(`skip  ${r.id}: ${r.skipped}`);
    else console.log(`${r.pass ? 'ok   ' : 'FAIL '} ${r.id.padEnd(58)} net ${f(r.network).padStart(9)}  played ${f(r.played).padStart(9)} ±${f(r.se)}  x${f(r.ratio, 3)}  ${r.nodes} nodes ${r.ms} ms${r.off ? '  off-network ' + r.off : ''}${r.done < r.runs ? '  unfinished ' + (r.runs - r.done) : ''}`);
  }
  const done = out.filter((r) => r.pass != null);
  const bad = done.filter((r) => !r.pass);
  const ratios = done.map((r) => r.ratio).filter((x) => isFinite(x)).sort((a, b) => a - b);
  console.log(`\n${done.length} checked, ${done.length - bad.length} agree, ${bad.length} do not, ${out.filter((r) => r.skipped).length} skipped, ${out.filter((r) => r.error).length} errors; `
    + `played/network median ${ratios.length ? ratios[Math.floor(ratios.length / 2)].toFixed(3) : '—'}, range ${ratios.length ? ratios[0].toFixed(3) + ' to ' + ratios[ratios.length - 1].toFixed(3) : '—'}; ${Math.round((Date.now() - t0) / 1000)} s`);
  const json = arg('json', null);
  if (json) fs.writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), runs, tolerance: tol, results: out }, null, 1));
  process.exitCode = bad.length || out.some((r) => r.error) ? 1 : 0;
}
module.exports = { check, play, inputFor };
