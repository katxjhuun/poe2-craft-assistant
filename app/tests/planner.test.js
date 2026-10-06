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
  // desecrated-only equipment modifiers are level 65 in the game data: below item level 65 the Well of Souls offers base
  // modifiers only (t22), and lich omens say why they cannot be used
  const lowItem = E.parseItem(ix, 'Item Class: Wands\nRarity: Rare\nDoom Song\nAttuned Wand\n--------\nItem Level: 60').item;
  const low = P.availableOps(ix, lowItem, { all: true }).find((o) => o.id === 'desecrate');
  assert.ok(low.ok, low.reason);
  assert.ok(!low.omens.includes('Omen of the Liege') && low.blocked.some((b) => b.name === 'Omen of the Liege' && /65/.test(b.reason)));
  const r = P.emulate(ix, lowItem, { op: 'bone', quality: 'Gnawed' }, { seed: 4 });
  assert.ok(r.reveal.options.length === 3 && r.reveal.options.every((o) => !o.only), JSON.stringify(r.reveal));
  // sceptres have no desecrated-only modifier (poe2db); they are desecrated with base modifiers (t23)
  const sceptre = P.availableOps(ix, parse('rare-sceptre-adv'), { all: true }).find((o) => o.id === 'desecrate');
  assert.ok(sceptre.ok, sceptre.reason);
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

test('an omen without a price is left out of the plan instead of counting as free', () => {
  const item = E.parseItem(ix, 'Item Class: Sceptres\nRarity: Normal\nRattling Sceptre\n--------\nItem Level: 82').item;
  const targets = { // two suffixes on a Rare item: the strategy removes misses with a Chaos Orb and the suffix Erasure omen
    'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 2, required: true, label: 'minion level' },
    'suffix-1': { fam: 'MinionLife', group: 'suffix', minTier: 3, required: true, label: 'minion life' },
  };
  const ctx = P.makeContext(ix, item);
  const st = P.toState(ctx, item);
  const { goals } = P.goalsFromTargets(ctx, targets);
  goals.forEach((g) => { g.eff = g.tier; });
  const params = P.expandStrategy({ tier: 'greater', sideOmens: true, start: 'transmute', removal: 'erasure' }); // aims with side omens
  const priceOf = (n) => (/Erasure/.test(n) ? null : 5);
  const r = P.simulate(ctx, st, goals, params, { trials: 400, seed: 5, priceOf, baseCost: 1 });
  assert.ok(!r.missingPrices.some((n) => /Erasure/.test(n)), 'not counted at 0');
  assert.ok(r.skippedUnpriced.some((n) => /Erasure/.test(n)), 'reported as left out');
  assert.ok(!r.steps.some((x) => x.names.some((n) => /Erasure/.test(n))), 'no step uses it');
  assert.ok(r.steps.some((x) => x.names.includes('Omen of Dextral Exaltation')), 'priced side omens are still used');
  // with a price the omen comes back
  const priced = P.simulate(ctx, st, goals, params, { trials: 400, seed: 5, priceOf: () => 5, baseCost: 1 });
  assert.deepEqual(priced.skippedUnpriced, []);
  assert.ok(priced.steps.some((x) => x.names.some((n) => /Erasure/.test(n))), 'the priced omen is used');
  // the Coronation omens are in the game files but not in the game: a Regal Orb is never aimed, and nothing is reported
  assert.ok(!priced.steps.some((x) => x.names.some((n) => /Coronation/.test(n))));
  assert.match(P.validate(ctx, Object.assign({}, st, { rarity: 'Magic' }), { op: 'regal', side: 'suffix' }) || '', /Omen of Dextral Coronation is not in the game/);
});

test('omens that are not in the game are never used, unpriced optional omens are left out, and unpriced plans rank last', () => {
  const item = parse('rare-sceptre-adv');
  const lvl = item.mods.find((x) => /Level of all Minion/.test(x.text));
  const ctx = P.makeContext(ix, item);
  const st = P.toState(ctx, item);
  const { goals } = P.goalsFromTargets(ctx, { 'suffix-0': { fam: lvl.fam, group: 'suffix', minTier: 1, required: true, label: 'lvl' } });
  goals.forEach((g) => { g.eff = g.tier; });
  // Omen of Homogenising Exaltation is in the game files but not in the game (kb.legacy_or_disabled): even with a
  // price no step uses it, and the strategy makes the same moves as the one without the setting
  const withSetting = P.simulate(ctx, st, goals, P.expandStrategy({ tier: 'greater', homog: true }), { trials: 300, seed: 5, priceOf: () => 10 });
  assert.ok(!withSetting.steps.some((x) => x.names.some((n) => /Homogenising/.test(n))), 'no step uses the omen');
  assert.deepEqual(withSetting.skippedUnpriced, [], 'and it is not reported as an omen without a price');
  const plain = P.simulate(ctx, st, goals, P.expandStrategy({ tier: 'greater' }), { trials: 300, seed: 5, priceOf: () => 10 });
  assert.equal(withSetting.meanCost, plain.meanCost);
  // the workbench refuses them too
  for (const a of [{ op: 'exalt', homog: true }, { op: 'annul', greater: true }, { op: 'vaal', omen: true }]) assert.match(P.validate(ctx, st, a) || '', /not in the game/, JSON.stringify(a));
  const white = E.parseItem(ix, 'Item Class: Sceptres\nRarity: Normal\nRattling Sceptre\n--------\nItem Level: 82').item;
  const wctx = P.makeContext(ix, white);
  assert.match(P.validate(wctx, P.toState(wctx, white), { op: 'alchemy', side: 'prefix' }) || '', /Omen of Sinistral Alchemy is not in the game/);
  assert.equal(P.validate(wctx, P.toState(wctx, white), { op: 'alchemy' }), null);
  assert.ok(!P.availableOps(ix, white, { all: true }).some((o) => o.omens.some((n) => /Alchemy|Homogenising|Greater Annulment/.test(n))), 'not listed as usable');
  // an optional omen that is in the game but has no price is left out and reported, never counted as free
  const noPrice = (n) => (/Dextral Exaltation/.test(n) ? null : 10);
  const aimed = P.simulate(ctx, st, goals, P.expandStrategy({ tier: 'greater', sideOmens: true }), { trials: 300, seed: 5, priceOf: noPrice });
  assert.ok(!aimed.steps.some((x) => x.names.includes('Omen of Dextral Exaltation')), 'no step uses the unpriced omen');
  assert.ok(aimed.skippedUnpriced.includes('Omen of Dextral Exaltation'));
  assert.deepEqual(aimed.missingPrices, []);
  // a result that counted something at 0 ranks behind a fully priced one in every profile, whatever its cost
  for (const prof of Object.values(P.PROFILES)) {
    const priced = { p: 0.3, costPerSuccess: 9e6, basesPerSuccess: 1, baseLimit: 100, missingPrices: [] };
    const free = { p: 1, costPerSuccess: 1, basesPerSuccess: 1, baseLimit: 100, missingPrices: ['Essence of Battle'] };
    assert.ok(prof.score(priced) < prof.score(free), prof.label);
  }
});

