# PoE2 0.5.5 "Forbidden Rites" Crafting: Doğrulanmış Tarif Kütüphanesi ve Kaynak Denetimi

İncelenen yaklaşık 35 kaynaktan çıkan sonuç şu: 0.5.5'te (Forbidden Rites, 4 Eylül 2026 13:00 PDT'de ekonomi sıfırlamasıyla açıldı) güvenle önerilebilecek tarifler, resmî 0.5.0 kuralına uyanlardır. Bu kurala göre bir item'da 1 crafted modifier (Essence/Perfect Essence/Alloy) ve 1 Desecrated modifier bulunabilir. Bu sınır içinde omen'lerle prefix/suffix tarafı kontrol edilir, Omen of Light + Abyssal Echoes ile desecration döngüsü kurulur ve bir mod Fracturing Orb ile kilitlenir. Runic Alloy ve Astrid's Creativity kullanan tarifler (ör. popüler "Puppet Master" minion sceptre'ı) büyük olasılıkla yalnızca Runes of Aldur liginde çalışır. Recombinator ise 0.5.5'te hiçbir ligde yoktur.

## TL;DR

- **Kütüphanenin temeli resmî metinlerdir.** GGG'nin 0.5.0 ve 0.5.5 yama notları şunları doğruluyor: tek crafted ve tek Desecrated mod sınırı, Greater Orb of Transmutation/Augmentation için minimum mod level 44 (önceden 55), Sanctify ve Vaal değer-çarpma sonucunun mevcut değer üzerinden çarpması, Omen of Corruption'ın elde edilemez olması, Recombinator'ın kapatılıp Omen of Recombination'ın silinmesi, Catalyst'lerin yalnızca Genesis Tree'den gelmesi ve tüm Vaal Infuser'ların en az %20 quality istemesi. Bunlarla çelişen her rehber adımı "outdated" ya da "rejected" olarak işaretlendi.
- **Minion Sorceress için en yüksek getirili ve 0.5.5'te geçerli yollar üç tane.** (1) Sceptre'da "+# to Level of all Minion Skills" suffix'ini Greater/Perfect Orb of Transmutation'ın mod-level tabanıyla avlamak. (2) Ring/Amulet'te Necrotic Catalyst quality'si + Omen of Catalysing Exaltation ile minion modlarına ağırlık vermek. (3) Genesis Tree'de minion ağırlıklı node'larla ring/belt üretmek. Alloy'lu sceptre tarifleri Forbidden Rites'ta büyük olasılıkla uygulanamaz.
- **Topluluk ve satıcı kaynaklarında ciddi kirlilik var.** PoE1'den kalma "fossils", "alt-regal", "metamod" jargonu, 0.5 öncesinden kalma Homogenising/Corruption omen tarifleri, "bone'lar mod level 64 ile sınırlı" gibi yanlış kurallar ve doğrulanmamış olasılık/maliyet sayıları yaygın. D kademesi (RMT/boost blogları) hiçbir tarifin tek dayanağı yapılmadı.

## Key Findings

1. **Tek crafted slot kuralı en kritik doğrulama filtresi.** Resmî 0.5.0 metni: "All crafted modifiers are now guaranteed, but items can only have 1 crafted modifier at a time. Desecrated modifiers no longer count as crafted modifiers, but items are limited to 1 Desecrated modifier." Sahada ikinci bir crafted-mod currency'si uygulandığında oyun işlemi **engelliyor**, mevcut modun üzerine yazmıyor. Resmî forumdaki 11 Haziran 2026 tarihli oyuncu raporunda Essence of the Abyss "this item already has a crafted modifier" hatasıyla reddedilmiş. 0.5 öncesinde NeverSink'e atfedilen "yeni crafted mod eskisini muhtemelen siler" tahmini bu raporla çelişiyor ve geçersiz sayıldı.
2. **Greater/Perfect tabanları kısmen doğrulandı.** Transmutation/Augmentation için 44/70 değerleri poe2wiki'deki item metni ve resmî yama notuyla doğrulandı. Regal/Chaos/Exalted için 35/50 değerleri yalnızca ikincil kaynaklarda geçiyor (plausible). Tabanın bir mod ailesini tamamen silmesi söz konusu olduğunda poe2wiki kuralı açık: "at least one tier of each mod will always be eligible to roll, respecting item level". Örnek olarak Light Radius'un en üst tier'i (level 30) Ancient bone ile yine de gelebiliyor.
3. **Bone kısıtları doğrulandı, ama yaygın bir yanlış ifade var.** Gnawed bone'lar **item level ≤ 64** item'larda kullanılabilir. "Mod level 64 cap" ifadesi yanlış. Ancient bone'lar **minimum modifier level 40** uygular.
4. **Forbidden Rites'ta durum şu:** Resmî 0.5.5 notlarına göre "The Verisium Anvil is now unlocked by completing The Runeseeker quest in Act 4 outside of the Runes of Aldur League" ve "Expedition Tablets can now be found in Standard and in the new Forbidden Rites League" (bunlar Runes of Aldur'da elde edilemiyor). Aynı notlar "The Aldur's Saga cannot be obtained outside of the Runes of Aldur League" diyor. Alloy'lar için poe2wiki "Exclusive to Runes of Aldur league" diyor ve 0.5.5 notları Alloy'lardan hiç bahsetmiyor, yani Forbidden Rites'ta yok sayılmalı (orta-yüksek güven). Recombinator 0.5.0'da kapatıldı ve 0.5.5'te yeniden açılmadı (yüksek güven).
5. **Olasılık iddialarının hiçbiri "verified" değil.** Craft of Exile'ın kendi sayfası şöyle diyor: "information regarding modifier weightings is not part of the game client's for Path of Exile 2" ve ağırlıklar "extrapolated using special methods". Rehberlerdeki her yüzde bu yüzden tahmindir.

## (a) Kaynak Tablosu

