# PoE2 Craft Bilgi Bankası — Patch 0.5.5

- Derleme tarihi: 24 Eylül 2026
- Oyun verisi sürümü: 4.5.5.2 (patch 0.5.5)
- Makine tarafı: `poe2_kb_0.5.5.json`
- Yeniden üretim: `poe2_kb_build.py`

Bu doküman, craft asistanının dayandığı bilginin insan tarafından okunabilir özeti ve doğrulama kaydıdır. Her bilgi bir güven etiketi taşır:

| Etiket | Anlamı |
|---|---|
| OYUN METNİ | Oyun dosyalarından çıkarılmış açıklama ya da veri. En güçlü kanıt. |
| YAMA NOTU | Resmi yama notundan alıntı. |
| ÇOKLU | En az iki bağımsız ikincil kaynak aynı şeyi söylüyor. |
| TEK | Tek ikincil kaynak. Pahalı bir craft'tan önce oyunda doğrula. |
| TAHMİN | Topluluk tahmini (ör. mod ağırlıkları). |

## 1. Güncel durum

- **0.5.0 Return of the Ancients** 29 Mayıs 2026'da çıktı; challenge ligi **Runes of Aldur**. (ÇOKLU)
- **0.5.5 Forbidden Rites** event ligi 4 Eylül 2026'da sıfır ekonomiyle başladı ve PoE2 **1.0**'a kadar sürecek; 1.0'ın 11 Aralık 2026'da çıkması bekleniyor. (ÇOKLU)
- 0.5.5 ile Runes of Aldur'un Verisium/Runeforging kısmı ve Expedition core oldu; Verisium Anvil, Act 4'teki Runeseeker göreviyle açılıyor. (ÇOKLU, ikincil kaynaklar)
- Sonuç: bu bilgi bankası 0.5.5'e kilitlidir. 1.0 çıktığında `poe2_kb_build.py` ile yeniden üret, farkları incele ve kural tablosunu yeni yama notlarına göre güncelle.

## 2. Kaynaklar ve güven katmanları

| Katman | Kaynak | Ne için | Dikkat |
|---|---|---|---|
| A | RePoE fork PoE2 export (`github.com/repoe-fork/poe2`, 4.5.5.2) | Mod metni, mod seviyesi, prefix/suffix, grup, spawn etiketleri, base'ler, currency açıklamaları | Gerçek ağırlık yok (yalnız 0/1). PoE1 artıkları ve `[DNT]` yer tutucuları var. `release_state` alanı güvenilmez. |
| A | GGG developer docs | API sınırları ve politika | — |
| A | Resmi yama notları (forum) | Kural değişiklikleri | — |
| A- | Exiled Exchange 2 verisi (`github.com/Kvan7/Exiled-Exchange-2`) | Trade sitesi tarzı stat listesi ve trade id'leri; trade item listesi | Topluluk bakımlı; bazı base'ler eksik (ör. 13 sceptre'dan yalnız 5'i listede). |
| B | poe2db.tw, Craft of Exile (PoE2), poe2wiki | Tier tabloları, tahmini ağırlıklar | Ağırlıklar tahmindir. |
| B | Maxroll, Mobalytics | Yöntem fikirleri | Yazar ve yama tarihine bak. |
| C | Topluluk derlemeleri (ör. Domistae codex, kendini "hızlı başvuru, kesin kaynak değil" diye tanımlıyor), Reddit, Steam, videolar | İpucu | Tek başına kanıt sayılmaz. |
| D | Currency satıcısı ve boost siteleri | Yalnız ipucu | PoE1 karışması ve uydurma sayı riski yüksek. |

## 3. Temel kurallar (0.5.5)

