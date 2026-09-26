// node --test app/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../engine.js');
const SAMPLES = require('../samples.js');
const kb = require(process.env.POE2_KB || path.join(__dirname, '..', '..', 'poe2_kb_0.5.5.json')); // POE2_KB: test a candidate KB
const ix = E.buildIndex(kb);
const sample = (id) => SAMPLES.find((s) => s.id === id).text;
const tiersOn = (base, fam) => E.familyTiersByTags(ix, fam, kb.bases[base].tags);
const MINION_W = 'GlobalIncreaseMinionSpellSkillGemLevelWeapon';
const MINION = 'GlobalIncreaseMinionSpellSkillGemLevel';

// ------------------------------------------------------------------ 10.1 data
test('10.1 counts match meta.counts', () => {
  const c = kb.meta.counts;
  assert.equal(Object.keys(kb.bases).length, c.bases);
  assert.equal(Object.keys(kb.mods).length, c.mods);
  assert.equal(Object.values(kb.mods).filter((m) => m.dom === 'd').length, c.desecrated_mods);
  assert.equal(Object.keys(kb.tag_signatures).length, c.tag_signatures);
  assert.equal(kb.stat_index.length, c.stat_index);
  assert.equal(kb.currency_roster.Currency.length, c.currencies);
  assert.equal(kb.currency_roster.Omen.length, c.omens);
});

test('10.1 no blacklist name or [DNT] in bases, roster or stat list', () => {
  const bl = new Set([...kb.poe1_only_blacklist.all_currency, ...kb.poe1_only_blacklist.crafting_like]);
  for (const name of [...kb.currency_roster.Currency, ...kb.currency_roster.Omen]) assert.ok(!bl.has(name), name);
  for (const b of Object.keys(kb.bases)) { assert.ok(!bl.has(b), b); assert.ok(!b.includes('[DNT]'), b); }
  for (const m of Object.values(kb.mods)) assert.ok(!m.txt.includes('[DNT]'), m.txt);
  for (const s of kb.stat_index) assert.ok(!s.r.includes('[DNT]'), s.r);
  assert.ok(!Object.values(kb.bases).some((b) => b.cls === 'Claw'));
});

test('10.1 sceptre minion level: suffix, +1..+4 at 2/25/55/78', () => {
  const t = tiersOn('Rattling Sceptre', MINION_W);
  assert.deepEqual(t.map((x) => x.lvl), [78, 55, 25, 2]);
  assert.deepEqual(t.map((x) => x.txt), [4, 3, 2, 1].map((n) => `+${n} to Level of all Minion Skills`));
  assert.ok(t.every((x) => kb.mods[x.id].gen === 's'));
  // pools agree with the sw walk
  const pool = E.poolFor(ix, kb.bases['Rattling Sceptre'].sig);
  for (const x of t) assert.deepEqual(pool.get(x.id), { tier: x.tier, side: 'suffix' });
});

test('10.1 ilvl 75 sceptre: +4 shows "needs ilvl 78"', () => {
  const r = E.parseItem(ix, sample('rare-sceptre-adv').replace('Item Level: 82', 'Item Level: 75'));
  const opts = E.pickerOptions(ix, r.item, { side: 'suffix', showImpossible: false, exclude: 'GlobalMinionSpellSkillGemLevelWeapon3' });
  const fam = opts.find((o) => o.fam === MINION_W);
  const t1 = fam.tiers.find((t) => t.tier === 1);
  assert.equal(t1.ok, false);
  assert.equal(t1.reason, 'needs ilvl 78');
  assert.equal(fam.tiers.find((t) => t.tier === 2).ok, true);
});

test('10.1 helmet max +2, amulet +3 at 75, belt none naturally', () => {
  const helm = Object.keys(kb.bases).find((b) => kb.bases[b].cls === 'Helmet');
  const amu = Object.keys(kb.bases).find((b) => kb.bases[b].cls === 'Amulet');
  const belt = Object.keys(kb.bases).find((b) => kb.bases[b].cls === 'Belt');
  assert.deepEqual(tiersOn(helm, MINION).map((x) => x.lvl), [41, 5]);
  const a = tiersOn(amu, MINION);
  assert.equal(a[0].txt, '+3 to Level of all Minion Skills');
  assert.equal(a[0].lvl, 75);
  assert.equal(tiersOn(belt, MINION).length, 0);
  assert.equal(tiersOn(belt, MINION_W).length, 0);
});

test('10.1 Perfect Exalted (floor 50) removes +1/+2 minion level on sceptre', () => {
  const floor = kb.crafting_ops.find((o) => o.id === 'exalt').min_mod_level.Perfect;
  assert.equal(floor, 50);
  const r = E.applyFloor(tiersOn('Rattling Sceptre', MINION_W), floor, 82);
  assert.deepEqual(r.tiers.map((x) => x.txt), ['+4 to Level of all Minion Skills', '+3 to Level of all Minion Skills']);
  assert.equal(r.fallback, false);
});

