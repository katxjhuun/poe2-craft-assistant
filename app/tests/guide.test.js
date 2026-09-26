// node --test app/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../engine.js');
const G = require('../guide.js');
const kb = require(process.env.POE2_KB || path.join(__dirname, '..', '..', 'poe2_kb_0.5.5.json')); // POE2_KB: test a candidate KB
const lib = require('../data/recipes_0.5.5.json');
const ix = E.buildIndex(kb);
const check = (c, o) => G.checkClaim(ix, c, lib, o);

test('10.5 "Chaos Orb rerolls all mods" is rejected (English and Turkish)', () => {
  assert.equal(check('Spam Chaos Orb until the item rerolls all its modifiers into something good.').verdict, 'rejected');
  assert.equal(check('Chaos Orb tüm modları yeniden atar.').verdict, 'rejected');
});

test('PoE1 currency and jargon are rejected', () => {
  assert.equal(check('Use an Orb of Scouring to clean the item first.').verdict, 'rejected');
  assert.equal(check('Do the classic alt-regal loop for the prefix.').verdict, 'rejected');
  assert.equal(check('Finish the rare with fossils before slamming.').verdict, 'rejected');
});

test('0.5 rule violations are rejected', () => {
  assert.equal(check('Apply a second essence, it overwrites the first crafted modifier.').verdict, 'rejected');
  assert.equal(check('Magic items can roll up to three modifiers.').verdict, 'rejected');
  assert.equal(check('Greater Exalted Orb needs item level 35.').verdict, 'rejected');
  assert.equal(check('Omen of Whittling removes the lowest tier modifier.').verdict, 'rejected');
});

test('legacy mechanics and old patches are outdated', () => {
  assert.equal(check('Use Omen of Homogenising Exaltation for a guaranteed level mod.').verdict, 'outdated');
  assert.equal(check('Catalysts drop from Breach monsters, farm them there.').verdict, 'outdated');
  assert.equal(check('In patch 0.3 you can slam two essences.').verdict, 'rejected');
  assert.equal(check('Exalt the item with a side omen.', { guidePatch: 0.3 }).verdict, 'outdated');
});

test('claims that match the verified log are verified', () => {
  const r = check('Omen of Light makes Orb of Annulment remove only the Desecrated modifier.');
  assert.equal(r.verdict, 'verified');
  assert.equal(r.match, 'k29');
  assert.equal(check('An item can have only one crafted modifier and one desecrated modifier.').verdict, 'verified');
});

test('unsupported percentages stay plausible at best', () => {
  const r = check('Perfect Exalted Orb has a 25% chance to hit +4 minion levels.');
  assert.equal(r.verdict, 'plausible');
  assert.ok(r.reasons.some((x) => /estimates/.test(x)));
});

test('guide splitting and summary', () => {
  const text = '1. Use Greater Orb of Transmutation on a white sceptre.\n2. Chaos Orb rerolls all mods.\n- Omen of Light removes only the Desecrated mod with Orb of Annulment.';
  const out = G.checkGuide(ix, text, lib);
  assert.equal(out.results.length, 3);
  assert.equal(out.summary.rejected, 1);
  assert.ok(out.summary.verified >= 1);
});

test('recipe library filters by class and league', () => {
  const rs = G.recipesFor(lib, 'Sceptre', 'Forbidden Rites');
  assert.ok(rs.some((r) => r.id === 'c1a'));
  const puppet = rs.find((r) => r.id === 'c1c');
  assert.equal(puppet.inLeague, false, 'Alloy recipe is Runes of Aldur only');
  assert.ok(rs.findIndex((r) => r.id === 'c1a') < rs.findIndex((r) => r.id === 'c1c'));
  assert.ok(!G.recipesFor(lib, 'Boots', 'Forbidden Rites').some((r) => r.id === 'c1a'));
});

test('every recipe currency name exists in PoE2 data', () => {
  const roster = new Set([...kb.currency_roster.Currency, ...kb.currency_roster.Omen]);
  const bad = [];
  for (const r of lib.recipes) for (const s of r.steps) for (const n of s.names) if (!roster.has(n)) bad.push(`${r.id}: ${n}`);
  assert.deepEqual(bad, []);
  for (const r of lib.recipes) assert.deepEqual(E.leakScan(ix, JSON.stringify(r)), [], r.id);
});

test('Putrefaction claims are no longer rejected', () => {
  assert.equal(check('Omen of Putrefaction creates an item with six desecrated modifiers.').verdict, 'verified');
});

