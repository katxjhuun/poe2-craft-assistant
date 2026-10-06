# PoE2 Craft Assistant

Path of Exile 2 (patch 0.5.5) için bir craft paneli: yapıştırılan item'ı okur, hedef statlara göre Cheap / Balanced / Premium craft yolları çıkarır, her adımdan sonra planı ve fiyatları günceller. claude.ai Artifact olarak çalışır:
https://claude.ai/artifact/7N2pMNG8ZhbqRjqy2mQmhH

Tasarım belgesi `poe2_craft_assistant_MASTER_PROMPT.md`, oyun bilgisi `poe2_bilgi_bankasi_0.5.5.md` ve `poe2_kb_0.5.5.json`.

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## Yapı

| Yol | İçerik |
|---|---|
| `app/index.src.html` | Sayfa (arayüz, fiyat bağlantısı, veritabanı, `sample` ile açıklama ve ekran görüntüsü okuma) |
| `app/engine.js` | Item metni ayrıştırıcı, eşleştirme, stat seçici, sızıntı filtresi |
| `app/planner.js` | Kurallar, 26 craft operatörü, Monte Carlo, profiller, tarif adayları ve beam search |
| `app/guide.js` | Rehber iddialarını denetleme, kaynak katmanları, tarif kütüphanesi, lig kuralları |
| `app/value.js` | Kaydedilen fiyatlardan item değeri tahmini |
| `app/pricecheck.js` | Fiyat kontrolü: Exiled Exchange 2'nin trade araması (MIT lisansı, kaynak başlıkta) |
| `scripts/coe_crosscheck.py` | Craft of Exile verisiyle karşılaştırma (tier'lar, ağırlıklar, desecrated), `reports/coe-crosscheck.md` |
| `app/data/` | Tarifler ve karar kaydı, poe2db ağırlıkları, ikonlar, self-test sonuçları |
| `app/tests/` | JS testleri (kabul testleri 10.1–10.5 dahil) |
| `scripts/fetch_prices.py` | Resmi Currency Exchange özeti + Exiled Exchange 2 (poe.ninja) fiyatları |
| `scripts/build_price_package.py` | Fiyat belgelerinden npm paketi |
| `scripts/fetch_icons.py`, `build_icons.py` | Fiyatlı eşyaların ikonları (web.poecdn.com, adresler Exiled Exchange 2 listesinden) ve paketi |
| `scripts/kb_update.py`, `kb_diff.py` | Bilgi tabanı güncelleme hattı (build / check / approve) |
| `scripts/selftest/` | Ağır self-test: rastgele yürüyüşler, strateji madenciliği, tarif karşılaştırması; `sweep.js` bütün strateji kombinasyonlarını tarar |
| `.github/workflows/prices.yml` | Fiyat işi (3 saatte bir) |

## Komutlar

```bash
node app/build.js                          # app/dist/index.html ve data/ (sonra Artifact olarak yayınlanır)
node --test app/tests/*.test.js            # JS testleri
python -m unittest discover -s scripts/tests
python scripts/fetch_prices.py             # fiyatları yerelde günceller (.kb_cache/out)
node scripts/selftest/run.js               # self-test (~30 dk); --quick kısa sürüm
scripts\selftest\capped.cmd node scripts/selftest/sweep.js --workers 25   # tam tarama (~5 saat); CPU'nun 25/32'sinde
scripts\selftest\capped.cmd node scripts/selftest/sweep_planner.js --workers 25   # planner'ı taramaya karşı ölçer (~30 dk)
python scripts/kb_update.py build          # yeni bilgi tabanı adayı, sonra check / approve
python scripts/fetch_icons.py              # yeni fiyatlı eşyaların ikonları, sonra scripts/build_icons.py
```

`.kb_cache/` (indirilen oyun verisi, fiyat saatleri, ikonlar) ve `app/dist/` depoya girmez.

## Tam tarama (`scripts/selftest/sweep.js`)

Self-test senaryolarının her birinde (başlangıç item'i + hedefler) planner'ın bütün strateji ayarlarının çarpımını (yaklaşık 10,6 milyon kombinasyon) kapsar ve sayfanın Cheap / Balanced / Premium seçimlerini denetler.

1. **Sınıflar.** Planner ayarları yalnızca sonucu değiştirebilecekleri yerde okur. Tarama hangi ayarların okunduğunu kaydeder; aynı rastgele sayılarla, okunan her ayarda aynı değeri taşıyan iki strateji birebir aynı hamleleri yapar. Uzay yalnızca okunan ayarlarda bölünür, her yaprak ("sınıf") kapsadığı bütün kombinasyonları temsil eder.
2. **Eleme.** Her sınıf kısa bir koşu alır (6 deneme, hepsi aynı rastgele sayılarla); iyimser tahmine göre en iyiler 30, sonra 300 denemeyle yeniden koşulur.
3. **Eşleştirme.** Cheap = bitmiş item başına en düşük maliyet, Balanced = bitirme şansıyla tartılmış maliyet, Premium = en yüksek bitirme şansı (sayfanın profil skorları).
4. **Doğrulama.** Atanan stratejiler, sayfa planner'ının kendi seçimi ve rakipler yeni rastgele sayılarla 1.000 denemeyle koşulur: aynı sıklıkta bitiren daha ucuzu var mı, daha pahalı olmayan daha garantilisi var mı? Varsa atama değişir ve yeniden denetlenir; son seçim 4.000 denemeyle ikinciyle bir kez daha karşılaştırılır.

Rare başlangıçta item'i atıp yeni base'e geçen stratejiler (slamOnly) dışarıda tutulur: yapıştırılan Rare item bitirilecek item'dir. Beyaz ve Magic başlangıçta yeni base yöntemin parçasıdır.

Son tam tarama (6 Ekim 2026, 283 dakika, 25 çekirdek): 784 senaryo, 12,9 milyar kombinasyon, 8,4 milyon sınıf, 9,6 milyon simülasyon. Yeniden simülasyon ilk atamayı Cheap'te 58, Balanced'ta 94, Premium'da 116 senaryoda değiştirdi; Cheap ve Balanced için atanandan daha ucuzu hiçbir senaryoda kalmadı.

İlgili betikler:

- `sweep_planner.js`: sayfanın plan akışını her senaryoda çalıştırır ve seçimini taramanın doğrulanmış en iyisiyle karşılaştırır (784 senaryo ~30 dakika, `--limit 150` ile ~6 dakika). Planner'daki her değişiklik bununla ölçülür.
- `sweep_report.js`: `reports/sweep-latest.md` (özet) ve `reports/sweep-summary.json`; `--planner <dosya>` ile planner tarafını bir `sweep_planner.js` ölçümünden alır.
- `capped.cmd`: komutu CPU'nun bir kısmında (varsayılan 32 mantıksal çekirdeğin 25'i) ve düşük öncelikte çalıştırır. `watch.sh`: ilerlemeyi çubuk olarak gösterir.

Yarıda kesilen tarama `reports/sweep-partial.jsonl` dosyasından devam eder; `--fresh` baştan başlatır. Tam sonuç `reports/sweep-latest.json` depoya girmez.

### Planner araması (taramadan çıkanlar)

Sayfanın araması (`app/planner.js`, `makeScreen`) taramanın yöntemlerini kullanır:

- Aynı davranan stratejiler tek koşuyu paylaşır (okunan ayarlar kaydedilir, aynı rastgele sayılar kullanılır).
- Koşular üç uzunluktadır (40, 200, 800 deneme); kısa koşu yalnızca kimin uzun koşu alacağını iyimser bir tahminle belirler.
- Başlangıç adayları profilin ızgarası, kütüphanedeki tarifler ve taramanın en sık kazanan rotalarıdır (`ROUTES_RARE`, `ROUTES_START`). Bazı rotalar yalnızca birlikte işe yarar (Orb of Alchemy + tutmazsa yeni base), tek ayar değiştiren arama onlara ulaşamaz.
- Beam search bir ya da iki ayarı birlikte değiştirir; seçimde, yalnızca en uzun koşunun okuduğu ayarların (nadir yolların) diğer değerleri de denenir, çünkü nadir bir çıkmaz maliyetin büyük kısmını taşıyabilir.

Ölçüm (784 senaryo, doğrulanmış en iyiye göre): Cheap %93, Balanced %90, Premium %89 aynı strateji, eşdeğer sonuç ya da daha iyisi; geri kalanların çoğunda fark %10'un altında. Aynı 150 senaryoda eski arama Cheap %25, Balanced %27, Premium %71 oranında daha kötüydü; yenisi %5, %8, %9. Item başına süre değişmedi (ortanca ~25 saniye).

## Fiyat hattı

1. `.github/workflows/prices.yml` 3 saatte bir (UTC :20) `fetch_prices.py` çalıştırır. Kaynaklar resmi Currency Exchange özeti (24 saatlik hacim ağırlıklı medyan) ve Exiled Exchange 2'nin poe.ninja verisi. EE2 fiyatları resmi özetten sistematik olarak saparsa (medyan oran 0,75–1,33 dışı) o lig resmi veride kalır.
2. Belgeler `poe2-craft-assistant-prices` npm paketine yayınlanır (npm trusted publishing, saklı anahtar yok). İş akışı npm yeni sürümü listeleyince jsDelivr önbelleğini temizler.
3. Sayfa paketi jsDelivr'dan (olmazsa unpkg) saatlik bir ekle, ayrı bir Web Worker içinde yükler ve yalnızca veriyi alır. Artifact sayfası başka sitelere istek atamaz, yalnızca bu CDN'lerden script yükleyebilir.
4. Paket yüklenemezse sayfa artifact veritabanındaki son kopyayı ya da sayfayla gelen `prices-snapshot.json` dosyasını kullanır.
5. Paket, bilgi tabanının kaynağı olan RePoE PoE2 dışa aktarımının güncel oyun verisi sürümünü de taşır (`meta.gameData`). Bu sürüm bilgi tabanınınkinden yeniyse sayfada "veri eski olabilir" bandı çıkar; bilgi tabanı `scripts/kb_update.py` ile yeniden üretilince kaybolur.

## Fiyat kontrolü (Exiled Exchange 2'den uyarlandı)

- Value panelindeki **Price check**, Exiled Exchange 2'nin (MIT, © 2020 Alexander Drozdov ve katkıda bulunanlar) arama kurma kodunun uyarlamasıdır (`app/pricecheck.js`): hazır ayarlar (bitmiş Magic/Rare/Unique için "Pseudo", Normal ve craft değeri olan eşyalar için "Base item"), item filtreleri (kategori ya da base, rarity, item level, corrupted, mirrored, sanctified, fractured, rune soketi, kalite, gerekli seviye, açılmamış desecrated), pseudo toplamlar (direnç, attribute, can, mana, ES, hareket hızı), %20 kaliteye göre armour/evasion/ES ve DPS, ±%10 arama aralığı (unique'lerde roll aralığının payı), "# Empty Modifier" sayısı ve trade2 sorgusu.
- Uyarlamalar: sayfa trade sitesini okuyamaz (Artifact CSP'si ve GGG ToS 7i), arama resmi sitede açılır; Corruption Enchantment'lar varsayılan açıktır (iki kez corrupted eşyalar bunlarla fiyatlanır); sanctified eşya sanctified eşyalarla karşılaştırılır. PoE Overlay II kapalı kaynak olduğu için yalnızca aynı tür arama davranışı alındı.
- Her türde çalışır: unique (ad + base, değişken satırlar), normal base, magic (jewel'larda "magic" rarity), rare, corrupted, iki kez corrupted, sanctified, desecrated (açılmış ve açılmamış), fractured.
- Fiyat listesi yalnızca giyilebilir eşyaların craft malzemelerini gösterir (fragment, gem, tablet, waystone, flask/charm malzemeleri yok).

## Workbench (Craft of Exile'dan esinlenildi)

- Item panelindeki **Workbench** düğmesi, item'in bir kopyası üzerinde çalışır: **Emulator** (currency, orb tier'ı ve omen seçip rastgele sonucu görmek, geri almak, istenirse "Use as my item" ile ana item'e aktarmak) ve **Calculator** (All/Any/At least N/None gereksinim grupları, tek kullanımın olasılığı; gruplar hedeflerden başlar).
- Bone (desecrate) kullanımında emülatör, Well of Souls'taki gibi 3 Desecrated mod sunar; varsayılan en yüksek seviyeli olandır (planner da onu alır), başka biri seçilebilir. Omen of Abyssal Echoes seçiliyse ilk üçlü bir kez yeniden çekilebilir; lich omen'leri (Blackblooded, Liege, Sovereign) de seçilebilir. Aynı kullanım aynı tohumla (seed) tekrar oynatılır, yani seçim değişince item'in geri kalanı değişmez.
- Stat seçicide her stat'ın yanında, bir sonraki rastgele modun o stat olma yüzdesi yazar (o taraf içinde; tooltip'te herhangi bir yeni mod içinde).
- **Strategy** (Craft of Exile'ın Simulator'ı gibi): Emulator'da seçilen currency adım olarak eklenir; her adımın kuralları sırayla denenir ("şu grup tutarsa → sonraki adım / bu adım tekrar / yeni base (baştan) / dur / N. adım"), hiçbiri tutmazsa "Otherwise", currency kullanılamıyorsa "If it cannot be used" hedefine gidilir; adım başına en fazla kullanım sayısı verilebilir. Koşullar stat'lar (tier sınırıyla), açık prefix/suffix slotu ve rarity olabilir. Hedef Calculator'daki gruplardır; koşu hedefe ulaşınca biter. 2.000 koşu dilimler hâlinde çalışır (en fazla 15 sn), sonuç: başarı oranı (%95 aralığı), koşu ve bitmiş item başına maliyet, medyan ve %90'lık maliyet, adım başına kullanım, koşuların nasıl bittiği. Yeni base, plan ayarlarındaki White base fiyatıyla sayılır; bütçe varsa koşu orada durur. Well of Souls'ta hedefin veya bir kuralın istediği Desecrated mod teklif edilirse alınır, yoksa Abyssal Echoes yeniden çeker, sonra en yüksek seviyeli olan alınır. Adımlar bu tarayıcıda item sınıfı başına hatırlanır.
- Planner fonksiyonları: `P.emulate`, `P.chanceOf`, `P.familyChances`, `P.runStrategy`, `P.runStrategyAsync`, `P.groupsMet`.

## Bilinen eksikler

Amaç: yapıştırılan item hangi durumda olursa olsun, hedef item'e giden craft adımlarını en verimli sırayla sunmak. Kapsam yalnızca karaktere giyilen, etkisi yüksek eşyalar ve jewel'lar.

- Kapsam dışı (kullanıcı kararı): flask ve charm craft'ı, tablet, waystone, amulet anointing, Verisium Anvil, craft dışı malzemeler ve canlı trade ilanı çekmek. Başka eşyalardaki flask ve charm statları (ör. belt'teki Flask Recovery) diğer statlar gibi planlanır.
- Soul modları (Medved's Tending) desteklenmiyor (kullanıcı, 28 Eylül 2026: sayıları yalnızca omen + Divine Orb ile yeniden atılabiliyor; ikinci bir kaynakla doğrulanmadı). Planner onları atmaz ve hedef olarak sunmaz; yapıştırılan item'de okunurlar.
- Desecration (R_DESECRATE_REVEAL): açılmamış modun tarafı bone kullanılırken belli olur. Well of Souls o tarafın normal modlarından ve yalnızca desecrate ile gelen modlardan 3 seçenek sunar: özel olanların sayısı %80/%15/%5 olasılıkla 1/2/3 (Craft of Exile), lich omen'i ilk seçeneği o lich'ten yapar. Gnawed bone ve sceptre yalnızca normal mod verir.
- Fiyatı olmayan malzeme bedava sayılmaz. İsteğe bağlı omen'ler (yön omen'leri, Greater, Catalysing, Homogenising, Whittling, Crystallisation, Abyssal Echoes) fiyatsızsa plandan çıkarılır ve bildirilir; fiyatsız zorunlu bir malzeme (bone, essence) kullanan plan, fiyatı tam bilinen bütün planların arkasında sıralanır. 6 Ekim 2026'da fiyatsız olanlar: Homogenising, Coronation, Alchemy, Greater Annulment ve Corruption omen'leri, Gnawed ve Ancient Cranium, Essence of Battle, Lesser Essence of Ruin. İlk tam tarama Homogenising omen'ini bedava saydığı için geçersizdi ve düzeltilip yeniden koşuldu.
- Kurallar mümkün olduğunca oyunun kendi metinlerine dayanıyor (`game_keywords`): tek crafted mod, dolu eşyada desecration, fractured kilidi, Sanctify aralığı, Minimum Modifier Level, Maximum Item Level, socket-bound augment'lar (açıklamasında "cannot be retrieved or replaced" yazan 17 rune/core; Orb of Extraction item'i yok eder ve bunları geri vermez).
- Oyun tablolarından: liquid emotion sonuçları, catalyst kalite türleri, Greater/Perfect alt seviyeleri, modların eşyaya eklediği tag'ler (caster silahlarda bir elementin büyü modu diğerlerini engeller; Grasping Mail yüzük modlarını açar).
- Olasılıklar tahmindir: mod ağırlıkları poe2db'nin topluluk verisi; Craft of Exile 8.987 tier'ın 8.929'unda aynı olasılığı veriyor, 58 tier'da ayrışıyor (sayfada seçilebilir). Desecrated modlar eşit ağırlıklı (Craft of Exile de öyle). Catalysing Exaltation çarpanı ×25: oyuncunun testi (t8, 4 yüzükte 4/4 attribute modu), ×6 ve üstü bu sonuçla uyumlu; ayarlanabilir.
- Kaynaklarda tam verisi olmayanlar (tahminle): Vaal Orb sonuç oranları (~%25'er, Maxroll/Game8) ve "1-3 mod"un dağılımı, Architect's Orb 50/50, Orb of Sacrifice'ın yükselttiği değer, Orb of Chance'in taban başına oranları (emülatör olası unique'leri listeler), Altered Collarbone'un "otherworldly" modları, catalyst başına kalite (%1, 50 altı item level'da %2), Rune of Aldur ve Void Flux'ın "eşdeğer mod" eşlemesi.
- Beyaz bazdan başlayan planlarda yeni baza dönmek çoğu zaman pahalı omen'lerle düzeltmekten ucuzdur ama çok sayıda baz ister. Baz fiyatı ve eşya başına baz sınırı oyuncunun girdisidir.
- Rare item değeri kullanıcının kaydettiği fiyatlardan tahmin edilir. Price check (Exiled Exchange 2'den uyarlandı) aramayı kurar ve resmi sitede açar; ilan çekilmez.
- Unique fiyatları poe.ninja'dan gelir; ilan sayısı olmadığı için nadir unique'lerde gerçek satıştan uzak olabilir.
- Ctrl+C (basit) metninde tier yoktur; aynı metne uyan hibrit ve yerel/genel modlar seçim için işaretlenir.
- Fiyat paketi npm'de herkese açık; Standard ligde EE2 ile resmi özet arasındaki fark koruma sınırına yakın.
- Veri 0.5.5'e kilitli. Yeni oyun verisi çıkınca sayfada uyarı bandı çıkar; bilgi tabanını yeniden üretmek elle yapılır: `kb_update.py build`, `check`, `approve`, sonra yayın.
- Self-test simülatörün veriye ve kurallara uyduğunu doğrular, oyunun davranışını değil. Oyun içi testlerin (t1–t31) hepsi kapandı.
