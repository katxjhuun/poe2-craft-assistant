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
    'Amulets': 'Amulet', 'Rings': 'Ring', 'Belts': 'Belt', 'Life_Flasks': 'LifeFlask', 'Mana_Flasks': 'ManaFlask',
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


def exact_text(s):
    """A mod text with its numbers, for telling same-text twins apart (IncreasedMana vs IncreasedManaTwoHandWeapon):
    ranges low to high (the game writes "reduced" ones high to low), one line, lower case."""
    s = s.replace('\u2014', '-').replace('\u2013', '-')
    s = re.sub(r'\((-?[\d.]+)-(-?[\d.]+)\)', lambda m: '(%s-%s)' % tuple(sorted((m.group(1), m.group(2)), key=float)), s)
    # poe2db writes some hybrids' lines in the other order ("+# to Evasion Rating" first): compare them as a set
    return ' | '.join(sorted(re.sub(r'\s+', ' ', l).strip().lower() for l in s.split('\n') if l.strip()))


def template_lines(s):
    """The mod text with numbers as #, lines in any order."""
    return ' | '.join(sorted(norm(l) for l in s.split('\n') if l.strip()))


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
        if m['dom'] != 'i':
            continue
        index[(m['gen'], frozenset(m['grp']), m['lvl'])].append(mid)
    # flask and charm pages are not matched on purpose: those classes are not supported
    # mods that roll on some base of each class: a page's entry belongs to its own class's mod, not to a one-hand
    # or two-hand twin with the same text (IncreasedMana vs IncreasedManaTwoHandWeapon)
    class_pool = defaultdict(set)
    for b in kb['bases'].values():
        p = kb['pools'].get(b.get('sig')) or {}
        for side in ('prefix', 'suffix'):
            class_pool[b['cls']].update(mid for mid, _t in p.get(side, []))

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
                cands = [c for c in cands if c in class_pool[cls]] or cands
            if len(cands) > 1:
                # same text and ranges first, then the same text with any numbers
                raw = text_of(e.get('str', ''))
                exact = [c for c in cands if exact_text(kb['mods'][c]['txt']) == exact_text(raw)]
                narrowed = exact or [c for c in cands if template_lines(kb['mods'][c]['txt']) == template_lines(raw)]
                cands = narrowed or cands[:1]
            if not cands:
                unmatched.append(f"{page}: {text_of(e.get('str', ''))[:60]} (lvl {e.get('Level')})")
                continue
            try:
                w = int(float(e.get('DropChance') or 0))
            except ValueError:
                continue
            for c in cands:  # every twin of this class with the same text (bases differ in which one they roll)
                pw[c] = w
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
    # Bases without a page of their own (all-attribute Grand Manchettes/Cuisses/Visage, the Golden bases): the class's
    # pages merged (a mod keeps the weight its class pages give it). Bases whose implicit adds the ring tag (Grasping
    # Mail forms) also take the Rings page for the ring mods their own page does not list.
    merged = {}
    for name, b in kb['bases'].items():
        pages = page_of_cls.get(b['cls'], [])
        if name in base_page or not pages:
            continue
        key = b['cls'] + ' (all pages)'
        if key not in merged:
            w = {}
            for pg in pages:
                for mid, v in per_page[pg]['weights'].items():
                    w.setdefault(mid, v)
            merged[key] = {'cls': b['cls'], 'weights': w, 'merged_from': pages}
        base_page[name] = key
    for name, b in kb['bases'].items():
        pg = base_page.get(name)
        if 'ring' not in (b.get('tags_added') or []) or not pg or 'Rings' not in per_page:
            continue
        key = pg + ' + Rings'
        if key not in merged:
            w = dict(per_page[pg]['weights']) if pg in per_page else dict(merged[pg]['weights'])
            for mid, v in per_page['Rings']['weights'].items():
                w.setdefault(mid, v)
            merged[key] = {'cls': b['cls'], 'weights': w, 'merged_from': [pg, 'Rings']}
        base_page[name] = key
    per_page.update(merged)
    matched = len({m for p in per_page.values() for m in p['weights']})
    out = {
        'meta': {
            'source': 'poe2db.tw item-class modifier pages (DropChance)', 'source_url': 'https://poe2db.tw/us/Modifiers',
            'fetched': datetime.now(timezone.utc).strftime('%Y-%m-%d'), 'patch': '0.5.5', 'pages': pages_ok,
            'matched': matched, 'unmatched': len(unmatched), 'bases_mapped': len(base_page),
            'note': 'Community weights, not official. Desecrated mods have no published weights and stay equal. Bases without a poe2db page use their class pages merged; Grasping Mail forms add the Rings page for ring mods.',
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
