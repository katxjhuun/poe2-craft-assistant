#!/usr/bin/env python3
"""Add jewel bases and natural jewel mods to poe2_kb_0.5.5.json.

Why: poe2_kb_build.py kept only mods of the "item" domain and dropped bases tagged not_for_sale,
so the knowledge base had no natural jewel mods (Ruby/Emerald/Sapphire pools were empty) and no
Diamond or Time-Lost jewels. Until the build is re-run on the RePoE export with the fix, this step
fills the gap from poe2db jewel pages (already cached in .kb_cache/poe2db by build_weights.py).

Each jewel page (Ruby, Emerald, ..., Time-Lost Diamond) lists the mods that can roll on that base.
A mod gets a synthetic spawn tag per page (p2db_ruby, ...) that is also added to the base, so the
engine's normal "first matching tag" eligibility walk and the precomputed pools stay consistent.

Usage: python scripts/augment_jewels.py   (idempotent: previous augmentation is replaced)
"""
import collections, json, os, re, sys
from importlib import util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB = os.environ.get('POE2_KB') or os.path.join(ROOT, 'poe2_kb_0.5.5.json')  # POE2_KB: augment a candidate KB
BASES = os.path.join(ROOT, '.kb_cache', 'poe2_base_items.json')
EE_ITEMS = os.path.join(ROOT, '.kb_cache', 'items.ndjson')
spec = util.spec_from_file_location('bw', os.path.join(ROOT, 'scripts', 'build_weights.py'))
bw = util.module_from_spec(spec); spec.loader.exec_module(bw)

PAGES = {  # poe2db page -> base name
    'Ruby': 'Ruby', 'Emerald': 'Emerald', 'Sapphire': 'Sapphire', 'Diamond': 'Diamond',
    'Time-Lost_Ruby': 'Time-Lost Ruby', 'Time-Lost_Emerald': 'Time-Lost Emerald',
    'Time-Lost_Sapphire': 'Time-Lost Sapphire', 'Time-Lost_Diamond': 'Time-Lost Diamond',
}
HIDDEN = re.compile(r'^[a-z0-9_ %+-]+\[[\d, -]+\]$')  # internal stat lines poe2db shows in grey


def page_tag(page):
    return 'p2db_' + page.lower().replace('-', '_')


def clean_text(html):
    lines = [l.strip() for l in bw.text_of(html).split('\n')]
    return '\n'.join(l for l in lines if l and not HIDDEN.match(l))


def export_has_jewel_mods(kb):
    """True when the game data export already carries natural jewel mods (poe2_kb_build.py reads the "misc" domain)."""
    tags = {'strjewel', 'dexjewel', 'intjewel'}
    return sum(1 for m in kb['mods'].values() if m.get('dom') == 'i' and m.get('src') != 'poe2db' and any(t in tags and w > 0 for t, w in m.get('sw', []))) >= 50


