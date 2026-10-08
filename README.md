# PoE2 Craft Assistant

Path of Exile 2 (patch 0.5.5) için bir craft paneli: yapıştırılan item'ı okur, hedef statlara ve bütçe tavanına göre tek bir craft rotası çıkarır (altında diğer yollar), her adımdan sonra rotayı ve fiyatları günceller. 7 Ekim 2026'dan beri rota bir denklem ağından gelir, simülasyon beklenmez; Cheap / Balanced / Premium ve tier aralığı kaldırıldı (aşağıda "Craft ağı"). claude.ai Artifact olarak çalışır:
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

## Craft ağı (`app/network.js`)

Oyuncunun 7 Ekim 2026 kararı: asistan yalnız sabit yollar gösteriyordu; yerine tek rota, bütçe tavanı, alternatifler ve
bekleme süresi olmayan bir "mantıksal ağ" istendi.

- **Düğüm** = item'ın durumu: hangi hedefler var (doğal, crafted, desecrated), hangi hedefin önünde aynı gruptan bir mod
  duruyor, her tarafta kaç başka mod var, ne fractured, gizli desecrated mod var mı, catalyst quality. **Kenar** = bir
  currency: sonuçları, olasılıkları (poe2db ağırlıklarından) ve fiyatı.
- **Rota** = her düğümde ortalamada en ucuz kenar. Simülasyon yok: maliyetler denklemlerden çözülür (her zaman biten bir
  kural kümesinden başlayan policy iteration; uzun "at, tutmadı, yine at" döngüleri bloklar içinde tam çözülür, yeni
  beyaz base tek bir bilinmeyendir). Beyaz base'te iki hedef yaklaşık 1 saniye (6.700 düğüm), üç hedef 3 saniye,
  dört hedef 9 saniye; beş hedef ve 100 base sınırıyla botlarda 35 ile 75 saniye (8 Ekim 2026 ölçümü; önce 4 dakika).
- **Engeller izlenir** (oyuncunun 8 Ekim 2026 kararı: "daha büyük bir ağ gerekiyorsa büyüt"). Bir hedefin grubundan
  gelen mod (düşük tier, kardeş mod) ya da onu etiketleriyle durduran karşı taraf modu, craft sırasında gelse bile o
  hedefin durumudur: item'da kaldıkça hedef gelemez ve rota onu kaldırmayı seçebilir. Önceden bu şans her atışta
  yeniden çekiliyordu; yerel savunmaların havuzun yarısı olduğu base'lerde (Grand Regalia, Grand Visage, Grand
  Cuisses) vaat %10 ile 7 kat arasında şaşıyordu. Beş hedefe kadar bütün doğal hedefler izlenir, altı hedefte grubu
  en büyük iki hedef (`net.track`).
- Verdikleri: beklenen maliyet, yayılımı, bütçe tavanı içinde kalma olasılığı, malzeme listesi, başka ilk adımlar,
  "şu modlu bir başlangıcı satın almak en çok ne eder", ve kurallar ("item şöyleyse şunu kullan").
- "Bases per item" sınırı rotayı bağlar: az base ile rota baştan başlamak yerine onarır (annul + chaos, fracture, Omen of
  Light döngüsü kendiliğinden çıkar).
- Catalyst quality oyuncunun seçimi: dokunma (varsayılan), olanı Omen of Catalysing Exaltation ile harca, ya da catalyst
  ekleyip harca.
