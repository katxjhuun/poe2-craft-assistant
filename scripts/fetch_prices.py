#!/usr/bin/env python3
"""PoE2 Craft Assistant - Currency Exchange price snapshot.

Pulls the official hourly Currency Exchange digest
(GET https://web.poecdn.com/api/currency-exchange/poe2/{hour_id}), keeps the last 24 complete
hours on disk, and writes one JSON document per league with 24h volume-weighted median prices
in Exalted Orbs. The local price server (scripts/prices_mcp.py, run by the Claude desktop app) calls refresh()
every hour, and the page copies the documents into the artifact's database; `python scripts/fetch_prices.py`
does the same update by hand.

Price model (see bilgi bankasi 12 and master prompt 8.2):
  * volume_traded of a market "A|B" holds the units of A and B that changed hands that hour,
    so vol[B] / vol[A] is the hour's volume-weighted price of A in B.
  * Prices in Exalted: direct A|Exalted markets, or via Divine / Chaos using that hour's
    Exalted rate for the bridge currency (24h rate as fallback).
  * Price = weighted median of the hourly samples (weight = units of the item traded);
    low/high = weighted 10th/90th percentile; change = last 3h mean vs first 3h mean.

Usage: python scripts/fetch_prices.py               (fetch new hours + build docs)
       python scripts/fetch_prices.py --offline     (rebuild docs from the cache only)
       python scripts/fetch_prices.py --crosscheck  (also compare with poe2db.tw and write a report)

Main source on request of the player (2026-09-26): the price feed of Exiled Exchange 2 (the price-check overlay), which
serves poe.ninja's PoE2 economy data per league: currency exchange items in Divine Orbs with 7-day trends, and unique
item prices. Unofficial; each league document says so, and items the feed does not list are filled from the official
digest (marked). The official digest is kept as its own document per league ("official-<slug>") for the page's
source switch and as the fallback when the feed is unreachable.

Second source (master prompt 8.3): poe2db.tw's economy pages mirror the same official exchange for the challenge league
(Runes of Aldur; its hourly rates matched ours exactly on 2026-09-26). It is used to cross-check the numbers, and as an
unofficial fallback for that league when the official digest has not delivered for 3 hours.
Only documented public endpoints are used. HTTP/1.1 is forced (HTTP/2 stalls on this CDN).
"""
import html as htmllib
import http.client, json, os, re, shutil, sys, time, urllib.parse, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# POE2_CACHE / POE2_BASE_ITEMS / POE2_ICON_IDS let the cloud price job run the script outside this project folder
CACHE = os.environ.get('POE2_CACHE') or os.path.join(ROOT, '.kb_cache')
CX_DIR = os.path.join(CACHE, 'cx')
OUT_DIR = os.path.join(CACHE, 'out')
BASE_ITEMS = os.environ.get('POE2_BASE_ITEMS') or os.path.join(CACHE, 'poe2_base_items.json')
if not os.path.exists(BASE_ITEMS):  # a fresh copy of the project (the cloud job): the slim list app/build.js writes
    BASE_ITEMS = os.path.join(ROOT, 'scripts', 'data', 'poe2_base_items.min.json')
ICON_DIR = os.path.join(CACHE, 'icons')
ICON_IDS = os.environ.get('POE2_ICON_IDS') or os.path.join(ROOT, 'scripts', 'data', 'icon_ids.json')  # without the icon folder
URL = 'https://web.poecdn.com/api/currency-exchange/poe2/{}'
UA = 'OAuth poe2craftassist/0.2 (personal tool)'
HOURS = 24

EX = 'Metadata/Items/Currency/CurrencyAddModToRare'
DIV = 'Metadata/Items/Currency/CurrencyModValues'
CHAOS = 'Metadata/Items/Currency/CurrencyRerollRare'
FIELDS = ['name', 'cat', 'ex', 'lo', 'hi', 'vol', 'chg', 'icon']
MIN_ITEMS = 20  # leagues with fewer traded items (dead or tiny private leagues) are skipped

os.makedirs(CX_DIR, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)


def icon_ids():
    """Ids of the item icons the page has (the price rows flag them)."""
    if os.path.isdir(ICON_DIR):
        return {f[:-4] for f in os.listdir(ICON_DIR)}
    if ICON_IDS and os.path.exists(ICON_IDS):
        return set(json.load(open(ICON_IDS, encoding='utf-8')))
    return set()