test('in-game test results settle linked claims in the right direction', () => {
  const eff = G.effectiveLibrary(lib, { t4: { status: 'confirmed', note: 'refused on ilvl 70' } });
  const by = (id) => eff.claims.find((c) => c.id === id);
  assert.equal(by('k26').verdict, 'verified');
  assert.equal(by('k27').verdict, 'rejected');
  const refuted = G.effectiveLibrary(lib, { t3: { status: 'refuted' } });
  assert.equal(refuted.claims.find((c) => c.id === 'k17').verdict, 'verified', 'refuting "blocked" means overwrite holds');
  assert.equal(G.effectiveLibrary(lib, {}).claims.find((c) => c.id === 'k11').verdict, 'verified', 'preset result applies');
  assert.equal(lib.claims.find((c) => c.id === 'k26').tested, undefined, 'the original library is not changed');
  const r = G.checkClaim(ix, 'Omen of Whittling removes the lowest tier modifier.', G.effectiveLibrary(lib, { t9: { status: 'confirmed' } }));
  assert.equal(r.verdict, 'rejected');
});

test('9.1 source tiers from the address', () => {
  assert.equal(G.sourceTier('https://www.pathofexile.com/forum/view-thread/1'), 'C');
  assert.equal(G.sourceTier('https://pathofexile.com/patch-notes'), 'A');
  assert.equal(G.sourceTier('poe2db.tw/us/Sceptres'), 'B');
  assert.equal(G.sourceTier('https://maxroll.gg/poe2/resources/crafting'), 'B');
  assert.equal(G.sourceTier('https://www.reddit.com/r/PathOfExile2/x'), 'C');
  assert.equal(G.sourceTier('https://cheap-currency-shop.example/guide'), 'D');
  assert.equal(G.sourceTier(''), null);
});

test('9.2 a claim said by two independent A/B sources is verified; the same author twice is not', () => {
  const claim = 'Omen of Dextral Necromancy makes the bone add a suffix desecrated modifier.';
  assert.equal(check(claim).verdict, 'plausible');
  const saved = G.logEntries([G.checkClaim(ix, claim, lib, {})], { url: 'https://maxroll.gg/poe2/a', author: 'Writer One', tier: 'B' });
  const lib2 = Object.assign({}, lib, { claims: lib.claims.concat(saved.map((c, i) => Object.assign({ id: 'u' + i }, c))) });
  const other = G.checkClaim(ix, claim, lib2, { source: { url: 'https://poe2db.tw/x', author: 'Someone Else', tier: 'B' } });
  assert.equal(other.verdict, 'verified');
  assert.ok(other.reasons.some((r) => /2 independent A\/B sources/.test(r)));
  assert.equal(G.checkClaim(ix, claim, lib2, { source: { url: 'https://maxroll.gg/poe2/b', author: 'writer one', tier: 'B' } }).verdict, 'plausible');
  assert.equal(G.checkClaim(ix, claim, lib2, { source: { url: 'https://reddit.com/r/x', author: 'Third', tier: 'C' } }).verdict, 'plausible');
  // a rule violation stays rejected whatever the sources say
  const bad = 'Chaos Orb rerolls all modifiers on the item.';
  const lib3 = Object.assign({}, lib, { claims: lib.claims.concat([{ id: 'u9', claim: bad, verdict: 'plausible', reason: '', source: { author: 'A', tier: 'A' } }]) });
  assert.equal(G.checkClaim(ix, bad, lib3, { source: { author: 'B', tier: 'B' } }).verdict, 'rejected');
});

test('9.2 percentages: the planner estimate is shown, the verdict stays plausible', () => {
  const r = G.checkClaim(ix, 'Perfect Exalted Orb has a 25% chance to hit +4 minion levels.', lib, { math: () => ({ text: 'Planner: 7.9% per use.' }) });
  assert.equal(r.verdict, 'plausible');
  assert.ok(r.reasons.includes('Planner: 7.9% per use.'));
});

test('8.1 league rules: HC, SSF and private copies follow their parent league; the player can set them', () => {
  assert.equal(G.leagueRules('Runes of Aldur'), 'Runes of Aldur');
  assert.equal(G.leagueRules('HC Runes of Aldur'), 'Runes of Aldur');
  assert.equal(G.leagueRules('SSF Forbidden Rites'), 'Forbidden Rites');
  assert.equal(G.leagueRules('Hardcore'), 'Standard');
  assert.equal(G.leagueRules('Standard'), 'Standard');
  assert.equal(G.leagueRules('HC FRites League by Cardiff (PL86503)'), null);
  const mine = [{ name: 'HC FRites League by Cardiff (PL86503)', rules: 'Forbidden Rites' }, { name: 'Runes of Aldur', rules: 'Nonsense' }];
  assert.equal(G.leagueRules('HC FRites League by Cardiff (PL86503)', mine), 'Forbidden Rites');
  assert.equal(G.leagueRules('Runes of Aldur', mine), 'Runes of Aldur');            // an invalid choice falls back to the name
  // recipes scoped to the parent league apply in its HC copy once the page passes the rules league
  const rs = G.recipesFor(lib, 'Sceptre', G.leagueRules('HC Forbidden Rites'));
  assert.ok(rs.some((r) => r.inLeague));
});
