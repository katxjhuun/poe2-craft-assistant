// node --test app/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../engine.js');
const P = require('../planner.js');
const SAMPLES = require('../samples.js');
const kb = require(process.env.POE2_KB || path.join(__dirname, '..', '..', 'poe2_kb_0.5.5.json')); // POE2_KB: test a candidate KB
const ix = E.buildIndex(kb);
const parse = (id, patch) => {
  let t = SAMPLES.find((s) => s.id === id).text;
  if (patch) t = patch(t);
  return E.parseItem(ix, t).item;
};
const ctxOf = (item) => P.makeContext(ix, item);

// ------------------------------------------------------------------ 10.2 rules
test('10.2 three prefixes + Omen of Sinistral Exaltation + Exalted Orb is rejected', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  st.mods.push({ id: 'IncreasedMana1', fam: 'x', side: 'prefix', lvl: 1, grp: ['x'], tier: 9, frac: false, des: false, crafted: false, lock: false });
  assert.match(P.validate(ctx, st, { op: 'exalt', side: 'prefix' }), /already has 3 prefix/);
  assert.equal(P.validate(ctx, st, { op: 'exalt', side: 'suffix' }), null);
});

test('10.2 Exalted Orb needs Rare; Alchemy works on Normal and Magic', () => {
  const magic = parse('magic-helmet-plain');
  const ctx = ctxOf(magic);
  const st = P.toState(ctx, magic);
  assert.match(P.validate(ctx, st, { op: 'exalt' }), /Rare/);
  assert.equal(P.validate(ctx, st, { op: 'alchemy' }), null);
  assert.equal(P.validate(ctx, Object.assign({}, st, { rarity: 'Normal', mods: [] }), { op: 'alchemy' }), null);
});

test('10.2 crafted mod present: no second essence or alloy', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  st.mods[0].crafted = true;
  assert.match(P.validate(ctx, st, { op: 'essence' }), /one crafted/);
  assert.match(P.validate(ctx, st, { op: 'alloy' }), /one crafted/);
});

test('10.2 desecrated mod present: no second bone; the plan starts with Omen of Light + Annulment', () => {
  const item = parse('rare-helmet-desecrated');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  assert.match(P.validate(ctx, st, { op: 'bone', quality: 'Preserved' }), /one Desecrated/);
  const fam = 'AbyssModHelmUlamanSuffixLifeCostEfficiency';
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-2': { fam: kb.mods[fam].fam, group: 'desecrated', minTier: 1, required: true, label: 'Life Cost Efficiency' } });
  goals.forEach((g) => { g.eff = g.tier; });
  const next = P.makePolicy(ctx, goals, { tier: 'base', sideOmens: true, removal: 'erasure', bone: 'Preserved' })(st);
  assert.deepEqual([next.op, next.light], ['annul', true]);
  assert.deepEqual(P.actionNames(next, ctx), ['Omen of Light', 'Orb of Annulment']);
});

test('10.2 fractured mods are never removed', () => {
  const item = parse('rare-boots-fractured');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const rng = P.rngFrom(5);
  for (let i = 0; i < 3000; i++) {
    const a = [{ op: 'chaos' }, { op: 'chaos', side: 'prefix' }, { op: 'annul' }, { op: 'annul', side: 'prefix', greater: true }, { op: 'chaos', whittle: true }][i % 5];
    if (P.validate(ctx, st, a)) continue;
    const r = P.apply(ctx, st, a, rng);
    assert.ok(r.state.mods.some((m) => m.frac && m.fam === 'MovementVelocity'));
    assert.ok(!r.removed.some((m) => m.frac));
  }
});

test('10.2 lich omens only for weapon or jewellery desecration', () => {
  const helm = parse('rare-helmet-desecrated', (t) => t.replace(/\{ Desecrated Suffix Modifier \}\n.*\n/, ''));
  const hctx = ctxOf(helm);
  assert.match(P.validate(hctx, P.toState(hctx, helm), { op: 'bone', quality: 'Preserved', lich: 'Amanamu' }), /weapon or jewellery/);
  const amu = parse('rare-amulet-plain');
  const actx = ctxOf(amu);
  const ast = P.toState(actx, amu);
  ast.rarity = 'Rare';
  assert.equal(P.validate(actx, Object.assign(ast, { mods: ast.mods.slice(0, 3) }), { op: 'bone', quality: 'Preserved', lich: 'Amanamu' }), null);
});

test('10.2 corrupted items reject normal currency', () => {
  const item = parse('rare-amulet-corrupted');
  const ctx = ctxOf(item);
  assert.match(P.validate(ctx, P.toState(ctx, item), { op: 'exalt' }), /Corrupted/);
});

test('Gnawed bones need item level 64 or lower', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  assert.match(P.validate(ctx, P.toState(ctx, item), { op: 'bone', quality: 'Gnawed' }), /64/);
});

// ------------------------------------------------------------------ pools and floors
test('Perfect Exalted floor removes +1/+2 minion level from the sceptre suffix pool', () => {
  const ctx = ctxOf(parse('rare-sceptre-adv'));
  const fam = 'GlobalIncreaseMinionSpellSkillGemLevelWeapon';
  assert.deepEqual(P.sidePool(ctx, 'suffix', 50).filter((e) => e.fam === fam).map((e) => e.lvl).sort(), [55, 78]);
  assert.equal(P.sidePool(ctx, 'suffix', 0).filter((e) => e.fam === fam).length, 4);
});

test('rolled mods respect groups and item level', () => {
  const item = parse('rare-sceptre-adv', (t) => t.replace('Item Level: 82', 'Item Level: 75'));
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const rng = P.rngFrom(11);
  for (let i = 0; i < 2000; i++) {
    const r = P.apply(ctx, st, { op: 'exalt', side: 'suffix' }, rng);
    const add = r.added[0];
    assert.ok(add.lvl <= 75);
    assert.ok(!add.grp.includes('IncreaseSocketedGemLevel'), 'minion level group is already on the item');
  }
});

// ------------------------------------------------------------------ policy and simulation
test('a lower tier of the goal stat is removed before slamming', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 1, required: true, label: '+# to Level of all Minion Skills' } });
  goals.forEach((g) => { g.eff = g.tier; });
  const a = P.makePolicy(ctx, goals, { tier: 'perfect', sideOmens: true, removal: 'erasure' })(st);
  assert.deepEqual([a.op, a.side], ['chaos', 'suffix']);
});

test('simulation is deterministic and finds the sceptre goal', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 1, required: true, label: 'minion level' } });
  goals.forEach((g) => { g.eff = g.tier; });
  const price = (n) => ({ 'Perfect Chaos Orb': 4000, 'Omen of Dextral Erasure': 5000, 'Perfect Exalted Orb': 1500, 'Omen of Dextral Exaltation': 20 }[n] ?? 1);
  const params = { tier: 'perfect', sideOmens: true, removal: 'erasure' };
  const r1 = P.simulate(ctx, st, goals, params, { trials: 800, seed: 42, priceOf: price });
  const r2 = P.simulate(ctx, st, goals, params, { trials: 800, seed: 42, priceOf: price });
  assert.equal(r1.p, r2.p);
  assert.equal(r1.meanCost, r2.meanCost);
  assert.ok(r1.p > 0.3, 'success rate ' + r1.p);
  assert.ok(r1.steps.some((s) => s.key === 'Omen of Dextral Erasure + Perfect Chaos Orb'));
  assert.ok(r1.pLow <= r1.p && r1.p <= r1.pHigh);
});

