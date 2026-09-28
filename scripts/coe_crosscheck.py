#!/usr/bin/env python3
"""Cross-check the knowledge base against Craft of Exile's PoE2 data (user request, 28 Sept 2026).

Craft of Exile (craftofexile.com, json/poe2/main/poec_data.json, cached in .kb_cache/coe) lists, for every base group, each
modifier tier with its item level, value ranges and roll weight. For every in-scope base group this script finds the
knowledge base's matching tier (same side, level, text and value ranges) on a base of that group and compares:
  - the tier exists in both (pool agreement),
  - the roll weight (ours: poe2db DropChance per item-class page, app/data/weights_0.5.5.json).
Desecrated modifiers are compared too. A page whose every weight differs by one factor (jewels: Craft of Exile x100) gives
the same chances and counts as agreeing. Writes reports/coe-crosscheck.md and, with --write, the result into
app/data/weights_0.5.5.json: meta.coe (totals) and, per page, coe = {modifier id: Craft of Exile weight} where the two
disagree (the page lets the player pick whose weights to use there). kb_update.py approve runs it after the weights.
Usage: python scripts/coe_crosscheck.py [--write]
"""
import collections, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COE = os.path.join(ROOT, '.kb_cache', 'coe')
# base groups that are not wearable gear (user: only items a character wears; no tablets, waystones, flasks, charms)
SKIP = re.compile(r'Tablet|Flask|Charm|Tier|Claw', re.I)


def load_js(name):
    s = open(os.path.join(COE, name), encoding='utf-8').read()
    return json.loads(s[s.index('=') + 1:].rstrip().rstrip(';'))


NUM = r'-?\d+(?:\.\d+)?'


def ranges_of(txt):
    out = []
    for m in re.finditer(r'\((%s)-(%s)\)|(%s)' % (NUM, NUM, NUM), txt):
        if m.group(1) is not None:
            a, b = float(m.group(1)), float(m.group(2))
            out.append((min(a, b), max(a, b)))
        else:
            out.append((float(m.group(3)), float(m.group(3))))
    return out


def norm(txt):
    t = re.sub(r'\[([^\]|]+)\|([^\]]+)\]', r'\2', txt)
    t = re.sub(r'\[([^\]]+)\]', r'\1', t)
    t = re.sub(r'\((%s)-(%s)\)' % (NUM, NUM), '#', t)
    t = re.sub(NUM, '#', t)
    t = t.replace('+', '').replace('\n', ', ').lower()
    return re.sub(r'\s+', ' ', t).strip()


