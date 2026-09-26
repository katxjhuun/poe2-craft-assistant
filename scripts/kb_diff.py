#!/usr/bin/env python3
"""PoE2 Craft Assistant - knowledge base difference report (master prompt 4.3).

Compares two knowledge base files and lists what changed, so a new game patch can be reviewed before the page
uses it: bases, modifiers (text, level, value ranges, groups, spawn tags), base pools (tiers), currency and omen
names, crafting operators and rules, legacy mechanics and the PoE1 blacklist.

Usage: python scripts/kb_diff.py OLD.json NEW.json [--out report.md] [--json report.json]
Exit code 0 always; the report says what needs a look ("review" items).
"""
import json, sys, os
from collections import Counter

def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)

def keyed(items, key='id'):
    return {x.get(key) or x.get('name') or json.dumps(x, sort_keys=True): x for x in items or []}

def diff_dict(a, b):
    added = sorted(set(b) - set(a))
    removed = sorted(set(a) - set(b))
    changed = sorted(k for k in set(a) & set(b) if a[k] != b[k])
    return added, removed, changed

MOD_FIELDS = ['txt', 'lvl', 'st', 'grp', 'sw', 'gen', 'dom', 'fam', 'mt']
BASE_FIELDS = ['cls', 'lvl', 'tags', 'imp', 'tl', 'sig']

def field_changes(a, b, fields):
    return [f for f in fields if a.get(f) != b.get(f)]

def pool_tiers(kb):
    """{base name: {mod id: (side, tier)}} through each base's tag signature."""
    out = {}
    for name, b in kb.get('bases', {}).items():
        p = kb.get('pools', {}).get(b.get('sig'), {})
        m = {}
        for side in ('prefix', 'suffix'):
            for mod_id, tier in p.get(side, []):
                m[mod_id] = (side, tier)
        out[name] = m
    return out

def report(old, new, old_name, new_name):
    R = {'files': [old_name, new_name], 'meta': {}, 'sections': []}
    om, nm = old.get('meta', {}), new.get('meta', {})
    R['meta'] = {'old_version': om.get('game_data_version') or om.get('version'), 'new_version': nm.get('game_data_version') or nm.get('version'),
                 'old_counts': om.get('counts'), 'new_counts': nm.get('counts')}

    def section(title, added, removed, changed, detail=None, review=False):
        R['sections'].append({'title': title, 'added': added, 'removed': removed, 'changed': changed, 'detail': detail or {}, 'review': review})

    # bases
    ob, nb = old.get('bases', {}), new.get('bases', {})
    a, r, c = diff_dict(ob, nb)
    det = {k: field_changes(ob[k], nb[k], BASE_FIELDS) for k in c}
    section('Bases', a, r, c, det, review=bool(r))
    # mods
    omods, nmods = old.get('mods', {}), new.get('mods', {})
    a, r, c = diff_dict(omods, nmods)
    det = {k: field_changes(omods[k], nmods[k], MOD_FIELDS) for k in c}
    lvl = [k for k in c if 'lvl' in det[k]]
    rng = [k for k in c if 'st' in det[k]]
    section('Modifiers', a, r, c, det, review=bool(r or lvl or rng))
    R['mod_summary'] = {
        'level_changed': [(k, omods[k].get('lvl'), nmods[k].get('lvl')) for k in lvl][:200],
        'range_changed': [(k, omods[k].get('txt'), nmods[k].get('txt')) for k in rng][:200],
        'families_added': sorted(set(m['fam'] for k, m in nmods.items() if k in a))[:200],
        'families_removed': sorted(set(m['fam'] for k, m in omods.items() if k in r))[:200],
    }
    # pools: which bases gained or lost mods, or saw tiers renumbered
    op, npl = pool_tiers(old), pool_tiers(new)
    gained, lost, retier = Counter(), Counter(), Counter()
    for name in set(op) & set(npl):
        o, n = op[name], npl[name]
        gained[name] = len(set(n) - set(o))
        lost[name] = len(set(o) - set(n))
        retier[name] = sum(1 for k in set(o) & set(n) if o[k] != n[k])
    R['pools'] = {
        'bases_with_new_mods': sum(1 for v in gained.values() if v), 'bases_losing_mods': sum(1 for v in lost.values() if v),
        'bases_with_tier_changes': sum(1 for v in retier.values() if v),
        'most_changed': [(b, gained[b], lost[b], retier[b]) for b in sorted(op.keys() & npl.keys(), key=lambda x: -(gained[x] + lost[x] + retier[x]))[:25]
                         if gained[b] + lost[b] + retier[b]],
    }
    # currency, omens, descriptions
    oc, nc = old.get('currency_roster', {}), new.get('currency_roster', {})
    for kind in sorted(set(oc) | set(nc)):
        so, sn = set(oc.get(kind, [])), set(nc.get(kind, []))
        section(f'{kind} names', sorted(sn - so), sorted(so - sn), [], review=bool(so - sn))
    od, nd = old.get('item_descriptions', {}), new.get('item_descriptions', {})
    a, r, c = diff_dict(od, nd)
    section('Currency and omen game text', a, r, c, {k: {'old': od[k], 'new': nd[k]} for k in c[:100]}, review=bool(c))
    # operators and rules
    oo, no = keyed(old.get('crafting_ops', [])), keyed(new.get('crafting_ops', []))
    a, r, c = diff_dict(oo, no)
    section('Crafting operators', a, r, c, {k: {'old': oo[k], 'new': no[k]} for k in c}, review=bool(a or r or c))
    orl, nrl = keyed(old.get('crafting_rules', [])), keyed(new.get('crafting_rules', []))
    a, r, c = diff_dict(orl, nrl)
    section('Crafting rules', a, r, c, {k: {'old': orl[k], 'new': nrl[k]} for k in c}, review=bool(a or r or c))
    ol, nl = keyed(old.get('legacy_or_disabled', []), 'name'), keyed(new.get('legacy_or_disabled', []), 'name')
    a, r, c = diff_dict(ol, nl)
    section('Legacy or disabled mechanics', a, r, c, review=bool(r))
    obl, nbl = set(old.get('poe1_only_blacklist', [])), set(new.get('poe1_only_blacklist', []))
    section('PoE1 blacklist', sorted(nbl - obl), sorted(obl - nbl), [], review=bool(obl - nbl))
    return R

