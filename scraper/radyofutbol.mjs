#!/usr/bin/env node
// Matcez — radyofutbol.net canlı skor çekici
//
// Radyo Futbol'un canlı skor sayfası (WordPress "canli-skor" eklentisi) yapısal JSON döndürür:
// skorlar, hafta numarası, maç durumu (beklemede/canlı/bitti) ve canlı maçlarda "olaylar" dizisi.
// Bu script veriyi düz HTTP ile çeker (tarayıcı gerekmez) — GitHub Actions'ta cron ile
// hafta sonu maç saatlerinde 10 dakikada bir çalıştırılabilir.
//
// NOT: Kullanmadan önce Radyo Futbol'dan izin alın ve uygulamada
// "Skor verisi: Radyo Futbol (radyofutbol.net)" atıfını gösterin.
//
// Kullanım:
//   node radyofutbol.mjs                 -> out-radyofutbol.json üretir (admin > İçe Aktar)
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node radyofutbol.mjs --push
//                                        -> skorları doğrudan Supabase'e işler

import { writeFileSync } from 'node:fs';

const BASE = 'https://radyofutbol.net';
const LIG_ADI = process.env.LIG_ADI || 'SÜPER LİG';
const PUSH = process.argv.includes('--push');

// radyofutbol takım adı (normalize) -> bizim teams.id
// Yeni takımlar (Sofascore'da olmayanlar) için elle negatif ID atayın ve
// teams tablosuna admin panelinden ekleyin.
const TEAM_MAP = {
  'GENCLIK GUCU': 930682, 'CB GENCLIK GUCU': 930682,
  'CIHANGIR': 280558,
  'DOGAN TURK BIRLIGI': 930680,
  'MAGUSA TURK GUCU': 277539,
  'DUMLUPINAR': 930681,
  'CETINKAYA': 930675,
  'ALSANCAK YESILOVA': 277538,
  'KUCUK KAYMAKLI': 1118203,
  'YENICAMI': 277956,
  'ESENTEPE': 930673,
  'LEFKE': 930674,
  'KARSIYAKA': 930679,
  'MESARYA': 930677,
  'MORMENEKSE': 1118202,
  'GONYELI': 930676,
  'YENIBOGAZICI': 1118204,
  // 26/27 yeni takımları — teams tablosuna eklendikten sonra ID'leri buraya yazın:
  // 'BAF ULKU YURDU': -101, 'DEGIRMENLIK': -102, 'ASLANKOY': -103,
};

function normalize(name) {
  return name
    .replaceAll('İ', 'I').replaceAll('Ş', 'S').replaceAll('Ğ', 'G')
    .replaceAll('Ü', 'U').replaceAll('Ö', 'O').replaceAll('Ç', 'C')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}

function toKickoffIso(tarih, saat, sezon) {
  // tarih "12/09", sezon "2026/2027" -> ay >= 7 ise ilk yıl, değilse ikinci yıl
  const [d, m] = tarih.split('/').map(Number);
  const [y1, y2] = sezon.split('/').map(Number);
  const year = m >= 7 ? y1 : y2;
  const [hh, mm] = (saat || '00:00').split(':').map(Number);
  // KKTC UTC+3
  return new Date(Date.UTC(year, m - 1, d, hh - 3, mm)).toISOString();
}

