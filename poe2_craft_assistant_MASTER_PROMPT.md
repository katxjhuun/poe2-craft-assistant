# PoE2 Craft Assistant — Master Build Prompt

- Sürüm: v1.0 (24 Eylül 2026)
- Hedef oyun: Path of Exile 2, patch 0.5.5 (oyun verisi 4.5.5.2)

> **Kullanım:** Bu dosyanın tamamını geliştiriciye yapıştır (claude.ai'de yeni bir sohbet ya da Claude Code). Yanına şu üç dosyayı ekle: `poe2_kb_0.5.5.json`, `poe2_bilgi_bankasi_0.5.5.md`, `poe2_kb_build.py`. Bölüm 12'de hedefi seç (A veya B) ve diğerini sil.

---

## 1. Rol ve görev

Sen, Path of Exile 2 (PoE2) için bir "Craft Assistant" paneli geliştiren kıdemli bir full-stack geliştirici ve oyun sistemleri analistisin. Görevin, kullanıcının yapıştırdığı item'ı okuyan, hedef statlara göre ucuz / orta / pahalı craft yolları çıkaran, her adımdan sonra fiyatı güncelleyen ve bunların hepsini yalnızca doğrulanmış PoE2 bilgisine dayanarak yapan bir panel inşa etmek.

Önce kısa bir uygulama planı yaz ve belirsiz noktaları varsayım olarak işaretle. Sonra Bölüm 11'deki fazlara göre kod teslim et.

## 2. Ürün akışı

1. Kullanıcı item'ı panele yapıştırır: oyunda Alt+Ctrl+C ile kopyalanan metin (Advanced Mod Descriptions açık), Ctrl+C metni ya da ekran görüntüsü.
2. Panel item'ı çözümler, oyun içi tooltip'i andıran bir önizleme çizer ve her modun yanına tier, değer ve bayrakları (fractured, desecrated, crafted) yazar.
3. Boş prefix/suffix slotlarına kullanıcı hedef stat girer. Item doluysa mevcut modun yanına "→" ile yerine gelmesini istediği stat yazılır.
4. Stat alanları PoE2 trade sitesindeki gibi çalışır: yazarken tahmin eden akıllı arama ve kategorili açılır liste.
5. Motor; mevcut item, hedefler, bütçe ve seçilen ligin fiyatlarına göre Ucuz / Orta / Pahalı craft yolları üretir.
6. Kullanıcı bir adımı oyunda uygular ve yeni item'ı yapıştırır. Önizleme, plan ve fiyat güncellenir.
7. Item önizlemesinin hemen altında, stat kutularının karşısında item'ın güncel değeri, harcanan currency ve hedefe kalan beklenen maliyet görünür; her işlemden sonra yeniden hesaplanır.

## 3. Değişmez kurallar

### 3.1 Yalnız PoE2; PoE1 karışması yasak

- JSON'daki `poe1_only_blacklist` isimleri arayüzde, planlarda ve açıklamalarda asla kullanılmaz (ör. Orb of Alteration, Orb of Scouring, Chromatic Orb, Awakener's Orb, Eldritch Chaos Orb, fossiller, "Screaming" ya da "Deafening" essence isimleri).
- PoE1 mekanik kalıpları yasaktır: crafting bench metamodları, fossil ve resonator, Harvest, beastcraft, influence (Shaper, Elder, Conqueror, Eldritch), veiled mod, "Chaos Orb tüm modları yeniden atar" (PoE2'de Chaos Orb 1 mod siler, 1 mod ekler), "alt-aug / alt-regal" jargonu (PoE2'de Orb of Alteration yok).
- Ham datamine verisine güvenme. PoE2 oyun dosyaları da PoE1 artıkları, `[DNT]` yer tutucuları ve çıkmamış sınıflar (Claw) içeriyor; `release_state` alanı güvenilmez. Yeni veri eklerken `poe2_kb_build.py` içindeki filtreleri uygula.
- Sızıntı testi: üretilen her plan ve açıklama metni kara listeye ve yasak kalıplara karşı taranır. Eşleşme varsa çıktı gösterilmez ve kayda geçirilir.

### 3.2 Uydurma yok

- Her currency, omen, mod ve kural JSON'daki bir kayda bağlanmalı (`crafting_ops`, `crafting_rules`, `mods`, `item_descriptions`). Kayıt yoksa arayüz "doğrulanmadı" der; tahmin yürütülmez.
- Güven seviyeleri (`conf`): `game_text` > `patch_note_quote` > `multi_secondary` > `single_secondary`. `single_secondary` kurallar planda sarı "oyunda doğrula" uyarısıyla gösterilir.
- Dil modeli yalnız açıklama ve özet yazar. Olasılık, maliyet, tier ve uygunluk sayıları deterministik motordan gelir; dil modeline sayı ürettirme.

### 3.3 Olasılıklar tahmindir

