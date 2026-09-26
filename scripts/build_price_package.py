#!/usr/bin/env python3
"""PoE2 Craft Assistant - npm package of the price documents (the price feed the page loads).

    python scripts/build_price_package.py [out_dir] [package_dir]

Reads meta.json and the league documents that scripts/fetch_prices.py wrote (default .kb_cache/out) and writes an npm
package (default npm/prices): prices.js sets globalThis.POE2_PRICE_FEED = {meta, leagues: {doc id: document}} (the
same shape as the page's bundled prices-snapshot.json), prices.json holds the same data, and the version comes from
meta.updatedAt, so every price update is a new version. The GitHub Actions workflow .github/workflows/prices.yml
publishes it; the page loads prices.js from jsDelivr (or unpkg) inside a Web Worker, since the artifact may load
scripts from those CDNs but cannot fetch other sites.

The package also carries the game data version of the newest RePoE PoE2 export, the source of the knowledge base
(meta.gameData). When it is newer than the knowledge base's own version, the page shows that its data may be outdated
(master prompt 3.4) until the knowledge base is rebuilt with scripts/kb_update.py.
"""
import http.client
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = 'poe2-craft-assistant-prices'
REPO = 'https://github.com/katxjhuun/poe2-craft-assistant'
GAME_VERSION_URL = 'https://raw.githubusercontent.com/repoe-fork/poe2/master/version.txt'  # as in poe2_kb_build.py
GAME_VERSION_SOURCE = 'RePoE PoE2 export (github.com/repoe-fork/poe2)'
UA = 'poe2craftassist/0.2 (personal tool; price package)'

README = """# {name}

Path of Exile 2 price documents for the PoE2 Craft Assistant, generated every few hours by a GitHub Actions job.
Unofficial: prices are derived from the official Path of Exile 2 Currency Exchange digest and from poe.ninja data
served by the Exiled Exchange 2 price feed. Not affiliated with or endorsed by Grinding Gear Games.

`prices.js` sets `globalThis.POE2_PRICE_FEED` to `{{meta, leagues}}`; `prices.json` holds the same data.
Built {updated} from {docs} documents.
"""


def version_of(updated_at):
    """1.YYYYMMDD.HHMMSS (no leading zeros in the last part), from an ISO time like 2026-09-26T12:03:28Z."""
    t = datetime.strptime(updated_at, '%Y-%m-%dT%H:%M:%SZ')
    return f'1.{t:%Y%m%d}.{int(t.strftime("%H%M%S"))}'


def game_data_version():
    """Version of the newest RePoE PoE2 export, like 4.5.5.2, or None when it cannot be read."""
    req = urllib.request.Request(GAME_VERSION_URL, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            text = r.read(64).decode('utf-8', 'replace').strip()
    except (OSError, http.client.HTTPException) as e:  # URLError, HTTPError and timeouts are OSErrors
        print(f'game data version not read ({e})', file=sys.stderr)
        return None
    return text if re.fullmatch(r'\d+(\.\d+){1,4}', text) else None


def build_package(out_dir, pkg_dir, game_data=None):
    """Write the package; returns its version. game_data: the newest game data version (game_data_version())."""
    meta = json.load(open(os.path.join(out_dir, 'meta.json'), encoding='utf-8'))
    if game_data:
        meta['gameData'] = {'version': game_data, 'source': GAME_VERSION_SOURCE}
    docs = meta.get('docs') or [l['slug'] for l in meta['leagues']]
    feed = {'meta': meta, 'leagues': {d: json.load(open(os.path.join(out_dir, f'league-{d}.json'), encoding='utf-8')) for d in docs}}
    version = version_of(meta['updatedAt'])
    os.makedirs(pkg_dir, exist_ok=True)
    data = json.dumps(feed, separators=(',', ':'), ensure_ascii=False)
    with open(os.path.join(pkg_dir, 'prices.js'), 'w', encoding='utf-8') as f:
        f.write(f'/* {NAME} {version}: generated price data, no code. */\nglobalThis.POE2_PRICE_FEED = {data};\n')
    with open(os.path.join(pkg_dir, 'prices.json'), 'w', encoding='utf-8') as f:
        f.write(data)
    with open(os.path.join(pkg_dir, 'README.md'), 'w', encoding='utf-8') as f:
        f.write(README.format(name=NAME, updated=meta['updatedAt'], docs=len(docs)))
    pkg = {
        'name': NAME,
        'version': version,
        'description': 'Path of Exile 2 prices (official Currency Exchange digest and poe.ninja data via Exiled Exchange 2) '
                       'for the PoE2 Craft Assistant. Generated, unofficial.',
        'main': 'prices.js',
        'files': ['prices.js', 'prices.json', 'README.md'],
        'keywords': ['path-of-exile-2', 'poe2', 'prices'],
        'license': 'UNLICENSED',
        'repository': {'type': 'git', 'url': 'git+' + REPO + '.git'},
    }
    with open(os.path.join(pkg_dir, 'package.json'), 'w', encoding='utf-8') as f:
        json.dump(pkg, f, indent=2)
        f.write('\n')
    return version


if __name__ == '__main__':
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.kb_cache', 'out')
    pkg_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'npm', 'prices')
    game = game_data_version()
    print(NAME, build_package(out_dir, pkg_dir, game), '->', pkg_dir, '| game data', game or 'unknown')
