// A small slice of the self-test (scripts/selftest) in the regular suite: rule invariants on random walks,
// roll frequencies against the weights, the parser round trip, and strategy mining on one scenario.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../scripts/selftest/walk.js');
const M = require('../../scripts/selftest/mine.js');

const HARD = ['crash', 'slots', 'crafted', 'desecrated', 'groups', 'ilvl', 'fractured', 'floor', 'effect', 'side', 'lich', 'pool', 'whittle', 'light', 'parse-adv', 'parse-simple'];

for (const base of ['Wrath Sceptre', 'Sirenscale Gloves', 'Biostatic Ring', 'Ruby']) {
  test(`self-test walk: every rule holds on ${base}`, () => {
    const r = W.walkBase(base, { walks: 6, steps: 50, seed: 42 });
    assert.ok(r.steps > 150, 'steps walked: ' + r.steps);
    for (const id of HARD) {
      const c = r.checks[id];
      if (!c) continue;
      assert.equal(c.fail, 0, `${id}: ${c.examples.join(' | ')}`);
    }
  });
}

test('self-test frequencies: Exalted Orb rolls follow the poe2db weights', () => {
  const f = W.frequencyTest('Sirenscale Gloves', 9, 12000);
  for (const t of f.tests) {
    assert.ok(t.fams >= 5, 'families compared');
    assert.equal(t.fail, 0, `${t.tier}: max z ${t.maxZ}`);
  }
});

test('self-test mining: a scenario compares strategies and finds a route', () => {
  const r = M.mineScenario({ id: 't', base: 'Wrath Sceptre', ilvl: 82, start: 'rare', seed: 5,
    targets: { 'suffix-0': { fam: 'GlobalIncreaseMinionSpellSkillGemLevelWeapon', group: 'suffix', minTier: 2, required: true, label: 'minion level' } } }, { trials: 60, maxSteps: 150 });
  assert.ok(!r.skip, r.skip);
  assert.ok(r.results.length >= 10, 'strategies: ' + r.results.length);
  assert.ok(r.results.some((x) => x.p > 0.3), 'some strategy finishes');
  assert.ok(r.results.every((x) => x.p >= 0 && x.p <= 1 && x.cost >= 0));
});
