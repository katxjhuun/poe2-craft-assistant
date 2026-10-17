// node --test app/tests
// The craft network (app/network.js): its bookkeeping, and its costs against the simulator on a few items.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../engine.js');
const P = require('../planner.js');
const NW = require('../network.js');
const kb = require(process.env.POE2_KB || path.join(__dirname, '..', '..', 'poe2_kb_0.5.5.json'));
const W = require('../data/weights_0.5.5.json');
const ix = E.buildIndex(kb);

// prices of a test world (Exalted Orbs): cheap basics, dear omens
const PRICES = {
  'Orb of Transmutation': 0.2, 'Greater Orb of Transmutation': 1, 'Perfect Orb of Transmutation': 20, 'Orb of Augmentation': 0.3, 'Greater Orb of Augmentation': 4,
  'Perfect Orb of Augmentation': 100, 'Regal Orb': 1, 'Greater Regal Orb': 5, 'Perfect Regal Orb': 20, 'Exalted Orb': 1, 'Greater Exalted Orb': 5, 'Perfect Exalted Orb': 1000,
  'Chaos Orb': 60, 'Greater Chaos Orb': 180, 'Perfect Chaos Orb': 2000, 'Orb of Annulment': 340, 'Fracturing Orb': 3400, 'Omen of Light': 3600,
  'Omen of Sinistral Exaltation': 300, 'Omen of Dextral Exaltation': 300, 'Omen of Sinistral Erasure': 5000, 'Omen of Dextral Erasure': 5000,
  'Omen of Sinistral Annulment': 5000, 'Omen of Dextral Annulment': 5000, 'Omen of Sinistral Necromancy': 1, 'Omen of Dextral Necromancy': 3,
  'Omen of Abyssal Echoes': 90, 'Preserved Rib': 7, 'Ancient Rib': 2800, 'Preserved Collarbone': 7, 'Preserved Jawbone': 7,
};
const priceOf = (n) => (PRICES[n] != null ? PRICES[n] : null);
const boots = (lines) => E.parseItem(ix, ['Item Class: Boots', ...lines].join('\n')).item;
const WHITE = ['Rarity: Normal', 'Totemic Greaves', '--------', 'Item Level: 82'];
function famOf(base, re, side) {
  for (const [id, pe] of E.poolFor(ix, kb.bases[base].sig)) { const m = kb.mods[id]; if (pe.side === side && re.test(m.txt.replace(/\n/g, ' / '))) return [m.fam, m.txt.split('\n')[0]]; }
  throw new Error('no family for ' + re);
}
function inputFor(item, wants, extra) {
  const targets = {};
  wants.forEach(([side, re, tier], k) => { const [fam, label] = famOf(item.base, re, side); targets[side + '-' + k] = { fam, group: side, minTier: tier, required: true, label }; });
  const page = W.base_page[item.base];
  return Object.assign({ ix, item, targets, locks: {}, priceOf, baseCost: 1, weights: page && W.pages[page] ? W.pages[page].weights : null, essences: [] }, extra);
}
const MS = ['prefix', /increased Movement Speed$/, 3], LIFE = ['prefix', /to maximum Life$/, 3], FIRE = ['suffix', /to Fire Resistance$/, 3];

test('network: the materials add up to the cost, and a larger budget is never less likely to hold', () => {
  const net = NW.build(inputFor(boots(WHITE), [MS, FIRE]));
  const s = net.start;
  const sum = net.materials(s).reduce((t, m) => t + m.cost, 0);
  assert.ok(Math.abs(sum - net.cost(s)) < 1e-6 * net.cost(s), `${sum} vs ${net.cost(s)}`);
  let last = 0;
  for (const b of [1, 10, 100, 1000, 1e5]) { const p = net.within(s, b); assert.ok(p >= last - 1e-12 && p <= 1); last = p; }
  assert.ok(last > 0.999);
  assert.ok(net.step(s).names[0].includes('Transmutation'));
});

test('network: one target by transmute alone is a closed form (cost per try over chance)', () => {
  // only the two cheapest orbs have a price: every miss is a new base, so cost = (transmute + base) / p - base
  const only = (n) => (n === 'Orb of Transmutation' ? 1 : null);
  const net = NW.build(inputFor(boots(WHITE), [MS], { priceOf: only, baseCost: 2 }));
  const s = net.start, st = net.step(s);
  const p = net.hit(s);
  assert.equal(st.a.op, 'transmute');
  assert.ok(p > 0 && p < 1);
  assert.ok(Math.abs(net.cost(s) - ((1 + 2) / p - 2)) < 1e-6 * net.cost(s));
  assert.ok(Math.abs(net.bases(s) - (1 / p - 1)) < 1e-6 / p);
});

test('network: an item that has every target costs nothing; an impossible tier is named', () => {
  const have = boots(['Rarity: Magic', 'Totemic Greaves', '--------', 'Item Level: 82', '--------', '{ Prefix Modifier "Hellion\'s" (Tier: 1) — Speed }', '35(35-35)% increased Movement Speed']);
  const net = NW.build(inputFor(have, [MS]));
  assert.ok(net.done(net.start));
  assert.equal(net.cost(net.start), 0);
  const low = boots(['Rarity: Normal', 'Totemic Greaves', '--------', 'Item Level: 60']);
  const no = NW.build(inputFor(low, [['prefix', /increased Movement Speed$/, 1]]));
  assert.ok(no.impossible && /item level/.test(no.impossible[0].why));
});

test('network: fewer bases cost more, and the route then repairs instead of starting over', () => {
  const net = NW.build(inputFor(boots(WHITE), [MS, LIFE, FIRE]));
  const s = net.start;
  const free = net.cost(s), bases = net.bases(s);
  assert.ok(bases > 5);
  net.fitBases(s, 3);
  assert.ok(net.bases(s) <= 3 + 1e-6);
  assert.ok(net.cost(s) > free);
  const sum = net.materials(s).reduce((t, m) => t + m.cost, 0);
  assert.ok(Math.abs(sum - net.cost(s)) < 1e-6 * net.cost(s));
  net.fitBases(s, 1e9);
  assert.ok(Math.abs(net.cost(s) - free) < 1e-6 * free);
});

test('network: a fractured target is never removed, and buying a start is worth something', () => {
  const frac = boots(['Rarity: Rare', 'Test', 'Totemic Greaves', '--------', 'Item Level: 82', '--------',
    '{ Fractured Prefix Modifier "Hellion\'s" (Tier: 1) — Speed }', '35(35-35)% increased Movement Speed',
    '{ Suffix Modifier "of the Whelpling" (Tier: 8) — Elemental, Fire, Resistance }', '+8(6-10)% to Fire Resistance']);
  const net = NW.build(inputFor(frac, [['prefix', /increased Movement Speed$/, 1], ['suffix', /to Fire Resistance$/, 2]]));
  const d = net.describe(net.start);
  assert.ok(d.has.some((x) => /fractured/.test(x)));
  // (lines after "New base" are about the white base that replaces the item)
  for (const r of net.rules(net.start, 40)) assert.ok(r.done || r.fresh || r.when.has.some((x) => /Movement Speed/.test(x)), 'the fractured target stays on every node of the route');
  const white = NW.build(inputFor(boots(WHITE), [['prefix', /increased Movement Speed$/, 1], ['suffix', /to Fire Resistance$/, 2]]));
  assert.ok(white.entries().some((e) => e.kind === 'magic' && e.worth > 0));
});

test('network: its promise matches the simulator (two items, played 600 times each)', () => {
  const { play } = require('../../scripts/selftest/network_check.js');
  for (const wants of [[MS], [LIFE, FIRE]]) {
    const input = inputFor(boots(WHITE), wants);
    const net = NW.build(input);
    const got = play(net, input, 600, 11, 20000);
    assert.equal(got.done, 600);
    assert.equal(got.off, 0);
    assert.ok(Math.abs(got.mean - net.cost(net.start)) <= 4 * got.se + 0.05 * net.cost(net.start), `${got.mean} ± ${got.se} vs ${net.cost(net.start)}`);
  }
});

// ---- what the cloud sweep's special requests and the gap measure found (8 Oct 2026)
const item = (cls, lines) => E.parseItem(ix, ['Item Class: ' + cls, ...lines].join('\n')).item;
const labelOf = (id) => E.template(kb.mods[id].txt.split('\n')[0]);
const poolOf = (base, side) => [...E.poolFor(ix, kb.bases[base].sig)].filter(([, pe]) => pe.side === side).map(([id, pe]) => ({ id, tier: pe.tier, fam: kb.mods[id].fam }));

test('network: a rune the targets need and the item cannot socket is "impossible", never a cost', () => {
  // four suffixes need Serle's Triumph; an Artificer's Orb adds no socket on a ring
  const ring = item('Rings', ['Rarity: Normal', 'Biostatic Ring', '--------', 'Item Level: 82']);
  const prices = Object.assign({}, PRICES, { "Serle's Triumph": 1000, "Artificer's Orb": 1 });
  const res = [/to Fire Resistance$/, /to Cold Resistance$/, /to Lightning Resistance$/, /to Chaos Resistance$/].map((re) => ['suffix', re, 4]);
  const net = NW.route(inputFor(ring, res, { priceOf: (n) => (prices[n] != null ? prices[n] : null) }));
  assert.ok(net.impossible, 'no route is promised');
  assert.match(net.impossible[0].why, /socket|holds/);
  // the same four suffixes on gloves (Artificer's Orb works there) have a route with the rune in it
  const gloves = item('Gloves', ['Rarity: Normal', 'Massive Mitts', '--------', 'Item Level: 82']);
  const g = NW.route(inputFor(gloves, res, { priceOf: (n) => (prices[n] != null ? prices[n] : null) }));
  assert.ok(!g.impossible && !g.unsupported, JSON.stringify(g.impossible || g.unsupported));
  assert.ok(g.cost(g.start) < 1e9);
  assert.ok(g.materials(g.start).some((m) => m.name === "Serle's Triumph"));
});

test('network: a modifier of the other side that keeps a target out with its tags is known', () => {
  // on a wand "+ to Level of all Fire Spell Skills" (suffix) stops the Chaos Damage prefix (game data adds_tags)
  const base = 'Dueling Wand';
  const fire = poolOf(base, 'suffix').filter((e) => /Level of all Fire Spell Skills$/.test(labelOf(e.id))).sort((a, b) => a.tier - b.tier)[0];
  const chaos = poolOf(base, 'prefix').filter((e) => /increased Chaos Damage$/.test(labelOf(e.id)))[0];
  assert.ok(fire && chaos && (kb.mods[fire.id].at || []).includes('no_chaos_spell_mods'));
  const wand = item('Wands', ['Rarity: Rare', 'Test', base, '--------', 'Item Level: 82', '--------', '{ Suffix Modifier "x" (Tier: 1) }', kb.mods[fire.id].txt.split('\n')[0].replace(/\(?(\d+)[^ ]*/, '$1')]);
  assert.equal(wand.mods.length, 1, 'the suffix was read');
  const input = inputFor(wand, [['prefix', /increased Chaos Damage$/, 3]]);
  const net = NW.route(input);
  assert.ok(!net.impossible && !net.unsupported);
  const d = net.describe(net.start);
  assert.deepEqual(d.across.length, 1, 'the target is kept out by the suffix');
  // no step of the route tries to roll the prefix while the suffix is there: every exalt-like step from the start node is absent
  const step = net.step(net.start);
  assert.ok(step && !['exalt', 'regal', 'augment'].includes(step.a.op), 'no roll for a prefix that cannot come: ' + JSON.stringify(step && step.a));
  // a white wand has the same target without that state
  const white = NW.route(inputFor(item('Wands', ['Rarity: Normal', base, '--------', 'Item Level: 82']), [['prefix', /increased Chaos Damage$/, 3]]));
  assert.equal(white.describe(white.start).across.length, 0);
});

test('network: the answer for the page is plain data', () => {
  const a = NW.answer(inputFor(boots(WHITE), [MS, FIRE]), { budget: 500, baseLimit: 50 });
  const copy = JSON.parse(JSON.stringify(a));
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(a).sort());
  assert.ok(a.net && a.meanCost > 0 && a.p > 0 && a.p <= 1 && a.next.names.length && a.steps.length && a.rules.length);
  assert.ok(a.bases <= 50 * 1.05, 'the base limit binds: ' + a.bases);
  const blocked = NW.answer(inputFor(boots(['Rarity: Rare', 'Test', 'Totemic Greaves', '--------', 'Item Level: 82', '--------', 'Corrupted']), [MS]), {});
  assert.equal(blocked.blocked, 'Corrupted');
});

test('planner: a Rune of Aldur never transforms a Chaos modifier (rune texts)', () => {
  const base = 'Dueling Wand';
  const ctx = P.makeContext(ix, item('Wands', ['Rarity: Normal', base, '--------', 'Item Level: 82']), {});
  const chaos = poolOf(base, 'prefix').filter((e) => /increased Chaos Damage$/.test(labelOf(e.id)))[0];
  const fire = poolOf(base, 'prefix').filter((e) => /increased Fire Damage$/.test(labelOf(e.id)))[0];
  const t = P.aldurTwin(ctx, chaos.id, 'Cold');
  assert.ok(!t || t === chaos.id, 'Chaos Damage stays under Breath of Aldur');
  const f = P.aldurTwin(ctx, fire.id, 'Cold');
  assert.ok(f && f !== fire.id && /Cold/.test(kb.mods[f].txt), 'Fire Damage becomes Cold Damage');
});

