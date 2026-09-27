#!/usr/bin/env python3
"""Read three small game tables and compare them with the knowledge base and the planner (reports/gamedata-extras.md):

  TieredCurrency          Greater/Perfect currency tiers and their Minimum Modifier Level
  LiquidEmotionOutcomes   the guaranteed mod each liquid emotion adds on each jewel (prefix or suffix)
  AlternateQualityTypes   catalyst quality types, the catalyst that gives each and the item classes it applies to

Rows refer to BaseItemTypes, Mods and ItemClasses by row number; RePoE's base_items.json and mods.json keep the row
order (checked in scripts/essences_from_gamedata.py). Run python scripts/fetch_gamedata.py first.
Usage: python scripts/gamedata_extras.py
"""
import csv, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GD = os.path.join(ROOT, '.kb_cache', 'gamedata')


def table(name):
    with open(os.path.join(GD, name + '.csv'), encoding='utf-8') as f:
        return list(csv.DictReader(f))


def ints(v):
    v = (v or '').strip('[]')
    return [int(x) for x in v.split(',') if x.strip()] if v else []


def main():
    items = json.load(open(os.path.join(ROOT, '.kb_cache', 'poe2_base_items.json'), encoding='utf-8'))
    mods = json.load(open(os.path.join(ROOT, '.kb_cache', 'poe2_mods.json'), encoding='utf-8'))
    kb = json.load(open(os.path.join(ROOT, 'poe2_kb_0.5.5.json'), encoding='utf-8'))
    ik, mk = list(items.keys()), list(mods.keys())
    name = lambda row: items[ik[int(row)]]['name']
    classes = [r['Id'] for r in table('ItemClasses')]
    lines = ['# Game tables: currency tiers, liquid emotions, catalyst quality', '']

    # 1. currency tiers vs crafting_ops.min_mod_level
    lines += ['## Currency tiers (TieredCurrency)', '', '| Currency | Tier | Minimum Modifier Level | Knowledge base | Same |', '|---|---|---|---|---|']
    kb_floor = {}
    for op in kb['crafting_ops']:
        for tier, lvl in (op.get('min_mod_level') or {}).items():
            for n in op['names']:
                if n.startswith(tier):
                    kb_floor[n] = lvl
    same = total = 0
    for r in table('TieredCurrency'):
        n, lvl = name(r['BaseItemType']), int(r['MinimumModLevel'])
        k = kb_floor.get(n)
        total += 1
        same += k == lvl
        lines.append(f"| {n} | {r['Tier']} | {lvl} | {k if k is not None else '-'} | {'yes' if k == lvl else 'NO'} |")
    lines += ['', f'{same} of {total} identical.', '']

    # 2. liquid emotions
    # a jewel can have a prefix and a suffix outcome (Potent Liquid Ferocity and Contempt): one of them is added
    emo = {}
    for r in table('LiquidEmotionOutcomes'):
        e = {'radius': r['RadiusJewel'] == '1', 'by_jewel': {}}
        for jewel in ('Ruby', 'Emerald', 'Sapphire', 'Diamond'):
            for side in ('Prefix', 'Suffix'):
                v = r[jewel + side]
                if v:
                    mid = mk[int(v)]
                    e['by_jewel'].setdefault(jewel, []).append({'side': side.lower(), 'mod': mid, 'text': mods[mid].get('text')})
        emo[name(r['BaseItemType'])] = e
    json.dump(emo, open(os.path.join(GD, 'liquid_emotions.json'), 'w', encoding='utf-8'), indent=1)
    kb_lq = kb.get('liquid_emotions') or {}
    same = sum(1 for n, e in emo.items() if n in kb_lq and {(('Time-Lost ' + j) if e['radius'] else j): len(v) for j, v in e['by_jewel'].items()}
               == {b: len(ids) for b, ids in kb_lq[n]['by_base'].items()})
    lines += ['## Liquid emotions (LiquidEmotionOutcomes)', '',
              f'{len(emo)} emotions; each adds one guaranteed crafted mod per jewel (Potent Ferocity and Contempt: a prefix or a suffix one). '
              f'Knowledge base (liquid_emotions): {same} of {len(emo)} with the same jewels and outcome counts.', '',
              '| Emotion | Jewels | Outcomes |', '|---|---|---|']
    for n, e in emo.items():
        outs = '; '.join(f"{j}: " + ' or '.join(f"{x['mod']} ({x['side']})" for x in v) for j, v in e['by_jewel'].items())
        lines.append(f"| {n} | {'Time-Lost' if e['radius'] else 'Basic'} | {outs} |")
    lines.append('')

    # 3. catalyst quality types
    lines += ['## Catalyst quality types (AlternateQualityTypes)', '', '| Quality type | Catalyst | Item classes |', '|---|---|---|']
    for r in table('AlternateQualityTypes'):
        cat = name(r['Item']) if r['Item'] else '-'
        lines.append(f"| {r['Description']} | {cat} | {', '.join(classes[i] for i in ints(r['ItemClass']))} |")
    open(os.path.join(ROOT, 'reports', 'gamedata-extras.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
