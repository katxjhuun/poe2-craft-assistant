#!/usr/bin/env python3
"""Essence -> item class -> guaranteed modifier, read from the game's own tables, and a comparison with the knowledge
base's list (poe2db pages, app/data/weights_0.5.5.json "essences").

Tables (RePoE dat export, .kb_cache/gamedata): Essences (BaseItemType = BaseItemTypes row), EssenceMods (Essence =
Essences row, TargetItemCategory = EssenceTargetItemCategories row, Mod = Mods row), EssenceTargetItemCategories
(ItemClasses = ItemClasses rows). Row numbers resolve through RePoE's base_items.json and mods.json, whose keys keep
the tables' row order (checked: row 87 of BaseItemTypes is Lesser Essence of the Body, Essences row 0).

Usage: python scripts/essences_from_gamedata.py  (writes reports/essences-check.md and .kb_cache/gamedata/essences.json)
"""
import collections, csv, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GD = os.path.join(ROOT, '.kb_cache', 'gamedata')
csv.field_size_limit(10 ** 8)


def rows(name):
    with open(os.path.join(GD, name + '.csv'), encoding='utf-8') as f:
        return list(csv.DictReader(f))


def ints(v):
    v = (v or '').strip('[]')
    return [int(x) for x in v.split(',') if x.strip()] if v else []


def main():
    items = json.load(open(os.path.join(ROOT, '.kb_cache', 'poe2_base_items.json'), encoding='utf-8'))
    mods = json.load(open(os.path.join(ROOT, '.kb_cache', 'poe2_mods.json'), encoding='utf-8'))
    item_keys, mod_keys = list(items.keys()), list(mods.keys())
    classes = rows('ItemClasses') if os.path.exists(os.path.join(GD, 'ItemClasses.csv')) else None
    cat = rows('EssenceTargetItemCategories')
    ess = rows('Essences')
    em = rows('EssenceMods')
    class_ids = [r['Id'] for r in classes] if classes else None
    out = collections.defaultdict(list)  # item class id -> [{essence, mod, category}]
    for r in em:
        e = ess[int(r['Essence'])]
        name = items[item_keys[int(e['BaseItemType'])]]['name']
        c = cat[int(r['TargetItemCategory'])]
        # one guaranteed mod, or one of several with weights (OutcomeMods / OutcomeModWeights, e.g. Essence of the
        # Infinite gives Strength, Dexterity or Intelligence)
        if r['Mod']:
            outcomes = [(mod_keys[int(r['Mod'])], None)]
        else:
            ids, ws = [mod_keys[i] for i in ints(r['OutcomeMods'])], ints(r['OutcomeModWeights'])
            outcomes = list(zip(ids, ws if len(ws) == len(ids) else [None] * len(ids)))  # no weights: the base decides
        for ci in ints(c['ItemClasses']):
            for mod, w in outcomes:
                out[class_ids[ci] if class_ids else ci].append({'essence': name, 'mod': mod, 'weight': w, 'category': c['Id'],
                                                                'perfect': bool(e.get('Perfect')), 'tier': e.get('Tier')})
    json.dump(out, open(os.path.join(GD, 'essences.json'), 'w', encoding='utf-8'), indent=1)
    # compare with the knowledge base's list (poe2db)
    W = json.load(open(os.path.join(ROOT, 'app', 'data', 'weights_0.5.5.json'), encoding='utf-8'))
    kb_ess = W.get('essences') or {}
    lines = ['# Essences: game tables vs the knowledge base (poe2db)', '', '| Class | Game table pairs | KB pairs | Same | Only game | Only KB |', '|---|---|---|---|---|---|']
    alias = {'Body Armour': 'Body Armour', 'Warstaff': 'Warstaff'}
    total = collections.Counter()
    notes = []
    for kcls, recs in sorted(kb_ess.items()):
        game = out.get(kcls) or out.get(kcls.replace(' ', '')) or []
        g = {(x['essence'], x['mod']) for x in game}
        k = {(x['item'], x['mod']) for x in recs}
        same, og, ok = g & k, g - k, k - g
        total.update({'game': len(g), 'kb': len(k), 'same': len(same), 'only game': len(og), 'only kb': len(ok)})
        lines.append(f'| {kcls} | {len(g)} | {len(k)} | {len(same)} | {len(og)} | {len(ok)} |')
        if (og or ok) and len(notes) < 12:
            notes.append(f'- {kcls}: only game {sorted(og)[:3]}; only KB {sorted(ok)[:3]}')
    lines += ['', f"Total: game {total['game']}, KB {total['kb']}, same {total['same']}, only game {total['only game']}, only KB {total['only kb']}", ''] + notes
    open(os.path.join(ROOT, 'reports', 'essences-check.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