// ---- what the 100,000-play cloud run of 7 Oct 2026 found (scenarios of scripts/selftest/network_sweep.js, by id)
test('network: scenarios the deep cloud run found wrong stay right', () => {
  const SW = require('../../scripts/selftest/network_sweep.js');
  const { load, weightsFor } = require('../../scripts/selftest/lib.js');
  const { play } = require('../../scripts/selftest/network_check.js');
  const L = load();
  const find = (id) => { const base = id.split('|')[0]; for (let n = 0; n < 400; n++) { let sc = null; try { sc = SW.scenario(base, n, true); } catch (e) { sc = null; } if (sc && sc.id === id) return sc; } throw new Error('no scenario ' + id); };
  const input = (sc) => ({ ix: L.ix, item: sc.item, targets: sc.targets, locks: {}, priceOf: L.priceOf, baseCost: 1, weights: weightsFor(sc.base), essences: SW.table(sc.base).essences, quality: sc.qualityMode });
  const check = (id, runs, tol) => {
    const sc = find(id), net = NW.route(input(sc));
    assert.ok(!net.impossible && !net.unsupported, id);
    const got = play(net, input(sc), runs, 7, 20000);
    assert.equal(got.off, 0, id + ': no craft leaves the network');
    assert.equal(got.done, got.runs, id + ': every craft ends');
    const want = net.cost(net.start);
    assert.ok(Math.abs(got.mean - want) <= 4 * got.se + tol * want, `${id}: played ${got.mean.toFixed(1)} ± ${got.se.toFixed(1)}, promised ${want.toFixed(1)}`);
    return net;
  };
  // a helmet: an alloy adds Mana Cost Efficiency as a crafted prefix, which is not the Desecrated suffix that was asked
  // for (the crafts once left the network there)
  const helm = check('Cryptic Crown|desecrated|ManaCostEfficiency', 500, 0.05);
  assert.equal(helm.goals[0].rareEss, null);
  // a quiver whose Critical Hit Chance suffix leaves the lich one suffix to offer: the first bone is sure (the network
  // once said one in two)
  const quiver = check('Visceral Quiver|desecrated|ManaCostEfficiency', 300, 0.03);
  const first = quiver.step(quiver.start);
  if (first && first.a.op === 'bone' && first.a.lich) assert.ok(quiver.hit(quiver.start) > 0.99, 'hit ' + quiver.hit(quiver.start));
  // boots, where the local defences are half of the prefix pool (the Well's later options were lost: 0.82)
  check('Grand Cuisses|set2|rare, another modifier fractured|5', 600, 0.08);
  // a staff: Chaos Damage with a modifier of the other side that stops it (1.22), and five targets (0.65)
  check('Permafrost Staff|one|ChaosDamageWeaponPrefix|T1', 500, 0.08);
});