| Kural | Güven |
|---|---|
| Normal item'da explicit mod yok; Magic en fazla 1 prefix + 1 suffix; Rare en fazla 3 prefix + 3 suffix. | ÇOKLU |
| Bir modun bir tier'ı ancak mod seviyesi ≤ item level ise çıkabilir. | ÇOKLU |
| Aynı mod grubundan iki mod aynı item'da olamaz; garanti mod veren currency çoğaltmak yerine başarısız olur. | ÇOKLU |
| **0.5+:** Item başına en fazla 1 crafted mod. Essence (her tier), Perfect ve özel Essence'ler, Runic Alloy'lar ve bazı Runic Ward enchant'ları aynı slotu kullanır. | YAMA NOTU |
| **0.5+:** Item başına en fazla 1 Desecrated mod; Desecrated modlar crafted sayılmaz. | YAMA NOTU |
| Fractured mod silinemez ve değiştirilemez. | ÇOKLU |
| Corrupted item'lar yalnız corrupted item'a özgü currency'lerle değişir (Architect's Orb, Orbs of Sacrifice, Vaal Cultivation Orb). | OYUN METNİ |
| Sanctified item'larda craft büyük ölçüde kapanır. | TEK |
| **0.5+:** Sanctify ve Vaal'ın değer rastgeleleştirme sonucu, modun mevcut değerini çarpar; bu yüzden önce Divine ile değerleri yükselt. | ÇOKLU |
| Gerçek roll ağırlıkları client verisinde yok; olasılıklar tahmindir. | ÇOKLU + veri kontrolü |

## 4. Currency'ler ne yapar

"Etki" sütunu oyun içi açıklamalardan alınmıştır (OYUN METNİ). Greater/Perfect taban mod seviyeleri açıklamada yazmaz; ikincil kaynaklardan gelir (ÇOKLU).