def markdown(R):
    L = [f"# Knowledge base difference report", '', f"- Old: `{R['files'][0]}` ({R['meta']['old_version']})",
         f"- New: `{R['files'][1]}` ({R['meta']['new_version']})", '']
    if R['meta']['old_counts'] or R['meta']['new_counts']:
        L += ['| Count | Old | New |', '|---|---|---|']
        keys = sorted(set((R['meta']['old_counts'] or {})) | set((R['meta']['new_counts'] or {})))
        for k in keys:
            L.append(f"| {k} | {(R['meta']['old_counts'] or {}).get(k, '')} | {(R['meta']['new_counts'] or {}).get(k, '')} |")
        L.append('')
    review = [s['title'] for s in R['sections'] if s['review']]
    L += [f"**Needs a look:** {', '.join(review) if review else 'nothing'}", '']
    L += ['| Section | Added | Removed | Changed |', '|---|---|---|---|']
    for s in R['sections']:
        L.append(f"| {s['title']}{' (review)' if s['review'] else ''} | {len(s['added'])} | {len(s['removed'])} | {len(s['changed'])} |")
    L.append('')
    p = R['pools']
    L += ['## Base pools', f"- Bases with new modifiers: {p['bases_with_new_mods']}", f"- Bases losing modifiers: {p['bases_losing_mods']}",
          f"- Bases with renumbered tiers: {p['bases_with_tier_changes']}", '']
    if p['most_changed']:
        L += ['| Base | New mods | Lost mods | Tier changes |', '|---|---|---|---|'] + [f'| {b} | {g} | {l} | {t} |' for b, g, l, t in p['most_changed']] + ['']
    ms = R['mod_summary']
    if ms['families_added']:
        L += ['## New modifier families', ', '.join(ms['families_added'][:120]), '']
    if ms['families_removed']:
        L += ['## Removed modifier families', ', '.join(ms['families_removed'][:120]), '']
    if ms['level_changed']:
        L += ['## Modifier level changes (first 50)', '| Mod | Old | New |', '|---|---|---|'] + [f'| {k} | {a} | {b} |' for k, a, b in ms['level_changed'][:50]] + ['']
    if ms['range_changed']:
        L += ['## Value range changes (first 50)', '| Mod | Old | New |', '|---|---|---|'] + [f"| {k} | {str(a).replace(chr(10), ' / ')} | {str(b).replace(chr(10), ' / ')} |" for k, a, b in ms['range_changed'][:50]] + ['']
    for s in R['sections']:
        if s['title'] in ('Bases', 'Modifiers'):
            continue
        if not (s['added'] or s['removed'] or s['changed']):
            continue
        L += [f"## {s['title']}"]
        if s['added']: L.append('- Added: ' + ', '.join(map(str, s['added'][:80])))
        if s['removed']: L.append('- Removed: ' + ', '.join(map(str, s['removed'][:80])))
        if s['changed']: L.append('- Changed: ' + ', '.join(map(str, s['changed'][:80])))
        L.append('')
    b = next(s for s in R['sections'] if s['title'] == 'Bases')
    if b['added'] or b['removed']:
        L += ['## Bases']
        if b['added']: L.append('- Added: ' + ', '.join(b['added'][:120]))
        if b['removed']: L.append('- Removed: ' + ', '.join(b['removed'][:120]))
        L.append('')
    return '\n'.join(L)

def main(argv):
    if len(argv) < 3:
        print(__doc__); return 2
    old_p, new_p = argv[1], argv[2]
    out_md = argv[argv.index('--out') + 1] if '--out' in argv else None
    out_js = argv[argv.index('--json') + 1] if '--json' in argv else None
    R = report(load(old_p), load(new_p), os.path.basename(old_p), os.path.basename(new_p))
    md = markdown(R)
    if out_md:
        with open(out_md, 'w', encoding='utf-8') as f: f.write(md)
    if out_js:
        with open(out_js, 'w', encoding='utf-8') as f: json.dump(R, f, indent=1, ensure_ascii=False)
    if not out_md:
        print(md)
    else:
        review = [s['title'] for s in R['sections'] if s['review']]
        print(f"report: {out_md}; needs a look: {', '.join(review) if review else 'nothing'}")
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv))