- **Her istek ağdan geçer** (oyuncunun 8 Ekim 2026 kararı: "ağın kapsamadığı hiçbir şey istemiyorum"). Sayfa artık eski
  simülatöre düşmez; simüle edilen planlayıcı, işçileri, ilerleme halkası ve profil kalıntıları sayfadan kaldırıldı. Ağ
  sayfada ayrı bir iş parçacığında (Web Worker) çözülür. Ağda olanlar: bütün orb'lar (tier ve taraf omen'leriyle), Orb
  of Alchemy, essence'lar (Magic ve Perfect, çok sonuçlular dahil), alloy'lar, liquid emotion'lar ve jewel'ın "+1
  modifier allowed" modu (beş modlu jewel), kemikler (lich omen'leri, Abyssal Echoes, modu gizli bırakma), Fracturing
  Orb, Omen of Whittling, Greater Exaltation, catalyst'ler, değere göre hedef ve Divine Orb, Flux, Rune of Aldur,
  Astrid's Creativity, Serle's Triumph, rune havuzları (gerekirse Artificer's Orb ile yuva), ve crafter videolarından
  gelen iki araç: istenmeyen Desecrated modu Omen of Light olmadan kaldıran ucuz Perfect essence (Omen of
  Crystallisation ile o tarafa nişanlanır; taraf doluysa omen de gerekmez: iddia k60) ve Essence of the Abyss (bıraktığı
  "Bears the Mark of the Abyssal Lord" modunun yerini bir sonraki kemik alır: iddia k59). Yalnız Desecrated suffix'i
  eksik bir yayda rota yaklaşık 2.690 ex'ten 380 ex'e indi.
- Cevap bir rota değilse nedenini söyler: `blocked` (Mirrored, Corrupted, Sanctified, Unique), `impossible` (item seviyesi
  yetmiyor, rune için yuva yok, hiçbir kural kümesi hedeflerle bitmiyor).
- **Havuz modeli.** Kimsenin istemediği modlar ortalanır, ama havuzdaki her kayıt tek tek izlenir: bir mod kendi
  grubundakileri ve etiketlerinin (oyun verisi `adds_tags`) durdurduklarını havuzdan çıkarır, karşı tarafta da ("+ to
  Level of all Fire Spell Skills" suffix'i wand'da Chaos Damage prefix'ini tutar). Yapıştırılan item'ın kendi
  engelleri bilinen durumlardır. Çekilmiş havuzlarla karşılaştırma: etiketsiz sınıflarda %0,6, wand ve staff'ta %2,4
  içinde. Item'daki bir hedefin kendi etiketleri havuzu keser (başka bir modun engeli sayılmaz); hedefin kendi
  grubundan bir ikizi (wand, staff ve focus'ta element hasarı prefix'leri) o grubu hedef gibi tutar. Well of Souls'ta
  yalnızca-Desecrated bir seçenek hedefle aynı gruptansa (wand'da "#% increased Elemental Damage" ile Cold Damage) o
  çekilişte hedef artık gelemez.
- **Omen of Whittling.** Omen en düşük seviyeli modu siler. Kimsenin istemediği modların en düşük seviyesi, taraf
  başına bir sınıf olarak düğümdedir (hedeflerin alabileceği en düşük seviyenin altında mı, üstünde mi). Omen yalnız
  neyi sileceği kesin olan düğümlerde bir kenardır: bir tarafta, item'daki bütün hedeflerin altında kalan bir mod
  varsa. Crafter'ların "whittle angle" dediği durum budur. Sınıflar ağı 2,6 ile 6 kat büyütür; çoğu rota omen'i
  kullanmadığı için önce omen "en iyi hâliyle" (oyuncu neyi sileceğini seçiyormuş gibi) çözülür ve yalnız rota onu
  kullanıyorsa sınıflı ağ kurulur. Sınıfların sığmadığı isteklerde ve küçük ağlarda omen rotaya girmez.
- **Değerler oturana kadar çözülür.** Blokları aşan döngüler (hedef silinir, yeniden atılır) tur başına şansıyla
  oturur; yalnız blok geçişleriyle 25.000 beyaz base'lik bir quiver rotası beşte bir eksik değerlenmişti. Geçişler
  yetmediğinde rotanın ulaştığı düğümlerin değerleri hızlandırılmış geçişlerle (Anderson) oturtulur; `net.settled`.
- **Kuralların reddettiği adım yok.** Oynatma her adımı simülatörün kurallarına sorar (`P.validate`); reddedilen adım
  taramada uyuşmazlıktır. Böyle bulunanlar: lich omen'leri yalnız silah ve takıda, kendi tarafı dolu essence başka
  tarafa nişanlanamaz, Astrid's Creativity ile bile üçüncü crafted mod olmaz.
- **İki crafted mod.** Düğüm, kimsenin istemediği iki crafted modu ayrı ayrı tutar (hangi essence'in modu olduğuyla
  birlikte): Astrid's Creativity takılı item'da araç essence'i ile alaşım art arda kullanılabilir. Daha önce "bilinen
  sınır" diye yazılan 565 ex'lik yay rotası kural dışıydı (300 craft'ta 22 adım reddedildi: üçüncü crafted mod); iki
  yuvayla ağın bulduğu en ucuz kurallı rota 667 ex'tir (oynatma 624 ± 47, reddedilen adım yok).
- **Item'ı kilitleyen ya da bırakan adımlar.** Bunlar ya item'ı bitirir ya da kaybettirir; kaybın yeni base'i adımın
  maliyetinde ve sayımındadır (`a.bases`), taban sınırının ücreti de üzerindedir.
  - *Vaal Orb:* dört sonuçtan biri bir ile üç modu rastgele değiştirir; hedefi eksik item'ı bitirme şansı tam
    hesaplanır (dolu bir botta %1,43; simülatörde %1,44).
  - *Omen of Sanctification + Divine Orb:* her değer %78-122 ile çarpılır. Değere göre hedefte kullanılır; hiçbir
    tier'ın aralığının yetmediği bir değer (T1'in tavanının %22 üstüne kadar) yalnız bununla hedef olabilir ve o
    zaman yalnız en yüksek tier sayılır (iki tier tek durumda ortalama şansı vaat ediyordu: %17,6'ya karşı %31,2).
    Sayfa, eldeki item'ın kendi değeriyle şansı gösterir.
  - *Omen of Putrefaction + kemik:* fractured olmayan her mod gider, altı gizli Desecrated mod gelir, item Corrupted
    olur. Yalnız Desecrated hedefli isteklerde en ucuz rota çoğunlukla budur (iki hedefli yayda 50 ex; oynatma 50,4).
    Iskada hangi seçeneğin alınacağı kuraldır (hedefin yolunda olmayan, Well listesinden en çok girdiyi götüren
    yalnız-Desecrated mod) ve liste girdi girdi izlenir; aynı taraftaki birden çok Desecrated hedef tek çekilişte
    birlikte sayılır (dokuzda iki, 1 - (8/9)^2 değil).
  - *Orb of Extraction:* Astrid's Creativity'yi geri verir; item bu yolla bırakılır (rune 1.753 ex, orb 307 ex).
  - *Void Flux:* Fire, Cold ve Lightning Resistance'ı aynı kademenin Chaos Resistance'ına çevirir. *Altered
    Collarbone:* takıda bir kemik seçeneği (oyun verisine göre Preserved gibi açılır).
- **Rune'lar item'ındır.** Yapıştırılan item'daki Astrid's Creativity ve Serle's Triumph o item'ın durumudur; yeni
  base'te yoktur, soketleri boştur. (Önceden her yeni base'te bedavaya varmış gibi sayılıyor, böyle bir item'dan
  başlayan craft rune fiyatı kadar ucuz vaat ediliyordu.)
- **Taban sınırı.** Dört ve daha çok hedefte küçük ağ (engeller izlenmeden) sınıra oturtulur; büyük ağ onun bulduğu
  "vazgeçme fiyatı"ndan (base + ücret + beyaz base'in değeri) başlar, küçük adımlarla düzeltilir ve bir kez kesin
  çözülür (`heldFit`). Büyük ağı önce serbest çözüp sonra aramak bir buçuk dakika sürüyordu.
- **Ağın dışında bilerek bırakılanlar.** Oyunda artık olmayan ya da kaldırılmış item'lar (Coronation ve Alchemy'nin
  taraf omen'leri, Greater Annulment, Homogenising omen'leri, Omen of Corruption: oyuncunun 8 Ekim 2026 kararı).
  Craft edilen item'ın prefix ve suffix'lerine dokunmayan currency'ler: Orb of Chance, Mirror of Kalandra,
  Architect's, Sacrifice ve Cultivation orb'ları, Verisium, kalite currency'leri, Omen of the Blessed (yalnız
  implicit). Flask ve charm craft'ı, anoint ve Verisium Anvil kapsam dışıdır.
- **Hinekora's Lock.** Ağda bir kenardır: kilit takılınca her currency'nin sonucu önceden görülür ve en iyisi
  kullanılır; adımın maliyeti kilit + E[en küçük (fiyat + sonucun değeri)] olur (kilitsiz adım, beklenenlerin en
  küçüğüdür). Farklı currency item'larının sonuçları bağımsız sayılır; aynı currency'nin omen'li ve omen'siz
  hâllerinden yalnız birine bakılır (omen'in gösterilen sonucu değiştirip değiştirmediği bilinmiyor: iddia k62, test
  t36). Kemiğin modu (Well'de seçilir), açılış ve rune'lar gösterilmez; gösterilenlerin hiçbiri değmezse rota bunlardan
  birini ya da yeni base'i kullanır, değere göre hedef yoksa bir Divine Orb ile kilidi harcayıp yeniden dener.
  Kilit en çok item'ın değeri kadar kazandırabilir, bu yüzden "vazgeçme fiyatı"ndan pahalıyken (517.000 ex ile
  neredeyse her craft'ta) hiç kenar değildir; kilitsiz kural seti oturduktan sonra devreye girer ve her turu kesin
  değerlenir. 667.000 ex'lik bir quiver craft'ında bugünkü fiyatla kullanılmaz; kilit 80.000 ex olsaydı craft
  546.814 ex'e, 20.000 ex olsaydı 367.941 ex'e inerdi. Oynatma: botta kilit 3 ex iken 268,1 vaat, 266,1 ± 5,6 oynanan.
- Rune of Aldur, takıldıktan sonra gelen modu dönüştürmez (oyuncu 8 Ekim 2026'da doğruladı: iddia k61).
- Araştırma günlüğü: `reports/research-crafters-2026-10-07.md` (0.5.5 crafter videoları ve yazılı rehberler).

Doğrulama (ağın vaadi, her modu bilen simülatörde oynanan maliyetle karşılaştırılır):

    node --test app/tests/network.test.js
    node scripts/selftest/network_check.js --limit 24      # yerelde birkaç saniye, tek çekirdek
    node scripts/selftest/network_sweep.js --shard 0/5 --minutes 17
    node scripts/selftest/network_sweep.js --deep --runs 100000 --minutes 17
    node scripts/selftest/network_gap.js "Dueling Wand" n6 150      # fark hangi adımdan geliyor
    node scripts/selftest/network_gap.js "Dueling Wand" "id:<taramanın yazdığı senaryo adı>" 300
    node scripts/selftest/network_gap.js "Dueling Wand" "fams:ColdDamageWeaponPrefix@2,IncreasedCastSpeed@3" 300

`network_gap.js`: oynanan eksi vaat edilen maliyet, düğüm düğüm tam olarak paylaştırılır (ziyaret sayısı x oyundaki
sonuçlar ile ağın sonuçları arasındaki fark, ağın kendi maliyetleriyle değerlenir). Wand'da ağın, craft'ın yarı fiyatını
vaat ettiği hatayı bu ölçüm buldu.

Geniş tarama bulutta çalışır, oyuncunun bilgisayarında değil: `.github/workflows/network.yml` (yalnız elle başlar:
`mode=broad` çok senaryo, `mode=deep` her senaryoyu 100.000 kez oynar; her iş kendini durdurur). Depo 8 Ekim 2026'dan
beri herkese açık, Actions dakikaları ücretsiz. Taramanın her altıncı çekilmiş senaryosu özel bir istektir: değere göre
hedef, item'da başka elementin direnci, rune havuzu, dört suffix (Serle's Triumph), beş modlu jewel, iki crafted mod
(Astrid's Creativity). Sonuçlar işin özetinde ve `sweep-*` çıktılarında.

## Tam tarama (`scripts/selftest/sweep.js`)

(Eski planner'ın strateji ayarları için. 8 Ekim 2026'dan beri sayfa bu planner'ı kullanmaz; simülatör ağın denetçisi olarak kalır.)


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
- Bütün slotlar hedefliyken rota (`scripts/selftest/full_targets.js`, `reports/full-targets.md`): normal eşyada 3 prefix + 3 suffix, jewel'da 5 hedef (üç suffix, bir prefix ve liquid emotion modu; tarif c15, `jewelFive`). 6 Ekim 2026 ölçümü: 56 base'in hepsinde, beyaz ve Rare başlangıçta, üç profilde de rota çıkıyor; 600 kullanımda hiçbir koşu bitmezse planner aynı rotaları 3.000 kullanımla dener. Maliyetler çok yüksek (normal eşyada ortanca 2.400–6.800 div), 37 senaryoda bazı profiller koşuların yarısından azında bitiyor ve hesap item başına ortanca 152 saniye sürüyor. Serle's Triumph rünü (+1 Suffix Modifier allowed) alan ve soket açılabilen sınıflarda dördüncü suffix hedef satırı vardır (7 mod): planner rünü, üç suffix hedefi Rare item'e oturunca takar, boş soket yoksa önce Artificer's Orb kullanır. `full_targets.js --seven` ölçümü (6 Ekim 2026): rünü alabilen 43 base'in hepsinde, beyaz ve Rare başlangıçta, üç profilde de rota çıkıyor (ortanca bitirme şansı %66–85, 2.200–4.300 div); hesap item başına dakikalar sürüyor.
- Rünler boş bir augment soketi ister (Serle's Triumph, Astrid's Creativity, Rune of Aldur); soketler önce slot açan rünlere ayrılır. Rünlerin açtığı mod havuzları ("Can roll Marksman / Berserking / Decay / Destruction / Chronomancy / Soul modifiers") hedef olarak desteklenmez: yapıştırılan item'de okunur, planlanmaz.
- Oyunda olmayan malzemeler (`legacy_or_disabled`): Homogenising, Alchemy, Coronation, Greater Annulment ve Corruption omen'leri planlara ve Workbench'e girmez; jewel'da yalnızca Preserved Cranium vardır (oyuncu, 6 Ekim 2026; oyun verisi ve fiyat listesiyle uyumlu).
- Grasping Mail: poe2db zırh modlarına tek ağırlık, yüzük modlarına gerçek ağırlık veriyor; ikisinin birbirine oranını veren kaynak yok. Zırh modları yüzük sayfasının ortanca ağırlığına ölçeklendi (tahmin).
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

## Desktop program (Windows)

`desktop\build.cmd` builds `desktop\out\PoE2CraftAssistant.exe` with the C# compiler that ships with Windows (nothing is
downloaded) and puts a copy of the page next to it. Run the exe: a tray icon appears and the Craft Assistant opens in its
own window (Edge's app mode), kept above the game.

- With Path of Exile 2 in front, hover an item and press the hotkey (default `Alt+D`). The program presses the game's
  own copy keys (Alt+Ctrl+C) for that item, reads the clipboard and hands the text to the page, which loads the item.
  One key press, one copy; nothing else is read from the game, and the program asks nothing of any web site.
- While a route is running, the same item coming back changed counts as the result of the route's next step: after
  each craft, press the hotkey on the item and the assistant is up to date, with no copy and paste.
- The route's steps on the game screen: after "Find craft route", click one of the three routes and the program draws
  that route over the game in a small panel of its own: the steps in order with their uses, the step to use now
  marked, with what it does, its chance per use and a warning when it cannot be undone. After each step, the hotkey on
  the item moves it on at once (the route's own rule on the item as it is now; "updating..." until the route is
  simulated again) and says how the step went (on plan, no hit yet, off plan). The panel has no frame, never takes the
  keyboard and lets every click through to the game. It is shown while the game is the window in front, or the
  assistant's window with the game behind it (a second screen); any other program in front hides it. It goes when the
  route is dropped (other targets, another item, Cancel) or with "Hide" under the routes.
- Where it is: top middle of the game's picture by default, as large as the game draws its own interface (by the
  picture's height). "Move" under the routes, or the tray menu, lets the panel take the mouse: drag it, then
  right-click it. The tray menu turns it off altogether.
- With the steps on the game screen, the hotkey leaves a minimised assistant window minimised, and the page keeps
  planning while its window is minimised or covered (the browser's background throttling is off for this window).
- An item the assistant does not craft (currency, gems, waystones and the like) is not loaded: the item being worked
  on stays.
- The hotkey is taken only while the game window is in front (a browser tab whose title merely starts with the
  game's name does not count). Settings are in `config.json` next to the exe (`hotkey`, `port`, `topmost`,
  `advancedCopy`, `gameTitle`, `watchClipboard`, and for the steps panel `stepsOverlay`, `stepsX` and `stepsY` in
  percent of the game's picture, `stepsScale` and `stepsOpacity` in percent); the tray menu opens it.
- Other tools: an item copied in game by any means (Ctrl+C, another tool's own copy) is loaded as well
  (`watchClipboard`). With a route running, only the route's own item comes in that way.
- The browser does not offer to translate the program's page (it is in English on purpose): the page is marked "do
  not translate", and translation is turned off in the program's own browser profile.
- "Search on trade" in the page opens the official trade site with the search prefilled, on the player's click.
- The price check window the program had for a day (6 and 7 Oct 2026: a panel over the game with the trade site's
  listings) was taken out again at the player's wish, with everything that asked the trade site; the hotkey only loads
  the item. What it left behind on purpose: the search builders in `app/pricecheck.js` for every kind of item, the
  reader of listed items and their tests (`app/tests/pricecheck.test.js`, `app/data/trade_items_0.5.5.json`,
  `scripts/trade_items.py`), which the page does not use; and three corrections the page's own trade search uses: a
  defence at 20% quality is the shown value x 1.2 (the trade site's own numbers), a stat written on two lines of the
  item text is one line of the search, and "Grants Skill: Level # ..." is a line of the search.
- Tested by the author: the page is served, an item text pushed to `POST /push` is loaded, counted as a step result and
  the route goes on; the window opens and stays on top; after the price check was taken out, the page loads and shows
  its item, and the program answers with the new hotkey. The player confirmed the hotkey in game earlier (as Alt+E).
  The steps panel (7 Oct 2026), with a test copy of the program on its own port: nothing is sent before a route is
  clicked; the click sends the route (the same next step, uses and chance as the page shows); a step result pushed to
  `POST /push` changes the step within 0.1 s and the simulated route follows; Hide, another route and another item
  do what they should; the panel as a real window is where the settings put it, 507 pixels wide on a 1440 pixels high
  screen, without a frame, click-through, never the window in front (the window in front stayed the same), and "Move"
  switches the click-through off and on. Its look was checked from a picture the program draws itself
  (`PoE2CraftAssistant.exe --render-steps steps.json out.png`), not from the screen.
  Not tested: the panel over the game itself (shown and hidden with the game in front, dragging it), the hotkey as
  Alt+D in game, and the clipboard watcher with another tool.