// ---- what the second deep cloud run and the crafters' videos led to (8 Oct 2026)
test('network: a modifier that rolls into the way of a target is a state; a target on the item is not "another modifier"', () => {
  // boots: a lower tier of Movement Speed that rolls keeps the target out for as long as it is there; the network
  // follows it (it once drew that chance anew at every roll)
  const net = NW.route(inputFor(boots(WHITE), [MS, FIRE]));
  assert.equal(net.track, 2, 'both natural targets are followed');
  const st = net.step(net.start);
  const kids = [];
  for (let q = 0; q < st.out.length; q += 2) if (st.out[q + 1] >= 0) kids.push(net.describe(st.out[q + 1]));
  assert.ok(kids.some((d) => d.inWay.length === 1), 'a first modifier of the group of a target is "in the way"');
  // a wand: the Freeze Buildup suffix that was asked for stops the Chaos Damage prefix with its tags. That is the
  // doing of the target itself (the pools are cut while it is there), not a modifier of the other side to remove
  const base = 'Dueling Wand';
  const freeze = poolOf(base, 'suffix').filter((e) => /increased Freeze Buildup$/.test(labelOf(e.id))).sort((a, b) => a.tier - b.tier)[0];
  assert.ok((kb.mods[freeze.id].at || []).includes('no_chaos_spell_mods'));
  const wand = item('Wands', ['Rarity: Rare', 'Test', base, '--------', 'Item Level: 82', '--------', '{ Suffix Modifier "x" (Tier: 1) }', kb.mods[freeze.id].txt.split('\n')[0].replace(/\(?(\d+)[^ ]*/, '$1')]);
  assert.equal(wand.mods.length, 1, 'the suffix was read');
  const w = NW.route(inputFor(wand, [['suffix', /increased Freeze Buildup$/, 1], ['prefix', /increased Chaos Damage$/, 3]]));
  if (!w.impossible) {
    const d = w.describe(w.start);
    assert.equal(d.has.length, 1);
    assert.equal(d.across.length, 0, 'the target on the item is not counted as a modifier in the way');
  }
});

test('network: the Well of Souls beside a desecrated-only modifier of the group of the target', () => {
  // a wand's desecrated-only "#% increased Elemental Damage" is of the group of its Cold Damage prefix: when the Well
  // draws it (the desecrated-only options come first), Cold Damage cannot be an option any more. The network's chance
  // for the bone is checked against the simulator's draws on the same item (it once said 2.2% where the game gives 1.6%).
  const base = 'Dueling Wand';
  const lvl = poolOf(base, 'suffix').filter((e) => /Level of all Cold Spell Skills$/.test(labelOf(e.id)) && e.tier === 2)[0];
  const mana = poolOf(base, 'prefix').filter((e) => /^\+# to maximum Mana$/.test(labelOf(e.id))).sort((a, b) => b.tier - a.tier)[0];
  const line = (e) => kb.mods[e.id].txt.split('\n')[0].replace(/\(?(\d+)[^ ]*/, '$1');
  const wand = item('Wands', ['Rarity: Rare', 'Test', base, '--------', 'Item Level: 82', '--------',
    '{ Suffix Modifier "x" (Tier: 2) }', line(lvl), '{ Prefix Modifier "y" (Tier: ' + mana.tier + ') }', line(mana)]);
  assert.equal(wand.mods.length, 2, 'both modifiers were read');
  const input = inputFor(wand, [['suffix', /Level of all Cold Spell Skills$/, 2], ['prefix', /increased Cold Damage$/, 2]]);
  const net = NW.route(input);
  assert.ok(!net.impossible && !net.unsupported);
  const cold = net.goals.findIndex((g) => /Cold Damage/.test(g.label));
  // the bone on the prefix side, revealed at once, without an omen of the Well
  const bone = net.acts[net.start].find((x) => x.a.op === 'bone' && x.a.quality === 'Preserved' && x.a.side === 'prefix' && !x.a.echoes && !x.a.lich && !x.a.hide && !x.a.mark);
  assert.ok(bone, 'the network has the bone as an edge');
  let model = 0;
  for (let q = 0; q < bone.out.length; q += 2) if (bone.out[q + 1] >= 0 && net.states[bone.out[q + 1]].g[cold] === 3) model += bone.out[q];
  const st = P.toState(net.ctx, wand), r = P.rngFrom(5);
  let hit = 0;
  const N = 60000;
  for (let k = 0; k < N; k++) if (P.revealOptions(net.ctx, st, 'prefix', 0, null, r).some((o) => o.fam === net.goals[cold].fam && o.tier <= 2)) hit++;
  const sim = hit / N, se = Math.sqrt(sim * (1 - sim) / N);
  assert.ok(sim > 0.002, 'the Well offers it at all: ' + sim);
  assert.ok(Math.abs(model - sim) <= 4 * se + 0.15 * sim, `network ${(model * 100).toFixed(2)}%, simulator ${(sim * 100).toFixed(2)}%`);
});

test('network: an essence as a tool against the unwanted Desecrated modifier (no Omen of Light)', () => {
  // A bow with its three prefixes wants a Desecrated suffix. When the Well of Souls misses, an essence or alloy takes
  // the miss away (claim k60): aimed at the suffixes with an Omen of Crystallisation, or without an omen once the
  // suffixes are full. That costs a fraction of Omen of Light and an Orb of Annulment. Its promise is played, and the
  // simulator's rules refuse none of its steps.
  const { E: E2, load, weightsFor, rng, renderItem } = require('../../scripts/selftest/lib.js');
  const SW = require('../../scripts/selftest/network_sweep.js');
  const { play } = require('../../scripts/selftest/network_check.js');
  const { labelOf: lab } = require('../../scripts/selftest/scenarios.js');
  const L = load();
  const base = 'Fanatic Bow', t = SW.table(base);
  const pre = [], taken = new Set();
  for (const f of t.nat.prefix) { if (pre.length === 3) break; if (f.grp.some((x) => taken.has(x))) continue; f.grp.forEach((x) => taken.add(x)); pre.push(f); }
  const des = t.des.suffix[0];
  const tierOf = (f) => f.tiers[Math.min(1, f.tiers.length - 1)];
  const it = E2.parseItem(L.ix, renderItem({ base, cls: t.cls, rarity: 'Rare', ilvl: 82, mods: pre.map((f) => ({ id: f.ids[tierOf(f)], side: f.side, tier: tierOf(f) })) }, rng(77), 'adv').text).item;
  const targets = {};
  pre.forEach((f, k) => { targets['prefix-' + k] = { fam: f.fam, group: 'prefix', minTier: tierOf(f), required: true, label: lab(f.ids[f.tiers[0]]) }; });
  targets['suffix-9'] = { fam: des.fam, group: 'desecrated', minTier: null, required: true, label: lab(des.ids[des.tiers[0]]) };
  const input = { ix: L.ix, item: it, targets, locks: {}, priceOf: L.priceOf, baseCost: 1, weights: weightsFor(base), essences: t.essences };
  if (L.priceOf('Omen of Dextral Crystallisation') == null || L.priceOf('Omen of Light') == null) return; // (the prices of the day lack them: nothing to compare)
  const net = NW.route(input);
  assert.ok(!net.impossible && !net.unsupported);
  const names = net.materials(net.start).map((m) => m.name);
  assert.ok(names.some((n) => /Essence|Alloy/.test(n)), 'the tool is in the route: ' + names.join(', '));
  assert.ok(!names.includes('Omen of Light'), 'no Omen of Light');
  const tool = net.rules(net.start, 10).find((x) => x.when.desecratedOther && (x.names || []).some((n) => /Essence|Alloy/.test(n)));
  assert.ok(tool, 'it is used on the unwanted Desecrated modifier');
  const got = play(net, input, 100, 5, 20000);
  assert.equal(got.off, 0, 'no craft leaves the network');
  assert.equal(got.refused, 0, 'the rules allow every step');
  assert.equal(got.done, got.runs);
  const want = net.cost(net.start);
  assert.ok(Math.abs(got.mean - want) <= 4 * got.se + 0.08 * want, `played ${got.mean.toFixed(1)} ± ${got.se.toFixed(1)}, promised ${want.toFixed(1)}`);
  assert.ok(net.settled, 'the values are settled');
});

test('planner: Essence of the Abyss leaves a Mark that the next desecration replaces (claim k59)', () => {
  const helmBase = Object.entries(kb.bases).find(([, b]) => b.cls === 'Helmet' && b.tags.includes('str_armour') && b.tl)[0];
  const helm = E.parseItem(ix, `Item Class: Helmets\nRarity: Normal\n${helmBase}\n--------\nItem Level: 82`).item;
  const ctx = P.makeContext(ix, helm, { essences: P.essencesForBase(ix, kb.bases[helm.base], W.essences.Helmet) });
  const recs = ctx.essences.filter((r) => r.item === 'Essence of the Abyss');
  assert.equal(recs.length, 2, 'the Mark as a prefix and as a suffix');
  const taken = new Set();
  const pool = [...ctx.pool.entries()].filter(([id]) => { if (kb.mods[id].grp.some((g) => taken.has(g)) || kb.mods[id].lvl > 82) return false; kb.mods[id].grp.forEach((g) => taken.add(g)); return true; });
  const mk = ([id, pe]) => ({ id, fam: kb.mods[id].fam, side: pe.side, lvl: kb.mods[id].lvl, grp: kb.mods[id].grp, tier: pe.tier, frac: false, des: false, crafted: false, lock: false });
  const st = Object.assign(P.toState(ctx, helm), { rarity: 'Rare' });
  st.mods = pool.filter(([, pe]) => pe.side === 'suffix').slice(0, 3).concat(pool.filter(([, pe]) => pe.side === 'prefix').slice(0, 3)).map(mk);
  const rng = P.rngFrom(3);
  for (const rec of recs) {
    const side = kb.mods[rec.mod].gen === 'p' ? 'prefix' : 'suffix';
    const a = { op: 'pessence', item: rec.item, mod: rec.mod };
    assert.equal(P.validate(ctx, st, a), null);
    const r1 = P.apply(ctx, st, a, rng);
    const mark = r1.state.mods.find((m) => m.fam === 'AbyssTargetMod');
    assert.ok(mark && mark.side === side && mark.crafted, 'the Mark is a crafted modifier of its side');
    assert.equal(r1.removed[0].side, side, 'on a full item it takes a slot of its own side');
    // the bone: only the Mark leaves, also on this full item, and the Desecrated modifier is of the side of the Mark
    const bone = { op: 'bone', quality: 'Preserved' };
    assert.equal(P.validate(ctx, r1.state, bone), null);
    const r2 = P.apply(ctx, r1.state, bone, rng);
    assert.deepEqual(r2.removed.map((m) => m.fam), ['AbyssTargetMod']);
    const des = r2.state.mods.filter((m) => m.des);
    assert.equal(des.length, 1);
    assert.equal(des[0].side, side);
    assert.equal(r2.state.mods.length, 6);
    for (const m of r1.state.mods) if (m !== mark) assert.ok(r2.state.mods.some((x) => x.id === m.id), 'every other modifier stays');
    // beside a Desecrated modifier the essence is refused
    const withDes = Object.assign({}, st, { mods: st.mods.slice(1).map((m, k) => (k === 0 ? Object.assign({}, m, { des: true }) : m)) });
    assert.match(P.validate(ctx, withDes, a), /cannot be used on an item that has a Desecrated modifier/);
  }
});

test('network: the values of a craft of very many turns are settled (a quiver with six targets)', () => {
  // A loop that crosses the solver's blocks (a target is lost and rolled again) settles by its chance per turn. With
  // passes over the blocks alone this route, 25,000 white bases long, was valued at 508,446 with its equations a
  // thousandth off, and played at 646,000: the accelerated sweeps settle it (656,662 at the prices of 8 Oct 2026).
  const SW = require('../../scripts/selftest/network_sweep.js');
  const { load, weightsFor } = require('../../scripts/selftest/lib.js');
  const L = load();
  const id = 'Visceral Quiver|set6|rare, other modifiers|9';
  let sc = null;
  for (let n = 0; n < 400 && !sc; n++) { let x = null; try { x = SW.scenario('Visceral Quiver', n, true); } catch (e) { x = null; } if (x && x.id === id) sc = x; }
  assert.ok(sc, 'the scenario is drawn');
  const net = NW.build({ ix: L.ix, item: sc.item, targets: sc.targets, locks: {}, priceOf: L.priceOf, baseCost: 1, weights: weightsFor(sc.base), essences: SW.table(sc.base).essences, quality: sc.qualityMode, lite: 0, track: 0, whittle: 'none', maxStates: 200000 });
  assert.ok(!net.unsupported && !net.impossible);
  assert.ok(net.settled, 'the values satisfy their own equations');
  // the route's first step and what follows it add up to the item's value
  const s = net.start, st = net.step(s);
  let v = st.cost;
  for (let t = 0; t < st.out.length; t += 2) v += st.out[t] * net.cost(st.out[t + 1] === -1 ? net.n0 : st.out[t + 1]);
  assert.ok(Math.abs(v - net.cost(s)) <= 1e-6 * net.cost(s), `${v} vs ${net.cost(s)}`);
});

// ---- the steps that lock an item or give it up, at the prices of the day (scripts/selftest/lib.js)
const lockWorld = () => {
  const L = require('../../scripts/selftest/lib.js'), SW = require('../../scripts/selftest/network_sweep.js'), { play } = require('../../scripts/selftest/network_check.js');
  const D = L.load();
  const item = (base, rarity, mods, more) => E.parseItem(D.ix, L.renderItem(Object.assign({ base, cls: kb.bases[base].cls, rarity, ilvl: 82, mods: mods || [] }, more), L.rng(5), 'adv').text).item;
  const ctxOf = (base) => P.makeContext(D.ix, item(base, 'Normal'), { weights: L.weightsFor(base) });
  const tiers = (base, side, re) => { const ctx = ctxOf(base), es = P.sidePool(ctx, side, 0).filter((e) => re.test(kb.mods[e.id].txt.replace(/\n/g, ' / '))); const f = es[0].fam; return { fam: f, side, label: kb.mods[es[0].id].txt.split('\n')[0], ids: Object.fromEntries(es.filter((e) => e.fam === f).map((e) => [e.tier, e.id])), ctx }; };
  const input = (it, targets, over, extra) => Object.assign({ ix: D.ix, item: it, targets, locks: {}, priceOf: (n) => (over && Object.prototype.hasOwnProperty.call(over, n) ? over[n] : D.priceOf(n)), baseCost: 1, weights: L.weightsFor(it.base),
    essences: P.essencesForBase(D.ix, kb.bases[it.base], (D.W.essences || {})[kb.bases[it.base].cls] || []) }, extra);
  // the network's chance that a locking step finishes the item, and the simulator's count over n uses
  const chance = (net, inp, op, n, prep) => {
    const st0 = P.toState(net.ctx, inp.item, inp.locks), e = net.acts[net.nodeOf(st0)].find((x) => op(x.a));
    if (!e) return null;
    let p = 0, hit = 0;
    for (let t = 0; t < e.out.length; t += 2) if (e.out[t + 1] !== -1) p += e.out[t];
    const r = L.rng(11);
    for (let k = 0; k < n; k++) { const st = Object.assign({}, st0, { mods: st0.mods.map((m) => Object.assign({}, m)) }); if (prep) prep(st, r); if (net.finished(P.apply(net.ctx, st, e.a, r).state)) hit++; }
    return { a: e.a, net: p, sim: hit / n, why: P.validate(net.ctx, st0, e.a) };
  };
  return { L, SW, D, play, item, ctxOf, tiers, input, chance };
};

test('network: Omen of Sanctification lifts a value past its tier, and only the highest tier counts for it', () => {
  const X = lockWorld(), base = 'Biostatic Ring', fire = X.tiers(base, 'suffix', /to Fire Resistance$/), cold = X.tiers(base, 'suffix', /to Cold Resistance$/);
  const [lo, hi] = P.rangeOf(fire.ctx, fire.ids[1]);
  const it = X.item(base, 'Rare', [{ id: fire.ids[1], side: 'suffix', tier: 1 }, { id: cold.ids[2], side: 'suffix', tier: 2 }]);
  const want = (min) => ({ 'suffix-0': { fam: fire.fam, group: 'suffix', minTier: null, minValue: min, required: true, label: fire.label } });
  const under = (min) => (st, r) => { const m = st.mods.find((x) => x.fam === fire.fam), vs = []; for (let v = lo; v <= hi; v++) if (v < min) vs.push(v); m.v = vs[Math.floor(r() * vs.length)]; };
  // a value two over the top of T1: T2 could reach it too (its top times 1.22), with a far smaller chance. One status
  // for both promised each the average: 17.6% where T1 has 31.2%.
  for (const min of [hi + 2, hi + 6]) {
    const inp = X.input(it, want(min), { 'Omen of Sanctification': 1 });
    const net = NW.build(inp);
    assert.ok(!net.impossible && !net.unsupported, 'a value over the range is a target while the omen has a price');
    assert.equal(net.goals[0].stretchFrom, hi);
    const c = X.chance(net, inp, (a) => a.sanctify, 40000, under(min));
    assert.equal(c.why, null);
    assert.ok(Math.abs(c.net - c.sim) < 0.012, `value ${min}: network ${c.net}, simulator ${c.sim}`);
  }
  // a value inside T1 stays a matter for the Divine Orb: no tier under it counts, and the omen is a step there too
  const inp = X.input(it, want(hi), { 'Omen of Sanctification': 1 });
  const net = NW.build(inp);
  assert.equal(net.goals[0].stretch, undefined);
  const c = X.chance(net, inp, (a) => a.sanctify, 40000, under(hi));
  assert.ok(Math.abs(c.net - c.sim) < 0.012, `network ${c.net}, simulator ${c.sim}`);
  // without a price for the omen the value over the range cannot be had
  assert.ok(NW.build(X.input(it, want(hi + 2), { 'Omen of Sanctification': null })).impossible);
  // the whole route from a white ring, played
  const white = X.input(X.item(base, 'Normal'), want(hi + 2));
  const route = NW.route(white), got = X.play(route, white, 250, 3, 20000, 60000);
  assert.ok(route.materials(route.start).some((m) => m.name === 'Omen of Sanctification'));
  assert.equal(got.refused, 0);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean / route.cost(route.start) - 1) < 0.15 || Math.abs(got.mean - route.cost(route.start)) < 3 * got.se, `${got.mean} vs ${route.cost(route.start)}`);
});

test('network: a Vaal Orb finishes an item with the chance the simulator counts', () => {
  const X = lockWorld(), base = 'Totemic Greaves';
  const f = (side, re) => X.tiers(base, side, re);
  const ms = f('prefix', /increased Movement Speed$/), life = f('prefix', /to maximum Life$/), arm = f('prefix', /increased Armour$/), fire = f('suffix', /to Fire Resistance$/), cold = f('suffix', /to Cold Resistance$/), lit = f('suffix', /to Lightning Resistance$/), chaos = f('suffix', /to Chaos Resistance$/);
  const targets = {};
  [[ms, 3], [life, 6], [fire, 6]].forEach(([t, tier], k) => { targets[t.side + '-' + k] = { fam: t.fam, group: t.side, minTier: tier, required: true, label: t.label }; });
  const m = (t, tier) => ({ id: t.ids[tier], side: t.side, tier });
  // a full item, the third target missing: a third of the Vaal Orb's quarter swaps a modifier one to three times
  const inp = X.input(X.item(base, 'Rare', [m(ms, 1), m(life, 2), m(arm, 3), m(cold, 3), m(lit, 4), m(chaos, 2)]), targets, { 'Vaal Orb': 0.01 });
  const net = NW.build(Object.assign({}, inp, { lite: 0, track: 0, whittle: 'none', maxStates: 200000 })), c = X.chance(net, inp, (a) => a.op === 'vaal', 120000);
  assert.equal(c.why, null);
  assert.ok(c.net > 0.005 && Math.abs(c.net - c.sim) < 0.002, `network ${c.net}, simulator ${c.sim}`);
  // the item is lost with the rest of the chance: a new base, counted in the step
  assert.ok(Math.abs(c.a.bases - (1 - c.net)) < 1e-9);
});

test('network: Desecrated targets alone are made with Omen of Putrefaction, as promised', () => {
  const X = lockWorld(), base = 'Gemini Bow', ctx = X.ctxOf(base);
  const pick = (side) => P.desPoolFor(ctx, side, 0, null).filter((e) => !ctx.pool.has(e.id))[0];
  const targets = {};
  [pick('prefix'), pick('suffix')].forEach((e, k) => { targets[e.side + '-' + k] = { fam: e.fam, group: 'desecrated', minTier: null, required: true, label: kb.mods[e.id].txt.split('\n')[0] }; });
  const inp = X.input(X.item(base, 'Normal'), targets);
  const net = NW.route(inp), s = net.start;
  assert.ok(net.settled);
  assert.ok(net.materials(s).some((x) => x.name === 'Omen of Putrefaction'), 'six reveals for the price of a bone and an omen');
  // (2,500 crafts: one costs about as much again as the average, so 400 of them are 5% apart, and at the prices of
  // 12 Oct 2026 they came out 14% over a promise that 3,000 crafts confirm to 2%)
  const got = X.play(net, inp, 2500, 3, 5000, 60000);
  assert.equal(got.refused, 0);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean / net.cost(s) - 1) < 0.12, `${got.mean} vs ${net.cost(s)}`);
});

test('network: the runes an item came with are that item\'s: a new base has none, an Orb of Extraction returns Astrid\'s Creativity', () => {
  const X = lockWorld(), base = 'Massive Mitts', t = X.SW.table(base);
  const sc = X.SW.scenario(base, t.nat.prefix.length + t.nat.suffix.length + t.des.prefix.length + t.des.suffix.length + 6 * 5 + 5);
  assert.match(sc.kind, /two crafted-only/);
  const fire = X.tiers(base, 'suffix', /to Fire Resistance$/);
  const it = X.item(base, 'Rare', [{ id: fire.ids[5], side: 'suffix', tier: 5 }], { runes: ["Astrid's Creativity"], sockets: 1 });
  const ctx = P.makeContext(X.D.ix, it, { weights: X.L.weightsFor(base) }), st = P.toState(ctx, it, {});
  assert.equal(ctx.craftedCap, 1);
  assert.equal(st.xCrafted, 1);
  const fresh = P.apply(ctx, st, { op: 'newbase' }, X.L.rng(1)).state;
  assert.equal(fresh.xCrafted, 0, 'a new base does not have the rune');
  assert.equal(P.freeSockets(ctx, fresh), 1, 'and its socket is free');
  assert.equal(P.validate(ctx, fresh, { op: 'rune_rule', item: "Astrid's Creativity" }), null);
  assert.match(P.validate(ctx, fresh, { op: 'extraction' }), /No augment/);
  const targets = Object.assign({}, sc.targets, { 'suffix-9': { fam: fire.fam, group: 'suffix', minTier: 1, required: true, label: fire.label } });
  const more = { essences: t.essences, quality: sc.qualityMode };
  const inp = X.input(it, targets, null, more), white = X.input(X.item(base, 'Normal'), targets, null, more);
  const net = NW.route(inp), w = NW.route(white);
  // from the pasted item the craft is cheaper than from a white base by less than the rune (it was by all of it, and
  // more, when every new base had the rune for nothing)
  assert.ok(net.cost(net.start) < w.cost(w.start));
  assert.ok(net.materials(net.start).some((x) => x.name === 'Orb of Extraction'), 'the rune is taken back when the item is given up');
  const got = X.play(net, inp, 200, 3, 5000, 60000);
  assert.equal(got.refused, 0);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean / net.cost(net.start) - 1) < 0.1, `${got.mean} vs ${net.cost(net.start)}`);
});