test('floor that empties a family keeps the best legal tier and flags it', () => {
  const r = E.applyFloor(tiersOn('Rattling Sceptre', MINION_W), 70, 60); // ilvl 60: +3 legal, floor 70
  assert.deepEqual(r.tiers.map((x) => x.lvl), [55]);
  assert.equal(r.fallback, true);
});

// ------------------------------------------------------------------ 10.3 parser
test('10.3 advanced Rare sceptre -> ItemState', () => {
  const { item, warnings } = E.parseItem(ix, sample('rare-sceptre-adv'));
  assert.equal(item.base, 'Rattling Sceptre');
  assert.equal(item.itemClass, 'Sceptre');
  assert.equal(item.rarity, 'Rare');
  assert.equal(item.ilvl, 82);
  assert.equal(item.source, 'adv_copy');
  const minion = item.mods.find((m) => m.modId === 'GlobalMinionSpellSkillGemLevelWeapon3');
  assert.equal(minion.slot, 'suffix');
  assert.equal(minion.tier, 2);
  assert.deepEqual(minion.values, [3]);
  assert.ok(minion.confidence > 0.9);
  assert.equal(item.mods.filter((m) => m.slot === 'prefix').length, 2);
  assert.ok(!warnings.some((w) => w.level === 'error'));
});

test('10.3 Magic item via plain copy infers side and tier', () => {
  const { item } = E.parseItem(ix, sample('magic-helmet-plain'));
  assert.equal(item.rarity, 'Magic');
  assert.equal(item.source, 'ctrl_c');
  assert.equal(item.mods.length, 1);
  assert.equal(item.mods[0].slot, 'suffix');
  assert.equal(item.mods[0].tier, 1);
  assert.deepEqual(E.slotLimits(item), { prefix: 1, suffix: 1 });
});

test('10.3 fractured / desecrated / corrupted / unrevealed flags', () => {
  const boots = E.parseItem(ix, sample('rare-boots-fractured')).item;
  assert.ok(boots.mods.find((m) => /Movement Speed/.test(m.text)).fractured);
  const helm = E.parseItem(ix, sample('rare-helmet-desecrated')).item;
  const des = helm.mods.filter((m) => m.desecrated);
  assert.equal(des.length, 1);
  assert.equal(des[0].modId, 'AbyssModHelmAmanamuSuffixSpiritReservationEfficiency');
  const amu = E.parseItem(ix, sample('rare-amulet-corrupted')).item;
  assert.equal(amu.flags.corrupted, true);
  assert.equal(amu.implicits.length, 1);
  const ring = E.parseItem(ix, sample('unrevealed')).item;
  const u = ring.mods.find((m) => m.unrevealed);
  assert.ok(u && u.desecrated && u.slot === 'suffix');
});

test('10.3 plain copy: ambiguous side is flagged with candidates', () => {
  const { item, warnings } = E.parseItem(ix, sample('rare-amulet-plain'));
  const rar = item.mods.find((m) => /Rarity/.test(m.text));
  assert.equal(rar.ambiguous, true);
  assert.ok(new Set(rar.candidates.map((c) => c.side)).size === 2);
  assert.ok(warnings.some((w) => /candidates/.test(w.msg)));
  assert.ok(item.mods.find((m) => /Minion/.test(m.text)).fractured);
});

test('10.3 hybrid mod in plain copy is grouped into one mod', () => {
  const txt = ['Item Class: Boots', 'Rarity: Magic', 'Totemic Greaves', '--------', 'Item Level: 80', '--------',
    '40% increased Armour', '+120 to Stun Threshold'].join('\n');
  const { item } = E.parseItem(ix, txt);
  assert.equal(item.mods.length, 1);
  assert.equal(item.mods[0].fam, 'LocalArmourAndStunThreshold');
});

test('10.3 validation: impossible tier, too many mods, two crafted / desecrated', () => {
  let r = E.parseItem(ix, sample('rare-sceptre-adv').replace('Item Level: 82', 'Item Level: 60'));
  assert.ok(r.warnings.some((w) => w.level === 'error' && /mod level 70/.test(w.msg)));
  const magic = sample('rare-sceptre-adv').replace('Rarity: Rare', 'Rarity: Magic').replace('Doom Song\n', '');
  r = E.parseItem(ix, magic);
  assert.ok(r.warnings.some((w) => /at most 1 prefix/.test(w.msg)));
  const two = sample('rare-helmet-desecrated').replace('{ Suffix Modifier — Elemental, Fire, Resistance }\n+39(36-40)% to Fire Resistance',
    '{ Desecrated Suffix Modifier }\n(10-20)% increased Glory generation'.replace('(10-20)', '15(10-20)'));
  r = E.parseItem(ix, two);
  assert.ok(r.warnings.some((w) => /R_ONE_DESECRATED/.test(w.msg)));
});