def rate_wait(headers):
    """Seconds to wait before the next request, from GGG's documented rate-limit headers.

    X-Rate-Limit-Rules: ip,account             rule names
    X-Rate-Limit-<Rule>: 10:60:120,30:300:600   per window: max hits : period (s) : restriction (s)
    X-Rate-Limit-<Rule>-State: 9:60:0,...       per window: hits so far : period (s) : active restriction (s)
    An active restriction is waited out; a window one hit from its limit waits its whole period.
    """
    if not headers:
        return 0
    get = headers.get
    wait = 0
    for rule in [x.strip() for x in (get('X-Rate-Limit-Rules') or '').split(',') if x.strip()]:
        name = rule[:1].upper() + rule[1:]
        limits = get(f'X-Rate-Limit-{name}') or get(f'X-Rate-Limit-{rule}') or ''
        states = get(f'X-Rate-Limit-{name}-State') or get(f'X-Rate-Limit-{rule}-State') or ''
        for lim, st in zip(limits.split(','), states.split(',')):
            try:
                mx, period, _ = (int(v) for v in lim.split(':'))
                hits, _, active = (int(v) for v in st.split(':'))
            except ValueError:
                continue
            if active > 0:
                wait = max(wait, active)
            elif hits >= mx - 1:
                wait = max(wait, period)
    return wait


def fetch(hour_id):
    req = urllib.request.Request(URL.format(hour_id), headers={
        'User-Agent': UA, 'Accept': 'application/json', 'Accept-Encoding': 'identity'})
    limited = False
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:  # a normal hour downloads in 2-3 s; a stall stays silent
                data = json.loads(r.read().decode('utf-8'))
                wait = rate_wait(getattr(r, 'headers', None))
                if wait:
                    print(f'near the rate limit, waiting {wait}s', file=sys.stderr)
                    time.sleep(min(wait, 900))
                return data
        except urllib.error.HTTPError as e:
            if e.code == 429 and not limited:
                limited = True
                wait = int(e.headers.get('Retry-After') or 0) or rate_wait(e.headers) or 60
                print(f'rate limited, waiting {wait}s', file=sys.stderr)
                time.sleep(min(wait, 900))
                continue
            raise  # never retry other 4xx/5xx: repeated invalid requests get the client restricted
        except (TimeoutError, urllib.error.URLError, ConnectionError, http.client.IncompleteRead) as e:
            # The CDN occasionally stalls mid-body; a fresh connection usually completes in ~2s.
            print(f'hour {hour_id}: network stall ({e}), retry {attempt + 1}/3', file=sys.stderr)
            time.sleep(3)
    return None


POE2DB_URL = 'https://poe2db.tw/us/Economy_{}'
POE2DB_UA = 'Mozilla/5.0 (poe2craftassist personal tool)'
POE2DB_LEAGUE = 'Runes of Aldur'  # the league poe2db's economy pages show (hourly rates checked against ours)
POE2DB_SOURCE = 'poe2db.tw economy pages (unofficial mirror of the official Currency Exchange)'
OFFICIAL_SOURCE = 'Path of Exile 2 Currency Exchange (official hourly digest)'
# one market row: "<amount> <item A> <-> <amount> <item B>", then the 24h volume (in Divine Orbs on the Divine page)
_P2_ROW = re.compile(r'<tr><td>\s*([\d.,]+)\s*<a href="Economy_[^"]*">(?:<img[^>]*>)?([^<]+)</a>\s*<i class="fa-solid fa-left-right[^"]*"></i>\s*'
                     r'([\d.,]+)\s*<a href="Economy_[^"]*">(?:<img[^>]*>)?([^<]+)</a></td><td><div class="text-end">([\d.,]+)', re.S)