test('network: Void Flux turns a resistance into Chaos Resistance', () => {
  const X = lockWorld(), base = 'Biostatic Ring', fire = X.tiers(base, 'suffix', /to Fire Resistance$/), chaos = X.tiers(base, 'suffix', /to Chaos Resistance$/);
  const targets = { 'suffix-0': { fam: chaos.fam, group: 'suffix', minTier: 2, required: true, label: chaos.label } };
  const inp = X.input(X.item(base, 'Rare', [{ id: fire.ids[1], side: 'suffix', tier: 1 }]), targets);
  const net = NW.route(inp), st = net.step(net.start);
  assert.deepEqual(st.names, ['Void Flux']);
  assert.ok(Math.abs(net.cost(net.start) - X.D.priceOf('Void Flux')) < 1e-9);
});

test('network: a large network keeps to the base limit from a small one\'s price of giving up', () => {
  // the small network (no blockers followed) is searched for the charge on bases; the large one is built at the price
  // of giving up that came out (input.giveUp), not solved free and searched again
  const input = inputFor(boots(WHITE), [MS, LIFE, FIRE]);
  const small = NW.build(Object.assign({}, input, { track: 0, whittle: 'none' }));
  const free = small.bases(small.start), max = Math.max(2, Math.floor(free / 4));
  assert.ok(small.fitBases(small.start, max) > 0, 'the limit binds');
  const z = small.giveUp;
  assert.ok(z > 0);
  const held = NW.build(Object.assign({}, input, { track: 8, whittle: 'none', giveUp: z, maxBases: max }));
  assert.ok(held.fitted && held.settled);
  assert.ok(held.bases(held.start) <= max * 1.02, `bases ${held.bases(held.start)} of ${max}`);
  assert.ok(held.charge > 0);
  // the same network searched in full lands on a route that costs about as much
  const full = NW.build(Object.assign({}, input, { track: 8, whittle: 'none' }));
  const c0 = full.cost(full.start);
  full.fitBases(full.start, max);
  assert.ok(full.cost(full.start) >= c0 * (1 - 1e-9), 'fewer bases never cost less');
  assert.ok(Math.abs(held.cost(held.start) / full.cost(full.start) - 1) < 0.05, `${held.cost(held.start)} vs ${full.cost(full.start)}`);
});

test("network: Hinekora's Lock is the best of what the currencies show, and no edge while it costs more than the item", () => {
  const X = lockWorld(), base = 'Totemic Greaves';
  const targets = {};
  [['prefix', /increased Movement Speed$/], ['suffix', /to Fire Resistance$/]].forEach(([side, re], k) => { const f = X.tiers(base, side, re); targets[side + '-' + k] = { fam: f.fam, group: side, minTier: 1, required: true, label: f.label }; });
  const build = (lock) => { const inp = Object.assign(X.input(X.item(base, 'Normal'), targets, { "Hinekora's Lock": lock }), { lite: 0, track: 8, whittle: 'none' }); return [NW.build(inp), inp]; };
  const [plain] = build(null), [dear] = build(1e6), [cheap, inp] = build(3);
  const c0 = plain.cost(plain.start), s = cheap.start;
  // dearer than the whole craft: the lock can win at most what the item is worth, so the route is the one without it
  assert.ok(Math.abs(dear.cost(dear.start) - c0) < 1e-9 * c0);
  assert.ok(!dear.materials(dear.start).some((m) => m.name === "Hinekora's Lock"));
  // for 3 ex it is used, the craft is cheaper, and the values are exact
  assert.ok(cheap.settled);
  const mats = cheap.materials(s), lock = mats.find((m) => m.name === "Hinekora's Lock");
  assert.ok(lock && lock.uses > 1, 'the lock is in the route');
  assert.ok(cheap.cost(s) < c0 * 0.9, `${cheap.cost(s)} vs ${c0}`);
  const sum = mats.reduce((t, m) => t + m.cost, 0);
  assert.ok(Math.abs(sum - cheap.cost(s)) < 1e-6 * cheap.cost(s), `materials ${sum} vs ${cheap.cost(s)}`);
  // a node where the lock is the step: one step per currency item is looked at, and the edge is the expected best of
  // their results (counted here by drawing each currency's result from its own edge)
  const n = cheap.rules(s, 200).find((x) => x.a && x.a.op === 'lock').node, e = cheap.acts[n][cheap.pol[n]], list = cheap.acts[n];
  const names = cheap.lockSteps(n).map((c) => c.names[c.names.length - 1]);
  assert.equal(new Set(names).size, names.length, 'one step per currency item');
  const val = (to) => (to === -1 ? cheap.cost(cheap.n0) + 1 : cheap.cost(to));
  let want = e.cost, drawn = 0;
  for (let t = 0; t < e.out.length; t += 2) want += e.out[t] * (e.out[t + 1] === -1 ? cheap.cost(cheap.n0) : cheap.cost(e.out[t + 1]));
  const r = X.L.rng(5), N = 60000;
  for (let i = 0; i < N; i++) {
    let best = e.a.capY;
    for (const k of e.a.cand) {
      const o = list[k].out;
      let u = r(), to = o[o.length - 1];
      for (let t = 0; t < o.length; t += 2) { u -= o[t]; if (u <= 0) { to = o[t + 1]; break; } }
      const y = list[k].cost - (list[k].a.bases || 0) + val(to);
      if (y < best) best = y;
    }
    drawn += 3 + best;
  }
  assert.ok(Math.abs(drawn / N / want - 1) < 0.01, `edge ${want}, drawn ${drawn / N}`);
  // the lines for the player add up, best first
  const L = cheap.lockList(n, 50);
  assert.ok(L.look.length === names.length && L.lines.length > 0);
  // and the play (every currency used on a copy of the item, the route's choice kept) costs what the route says
  const got = X.play(cheap, inp, 500, 3, 20000, 90000);
  assert.equal(got.refused, 0);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean / cheap.cost(s) - 1) < 0.1 || Math.abs(got.mean - cheap.cost(s)) < 3 * got.se, `${got.mean} vs ${cheap.cost(s)}`);
});

// ---- what the third deep cloud run found (run 37851539057, 9 Oct 2026)
test('network: what the third deep run found: a group mate across the sides, one twin for two targets, long Well lists', () => {
  const X = lockWorld();
  const find = (id) => { const base = id.split('|')[0]; for (let n = 0; n < 900; n++) { let sc = null; try { sc = X.SW.scenario(base, n); } catch (e) { sc = null; } if (sc && sc.id === id) return sc; } throw new Error('no scenario ' + id); };
  const played = (net, inp, runs, tol, what) => {
    const got = X.play(net, inp, runs, 7, 20000, 90000), want = net.cost(net.start);
    assert.equal(got.off, 0, what + ': no craft leaves the network');
    assert.equal(got.refused, 0, what + ': the rules allow every step');
    assert.equal(got.done, got.runs, what + ': every craft ends');
    assert.ok(Math.abs(got.mean - want) <= 4 * got.se + tol * want, `${what}: played ${got.mean.toFixed(1)} ± ${got.se.toFixed(1)}, promised ${want.toFixed(1)}`);
  };
  // A belt: the Desecrated suffix "Thorns Critical Hit Chance" cannot come while a Thorns prefix is on the item (no
  // group twice on an item, whatever the side). The route took bone after bone on such items: 786 promised, 1,211
  // played. The prefix is a state of the target now, like a modifier that stops a target with its tags.
  const sc = find('Runemastered Heavy Belt|set2|rare, some targets there|10');
  const inp = { ix: X.D.ix, item: sc.item, targets: sc.targets, locks: {}, priceOf: X.D.priceOf, baseCost: 1, weights: X.L.weightsFor(sc.base), essences: X.SW.table(sc.base).essences, quality: sc.qualityMode };
  const belt = NW.route(inp);
  assert.ok(belt.states.some((S) => S.g.includes(9)), 'the Thorns prefix that keeps the suffix out is a state');
  played(belt, inp, 700, 0.06, 'belt');

  // A ring with Chaos and Fire Resistance wanted: a Cold Resistance of a high tier is the twin of either (Void Flux,
  // Blazing Flux), but it is one modifier. It was counted for both when it rolled, and after the first Flux the
  // route still had the "second twin" that the Flux had turned as well: 4,290 promised for a body armour that
  // plays at 8,930.
  const base = 'Biostatic Ring', fire = X.tiers(base, 'suffix', /to Fire Resistance$/), chaos = X.tiers(base, 'suffix', /to Chaos Resistance$/), cold = X.tiers(base, 'suffix', /to Cold Resistance$/), lit = X.tiers(base, 'suffix', /to Lightning Resistance$/);
  const targets = {};
  [[chaos, 2], [fire, 2]].forEach(([t, tier], k) => { targets['suffix-' + k] = { fam: t.fam, group: 'suffix', minTier: tier, required: true, label: t.label }; });
  const white = X.input(X.item(base, 'Normal'), targets), ring = NW.route(white);
  played(ring, white, 500, 0.08, 'ring');
  // with a Cold and a Lightning Resistance on the item (one twin each): a Flux finishes one target and leaves the
  // other without its twin
  const both = X.input(X.item(base, 'Rare', [{ id: cold.ids[1], side: 'suffix', tier: 1 }, { id: lit.ids[1], side: 'suffix', tier: 1 }]), targets), net2 = NW.route(both);
  const st = P.toState(net2.ctx, both.item, {}), node = net2.nodeOf(st);
  const twins = net2.states[node].g.filter((x) => x === 8).length;
  assert.equal(twins, 2, 'each of the two is the twin of one target');
  for (const e of net2.acts[node].filter((x) => x.a.op === 'flux')) for (let t = 1; t < e.out.length; t += 2) assert.ok(!net2.states[e.out[t]].g.includes(8), `after ${e.a.to} Flux no twin is left`);
  played(net2, both, 400, 0.08, 'ring with two twins');

  // An amulet (11 and 20 entries on the Well's lists): what Omen of Putrefaction's reveals take off the lists was
  // followed item by item, and a network of 1,600 nodes took 19 seconds to build (a large one ran out of memory).
  const am = 'Runemastered Veridical Chain', life = X.tiers(am, 'prefix', /to maximum Life$/), str = X.tiers(am, 'suffix', /to Strength$/);
  const t2 = { 'prefix-0': { fam: life.fam, group: 'prefix', minTier: 2, required: true, label: life.label }, 'suffix-1': { fam: str.fam, group: 'suffix', minTier: 2, required: true, label: str.label } };
  const amulet = NW.build(Object.assign(X.input(X.item(am, 'Normal'), t2), { lite: 0, track: 0, whittle: 'none' }));
  assert.ok(amulet.acts.some((l) => l.some((e) => e.a.putrefy)), 'the omen is an edge');
  assert.ok(amulet.timing.expand < 6000, `built in ${amulet.timing.expand} ms`);
});

test('network: the cheaper orb tier is used, also when it is the higher one; an item is seen where its node is not', () => {
  // Greater Orbs of Transmutation cost less than plain ones on the market of 10 Oct 2026. The network kept a higher
  // tier only where its floor raised a target's share, so it rolled with the dearer plain orb.
  const cheap = (n) => (n === 'Greater Orb of Transmutation' ? 0.05 : priceOf(n));
  const input = inputFor(boots(WHITE), [['prefix', /increased Movement Speed$/, 6]], { priceOf: cheap });
  const net = NW.build(input), dear = NW.build(inputFor(boots(WHITE), [['prefix', /increased Movement Speed$/, 6]]));
  assert.deepEqual(net.step(net.start).names, ['Greater Orb of Transmutation']);
  assert.ok(net.cost(net.start) < dear.cost(dear.start));
  // a dearer higher tier that raises no target's share is still no edge
  assert.ok(!dear.acts[dear.start].some((e) => e.a.op === 'transmute' && e.a.tier === 'perfect'));

  // What an item holds that its node does not know: with no blockers followed, a Life prefix of too low a tier is "one
  // more prefix" for the node, and an Exalted Orb for Life can do nothing on that item. The play asks the item.
  const loose = NW.build(inputFor(boots(WHITE), [MS, LIFE, FIRE], { track: 0, whittle: 'none' }));
  const ctx = loose.ctx;
  const low = P.sidePool(ctx, 'prefix', 0).filter((e) => /to maximum Life$/.test(kb.mods[e.id].txt)).sort((a, b) => b.tier - a.tier)[0];
  const st = P.toState(ctx, boots(WHITE), {});
  st.rarity = 'Rare';
  st.mods.push({ id: low.id, fam: low.fam, side: 'prefix', lvl: low.lvl, grp: low.grp, tier: low.tier, frac: false, des: false, crafted: false, lock: false });
  const node = loose.nodeOf(st);
  assert.ok(node >= 0);
  const life = loose.goals.findIndex((g) => /Life/.test(g.label));
  assert.deepEqual(loose.hiddenBlocks(st, node), [life], 'the low Life tier keeps the Life target out, and the node does not say so');
  const exalt = loose.acts[node].find((e) => e.a.op === 'exalt' && e.a.side === 'prefix') || loose.acts[node].find((e) => e.a.op === 'exalt');
  assert.ok(loose.adds(node, exalt.out).includes(life), 'the node takes an Exalted Orb to add Life');
  // with the blockers followed the same item is a node that knows
  const tight = NW.build(inputFor(boots(WHITE), [MS, LIFE, FIRE], { track: 8, whittle: 'none' }));
  assert.deepEqual(tight.hiddenBlocks(st, tight.nodeOf(st)), []);
});

