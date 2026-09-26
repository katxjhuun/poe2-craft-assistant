#!/usr/bin/env python3
"""PoE2 Craft Assistant - knowledge base builder (v1, 2026-09-24).
Rebuilds poe2_kb_<patch>.json from:
  - RePoE fork PoE2 export (github.com/repoe-fork/poe2)       -> mods, bases, currency descriptions
  - RePoE fork PoE1 export (repoe-fork.github.io root = PoE1)  -> ONLY used to build the PoE1 blacklist
  - Exiled Exchange 2 data (github.com/Kvan7/Exiled-Exchange-2) -> trade-style stat index + trade item list
Run after every PoE2 patch (e.g. 1.0) and diff the output. Check each source repo's license first.
Usage: python3 poe2_kb_build.py [output.json]
"""
import json, re, collections, os, sys, urllib.request
OUT = sys.argv[1] if len(sys.argv) > 1 else 'poe2_kb.json'
CACHE = os.environ.get('KB_CACHE', '.kb_cache'); os.makedirs(CACHE, exist_ok=True)
SRC = {
 'poe2_mods.json': 'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/mods.json',
 'poe2_base_items.json': 'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/base_items.json',
 'poe2_version.txt': 'https://raw.githubusercontent.com/repoe-fork/poe2/master/version.txt',
 'poe1_base_items.json': 'https://raw.githubusercontent.com/repoe-fork/repoe-fork.github.io/master/data/base_items.json',
 'items.ndjson': 'https://raw.githubusercontent.com/Kvan7/Exiled-Exchange-2/master/renderer/public/data/en/items.ndjson',
 'stats.ndjson': 'https://raw.githubusercontent.com/Kvan7/Exiled-Exchange-2/master/renderer/public/data/en/stats.ndjson',
}
def get(name):
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        req = urllib.request.Request(SRC[name], headers={'User-Agent': 'poe2-craft-assistant-kb-builder/1.0'})
        with urllib.request.urlopen(req, timeout=120) as r, open(p, 'wb') as f: f.write(r.read())
    return p
GAME_VERSION = open(get('poe2_version.txt')).read().strip()
# ---- PoE1 blacklist (released PoE1 currency names that are not in the PoE2 trade list)
_p1 = json.load(open(get('poe1_base_items.json')))
_ee = [json.loads(l) for l in open(get('items.ndjson'), encoding='utf-8') if l.strip()]
_ee_names = set((i.get('name') or i.get('refName')) for i in _ee)
_p1cur = set(v['name'] for v in _p1.values() if v.get('item_class') == 'StackableCurrency' and v.get('release_state') == 'released')
_GENERIC = {'Enchant', 'Prophecy'}  # generic words would cause false positives in a leak filter
_bl_all = sorted(n for n in _p1cur if n and n.strip() and n not in _ee_names and n not in _GENERIC)
_bl_craft = [n for n in _bl_all if re.search(r"Orb|Essence|Fossil|Resonator|Catalyst|Oil|Ichor|Ember|Lifeforce|Beast|Scouring|Shard|Splinter", n)]
bl = {'poe1_only_currency': _bl_all, 'poe1_only_crafting_like': _bl_craft}
mods=json.load(open(get('poe2_mods.json'))); bases=json.load(open(get('poe2_base_items.json')))
ee_items=_ee
ee_stats=[json.loads(l) for l in open(get('stats.ndjson'), encoding='utf-8') if l.strip()]
def clean(t):
    t=t or ''; t=re.sub(r'\[([^\]|]+)\|([^\]]+)\]', r'\2', t); t=re.sub(r'\[([^\]|]+)\]', r'\1', t); return t
