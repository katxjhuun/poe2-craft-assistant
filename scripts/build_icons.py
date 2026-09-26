#!/usr/bin/env python3
"""Pack downloaded item icons (.kb_cache/icons/*.png, PoE2 art from web.poecdn.com via the
Exiled Exchange 2 item list) into app/data/icons.json as 48px WebP data URIs keyed by short id.
Items with no icon of their own reuse the icon of an item with the same art file (RePoE dds path)."""
import base64, io, json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, '.kb_cache', 'icons')
BASE_ITEMS = os.path.join(ROOT, '.kb_cache', 'poe2_base_items.json')
OUT = os.path.join(ROOT, 'app', 'data', 'icons.json')
SIZE = 48

base = json.load(open(BASE_ITEMS, encoding='utf-8'))
by_short = {k.rsplit('/', 1)[-1]: v for k, v in base.items()}
have = {f[:-4] for f in os.listdir(ICON_DIR) if f.endswith('.png')}

out = {}
for sid in sorted(have):
    im = Image.open(os.path.join(ICON_DIR, sid + '.png')).convert('RGBA')
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=88, method=6)
    out[sid] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()

# aliases: same dds art
art = {}
for sid in have:
    vi = (by_short.get(sid) or {}).get('visual_identity') or {}
    if vi.get('dds_file'):
        art.setdefault(vi['dds_file'], sid)
aliases = 0
for sid, item in by_short.items():
    if sid in out or item.get('item_class') not in ('StackableCurrency', 'Omen'):
        continue
    src = art.get((item.get('visual_identity') or {}).get('dds_file'))
    if src:
        out[sid] = out[src]
        aliases += 1

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(out, f, separators=(',', ':'))
print(f'{len(out)} icons ({aliases} aliases), {os.path.getsize(OUT) / 1024:.0f} KB -> {OUT}')