test('buildPlans returns three profiles with costs from the price function', async () => {
  const item = parse('rare-sceptre-adv');
  const targets = {
    'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 1, required: true, label: 'minion level' },
    'prefix-2': { fam: 'AlliesInPresenceAllDamage', group: 'prefix', minTier: 2, required: true, label: 'allies damage' },
    'suffix-1': { fam: 'MinionLife', group: 'suffix', minTier: 1, required: false, label: 'minion life' },
  };
  const out = await P.buildPlans({ ix, item, targets, locks: {}, priceOf: () => 10, trials: 1500, screenTrials: 200 });
  assert.deepEqual(Object.keys(out.profiles), ['cheap', 'balanced', 'premium']);
  for (const k of ['cheap', 'balanced', 'premium']) {
    const p = out.profiles[k];
    assert.ok(p.p > 0, k + ' has a success chance');
    assert.ok(p.meanCost > 0 && isFinite(p.costPerSuccess));
    assert.ok(p.steps.length > 0);
  }
  assert.equal(out.profiles.cheap.goals.length, 2, 'cheap drops nice-to-have goals');
  assert.ok(out.profiles.cheap.goals.every((g) => g.eff === 3), 'cheap accepts T3');
  assert.equal(out.profiles.premium.goals.length, 3);
});

test('impossible goals are reported instead of planned', async () => {
  const item = parse('rare-sceptre-adv', (t) => t.replace('Item Level: 82', 'Item Level: 60'));
  const targets = { 'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 1, required: true, label: 'minion level' } };
  const out = await P.buildPlans({ ix, item, targets, locks: {}, priceOf: () => 1, trials: 200, screenTrials: 50 });
  assert.ok(out.profiles.premium.impossible[0].includes('item level'));
});

test('step evaluation: hit, miss and loss', () => {
  const before = parse('rare-sceptre-adv', (t) => t.replace(/\{ Suffix Modifier \(Tier: 2\) — Minion, Life \}\nMinions have 43\(41-45\)% increased maximum Life\n?/, ''));
  const after = parse('rare-sceptre-adv');
  const ctx = ctxOf(after);
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-1': { fam: 'MinionLife', group: 'suffix', minTier: 2, required: true, label: 'minion life' } });
  goals.forEach((g) => { g.eff = g.tier; });
  assert.equal(P.evaluateStep(ix, before, after, goals, { op: 'exalt', side: 'suffix' }).verdict, 'expected');
  assert.equal(P.evaluateStep(ix, after, before, goals, { op: 'annul' }).verdict, 'deviation');
  assert.equal(P.evaluateStep(ix, before, before, goals, { op: 'exalt' }).verdict, 'deviation');
});

// ------------------------------------------------------------------ essences
const W = require('../data/weights_0.5.5.json');
test('essence rules: Magic-only, Rare-only, one crafted slot', () => {
  const magic = parse('magic-helmet-plain');
  const ctx = P.makeContext(ix, magic, { essences: W.essences.Helmet });
  const st = P.toState(ctx, magic);
  assert.equal(P.validate(ctx, st, { op: 'essence', item: 'Greater Essence of the Body', mod: 'IncreasedLife6' }), null);
  assert.match(P.validate(ctx, st, { op: 'pessence', item: 'Essence of Hysteria', mod: 'IncreasedLife6' }), /Rare/);
  const rare = Object.assign(P.toState(ctx, magic), { rarity: 'Rare' });
  assert.match(P.validate(ctx, rare, { op: 'essence', item: 'Greater Essence of the Body', mod: 'IncreasedLife6' }), /Magic/);
  rare.mods[0].crafted = true;
  assert.match(P.validate(ctx, rare, { op: 'pessence', item: 'x', mod: 'IncreasedLife6' }), /one crafted/);
});

test('policy uses a Magic essence that guarantees an unmet goal', () => {
  const boots = E.parseItem(ix, ['Item Class: Boots', 'Rarity: Magic', 'Totemic Greaves', '--------', 'Item Level: 81', '--------', '30% increased Movement Speed'].join('\n')).item;
  const ctx = P.makeContext(ix, boots, { essences: W.essences.Boots });
  const st = P.toState(ctx, boots);
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': { fam: 'FireResistance', group: 'suffix', minTier: 4, required: true, label: 'fire res' } });
  goals.forEach((g) => { g.eff = g.tier; });
  const a = P.makePolicy(ctx, goals, { tier: 'base', essence: true, restart: true, start: 'transmute' })(st);
  assert.equal(a.op, 'essence');
  assert.match(a.item, /Essence of Insulation/);
  const r = P.apply(ctx, st, a, P.rngFrom(1));
  assert.equal(r.state.rarity, 'Rare');
  assert.ok(r.state.mods.some((m) => m.crafted && m.fam === 'FireResistance'));
  const b = P.makePolicy(ctx, goals, { tier: 'base', essence: false, restart: true, start: 'transmute' })(st);
  assert.notEqual(b.op, 'essence');
});

test('plans consider essences and keep the cheaper route', async () => {
  const item = E.parseItem(ix, ['Item Class: Boots', 'Rarity: Normal', 'Totemic Greaves', '--------', 'Item Level: 81'].join('\n')).item;
  const targets = { 'suffix-0': { fam: 'FireResistance', group: 'suffix', minTier: 3, required: true, label: 'fire res' } };
  const out = await P.buildPlans({ ix, item, targets, locks: {}, priceOf: (n) => (/Essence/.test(n) ? 3 : 1), baseCost: 1, essences: W.essences.Boots, trials: 800, screenTrials: 120 });
  const cheap = out.profiles.cheap;
  assert.ok(cheap.steps.some((s) => s.action.op === 'essence'), cheap.steps.map((s) => s.key).join(' | '));
  assert.ok(cheap.p > 0.95);
});

test('success and fail chance add up and fail is split by cause', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 1, required: true, label: 'minion level' } });
  goals.forEach((g) => { g.eff = g.tier; });
  const params = { tier: 'perfect', sideOmens: true, removal: 'erasure' };
  const price = () => 100;
  const free = P.simulate(ctx, st, goals, params, { trials: 400, seed: 3, priceOf: price });
  assert.ok(Math.abs(free.p + free.pFail - 1) < 1e-9);
  assert.ok(Math.abs(free.failDead + free.failBudget + free.unfinished - free.pFail) < 1e-9);
  assert.equal(free.failBudget, 0, 'no budget, no budget failures');
  const tight = P.simulate(ctx, st, goals, params, { trials: 400, seed: 3, priceOf: price, budget: 150 });
  assert.ok(tight.failBudget > 0.9, String(tight.failBudget));
});

test('finish-within chances grow to the plan success', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 1, required: true, label: 'minion level' } });
  goals.forEach((g) => { g.eff = g.tier; });
  const r = P.simulate(ctx, st, goals, { tier: 'perfect', sideOmens: true, removal: 'erasure' }, { trials: 500, seed: 9, priceOf: () => 1 });
  const ws = r.finishWithin.map((x) => x.p);
  for (let i = 1; i < ws.length; i++) assert.ok(ws[i] >= ws[i - 1]);
  assert.ok(Math.abs(ws[ws.length - 1] - r.p) < 1e-9, 'within 600 uses equals the plan success');
});

// ------------------------------------------------------------------ minimum values, fracture, step preview
function lifeGoal(ctx, minValue) {
  const item = ctx.item;
  const m = item.mods.find((x) => /Minions have/.test(x.text));
  return P.goalsFromTargets(ctx, { 'suffix-1': { fam: m.fam, group: 'suffix', minTier: null, minValue, required: true, label: 'Minions have #% increased maximum Life' } }).goals;
}

test('6.3 minimum value: met, fixed by Divine Orb, or removed when the tier cannot reach it', () => {
  const item = parse('rare-sceptre-adv'); // Minions have 43(41-45)% increased maximum Life
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const at = (v) => { const g = lifeGoal(ctx, v); g.forEach((x) => { x.eff = x.tier; }); return g; };
  assert.equal(P.goalMet(st, at(40)[0]), true);
  const g45 = at(45);
  assert.equal(P.goalMet(st, g45[0]), false);
  const a = P.makePolicy(ctx, g45, { tier: 'base', sideOmens: true, removal: 'erasure' })(st);
  assert.equal(a.op, 'divine');
  assert.deepEqual(P.actionNames(a, ctx), ['Divine Orb']);
  const r = P.simulate(ctx, st, g45, { tier: 'base', sideOmens: true, removal: 'erasure' }, { trials: 2000, seed: 5, priceOf: () => 1 });
  assert.ok(r.p > 0.99, 'reaches 45 by rerolling ' + r.p);
  assert.ok(Math.abs(r.meanSteps - 5) < 0.6, 'about 1 in 5 rolls is 45: ' + r.meanSteps); // 41..45 uniform
  // A value above the tier's range: the mod is junk and gets replaced.
  const hi = at(200);
  assert.ok(P.nearMiss(st.mods.find((m) => m.fam === hi[0].fam), hi[0]) === false);
});

