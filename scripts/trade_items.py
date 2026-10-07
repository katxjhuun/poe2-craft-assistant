"""Builds app/data/trade_items_0.5.5.json: every item of the trade item list that is not a piece of gear the knowledge
base already holds as a base: gems, uncut gems, waystones, tablets, relics, charms, flasks, trial keys and everything
that stacks (currency, omens, runes and cores, fragments, keys). The price check reads it to know what a copied item is
and how the trade site wants it searched.

Source: Exiled Exchange 2's items.ndjson (the trade site's item list with Exiled Exchange 2's categories), the file
poe2_kb_build.py already keeps in .kb_cache. Nothing is downloaded here.

    python scripts/trade_items.py
"""
import json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.environ.get('KB_CACHE', os.path.join(ROOT, '.kb_cache')), 'items.ndjson')
OUT = os.path.join(ROOT, 'app', 'data', 'trade_items_0.5.5.json')

# Exiled Exchange 2's category -> the price check's kind. Kinds that are searched as an item of their own:
KIND = {
    'Active Skill Gem': 'gem', 'Support Skill Gem': 'support', 'MetaSkillGem': 'meta', 'UncutSkillGem': 'uncut',
    'Map': 'waystone', 'TowerAugment': 'tablet', 'Relic': 'relic', 'Charm': 'charm', 'Flask': 'flask',
    'MiscMapItem': 'trial', 'ExpeditionLogbook': 'logbook',
}
# ... and what stacks or is traded like currency (the label is shown with the price)
STACK = {
    'Currency': 'Currency', 'Omen': 'Omen', 'SoulCore': 'Rune or core', 'PinnacleKey': 'Fragment', 'MapFragment': 'Fragment',
    'VaultKey': 'Reliquary key', 'QuestItem': 'Fragment', 'Breachstone': 'Fragment', 'Incubator': 'Currency', 'BrequelFruit': 'Wombgift',
}

def main():
    if not os.path.exists(SRC):
        sys.exit('missing ' + SRC + ' (run poe2_kb_build.py once: it fetches the trade item list)')
    kb = json.load(open(os.path.join(ROOT, 'poe2_kb_0.5.5.json'), encoding='utf-8'))
    rows = [json.loads(l) for l in open(SRC, encoding='utf-8') if l.strip()]
    items, uniques, seen = {}, {}, collections.Counter()
    for r in rows:
        name = r.get('refName') or r.get('name')
        cat = (r.get('craftable') or {}).get('category')
        if r.get('namespace') == 'UNIQUE':
            base = (r.get('unique') or {}).get('base')
            # uniques the knowledge base does not hold (charms, flasks, tablets, relics): name -> their bases
            if name and base and name != 'INCOMPLETE' and name not in kb.get('uniques', {}):
                uniques.setdefault(name, [])
                if base not in uniques[name]: uniques[name].append(base)
            continue
        if not name or not cat: continue
        kind = KIND.get(cat) or ('stack' if cat in STACK else None)
        if not kind: continue                      # gear and jewels: the knowledge base's own bases
        e = items.setdefault(name, {'k': kind})
        seen[kind] += 1
        if kind == 'stack' and 'g' not in e: e['g'] = STACK[cat]
        if r.get('tradeTag'): e['t'] = r['tradeTag']
        if kind == 'waystone': e['tier'] = (r.get('map') or {}).get('tier')
        # a lineage support gem trades like currency (it has an exchange tag): keep it a gem, the tag says the rest
    out = {
        'meta': {'source': 'Exiled Exchange 2 items.ndjson (github.com/Kvan7/Exiled-Exchange-2), the trade site\'s item list',
                 'game': kb['meta'].get('patch'), 'kinds': dict(sorted(collections.Counter(v['k'] for v in items.values()).items()))},
        'items': dict(sorted(items.items())),
        'uniques': dict(sorted(uniques.items())),
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, separators=(',', ':'))
    print('wrote', os.path.relpath(OUT, ROOT), os.path.getsize(OUT), 'bytes;', len(items), 'items', out['meta']['kinds'], '; uniques outside the knowledge base:', len(uniques))

if __name__ == '__main__':
    main()