test('five-modifier jewel (t24): three suffixes stay when "+1 Suffix Modifier allowed" goes, and only prefixes change after that (R_NO_SPACE)', () => {
  const jewel = (lines) => E.parseItem(ix, ['Item Class: Jewels', 'Rarity: Rare', 'Test Gem', 'Emerald', '--------', 'Item Level: 82', '--------'].concat(lines).join('\n')).item;
  const S3 = ['20% increased Critical Damage Bonus for Attack Damage', '15% increased Critical Hit Chance for Attacks', '3% increased Attack Speed with Bows'];
  const sides = (it) => [it.mods.filter((m) => m.slot === 'prefix').length, it.mods.filter((m) => m.slot === 'suffix').length];
  const kept = (it) => S3.every((t) => it.mods.some((m) => m.text === t));
  const after = (it, a, seed) => { const r = P.emulate(ix, it, a, { seed }); return r.reason ? r : E.parseItem(ix, r.text).item; };
  // the jewel of the guides reads as three suffixes and two prefixes (one crafted), with no issue
  const done = jewel(S3.concat(['10% increased Projectile Damage', '60% increased Effect of Suffixes']));
  assert.deepEqual(sides(done), [2, 3]);
  assert.ok(done.mods.find((m) => /Effect of Suffixes/.test(m.text)).crafted);
  const notes = (lines) => E.parseItem(ix, ['Item Class: Jewels', 'Rarity: Rare', 'Test Gem', 'Emerald', '--------', 'Item Level: 82', '--------'].concat(lines).join('\n')).warnings;
  assert.ok(!notes(S3.concat(['10% increased Projectile Damage', '60% increased Effect of Suffixes'])).some((w) => w.level === 'error'), 'three suffixes on a jewel are a note, not an error');
  assert.ok(notes(S3.concat(['10% increased Projectile Damage'])).some((w) => w.level === 'info' && /Three suffixes on a jewel/.test(w.msg)));
  assert.ok(notes(S3.concat(['4% increased Attack Speed'])).some((w) => w.level === 'error' && /found 4/.test(w.msg)), 'four suffixes are still an error');
  // with "+1 Suffix Modifier allowed" (a prefix) a third suffix can be desecrated
  const two = jewel(S3.slice(0, 2).concat(['+1 Suffix Modifier allowed', '12% increased Attack Damage']));
  assert.deepEqual(sides(after(two, { op: 'bone', quality: 'Preserved', side: 'suffix' }, 1)), [2, 3]);
  // removing a prefix with Omen of Sinistral Annulment: the allowance mod or the other prefix; the three suffixes stay either way
  const three = jewel(S3.concat(['+1 Suffix Modifier allowed', '10% increased Projectile Damage']));
  let gone = 0;
  for (let s = 1; s <= 200; s++) {
    const it = after(three, { op: 'annul', side: 'prefix' }, s);
    assert.deepEqual(sides(it), [1, 3]);
    assert.ok(kept(it));
    if (!it.mods.some((m) => /Suffix Modifier allowed/.test(m.text))) gone++;
  }
  assert.ok(gone > 70 && gone < 130, String(gone));
  // one prefix, three suffixes (over the limit of two): an Exalted Orb adds a prefix, never a suffix
  const open = jewel(S3.concat(['10% increased Projectile Damage']));
  for (let s = 1; s <= 30; s++) assert.deepEqual(sides(after(open, { op: 'exalt' }, s)), [2, 3]);
  // ...but with that free prefix slot a Chaos Orb can still take a suffix (it comes back as a prefix)
  let lost = 0;
  for (let s = 1; s <= 200; s++) if (!kept(after(open, { op: 'chaos' }, s))) lost++;
  assert.ok(lost > 100, 'a suffix can be lost while a prefix slot is free: ' + lost);
  // both prefixes filled: the Chaos Orb only swaps a prefix, and no Exalted Orb fits
  const full = jewel(S3.concat(['10% increased Projectile Damage', '12% increased Attack Damage']));
  for (let s = 1; s <= 200; s++) { const it = after(full, { op: 'chaos' }, s); assert.deepEqual(sides(it), [2, 3]); assert.ok(kept(it)); }
  assert.match(after(full, { op: 'exalt' }, 1).reason, /No open affix/);
  // Omen of Dextral Erasure aims at the suffixes, where nothing can be replaced: the game refuses the orb
  assert.match(after(full, { op: 'chaos', side: 'suffix' }, 1).reason, /no space for more modifiers/);
  // Potent Liquid Ferocity can only give "Effect of Suffixes" (a prefix) there, in place of one of the two prefixes
  let first = 0;
  for (let s = 1; s <= 200; s++) {
    const it = after(full, { op: 'liquid', item: 'Potent Liquid Ferocity' }, s);
    assert.deepEqual(sides(it), [2, 3]);
    assert.ok(kept(it) && it.mods.some((m) => /Effect of Suffixes/.test(m.text)));
    if (!it.mods.some((m) => m.text === '10% increased Projectile Damage')) first++;
  }
  assert.ok(first > 70 && first < 130, String(first));
  // on a jewel within its limits nothing changes: a Chaos Orb takes any modifier
  const plain = jewel(S3.slice(0, 2).concat(['10% increased Projectile Damage', '12% increased Attack Damage']));
  let suffixHit = 0;
  for (let s = 1; s <= 200; s++) if (!S3.slice(0, 2).every((t) => after(plain, { op: 'chaos' }, s).mods.some((m) => m.text === t))) suffixHit++;
  assert.ok(suffixHit > 70 && suffixHit < 130, String(suffixHit));
});