// ---- an item that no white base can replace, and a bought start (10 Oct 2026)
const ringWith = (lines) => E.parseItem(ix, ['Item Class: Rings', 'Rarity: Rare', 'Test Ring', 'Mnemonic Ring', '--------', 'Item Level: 80', '--------', ...lines].join('\n')).item;
const GENESIS = { fam: 'SpellManaCostEfficiency', group: 'prefix', minTier: 1, required: true, label: '#% increased Mana Cost Efficiency of Spells' };

test('network: a target the item carries and no white base can get is held, and the item is never given up', () => {
  // A Mnemonic Ring from the Genesis Tree with its "Mana Cost Efficiency of Spells" fractured (the mana stacking
  // craft): the base does not roll that modifier, and the network called the request impossible.
  const item = ringWith(['{ Fractured Prefix Modifier }', '24(23-26)% increased Mana Cost Efficiency of Spells']);
  assert.equal(item.mods[0].fam, 'SpellManaCostEfficiency');
  const input = inputFor(item, [['prefix', /^\+\(\d+-\d+\) to maximum Mana$/, 3], ['suffix', /to Fire Resistance$/, 3]]);
  input.targets['prefix-9'] = GENESIS;
  const net = NW.build(input);
  assert.ok(!net.impossible, JSON.stringify(net.impossible));
  assert.equal(net.bound.mode, 'never');
  assert.equal(net.bound.held.length, 1);
  assert.ok(!net.acts.some((list) => list.some((e) => e.a.op === 'newbase' || (e.a.bases > 0))), 'no step gives the item up or can lose it');
  const want = net.cost(net.start);
  assert.ok(want > 0 && want < 1e7, String(want));
  assert.equal(net.bases(net.start), 0);
  const X = lockWorld(), got = X.play(net, input, 300, 3, 20000, 60000);
  assert.equal(got.done, got.runs, 'every craft ends on the one ring');
  assert.ok(Math.abs(got.mean - want) < Math.max(4 * got.se, 0.08 * want), `played ${got.mean} ±${got.se}, promised ${want}`);
  // the answer for the page says why the route stays on the item
  const a = NW.answer(input, {});
  assert.equal(a.bound.mode, 'never');
  assert.ok(a.steps.length > 0 && !a.steps.some((s) => s.names.includes('New base')));
});

test('network: without a price for another one, an item whose held modifier every route can lose has no route; with a price it has', () => {
  // the Genesis prefix is not fractured and the prefixes are full: every removal on that side can take it
  const lines = ['{ Prefix Modifier }', '24(23-26)% increased Mana Cost Efficiency of Spells', '{ Prefix Modifier (Tier: 6) }', '+40(38-49) to maximum Mana', '{ Prefix Modifier (Tier: 3) }', '12(10-14)% increased Rarity of Items found'];
  const item = ringWith(lines);
  assert.equal(item.mods.length, 3);
  const input = inputFor(item, [['prefix', /^\+\(\d+-\d+\) to maximum Life$/, 3]]);
  input.targets['prefix-9'] = GENESIS;
  const a = NW.answer(input, {});
  assert.ok(a.impossible && /price of another item/.test(a.impossible[0]), JSON.stringify(a.impossible || a.meanCost));
  const b = NW.answer(Object.assign({}, input, { restart: 'item', itemCost: 2000 }), {});
  assert.ok(!b.impossible && b.meanCost > 0, JSON.stringify(b.impossible));
  assert.equal(b.bound.mode, 'item');
  assert.ok(b.steps.some((s) => s.names.includes('New base') && s.cost === 2000), 'another ring is a material of the craft, at its price');
});

test('network: a bought start: giving the item up takes another item like it, at its price', () => {
  // Magic boots that have the movement speed: a white base would have to roll it again; another bought pair has it.
  const item = boots(['Rarity: Magic', 'Totemic Greaves', '--------', 'Item Level: 82', '--------', '{ Prefix Modifier (Tier: 3) }', '25(24-26)% increased Movement Speed']);
  const white = NW.build(inputFor(item, [MS, FIRE, LIFE]));
  const input = inputFor(item, [MS, FIRE, LIFE], { restart: 'item', itemCost: 30 });
  const net = NW.build(input);
  assert.equal(net.bound.mode, 'item');
  assert.equal(net.n0, net.start, 'a restart leads to the item as it was pasted');
  assert.ok(!white.bound);
  // dearer bought pairs make the craft dearer, and a free one is the cheapest
  const at = (c) => { const n = NW.build(inputFor(item, [MS, FIRE, LIFE], { restart: 'item', itemCost: c })); return n.cost(n.start); };
  assert.ok(at(1) < at(30) && at(30) < at(3000));
  const X = lockWorld(), got = X.play(net, input, 400, 3, 20000, 60000), want = net.cost(net.start);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean - want) < Math.max(4 * got.se, 0.08 * want), `played ${got.mean} ±${got.se}, promised ${want}`);
});

test('network: a side that holds four or five modifiers: every count of them is a node of its own', () => {
  // Tenebrous Amulet: one prefix, five suffixes (its implicit). The key of a node had room for three modifiers nobody
  // asked for on a side: the item with four of them on the suffix side was the node of an item with one such prefix
  // and none such suffix, and the route's step there (Omen of Greater Exaltation) is one the rules refuse on it.
  const X = lockWorld(), base = 'Tenebrous Amulet';
  const white = E.parseItem(X.D.ix, X.L.renderItem({ base, cls: 'Amulet', rarity: 'Normal', ilvl: 82, mods: [], implicits: kb.bases[base].imp }, X.L.rng(5), 'adv').text).item;
  assert.deepEqual(white.slotDelta, { prefix: -2, suffix: 2 });
  const res = X.tiers(base, 'suffix', /to all Elemental Resistances$/), crit = X.tiers(base, 'suffix', /increased Critical Damage Bonus$/);
  const inp = X.input(white, { 'suffix-0': { fam: res.fam, group: 'suffix', minTier: 2, required: true, label: res.label }, 'suffix-1': { fam: crit.fam, group: 'suffix', minTier: 2, required: true, label: crit.label } });
  const net = NW.build(inp);
  const at = (jp, js) => net.states.findIndex((S) => S.r === 2 && S.j[0] === jp && S.j[1] === js && S.g[0] === 1 && S.g[1] === 0 && !S.cx && !S.cy && !S.dj && !S.du && S.fg < 0 && !S.fj);
  const full = at(0, 4), other = at(1, 0);
  assert.ok(full >= 0 && other >= 0 && full !== other, 'four other suffixes and one other prefix are two nodes');
  // on the full suffix side no step adds two modifiers: one slot is open
  assert.ok(!net.acts[full].some((e) => e.a.op === 'exalt' && e.a.greater));
  assert.ok(net.acts[other].some((e) => e.a.op === 'exalt' && e.a.greater));
  const got = X.play(net, inp, 300, 3, 20000, 60000), want = net.cost(net.start);
  assert.equal(got.refused, 0);
  assert.ok(got.detours < got.runs / 10, `${got.detours} detours`);
  assert.ok(Math.abs(got.mean - want) < Math.max(4 * got.se, 0.08 * want), `played ${got.mean} ±${got.se}, promised ${want}`);
});

test('network: the cost a route is reported with is the rule set\'s own, also where the item is never given up', () => {
  // A route that never gives the item up repairs it in loops that cross the solver's blocks; the reported money was
  // solved apart, from nothing, with the usual passes, and came out a quarter low on a jewel (65,346 for 87,464; the
  // seventh deep run). It starts from the rule set's values now and is checked against its own equations.
  const item = ringWith(['{ Prefix Modifier (Tier: 6) }', '+40(38-49) to maximum Mana', '{ Suffix Modifier (Tier: 3) }', '+25(21-25)% to Fire Resistance', '{ Suffix Modifier (Tier: 5) }', '+12(9-12) to Strength']);
  const input = inputFor(item, [['prefix', /^\+\(\d+-\d+\) to maximum Life$/, 3], ['suffix', /to Cold Resistance$/, 3], ['suffix', /to Lightning Resistance$/, 3]], { restart: 'never' });
  const net = NW.build(input);
  assert.equal(net.bound.mode, 'never');
  assert.ok(net.settled, 'settled: ' + JSON.stringify(net.timing));
  assert.ok(net.moneyOff <= 1e-6);
  // the model played by its own chances gives its promise
  const r = P.rngFrom(77);
  let sum = 0, sq = 0;
  const n = 4000;
  for (let k = 0; k < n; k++) {
    let s = net.start, c = 0;
    for (let i = 0; i < 100000 && !net.done(s); i++) {
      const step = net.step(s);
      c += step.cost;
      let u = r(), to = step.out[step.out.length - 1];
      for (let t = 0; t < step.out.length; t += 2) { u -= step.out[t]; if (u <= 0) { to = step.out[t + 1]; break; } }
      s = to < 0 ? net.n0 : to;
    }
    sum += c; sq += c * c;
  }
  const mean = sum / n, se = Math.sqrt((sq / n - mean * mean) / n), want = net.cost(net.start);
  assert.ok(Math.abs(mean - want) < 4 * se, `by its own chances ${mean} ±${se}, promised ${want}`);
  // the answer for the page carries the flag
  assert.equal(NW.answer(input, {}).settled, true);
});

test('network: two targets that keep each other out by their tags: the rune that can bring both is found', () => {
  // On a wand the Fire Damage prefix and a Chaos spell level suffix keep each other out. Passion of Aldur (the first
  // rune that serves a target) would need a Cold or Lightning Damage prefix next to the Chaos level, and those keep
  // each other out as well: the network promised that path and no craft of forty ended (the seventh deep run).
  // Betrayal of Aldur turns a Fire spell level into the Chaos one next to a fractured Fire Damage.
  const X = lockWorld(), base = 'Dueling Wand';
  const fire = X.tiers(base, 'prefix', /^\(\d+-\d+\)% increased Fire Damage$/), chaos = X.tiers(base, 'suffix', /to Level of all Chaos Spell Skills$/);
  const inp = X.input(X.item(base, 'Normal'), { 'prefix-0': { fam: fire.fam, group: 'prefix', minTier: 3, required: true, label: fire.label }, 'suffix-0': { fam: chaos.fam, group: 'suffix', minTier: 3, required: true, label: chaos.label } });
  const net = NW.route(inp);
  assert.ok(!net.impossible, JSON.stringify(net.impossible));
  const mats = net.materials(net.start).filter((m) => m.uses > 0.01).map((m) => m.name);
  assert.ok(mats.includes('Betrayal of Aldur') && mats.includes('Fracturing Orb'), mats.join(', '));
  assert.ok(!mats.includes('Passion of Aldur'));
  const got = X.play(net, inp, 150, 3, 200000, 90000), want = net.cost(net.start);
  assert.equal(got.done, got.runs, 'every craft ends');
  assert.equal(got.refused, 0);
  assert.ok(Math.abs(got.mean - want) < Math.max(4 * got.se, 0.1 * want), `played ${got.mean} ±${got.se}, promised ${want}`);
});