def poe2db_page(slug):
    """One poe2db economy page (polite: plain GET, identified user agent). Returns HTML or None."""
    req = urllib.request.Request(POE2DB_URL.format(slug), headers={'User-Agent': POE2DB_UA, 'Accept-Encoding': 'identity'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode('utf-8', 'replace')
    except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as e:
        print(f'poe2db {slug}: {e}', file=sys.stderr)
        return None


def poe2db_divine_markets(page):
    """{item name: (price in Divine Orbs, 24h volume in Divine Orbs)} from poe2db's Divine Orb page."""
    out = {}
    for a, na, b, nb, vol in _P2_ROW.findall(page or ''):
        a, b = float(a.replace(',', '')), float(b.replace(',', ''))
        na, nb, vol = htmllib.unescape(na).strip(), htmllib.unescape(nb).strip(), float(vol.replace(',', ''))
        if a <= 0 or b <= 0:
            continue
        if nb == 'Divine Orb' and na != 'Divine Orb':
            out[na] = (b / a, vol)
        elif na == 'Divine Orb' and nb != 'Divine Orb':
            out[nb] = (a / b, vol)
    return out


THIN_DIV = 20  # items with less than this many Divine Orbs traded in 24h on poe2db are thin markets


def crosscheck(doc, markets):
    """Compare a league doc with poe2db's Divine markets (both in Divine Orbs). Returns a summary dict; the deviation
    figures use items with at least THIN_DIV Divine Orbs of 24h volume, thin markets are counted apart."""
    div_ex = doc.get('divine')
    p2_ex = markets.get('Exalted Orb')
    rows = []
    for row in doc['items'].values():
        name, price = row[0], row[2]
        if name in ('Divine Orb', 'Exalted Orb') or not price or name not in markets or not div_ex:
            continue
        ours_div = price / div_ex
        theirs, vol = markets[name]
        rows.append((name, ours_div, theirs, ours_div / theirs, vol))
    import math
    liquid = [r for r in rows if r[4] >= THIN_DIV]
    devs = sorted(abs(math.log(r[3])) for r in liquid)
    med = math.exp(devs[len(devs) // 2]) - 1 if devs else None
    return {
        'items': len(liquid), 'thin': len(rows) - len(liquid),
        'divine_ex': {'ours': div_ex, 'poe2db': round(1 / p2_ex[0], 2) if p2_ex else None},
        'median_deviation': med,
        'within_10pct': sum(1 for d in devs if d < math.log(1.1)) / len(devs) if devs else None,
        'worst': sorted(liquid, key=lambda r: -abs(math.log(r[3])))[:15],
        'thin_worst': sorted([r for r in rows if r[4] < THIN_DIV], key=lambda r: -abs(math.log(r[3])))[:10],
    }


def poe2db_doc(markets, base, icons, now_hour):
    """An unofficial league doc from poe2db's Divine markets (used only when the official digest is stale)."""
    by_name = {}
    for meta_id, item in base.items():
        by_name.setdefault(item.get('name'), meta_id)
    p2_ex = markets.get('Exalted Orb')
    if not p2_ex:
        return None
    div_ex = 1 / p2_ex[0]
    items = {}
    for name, (price_div, vol_div) in markets.items():
        meta_id = by_name.get(name)
        if not meta_id or meta_id == EX:
            continue
        price = price_div * div_ex
        items[short(meta_id)] = [name, category(meta_id, base[meta_id]), sig(price), None, None, int(vol_div / price_div) if price_div else 0, None,
                                 1 if short(meta_id) in icons else 0]
    items[short(DIV)] = [base[DIV]['name'], 'Currency', sig(div_ex), None, None, 0, None, 1 if short(DIV) in icons else 0]
    items[short(EX)] = [base[EX]['name'], 'Currency', 1, 1, 1, 0, 0, 1 if short(EX) in icons else 0]
    slug = re.sub(r'[^A-Za-z0-9]+', '-', POE2DB_LEAGUE).strip('-').lower()
    chaos = items.get(short(CHAOS), [None] * 3)[2]
    return {'league': POE2DB_LEAGUE, 'slug': slug, 'hourFrom': now_hour - HOURS * 3600, 'hourTo': now_hour,
            'updatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'fields': FIELDS,
            'divine': sig(div_ex), 'chaos': chaos, 'items': items, 'source': POE2DB_SOURCE, 'unofficial': True}


EE2_URL = 'https://api.exiledexchange2.dev/proxy/{}/overviewData.json'
EE2_UA = 'poe2craftassist/0.3 (personal tool; the price feed Exiled Exchange 2 uses)'
EE2_SOURCE = 'Exiled Exchange 2 price feed (poe.ninja data, unofficial)'
EE2_DIR = os.path.join(CACHE, 'ee2')
EE2_MIN_VOL_EX = 1e7        # smaller (private) leagues keep the official digest only
EE2_MAX_AGE = 2 * 3600      # a cached feed is used offline or when the feed fails, up to this age
EE2_AGREE = (0.75, 1.33)    # median feed/official price ratio on liquid items; outside it the league keeps the official digest
EE2_AGREE_MIN_ITEMS = 30
# poe.ninja overview types -> the page's exchange categories (items without a known metadata id)
NINJA_CAT = {'Currency': 'Currency', 'Fragments': 'Fragments', 'Abyss': 'Abyss', 'UncutGems': 'Gems', 'LineageSupportGems': 'Gems',
             'Essences': 'Essences', 'Ultimatum': 'Runes & Cores', 'Idols': 'Fragments', 'Runes': 'Runes & Cores', 'Ritual': 'Omens',
             'Expedition': 'Currency', 'Delirium': 'Delirium', 'Breach': 'Catalysts', 'Verisium': 'Verisium'}


def ee2_league_id(name):
    return {'Standard': 'standard', 'Hardcore': 'hardcore'}.get(name, name)


def fetch_ee2(league, slug, offline=False):
    """poe.ninja overview for one league through Exiled Exchange 2's feed; cached in .kb_cache/ee2. Returns (data, age s)."""
    os.makedirs(EE2_DIR, exist_ok=True)
    path = os.path.join(EE2_DIR, f'overview-{slug}.json')
    if not offline:
        req = urllib.request.Request(EE2_URL.format(urllib.parse.quote(ee2_league_id(league))),
                                     headers={'User-Agent': EE2_UA, 'Accept': 'application/json', 'Accept-Encoding': 'identity'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode('utf-8'))
            if data.get('core', {}).get('rates', {}).get('exalted'):
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(data, f)
                return data, 0
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead, ValueError) as e:
            print(f'EE2 feed {league}: {e}', file=sys.stderr)
    if os.path.exists(path) and time.time() - os.path.getmtime(path) <= EE2_MAX_AGE:
        return json.load(open(path, encoding='utf-8')), int(time.time() - os.path.getmtime(path))
    return None, None


def spark_range(price, spark):
    """7-day low and high (from poe.ninja's sparkline: cumulative % change over 7 days) and the last day's change in %."""
    data = [x for x in ((spark or {}).get('data') or []) if x is not None]
    if not data or not price:
        return None, None, None
    total = spark.get('totalChange')
    total = data[-1] if total is None else total
    if total <= -100:
        return None, None, None
    start = price / (1 + total / 100)
    lo = start * (1 + min([0] + data) / 100)
    hi = start * (1 + max([0] + data) / 100)
    chg = round(((1 + data[-1] / 100) / (1 + data[-2] / 100) - 1) * 100, 1) if len(data) >= 2 and data[-2] > -100 else None
    return lo, hi, chg


def ee2_doc(ov, official, base, icons, fetched_at):
    """League doc from the feed, in Exalted Orbs; items the feed lacks come from the official doc (last field 'o').
    The volume field keeps the official exchange's 24h units: the feed's own volume covers about one hour
    (median 1/40 of the official 24h figure on 2026-09-26), so the page's "traded in 24h" and thin-market checks
    stay on one scale. An item the official digest did not see in 24h gets 0."""
    rates = ov['core']['rates']
    div_ex = rates['exalted']
    chaos_ex = div_ex / rates['chaos'] if rates.get('chaos') else None
    by_name = {}
    for meta_id, item in base.items():
        by_name.setdefault(item.get('name'), meta_id)
    items, uniques = {}, {}
    for sec in ov.get('itemOverviews', []):
        t = sec.get('type', '')
        for line in sec.get('lines', []):
            price_div = line.get('primaryValue')
            if not price_div:
                continue
            price = price_div * div_ex
            lo, hi, chg = spark_range(price, line.get('sparkline'))
            units = int(line['volumePrimaryValue'] / price_div) if line.get('volumePrimaryValue') else None  # uniques carry no volume
            if t.startswith('Unique'):
                key = line['name'] + (f" ({line['variant']})" if line.get('variant') else '')
                uniques[key] = [sig(price), sig(lo) if lo else None, sig(hi) if hi else None, units, chg, t[len('Unique'):]]
                continue
            meta_id = by_name.get(line['name'])
            key = short(meta_id) if meta_id else 'ninja:' + str(line.get('id') or line['name'])
            cat = category(meta_id, base[meta_id]) if meta_id else NINJA_CAT.get(t, 'Other')
            off = official['items'].get(key) if official else None
            vol = off[5] if off else (0 if official else units)
            items[key] = [line['name'], cat, sig(price), sig(lo) if lo else None, sig(hi) if hi else None, vol, chg, 1 if key in icons else 0, 'n']
    items[short(EX)] = [base[EX]['name'], 'Currency', 1, 1, 1, 0, 0, 1 if short(EX) in icons else 0, 'n']
    if short(DIV) in items:
        items[short(DIV)][2] = sig(div_ex)
    if official:
        for k, row in official['items'].items():
            if k not in items:
                items[k] = list(row[:8]) + ['o']
    hour = int(fetched_at) // 3600 * 3600
    return {'league': official['league'] if official else None, 'slug': official['slug'] if official else None,
            'hourFrom': hour - 24 * 3600, 'hourTo': hour, 'updatedAt': datetime.fromtimestamp(fetched_at, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'fields': FIELDS + ['src'], 'divine': sig(div_ex), 'chaos': sig(chaos_ex) if chaos_ex else None, 'items': items, 'uniques': uniques,
            'source': EE2_SOURCE, 'unofficial': True, 'rangeDays': 7, 'volume': 'official exchange, 24h units'}


def feed_agreement(doc, official):
    """Median ratio feed/official over items with 20+ Divine Orbs of official 24h volume, and how many were compared.
    A ratio far from 1 across the board means the feed's Divine->Exalted rate disagrees with the exchange itself."""
    div = official.get('divine') or 0
    ratios = []
    for k, r in doc['items'].items():
        o = official['items'].get(k)
        if r[-1] != 'n' or not o or k in (short(EX), short(DIV)) or not (r[2] and o[2] and o[5]):
            continue
        if o[2] * o[5] >= 20 * div:
            ratios.append(r[2] / o[2])
    if not ratios:
        return None, 0
    ratios.sort()
    n = len(ratios)
    return (ratios[n // 2] if n % 2 else (ratios[n // 2 - 1] + ratios[n // 2]) / 2), n


def ee2_layer(meta, offline=False):
    """Put the feed's document in front of the official one for each big league; rewrites meta.json. Returns meta."""
    base = json.load(open(BASE_ITEMS, encoding='utf-8'))
    icons = icon_ids()
    docs = []
    for l in meta['leagues']:
        slug = l['slug']
        path = os.path.join(OUT_DIR, f'league-{slug}.json')
        official = json.load(open(path, encoding='utf-8'))
        ov, age = fetch_ee2(l['name'], slug, offline) if l['volEx'] >= EE2_MIN_VOL_EX else (None, None)
        if not offline and ov is not None and age == 0:
            time.sleep(1.5)
        doc = ee2_doc(ov, official, base, icons, time.time() - (age or 0)) if ov else None
        agree, n = feed_agreement(doc, official) if doc else (None, 0)
        if doc and n >= EE2_AGREE_MIN_ITEMS and not EE2_AGREE[0] <= agree <= EE2_AGREE[1]:
            print(f"  {l['name']:<42} Exiled Exchange 2 feed skipped: its prices are x{agree:.2f} the exchange's on {n} liquid items "
                  f"(1 div = {doc['divine']} ex there, {official['divine']} ex on the exchange)", file=sys.stderr)
            l.update({'source': 'official', 'ee2Mismatch': round(agree, 2)})
            docs.append(slug)
            continue
        if doc:
            with open(os.path.join(OUT_DIR, f'league-official-{slug}.json'), 'w', encoding='utf-8') as f:
                json.dump(official, f, separators=(',', ':'))
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(doc, f, separators=(',', ':'))
            l.update({'source': 'ee2', 'officialDoc': 'official-' + slug, 'divine': doc['divine'], 'chaos': doc['chaos'],
                      'items': len(doc['items']), 'uniques': len(doc['uniques']), 'ee2Agreement': round(agree, 3) if agree else None})
            docs += [slug, 'official-' + slug]
        else:
            l.update({'source': 'official'})
            docs.append(slug)
    meta['docs'] = docs
    meta['source'] = f"{EE2_SOURCE}; {OFFICIAL_SOURCE} as fallback and switch"
    with open(os.path.join(OUT_DIR, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, separators=(',', ':'))
    keep = {f'league-{d}.json' for d in docs} | {'meta.json'}
    for f in os.listdir(OUT_DIR):
        if f not in keep:
            os.remove(os.path.join(OUT_DIR, f))
    return meta


def cached_ids():
    return sorted(int(f[:-5]) for f in os.listdir(CX_DIR) if f.endswith('.json') and f[:-5].isdigit())


def update_cache():
    """Download the hours of the last HOURS that are not on disk yet, newest first, so one stalled hour does not hold
    up the rest (a run that starts with an empty cache, like the cloud job, needs all of them); hours that failed get
    one more try at the end. An hour the digest has not published yet (404 or no markets) is left for the next run."""
    now_hour = int(time.time()) // 3600 * 3600
    have = set(cached_ids())
    todo = [h for h in range(now_hour - 3600, now_hour - HOURS * 3600 - 1, -3600) if h not in have]
    fetched = 0
    for attempt in range(2):
        failed = []
        for hid in todo:
            try:
                data = fetch(hid)
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    raise
                data = {}
            if data is None:
                failed.append(hid)
            elif data.get('markets'):
                with open(os.path.join(CX_DIR, f'{hid}.json'), 'w', encoding='utf-8') as f:
                    json.dump(data, f)
                fetched += 1
            time.sleep(1.5)
        if not failed:
            break
        print(f'{len(failed)} hour(s) stalled; trying them once more', file=sys.stderr)
        todo = failed
    # prune anything older than 48h
    for h in cached_ids():
        if h < now_hour - 48 * 3600:
            os.remove(os.path.join(CX_DIR, f'{h}.json'))
    return fetched


# ------------------------------------------------------------------ item metadata

BONES = ('Rib', 'Collarbone', 'Jawbone', 'Cranium', 'Vertebrae')


def category(meta_id, item):
    cls, name = item['item_class'], item['name']
    if cls == 'Omen':
        return 'Omens'
    if cls == 'SoulCore':
        return 'Runes & Cores'
    if 'Gem' in cls:
        return 'Gems'
    if cls in ('VaultKey', 'MapFragment', 'PinnacleKeyStackable', 'AtlasCurrency', 'IncubatorStackable',
               'Expedition2Logbooks', 'Breachstone'):
        return 'Fragments'
    if 'Essence' in name:
        return 'Essences'
    if 'Catalyst' in name:
        return 'Catalysts'
    if name.split()[-1] in BONES:
        return 'Abyss'
    if name.startswith(('Liquid ', 'Diluted', 'Concentrated', 'Potent', 'Ancient Liquid', 'Ancient Diluted',
                        'Ancient Concentrated', 'Ancient Potent')) and 'Verisium' not in name or name == 'Simulacrum Splinter':
        return 'Delirium'
    if 'Alloy' in name or 'Verisium' in name or 'Starlit Ore' in name or 'Crest of' in name:
        return 'Verisium'
    if name in ('Breach Splinter', 'Cryptic Key', 'Shattered Triskelion'):
        return 'Fragments'
    return 'Currency'


def short(meta_id):
    return meta_id.rsplit('/', 1)[-1]


# ------------------------------------------------------------------ aggregation

def wquantile(samples, q):
    """samples: [(value, weight)]"""
    s = sorted(samples)
    total = sum(w for _, w in s)
    if total <= 0:
        return None
    acc = 0
    for v, w in s:
        acc += w
        if acc >= q * total:
            return v
    return s[-1][0]


def sig(x, n=4):
    if x is None:
        return None
    if x == 0:
        return 0
    from math import floor, log10
    return round(x, -int(floor(log10(abs(x)))) + (n - 1))


def build():
    hours = cached_ids()[-HOURS:]
    if not hours:
        raise SystemExit('no cached hours; run without --offline first')
    base = json.load(open(BASE_ITEMS, encoding='utf-8'))
    icons = icon_ids()

    loaded = [json.load(open(os.path.join(CX_DIR, f'{h}.json'), encoding='utf-8')) for h in hours]

    # 24h bridge rates per league (Exalted per Divine / per Chaos)
    bridge = defaultdict(lambda: defaultdict(lambda: [0, 0]))  # league -> cur -> [vol cur, vol ex]
    hourly_bridge = []
    for data in loaded:
        hb = defaultdict(dict)
        for m in data['markets']:
            pair = set(m['market_pair'])
            for cur in (DIV, CHAOS):
                if pair == {cur, EX}:
                    v = m['volume_traded']
                    if v.get(cur) and v.get(EX):
                        bridge[m['league']][cur][0] += v[cur]
                        bridge[m['league']][cur][1] += v[EX]
                        hb[m['league']][cur] = v[EX] / v[cur]
        hourly_bridge.append(hb)
    day_rate = {lg: {c: (b[1] / b[0]) for c, b in d.items() if b[0]} for lg, d in bridge.items()}

    samples = defaultdict(list)  # (league, item) -> [(hour_idx, price_ex, units)]
    for hi, data in enumerate(loaded):
        for m in data['markets']:
            lg = m['league']
            a, b = m['market_pair']
            v = m['volume_traded']
            if not v.get(a) or not v.get(b):
                continue
            for x, y in ((a, b), (b, a)):
                if x == EX:
                    continue
                # Divine and Chaos are the bridges every other price goes through: price them by their own Exalted
                # market only, so the page and the conversions use one rate (a busy Divine<->Chaos market bridged
                # through a thin Chaos<->Exalted one had pulled Runes of Aldur's Divine 20% off; found against poe2db).
                if x in (DIV, CHAOS) and y != EX:
                    continue
                if y == EX:
                    rate = 1.0
                elif y in (DIV, CHAOS):
                    rate = hourly_bridge[hi].get(lg, {}).get(y) or day_rate.get(lg, {}).get(y)
                    if not rate:
                        continue
                else:
                    continue
                samples[(lg, x)].append((hi, v[y] / v[x] * rate, v[x]))

    per_league = defaultdict(dict)
    for (lg, x), ss in samples.items():
        pts = [(p, w) for _, p, w in ss]
        price = wquantile(pts, 0.5)
        lo, hi_ = wquantile(pts, 0.1), wquantile(pts, 0.9)
        units = sum(w for _, _, w in ss)
        first = [(p, w) for h, p, w in ss if h < 3]
        last = [(p, w) for h, p, w in ss if h >= len(hours) - 3]
        chg = None
        if first and last:
            mf = sum(p * w for p, w in first) / sum(w for _, w in first)
            ml = sum(p * w for p, w in last) / sum(w for _, w in last)
            if mf > 0:
                chg = round((ml / mf - 1) * 100, 1)
        item = base.get(x)
        name = item['name'] if item else short(x)
        cat = category(x, item) if item else 'Other'
        per_league[lg][short(x)] = [name, cat, sig(price), sig(lo), sig(hi_), int(units), chg, 1 if short(x) in icons else 0]

    # Exalted Orb itself
    ex_item = base[EX]
    for lg in per_league:
        per_league[lg][short(EX)] = [ex_item['name'], 'Currency', 1, 1, 1, 0, 0, 1 if short(EX) in icons else 0]

    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    leagues = []
    for lg, items in per_league.items():
        if len(items) < MIN_ITEMS:
            continue
        vol_ex = sum((it[2] or 0) * it[5] for it in items.values()) / 2
        slug = re.sub(r'[^A-Za-z0-9]+', '-', lg).strip('-').lower()
        doc = {
            'league': lg, 'slug': slug, 'hourFrom': hours[0], 'hourTo': hours[-1] + 3600, 'updatedAt': now,
            'fields': FIELDS, 'source': OFFICIAL_SOURCE,
            'divine': items.get(short(DIV), [None] * 3)[2],
            'chaos': items.get(short(CHAOS), [None] * 3)[2],
            'items': items,
        }
        with open(os.path.join(OUT_DIR, f'league-{slug}.json'), 'w', encoding='utf-8') as f:
            json.dump(doc, f, separators=(',', ':'))
        leagues.append({'name': lg, 'slug': slug, 'volEx': round(vol_ex), 'items': len(items),
                        'divine': doc['divine'], 'chaos': doc['chaos']})
    leagues.sort(key=lambda l: -l['volEx'])
    meta = {'updatedAt': now, 'hourFrom': hours[0], 'hourTo': hours[-1] + 3600, 'hours': len(hours),
            'source': 'Path of Exile 2 Currency Exchange (official hourly digest)', 'leagues': leagues}
    with open(os.path.join(OUT_DIR, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, separators=(',', ':'))
    # drop docs for leagues that no longer trade
    keep = {f"league-{l['slug']}.json" for l in leagues} | {'meta.json'}
    for f in os.listdir(OUT_DIR):
        if f not in keep:
            os.remove(os.path.join(OUT_DIR, f))
    return meta


LOCK = os.path.join(CACHE, 'refresh.lock')
LOCK_MAX_AGE = 30 * 60      # a lock older than this was left by a run that died


def _take_lock():
    os.makedirs(CACHE, exist_ok=True)
    if os.path.exists(LOCK) and time.time() - os.path.getmtime(LOCK) > LOCK_MAX_AGE:
        try:
            os.remove(LOCK)
        except OSError:
            pass
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    os.write(fd, f'{os.getpid()} {int(time.time())}'.encode())
    os.close(fd)
    return True


def _publish(staging, final):
    """Move the staged documents into place: league documents first, meta.json last, then drop the ones no longer
    listed, so a reader that follows meta.json never meets a half-written set."""
    os.makedirs(final, exist_ok=True)
    names = sorted((f for f in os.listdir(staging) if f.endswith('.json')), key=lambda f: f == 'meta.json')
    for f in names:
        for attempt in range(5):  # Windows refuses to replace a file another process is reading at that moment
            try:
                os.replace(os.path.join(staging, f), os.path.join(final, f))
                break
            except PermissionError:
                time.sleep(0.3)
        else:
            raise PermissionError(f'could not replace {f} in {final}')
    for f in os.listdir(final):
        if f.endswith('.json') and f not in names:
            try:
                os.remove(os.path.join(final, f))
            except OSError:
                pass


def refresh(offline=False, crosscheck_report=False):
    """One price update: new hours of the official digest, the league documents, the Exiled Exchange 2 layer and the
    poe2db fallback, built in a staging folder and then moved into .kb_cache/out. Used by the command line and by the
    local price server (scripts/prices_mcp.py). Returns meta, or None when another update holds the lock."""
    global OUT_DIR
    if not _take_lock():
        print('another price update is running; skipped', file=sys.stderr)
        return None
    final = OUT_DIR
    staging = final + '.new'
    try:
        shutil.rmtree(staging, ignore_errors=True)
        os.makedirs(staging)
        OUT_DIR = staging
        got = 0 if offline else update_cache()
        meta = build()

        span = f"{datetime.fromtimestamp(meta['hourFrom'], timezone.utc):%Y-%m-%d %H:%M} - {datetime.fromtimestamp(meta['hourTo'], timezone.utc):%Y-%m-%d %H:%M} UTC"
        print(f"fetched {got} new hour(s); window {meta['hours']}h {span}")
        for l in meta['leagues']:
            print(f"  {l['name']:<42} items {l['items']:>4}  1 div = {l['divine']} ex  1 chaos = {l['chaos']} ex  vol {l['volEx']:,} ex")
        meta = ee2_layer(meta, offline=offline)
        for l in meta['leagues']:
            if l.get('source') == 'ee2':
                print(f"  {l['name']:<42} Exiled Exchange 2 feed: 1 div = {l['divine']} ex, {l['items']} items, {l['uniques']} uniques")
        now_hour = int(time.time()) // 3600 * 3600
        stale = now_hour - meta['hourTo'] >= 3 * 3600
        if (crosscheck_report or stale) and not offline:
            page = poe2db_page('divine')
            markets = poe2db_divine_markets(page)
            slug = re.sub(r'[^A-Za-z0-9]+', '-', POE2DB_LEAGUE).strip('-').lower()
            doc_path = os.path.join(OUT_DIR, f'league-{slug}.json')
            off_path = os.path.join(OUT_DIR, f'league-official-{slug}.json')
            check_path = off_path if os.path.exists(off_path) else doc_path
            if markets and crosscheck_report and os.path.exists(check_path):
                c = crosscheck(json.load(open(check_path, encoding='utf-8')), markets)
                print(f"crosscheck with poe2db ({POE2DB_LEAGUE}): {c['items']} items with {THIN_DIV}+ div volume (plus {c['thin']} thin), median deviation {c['median_deviation']:.1%}, "
                      f"{c['within_10pct']:.0%} within 10%; 1 div = {c['divine_ex']['ours']} ex (ours) vs {c['divine_ex']['poe2db']} ex (poe2db)")
                os.makedirs(os.path.join(ROOT, 'reports'), exist_ok=True)
                rep_path = os.path.join(ROOT, 'reports', f"price-crosscheck-{datetime.now(timezone.utc):%Y-%m-%d-%H%M}.md")
                with open(rep_path, 'w', encoding='utf-8') as f:
                    f.write(f"# Price cross-check with poe2db ({POE2DB_LEAGUE})\n\nOur window: {span}. poe2db: 24h values on its Divine Orb page.\n\n"
                            f"- Items compared: {c['items']} with at least {THIN_DIV} Divine Orbs of 24h volume ({c['thin']} thin markets listed apart)\n- Median deviation: {c['median_deviation']:.1%}\n- Within 10%: {c['within_10pct']:.0%}\n"
                            f"- Divine Orb: {c['divine_ex']['ours']} ex (ours), {c['divine_ex']['poe2db']} ex (poe2db)\n\n"
                            "Large deviations are usually thin markets that disagree with each other (the official data has several markets per item).\n\n"
                            "| Item | Ours (div) | poe2db (div) | Ratio | poe2db 24h volume (div) |\n|---|---|---|---|---|\n"
                            + ''.join(f'| {n} | {o:.4g} | {t:.4g} | {r:.2f} | {v:,.0f} |\n' for n, o, t, r, v in c['worst'])
                            + '\n## Thin markets (largest gaps)\n\nFew trades, and the markets of one item disagree; neither number is reliable.\n\n'
                            + '| Item | Ours (div) | poe2db (div) | Ratio | poe2db 24h volume (div) |\n|---|---|---|---|---|\n'
                            + ''.join(f'| {n} | {o:.4g} | {t:.4g} | {r:.2f} | {v:,.0f} |\n' for n, o, t, r, v in c['thin_worst']))
                print('report:', rep_path)
            if markets and stale and not any(l['name'] == POE2DB_LEAGUE and l.get('source') == 'ee2' for l in meta['leagues']):
                base = json.load(open(BASE_ITEMS, encoding='utf-8'))
                icons = icon_ids()
                doc = poe2db_doc(markets, base, icons, now_hour)
                if doc:
                    with open(doc_path, 'w', encoding='utf-8') as f:
                        json.dump(doc, f, separators=(',', ':'))
                    print(f"official digest is {(now_hour - meta['hourTo']) // 3600}h old: {POE2DB_LEAGUE} prices taken from poe2db (unofficial) for now")
        OUT_DIR = final
        _publish(staging, final)
        print('docs:', final)
        return meta
    finally:
        OUT_DIR = final
        shutil.rmtree(staging, ignore_errors=True)
        try:
            os.remove(LOCK)
        except OSError:
            pass


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if refresh(offline='--offline' in sys.argv, crosscheck_report='--crosscheck' in sys.argv) is None:
        sys.exit(2)
