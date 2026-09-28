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
| `scripts/selftest/` | Ağır self-test: rastgele yürüyüşler, strateji madenciliği, tarif karşılaştırması |
| `.github/workflows/prices.yml` | Fiyat işi (3 saatte bir) |

## Komutlar

```bash
node app/build.js                          # app/dist/index.html ve data/ (sonra Artifact olarak yayınlanır)
node --test app/tests/*.test.js            # JS testleri
python -m unittest discover -s scripts/tests
python scripts/fetch_prices.py             # fiyatları yerelde günceller (.kb_cache/out)
node scripts/selftest/run.js               # self-test (~10 dk); --quick kısa sürüm
python scripts/kb_update.py build          # yeni bilgi tabanı adayı, sonra check / approve
python scripts/fetch_icons.py              # yeni fiyatlı eşyaların ikonları, sonra scripts/build_icons.py
```

`.kb_cache/` (indirilen oyun verisi, fiyat saatleri, ikonlar) ve `app/dist/` depoya girmez.

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

- Flask ve charm craft'ı kapsam dışı (kullanıcı kararı): bu eşyalar yapıştırılınca panel desteklenmediklerini söyler. Başka eşyalardaki flask ve charm statları (ör. belt'teki Flask Recovery) diğer statlar gibi ağırlıkları ve çıkma şartlarıyla planlanır.
- Desecration (R_DESECRATE_REVEAL): açılmamış modun tarafı bone kullanılırken belli olur (Necromancy omen'i yoksa rastgele). Well of Souls o tarafın normal modlarından ve yalnızca desecrate ile gelen modlardan 3 seçenek sunar; özel mod çıkabiliyorsa en az biri özeldir (ekipmanda item level 65+). Bu yüzden Gnawed bone ve sceptre yalnızca normal mod verir (t22, t23). Lich omen'i yalnızca o lich'in modlarını sunar. Kaynaklar: poe2db, Game8, Sift ve oyuncunun staff'larındaki Desecrated T1 normal mod. İlk seçenek dışındakilerin yaklaşık yarısının özel olması tek kaynaklı bir tahmin (t31). Normal hedefler için de bone kullanmak (desSlam) bir strateji seçeneği; simülasyon ucuz olduğu yerde seçer.
- Kurallar mümkün olduğunca oyunun kendi yardım metinlerine dayanıyor (bilgi tabanında `game_keywords`, RePoE `keywords.json`): tek crafted mod, dolu eşyada desecration, fractured kilidi, Sanctify aralığı, Minimum Modifier Level ve Maximum Item Level.
- Oyun tablolarından: liquid emotion sonuçları (`LiquidEmotionOutcomes`), catalyst kalite türleri (`AlternateQualityTypes`), Greater/Perfect alt seviyeleri (`TieredCurrency`, build'de karşılaştırılır), Verisium Anvil yükseltmeleri (`Expedition2VerisiumCrafts`, yalnızca listelenir). Modların eşyaya eklediği tag'ler (`adds_tags`) havuza uygulanır: caster silahlarda bir elementin büyü modu diğerlerini engeller; "Can roll Ring Modifiers" (Grasping Mail) yüzük modlarını açar.
- Flux (R_FLUX, t20): diğer elementlerin bütün direnç modları aynı tier'da hedef elemente döner, değer yeniden atılır; item'de o element zaten varsa ikisi birden kalır.
- Topluluk kaynaklı, oyun içinde doğrulanacak: Rare jewel 4 modu geçebilir mi (t24: oyuncu ve Maxroll 4 diyor, rehberler 5 modlu jewel anlatıyor); Perfect essence ve liquid emotion dolu tarafta o taraftan mod siler (t25); Catalysing Exaltation'ın gücü (t8); essence'ların item level kontrolü (t18); Well of Souls seçeneklerinin kaçı özel (t31). Kaynakla kapananlar: T1 en iyi tier (t1, oyuncunun 25 modu), ikinci essence girmez (t3), Catalysing ile yan omen birleşir (t12, Maxroll), Alt+Ctrl+C mod tag'lerini içerir (t14), jewel'lar Transmutation/Regal ile craft edilir (t21, Maxroll). Doğrulananlar: Potent Contempt/Ferocity modu silinen tarafa ekler (t26), Runeforging modları korur, Runic Ward ekler ve 55+ base'lerde savunmayı düşürür (t28), Grasping Mail yüzük catalyst'lerini alır (t29), jewel'lara Orb of Chance kullanılamaz.
- Unique jewel'lar (13) bilgi tabanında: base, sınır, bozuk düşme, satırları; her item'de değişen satırlar işaretli.
- Beyaz bazdan başlayan planlarda yeni baza dönmek (Magic aşamasında iki hedef tutmazsa ya da Rare'de taraf dolunca) çoğu zaman pahalı omen'lerle düzeltmekten çok daha ucuzdur ama çok sayıda baz ister. Baz fiyatı (varsayılan 1 ex) ve eşya başına baz sınırı (varsayılan 100) oyuncunun girdisidir; piyasada o kadar baz bulunmayabilir. Sınırın ötesinde çok daha ucuz bir yol varsa plan bunu söyler.
- Olasılıklar tahmindir: mod ağırlıkları poe2db'nin topluluk verisi (base-mod çiftlerinin %99,8'inde var; kalanlar ailenin en düşük ağırlığını alır), desecrated modlar eşit ağırlıklı, Catalysing Exaltation çarpanı (varsayılan ×5) tek kaynaklı ve ayarlanabilir.
- Rare item değeri yalnızca kullanıcının kaydettiği fiyatlardan tahmin edilir; resmi fiyat geçmişi yok ve trade sitesine otomatik istek yasak (ToS 7i). Price check aramayı kurar, sonuçları resmi sitede açar.
- Oyun verisinde ve kaynaklarda olmayanlar (emülatörde tahminle ya da açıklamayla): Vaal Orb sonuçlarının oranı (~%25'er, Maxroll/Game8), Architect's Orb 50/50, Orb of Sacrifice'ın yükselttiği enchantment değeri, Orb of Chance'in taban başına oranları (emülatör olası unique'leri listeler), Altered Collarbone'un "otherworldly" modları, catalyst başına kalite (%1, 50 altı item level'da %2), Catalysing Exaltation'ın gücü (t8).
- Unique fiyatları poe.ninja'dan gelir; ilan sayısı olmadığı için nadir unique'lerde gerçek satıştan uzak olabilir.
- Ctrl+C (basit) metninde tier yoktur; aynı metne uyan hibrit ve yerel/genel modlar seçim için işaretlenir.
- Standard ligde EE2 ile resmi özet arasındaki fark koruma sınırına yakın; lig kaynağı çalışmadan çalışmaya değişebilir.
- Fiyat paketi npm'de herkese açık; npm veri dağıtımı için tasarlanmadı.
- Veri 0.5.5'e kilitli. Yeni oyun verisi çıkınca (fiyat işi haber verir; bu bilgi yoksa PoE2 1.0'ın planlanan tarihi 11 Aralık 2026'dan itibaren) sayfada uyarı bandı çıkar. Bilgi tabanını yeniden üretmek elle yapılır: `kb_update.py build`, `check`, `approve`, sonra yayın.
- Self-test simülatörün veriye ve kurallara uyduğunu doğrular, oyunun davranışını değil; tartışmalı mekanikler oyun içi testlerle (t1–t31) kapanır.
