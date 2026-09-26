const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../value.js');

const f = (fam, tier) => ({ fam, tier, text: fam + ' T' + tier });
const obs = (feats, ex) => ({ cls: 'Amulet', feats, ex });

test('similar items: closest logged prices drive the estimate', () => {
  const log = [
    obs([f('Spirit', 1), f('SpellLevel', 1)], 900),
    obs([f('Spirit', 1), f('SpellLevel', 2)], 500),
    obs([f('Life', 3), f('Rarity', 2)], 20),
    obs([f('Spirit', 5), f('Mana', 3)], 30),
  ];
  const e = V.estimate([f('Spirit', 1), f('SpellLevel', 1)], log);
  assert.equal(e.method, 'similar');
  assert.ok(e.value >= 500 && e.value <= 900, String(e.value));
  assert.equal(V.estimate([f('Armour', 1)], log), null, 'nothing similar -> no estimate');
});

test('mod model: learns that a family adds value and projects a target', () => {
  const log = [];
  for (let i = 0; i < 20; i++) {
    const spell = (i % 4) + 1; // tiers 1..4
    const base = [f('SpellLevel', spell), f('Life', (i % 3) + 2)];
    const price = 1000 * Math.pow(0.45, spell - 1) * (1 + (i % 5) * 0.05);
    log.push(obs(base, price));
  }
  const model = V.fitModel(log, 0.5);
  assert.ok(model && model.weights.SpellLevel > model.weights.Life, JSON.stringify(model.weights));
  const cur = [f('SpellLevel', 4), f('Life', 3)];
  const before = V.estimate(cur, log, model).value;
  const after = V.estimate(V.withTarget(cur, 'SpellLevel T4', { fam: 'SpellLevel', tier: 1 }), log, model).value;
  assert.ok(after > before * 3, `${before} -> ${after}`);
  assert.equal(V.fitModel(log.slice(0, 5)), null, 'needs 8+ prices');
});

test('similarity is symmetric-ish and tier-aware', () => {
  const a = [f('Spirit', 1), f('SpellLevel', 1)];
  assert.equal(V.similarity(a, a), 1);
  assert.ok(V.similarity(a, [f('Spirit', 2), f('SpellLevel', 1)]) > V.similarity(a, [f('Spirit', 5), f('SpellLevel', 1)]));
  assert.ok(V.similarity(a, [f('Life', 1)]) === 0);
});
