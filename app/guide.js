/* PoE2 Craft Assistant — guide analysis and recipe library (F4).
 * Deterministic checks of crafting claims against the knowledge base, the 0.5 rules and the claim log.
 * A language model may split a guide into claims, but every verdict here comes from these rules.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.PoE2Guide = factory(root.PoE2Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const ORDER = { rejected: 0, outdated: 1, plausible: 2, verified: 3 };

  /** Rule checks: [pattern, verdict, reason]. English and Turkish phrasings. */
  const RULES = [
    [/chaos orb[^.]{0,80}\b(all|every|whole|entire)\b[^.]{0,30}\b(mods?|modifiers?|affixes|item)|chaos orb[^.]{0,40}reroll|chaos orb[^.]{0,60}tüm mod|tüm modları[^.]{0,40}chaos orb/i, 'rejected', 'Chaos Orb removes one random modifier and adds one; it never rerolls the whole item (PoE2 game text).'],
    [/\b(two|2|second|multiple|several|both|double)\b[^.]{0,20}\b(crafted (mods?|modifiers?)|(perfect )?essences?)\b|\bchain(ed)? essences?\b|iki(nci)? crafted/i, 'rejected', 'Items hold at most one crafted modifier since 0.5 (official patch note).'],
    [/\b(two|2|second|multiple|several|six|6)\b[^.]{0,20}\bdesecrated (mods?|modifiers?)|iki(nci)? desecrated/i, 'rejected', 'Items hold at most one Desecrated modifier since 0.5 (official patch note).'],
    [/\bmagic items?\b[^.]{0,40}\b(three|3|four|4|five|5|six|6)\b[^.]{0,15}\b(mods?|modifiers?|affixes)/i, 'rejected', 'Magic items hold at most one prefix and one suffix.'],
    [/\b(orb of )?alchemy\b[^.]{0,40}\bonly\b[^.]{0,20}\bnormal\b/i, 'rejected', 'Game text: Orb of Alchemy works on Normal or Magic items.'],
    [/greater exalt\w*[^.]{0,40}\b(item level|ilvl)\b/i, 'rejected', 'The Greater Exalted floor (35) is a minimum modifier level, not an item level requirement.'],
    [/gnawed[^.]{0,40}\bmod(ifier)? level\b[^.]{0,10}64/i, 'rejected', 'Gnawed bones require item level 64 or lower; they do not cap mod level.'],
    [/whittling[^.]{0,60}\b(lowest|worst) tier\b/i, 'rejected', 'Game text: Omen of Whittling removes the lowest level modifier, not the lowest tier.'],
    [/catalysts?[^.]{0,40}\b(drop|drops|dropped)\b[^.]{0,30}\b(monsters?|breach)\b/i, 'outdated', 'Since 0.5.0 catalysts come only from the Genesis Tree.'],
    [/recombinator|omen of recombination/i, 'outdated', 'The Recombinator was disabled in 0.5.0 and not reopened in 0.5.5.'],
    [/artificer'?s orb[^.]{0,60}\b(any|all|every)\b[^.]{0,20}\b(equipment|item|gear|jewell?ery)/i, 'rejected', "Game text: Artificer's Orb works on martial weapons, wands, staves and armour only."],
    [/\balloys?\b[^.]{0,60}\b(forbidden rites)\b/i, 'rejected', 'Runic Alloys are exclusive to Runes of Aldur (poe2wiki); medium confidence.'],
    [/sanctif\w*[^.]{0,60}\b(reroll|re-roll|randomi[sz]e)s?\b[^.]{0,20}\bvalues?\b/i, 'rejected', 'Since 0.5 Sanctify multiplies the current values instead of randomising them.'],
    [/\b(sword|axe|dagger|flail)s?\b[^.]{0,40}\b(drop|drops|available)\b[^.]{0,30}0\.5\.5/i, 'rejected', 'Swords, axes and daggers are not intended to drop in 0.5.5; they are expected with 1.0.'],
    [/omen of corruption/i, 'outdated', 'Omen of Corruption cannot be obtained since 0.5.0.'],
    [/homogenis/i, 'outdated', 'Homogenising omens stopped dropping in 0.4; only old Standard copies exist.'],
    [/\bentities\b/i, 'rejected', 'There is no Entities system in PoE2.'],
  ];

  const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'on', 'in', 'is', 'it', 'its', 'for', 'with', 'your', 'you', 'can', 'be', 'are', 'that', 'this', 'by', 'from', 'only', 'use', 'then', 'will', 'into', 'at', 'as', 'item', 'items']);
  function tokens(s) {
    return new Set(String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  }
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let n = 0;
    for (const w of A) if (B.has(w)) n++;
    return n / (A.size + B.size - n);
  }

  /** Split guide text into claim-sized sentences (fallback when no language model is used). */
  function splitClaims(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
      .map((s) => s.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
      .filter((s) => s.length >= 12 && /[A-Za-z]/.test(s));
  }

  function patchOf(text) {
    const m = String(text).match(/\b(?:patch|version|v)?\s*(0\.\d)(?:\.\d+)?\b/i);
    return m ? parseFloat(m[1]) : null;
  }

  /**
   * Check one claim. lib = recipes JSON ({claims}). opts = { guidePatch }.
   * Returns { claim, verdict, reasons: [], match: claimLogEntry|null }.
   */
  function checkClaim(ix, claim, lib, opts) {
    opts = opts || {};
    const reasons = [];
    let verdict = null;
    const worse = (v) => { if (verdict == null || ORDER[v] < ORDER[verdict]) verdict = v; };

    // 1. PoE1 names and mechanics
    const leaks = E.leakScan(ix, claim);
    for (const l of leaks) { reasons.push(`${l.match}: ${l.reason}`); worse('rejected'); }
    // 2. names that are not PoE2 currency (only when they look like currency)
    const unknown = E.explanationProblems(ix, claim).filter((p) => /not in PoE2 data/.test(p));
    for (const u of unknown) { reasons.push(`Unknown name: ${u.replace(' (not in PoE2 data)', '')}. Not a PoE2 currency or omen.`); worse('rejected'); }
    // 3. legacy mechanics
    for (const l of E.legacyScan(ix, claim)) { reasons.push(`${l.name}: ${l.status}.`); worse('outdated'); }
    // 4. rule patterns
    for (const [re, v, why] of RULES) {
      if (!re.test(claim)) continue;
      if (/desecrated/i.test(why) && /putrefaction/i.test(claim)) continue; // Putrefaction items are the exception
      reasons.push(why); worse(v);
    }
    // 5. version
    const p = patchOf(claim) || opts.guidePatch || null;
    if (p != null && p < 0.5) { reasons.push(`Written for patch ${p}; before the 0.5 crafted/desecrated rules.`); worse('outdated'); }
    // 6. claim log
    let match = null, best = 0;
    for (const c of (lib && lib.claims) || []) {
      const s = similarity(claim, c.claim);
      if (s > best) { best = s; match = c; }
    }
    if (best < 0.45) match = null;
    if (match) {
      reasons.push(match.source ? `Logged before from ${sourceLabel(match.source)} as ${match.verdict}.` : `Claim log ${match.id}: ${match.reason}`);
      if (verdict == null || ORDER[match.verdict] < ORDER[verdict]) verdict = match.verdict;
    }
    // 7. numbers: the simulator's own estimate when the page can compute one (opts.math), never a verdict upgrade
    const pctClaim = /\b\d+(?:\.\d+)?\s*%/.test(claim) && /\b(chance|odds|probability|success|hits?)\b/i.test(claim);
    if (pctClaim && !(match && match.verdict === 'verified')) {
      const m = opts.math ? opts.math(claim) : null;
      if (m) reasons.push(m.text);
      reasons.push('Percentages are estimates: the game publishes no roll weights.' + (m ? '' : ' Check against the planner.'));
      worse('plausible');
    }
    // 8. independent confirmation: this guide and logged claims from other A/B sources that say the same
    let sources = [];
    if (verdict == null || verdict === 'plausible' || verdict === 'verified') {
      const srcs = new Map();
      const add = (src) => { const k = sourceKey(src); if (k && /^[AB]$/.test(src.tier || '')) srcs.set(k, src); };
      add(opts.source);
      for (const c of (lib && lib.claims) || []) {
        if (!c.source || c.verdict === 'rejected' || c.verdict === 'outdated') continue;
        if (similarity(claim, c.claim) >= 0.45) add(c.source);
      }
      sources = [...srcs.values()];
      if (sources.length >= 2 && !pctClaim && verdict !== 'verified') {
        verdict = 'verified';
        reasons.push(`Said by ${sources.length} independent A/B sources: ${sources.map(sourceLabel).join('; ')}.`);
      }
    }
    if (verdict == null) {
      verdict = 'plausible';
      reasons.push('No rule or logged claim confirms or contradicts this. Needs a second independent source or an in-game test.');
    }
    return { claim, verdict, reasons, match: match ? match.id : null, sources: sources.length };
  }

  // ---------------------------------------------------------------- sources (master prompt 9.1)
  const TIER_HOSTS = [
    [/(^|\.)pathofexile\.com$/, 'A'],
    [/(^|\.)(poe2db\.tw|poe2wiki\.net|poewiki\.net|craftofexile\.com|maxroll\.gg|mobalytics\.gg)$/, 'B'],
    [/(^|\.)(reddit\.com|steamcommunity\.com|youtube\.com|youtu\.be|twitch\.tv|discord\.(gg|com)|forum\.pathofexile\.com)$/, 'C'],
  ];
  function hostOf(url) {
    const m = String(url || '').trim().match(/^(?:https?:\/\/)?([^/?#\s]+)/i);
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  }
  /** Source tier from the address: A official, B databases and signed guides, C community, D anything else (a hint only). */
  function sourceTier(url) {
    const h = hostOf(url);
    if (!h) return null;
    // Forum threads can be patch notes (A) or player posts (C): the conservative guess is C; the page lets the player change it.
    if (/^(forum\.)?pathofexile\.com$/.test(h) && /pathofexile\.com\/forum|^forum\./i.test(String(url).replace(/^https?:\/\/(www\.)?/i, ''))) return 'C';
    for (const [re, t] of TIER_HOSTS) if (re.test(h)) return t;
    return 'D';
  }
  /** Two sources are independent when the author differs (or, without an author, the page). */
  function sourceKey(src) {
    if (!src) return '';
    const a = String(src.author || '').trim().toLowerCase();
    if (a) return 'a:' + a;
    const u = String(src.url || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
    return u ? 'u:' + u : '';
  }
  function sourceLabel(src) {
    return [src.author, hostOf(src.url), src.date].filter(Boolean).join(', ') + ` (${src.tier})`;
  }

  /**
   * Claim log entries for the checked results of one guide (9.2 step 5): every claim with its verdict and reasons,
   * rejected ones included as the archive. source = {url, author, date, tier, patch}.
   */
  function logEntries(results, source) {
    return results.map((r) => ({
      claim: r.claim, verdict: r.verdict, reason: r.reasons.join(' '), source: Object.assign({}, source), match: r.match || null,
    }));
  }

  /** Check a whole guide. claims: optional pre-split list (e.g. from a language model). */
  function checkGuide(ix, text, lib, opts) {
    opts = opts || {};
    const guidePatch = opts.guidePatch != null ? opts.guidePatch : null;
    const list = opts.claims && opts.claims.length ? opts.claims : splitClaims(text);
    const results = list.map((c) => checkClaim(ix, c, lib, { guidePatch, source: opts.source, math: opts.math }));
    const summary = { verified: 0, plausible: 0, outdated: 0, rejected: 0 };
    for (const r of results) summary[r.verdict]++;
    return { results, summary };
  }

  /** Recipes for an item class and league, best verdicts and matching leagues first. */
  function recipesFor(lib, itemClass, league) {
    const rs = ((lib && lib.recipes) || []).filter((r) => r.classes.includes('*') || r.classes.includes(itemClass));
    return rs.map((r) => Object.assign({}, r, { inLeague: !r.league_scope.length ? false : r.league_scope.includes(league) }))
      .sort((a, b) => (!!b.user - !!a.user) || (b.inLeague - a.inLeague) || (ORDER[b.verdict] - ORDER[a.verdict]) || (b.classes.includes('*') ? -1 : 0) - (a.classes.includes('*') ? -1 : 0));
  }

  /**
   * Apply in-game test results to the claim log. A test lists the claims it settles: "k26" agrees with the
   * question, "!k27" says the opposite. confirmed -> agreeing claims become verified, opposite ones rejected;
   * refuted -> the other way round. results: {testId: {status: 'open'|'confirmed'|'refuted', note, at}};
   * tests may carry a preset status (already settled). Returns a copy of the library.
   */
  function effectiveLibrary(lib, results) {
    const out = Object.assign({}, lib, { claims: (lib.claims || []).map((c) => Object.assign({}, c)) });
    const byId = new Map(out.claims.map((c) => [c.id, c]));
    for (const t of lib.tests || []) {
      const r = (results && results[t.id]) || (t.status ? { status: t.status, note: t.note } : null);
      if (!r || !r.status || r.status === 'open') continue;
      for (const ref of t.claims || []) {
        const neg = ref.startsWith('!');
        const c = byId.get(neg ? ref.slice(1) : ref);
        if (!c) continue;
        const holds = (r.status === 'confirmed') !== neg;
        c.verdict = holds ? 'verified' : 'rejected';
        c.reason = `In-game test ${t.id} (${r.status}${r.note ? ': ' + r.note : ''}). Earlier note: ${c.reason}`;
        c.tested = true;
      }
    }
    return out;
  }

  const RULE_LEAGUES = ['Forbidden Rites', 'Runes of Aldur', 'Standard'];
  /**
   * The league whose rules and mechanics a league follows (8.1): the player's choice for that name (mine:
   * [{name, rules}]), else read from the name, since HC and SSF copies follow their parent league; the permanent
   * Hardcore and SSF leagues follow Standard. Null for a private league whose name does not say it.
   */
  function leagueRules(name, mine) {
    const own = (mine || []).find((l) => l && l.name === name);
    if (own && RULE_LEAGUES.includes(own.rules)) return own.rules;
    const n = String(name || '').toLowerCase().trim();
    if (['hardcore', 'solo self-found', 'hardcore ssf', 'hardcore solo self-found', 'ssf', 'hc ssf'].includes(n)) return 'Standard';
    return RULE_LEAGUES.find((r) => n.includes(r.toLowerCase())) || null;
  }

  /** Is dotted version a newer than b ("4.5.10.0" > "4.5.9.3")? */
  function newerVersion(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }
  const RELEASE_1_0 = Date.parse('2026-12-11T00:00:00Z');
  /**
   * The "data may be outdated" notice (master prompt 3.4), or '' when none applies. kbMeta: the knowledge base's meta;
   * gameData: {version} of the newest RePoE PoE2 export, which the price job records (null when unknown). A newer
   * version means a patch changed the game files; without that record the notice starts on PoE2 1.0's planned date.
   */
  function staleNotice(kbMeta, gameData, now) {
    if (!kbMeta) return '';
    const have = kbMeta.game_data_version;
    const patch = String(kbMeta.patch || '').split(' ')[0] || '?';
    const next = gameData && /^\d+(\.\d+)+$/.test(gameData.version || '') ? gameData.version : null;
    if (have && next && newerVersion(next, have)) {
      return `New game data is out (version ${next}; this knowledge base uses ${have}, patch ${patch}). Tiers and rules may be outdated until it is rebuilt.`;
    }
    if (+(now || new Date()) >= RELEASE_1_0 && /^0\./.test(patch)) {
      return `PoE2 1.0 was due on 11 December 2026. This knowledge base is patch ${patch} data; tiers and rules may be outdated until it is rebuilt.`;
    }
    return '';
  }

  return { RULES, RULE_LEAGUES, splitClaims, checkClaim, checkGuide, recipesFor, similarity, patchOf, effectiveLibrary, sourceTier, sourceKey, sourceLabel, hostOf, logEntries, leagueRules,
    newerVersion, staleNotice };
});
