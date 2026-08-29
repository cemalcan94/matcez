# Matcez

<img src="assets/logo/matcez-icon.svg" width="88" alt="Matcez logo">

KKTC Süper Ligi için FPL (Fantasy Premier League) tarzı fantazi futbol uygulaması.
Vanilla JS SPA + Supabase. Statik olarak barındırılır (Netlify, Vercel, GitHub Pages…).

## Özellikler

- **Kadro kurma**: 100M bütçe, 15 oyuncu (2 kaleci, 5 defans, 5 orta saha, 3 forvet), aynı takımdan en fazla 3 oyuncu
- **İlk 11 + yedekler**: geçerli diziliş kontrolü (min 3 defans, 2 orta saha, 1 forvet), kaptan (x2) ve kaptan vekili
- **Haftalık puanlar**: oto-yedek (oynamayan ilk 11 oyuncusu yerine sıradaki uygun yedek girer), kaptan oynamazsa vekil x2 alır
- **Mini ligler**: davet koduyla arkadaş ligleri
- **Gerçek lig takibi**: fikstür, sonuçlar, puan tablosu (sonuçlardan otomatik hesaplanır)
- **Admin paneli**: hafta/fikstür/sonuç yönetimi, maç olayı girişi (grid), oyuncu fiyat/pozisyon düzenleme, JSON içe aktarma, puan hesaplama
- **Demo modu**: Supabase yapılandırılmadıysa uygulama tamamen tarayıcıda (localStorage) çalışır — kurulum yapmadan deneyin

## Puan kuralları (KKTC uyarlaması)

| Olay | Puan |
|---|---|
| Maça çıkma | +2 |
| Gol (Kaleci / Defans / Orta saha / Forvet) | +10 / +6 / +5 / +4 |
| Asist | +3 |
| Gol yememe (oynadı + takım gol yemedi; K/D) | +4 |
| Gol yememe (orta saha) | +1 |
| Maçın oyuncusu | +3 |
| Sarı kart | −1 |
| Kırmızı kart | −3 |
| Kendi kalesine gol | −2 |

> Neden "dakika" yerine "maça çıkma"? Sofascore bu lig için kadro/ilk 11 verisi tutmuyor;
> gol olayları otomatik çekilebiliyor ama kimin oynadığı çekilemiyor. "Oynadı" işaretleri
> admin panelindeki grid'den girilir (maç başına ~1 dakika sürer, "Tümünü Oynadı işaretle" kısayolu var).

## Hızlı başlangıç (demo)

```bash
cd kktc-fantazi
python3 -m http.server 8123
```

<http://localhost:8123> — kurulum gerektirmez, demo modunda açılır (admin paneli dahil her şey denenebilir).

## Gerçek kurulum (Supabase)

1. [supabase.com](https://supabase.com)'da ücretsiz proje oluşturun.
2. **SQL Editor**'de sırasıyla çalıştırın:
   - `supabase/schema.sql` (tablolar, güvenlik kuralları, puan motoru)
   - `supabase/seed.sql` (16 takım + 279 oyuncu — 25/26 sezonu kadroları)
3. `js/config.js` içine **Settings → API**'deki URL ve anon key'i yazın.
4. Uygulamada kayıt olun, sonra SQL Editor'de kendinizi admin yapın:
   ```sql
   update profiles set is_admin = true
     where id = (select id from auth.users where email = 'SIZIN@EMAIL.COM');
   ```
5. Statik dosyaları herhangi bir hosta yükleyin (Netlify drag-drop yeterli).

### Auth notu
Supabase varsayılan olarak e-posta onayı ister. Kapatmak için:
**Authentication → Providers → Email → Confirm email** kapatın.

## Veri girişi iş akışı (haftalık ~15 dk)

1. **Scraper** (isteğe bağlı, önerilen):
   ```bash
   cd scraper && npm install && npx playwright install chromium
   node scrape.mjs                # out.json üretir
   # veya doğrudan Supabase'e:
   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scrape.mjs --push
   ```
   Fikstürü, skorları ve gol atanları otomatik çeker (Sofascore'u gerçek tarayıcıyla açar,
   çünkü API düz istekleri engelliyor). `out.json` üretirse admin panelindeki **İçe Aktar** sekmesine yapıştırın.
2. **Admin → Maç Olayları**: her maç için "Oynadı" işaretlerini girin ("Tümünü Oynadı işaretle" + oynamayanların tikini kaldır),
   varsa kart/asist/MOTM ekleyin.
3. **Admin → Puan Hesabı**: haftanın "Puanları Hesapla" düğmesine basın. Bitti.

> Sezon başında yeni sezon Sofascore'a düştüğünde scraper haftaları ve fikstürü otomatik oluşturur.
> Yeni çıkan takımların (Sofascore'da kadrosu olmayan) oyuncularını admin panelinden ekleyebilirsiniz;
> gol atan bilinmeyen oyuncuları scraper otomatik ekler (tahmini pozisyonla, sarı satır olarak işaretlenir).

## Mimari

```
index.html          kabuk (topbar, nav, view container)
css/style.css       koyu tema, saha görünümü
js/
  config.js         Supabase bilgileri + oyun kuralları (bütçe, kadro limitleri)
  seed-data.js      16 takım + 279 oyuncu (Sofascore ID'leriyle)
  store.js          veri katmanı: DemoStore (localStorage) / SupaStore (aynı arayüz)
  points.js         puan motoru (JS) — schema.sql'deki SQL motoruyla birebir aynı kurallar
  app.js            hash router + auth durumu
  views.js          ana sayfa (hero + fikstür + tablolar), ligler, giriş
  squad.js          Takımım (ilk 11/kaptan), Transferler (pazar, segmentli), Puanlar (hafta dökümü)
  admin.js          admin paneli
supabase/
  schema.sql        tablolar + RLS + compute_gw_points (sunucu tarafı puan motoru)
  seed.sql          takım ve oyuncu seed'i
scraper/
  scrape.mjs        Playwright ile Sofascore scraper (fikstür + skor + goller)
```

Puanlar sunucuda SQL fonksiyonuyla hesaplanır (`compute_gw_points`) — istemci manipülasyonuna kapalıdır.
Kadro kaydı RLS ile korunur: kullanıcı yalnızca kendi kadrosunu, yalnızca son teslim saatinden önce değiştirebilir.

## Transferler ve kozlar

- İlk kadro serbest; sonra haftada **2 ücretsiz transfer**, her ek transfer **−4 puan**.
- **Kozlar** (sezonda 1'er kez, haftada en fazla 1; ana sayfadan oynanır/iptal edilir):
  Bench Boost (yedek puanları da sayılır), Triple Captain (kaptan x3),
  Wildcard (o hafta sınırsız transfer, kalıcı), Free Hit (bir haftalık sınırsız transfer, kadro geri döner).
- Oyuncu profilleri: son haftaların puan dökümü + gelecek maçlar (formaya dokun → Profili gör).

## Bilinen sınırlar / yol haritası

- Oyuncu fiyatları sabittir (v2: forma göre fiyat değişimi)
- Ücretsiz transfer hakkı haftadan haftaya birikmez (FPL'deki gibi biriktirme v2)
- 26/27 sezonu takımları netleşince (küme düşen/çıkanlar) takım listesi admin panelinden güncellenmeli
