#!/usr/bin/env python3
"""Check the knowledge base against independent game data exports (reports/kb-verify.md, .json).

1. Natural mod pools: for every in-scope base, the prefix and suffix mods (and their levels) in the knowledge base
   against RePoE's own per-base computation (mods_by_base.json).
2. Corruption mods: which bases can take which "Corruption Enhancement" mods (not in the knowledge base yet).

Run python scripts/fetch_gamedata.py first. Usage: python scripts/kb_verify.py [kb.json]
"""
import collections, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'poe2_kb_0.5.5.json')
GD = os.path.join(ROOT, '.kb_cache', 'gamedata')
BASES = os.path.join(ROOT, '.kb_cache', 'poe2_base_items.json')
REPORTS = os.path.join(ROOT, 'reports')
SCOPE = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'One Hand Mace', 'Two Hand Mace', 'Spear', 'Bow', 'Crossbow',
         'Warstaff', 'Wand', 'Staff', 'Sceptre', 'Talisman', 'Shield', 'Buckler', 'Focus', 'Quiver', 'Ring', 'Amulet',
         'Belt', 'Jewel']


ITEM_MODS = {}
RADIUS = re.compile(r'^(Small|Notable) Passive Skills in Radius also grant ')


def clean(t):
    t = re.sub(r'\[([^\]|]+)\|([^\]]+)\]', r'\2', t or '')
    return re.sub(r'\[([^\]|]+)\]', r'\1', t).strip()


def sorted_ranges(t):
    # the game data writes the range of a negative stat ("reduced") high to low, (10-5)%: sort both ends
    return re.sub(r'\((-?[\d.]+)-(-?[\d.]+)\)', lambda m: '(%s-%s)' % tuple(sorted((m.group(1), m.group(2)), key=float)), t)


def strip_radius(t):
    return '\n'.join(RADIUS.sub('', line) for line in sorted_ranges(clean(t)).split('\n'))


def expected_with_tags(tags):
    """Natural and corruption mods (id -> level) an item with these tags can roll, by the spawn-weight rule."""
    ts = set(tags)

    def ok(sw):
        for x in sw or []:
            if x['tag'] in ts:
                return x['weight'] > 0
        return False
    out = {'prefix': {}, 'suffix': {}, 'corrupted': {}}
    for mid, m in ITEM_MODS.items():
        g = m.get('generation_type')
        if m.get('domain') == 'item' and g in out and ok(m.get('spawn_weights')):
            out[g][mid] = m.get('required_level')
    return out


