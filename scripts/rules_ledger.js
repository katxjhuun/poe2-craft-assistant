/* Rules ledger: every crafting rule the assistant goes by, with its status, in one file (reports/rules-ledger.md).
 * Agreed with the player on 12 Nov 2026: no simulation runs on a scenario that touches a rule marked "unknown"; the
 * questions in the ledger's last section are asked at the start of the work, in one message, not during a run.
 *
 *   node scripts/rules_ledger.js            write reports/rules-ledger.md from the knowledge base in use
 *   POE2_KB=path node scripts/rules_ledger.js   from a candidate knowledge base
 *
 * It also writes app/data/rules_ledger.json: every rule's status and hash (app/gate.js ruleHash) and the ledger's
 * hash, which every gate result carries as its stamp (a rule change reruns only the routes that use that rule).
 *
 * Sources: kb.crafting_rules, kb.crafting_ops, kb.legacy_or_disabled, the recipe library's claims and in-game tests,
 * the engine's own assumptions (ASSUMPTIONS below, each found in the code by a search string) and the 1.0 rules
 * (V1 below, from reports/poe2-1.0-crafting-2026-11-09.md).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const kb = require(process.env.POE2_KB || path.join(ROOT, 'poe2_kb_0.5.5.json'));
const lib = require(path.join(ROOT, 'app', 'data', 'recipes_0.5.5.json'));

const STATUS = { verified: 'verified', strong: 'strong', weak: 'weak', unknown: 'unknown', refuted: 'refuted' };
const fromConf = (c) => ({ game_text: 'verified', game_data: 'verified', patch_note_quote: 'strong', multi_secondary: 'strong', single_secondary: 'weak' }[c] || 'unknown');
const fromVerdict = (v) => ({ verified: 'verified', plausible: 'weak', rejected: 'refuted', outdated: 'refuted' }[v] || 'unknown');
const fromTest = (s) => ({ confirmed: 'verified', refuted: 'refuted' }[s] || 'unknown');

/** What the engine takes for granted where the game says nothing; `find` locates it in the code. */
const ASSUMPTIONS = [
  { id: 'A_FLUX_TIER', file: 'app/planner.js', find: '"equivalent" is taken as the same tier number', rule: 'Flux: an "equivalent" resistance modifier is the same tier number of the new element.', status: 'strong' },
  { id: 'A_DESECRATE_SIDE', file: 'app/planner.js', find: 'does not say which side loses the mod', rule: 'Desecrating a full item: the removed modifier is from a side that can hold the desecrated one.', status: 'weak' },
  { id: 'A_ESSENCE_EVEN', file: 'app/planner.js', find: 'or evenly when the table has', rule: 'An essence with several outcomes and no weights in the files gives each of them equally often.', status: 'weak' },
  { id: 'A_ENCHANT_EVEN', file: 'app/planner.js', find: 'evenly (no weights are published)', rule: 'Corruption Enchantments: each one the base can take is equally likely.', status: 'weak' },
  { id: 'A_SANCTIFY_EVEN', file: 'app/planner.js', find: 'game publishes no weights, so evenly', rule: 'Omen of Sanctification: each value is multiplied by 78% to 122%, every factor equally likely.', status: 'weak' },
  { id: 'A_DES_WEIGHTS', file: 'app/planner.js', find: 'desecrated-only ones evenly', rule: 'Desecrated-only modifiers at the Well of Souls are equally likely (Craft of Exile gives them weight 1).', status: 'weak' },
  { id: 'A_WEIGHTS', file: 'app/planner.js', find: 'weightOf', rule: 'Roll chances come from poe2db weights (the client data has only 0/1); Craft of Exile agrees on 8,929 of 8,987 tiers.', status: 'strong' },
  { id: 'A_CATALYST_RING', file: 'app/planner.js', find: 'Which catalysts it takes is in-game test t29', rule: 'A base that says "Catalysts can be applied" takes the ring and amulet catalysts, with the same rules as on rings and amulets.', status: 'verified', source: 'in-game test t29; the player (12 Nov 2026)' },
  { id: 'A_RUNE_POOL_WELL', file: 'app/planner.js', find: 'in-game test t33', rule: 'The Well of Souls does not offer a socketed rune\'s pool: no plan counts on it.', status: 'refuted', source: 'the player (12 Nov 2026): it does offer it (t33)' },
  { id: 'A_RUNE_POOL_WEIGHT', file: 'app/planner.js', find: 'in-game test t33', rule: 'How often the Well of Souls offers a socketed rune\'s pool modifiers against the item\'s own. Not modelled: a route with a bone step on an item with a pool rune is not offered as a recommendation.', status: 'unknown' },
];

