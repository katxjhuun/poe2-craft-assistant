#!/usr/bin/env python3
"""PoE2 Craft Assistant - mod weights and essence table from poe2db.tw (third-party).

The game client has no real roll weights (spawn weights are 0/1). poe2db publishes per-mod
"DropChance" weights on its item-class modifier pages; this script reads those pages and maps
each entry onto the knowledge-base mod ids (by prefix/suffix, mod group, mod level and text).

Output: app/data/weights_0.5.5.json
  { meta: {source, fetched, pages, matched, unmatched},
    pages: {page: {cls, weights: {modId: weight}}},   # weights differ per class and armour type
    base_page: {baseName: page},                      # which page applies to each base
    essences: {itemClass: [{item, mod, gen, lvl, perfect, alloy}]} }

Weights are community data, not official: the page labels every chance with the source and date.
Pages are cached in .kb_cache/poe2db/ and fetched politely (one request every 2 s, robots.txt allows).
Usage: python scripts/build_weights.py [--offline]
"""
import json, os, re, sys, time, urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.kb_cache', 'poe2db')
KB = os.environ.get('POE2_KB') or os.path.join(ROOT, 'poe2_kb_0.5.5.json')  # POE2_KB / POE2_WEIGHTS_OUT: a candidate
OUT = os.environ.get('POE2_WEIGHTS_OUT') or os.path.join(ROOT, 'app', 'data', 'weights_0.5.5.json')
UA = 'Mozilla/5.0 (poe2craftassist personal tool)'
os.makedirs(CACHE, exist_ok=True)

PAGES = {
    'Sceptres': 'Sceptre', 'Wands': 'Wand', 'Staves': 'Staff', 'Quarterstaves': 'Warstaff', 'Bows': 'Bow',
    'Crossbows': 'Crossbow', 'Spears': 'Spear', 'One_Hand_Maces': 'One Hand Mace', 'Two_Hand_Maces': 'Two Hand Mace',
    'Talismans': 'Talisman', 'Quivers': 'Quiver', 'Foci': 'Focus', 'Bucklers': 'Buckler',
    'One_Hand_Swords': 'One Hand Sword', 'Two_Hand_Swords': 'Two Hand Sword', 'One_Hand_Axes': 'One Hand Axe',
    'Two_Hand_Axes': 'Two Hand Axe', 'Daggers': 'Dagger', 'Flails': 'Flail',
    'Amulets': 'Amulet', 'Rings': 'Ring', 'Belts': 'Belt', 'Life_Flasks': 'Life Flask', 'Mana_Flasks': 'Mana Flask', 'Charms': 'Charm',
    'Ruby': 'Jewel', 'Emerald': 'Jewel', 'Sapphire': 'Jewel', 'Diamond': 'Jewel',
    'Time-Lost_Ruby': 'Jewel', 'Time-Lost_Emerald': 'Jewel', 'Time-Lost_Sapphire': 'Jewel', 'Time-Lost_Diamond': 'Jewel',
}
for cls, page in [('Body Armour', 'Body_Armours'), ('Helmet', 'Helmets'), ('Gloves', 'Gloves'), ('Boots', 'Boots')]:
    for attr in ['str', 'dex', 'int', 'str_dex', 'str_int', 'dex_int', 'str_dex_int']:
        PAGES[f'{page}_{attr}'] = cls
for attr in ['str', 'str_dex', 'str_int']:
    PAGES[f'Shields_{attr}'] = 'Shield'