test("network: the pasted item's fractured modifier takes its group out of every pool, also out of a target's twins", () => {
  // A shield with a fractured Fire Resistance wants Chaos Resistance. Another element's resistance is that target's
  // twin (a Void Flux turns it): on a white base three elements roll, next to the fractured Fire Resistance two.
  // The network counted three, and promised 6/7 of what the craft costs (the tenth deep run, x1.17).
  const X = lockWorld(), base = 'Golden Targe';
  const fire = X.tiers(base, 'suffix', /to Fire Resistance$/), chaos = X.tiers(base, 'suffix', /to Chaos Resistance$/);
  // (its lowest tier: one that a Void Flux would turn into the wanted Chaos Resistance is the target's twin itself)
  const low = Math.max(...Object.keys(fire.ids).map(Number));
  const it = X.item(base, 'Rare', [{ id: fire.ids[low], side: 'suffix', tier: low, frac: true }]);
  const targets = { 'suffix-0': { fam: chaos.fam, group: 'suffix', minTier: 3, required: true, label: chaos.label } };
  const net = NW.build(Object.assign(X.input(it, targets, null, { restart: 'item', itemCost: 400 }), { lite: 0, track: 8, maxStates: 60000, whittle: 'none' }));
  assert.ok(!net.unsupported && !net.impossible);
  const on = net.poolStats(1, 0, 1, 0, 0, 0, 1), off = net.poolStats(1, 0, 1, 0, 0, 0, 0);
  assert.ok(off.pool.some((e) => e.fam === fire.fam), 'a white base rolls Fire Resistance');
  assert.ok(!on.pool.some((e) => e.fam === fire.fam), 'the pasted item does not roll a second one');
  if (off.twin[0] > 0) assert.ok(Math.abs(on.twin[0] / off.twin[0] - 2 / 3) < 0.03, `twins: ${on.twin[0]} of ${off.twin[0]}`);
  // the item as pasted is such a node, a white base is not
  assert.equal(net.states[net.start].kf, 1);
});

test('network: Omen of Catalysing Exaltation boosts the roll, not the modifiers that were on the item before it', () => {
  // An amulet with 20% Defences quality and an unknown prefix wants "% increased Evasion Rating". With the omen the
  // three defence families are nearly all of the prefix pool. The prefix already on the item was rolled without the
  // omen, so it is seldom one of them; weighed with the boost it was taken for "% Energy Shield" or "% Armour" nine
  // times in ten, those left the pool, and the target was promised at 43% where it rolls at 32% (x1.18 on a bought
  // start, the ninth and tenth deep runs).
  const X = lockWorld(), base = 'Dusk Amulet';
  const eva = X.tiers(base, 'prefix', /% increased Evasion Rating$/), acc = X.tiers(base, 'prefix', /to Accuracy Rating$/), crit = X.tiers(base, 'suffix', /% increased Critical Hit Chance$/);
  const low = (t) => Math.max(...Object.keys(t.ids).map(Number));
  const it = X.item(base, 'Rare', [{ id: acc.ids[low(acc)], side: 'prefix', tier: low(acc) }, { id: crit.ids[low(crit)], side: 'suffix', tier: low(crit) }], { quality: 20, qualityType: 'Defences Modifiers' });
  const targets = { 'prefix-0': { fam: eva.fam, group: 'prefix', minTier: 1, required: true, label: eva.label } };
  const inp = X.input(it, targets, null, { quality: 'use' });
  const net = NW.build(Object.assign({}, inp, { lite: 0, track: 8, maxStates: 60000, whittle: 'none' }));
  assert.ok(!net.unsupported && !net.impossible);
  if (!net.catalyst) return; // (the prices of the day lack the omen: nothing to compare)
  const st0 = P.toState(net.ctx, it, {}), node = net.nodeOf(st0);
  const e = net.acts[node].find((x) => x.a.op === 'exalt' && x.a.catalyse && x.a.side === 'prefix' && x.a.tier === 'base');
  assert.ok(e, 'the omen is an edge of the pasted item');
  let model = 0;
  for (let t = 0; t < e.out.length; t += 2) { const d = net.describe(e.out[t + 1]); if (d.has.length || d.inWay.length) model += e.out[t]; }
  const r = X.L.rng(5), n = 6000;
  let hit = 0;
  for (let k = 0; k < n; k++) {
    const st = Object.assign({}, st0, { mods: st0.mods.map((m) => Object.assign({}, m)) });
    if (P.apply(net.ctx, st, e.a, r).state.mods.some((m) => m.fam === eva.fam)) hit++;
  }
  assert.ok(Math.abs(model - hit / n) < 0.05, `the Evasion family: ${model} in the network, ${hit / n} in ${n} uses`);
});

test('network: a route that never gives the item up has settled values (its rule set is solved part by part)', () => {
  // A ring that is the only one, four targets: valued by a few passes a round, the rule set went round in circles for
  // all 400 rounds and the page said "the numbers are rough" (5% over what the rule set costs; the tenth deep run).
  const X = lockWorld(), id = 'Gloam Ring|set4|rare, other modifiers|only item|2';
  let sc = null;
  for (let n = 0; n < 600 && !sc; n++) { let x = null; try { x = X.SW.scenario('Gloam Ring', n, false); } catch (err) { x = null; } if (x && x.id === id) sc = x; }
  assert.ok(sc, 'the scenario of the sweep');
  const inp = { ix: X.D.ix, item: sc.item, targets: sc.targets, locks: {}, priceOf: X.D.priceOf, baseCost: 1, weights: X.L.weightsFor(sc.base), essences: X.SW.table(sc.base).essences, quality: sc.qualityMode, restart: sc.restart, itemCost: sc.itemCost };
  const net = NW.route(inp);
  if (net.impossible || net.unsupported) return; // (the prices of the day leave no route: nothing to settle)
  assert.equal(net.bound.mode, 'never');
  assert.ok(net.settled, 'the values are the rule set\'s own');
  // the values satisfy their own equations on every node the route reaches
  const seen = new Set([net.start]), q = [net.start];
  let worst = 0;
  while (q.length) {
    const k = q.pop();
    if (net.done(k)) continue;
    const step = net.step(k);
    if (!step) continue;
    let v = step.cost;
    for (let t = 0; t < step.out.length; t += 2) { const to = step.out[t + 1]; assert.ok(to >= 0, 'no new base on this route'); v += step.out[t] * net.cost(to); if (!seen.has(to)) { seen.add(to); q.push(to); } }
    worst = Math.max(worst, Math.abs(v - net.cost(k)) / Math.max(1, net.cost(k)));
  }
  assert.ok(worst < 1e-7, `residual ${worst}`);
});

test("network: a target's twin thins the pools with its own tags", () => {
  // A wand wants Chaos Damage and Freeze Buildup. A Cold Damage prefix is the Chaos target's twin (a Rune of Aldur
  // turns it), and beside it no Ignite or Shock suffix rolls: the network rolled them, as modifiers in Freeze
  // Buildup's way, 16% of the suffixes where the simulator has none (Dueling Wand x0.79 to x0.86 in the deep runs).
  // The step's outcomes in the network against the simulator's, node by node.
  const X = lockWorld(), base = 'Dueling Wand';
  const chaos = X.tiers(base, 'prefix', /% increased Chaos Damage$/), cold = X.tiers(base, 'prefix', /% increased Cold Damage$/), freeze = X.tiers(base, 'suffix', /% increased Freeze Buildup$/);
  const top = (t) => Math.min(...Object.keys(t.ids).map(Number));
  const it = X.item(base, 'Magic', [{ id: cold.ids[top(cold)], side: 'prefix', tier: top(cold) }]);
  const targets = {
    'prefix-0': { fam: chaos.fam, group: 'prefix', minTier: 1, required: true, label: chaos.label },
    'suffix-0': { fam: freeze.fam, group: 'suffix', minTier: 1, required: true, label: freeze.label },
  };
  const net = NW.build(Object.assign({}, X.input(X.item(base, 'Normal'), targets), { lite: 0, track: 8, maxStates: 120000, whittle: 'none' }));
  assert.ok(!net.unsupported && !net.impossible);
  const st0 = P.toState(net.ctx, it, {}), node = net.nodeOf(st0);
  assert.ok(node >= 0);
  if (!net.describe(node).twin.length) return; // (the prices of the day lack the rune: the Cold prefix is no twin)
  const e = net.acts[node].find((x) => x.a.op === 'augment');
  assert.ok(e, 'an Orb of Augmentation is an edge there');
  const model = new Map();
  for (let t = 0; t < e.out.length; t += 2) model.set(e.out[t + 1], e.out[t]);
  const r = X.L.rng(9), n = 4000, sim = new Map();
  for (let k = 0; k < n; k++) {
    const st = Object.assign({}, st0, { mods: st0.mods.map((m) => Object.assign({}, m)) });
    const to = net.nodeOf(P.apply(net.ctx, st, e.a, r).state);
    sim.set(to, (sim.get(to) || 0) + 1 / n);
  }
  let apart = 0;
  for (const k of new Set([...model.keys(), ...sim.keys()])) apart += Math.abs((model.get(k) || 0) - (sim.get(k) || 0)) / 2;
  assert.ok(apart < 0.05, `the outcomes are ${apart} apart`);
});

test('network: a Flux turns every resistance of the other elements; no Fracturing Orb while a second one of the target may be on the item', () => {
  // A ring that is never given up wants Cold Resistance. A Glacial Flux turns the Fire Resistance twin into it, and a
  // low Lightning Resistance nobody asked for into a low Cold Resistance beside it. A Fracturing Orb that picks that
  // one leaves a modifier of the target's family in its way for good once the target is lost: 205 of 100,000 crafts
  // went on with Chaos Orbs for ever (the eleventh deep run, x8.2).
  const X = lockWorld(), base = 'Gloam Ring';
  const cold = X.tiers(base, 'suffix', /to Cold Resistance$/), fire = X.tiers(base, 'suffix', /to Fire Resistance$/), mana = X.tiers(base, 'prefix', /to maximum Mana$/), life = X.tiers(base, 'prefix', /to maximum Life$/), dex = X.tiers(base, 'suffix', /to Dexterity$/);
  const top = (t) => Math.min(...Object.keys(t.ids).map(Number)), low = (t) => Math.max(...Object.keys(t.ids).map(Number));
  const mod = (t, tier) => ({ id: t.ids[tier], side: t.side, tier });
  const targets = {
    'suffix-0': { fam: cold.fam, group: 'suffix', minTier: 2, required: true, label: cold.label },
    'prefix-0': { fam: mana.fam, group: 'prefix', minTier: 1, required: true, label: mana.label },
  };
  const never = { restart: 'never' };
  const plain = X.item(base, 'Rare', [mod(cold, top(cold)), mod(dex, low(dex)), mod(life, low(life)), mod(mana, low(mana))]);
  const net = NW.build(Object.assign({}, X.input(plain, targets, null, never), { lite: 0, track: 8, maxStates: 120000, whittle: 'none' }));
  assert.ok(!net.unsupported && !net.impossible);
  const at = (it) => net.nodeOf(P.toState(net.ctx, it, {}));
  const has = (node, op) => net.acts[node].some((x) => x.a.op === op);
  if (!has(at(plain), 'fracture')) return; // (the prices of the day lack the orb: nothing to compare)
  // the same item with a second, low Cold Resistance where the Dexterity was
  const twice = X.item(base, 'Rare', [mod(cold, top(cold)), mod(cold, low(cold)), mod(life, low(life)), mod(mana, low(mana))]);
  const n2 = at(twice);
  assert.ok(n2 >= 0, 'an item with two of the family is a node');
  if (net.describe(n2).secondOf) assert.ok(!has(n2, 'fracture'), 'no Fracturing Orb beside a second modifier of the target');
  // the Flux says so itself, by the chance that a modifier nobody asked for was a resistance it turns
  const twin = X.item(base, 'Rare', [mod(fire, top(fire)), mod(dex, low(dex)), mod(life, low(life)), mod(mana, low(mana))]);
  const n3 = at(twin), e = net.acts[n3].find((x) => x.a.op === 'flux');
  if (!e) return; // (no Flux at the prices of the day)
  let withSecond = 0;
  for (let t = 0; t < e.out.length; t += 2) {
    const d = net.describe(e.out[t + 1]);
    if (d.secondOf) { withSecond += e.out[t]; assert.ok(!has(e.out[t + 1], 'fracture')); assert.equal(d.secondOf, cold.label); }
  }
  assert.ok(withSecond > 0.01 && withSecond < 0.9, `the Flux leaves a second Cold Resistance ${withSecond} of the time`);
});

test('network: Omen of Putrefaction for a base modifier: what was taken at the Well is no modifier "nobody knows"', () => {
  // A staff wants "(53-59)% increased Critical Spell Damage Bonus" at 58 or more, and the omen is cheap. Its reveals
  // fill the prefixes first, then the suffixes. The network counted what those reveals left on the item as
  // modifiers nobody knows: three prefixes by weight stop a fifth of the suffixes with their tags (the highest
  // option, which the player is told to take, stops none), and every desecrated-only suffix made the pool a sixth
  // smaller. The target's share grew with each: 0.40% a use promised, 0.26% played (x1.20, the twelfth deep run).
  const X = lockWorld(), base = 'Permafrost Staff';
  const crit = X.tiers(base, 'suffix', /% increased Critical Spell Damage Bonus$/);
  const targets = { 'suffix-0': { fam: crit.fam, group: 'suffix', minValue: 58, required: true, label: crit.label } };
  // (prices that leave the omen as the way: an Exalted Orb is the unit, everything the omen's loop needs is a hundredth)
  const over = { 'Omen of Putrefaction': 0.01, 'Preserved Jawbone': 0.01, 'Regal Orb': 0.01, 'Orb of Transmutation': 0.01, 'Greater Orb of Transmutation': 5, 'Perfect Orb of Transmutation': 50,
    'Orb of Augmentation': 0.01, 'Omen of Abyssal Echoes': 1000, 'Ancient Jawbone': 1000, 'Gnawed Jawbone': 1000, 'Orb of Alchemy': 1000 };
  const inp = X.input(X.item(base, 'Normal'), targets, over);
  const net = NW.route(inp), s = net.start;
  assert.ok(!net.impossible && !net.unsupported);
  if (!net.materials(s).some((x) => x.name === 'Omen of Putrefaction')) return; // (another way is cheaper at these prices: nothing to compare)
  const got = X.play(net, inp, 1500, 3, 400000, 150000);
  assert.equal(got.refused, 0);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean / net.cost(s) - 1) < 0.1, `played ${got.mean} +-${got.se}, promised ${net.cost(s)}`);
});

