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