nm=lambda i: i.get('name') or i.get('refName')
trade_names=set(nm(i) for i in ee_items if i.get('namespace')=='ITEM')
UNCONF={'One Hand Sword','Two Hand Sword','One Hand Axe','Two Hand Axe','Dagger','Flail'}
GEAR={'Body Armour','Helmet','Gloves','Boots','Shield','Buckler','Focus','One Hand Mace','Two Hand Mace','Warstaff','Spear','Bow','Crossbow','Talisman','Ring','Amulet','Belt','One Hand Sword','Two Hand Sword','Dagger','One Hand Axe','Two Hand Axe','Flail','Staff','Wand','Sceptre','Quiver','Jewel','Claw','Charm','LifeFlask','ManaFlask','UtilityFlask'}
# Flasks and charms roll only the "flask" domain; gear never rolls it. Many flask mods are weighted on the "default"
# tag, so pools must keep the domains apart. The export's class names become the in-game ones ("Item Class: Charms").
CLASS_NAME={'LifeFlask':'Life Flask','ManaFlask':'Mana Flask','UtilityFlask':'Charm'}
FLASKS={'Life Flask','Mana Flask','Charm'}
# ---- mods
M={}
# Natural jewel mods are in the export's "misc" domain (game data 4.5.5.2: 364 mods, e.g. JewelAccuracy), but the
# Time-Lost (radius) ones lose their in-game wording there: "(2-3)% increased Armour" instead of "Small Passive Skills in
# Radius also grant (2-3)% increased Armour", so pasted Time-Lost jewels would not match and poe2db's weights would not
# map. Jewels therefore come from scripts/augment_jewels.py (poe2db, in-game wording). Add 'misc' here only after
# checking a new export with scripts/kb_update.py check.
JEWEL_DOMAINS=set()
for k,m in mods.items():
    g=m.get('generation_type'); dom=m.get('domain')
    if g not in ('prefix','suffix'): continue
    sw=[[s['tag'],s['weight']] for s in (m.get('spawn_weights') or [])]
    # Only the "desecrated" domain is desecrated; every other kept domain holds natural mods.
    if dom=='item' or dom in JEWEL_DOMAINS or dom=='flask': pass
    elif dom=='desecrated':
        pos=[t for t,w in sw if w>0]
        if not pos or set(pos)<= {'map'}: continue
    else: continue
    M[k]={'fam':m.get('type'),'gen':g[0],'lvl':m.get('required_level'),'txt':clean(m.get('text')),
          'st':[[s['id'],s.get('min'),s.get('max')] for s in (m.get('stats') or [])],
          'mt':m.get('implicit_tags') or [],'grp':m.get('groups') or [],'sw':sw,'dom':'d' if dom=='desecrated' else 'f' if dom=='flask' else 'i'}
    if m.get('is_essence_only'): M[k]['eo']=1
# ---- bases (trade-listed only, no DNT)
B={}; seen=set()
for meta,v in bases.items():
    n=v.get('name') or ''
    tags=v.get('tags') or []
    # Diamond and Time-Lost jewels carry not_for_sale but are real, tradeable bases
    if v.get('item_class') not in GEAR or n.startswith('[DNT]') or v.get('release_state')!='released' or ('not_for_sale' in tags and v.get('item_class')!='Jewel'): continue
    if v.get('item_class')=='Claw': continue
    if (n,v['item_class']) in seen: continue
    seen.add((n,v['item_class']))
    imp=[clean(mods[i]['text']) if i in mods else i for i in (v.get('implicits') or [])]
    B[n]={'cls':CLASS_NAME.get(v['item_class'],v['item_class']),'lvl':v.get('drop_level'),'tags':tags,'imp':imp,'tl':1 if n in trade_names else 0}
    if v['item_class'] in UNCONF: B[n]['unconfirmed_class']=1
# ---- pools per tag signature (natural mods of the base's domain: item mods for gear, flask mods for flasks/charms)
def weight_for(tags, sw):
    ts=set(tags)
    for t,w in sw:
        if t in ts: return w
    return 0
