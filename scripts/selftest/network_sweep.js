/* The broad check of the craft network (app/network.js), made for the cloud workflow (.github/workflows/network.yml).
 *
 * Every gear class the tool covers (one base per class and weight page: weapons, armour of every attribute, off-hands,
 * jewellery, jewels; no uniques), targets drawn from every modifier such a base can have, and start items in every
 * kind of state: white, Magic, Rare with other modifiers, with targets already there, with a fractured modifier (a
 * target or not), with an unwanted Desecrated one, and with catalyst quality in each of the three quality modes.
 * Every sixth drawn scenario is one of the special requests in turn: a target by value, a resistance target on an item
 * that has another element's, a modifier of a rune's pool, four suffixes (Serle's Triumph), five modifiers on a jewel,
 * two crafted-only modifiers (Astrid's Creativity).
 *
 * For each scenario:
 *   1. the network is solved and its promised cost is compared with the simulator (planner.js) playing its rules;
 *   2. on a share of them the planner's old routes are simulated too: none should be clearly cheaper than the route
 *      the network found. Where one is, the network is missing a step the old routes have, and the report names it.
 *
 * The number of combinations is without end, so the scenarios come in a fixed order (every single modifier of every
 * base first, then drawn sets of two to six) and a run takes as many as its time allows:
 *
 *   node scripts/selftest/network_sweep.js --shard 0/5 --minutes 17 --json out.json
 *   node scripts/selftest/network_sweep.js --deep --runs 100000 --minutes 17      (every scenario played 100,000 times)
 *   node scripts/selftest/network_sweep.js --drawn --minutes 17      (skips the single modifiers: drawn sets and special requests)
 *
 * Without --deep a craft that takes very many uses is played fewer times, so that many scenarios fit; with it every
 * scenario is played --runs times, however long that takes, and the run covers fewer of them.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { ROOT, E, P, load, weightsFor, testBases, rng, renderItem } = require('./lib.js');
const NW = require(path.join(ROOT, 'app', 'network.js'));
const { play } = require('./network_check.js');
const { labelOf } = require('./scenarios.js');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; };
const SIDES = ['prefix', 'suffix'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a base can have: natural families per side with their tiers, desecrated-only families, and its context. */
const tables = new Map();
function table(base) {
  if (tables.has(base)) return tables.get(base);
  const { ix, kb, W } = load();
  const cls = kb.bases[base].cls;
  const white = E.parseItem(ix, renderItem({ base, cls, rarity: 'Normal', ilvl: 82, mods: [] }, rng(1), 'adv').text).item;
  const essences = (W.essences || {})[cls] || [];
  const ctx = P.makeContext(ix, white, { weights: weightsFor(base), essences });
  const group = (list) => {
    const by = new Map();
    for (const e of list) { let f = by.get(e.fam); if (!f) by.set(e.fam, f = { fam: e.fam, side: e.side, ids: {}, grp: e.grp }); if (!f.ids[e.tier] || e.id < f.ids[e.tier]) f.ids[e.tier] = e.id; }
    return [...by.values()].map((f) => Object.assign(f, { tiers: Object.keys(f.ids).map(Number).sort((a, b) => a - b) })).filter((f) => !/Essence/.test(f.fam));
  };
  const t = { base, cls, ctx, essences, nat: {}, des: {} };
  for (const side of SIDES) { t.nat[side] = group(P.sidePool(ctx, side, 0)); t.des[side] = ctx.bone ? group(P.desPoolFor(ctx, side, 0, null)) : []; }
  t.lim = E.slotLimits({ rarity: 'Rare', slotDelta: { prefix: 0, suffix: 0 } }, cls);
  tables.set(base, t);
  return t;
}
const target = (f, tier, des) => ({ fam: f.fam, group: des ? 'desecrated' : f.side, minTier: des ? null : tier, required: true, label: labelOf(f.ids[f.tiers[0]]) });

/** Other modifiers for a start item: random natural ones that share no group with the targets or each other. */
function junk(t, taken, counts, r) {
  const { kb } = load();
  const out = [];
  for (const side of SIDES) {
    const pool = [...t.ctx.pool.entries()].filter(([id, pe]) => pe.side === side && kb.mods[id].lvl <= 82 && !/Essence/.test(kb.mods[id].fam));
    for (let i = 0; i < counts[side]; i++) {
      const ok = pool.filter(([id]) => !kb.mods[id].grp.some((x) => taken.has(x)));
      if (!ok.length) break;
      const [id, pe] = ok[Math.floor(r() * ok.length)];
      kb.mods[id].grp.forEach((x) => taken.add(x));
      out.push({ id, side, tier: pe.tier });
    }
  }
  return out;
}