| Currency | Uygulandığı yer | Etki | Omen ile kontrol | Not |
|---|---|---|---|---|
| Orb of Transmutation / Greater / Perfect | Normal | Magic, 1 mod | — | Taban: Greater 44 (0.5'ten önce 55), Perfect 70 |
| Orb of Augmentation / Greater / Perfect | Magic, boş taraf | +1 mod | — | Taban: 44 / 70 |
| Regal Orb / Greater / Perfect | Magic | Rare + 1 mod | Sinistral/Dextral Coronation | Taban: 35 / 50 |
| Orb of Alchemy | Normal veya Magic | Rare, 4 mod | Sinistral/Dextral Alchemy | |
| Exalted Orb / Greater / Perfect | Rare, boş slot | +1 mod | Sinistral/Dextral Exaltation; Greater Exaltation (+2 mod); Catalysing Exaltation | Taban: 35 / 50 |
| Chaos Orb / Greater / Perfect | Rare | 1 rastgele mod siler, 1 mod ekler | Sinistral/Dextral Erasure (silinecek taraf); Whittling | PoE1'deki gibi tam reroll değildir. Taban: 35 / 50 |
| Orb of Annulment | Modlu item | 1 rastgele mod siler | Sinistral/Dextral Annulment; Greater Annulment (2 mod); Light (yalnız Desecrated) | |
| Divine Orb | Modlu item | Sayısal değerleri yeniden atar | Blessed (yalnız implicit); Sanctification (Rare'i Sanctify eder) | |
| Orb of Chance | Normal | Aynı sınıftan rastgele Unique olur ya da item yok olur | Chance (yok olmaz); the Ancients (Unique garanti) | |
| Vaal Orb | Bozulmamış item | Öngörülemez değişiklik + Corrupted | — | Omen of Corruption 0.5'ten beri elde edilemiyor |
| Fracturing Orb | En az 4 modlu Rare | Rastgele 1 modu kilitler | — | |
| Hinekora's Lock | Item | Sonraki currency'nin sonucunu önceden gösterir; item değişirse etki kalkar | — | |
| Mirror of Kalandra | Item | Kopya üretir | — | |
| Artificer's Orb | Martial weapon, wand, staff, armour | +1 augment socket | — | Jewellery'ye uygulanmaz |
| Essence (Lesser / normal / Greater) | Magic | Rare + garanti mod | — | Crafted slotu kullanır |
| Perfect Essence ve özel Essence'ler (Abyss, Breach, Horror, Insanity, Delirium, Hysteria) | Rare | 1 rastgele mod siler + garanti mod ekler | Sinistral/Dextral Crystallisation (silinecek taraf) | Essence of the Abyss "Bears the Mark of the Abyssal Lord" ekler; sonraki desecration bunun yerine geçer |
| Runic Alloy'lar (13 adet) | Rare | 1 rastgele mod siler + alloy'a özgü garanti mod ekler | — | Crafted slotu kullanır; lig kapsamı için bkz. bölüm 8 |
| Kemikler (desecration) | Rare | Gizli bir Desecrated mod ekler; Well of Souls'ta 3 seçenekten biri seçilir | bkz. bölüm 7 | |
| Orbs of Sacrifice (Kamasa's, Kopec's, Yaomac's, Yugul's) | Corruption enchant'ı olan Rare | Enchant'ı yükseltir + 1 rastgele mod siler | — | Kamasa: amulet/ring/belt. Kopec: armour. Yaomac: weapon/quiver. Yugul: jewel |
| Architect's Orb | Corrupted ekipman veya jewel | Öngörülemez değişiklik ya da item yok olur | — | |
| Vaal Cultivation Orb | Corrupted Vaal Unique ve diğer Unique'ler | 2 moda kadar değiştirir; diğer Unique'leri aynı sınıftan Corrupted Unique'e çevirir | — | |
| Flux'lar | Item | Blazing: Cold ve Lightning res → Fire res. Chilling: Fire ve Lightning → Cold. Crackling: Fire ve Cold → Lightning. Void: tüm elemental res → Chaos res. | — | Perfect Flux, item'daki skill'leri level 20'ye çıkarır |
| Kalite currency'leri | Whetstone: martial weapon. Armourer's Scrap: armour. Arcanist's Etcher: wand/staff/sceptre. Glassblower's Bauble: flask. | Kalite ekler | — | |
| Vaal Infuser'lar | Arcanist's: wand/staff/sceptre. Armourer's: armour. Blacksmith's: martial weapon. Catalysing: ring/amulet. | Maksimum kaliteyi %10'a kadar aşar; Corrupt etme şansı var | — | "%20 kalite şartı" iddiası TEK |
| Liquid emotion'lar (ör. Liquid Despair) | Rare basic jewel | 1 rastgele mod siler + garanti crafted mod ekler | — | |

## 5. Catalyst eşlemesi (OYUN METNİ)

Ring ve amulet içindir; "Refined" sürümleri aynı eşlemeyle jewel içindir. Yeni catalyst, item'daki diğer kalite türünün yerini alır.

| Catalyst | Güçlendirdiği modlar |
|---|---|
| Flesh | Life |
| Neural | Mana |
| Carapace | Armour, Evasion, Energy Shield |
| Uul-Netol's | Physical |
| Xoph's | Fire |
| Tul's | Cold |
| Esh's | Lightning |
| Chayula's | Chaos |
| Reaver | Attack |
| Sibilant | Caster |
| Skittering | Speed |
| Adaptive | Attribute |
| Necrotic | Minion |

0.5'ten beri catalyst'ler yalnız Genesis Tree'den (Breach) elde ediliyor. (ÇOKLU)

## 6. Omen'ler (50 adet, OYUN METNİ)

**Item craft omen'leri**

- Sinistral / Dextral Exaltation: Exalted Orb yalnız prefix / suffix ekler.
- Sinistral / Dextral Annulment: Orb of Annulment yalnız prefix / suffix siler.
- Sinistral / Dextral Erasure: Chaos Orb yalnız prefix / suffix siler.
- Sinistral / Dextral Coronation: Regal Orb yalnız prefix / suffix ekler.
- Sinistral / Dextral Crystallisation: Perfect veya Corrupted Essence yalnız prefix / suffix siler.
- Sinistral / Dextral Necromancy: desecration yalnız prefix / suffix ekler.
- Sinistral / Dextral Alchemy: Orb of Alchemy en fazla sayıda prefix / suffix verir.
- Greater Exaltation: Exalted Orb 2 mod ekler. Greater Annulment: Orb of Annulment 2 mod siler.
- Whittling: Chaos Orb en düşük seviyeli modu siler. En düşük tier'ı değil; her seferinde oyunda hover ile hangi modun vurgulandığını kontrol et.
- Light: Orb of Annulment yalnız Desecrated modu siler.
- Abyssal Echoes: Desecrated reveal seçenekleri bir kez yenilenebilir.
- the Blackblooded / the Liege / the Sovereign: weapon veya jewellery desecration'ında sırasıyla Kurgal / Amanamu / Ulaman modunu garanti eder.
- Putrefaction: desecration tüm modları en fazla 6 gizli modla değiştirir ve item'ı Corrupt eder. 0.5'in tek Desecrated mod kuralıyla çelişiyor; oyunda doğrula.
- Catalysing Exaltation: Exalted Orb, catalyst kalitesini tüketerek eşleşen mod türünün şansını artırır. Çarpan TAHMİN.
- Sanctification: Rare item'da Divine Orb, item'ı Sanctify eder. Blessed: Divine Orb yalnız implicit'leri yeniden atar.
- Chance: Orb of Chance item'ı yok etmez. the Ancients: Orb of Chance aynı sınıftan Unique garanti eder.

**Waystone omen'leri:** Chaotic Effectiveness, Chaotic Monsters, Chaotic Quantity, Chaotic Rarity. Waystone'da kullanılan Chaos Orb, tüm modları ilgili türü vermeyen modlarla değiştirir.

**Craft dışı (panelde gizle):** Amelioration (ölümde deneyim kaybı), Answered Prayers (shrine), Bartering (satışta altın değeri), Gambling (gamble altın maliyeti), Refreshment (flask ve charm şarjı), Reinforcements (Rogue Exile), Resurgence (düşük canda iyileşme), Secret Compartments (strongbox), the Hunt (possessed canavar), Saga'lar: Aldur's, Medved's, Olroth's, Uhtred's, Vorana's (Expedition logbook).

**Eski veya kapalı:** Homogenising Exaltation ve Homogenising Coronation (0.4'ten beri düşmüyor; Standard'daki eski kopyalar), Omen of Corruption (0.5'ten beri elde edilemiyor), Omen of Recombination (0.5'te kaldırıldı). (ÇOKLU)

## 7. Desecration (Abyss)

- Kemik ve item eşlemesi (OYUN METNİ): Jawbone → Rare weapon veya quiver. Rib → Rare armour. Collarbone → Rare amulet, ring, belt. Altered Collarbone → aynı item'lar + "otherworldly" mod şansı. Cranium → Rare jewel. Vertebrae → Rare waystone.
- Kemik kalitesi kuralları (TEK): Gnawed yalnız item level ≤ 64; Preserved her item level'da; Ancient en az mod seviyesi 40.
- Reveal: Well of Souls'ta 3 seçenekten biri seçilir. (ÇOKLU)
- JSON'da 299 desecrated mod var. Lich etiketleri: `kurgal_mod`, `amanamu_mod`, `ulaman_mod`. Ayrıca `breach_desecration` etiketi var; Altered Collarbone ile ilişkili olması muhtemel, doğrula.
- 0.5: Instant Leech veren desecrated modlar artık çıkmıyor. (TEK)
- Standart döngü: Necromancy omen'i (taraf) + gerekirse lich omen'i + Abyssal Echoes → kemik → reveal. Sonuç kötüyse Omen of Light + Orb of Annulment ile yalnız Desecrated modu sil ve tekrarla.

## 8. Lig ve mekanik uygunluğu

| Mekanik | Runes of Aldur | Forbidden Rites | Standard | Güven |
|---|---|---|---|---|
| Verisium, Runeforging, Verisium Anvil | var | var (0.5.5'te core) | var | ÇOKLU |
| Runic Alloy'lar | var | doğrulanmadı | doğrulanmadı | TEK ("Runes of Aldur'a özgü") |
| Recombinator | kapalı | doğrulanmadı | doğrulanmadı | ÇOKLU (RoA için); diğerleri açık soru |
| Genesis Tree (Breach) | var | var | var | ÇOKLU |
| Liquid emotion ile jewel craft | var | var | var | ÇOKLU |
| Homogenising omen'leri, Omen of Corruption | düşmüyor | düşmüyor | eski kopyalar | ÇOKLU |

## 9. Veriyle doğrulanmış örnekler (planlayıcı testleri için)

**+# to Level of all Minion Skills** (suffix):

| Item | Tier ve gereken mod seviyesi |
|---|---|
| Sceptre | +1 (2), +2 (25), +3 (55), +4 (78) |
| Helmet | +1 (5), +2 (41) |
| Amulet | +1 (5), +2 (41), +3 (75) |
| Belt | Doğal havuzda yok; +1 (36) ve +2 (64) yalnız Genesis Tree minion etiketiyle |
| Hiçbir base | +5 (81): doğal spawn etiketi yok |

- Sceptre suffix havuzunda "Minions have #% increased maximum Life" de var (6 tier, T1: %46–50, mod seviyesi 80). İkisi de suffix olduğu için aynı sceptre'da iki suffix slotunu birlikte kullanır.
- Perfect Exalted Orb (taban 50), sceptre suffix havuzundan +1 ve +2 minion level'ı eler; +3 ve +4 kalır.
- Item level 75 olan bir sceptre'da +4 çıkamaz (78 gerekir).
- Necrotic Catalyst, ring ve amulet'taki Minion modlarını güçlendirir; Omen of Catalysing Exaltation ile birlikte kullanılabilir.
- `IncreasedLife` ailesinde 13 tier var (mod seviyesi 1–80), ama bir base'de kaç tier'ın uygun olduğu base'e göre değişir. Sabit tier sayısı varsayma.

## 10. Rehber doğrulama kaydı

| # | İddia | Kaynak türü | Karar | Gerekçe |
|---|---|---|---|---|
| 1 | "Chaos Orb bir rare'deki tüm modları yeniden atar" | D | Reddedildi | PoE1 davranışı. PoE2 oyun metni: 1 mod siler, 1 mod ekler. |
| 2 | "Screaming Essence of Anger kullan" | D | Reddedildi | PoE1 isimlendirmesi. PoE2'de Lesser / normal / Greater / Perfect Essence of X. |
| 3 | "alt-aug" ve "alt-regal" döngüleri | C | Terim reddedildi | PoE2'de Orb of Alteration yok. Magic item'ı yeniden atmanın ucuz eşdeğeri yok; Annulment + Augmentation pahalı bir alternatif. |
| 4 | "Orb of Alchemy yalnız Normal item'a uygulanır" | C | Düzeltildi | Oyun metni: Normal veya Magic. |
| 5 | "Uul-Netol's Catalyst attack modlarını güçlendirir"; catalyst listesi 10 adet | C | Düzeltildi | Oyun metni: Physical. Neural (Mana), Carapace (defans) ve Necrotic (Minion) listede eksikti. |
| 6 | "Artificer's Orb her ekipmana soket ekler" | C | Düzeltildi | Oyun metni: martial weapon, wand, staff, armour. |
| 7 | "Chaos Shard'lar birleşip Chaos Orb olur" | C | Şüpheli | PoE2 trade listesinde yalnız Transmutation, Regal, Chance, Artificer's ve Raven-Touched shard var. |
| 8 | "Greater Exalted için item level ≥ 35" | C | Düzeltildi | Item level değil, en az mod seviyesi (35). |
| 9 | Lich omen eşlemesi (Blackblooded → Kurgal, Liege → Amanamu, Sovereign → Ulaman) | C | Doğrulandı | Oyun metni; yalnız weapon ve jewellery. |
| 10 | Tek crafted + tek desecrated mod | B/C | Doğrulandı | Yama notu alıntısı ve birden çok bağımsız kaynak. |
| 11 | "Omen of Putrefaction ile 6 desecrated modlu item" | C | Çelişkili | Oyun metni hâlâ böyle diyor; 0.5 kuralı tek desecrated mod diyor. Oyunda test et. |
| 12 | "Whittling en düşük tier'ı siler" | C | Düzeltildi | Oyun metni: en düşük seviyeli mod. Oyuncular beklenmedik vurgulamalar bildiriyor; her seferinde hover ile kontrol et. |
| 13 | Kesin yüzde olasılıklar | C/D | Tahmin | Ağırlıklar client'ta yok. Kaynağı belirtilmeyen yüzdeler reddedilir. |
| 14 | Homogenising Exaltation ile +level craft | B/C | Eski | 0.4'ten beri düşmüyor; Standard'a özgü. |
| 15 | Recombinator tarifleri | B/C | Eski veya belirsiz | Runes of Aldur'da kapalı; 0.5.5 durumu doğrulanmadı. |
| 16 | "Omen of Sinistral Necromancy ~9 Ex", "Divine ≈ 88 Ex" | D | Geçici | Fiyatlar haftalık değişir; bilgi bankasına fiyat yazılmaz. |
| 17 | "Vaal Infuser için %20 kalite şartı" | C | Tek kaynak | Oyun metninde yok. |
| 18 | "Mod etiketleri oyunda hiç görünmez" | C | Belirsiz | Advanced kopya satırında em dash'ten sonra bir etiket alanı parse ediliyor (EE2). Oyunda kontrol et. |
| 19 | "İkinci Essence birincinin üzerine yazar" | D | Belirsiz | Başka bir kaynak "engeller ya da üzerine yazar" diyor. Oyunda test edilene kadar planlayıcı ikinci crafted mod önermez. |
| 20 | "Vaal Orb Unique'i rastgele bir Rare'e çevirebilir" | C | Doğrulanmadı | Oyun metni yalnız "öngörülemez değişiklik" diyor. |
| 21 | Catalysing Exaltation çarpanı (%20 kalitede yaklaşık 5×) | C | Tahmin | Oyun metninde oran yok; ayarlanabilir parametre olarak tut. |
| 22 | Sanctify çarpan aralığı %78–122 | C | Tek kaynak | Doğrula. |

## 11. PoE1 sızıntısını önleme

**Kanıtlar**

- PoE2'nin kendi oyun dosyalarında PoE1 currency'leri duruyor: Orb of Alteration, Orb of Scouring, Orb of Fusing, Chromatic Orb, Orb of Regret, Awakener's Orb, Eldritch Chaos/Exalted Orb, Harbinger's Orb, Orb of Unmaking, Blessed Orb, Sacred Orb, Crusader's Exalted Orb, Cartographer's Chisel ve fossiller. Hiçbiri PoE2 trade listesinde yok.
- RePoE'nin kök export'u PoE1'dir (3.29.x); PoE2 ayrı depodadır (4.5.x). Yanlış depodan veri çekmek en kolay karışma yoludur.
- PoE2 verisinde `[DNT]` yer tutucu base'ler, Claw sınıfı ve `release_state: released` görünen çıkmamış içerik var.
- Rehberlerde PoE1 mekanikleri ve jargonu dolaşıyor (bkz. bölüm 10, satır 1–3).

**Kabul kuralı:** Bir isim ya da mekanik yalnızca (a) PoE2 trade listesinde veya PoE2 oyun metninde varsa ve (b) PoE1 kara listesinde yoksa bilgi bankasına girer.

**İsim kara listesi:** JSON'da 621 isim var (`poe1_only_blacklist`). En sık karışanlar: yukarıdaki orb'lar; Veiled Chaos Orb; Eldritch Orb of Annulment; Crusader's, Elder's ve Hunter's Exalted Orb; Tainted Chaos Orb; Orb of Dominance; Delirium Orb'lar; Oil'ler (Amber, Azure, Clear, Crimson, Golden, Indigo, Opalescent); PoE1 catalyst'leri (Abrasive, Accelerating, Fertile, Imbued, Intrinsic, Noxious); Muttering, Screaming, Deafening gibi essence ön ekleri; Chaos, Exalted, Alchemy, Alteration ve Annulment shard'ları.

**Mekanik kara listesi:** crafting bench ve metamodlar ("Prefixes Cannot Be Changed" vb.), fossil ve resonator, Harvest, beastcraft, influence (Shaper, Elder, Conqueror, Eldritch), veiled mod, Chaos Orb ile tam reroll, Orb of Scouring ile temizleme, Orb of Alteration ile Magic reroll.

## 12. Resmi API gerçekleri (fiyat katmanı için)

- Sunucu: `https://api.pathofexile.com`. GGG, PoE2 için veri döndüren API'lerin sınırlı olduğunu belirtiyor.
- **Currency Exchange (herkese açık):** `GET https://web.poecdn.com/api/currency-exchange/poe2/{id}`. `id`, saate yuvarlanmış unix zamanıdır; verilmezse en eski saat döner. Saatlik özettir, yalnız geçmişi içerir, içinde bulunulan saat yoktur. Alanlar: `next_change_id`, `markets[]` → `league`, `market_id` ("A|B" metadata id), `market_pair`, `volume_traded`, `lowest_stock`, `highest_stock`, `lowest_ratio`, `highest_ratio`.
- **Leagues:** `GET /league?realm=poe2&type=main` ve `type=event`; `service:leagues` yetkisi gerekir.
- **Characters:** `GET /character/poe2/{name}`; `account:characters` (OAuth) gerekir. İleride karakterden item içe aktarmak için kullanılabilir.
- **Public Stash API** yalnız PoE1 içindir. PoE2 item fiyatları için resmi bir akış yok.
- **Uygulama kaydı:** GGG şu an yeni uygulama başvurusu işleyemiyor.
- **Oyun verisi:** GGG pasif ağaçlar dışında oyun verisi dağıtmıyor.
- **Politika:** Belge dışı endpoint'leri tersine mühendislikle kullanmak ToS 7i'ye aykırıdır. İstekler `User-Agent: OAuth {clientId}/{version} (contact: {email})` biçimini kullanmalıdır. Rate-limit başlıklarına uyulmalıdır; çok sayıda 4xx yanıt erişim kısıtına yol açar. Uygulamada "This product isn't affiliated with or endorsed by Grinding Gear Games in any way." ibaresi görünmelidir. GGG'nin fikri mülkiyetiyle ticari gelir elde edilemez.
- **Resmi olmayan yedekler:** poe.ninja PoE2 ekonomi verisi (belgesiz endpoint'ler), poe2scout (açık kaynak, API'si var).

## 13. Açık sorular (oyunda test et)

1. Advanced kopyadaki `Tier: 1` en iyi tier mi? JSON'un hesapladığı tier ile karşılaştır.
2. Greater/Perfect taban seviyeleri (44/70 ve 35/50) doğru mu; taban bir mod ailesini tamamen boşaltırsa ne oluyor?
3. Gnawed ve Ancient kemiklerin kısıtları.
4. İkinci crafted mod uygulanmaya çalışılınca ne oluyor: engel mi, üzerine yazma mı?
5. Omen of Putrefaction'ın 0.5'teki davranışı.
6. Recombinator ve Runic Alloy'ların Forbidden Rites'taki durumu.
7. Sanctify çarpan aralığı.
8. Kılıç, balta, dagger ve flail sınıfları 0.5.5'te düşüyor mu? Kılıçların 1.0 ile gelmesi bekleniyor; JSON'da `unconfirmed_class` ile işaretli.
9. Advanced kopyada mod etiketleri görünüyor mu?
10. Currency Exchange'deki `lowest_ratio` ve `highest_ratio` alanlarının yönü.

## 14. Kaynakça

- GGG developer docs: https://www.pathofexile.com/developer/docs/reference, https://www.pathofexile.com/developer/docs/index, https://www.pathofexile.com/developer/docs/data
- 0.5.0 yama notları: https://www.pathofexile.com/forum/view-thread/3932540
- 0.5.5 yama notları: https://www.pathofexile.com/forum/view-thread/4000864
- RePoE PoE2: https://github.com/repoe-fork/poe2 (PoE1 kök export: https://github.com/repoe-fork/repoe-fork.github.io)
- Exiled Exchange 2: https://github.com/Kvan7/Exiled-Exchange-2
- Craft of Exile ağırlık notu: https://www.craftofexile.com/weightings?game=poe2
- poe2db: https://poe2db.tw/us/
- Domistae crafting codex: https://domistae.github.io/poe2-leveling/poe2_crafting_codex.html
- 0.5.0 craft değişiklikleri özeti: https://bugfree.gg/guides/poe2-crafting-changes-0-5-0
- poe2scout: https://github.com/poe2scout/poe2scout
- Whittling tartışması (Steam): https://steamcommunity.com/app/2694490/discussions/0/598524553372696566
- Benzer araçlar: https://pathofcrafting.net, https://poe2craft.com
