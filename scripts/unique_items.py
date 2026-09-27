#!/usr/bin/env python3
"""Unique items (every class but flasks and charms): what each one is, checked from two sources, into kb.uniques.

1. Names: RePoE uniques.json (game data). Base types: Exiled Exchange 2 items.ndjson (trade site list), else the poe2db page.
2. Each unique's lines: poe2db unique pages (in-game wording, ranges), cached in .kb_cache/poe2db, fetched one every 2 s.
3. Every line is matched to the game data's unique-generation mods (RePoE mods.json) by text and range; a line counts as
   verified when a game mod has the same text and range. Lines that vary per item (a random passive, a keystone, random
   jewel or desecrated mods, a timeless leader) are marked; other lines without a game mod stay, marked unverified.

Writes kb['uniques'] into the knowledge base given by POE2_KB (default poe2_kb_0.5.5.json) and reports/uniques.md.
Usage: python scripts/unique_items.py [--offline]
"""
import collections, json, os, re, sys, time, urllib.parse, urllib.request
from importlib import util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB = os.environ.get('POE2_KB') or os.path.join(ROOT, 'poe2_kb_0.5.5.json')
CACHE = os.environ.get('KB_CACHE') or os.path.join(ROOT, '.kb_cache')
spec = util.spec_from_file_location('bw', os.path.join(ROOT, 'scripts', 'build_weights.py'))
bw = util.module_from_spec(spec); spec.loader.exec_module(bw)
OFFLINE = '--offline' in sys.argv
SKIP_CLASSES = {'Charm', 'Flask'}  # out of scope (user decision)

HIDDEN = re.compile(r'^[a-z][a-z0-9_ %+-]*\[[\d, -]+\]$')
VARIABLE = re.compile(r'\[[A-Za-z]|^Allocates Passive Skill$|Specific Skill|^Random \d|Conquered by|^Historic$')


def fetch(page):
    """A poe2db page from the cache, or fetched (the name URL-quoted: Mjölner, Atziri's Rule)."""
    path = os.path.join(bw.CACHE, page + '.html')
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()
    if OFFLINE:
        return None
    url = 'https://poe2db.tw/us/' + urllib.parse.quote(page, safe="'")  # poe2db wants the apostrophe as is
    req = urllib.request.Request(url, headers={'User-Agent': bw.UA, 'Accept-Encoding': 'identity'})
    for _ in range(2):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                html = r.read().decode('utf-8')
            open(path, 'w', encoding='utf-8').write(html)
            time.sleep(2)
            return html
        except urllib.error.HTTPError as e:
            print(f'  {page}: HTTP {e.code}', file=sys.stderr)
            return None
        except Exception as e:
            print(f'  {page}: {e}, retry', file=sys.stderr)
            time.sleep(4)
    return None


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
    by_text = collections.defaultdict(list)
    for mid, m in mods.items():
        if m.get('generation_type') == 'unique' and m.get('domain') in ('misc', 'item'):
            by_text[game_text(m.get('text'))].append(mid)
    names = sorted({v['name'] for v in uniques.values() if v.get('item_class') not in SKIP_CLASSES})
    U, missing = {}, []
    lines = ['# Unique items', '', 'Sources: RePoE uniques.json (names), Exiled Exchange 2 (base types), poe2db unique pages (lines),',
             'RePoE mods.json unique mods (text and range check). Flasks and charms are out of scope.', '']
    per_cls = collections.Counter()
    for i, name in enumerate(names):
        html = fetch(name.replace(' ', '_'))
        pops = [p for p in popups(html or '') if p['name'] == name]
        if not pops:
            # poe2db splits some uniques into forms with their own pages (Guiding Palm of the Eye, of the Heart, of the Mind)
            forms = [f[:-5] for f in os.listdir(bw.CACHE) if f.startswith(name.replace(' ', '_') + '_of_') and f.endswith('.html')]
            if not forms and not OFFLINE:
                forms = [name.replace(' ', '_') + suffix for suffix in ('_of_the_Eye', '_of_the_Heart', '_of_the_Mind')]
            for form in forms:
                pops += [p for p in popups(fetch(form) or '') if (p['name'] or '').startswith(name)]
        if not pops:
            missing.append(name); continue
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
                    rec['variable'] = True
                ml.append(rec)
            variants.append({'base': p['base'], 'limit': next((x.split(':', 1)[1].strip() for x in p['props'] if x.startswith('Limited To')), None),
                             'radius': next((x.split(':', 1)[1].strip() for x in p['props'] if x.startswith('Radius')), None),
                             'req': ' '.join(p['req']).replace('Requires:', '').strip() or None,
                             'implicit': p['implicit'], 'mods': ml, 'corrupted': p['corrupted']})
        base = ee_base.get(name) or variants[0]['base']
        cls = (kb['bases'].get(base) or {}).get('cls') or next((kb['bases'][v['base']]['cls'] for v in variants if v['base'] in kb['bases']), None)
        if not cls and 'Timeless' in (base or ''):
            cls = 'Jewel'
        U[name] = {'cls': cls, 'trade_base': ee_base.get(name), 'variants': variants}
        per_cls[cls] += 1
        ok = sum(1 for v in variants for m in v['mods'] if m['verified'] or m.get('variable'))
        n = sum(len(v['mods']) for v in variants)
        lines.append(f"- **{name}** ({cls}; {', '.join(sorted({v['base'] or '?' for v in variants}))}{'; drops corrupted' if variants[0]['corrupted'] else ''}): "
                     f"{ok} of {n} lines matched or marked as varying")
        for v in variants:
            for m in v['mods']:
                if not m['verified'] and not m.get('variable'):
                    lines.append(f"  - no game mod with this text: {m['txt'].replace(chr(10), ' / ')}")
        if (i + 1) % 50 == 0:
            print(f'  {i + 1}/{len(names)}', flush=True)
    kb['uniques'] = U
    kb['meta']['counts']['uniques'] = len(U)
    note = 'uniques = unique items but flasks and charms (RePoE uniques.json names, poe2db unique pages for their lines, each line checked against the game data unique mods).'
    kb['meta']['rules'] = [r for r in kb['meta']['rules'] if not r.startswith('uniques = ')] + [note]
    json.dump(kb, open(KB, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    tot = sum(len(v['mods']) for u in U.values() for v in u['variants'])
    good = sum(1 for u in U.values() for v in u['variants'] for m in v['mods'] if m['verified'] or m.get('variable'))
    head = [f'{len(U)} of {len(names)} uniques read; {good} of {tot} lines match a game mod or vary per item.',
            'By class: ' + ', '.join(f'{c} {n}' for c, n in per_cls.most_common()) + '.',
            ('No poe2db page: ' + ', '.join(missing)) if missing else 'Every unique has a poe2db page.', '']
    open(os.path.join(ROOT, 'reports', 'uniques.md'), 'w', encoding='utf-8').write('\n'.join(lines[:5] + head + lines[5:]) + '\n')
    print('\n'.join(head))


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
