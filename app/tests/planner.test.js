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
  const sceptre = P.availableOps(ix, parse('rare-sceptre-adv')).find((o) => o.id === 'desecrate');
  assert.ok(sceptre.omens.includes('Omen of the Liege'));
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
  for (const n of names) assert.ok(kb.currency_metadata_ids[n] || kb.item_descriptions[n], 'known PoE2 name: ' + n);
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

test('flasks and charms stay Magic: only Magic currency, one prefix and one suffix goal', async () => {
  const item = E.parseItem(ix, 'Item Class: Life Flasks\nRarity: Normal\nUltimate Life Flask\n--------\nItem Level: 84').item;
  const ctx = P.makeContext(ix, item);
  const st = P.toState(ctx, item);
  assert.ok(ctx.magicOnly);
  const magic = Object.assign({}, st, { rarity: 'Magic' });
  for (const op of ['regal', 'alchemy', 'exalt', 'chaos', 'essence', 'fracture']) assert.match(P.validate(ctx, magic, { op }) || '', /R_FLASK_MAGIC/, op);
  assert.equal(P.validate(ctx, st, { op: 'transmute' }), null);
  const ops = P.availableOps(ix, item, { all: true });
  assert.ok(ops.find((o) => o.id === 'quality').cur.includes("Glassblower's Bauble"));
  assert.ok(!ops.find((o) => o.id === 'regal').ok);
  const targets = {
    'prefix-0': { fam: 'FlaskIncreasedRecoverySpeed', group: 'prefix', minTier: 1, required: true, label: 'recovery rate' },
    'suffix-0': { fam: 'FlaskIncreasedChargesAdded', group: 'suffix', minTier: 1, required: true, label: 'charges gained' },
  };
  const out = await P.buildPlans({ ix, item, targets, locks: {}, priceOf: () => 1, trials: 600, screenTrials: 120, beamBudgetMs: 0 });
  const bal = out.profiles.balanced;
  assert.ok(bal.p > 0.5, 'the Magic loop reaches the goals');
  const used = new Set(bal.steps.map((s) => s.action.op));
  assert.ok([...used].every((op) => ['transmute', 'augment', 'annul', 'newbase', 'divine'].includes(op)), [...used].join());
  const two = await P.buildPlans({ ix, item, targets: { 'prefix-0': targets['prefix-0'], 'prefix-1': { fam: 'FlaskIncreasedRecoveryAmount', group: 'prefix', minTier: 3, required: true, label: 'amount' } },
    locks: {}, priceOf: () => 1, trials: 200, screenTrials: 40, beamBudgetMs: 0 });
  assert.match(two.profiles.balanced.impossible.join(' '), /only 1 prefix/);
});