test('10.3 amulet slot implicits change limits', () => {
  const txt = ['Item Class: Amulets', 'Rarity: Rare', 'X', 'Dusk Amulet', '--------', 'Item Level: 80', '--------',
    '+1 Prefix Modifier allowed (implicit)', '-1 Suffix Modifier allowed (implicit)', '--------', '+128 to maximum Life'].join('\n');
  const { item } = E.parseItem(ix, txt);
  assert.deepEqual(E.slotLimits(item), { prefix: 4, suffix: 2 });
});

test('10.3 garbage input returns a helpful error', () => {
  const r = E.parseItem(ix, 'hello world');
  assert.equal(r.item, null);
  assert.match(r.warnings[0].msg, /Rarity/);
});

// ------------------------------------------------------------------ picker
test('picker: fuzzy search finds stats by shorthand', () => {
  const { item } = E.parseItem(ix, sample('rare-helmet-desecrated'));
  const opts = E.pickerOptions(ix, item, { side: 'suffix', showImpossible: false, exclude: 'FireResist7' });
  assert.equal(E.searchOptions(opts, 'fire res')[0].label, '+#% to Fire Resistance');
  const { item: sc } = E.parseItem(ix, sample('rare-sceptre-adv'));
  const so = E.pickerOptions(ix, sc, { side: 'suffix', showImpossible: false, exclude: 'GlobalMinionSpellSkillGemLevelWeapon3' });
  assert.equal(E.searchOptions(so, 'minion lvl')[0].fam, MINION_W);
});

test('picker: group conflict and single desecrated slot are reported', () => {
  const { item } = E.parseItem(ix, sample('rare-helmet-desecrated'));
  const opts = E.pickerOptions(ix, item, { side: 'suffix', showImpossible: true });
  const fire = opts.find((o) => o.fam === 'FireResistance' && o.group === 'suffix');
  assert.ok(fire.tiers.every((t) => !t.ok));
  assert.ok(fire.tiers.some((t) => /conflicts with/.test(t.reason)));
  const desOpt = opts.find((o) => o.group === 'desecrated');
  assert.ok(desOpt.tiers.every((t) => !t.ok));
  assert.ok(opts.some((o) => o.reason === 'cannot roll on this base'));
});

test('template target resolves to the right side on sceptre', () => {
  const { item } = E.parseItem(ix, sample('rare-sceptre-adv'));
  assert.equal(E.resolveTemplateTarget(ix, item, '+# to Level of all Minion Skills').side, 'suffix');
  assert.equal(E.resolveTemplateTarget(ix, item, 'Minions have #% increased maximum Life').side, 'suffix');
});

// ------------------------------------------------------------------ 10.5 leak
test('10.5 leak filter catches PoE1 names and mechanics', () => {
  assert.ok(E.leakScan(ix, 'Önce Orb of Scouring kullan, sonra Chromatic Orb.').length >= 2);
  assert.ok(E.leakScan(ix, 'Chaos Orb tüm modları yeniden atar').some((h) => /reroll/.test(h.reason)));
  assert.ok(E.leakScan(ix, 'alt-regal ile başla').length);
  assert.ok(E.leakScan(ix, 'Use a Screaming Essence of Anger').length);
  assert.deepEqual(E.leakScan(ix, 'Omen of Dextral Exaltation + Greater Exalted Orb, sonra Chaos Orb ile 1 mod değiştir.'), []);
});

test('legacy mechanics are recognised', () => {
  assert.ok(E.legacyScan(ix, 'Omen of Homogenising Exaltation kullan').length);
});

test('10.5 explanation filter rejects PoE1 and unknown names, accepts PoE2 names', () => {
  assert.ok(E.explanationProblems(ix, 'Start with an Orb of Scouring, then slam.').length);
  assert.ok(E.explanationProblems(ix, 'Chaos Orb rerolls all modifiers on the item.').length);
  assert.ok(E.explanationProblems(ix, 'Use Omen of Fancy Slamming first.').length);
  assert.deepEqual(E.explanationProblems(ix, 'Activate Omen of Dextral Exaltation, then use a Greater Exalted Orb. If it misses, Omen of Dextral Erasure with a Perfect Chaos Orb clears one suffix. Divine Orb last.'), []);
});