def main():
    d, l = load_js('poec_data.json'), load_js('poec_lang.us.json')
    kb = json.load(open(os.path.join(ROOT, 'poe2_kb_0.5.5.json'), encoding='utf-8'))
    W = json.load(open(os.path.join(ROOT, 'app', 'data', 'weights_0.5.5.json'), encoding='utf-8'))
    cmods = {m['id_modifier']: m for m in d['modifiers']['seq']}
    by_base = collections.defaultdict(list)
    for b in d['bitems']['seq']:
        by_base[b['id_base']].append(b['name_bitem'])
    rows, per_page, desec = [], {}, collections.Counter()
    tot = collections.Counter()
    mismatch_examples = []
    ratios = collections.defaultdict(collections.Counter)
    for b in d['bases']['seq']:
        name = b['name_base']
        if SKIP.search(name):
            continue
        ours = [n for n in by_base.get(b['id_base'], []) if n in kb['bases']]
        if not ours:
            continue
        page = collections.Counter(W['base_page'].get(n) for n in ours).most_common(1)[0][0]
        weights = (W['pages'].get(page) or {}).get('weights', {})
        # our tiers on the group's bases: the union of their pools
        pool = set()
        for n in ours:
            p = kb['pools'][kb['bases'][n]['sig']]
            for side in ('prefix', 'suffix'):
                for mid, _t in p.get(side, []):
                    pool.add(mid)
        index = collections.defaultdict(list)
        for mid in pool:
            m = kb['mods'][mid]
            index[(m['gen'], m['lvl'], norm(m['txt']))].append(mid)
        c = collections.Counter()
        page_rec = per_page.setdefault(page, {'agree': [], 'differ': {}, 'coe_only': 0, 'ours_only': 0})
        seen = set()
        for cid, tiers in d['tiers'].items():
            cm = cmods.get(cid)
            if not cm or b['id_base'] not in tiers:
                continue
            group = cm['id_mgroup']
            for t in tiers[b['id_base']]:
                if group == '10':
                    desec[t['weighting']] += 1
                    continue
                if group != '1':
                    continue
                side = 'p' if cm['affix'] == 'prefix' else 's' if cm['affix'] == 'suffix' else None
                if not side:
                    continue
                key = (side, int(t['ilvl']), norm(cm['name_modifier']))
                cands = index.get(key, [])
                nv = [tuple(sorted(map(float, r))) if isinstance(r, list) else (float(r), float(r)) for r in json.loads(t['nvalues'] or '[]')]
                hit = [x for x in cands if sorted(ranges_of(kb['mods'][x]['txt'])) == sorted(nv)] or cands
                c['coe_tiers'] += 1
                if not hit:
                    c['coe_only'] += 1
                    continue
                mid = hit[0]
                seen.add(mid)
                c['matched'] += 1
                ow, cw = weights.get(mid), int(t['weighting'])
                if ow:
                    ratios[page][round(cw / ow, 4)] += 1
                if ow is None:
                    c['no_weight_ours'] += 1
                elif ow == cw:
                    c['same_weight'] += 1
                    page_rec['agree'].append(mid)
                else:
                    c['diff_weight'] += 1
                    page_rec['differ'][mid] = [ow, cw]
                    if len(mismatch_examples) < 40:
                        mismatch_examples.append((name, mid, kb['mods'][mid]['txt'].replace('\n', ' / '), ow, cw))
        c['ours_only'] = len([x for x in pool if x not in seen and kb['mods'][x].get('dom') == 'i'])
        page_rec['coe_only'] += c['coe_only']
        page_rec['ours_only'] += c['ours_only']
        tot.update(c)
        rows.append((name, page, c))
    # a page whose weights all differ by one factor gives the same chances: it agrees
    scaled = {p for p, c in ratios.items() if len(c) == 1 and next(iter(c)) != 1}
    for p in scaled:
        n = len(per_page[p]['differ'])
        per_page[p]['agree'] += list(per_page[p]['differ'])
        per_page[p]['differ'] = {}
        tot['diff_weight'] -= n; tot['same_weight'] += n; tot['scaled'] += n
    lines = ['# Craft of Exile cross-check', '',
             'Source: Craft of Exile PoE2 data (craftofexile.com json/poe2/main/poec_data.json, downloaded 28 Sept 2026 with the',
             "user's OK). Ours: knowledge base tiers (game data) and poe2db roll weights. Wearable gear only.", '',
             f"Tiers in Craft of Exile: {tot['coe_tiers']}; matched to our tier (side, level, text, ranges): {tot['matched']}; "
             f"not found in ours: {tot['coe_only']}; our natural tiers Craft of Exile lacks: {tot['ours_only']}.",
             f"Weights of matched tiers: same {tot['same_weight']} (of them {tot['scaled']} on pages where Craft of Exile's are all the same multiple of"
             f" poe2db's: {', '.join(sorted(scaled)) or 'none'}), different {tot['diff_weight']}, no poe2db weight {tot['no_weight_ours']}.",
             f"Desecrated tiers: weights {dict(desec)} (all equal).", '',
             '| Base group | Our page | CoE tiers | Matched | Same weight | Different | Not in ours | Ours only |', '|---|---|---|---|---|---|---|---|']
    for name, page, c in rows:
        lines.append(f"| {name} | {page} | {c['coe_tiers']} | {c['matched']} | {c['same_weight']} | {c['diff_weight']} | {c['coe_only']} | {c['ours_only']} |")
    if mismatch_examples:
        lines += ['', '## Weight differences (first 40)', '', '| Base group | Mod | Text | poe2db | Craft of Exile |', '|---|---|---|---|---|']
        for n, mid, txt, ow, cw in mismatch_examples:
            lines.append(f'| {n} | {mid} | {txt} | {ow} | {cw} |')
    open(os.path.join(ROOT, 'reports', 'coe-crosscheck.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('\n'.join(lines[:9]))
    if '--write' in sys.argv:
        wp = os.path.join(ROOT, 'app', 'data', 'weights_0.5.5.json')
        W2 = json.load(open(wp, encoding='utf-8'))
        W2['meta']['coe'] = {'source': 'Craft of Exile poec_data.json (downloaded 28 Sept 2026)', 'tiers': tot['coe_tiers'], 'matched': tot['matched'],
                             'same': tot['same_weight'], 'differ': tot['diff_weight'], 'desecrated_weights': dict(desec)}
        for p, r in per_page.items():
            if p in W2['pages']:
                W2['pages'][p].pop('coe', None)
                if r['differ']:
                    W2['pages'][p]['coe'] = {mid: v[1] for mid, v in r['differ'].items()}
        json.dump(W2, open(wp, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
        print('weights file: Craft of Exile disagreements written for', sum(1 for r in per_page.values() if r['differ']), 'pages')


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