/**
 * A special request for a base (which: 0..5), or null when the base has no such case.
 * mk(id, kind, mods, rarity, targets): the scenario maker of `scenario`.
 */
function special(t, which, n, r, mk) {
  const { ix, kb } = load();
  const base = t.base;
  const pickFam = (side, k, skip) => {
    const out = [], taken = new Set(skip || []), list = t.nat[side];
    for (let tries = 0; out.length < k && tries < 80 && list.length; tries++) {
      const f = list[Math.floor(r() * list.length)];
      if (f.grp.some((x) => taken.has(x)) || out.includes(f)) continue;
      f.grp.forEach((x) => taken.add(x));
      out.push(f);
    }
    return out;
  };
  const tierOf = (f, low) => f.tiers[Math.min(f.tiers.length - 1, low + Math.floor(r() * 2))];
  if (which === 0) {
    // a target by value: at least a share of the best tier's range; white, or Rare with the modifier rolled as it comes
    const all = SIDES.flatMap((sd) => t.nat[sd]);
    for (let tries = 0; tries < 20; tries++) {
      const f = all[Math.floor(r() * all.length)], id = f.ids[f.tiers[0]];
      let range = null;
      try { range = P.rangeOf(t.ctx, id); } catch (e) { range = null; }
      if (!range || !(range[1] > range[0])) continue;
      const v = Math.round(range[0] + (range[1] - range[0]) * (n % 2 ? 0.8 : 0.5));
      const targets = { [f.side + '-0']: Object.assign(target(f, null), { minTier: null, minValue: v }) };
      const there = n % 4 >= 2;
      const mods = there ? [{ id, side: f.side, tier: f.tiers[0] }].concat(junk(t, new Set(f.grp), { prefix: Math.floor(r() * 2), suffix: Math.floor(r() * 2) }, r)) : [];
      return mk(`value|${f.fam}|${v}|${there ? 'there' : 'white'}|${n}`, `a target by value, ${there ? 'rare with the modifier' : 'white'}`, mods, there ? 'Rare' : 'Normal', targets);
    }
    return null;
  }
  if (which === 1) {
    // a resistance target on an item that has another element's resistance (a Flux converts it)
    const res = t.nat.suffix.filter((f) => /to (Fire|Cold|Lightning) Resistance$/.test(labelOf(f.ids[f.tiers[0]])));
    if (res.length < 2) return null;
    const a = res[n % res.length], b = res[(n + 1) % res.length];
    const tier = tierOf(a, 0);
    if (a === b || !b.ids[tier]) return null;
    const mods = [{ id: b.ids[tier], side: 'suffix', tier }].concat(junk(t, new Set(a.grp.concat(b.grp)), { prefix: Math.floor(r() * 2), suffix: Math.floor(r() * 2) }, r));
    return mk(`element|${a.fam}|T${tier}|${n}`, 'a resistance target, another element on the item', mods, 'Rare', { 'suffix-0': target(a, tier) });
  }
  if (which === 2) {
    // a modifier of a rune's pool (the rune has to be socketed first), alone or with a natural target
    const pools = E.runePoolsOn(ix, base);
    if (!pools.length) return null;
    const p = pools[n % pools.length];
    const es = [...p.mods.entries()].sort((x, y) => x[1].tier - y[1].tier || (x[0] < y[0] ? -1 : 1));
    if (!es.length) return null;
    const [id, pe] = es[Math.floor(r() * Math.min(es.length, 6))];
    const m = kb.mods[id];
    const targets = { [pe.side + '-0']: { fam: m.fam, group: 'rune', minTier: pe.tier, required: true, label: labelOf(id) } };
    if (n % 2) { const [f] = pickFam(pe.side === 'prefix' ? 'suffix' : 'prefix', 1, m.grp || []); if (f) targets[f.side + '-1'] = target(f, tierOf(f, 1)); }
    return mk(`pool|${p.tag}|${m.fam}|${n}`, "a modifier of a rune's pool, white", [], 'Normal', targets);
  }
  if (which === 3) {
    // one suffix more than the item takes: Serle's Triumph
    if (t.cls === 'Jewel' || !P.runeFor(t.ctx, /Suffix Modifiers? allowed/i)) return null;
    const sfx = pickFam('suffix', t.lim.suffix + 1);
    if (sfx.length < t.lim.suffix + 1) return null;
    const pre = n % 3 === 0 ? [] : pickFam('prefix', 1, sfx.flatMap((f) => f.grp));
    const targets = {};
    sfx.forEach((f, k) => { targets['suffix-' + k] = target(f, tierOf(f, 2)); });
    pre.forEach((f, k) => { targets['prefix-' + k] = target(f, tierOf(f, 2)); });
    return mk(`serle|${sfx.length + pre.length}|${n}`, "four suffixes (Serle's Triumph), white", [], 'Normal', targets);
  }
  if (which === 4) {
    // a jewel with three modifiers on one side (a liquid emotion's allowance modifier)
    if (t.cls !== 'Jewel') return null;
    const big = SIDES[n % 2], small = SIDES[1 - (n % 2)];
    const a = pickFam(big, t.lim[big] + 1);
    if (a.length < t.lim[big] + 1) return null;
    const b = pickFam(small, n % 3 === 0 ? 2 : 1, a.flatMap((f) => f.grp));
    const targets = {};
    a.forEach((f, k) => { targets[big + '-' + k] = target(f, tierOf(f, 1)); });
    b.forEach((f, k) => { targets[small + '-' + k] = target(f, tierOf(f, 1)); });
    return mk(`jewel5|${a.length + b.length}|${n}`, 'a jewel with three modifiers on one side, white', [], 'Normal', targets);
  }
  // two crafted-only modifiers: the second needs Astrid's Creativity
  if (!P.runeFor(t.ctx, /additional Crafted Modifier/i)) return null;
  const ess = t.essences.filter((e) => e.kind === 'rare' && !(kb.essence_outcomes || {})[e.item] && kb.mods[e.mod] && !t.ctx.pool.has(e.mod));
  const two = [];
  for (let tries = 0; two.length < 2 && tries < 40 && ess.length; tries++) {
    const e = ess[Math.floor(r() * ess.length)], m = kb.mods[e.mod];
    if (!two.some((x) => x.m.fam === m.fam || (x.m.grp || []).some((g) => (m.grp || []).includes(g)))) two.push({ e, m });
  }
  if (two.length < 2) return null;
  const targets = {};
  two.forEach(({ e, m }, k) => { targets[(m.gen === 'p' ? 'prefix' : 'suffix') + '-' + k] = { fam: m.fam, group: 'essence', minTier: null, required: true, label: labelOf(e.mod) }; });
  return mk(`crafted2|${two.map((x) => x.m.fam).join('+')}|${n}`, "two crafted-only modifiers (Astrid's Creativity), white", [], 'Normal', targets);
}

