/* PoE2 Craft Assistant: the route played by the simulator (planner.js), craft after craft.
 *
 * The network (network.js) promises a cost from its equations; here its rule set is played on real items, modifier by
 * modifier, as the game would roll them. The checks (scripts/selftest/network_check.js, network_sweep.js, the replay
 * gate scripts/gate.js) and the page's expert view (a short replay of the player's own item) use the same play.
 * Moved here unchanged from scripts/selftest/network_check.js on 12 Nov 2026.
 *
 * make({E, P, NW, rng, renderItem}) returns {play}. renderItem (scripts/selftest/lib.js) is needed only for
 * opts.again (an item its node does not know is valued by the route solved again from it); the page does not use it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PoE2Replay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function make(deps) {
    const { E, P, NW } = deps;
    const rng = deps.rng || ((seed) => P.rngFrom(seed));
    const renderItem = deps.renderItem || (() => { throw new Error('opts.again needs renderItem'); });
    /**
     * Play the network's rule set on the item `runs` times (fewer when `limitMs` runs out). Returns { mean, se, done, steps, off, runs }.
     * opts.again {max, per, ms}: what the page does with an item its node does not know. The page solves again from
     * every pasted item, so a modifier that keeps a target out is known to it; the play has one network for the whole
     * scenario. Where a step can do nothing on the item in hand for that reason, the route is solved again from that
     * item and the craft ends there with the cost that route promises (at most `max` solves a scenario, `ms` each;
     * after `per` solves for one set of targets on the item and one set of targets kept out, their mean is used). Such crafts are counted as
     * valued. Without it (or past the limit) the play takes the node's next step that can do something.
     * opts.costs: an array that gets the cost of every craft that ended (the gate's median, P90 and worst case).
     * opts.minRuns: crafts played before `limitMs` can stop the play (200; the page's short replay takes fewer).
     * opts.first: an option of the start node (net.options) used as the first step of every craft.
     * opts.steps: a Map that gets, per kind of step (its currency names), how often it was used, how often the item had
     * more targets met after it, and how often fewer (a target lost, or the item lost to a locking step): the expert view's
     * step chances and the steps that can brick the item.
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
      const wanted = (st) => (opts) => {
        for (const g of goals) {
          if (g.kind === 'nat' && g.noWell) continue;
          // (one of several stats for a slot: with one of them on the item the others are no targets)
          if (g.oi >= 0 && st && st.mods.some((m) => goals.some((h) => h.oi === g.oi && P.meets(m, h, h.tier)))) continue;
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
      const again = new Map(), againMet = new Map(); // (by kind; by how many targets are on the item)
      let solves = 0, valued = 0;
      const valueAgain = (st, node, hidden) => {
        if (!AGAIN) return null;
        // (one kind: the targets that are on the item, and the targets kept out; what else is on it differs from item to item)
        const key = net.states[node].g.map((x) => (x >= 1 && x <= 3 ? 1 : 0)).join('') + '|' + hidden.join(',');
        const got = again.get(key), mean = got && got.n ? got.sum / got.n : null;
        if (got && got.n >= AGAIN.per) return mean;
        // (an item the writer below cannot put into text as it is: runes that change the rules, a hidden modifier, quality.
        // Astrid's Creativity and Serle's Triumph that the craft socketed are written with it, as rune lines the reader
        // takes their rules from: boots that carried Astrid's Creativity and a low "+# to Evasion Rating" were never
        // valued, and 99 of 1,000 such crafts never ended where the item is never given up.)
        const runeTxt = (n) => ((((ctx.kb.augments[n] || {}).by_class || {})[ctx.cls] || {}).txt || []).join('\n');
        const runes = st.runes || [];
        const xc = runes.filter((n) => /additional Crafted Modifier/i.test(runeTxt(n))).length;
        const xs = runes.reduce((s, n) => { const x = /\+(\d+) Suffix Modifiers? allowed/i.exec(runeTxt(n)); return s + (x ? +x[1] : 0); }, 0);
        const written = runes.every((n) => /additional Crafted Modifier|Suffix Modifiers? allowed/i.test(runeTxt(n))) && (st.xCrafted || 0) === xc && (st.xSuffix || 0) === xs;
        if (st.aldur || !written || (st.tags || []).length || st.catQ || st.mods.some((m) => !m.id || m.unrevealed)) return mean;
        // No more routes to solve for this scenario: a kind that was never solved is valued as the kinds with as many
        // targets on the item were, on average. (Without that an item of a new kind had no end where the item is never
        // given up: in the thirteenth deep run up to 2,537 of 100,000 crafts of such a scenario went on for ever.)
        if (solves >= AGAIN.max) { if (mean != null) return mean; const m = againMet.get(key.split('|')[0].split('1').length - 1); return m && m.n ? m.sum / m.n : null; }
        solves++;
        let v = null;
        try {
          const base = input.item.base;
          const text = renderItem({ base, cls: ctx.cls, rarity: st.rarity, ilvl: input.item.ilvl, name: 'Item In Hand', implicits: ctx.kb.bases[base].imp || [], runes,
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
        { const nm = key.split('|')[0].split('1').length - 1, m = againMet.get(nm) || { n: 0, sum: 0 }; m.n++; m.sum += v; againMet.set(nm, m); }
        return v;
      };
      // a reforge step names the kind of modifier to mark (PoE2 1.0): the network finds it on the item; the rules check that
      // (validated as it stood, with no modifier named, every such step was refused and a detour taken in its place)
      const onItem = (a, st) => (a && a.op === 'reforge' && net.marksFor ? net.marksFor(a, st) || a : a);
      const removes = (a, st) => a.op === 'chaos' || a.op === 'reforge' || a.op === 'annul' || a.op === 'pessence' || a.op === 'liquid' || a.op === 'newbase' || a.op === 'extraction' || a.op === 'vaal'
        || (a.op === 'bone' && (a.putrefy || a.mark || (!a.hide && open(st, 'prefix') + open(st, 'suffix') === 0)));
      /** Can edge e of the node do nothing on this item: all it could add is among the targets kept out (blocked), and it removes nothing? */
      const futileOn = (node, e, st, blocked) => { if (removes(e.a, st)) return false; const adds = net.adds(node, e.out); return adds.length > 0 && adds.every((i) => blocked.includes(i)); };
      // what an item looks like, in a few words (for the reasons a craft did not end)
      const look = (st) => { const c = (f) => st.mods.filter(f).length; return `${st.rarity} ${c((m) => m.side === 'prefix')}/${c((m) => m.side === 'suffix')}${c((m) => m.crafted) ? ' crafted ' + c((m) => m.crafted) : ''}${c((m) => m.des && !m.unrevealed) ? ' desecrated ' + c((m) => m.des && !m.unrevealed) : ''}${c((m) => m.unrevealed) ? ' hidden' : ''}${c((m) => m.frac) ? ' fractured' : ''}${st.aldur ? ' aldur' : ''}${(st.tags || []).length ? ' pool rune' : ''}${st.xCrafted ? ' astrid' : ''}${st.xSuffix ? ' serle' : ''}`; };
      const note = (m, a, text) => { const k = `${a.op}${a.item ? ' ' + a.item : ''}: ${text}`; m.set(k, (m.get(k) || 0) + 1); };
      const COSTS = opts && Array.isArray(opts.costs) ? opts.costs : null, STEPS = opts && opts.steps instanceof Map ? opts.steps : null;
      // (targets met on an item, for opts.steps: -1 for an item a locking step has lost)
      const metOf = (st) => ((st.corrupted || st.sanctified) && !(net.finished && net.finished(st)) ? -1 : goals.filter((g) => st.mods.some((m) => m.fam === g.fam && !m.unrevealed && P.meets(m, g, g.tier))).length);
      const keyOf = (step) => (step.a.op === 'lock' ? "Hinekora's Lock" : (step.names && step.names.length ? step.names.join(' + ') : step.a.op === 'bone' || step.a.op === 'reveal' ? 'Well of Souls' : step.a.op));
      for (let n = 0; n < runs; n++) {
        if (until && (n & 15) === 0 && n >= (opts && opts.minRuns != null ? opts.minRuns : 200) && Date.now() > until) break;
        if (n === 40 && done === 0) break; // not one of forty crafts ends: the rules and the simulator disagree, more plays say nothing
        played++;
        let st = { ...st0, mods: st0.mods.map((m) => ({ ...m })) };
        let cost = 0, k = 0, ok = false, lastA = null;
        from = -1;
        // (opts.keep: the crafts of more than that many uses are kept, with the nodes they spent them at)
        const spent = KEEP ? new Map() : null, turns = KEEP ? [] : null;
        // how often a node's step could do nothing on the item in hand (see "hidden" below)
        const stuck = new Map();
        let prevKey = null, prevMet = 0;
        for (; k < maxSteps; k++) {
          if (STEPS) {
            const m = metOf(st);
            if (prevKey) { const rec = STEPS.get(prevKey) || { uses: 0, gain: 0, loss: 0 }; rec.uses++; if (m > prevMet) rec.gain++; else if (m < prevMet) rec.loss++; STEPS.set(prevKey, rec); }
            prevKey = null; prevMet = Math.max(0, m);
          }
          // a locked item (Corrupted or Sanctified) is finished when every target is on it, else it is lost: a new base
          // (which the step that locked it has paid for)
          if (st.corrupted || st.sanctified) {
            const fin = !!(net.finished && net.finished(st));
            // (for the audit: where the locking step led, finished or lost; it was the one step whose outcome was not kept,
            // and a Putrefaction that finished less often than promised showed in no node's share of the gap)
            if (audit && from >= 0) { const rec = audit.get(from) || { n: 0, to: new Map() }; rec.n++; const to = fin ? ((k) => (k < 0 ? -2 : k))(net.nodeOf(st)) : net.n0; /* (-2: finished, and no node for it) */ rec.to.set(to, (rec.to.get(to) || 0) + 1); audit.set(from, rec); }
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
          if (audit && from >= 0) { const rec = audit.get(from) || { n: 0, to: new Map() }, to = node < 0 && net.finished && net.finished(st) ? -2 : node; rec.n++; rec.to.set(to, (rec.to.get(to) || 0) + 1); audit.set(from, rec); }
          // (an item the network has no node for: kept with the step that led to it, for the audit)
          if (node < 0 && audit && from >= 0) (audit.offs = audit.offs || []).push({ from, a: lastA, state: net.stateOf ? JSON.stringify(net.stateOf(st, true)) + ' (with what is known); ' + JSON.stringify(net.stateOf(st, false)) + ' (without)' : '', item: st.rarity + ' ' + st.mods.map((m) => `${m.side[0]}:${m.unrevealed ? '(hidden)' : m.fam}${m.tier ? ' T' + m.tier : ''}${m.frac ? '(F)' : ''}${m.des ? '(D)' : ''}${m.crafted ? '(C)' : ''}`).join(', ') });
          from = node;
          // (an item with every target on it is finished, also one the network has no node for: what else is on it does not matter any more)
          if (node < 0) { if (net.finished && net.finished(st)) { ok = true; break; } off++; note(endWhy, lastA || { op: 'start' }, 'left the network as ' + look(st)); break; }
          if (net.done(node)) { ok = true; break; }
          // (opts.first: the first step of every craft is that one, an option of the start node: the expert view's other routes)
          let step = k === 0 && opts && opts.first && node === net.start ? opts.first : net.step(node);
          if (!step) { note(endWhy, lastA || { op: 'start' }, 'no step for ' + look(st)); break; }
          // A step the rules refuse on this very item, where the network's node does not know what is in a target's way
          // (not every target's blockers are followed in a large network): the player sees the item and takes the next
          // cheapest step the rules allow. Counted as a detour, with the reason; the cost shows what it does to the promise.
          if (step.a.op !== 'lock' && step.a.op !== 'reveal' && !(step.a.op === 'bone' && step.a.hide) && step.a.op !== 'catalyst') {
            const bad = P.validate(ctx, st, onItem(step.a.pre || step.a, st));
            if (bad) {
              const alt = net.options(node).find((o) => !o.best && o.a.op !== 'lock' && !P.validate(ctx, st, onItem(o.a.pre || o.a, st)));
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
              // An item that is never given up, that no route solved again has valued, and that has come back to this
              // node forty times: whoever holds it takes off a modifier that may be the one in the way, with a step that
              // can take any of them (no side, not Omen of Light). The next cheapest step that can do something is the
              // network's choice for an item without the blocker and can go round in a circle that never touches it: a
              // bone that leaves a hidden Desecrated modifier, then Omen of Light with an Orb of Annulment that takes that
              // one off again (Grand Cuisses with a low "+# to Evasion Rating", the network that follows no blocker where
              // the item is never given up: 99 of 1,000 crafts did not end within 115,650 uses, 627 in the sixteenth deep
              // run). Only that late: where the other steps change the item they mostly get past the blocker, and for
              // less (a Grand Regalia played at x1.22 with the removal from the sixth time on, x1.04 without it).
              const clear = never && c > 40 ? net.options(node).find((o) => (o.a.op === 'annul' || o.a.op === 'chaos') && !o.a.side && !o.a.light && !o.a.whittle && !o.a.pre && !P.validate(ctx, st, o.a)) : null;
              const alt = clear || net.options(node).find((o) => !o.best && o.a.op !== 'lock' && !P.validate(ctx, st, onItem(o.a.pre || o.a, st)) && !futileOn(node, o, st, hidden));
              if (alt) { detours++; note(detourWhy, step.a, why); step = alt; }
            }
          }
          if (step.a.op === 'newbase') stuck.clear();
          // (for the audit: a detour is another edge than the node's, whose chances the node's step does not have; its
          // outcome is counted apart, per node, and not as the node's)
          if (audit && step !== null && step.a !== (net.step(node) || {}).a) { audit.detours = audit.detours || new Map(); audit.detours.set(node, (audit.detours.get(node) || 0) + 1); from = -1; }
          let a = step.a;
          lastA = a;
          if (STEPS && a.op !== 'newbase') prevKey = keyOf(step);
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
              const s1 = s2;
              s2 = P.apply(ctx, s2, c.a, r, (opts, again, at) => wanted(at || s1)(opts) || dull(opts)).state;
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
            // (a reforge step names the kind of modifier to mark: the network finds it on the item)
            if (a.op === 'reforge') { a = onItem(a, st); lastA = a; }
            refuse(a);
            // (with Abyssal Echoes the first three options are declined when no target is among them: `again` is the reroll)
            // (what is a target is read off the item as it is at that reveal, `at`: an Omen of Putrefaction has taken
            // away the item's modifiers by then. Read off the item before the step, a slot of several stats that had
            // one of them looked filled, and its stats were never taken: from such items not one craft in the
            // fifteenth and sixteenth deep runs was finished that way, where the network counts 12.3% (Drakeskin
            // Boots, x1.18).)
            if (a.op === 'newbase' && net.bound) st = another(st);
            else st = P.apply(ctx, st, a, r, (opts, again, at, side) => wanted(at || st)(opts) || (a.echoes && !again ? null : a.putrefy ? spare(opts, at, side, a.quality === 'Ancient' ? 40 : 0) : dull(opts))).state;
            // (an Orb of Extraction destroys the item: the craft goes on with a new base, which the step's cost includes)
            if (a.op === 'extraction') { st = another(st); st.destroyed = false; }
          }
        }
        if (ok) { done++; sum += cost; sq += cost * cost; if (COSTS) COSTS.push(cost); }
        else if (k >= maxSteps) note(endWhy, lastA || { op: 'start' }, `not finished within ${maxSteps} uses`);
        if (spent && k > opts.keep && KEEP.length < 12) KEEP.push({ uses: k, ended: ok, cost, state: { rarity: st.rarity, mods: st.mods.map((m) => ({ ...m })) }, turns: turns.filter((x) => typeof x === 'string'), at: [...spent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
          item: st.rarity + ' ' + st.mods.map((m) => `${m.side[0]}:${m.unrevealed ? '(hidden)' : m.fam}${m.tier ? ' T' + m.tier : ''}${m.frac ? '(F)' : ''}${m.des ? '(D)' : ''}${m.crafted ? '(C)' : ''}`).join(', ') });
        steps += k;
      }
      const mean = done ? sum / done : NaN;
      const sd = done > 1 ? Math.sqrt(Math.max(0, sq / done - mean * mean)) : 0;
      const top = (m) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, c]) => `${c}x ${k}`);
      return { mean, se: done ? sd / Math.sqrt(done) : NaN, sd, done, steps: steps / Math.max(1, played), off, refused, runs: played, detours, why: top(whyOf), detourWhy: top(detourWhy), endWhy: top(endWhy), gaveUp, gaveUpWhy: top(gaveUpWhy), valued, solves, kept: KEEP };
    }
    return { play };
  }
  return { make };
});