test('Fracturing Orb: needs 4 mods, locks one at random, and a plan variant uses it on a finished goal', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const three = Object.assign({}, st, { mods: st.mods.slice(0, 3) });
  assert.match(P.validate(ctx, three, { op: 'fracture' }), /at least 4/);
  const r = P.apply(ctx, st, { op: 'fracture' }, P.rngFrom(3));
  assert.equal(r.state.mods.filter((m) => m.frac).length, 1);
  const lvl = item.mods.find((x) => /Level of all Minion/.test(x.text));
  const life = item.mods.find((x) => /Minions have/.test(x.text));
  const { goals } = P.goalsFromTargets(ctx, {
    'suffix-0': { fam: lvl.fam, group: 'suffix', minTier: 2, required: true, label: 'minion level' },
    'suffix-1': { fam: life.fam, group: 'suffix', minTier: 1, required: true, label: 'minion life' },
  });
  goals.forEach((g) => { g.eff = g.tier; });
  assert.equal(P.makePolicy(ctx, goals, { tier: 'perfect', sideOmens: true, removal: 'erasure', fracture: true })(st).op, 'fracture');
  assert.notEqual(P.makePolicy(ctx, goals, { tier: 'perfect', sideOmens: true, removal: 'erasure' })(st).op, 'fracture');
});

test('6.2 step preview: outcome shares add up and only the chosen side loses a mod', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const lvl = item.mods.find((x) => /Level of all Minion/.test(x.text));
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': { fam: lvl.fam, group: 'suffix', minTier: 1, required: true, label: 'minion level' } });
  goals.forEach((g) => { g.eff = g.tier; });
  const pv = P.stepPreview(ix, item, {}, goals, { op: 'chaos', tier: 'perfect', side: 'suffix' }, null, 2000);
  assert.ok(Math.abs(pv.success + pv.miss + pv.damage - 1) < 1e-9);
  assert.ok(pv.removes.every((r) => r.side === 'suffix'));
  assert.ok(Math.abs(pv.removes.reduce((t, r) => t + r.p, 0) - 1) < 1e-9, 'one suffix removed per use');
  const hit = pv.adds.find((a) => a.fam === lvl.fam);
  assert.ok(hit && hit.goal > 0 && hit.tMin === 1, 'the goal family can land at T1');
  assert.equal(pv.adds[0].fam, lvl.fam, 'goal outcomes are listed first');
  assert.equal(P.stepPreview(ix, item, {}, goals, { op: 'augment' }, null, 100), null, 'Augmentation on a Rare is not allowed');
});

// ------------------------------------------------------------------ 7.2 every crafting operator, availability from the rules
test('10.2 corrupted items list only corrupted-item currency; the Orb of Sacrifice needs a Corruption Enchantment', () => {
  const plain = parse('rare-amulet-corrupted');
  const ids = P.availableOps(ix, plain).map((o) => o.id);
  assert.deepEqual(ids, ['architect']);
  const enchanted = parse('rare-amulet-corrupted', (t) => t.replace('{ Implicit Modifier', '{ Corruption Implicit Modifier'));
  const ops = P.availableOps(ix, enchanted);
  assert.deepEqual(ops.map((o) => o.id).sort(), ['architect', 'sacrifice']);
  assert.deepEqual(ops.find((o) => o.id === 'sacrifice').cur, ["Kamasa's Orb of Sacrifice"]);
  const ctx = ctxOf(enchanted);
  assert.match(P.validate(ctx, P.toState(ctx, enchanted), { op: 'sacrifice', item: "Kopec's Orb of Sacrifice" }), /does not work on Amulet/);
});

test('10.2 lich omens are listed for weapons and jewellery only; armour shows why', () => {
  const boots = P.availableOps(ix, parse('rare-boots-fractured')).find((o) => o.id === 'desecrate');
  assert.ok(!boots.omens.includes('Omen of the Liege'));
  assert.ok(boots.blocked.some((b) => b.name === 'Omen of the Liege' && /weapon or jewellery/.test(b.reason)));
  const wand = P.availableOps(ix, E.parseItem(ix, 'Item Class: Wands\nRarity: Rare\nDoom Song\nAttuned Wand\n--------\nItem Level: 82').item).find((o) => o.id === 'desecrate');
  assert.ok(wand.omens.includes('Omen of the Liege'));
  // desecrated equipment modifiers are level 65 in the game data: below item level 65 nothing can roll, lich omens say why
  const low = P.availableOps(ix, E.parseItem(ix, 'Item Class: Wands\nRarity: Rare\nDoom Song\nAttuned Wand\n--------\nItem Level: 60').item, { all: true }).find((o) => o.id === 'desecrate');
  assert.ok(!low.ok && /no desecrated modifier/.test(low.reason));
  assert.ok(!low.omens.includes('Omen of the Liege') && low.blocked.some((b) => b.name === 'Omen of the Liege' && /65/.test(b.reason)));
  // no desecrated modifier has a sceptre spawn tag in the game data
  const sceptre = P.availableOps(ix, parse('rare-sceptre-adv'), { all: true }).find((o) => o.id === 'desecrate');
  assert.ok(!sceptre.ok && /no desecrated modifier/.test(sceptre.reason));
});

test('game text rules: Minimum Modifier Level gates the item level, Fracturing Orb, full desecration, Divine and fractured values', () => {
  const W = require('../data/weights_0.5.5.json');
  const low = E.parseItem(ix, 'Item Class: Wands\nRarity: Normal\nAttuned Wand\n--------\nItem Level: 60').item;
  const ctx = P.makeContext(ix, low), st = P.toState(ctx, low);
  assert.match(P.validate(ctx, st, { op: 'transmute', tier: 'perfect' }), /below item level 70/);
  assert.equal(P.validate(ctx, st, { op: 'transmute', tier: 'greater' }), null);
  // Fracturing Orb: "Cannot be used on Fractured items"
  const boots = parse('rare-boots-fractured');
  const bctx = ctxOf(boots), bst = P.toState(bctx, boots);
  assert.match(P.validate(bctx, bst, { op: 'fracture' }), /Fractured items/);
  // desecrating a full item removes a random (non-fractured) modifier and adds the desecrated one
  const wand = E.parseItem(ix, 'Item Class: Wands\nRarity: Rare\nDoom Song\nAttuned Wand\n--------\nItem Level: 82').item;
  const wctx = P.makeContext(ix, wand, { weights: W.pages[W.base_page[wand.base]] ? W.pages[W.base_page[wand.base]].weights : null });
  let full = P.toState(wctx, wand);
  const rng = P.rngFrom(3);
  while (full.mods.length < 6) full = P.apply(wctx, full, { op: 'exalt' }, rng).state;
  full.mods[0].frac = true;
  assert.equal(P.validate(wctx, full, { op: 'bone', quality: 'Preserved' }), null);
  for (let i = 0; i < 30; i++) {
    const r = P.apply(wctx, full, { op: 'bone', quality: 'Preserved' }, rng);
    assert.equal(r.removed.length, 1);
    assert.ok(!r.removed[0].frac, 'a fractured modifier is never removed');
    assert.ok(r.added.length === 1 && r.added[0].des && r.state.mods.length === 6);
  }
  // Divine Orb: a fractured value stays, and a fractured near miss is not something a Divine can fix
  const g = { fam: full.mods[0].fam, des: false, minValue: 1e9 };
  wctx.needValues = true;
  const vals = P.toState(wctx, wand);
  vals.mods = full.mods.map((m) => Object.assign({}, m, { v: 1, hi: 1e10 }));
  const after = P.apply(wctx, vals, { op: 'divine' }, rng).state;
  assert.equal(after.mods[0].v, 1);
  assert.ok(!P.nearMiss(vals.mods[0], g) && P.nearMiss(Object.assign({}, vals.mods[0], { frac: false }), g));
});