sigs={}; pools={}
nat=[(k,m) for k,m in M.items() if m['dom']=='i']
nat_flask=[(k,m) for k,m in M.items() if m['dom']=='f']
for n,b in B.items():
    key=tuple(sorted(b['tags']))
    if key not in sigs:
        sid='S%d'%len(sigs); sigs[key]=sid
        src=nat_flask if b['cls'] in FLASKS else nat
        pref=[k for k,m in src if m['gen']=='p' and weight_for(b['tags'],m['sw'])>0]
        suf=[k for k,m in src if m['gen']=='s' and weight_for(b['tags'],m['sw'])>0]
        def tiers(ids):
            fam=collections.defaultdict(list)
            for i in ids: fam[M[i]['fam']].append(i)
            out=[]
            for f,lst in fam.items():
                lst.sort(key=lambda i:-(M[i]['lvl'] or 0))
                out+= [[i,t+1] for t,i in enumerate(lst)]
            return out
        pools[sid]={'prefix':tiers(pref),'suffix':tiers(suf)}
    b['sig']=sigs[key]
# ---- stat index (trade-site style search)
SI=[{'r':s['ref'],'ids':(s.get('trade') or {}).get('ids') or {},'m':[x.get('string') for x in s.get('matchers',[]) if x.get('string')]} for s in ee_stats]
# ---- currency roster from trade list
roster=collections.defaultdict(list)
for i in ee_items:
    c=(i.get('craftable') or {}).get('category')
    if i.get('namespace')=='ITEM' and c in ('Currency','Omen') and not (nm(i) or '').startswith('[DNT]'):
        roster[c].append(nm(i))
roster={k:sorted(set(v)) for k,v in roster.items()}
kb={'meta':{'game':'Path of Exile 2','game_data_version':GAME_VERSION,'patch':'0.5.5 (Forbidden Rites event league, Runes of Aldur challenge league)','generated':'2026-09-24',
  'sources':{'mods_and_bases':'RePoE fork PoE2 export (github.com/repoe-fork/poe2, datamined from game files)','trade_list_and_stat_index':'Exiled Exchange 2 data (github.com/Kvan7/Exiled-Exchange-2, mirrors PoE2 trade site item/stat lists)','poe1_blacklist':'RePoE PoE1 export 3.29.3.3 diffed against PoE2 trade list'},
  'rules':['Bases: RePoE released bases minus [DNT] placeholders, not_for_sale bases and Claw class. tl=1 means the name is also in the EE2/trade item list (stronger confirmation); tl=0 = datamined only, verify in game. unconfirmed_class=1: weapon class may not be obtainable in 0.5.5 (e.g. swords are slated for 1.0) - hide by default.',
           'spawn weights in PoE2 client data are only 0/1 (eligibility), NOT real roll weights. Probabilities need community-estimated weights; label them as estimates.',
           'Eligibility rule: walk mod.sw in order; the first tag the base has decides (w>0 eligible, 0 blocked).',
           'Tier numbers in pools are computed per base: T1 = highest mod level within the family on that base (community convention). Verify against in-game Alt view.',
           'dom:i = normal item mod, dom:d = desecrated (Abyss) mod, dom:f = flask/charm mod (only Life Flask, Mana Flask and Charm bases roll it); eo = essence-only.',
           'Mods whose sw is only [default,0] are not naturally rollable (essence/alloy/Genesis Tree/other source).'],
  'counts':{}},
 'bases':B,'tag_signatures':{v:list(k) for k,v in sigs.items()},'pools':pools,'mods':M,'stat_index':SI,'currency_roster':roster,
 'poe1_only_blacklist':{'crafting_like':bl['poe1_only_crafting_like'],'all_currency':bl['poe1_only_currency']}}
kb['meta']['counts']={'bases':len(B),'mods':len(M),'natural_item_mods':len(nat),'flask_mods':len(nat_flask),'desecrated_mods':sum(1 for m in M.values() if m['dom']=='d'),'tag_signatures':len(sigs),'stat_index':len(SI),'currencies':len(roster.get('Currency',[])),'omens':len(roster.get('Omen',[])),'poe1_blacklist':len(bl['poe1_only_currency'])}