test('network: a Fracturing Orb can lock a modifier that keeps a target out; the route counts it, and never risks an only item', () => {
  // A ring wants "Adds # to # Cold damage to Attacks" at tier 3 and Strength. Where the network does not follow a
  // target's blockers, a modifier nobody asked for may be a lower tier of that target; fractured, it keeps the target
  // out for good. The orb's edge took it for any other modifier: an item that is never given up was fractured that
  // way and crafted on for ever (up to 2,537 of 100,000 crafts of such scenarios, the thirteenth deep run).
  const X = lockWorld(), base = 'Dusk Ring';
  const cold = X.tiers(base, 'prefix', /^Adds .* Cold damage to Attacks$/i), str = X.tiers(base, 'suffix', /to Strength$/), life = X.tiers(base, 'prefix', /to maximum Life$/), mana = X.tiers(base, 'prefix', /to maximum Mana$/), dex = X.tiers(base, 'suffix', /to Dexterity$/), int = X.tiers(base, 'suffix', /to Intelligence$/);
  const low = (t) => Math.max(...Object.keys(t.ids).map(Number));
  const mod = (t, tier) => ({ id: t.ids[tier], side: t.side, tier });
  const targets = {
    'prefix-0': { fam: cold.fam, group: 'prefix', minTier: 3, required: true, label: cold.label },
    'suffix-0': { fam: str.fam, group: 'suffix', minTier: 3, required: true, label: str.label },
  };
  const it = X.item(base, 'Rare', [mod(life, low(life)), mod(mana, low(mana)), mod(dex, low(dex)), mod(int, low(int))]);
  const build = (extra, track) => NW.build(Object.assign({}, X.input(it, targets, null, extra), { lite: 0, track, maxStates: 120000, whittle: 'none' }));
  const edge = (net) => net.acts[net.start].find((x) => x.a.op === 'fracture');
  // every blocker followed: a modifier nobody asked for is known to be in no target's way
  const all = build(null, 8), e0 = edge(all);
  if (!e0) return; // (the prices of the day lack the orb: nothing to compare)
  assert.ok(!e0.a.bases, 'with the blockers followed the orb loses nothing');
  // no blocker followed: a share of the orb's uses is the item lost
  const none = build(null, 0), e1 = edge(none);
  assert.ok(e1 && e1.a.bases > 0.001 && e1.a.bases < 0.5, `the lost share: ${e1 && e1.a.bases}`);
  let back = 0;
  for (let t = 0; t < e1.out.length; t += 2) if (e1.out[t + 1] === -1) back += e1.out[t];
  assert.ok(Math.abs(back - e1.a.bases) < 1e-9, 'that share leads to a new base');
  // the same item as the only one: the orb is no edge
  const only = build({ restart: 'never' }, 0);
  assert.ok(!only.unsupported && !only.impossible);
  assert.ok(!edge(only), 'no Fracturing Orb on an item that is never given up while a modifier may be in a target\'s way');
});

test('network: one of several stats fills a slot (the player\'s "or")', () => {
  // A ring's first suffix may be Fire or Cold Resistance, its first prefix Mana or Life. Either stat of a slot on the
  // item fills it; the others of the slot are not wanted then, and one of them that is on the item as well is one more
  // modifier nobody asked for.
  const X = lockWorld(), base = 'Dusk Ring';
  const fire = X.tiers(base, 'suffix', /to Fire Resistance$/), cold = X.tiers(base, 'suffix', /to Cold Resistance$/), mana = X.tiers(base, 'prefix', /to maximum Mana$/), life = X.tiers(base, 'prefix', /to maximum Life$/);
  const T = (f, tier, more) => Object.assign({ fam: f.fam, group: f.side, minTier: tier, required: true, label: f.label }, more);
  const both = { 'suffix-0': T(fire, 1, { or: true, alts: [T(cold, 1)] }), 'prefix-0': T(mana, 2, { or: true, alts: [T(life, 2)] }) };
  const one = { 'suffix-0': T(fire, 1), 'prefix-0': T(mana, 2) };
  const white = X.item(base, 'Normal');
  const inp = X.input(white, both), net = NW.route(inp), alone = NW.route(X.input(white, one));
  assert.ok(!net.impossible && !net.unsupported && net.settled);
  assert.equal(net.goals.length, 4);
  assert.deepEqual(net.goals.map((g) => g.oi).sort(), [0, 0, 1, 1], 'two slots, two stats each');
  assert.ok(net.cost(net.start) < 0.9 * alone.cost(alone.start), `one of two stats a slot is cheaper: ${net.cost(net.start)} against ${alone.cost(alone.start)}`);
  const got = X.play(net, inp, 1200, 3, 200000, 90000);
  assert.equal(got.refused, 0);
  assert.equal(got.off, 0);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean / net.cost(net.start) - 1) < 0.1, `played ${got.mean} +-${got.se}, promised ${net.cost(net.start)}`);
  // either stat finishes the slot, and both on the item do as well
  const top = (f) => Math.min(...Object.keys(f.ids).map(Number));
  const mod = (f, tier) => ({ id: f.ids[tier], side: f.side, tier });
  const done = (mods) => net.finished(P.toState(net.ctx, X.item(base, 'Rare', mods), {}));
  assert.ok(done([mod(cold, top(cold)), mod(life, top(life))]), 'the second stat of each slot');
  assert.ok(done([mod(fire, top(fire)), mod(cold, top(cold)), mod(mana, top(mana))]), 'two stats of one slot on the item');
  assert.ok(!done([mod(fire, top(fire)), mod(cold, top(cold))]), 'the other slot is empty');
  // the node of an item with two stats of one slot: the second is a modifier nobody asked for
  const d = net.describe(net.nodeOf(P.toState(net.ctx, X.item(base, 'Rare', [mod(fire, top(fire)), mod(cold, top(cold))]), {})));
  assert.equal(d.has.length, 1);
  assert.equal(d.otherSuffixes, 1);
  assert.deepEqual(d.miss.slice().sort(), [life.label, mana.label].sort(), 'only the other slot is missing, by either of its stats');
  // a stat that is given twice for a slot counts once, and a slot with "or" off takes its own stat only
  const twice = NW.route(X.input(white, { 'suffix-0': T(fire, 1, { or: true, alts: [T(fire, 1), T(cold, 1), T(cold, 2)] }) }));
  assert.equal(twice.goals.length, 2);
  const off = NW.route(X.input(white, { 'suffix-0': T(fire, 1, { or: false, alts: [T(cold, 1)] }) }));
  assert.equal(off.goals.length, 1);
});

test('network: a fractured twin stays a fractured modifier when the target itself rolls beside it', () => {
  // A ring wants Cold Resistance and carries a fractured Fire Resistance of the top tier: the target's twin (a Flux
  // would turn it, but a fractured modifier is not turned). When the Cold Resistance rolls beside it, the item has the
  // target and a fractured modifier nobody asked for. The network took the target for the fractured one, and the
  // item, as the reader sees it, was no node (1,572 of a hammer's crafts left the network, the fourteenth deep run).
  const X = lockWorld(), base = 'Dusk Ring';
  const cold = X.tiers(base, 'suffix', /to Cold Resistance$/), fire = X.tiers(base, 'suffix', /to Fire Resistance$/), mana = X.tiers(base, 'prefix', /to maximum Mana$/), life = X.tiers(base, 'prefix', /to maximum Life$/);
  const top = (t) => Math.min(...Object.keys(t.ids).map(Number)), low = (t) => Math.max(...Object.keys(t.ids).map(Number));
  const it = X.item(base, 'Rare', [{ id: fire.ids[top(fire)], side: 'suffix', tier: top(fire), frac: true }, { id: life.ids[low(life)], side: 'prefix', tier: low(life) }]);
  const targets = {
    'suffix-0': { fam: cold.fam, group: 'suffix', minTier: 1, required: true, label: cold.label },
    'prefix-0': { fam: mana.fam, group: 'prefix', minTier: 1, required: true, label: mana.label },
  };
  const net = NW.build(Object.assign({}, X.input(it, targets, null, { restart: 'item', itemCost: 50 }), { lite: 0, track: 8, maxStates: 120000, whittle: 'none' }));
  assert.ok(!net.unsupported && !net.impossible);
  const d0 = net.describe(net.start);
  // (A fractured modifier is no twin: a Flux leaves it as it is. The reader took it for one, a roll for a fractured
  // modifier nobody asked for: one item, two nodes, a ring at 1.16 times its promise in the seventeenth deep run.)
  assert.deepEqual(d0.twin, [], 'the fractured Fire Resistance is no twin of the Cold Resistance target');
  assert.equal(d0.fracturedOther, 'suffix', 'it is a fractured modifier nobody asked for');
  const e = net.acts[net.start].find((x) => x.a.op === 'exalt');
  assert.ok(e, 'an Exalted Orb is an edge of the pasted item');
  let seen = 0;
  for (let t = 0; t < e.out.length; t += 2) {
    if (e.out[t + 1] < 0) continue;
    const d = net.describe(e.out[t + 1]);
    const c = d.has.find((x) => x.startsWith(cold.label));
    if (!c) continue;
    seen++;
    assert.ok(!/fractured/.test(c), 'the rolled Cold Resistance is not the fractured modifier');
    assert.equal(d.fracturedOther, 'suffix', 'the Fire Resistance is: a fractured modifier nobody asked for');
  }
  assert.ok(seen > 0, 'the target can roll beside its fractured twin');
  // and the item as the reader sees it then is one of those nodes
  const both = X.item(base, 'Rare', [{ id: fire.ids[top(fire)], side: 'suffix', tier: top(fire), frac: true }, { id: cold.ids[top(cold)], side: 'suffix', tier: top(cold) }, { id: life.ids[low(life)], side: 'prefix', tier: low(life) }]);
  const n2 = net.nodeOf(P.toState(net.ctx, both, {}));
  assert.ok(n2 >= 0, 'that item is a node');
  let reached = false;
  for (let t = 0; t < e.out.length; t += 2) if (e.out[t + 1] === n2) reached = true;
  assert.ok(reached, 'and the Exalted Orb leads to it');
});

test('network: alternatives never send a request to the smaller networks, and more than eight stats still have a route', () => {
  // The player's staff of 13 Oct 2026: five slots, two of them with an alternative, were solved as a request of seven
  // targets in the smaller network (225,216 where the slots' own five stats cost 41,219). "Many targets" goes by the
  // slots. And nine stats in all had no route ("too many targets"): the last alternatives of the longest list are
  // left out until the network holds the request.
  const X = lockWorld(), base = 'Dusk Ring';
  const S = (re) => X.tiers(base, 'suffix', re), Pf = (re) => X.tiers(base, 'prefix', re);
  const fire = S(/to Fire Resistance$/), cold = S(/to Cold Resistance$/), light = S(/to Lightning Resistance$/), chaos = S(/to Chaos Resistance$/);
  const mana = Pf(/to maximum Mana$/), life = Pf(/to maximum Life$/), str = S(/to Strength$/), dex = S(/to Dexterity$/), int = S(/to Intelligence$/);
  const low = (f) => Math.max(...Object.keys(f.ids).map(Number));
  const T = (f, more) => Object.assign({ fam: f.fam, group: f.side, minTier: low(f), required: true, label: f.label }, more);
  const white = X.item(base, 'Normal');
  const plain = NW.answer(X.input(white, { 'suffix-0': T(fire), 'prefix-0': T(mana), 'suffix-1': T(str) }), {});
  assert.ok(plain.meanCost > 0 && !plain.lite);
  // three slots, seven stats
  const seven = NW.answer(X.input(white, { 'suffix-0': T(fire, { or: true, alts: [T(cold), T(light)] }), 'prefix-0': T(mana, { or: true, alts: [T(life)] }), 'suffix-1': T(str, { or: true, alts: [T(dex)] }) }), {});
  assert.ok(!seven.unsupported && !seven.impossible, 'seven stats in three slots have a route');
  assert.ok(!seven.lite, 'in the full network');
  // (alternatives stay as far as the network follows every natural stat's blockers: the rest is left out, and named)
  const nat = (a) => a.goals.filter((g) => g.kind === 'nat').length;
  assert.equal(seven.track, nat(seven), 'every natural stat has its blockers followed');
  assert.equal(seven.goals.length + seven.orLeft.length, 7);
  assert.ok(seven.goals.length > 3, 'some alternatives are followed');
  assert.ok(seven.meanCost <= plain.meanCost * 1.001, `no dearer than the slots' own stats: ${seven.meanCost} against ${plain.meanCost}`);
  // and the simulator plays it at its promise (two slots of one side with three and two stats)
  const inp7 = X.input(white, { 'suffix-0': T(fire, { or: true, alts: [T(cold), T(light)] }), 'prefix-0': T(mana, { or: true, alts: [T(life)] }), 'suffix-1': T(str, { or: true, alts: [T(dex)] }) });
  const net7 = NW.route(inp7), got = X.play(net7, inp7, 1500, 5, 200000, 90000);
  assert.equal(got.refused, 0);
  assert.equal(got.off, 0);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean / net7.cost(net7.start) - 1) < 0.1, `played ${got.mean} +-${got.se}, promised ${net7.cost(net7.start)}`);
  // three slots, nine stats: one is left out
  const nine = NW.answer(X.input(white, { 'suffix-0': T(fire, { or: true, alts: [T(cold), T(light), T(chaos)] }), 'prefix-0': T(mana, { or: true, alts: [T(life)] }), 'suffix-1': T(str, { or: true, alts: [T(dex), T(int)] }) }), {});
  assert.ok(!nine.unsupported && !nine.impossible, 'nine stats in three slots have a route');
  assert.ok(nine.goals.length <= 8);
  assert.equal(nine.goals.length + nine.orLeft.length, 9);
  assert.equal(nine.orLeft[0], chaos.label);
  assert.equal(nine.track, nat(nine));
  assert.ok(!nine.orNone);
  assert.ok(!nine.goals.some((g) => g.fam === chaos.fam), 'the last stat of the longest list is the one left out');
  assert.ok(nine.meanCost <= plain.meanCost * 1.001, `no dearer than the slots' own stats: ${nine.meanCost} against ${plain.meanCost}`);
});