/**
 * The n-th scenario of a base (0, 1, 2, ...): singles first, then desecrated singles, then drawn sets. null when n is a
 * single past the list. plain: no special requests (the drawn set every index had before 8 Oct 2026, to replay an old run).
 */
function scenario(base, n, plain) {
  const { ix, kb } = load();
  const t = table(base);
  const singles = SIDES.flatMap((s) => t.nat[s]);
  const desSingles = SIDES.flatMap((s) => t.des[s]);
  const r = rng(7919 * (n + 1) + base.length * 31 + base.charCodeAt(0));
  const mk = (id, kind, mods, rarity, targets, extra) => {
    const item = E.parseItem(ix, renderItem(Object.assign({ base, cls: t.cls, rarity, ilvl: 82, mods }, extra && extra.quality ? { quality: extra.quality, qualityType: extra.qualityType } : null), r, 'adv').text).item;
    return { id: `${base}|${id}`, base, cls: t.cls, kind, item, targets, qualityMode: (extra && extra.mode) || 'lock', seed: 1000 + n };
  };
  if (n < singles.length) {
    const f = singles[n];
    return mk(`one|${f.fam}|T${f.tiers[0]}`, 'one modifier, white', [], 'Normal', { [f.side + '-0']: target(f, f.tiers[0]) });
  }
  n -= singles.length;
  if (n < desSingles.length) {
    const f = desSingles[n];
    const taken = new Set(f.grp);
    return mk(`desecrated|${f.fam}`, 'one desecrated modifier, rare', junk(t, taken, { prefix: 1 + Math.floor(r() * 2), suffix: 1 + Math.floor(r() * 2) }, r), 'Rare', { [f.side + '-2']: target(f, null, true) });
  }
  n -= desSingles.length;
  // every sixth: a special request, in turn (a base without that case gets a drawn set instead)
  if (n % 6 === 5 && !plain) { const sp = special(t, Math.floor(n / 6) % 6, n, r, mk); if (sp) return sp; }
  // a drawn set of two to six targets (jewels: up to four), tiers within three of the best
  const maxK = Math.min(6, t.lim.prefix + t.lim.suffix);
  const k = 2 + (n % Math.max(1, maxK - 1));
  const picked = [], taken = new Set(), per = { prefix: 0, suffix: 0 };
  let des = null;
  for (let tries = 0; picked.length < k && tries < 60; tries++) {
    const side = SIDES[Math.floor(r() * 2)];
    if (per[side] >= t.lim[side]) continue;
    const wantDes = !des && t.des[side].length && r() < 0.12;
    const list = wantDes ? t.des[side] : t.nat[side];
    if (!list.length) continue;
    const f = list[Math.floor(r() * list.length)];
    if (f.grp.some((x) => taken.has(x)) || picked.some((p) => p.f.fam === f.fam)) continue;
    f.grp.forEach((x) => taken.add(x));
    per[side]++;
    const tier = wantDes ? null : f.tiers[Math.min(f.tiers.length - 1, Math.floor(r() * 3))];
    if (wantDes) des = f;
    picked.push({ f, tier, des: wantDes });
  }
  if (picked.length < 2) return null;
  const targets = {};
  const idx = { prefix: 0, suffix: 0 };
  for (const p of picked) targets[p.f.side + '-' + idx[p.f.side]++] = target(p.f, p.tier, p.des);
  const room = (side, have) => Math.max(0, t.lim[side] - have);
  const kind = n % 7;
  const names = ['white', 'magic', 'rare, other modifiers', 'rare, some targets there', 'rare, a target fractured', 'rare, another modifier fractured', 'rare, an unwanted desecrated modifier'];
  // catalyst quality on the classes that take catalysts, in each of the three modes in turn
  const takes = t.cls === 'Jewel' || t.cls === 'Ring' || t.cls === 'Amulet';
  let extra = null;
  if (takes && kind >= 2) {
    const mode = ['lock', 'use', 'raise'][Math.floor(n / 7) % 3];
    const tags = Object.keys(P.CATALYST_NAME).filter((tag) => picked.some((p) => !p.des && (ix.famMods.get(p.f.fam) || []).some((id) => (kb.mods[id].mt || []).includes(tag))));
    if (mode !== 'lock' && tags.length) extra = { mode, quality: mode === 'use' ? 20 : (n % 2 ? 0 : 10), qualityType: cap(tags[0]) + ' Modifiers' };
    else if (mode !== 'lock') extra = { mode };
  }
  const tag = `set${picked.length}|${names[kind]}${extra ? '|quality ' + extra.mode : ''}|${n}`;
  if (kind === 0) return mk(tag, `${picked.length} targets, ${names[kind]}`, [], 'Normal', targets);
  if (kind === 1) {
    // one modifier: a target at its tier, or another one
    const p = picked.find((x) => !x.des);
    const mods = p && r() < 0.5 ? [{ id: p.f.ids[p.tier], side: p.f.side, tier: p.tier }] : junk(t, new Set(taken), r() < 0.5 ? { prefix: 1, suffix: 0 } : { prefix: 0, suffix: 1 }, r);
    return mk(tag, `${picked.length} targets, ${names[kind]}`, mods, 'Magic', targets);
  }
  const mods = [];
  const have = { prefix: 0, suffix: 0 };
  const nat = picked.filter((p) => !p.des);
  if (kind === 3 || kind === 4) for (const p of nat) if (r() < 0.45 || (kind === 4 && !mods.length)) { mods.push({ id: p.f.ids[p.tier], side: p.f.side, tier: p.tier }); have[p.f.side]++; }
  if (kind === 4 && mods.length) mods[0].frac = true;
  const counts = { prefix: Math.floor(r() * (room('prefix', have.prefix) + 1)), suffix: Math.floor(r() * (room('suffix', have.suffix) + 1)) };
  if (kind === 2 && counts.prefix + counts.suffix === 0) counts.suffix = Math.min(1, room('suffix', 0));
  const js = junk(t, new Set(taken), counts, r);
  if (kind === 5 && js.length) js[0].frac = true;
  if (kind === 6 && js.length && t.ctx.bone) js[0].des = true;
  return mk(tag, `${picked.length} targets, ${names[kind]}`, mods.concat(js), 'Rare', targets, extra);
}