/** PoE2 1.0, before the patch notes (reports/poe2-1.0-crafting-2026-11-09.md). */
const V1 = [
  { id: 'V1_FORGEMARK', rule: 'Crimson Iron / Scarlet Hide / Vermilion Gold: a Forgemark in place of a chosen modifier on a Rare weapon or quiver / armour or belt / amulet or ring, item level 64 or lower.', status: 'verified', source: 'poe2db item text (datamined)' },
  { id: 'V1_BLOODMARK', rule: 'Bloodvial of Komaki / Eldra / Rithva: a Bloodmark in place of a chosen suffix, same three groups, Minimum Modifier Level 65.', status: 'verified', source: 'poe2db item text (datamined)' },
  { id: 'V1_REFORGE', rule: 'Reforging turns every marked modifier into a new random one, fractured at once.', status: 'strong', source: 'Maxroll, Game8, poe2db news' },
  { id: 'V1_NO_REMARK', rule: 'A fractured item cannot be marked again.', status: 'strong', source: 'Maxroll' },
  { id: 'V1_TWO_FRACTURED', rule: 'An item can have up to two fractured modifiers.', status: 'weak', source: 'Game8 only' },
  { id: 'V1_FORGE_SIDE', rule: 'A Forgemark\'s new modifier is of the marked one\'s side.', status: 'unknown', source: 'engine assumption' },
  { id: 'V1_BLOOD_GROUPS', rule: 'Which modifiers the Komaki, Eldra and Rithva groups hold (the engine draws from every suffix of level 65+).', status: 'unknown', source: 'not datamined yet' },
  { id: 'V1_MIX', rule: 'Forgemarks and Bloodmarks can be on one item and reforged together.', status: 'unknown', source: 'engine assumption' },
  { id: 'V1_FRACTURE_ORB', rule: 'The Fracturing Orb still needs four modifiers and works next to Forgemarks.', status: 'unknown', source: 'patch notes ~4 Dec' },
  { id: 'V1_EXISTING', rule: 'Existing currencies, omens, essences, bones, runes, affix limits and the crafted-modifier limit are unchanged in 1.0.', status: 'unknown', source: 'patch notes ~4 Dec' },
  { id: 'V1_SWORDS', rule: 'Swords and daggers are real item classes (the KB marks swords unconfirmed_class).', status: 'strong', source: 'Maxroll (Duelist, Shadow), poe2db uniques' },
];

