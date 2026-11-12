# Yol haritası — PoE2 Craft Assistant (12 Kasım 2026)

**Hedef:** Oyunu çok iyi bilen bir oyuncu, istediği statları seçip item'ını yapıştırınca, bildiği tariften daha iyi
ya da en az onun kadar iyi bir rota görsün. Önerilen her rota sözünü tutsun: 100.000 craft'lık replay'de beklenen
maliyet ±2%, başarı şansı 0,5 puan içinde. Ölçüt ve çalışma biçimi: [definition-of-done.md](definition-of-done.md),
kurallar: [rules-ledger.md](rules-ledger.md).

**Sabit tarihler:** 1.0 yama notları ~4 Aralık, 1.0 çıkışı 11 Aralık (ekonomi sıfırlanır, 0.5.5 verisi eskir).

**Her fazda geçerli kural:** İşe başlarken kural defteri yeniden üretilir; işin dokunduğu `unknown` / `weak` kurallar
oyuncuya tek mesajda sorulur; cevaplar gelmeden simülasyon koşmaz. 0.5.5 için yeni bulut taraması yok.

---

## Faz 0 — Toparlama (12–19 Kasım) — **bitti 12 Kasım**

Yarım kalan işleri kapatmak; yeni iş açmamak. Sonuç: 84d2c77 main'de (200f4ee), yarım dal kurtarıldı (7d7f2a8; 17.
taramanın Wrath Sceptre'ı 2.000/2.000 craft bitiyor), bilgi tabanı 0.5.5.7 onaylandı ve yayımlandı (e000a4b, sayfa v88),
19. tarama okundu (`network-sweep-2026-11-12.md`: %97,0 uyum; eksi söz ve oturmamış değerler Faz 1'e). 194 test geçiyor.

| İş | Bitti sayılır |
|---|---|
| `worktree-agent-a1ef1a8bff7a462c5` dalı (84d2c77, tutarsızlık avı: 4 neden, `diag/hunt.js`, 3 test): code-review, main'e al | testler geçer, dal main'de |
| `worktree-agent-a648d598e86b0f9e6` dalı ("bitmeyen craft'lar"; commit edilmemiş: `nodeOf`'ta hedefin ikizi yanındaki engel, `diag/item_trace.js`): **kurtarılır** (karar 12 Kas) — test, 17. taramanın 52 bitmeyen craft'ının replay'i, 84d2c77 ile birlikte inceleme | 52 craft biter, testler geçer, main'de |
| 0.5.5.7 bilgi tabanı adayı (veri değişikliği yok, kontroller artık geçiyor): onayla, derle, yayımla | sayfa yeni sürümle yayında |
| 19. bulut taraması: yalnızca önerilen rotalara dokunan hatalar için okunur | kısa not, yeni tarama yok |

## Faz 1 — Doğrulama kapısı (20 Kasım–3 Aralık; Faz 2 ile paralel, ayrı oturum ve worktree — karar 12 Kas)

"Bitti" tanımını ölçülebilir yapan altyapı. 1.0'dan bağımsız; 1.0 verisiyle aynen çalışacak.

1. **Hedef listesi biçimi:** craft hedefleri repo'da sabit bir listede. Şimdilik mevcut senaryolar; 1.0'ın ilk
   haftasında ticaret talebinden 30 hedef.
2. **Replay kapısı:** önerilecek her rota 100.000 craft'la oynatılır; maliyet ve başarı şansının 95% güven aralığı
   sınırın içindeyse "öneri", değilse "emin değil". Hedef listesi çevrimdışı (bulut / gece) doğrulanır; oyuncunun
   kendi item'ı için sayfada kısa bir simülasyon ve güven etiketi. 100 hedef × önerilen rotalar × 100.000 craft
   yerelde (2 işlem) günler sürer: hedef listesi doğrulaması bulutta (ücretsiz Actions limiti), oyuncunun izniyle.
3. **Bilinen tariflerle karşılaştırma:** rota kütüphanesindeki en iyi crafter tarifi ile öneri yan yana; tarif
   kazanıyorsa hata kaydı açılır.
4. **Sonuç damgası:** her simülasyon sonucu kural defterinin özetini (hash) ve fiyat tarihini taşır; bir kural
   değişince yalnızca o kuralı kullanan rotalar yeniden koşar.
5. **Uzman görünümü (sayfa):** en iyi rota + sonraki seçenekler; beklenen maliyet, medyan, kötü gidiş (P90) ve
   replay'de görülen en kötü durum; adım şansları, item'ı bozabilecek adımlar; rotanın dayandığı `weak` kurallar
   uyarı olarak; "en iyi" ölçütü oyuncunun seçimi (beklenen maliyet / en kötü durum / en az adım). Öğretici metin yok.
   Dağılım grafikleri `dataviz` skill'iyle.
6. **10 saniye ölçümü sayfada:** cevap süresi Node'da değil, yayımlanan sayfada (tarayıcıda) ölçülür; hedef
   listesinin en büyük ağlarıyla. Ağ büyüdükçe (Faz 2'nin iki fractured modifier'ı) yeniden ölçülür.

## Faz 2 — 1.0 ön hazırlık (20 Kasım–3 Aralık, Faz 1 ile paralel)

Datamine edilmiş bilgiyle yapılabilenler; yama notları geldiğinde yalnızca kurallar güncellenecek şekilde.

1. **Ağ:** ikinci fractured modifier (bugün tek: `fg`/`fj`), Forgemark / Bloodmark + reforge kenarları. Bellek ve
   hız ölçülür (craft-network skill'inin kuralları).
2. **Rotalar:** strateji üreticisi `reforge` operatörünü kullanabilsin (şu an yalnızca motor biliyor).
3. **Fiyat hattı:** lig adı parametre; Conquerors of Wraeclast ve altı yeni eşya fiyat listesinde.
4. **Senaryolar:** `POE2_V1=1` ile Forgemark ve iki-fractured senaryoları; bulut yerine yerelde küçük ölçek.

## Faz 3 — Yama notları (≈4–10 Aralık)

1. Yama notları okunur → kural defterinin 1.0 bölümü ve değişen her mevcut kural güncellenir.
2. Bilinmeyenler oyuncuya **tek mesajda** sorulur (Forgemark'ın tarafı, Bloodmark grupları, karışık işaret,
   Fracturing Orb, mevcut currency / omen / essence değişiklikleri).
3. Motor ve ağ kuralları düzeltilir; testler; hedef listesi dışında simülasyon yok.

## Faz 4 — Çıkış (11–14 Aralık)

1. 1.0 oyun verisinden bilgi tabanı (indirmeler oyuncunun onayıyla) → fark raporu → kural defteri.
2. `reforge` kendiliğinden açılır; kılıç/hançer sınıfları ve yeni base'ler gerçek olur.
3. Fiyatlar yeni ligde; ilk günlerde piyasa zayıf, rotalar bunu söyler.
4. Sayfa ve masaüstü yardımcısı yayımlanır.

## Faz 5 — Hedef listesinde "bitti" (15–31 Aralık)

1. İlk haftanın ticaret talebinden 100 hedef.
2. Her hedef replay kapısından geçer; bilinen tarifin kazandığı hedefler düzeltilir.
3. 1–5 maddeleri tuttuğunda iş biter; liste dışındaki farklar yeni iş açmaz.

---

## Riskler

- **Oyun verisi gecikir** (RePoE dışa aktarımı çıkıştan sonra gelir): Faz 4 kayar; sayfa eski veriyle "outdated"
  uyarısı gösterir.
- **Yama notları datamine'ı çürütür:** Faz 2'nin bir kısmı yeniden yazılır; bu yüzden Faz 2 küçük tutuldu.
- **İki fractured modifier ağı büyütür:** bellek ölçülür; gerekirse yalnızca Forgemark'lı hedeflerde açılır.
- **Zayıf piyasa:** ilk günlerin fiyatları güvenilmez; rota maliyeti fiyat tarihini ve kaynağını gösterir.

## Kararlar (12 Kasım 2026)

1. `worktree-agent-a648…` dalı kurtarılır (Faz 0).
2. Hedef listesi 100 craft hedefi; cevap 10 saniye; fiyatlar en çok 24 saatlik.
3. Faz 1 ve Faz 2 paralel, iki ayrı oturumda.
4. Simülasyon işlerinde `craft-network` ile birlikte `simulasyon-crafting-denge` ve `hayal-gucu-hassas-is`
   skill'leri kullanılır; oturum brief'leri bunu söyler. Uzman görünümü medyan ve en kötü durumu da gösterir;
   10 saniye sayfada ölçülür (Faz 1 madde 5–6).