// The planner's old routes, to see whether any is cheaper than the network's (their settings as the sweep verified them)
const RIVALS_RARE = [{}, { exaltTier: 'greater' }, { sideOmens: true }, { chaosTier: 'greater' }, { exaltTier: 'greater', removal: 'annul' }, { fracture: true },
  { desSlam: true, bone: 'Ancient', echoes: true, sideOmens: true }, { removal: 'whittle', sideOmens: true, exaltTier: 'greater', chaosTier: 'greater' },
  { removal: 'erasure', sideOmens: true, exaltTier: 'greater', chaosTier: 'greater' }, { greaterExalt: true }];
const RIVALS_START = [{ magicTier: 'greater' }, {}, { magicTier: 'perfect' }, { pair: true, magicTier: 'greater' }, { magicTier: 'greater', slamOnly: true }, { start: 'alchemy' }, { start: 'alchemy', slamOnly: true }];

function rivals(sc, input) {
  const { priceOf } = load();
  const ctx = P.makeContext(input.ix, input.item, { weights: input.weights, essences: input.essences });
  const st = P.toState(ctx, input.item);
  const { goals } = P.goalsFromTargets(ctx, input.targets);
  goals.forEach((g) => { g.eff = g.tier; });
  let best = null;
  const list = st.rarity === 'Rare' ? RIVALS_RARE : RIVALS_START.concat(RIVALS_RARE.slice(0, 5));
  for (const p of list) {
    let res;
    try { res = P.simulate(ctx, st, goals, P.expandStrategy(p), { trials: 300, seed: 17, priceOf, baseCost: 1, maxSteps: 600 }); } catch (e) { continue; }
    if (!(res.p >= 0.2) || (res.missingPrices && res.missingPrices.length)) continue;
    const cps = res.meanCost / res.p;
    if (!best || cps < best.cps) best = { cps, p: res.p, params: p, route: res.steps.slice(0, 4).map((x) => `${x.key} x${x.avg.toFixed(1)}`) };
  }
  return best;
}

