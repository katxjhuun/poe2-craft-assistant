#!/usr/bin/env python3
"""Download the icons of priced items that have none yet into .kb_cache/icons/<short id>.png.

The icons are PoE2 art from web.poecdn.com. Only the signed /gen/image/ URLs serve PoE2 art (the plain /image/ path
serves PoE1 art); they come from the Exiled Exchange 2 item list (.kb_cache/items.ndjson), matched by item name.
Each image is downloaded once and copied for every item that shares it. Afterwards run scripts/build_icons.py (packs
them into app/data/icons.json) and node app/build.js.

Usage: python scripts/fetch_icons.py            (download what is missing)
       python scripts/fetch_icons.py --dry-run  (only count it)
"""
import http.client, json, os, re, sys, time, urllib.error, urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.kb_cache')
ICON_DIR = os.path.join(CACHE, 'icons')
ITEMS = os.path.join(CACHE, 'items.ndjson')
OUT_DIR = os.path.join(CACHE, 'out')
SNAPSHOT = os.path.join(ROOT, 'app', 'dist', 'data', 'prices-snapshot.json')
PACKED = os.path.join(ROOT, 'app', 'data', 'icons.json')  # includes aliases (items sharing another item's art)
PREFIX = 'https://web.poecdn.com/gen/image/'
UA = 'poe2craftassist/0.2 (personal tool; item icons)'
PAUSE = 0.25  # seconds between downloads


def priced_items():
    """{short id: name} of every item in the latest price documents (.kb_cache/out, else the page's snapshot)."""
    docs = []
    meta_path = os.path.join(OUT_DIR, 'meta.json')
    if os.path.exists(meta_path):
        meta = json.load(open(meta_path, encoding='utf-8'))
        for d in meta.get('docs') or [l['slug'] for l in meta['leagues']]:
            docs.append(json.load(open(os.path.join(OUT_DIR, f'league-{d}.json'), encoding='utf-8')))
    else:
        docs = list(json.load(open(SNAPSHOT, encoding='utf-8'))['leagues'].values())
    items = {}
    for doc in docs:
        for sid, row in doc['items'].items():
            items.setdefault(sid, row[0])
    return items


def icon_urls():
    """{item name: PoE2 icon URL} from the Exiled Exchange 2 item list (entries without art say %NOT_FOUND%)."""
    by_name = {}
    for line in open(ITEMS, encoding='utf-8'):
        e = json.loads(line)
        url = e.get('icon') or ''
        if not url.startswith(PREFIX):
            continue
        for n in (e.get('name'), e.get('refName')):
            if n:
                by_name.setdefault(n, url)
    return by_name


def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read()
            if not data.startswith(b'\x89PNG'):
                raise ValueError('not a PNG image')
            return data
        except urllib.error.HTTPError as e:
            print(f'  HTTP {e.code}: {url}', file=sys.stderr)
            return None  # never retry 4xx/5xx
        except (TimeoutError, urllib.error.URLError, ConnectionError, http.client.IncompleteRead, ValueError) as e:
            print(f'  retry {attempt + 1}/3 ({e})', file=sys.stderr)
            time.sleep(3)
    return None


def main(dry_run=False):
    os.makedirs(ICON_DIR, exist_ok=True)
    have = {f[:-4] for f in os.listdir(ICON_DIR) if f.endswith('.png')}
    packed = set(json.load(open(PACKED, encoding='utf-8'))) if os.path.exists(PACKED) else set()
    want = {sid: name for sid, name in priced_items().items()
            if sid not in have and sid not in packed and re.fullmatch(r'[A-Za-z0-9_]+', sid)}
    urls = icon_urls()
    by_url = defaultdict(list)
    for sid, name in want.items():
        if name in urls:
            by_url[urls[name]].append(sid)
    unknown = sorted(name for name in want.values() if name not in urls)
    print(f'{len(want)} priced items without an icon: {sum(map(len, by_url.values()))} in the Exiled Exchange 2 list '
          f'({len(by_url)} images), {len(unknown)} not' + (f': {", ".join(unknown[:10])}' if unknown else ''))
    if dry_run:
        return 0
    done = failed = 0
    for i, (url, sids) in enumerate(by_url.items()):
        data = download(url)
        if data is None:
            failed += 1
        else:
            for sid in sids:
                with open(os.path.join(ICON_DIR, sid + '.png'), 'wb') as f:
                    f.write(data)
            done += 1
        if (i + 1) % 50 == 0:
            print(f'  {i + 1}/{len(by_url)} images')
        time.sleep(PAUSE)
    print(f'downloaded {done} of {len(by_url)} images, {failed} failed' + (' (run again to retry)' if failed else ''))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(dry_run='--dry-run' in sys.argv))