test('7.2 operator rules: chance, quality, infuser, flux, liquid emotions, mirrored and sanctified items', () => {
  const sceptre = parse('rare-sceptre-adv');
  const ctx = ctxOf(sceptre), st = P.toState(ctx, sceptre);
  assert.match(P.validate(ctx, st, { op: 'chance' }), /Normal/);
  assert.equal(P.validate(ctx, st, { op: 'quality', item: "Arcanist's Etcher" }), null);
  assert.match(P.validate(ctx, st, { op: 'quality', item: "Armourer's Scrap" }), /does not work on Sceptre/);
  assert.match(P.validate(ctx, Object.assign({}, st, { quality: 20 }), { op: 'quality' }), /20%/);
  assert.equal(P.validate(ctx, st, { op: 'infuser' }), null);
  assert.match(P.validate(ctx, st, { op: 'artificer' }), /martial weapons, wands, staves and armour/);
  assert.match(P.validate(ctx, st, { op: 'flux', to: 'fire' }), /needs a resistance modifier/);
  assert.match(P.validate(ctx, Object.assign({}, st, { mirrored: true }), { op: 'divine' }), /Mirrored/);
  assert.match(P.validate(ctx, Object.assign({}, st, { sanctified: true }), { op: 'exalt' }), /Sanctified/);
  assert.match(P.validate(ctx, Object.assign({}, st, { corrupted: true }), { op: 'vaal' }), /Corrupted items only accept/);
  assert.match(P.validate(ctx, st, { op: 'liquid' }), /Rare jewels/);
  const names = P.availableOps(ix, sceptre).flatMap((o) => o.cur.concat(o.omens));
  for (const n of names) assert.ok(kb.currency_metadata_ids[n] || kb.item_descriptions[n] || kb.augments[n], 'known PoE2 name: ' + n);
});

test('Flux turns a resistance into the same tier of another element, and the planner uses it for a resistance goal', () => {
  const boots = parse('rare-boots-fractured');
  const ctx = ctxOf(boots), st = P.toState(ctx, boots);
  const cold = st.mods.find((m) => m.fam === 'ColdResistance');
  assert.ok(cold, 'the sample has a cold resistance mod');
  const r = P.apply(ctx, st, { op: 'flux', to: 'fire' }, P.rngFrom(1));
  const fire = r.state.mods.find((m) => m.fam === 'FireResistance');
  assert.ok(fire && !r.state.mods.some((m) => m.fam === 'ColdResistance'));
  assert.equal(P.resElement(fire.id).n, P.resElement(cold.id).n, 'same tier number');
  assert.deepEqual(P.actionNames({ op: 'flux', to: 'fire' }), ['Blazing Flux']);
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-2': { fam: 'FireResistance', group: 'suffix', minTier: 8, required: true, label: 'fire res' } });
  goals.forEach((g) => { g.eff = g.tier; });
  assert.deepEqual(P.makePolicy(ctx, goals, { tier: 'base', sideOmens: true, removal: 'erasure' })(st), { op: 'flux', to: 'fire' });
  // Not when the cold resistance is itself a finished goal.
  const both = P.goalsFromTargets(ctx, {
    'suffix-2': { fam: 'FireResistance', group: 'suffix', minTier: 8, required: true, label: 'fire res' },
    'suffix-0': { fam: 'ColdResistance', group: 'suffix', minTier: 8, required: true, label: 'cold res' },
  }).goals;
  both.forEach((g) => { g.eff = g.tier; });
  assert.notEqual(P.makePolicy(ctx, both, { tier: 'base', sideOmens: true, removal: 'erasure' })(st).op, 'flux');
});

test('7.2 Omen of Catalysing Exaltation raises matching mods by the player\'s multiplier and uses up the quality', () => {
  const amulet = parse('rare-amulet-plain', (t) => t.replace('--------\nItem Level', '--------\nQuality (Life Modifiers): +20% (augmented)\n--------\nItem Level'));
  assert.equal(amulet.qualityType, 'Life Modifiers');
  const share = (mult, catalyse) => {
    const ctx = P.makeContext(ix, amulet, { catalystMult: mult });
    const st = P.toState(ctx, amulet);
    assert.equal(st.catTag, 'life');
    const rng = P.rngFrom(9);
    let life = 0, n = 3000, left = 0;
    for (let i = 0; i < n; i++) {
      const r = P.apply(ctx, st, { op: 'exalt', catalyse }, rng);
      if (r.added.some((m) => kb.mods[m.id].mt.includes('life'))) life++;
      left += r.state.catQ;
    }
    return { p: life / n, left };
  };
  const plain = share(3, false), boosted = share(3, true);
  assert.ok(boosted.p > plain.p * 1.6, `boosted ${boosted.p} vs ${plain.p}`);
  assert.equal(boosted.left, 0, 'quality consumed');
  assert.ok(plain.left > 0, 'no omen: quality stays');
  assert.deepEqual(P.actionNames({ op: 'exalt', catalyse: true }), ['Omen of Catalysing Exaltation', 'Exalted Orb']);
});

// ------------------------------------------------------------------ 7.4 candidates: recipes and beam search
test('7.4 recipe steps become strategy settings', () => {
  const lib = require('../data/recipes_0.5.5.json');
  const r = lib.recipes.find((x) => x.id === 'c1a');
  const p = P.recipeParams(r);
  assert.equal(p.start, 'transmute');
  assert.equal(p.tier, 'greater');
  assert.equal(p.sideOmens, true);
  assert.deepEqual(P.recipeParams({ steps: [{ text: 'Chaos Orb with Omen of Whittling, then Perfect Exalted Orb', names: [] }] }), { removal: 'whittle', tier: 'perfect' });
});

test('7.4 per-operation orb tiers: Perfect Exalted with basic Chaos', () => {
  const item = parse('rare-sceptre-adv');
  const ctx = ctxOf(item);
  const st = P.toState(ctx, item);
  const lvl = item.mods.find((x) => /Level of all Minion/.test(x.text));
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': { fam: lvl.fam, group: 'suffix', minTier: 1, required: true, label: 'lvl' } });
  goals.forEach((g) => { g.eff = g.tier; });
  const params = P.expandStrategy({ tier: 'base', exaltTier: 'perfect', removal: 'erasure', sideOmens: true });
  assert.equal(params.chaosTier, 'base');
  const a = P.makePolicy(ctx, goals, params)(st);
  assert.deepEqual([a.op, a.tier], ['chaos', 'base']); // the T2 minion level blocks the family: clear it with a basic Chaos Orb
  const noJunk = Object.assign({}, st, { mods: st.mods.filter((m) => m.fam !== lvl.fam) });
  const b = P.makePolicy(ctx, goals, params)(noJunk);
  assert.deepEqual([b.op, b.tier], ['exalt', 'perfect']);
});

test('7.4 beam search never returns a worse plan than the screened grid', async () => {
  const item = parse('rare-sceptre-adv');
  const lvl = item.mods.find((x) => /Level of all Minion/.test(x.text));
  const input = { ix, item, targets: { 'suffix-0': { fam: lvl.fam, group: 'suffix', minTier: 1, required: true, label: 'lvl' } }, locks: {},
    priceOf: (n) => ({ 'Perfect Chaos Orb': 900, 'Omen of Dextral Erasure': 5000, 'Perfect Exalted Orb': 1500, 'Greater Exalted Orb': 5, 'Greater Chaos Orb': 190, 'Chaos Orb': 80 }[n] ?? 20),
    baseCost: 1, budget: 0, beamBudgetMs: 0, trials: 800, timeBudgetMs: 800 };
  const out = await P.buildPlans(input);
  const pl = out.profiles.balanced;
  assert.ok(pl.seeds && pl.seeds.length >= 1, 'screened candidates kept for the search');
  assert.equal(pl.search.searched, false);
  const better = await P.improvePlan(Object.assign({}, input, { beamBudgetMs: 800 }), pl);
  assert.equal(better.search.searched, true);
  const score = P.PROFILES.balanced.score;
  assert.ok(score(better) <= score(pl) + 1e-9, `search result ${score(better)} vs grid ${score(pl)}`);
});

