#!/usr/bin/env python3
"""PoE2 Craft Assistant - knowledge base builder (v1, 2026-09-24).
Rebuilds poe2_kb_<patch>.json from:
  - RePoE fork PoE2 export (github.com/repoe-fork/poe2)       -> mods, bases, currency descriptions, the game's own
                                                                   keyword help texts (crafting rules as game text)
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
 'poe2_keywords.json': 'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/keywords.json',
 # raw game tables (column names are community guesses, values are the game's): essences and their outcomes
 'EssenceMods.csv': 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/EssenceMods.csv',
 'Essences.csv': 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/Essences.csv',
 'EssenceTargetItemCategories.csv': 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/EssenceTargetItemCategories.csv',
 'SoulCoreStatCategories.csv': 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/SoulCoreStatCategories.csv',
 'ItemClasses.csv': 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/ItemClasses.csv',
 # liquid emotion outcomes per jewel, Greater/Perfect currency floors, catalyst quality types
 'LiquidEmotionOutcomes.csv': 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/LiquidEmotionOutcomes.csv',
 'TieredCurrency.csv': 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/TieredCurrency.csv',
 'AlternateQualityTypes.csv': 'https://raw.githubusercontent.com/repoe-fork/dat-export/develop/current/poe2/heuristics/csv/AlternateQualityTypes.csv',
 # runes, soul cores, talismans, idols: what each gives per item class (RePoE's reading of the SoulCore tables)
 'poe2_augments.json': 'https://raw.githubusercontent.com/repoe-fork/poe2/master/data/augments.json',
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
GEAR={'Body Armour','Helmet','Gloves','Boots','Shield','Buckler','Focus','One Hand Mace','Two Hand Mace','Warstaff','Spear','Bow','Crossbow','Talisman','Ring','Amulet','Belt','One Hand Sword','Two Hand Sword','Dagger','One Hand Axe','Two Hand Axe','Flail','Staff','Wand','Sceptre','Quiver','Jewel','Claw','Charm','LifeFlask','ManaFlask'}
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
    # Corruption Enhancements (what a Vaal Orb can add): item domain, and misc for jewels. dom 'c', gen 'c'.
    if g=='corrupted' and dom in ('item','misc'):
        M[k]={'fam':m.get('type'),'gen':'c','lvl':m.get('required_level'),'txt':clean(m.get('text')),
              'st':[[s['id'],s.get('min'),s.get('max')] for s in (m.get('stats') or [])],
              'mt':m.get('implicit_tags') or [],'grp':m.get('groups') or [],'sw':[[s['tag'],s['weight']] for s in (m.get('spawn_weights') or [])],'dom':'c','cdom':dom}
        continue
    if g not in ('prefix','suffix'): continue
    sw=[[s['tag'],s['weight']] for s in (m.get('spawn_weights') or [])]
    # Only the "desecrated" domain is desecrated; every other kept domain holds natural mods.
    if dom=='item' or dom in JEWEL_DOMAINS: pass
    elif dom=='desecrated':
        pos=[t for t,w in sw if w>0]
        if not pos or set(pos)<= {'map'}: continue
    else: continue
    M[k]={'fam':m.get('type'),'gen':g[0],'lvl':m.get('required_level'),'txt':clean(m.get('text')),
          'st':[[s['id'],s.get('min'),s.get('max')] for s in (m.get('stats') or [])],
          'mt':m.get('implicit_tags') or [],'grp':m.get('groups') or [],'sw':sw,'dom':'d' if dom=='desecrated' else 'i'}
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
    imp=[x for x in (clean(mods[i]['text']) if i in mods else i for i in (v.get('implicits') or [])) if x]
    B[n]={'cls':v['item_class'],'lvl':v.get('drop_level'),'tags':tags,'imp':imp,'tl':1 if n in trade_names else 0}
    if v['item_class'] in UNCONF: B[n]['unconfirmed_class']=1
# ---- pools per tag signature (natural item-domain mods only)
def weight_for(tags, sw):
    ts=set(tags)
    for t,w in sw:
        if t in ts: return w
    return 0
sigs={}; pools={}
nat=[(k,m) for k,m in M.items() if m['dom']=='i']
for n,b in B.items():
    key=tuple(sorted(b['tags']))
    if key not in sigs:
        sid='S%d'%len(sigs); sigs[key]=sid
        pref=[k for k,m in nat if m['gen']=='p' and weight_for(b['tags'],m['sw'])>0]
        suf=[k for k,m in nat if m['gen']=='s' and weight_for(b['tags'],m['sw'])>0]
        def tiers(ids):
            fam=collections.defaultdict(list)
            for i in ids: fam[M[i]['fam']].append(i)
            out=[]
            for f,lst in fam.items():
                lst.sort(key=lambda i:-(M[i]['lvl'] or 0))
                out+= [[i,t+1] for t,i in enumerate(lst)]
            return out
        # a mod's domain must match the item's: equipment takes item-domain enhancements, jewels the misc-domain ones
        cdom='misc' if b['cls']=='Jewel' else 'item'
        cor=[k for k,m in M.items() if m['dom']=='c' and m['cdom']==cdom and weight_for(b['tags'],m['sw'])>0]
        pools[sid]={'prefix':tiers(pref),'suffix':tiers(suf),'corrupted':sorted(cor)}
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
           'dom:i = normal item mod, dom:d = desecrated (Abyss) mod; eo = essence-only.',
           'Mods whose sw is only [default,0] are not naturally rollable (essence/alloy/Genesis Tree/other source).'],
  'counts':{}},
 'bases':B,'tag_signatures':{v:list(k) for k,v in sigs.items()},'pools':pools,'mods':M,'stat_index':SI,'currency_roster':roster,
 'poe1_only_blacklist':{'crafting_like':bl['poe1_only_crafting_like'],'all_currency':bl['poe1_only_currency']}}
kb['meta']['counts']={'bases':len(B),'mods':len(M),'natural_item_mods':len(nat),'desecrated_mods':sum(1 for m in M.values() if m['dom']=='d'),'tag_signatures':len(sigs),'stat_index':len(SI),'currencies':len(roster.get('Currency',[])),'omens':len(roster.get('Omen',[])),'poe1_blacklist':len(bl['poe1_only_currency'])}



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
 {'id':'R_RARITY_SLOTS','rule':'Normal: 0 explicit; Magic: max 1 prefix + 1 suffix; Rare: max 3 prefix + 3 suffix','conf':G,'source':'keyword ItemRarity'},
 {'id':'R_ILVL_GATE','rule':'A mod tier can roll only if mod.lvl <= item level','conf':M2},
 {'id':'R_MOD_GROUP','rule':'Only one mod per modifier group on an item; guaranteed-mod currency fails instead of duplicating','conf':M2},
 {'id':'R_ONE_CRAFTED','rule':'0.5+: max 1 crafted modifier per item (Essence, Perfect/special Essence, Runic Alloy, some Runic Ward enchants share this slot)','conf':G,'patch':'0.5.0','source':'keyword Crafted'},
 {'id':'R_ONE_DESECRATED','rule':'0.5+: max 1 Desecrated modifier per item (items with Desecrated modifiers cannot be Desecrated again); Desecrated mods do NOT count as crafted','conf':G,'patch':'0.5.0','source':'keyword Abyssalify'},
 {'id':'R_DESECRATE_FULL','rule':'Desecrating adds an Unrevealed Desecrated modifier; if the modifiers are full, a random modifier is also removed','conf':G,'source':'keyword Abyssalify'},
 {'id':'R_FRACTURED_LOCK','rule':'A Fractured modifier is locked permanently: it cannot be removed or altered (a Divine Orb leaves its values; a Fracturing Orb cannot be used on Fractured items)','conf':G,'source':'keyword Fracture; Fracturing Orb text'},
 {'id':'R_MIN_MOD_LEVEL','rule':'Currency with a Minimum Modifier Level adds random modifiers of at least that level, except a modifier type that would be excluded entirely (it keeps its best tier); it cannot be used on items with an item level below that level','conf':G,'source':'keyword BetterCurrencyMinimumLevel'},
 {'id':'R_MAX_ITEM_LEVEL','rule':'Currency with a Maximum Item Level (Gnawed bones: 64) cannot be used on items above that level','conf':G,'source':'keyword CurrencyMaximumItemLevel'},
 {'id':'R_CORRUPTED_LOCK','rule':'Corrupted items cannot be modified except by currencies that explicitly target corrupted items (Architect\'s Orb, Orbs of Sacrifice, Vaal Cultivation Orb, ...)','conf':G},
 {'id':'R_SANCTIFIED_LOCK','rule':'Sanctifying multiplies each modifier value by a random 78% to 122%; most methods of crafting and modification cannot be used on Sanctified items','conf':G,'source':'keyword Sanctified'},
 {'id':'R_VALUE_MULT_05','rule':'0.5+: Sanctify and the Vaal value-randomise outcome multiply each mod value from its CURRENT value (Divine to max first)','conf':M2,'patch':'0.5.0'},
 {'id':'R_JEWEL_SLOTS','rule':'Rare jewels: max 2 prefix + 2 suffix (Magic jewels 1 + 1). The liquid emotion modifiers "+1 Prefix Modifier allowed" and "+1 Suffix Modifier allowed" raise one side by 1','conf':S1,'source':'IGGM 0.5.0 jewel article; the game help text (keyword ItemRarity) only gives the general 3 + 3','test':'t24'},
 {'id':'R_SWAP_REMOVAL','rule':'Perfect and Corrupted essences and liquid emotions remove a random modifier and add a guaranteed one: when the side of the new modifier is full, the removed modifier is one of that side; otherwise any modifier can go (Omens of Sinistral/Dextral Crystallisation limit essences to one side)','conf':M2,'source':'GGG forum thread 3853903 (player report, 14 Sept 2025) and the Mobalytics essence guide','test':'t25'},
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
 op('divine','Divine Orb',input='item with mods',effect='randomise numeric values of mods',conf=G,omens=['Omen of the Blessed (implicits only)','Omen of Sanctification (Rare -> Sanctify: each value x random 78-122%, R_SANCTIFIED_LOCK)']),
 op('chance','Orb of Chance',input='Normal',effect='-> random Unique of same class OR destroyed',conf=G,omens=['Omen of Chance (no destroy)','Omen of the Ancients (guaranteed Unique of same class)']),
 op('vaal','Vaal Orb',input='any non-corrupted',effect='unpredictable modification + Corrupted',conf=G,note='Omen of Corruption is legacy/unobtainable since 0.5.0'),
 op('fracture','Fracturing Orb',input='Rare with >=4 mods and no Fractured modifier',effect='fracture (lock) 1 random mod',conf=G),
 op('hinekora','Hinekora\'s Lock',input='item',effect='foresee result of next currency; any modification removes the foresight',conf=G),
 op('mirror','Mirror of Kalandra',input='item',effect='create mirrored copy',conf=G),
 op('artificer','Artificer\'s Orb',input='martial weapon, wand, staff or armour',effect='+1 augment socket',conf=G),
 op('essence_upgrade','Lesser/normal/Greater Essence of X',input='Magic',effect='-> Rare + guaranteed mod (counts as the 1 crafted mod)',conf=G,rule_refs=['R_ONE_CRAFTED']),
 op('essence_replace','Perfect Essence of X + special essences (Abyss, Breach, Horror, Insanity, Delirium, Hysteria)',input='Rare',effect='remove 1 random mod + add guaranteed mod',conf=G,omens=['Omen of Sinistral Crystallisation (removes prefix only)','Omen of Dextral Crystallisation (removes suffix only)'],note='Essence of the Abyss adds "Bears the Mark of the Abyssal Lord", replaced on next desecration'),
 op('alloy','13 Runic Alloys',input='Rare',effect='remove 1 random mod + add alloy-exclusive guaranteed mod (counts as crafted)',conf=G,league_scope='Forbidden Rites, Runes of Aldur and Standard: traded on the official Currency Exchange in each (checked 27 Sept 2026)',scope_conf='official_data'),
 op('desecrate','Bones: Jawbone (Rare weapon/quiver), Rib (Rare armour), Collarbone (Rare amulet/ring/belt), Altered Collarbone (+chance of otherworldly mods), Cranium (Rare jewel), Vertebrae (Rare waystone)',input='Rare',effect='adds 1 unrevealed Desecrated mod; reveal at Well of Souls = choose 1 of 3',conf=G,quality_rules={'Gnawed':'Maximum Item Level 64','Preserved':'any','Ancient':'Minimum Modifier Level 40'},quality_conf=G,full_item='a random modifier is also removed (R_DESECRATE_FULL)',omens=['Omen of Sinistral/Dextral Necromancy (side)','Omen of the Blackblooded (Kurgal) / Liege (Amanamu) / Sovereign (Ulaman) - weapon or jewellery only','Omen of Abyssal Echoes (reroll the options once)','Omen of Putrefaction (replace all mods with up to 6 unrevealed + corrupt; conflicts with 0.5 one-desecrated cap -> verify)'],rule_refs=['R_ONE_DESECRATED']),
 op('catalyst','Catalysts (Flesh=Life, Neural=Mana, Carapace=Armour/Evasion/ES, Uul-Netol\'s=Physical, Xoph\'s=Fire, Tul\'s=Cold, Esh\'s=Lightning, Chayula\'s=Chaos, Reaver=Attack, Sibilant=Caster, Skittering=Speed, Adaptive=Attribute, Necrotic=Minion); Refined = same for jewels',input='ring/amulet (Refined: jewel)',effect='adds quality enhancing that mod type; replaces other quality types',conf=G,source='item texts; types and item classes: game table AlternateQualityTypes (catalyst_qualities)',note='Game text (keyword Catalyst): exclusive drops from the Breach mechanic; 0.5 community sources: from the Genesis Tree'),
 op('quality','Blacksmith\'s Whetstone (martial weapon), Armourer\'s Scrap (armour), Arcanist\'s Etcher (wand/staff/sceptre), Glassblower\'s Bauble (flask)',input='item',effect='+quality',conf=G),
 op('infuser','Vaal Arcanist\'s/Armourer\'s/Blacksmith\'s/Catalysing Infuser',input='wand/staff/sceptre | armour | martial weapon | ring/amulet',effect='quality above max by up to 10%, chance to Corrupt',conf=G),
 op('flux','Blazing/Chilling/Crackling/Void Flux',input='item',effect='convert all elemental resistance mods to Fire/Cold/Lightning (Void: to Chaos) equivalents',conf=G),
 op('sacrifice','Kamasa\'s (amulet/ring/belt), Kopec\'s (armour), Yaomac\'s (weapon/quiver), Yugul\'s (jewel) Orb of Sacrifice',input='Rare with corruption enchantment',effect='upgrade corruption enchantment + remove 1 random mod',conf=G),
 op('architect','Architect\'s Orb',input='Corrupted equipment or jewel',effect='modify unpredictably or destroy',conf=G),
 op('cultivation','Vaal Cultivation Orb',input='Corrupted Vaal Unique / other Unique',effect='replace up to 2 mods / turn into corrupted Unique of same class',conf=G),
 op('liquid_emotion','Liquid emotions (Diluted, plain, Concentrated and Potent; the Ancient ones are for Time-Lost jewels)',input='Rare Basic Jewel (Ancient: Rare Time-Lost Jewel)',effect='removes a random modifier and adds the guaranteed crafted modifier the game lists for that jewel (liquid_emotions)',conf=G,source='item texts; outcomes: game table LiquidEmotionOutcomes',rule_refs=['R_ONE_CRAFTED','R_SWAP_REMOVAL']),
]
legacy=[{'name':'Omen of Homogenising Exaltation / Coronation','status':'drops disabled since 0.4 (Standard legacy)','conf':M2},
        {'name':'Omen of Corruption','status':'unobtainable since 0.5.0 (legacy)','conf':M2},
        {'name':'Omen of Recombination','status':'removed in 0.5.0','conf':M2},
        {'name':'Recombinator (Expedition)','status':'disabled in Runes of Aldur; status in 0.5.5 / Forbidden Rites unverified','conf':S1}]
kb['crafting_rules']=rules; kb['crafting_ops']=ops; kb['legacy_or_disabled']=legacy
# ---- essences that give one of several mods (EssenceMods rows without a fixed Mod: OutcomeMods, OutcomeModWeights).
# Table rows refer to BaseItemTypes and Mods by row number; RePoE's base_items.json and mods.json keep that order.
import csv as _csv
def _table(name):
    with open(get(name), encoding='utf-8') as f: return list(_csv.DictReader(f))
def _ints(v):
    v=(v or '').strip('[]'); return [int(x) for x in v.split(',') if x.strip()] if v else []
_item_keys=list(bases.keys()); _mod_keys=list(mods.keys()); _ess=_table('Essences.csv')
EO={}
for r in _table('EssenceMods.csv'):
    if r['Mod'] or not r['OutcomeMods']: continue
    name=bases[_item_keys[int(_ess[int(r['Essence'])]['BaseItemType'])]]['name']
    ids=[_mod_keys[i] for i in _ints(r['OutcomeMods'])]; ws=_ints(r['OutcomeModWeights'])
    cur=EO.setdefault(name,{'mods':[],'weights':[] if len(ws)==len(ids) else None})
    for i,mid in enumerate(ids):
        if mid in cur['mods']: continue
        cur['mods'].append(mid)
        if cur['weights'] is not None: cur['weights'].append(ws[i])
kb['essence_outcomes']=EO
# ---- augments (runes, soul cores, talismans, idols): stats per item class. Category -> item classes comes from the game
# table SoulCoreStatCategories; its "All", "Martial Weapon" and "Armour" rows are empty there and resolve through the
# essence categories of the same name (AllEquipment, Weapons, Armour).
_ic=[r['Id'] for r in _table('ItemClasses.csv')]
_cls=lambda v: [_ic[i] for i in _ints(v)]
_etc={r['Id']:_cls(r['ItemClasses']) for r in _table('EssenceTargetItemCategories.csv')}
_scc={r['Id']:_cls(r['TargetItemClasses']) for r in _table('SoulCoreStatCategories.csv')}
_wide={'All':_etc['AllEquipment'],'Martial Weapon':_etc['Weapons'],'Armour':_etc['Armour']}
def _classes(cat):
    got=list(_scc.get(cat) or _wide.get(cat) or [])
    if cat in ('Martial Or Caster Weapon','Martial Weapon Wand or Staff'): got+= [c for c in _etc['Weapons'] if c not in got]
    return got
AUG={}
for meta,v in json.load(open(get('poe2_augments.json'),encoding='utf-8')).items():
    b=bases.get(meta) or {}
    name=b.get('name') or meta.rsplit('/',1)[-1]
    if name.startswith('[DNT]') or b.get('release_state') not in (None,'released'): continue
    by={}
    for cat,c in (v.get('categories') or {}).items():
        for cl in _classes(cat):
            e=by.setdefault(cl,{'txt':[],'st':[]})
            e['txt']+= [clean(t) for t in c.get('stat_text') or []]
            e['st']+= [s['id'] for s in c.get('stats') or []]
            if c.get('bonded_stat_text'): e.setdefault('bonded',[]).extend(clean(t) for t in c['bonded_stat_text'])
    AUG[name]={'type':v.get('type_id'),'lvl':v.get('required_level'),'limit':clean(v.get('limit')) or None,'by_class':by}
kb['augments']=AUG
kb['meta']['counts']['augments']=len(AUG)
# ---- catalyst quality types (game table AlternateQualityTypes): the catalyst that adds each type, its item classes and the mod
# tag the planner reads as "the corresponding type of Modifier" (Omen of Catalysing Exaltation). Every tag must exist on mods.
_tagword={'Life':'life','Mana':'mana','Defence':'defences','Physical':'physical','Fire':'fire','Cold':'cold','Lightning':'lightning',
          'Chaos':'chaos','Attack':'attack','Caster':'caster','Speed':'speed','Attribute':'attribute','Minion':'minion'}
CQ=[]
for r in _table('AlternateQualityTypes.csv'):
    b=bases[_item_keys[int(r['Item'])]]
    CQ.append({'quality':r['Description'],'catalyst':b['name'],'classes':_cls(r['ItemClass']),
               'tag':_tagword[re.match(r'Quality \((\w+) Modifiers\)',r['Description']).group(1)],
               'text':clean((b.get('properties') or {}).get('description')).replace('\r','').split('\n')[0]})
_alltags={t for m in M.values() for t in m['mt']}
assert CQ and all(q['tag'] in _alltags for q in CQ), [q['tag'] for q in CQ if q['tag'] not in _alltags]
kb['catalyst_qualities']=CQ
kb['meta']['rules'].append('catalyst_qualities = catalyst quality types from the game table AlternateQualityTypes with the catalyst that adds each, the item classes it works on and the mod tag it favours.')
kb['meta']['rules'].append('augments = runes, soul cores, talismans and idols with their stats per item class (RePoE augments.json from the game tables; categories resolved with SoulCoreStatCategories). They go into augment sockets, not affix slots.')
# ---- Greater/Perfect currency floors: the game table TieredCurrency (Tier, MinimumModLevel) must agree with crafting_ops
_floor={bases[_item_keys[int(r['BaseItemType'])]]['name']:int(r['MinimumModLevel']) for r in _table('TieredCurrency.csv')}
_seen=set()
for o in ops:
    for tier,lvl in (o.get('min_mod_level') or {}).items():
        for n in o['names']:
            if n.startswith(tier+' '):
                assert _floor.get(n)==lvl, ('TieredCurrency disagrees', n, _floor.get(n), lvl)
                _seen.add(n)
    if o.get('min_mod_level'): o['floor_conf']='game_data'; o['floor_source']='game table TieredCurrency'
assert _seen==set(_floor), sorted(set(_floor)^_seen)
# ---- liquid emotions: the crafted modifier each adds on each jewel (game table LiquidEmotionOutcomes). A row with both a
# prefix and a suffix mod for one jewel adds one of the two. RadiusJewel rows are the Ancient ones, for Time-Lost jewels.
# Natural jewel outcomes keep their game ids here; scripts/augment_jewels.py points them at the knowledge base's jewel mods.
LQ={}
for r in _table('LiquidEmotionOutcomes.csv'):
    tl=r['RadiusJewel']=='1'
    by={}
    for j in ('Ruby','Emerald','Sapphire','Diamond'):
        ids=[_mod_keys[int(r[j+s])] for s in ('Prefix','Suffix') if r[j+s]]
        if ids: by[('Time-Lost '+j) if tl else j]=ids
        for mid in ids:
            m=mods[mid]
            if mid in M or (m.get('spawn_weights') and any(s['weight'] for s in m['spawn_weights'])): continue
            # crafted-only jewel mods (no spawn weight anywhere): kept so plans and pasted items can name them
            M[mid]={'fam':'+'.join(m.get('groups') or [m.get('type')]),'gen':m['generation_type'][0],'lvl':m.get('required_level'),
                    'txt':clean(m.get('text')),'st':[[s['id'],s.get('min'),s.get('max')] for s in (m.get('stats') or [])],
                    'mt':m.get('implicit_tags') or [],'grp':m.get('groups') or [],'sw':[],'dom':'i','src':'liquid'}
    LQ[bases[_item_keys[int(r['BaseItemType'])]]['name']]={'time_lost':tl,'by_base':by}
kb['liquid_emotions']=LQ
kb['meta']['counts']['liquid_emotions']=len(LQ); kb['meta']['counts']['mods']=len(M)
# mods that change how many prefixes or suffixes an item allows ("+1 Prefix Modifier allowed")
for m in M.values():
    if 'MaxPrefixMaxSuffix' in m['grp']:
        cap={}
        for x in re.finditer(r'([+-]\d+) (Prefix|Suffix) Modifiers? allowed', m['txt']): cap[x.group(2).lower()]=int(x.group(1))
        if cap: m['cap']=cap
kb['meta']['rules'].append('liquid_emotions = the crafted modifier each liquid emotion adds per jewel base (game table LiquidEmotionOutcomes; two ids = a prefix or a suffix, one of them is added). src:liquid mods are crafted-only; cap = change to the prefix/suffix limit.')
kb['meta']['rules'].append('essence_outcomes = essences that add one of several mods (game table EssenceMods.OutcomeMods, with OutcomeModWeights when the table has them; none = not in the files).')
_kw = json.load(open(get('poe2_keywords.json'), encoding='utf-8'))
KEYWORDS = ['ItemRarity','Rarity','Crafted','Fracture','Abyssalify','UnstableDesecration','Sanctified','Corrupted','Mirrored',
            'BetterCurrencyMinimumLevel','CurrencyMaximumItemLevel','Essence','Omen','Catalyst','Quality','MaximumQuality',
            'Augment','Ancient','SocketBound','Rune','Jewel','BasicJewel','Historic','Jewellery']
kb['game_keywords'] = {k: {'term': _kw[k]['term'], 'text': clean(_kw[k]['definition']).replace('\r', '')} for k in KEYWORDS if k in _kw}
kb['meta']['rules'].append('game_keywords = the game\'s own help texts for crafting terms (RePoE keywords.json); crafting_rules cite them as source.')
kb['meta']['rules'].append('crafting_rules / crafting_ops: conf = game_text (datamined in-game description) > patch_note_quote > multi_secondary > single_secondary (verify in game).')

json.dump(kb,open(OUT,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('game data', GAME_VERSION, '->', OUT, json.dumps(kb['meta']['counts']))