# ---- currency metadata ids + in-game descriptions
_clean=clean
meta={}
names=set(roster.get('Currency',[]))|set(roster.get('Omen',[]))
for k,v in bases.items():
    n=v.get('name')
    if n in names and v.get('item_class') in ('StackableCurrency','Omen') and n not in meta: meta[n]=k
kb['currency_metadata_ids']=meta
kb['meta']['rules'].append('currency_metadata_ids maps item name -> game metadata id; Currency Exchange API market_id uses these ids.')
kb['item_descriptions']={n:_clean((bases[k].get('properties') or {}).get('description')).replace('\n',' ') for n,k in meta.items() if (bases[k].get('properties') or {}).get('description')}
kb['meta']['rules'].append('item_descriptions = in-game description text from game data (numeric floors like Greater/Perfect min modifier level are NOT in this text).')
G='game_text'; P='patch_note_quote'; M2='multi_secondary'; S1='single_secondary'
rules=[
 {'id':'R_RARITY_SLOTS','rule':'Normal: 0 explicit; Magic: max 1 prefix + 1 suffix; Rare: max 3 prefix + 3 suffix','conf':M2},
 {'id':'R_ILVL_GATE','rule':'A mod tier can roll only if mod.lvl <= item level','conf':M2},
 {'id':'R_MOD_GROUP','rule':'Only one mod per modifier group on an item; guaranteed-mod currency fails instead of duplicating','conf':M2},
 {'id':'R_ONE_CRAFTED','rule':'0.5+: max 1 crafted modifier per item (Essence, Perfect/special Essence, Runic Alloy, some Runic Ward enchants share this slot)','conf':P,'patch':'0.5.0'},
 {'id':'R_ONE_DESECRATED','rule':'0.5+: max 1 Desecrated modifier per item; Desecrated mods do NOT count as crafted','conf':P,'patch':'0.5.0'},
 {'id':'R_FRACTURED_LOCK','rule':'Fractured mod cannot be removed or changed by Chaos/Annulment/etc.','conf':M2},
 {'id':'R_CORRUPTED_LOCK','rule':'Corrupted items cannot be modified except by currencies that explicitly target corrupted items (Architect\'s Orb, Orbs of Sacrifice, Vaal Cultivation Orb, ...)','conf':G},
 {'id':'R_SANCTIFIED_LOCK','rule':'Sanctified items: most crafting no longer possible (verify per currency in game)','conf':S1},
 {'id':'R_FLASK_MAGIC','rule':'Flasks and charms can only be Normal or Magic (max 1 prefix + 1 suffix): Regal Orb, Orb of Alchemy, Exalted and Chaos Orbs, essences, bones and the Fracturing Orb do not apply to them','conf':S1},
 {'id':'R_VALUE_MULT_05','rule':'0.5+: Sanctify and the Vaal value-randomise outcome multiply each mod value from its CURRENT value (Divine to max first)','conf':M2,'patch':'0.5.0'},
 {'id':'R_WEIGHTS','rule':'Real roll weights are not in client data (spawn weight 0/1). Use community-estimated weights and label outputs as estimates','conf':M2},
]
def op(i,name,**k): d={'id':i,'names':name if isinstance(name,list) else [name]}; d.update(k); return d
ops=[
 op('transmute',['Orb of Transmutation','Greater Orb of Transmutation','Perfect Orb of Transmutation'],input='Normal',effect='-> Magic with 1 random mod',min_mod_level={'Greater':44,'Perfect':70},conf=G,floor_conf=M2,note='Greater floor was 55 before 0.5.0'),
 op('augment',['Orb of Augmentation','Greater Orb of Augmentation','Perfect Orb of Augmentation'],input='Magic with an open side',effect='+1 random mod',min_mod_level={'Greater':44,'Perfect':70},conf=G,floor_conf=M2),
 op('regal',['Regal Orb','Greater Regal Orb','Perfect Regal Orb'],input='Magic',effect='-> Rare, +1 random mod',min_mod_level={'Greater':35,'Perfect':50},conf=G,floor_conf=M2,omens=['Omen of Sinistral Coronation (prefix only)','Omen of Dextral Coronation (suffix only)']),
 op('alchemy','Orb of Alchemy',input='Normal or Magic',effect='-> Rare with 4 random mods',conf=G,omens=['Omen of Sinistral Alchemy (max prefixes)','Omen of Dextral Alchemy (max suffixes)']),
 op('exalt',['Exalted Orb','Greater Exalted Orb','Perfect Exalted Orb'],input='Rare with open slot',effect='+1 random mod',min_mod_level={'Greater':35,'Perfect':50},conf=G,floor_conf=M2,omens=['Omen of Sinistral Exaltation (prefix only)','Omen of Dextral Exaltation (suffix only)','Omen of Greater Exaltation (adds 2 mods)','Omen of Catalysing Exaltation (consumes catalyst quality to raise chance of matching mod type)']),
 op('chaos',['Chaos Orb','Greater Chaos Orb','Perfect Chaos Orb'],input='Rare',effect='remove 1 random mod + add 1 random mod (NOT a full reroll like PoE1)',min_mod_level={'Greater':35,'Perfect':50},conf=G,floor_conf=M2,omens=['Omen of Sinistral Erasure (removes prefix only)','Omen of Dextral Erasure (removes suffix only)','Omen of Whittling (removes lowest level mod; always hover-check in game)']),
 op('annul','Orb of Annulment',input='item with removable mods',effect='remove 1 random mod',conf=G,omens=['Omen of Sinistral Annulment','Omen of Dextral Annulment','Omen of Greater Annulment (removes 2)','Omen of Light (removes only the Desecrated mod)']),
 op('divine','Divine Orb',input='item with mods',effect='randomise numeric values of mods',conf=G,omens=['Omen of the Blessed (implicits only)','Omen of Sanctification (Rare -> Sanctify; value multiplier range ~78-122% is single-source)']),
 op('chance','Orb of Chance',input='Normal',effect='-> random Unique of same class OR destroyed',conf=G,omens=['Omen of Chance (no destroy)','Omen of the Ancients (guaranteed Unique of same class)']),
 op('vaal','Vaal Orb',input='any non-corrupted',effect='unpredictable modification + Corrupted',conf=G,note='Omen of Corruption is legacy/unobtainable since 0.5.0'),
 op('fracture','Fracturing Orb',input='Rare with >=4 mods',effect='fracture (lock) 1 random mod',conf=G),
 op('hinekora','Hinekora\'s Lock',input='item',effect='foresee result of next currency; any modification removes the foresight',conf=G),
 op('mirror','Mirror of Kalandra',input='item',effect='create mirrored copy',conf=G),
 op('artificer','Artificer\'s Orb',input='martial weapon, wand, staff or armour',effect='+1 augment socket',conf=G),
 op('essence_upgrade','Lesser/normal/Greater Essence of X',input='Magic',effect='-> Rare + guaranteed mod (counts as the 1 crafted mod)',conf=G,rule_refs=['R_ONE_CRAFTED']),
 op('essence_replace','Perfect Essence of X + special essences (Abyss, Breach, Horror, Insanity, Delirium, Hysteria)',input='Rare',effect='remove 1 random mod + add guaranteed mod',conf=G,omens=['Omen of Sinistral Crystallisation (removes prefix only)','Omen of Dextral Crystallisation (removes suffix only)'],note='Essence of the Abyss adds "Bears the Mark of the Abyssal Lord", replaced on next desecration'),
 op('alloy','13 Runic Alloys',input='Rare',effect='remove 1 random mod + add alloy-exclusive guaranteed mod (counts as crafted)',conf=G,league_scope='Runes of Aldur (per community codex; verify in current league)',scope_conf=S1),
 op('desecrate','Bones: Jawbone (Rare weapon/quiver), Rib (Rare armour), Collarbone (Rare amulet/ring/belt), Altered Collarbone (+chance of otherworldly mods), Cranium (Rare jewel), Vertebrae (Rare waystone)',input='Rare',effect='adds 1 unrevealed Desecrated mod; reveal at Well of Souls = choose 1 of 3',conf=G,quality_rules={'Gnawed':'item level <= 64 (community)','Preserved':'any','Ancient':'min modifier level 40 (community)'},quality_conf=S1,omens=['Omen of Sinistral/Dextral Necromancy (side)','Omen of the Blackblooded (Kurgal) / Liege (Amanamu) / Sovereign (Ulaman) - weapon or jewellery only','Omen of Abyssal Echoes (reroll the options once)','Omen of Putrefaction (replace all mods with up to 6 unrevealed + corrupt; conflicts with 0.5 one-desecrated cap -> verify)'],rule_refs=['R_ONE_DESECRATED']),
 op('catalyst','Catalysts (Flesh=Life, Neural=Mana, Carapace=Armour/Evasion/ES, Uul-Netol\'s=Physical, Xoph\'s=Fire, Tul\'s=Cold, Esh\'s=Lightning, Chayula\'s=Chaos, Reaver=Attack, Sibilant=Caster, Skittering=Speed, Adaptive=Attribute, Necrotic=Minion); Refined = same for jewels',input='ring/amulet (Refined: jewel)',effect='adds quality enhancing that mod type; replaces other quality types',conf=G,note='0.5: catalysts obtained only via Genesis Tree (multi secondary)'),
 op('quality','Blacksmith\'s Whetstone (martial weapon), Armourer\'s Scrap (armour), Arcanist\'s Etcher (wand/staff/sceptre), Glassblower\'s Bauble (flask)',input='item',effect='+quality',conf=G),
 op('infuser','Vaal Arcanist\'s/Armourer\'s/Blacksmith\'s/Catalysing Infuser',input='wand/staff/sceptre | armour | martial weapon | ring/amulet',effect='quality above max by up to 10%, chance to Corrupt',conf=G),
 op('flux','Blazing/Chilling/Crackling/Void Flux',input='item',effect='convert all elemental resistance mods to Fire/Cold/Lightning (Void: to Chaos) equivalents',conf=G),
 op('sacrifice','Kamasa\'s (amulet/ring/belt), Kopec\'s (armour), Yaomac\'s (weapon/quiver), Yugul\'s (jewel) Orb of Sacrifice',input='Rare with corruption enchantment',effect='upgrade corruption enchantment + remove 1 random mod',conf=G),
 op('architect','Architect\'s Orb',input='Corrupted equipment or jewel',effect='modify unpredictably or destroy',conf=G),
 op('cultivation','Vaal Cultivation Orb',input='Corrupted Vaal Unique / other Unique',effect='replace up to 2 mods / turn into corrupted Unique of same class',conf=G),
 op('liquid_emotion','Liquid emotions (e.g. Liquid Despair)',input='Rare basic jewel',effect='remove 1 random mod + add guaranteed crafted mod',conf=G),
]
legacy=[{'name':'Omen of Homogenising Exaltation / Coronation','status':'drops disabled since 0.4 (Standard legacy)','conf':M2},
        {'name':'Omen of Corruption','status':'unobtainable since 0.5.0 (legacy)','conf':M2},
        {'name':'Omen of Recombination','status':'removed in 0.5.0','conf':M2},
        {'name':'Recombinator (Expedition)','status':'disabled in Runes of Aldur; status in 0.5.5 / Forbidden Rites unverified','conf':S1}]
kb['crafting_rules']=rules; kb['crafting_ops']=ops; kb['legacy_or_disabled']=legacy
kb['meta']['rules'].append('crafting_rules / crafting_ops: conf = game_text (datamined in-game description) > patch_note_quote > multi_secondary > single_secondary (verify in game).')

json.dump(kb,open(OUT,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('game data', GAME_VERSION, '->', OUT, json.dumps(kb['meta']['counts']))