test('five targets on a jewel: the plan goes through Potent Liquid Contempt, a desecrated third suffix and Potent Liquid Ferocity (recipe c15)', async () => {
  const W = require('../data/weights_0.5.5.json');
  const jewel = (rarity, lines) => E.parseItem(ix, ['Item Class: Jewels', 'Rarity: ' + rarity].concat(rarity === 'Normal' ? [] : ['Test Gem'], ['Emerald', '--------', 'Item Level: 82'],
    lines.length ? ['--------'] : [], lines).join('\n')).item;
  const want = ['20% increased Critical Damage Bonus for Attack Damage', '15% increased Critical Hit Chance for Attacks', '3% increased Attack Speed with Bows',
    '10% increased Projectile Damage', '60% increased Effect of Suffixes'];
  const targets = {}, n = { prefix: 0, suffix: 0 };
  for (const t of want) {
    const m = jewel('Rare', [t]).mods[0];
    targets[m.slot + '-' + n[m.slot]++] = { fam: kb.mods[m.modId].fam, group: m.slot, minTier: null, required: true, label: E.template(t) };
  }
  assert.deepEqual(n, { prefix: 2, suffix: 3 });
  const weights = W.pages[W.base_page.Emerald].weights;
  const sim = (item, params, trials) => {
    const ctx = P.makeContext(ix, item, { weights });
    const { goals } = P.goalsFromTargets(ctx, targets);
    goals.forEach((g) => { g.eff = g.tier; });
    return P.simulate(ctx, P.toState(ctx, item), goals, P.expandStrategy(params), { trials, seed: 11, priceOf: () => 10, baseCost: 1 });
  };
  // the start of the guides: the first suffix fractured
  const frac = jewel('Rare', ['20% increased Critical Damage Bonus for Attack Damage (fractured)', '8% increased Fire Damage']);
  assert.ok(frac.mods[0].fractured);
  const r = sim(frac, { echoes: true }, 300);
  assert.ok(r.p > 0.9, 'finishes: ' + r.p);
  const used = (re) => r.steps.some((x) => x.names.some((nm) => re.test(nm)));
  for (const re of [/^Potent Liquid Contempt$/, /^Preserved Cranium$/, /^Potent Liquid Ferocity$/, /^Omen of Sinistral Annulment$/, /^Omen of Light$/]) assert.ok(used(re), String(re));
  assert.ok(!used(/Dextral (Erasure|Annulment)/), 'no suffix-side removal omen: the fractured suffix and the over-limit rule keep the suffixes');
  // from a white base: fracture the first suffix, a wrong fracture means a new base
  const white = sim(jewel('Normal', []), { fracture: true, restart: true, echoes: true, tier: 'greater' }, 200);
  assert.ok(white.p > 0.8, 'white base: ' + white.p);
  assert.ok(white.steps.some((x) => x.names.includes('Fracturing Orb')) && white.steps.some((x) => x.names.includes('New base')));
  // on a Rare jewel a wrong fracture ends the run
  const rare = sim(jewel('Rare', ['8% increased Fire Damage', '+10% to Fire Resistance']), { fracture: true, echoes: true }, 200);
  assert.ok(rare.fails.some((f) => /fractured modifier that is not a goal/.test(f.reason)));
  // the planner offers the route, and refuses six targets or three on both sides
  const out = await P.buildPlans({ ix, item: frac, targets, locks: {}, priceOf: () => 10, baseCost: 1, weights, trials: 300, screenTrials: 60, beamBudgetMs: 0 });
  for (const k of ['cheap', 'balanced', 'premium']) assert.ok(out.profiles[k].p > 0.8, k + ': ' + JSON.stringify(out.profiles[k].impossible || out.profiles[k].p));
  const extra = jewel('Rare', ['12% increased Attack Damage']).mods[0];
  const six = Object.assign({}, targets, { 'prefix-2': { fam: kb.mods[extra.modId].fam, group: 'prefix', minTier: null, required: true, label: 'attack damage' } });
  const no = await P.buildPlans({ ix, item: frac, targets: six, locks: {}, priceOf: () => 10, baseCost: 1, weights, trials: 100, screenTrials: 40, beamBudgetMs: 0 });
  assert.match(no.profiles.premium.impossible[0], /five modifiers at most/);
});

test("Serle's Triumph: a fourth suffix (seven modifiers), socketed when three suffix goals are on the item", async () => {
  // the player's gloves: two runes, three prefixes and four suffixes
  const worn = E.parseItem(ix, ['Item Class: Gloves', 'Rarity: Rare', 'Demon Mitts', 'Polished Bracers', '--------', 'Sockets: S S', '--------', 'Item Level: 80', '--------',
    '+1 Suffix Modifier allowed (rune)', 'Can roll Marksman modifiers (rune)', '--------', '33% increased Projectile Speed', '31% increased Projectile Damage',
    'Adds 2 to 58 Lightning damage to Attacks', '+2 to Level of all Projectile Skills', '32% increased Critical Hit Chance',
    'Gain Deflection Rating equal to 19% of Evasion Rating', '28% increased Critical Damage Bonus'].join('\n'));
  assert.deepEqual(E.itemLimits(ix, worn.item), { prefix: 3, suffix: 4 });
  assert.deepEqual([worn.item.mods.filter((m) => m.slot === 'prefix').length, worn.item.mods.filter((m) => m.slot === 'suffix').length], [3, 4]);
  assert.ok(!worn.warnings.some((w) => w.level === 'error'), JSON.stringify(worn.warnings.filter((w) => w.level === 'error')));
  assert.equal(P.suffixRune(ix, worn.item), null, 'the rune is already there');
  // gloves without it: the plans can socket it (an Artificer's Orb first when there is no socket)
  const gloves = E.parseItem(ix, ['Item Class: Gloves', 'Rarity: Rare', 'Test', 'Polished Bracers', '--------', 'Item Level: 82', '--------',
    '+25% to Fire Resistance', '+25% to Cold Resistance', '+25% to Lightning Resistance'].join('\n')).item;
  assert.equal(P.suffixRune(ix, gloves), "Serle's Triumph");
  const targets = {};
  gloves.mods.forEach((m, i) => { targets['suffix-' + i] = { fam: kb.mods[m.modId].fam, group: 'suffix', minTier: null, required: true, label: m.text }; });
  const fourth = E.parseItem(ix, ['Item Class: Gloves', 'Rarity: Rare', 'Test', 'Polished Bracers', '--------', 'Item Level: 82', '--------', '+20 to Dexterity'].join('\n')).item.mods[0];
  targets['suffix-3'] = { fam: kb.mods[fourth.modId].fam, group: 'suffix', minTier: 5, required: true, label: 'dexterity' };
  const ctx = P.makeContext(ix, gloves);
  const { goals } = P.goalsFromTargets(ctx, targets);
  goals.forEach((g) => { g.eff = g.tier; });
  assert.equal(goals.filter((g) => g.side === 'suffix').length, 4);
  const r = P.simulate(ctx, P.toState(ctx, gloves), goals, P.expandStrategy({ sideOmens: true, removal: 'annul' }), { trials: 200, seed: 3, priceOf: () => 10 });
  // a missed fourth suffix is hard to clear without losing one of the three (the omen takes any suffix), so many runs do not finish
  assert.ok(r.p > 0.2, 'finishes: ' + r.p);
  const first = (name) => r.steps.findIndex((x) => x.names.includes(name));
  assert.ok(first("Artificer's Orb") >= 0 && first("Serle's Triumph") > first("Artificer's Orb"), 'a socket first, then the rune: ' + r.steps.map((x) => x.key).join('; '));
  assert.ok(Math.abs(r.steps[first("Serle's Triumph")].avg - 1) < 0.01, 'socketed once');
  // the planner takes four suffix targets on gloves, not five; a ring has no socket for the rune
  const out = await P.buildPlans({ ix, item: gloves, targets, locks: {}, priceOf: () => 10, baseCost: 1, trials: 200, screenTrials: 40, beamBudgetMs: 0 });
  assert.ok(out.profiles.balanced.p > 0, JSON.stringify(out.profiles.balanced.impossible || out.profiles.balanced.fails || 'route'));
  const five = Object.assign({}, targets, { 'suffix-4': { fam: 'ManaRegeneration', group: 'suffix', minTier: null, required: true, label: 'mana regeneration' } });
  const no = await P.buildPlans({ ix, item: gloves, targets: five, locks: {}, priceOf: () => 10, baseCost: 1, trials: 100, screenTrials: 40, beamBudgetMs: 0 });
  assert.match(no.profiles.premium.impossible[0], /More suffix targets \(5\) than a Rare item of this class holds \(4\)/);
  const ring = E.parseItem(ix, 'Item Class: Rings\nRarity: Normal\nRuby Ring\n--------\nItem Level: 82').item;
  assert.equal(P.suffixRune(ix, ring), null);
});

