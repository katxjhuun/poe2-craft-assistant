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

## Bilinen eksikler

- Flask ve charm craft'ı destekleniyor ama iki sınırı var:
  - Normal veya Magic kalırlar (kural R_FLASK_MAGIC). Bu kural tek bir topluluk kaynağına dayanıyor; panel "verify in game" diyor.
  - poe2db flask ve charm için ağırlık yayınlamıyor, bu yüzden şanslar eşit ağırlıkla hesaplanıyor.
- Expedition Tablet'in ikonu yok; Exiled Exchange 2 listesinde adresi bulunmuyor. Diğer bütün fiyatlı eşyaların ikonu var.
- Beyaz bazdan başlayan planlarda yeni baza dönmek (Magic aşamasında iki hedef tutmazsa ya da Rare'de taraf dolunca) çoğu zaman pahalı omen'lerle düzeltmekten çok daha ucuzdur ama çok sayıda baz ister. Baz fiyatı (varsayılan 1 ex) ve eşya başına baz sınırı (varsayılan 100) oyuncunun girdisidir; piyasada o kadar baz bulunmayabilir. Sınırın ötesinde çok daha ucuz bir yol varsa plan bunu söyler.
- Olasılıklar tahmindir: mod ağırlıkları poe2db'nin topluluk verisi, desecrated modlar eşit ağırlıklı, Catalysing Exaltation çarpanı (varsayılan ×5) tek kaynaklı ve ayarlanabilir.
- Rare item değeri yalnızca kullanıcının kaydettiği fiyatlardan tahmin edilir; resmi fiyat geçmişi yok ve trade sitesine otomatik istek yasak (ToS 7i).
- Unique fiyatları poe.ninja'dan gelir; ilan sayısı olmadığı için nadir unique'lerde gerçek satıştan uzak olabilir.
- Ctrl+C (basit) metninde tier yoktur; aynı metne uyan hibrit ve yerel/genel modlar seçim için işaretlenir.
- Standard ligde EE2 ile resmi özet arasındaki fark koruma sınırına yakın; lig kaynağı çalışmadan çalışmaya değişebilir.
- Fiyat paketi npm'de herkese açık; npm veri dağıtımı için tasarlanmadı.
- Veri 0.5.5'e kilitli. Yeni oyun verisi çıkınca (fiyat işi haber verir; bu bilgi yoksa PoE2 1.0'ın planlanan tarihi 11 Aralık 2026'dan itibaren) sayfada uyarı bandı çıkar. Bilgi tabanını yeniden üretmek elle yapılır: `kb_update.py build`, `check`, `approve`, sonra yayın.
- Self-test simülatörün veriye ve kurallara uyduğunu doğrular, oyunun davranışını değil; tartışmalı mekanikler oyun içi testlerle (t1–t20) kapanır.