| # | Kaynak | Kademe | Tarih | Hedef yama | Not |
|---|---|---|---|---|---|
| 1 | GGG – Content Update 0.5.0 patch notes (pathofexile.com forum, thread 3932540) | A | 21–29 May 2026 | 0.5.0 | Tek crafted/desecrated kuralı, Greater Trans/Aug 44, Sanctify/Vaal çarpma, Recombinator kapalı, Infuser %20 quality, Catalyst yalnız Genesis Tree |
| 2 | GGG – 0.5.5 Patch Notes (thread 4000864, Stacey_GGG) | A | 2 Eyl 2026 (4 Eyl güncelleme) | 0.5.5 | Runes of Aldur core'a geçiş, Verisium Anvil, Sacred Bloom yalnız FR, Sword/Axe/Dagger bug fix, Ctrl+C advanced açıklama fix |
| 3 | GGG – 0.5.2 patch notes (Maxroll/PatchBot/Sportskeeda alıntıları) | A (ikincil aktarım) | 12 Haz 2026 | 0.5.2 | Necrotic ve Refined Necrotic Catalyst, Genesis Tree kaynağı |
| 4 | GGG – Forbidden Rites FAQ (Natalia_GGG, thread 4000430) | A | 30 Ağu 2026 | 0.5.5 | Runes of Aldur 1.0'a kadar sürüyor; 0.5.5 notları da "The existing Runes of Aldur League will continue to run" diyor |
| 5 | Resmî forum oyuncu raporu "Essence of Abyss 'this item already has a crafted modifier'" (thread 3960848) | C (resmî platformda oyuncu testi) | 11–12 Haz 2026 | 0.5.0 | İkinci crafted mod engelleniyor |
| 6 | poe2wiki.net – Greater/Perfect Orb of Transmutation, Ancient Jawbone, Gnawed Collarbone, Omen of Putrefaction, Runic Alloy, The Runebinder's Alloy, Alloy, Astrid's Creativity | B | 2026 (sayfa revizyonları) | 0.5.x | Min. mod level, aile-istisnası kuralı, lig kısıtları |
| 7 | poe.ninja / vaal.tools / PlayFunc (in-game item metni aynaları) | B | 2026 | 0.5.x | Omen of Catalysing Exaltation, Putrefaction, Light, lich omen metinleri |
| 8 | Craft of Exile (PoE2 + beta.craftofexile.com) | B | 2026, "Forbidden Rites için güncel" | 0.5.5 | Ağırlıkların istemcide olmadığını açıkça yazıyor |
| 9 | Maxroll – Minion Army Lich / Disciple of Varashta Minion build guides | B | 2026 | 0.5 (Return of the Ancients) | Minion levels sceptre/helmet/amulet önceliği |
| 10 | Maxroll – 0.5.0 / 0.5.5 patch note sayfaları | B | 2026 | 0.5.0 / 0.5.5 | Resmî notların aynası |
| 11 | domistae "PoE2 Crafting Codex" (GitHub Pages) | C | 2026 | 0.5.5 (kendi beyanı) | Kapsamlı ama kendisi "not ground truth" diyor; hatalar içeriyor |
| 12 | POE2FUN – "0.5.0 Minion Sceptre Crafting Guide: The New Puppet Sceptre" | C | 2026 | 0.5.0 | Alloy + Astrid's Creativity kullanıyor, yalnızca RoA'da geçerli |
| 13 | POE2FUN – 0.4.0 Solar Amulet guide | C | 2025–26 | 0.4.0 | Outdated |
| 14 | Fextralife PoE2 wiki (Runic Alloy, Orb of Transmutation, Genesis Tree) | C | 2026 | 0.5 | PoE1 kirliliği ("fossils") içeriyor |
| 15 | Game8 (Genesis Tree, bone ve omen sayfaları) | C | 2026 | 0.5.x | Jenerik "Currency Exchange" edinim metinleri |
| 16 | VULKK – Desecration Crafting Guide / Crafting Recommendations | B (yazarlı) → içerik outdated | 5 Eyl 2025 / 10 Oca 2025 | 0.3 / 0.1 | Homogenising ve Corruption omen'lerine dayanıyor |
| 17 | VULKK – 0.5.0 Changes Overview | B | 22 May 2026 | 0.5.0 | Recombinator kaldırıldı, liquid emotions |
| 18 | Sportskeeda (0.3 crafting, grenade crossbow, omen guide) | C | 2025 | 0.3 | Tarihsel |
| 19 | GameFragger (NeverSink'e atfedilen tahmin) | C | 25 May 2026 | 0.5 öncesi | Spekülasyon, çürütüldü |
| 20 | Steam Discussions – Whittling sorusu | C | 2025 | 0.x | Whittling'in "lowest level" çalıştığını dolaylı doğruluyor |
| 21 | gamer.org – 0.5.2 minion builds | C | Haz 2026 | 0.5.2 | "+6 minion amulet" iddiası doğrulanmadı |
| 22 | timesaver.gg (0.5 crafting, omens, sanctify, catalysts, desecrated currency) | D | Tem–Eyl 2026 | 0.5.x | Currency satıcısı; bazı doğru metin alıntıları var |
| 23 | EZG (0.5.5 desecration, FR guides) | D | Eyl 2026 | 0.5.5 | Fractured-suffix desecration döngüsü (lead); FR'de Alloy iddiası güvenilmez |
| 24 | POECURRENCY, Boostmatch, MMOJUGG, AOEAH, MTMMO, U4N, RPGStash, InstantCarry, MMOSO, Kingboost, Expcarry, misti.services | D | 2025–2026 | 0.3–0.5.5 | Uydurma sayılar, PoE1 terimleri ve eski mekanikler |

## (b) İddia Doğrulama Günlüğü

| # | İddia | Kaynak | Hüküm | Gerekçe |
|---|---|---|---|---|
| 1 | Item'da yalnız 1 crafted modifier; Essence, Perfect Essence ve Alloy aynı slotu paylaşır | Codex, timesaver, resmî 0.5.0 | **verified** | Resmî 0.5.0 metni. Alloy'ların "similar to Perfect Essences" çalıştığı resmî notta yazıyor. Forumda oyuncu da "they fight for the spot" diyor |
| 2 | İkinci crafted mod eskisinin üzerine yazar | GameFragger (NeverSink'e atfen) | **rejected** | 0.5 öncesi tahmin. 11 Haz 2026 oyun-içi raporda uygulama "already has a crafted modifier" hatasıyla engellendi |
| 3 | "Alloy overrides (or blocks)" | Codex | **outdated/eksik** | Gözlenen davranış engelleme. "Overrides" kısmı kanıtsız |
| 4 | Chained essence (iki Perfect Essence'ı üst üste, "biri diğerini silerse tekrarla") | AOEAH 0.3 | **outdated** | 0.5 tek crafted slot kuralıyla imkânsız |
| 5 | Greater Orb of Transmutation/Augmentation min mod level 44 (önceden 55), Act 4'ten düşer | Resmî 0.5.0, poe2wiki, Fextralife | **verified** | İki A/B kaynak birebir aynı |
| 6 | "Greater Orb'ların tamamı 55'ten 44'e indi" | Boostmatch | **rejected** | Değişiklik yalnızca Transmutation/Augmentation için |
| 7 | Perfect Orb of Transmutation min mod level 70 | poe2wiki, Codex | **verified** (B+C) | Wiki item metni "Minimum Modifier Level: 70" |
| 8 | Greater/Perfect Regal, Chaos, Exalted 35/50 | Codex | **plausible** | Bu araştırmada yalnızca C kaynağında görüldü. In-game tooltip ile kontrol edilmeli |
| 9 | Taban bir aileyi tamamen silecekse o ailenin en üst uygun tier'i yine rol edebilir | poe2wiki, Codex | **verified (B)** | Wiki: "at least one tier of each mod will always be eligible to roll, respecting item level" |
| 10 | "Greater Exalts require ilvl ≥ 35" | Codex §II | **rejected** | Mod level tabanı ile item level karıştırılmış |
| 11 | Gnawed bone'lar item level ≤ 64 item'larda çalışır | poe2wiki (Gnawed Collarbone), Expert Game Reviews, Geektown | **verified** | "This item can only be used on items of item level 64 or below." |
| 12 | "Gnawed bones cap at mod level 64" | Codex §II | **rejected** | Kısıt item level üzerinde, mod level üzerinde değil |
| 13 | Ancient bone min mod level 40 | poe2wiki (Ancient Jawbone), MuleFactory metni | **verified** | Item metni "Minimum Modifier Level: 40" ve Light Radius istisna örneği |
| 14 | Lich modları (Amanamu/Ulaman/Kurgal) yalnızca ilvl 65+ ve Preserved+ bone ile gelir | MMOSO | **plausible** | Gnawed ≤64 kuralıyla tutarlı ama A/B teyidi yok |
| 15 | Omen of Whittling: Chaos Orb **en düşük level'li** modu değiştirir | poe.ninja/Sportskeeda metin, Codex, Steam | **verified** | Oyun metni "lowest level modifier". Steam kullanıcısı tier ile level'in farklı olduğunu gözlemlemiş |
| 16 | "Whittling ile en düşük tier'i hedefle" | Codex §IV (Chaos Orb satırı) | **rejected** | Kendi Omen bölümüyle bile çelişiyor. Doğrusu lowest level |
| 17 | Omen of Light: Annulment yalnız Desecrated mod siler | vaal.tools, wiki | **verified** | Oyun metni |
| 18 | Blackblooded/Liege/Sovereign yalnız weapon/jewellery desecration'da çalışır | vaal.tools metni | **verified** | "next Weapon or Jewellery Desecration attempt" |
| 19 | Omen of Catalysing Exaltation catalyst quality'sini tüketir ve eşleşen mod tipinin şansını artırır | poe.ninja, PlayFunc metni | **verified** (metin); büyüklük **unknown** | Artışın oranı yayımlanmamış |
| 20 | Necrotic Catalyst Ring/Amulet'teki minion modlarını güçlendirir, Refined versiyonu da var, Genesis Tree'den gelir | 0.5.2 notları (Maxroll/PatchBot/Sportskeeda) | **verified** | Resmî not metni |
| 21 | "Refined Necrotic, ring/amulet'te jewel etkilerini artırır" | gamer.org | **rejected/şüpheli** | Refined catalyst'ler Jewel'lar için (resmî: "12 Catalysts that can add new quality modifiers to Jewels") |
| 22 | Necrotic Catalyst ile "+6 minion skill level amulet" mümkün | gamer.org | **plausible (needs test)** | Quality'nin tamsayı +level modlarında yuvarlamayla nasıl davrandığı doğrulanmadı |
| 23 | Catalyst'ler Breach canavarlarından düşer | timesaver catalyst guide | **outdated** | 0.5.0: "Catalysts can no longer drop from Monsters, these are now solely obtained from the Genesis Tree." |
| 24 | Sanctify ve Vaal değer-rastgeleleştirme sonucu mevcut değer üzerinden çarpar | Resmî 0.5.0 | **verified** | Resmî metin |
| 25 | Sanctify çarpanı 0.78–1.22 (0.01 adım, yukarı yuvarlama) | timesaver, Codex | **plausible** | Yalnızca C/D kaynaklarda. Aralık bir D kaynağında 0.8–1.2 diye geçiyor, çelişkili |
| 26 | "Sanctify tüm değerleri yeniden roll eder, sonra 0.8–1.2 ile çarpar" | InstantCarry | **rejected** | 0.5.0'da "instead of randomising values" |
| 27 | Tüm Infuser'lar en az %20 quality ister; dört tip (Armourer's/Blacksmith's/Arcanist's/Catalysing) | Resmî 0.5.0 | **verified** | Resmî metin |
| 28 | Omen of Corruption elde edilemez; Homogenising Exaltation/Coronation yalnızca Standard Currency Exchange'te | Resmî 0.5.0 | **verified** | "only appear on the Currency Exchange in Standard Leagues" |
| 29 | Homogenising Exaltation ile tarif (VULKK Desecration, POE2FUN 0.4 amulet) | VULKK, POE2FUN | **outdated** | FR/RoA'da omen düşmüyor |
| 30 | Recombinator kapalı, Omen of Recombination silindi | Resmî 0.5.0 | **verified** | FR için 0.5.5'te geri açılış yok |
| 31 | Alloy'lar Forbidden Rites'ta kullanılabilir | EZG | **rejected (orta güven)** | poe2wiki: "Exclusive to Runes of Aldur league". 0.5.5 notlarında söz yok. FR alloy fiyat sayfası bulunamadı |
| 32 | "Alloys replace the old Entities and Recombination Tools" | Fextralife, Boostmatch | **rejected** | PoE2'de "Entities" diye bir sistem yok, uydurma |
| 33 | "Finish your Rare item using orbs and fossils first" (Runic Alloy sayfası) | Fextralife | **rejected – PoE1 kirliliği** | Fossil'ler PoE2'de yok |
| 34 | Runic Alloy "drops from monsters imprisoned by essences" | Fextralife | **rejected** | Resmî: Alloy'lar Remnant karşılaşmalarından açılır |
| 35 | Runic Alloy ring değeri +(37–49) / +(25–30) | Fextralife / RPGStash | **çelişkili** | İki C/D kaynak farklı. RoA-only olduğu için kütüphane dışı |
| 36 | Astrid's Creativity "Can have 1 additional Crafted Modifier(s)" (augment soketine) | Fextralife, dadsofexile, POE2FUN | **plausible** | Verisium Remnant runeword'ü. FR'de elde edilebilirliği doğrulanmadı. 0.5.4'ten beri Corrupted/Sanctified item'lara soketlenemiyor |
| 37 | Omen of Putrefaction: tüm modları ≤6 unrevealed Desecrated ile değiştirip item'ı corrupt eder | vaal.tools/Game8 metni, poe2wiki | **metin verified; 0.5 davranışı unknown** | 0.5 tek-desecrated kuralıyla çelişiyor. Test edilmeli |
| 38 | Liquid Emotions jewel'larda Greater Essence gibi çalışır, rastgele bir modu değiştirir | Resmî 0.5.0 | **verified** | Crafted slotu tüketip tüketmediği bilinmiyor |
| 39 | Loathsome Mire amulet'leri iki instilled notable verir, bedeli −1 prefix veya −1 suffix | Resmî 0.5.0 | **verified** | EZG'nin Absent/Portent tarifleri bu base'lere dayanıyor |
| 40 | Genesis Tree ring/belt'e caster ve minion modları ekler | Resmî 0.5.0 | **verified** | "Added a new set of Caster and Minion mods that can be crafted onto Rings and Belts" |
| 41 | Genesis Tree puan limitleri (15 currency/amulet, 10 ring/belt) veya (womb başına 15) | AOEAH / Game8 | **çelişkili → unknown** | Oyun içinde bakılmalı |
| 42 | "1,458 Hiveblood ile guaranteed ilvl 84 base" | Boostmatch | **rejected (kanıtsız)** | Uydurma görünümlü kesin sayı |
| 43 | Omen of Chaotic Rarity/Quantity/Monsters ters çevrildi; Omen of Chaotic Effectiveness eklendi | Resmî 0.5.0, Codex | **verified** | Waystone'a özel |
| 44 | Magic item "up to three Modifiers" | Sportskeeda crafting currency guide | **rejected** | Magic item en fazla 1 prefix + 1 suffix taşır |
| 45 | "Alt-regal sequence with essences" | Codex §V | **rejected – PoE1 jargonu** | PoE2'de Orb of Alteration yok. Adımlar Transmutation→Augmentation→Essence olarak yeniden yazılmalı |
| 46 | Orb of Alchemy yalnızca Normal item'da çalışır | Codex | **outdated/eksik** | Güncel metin Normal veya Magic item |
| 47 | "Omen of Dexter Necromancy" | EZG | **rejected (isim hatası)** | Doğru isim Omen of Dextral Necromancy |
| 48 | Fractured suffix + tek boş suffix ile Necromancy/Essence desecration döngüsü (Absent Amulet, Portent Amulet, Dusk Ring) | EZG | **plausible (needs test)** | Mantık tek-desecrated ve side-omen kurallarıyla tutarlı. Kaynak D |
| 49 | Maxroll: minion levels sceptre, helmet, amulet'te; Spirit body armour, amulet, sceptre'da | Maxroll 0.5 | **verified (B)** | İki Maxroll rehberi aynı |
| 50 | Sword/Axe/Dagger base'leri 0.5.5'te düşer | EZG (Gamescom haberi) | **rejected (0.5.5 için)** | 0.5.5 bug fix: "some Unique Swords, Axes and Daggers were able to drop from Expedition Unique Chests". Yani düşmeleri amaçlanmıyor. Kılıçlar, GGG'nin 25 Ağustos 2026 Gamescom Opening Night Live'daki 1.0 fragmanında Duelist ile birlikte duyuruldu (pathofexile.gg: "The trailer shows the Duelist using both one-handed swords and two-handed greatswords"); 1.0 çıkışı 11 Aralık 2026 |
| 51 | Sanctify/Divine "tier 1 = en iyi tier" (Advanced Mod Descriptions) | Codex | **plausible-yüksek** | PoE2DB T1'i en üst tier olarak listeliyor. Resmî tanım bulunamadı |
| 52 | "Crafting in 0.5 dozens of Exalted ... ~9 Exalted for forcing a prefix" | timesaver | **rejected (fiyat)** | Canlı fiyat. Kütüphaneye alınmadı |

## (c) Tarif Kütüphanesi

**Genel ön koşullar (her tarif için):**
- Crafted slot boş mu? Essence, Perfect Essence, Alloy ve bazı Runic Ward enchant'ları aynı slotu kullanır.
- Desecrated slot boş mu?
- Hedef tier'in mod level'i ≤ item level mi?
- Aynı mod grubundan başka bir mod item'da var mı?
- Omen'ler sağ tıkla aktive edildi mi? Aktif olmayan omen etki etmez.

**Lig kapsamı etiketleri:** **[FR]** Forbidden Rites'ta geçerli · **[RoA]** yalnızca Runes of Aldur · **[STD]** yalnızca Standard legacy.

**Maliyet kademeleri:** Canlı fiyat verilmemiştir. Ucuz = temel orb'lar ve Greater Essence. Orta = Greater/Perfect orb'lar, yaygın omen'ler, Preserved bone. Pahalı = Fracturing Orb, Perfect Essence, Ancient bone, Omen of Whittling/Sanctification, Genesis Tree yüksek ilvl gift'ler. Orb sayıları tahmindir.

### C1. Weapon – Minion Sceptre (öncelikli)

**C1-a. Ucuz: "+# to Level of all Minion Skills" suffix avı [FR] – plausible**

- **Ön koşul:** Sceptre base'i. Maxroll'a göre Rattling Sceptre en iyisi, Shrine Sceptre da iş görür. +1/+2/+3/+4 tier'leri sırasıyla mod level 2/25/55/78'de açılır.
- **Mantık (tabana dayalı hesap):**
  - Greater Orb of Transmutation (taban 44) ilvl 78+ base'de minion-level ailesinden yalnızca +3 veya +4 getirebilir.
  - Perfect Orb of Transmutation (taban 70) ilvl 78+ base'de yalnızca +4 getirebilir.
  - ilvl 55–77 base'de Perfect Transmutation'ın aile-istisnası kuralı gereği +3'ü uygun bırakması gerekir. Bu, poe2wiki kuralından çıkarım; test edilmeli.
- **Adımlar:**
  1. Normal sceptre'a Greater Orb of Transmutation uygula.
  2. Minion-level suffix'i gelmezse base'i bırak. Magic item'da mod silecek bir PoE2 orb'u olmadığından yeni base gerekir.
  3. Suffix geldiyse Orb of Augmentation / Greater Orb of Augmentation ile bir prefix ekle. Hedef % increased Spirit veya minion hasar prefix'i. Tarafı poe2db'den doğrula.
  4. Regal Orb ya da uygun bir Greater Essence ile Rare'e yükselt. Essence kullanırsan crafted slot dolar.
  5. Omen of Sinistral Exaltation + Exalted Orb ile prefix'leri doldur.
- **Kontrol noktaları:**
  - Durma: 1. adımda +4 (ilvl 78+) veya bütçeye göre +3 geldiyse devam et.
  - 3. adımdaki prefix çöpse Regal'dan önce karar ver: satış mı, devam mı.
  - Rare'de iki iyi prefix + minion-level varsa desecration'a (C8) geç.
- **Riskler:**
  - Resmî 0.5.0 notlarına göre "Greater and Perfect currencies have been made somewhat rarer, with Transmutation and Augmentation being made significantly rarer", bu yüzden base başına maliyet yüksek.
  - Gerçek roll ağırlıkları bilinmiyor.
- **Kaynaklar:** Resmî 0.5.0 (taban 44), poe2wiki (taban 70 + aile istisnası), Maxroll minion rehberleri.

**C1-b. Orta: Rare sceptre'ı fracture + side-omen ile tamamlama [FR] – plausible**

1. +3/+4 minion-level suffix'li Rare sceptre al (en az 4 mod olmalı).
2. Fracturing Orb uygula. Minion-level fracture olmazsa tarif bu item için biter.
3. Kötü suffix'leri Omen of Dextral Erasure + Chaos Orb ile değiştir. Kötü prefix'ler için Omen of Sinistral Erasure kullan. En düşük level'li çöp mod için Omen of Whittling daha verimli.
4. Boş slotlar için Omen of Sinistral/Dextral Exaltation + Greater Exalted Orb kullan.
5. Crafted slot boşsa bir Greater/Perfect Essence ekle. Perfect Essence rastgele mod siler, bu yüzden Omen of Sinistral/Dextral Crystallisation ile tarafı seç.
6. Son adım desecration (C8).

- **Kontrol:** Fracture başarısızsa item'ı sat. Chaos adımında hedef T1 Spirit veya kritik şansı gibi güçlü bir mod.
- **Risk:** Resmî 0.5.0 notlarına göre "Some items and content now require you to specialise in them through Atlas Passive Skills including ... Fracturing Orbs"; EZG'ye (D kaynak) göre gereken node "Hidden Scars" Atlas Passive'i.
- **Kaynak:** POE2FUN (1–3. adımlar), resmî 0.5.0.

**C1-c. Pahalı: "Puppet Master" sceptre (Adaptive Alloy + The Runebinder's Alloy + Astrid's Creativity) [RoA] – plausible, FR'de uygulanamaz**

- **Adımlar:** Fractured +4 → Chaos ile T1 Spirit veya kritik → side-omen ile Exalt → Crystallisation + Adaptive Alloy → soket + Astrid's Creativity → ikinci Exalt → Crystallisation + The Runebinder's Alloy → Greater/Perfect Exalted → Jawbone.
- **Uyarılar:**
  - İkinci Alloy yalnızca Astrid's Creativity ile mümkün, çünkü tek crafted slot kuralı geçerli.
  - Crystallisation omen'lerinin Alloy'larda çalıştığı yalnızca bu C kaynağında geçiyor. Test edilmeli.
  - Alloy'lar poe2wiki'ye göre "Exclusive to Runes of Aldur league".
- **Kaynak:** POE2FUN (0.5.0), poe2wiki.

### C2. Weapon – Caster Wand/Staff "+# to Level of all [type] Spell Skills" [FR]

**C2-a. Ucuz – plausible:**
1. ilvl'si uygun Normal wand/staff'a (ör. Lightning için ilvl ≥81) Orb of Transmutation / Greater Orb of Transmutation uygula. Hedef +level prefix.
2. Orb of Augmentation ile cast speed benzeri bir suffix ekle.
3. Greater Essence of Sorcery (% spell damage) veya Greater Essence of Alacrity (cast speed) ile Rare yap. Hangi tarafa ekleneceğini essence tooltip'inden kontrol et.
4. Side-omen + Exalted Orb.

- **Kontrol:** +level gelmezse base'i bırak.
- **Kaynak:** Codex (breakpoint tablosu, C), Codex essence kataloğu. Perfect Essence of Sorcery'nin "+to spell levels" iddiası plausible, tooltip kontrolü gerekli.

**C2-b. Orta:** C1-b ile aynı mantık. Önce +level prefix fracture edilir, sonra Erasure/Exaltation omen'leri kullanılır.

### C3. Helmet – ES + minion levels [FR] – plausible

1. Int veya hibrit ES helmet base al.
2. Transmutation/Augmentation ile "+# to Level of all Minion Skills" + ES modu dene.
3. Greater Essence of Enhancement ile Rare yap. Crafted slot dolar.
4. Side-omen ile Exalted Orb.
5. Rib ile desecration (C8). Lich omen'leri armour'da ÇALIŞMAZ, çünkü yalnızca weapon ve jewellery için geçerliler.

- **Kaynak:** Maxroll (helmet'te minion levels), omen metinleri.

### C4. Amulet / Ring – minion jewellery

**C4-a. Orta: Necrotic Catalyst + Omen of Catalysing Exaltation [FR] – verified (mekanik), plausible (verim)**

1. Minion-level ya da minion modlu Rare amulet/ring hazırla ve en az bir boş slot bırak.
2. Necrotic Catalyst'i quality dolana kadar uygula. Timesaver'a göre normal jewellery'de tavan %20, Breach Ring'lerde %50 (D kaynak, test edilmeli). Farklı bir catalyst tipi mevcut quality'yi değiştirir.
3. Omen of Catalysing Exaltation aktifken Exalted Orb (Greater/Perfect) kullan. Omen tüm catalyst quality'sini tüketir ve minion tipi modun şansını artırır.
4. Quality tükendiği için sonraki slam'ler öncesinde catalyst'i yeniden uygula.

- **Kontrol:** Her slam sonrasında taraf dolduysa Omen of Sinistral/Dextral Exaltation ile birleştir. Birlikte çalıştıkları Codex'te belirtiliyor ("multiple compatible omens"), test edilmeli.
- **Risk:** Şans artışının büyüklüğü bilinmiyor. Catalyst'ler yalnız Genesis Tree'den geliyor, bu yüzden FR'nin taze ekonomisinde kıt olabilir.
- **Kaynak:** 0.5.2 notları, Omen metni (poe.ninja), 0.5.0 (catalyst kaynağı).

**C4-b. Genel catalyst jewellery (Life/Mana/elemental) [FR]:** Aynı akış, farklı catalyst'lerle: Flesh = Life, Neural = Mana, Carapace = Armour/Evasion/ES, Xoph's/Tul's/Esh's = elemental, Chayula's = Chaos, Reaver = Attack, Sibilant = Caster, Skittering = Speed, Adaptive = Attribute. Timesaver'ın "+60 Life → +72" hesabı %20 quality için matematiksel olarak tutarlı.

**C4-c. Pahalı: Loathsome Mire amulet'leri (Absent / Portent) üzerinde fractured-suffix desecration döngüsü [FR] – plausible (needs test)**

1. Hedef tarafta tam iki mod olacak şekilde item'ı hazırla: biri fractured, diğeri değiştirilecek slot. Base'in −1 prefix veya −1 suffix bedeli var.
2. Omen of Dextral Necromancy + Preserved Collarbone ile suffix desecration yap.
3. Reveal sırasında Omen of Abyssal Echoes ile seçenekleri bir kez yeniden çek. Jewellery olduğu için Omen of the Liege/Sovereign/Blackblooded ile lich havuzu seçilebilir.
4. Iska olursa Omen of Light + Orb of Annulment ile yalnız Desecrated modu sil ve tekrarla.

- **Uyarı:** Item'da önceden crafted mod varsa tarifin mod yapısı bozulabilir (EZG'nin kendi uyarısı).
- **Kaynak:** EZG (D, yalnızca lead), resmî 0.5.0 (base tanımı), omen metinleri.

### C5. Belt / Ring / Amulet – Genesis Tree [FR – Breach core; puan limitleri unknown]

1. Breach'ten Hiveblood ve Wombgift topla. Banded = Belt, Signet = Ring, Ornate = Amulet, Lavish = Currency (catalyst dahil), Revelatory = Breachstone.
2. İlgili womb dalında minion modifier ağırlığını artıran node'ları ve "higher tier modifier rating" node'larını al. Resmî metne göre minion/caster mod seti Rings and Belts için tanımlı; Amulet'te node metnini kontrol et.
3. Hiveblood harca ve item'ı büyüt.
4. Çıkan Rare'i C4 akışıyla (catalyst + Catalysing Exaltation) veya C8 (desecration) ile tamamla.

- **Kontrol:** Node metinleri "increased weight" diyorsa bu garanti değil, olasılık kaydırmasıdır.
- **Risk:** Dal puanları kullanımla açılıyor. Önce ucuz gift'lerle dalı açmak tavsiye ediliyor (AOEAH, D).
- **Kaynak:** Resmî 0.5.0, Fextralife ve Game8 (C), 0.5.2 (Necrotic).

### C6. Boots – Movement Speed + Resistances [FR]

**C6-a. Ucuz – plausible:**
1. ilvl 75–80 boot base seç. Codex'e göre MS T1 ilvl 82, T2 ilvl 70'te açılıyor ve 75–80 aralığı daha dar bir havuz verir.
2. Orb of Transmutation / Greater Orb of Transmutation ile "% increased Movement Speed" suffix'ini ara.
3. Orb of Augmentation ile Life veya ES prefix'i ekle.
4. Greater Essence of Insulation / Thawing / Grounding ile Rare yap. Crafted slot resistance essence'ına gider.
5. Omen of Dextral Exaltation + Exalted Orb ile ikinci resistance.

- **Kontrol:** MS gelmediyse base'i bırak. 4. adımdan sonra 3 suffix doluysa prefix'lere geç.
- **Kaynak:** Codex (C), resmî rarity kuralları.

**C6-b. Orta:** Rare boot'ta MS'i fracture et, sonra Erasure/Annulment omen'leriyle kalan suffix'leri resistance'a çevir.

### C7. Body Armour – Life/ES [FR] – plausible

1. İyi bir defans prefix'li Magic base'e Greater Essence of the Body (Life) ya da Greater Essence of Enhancement uygula.
2. Omen of Greater Exaltation + Exalted Orb (2 mod ekler).
3. Omen of Sinistral/Dextral Annulment ile kötü tarafı temizle.
4. Rib + Necromancy omen ile desecration yap.
5. İsteğe bağlı: Essence of Delirium (body armour notable) ancak crafted slot boşsa kullanılabilir.

- **Uyarı:** Essence of the Body, item'da zaten maximum life modu varsa "already has a modifier of that type" hatası verir (mod grubu kuralı).
- **Kaynak:** Codex, resmî kural.

### C8. Evrensel Desecration Döngüsü (Omen of Light + Abyssal Echoes) [FR] – verified (mekanik)

1. Item Rare olmalı ve Desecrated slotu boş olmalı. Slot türüne göre bone seç: Jawbone = weapon/quiver, Rib = armour, Collarbone = ring/amulet/belt, Altered Collarbone = otherworldly şansı, Cranium = jewel.
2. Item ilvl ≤64 ise Gnawed kullanılabilir. Üstünde Preserved, yüksek taban istiyorsan Ancient (min mod level 40).
3. Tarafı seçmek için Omen of Sinistral/Dextral Necromancy kullan. Weapon/jewellery'de lich havuzu için Liege/Sovereign/Blackblooded ekle.
4. Well of Souls'ta reveal yap. İlk üçlü kötüyse Omen of Abyssal Echoes ile bir kez yeniden çek.
5. Iska olursa Omen of Light + Orb of Annulment (yalnız Desecrated mod silinir) ve 3. adıma dön.

- **Risk:** Item'ın tüm affix slotları doluysa bone önce rastgele bir mod siler (timesaver ve MMOJUGG, D; tutarlı ama test edilmeli). Bu yüzden hedef tarafta bir slot boş bırak.
- **Durma:** İkinci Omen of Light'tan sonra item değerini yeniden fiyatla.

### C9. Perfect Essence + Crystallisation ile hedefli değişim [FR] – verified (mekanik)

- **Ön koşul:** Crafted slot boş olmalı.
- **Adımlar:** Omen of Sinistral Crystallisation (prefix siler) veya Omen of Dextral Crystallisation (suffix siler) aktive et, sonra Perfect Essence uygula. Rastgele silme yalnız seçilen tarafta olur ve essence modu eklenir.
- **İpucu:** Değişmesini istemediğin modları önceden fracture et. Tarafta tek "feda" mod bırakırsan silme deterministik olur (fracture izolasyonu).
- **Uyarı:** Perfect Essence of Battle 0.5'te +3 (Two Hand/Crossbow) ve +2 (One Hand/Bow). Eski +5/+3 değerli rehberler outdated.

### C10. Fracture + side-omen izolasyonu [FR] – verified (mekanik)

1. Rare item'da (en az 4 mod) Fracturing Orb ile en değerli mod kilitlenir.
2. Hedef tarafta tek değiştirilebilir mod kaldığında Omen of Sinistral/Dextral Erasure + Chaos Orb yalnızca o modu değiştirir. Chaos Orb PoE2'de bir modu kaldırıp bir mod ekler; tüm modları yeniden roll etmez.
3. Omen of Sinistral/Dextral Annulment ile slot boşaltılır, ardından Omen of Sinistral/Dextral Exaltation ile doldurulur.

### C11. Jewel – Liquid Emotions ve Refined Catalysts [FR] – verified (mekanik)

1. Rare jewel'a uygun Liquid Emotion uygula. Rastgele bir mevcut modu kendi setinden bir modla değiştirir.
2. Refined Catalyst'lerle jewel quality modu ekle (12 yeni tip, Genesis Tree kaynaklı; minion için Refined Necrotic).
3. Cranium ile desecration yap.
4. Potent/Ancient emotions yalnızca Delirium haritalarından gelir (Timelost Jewel için Ancient).

- **Belirsizlik:** Liquid Emotion modunun crafted slotu tüketip tüketmediği bilinmiyor.

### C12. Bitiriş – Sanctify / Vaal [FR]

- **Sanctify:** Omen of Sanctification + Divine Orb. Değerler mevcut değer üzerinden çarpılır ve item Sanctified olarak kilitlenir. Aralık 78–122% plausible.
- **Vaal:** Önce Vaal Infuser'ı %20+ quality'ye sahip item'a uygula, sonra Vaal Orb. Omen of Corruption yok, bu yüzden sonuç tamamen RNG.
- **Kontrol:** En kötü senaryoda bile (tüm modlar ×0.78) item kabul edilebilir değilse Sanctify yapma.

### C13. Legacy / geçersiz tarifler (kütüphaneye "disabled" olarak ekle)

- **[STD]** Omen of Homogenising Exaltation/Coronation tarifleri (VULKK 2025, POE2FUN 0.4 amulet).
- **[STD/geçersiz]** Omen of Corruption ile kontrollü Vaal.
- **[yok]** Recombinator ve Omen of Recombination tarifleri.
- **[geçersiz]** 0.3 dönemi çift Perfect Essence ve Putrefaction ile 6-desecrated tarifleri. Putrefaction'ın 0.5 davranışı test edilmedikçe kullanılmamalı.

## (d) Sahada Bulunan PoE1 Kirliliği ve Eski Veri

| Bulgu | Kaynak | Tür |
|---|---|---|
| "finish crafting your Rare item using orbs and fossils first" | Fextralife – Runic Alloy | PoE1 (Fossil) |
| "The alt-regal sequence with essences" | domistae Codex §V | PoE1 jargonu (Orb of Alteration PoE2'de yok) |
| "every meta-mod" / "metamods" başlığı | domistae Codex giriş | PoE1 crafting-bench metamod kavramı |
| Alloys "replace the old Entities and Recombination Tools" | Fextralife, Boostmatch | Uydurma sistem adı |
| Magic item "up to three Modifiers" | Sportskeeda | Yanlış kural |
| Sanctify "rerolls all modifier values then ×0.8–1.2" | InstantCarry | 0.5 öncesi / yanlış |
| "Catalysts are exclusive drops from the Breach mechanic" (monster drop) | timesaver | 0.5 öncesi |
| Omen of Homogenising Exaltation / Omen of Corruption içeren tarifler | VULKK 2025, POE2FUN 0.4 | 0.3/0.4 dönemi |
| "Omen of Dexter Necromancy" | EZG | İsim bozulması (AI metni işareti) |
| Arama sonuçlarında 2019 PoE1 "alt-aug-regal-scour + can have multiple crafted modifiers metacraft" Steam başlığı | Steam (PoE1 app 238960) | PoE1 içeriği PoE2 aramalarına sızıyor. Asistan filtresinde app ID kontrolü önerilir |
| "Chaos Orb ... primarily a fractional trading unit; using it to re-roll your gear ..." | Boostmatch | PoE1 "reroll all" zihniyeti; PoE2'de Chaos tek modu değiştirir |

Aramalarda Orb of Scouring, Orb of Fusing, Chromatic Orb, Awakener's Orb, Eldritch currency, Harvest ve influence'lı (Shaper/Elder/Conqueror) PoE2 tarifi ile karşılaşılmadı. Asistanın reddetme listesinde yine de kalmalılar.

## (e) Açık Sorular – Yanıtlar ve Güven

| Soru | Yanıt | Güven |
|---|---|---|
| Advanced tooltip'te "Tier: 1" en iyi tier mi? | Evet, T1 en yüksek tier (PoE2DB listelemesi ve Codex ile uyumlu). Resmî tanım metni bulunamadı | Orta-yüksek |
| Greater/Perfect tabanları doğru mu? | Trans/Aug 44/70 doğrulandı (A+B). Regal/Chaos/Exalted 35/50 yalnızca C kaynakta var | 44/70 yüksek; 35/50 orta |
| Taban bir aileyi tamamen silerse? | Ailenin en üst uygun tier'i (item level'e saygılı) yine rol edebilir. Light Radius örneği var | Yüksek (B) |
| Gnawed ≤64? Ancient min 40? | Gnawed: item level ≤64. Ancient: minimum modifier level 40 | Yüksek |
| İkinci crafted-mod currency? | Engellenir ("this item already has a crafted modifier"). Üzerine yazma kanıtı yok | Orta-yüksek (0.5.5'te yeniden test önerilir) |
| Omen of Putrefaction 0.5'te? | Metin hâlâ "up to 6 Unrevealed modifiers + Corrupt" diyor ve 0.5 tek-desecrated kuralıyla çelişiyor. Gerçek davranış belgelenmemiş. Kullanmadan önce tooltip'e bakılmalı | Düşük |
| Recombinator FR'de? | Yok (0.5.0'da kapatıldı, 0.5.5'te açılmadı) | Yüksek |
| Runic Alloy FR'de? | Büyük olasılıkla yok ("Exclusive to Runes of Aldur league"). Verisium Anvil ve Remnant'lar core'a geçti ama Alloy'lardan söz edilmiyor | Orta-yüksek |
| Sanctify aralığı 78–122%? | Yalnızca C/D kaynaklarda. Bir D kaynak 80–120 diyor. Mevcut değer üzerinden çarpma A ile doğrulandı | Aralık: orta-düşük |
| Vaal Infuser %20 quality? | Evet: "All Infusers can only be used on items at or above 20% Quality." | Yüksek |
| Sword/Axe/Dagger/Flail 0.5.5'te düşüyor mu? | Hayır. 0.5.5, Expedition sandıklarından yanlışlıkla düşen Unique Sword/Axe/Dagger'ları bug olarak düzeltti. Kılıçlar, 25 Ağustos 2026 Gamescom Opening Night Live'daki 1.0 fragmanında Duelist ile duyuruldu (pathofexile.gg); 1.0 çıkışı 11 Aralık 2026. Flail için veri yok | Sword/Axe/Dagger orta-yüksek; Flail düşük |
| Advanced copy metni mod tag'lerini gösteriyor mu? | Kanıt yok. Codex tag'lerin oyunda görünmediğini söylüyor. 0.5.5 yalnızca chat-link'li item'da Ctrl+C advanced açıklama hatasını düzeltti | Düşük (test gerekli) |
| Currency Exchange API lowest_ratio / highest_ratio yönü | Bu araştırmada belgelenmiş bir kaynak bulunamadı | Bilinmiyor |

## (f) Oyun İçi Test Gerektiren Konular

1. Tam doldurulmuş crafted slotta Perfect Essence / Alloy / Liquid Emotion davranışı: hata mesajı mı, sessiz tüketim mi? 0.5.5'te yeniden test et.
2. Liquid Emotion ve Runic Ward enchant'ları crafted slotu tüketiyor mu?
3. Omen of Putrefaction'ın 0.5.5 tooltip'i ve gerçek sonucu. Yalnızca ucuz bir item'da test edilmeli.
4. Omen of Sinistral/Dextral Crystallisation'ın Alloy'larla çalışıp çalışmadığı (RoA).
5. Greater/Perfect Regal, Chaos, Exalted taban değerleri (35/50) için tooltip ekran görüntüsü.
6. Perfect Orb of Transmutation'ın ilvl 55–77 sceptre'da minion-level ailesini +3'te tutup tutmadığı (aile-istisnası kuralının pratik testi).
7. Necrotic Catalyst quality'sinin tamsayı "+# to Level of all Minion Skills" modlarını yuvarlamayla artırıp artırmadığı ("+6 amulet" iddiası).
8. Omen of Catalysing Exaltation'ın side-exaltation omen'leriyle aynı slam'de birlikte çalışması ve şans artışının büyüklüğü.
9. Tüm affix'leri dolu item'da bone'un rastgele mod silip silmediği.
10. Lich modlarının ilvl 65+ ve Preserved+ bone şartı.
11. Genesis Tree dal puan limitleri (10 mu 15 mi) ve minion node metinlerinin Amulet'i kapsayıp kapsamadığı.
12. Sanctify çarpan aralığı, adım büyüklüğü ve yuvarlama yönü.
13. Advanced item copy (Ctrl+Alt+C) çıktısında tag ve mod level alanlarının varlığı.
14. Currency Exchange API'de lowest_ratio / highest_ratio alanlarının yönü (hangi taraf "want", hangisi "have").
15. Astrid's Creativity'nin Forbidden Rites'ta Verisium Remnant runeword'üyle elde edilebilirliği.
16. Flail base'lerinin 0.5.5'te düşüp düşmediği.

## Recommendations

- **Kütüphane şeması:** Her tarifte zorunlu alanlar olsun: `league_scope` (FR/RoA/STD), `crafted_slot_use`, `desecrated_slot_use`, `min_ilvl`, `verdict`, `source_tier`. Tek crafted ve tek desecrated sınırını ihlal eden her tarif otomatik reddedilsin.
- **Otomatik kirlilik filtresi:** Metinde Alteration, Scouring, Chromatic, Fusing, Awakener, Eldritch, Fossil, Resonator, Harvest, metamod, "alt-aug", "alt-regal", Shaper/Elder/Conqueror, veiled, Whispering/Muttering/Screaming/Deafening, Homogenising (STD dışında), Omen of Corruption veya Recombinator geçiyorsa tarif "karantina"ya alınsın.
- **Olasılık gösterimi:** Panelde yüzde gösterilecekse "Craft of Exile tahmini ağırlıkları" etiketiyle gösterilsin. Oyun istemcisi yalnızca uygunluk (0/1) bilgisi taşıyor.
- **Minion Sorceress için uygulama sırası (FR):** C1-a (sceptre) → C3 (helmet) → C5 (Genesis Tree belt/ring) → C4-a (Necrotic amulet) → C8 (desecration finişi). C1-c yalnızca RoA karakteri için saklansın.

## Caveats

- poe2wiki ve Maxroll sayfalarının bir kısmına bot engeli nedeniyle yalnızca arama özetleri üzerinden erişildi. Bu kaynaklardan alınan alıntılar, sayfaların eski revizyonlarını yansıtıyor olabilir.
- 0.5.2 yama metni GGG forumundan doğrudan değil, Maxroll, PatchBot ve Sportskeeda aynalarından doğrulandı.
- D kademesi siteler yalnızca "lead" olarak kullanıldı. EZG'nin fractured-desecration döngüsü mantıksal olarak tutarlı olsa da test edilmeden "verified" sayılmamalı.
- Forbidden Rites'ta Alloy yokluğu, doğrudan bir yasak metnine değil etiket ve sessizlik kanıtına dayanıyor. Trade sitesinde FR ligi için Alloy araması yapılarak kesinleştirilmeli.