test('rune pools: every modifier a socket-bound rune opens is a target; one pool per item; the plan sockets the rune', async () => {
  // game data: six runes give the item a tag, and the modifiers with a spawn weight on that tag can roll
  const pools = Object.fromEntries(E.runePools(ix).map((p) => [p.rune, p]));
  assert.deepEqual(Object.keys(pools).sort(), ["Katla's Gloom", "Kolr's Hunt", "Medved's Tending", "Thrud's Might", "Uhtred's Sidereus", "Vorana's Carnage"]);
  assert.deepEqual([pools["Kolr's Hunt"].tag, pools["Kolr's Hunt"].classes, pools["Kolr's Hunt"].mods.size], ['marksman', ['Gloves'], 28]);
  assert.deepEqual([pools["Katla's Gloom"].tag, pools["Vorana's Carnage"].classes, pools["Uhtred's Sidereus"].classes, pools["Medved's Tending"].classes], ['decay', ['Helmet'], ['Boots'], ['Body Armour']]);
  assert.ok(pools["Thrud's Might"].classes.includes('Bow') && pools["Thrud's Might"].classes.includes('Wand'));

  const gloves = E.parseItem(ix, ['Item Class: Gloves', 'Rarity: Normal', 'Polished Bracers', '--------', 'Item Level: 82'].join('\n')).item;
  const opts = (item, o) => E.pickerOptions(ix, item, Object.assign({ side: 'suffix', runeBlocked: P.runeBlocks(ix, item) }, o)).filter((x) => x.group === 'rune');
  // gloves take two such runes: both pools are offered until a target is chosen from one of them
  assert.deepEqual([...new Set(opts(gloves).map((o) => o.rune))].sort(), ['decay', 'marksman']);
  assert.ok(opts(gloves).every((o) => o.ok), 'an Artificer\'s Orb gives the socket');
  assert.deepEqual([...new Set(opts(gloves, { runePool: 'marksman' }).map((o) => o.rune))], ['marksman']);
  // a ring has no augment socket and no rune pool
  const ring = E.parseItem(ix, 'Item Class: Rings\nRarity: Normal\nRuby Ring\n--------\nItem Level: 82').item;
  assert.equal(opts(ring).length, 0);
  // with one rune socketed (socket-bound: it stays) only its pool is left, and the other rune is refused
  const worn = E.parseItem(ix, ['Item Class: Gloves', 'Rarity: Rare', 'Demon Mitts', 'Polished Bracers', '--------', 'Sockets: S S', '--------', 'Item Level: 80', '--------',
    '+1 Suffix Modifier allowed (rune)', 'Can roll Marksman modifiers (rune)', '--------', '33% increased Projectile Speed', '31% increased Projectile Damage',
    'Adds 2 to 58 Lightning damage to Attacks', '+2 to Level of all Projectile Skills', '32% increased Critical Hit Chance',
    'Gain Deflection Rating equal to 19% of Evasion Rating'].join('\n'));
  assert.ok(worn.item.mods.every((m) => m.inPool), 'the Marksman modifiers are of the item\'s pool');
  assert.ok(!worn.warnings.some((w) => /not in/i.test(w.msg)), JSON.stringify(worn.warnings));
  assert.deepEqual([...new Set(opts(worn.item).map((o) => o.rune))], ['marksman']);
  assert.match(P.runeBlocks(ix, worn.item).decay, /another pool rune is socketed/);
  const wctx = P.makeContext(ix, worn.item);
  const wst = P.toState(wctx, worn.item);
  assert.deepEqual(wst.tags, ['marksman']);
  assert.match(P.validate(wctx, Object.assign({}, wst, { sockets: 1 }), { op: 'rune_rule', item: "Katla's Gloom" }), /One rune that opens a modifier pool per item/);
  // the socketed pool rolls with the item's own modifiers (Exalted Orb), a free suffix here
  const seen = new Set();
  for (let s = 1; s <= 300; s++) for (const m of P.apply(wctx, wst, { op: 'exalt', side: 'suffix' }, P.rngFrom(s)).added) seen.add(m.id);
  assert.ok([...seen].some((id) => /^MarksmanInfluence/.test(id)) && [...seen].some((id) => !/^MarksmanInfluence/.test(id)), [...seen].join());
  assert.ok(![...seen].some((id) => /^DecayInfluence/.test(id)));
  const fc = P.familyChances(ix, worn.item, {});
  const pierce = opts(worn.item).find((o) => o.fam === 'ChanceToPierce');
  assert.ok(fc.side.suffix[pierce.fam] > 0, 'a chance once the rune is socketed');
  assert.equal(P.familyChances(ix, gloves, {}).side.suffix[pierce.fam], undefined, 'none before');

  // a target from the pool: the goal names the rune, and the plan sockets it (an Artificer's Orb first) once the
  // targets of the item's own pool are done
  const fire = E.parseItem(ix, ['Item Class: Gloves', 'Rarity: Rare', 'T', 'Polished Bracers', '--------', 'Item Level: 82', '--------', '+25% to Fire Resistance'].join('\n')).item.mods[0];
  const crit = opts(gloves).find((o) => o.fam === 'CriticalStrikeChance');
  const targets = {
    'suffix-0': { fam: kb.mods[fire.modId].fam, group: 'suffix', minTier: null, required: true, label: 'fire resistance' },
    'suffix-1': { fam: crit.fam, group: 'rune', rune: 'marksman', minTier: null, required: true, label: crit.label },
  };
  const ctx = P.makeContext(ix, gloves);
  const { goals } = P.goalsFromTargets(ctx, targets);
  goals.forEach((g) => { g.eff = g.tier; });
  assert.deepEqual(goals.map((g) => [g.side, g.rune, g.runeItem]), [['suffix', null, null], ['suffix', 'marksman', "Kolr's Hunt"]]);
  const r = P.simulate(ctx, P.toState(ctx, gloves), goals, P.expandStrategy({ sideOmens: true, removal: 'annul', restart: false }), { trials: 200, seed: 3, priceOf: () => 10 });
  assert.ok(r.p > 0.9, 'finishes: ' + r.p);
  const first = (name) => r.steps.findIndex((x) => x.names.includes(name));
  assert.ok(first("Artificer's Orb") >= 0 && first("Kolr's Hunt") > first("Artificer's Orb"), r.steps.map((x) => x.key).join('; '));
  assert.ok(Math.abs(r.steps[first("Kolr's Hunt")].avg - 1) < 0.01, 'socketed once');
  // before the rune nothing rolls the Marksman goal: with the fire resistance still open the rune waits
  const st = Object.assign(P.toState(ctx, gloves), { rarity: 'Rare' });
  const pol = P.makePolicy(ctx, goals, P.expandStrategy({ sideOmens: true }));
  assert.equal(pol(st).op, 'exalt');

  const plan = async (item, t) => (await P.buildPlans({ ix, item, targets: t, locks: {}, priceOf: () => 10, baseCost: 1, trials: 100, screenTrials: 40, beamBudgetMs: 0 })).profiles.balanced;
  const ok = await plan(gloves, targets);
  assert.ok(ok.p > 0.5 && ok.steps.some((s) => s.names.includes("Kolr's Hunt")), JSON.stringify(ok.impossible || ok.p));
  // two pools: refused
  const decay = opts(gloves).find((o) => o.rune === 'decay');
  const two = Object.assign({}, targets, { 'suffix-2': { fam: decay.fam, group: 'rune', rune: 'decay', minTier: null, required: true, label: decay.label } });
  assert.match((await plan(gloves, two)).impossible[0], /two rune pools \(Kolr's Hunt and Katla's Gloom\): one rune that opens a pool per item/);
  // a Decay target on the gloves that carry Kolr's Hunt: refused, the rune cannot be replaced
  assert.match((await plan(worn.item, { 'suffix-3': two['suffix-2'] })).impossible[0], /Katla's Gloom, and the item carries another pool rune already/);
  // four suffixes with one from a rune pool need two sockets (Serle's Triumph and the pool rune): gloves get one from
  // an Artificer's Orb; an exceptional base that dropped with two has room
  const res = ['+25% to Fire Resistance', '+25% to Cold Resistance', '+25% to Lightning Resistance'];
  const rare = E.parseItem(ix, ['Item Class: Gloves', 'Rarity: Rare', 'T', 'Polished Bracers', '--------', 'Item Level: 82', '--------', ...res].join('\n')).item;
  const four = {};
  rare.mods.forEach((m, i) => { four['suffix-' + i] = { fam: kb.mods[m.modId].fam, group: 'suffix', minTier: null, required: true, label: m.text }; });
  four['suffix-3'] = targets['suffix-1'];
  assert.match((await plan(gloves, four)).impossible[0], /two augment sockets, and this item can have one/);
  const exc = E.parseItem(ix, ['Item Class: Gloves', 'Rarity: Normal', 'Polished Bracers', '--------', 'Quality: +27% (augmented)', '--------', 'Sockets: S S', '--------', 'Item Level: 82'].join('\n'));
  assert.ok(!exc.warnings.some((w) => w.level === 'error'), JSON.stringify(exc.warnings));
  assert.deepEqual([(exc.item.sockets || []).length, exc.item.quality], [2, 27], 'an exceptional base: one more socket, quality past 20%');
  assert.ok(exc.warnings.some((w) => w.level === 'info' && /one more than Gloves usually get: an exceptional base/.test(w.msg)));
  const ectx = P.makeContext(ix, exc.item);
  assert.match(P.validate(ectx, P.toState(ectx, exc.item), { op: 'artificer' }), /adds none past the usual number/);
  const both = await plan(exc.item, four);
  assert.ok(both.p > 0 && ["Kolr's Hunt", "Serle's Triumph"].every((n) => both.steps.some((s) => s.names.includes(n))) && !both.steps.some((s) => s.names.includes("Artificer's Orb")),
    JSON.stringify(both.impossible || both.steps.map((s) => s.names)));
});

test('jewels are desecrated with the Preserved Cranium only (no Gnawed or Ancient Cranium in the game)', () => {
  const jewel = E.parseItem(ix, 'Item Class: Jewels\nRarity: Normal\nDiamond\n--------\nItem Level: 82').item;
  const ctx = P.makeContext(ix, jewel);
  const rare = Object.assign({}, P.toState(ctx, jewel), { rarity: 'Rare' });
  assert.equal(P.validate(ctx, rare, { op: 'bone', quality: 'Preserved' }), null);
  assert.match(P.validate(ctx, rare, { op: 'bone', quality: 'Ancient' }), /no Ancient Cranium/);
  assert.match(P.validate(ctx, rare, { op: 'bone', quality: 'Gnawed' }), /no Gnawed Cranium/);
  const des = P.availableOps(ix, jewel, { all: true }).find((o) => o.id === 'desecrate');
  assert.deepEqual(des.cur, ['Preserved Cranium']);
  assert.ok(!des.blocked.some((x) => /Cranium/.test(x.name)), 'the missing bones are not listed as blocked either');
  // other classes keep all three
  const wand = E.parseItem(ix, 'Item Class: Wands\nRarity: Normal\nDueling Wand\n--------\nItem Level: 82').item;
  assert.equal(P.availableOps(ix, wand, { all: true }).find((o) => o.id === 'desecrate').cur.filter((n) => /Jawbone/.test(n)).length, 2);
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

test('the Verisium Anvil is outside the tool (user, 28 Sept 2026): not listed among the currency that can be used', () => {
  const item = E.parseItem(ix, 'Item Class: Body Armours\nRarity: Normal\nRusted Cuirass\n--------\nItem Level: 82').item;
  assert.ok(!P.availableOps(ix, item).some((o) => o.id === 'verisium'));
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

test("runes that change crafting: Astrid's Creativity a second crafted modifier; Medved's Tending opens the Soul pool", () => {
  const armour = E.parseItem(ix, 'Item Class: Body Armours\nRarity: Rare\nTest\nHeavy Plate\n--------\nItem Level: 82\n--------\n+120 to maximum Life').item;
  const ctx = ctxOf(armour);
  assert.match(P.validate(ctx, P.toState(ctx, armour), { op: 'rune_rule', item: "Medved's Tending" }), /No free augment socket/);
  assert.ok(P.availableOps(ix, armour, { all: true }).some((o) => o.id === 'rune_rule' && /Soul modifiers \(Medved's Tending\)/.test(o.title)));
  // the Soul modifiers are offered as targets from the rune's pool; the ones with two defences only for the base's own
  // armour type (Heavy Plate is armour only: spawn weights name the other types with 0 before the soul tag)
  const soul = [...E.pickerOptions(ix, armour, { side: 'prefix' }), ...E.pickerOptions(ix, armour, { side: 'suffix' })].filter((o) => o.group === 'rune');
  assert.ok(soul.length >= 8 && soul.every((o) => o.rune === 'soul'), 'soul options: ' + soul.length);
  const ids = soul.flatMap((o) => o.tiers.map((t) => t.id));
  assert.ok(ids.includes('SoulInfluenceSpiritDefencesHybridArmour') && !ids.includes('SoulInfluenceSpiritDefencesHybridArmourEvasion') && !ids.includes('SoulInfluenceSpiritDefencesHybridEnergyShield'), ids.join());
  const sword = E.parseItem(ix, 'Item Class: One Hand Maces\nRarity: Rare\nTest\nMarauding Mace\n--------\nItem Level: 82\n--------\n+20% to Fire Resistance').item;
  const sc = ctxOf(sword);
  const st = P.toState(sc, sword);
  // a rune needs a free augment socket; an Artificer's Orb adds one
  assert.match(P.validate(sc, st, { op: 'rune_rule', item: "Astrid's Creativity" }), /No free augment socket/);
  const holed = P.apply(sc, st, { op: 'artificer' }, P.rngFrom(1)).state;
  assert.equal(P.validate(sc, holed, { op: 'rune_rule', item: "Astrid's Creativity" }), null);
  const runed = P.apply(sc, holed, { op: 'rune_rule', item: "Astrid's Creativity" }, P.rngFrom(1)).state;
  assert.equal(runed.xCrafted, 1);
  assert.match(P.validate(sc, runed, { op: 'rune_rule', item: "Serle's Triumph" }), /No free augment socket/, 'the one socket is taken');
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

test('workbench: a bone use offers three Desecrated modifiers; the same seed takes another one; Abyssal Echoes rerolls the three', () => {
  const item = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '+120 to maximum Life', '35% increased Armour', '+30% to Fire Resistance'].join('\n')).item;
  const a = { op: 'bone', quality: 'Preserved' };
  const r = P.emulate(ix, item, a, { seed: 11 });
  assert.ok(r.reveal && r.reveal.options.length === 3, JSON.stringify(r.reveal));
  const top = Math.max(...r.reveal.options.map((o) => o.lvl));
  assert.equal(r.reveal.options[r.reveal.chosen].lvl, top, 'default: the highest level one, as the planner takes');
  assert.equal(r.reveal.canReroll, false);
  assert.deepEqual(r.added, [r.reveal.options[r.reveal.chosen].text]);
  const other = (r.reveal.chosen + 1) % 3;
  const r2 = P.emulate(ix, item, a, { seed: r.seed, reveal: { choose: other } });
  assert.deepEqual(r2.reveal.options, r.reveal.options, 'same seed, same three offered');
  assert.deepEqual(r2.added, [r.reveal.options[other].text]);
  const it2 = E.parseItem(ix, r2.text).item;
  assert.equal(it2.mods.filter((m) => m.slot === 'prefix' || m.slot === 'suffix').length, 4);
  assert.equal(it2.mods.filter((m) => m.desecrated).length, 1, 'the kept one reads back as Desecrated');
  // Omen of Abyssal Echoes: the first three can be rerolled once, then one of the new three is kept
  const e = { op: 'bone', quality: 'Preserved', echoes: true };
  const r3 = P.emulate(ix, item, e, { seed: 11 });
  assert.equal(r3.reveal.canReroll, true);
  const r4 = P.emulate(ix, item, e, { seed: 11, reveal: { reroll: true } });
  assert.equal(r4.reveal.rerolled, true);
  assert.equal(r4.reveal.canReroll, false);
  assert.deepEqual(r4.reveal.first, r3.reveal.options, 'the three before the reroll are the first ones');
  const r5 = P.emulate(ix, item, e, { seed: 11, reveal: { reroll: true, choose: 2 } });
  assert.deepEqual(r5.reveal.options, r4.reveal.options);
  assert.deepEqual(r5.added, [r4.reveal.options[2].text]);
  assert.ok(P.actionNames(e).includes('Omen of Abyssal Echoes'));
  // other currency has no reveal
  assert.equal(P.emulate(ix, item, { op: 'exalt' }, { seed: 3 }).reveal, undefined);
});

test('strategy simulator: transmute until a Life prefix, augment for Fire Resistance, else a new base; agrees with the stat shares', () => {
  const white = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Normal', 'Heavy Plate', '--------', 'Item Level: 82'].join('\n')).item;
  const life = { fam: 'IncreasedLife', side: 'prefix' }, fire = { fam: 'FireResistance', side: 'suffix' };
  const strategy = {
    steps: [
      { action: { op: 'transmute', tier: 'base' }, rules: [{ groups: [{ type: 'not', reqs: [life] }], go: 'restart' }] },
      { action: { op: 'augment', tier: 'base' }, otherwise: 'restart' },
    ],
    goal: [{ type: 'and', reqs: [life, fire] }],
  };
  const price = { 'Orb of Transmutation': 0.01, 'Orb of Augmentation': 0.02 };
  const r = P.runStrategy(ix, white, strategy, { trials: 3000, maxUses: 5000, priceOf: (n) => price[n] ?? null, baseCost: 0.005 });
  assert.ok(!r.reason, r.reason);
  assert.ok(r.p > 0.99, JSON.stringify(r.ends));
  // one attempt succeeds with P(Life prefix first) x P(Fire Resistance among the suffixes)
  const fc = P.familyChances(ix, white, {});
  const pl = fc.any['prefix|IncreasedLife'];
  const withLife = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Magic', 'Heavy Plate', '--------', 'Item Level: 82', '--------', '+120 to maximum Life'].join('\n')).item;
  const pf = P.familyChances(ix, withLife, {}).side.suffix.FireResistance;
  const expected = 1 / (pl * pf);
  assert.ok(Math.abs(r.meanRestarts + 1 - expected) / expected < 0.12, `${r.meanRestarts + 1} vs ${expected}`);
  // uses: a Transmutation per attempt, an Augmentation per kept Life prefix; cost = uses x prices + restarts x base
  assert.ok(Math.abs(r.steps[0].avg - (r.meanRestarts + 1)) < 1e-9);
  const cost = r.steps[0].avg * 0.01 + r.steps[1].avg * 0.02 + r.meanRestarts * 0.005;
  assert.ok(Math.abs(cost - r.meanCost) < 1e-6, `${cost} vs ${r.meanCost}`);
  assert.deepEqual(r.missingPrices, []);
  // a step that cannot be used can stop the run; a budget ends runs too
  const reg = P.runStrategy(ix, white, { steps: [{ action: { op: 'regal', tier: 'base' }, unusable: 'stop' }], goal: strategy.goal }, { trials: 50 });
  assert.equal(reg.p, 0);
  assert.match(reg.ends[0].reason, /^step 1 could not be used/);
  const tight = P.runStrategy(ix, white, strategy, { trials: 500, priceOf: (n) => price[n] ?? null, baseCost: 0.005, budget: 0.2 });
  assert.ok(tight.ends.some((e) => e.reason === 'over budget') && tight.p < 0.9, JSON.stringify(tight.ends));
  assert.ok(tight.meanCost <= 0.2 + 1e-9);
  // Well of Souls: an offered Desecrated modifier the goal asks for is kept
  const rare = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '+120 to maximum Life', '35% increased Armour', '+30% to Fire Resistance'].join('\n')).item;
  const ctx = P.makeContext(ix, rare);
  const d = P.desPoolFor(ctx, 'suffix', 0, null).find((e) => e.fam !== 'FireResistance');
  const one = P.runStrategy(ix, rare, { steps: [{ action: { op: 'bone', quality: 'Preserved', side: 'suffix' } }], goal: [{ type: 'and', reqs: [{ fam: d.fam, side: 'suffix', des: true }] }] }, { trials: 4000 });
  const two = P.runStrategy(ix, rare, { steps: [{ action: { op: 'bone', quality: 'Preserved', side: 'suffix', echoes: true } }], goal: [{ type: 'and', reqs: [{ fam: d.fam, side: 'suffix', des: true }] }] }, { trials: 4000 });
  assert.ok(one.p > 0 && two.p > one.p * 1.5, `${one.p} ${two.p}`);
});

test('strategy simulator: the sliced run gives the same result as the plain one; rules can send a run to a step', async () => {
  const white = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Normal', 'Heavy Plate', '--------', 'Item Level: 82'].join('\n')).item;
  const life = { fam: 'IncreasedLife', side: 'prefix' };
  const strategy = {
    steps: [
      { action: { op: 'transmute', tier: 'base' }, rules: [{ groups: [{ type: 'and', reqs: [life] }], go: { step: 2 } }], otherwise: 'restart' },
      { action: { op: 'augment', tier: 'base' } }, // skipped by the rule
      { action: { op: 'regal', tier: 'base' }, rules: [{ groups: [{ type: 'and', reqs: [{ kind: 'open', side: 'suffix' }] }], go: 'next' }], otherwise: 'stop' },
      { action: { op: 'exalt', tier: 'base', side: 'suffix' }, rules: [{ groups: [{ type: 'and', reqs: [{ kind: 'rarity', value: 'Rare' }] }], go: 'repeat' }], max: 2 },
    ],
    goal: [{ type: 'count', n: 3, reqs: [life, { fam: 'FireResistance', side: 'suffix' }, { fam: 'ColdResistance', side: 'suffix' }, { fam: 'LightningResistance', side: 'suffix' }] }],
  };
  const a = P.runStrategy(ix, white, strategy, { trials: 600, seed: 5 });
  const b = await P.runStrategyAsync(ix, white, strategy, { trials: 600, seed: 5 });
  assert.deepEqual(b, a);
  assert.equal(a.steps[1].avg, 0, 'the rule skips the Augmentation');
  assert.ok(a.steps[3].avg <= 2 + 1e-9, 'at most two Exalted Orbs per run');
  assert.ok(a.p > 0 && a.p < 1, JSON.stringify(a.ends));
  assert.ok(a.ends.every((e) => ['goal met', 'past the last step', 'stopped at step 3'].includes(e.reason)), JSON.stringify(a.ends));
  // the rarity and open-slot requirements
  const ctx = P.makeContext(ix, white);
  const st = P.toState(ctx, white);
  // an open slot counts under the item's rarity: none on a Normal item, one per side on a Magic one
  assert.ok(P.groupsMet(ctx, st, [{ type: 'and', reqs: [{ kind: 'rarity', value: 'Normal' }] }, { type: 'not', reqs: [{ kind: 'open', side: 'prefix' }] }]));
  const magic = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Magic', 'Heavy Plate', '--------', 'Item Level: 82', '--------', '+120 to maximum Life'].join('\n')).item;
  const cm = P.makeContext(ix, magic), sm = P.toState(cm, magic);
  assert.ok(P.groupsMet(cm, sm, [{ type: 'and', reqs: [{ kind: 'open', side: 'suffix' }] }, { type: 'not', reqs: [{ kind: 'open', side: 'prefix' }] }]));
  assert.ok(!P.groupsMet(ctx, st, [{ type: 'or', reqs: [{ kind: 'rarity', value: 'Rare' }] }]));
  assert.match(P.runStrategy(ix, white, { steps: [], goal: [] }).reason, /at least one step/);
});

test('Well of Souls: three options from one side, base modifiers and desecrated-only ones, at least one desecrated-only when one can roll', () => {
  const armour = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '+120 to maximum Life', '+30% to Fire Resistance'].join('\n')).item;
  const ctx = P.makeContext(ix, armour);
  // poe2db: body armour, gloves, boots and helmets have no desecrated-only prefix; the game data agrees
  assert.equal(P.desPoolFor(ctx, 'prefix', 0, null).length, 0);
  assert.ok(P.desPoolFor(ctx, 'suffix', 0, null).length > 0);
  let sides = { prefix: 0, suffix: 0 }, base = 0, only = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = P.emulate(ix, armour, { op: 'bone', quality: 'Preserved' }, { seed });
    const o = r.reveal.options;
    assert.equal(o.length, 3);
    assert.equal(new Set(o.map((x) => x.side)).size, 1, 'one side, set when the bone is used');
    sides[o[0].side]++;
    if (o[0].side === 'suffix') assert.ok(o.some((x) => x.only), 'at least one desecrated-only suffix');
    else assert.ok(o.every((x) => !x.only), 'no desecrated-only prefix on body armour');
    base += o.filter((x) => !x.only).length; only += o.filter((x) => x.only).length;
  }
  assert.ok(sides.prefix > 100 && sides.suffix > 100, JSON.stringify(sides));
  assert.ok(base > 0 && only > 0);
  // the side omen sets the side; a lich omen offers only that lich's modifiers
  const rs = P.emulate(ix, armour, { op: 'bone', quality: 'Preserved', side: 'suffix' }, { seed: 7 });
  assert.ok(rs.reveal.options.every((x) => x.side === 'suffix'));
  const ring = E.parseItem(ix, ['Item Class: Rings', 'Rarity: Rare', 'Test Loop', 'Ruby Ring', '--------', 'Item Level: 82', '--------', '+60 to maximum Life'].join('\n')).item;
  // a lich omen guarantees one of that lich's modifiers: the first option (Craft of Exile, game text "a random Kurgal modifier")
  const kb2 = ix.kb;
  let counts = [0, 0, 0, 0];
  for (let seed = 1; seed <= 400; seed++) {
    const rl = P.emulate(ix, ring, { op: 'bone', quality: 'Preserved', lich: 'Kurgal', side: 'suffix' }, { seed });
    const o = rl.reveal.options;
    assert.equal(o.length, 3);
    const first = kb2.mods[Object.keys(kb2.mods).find((id) => kb2.mods[id].txt.replace(/\n/g, ' / ') === o[0].text && kb2.mods[id].dom === 'd')];
    assert.equal(E.lichOf(first), 'Kurgal', o[0].text);
    counts[o.filter((x) => x.only).length]++;
  }
  // how many desecrated-only: 1, 2 or 3 at 80/15/5% (Craft of Exile); never 0 when one can roll
  assert.equal(counts[0], 0);
  assert.ok(counts[1] > 280 && counts[2] > 30 && counts[3] > 5, JSON.stringify(counts));
  // a base-modifier goal is met by a Desecrated base modifier of that family, and the Well keeps it when offered
  const lifeGoal = { fam: 'IncreasedLife', side: 'prefix', des: false, grp: ['IncreasedLife'], tier: null };
  assert.ok(P.meets({ fam: 'IncreasedLife', des: true, tier: 3 }, lifeGoal));
  assert.ok(!P.meets({ fam: 'IncreasedLife', des: false, tier: 3 }, Object.assign({}, lifeGoal, { des: true })));
  const noLife = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '35% increased Armour', '+30% to Fire Resistance'].join('\n')).item;
  const c2 = P.makeContext(ix, noLife);
  const { goals } = P.goalsFromTargets(c2, { 'prefix-0': { fam: 'IncreasedLife', group: 'prefix', label: 'Life' } });
  const run = P.simulate(c2, P.toState(c2, noLife), goals, { bone: 'Preserved', echoes: true }, { trials: 1 }); // policy smoke
  assert.ok(run.trials === 1);
});

test('Flux: every other-element resistance converts at its tier, values rolled again, even onto an element the item has (t20)', () => {
  const item = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '+120 to maximum Life', '+30% to Fire Resistance', '+31% to Cold Resistance'].join('\n')).item;
  const ctx = P.makeContext(ix, item);
  const st = P.toState(ctx, item);
  assert.equal(P.validate(ctx, st, { op: 'flux', to: 'fire' }), null);
  const cold = st.mods.find((m) => m.fam === 'ColdResistance');
  const r = P.apply(ctx, st, { op: 'flux', to: 'fire' }, P.rngFrom(3));
  const fire = r.state.mods.filter((m) => m.fam === 'FireResistance');
  assert.equal(fire.length, 2, 'two Fire Resistance modifiers');
  assert.equal(fire.find((m) => m.flux).tier, cold.tier, 'same tier');
  const out = P.emulate(ix, item, { op: 'flux', to: 'fire' }, { seed: 5 });
  assert.equal((out.text.match(/to Fire Resistance/g) || []).length, 2);
  assert.ok(!/Cold Resistance/.test(out.text));
});

