#!/usr/bin/env python3
"""Download the game data tables the knowledge base is checked against into .kb_cache/gamedata/.

Sources (public, generated from the PoE2 game files; approved by the user on 27 Sept 2026):
  - RePoE fork PoE2 export (github.com/repoe-fork/poe2): mods per base, augments (runes, soul cores, talismans), tags
  - RePoE raw table export (github.com/repoe-fork/dat-export, current/poe2/heuristics/csv): essence, soul core,
    liquid emotion, currency tier and quality tables. Column names there are community guesses; values are the game's.

Usage: python scripts/fetch_gamedata.py [--fresh]
"""
import os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '.kb_cache', 'gamedata')
REPOE = 'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/'
DAT = 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/'
FILES = {name: REPOE + name for name in ['mods_by_base.json', 'augments.json', 'tags.json', 'tag_details.json']}
FILES.update({name + '.csv': DAT + name + '.csv' for name in [
    'EssenceMods', 'Essences', 'EssenceTargetItemCategories', 'EssenceType', 'SoulCores', 'SoulCoreStats',
    'SoulCoreStatCategories', 'SoulCoreLimits', 'SoulCoreTypes', 'LiquidEmotionOutcomes', 'TieredCurrency',
    'CurrencyPerItemClassConditions', 'Incursion2Crafting', 'Expedition2VerisiumCrafts', 'AlternateQualityTypes', 'Tags']})


def main(fresh=False):
    os.makedirs(OUT, exist_ok=True)
    for name, url in FILES.items():
        path = os.path.join(OUT, name)
        if os.path.exists(path) and not fresh:
            continue
        req = urllib.request.Request(url, headers={'User-Agent': 'poe2-craft-assistant-kb-check/1.0'})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
            f.write(r.read())
        print(f'{name}: {os.path.getsize(path):,} bytes')
    print('game data in', OUT)


if __name__ == '__main__':
    main(fresh='--fresh' in sys.argv)
