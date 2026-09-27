/* PoE2 Craft Assistant — deterministic engine (F1).
 * Pure functions over poe2_kb_0.5.5.json: text normalisation, item parsing
 * (Alt+Ctrl+C advanced copy and plain Ctrl+C), mod matching, per-base tiers,
 * eligibility, validation, stat search and the PoE1 leak filter.
 * Runs in the browser (window.PoE2Engine) and in Node (module.exports) for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PoE2Engine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NUM = String.raw`-?\d+(?:\.\d+)?`;
  const RE_ADV_RANGE = new RegExp(`(${NUM})\\((${NUM})-(${NUM})\\)`, 'g'); // 45(40-49)
  const RE_TPL_RANGE = new RegExp(`\\((${NUM})-(${NUM})\\)`, 'g');          // (40-49)
  const RE_MARKER = /\s*\((fractured|crafted|desecrated|implicit|rune|enchant|augmented|unmet)\)\s*$/i;

  // ---------------------------------------------------------------- text

  /** Strip copy markers and the advanced "45(40-49)" range, keep the rolled value. */
  function cleanLine(s) {
    return String(s).replace(RE_MARKER, '').replace(RE_ADV_RANGE, '$1').trim();
  }

  /** Canonical matching key: every number or range becomes '#', sign dropped, lower case. */
  function normalize(s) {
    return cleanLine(s)
      .replace(RE_TPL_RANGE, '#')
      .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
      .replace(/[+-]#/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** Display template for a picker: "+(41-45)% to Fire Resistance" -> "+#% to Fire Resistance". */
  function template(txt) {
    return String(txt).replace(RE_TPL_RANGE, '#').replace(/\d+(?:\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
  }

  /** Numeric slots of a KB mod line: "(10-19) to (20-30)" -> [[10,19],[20,30]]; fixed "3" -> [3,3]. */
  function templateRanges(txtLine) {
    const out = [];
    const re = new RegExp(`\\((${NUM})-(${NUM})\\)|(${NUM})`, 'g');
    let m;
    while ((m = re.exec(txtLine))) {
      if (m[1] !== undefined) out.push([+m[1], +m[2]]);
      else out.push([+m[3], +m[3]]);
    }
    return out;
  }

  /** Rolled numbers on an item line, in order. Leading '+' is dropped, '-' kept. */
  function lineValues(line) {
    const s = cleanLine(line);
    const out = [];
    const re = new RegExp(NUM, 'g');
    let m;
    while ((m = re.exec(s))) out.push(+m[0]);
    return out;
  }

  function valuesFit(values, ranges) {
    if (values.length !== ranges.length) return null; // cannot judge
    for (let i = 0; i < values.length; i++) {
      const lo = Math.min(ranges[i][0], ranges[i][1]);
      const hi = Math.max(ranges[i][0], ranges[i][1]);
      const v = Math.abs(values[i]);
      const alo = Math.min(Math.abs(lo), Math.abs(hi));
      const ahi = Math.max(Math.abs(lo), Math.abs(hi));
      // Compare on magnitude: "reduced" lines show a positive number for a negative stat.
      if (v < alo - 1e-6 || v > ahi + 1e-6) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- index

  function buildIndex(kb) {
    const lineIndex = new Map(); // normalized line -> [{id, li, n}]
    const famMods = new Map();   // fam -> [modId]
    const corruptionMods = [];   // Corruption Enhancements (dom 'c'): implicits a Vaal Orb can add, not affixes
    for (const [id, m] of Object.entries(kb.mods)) {
      if (m.dom === 'c') { corruptionMods.push(id); continue; }
      if (!famMods.has(m.fam)) famMods.set(m.fam, []);
      famMods.get(m.fam).push(id);
      if (!m.txt) continue;
      const lines = m.txt.split('\n');
      lines.forEach((ln, li) => {
        const key = normalize(ln);
        if (!lineIndex.has(key)) lineIndex.set(key, []);
        lineIndex.get(key).push({ id, li, n: lines.length });
      });
    }
    const bl = kb.poe1_only_blacklist || {};
    const blNames = [...new Set([...(bl.all_currency || []), ...(bl.crafting_like || [])])]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const baseNames = Object.keys(kb.bases).sort((a, b) => b.length - a.length);
    const statByNorm = new Map();
    for (const s of kb.stat_index || []) for (const p of s.m || [s.r]) statByNorm.set(normalize(p), s);
    return {
      kb, lineIndex, famMods, blNames, baseNames, statByNorm, corruptionMods,
      _pool: new Map(), _desPool: new Map(), _opts: new Map(),
    };
  }

  /** Per-base pool: modId -> {tier, side} for natural mods (precomputed in kb.pools). */
  function poolFor(ix, sig) {
    if (ix._pool.has(sig)) return ix._pool.get(sig);
    const p = ix.kb.pools[sig] || { prefix: [], suffix: [] };
    const map = new Map();
    for (const side of ['prefix', 'suffix']) for (const [id, tier] of p[side]) map.set(id, { tier, side });
    ix._pool.set(sig, map);
    return map;
  }

  /** Spawn-weight walk: first tag the base has decides. */
  function swEligible(mod, tagSet) {
    for (const [t, w] of mod.sw) if (tagSet.has(t)) return w > 0;
    return false;
  }

  /** Desecrated pool for a base (not in kb.pools): eligibility by sw walk, tier by level within family. */
  function desecratedPoolFor(ix, baseName) {
    if (ix._desPool.has(baseName)) return ix._desPool.get(baseName);
    const base = ix.kb.bases[baseName];
    const tags = new Set(base ? base.tags : []);
    const byFam = new Map();
    for (const [id, m] of Object.entries(ix.kb.mods)) {
      if (m.dom !== 'd' || !swEligible(m, tags)) continue;
      if (!byFam.has(m.fam)) byFam.set(m.fam, []);
      byFam.get(m.fam).push(id);
    }
    const map = new Map();
    for (const ids of byFam.values()) {
      ids.sort((a, b) => ix.kb.mods[b].lvl - ix.kb.mods[a].lvl);
      ids.forEach((id, i) => map.set(id, { tier: i + 1, side: ix.kb.mods[id].gen === 'p' ? 'prefix' : 'suffix' }));
    }
    ix._desPool.set(baseName, map);
    return map;
  }

  /** Natural mods of one family that are eligible on a tag set, sorted T1 first (highest level). */
  function familyTiersByTags(ix, fam, tags) {
    const set = new Set(tags);
    const ids = (ix.famMods.get(fam) || []).filter((id) => {
      const m = ix.kb.mods[id];
      return m.dom === 'i' && swEligible(m, set);
    });
    ids.sort((a, b) => ix.kb.mods[b].lvl - ix.kb.mods[a].lvl);
    return ids.map((id, i) => ({ id, tier: i + 1, lvl: ix.kb.mods[id].lvl, txt: ix.kb.mods[id].txt }));
  }

  /** Greater/Perfect floor: drop tiers below the minimum modifier level.
   *  If the floor empties the family, poe2wiki (B) says the best ilvl-legal tier stays eligible;
   *  that is flagged as `fallback` so the UI can show a verify warning. */
  function applyFloor(tiers, floor, ilvl) {
    const legal = tiers.filter((t) => t.lvl <= ilvl);
    const kept = legal.filter((t) => t.lvl >= floor);
    if (kept.length) return { tiers: kept, fallback: false };
    return { tiers: legal.length ? [legal[0]] : [], fallback: legal.length > 0 };
  }

  // ---------------------------------------------------------------- item text

  const CLASS_ALIASES = {
    Staves: 'Staff', Foci: 'Focus', Quarterstaves: 'Warstaff', 'Body Armours': 'Body Armour',
    Gloves: 'Gloves', Boots: 'Boots', 'Life Flasks': 'LifeFlask', 'Mana Flasks': 'ManaFlask',
  };
  function singularClass(c) {
    if (!c) return null;
    if (CLASS_ALIASES[c]) return CLASS_ALIASES[c];
    return c.replace(/s$/, '');
  }

  function resolveBase(ix, lines) {
    for (const raw of lines) {
      const l = raw.replace(/^Superior /, '').trim();
      if (ix.kb.bases[l]) return l;
    }
    // Magic names wrap the base: "Hale Rattling Sceptre of the Taskmaster"
    for (const raw of lines) {
      const l = ' ' + raw.trim() + ' ';
      for (const b of ix.baseNames) if (l.includes(' ' + b + ' ')) return b;
    }
    return null;
  }

  const RE_ADV_HEADER = /^\{(.*)\}$/;

  function parseAdvHeader(inner) {
    const h = { kind: 'other', fractured: false, desecrated: false, crafted: false, name: null, tier: null, tags: [], raw: inner.trim() };
    const nameM = inner.match(/"([^"]*)"/);
    if (nameM) h.name = nameM[1];
    const body = inner.replace(/"[^"]*"/, '');
    const tierM = body.match(/\((?:Tier|Rank):\s*(\d+)\)/i);
    if (tierM) h.tier = +tierM[1];
    const dash = body.split(/\s[—–]\s|\s-\s/);
    if (dash.length > 1) h.tags = dash.slice(1).join(' ').split(',').map((t) => t.trim()).filter(Boolean);
    const head = dash[0];
    if (/\bPrefix Modifier\b/i.test(head)) h.kind = 'prefix';
    else if (/\bSuffix Modifier\b/i.test(head)) h.kind = 'suffix';
    else if (/\bImplicit Modifier\b/i.test(head)) h.kind = 'implicit';
    else if (/\bCorruption\b/i.test(head)) h.kind = 'implicit';
    else if (/\bUnique Modifier\b/i.test(head)) h.kind = 'unique';
    else if (/\bEnchant/i.test(head)) h.kind = 'enchant';
    else if (/\bRune\b|\bSoul Core\b/i.test(head)) h.kind = 'rune';
    h.fractured = /\bFractured\b/i.test(head);
    h.desecrated = /\bDesecrated\b/i.test(head);
    h.crafted = /\bCrafted\b/i.test(head);
    h.corruption = /\bCorruption\b/i.test(head);
    h.vaal = /\bVaal\b/i.test(head);
    if (h.vaal && h.kind === 'other') h.kind = 'unique';
    return h;
  }

  /** Lines that carry item state, not mods. */
  const STATUS = {
    Corrupted: 'corrupted', Sanctified: 'sanctified', Mirrored: 'mirrored', Unidentified: 'unidentified',
    'Fractured Item': 'fracturedItem',
  };

  function isReminder(line) {
    return /^\(.*\)$/.test(line.trim());
  }

  /**
   * Parse item text copied from the game.
   * Returns { item: ItemState, warnings: [{level, msg}] }.
   */
  function parseItem(ix, text) {
    const warnings = [];
    const src = String(text || '').replace(/\r/g, '');
    const sections = src
      .split(/\n-{4,}\s*\n?/)
      .map((s) => s.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== ''))
      .filter((s) => s.length);
    if (!sections.length) return { item: null, warnings: [{ level: 'error', msg: 'Nothing to read. Hover the item in game, press Alt+Ctrl+C and paste it here.' }] };

    const head = sections[0];
    const item = {
      base: null, itemClass: null, rarity: null, name: null, ilvl: null, quality: 0, qualityType: null,
      flags: { corrupted: false, sanctified: false, mirrored: false, unidentified: false },
      implicits: [], mods: [], runes: [], sockets: [], source: 'ctrl_c',
      slotDelta: { prefix: 0, suffix: 0 },
    };

    let rarityIdx = -1;
    head.forEach((l, i) => {
      let m;
      if ((m = l.match(/^Item Class:\s*(.+)$/))) item.itemClassText = m[1].trim();
      else if ((m = l.match(/^Rarity:\s*(.+)$/))) { item.rarity = m[1].trim(); rarityIdx = i; }
    });
    if (!item.rarity) {
      return { item: null, warnings: [{ level: 'error', msg: 'No "Rarity:" line found. This does not look like PoE2 item text; copy the item in game with Alt+Ctrl+C.' }] };
    }
    const nameLines = head.slice(rarityIdx + 1);
    item.base = resolveBase(ix, nameLines);
    if (item.rarity === 'Rare' || item.rarity === 'Unique') item.name = nameLines.length > 1 ? nameLines[0] : null;
    else if (item.rarity === 'Magic') item.name = nameLines[0] || null;
    // Flasks and charms are shown but not crafted or planned.
    const flaskOrCharm = /flask|charm/i.test(item.itemClassText || '') || (item.base && /Flask|Charm/.test(ix.kb.bases[item.base].cls));
    if (flaskOrCharm) {
      item.unsupported = 'Flasks and charms are not supported: the assistant does not craft them.';
      warnings.push({ level: 'warn', msg: item.unsupported + ' The item is shown, but stats and plans are off.' });
    }
    if (!item.base) {
      if (!flaskOrCharm) warnings.push({ level: 'error', msg: `Unknown base ("${nameLines.join(' / ')}"). It is not in the 0.5.5 knowledge base; it may be from another patch or unreleased.` });
    } else {
      const b = ix.kb.bases[item.base];
      item.itemClass = b.cls;
      if (b.unconfirmed_class) warnings.push({ level: 'warn', msg: `${b.cls} may not drop in 0.5.5 (expected with 1.0). Verify in game.` });
      if (!b.tl) warnings.push({ level: 'info', msg: `${item.base} is not on the trade item list (datamined only). Verify in game.` });
      const fromText = singularClass(item.itemClassText);
      if (fromText && fromText !== b.cls) warnings.push({ level: 'info', msg: `Item text says class "${item.itemClassText}"; the knowledge base says "${b.cls}".` });
    }

    // Everything up to (and including) the "Item Level:" section is properties.
    let modStart = 1;
    for (let s = 1; s < sections.length; s++) {
      for (const l of sections[s]) {
        let m;
        if (/^Item Level:.*\?/.test(l)) { item.ilvlUnreadable = true; modStart = s + 1; } // screenshot reader could not read it
        else if ((m = l.match(/^Item Level:\s*(\d+)/))) { item.ilvl = +m[1]; modStart = s + 1; }
        else if ((m = l.match(/^Quality(?:\s*\(([^)]+)\))?:\s*\+?(\d+)%/))) { item.quality = +m[2]; item.qualityType = m[1] || null; }
        else if ((m = l.match(/^Sockets:\s*(.+)$/))) item.sockets = m[1].trim().split(/\s+/);
      }
    }
    // Property blocks (Spirit, Armour, Requires, ...) as shown between the header and the mods.
    item.props = sections.slice(1, modStart).map((sec) => sec.filter((l) => !/^Item Level:/.test(l) && !/^Quality/.test(l)))
      .filter((sec) => sec.length);
    if (item.ilvlUnreadable) warnings.push({ level: 'warn', msg: 'The item level could not be read. Type it into the "Item Level:" line; tier checks need it.' });
    else if (item.ilvl == null) warnings.push({ level: 'warn', msg: 'No "Item Level" line. Tier eligibility cannot be checked without it.' });

    const adv = sections.slice(modStart).some((s) => s.some((l) => RE_ADV_HEADER.test(l.trim())));
    item.source = adv ? 'adv_copy' : 'ctrl_c';

    const rawMods = []; // {header?, lines[], kind hint, markers}
    for (let s = modStart; s < sections.length; s++) {
      const sec = sections[s];
      if (sec.length === 1 && STATUS[sec[0].trim()]) { item.flags[STATUS[sec[0].trim()]] = true; continue; }
      let cur = null;
      let sectionHasMod = false;
      const pending = [];
      for (const lineRaw of sec) {
        const line = lineRaw.trim();
        if (STATUS[line]) { item.flags[STATUS[line]] = true; continue; }
        const hm = line.match(RE_ADV_HEADER);
        if (hm) {
          cur = { header: parseAdvHeader(hm[1]), lines: [] };
          pending.push(cur);
          sectionHasMod = true;
          continue;
        }
        if (isReminder(line)) continue;
        if (adv) {
          if (cur) cur.lines.push(line);
          else pending.push({ header: null, lines: [line], loose: true });
        } else {
          pending.push({ header: null, lines: [line] });
        }
      }
      if (adv && !sectionHasMod) {
        // Unique flavour text, "Note:" lines, etc. Keep lines that match something known or carry a marker.
        for (const p of pending) {
          const l = p.lines[0];
          if (ix.lineIndex.has(normalize(l)) || RE_MARKER.test(l) || /^Grants Skill:/.test(l)) rawMods.push({ header: null, lines: p.lines, orphan: true });
          else if (rawMods.some((x) => x.header)) (item.flavour = item.flavour || []).push(l);
        }
        continue;
      }
      rawMods.push(...pending.filter((p) => p.lines.length || p.header));
    }

    // ---------------------------------------------------------- resolve lines to mods
    const sig = item.base ? ix.kb.bases[item.base].sig : null;
    const pool = sig ? poolFor(ix, sig) : new Map();
    const desPool = item.base ? desecratedPoolFor(ix, item.base) : new Map();

    const slotLine = (l) => {
      const sm = cleanLine(l).match(/^([+-]\d+) (Prefix|Suffix) Modifiers? allowed$/i);
      if (sm) item.slotDelta[sm[2].toLowerCase()] += +sm[1];
    };
    const addImplicit = (lines, extra) => {
      for (const l of lines) { item.implicits.push({ text: cleanLine(l), ...extra }); slotLine(l); }
    };
    // Socketed runes can also add a prefix/suffix slot ("+1 Suffix Modifier allowed (rune)").
    const addRune = (l, kind) => { item.runes.push({ text: cleanLine(l), kind }); slotLine(l); };
    const addGrant = (l) => { (item.props = item.props || []).push([cleanLine(l)]); };
    /** Lines without a mod header: use their copy markers. Returns true when handled. */
    const loose = (l) => {
      if (/\(implicit\)\s*$/i.test(l)) { addImplicit([l], {}); return true; }
      if (/\(enchant\)\s*$/i.test(l)) { addRune(l, 'enchant'); return true; }
      if (/\(rune\)\s*$/i.test(l)) { addRune(l, 'rune'); return true; }
      if (/^Grants Skill:/.test(l)) { addGrant(l); return true; }
      return false;
    };

    if (adv) {
      for (const r of rawMods) {
        const h = r.header;
        if (!h) {
          for (const l of r.lines) if (!loose(l)) warnings.push({ level: 'info', msg: `Skipped a line without a mod header: "${l}"` });
          continue;
        }
        if (h.kind === 'implicit') { addImplicit(r.lines, { corruption: !!h.corruption }); continue; }
        if (h.kind === 'rune' || h.kind === 'enchant') { for (const l of r.lines) addRune(l, h.kind); continue; }
        if (h.kind === 'unique') { item.mods.push(makeUnmatched(r.lines, 'unique', h)); continue; }
        if (h.kind !== 'prefix' && h.kind !== 'suffix') {
          warnings.push({ level: 'info', msg: `Unrecognised mod header "{ ${h.raw} }"; its lines are shown unmatched.` });
          item.mods.push(makeUnmatched(r.lines, null, h));
          continue;
        }
        item.mods.push(resolveMod(ix, r.lines, { side: h.kind, header: h, pool, desPool, ilvl: item.ilvl, warnings, quiet: !!item.unsupported }));
      }
    } else {
      // Plain copy: implicit/rune markers are explicit; explicit mods need grouping for hybrids.
      const explicitLines = [];
      for (const r of rawMods) {
        const l = r.lines[0];
        if (!loose(l)) explicitLines.push(l);
      }
      let i = 0;
      while (i < explicitLines.length) {
        const two = i + 1 < explicitLines.length ? [explicitLines[i], explicitLines[i + 1]] : null;
        const markerOf = (l) => ((l.match(RE_MARKER) || [])[1] || '').toLowerCase();
        // Three-line hybrids first (e.g. "% increased Evasion and Energy Shield" + base Evasion + base Energy Shield;
        // found by the self-test), kept only when they can roll here and the values fit.
        const three = i + 2 < explicitLines.length ? explicitLines.slice(i, i + 3) : null;
        if (three && three.every((l) => markerOf(l) === markerOf(three[0]))) {
          const hy3 = resolveMod(ix, three, { side: null, header: markers(three[0]), pool, desPool, ilvl: item.ilvl, warnings: [], hybridOnly: true });
          if (hy3.modId && (hy3.inPool || markerOf(three[0]) === 'crafted') && hy3.fit !== false) { item.mods.push(hy3); i += 3; continue; }
        }
        if (two && markerOf(two[0]) === markerOf(two[1])) {
          const hy = resolveMod(ix, two, { side: null, header: markers(two[0]), pool, desPool, ilvl: item.ilvl, warnings: [], hybridOnly: true });
          if (hy.modId) {
            // Two lines that also read as two mods which can roll here: keep the hybrid only when it can roll here too
            // and its values fit (found by the self-test: two plain lines were read as a Runes of Aldur alloy hybrid).
            const ok = (m, line) => m.modId && (m.inPool || markerOf(line) === 'crafted') && m.fit !== false;
            const opt = { side: null, pool, desPool, ilvl: item.ilvl, warnings: [] };
            const a = resolveMod(ix, [two[0]], Object.assign({ header: markers(two[0]) }, opt));
            const b = resolveMod(ix, [two[1]], Object.assign({ header: markers(two[1]) }, opt));
            if (ok(hy, two[0]) || (!ok(a, two[0]) && !ok(b, two[1]))) {
              if (ok(hy, two[0]) && ok(a, two[0]) && ok(b, two[1])) {
                // Both readings can roll here (self-test finding): say so instead of guessing silently.
                hy.ambiguous = true; hy.splitAlt = [a.modId, b.modId];
                hy.confidence = Math.max(0.05, +(hy.confidence - 0.25).toFixed(2));
                warnings.push({ level: 'warn', msg: `"${hy.text.replace('\n', ' / ')}" can be one hybrid modifier or two separate ones; plain Ctrl+C text does not say which. Alt+Ctrl+C shows it.` });
              }
              item.mods.push(hy); i += 2; continue;
            }
          }
        }
        item.mods.push(resolveMod(ix, [explicitLines[i]], { side: null, header: markers(explicitLines[i]), pool, desPool, ilvl: item.ilvl, warnings, quiet: !!item.unsupported }));
        i += 1;
      }
    }

    const parseWarnings = warnings.slice();
    validateItem(ix, item, warnings);
    return { item, warnings, parseWarnings };
  }

  function markers(line) {
    const m = (line.match(RE_MARKER) || [])[1];
    const k = (m || '').toLowerCase();
    return { kind: null, fractured: k === 'fractured', desecrated: k === 'desecrated', crafted: k === 'crafted', tier: null, name: null, tags: [] };
  }

  function makeUnmatched(lines, slot, h) {
    return {
      slot, modId: null, fam: null, text: lines.map(cleanLine).join('\n'), values: lines.flatMap(lineValues),
      tier: h && h.tier, gameTier: h && h.tier, fractured: !!(h && h.fractured), desecrated: !!(h && h.desecrated),
      crafted: !!(h && h.crafted), vaal: !!(h && h.vaal), confidence: 0, candidates: [], unrevealed: false, note: 'unmatched',
    };
  }

  /** Match one mod (one or more lines) to KB candidates and pick the best. */
  function resolveMod(ix, lines, ctx) {
    const h = ctx.header || {};
    const text = lines.map(cleanLine).join('\n');
    const values = lines.flatMap(lineValues);

    if (lines.length === 1 && /unrevealed/i.test(lines[0])) {
      return {
        slot: ctx.side, modId: null, fam: null, text, values: [], tier: null, gameTier: h.tier || null,
        fractured: false, desecrated: true, crafted: false, confidence: 0.9, candidates: [], unrevealed: true,
      };
    }

    const first = ix.lineIndex.get(normalize(lines[0])) || [];
    const cands = [];
    for (const e of first) {
      if (e.li !== 0 || e.n !== lines.length) continue;
      const m = ix.kb.mods[e.id];
      const mlines = m.txt.split('\n');
      if (!mlines.every((ml, k) => normalize(ml) === normalize(lines[k]))) continue;
      const side = m.gen === 'p' ? 'prefix' : 'suffix';
      if (ctx.side && ctx.side !== side) continue;
      const des = m.dom === 'd';
      const pe = des ? ctx.desPool.get(e.id) : ctx.pool.get(e.id);
      const ranges = mlines.flatMap(templateRanges);
      const fit = valuesFit(values, ranges);
      const ilvlOk = ctx.ilvl == null ? true : m.lvl <= ctx.ilvl;
      let score = 0;
      if (pe) score += 4;
      if (fit === true) score += 3;
      else if (fit === null) score += 1;
      // Crafted (essence) mods: whether essences check item level is unknown (t18), so it does not count against them.
      if (ilvlOk || h.crafted) score += 1;
      if (h.desecrated === des) score += 2;
      if (h.kind && !h.desecrated && des) score -= 6; // Alt+Ctrl+C says it is not desecrated
      if (h.crafted && !des) score += 2;
      if (h.crafted && !pe && (m.eo || /^Essence/.test(e.id))) score += 1; // same text elsewhere: the essence mod wins
      // A crafted line is an essence (or alloy) mod: a mod an essence gives beats a natural one with the same text
      // (self-test finding: "+# to Level of all Spell Skills" on wands). ix.essenceMods is set by the page from poe2db.
      if (h.crafted && ix.essenceMods && ix.essenceMods.has(e.id)) score += 3;
      if (h.tier && pe && pe.tier === h.tier) score += 2;
      cands.push({ id: e.id, side, tier: pe ? pe.tier : null, inPool: !!pe, fit, ilvlOk, des, score, lvl: m.lvl });
    }
    if (ctx.hybridOnly && !cands.length) return { modId: null };
    cands.sort((a, b) => b.score - a.score || b.lvl - a.lvl);

    if (!cands.length) {
      const r = makeUnmatched(lines, ctx.side, h);
      r.fractured = !!h.fractured; r.desecrated = !!h.desecrated; r.crafted = !!h.crafted;
      if (ctx.warnings && !ctx.quiet) ctx.warnings.push({ level: 'warn', msg: `No knowledge base match for "${text}". This mod is unverified.` });
      return r;
    }
    const best = cands[0];
    const top = cands.filter((c) => c.score === best.score);
    const distinctFams = new Set(top.map((c) => ix.kb.mods[c.id].fam));
    const m = ix.kb.mods[best.id];
    let confidence = 0.55;
    if (best.inPool) confidence += 0.2;
    if (best.fit === true) confidence += 0.15;
    if (ctx.side) confidence += 0.08;
    if (distinctFams.size > 1) confidence -= 0.25;
    // Plain copies without ranges: overlapping tier ranges of one family fit the value equally (self-test finding).
    const tierAmbiguous = !ctx.side && top.filter((c) => ix.kb.mods[c.id].fam === m.fam && c.tier !== best.tier).length > 0;
    if (tierAmbiguous) confidence -= 0.15;
    confidence = Math.max(0.05, Math.min(0.99, confidence));

    const mod = {
      slot: best.side, modId: best.id, fam: m.fam, text, values,
      tier: best.tier, gameTier: h.tier || null,
      fractured: !!h.fractured, desecrated: h.kind ? !!h.desecrated : best.des || !!h.desecrated, crafted: !!h.crafted,
      confidence: +confidence.toFixed(2), candidates: cands.slice(0, 6).map((c) => ({ id: c.id, tier: c.tier, side: c.side, inPool: c.inPool, fit: c.fit })),
      ambiguous: distinctFams.size > 1, tierAmbiguous, inPool: best.inPool, fit: best.fit, ilvlOk: best.ilvlOk, lvl: m.lvl,
      name: h.name || null, tags: h.tags || [],
    };
    // Crafted: non-natural mods (essence/alloy/Genesis) are the crafted slot.
    if (!best.des && !best.inPool && isNonNatural(m)) mod.crafted = true;
    return mod;
  }

  function isNonNatural(m) {
    return m.dom === 'i' && m.sw.every(([, w]) => w === 0);
  }

  // ---------------------------------------------------------------- validation

  /**
   * Affix limits per side. Game text (keyword ItemRarity): Magic 1 + 1, Rare 3 + 3. Rare jewels: 2 + 2 (R_JEWEL_SLOTS,
   * community source, in-game test t24). cls: the item class, when the item object does not carry it.
   */
  function slotLimits(item, cls) {
    const rare = (cls || item.cls || item.itemClass) === 'Jewel' ? 2 : 3;
    const base = item.rarity === 'Magic' ? 1 : item.rarity === 'Rare' ? rare : item.rarity === 'Normal' ? 0 : rare;
    return {
      prefix: Math.max(0, base + (item.rarity === 'Rare' ? item.slotDelta.prefix : 0)),
      suffix: Math.max(0, base + (item.rarity === 'Rare' ? item.slotDelta.suffix : 0)),
    };
  }

  /** Limits of a parsed item: its class, implicit/rune slot changes and explicit "+1 Prefix Modifier allowed" mods. */
  function itemLimits(ix, item) {
    const b = item.base ? ix.kb.bases[item.base] : null;
    const lim = slotLimits(item, b && b.cls);
    if (item.rarity !== 'Rare') return lim;
    for (const m of item.mods || []) {
      const cap = m.modId && ix.kb.mods[m.modId] ? ix.kb.mods[m.modId].cap : null;
      if (cap) { lim.prefix += cap.prefix || 0; lim.suffix += cap.suffix || 0; }
    }
    return lim;
  }

  function validateItem(ix, item, warnings) {
    if (!item) return warnings;
    const lim = itemLimits(ix, item);
    const count = { prefix: 0, suffix: 0 };
    for (const m of item.mods) if (m.slot === 'prefix' || m.slot === 'suffix') count[m.slot]++;
    if (item.rarity === 'Normal' && item.mods.length) warnings.push({ level: 'error', msg: 'A Normal item cannot have explicit mods; check the Rarity line.' });
    if (item.rarity !== 'Unique') {
      for (const side of ['prefix', 'suffix']) {
        if (count[side] > lim[side]) warnings.push({ level: 'error', msg: `A ${item.rarity} item allows at most ${lim[side]} ${side}${lim[side] === 1 ? '' : 'es'}; found ${count[side]}. Check the matches.` });
      }
    }
    const crafted = item.mods.filter((m) => m.crafted).length;
    const des = item.mods.filter((m) => m.desecrated).length;
    if (crafted > 1) warnings.push({ level: 'error', msg: `0.5+ rule: max 1 crafted mod per item (R_ONE_CRAFTED); found ${crafted}.` });
    if (des > 1 && item.flags.corrupted) warnings.push({ level: 'info', msg: `${des} Desecrated mods on a corrupted item: this is an Omen of Putrefaction item (the one-Desecrated cap does not apply to it).` });
    else if (des > 1) warnings.push({ level: 'error', msg: `0.5+ rule: max 1 Desecrated mod per item (R_ONE_DESECRATED); found ${des}.` });
    for (const m of item.mods) {
      if (!m.modId) continue;
      if (item.ilvl != null && m.lvl > item.ilvl) warnings.push({ level: 'error', msg: `"${m.text}" needs mod level ${m.lvl} but the item level is ${item.ilvl}; this tier cannot roll here.` });
      if (m.fit === false) warnings.push({ level: 'warn', msg: `"${m.text}" is outside this tier's range (a Sanctify/Vaal multiplied value, or a wrong match).` });
      if (m.gameTier && m.tier && m.gameTier !== m.tier) warnings.push({ level: 'warn', msg: `"${m.text}": game says T${m.gameTier}, computed T${m.tier}. Showing the game's tier.` });
      if (m.gameTier) m.tier = m.gameTier;
      if (m.ambiguous) warnings.push({ level: 'info', msg: `"${m.text}" matches more than one mod; pick the right one from the candidates.` });
      if (!m.inPool && !m.desecrated && !m.crafted) warnings.push({ level: 'info', msg: `"${m.text}" is not in this base's natural pool (from an essence, the Genesis Tree or another mechanic).` });
    }
    if (item.flags.corrupted) warnings.push({ level: 'info', msg: "Corrupted: only corrupted-item currency applies (Architect's Orb, Orbs of Sacrifice, Vaal Cultivation Orb)." });
    if (item.flags.sanctified) warnings.push({ level: 'info', msg: 'Sanctified: most crafting is locked (single source, verify in game).' });
    if (item.source === 'ctrl_c') warnings.push({ level: 'info', msg: "Plain Ctrl+C copy: sides and tiers were inferred. Turn on Advanced Mod Descriptions in game and use Alt+Ctrl+C for exact data." });
    return warnings;
  }

  // ---------------------------------------------------------------- stat picker

  function nonNaturalGroup(id) {
    if (/^Alloy/.test(id)) return 'alloy';
    if (/^GenesisTree/.test(id)) return 'genesis';
    if (/Essence/.test(id)) return 'essence';
    return 'other';
  }

  /**
   * Picker options for one slot.
   * opts: { side, showImpossible, league, exclude: modId (the mod being replaced) }
   * Returns [{key, fam, label, side, group, tiers:[{id,tier,lvl,txt,ok,reason}], ok, reason}]
   */
  function pickerOptions(ix, item, opts) {
    if (!item || !item.base) return [];
    const base = ix.kb.bases[item.base];
    const ilvl = item.ilvl == null ? 100 : item.ilvl;
    const side = opts.side;
    const pool = poolFor(ix, base.sig);
    const others = item.mods.filter((m) => m.modId && m.modId !== opts.exclude);
    const takenGroups = new Map();
    for (const m of others) for (const g of ix.kb.mods[m.modId].grp) takenGroups.set(g, m.text);

    const fams = new Map();
    const add = (id, tier, group, baseReason, via) => {
      const m = ix.kb.mods[id];
      const key = group + '|' + m.fam;
      if (!fams.has(key)) fams.set(key, { key, fam: m.fam, label: template(m.txt), side, group, tiers: [], baseReason });
      let reason = baseReason || null;
      if (!reason && m.lvl > ilvl) reason = `needs ilvl ${m.lvl}`;
      if (!reason) {
        const g = m.grp.find((x) => takenGroups.has(x));
        if (g) reason = `conflicts with: ${takenGroups.get(g)}`;
      }
      fams.get(key).tiers.push({ id, tier, lvl: m.lvl, txt: m.txt, ok: !reason, reason, via: via || null });
    };

    for (const [id, pe] of pool) if (pe.side === side) add(id, pe.tier, side, null);
    for (const [id, pe] of desecratedPoolFor(ix, item.base)) if (pe.side === side) add(id, pe.tier, 'desecrated', null);

    const hasCrafted = item.mods.some((m) => m.crafted && m.modId !== opts.exclude);
    const hasDes = item.mods.some((m) => m.desecrated && m.modId !== opts.exclude);

    // Essences and alloys that poe2db lists for this item class (base eligibility known).
    const listed = new Set();
    const gl = side === 'prefix' ? 'p' : 's';
    for (const rec of opts.essences || []) {
      if (rec.gen !== gl || !ix.kb.mods[rec.mod] || !ix.kb.mods[rec.mod].txt) continue;
      listed.add(rec.mod);
      const grp = rec.liquid ? 'liquid' : rec.alloy ? 'alloy' : 'essence';
      add(rec.mod, null, grp, null, rec.item);
    }

    if (opts.showImpossible) {
      const seenFam = new Set([...fams.values()].map((f) => f.fam));
      const g = side === 'prefix' ? 'p' : 's';
      for (const [id, m] of Object.entries(ix.kb.mods)) {
        if (m.gen !== g || !m.txt || m.dom === 'd') continue; // other bases' desecrated mods: noise
        if (isNonNatural(m)) {
          if (listed.has(id)) continue;
          const grp = nonNaturalGroup(id);
          if (grp === 'other') continue;
          add(id, null, grp, 'base eligibility unverified');
          continue;
        }
        if (seenFam.has(m.fam)) continue;
        add(id, null, side, 'cannot roll on this base');
      }
    }

    const out = [];
    for (const f of fams.values()) {
      f.tiers.sort((a, b) => (a.tier || 99) - (b.tier || 99) || b.lvl - a.lvl);
      if (f.group === 'desecrated' && hasDes) for (const t of f.tiers) if (t.ok) { t.ok = false; t.reason = 'item already has a Desecrated mod'; }
      if (['essence', 'alloy', 'genesis', 'liquid'].includes(f.group) && hasCrafted) for (const t of f.tiers) { t.ok = false; t.reason = t.reason || 'item already has a crafted mod'; }
      f.ok = f.tiers.some((t) => t.ok);
      f.reason = f.ok ? null : (f.tiers[f.tiers.length - 1] || {}).reason || f.baseReason;
      if (!f.ok && !opts.showImpossible) continue;
      f.lich = f.group === 'desecrated' ? lichOf(ix.kb.mods[f.tiers[0].id]) : null;
      out.push(f);
    }
    return out;
  }

  function lichOf(m) {
    if (m.mt.includes('kurgal_mod')) return 'Kurgal';
    if (m.mt.includes('amanamu_mod')) return 'Amanamu';
    if (m.mt.includes('ulaman_mod')) return 'Ulaman';
    return null;
  }

  const SYN = {
    res: ['resistance', 'resistances'], resist: ['resistance', 'resistances'], lvl: ['level'], lv: ['level'],
    ms: ['movement speed'], es: ['energy shield'], hp: ['life'], crit: ['critical'], phys: ['physical'],
    dmg: ['damage'], attr: ['attribute', 'attributes'], as: ['attack speed'], cs: ['cast speed'],
    ele: ['elemental'], mana: ['mana'], regen: ['regeneration'], ar: ['armour'], eva: ['evasion'], spd: ['speed'],
    minions: ['minion'], light: ['lightning'], lightn: ['lightning'],
  };

  /** Fuzzy score of a label against a query ("fire res", "minion lvl"). 0 = no match. */
  function searchScore(label, query) {
    const L = label.toLowerCase();
    const words = L.split(/[^a-z0-9%#]+/).filter(Boolean);
    const toks = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return 1;
    let score = 0;
    for (const t of toks) {
      const alts = [t, ...(SYN[t] || [])];
      let best = 0;
      for (const a of alts) {
        if (a.includes(' ')) { if (L.includes(a)) best = Math.max(best, 3); continue; }
        for (const w of words) {
          if (w === a) best = Math.max(best, 3);
          else if (w.startsWith(a)) best = Math.max(best, 2);
          else if (a.length >= 3 && w.includes(a)) best = Math.max(best, 1);
        }
      }
      if (!best) return 0;
      score += best;
    }
    return score + 1 / (1 + L.length / 40);
  }

  function searchOptions(options, query, limit) {
    const scored = [];
    for (const o of options) {
      const s = searchScore(o.label, query);
      if (s > 0) scored.push([s + (o.ok ? 10 : 0), o]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, limit || 60).map((x) => x[1]);
  }

  /** Resolve a template target ("+# to Level of all Minion Skills") to a family on this base. */
  function resolveTemplateTarget(ix, item, label) {
    const want = normalize(label);
    for (const side of ['prefix', 'suffix']) {
      const opts = pickerOptions(ix, item, { side, showImpossible: true });
      const hit = opts.find((o) => o.group === side && !o.baseReason && normalize(o.label) === want);
      if (hit) return hit;
    }
    return null;
  }

  // ---------------------------------------------------------------- leak filter

  const MECHANIC_PATTERNS = [
    [/\balt[\s-]?(aug|regal)\b/i, 'alt-aug / alt-regal (no Orb of Alteration in PoE2)'],
    [/\bfossils?\b/i, 'fossil (PoE1)'],
    [/\bresonators?\b/i, 'resonator (PoE1)'],
    [/\bharvest\b/i, 'Harvest (PoE1)'],
    [/\bbeast\s?craft/i, 'beastcraft (PoE1)'],
    [/\bmeta[\s-]?mods?\b|\bmetacraft/i, 'crafting bench metamod (PoE1)'],
    [/\bcrafting bench\b/i, 'crafting bench (PoE1)'],
    [/\b(shaper|elder|conqueror|crusader|redeemer|hunter|warlord)\s+(influence|item|mod)/i, 'influence (PoE1)'],
    [/\binfluenced?\b/i, 'influence (PoE1)'],
    [/\bveiled\b/i, 'veiled mod (PoE1)'],
    [/\b(Whispering|Muttering|Weeping|Wailing|Screaming|Shrieking|Deafening) Essence\b/i, 'PoE1 essence name'],
    [/chaos orb.{0,60}(tüm mod|all (the )?(mods|modifiers)|reroll(s)? (the )?(item|all))/i, 'Chaos Orb full reroll (PoE1 behaviour)'],
    [/(tüm modları|all (mods|modifiers)).{0,40}chaos orb/i, 'Chaos Orb full reroll (PoE1 behaviour)'],
  ];

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Scan generated text for PoE1 names and mechanics. Returns [{match, reason}]. */
  function leakScan(ix, text) {
    const hits = [];
    const s = String(text || '');
    const lower = s.toLowerCase();
    for (const name of ix.blNames) {
      const n = name.toLowerCase();
      if (!lower.includes(n)) continue;
      if (new RegExp(`(^|[^A-Za-z'])${escapeRe(n)}($|[^A-Za-z'])`, 'i').test(s)) hits.push({ match: name, reason: 'PoE1 blacklist' });
    }
    for (const [re, reason] of MECHANIC_PATTERNS) {
      const m = s.match(re);
      if (m) hits.push({ match: m[0], reason });
    }
    return hits;
  }

  /**
   * Check generated explanation text before it is shown: PoE1 names and mechanics, plus any
   * currency- or omen-like name that is not in the PoE2 roster. Returns a list of problems.
   */
  function explanationProblems(ix, text) {
    const problems = leakScan(ix, text).map((h) => `${h.match} (${h.reason})`);
    const roster = ix._roster || (ix._roster = new Set([...(ix.kb.currency_roster.Currency || []), ...(ix.kb.currency_roster.Omen || [])].map((n) => n.toLowerCase())));
    const re = /\b(Omen of (?:the )?[A-Z][\w'-]*(?: [A-Z][\w'-]*)?|(?:Greater |Perfect )?Orb of [A-Z][\w'-]*|(?:Greater |Perfect )?[A-Z][\w'-]* Orb)\b/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const name = m[1];
      if (!roster.has(name.toLowerCase()) && !problems.some((p) => p.startsWith(name))) problems.push(`${name} (not in PoE2 data)`);
    }
    return problems;
  }

  function legacyScan(ix, text) {
    const out = [];
    for (const l of ix.kb.legacy_or_disabled || []) {
      for (const part of l.name.split(' / ')) {
        const n = part.replace(/^Omen of /, '').trim();
        if (n && String(text).toLowerCase().includes(n.toLowerCase())) out.push(l);
      }
    }
    return out;
  }

  /**
   * Differences between two readings of an item (e.g. the Alt+Ctrl+C text and a screenshot, or the item before and
   * after a step). Mods are paired by side and stat template, so a changed roll shows as a value difference.
   * Returns [{ kind: 'field'|'value'|'flag'|'only-a'|'only-b', text, a, b }].
   */
  function diffItems(a, b) {
    const out = [];
    if (!a || !b) return out;
    const field = (label, x, y) => { if (String(x == null ? '' : x) !== String(y == null ? '' : y)) out.push({ kind: 'field', text: label, a: x, b: y }); };
    field('Base', a.base, b.base);
    field('Name', a.name, b.name);
    field('Rarity', a.rarity, b.rarity);
    field('Item level', a.ilvl, b.ilvl);
    field('Quality', a.quality || 0, b.quality || 0);
    for (const f of ['corrupted', 'sanctified', 'mirrored']) field(f.charAt(0).toUpperCase() + f.slice(1), !!(a.flags && a.flags[f]), !!(b.flags && b.flags[f]));
    const keyOf = (m) => (m.slot || '') + '|' + (m.unrevealed ? 'unrevealed' : normalize(m.text));
    const list = (it) => [...(it.implicits || []).map((m) => Object.assign({ slot: 'implicit' }, m)), ...(it.mods || [])];
    const rest = list(b).slice();
    for (const m of list(a)) {
      const i = rest.findIndex((x) => keyOf(x) === keyOf(m));
      if (i < 0) { out.push({ kind: 'only-a', text: m.text, a: m.slot }); continue; }
      const n = rest.splice(i, 1)[0];
      const va = (m.values || []).join('/'), vb = (n.values || []).join('/');
      const first = m.text.split('\n')[0];
      if (va !== vb) out.push({ kind: 'value', text: first, a: va, b: vb });
      for (const f of ['fractured', 'desecrated', 'crafted']) if (!!m[f] !== !!n[f]) out.push({ kind: 'flag', text: `${first}: ${f}`, a: !!m[f], b: !!n[f] });
      if (m.tier && n.tier && m.tier !== n.tier) out.push({ kind: 'value', text: `${first}: tier`, a: 'T' + m.tier, b: 'T' + n.tier });
    }
    for (const n of rest) out.push({ kind: 'only-b', text: n.text, b: n.slot });
    return out;
  }

  return {
    cleanLine, normalize, template, templateRanges, lineValues, valuesFit,
    buildIndex, poolFor, desecratedPoolFor, swEligible, familyTiersByTags, applyFloor,
    parseItem, validateItem, slotLimits, itemLimits, pickerOptions, searchOptions, searchScore, resolveTemplateTarget,
    leakScan, legacyScan, explanationProblems, lichOf, diffItems,
  };
});