test('corruption: Vaal Orb outcomes (Omen of Corruption is not in the game), Architect 50/50, Orb of Sacrifice', () => {
  const armour = E.parseItem(ix, ['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '+120 to maximum Life', '35% increased Armour', '+30% to Fire Resistance', '+25% to Cold Resistance'].join('\n')).item;
  const seen = {};
  const kind = (o) => o.split(':')[1].split('.')[0].trim();
  for (let s = 1; s <= 400; s++) {
    const r = P.emulate(ix, armour, { op: 'vaal' }, { seed: s });
    seen[kind(r.outcome)] = 1 + (seen[kind(r.outcome)] || 0);
    assert.ok(E.parseItem(ix, r.text).item.flags.corrupted);
  }
  assert.equal(Object.keys(seen).length, 4, JSON.stringify(seen));
  for (const n of Object.values(seen)) assert.ok(n > 60 && n < 140, JSON.stringify(seen));
  // Omen of Corruption cannot be obtained since 0.5.0 (kb.legacy_or_disabled): the emulator refuses it
  assert.match(P.emulate(ix, armour, { op: 'vaal', omen: true }, { seed: 1 }).reason, /Omen of Corruption is not in the game/);
  // an added Corruption Enchantment reads back as a corruption implicit
  let ench;
  for (let s = 1; !ench && s <= 400; s++) { const r = P.emulate(ix, armour, { op: 'vaal' }, { seed: s }); if (/Enchantment was added/.test(r.outcome)) ench = r; }
  const ci = E.parseItem(ix, ench.text).item;
  assert.equal(ci.implicits.filter((m) => m.corruption).length, 1);
  assert.match(P.emulate(ix, ci, { op: 'exalt' }).reason, /Corrupted/);
  let destroyed = 0;
  for (let s = 1; s <= 200; s++) {
    const r = P.emulate(ix, ci, { op: 'architect' }, { seed: s });
    if (r.destroyed) destroyed++;
    else assert.equal(E.parseItem(ix, r.text).item.implicits.filter((m) => m.corruption).length, 2);
  }
  assert.ok(destroyed > 70 && destroyed < 130, String(destroyed));
  const sac = P.emulate(ix, ci, { op: 'sacrifice' }, { seed: 2 });
  assert.equal(sac.removed.length, 1);
  assert.match(sac.outcome, /upgraded/);
});

test('Void Flux, Omen of Putrefaction, Homogenising omens, Altered Collarbone, catalysts, Artificer, Extraction, Aldur, Chance, Cultivation', () => {
  const it = (lines) => E.parseItem(ix, lines.join('\n')).item;
  const armour = it(['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------',
    '+120 to maximum Life', '35% increased Armour', '+30% to Fire Resistance', '+25% to Cold Resistance']);
  const vf = E.parseItem(ix, P.emulate(ix, armour, { op: 'flux', to: 'chaos' }, { seed: 1 }).text).item;
  assert.equal(vf.mods.filter((m) => m.fam === 'ChaosResistance').length, 2);
  assert.equal(vf.mods.filter((m) => /Fire|Cold/.test(m.fam || '')).length, 0);
  const pu = E.parseItem(ix, P.emulate(ix, armour, { op: 'bone', quality: 'Preserved', putrefy: true }, { seed: 3 }).text).item;
  assert.equal(pu.mods.filter((m) => m.desecrated).length, 6);
  assert.ok(pu.flags.corrupted);
  // Homogenising omens are not in the game (0.5.5): the emulator refuses them
  const one = it(['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Item Level: 82', '--------', '+30% to Fire Resistance']);
  assert.match(P.emulate(ix, one, { op: 'exalt', homog: true }, { seed: 1 }).reason, /Omen of Homogenising Exaltation is not in the game/);
  assert.ok(P.actionNames({ op: 'exalt', homog: true }).includes('Omen of Homogenising Exaltation'));
  // Altered Collarbone only on jewellery
  const ring = it(['Item Class: Rings', 'Rarity: Rare', 'Test Loop', 'Ruby Ring', '--------', 'Item Level: 82', '--------', '+60 to maximum Life']);
  assert.ok(P.emulate(ix, ring, { op: 'bone', quality: 'Altered' }, { seed: 1 }).text);
  assert.match(P.emulate(ix, armour, { op: 'bone', quality: 'Altered' }).reason, /amulets, rings and belts/);
  // catalysts: 1% a catalyst at item level 50+, up to 20%
  let r2 = ring;
  for (let i = 0; i < 25; i++) {
    const e = P.emulate(ix, r2, { op: 'catalyst', tag: 'life', item: 'Flesh Catalyst' }, { seed: i });
    if (e.reason) break;
    r2 = E.parseItem(ix, e.text).item;
  }
  assert.equal(r2.quality, 20);
  // Artificer's Orb adds an augment socket up to the base's usual number; Orb of Extraction destroys the item and returns
  // the runes that are not socket-bound
  const art = E.parseItem(ix, P.emulate(ix, armour, { op: 'artificer' }, { seed: 1 }).text).item;
  assert.equal((art.sockets || []).length, 1);
  const art2 = E.parseItem(ix, P.emulate(ix, art, { op: 'artificer' }, { seed: 1 }).text).item;
  assert.equal((art2.sockets || []).length, 2);
  assert.match(P.emulate(ix, art2, { op: 'artificer' }).reason, /the most Artificer.s Orb gives Body Armour/);
  assert.match(P.emulate(ix, armour, { op: 'extraction' }).reason, /No augment is socketed/);
  const runed = it(['Item Class: Body Armours', 'Rarity: Rare', 'Test Robe', 'Heavy Plate', '--------', 'Sockets: S S', '--------', 'Item Level: 82', '--------',
    '+15% to Fire Resistance (rune)', 'Can roll Soul modifiers (rune)', '--------', '+120 to maximum Life']);
  const ex = P.emulate(ix, runed, { op: 'extraction' }, { seed: 1 });
  assert.ok(ex.destroyed && /Back to you: \+15% to Fire Resistance/.test(ex.outcome) && /Lost \(socket-bound\): Can roll Soul modifiers/.test(ex.outcome), ex.outcome);
  assert.ok(kb.augments["Medved's Tending"].bound);
  // Rune of Aldur: Cold modifiers turn into the same tier of Fire ones
  const noSocket = it(['Item Class: Staves', 'Rarity: Rare', 'Test', 'Chiming Staff', '--------', 'Item Level: 82', '--------', '120% increased Cold Damage', '+4 to Level of all Cold Spell Skills']);
  assert.match(P.emulate(ix, noSocket, { op: 'aldur', item: 'Passion of Aldur' }, { seed: 1 }).reason, /No free augment socket/);
  const staff = it(['Item Class: Staves', 'Rarity: Rare', 'Test', 'Chiming Staff', '--------', 'Sockets: S', '--------', 'Item Level: 82', '--------', '120% increased Cold Damage', '+4 to Level of all Cold Spell Skills']);
  const al = E.parseItem(ix, P.emulate(ix, staff, { op: 'aldur', item: 'Passion of Aldur' }, { seed: 1 }).text).item;
  assert.equal(al.mods.length, 2);
  assert.ok(al.mods.every((m) => /Fire/.test(m.fam) && !/Cold/.test(m.fam)), JSON.stringify(al.mods.map((m) => m.fam)));
  // Orb of Chance: the uniques of the base, odds not in the data; Vaal Cultivation Orb: another unique of the class
  assert.match(P.emulate(ix, it(['Item Class: Rings', 'Rarity: Normal', 'Ruby Ring', '--------', 'Item Level: 82']), { op: 'chance' }).reason, /odds per base are not/);
  const uq = it(['Item Class: Rings', 'Rarity: Unique', "Ventor's Gamble", 'Gold Ring', '--------', 'Item Level: 82', '--------', '12% increased Rarity of Items found', '--------', 'Corrupted']);
  const cu = E.parseItem(ix, P.emulate(ix, uq, { op: 'cultivation' }, { seed: 3 }).text).item;
  assert.ok(cu.rarity === 'Unique' && cu.name !== "Ventor's Gamble" && kb.uniques[cu.name].cls === 'Ring' && cu.flags.corrupted);
});
