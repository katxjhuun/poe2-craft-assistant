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
const { ROOT, E, P, load, weightsFor, testBases, rng, renderItem } = require('./lib.js');
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

/**
 * Play the network's rule set on the item `runs` times (fewer when `limitMs` runs out). Returns { mean, se, done, steps, off, runs }.
 * opts.again {max, per, ms}: what the page does with an item its node does not know. The page solves again from
 * every pasted item, so a modifier that keeps a target out is known to it; the play has one network for the whole
 * scenario. Where a step can do nothing on the item in hand for that reason, the route is solved again from that
 * item and the craft ends there with the cost that route promises (at most `max` solves a scenario, `ms` each;
 * after `per` solves for one set of targets on the item and one set of targets kept out, their mean is used). Such crafts are counted as
 * valued. Without it (or past the limit) the play takes the node's next step that can do something.
 */
function play(net, input, runs, seed, maxSteps, limitMs, audit, opts) {
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
  let sum = 0, sq = 0, done = 0, steps = 0, off = 0, refused = 0, detours = 0;
  // why a step was refused, and why another one was used in its place: reason -> how often
  const whyOf = new Map(), detourWhy = new Map(), endWhy = new Map(), gaveUpWhy = new Map();
  let gaveUp = 0;
  // a step that removes a modifier may remove the one that is in a target's way (a bone does on a full item)
  // a new start: a white base, or with a bound route (net.bound) another item like the pasted one
  const another = (st) => (net.bound ? P.toState(ctx, input.item, input.locks) : P.apply(ctx, st, { op: 'newbase' }, r).state);
  const KEEP = opts && opts.keep > 0 ? [] : null;
  const words = (st) => st.rarity + ' ' + st.mods.map((m) => `${m.side[0]}:${m.unrevealed ? '(hidden)' : m.fam}${m.tier ? ' T' + m.tier : ''}${m.frac ? '(F)' : ''}${m.des ? '(D)' : ''}${m.crafted ? '(C)' : ''}`).join(', ');
  const AGAIN = opts && opts.again && net.N <= 90000 && !net.goals.some((g) => g.minValue != null) ? opts.again : null;
  const again = new Map();
  let solves = 0, valued = 0;
  const valueAgain = (st, node, hidden) => {
    if (!AGAIN) return null;
    // (one kind: the targets that are on the item, and the targets kept out; what else is on it differs from item to item)
    const key = net.states[node].g.map((x) => (x >= 1 && x <= 3 ? 1 : 0)).join('') + '|' + hidden.join(',');
    const got = again.get(key), mean = got && got.n ? got.sum / got.n : null;
    if (got && got.n >= AGAIN.per) return mean;
    // (an item the writer below cannot put into text as it is: runes that change the rules, a hidden modifier, quality)
    if (solves >= AGAIN.max || st.aldur || st.xCrafted || st.xSuffix || (st.tags || []).length || st.catQ || st.mods.some((m) => !m.id || m.unrevealed)) return mean;
    solves++;
    let v = null;
    try {
      const base = input.item.base;
      const text = renderItem({ base, cls: ctx.cls, rarity: st.rarity, ilvl: input.item.ilvl, name: 'Item In Hand', implicits: ctx.kb.bases[base].imp || [],
        mods: st.mods.map((m) => ({ id: m.id, side: m.side, tier: m.tier, frac: m.frac, des: m.des, crafted: m.crafted })) }, rng(seed + 7919 * solves), 'adv').text;
      const item = E.parseItem(ctx.ix, text).item;
      // (The small network: no blocker followed, no Omen of Whittling. The item's own blockers are known to it all
      // the same, it is there in seconds, and its route is one of the full network's, perhaps not the cheapest: the
      // craft is not valued too low. The full route from a body armour that is never given up took over the
      // minute and a half a solve may take, and nothing was valued.)
      const n2 = NW.build(Object.assign({}, input, { item, lite: 0, track: 0, whittle: 'none', maxStates: 120000, deadline: Date.now() + (AGAIN.ms || 90000) }));
      if (n2 && !n2.unsupported && !n2.impossible && !n2.blocked) { const c = n2.done(n2.start) ? 0 : n2.cost(n2.start); if (c >= 0 && c < 1e11) v = c; }
    } catch (e) { v = null; }
    if (v == null) return mean;
    const rec = got || { n: 0, sum: 0 };
    rec.n++; rec.sum += v;
    again.set(key, rec);
    return v;
  };
  const removes = (a, st) => a.op === 'chaos' || a.op === 'annul' || a.op === 'pessence' || a.op === 'liquid' || a.op === 'newbase' || a.op === 'extraction' || a.op === 'vaal'
    || (a.op === 'bone' && (a.putrefy || a.mark || (!a.hide && open(st, 'prefix') + open(st, 'suffix') === 0)));
  /** Can edge e of the node do nothing on this item: all it could add is among the targets kept out (blocked), and it removes nothing? */
  const futileOn = (node, e, st, blocked) => { if (removes(e.a, st)) return false; const adds = net.adds(node, e.out); return adds.length > 0 && adds.every((i) => blocked.includes(i)); };
  // what an item looks like, in a few words (for the reasons a craft did not end)
  const look = (st) => { const c = (f) => st.mods.filter(f).length; return `${st.rarity} ${c((m) => m.side === 'prefix')}/${c((m) => m.side === 'suffix')}${c((m) => m.crafted) ? ' crafted ' + c((m) => m.crafted) : ''}${c((m) => m.des && !m.unrevealed) ? ' desecrated ' + c((m) => m.des && !m.unrevealed) : ''}${c((m) => m.unrevealed) ? ' hidden' : ''}${c((m) => m.frac) ? ' fractured' : ''}${st.aldur ? ' aldur' : ''}${(st.tags || []).length ? ' pool rune' : ''}${st.xCrafted ? ' astrid' : ''}${st.xSuffix ? ' serle' : ''}`; };
  const note = (m, a, text) => { const k = `${a.op}${a.item ? ' ' + a.item : ''}: ${text}`; m.set(k, (m.get(k) || 0) + 1); };
  for (let n = 0; n < runs; n++) {
    if (until && (n & 15) === 0 && n >= 200 && Date.now() > until) break;
    if (n === 40 && done === 0) break; // not one of forty crafts ends: the rules and the simulator disagree, more plays say nothing
    played++;
    let st = { ...st0, mods: st0.mods.map((m) => ({ ...m })) };
    let cost = 0, k = 0, ok = false, lastA = null;
    from = -1;
    // (opts.keep: the crafts of more than that many uses are kept, with the nodes they spent them at)
    const spent = KEEP ? new Map() : null, turns = KEEP ? [] : null;
    // how often a node's step could do nothing on the item in hand (see "hidden" below)
    const stuck = new Map();
    for (; k < maxSteps; k++) {
      // a locked item (Corrupted or Sanctified) is finished when every target is on it, else it is lost: a new base
      // (which the step that locked it has paid for)
      if (st.corrupted || st.sanctified) {
        const fin = !!(net.finished && net.finished(st));
        // (for the audit: where the locking step led, finished or lost; it was the one step whose outcome was not kept,
        // and a Putrefaction that finished less often than promised showed in no node's share of the gap)
        if (audit && from >= 0) { const rec = audit.get(from) || { n: 0, to: new Map() }; rec.n++; const to = fin ? Math.max(-2, net.nodeOf(st)) : net.n0; rec.to.set(to, (rec.to.get(to) || 0) + 1); audit.set(from, rec); }
        // (and what the locked items were: finished, with a target's family under its tier or value, with every target's family but not all met, the rest)
        if (audit) { const L = (audit.locked = audit.locked || { n: 0, fin: 0, under: 0, fams: new Map() }); L.n++; if (fin) L.fin++; else { const k = goals.map((g) => (st.mods.some((m) => P.meets(m, g, g.tier)) ? 'M' : st.mods.some((m) => m.fam === g.fam) ? 'u' : '-')).join(''); L.fams.set(k, (L.fams.get(k) || 0) + 1); if (k.includes('u')) L.under++; } }
        if (fin) { ok = true; break; }
        st = another(st);
        st.corrupted = false; st.sanctified = false; st.destroyed = false;
        from = -1;
      }
      const node = net.nodeOf(st);
      if (spent) spent.set(node, (spent.get(node) || 0) + 1);
      // (what a Fracturing Orb or a Flux, the steps that change what a modifier is for good, did to the item)
      if (turns && lastA && (lastA.op === 'fracture' || lastA.op === 'flux') && turns.length < 40 && turns[turns.length - 1] !== k) { turns.push(k); turns.push(`use ${k} ${lastA.op}${lastA.to ? ' ' + lastA.to : ''} -> ${words(st)}`); }
      // (for the audit: how much of the item the network knew: everything, not what a blocker's tags stop, not the blockers)
      if (audit && net.mapping && node >= 0) { const lv = net.mapping(st); (audit.maps = audit.maps || [0, 0, 0])[lv < 0 ? 2 : lv]++; }
      if (audit && from >= 0) { const rec = audit.get(from) || { n: 0, to: new Map() }; rec.n++; rec.to.set(node, (rec.to.get(node) || 0) + 1); audit.set(from, rec); }
      // (an item the network has no node for: kept with the step that led to it, for the audit)
      if (node < 0 && audit && from >= 0) (audit.offs = audit.offs || []).push({ from, a: lastA, state: net.stateOf ? JSON.stringify(net.stateOf(st, true)) + ' (with what is known); ' + JSON.stringify(net.stateOf(st, false)) + ' (without)' : '', item: st.rarity + ' ' + st.mods.map((m) => `${m.side[0]}:${m.unrevealed ? '(hidden)' : m.fam}${m.tier ? ' T' + m.tier : ''}${m.frac ? '(F)' : ''}${m.des ? '(D)' : ''}${m.crafted ? '(C)' : ''}`).join(', ') });
      from = node;
      // (an item with every target on it is finished, also one the network has no node for: what else is on it does not matter any more)
      if (node < 0) { if (net.finished && net.finished(st)) { ok = true; break; } off++; note(endWhy, lastA || { op: 'start' }, 'left the network as ' + look(st)); break; }
      if (net.done(node)) { ok = true; break; }
      let step = net.step(node);
      if (!step) { note(endWhy, lastA || { op: 'start' }, 'no step for ' + look(st)); break; }
      // A step the rules refuse on this very item, where the network's node does not know what is in a target's way
      // (not every target's blockers are followed in a large network): the player sees the item and takes the next
      // cheapest step the rules allow. Counted as a detour, with the reason; the cost shows what it does to the promise.
      if (step.a.op !== 'lock' && step.a.op !== 'reveal' && !(step.a.op === 'bone' && step.a.hide) && step.a.op !== 'catalyst') {
        const bad = P.validate(ctx, st, step.a.pre || step.a);
        if (bad) {
          const alt = net.options(node).find((o) => !o.best && o.a.op !== 'lock' && !P.validate(ctx, st, o.a.pre || o.a));
          if (alt) { detours++; note(detourWhy, step.a, bad); step = alt; }
        }
        // The same for a step that can do nothing on this very item: every target it could add is kept out by a
        // modifier the node does not know (a lower tier of the target, one of its group, one whose tags stop it), and
        // the step removes no modifier. The route would take bone after bone and the craft would never end (4 of 500
        // on a ring whose "+# to all Attributes" was of too low a tier). The page builds the route again from every
        // pasted item and sees the modifier; the play, which keeps one network, takes the node's next cheapest step
        // that can still do something: one that removes a modifier, or adds another target, or a new base.
        // Where that brings the item back to the same node again and again (the other step hides a Desecrated modifier
        // that the next node cannot reveal usefully either), the item is given up for a new base at the sixth time:
        // the page's route for such an item is at least as good as that.
        const hidden = net.hiddenBlocks(st, node);
        if (hidden.length && futileOn(node, step, st, hidden)) {
          const why = 'a modifier the node does not know keeps ' + hidden.map((i) => net.goals[i].label).join(' + ') + ' out';
          const c = (stuck.get(node) || 0) + 1;
          stuck.set(node, c);
          const never = !!(net.bound && net.bound.mode === 'never');
          if (c > 5) {
            // The page would solve again from this item. Where the play's one network has come back to the same node
            // six times, the craft ends with what the route solved again from the item promises, when that is less
            // than giving the item up. (That route is the small network's, without Omen of Whittling: an upper bound.
            // It was taken at the first such step, before any other step was tried: in the twelfth deep run 87% of a
            // bow's crafts ended that way and "played" at x1.26 of a promise that the play without it meets, x1.00
            // over 2,500 crafts; an amulet at x1.52 with 54% of its crafts.)
            const v2 = valueAgain(st, node, hidden);
            const fresh = never ? Infinity : (net.price('New base') || 0) + net.cost(net.n0);
            if (v2 != null && v2 <= fresh) { cost += v2; valued++; ok = true; break; }
          }
          if (c > 5 && !never) {
            gaveUp++; note(gaveUpWhy, step.a, why + ' (' + look(st) + ')');
            st = another(st); st.destroyed = false;
            cost += net.price('New base') || 0;
            stuck.clear(); from = -1;
            continue;
          }
          const alt = net.options(node).find((o) => !o.best && o.a.op !== 'lock' && !P.validate(ctx, st, o.a.pre || o.a) && !futileOn(node, o, st, hidden));
          if (alt) { detours++; note(detourWhy, step.a, why); step = alt; }
        }
      }
      if (step.a.op === 'newbase') stuck.clear();
      let a = step.a;
      lastA = a;
      // (a step the simulator's rules refuse is a disagreement between the network and the rules: counted, and kept for the audit)
      const refuse = (x) => { const why = P.validate(ctx, st, x); if (why) { refused++; note(whyOf, x, why); if (audit) (audit.refused = audit.refused || []).push({ from: node, a: x, why, item: st.rarity + ' ' + st.mods.map((m) => `${m.side[0]}:${m.unrevealed ? '(hidden)' : m.fam}${m.frac ? '(F)' : ''}${m.des ? '(D)' : ''}${m.crafted ? '(C)' : ''}`).join(', ') }); } };
      if (a.op === 'lock') {
        // Hinekora's Lock: every currency the route looks at is used on a copy of the item (what the lock shows), and
        // the route says which of the results to take. Each copy has its own draws: the results of different currency
        // items are taken to be drawn apart (network.js LOCK).
        refuse({ op: 'hinekora' });
        st = P.apply(ctx, st, { op: 'hinekora' }, r).state;
        const seen = [];
        for (const c of net.lockSteps(node)) {
          let s2 = { ...st, mods: st.mods.map((m) => ({ ...m })) };
          const why = (c.a.pre && P.validate(ctx, s2, c.a.pre)) || null;
          if (c.a.pre) s2 = P.apply(ctx, s2, c.a.pre, r).state;
          const why2 = why || P.validate(ctx, s2, c.a);
          const pick = wanted(s2);
          s2 = P.apply(ctx, s2, c.a, r, (opts) => pick(opts) || dull(opts)).state;
          seen.push([c.k, s2, why2, c.a]);
        }
        const use = net.lockUse(node, seen);
        cost += use.cost;
        if (audit) { const L = audit.locks || (audit.locks = new Map()), rec = L.get(node) || { n: 0, y: 0, want: use.want, to: new Map() }; rec.n++; rec.y += use.y; const key = use.k != null ? use.k + '>' + use.to : use.burn ? 'burn' : 'rest'; rec.to.set(key, (rec.to.get(key) || 0) + 1); L.set(node, rec); }
        if (use.burn) { refuse({ op: 'divine' }); st = P.apply(ctx, st, { op: 'divine' }, r).state; continue; }
        if (use.k != null) {
          const hit = seen.find((x) => x[0] === use.k);
          if (hit[2]) { refused++; if (audit) (audit.refused = audit.refused || []).push({ from: node, a: hit[3], why: hit[2], item: 'with Hinekora\'s Lock' }); }
          st = hit[1];
          continue;
        }
        a = use.rest.a; // nothing shown is worth using: this step, unseen (its cost is counted above)
        st.foresight = false; // (whatever is used on the item spends the lock)
        lastA = a;
      } else cost += step.cost;
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
        if (a.pre) { refuse(a.pre); st = P.apply(ctx, st, a.pre, r).state; }
        refuse(a);
        const pick = wanted(st);
        // (with Abyssal Echoes the first three options are declined when no target is among them: `again` is the reroll)
        if (a.op === 'newbase' && net.bound) st = another(st);
        else st = P.apply(ctx, st, a, r, (opts, again, at, side) => pick(opts) || (a.echoes && !again ? null : a.putrefy ? spare(opts, at, side, a.quality === 'Ancient' ? 40 : 0) : dull(opts))).state;
        // (an Orb of Extraction destroys the item: the craft goes on with a new base, which the step's cost includes)
        if (a.op === 'extraction') { st = another(st); st.destroyed = false; }
      }
    }
    if (ok) { done++; sum += cost; sq += cost * cost; }
    else if (k >= maxSteps) note(endWhy, lastA || { op: 'start' }, `not finished within ${maxSteps} uses`);
    if (spent && k > opts.keep && KEEP.length < 12) KEEP.push({ uses: k, ended: ok, cost, turns: turns.filter((x) => typeof x === 'string'), at: [...spent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
      item: st.rarity + ' ' + st.mods.map((m) => `${m.side[0]}:${m.unrevealed ? '(hidden)' : m.fam}${m.tier ? ' T' + m.tier : ''}${m.frac ? '(F)' : ''}${m.des ? '(D)' : ''}${m.crafted ? '(C)' : ''}`).join(', ') });
    steps += k;
  }
  const mean = done ? sum / done : NaN;
  const sd = done > 1 ? Math.sqrt(Math.max(0, sq / done - mean * mean)) : 0;
  const top = (m) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, c]) => `${c}x ${k}`);
  return { mean, se: done ? sd / Math.sqrt(done) : NaN, sd, done, steps: steps / Math.max(1, played), off, refused, runs: played, detours, why: top(whyOf), detourWhy: top(detourWhy), endWhy: top(endWhy), gaveUp, gaveUpWhy: top(gaveUpWhy), valued, solves, kept: KEEP };
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