test('an omen without a price is left out of the plan instead of counting as free', async () => {
  const item = E.parseItem(ix, 'Item Class: Sceptres\nRarity: Normal\nRattling Sceptre\n--------\nItem Level: 82').item;
  const targets = { // two suffixes need a Rare, so the plan goes through a Regal Orb (where Coronation omens aim)
    'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 2, required: true, label: 'minion level' },
    'suffix-1': { fam: 'MinionLife', group: 'suffix', minTier: 3, required: true, label: 'minion life' },
  };
  const priceOf = (n) => (/Coronation/.test(n) ? null : 5);
  const out = await P.buildPlans({ ix, item, targets, locks: {}, priceOf, trials: 400, screenTrials: 80, beamBudgetMs: 0 });
  const bal = out.profiles.balanced;
  assert.ok(bal.params.sideOmens, 'the balanced grid aims with side omens');
  assert.ok(!bal.missingPrices.some((n) => /Coronation/.test(n)), 'not counted at 0');
  assert.ok(bal.skippedUnpriced.some((n) => /Coronation/.test(n)), 'reported as left out');
  assert.ok(!bal.steps.some((s) => s.names.some((n) => /Coronation/.test(n))), 'no step uses it');
  assert.ok(bal.steps.some((s) => s.names.includes('Omen of Dextral Exaltation')), 'priced side omens are still used');
  // with a price the omen comes back
  const priced = await P.buildPlans({ ix, item, targets, locks: {}, priceOf: () => 5, trials: 400, screenTrials: 80, beamBudgetMs: 0 });
  assert.deepEqual(priced.profiles.balanced.skippedUnpriced, []);
});

test('white base: starting over (pair, slamOnly) beats paying for removals, and counts the bases a finished item takes', () => {
  const W = require('../data/weights_0.5.5.json');
  const item = E.parseItem(ix, 'Item Class: Sceptres\nRarity: Normal\nRattling Sceptre\n--------\nItem Level: 82').item;
  const ctx = P.makeContext(ix, item, { weights: W.pages[W.base_page[item.base]].weights });
  const st = P.toState(ctx, item);
  const target = (stat, tier) => { const f = E.resolveTemplateTarget(ix, item, stat); return { fam: f.fam, group: f.group, minTier: tier, required: true, label: f.label }; };
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': target('+# to Level of all Minion Skills', 2), 'prefix-0': target('#% increased Spirit', 3) });
  goals.forEach((g) => { g.eff = g.tier; });
  const price = { 'Greater Orb of Transmutation': 0.5, 'Greater Orb of Augmentation': 6, 'Greater Regal Orb': 4, 'Greater Exalted Orb': 5.5, 'Greater Chaos Orb': 190,
    'Omen of Sinistral Exaltation': 38, 'Omen of Dextral Exaltation': 8, 'Omen of Sinistral Erasure': 7200, 'Omen of Dextral Erasure': 5000 };
  const opts = { trials: 400, seed: 11, priceOf: (n) => (price[n] != null ? price[n] : null), baseCost: 1, maxSteps: 600 };
  const base = { tier: 'greater', sideOmens: true, removal: 'erasure', start: 'transmute', restart: true };
  const fix = P.simulate(ctx, st, goals, Object.assign({}, base), opts);
  const restart = P.simulate(ctx, st, goals, Object.assign({}, base, { pair: true, slamOnly: true }), opts);
  assert.ok(restart.p > 0.5, 'the restart loop finishes');
  assert.ok(restart.costPerSuccess < 0.5 * fix.costPerSuccess, `restarting ${Math.round(restart.costPerSuccess)} vs fixing ${Math.round(fix.costPerSuccess)}`);
  assert.ok(restart.meanBases > 1 && restart.basesPerSuccess >= restart.meanBases, 'bases per finished item are counted');
  // Steps are listed by first use: the Transmutation of the first base comes first, the Augmentation after it
  // (one goal per side, so a Magic item with both finishes the plan).
  const at = (op) => restart.steps.findIndex((s) => s.action.op === op);
  assert.equal(at('transmute'), 0);
  assert.ok(at('augment') > at('transmute'));
  // The fast restart loop (drawn from the keep table) and the use-by-use loop (forced by a budget) agree.
  const slow = P.simulate(ctx, st, goals, Object.assign({}, base, { pair: true, slamOnly: true }), Object.assign({}, opts, { budget: 1e12 }));
  assert.ok(Math.abs(slow.p - restart.p) < 0.1, `p ${slow.p} vs ${restart.p}`);
  const ratio = slow.costPerSuccess / restart.costPerSuccess;
  assert.ok(ratio > 0.6 && ratio < 1.6, `cost per success ratio ${ratio}`);
});

test('profiles keep to the player\'s white-base limit and a success floor', () => {
  const r = (p, cps, bases, limit) => ({ p, costPerSuccess: cps, basesPerSuccess: bases, baseLimit: limit });
  for (const k of ['cheap', 'balanced', 'premium']) {
    const score = P.PROFILES[k].score;
    // over the limit ranks after anything within it, however cheap
    assert.ok(score(r(0.9, 1e6, 10, 100)) < score(r(0.99, 10, 5000, 100)), k);
    // no limit: the cheap restart route may win
    if (k !== 'premium') assert.ok(score(r(0.99, 10, 5000, null)) < score(r(0.9, 1e6, 10, null)), k);
  }
  // a plan that usually fails is a last resort for Cheap (floor 20%) and Balanced (floor 50%)
  assert.ok(P.PROFILES.cheap.score(r(0.25, 5000, 1, null)) < P.PROFILES.cheap.score(r(0.05, 100, 1, null)));
  assert.ok(P.PROFILES.balanced.score(r(0.6, 5000, 1, null)) < P.PROFILES.balanced.score(r(0.3, 100, 1, null)));
});

test('essences with several outcomes (game table EssenceMods.OutcomeMods) roll among what the base can take', () => {
  const W = require('../data/weights_0.5.5.json');
  const amulet = E.parseItem(ix, 'Item Class: Amulets\nRarity: Magic\nGold Amulet\n--------\nItem Level: 82').item;
  const ctx = P.makeContext(ix, amulet, { essences: P.essencesForBase(ix, kb.bases[amulet.base], W.essences.Amulet) });
  let st = P.toState(ctx, amulet);
  const got = new Map();
  const rng = P.rngFrom(5);
  for (let i = 0; i < 600; i++) {
    const r = P.apply(ctx, st, { op: 'essence', item: 'Essence of the Infinite', mod: 'Strength4' }, rng);
    const id = r.added[0] && r.added[0].id;
    got.set(id, (got.get(id) || 0) + 1);
  }
  assert.deepEqual([...got.keys()].sort(), ['Dexterity4', 'Intelligence4', 'Strength4'], 'one of the three attributes, not always Strength');
  for (const n of got.values()) assert.ok(n > 120, 'about a third each');
  // Essence of Enhancement: only the defence type of the base fits, so it stays deterministic
  const helmBase = Object.entries(kb.bases).find(([, b]) => b.cls === 'Helmet' && b.tags.includes('str_armour') && b.tl)[0];
  const helm = E.parseItem(ix, `Item Class: Helmets\nRarity: Magic\n${helmBase}\n--------\nItem Level: 82`).item;
  const hctx = P.makeContext(ix, helm, { essences: P.essencesForBase(ix, kb.bases[helm.base], W.essences.Helmet) });
  const fit = hctx.essences.filter((r) => r.item === 'Essence of Enhancement').map((r) => r.mod);
  assert.equal(fit.length, 1);
  const r = P.apply(hctx, P.toState(hctx, helm), { op: 'essence', item: 'Essence of Enhancement', mod: fit[0] }, rng);
  assert.equal(r.added[0].id, fit[0]);
});