function lineOf(file, find) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(find));
  return i < 0 ? null : i + 1;
}
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\n+/g, ' ').trim();
const short = (s, n) => { s = cell(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const rows = [];   // { section, id, rule, status, source }
for (const r of kb.crafting_rules || []) rows.push({ section: 'Rules', id: r.id, rule: r.rule, status: fromConf(r.conf), source: r.source });
for (const o of kb.crafting_ops || []) {
  const floor = o.min_mod_level ? ` Floors: ${Object.entries(o.min_mod_level).map(([k, v]) => `${k} ${v}`).join(', ')} (${o.floor_conf || '?'}).` : '';
  rows.push({ section: 'Operators', id: o.id, rule: `${(o.names || []).join(', ')}: ${o.effect}.${floor}`, status: fromConf(o.conf), source: o.floor_source || 'game text' });
}
for (const l of kb.legacy_or_disabled || []) rows.push({ section: 'Not in the game', id: l.name, rule: l.status, status: fromConf(l.conf), source: l.source });
for (const t of lib.tests || []) rows.push({ section: 'In-game tests', id: t.id, rule: t.question + (t.note ? ` (${t.note})` : ''), status: fromTest(t.status), source: (t.claims || []).join(', ') });
for (const c of lib.claims || []) if (c.verdict !== 'rejected') rows.push({ section: 'Claims', id: c.id, rule: c.claim, status: fromVerdict(c.verdict), source: c.source ? [c.source.author, c.source.tier].filter(Boolean).join(', ') : c.reason });
for (const a of ASSUMPTIONS) {
  const ln = lineOf(a.file, a.find);
  rows.push({ section: 'Engine assumptions', id: a.id, rule: a.rule, status: a.status, source: (ln ? `${a.file}:${ln}` : `${a.file} (not found: "${a.find}")`) + (a.source ? `; ${a.source}` : '') });
}
for (const v of V1) rows.push({ section: 'PoE2 1.0', id: v.id, rule: v.rule, status: v.status, source: v.source });

const order = ['Rules', 'Operators', 'Not in the game', 'In-game tests', 'Claims', 'Engine assumptions', 'PoE2 1.0'];
const statuses = ['verified', 'strong', 'weak', 'unknown', 'refuted'];
const out = [];
out.push('# Rules ledger');
out.push('');
out.push(`Generated by \`node scripts/rules_ledger.js\` from \`${path.basename(process.env.POE2_KB || 'poe2_kb_0.5.5.json')}\` (game data ${kb.meta.game_data_version}) and the recipe library. Do not edit by hand: change the source and run it again.`);
out.push('');
out.push('**Status:** verified = game text, game data or an in-game test; strong = several independent sources; weak = one source or a plausible claim; unknown = nobody knows yet; refuted = tested or shown wrong (kept so nobody brings it back).');
out.push('');
out.push('**Working rule (12 Nov 2026):** a simulation or sweep does not run on a scenario that uses an `unknown` rule. The questions at the end are asked at the start of a piece of work, in one message.');
out.push('');
out.push('| Section | ' + statuses.join(' | ') + ' |');
out.push('|---|' + statuses.map(() => '---').join('|') + '|');
for (const s of order) out.push(`| ${s} | ` + statuses.map((st) => rows.filter((r) => r.section === s && r.status === st).length || '').join(' | ') + ' |');
out.push('');
const rejected = (lib.claims || []).filter((c) => c.verdict === 'rejected').length;
for (const s of order) {
  out.push(`## ${s}`);
  out.push('');
  if (s === 'Claims') { out.push(`(${rejected} rejected claims, PoE1 rules and myths, are in app/data/recipes_0.5.5.json and not listed.)`); out.push(''); }
  out.push('| Id | Rule | Status | Source |');
  out.push('|---|---|---|---|');
  for (const r of rows.filter((x) => x.section === s)) out.push(`| ${cell(r.id)} | ${short(r.rule, 260)} | ${r.status} | ${short(r.source, 120)} |`);
  out.push('');
}
out.push('## Open questions');
out.push('');
out.push('Everything `unknown` or `weak`, to ask before the work that needs it. A question answered in game becomes an in-game test (verified or refuted); one answered by a source moves the rule to strong.');
out.push('');
for (const st of ['unknown', 'weak']) {
  out.push(`### ${st}`);
  out.push('');
  for (const r of rows.filter((x) => x.status === st)) out.push(`- **${cell(r.id)}** (${r.section}): ${short(r.rule, 220)}`);
  out.push('');
}
// the machine-readable ledger for the gate (scripts/gate.js, the page)
const G = require(path.join(ROOT, 'app', 'gate.js'));
const json = { meta: { made: 'node scripts/rules_ledger.js', kb: path.basename(process.env.POE2_KB || 'poe2_kb_0.5.5.json'), game_data: kb.meta.game_data_version }, hash: null, rules: {} };
for (const r of rows) {
  const id = cell(r.id);
  if (json.rules[id]) throw new Error('two rules with the id ' + id);
  json.rules[id] = { status: r.status, section: r.section, hash: G.ruleHash({ id, status: r.status, rule: cell(r.rule) }), rule: short(r.rule, 260) };
}
json.hash = G.hash(Object.keys(json.rules).sort().map((id) => id + ':' + json.rules[id].hash).join(','));
fs.writeFileSync(path.join(ROOT, 'app', 'data', 'rules_ledger.json'), JSON.stringify(json, null, 1) + '\n');
out.splice(3, 0, '', `Ledger hash: \`${json.hash}\` (app/data/rules_ledger.json: every rule's hash; the gate's results carry them).`);
const file = path.join(ROOT, 'reports', 'rules-ledger.md');
fs.writeFileSync(file, out.join('\n'));
console.log(`${file}: ${rows.length} rules; ` + statuses.map((st) => `${st} ${rows.filter((r) => r.status === st).length}`).join(', '));
for (const r of rows) if (/not found:/.test(r.source)) console.log(`  missing in code: ${r.id}`);
