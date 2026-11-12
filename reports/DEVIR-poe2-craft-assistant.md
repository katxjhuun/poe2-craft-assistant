# DEVIR: PoE2 Craft Assistant (12 Kasım 2026)

**Hedef:** PoE2 craft asistanı: bilgi tabanı ve craft ağı doğru, hızlı ve dürüst (ağ, simülatörle tutarlı); 1.0 (11 Aralık 2026) için hazır olmak.

**Durum**
- main: b2c144f (ağın tüm son düzeltmeleri, sayfa v87 yayında).
- Dal `worktree-agent-a1ef1a8bff7a462c5` 84d2c77: ağ/simülatör tutarsızlık avı; 4 neden düzeltildi, `scripts/selftest/diag/hunt.js`, 3 test, 192 test geçiyor. Henüz ana koda alınmadı.
- Dal `worktree-agent-a648d598e86b0f9e6`: "bitmeyen craft'lar" işi yarıda, durduruldu. İçinde `app/_nw_head.js`, `diag/_batch.js` gibi geçici dosyalar var; temizlenmeli.
- Bilgi tabanı 0.5.5.7 adayı (`.kb_cache/candidate/`) hazır; fark raporu veri değişikliği göstermiyor. Kontrolde sayfa testleri ve öz-test BAŞARISIZ: `reports/kb-update-2026-11-09-0214.md`. Onaylanmadı, mevcut bilgi tabanı yerinde.
- Bulut: 19. tarama (42532075834, 7ca329a) bitti, başarılı; okunmadı.

**Kararlar**
- Sınır: Actions ücretsiz limit tam kullanılacak (19 makine, 315 dk). Azure reddedildi. Ek GitHub hesabı önerilmez.
- "afk" = kullanıcı dur diyene kadar PC kullanılabilir (CPU ≤%90, RAM ≥4-6 GB boş).
- Yerel işlemler: en çok 2 per işçi, her başlatmadan önce boş RAM kontrolü.
- Kaynak indirmeleri kullanıcı izniyle yapılır.

**Sonraki adım (sırayla)**
1. Bilgi tabanı kontrolünün neden başarısız olduğunu bul (`.kb_cache/work/kb_check.txt`); sonra gerekirse `python scripts/kb_update.py approve`, `node app/build.js`, sayfayı yayımla (önce yayımlanmış veri dosyasını oku).
2. 84d2c77 dalını code-review ile incele, ana koda al, testleri koş, yayımla.
3. 19. taramayı oku (`bash scripts/selftest/diag/fetch_run.sh 42532075834 .kb_cache/runs/run19`).
4. 4 Aralık yama notlarını oku; 11 Aralık'ta yeni ligi (Conquerors of Wraeclast, Crimson Iron/Forgemark, Reforging Bench, Blood Vial) bilgi tabanına, ağa ve fiyatlara ekle. Ayrıntı: `reports/poe2-1.0-crafting-2026-11-09.md`.

**Tercihler:** Türkçe yanıt; sayfa arayüzü İngilizce; commit'te Co-Authored-By satırı; bulut işleri ve kaynak indirme için izin.

**Devam prompt'u:** "PoE2 Craft Assistant'ta (C:\Users\PC1\Desktop\poe2craftassist) craft ağı işine devam ediyoruz. Önce DEVIR notundaki sonraki adımı al: bilgi tabanı kontrolünün başarısızlığını çöz, 84d2c77 dalını ana koda al, sonra 19. bulut taramasını oku. Türkçe yanıt ver; yerelde en çok iki işlem, bulutu gereksiz başlatma."