test('liquid emotions add the crafted mod of the game table LiquidEmotionOutcomes; Rare jewels allow 2 + 2', () => {
  assert.deepEqual(E.slotLimits({ rarity: 'Rare', slotDelta: { prefix: 0, suffix: 0 } }, 'Jewel'), { prefix: 2, suffix: 2 });
  assert.deepEqual(E.slotLimits({ rarity: 'Rare', slotDelta: { prefix: 0, suffix: 0 } }, 'Ring'), { prefix: 3, suffix: 3 });
  const white = E.parseItem(ix, 'Item Class: Jewels\nRarity: Normal\nRuby\n--------\nItem Level: 82').item;
  const ctx = ctxOf(white);
  const ire = kb.liquid_emotions['Diluted Liquid Ire'].by_base.Ruby;
  assert.equal(ire.length, 1);
  assert.match(kb.mods[ire[0]].txt, /increased Armour/);
  const mk = (id) => ({ id, fam: kb.mods[id].fam, side: kb.mods[id].gen === 'p' ? 'prefix' : 'suffix', lvl: kb.mods[id].lvl, grp: kb.mods[id].grp, tier: 1, frac: false, des: false, crafted: false, lock: false });
  const taken = new Set(kb.mods[ire[0]].grp);
  const pick = (side) => kb.pools[kb.bases.Ruby.sig][side].map(([id]) => id).filter((id) => {
    if (kb.mods[id].grp.some((g) => taken.has(g))) return false;
    kb.mods[id].grp.forEach((g) => taken.add(g));
    return true;
  }).slice(0, 2);
  const st = Object.assign(P.toState(ctx, white), { rarity: 'Rare' });
  st.mods = pick('prefix').concat(pick('suffix')).map(mk);
  assert.equal(st.mods.length, 4);
  assert.ok(P.validate(ctx, st, { op: 'exalt' }), 'a Rare jewel with 2 prefixes and 2 suffixes is full');
  // the prefix side is full: one of the prefixes goes (R_SWAP_REMOVAL), the armour mod comes in as a crafted mod
  const rng = P.rngFrom(3);
  for (let i = 0; i < 40; i++) {
    const r = P.apply(ctx, st, { op: 'liquid', item: 'Diluted Liquid Ire' }, rng);
    assert.equal(r.removed.length, 1);
    assert.equal(r.removed[0].side, 'prefix');
    assert.deepEqual(r.added.map((m) => [m.id, m.crafted]), [[ire[0], true]]);
  }
  const once = P.apply(ctx, st, { op: 'liquid', item: 'Diluted Liquid Ire' }, rng).state;
  assert.match(P.validate(ctx, once, { op: 'liquid', item: 'Liquid Paranoia' }), /one crafted modifier/);
  assert.match(P.validate(ctx, st, { op: 'liquid', item: 'Ancient Diluted Liquid Ire' }), /Time-Lost/);
  assert.deepEqual(P.actionNames({ op: 'liquid', item: 'Diluted Liquid Ire' }), ['Diluted Liquid Ire']);
  // Diamond jewels get nothing from Diluted Liquid Ire in the game table
  const dia = E.parseItem(ix, 'Item Class: Jewels\nRarity: Normal\nDiamond\n--------\nItem Level: 82').item;
  const dctx = ctxOf(dia);
  const dst = Object.assign(P.toState(dctx, dia), { rarity: 'Rare', mods: st.mods.slice(0, 1).map((m) => Object.assign({}, m)) });
  assert.match(P.validate(dctx, dst, { op: 'liquid', item: 'Diluted Liquid Ire' }), /no modifier for a Diamond jewel/);
  // Potent Liquid Contempt: "+1 Prefix Modifier allowed" (a suffix) or "+1 Suffix Modifier allowed" (a prefix), on the
  // side the removal opened; that side's limit then grows by one
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const r = P.apply(ctx, st, { op: 'liquid', item: 'Potent Liquid Contempt' }, rng);
    assert.equal(r.added.length, 1);
    const cap = kb.mods[r.added[0].id].cap;
    assert.ok(cap, 'a prefix/suffix allowance mod');
    assert.equal(r.added[0].side, r.removed[0].side, 'added on the side the removal opened');
    assert.equal(P.validate(ctx, r.state, { op: 'exalt', side: cap.prefix ? 'prefix' : 'suffix' }), null, 'room on the grown side');
    seen.add(r.added[0].id);
  }
  assert.equal(seen.size, 2, 'both outcomes happen');
  // the stat picker lists liquid emotion mods as their own group
  const item = Object.assign({}, white, { rarity: 'Rare', mods: [] });
  const opts = E.pickerOptions(ix, item, { side: 'prefix', essences: P.liquidFor(kb, 'Ruby') });
  assert.ok(opts.some((o) => o.group === 'liquid' && o.tiers.some((t) => t.via === 'Diluted Liquid Ire')));
  // a liquid target is a crafted-slot goal, and the policy finishes it with the emotion
  const { goals } = P.goalsFromTargets(ctx, { 'prefix-0': { fam: kb.mods[ire[0]].fam, group: 'liquid', required: true, label: 'armour' } });
  assert.equal(goals.length, 1);
  assert.ok(goals[0].essenceOnly);
  goals.forEach((g) => { g.eff = g.tier; });
  const a = P.makePolicy(ctx, goals, { tier: 'base', essence: true, removal: 'annul' })(st);
  assert.deepEqual([a.op, a.item], ['liquid', 'Diluted Liquid Ire']);
});

test('a Perfect or special essence on a full side removes one of that side without an omen (R_SWAP_REMOVAL)', () => {
  const W = require('../data/weights_0.5.5.json');
  const helmBase = Object.entries(kb.bases).find(([, b]) => b.cls === 'Helmet' && b.tags.includes('str_armour') && b.tl)[0];
  const helm = E.parseItem(ix, `Item Class: Helmets\nRarity: Normal\n${helmBase}\n--------\nItem Level: 82`).item;
  const ctx = P.makeContext(ix, helm, { essences: P.essencesForBase(ix, kb.bases[helm.base], W.essences.Helmet) });
  const rec = ctx.essences.find((r) => r.item === 'Essence of Hysteria');
  assert.ok(rec && kb.mods[rec.mod].gen === 's');
  const taken = new Set(kb.mods[rec.mod].grp);
  const pool = [...ctx.pool.entries()].filter(([id]) => {
    if (kb.mods[id].grp.some((g) => taken.has(g)) || kb.mods[id].lvl > 82) return false;
    kb.mods[id].grp.forEach((g) => taken.add(g));
    return true;
  });
  const mk = ([id, pe]) => ({ id, fam: kb.mods[id].fam, side: pe.side, lvl: kb.mods[id].lvl, grp: kb.mods[id].grp, tier: pe.tier, frac: false, des: false, crafted: false, lock: false });
  const st = Object.assign(P.toState(ctx, helm), { rarity: 'Rare' });
  st.mods = pool.filter(([, pe]) => pe.side === 'suffix').slice(0, 3).concat(pool.filter(([, pe]) => pe.side === 'prefix').slice(0, 1)).map(mk);
  assert.equal(P.validate(ctx, st, { op: 'pessence', item: rec.item, mod: rec.mod }), null, 'no omen needed');
  assert.match(P.validate(ctx, st, { op: 'pessence', item: rec.item, mod: rec.mod, side: 'prefix' }), /suffixes are full/);
  const rng = P.rngFrom(11);
  for (let i = 0; i < 40; i++) {
    const r = P.apply(ctx, st, { op: 'pessence', item: rec.item, mod: rec.mod }, rng);
    assert.equal(r.removed[0].side, 'suffix');
    assert.equal(r.added[0].id, rec.mod);
  }
  // with room on the essence side, any modifier can go
  const room = Object.assign({}, st, { mods: st.mods.slice(1) });
  const sides = new Set();
  for (let i = 0; i < 60; i++) sides.add(P.apply(ctx, room, { op: 'pessence', item: rec.item, mod: rec.mod }, rng).removed[0].side);
  assert.deepEqual([...sides].sort(), ['prefix', 'suffix']);
});