function runOne(sc, runs, withRivals, deep, limitMs) {
  const { ix, priceOf } = load();
  const input = { ix, item: sc.item, targets: sc.targets, locks: {}, priceOf, baseCost: 1, weights: weightsFor(sc.base), essences: table(sc.base).essences, quality: sc.qualityMode };
  const t0 = Date.now();
  // (a network that is not solved within ten minutes is given up: "out of time" in the report. In the second deep run
  // 9 of 64 processes did not end before their job's limit, and a process that is cut prints no report at all.)
  const net = NW.route(Object.assign({ deadline: t0 + 10 * 60000 }, input));
  const out = { id: sc.id, cls: sc.cls, kind: sc.kind, ms: Date.now() - t0 };
  if (net.blocked) return Object.assign(out, { skipped: 'blocked: ' + net.blocked });
  if (net.unsupported) return Object.assign(out, { skipped: net.unsupported });
  if (net.impossible) return Object.assign(out, { skipped: 'impossible: ' + net.impossible[0].why });
  const s = net.start;
  if (net.done(s)) return Object.assign(out, { skipped: 'already done' });
  const want = net.cost(s);
  if (!(want < 1e12)) return Object.assign(out, { skipped: 'no route with the priced materials' });
  const stepsGuess = net.materials(s).reduce((x, m) => x + m.uses, 0);
  const n = deep ? runs : Math.max(120, Math.min(runs, Math.round(6e5 / Math.max(1, stepsGuess))));
  // a craft of thousands of uses, played 100,000 times, takes hours: such a scenario stops after 40 minutes and says how far it got
  // (near the end of the run the limit is what is left of it, so the process ends on time and its report is written)
  const got = play(net, input, n, sc.seed, Math.max(5000, Math.round(stepsGuess * 60)), deep ? Math.min(40 * 60000, limitMs > 0 ? limitMs : 40 * 60000) : 0);
  const ratio = got.mean / want, z = (got.mean - want) / (got.se || 1);
  Object.assign(out, { nodes: net.N, lite: net.lite || 0, runs: got.runs, asked: n, uses: got.steps, network: want, played: got.mean, se: got.se, ratio, z, done: got.done, off: got.off,
    // refused: steps of the route that the simulator's rules do not allow (the network and the rules disagree)
    refused: got.refused || 0, why: got.why || [], detours: got.detours || 0, detourWhy: got.detourWhy || [], endWhy: got.endWhy || [], futile: got.futile || 0, futileWhy: got.futileWhy || [], track: net.track, classes: net.classes, whittle: net.whittle, settled: net.settled !== false,
    pass: got.done === got.runs && got.off === 0 && !got.refused && net.settled !== false && (Math.abs(ratio - 1) <= 0.15 || Math.abs(z) <= 3) });
  if (withRivals) {
    const b = rivals(sc, input);
    if (b) Object.assign(out, { rival: b.cps, rivalRoute: b.route, rivalParams: b.params, rivalCheaper: b.cps < 0.85 * want });
  }
  return out;
}