def main():
    ITEM_MODS.update(json.load(open(os.path.join(ROOT, '.kb_cache', 'poe2_mods.json'), encoding='utf-8')))
    kb = json.load(open(KB, encoding='utf-8'))
    mbb = json.load(open(os.path.join(GD, 'mods_by_base.json'), encoding='utf-8'))
    items = json.load(open(BASES, encoding='utf-8'))
    name_of = {meta: v.get('name') for meta, v in items.items()}
    # RePoE's view: base name -> {prefix: {id: lvl}, suffix: {...}, corrupted: {...}}
    repoe = {}
    for cls, sigs in mbb.items():
        for sig, entry in (sigs or {}).items():
            gen = {}
            for g, fams in (entry.get('mods') or {}).items():
                gen[g] = {mid: lvl for fam in fams.values() for mid, lvl in fam.items()}
            for meta in entry.get('bases') or []:
                n = name_of.get(meta)
                if n and n not in repoe:
                    repoe[n] = {'class': cls, 'mods': gen}
    per_class = collections.OrderedDict((c, collections.Counter()) for c in SCOPE)
    examples = collections.defaultdict(list)
    corrupted = collections.defaultdict(set)
    for name, b in sorted(kb['bases'].items()):
        cls = b['cls']
        if cls not in per_class or b.get('unconfirmed_class'):
            continue
        c = per_class[cls]
        c['bases'] += 1
        r = repoe.get(name)
        if not r:
            c['not in RePoE'] += 1
            if len(examples[cls]) < 3:
                examples[cls].append(f'{name}: no RePoE entry')
            continue
        pool = kb['pools'].get(b['sig']) or {}
        if cls == 'Jewel' and any(kb['mods'][mid].get('src') == 'poe2db' for side in ('prefix', 'suffix') for mid, _t in pool.get(side, [])):
            # Jewel mods come from poe2db with its own ids: compare the texts and ranges instead. The game data text
            # lacks the "Small/Notable Passive Skills in Radius also grant" prefix of radius jewels, so drop it.
            ok = True
            for side in ('prefix', 'suffix'):
                mine = collections.Counter(strip_radius(kb['mods'][mid]['txt']) for mid, _t in pool.get(side, []))
                theirs = collections.Counter(sorted_ranges(clean(ITEM_MODS[mid]['text'])) for mid in (r['mods'].get(side) or {}))
                if mine != theirs:
                    ok = False
                    if len(examples[cls]) < 5:
                        examples[cls].append(f"{name} {side}: {sum((mine - theirs).values())} texts only in the KB, {sum((theirs - mine).values())} only in the game data"
                                             + f" (e.g. {list((mine - theirs))[:2]} / {list((theirs - mine))[:2]})")
            if 'corrupted' in pool:
                if set(pool['corrupted']) == set((r['mods'].get('corrupted') or {}).keys()):
                    c['corruption identical'] += 1
                else:
                    ok = False
                    if len(examples[cls]) < 5:
                        examples[cls].append(f'{name} corrupted: lists differ')
            c['identical' if ok else 'different'] += 1
            c['compared by text'] += 1
            for mid in (r['mods'].get('corrupted') or {}):
                corrupted[cls].add(mid)
            continue
        ok = True
        if b.get('tags_added'):
            # Implicits that add tags ("Can roll Ring Modifiers" adds ring): RePoE's lists use the base's own tags only, so
            # compute the game rule here (first matching spawn tag among the base's tags and the added ones decides).
            r = {'mods': expected_with_tags(b['tags'])}
            c['computed with implicit tags'] += 1
        if 'corrupted' in pool:
            mine_c, theirs_c = set(pool['corrupted']), set((r['mods'].get('corrupted') or {}).keys())
            if mine_c != theirs_c:
                ok = False
                if len(examples[cls]) < 5:
                    examples[cls].append(f"{name} corrupted: {len(theirs_c - mine_c)} missing, {len(mine_c - theirs_c)} extra")
            else:
                c['corruption identical'] += 1
        for side, g in (('prefix', 'prefix'), ('suffix', 'suffix')):
            mine = {mid for mid, _t in pool.get(side, [])}
            theirs = set((r['mods'].get(g) or {}).keys())
            # the knowledge base keeps natural item mods; RePoE lists the same generation types
            extra, missing = mine - theirs, theirs - mine
            lvl_diff = [mid for mid in mine & theirs if kb['mods'][mid]['lvl'] != r['mods'][g][mid]]
            if extra or missing or lvl_diff:
                ok = False
                if len(examples[cls]) < 5:
                    examples[cls].append(f"{name} {side}: {len(missing)} missing, {len(extra)} extra, {len(lvl_diff)} level differences"
                                         + (f" (missing e.g. {sorted(missing)[:3]})" if missing else '')
                                         + (f" (extra e.g. {sorted(extra)[:3]})" if extra else ''))
        c['identical' if ok else 'different'] += 1
        for mid in (r['mods'].get('corrupted') or {}):
            corrupted[cls].add(mid)
    out = {'kb': os.path.basename(KB), 'classes': {c: dict(v) for c, v in per_class.items()},
           'examples': dict(examples), 'corrupted_mods_per_class': {c: sorted(v) for c, v in corrupted.items()}}
    os.makedirs(REPORTS, exist_ok=True)
    json.dump(out, open(os.path.join(REPORTS, 'kb-verify.json'), 'w', encoding='utf-8'), indent=1)
    lines = ['# Knowledge base check against the game data', '',
             f"Knowledge base `{out['kb']}` against RePoE's per-base mod lists (mods_by_base.json, game data 0.5.5).", '',
             '| Class | Bases | Identical pools | Different | Not in RePoE | Computed with implicit tags | Corruption mods |', '|---|---|---|---|---|---|---|']
    for c, v in per_class.items():
        lines.append(f"| {c} | {v['bases']} | {v['identical']} | {v['different']} | {v['not in RePoE']} | {v['computed with implicit tags']} | {len(corrupted.get(c, ()))} |")
    lines += ['', 'Bases whose implicits add tags (e.g. Grasping Mail: "Can roll Ring Modifiers" adds ring) are compared with the '
              'spawn-weight rule over their tags plus the added ones; the per-base lists of RePoE leave the added tags out.']
    if examples:
        lines += ['', '## Differences', '']
        for c, ex in examples.items():
            lines += [f'- {c}: ' + '; '.join(ex)]
    open(os.path.join(REPORTS, 'kb-verify.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