test('catalyst quality types (game table AlternateQualityTypes) map to the tags the planner favours', () => {
  assert.equal(kb.catalyst_qualities.length, 26);
  for (const q of kb.catalyst_qualities) {
    assert.equal(P.catalystTag(q.quality.slice('Quality ('.length, -1)), q.tag, q.quality);
    assert.ok(q.classes.every((c) => ['Ring', 'Amulet', 'Jewel'].includes(c)), q.catalyst);
    assert.equal(q.classes.includes('Jewel'), q.catalyst.startsWith('Refined '), q.catalyst);
    assert.ok(kb.item_descriptions[q.catalyst], 'a PoE2 currency: ' + q.catalyst);
  }
  // jewel mods carry the game's mod tags, so Refined catalysts have something to favour
  const ruby = kb.pools[kb.bases.Ruby.sig];
  assert.ok(ruby.prefix.concat(ruby.suffix).some(([id]) => kb.mods[id].mt.includes('life')));
});

test('tags a mod gives the item (game data adds_tags): one element\'s spell mods keep the others off', () => {
  const white = E.parseItem(ix, 'Item Class: Wands\nRarity: Normal\nAttuned Wand\n--------\nItem Level: 82').item;
  const ctx = ctxOf(white);
  const fam = (f) => [...ctx.pool.entries()].filter(([id, pe]) => kb.mods[id].fam === f && kb.mods[id].lvl <= 82).map(([id, pe]) => ({ id, pe }));
  const fire = fam('FireDamageWeaponPrefix')[0];
  assert.ok(fire && kb.mods[fire.id].at.includes('no_cold_spell_mods'), 'the Fire prefix adds no_cold_spell_mods');
  const mk = ({ id, pe }) => ({ id, fam: kb.mods[id].fam, side: pe.side, lvl: kb.mods[id].lvl, grp: kb.mods[id].grp, tier: pe.tier, frac: false, des: false, crafted: false, lock: false });
  const st = Object.assign(P.toState(ctx, white), { rarity: 'Rare', mods: [mk(fire)] });
  const blocked = new Set(['ColdDamageWeaponPrefix', 'LightningDamageWeaponPrefix', 'ChaosDamageWeaponPrefix', 'PhysicalSpellDamageWeaponPrefix',
    'GlobalIncreaseColdSpellSkillGemLevelWeapon', 'GlobalIncreaseLightningSpellSkillGemLevelWeapon', 'GlobalIncreaseChaosSpellSkillGemLevelWeapon',
    'GlobalIncreasePhysicalSpellSkillGemLevelWeapon', 'FreezeDamageIncrease', 'ShockChanceIncrease']);
  const rng = P.rngFrom(21);
  let fireGem = 0;
  for (let i = 0; i < 3000; i++) {
    const r = P.apply(ctx, st, { op: 'exalt' }, rng);
    for (const m of r.added) assert.ok(!blocked.has(m.fam), `${m.fam} came in next to a Fire damage prefix`);
    if (r.added.some((m) => m.fam === 'GlobalIncreaseFireSpellSkillGemLevelWeapon')) fireGem++;
  }
  assert.ok(fireGem > 0, 'Fire spell levels can still come');
  // without the Fire prefix the Cold one can roll
  const plain = Object.assign({}, st, { mods: [] });
  let cold = 0;
  for (let i = 0; i < 3000; i++) if (P.apply(ctx, plain, { op: 'exalt' }, rng).added.some((m) => m.fam === 'ColdDamageWeaponPrefix')) cold++;
  assert.ok(cold > 0);
  // the stat picker says why
  const item = Object.assign({}, white, { rarity: 'Rare', mods: [{ slot: 'prefix', text: kb.mods[fire.id].txt, modId: fire.id }] });
  // (Cold damage is also the Fire prefix's group; across sides only the tags keep the Cold spell levels off)
  const opts = E.pickerOptions(ix, item, { side: 'suffix', showImpossible: true });
  const c = opts.find((o) => o.fam === 'GlobalIncreaseColdSpellSkillGemLevelWeapon');
  assert.ok(c && !c.ok && /blocked by/.test(c.reason), JSON.stringify(c && c.reason));
  assert.ok(opts.find((o) => o.fam === 'GlobalIncreaseFireSpellSkillGemLevelWeapon').ok);
  // two targets that keep each other off can never be finished
  const { goals } = P.goalsFromTargets(ctx, {
    'prefix-0': { fam: 'FireDamageWeaponPrefix', group: 'prefix', required: true, label: 'fire' },
    'suffix-0': { fam: 'GlobalIncreaseColdSpellSkillGemLevelWeapon', group: 'suffix', required: true, label: 'cold levels' },
  });
  assert.match(P.goalClash(ctx, goals, goals.find((g) => g.side === 'suffix')) || '', /cannot roll together with "fire"/);
  // a junk Fire prefix is removed before the Cold spell level goal is slammed
  const coldGoal = P.goalsFromTargets(ctx, { 'suffix-0': { fam: 'GlobalIncreaseColdSpellSkillGemLevelWeapon', group: 'suffix', required: true, label: 'cold levels' } }).goals;
  coldGoal.forEach((g) => { g.eff = g.tier; });
  const a = P.makePolicy(ctx, coldGoal, { tier: 'base', sideOmens: true, removal: 'annul' })(st);
  assert.equal(a.op, 'annul');
});

test('a base whose implicit adds tags ("Can roll Ring Modifiers") rolls ring mods too', () => {
  const b = kb.bases['Grasping Mail'];
  assert.ok(b && b.tags.includes('ring') && b.tags_added.includes('ring'));
  const pool = kb.pools[b.sig];
  const ids = new Set(pool.prefix.concat(pool.suffix).map(([id]) => id));
  assert.ok(ids.has('AddedColdDamage1'), 'the ring prefix "Adds # to # Cold Damage to Attacks"');
  const plain = Object.entries(kb.bases).find(([n, x]) => x.cls === 'Body Armour' && !x.tags_added && x.tags.includes('str_dex_int_armour'));
  const other = kb.pools[plain[1].sig];
  assert.ok(!other.prefix.some(([id]) => id === 'AddedColdDamage1'), 'other body armours do not');
});

test('the Verisium Anvil upgrade of a base is listed with its cost (game table Expedition2VerisiumCrafts)', () => {
  const up = kb.verisium_upgrades['Rusted Cuirass'];
  assert.deepEqual(up, [{ to: 'Runeforged Rusted Cuirass', cost: { Verisium: 20 },
    def: { from: { Armour: 45, Evasion: 0, EnergyShield: 0, Ward: 0 }, to: { Armour: 45, Evasion: 0, EnergyShield: 0, Ward: 29 } } }]);
  assert.ok(kb.bases['Runeforged Rusted Cuirass'].tags.includes('runeforged'));
  const item = E.parseItem(ix, 'Item Class: Body Armours\nRarity: Normal\nRusted Cuirass\n--------\nItem Level: 82').item;
  const op = P.availableOps(ix, item).find((o) => o.id === 'verisium');
  assert.ok(op && op.ok && !op.planned && /20 Verisium/.test(op.note) && /Runic Ward \+29/.test(op.note), JSON.stringify(op));
  // a level 59 base gives up part of its Armour for the Ward (game table ArmourTypes)
  const heavy = kb.verisium_upgrades['Heavy Plate'][0].def;
  assert.ok(heavy.to.Armour < heavy.from.Armour && heavy.to.Ward > 0);
  // a unique moves to its Runeforged base with a crest
  const [name, ups] = Object.entries(kb.verisium_unique_upgrades).find(([, l]) => l.some((u) => kb.bases[u.from]));
  const u0 = ups.find((u) => kb.bases[u.from]);
  const uniq = Object.assign(E.parseItem(ix, `Item Class: X\nRarity: Normal\n${u0.from}\n--------\nItem Level: 82`).item, { rarity: 'Unique', name, mods: [] });
  const uop = P.availableOps(ix, uniq).find((o) => o.id === 'verisium');
  assert.ok(uop && uop.ok && /same unique/.test(uop.note), name + ' ' + JSON.stringify(uop));
});