test('picker lists class essences as selectable options with their essence names', () => {
  const { item } = E.parseItem(ix, sample('rare-sceptre-adv'));
  const essences = [{ item: 'Greater Essence of Command', mod: 'NearbyAlliesAllDamage6', gen: 'p', lvl: 60, perfect: false, alloy: false }];
  const opts = E.pickerOptions(ix, item, { side: 'prefix', showImpossible: false, essences });
  const ess = opts.find((o) => o.group === 'essence');
  assert.ok(ess && ess.ok);
  assert.equal(ess.tiers[0].via, 'Greater Essence of Command');
});

test('jewels: natural jewel mods resolve on Ruby and Diamond bases', () => {
  const txt = ['Item Class: Jewels', 'Rarity: Rare', 'Chimeric Spark', 'Ruby', '--------', 'Item Level: 80', '--------',
    '{ Prefix Modifier (Tier: 1) — Armour }', '15(10-20)% increased Armour',
    '{ Suffix Modifier }', '14(10-20)% increased Armour Break Duration'].join('\n');
  const { item, warnings } = E.parseItem(ix, txt);
  assert.equal(item.itemClass, 'Jewel');
  assert.equal(item.mods.length, 2);
  // the mods may come from the game data export (Jewel*) or from the poe2db augmentation (P2DB_*): either way in the pool
  assert.ok(item.mods.every((m) => m.modId && m.inPool), JSON.stringify(item.mods.map((m) => m.modId)));
  assert.ok(!warnings.some((w) => w.level === 'error'));
  const opts = E.pickerOptions(ix, item, { side: 'prefix', showImpossible: false });
  assert.ok(opts.length >= 10);
  assert.ok(kb.bases.Diamond && kb.pools[kb.bases.Diamond.sig].prefix.length > kb.pools[kb.bases.Ruby.sig].prefix.length);
  assert.ok(kb.bases['Time-Lost Ruby']);
});

test('Putrefaction: several desecrated mods on a corrupted item are allowed', () => {
  const lines = ['Item Class: Foci', 'Rarity: Rare', 'Vortex Barrier', 'Tasalian Focus', '--------', 'Item Level: 82', '--------',
    '{ Desecrated Prefix Modifier }', '+164(150-164) to maximum Mana',
    '{ Desecrated Suffix Modifier }', '+22(21-25)% to Cold Resistance', '--------', 'Corrupted'];
  const r = E.parseItem(ix, lines.join('\n'));
  assert.ok(!r.warnings.some((w) => /R_ONE_DESECRATED/.test(w.msg)));
  assert.ok(r.warnings.some((w) => /Putrefaction/.test(w.msg)));
  const nc = E.parseItem(ix, lines.slice(0, -2).join('\n'));
  assert.ok(nc.warnings.some((w) => /R_ONE_DESECRATED/.test(w.msg)));
});

test('flasks and charms: flask-domain mods, in-game class names, no gear mods', () => {
  const flask = E.parseItem(ix, SAMPLES.find((s) => s.id === 'magic-flask').text);
  assert.ok(!flask.item.unsupported);
  assert.equal(flask.item.itemClass, 'Life Flask');
  assert.deepEqual(flask.item.mods.map((m) => [m.slot, m.modId, m.tier, m.inPool]),
    [['prefix', 'FlaskIncreasedRecoveryOnLowLife4', 2, true], ['suffix', 'FlaskChargesAddedIncreasePercent6', 1, true]]);
  assert.deepEqual(flask.warnings, []);
  const charm = E.parseItem(ix, ['Item Class: Charms', 'Rarity: Magic', "Examiner's Thawing Charm", '--------', 'Item Level: 70', '--------', '28% increased Duration'].join('\n'));
  assert.equal(charm.item.itemClass, 'Charm');
  assert.equal(charm.item.mods[0].modId, 'CharmIncreasedDuration3');
  assert.ok(!charm.warnings.some((w) => /class/.test(w.msg)), 'the text class "Charms" matches the knowledge base');
  // pools keep the domains apart: flask mods never reach gear, gear mods never reach flasks
  const poolIds = (base) => [...E.poolFor(ix, kb.bases[base].sig).keys()];
  assert.ok(poolIds('Ultimate Life Flask').every((id) => kb.mods[id].dom === 'f'));
  assert.ok(poolIds('Rattling Sceptre').every((id) => kb.mods[id].dom !== 'f'));
  assert.equal(E.desecratedPoolFor(ix, 'Thawing Charm').size, 0);
  // a Rare flask is flagged by the single-source rule
  const rare = E.parseItem(ix, SAMPLES.find((s) => s.id === 'magic-flask').text.replace('Rarity: Magic', 'Rarity: Rare'));
  assert.ok(rare.warnings.some((w) => /R_FLASK_MAGIC/.test(w.msg)));
});