def fetch(page, offline):
    path = os.path.join(CACHE, page + '.html')
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()
    if offline:
        return None
    req = urllib.request.Request(f'https://poe2db.tw/us/{page}', headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                html = r.read().decode('utf-8')
            open(path, 'w', encoding='utf-8').write(html)
            time.sleep(2)
            return html
        except urllib.error.HTTPError as e:
            print(f'  {page}: HTTP {e.code}', file=sys.stderr)
            return None
        except Exception as e:  # network stall: one retry
            print(f'  {page}: {e}, retry', file=sys.stderr)
            time.sleep(4)
    return None


def mods_view(html):
    i = html.find('new ModsView(')
    if i < 0:
        return None
    obj, _ = json.JSONDecoder().raw_decode(html[i + len('new ModsView('):])
    return obj


def text_of(html_str):
    s = re.sub(r'<br\s*/?>', '\n', html_str)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('—', '-').replace('&ndash;', '-').replace('–', '-')
    return s


def norm(s):
    s = re.sub(r'\((-?[\d.]+)-(-?[\d.]+)\)', '#', s)
    s = re.sub(r'[+-]?\d+(?:\.\d+)?', '#', s)
    s = s.replace('+#', '#')
    return re.sub(r'\s+', ' ', s).strip().lower()


def main():
    offline = '--offline' in sys.argv
    kb = json.load(open(KB, encoding='utf-8'))
    index = defaultdict(list)
    for mid, m in kb['mods'].items():
        if m['dom'] not in ('i', 'f'):   # natural item mods and flask/charm mods
            continue
        index[(m['gen'], frozenset(m['grp']), m['lvl'])].append(mid)

    per_page = {}
    essences = defaultdict(dict)
    pages_ok, unmatched = 0, []
    for page, cls in PAGES.items():
        html = fetch(page, offline)
        obj = mods_view(html) if html else None
        if not obj:
            print(f'  skipped {page}')
            continue
        pages_ok += 1
        pw = per_page.setdefault(page, {'cls': cls, 'weights': {}})['weights']
        for e in obj.get('normal', []):
            gen = {'1': 'p', '2': 's'}.get(str(e.get('ModGenerationTypeID')))
            if not gen:
                continue
            key = (gen, frozenset(e.get('ModFamilyList') or []), int(e.get('Level') or 0))
            cands = index.get(key, [])
            if len(cands) > 1:
                t = norm(text_of(e.get('str', '')))
                narrowed = [c for c in cands if norm(kb['mods'][c]['txt'].replace('\n', ' ')) == t.replace('\n', ' ')]
                cands = narrowed or cands[:1]
            if not cands:
                unmatched.append(f"{page}: {text_of(e.get('str', ''))[:60]} (lvl {e.get('Level')})")
                continue
            try:
                w = int(float(e.get('DropChance') or 0))
            except ValueError:
                continue
            pw[cands[0]] = w
        for listname in ('essence', 'perfect_essence'):
            for e in obj.get(listname, []):
                code = e.get('Code')
                if not code or code not in kb['mods']:
                    continue
                item = re.sub(r'<[^>]+>', '', e.get('Name', '')).strip()
                # kind: 'magic' = Lesser/normal/Greater essence (Magic -> Rare); 'rare' = Perfect, special essences
                # and alloys (Rare: remove a random mod, add the guaranteed one)
                rec = {'item': item, 'mod': code, 'gen': {'1': 'p', '2': 's'}.get(str(e.get('ModGenerationTypeID')), '?'),
                       'lvl': int(e.get('Level') or 0), 'perfect': bool(e.get('IsPerfect')), 'alloy': bool(e.get('IsAlloy')),
                       'kind': 'magic' if listname == 'essence' else 'rare'}
                essences[cls][item + '|' + code] = rec
        print(f'  {page}: {len(obj.get("normal", []))} mods, {len(obj.get("essence", [])) + len(obj.get("perfect_essence", []))} essence/alloy rows')

    # A page that publishes no weights (every DropChance 0: flasks and charms) is no weight source. Its bases stay on
    # equal weights, which the page labels as an estimate.
    no_weights = sorted(p for p, v in per_page.items() if v['weights'] and not any(v['weights'].values()))
    for p in no_weights:
        del per_page[p]
    if no_weights:
        print('  no published weights (equal weights):', ', '.join(no_weights))

    # base -> page: armour types by their attribute tag, jewels by name, everything else by class
    page_of_cls = defaultdict(list)
    for page, cls in PAGES.items():
        if page in per_page:
            page_of_cls[cls].append(page)
    base_page = {}
    for name, b in kb['bases'].items():
        pages = page_of_cls.get(b['cls'], [])
        if not pages:
            continue
        if len(pages) == 1:
            base_page[name] = pages[0]
            continue
        attr = next((t[:-len('_armour')] for t in b['tags'] if re.fullmatch(r'(str|dex|int)(_dex|_int)*_armour', t)), None)
        want = [p for p in pages if attr and p.endswith('_' + attr)] or [p for p in pages if p.replace('_', ' ') == name]
        if want:
            base_page[name] = want[0]
    matched = len({m for p in per_page.values() for m in p['weights']})
    out = {
        'meta': {
            'source': 'poe2db.tw item-class modifier pages (DropChance)', 'source_url': 'https://poe2db.tw/us/Modifiers',
            'fetched': datetime.now(timezone.utc).strftime('%Y-%m-%d'), 'patch': '0.5.5', 'pages': pages_ok,
            'matched': matched, 'unmatched': len(unmatched), 'bases_mapped': len(base_page), 'pages_without_weights': no_weights,
            'note': 'Community weights, not official. Desecrated mods have no published weights and stay equal.',
        },
        'pages': per_page,
        'base_page': base_page,
        'essences': {cls: sorted(v.values(), key=lambda r: (r['item'], r['mod'])) for cls, v in essences.items()},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), separators=(',', ':'))
    print(json.dumps(out['meta'], indent=1))
    if unmatched:
        print('unmatched examples:', *unmatched[:12], sep='\n  ')


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
