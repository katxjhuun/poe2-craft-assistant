#!/usr/bin/env python3
"""Unique jewels: what each one is, checked from two sources, into the knowledge base (kb.uniques).

1. Names and item class: RePoE uniques.json (game data). Base types: Exiled Exchange 2 items.ndjson (trade site list).
2. Each unique's lines: poe2db unique pages (in-game wording, ranges), cached in .kb_cache/poe2db.
3. Every line is matched to the game data's unique-generation mods (RePoE mods.json) by text; a line counts as verified
   when a game mod has the same text and range. Lines without a game mod stay, marked unverified.

Writes kb['uniques'] into the knowledge base given by POE2_KB (default poe2_kb_0.5.5.json) and reports/unique-jewels.md.
Usage: python scripts/unique_jewels.py
"""
import collections, json, os, re, sys
from importlib import util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB = os.environ.get('POE2_KB') or os.path.join(ROOT, 'poe2_kb_0.5.5.json')
CACHE = os.environ.get('KB_CACHE') or os.path.join(ROOT, '.kb_cache')
spec = util.spec_from_file_location('bw', os.path.join(ROOT, 'scripts', 'build_weights.py'))
bw = util.module_from_spec(spec); spec.loader.exec_module(bw)
OFFLINE = '--offline' in sys.argv


HIDDEN = re.compile(r'^[a-z][a-z0-9_ %+-]*\[[\d, -]+\]$')
VARIABLE = re.compile(r'\[[A-Za-z]|^Allocates Passive Skill$|Specific Skill|^Random \d|Conquered by|^Historic$')


def game_text(t):
    t = re.sub(r'\[([^\]|]+)\|([^\]]+)\]', r'\2', t or '')
    t = re.sub(r'\[([^\]|]+)\]', r'\1', t).strip()
    return re.sub(r'\((-?[\d.]+)-(-?[\d.]+)\)', lambda m: '(%s-%s)' % tuple(sorted((m.group(1), m.group(2)), key=float)), t)


def page_text(html):
    s = bw.text_of(html)
    s = re.sub(r'[ \t]+', ' ', s).replace('—', '-').replace('–', '-')
    return '\n'.join(l.strip() for l in s.split('\n') if l.strip())


def popups(html):
    """Each unique popup on the page: name, base, properties, requirements, implicit and explicit lines, corrupted."""
    out = []
    for m in re.finditer(r'<div class="newItemPopup UniquePopup.*?(?=<div class="newItemPopup|\Z)', html, re.S):
        block = m.group(0)
        name = re.search(r'<div class="itemName">\s*<span class="lc">(.*?)</span>', block, re.S)
        base = re.search(r'<div class="itemName typeLine">\s*<span class="lc">(.*?)</span>', block, re.S)
        cls_div = lambda c: [page_text(x) for x in re.findall(r'<div class="%s">(.*?)</div>' % c, block, re.S)]
        out.append({
            'name': page_text(name.group(1)) if name else None, 'base': page_text(base.group(1)) if base else None,
            'props': cls_div('property'), 'req': cls_div('requirements'),
            'implicit': cls_div('implicitMod'), 'explicit': cls_div('explicitMod'),
            'corrupted': '<div class="corrupted">' in block,
        })
    return out


def main():
    uniques = json.load(open(os.path.join(CACHE, 'poe2_uniques.json'), encoding='utf-8'))
    mods = json.load(open(os.path.join(CACHE, 'poe2_mods.json'), encoding='utf-8'))
    ee = [json.loads(l) for l in open(os.path.join(CACHE, 'items.ndjson'), encoding='utf-8') if l.strip()]
    ee_base = {i.get('name') or i.get('refName'): (i.get('unique') or {}).get('base') for i in ee if i.get('namespace') == 'UNIQUE'}
    kb = json.load(open(KB, encoding='utf-8'))
    # unique-generation mods by text (jewels use the misc domain)
    by_text = collections.defaultdict(list)
    for mid, m in mods.items():
        if m.get('generation_type') == 'unique' and m.get('domain') in ('misc', 'item'):
            by_text[game_text(m.get('text'))].append(mid)
    names = sorted({v['name'] for v in uniques.values() if v.get('item_class') == 'Jewel'})
    U, lines = {}, ['# Unique jewels', '', 'Sources: RePoE uniques.json (names), Exiled Exchange 2 (base types), poe2db unique pages (lines),',
                    'RePoE mods.json unique mods (text and range check).', '']
    for name in names:
        html = bw.fetch(name.replace(' ', '_'), OFFLINE)
        pops = [p for p in popups(html or '') if p['name'] == name]
        if not pops:
            lines.append(f'- {name}: no poe2db page'); continue
        variants, seen = [], set()
        for p in pops:
            key = (p['base'], tuple(p['explicit']))
            if key in seen: continue
            seen.add(key)
            ml = []
            for t in p['explicit']:
                if HIDDEN.match(t):
                    continue  # internal stat lines poe2db shows in grey, not on the item
                ids = by_text.get(t) or []
                rec = {'txt': t, 'ids': ids[:3], 'verified': bool(ids)}
                if VARIABLE.search(t):
                    rec['variable'] = True  # the item rolls what goes here (a passive, a keystone, random jewel mods)
                ml.append(rec)
            variants.append({'base': p['base'], 'limit': next((x.split(':', 1)[1].strip() for x in p['props'] if x.startswith('Limited To')), None),
                             'radius': next((x.split(':', 1)[1].strip() for x in p['props'] if x.startswith('Radius')), None),
                             'req': ' '.join(p['req']).replace('Requires:', '').strip() or None,
                             'implicit': p['implicit'], 'mods': ml, 'corrupted': p['corrupted']})
        U[name] = {'cls': 'Jewel', 'trade_base': ee_base.get(name), 'variants': variants}
        v0 = variants[0]
        ok = sum(1 for v in variants for m in v['mods'] if m['verified']); n = sum(len(v['mods']) for v in variants)
        lines.append(f"- **{name}** ({', '.join(sorted({v['base'] for v in variants}))}; limit {v0['limit'] or '-'}{'; drops corrupted' if v0['corrupted'] else ''}): "
                     f"{ok} of {n} lines found in the game data")
        for v in variants:
            for m in v['mods']:
                lines.append(f"  - {m['txt'].replace(chr(10), ' / ')}{' (varies per item)' if m.get('variable') else '' if m['verified'] else ' (no game mod with this text)'}")
    kb['uniques'] = U
    kb['meta']['counts']['uniques'] = len(U)
    note = 'uniques = unique jewels (RePoE uniques.json names, poe2db unique pages for their lines, each line checked against the game data unique mods).'
    kb['meta']['rules'] = [r for r in kb['meta']['rules'] if not r.startswith('uniques = ')] + [note]
    json.dump(kb, open(KB, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    open(os.path.join(ROOT, 'reports', 'unique-jewels.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