if (require.main === module) {
  const [shard, shards] = String(arg('shard', '0/1')).split('/').map(Number);
  const minutes = +arg('minutes', 5), runs = +arg('runs', 1200), every = +arg('rivals', 15), deep = process.argv.includes('--deep');
  // --drawn: start after the single modifiers (they are the first scenarios of every base and were checked on their own)
  const drawn = process.argv.includes('--drawn');
  const firstDrawn = (base) => { const t = table(base); return t.nat.prefix.length + t.nat.suffix.length + t.des.prefix.length + t.des.suffix.length; };
  const bases = testBases();
  const deadline = Date.now() + minutes * 60000;
  const jsonOut = arg('json', null);
  const out = [];
  let i = 0, round = 0, live = bases.length;
  // round by round over the bases, so every class is covered however short the run
  outer: while (live > 0 && round < 100000) {
    live = 0;
    for (const base of bases) {
      const mine = i++ % shards === shard;
      let sc = null;
      try { sc = scenario(base, round + (drawn ? firstDrawn(base) : 0)); } catch (e) { if (mine) out.push({ id: `${base}|#${round}`, error: 'scenario: ' + String(e && e.message || e) }); }
      if (sc) live++;
      if (!sc || !mine) continue;
      let res;
      try { res = runOne(sc, runs, every > 0 && out.length % every === 0, deep, Math.max(60000, deadline + 5 * 60000 - Date.now())); } catch (e) { res = { id: sc.id, cls: sc.cls, kind: sc.kind, error: String(e && e.stack || e).split('\n').slice(0, 2).join(' | ') }; }
      out.push(res);
      // (the results so far, after every scenario: a process that is stopped before its report still leaves them)
      if (jsonOut) { try { fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), shard, shards, minutes, partial: true, results: out })); } catch (e) { /* the report at the end still comes */ } }
      if (Date.now() > deadline) break outer;
    }
    live = bases.length; // drawn sets never end: only the clock stops the run
    round++;
  }
  // ---- summary
  const checked = out.filter((r) => r.pass != null), bad = checked.filter((r) => !r.pass), errors = out.filter((r) => r.error), skipped = out.filter((r) => r.skipped);
  const ratios = checked.map((r) => r.ratio).filter(isFinite).sort((a, b) => a - b);
  const q = (p) => (ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))].toFixed(3) : '—');
  const byCls = new Map();
  for (const r of out) { const c = byCls.get(r.cls || '?') || { n: 0, ok: 0, bad: 0, skip: 0, err: 0 }; c.n++; if (r.pass) c.ok++; else if (r.pass === false) c.bad++; else if (r.skipped) c.skip++; else c.err++; byCls.set(r.cls || '?', c); }
  const skipWhy = new Map();
  for (const r of skipped) { const k = r.skipped.replace(/: .*/, ''); skipWhy.set(k, (skipWhy.get(k) || 0) + 1); }
  const riv = out.filter((r) => r.rival != null), cheaper = riv.filter((r) => r.rivalCheaper);
  const lines = [];
  lines.push(`## Craft network sweep, shard ${shard + 1} of ${shards}`, '',
    `${out.length} scenarios in ${minutes} min (rounds: ${round + 1} per base${deep ? `; every scenario played ${runs.toLocaleString('en-US')} times` : ''}): ${checked.length} checked against the simulator, ${checked.length - bad.length} agree, ${bad.length} do not, ${skipped.length} outside the network, ${errors.length} errors.`,
    `Played cost / promised cost: median ${q(0.5)}, 5% ${q(0.05)}, 95% ${q(0.95)}.`,
    `Crafts played: ${checked.reduce((x, r) => x + r.runs, 0).toLocaleString('en-US')} in all${deep ? `; ${checked.filter((r) => r.runs >= r.asked).length} scenarios with all ${runs.toLocaleString('en-US')}, ${checked.filter((r) => r.runs < r.asked).length} cut short at 40 minutes` : ''}.`,
    `Old routes simulated on ${riv.length} scenarios: clearly cheaper than the network's route on ${cheaper.length}.`, '',
    '| Class | Scenarios | Agree | Do not | Outside | Errors |', '|---|---|---|---|---|---|',
    ...[...byCls.entries()].sort().map(([c, v]) => `| ${c} | ${v.n} | ${v.ok} | ${v.bad} | ${v.skip} | ${v.err} |`), '',
    'Outside the network: ' + ([...skipWhy.entries()].map(([k, v]) => `${k} (${v})`).join(', ') || 'none'), '');
  if (bad.length) lines.push('### Promise and play disagree', '', ...bad.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1)).slice(0, 25).map((r) => `- ${r.id}: promised ${r.network.toFixed(1)}, played ${isFinite(r.played) ? r.played.toFixed(1) : '—'} (x${isFinite(r.ratio) ? r.ratio.toFixed(2) : '—'}), ${r.nodes} nodes${r.off ? ', ' + r.off + ' runs left the network' : ''}${r.refused ? ', ' + r.refused + ' steps the rules refuse (' + (r.why || []).join('; ') + ')' : ''}${r.detours ? ', ' + r.detours + ' detours' : ''}${r.futile ? ', ' + r.futile + ' items given up as futile' : ''}${r.settled === false ? ', values not settled' : ''}${r.done < r.runs ? ', ' + (r.runs - r.done) + ' unfinished' + ((r.endWhy || []).length ? ' (' + r.endWhy.join('; ') + ')' : '') : ''}`), '');
  // steps the rules refused on the item in hand, where another step was taken (the node did not know what was in a target's way)
  const detoured = out.filter((r) => r.detours > 0);
  if (detoured.length) {
    const reasons = new Map();
    for (const r of detoured) for (const t of r.detourWhy || []) { const m = /^(\d+)x (.*)$/.exec(t); if (m) reasons.set(m[2], (reasons.get(m[2]) || 0) + +m[1]); }
    lines.push('### Detours', '', `${detoured.length} scenarios took another step where the rules refused the route's on the item in hand (${detoured.reduce((x, r) => x + r.detours, 0).toLocaleString('en-US')} times in all):`,
      ...[...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => `- ${c.toLocaleString('en-US')}x ${k}`), '');
  }
  // items given up because a step that should long have worked had not (a blocker the node does not know)
  const gaveUp = out.filter((r) => r.futile > 0);
  if (gaveUp.length) lines.push('### Items given up as futile', '', `${gaveUp.length} scenarios (${gaveUp.reduce((x, r) => x + r.futile, 0).toLocaleString('en-US')} items in ${gaveUp.reduce((x, r) => x + r.runs, 0).toLocaleString('en-US')} crafts): a step that should have added a target with all but one chance in ten thousand had not; the item holds a modifier in the target's way that its node does not know.`,
    ...gaveUp.sort((a, b) => b.futile / b.runs - a.futile / a.runs).slice(0, 6).map((r) => `- ${r.id}: ${r.futile} in ${r.runs} crafts, track ${r.track}, ${r.whittle} (${(r.futileWhy || []).slice(0, 2).join('; ')})`), '');
  if (cheaper.length) lines.push('### An old route is cheaper', '', ...cheaper.sort((a, b) => a.rival / a.network - b.rival / b.network).slice(0, 25).map((r) => `- ${r.id}: network ${r.network.toFixed(1)}, old route ${r.rival.toFixed(1)} (${JSON.stringify(r.rivalParams)}: ${r.rivalRoute.join(', ')})`), '');
  if (errors.length) lines.push('### Errors', '', ...errors.slice(0, 15).map((r) => `- ${r.id}: ${r.error}`), '');
  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  const json = arg('json', null);
  if (json) fs.writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), shard, shards, minutes, results: out }));
  process.exitCode = errors.length ? 1 : 0;
}
module.exports = { scenario, table, runOne, special };
