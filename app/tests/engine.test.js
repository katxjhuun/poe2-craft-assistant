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

test('flasks and charms are marked not supported', () => {
  const r = E.parseItem(ix, ['Item Class: Charms', 'Rarity: Magic', 'Thawing Charm of the Owl', '--------', 'Item Level: 70', '--------', '+20 to Intelligence'].join('\n'));
  assert.ok(r.item && r.item.unsupported);
  assert.ok(!r.warnings.some((w) => w.level === 'error'));
});

test('a Rare jewel copy: usage text is not a mod, limits are 2 + 2, "+1 Prefix Modifier allowed" raises them', () => {
  const lines = ['Item Class: Jewels', 'Rarity: Rare', 'Gloom Spark', 'Ruby', '--------', 'Item Level: 82', '--------',
    '6% increased Area of Effect', '15% increased Attack Damage', '10% increased Bleeding Duration', '20% increased Flammability Magnitude', '--------',
    'Place into an allocated Jewel Socket on the Passive Skill Tree. Right click to remove from the Socket.'];
  const r = E.parseItem(ix, lines.join('\n'));
  assert.equal(r.item.mods.length, 4);
  assert.ok(!r.warnings.some((w) => /No knowledge base match/.test(w.msg)), JSON.stringify(r.warnings));
  assert.deepEqual(E.itemLimits(ix, r.item), { prefix: 2, suffix: 2 });
  // a crafted "+1 Prefix Modifier allowed" (Potent Liquid Contempt) lets a third prefix in
  const withCap = Object.assign({}, r.item, { mods: r.item.mods.concat([{ slot: 'suffix', text: '+1 Prefix Modifier allowed', modId: 'CraftedJewelAdditionalPrefixAllowed', crafted: true }]) });
  assert.deepEqual(E.itemLimits(ix, withCap), { prefix: 3, suffix: 2 });
});

test('real jewels with a "+1 Prefix/Suffix Modifier allowed" mod: 4 regular mods and the crafted one, tiers as the game shows', () => {
  const JEWELS = require('./fixtures/jewels.js');
  const want = { 'blight-joy': { prefix: 2, suffix: 3 }, 'loath-ornament': { prefix: 3, suffix: 2 } };
  for (const j of JEWELS) {
    const r = E.parseItem(ix, j.text);
    assert.equal(r.item.mods.length, 5, j.id);
    assert.ok(r.item.mods.every((m) => m.modId), j.id + ' every line matched');
    assert.equal(r.item.mods.filter((m) => m.crafted).length, 1, j.id);
    assert.deepEqual(E.itemLimits(ix, r.item), want[j.id], j.id);
    assert.ok(!r.warnings.some((w) => w.level !== 'info'), j.id + ' ' + JSON.stringify(r.warnings));
    for (const m of r.item.mods) if (!m.crafted) assert.equal(m.tier, 1, `${j.id}: ${m.text}`);
  }
  // different stats that share a mod group keep their own family (game mod type)
  const loath = E.parseItem(ix, JEWELS[1].text).item;
  const staff = loath.mods.find((m) => /Quarterstaves/.test(m.text));
  const mace = Object.entries(kb.mods).find(([, m]) => m.src === 'poe2db' && /Damage with Maces$/.test(m.txt));
  assert.ok(mace && kb.mods[staff.modId].fam !== mace[1].fam && kb.mods[staff.modId].grp.some((g) => mace[1].grp.includes(g)));
});

test('trade wands and staves from test t27 read cleanly; mods a base cannot roll are flagged, tiers match the game', () => {
  const ITEMS = require('./fixtures/spell-weapons.js');
  for (const it of ITEMS) {
    const r = E.parseItem(ix, it.text);
    assert.ok(r.item.mods.every((m) => m.modId), it.id + ' every line matched');
    assert.ok(!r.warnings.some((w) => w.level === 'error'), it.id + ' ' + JSON.stringify(r.warnings));
    for (const m of r.item.mods) if (m.gameTier) assert.equal(m.tier, m.gameTier, `${it.id}: ${m.text}`);
    // a Gelid Staff's own tags keep Fire spell modifiers off; the game shows those two lines without a tier
    const out = r.item.mods.filter((m) => !m.inPool && !m.desecrated && !m.crafted).map((m) => m.text);
    assert.deepEqual(out, it.id === 'mind-roar' ? ['95% increased Flammability Magnitude', '+7 to Level of all Fire Spell Skills'] : [], it.id);
  }
  assert.ok(kb.bases['Gelid Staff'].tags.includes('no_fire_spell_mods'));
  // the socketed Passion of Aldur rune explains those lines
  const mind = E.parseItem(ix, ITEMS.find((x) => x.id === 'mind-roar').text);
  assert.ok(mind.warnings.some((w) => /Passion of Aldur rune transformed it/.test(w.msg)), JSON.stringify(mind.warnings));
});


test('a pasted unique: its lines match the unique\'s known lines (kb.uniques) with their ranges, no "no match" warnings', () => {
  // a unique with only fixed, game-verified lines, on a base the knowledge base has
  const [name, u] = Object.entries(kb.uniques).find(([, x]) => x.cls === 'Ring' && x.trade_base && kb.bases[x.trade_base]
    && x.variants.length === 1 && x.variants[0].mods.length >= 3 && x.variants[0].mods.every((m) => m.verified && !m.txt.includes('\n')));
  const v = u.variants[0];
  const roll = (t) => t.replace(/\((-?[\d.]+)-(-?[\d.]+)\)/g, (_, a) => a);
  const text = [`Item Class: Rings`, 'Rarity: Unique', name, u.trade_base, '--------', 'Item Level: 80', '--------', ...v.mods.map((m) => roll(m.txt))].join('\n');
  const r = E.parseItem(ix, text);
  assert.equal(r.item.mods.length, v.mods.length, name);
  for (const m of r.item.mods) {
    assert.equal(m.slot, 'unique', name + ': ' + m.text);
    assert.ok(m.uniqueLine && m.fit !== false, name + ': ' + m.text);
  }
  assert.ok(!r.warnings.some((w) => /No knowledge base match/.test(w.msg)), JSON.stringify(r.warnings));
  assert.ok(r.warnings.some((w) => w.msg.startsWith(name + ':')));
  assert.ok(Object.keys(kb.uniques).length > 400);
});

test('a unique line with a range across zero: both "increased" and "reduced" rolls match it, any magnitude up to the end', () => {
  const u = kb.uniques["Ventor's Gamble"];
  assert.ok(u && u.variants[0].mods.some((m) => /^\(-25-25\)% reduced Rarity of Items found$/.test(m.txt) && m.verified));
  const base = u.trade_base || u.variants[0].base;
  const parse = (line) => E.parseItem(ix, ['Item Class: Rings', 'Rarity: Unique', "Ventor's Gamble", base, '--------', 'Item Level: 80', '--------', line].join('\n'));
  for (const line of ['12% increased Rarity of Items found', '7% reduced Rarity of Items found']) {
    const r = parse(line);
    assert.equal(r.item.mods.length, 1, line);
    assert.equal(r.item.mods[0].slot, 'unique', line);
    assert.equal(r.item.mods[0].fit, true, line);
  }
  assert.equal(parse('30% increased Rarity of Items found').item.mods[0].fit, false, 'above the range');
});