- PoE2 client verisinde gerçek roll ağırlıkları yok; spawn weight yalnız 0 ya da 1 (uygun / uygun değil).
- Motor ağırlıkları `weights/<patch>.json` dosyasından okur (topluluk tahmini; kaynak ve tarih alanlarıyla). Dosya yoksa "uygun modlar eşit olasılıklı" varsayımını kullanır ve her olasılığı "kaba tahmin" rozetiyle gösterir.
- Oyun metni garanti demiyorsa hiçbir ekranda "garanti" kelimesi kullanılmaz.

### 3.4 Sürüm ve lig

- JSON 0.5.5'e kilitlidir. PoE2 1.0'ın 11 Aralık 2026'da çıkması bekleniyor. 1.0 sonrasında veri yeniden üretilene kadar arayüzde "veri eski olabilir" bandı görünür.
- Her kural bir yama ve lig kapsamı taşır. Lig uygunluk matrisi bilgi bankası dokümanının 8. bölümündedir (ör. Runic Alloy'ların Forbidden Rites'ta bulunup bulunmadığı doğrulanmadı; Recombinator Runes of Aldur'da kapalı; Homogenising omen'leri ve Omen of Corruption yalnız Standard'daki eski kopyalar).

### 3.5 GGG politikası

- Yalnız belgelenmiş resmi API'ler kullanılır. Trade sitesinin dahili API'lerine otomatik istek atma, tarama yapma; GGG'ye göre belge dışı endpoint'leri tersine mühendislikle kullanmak ToS 7i'ye aykırıdır.
- Oyunla, oyun dosyalarıyla ya da bellekle etkileşim yok; ekranı okuyarak otomasyon yok. Item'ı kullanıcı kendisi kopyalar ve yapıştırır.
- API isteklerinde `User-Agent: OAuth {clientId}/{version} (contact: {email})` biçimi kullanılır.
- Arayüzde görünür bir yerde şu ibare bulunur: "This product isn't affiliated with or endorsed by Grinding Gear Games in any way." GGG logosu kullanılmaz, resmi arayüz birebir taklit edilmez, ticari gelir amaçlanmaz.

## 4. Bilgi katmanı: `poe2_kb_0.5.5.json`

### 4.1 Şema

| Anahtar | İçerik |
|---|---|
| `meta` | Sürüm, kaynaklar, kurallar, sayılar |
| `bases` | `{ad: {cls, lvl (drop level), tags[], imp[] (implicit metinleri), sig, tl (trade listesinde var mı), unconfirmed_class?}}`; 1.709 base |
| `tag_signatures` | `{S0: [tags]}`; aynı etiket setine sahip base'ler aynı havuzu paylaşır |
| `pools` | `{S0: {prefix: [[mod_id, tier]], suffix: [...]}}`; base başına doğal mod havuzu, tier'lar hesaplanmış |
| `mods` | `{id: {fam, gen ('p' / 's'), lvl (mod seviyesi), txt, st [[stat_id, min, max]], mt (mod etiketleri), grp (gruplar), sw [[etiket, 0/1]], dom ('i' normal, 'd' desecrated), eo? (yalnız essence)}}`; 2.885 mod |
| `stat_index` | Trade sitesi tarzı stat listesi: `{r: metin, ids: {explicit, desecrated, fractured, crafted, rune, implicit, enchant, pseudo, ...}, m: [eşleştirme kalıpları]}`; 2.526 kayıt |
| `currency_roster` | `{Currency: [...], Omen: [...]}` |
| `currency_metadata_ids` | İsim → oyun metadata id (Currency Exchange `market_id` çözümü için) |
| `item_descriptions` | Currency ve omen'lerin oyun içi açıklama metni |
| `crafting_rules` | Global kurallar (`conf`, `patch`) |
| `crafting_ops` | Currency ve omen operatörleri: girdi, etki, taban mod seviyesi, omen'ler, `conf`, lig kapsamı |
| `legacy_or_disabled` | Eski veya kapalı mekanikler |
| `poe1_only_blacklist` | 621 PoE1'e özgü isim |

### 4.2 Hesaplama kuralları

- **Uygunluk:** `mod.sw` listesinde sırayla ilerle; base'in sahip olduğu ilk etiket karar verir (ağırlık > 0 ise uygun, 0 ise engelli). `pools` bunu önceden hesaplar. `dom: 'd'` modları ayrı değerlendirilir; lich etiketleri `kurgal_mod`, `amanamu_mod`, `ulaman_mod`.
- **Item level kapısı:** `mod.lvl ≤ ilvl` değilse o tier çıkamaz.
- **Tier:** Aynı `fam` içinde, o base'de uygun olan modlar mod seviyesine göre büyükten küçüğe sıralanır; T1 en yüksek olandır (topluluk kuralı). Advanced kopyadaki `(Tier: N)` değeriyle çapraz kontrol et; tutarsızlıkta oyundakini göster ve kayda geçir.
- **Grup:** Aynı `grp`'dan iki mod aynı item'da olamaz.
- **Taban seviye (Greater / Perfect):** `crafting_ops[].min_mod_level`; `mod.lvl` tabanın altında olan tier'lar havuzdan çıkar. Taban bir aileyi tamamen boşaltıyorsa ne olduğu doğrulanmadı; bu durumda uyarı göster.
- **Metin temizliği:** JSON'daki metinler temizlenmiştir. Ham veriden gelirse `[A|B]` → `B`, `[A]` → `A`.

### 4.3 Güncelleme hattı

`poe2_kb_build.py` → yeni JSON → önceki sürümle fark raporu (eklenen / silinen modlar, değişen seviyeler) → Bölüm 10 testleri → onay. Kaynak depoların lisanslarını kontrol et. Ağırlık dosyası ayrı sürümlenir.

## 5. Item girişi ve çözümleme

### 5.1 Kanallar (öncelik sırasıyla)

1. **Alt+Ctrl+C metni** (oyunun UI ayarlarında Advanced Mod Descriptions açık olmalı). Prefix/suffix ve tier bilgisini doğrudan verir; yapıştırma alanında bunu öner.
2. **Ctrl+C metni.** Tier ve taraf bilgisi yoktur; JSON eşleştirmesiyle çıkarılır, güven düşük gösterilir.
3. **Ekran görüntüsü** (Ctrl+V ya da sürükle-bırak). Görsel destekli bir modelle metne çevir, çıktıyı Ctrl+C formatına normalize et ve aynı parser'dan geçir. Her satırın güvenini göster ve düzeltme imkânı ver. Ekran görüntüsü önizlemede küçük resim olarak kalır.

### 5.2 Metin formatı (0.5+)

- Bölümler `--------` satırıyla ayrılır. Başlıkta `Item Class: `, `Rarity: ` (Normal / Magic / Rare / Unique), ad ve base satırları bulunur; ardından `Item Level: `, kalite, soketler ve gereksinimler gelir.
- Advanced mod başlık satırı: `{ Prefix Modifier "Ad" (Tier: 2) — Etiket, Etiket }`. Türler: `Prefix Modifier`, `Suffix Modifier`, `Implicit Modifier`; ön ekler: `Fractured `, `Desecrated `, `Crafted `; corrupted implicit için `Corruption Enhancement`. Ayraç em dash karakteridir (U+2014).
- Basit kopyada satır sonunda ` (fractured)`, ` (desecrated)`, ` (crafted)` işaretleri görülür. Diğer işaretler ve durum satırları (ör. `Corrupted`, `Unidentified`, gizli "Unrevealed" desecrated modlar) için referans al.
- Referans uygulama: Exiled Exchange 2'nin `renderer/src/parser/` klasörü ve `renderer/public/data/en/client_strings.js` dosyası. Kullanmadan önce lisansını kontrol et.

### 5.3 Eşleştirme

- Her mod satırı → `stat_index` (metin kalıbı) → aynı kalıba uyan aday JSON modları → değerin min–max aralığına ve item level'a göre tier.
- Birden çok aday kalırsa (ör. hibrit modlar) listele ve kullanıcıya seçtir.
- Doğrulama: Magic ≤ 1 prefix + 1 suffix, Rare ≤ 3 + 3; en fazla 1 crafted ve 1 desecrated mod; item level'a göre imkânsız tier; aralık dışı değer. Hepsi uyarı olarak gösterilir.

### 5.4 ItemState şeması (örnek)

```json
{
  "base": "Wrath Sceptre",
  "itemClass": "Sceptre",
  "rarity": "Rare",
  "ilvl": 82,
  "quality": 0,
  "flags": {"corrupted": false, "sanctified": false, "mirrored": false},
  "mods": [
    {
      "slot": "suffix",
      "modId": "GlobalMinionSpellSkillGemLevelWeapon3",
      "text": "+3 to Level of all Minion Skills",
      "values": [3],
      "tier": 2,
      "fractured": false,
      "desecrated": false,
      "crafted": false,
      "confidence": 0.98
    }
  ],
  "sockets": [],
  "source": "adv_copy"
}
```

## 6. Arayüz

### 6.1 Yerleşim

Masaüstünde aşağıdaki gibi; mobilde aynı sırayla tek sütun.

```
┌─ Üst şerit: Lig seçimi | Veri sürümü | Fiyat verisinin saati ────────────────────┐
│ Yapıştırma alanı: "Item'ı yapıştır (Alt+Ctrl+C metni ya da ekran görüntüsü)"     │
├───────────────────────────────┬──────────────────────────────────────────────────┤
│ ITEM ÖNİZLEMESİ (tooltip)     │ Ekran görüntüsü (küçük) ve Önce / Sonra görünümü │
├───────────────────────────────┴──────────────────────┬───────────────────────────┤
│ PREFIX 1  [mevcut mod, T2, değer]  →  [hedef stat ▾] │ FİYAT                     │
│ PREFIX 2  [mevcut mod]             →  [hedef stat ▾] │ Tahmini değer (aralık)    │
│ PREFIX 3  (boş)                       [hedef stat ▾] │ Harcanan (kesin)          │
│ SUFFIX 1–3 ...                                       │ Hedefe kalan (beklenen)   │
│                                                      │ Kaynak ve saat            │
├──────────────────────────────────────────────────────┴───────────────────────────┤
│ PLANLAR: [Ucuz] [Orta] [Pahalı]  adımlar, olasılık, beklenen maliyet, risk        │
│ ADIM: "Greater Exalted Orb + Omen of Dextral Exaltation"  [Oyunda uyguladım]      │
│ GEÇMİŞ: zaman çizelgesi, geri al                                                  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Item önizlemesi

- Oyun içi tooltip'i andıran ama birebir kopyalamayan bir kart: rarity rengine göre başlık, base, özellikler, gereksinimler, implicit'ler, ayraç, explicit modlar. Oyunun görsellerini ve logolarını kullanma.
- Her işlemden sonra canlı güncellenir. Değişen satır kısa bir vurguyla gösterilir: eklenen mod belirir, silinen mod üstü çizili olarak solar. "Önce / Sonra" geçişi vardır.
- Önizleme modu: plan adımının olası sonuçlarını hayalet satırlarla gösterir (ör. "%38 olasılıkla T1–T2 Cold Resistance", tahmin rozetiyle).

### 6.3 Affix ızgarası ve hedefler

- 3 prefix + 3 suffix satırı (Magic item'da 1 + 1). Her satırda mevcut mod (tier rozeti, değer, bayrak ikonları) ve hedef alanı bulunur.
- Boş slotta "Hedef stat" alanı, dolu slotta "→ yerine" hedefi. Her satırda bir "koru" kilidi vardır; planlayıcı kilitli modu silmeye çalışmaz. Fractured modlar otomatik kilitlidir.
- Hedefte en az tier ya da en az değer seçilir; hedef "zorunlu" ya da "olsa iyi" olarak işaretlenir.
- Hazır hedef şablonları sunulur. Örnek: "Minion sceptre" = `+# to Level of all Minion Skills` + `Minions have #% increased maximum Life`. İkisi de sceptre'da suffix'tir; şablon bunu ızgarada doğru tarafa yerleştirir.

### 6.4 Stat seçici (trade sitesi benzeri)

- Combobox: yazarken bulanık arama ("fire res" → "+#% to Fire Resistance", "minion lvl" → "+# to Level of all Minion Skills"), klavyeyle gezinme, son kullanılanlar.
- Açılır liste grupları: Explicit prefix, Explicit suffix, Desecrated, Essence / Crafted, Alloy (lig izin veriyorsa).
- Varsayılan olarak yalnız bu base + item level + taraf için mümkün modlar listelenir. "İmkânsızları da göster" açılınca diğerleri gri ve gerekçeli görünür: "ilvl 78 gerekli", "bu base'de çıkmaz", "grup çakışması".
- Her stat için tier listesi gösterilir: değer aralığı ve gereken mod seviyesi.

### 6.5 Fiyat paneli (stat kutularının karşısında)

- Lig seçici (bkz. 8.1). Birim Exalted Orb; yanında Divine Orb karşılığı.
- Üç değer:
  - **Tahmini değer:** aralık ve güven seviyesiyle.
  - **Harcanan:** kullanılan currency × o anki fiyat; kesin.
  - **Hedefe kalan:** seçili planın beklenen maliyeti.
- Veri kaynağı ve saat damgası gösterilir; eski veride uyarı çıkar. Her işlemden sonra yeniden hesaplanır.
- "Resmi trade sitesinde karşılaştır" düğmesi (bkz. 8.4).

### 6.6 Plan kartları ve adım koşucu

- Her kartta: adım listesi (currency + omen'ler), adım başarı olasılığı, beklenen deneme sayısı, beklenen maliyet (aralık), item'ı bozma riski, "burada dur" kontrol noktaları ve kullanılan kuralların güven rozetleri.
- Adım koşucu: "Oyunda uyguladım" → yeni item'ı yapıştır → sonuç plana göre değerlendirilir ("beklenen", "kabul edilebilir", "sapma") → plan yeniden hesaplanır. Harcanan currency otomatik eklenir.
- Geçmiş: her adımdaki item durumu, harcama ve fiyat; geri alma.

### 6.7 Dil ve metin

- Arayüz Türkçe. Item, stat, currency ve omen adları oyundaki İngilizce halleriyle yazılır; böylece trade sitesi ve item metniyle birebir eşleşir.
- Düğmeler ne olacağını söyler: "Item'ı yapıştır", "Plan oluştur", "Oyunda uyguladım", "Sonucu yapıştır". Hata mesajları ne olduğunu ve nasıl düzeleceğini söyler.

### 6.8 Görsel yön

- Konu: oyun içi tooltip ve stash dünyası. Tek bir parlak vurgu rengi yerine anlamlı bir renk sistemi kullan.
- Renk önerisi:
  - Zemin `#1E1812` (koyu umber), yüzey `#2A2219`, metin `#D8CBB0`.
  - Rarity: Normal `#C8C8C8`, Magic `#8888FF`, Rare `#FFFF77`, Unique `#AF6025`.
  - Mod durumu: fractured `#B89B5E`, desecrated `#5FB39A`, crafted `#9CC4E4`, corrupted `#D64545`.
  - Eylem rengi `#C98B3A`.
- Yazı: item adları ve başlıklar için küçük büyük harfli serif "Spectral SC"; arayüz ve sayılar için "Atkinson Hyperlegible". Her ikisine yedek font yığını tanımla.
- Cesareti tek yerde kullan: item önizlemesi. Geri kalan sade kalsın. Hareket yalnız kullanıcı eylemine yanıt olarak (mod ekleme / silme). Klavye odağı görünür olsun, `prefers-reduced-motion` desteklensin, mobilde tek sütun olsun.

## 7. Craft motoru

### 7.1 Durum modeli

`ItemState` + `omensActive[]` + `hinekoraForesight?` + `spent[]` (kullanılan currency ve o anki fiyatı).

### 7.2 Operatörler (veri güdümlü)

- Her operatör `crafting_ops` kaydından üretilir: ön koşul (rarity, item sınıfı, mod sayısı, boş taraf, corrupted / sanctified değil), etki, taban mod seviyesi, omen etkileşimleri, crafted ve desecrated slot kuralları.
- Omen'ler operatör değiştiricidir. Aynı türden bir omen tek başına, farklı türler birlikte uygulanabilir (ör. Greater Exaltation + Dextral Exaltation). Omen yalnız eşleştiği currency'yi etkiler ve 3 + 3 sınırını aşamaz; imkânsız bir kombinasyon uygulanmaz, uyarı verilir.
- En az şu operatörler bulunur: Transmutation, Augmentation, Regal, Alchemy, Exalted, Chaos (Greater / Perfect dahil), Annulment, Divine, Chance, Vaal, Fracturing, Hinekora's Lock, Essence (Magic → Rare ve Rare'de değiştirme), Runic Alloy, Desecration + Reveal, Catalyst, kalite currency'leri, Vaal Infuser, Flux, Orbs of Sacrifice, Architect's Orb, Vaal Cultivation Orb, liquid emotion.
- Özel durumlar:
  - Whittling: "en düşük seviyeli mod" (en düşük tier değil).
  - Light: yalnız Desecrated modu siler.
  - Abyssal Echoes: reveal seçeneklerini bir kez yeniler.
  - Lich omen'leri (Blackblooded, Liege, Sovereign): yalnız weapon ve jewellery.
  - Crystallisation: Perfect veya Corrupted Essence'in sileceği tarafı belirler.
  - Catalysing Exaltation: catalyst kalitesini tüketip eşleşen mod türünün şansını artırır; çarpan tahmindir ve ayarlanabilir parametre olarak tutulur.

### 7.3 Simülasyon

- Monte Carlo (varsayılan adım başına 20.000 deneme, ayarlanabilir); basit adımlar için analitik hesap.
- Rastgelelik: uygun havuz (taraf, item level, grup, taban seviye, omen kısıtları) × ağırlık tablosu.
- Desecration reveal: 3 seçenekten en iyisini seçen oyuncu varsayımı; Abyssal Echoes varsa ikinci set.
- Sonuç dağılımı: hedef tam / kısmen / başarısız / item bozuldu; beklenen maliyet ve güven aralığıyla.

### 7.4 Yol arama

- Girdi: ItemState, hedefler (zorunlu / olsa iyi, en az tier), bütçe tavanı, risk toleransı, lig (mekanik uygunluğu ve fiyatlar).
- Aday üretimi: (a) doğrulanmış tarif kütüphanesindeki şablonlar (Bölüm 9), (b) sınırlı beam search (derinlik ≤ 8, genişlik ≤ 50).
- Her aday simüle edilir. Ölçütler: başarı olasılığı, beklenen maliyet, varyans, bozma riski, adım sayısı.
- Profiller:
  - **Ucuz:** en düşük beklenen maliyet; T2–T3 kabul; az omen; düşük başarı oranı kabul edilir.
  - **Orta:** maliyet ile başarı arasında denge; ana modlarda T1–T2.
  - **Pahalı:** en yüksek başarı olasılığı ve tier kalitesi; Perfect orb'lar, omen'ler, fracture ve desecration döngüleri.
- Her profil için "craft yerine satın al" karşılaştırması yapılır (8.4'te kullanıcının gözlemlediği fiyat varsa).

### 7.5 Güvenlik kontrolleri

- Geri alınamaz adımlardan önce (Fracturing, Vaal, Sanctify, Mirror) onay istenir ve "neden şimdi" açıklanır.
- Sıra ilkesi: ucuz ve geri alınabilir işlemler önce, pahalı ve geri alınamaz işlemler sona.
- Kural ihlali içeren plan asla gösterilmez (ör. ikinci crafted mod, ikinci desecrated mod, Magic item'a Exalted Orb).

### 7.6 Açıklama katmanı (dil modeli)

- Dil modeline yalnız şunlar verilir: plan JSON'u, simülasyon sonuçları, ilgili JSON kayıtları (id + `conf`). Görevi: kısa, adım adım Türkçe açıklama; sıranın gerekçesi; riskler.
- Çıktı PoE1 sızıntı filtresinden geçer. JSON'da olmayan bir isim geçerse yanıt reddedilir ve yeniden üretilir.

## 8. Ekonomi ve fiyat katmanı

### 8.1 Lig listesi

- Resmi `GET https://api.pathofexile.com/league?realm=poe2&type=main` ve `type=event` endpoint'leri `service:leagues` yetkisi, yani kayıtlı bir OAuth uygulaması ister. GGG şu an yeni uygulama kaydı işleyemiyor.
- Birincil yöntem: Currency Exchange verisindeki `league` alanlarından aktif ligleri türet (son 24 saatte hacmi olanlar). Kullanıcı elle lig adı da ekleyebilir. Kayıtlı bir istemci varsa resmi endpoint kullanılır.
- Varsayılan lig: en yüksek hacimli event veya challenge ligi. Seçim hatırlanır.

### 8.2 Currency fiyatları (resmi, herkese açık)

- `GET https://web.poecdn.com/api/currency-exchange/poe2/{id}`; `id` saate yuvarlanmış unix zamanıdır. Parametresiz çağrı en eski saati döndürür; güncel veri için son tam saati hesaplayıp gönder. Yanıttaki `next_change_id` gönderdiğin değerle aynıysa akışın sonundasın; bir sonraki saati bekle.
- Veri yalnız geçmişi kapsar; içinde bulunulan saat yoktur.
- Her markette şu alanlar bulunur: `league`, `market_id` ("A|B" biçiminde iki metadata id), `market_pair`, `volume_traded`, `lowest_stock`, `highest_stock`, `lowest_ratio`, `highest_ratio`. Sözlük anahtarları currency metadata id'leridir.
- İsimleri `currency_metadata_ids` ile çöz. Örnek: Chaos Orb = `Metadata/Items/Currency/CurrencyRerollRare`, Divine Orb = `Metadata/Items/Currency/CurrencyModValues`, Exalted Orb = `Metadata/Items/Currency/CurrencyAddModToRare`.
- `lowest_ratio` ve `highest_ratio` alanlarının yönü belgelenmemiş; gerçek bir yanıtla doğrula ve sabit bir örnek yanıtı birim testine koy.
- Fiyat = son 24 saatin hacim ağırlıklı medyanı, Exalted Orb cinsinden. Doğrudan Exalted paritesi yoksa Divine ya da Chaos üzerinden çapraz kur. Önbellek süresi 1 saat.
- Rate-limit başlıklarını (`X-Rate-Limit-*`, `Retry-After`) oku ve uy. 4xx yanıtları tekrarlama; çok sayıda geçersiz istek erişim kısıtına yol açar.

### 8.3 Yedek kaynaklar (resmi değil)

- poe.ninja PoE2 ekonomi verisi (belgesiz endpoint'ler) ve poe2scout (açık kaynak, API'si var). Kullanılırsa "resmi değil" rozeti, kaynak ve saat gösterilir; kullanım koşullarına uyulur.
- Hiçbiri yoksa kullanıcı fiyatları bir tablodan elle girer.

### 8.4 Item değeri: dürüst yöntem

- Rare item için resmi API'den anlık fiyat alınamaz; PoE2 için Public Stash API da yok. Panel bunu açıkça söyler ve üç değer sunar:
  1. **Harcanan (kesin):** kullanılan currency × fiyat.
  2. **Tahmini değer (aralık, düşük güven):** kullanıcının gözlemlediği karşılaştırma fiyatlarından ve basit bir mod-değer modelinden. Nasıl hesaplandığı gösterilir.
  3. **Resmi trade'de karşılaştır:** item'ın modlarından bir arama tarifi üretir (stat metinleri + en az değerler). Kullanıcı bunu resmi PoE2 trade sitesinde uygular ya da sitenin kendi içe aktarma özelliğine yapıştırır, gördüğü fiyatı panele girer. Önceden doldurulmuş arama bağlantısı ancak resmi olarak çalıştığı doğrulanırsa kullanılır.
- Dahili trade API'sine otomatik istek atılmaz.

### 8.5 Mimari notu

Tarayıcı `User-Agent` başlığını değiştiremez ve CORS sorun çıkarabilir. Bu yüzden fiyat çekimi küçük bir sunucu üzerinden (Hedef B) ya da bir MCP bağlayıcısıyla (Hedef A) yapılır. İstemci sırları (ileride OAuth) asla tarayıcıya konmaz.

## 9. Rehber analizi ve tarif kütüphanesi

### 9.1 Kaynak katmanları

- A: oyun verisi, resmi yama notları, oyun içi tooltip.
- B: poe2db, Craft of Exile, poe2wiki; yazarı ve yama etiketi belli rehberler (Maxroll, Mobalytics).
- C: topluluk derlemeleri, Reddit, Steam, videolar.
- D: currency satıcısı ve boost blogları; yalnız ipucu.

### 9.2 Hat

1. **Topla:** URL, yazar, yayın tarihi, iddia edilen yama.
2. **Ayrıştır:** atomik iddialar. Mekanik ("Omen X şunu yapar"), sıra (tarif adımları), sayı (olasılık, maliyet), ön koşul (item level, base).
3. **Kontrol et:**
   - Sürüm: yama 0.5.0'dan eskiyse tek crafted / tek desecrated kuralı öncesidir → "eski olabilir".
   - Varlık: her isim JSON'da var mı, kara listede mi?
   - Kural tutarlılığı: 3 + 3 sınırı, tek crafted, tek desecrated, taraf kısıtları, item level kapıları, lig uygunluğu.
   - Oyun metni: `item_descriptions` ile çelişiyor mu?
   - Matematik: olasılık iddiasını simülatörle yeniden hesapla; fark büyükse işaretle.
   - Bağımsız teyit: iddia en az iki bağımsız A veya B kaynağında var mı?
4. **Karar:** doğrulandı / olası (oyunda test) / eski / reddedildi; gerekçe ve kaynaklarla birlikte.
5. **Yayınla:** doğrulanan tarifler kütüphaneye; reddedilenler gerekçe notuyla arşive.

### 9.3 Tarif şeması

```json
{
  "id": "minion-sceptre-level",
  "patch": "0.5.5",
  "league_scope": ["Forbidden Rites", "Runes of Aldur", "Standard"],
  "target": {
    "itemClass": "Sceptre",
    "minIlvl": 78,
    "mods": [
      {"stat": "+# to Level of all Minion Skills", "minTier": 1, "required": true},
      {"stat": "Minions have #% increased maximum Life", "minTier": 2, "required": false}
    ]
  },
  "steps": [
    {"op": "exalt", "tier": "Perfect", "omens": ["Omen of Dextral Exaltation"], "expect": "suffix havuzundan bir mod"}
  ],
  "checkpoints": ["Minion level T1 gelmediyse ..."],
  "sources": [{"url": "...", "tier": "B", "date": "2026-.."}],
  "verdict": "olası",
  "notes": "Adımlar örnektir; gerçek tarif doğrulama hattından geçmeden yayınlanmaz."
}
```

### 9.4 Başlangıç verisi

Bilgi bankası dokümanının 10. bölümündeki 22 kararı kütüphaneye ve reddedilenler arşivine aktar.

## 10. Kabul testleri

### 10.1 Veri

- JSON yüklenir; sayılar `meta.counts` ile eşleşir.
- Hiçbir listede `poe1_only_blacklist` ismi ya da `[DNT]` görünmez.
- Sceptre'da `+# to Level of all Minion Skills` suffix'tir: +1 / +2 / +3 / +4, mod seviyeleri 2 / 25 / 55 / 78. Item level 75 sceptre'da +4 "imkânsız (ilvl 78 gerekli)" görünür.
- Helmet'ta aynı stat en fazla +2; Amulet'ta +3 (seviye 75); Belt'in doğal havuzunda yok (yalnız Genesis Tree etiketi).
- Perfect Exalted Orb (taban 50), sceptre suffix havuzundan +1 ve +2 minion level'ı çıkarır; +3 ve +4 kalır.

### 10.2 Kurallar

- Rare'de crafted mod varken ikinci bir Essence ya da Alloy planı üretilmez.
- Desecrated mod varken ikinci kemik planı üretilmez; önce Omen of Light + Orb of Annulment önerilir.
- 3 prefix'i dolu item'a Omen of Sinistral Exaltation + Exalted Orb planı reddedilir.
- Fractured mod hiçbir silme simülasyonunda silinmez.
- Magic item'a Exalted Orb uygulanamaz; Orb of Alchemy Normal ve Magic item'da çalışır.
- Omen of the Liege yalnız weapon ve jewellery desecration'ında geçerlidir; armour'da uyarı çıkar.
- Corrupted item'da yalnız corrupted item'a özgü currency'ler listelenir.

### 10.3 Parser

- Alt+Ctrl+C örnek metinleri (Magic, Rare, fractured, desecrated, crafted, corrupted, gizli desecrated) doğru ItemState üretir.
- Ctrl+C metninde taraf ve tier çıkarımı yapılır; belirsizse aday listesi gösterilir.
- Aynı item'ın metin ve ekran görüntüsü girdileri aynı ItemState'e yakınsar; farklar gösterilir.

### 10.4 Fiyat

- Sabit bir Currency Exchange yanıtıyla: metadata id → isim eşlemesi, Exalted cinsinden fiyat, çapraz kur, 1 saatlik önbellek ve rate-limit davranışı test edilir.
- Veri 3 saatten eskiyse uyarı çıkar.

### 10.5 Sızıntı

- Dil modeline bilerek "Orb of Scouring kullan" içeren bağlam verildiğinde çıktı filtrelenir.
- Rehber hattına "Chaos Orb tüm modları yeniden atar" iddiası verildiğinde "reddedildi" kararı çıkar.

## 11. Teslim fazları

- **F1:** JSON yükleme, parser (Alt+Ctrl+C ve Ctrl+C), tooltip önizleme, affix ızgarası, stat seçici.
- **F2:** kural motoru, simülatör, üç profilli plan, adım koşucu, geçmiş.
- **F3:** fiyat katmanı (Currency Exchange, lig türetme, önbellek), harcanan ve değer panelleri.
- **F4:** rehber analiz hattı ve tarif kütüphanesi.
- **F5:** ekran görüntüsü okuma, cila, erişilebilirlik, mobil.

Her fazın sonunda: çalışan demo, test sonuçları, bilinen eksikler listesi.

## 12. Uygulama hedefi (birini seç, diğerini sil)

### A) claude.ai Artifact (hızlı başlangıç)

- Tek bir HTML sayfası olarak yayınla. Yayınlanan sayfa dış sitelere istek atamaz (içerik güvenlik politikası). Bu yüzden:
  - JSON'u artifact'ın `assets` deposuna yükle; sayfa `/_blob/<id>` üzerinden okusun. (`assets` kullanan sayfa herkese açık paylaşılamaz; kişisel kullanım için sorun değil.)
  - Ekran görüntüsü okuma ve açıklamalar için `sample` yeteneğini kullan. Görsel desteğini `sample.limits()` ile kontrol et; ilk kullanımda izin istenir ve kullanım, sayfayı açan kişinin hesabından karşılanır.
  - Geçmiş, hedef şablonları ve fiyat anlık görüntüleri `db` içinde; kişisel veriler `user` + `db` ile kullanıcıya özel yolda.
  - Fiyatlar: (1) Currency Exchange'i saran özel bir MCP bağlayıcısı eklenirse `mcp` yeteneğiyle; (2) yoksa sohbette Claude'dan fiyat anlık görüntüsünü `db`'ye yazmasını iste; (3) ya da elle giriş. Her durumda saat damgası göster.
  - Yayınlamadan önce Artifact aracının `capabilities` eylemiyle güncel sözleşmeyi oku. `claude.use(...)` null dönerse ilgili özelliği gizle.
- Kısıt: saatlik otomatik fiyat güncellemesi ancak bağlayıcıyla mümkün.

### B) Tam web uygulaması (Claude Code ile)

- Ön yüz: Vite + React + TypeScript. Craft motoru ayrı bir TypeScript paketi (saf fonksiyonlar, Vitest testleri).
- Arka uç: küçük bir Node (Hono) servisi ya da Cloudflare Worker:
  - `GET /api/leagues` ve `GET /api/prices?league=`: Currency Exchange'i saatlik ve doğru `User-Agent` ile çeker, önbellekler, medyanları hesaplar.
  - `POST /api/ocr`: ekran görüntüsünü görsel destekli bir Claude modeline gönderir. API anahtarı yalnız sunucuda durur; güncel model listesi için https://docs.claude.com adresine bak.
  - `GET /kb/poe2_kb_0.5.5.json`: JSON'u sunar.
- `scripts/` altında `poe2_kb_build.py`; CI'da haftalık "yeni oyun verisi var mı" kontrolü.
- Kişisel kullanım; GGG ibaresi görünür; ticari kullanım yok.

## 13. İlk yanıtında beklediğim

1. Seçilen hedefe göre en fazla bir sayfalık mimari özet ve varsayımlar listesi.
2. F1'in kodu ve testleri.
3. Bilgi bankası dokümanının 13. bölümündeki açık sorular için oyunda yapılacak küçük ve ucuz test önerileri.