async function main() {
  const ua = { 'User-Agent': 'MatcezBot/1.0 (+skor verisi; izinli kullanim)' };
  const html = await fetch(`${BASE}/canli-skor/`, { headers: ua }).then(r => r.text());
  const nonce = html.match(/canli_skor_ajax\s*=\s*{[^}]*"nonce"\s*:\s*"([a-f0-9]+)"/)?.[1];
  if (!nonce) throw new Error('nonce bulunamadı — sayfa yapısı değişmiş olabilir.');

  const resp = await fetch(`${BASE}/wp-admin/admin-ajax.php`, {
    method: 'POST',
    headers: { ...ua, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/canli-skor/` },
    body: `action=get_live_scores&nonce=${nonce}`,
  }).then(r => r.json());
  if (!resp.success) throw new Error('API success=false döndü.');

  const rows = resp.data.filter(x => x.lig_adi === LIG_ADI);
  console.log(`${LIG_ADI}: ${rows.length} maç bulundu (sezon ${rows[0]?.sezon ?? '?'}).`);

  const fixtures = [];
  const unknownTeams = new Set();
  const liveEvents = [];

  for (const x of rows) {
    const home = TEAM_MAP[normalize(x.ev_sahibi_takim)];
    const away = TEAM_MAP[normalize(x.deplasman_takim)];
    if (!home) unknownTeams.add(x.ev_sahibi_takim);
    if (!away) unknownTeams.add(x.deplasman_takim);
    if (!home || !away) continue;

    const finished = /bitti|tamamlan/i.test(x.mac_durumu);
    fixtures.push({
      id: -(2000000 + Number(x.id)),   // radyofutbol maç id'si (Sofascore id'leriyle çakışmasın)
      gw_id: Number(x.hafta_numarasi) || null,
      home_id: home, away_id: away,
      kickoff: toKickoffIso(x.mac_tarihi, x.mac_saati, x.sezon),
      home_score: x.ev_sahibi_skor == null ? null : Number(x.ev_sahibi_skor),
      away_score: x.deplasman_skor == null ? null : Number(x.deplasman_skor),
      status: finished ? 'finished' : 'scheduled',
      _durum: x.mac_durumu,
    });
    // canlı olaylar (gol/kart) — oyuncu isimleri içerirse admin eşleştirmesi için dök
    if (x.olaylar?.length) liveEvents.push({ mac: `${x.ev_sahibi_takim} - ${x.deplasman_takim}`, olaylar: x.olaylar });
  }

  if (unknownTeams.size) {
    console.warn('Eşleşmeyen takımlar (TEAM_MAP\'e ekleyin):', [...unknownTeams].join(', '));
  }

  const bundle = { fixtures: fixtures.map(({ _durum, ...f }) => f), _liveEvents: liveEvents };
  writeFileSync(new URL('./out-radyofutbol.json', import.meta.url), JSON.stringify(bundle, null, 2));
  console.log(`out-radyofutbol.json yazıldı: ${fixtures.length} maç, ${liveEvents.length} maçta canlı olay.`);
  for (const f of fixtures) console.log(' ', f.home_id, '-', f.away_id, '|', f.home_score, f.away_score, '|', f._durum ?? f.status);

  if (PUSH) {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_KEY gerekli.');
    const sb = createClient(url, key);

    // Mevcut fikstürle eşleştir: aynı hafta + aynı ev/deplasman varsa skoru GÜNCELLE,
    // yoksa yeni satır ekle. (Sofascore'dan gelen fikstürleri çiftlememek için.)
    const { data: gws } = await sb.from('gameweeks').select('id, number');
    const gwByNumber = Object.fromEntries((gws ?? []).map(g => [g.number, g.id]));
    const { data: existing } = await sb.from('fixtures').select('id, gw_id, home_id, away_id');

    for (const f of bundle.fixtures) {
      const gwId = gwByNumber[f.gw_id] ?? f.gw_id;
      if (!gwId) { console.warn('Hafta bulunamadı, atlandı:', f); continue; }
      const match = (existing ?? []).find(e =>
        e.gw_id === gwId && e.home_id === f.home_id && e.away_id === f.away_id);
      if (match) {
        const { error } = await sb.from('fixtures').update({
          home_score: f.home_score, away_score: f.away_score,
          status: f.status, kickoff: f.kickoff,
        }).eq('id', match.id);
        if (error) console.warn('güncelleme hatası:', error.message);
      } else {
        const { error } = await sb.from('fixtures').insert({ ...f, gw_id: gwId });
        if (error) console.warn('ekleme hatası:', error.message);
      }
    }
    console.log('Supabase güncellendi.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