test('network: two stats of one modifier group are never asked of one item', () => {
  // A staff's natural Cast Speed and the Cast Speed hybrid of an alloy are of one modifier group: the game adds no
  // modifier whose group the item has. As two targets the network priced them (673 promised, and no craft ever
  // finished); as an "or" stat beside the alloy the route chased the Cast Speed (592 promised, 4,070 played). Two
  // slots that nothing else fills are a request no item meets; an "or" stat of another slot's group is left out.
  const X = lockWorld(), base = 'Chiming Staff', white = X.item(base, 'Normal');
  const ess = X.input(white, {}).essences, ctx = X.ctxOf(base);
  // an alloy (or essence) whose modifier shares its group with a natural family of the base that is not its own
  let pair = null;
  for (const r of ess) {
    const m = kb.mods[r.mod];
    for (const side of ['prefix', 'suffix']) for (const e of P.sidePool(ctx, side, 0)) {
      if (pair || e.fam === m.fam || !e.grp.some((x) => m.grp.includes(x))) continue;
      pair = { crafted: { fam: m.fam, group: r.alloy ? 'alloy' : 'essence', required: true, label: m.txt.split('\n').join(' ') }, nat: { fam: e.fam, group: side, minTier: e.tier, required: true, label: kb.mods[e.id].txt.split('\n')[0] }, side };
    }
  }
  if (!pair) return; // (no such pair in the data of the day)
  const other = P.sidePool(ctx, pair.side, 0).find((e) => e.fam !== pair.nat.fam && !e.grp.some((x) => kb.mods[ess.find((r) => kb.mods[r.mod].fam === pair.crafted.fam).mod].grp.includes(x)));
  const third = { fam: other.fam, group: pair.side, minTier: other.tier, required: true, label: kb.mods[other.id].txt.split('\n')[0] };
  const slotA = pair.side + '-0', slotB = (kb.mods[ess.find((r) => kb.mods[r.mod].fam === pair.crafted.fam).mod].gen === 'p' ? 'prefix' : 'suffix') + '-1';
  const two = NW.answer(X.input(white, { [slotA]: pair.nat, [slotB]: pair.crafted }), {});
  assert.ok(two.impossible && two.impossible.length === 2, 'two slots of one modifier group: not possible');
  assert.match(two.impossible[0], /one modifier group/);
  const plain = NW.route(X.input(white, { [slotA]: third, [slotB]: pair.crafted }));
  const inp = X.input(white, { [slotA]: Object.assign({}, third, { or: true, alts: [pair.nat] }), [slotB]: pair.crafted });
  const or = NW.route(inp);
  assert.ok(!or.impossible && !or.unsupported);
  assert.equal(or.goals.length, 2, 'the "or" stat of the other slot\'s group is no goal');
  assert.equal(or.orLeft.length, 1);
  assert.match(or.orLeft[0], /one modifier group/);
  assert.ok(or.orNone);
  assert.ok(Math.abs(or.cost(or.start) / plain.cost(plain.start) - 1) < 1e-6, 'the route of the slots\' own stats');
  const got = X.play(or, inp, 300, 3, 200000, 90000);
  assert.equal(got.done, got.runs, 'and every craft of it ends');
  assert.ok(Math.abs(got.mean / or.cost(or.start) - 1) < 0.15, `played ${got.mean} +-${got.se}, promised ${or.cost(or.start)}`);
});

test('network: an item with two stats of one slot is the node a roll leads to, and another element is a twin of the target that needs it', () => {
  // A slot of Cold Resistance or Chaos Resistance or Intelligence, and a Lightning Resistance target. The reader took
  // an item with Intelligence and Cold Resistance for one node and a roll from the Intelligence for another; and a
  // Fire Resistance beside the Intelligence for the twin of the slot's Chaos Resistance (so for nobody's), where a
  // roll makes it the Lightning Resistance's twin. A body armour played at 1.16 times its promise, the sixteenth deep run.
  const X = lockWorld(), base = 'Dusk Ring';
  const S = (re) => X.tiers(base, 'suffix', re);
  const cold = S(/to Cold Resistance$/), chaos = S(/to Chaos Resistance$/), int = S(/to Intelligence$/), light = S(/to Lightning Resistance$/), fire = S(/to Fire Resistance$/);
  const mana = X.tiers(base, 'prefix', /to maximum Mana$/);
  const top = (t) => Math.min(...Object.keys(t.ids).map(Number)), low = (t) => Math.max(...Object.keys(t.ids).map(Number));
  const T = (f, tier, more) => Object.assign({ fam: f.fam, group: f.side, minTier: tier, required: true, label: f.label }, more);
  const targets = { 'suffix-0': T(cold, low(cold), { or: true, alts: [T(chaos, low(chaos)), T(int, low(int))] }), 'suffix-1': T(light, 2), 'prefix-0': T(mana, low(mana)) };
  const white = X.item(base, 'Normal'), net = NW.route(X.input(white, targets));
  assert.ok(!net.unsupported && !net.impossible);
  const mod = (f, tier) => ({ id: f.ids[tier], side: f.side, tier });
  const nodeOf = (mods) => net.nodeOf(P.toState(net.ctx, X.item(base, 'Rare', mods), {}));
  // two stats of the slot: one fills it, the other is a modifier nobody asked for, whatever the order
  const both = nodeOf([mod(int, top(int)), mod(cold, top(cold)), mod(mana, top(mana))]), d = net.describe(both);
  assert.ok(both >= 0);
  assert.equal(d.has.filter((h) => [cold.label, chaos.label, int.label].some((l) => h.startsWith(l))).length, 1, 'one stat fills the slot');
  assert.equal(d.otherSuffixes, 1, 'the other is nobody\'s');
  assert.equal(nodeOf([mod(cold, top(cold)), mod(int, top(int)), mod(mana, top(mana))]), both, 'the order on the item does not matter');
  // and an Exalted Orb from the item with the Intelligence leads there when the Cold Resistance rolls
  const from = nodeOf([mod(int, top(int)), mod(mana, top(mana))]), e = net.acts[from].find((x) => x.a.op === 'exalt');
  assert.ok(e, 'an Exalted Orb is an edge');
  let there = false;
  for (let t = 0; t < e.out.length; t += 2) if (e.out[t + 1] === both) there = true;
  assert.ok(there, 'the roll leads to the node the item is read as');
  // another element beside a filled slot: the twin of the target that needs it, not of the slot's other stats
  const tw = net.describe(nodeOf([mod(int, top(int)), mod(fire, 1), mod(mana, top(mana))]));
  if (tw.twin.length) assert.deepEqual(tw.twin, [light.label], 'the Fire Resistance is the Lightning Resistance\'s twin');
});

test('network: with one crafted modifier on the item, another slot can take an essence or alloy where Astrid\'s Creativity fits', () => {
  // The player's report of 14 Oct 2026: only the first slot offered essences and alloys. With a crafted modifier on
  // the item the others offered none, though Astrid's Creativity ("Can have 1 additional Crafted Modifier") makes
  // room for a second one on an item that has or can get an augment socket; the network sockets it then. A ring has
  // no augment socket: there the other slots offer none.
  const X = lockWorld();
  const setup = (base) => {
    const ess = X.input(X.item(base, 'Normal'), {}).essences, crafts = ess.filter((r) => r.alloy || r.kind === 'rare');
    const pre = crafts.find((r) => kb.mods[r.mod].gen === 'p'), suf = crafts.find((r) => kb.mods[r.mod].gen === 's');
    const it = X.item(base, 'Rare', [{ id: pre.mod, side: 'prefix', crafted: true }]);
    const offered = E.pickerOptions(X.D.ix, it, { side: 'suffix', essences: ess }).filter((o) => ['essence', 'alloy'].includes(o.group) && o.ok);
    return { ess, pre, suf, it, offered };
  };
  const staff = setup('Chiming Staff');
  assert.ok(staff.it.mods.some((m) => m.crafted), 'the staff has a crafted modifier');
  assert.ok(staff.offered.length > 0, 'its other slots offer essences and alloys');
  const T = (r) => ({ fam: kb.mods[r.mod].fam, group: r.alloy ? 'alloy' : 'essence', label: kb.mods[r.mod].txt.split('\n').join(' '), minTier: null, required: true });
  const inp = X.input(staff.it, { 'prefix-0': T(staff.pre), 'suffix-0': T(staff.suf) }), net = NW.route(inp);
  assert.ok(!net.impossible && !net.unsupported, 'the network routes both crafted modifiers');
  assert.ok(net.materials(net.start).some((m) => /Astrid/.test(m.name)), 'with Astrid\'s Creativity');
  const got = X.play(net, inp, 600, 7, 200000, 90000);
  assert.equal(got.done, got.runs);
  assert.ok(Math.abs(got.mean / net.cost(net.start) - 1) < 0.1, `played ${got.mean} +-${got.se}, promised ${net.cost(net.start)}`);
  const ring = setup('Dusk Ring');
  assert.equal(ring.offered.length, 0, 'a ring has no augment socket for the rune');
});

test('network: the flat edge arrays read back as the edges, the lock\'s too', () => {
  // Since 17 Oct 2026 the edges are flat typed arrays (2.4 times less memory a node); net.acts, step, options and
  // lockSteps are made from them when asked. A network whose route uses Hinekora's Lock (priced at 3 here) has both
  // kinds: the node's own edges, and the lock's edge after them, made again while the network is solved.
  const X = lockWorld(), base = 'Totemic Greaves';
  const targets = {};
  [['prefix', /increased Movement Speed$/], ['suffix', /to Fire Resistance$/]].forEach(([side, re], k) => { const f = X.tiers(base, side, re); targets[side + '-' + k] = { fam: f.fam, group: side, minTier: 1, required: true, label: f.label }; });
  const net = NW.build(Object.assign(X.input(X.item(base, 'Normal'), targets, { "Hinekora's Lock": 3 }), { lite: 0, track: 8, whittle: 'none' }));
  assert.ok(!net.unsupported && !net.impossible);
  const st = net.storage();
  assert.ok(st.edges >= st.distinct && st.outcomes > 0 && st.bytes > 0);
  assert.ok(st.lock > 0, 'the route uses the lock somewhere');
  assert.equal(net.acts.length, net.N);
  let lockNodes = 0;
  for (let s = 0; s < net.N; s++) {
    const list = net.acts[s];
    for (const e of list) {
      let sum = 0;
      for (let t = 0; t < e.out.length; t += 2) { sum += e.out[t]; assert.ok(e.out[t + 1] === -1 || (e.out[t + 1] >= 0 && e.out[t + 1] < net.N)); }
      assert.ok(Math.abs(sum - 1) < 1e-9, 'an edge\'s chances add up to one');
    }
    const lockAt = list.findIndex((e) => e.a.op === 'lock');
    if (lockAt >= 0) { lockNodes++; assert.equal(lockAt, list.length - 1, 'the lock\'s edge comes after the node\'s own'); }
    const step = net.step(s);
    if (net.pol[s] >= 0) {
      assert.deepEqual({ a: step.a, cost: step.cost, out: step.out }, list[net.pol[s]], 'the step is the edge the rule set chose');
      if (step.a.op === 'lock') assert.deepEqual(net.lockSteps(s).map((c) => c.a), step.a.cand.map((k) => list[k].a));
    }
  }
  assert.ok(lockNodes > 0);
  assert.ok(net.acts.some((l) => l.some((e) => e.a.op === 'lock')), 'the view iterates like an array');
});