def main():
    kb = json.load(open(KB, encoding='utf-8'))
    if export_has_jewel_mods(kb) and '--force' not in sys.argv:
        print('the knowledge base already has natural jewel mods from the game data export; poe2db augmentation skipped (--force to add it anyway)')
        return
    # drop a previous augmentation
    for k in [k for k, m in kb['mods'].items() if m.get('src') == 'poe2db']:
        del kb['mods'][k]
    for b in kb['bases'].values():
        b['tags'] = [t for t in b['tags'] if not t.startswith('p2db_')]
    for k in [k for k, b in kb['bases'].items() if b.get('src') == 'poe2db']:
        del kb['bases'][k]

    repoe = json.load(open(BASES, encoding='utf-8'))
    trade = set()
    for line in open(EE_ITEMS, encoding='utf-8'):
        line = line.strip()
        if line:
            j = json.loads(line)
            if j.get('name'):
                trade.add(j['name'])

    # bases
    for meta, v in repoe.items():
        if v.get('item_class') != 'Jewel' or v.get('release_state') != 'released' or v['name'] not in PAGES.values():
            continue
        name = v['name']
        tags = [t for t in v.get('tags') or [] if t != 'not_for_sale']
        page = next(p for p, n in PAGES.items() if n == name)
        tags = [page_tag(page)] + tags
        if name in kb['bases']:
            kb['bases'][name]['tags'] = tags
        else:
            kb['bases'][name] = {'cls': 'Jewel', 'lvl': v.get('drop_level') or 20, 'tags': tags, 'imp': [], 'tl': 1 if name in trade else 0, 'src': 'poe2db'}

    # mods
    found = collections.OrderedDict()
    for page, base in PAGES.items():
        html = bw.fetch(page, True)
        obj = bw.mods_view(html) if html else None
        if not obj:
            print('missing page', page, file=sys.stderr)
            continue
        for e in obj.get('normal', []):
            gen = {'1': 'p', '2': 's'}.get(str(e.get('ModGenerationTypeID')))
            if not gen:
                continue
            fams = e.get('ModFamilyList') or []
            txt = clean_text(e.get('str', ''))
            if not txt:
                continue
            key = (gen, tuple(fams), int(e.get('Level') or 0), txt)
            rec = found.setdefault(key, {'pages': [], 'e': e})
            rec['pages'].append(page)
    used = set()
    added = 0
    for (gen, fams, lvl, txt), rec in found.items():
        fam = '+'.join(fams) if fams else 'Jewel'
        base_id = 'P2DB_' + re.sub(r'[^A-Za-z0-9]+', '', fam) + '_' + gen + str(lvl)
        mid, n = base_id, 2
        while mid in used or mid in kb['mods']:
            mid = f'{base_id}_{n}'; n += 1
        used.add(mid)
        kb['mods'][mid] = {
            'fam': fam, 'gen': gen, 'lvl': lvl, 'txt': txt, 'st': [],
            'mt': rec['e'].get('fossil_no') or [], 'grp': list(fams),
            'sw': [[page_tag(p), 1] for p in rec['pages']] + [['default', 0]], 'dom': 'i', 'src': 'poe2db',
        }
        added += 1

    # recompute signatures and pools for jewel bases
    sigs = {tuple(sorted(v)): k for k, v in kb['tag_signatures'].items()}
    nat = [(k, m) for k, m in kb['mods'].items() if m['dom'] == 'i']

    def eligible(tags, sw):
        ts = set(tags)
        for t, w in sw:
            if t in ts:
                return w > 0
        return False

    def tiers(ids):
        fam = collections.defaultdict(list)
        for i in ids:
            fam[kb['mods'][i]['fam']].append(i)
        out = []
        for lst in fam.values():
            lst.sort(key=lambda i: -(kb['mods'][i]['lvl'] or 0))
            out += [[i, t + 1] for t, i in enumerate(lst)]
        return out

    for name, b in kb['bases'].items():
        if b['cls'] != 'Jewel':
            continue
        key = tuple(sorted(b['tags']))
        if key not in sigs:
            sid = 'S%d' % len(kb['tag_signatures'])
            while sid in kb['tag_signatures']:
                sid = 'S%d' % (int(sid[1:]) + 1)
            sigs[key] = sid
            kb['tag_signatures'][sid] = list(key)
        sid = sigs[key]
        b['sig'] = sid
        kb['pools'][sid] = {
            'prefix': tiers([k for k, m in nat if m['gen'] == 'p' and eligible(b['tags'], m['sw'])]),
            'suffix': tiers([k for k, m in nat if m['gen'] == 's' and eligible(b['tags'], m['sw'])]),
            # Corruption Enhancements of jewels are the misc-domain ones (see poe2_kb_build.py)
            'corrupted': sorted(k for k, m in kb['mods'].items() if m['dom'] == 'c' and m.get('cdom') == 'misc' and eligible(b['tags'], m['sw'])),
        }

    c = kb['meta']['counts']
    c['bases'] = len(kb['bases']); c['mods'] = len(kb['mods']); c['tag_signatures'] = len(kb['tag_signatures'])
    c['natural_item_mods'] = sum(1 for m in kb['mods'].values() if m['dom'] == 'i')
    note = ('Jewel mods (src: poe2db) and Diamond/Time-Lost jewel bases were added on 2026-09-25 by scripts/augment_jewels.py '
            'because the RePoE build dropped the jewel mod domain and not_for_sale bases. Jewel weights on poe2db are all equal.')
    kb['meta']['rules'] = [r for r in kb['meta']['rules'] if not r.startswith('Jewel mods (src: poe2db)')] + [note]
    json.dump(kb, open(KB, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    jb = {n: (len(kb['pools'][b['sig']]['prefix']), len(kb['pools'][b['sig']]['suffix'])) for n, b in kb['bases'].items() if b['cls'] == 'Jewel'}
    print(f'added {added} jewel mods; jewel bases (prefix, suffix pool sizes): {jb}')


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