test('Orb of Chance does not work on jewels (game table Chanceableitemclasses); a pasted unique jewel says what it is', () => {
  assert.ok(!kb.chanceable_classes.includes('Jewel') && kb.chanceable_classes.includes('Ring'));
  const ruby = E.parseItem(ix, 'Item Class: Jewels\nRarity: Normal\nRuby\n--------\nItem Level: 82').item;
  const ctx = ctxOf(ruby);
  assert.match(P.validate(ctx, P.toState(ctx, ruby), { op: 'chance' }), /cannot be used on jewels/);
  const ring = E.parseItem(ix, 'Item Class: Rings\nRarity: Normal\nGold Ring\n--------\nItem Level: 82').item;
  const rctx = ctxOf(ring);
  assert.equal(P.validate(rctx, P.toState(rctx, ring), { op: 'chance' }), null);
  assert.equal(Object.values(kb.uniques).filter((u) => u.cls === 'Jewel').length, 13);
  const r = E.parseItem(ix, 'Item Class: Jewels\nRarity: Unique\nMegalomaniac\nDiamond\n--------\nItem Level: 82\n--------\nAllocates Heavy Buffer\nAllocates Tenfold Attacks\nAllocates Unstoppable Barrier\n--------\nCorrupted');
  assert.ok(r.warnings.some((w) => /Megalomaniac: Limited to 1, drops corrupted/.test(w.msg) && /Orb of Chance does not work on jewels/.test(w.msg)), JSON.stringify(r.warnings));
});

test('a base that says "Catalysts can be applied to this item" takes catalyst quality', () => {
  const mail = E.parseItem(ix, 'Item Class: Body Armours\nRarity: Rare\nTest Name\nGrasping Mail\n--------\nItem Level: 82').item;
  assert.ok(P.availableOps(ix, mail).some((o) => o.id === 'catalyst' && o.ok));
  const ctx = ctxOf(Object.assign({}, mail, { quality: 20, qualityType: 'Life Modifiers' }));
  assert.equal(P.toState(ctx, Object.assign({}, mail, { quality: 20, qualityType: 'Life Modifiers' })).catTag, 'life');
  const plain = E.parseItem(ix, 'Item Class: Body Armours\nRarity: Rare\nTest Name\nRusted Cuirass\n--------\nItem Level: 82').item;
  assert.ok(!P.availableOps(ix, plain).some((o) => o.id === 'catalyst'));
});

test('Omens of Crystallisation are for Perfect and Corrupted essences, not Runic Alloys (game text)', () => {
  const W = require('../data/weights_0.5.5.json');
  const helmBase = Object.entries(kb.bases).find(([, b]) => b.cls === 'Helmet' && b.tags.includes('str_armour') && b.tl)[0];
  const helm = E.parseItem(ix, `Item Class: Helmets\nRarity: Normal\n${helmBase}\n--------\nItem Level: 82`).item;
  const ctx = P.makeContext(ix, helm, { essences: P.essencesForBase(ix, kb.bases[helm.base], W.essences.Helmet) });
  const alloy = ctx.essences.find((r) => r.alloy);
  assert.ok(alloy, 'a Runic Alloy for helmets');
  const pe = [...ctx.pool.entries()].find(([id, e]) => e.side === 'prefix' && !kb.mods[id].grp.some((g) => kb.mods[alloy.mod].grp.includes(g)));
  const st = Object.assign(P.toState(ctx, helm), { rarity: 'Rare', mods: [{ id: pe[0], fam: kb.mods[pe[0]].fam, side: 'prefix', lvl: kb.mods[pe[0]].lvl, grp: kb.mods[pe[0]].grp, tier: pe[1].tier, frac: false, des: false, crafted: false, lock: false }] });
  assert.match(P.validate(ctx, st, { op: 'pessence', item: alloy.item, mod: alloy.mod, side: 'prefix' }), /not with Runic Alloys/);
  assert.equal(P.validate(ctx, st, { op: 'pessence', item: alloy.item, mod: alloy.mod }), null);
});

test('runes that change crafting: Medved\'s Tending opens the Soul modifiers, Astrid\'s Creativity a second crafted modifier', () => {
  const text = (rune, mods) => ['Item Class: Body Armours', 'Rarity: Rare', 'Test Name', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    ...(rune ? [rune + ' (rune)', '--------'] : []), ...mods].join('\n');
  const soulCount = (item) => {
    const ctx = ctxOf(item);
    const st = P.toState(ctx, item);
    const rng = P.rngFrom(4);
    let n = 0;
    for (let i = 0; i < 3000; i++) if (P.apply(ctx, st, { op: 'exalt' }, rng).added.some((m) => /^SoulInfluence/.test(m.id))) n++;
    return n;
  };
  const withRune = E.parseItem(ix, text('Can roll Soul modifiers', ['+100 to maximum Life'])).item;
  const without = E.parseItem(ix, text(null, ['+100 to maximum Life'])).item;
  assert.ok(E.runeRules(withRune).soul && !E.runeRules(without).soul);
  assert.ok(soulCount(withRune) > 0, 'Soul modifiers roll with the rune');
  assert.equal(soulCount(without), 0, 'and never without it');
  // Astrid's Creativity: a second crafted modifier is allowed
  const W = require('../data/weights_0.5.5.json');
  const one = (rune) => {
    const it = E.parseItem(ix, text(rune, ['+100 to maximum Life'])).item;
    const ctx = P.makeContext(ix, it, { essences: P.essencesForBase(ix, kb.bases[it.base], W.essences['Body Armour']) });
    const st = P.toState(ctx, it);
    st.mods[0].crafted = true;
    const rec = ctx.essences.find((r) => r.kind === 'rare' && !r.alloy && !kb.mods[r.mod].grp.some((g) => st.mods[0].grp.includes(g)));
    return P.validate(ctx, st, { op: 'pessence', item: rec.item, mod: rec.mod });
  };
  assert.match(one(null), /one crafted modifier/);
  assert.equal(one('Can have 1 additional Crafted Modifier'), null);
});

test('workbench: the emulator keeps the modifiers that stay, the calculator and the stat shares agree', () => {
  const item = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '+120 to maximum Life', '35% increased Armour', '+30% to Fire Resistance'].join('\n')).item;
  const r = P.emulate(ix, item, { op: 'exalt' }, { rng: P.rngFrom(3) });
  const after = E.parseItem(ix, r.text);
  assert.equal(after.item.mods.length, 4);
  for (const m of item.mods) assert.ok(after.item.mods.some((x) => x.text === m.text && x.modId === m.modId), 'kept as it was: ' + m.text);
  assert.equal(r.added.length, 1);
  assert.ok(!after.warnings.some((w) => w.level === 'error'));
  assert.match(P.emulate(ix, item, { op: 'transmute' }).reason, /Normal/);
  // Divine rolls values again, fractured ones stay
  const div = E.parseItem(ix, P.emulate(ix, after.item, { op: 'divine' }, { rng: P.rngFrom(9) }).text).item;
  assert.deepEqual(div.mods.map((m) => m.modId), after.item.mods.map((m) => m.modId));
  // calculator: one Chaos Orb and a Cold Resistance suffix; stat share of the same family
  const cold = [...P.makeContext(ix, item).pool.entries()].find(([id, pe]) => kb.mods[id].fam === 'ColdResistance' && pe.side === 'suffix');
  assert.ok(cold);
  const c = P.chanceOf(ix, item, { op: 'chaos' }, [{ type: 'and', reqs: [{ fam: 'ColdResistance', side: 'suffix' }] }], { n: 8000 });
  const fc = P.familyChances(ix, item, {});
  assert.ok(c.p > 0.02 && c.p < 0.5, JSON.stringify(c));
  assert.ok(Math.abs(c.p - fc.any['suffix|ColdResistance']) < 0.03, `${c.p} vs ${fc.any['suffix|ColdResistance']}`);
  assert.equal(fc.side.suffix.FireResistance, undefined, 'the Fire Resistance group is taken');
  assert.deepEqual(P.chanceOf(ix, item, { op: 'chaos' }, [{ type: 'not', reqs: [{ fam: 'IncreasedLife', side: 'prefix' }] }], { n: 2000 }).before, false);
  const sum = Object.values(fc.side.prefix).reduce((t, x) => t + x, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});
