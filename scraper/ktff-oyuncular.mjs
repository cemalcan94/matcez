#!/usr/bin/env node
// KTFF Bilgi Bankası — AKSA Süper Lig lisanslı oyuncu listesi çekici
//
// Kaynak: ktff.org/BilgiBankasi/Futbolcular (L_ID=163 → AKSA Süper Lig, Durum=1 → aktif)
// Bu, 26/27 sezonunun RESMİ lisans listesidir. Lisanslar sezon başına kadar peyderpey
// girilir — sezon yaklaştıkça bu script'i yeniden çalıştırıp listeyi güncelleyin.
//
// Not: Listede pozisyon bilgisi YOKTUR; yeni oyuncular 'M' + pos_guess=true olarak
// üretilir, pozisyonlar admin panelinden düzeltilir.
//
// Kullanım:  node ktff-oyuncular.mjs   -> ktff-oyuncular.json (ham liste) üretir
//            ve mevcut seed ile isim karşılaştırması raporlar.

import { writeFileSync } from 'node:fs';
import { TEAMS, PLAYERS } from '../js/seed-data.js';

const BASE = 'http://www.ktff.org/BilgiBankasi/Futbolcular?LisansNo=0&OyuncuAd%C4%B1=&OyuncuSoyad%C4%B1=&K_ID=&L_ID=163&Durum=1';

// KTFF kulüp adı -> bizim teams.id (yeni takımlar eklendikçe güncellenir)
const CLUB_MAP = {
  'China Bazaar Gençlik Gücü TSK': 930682,
  'Çetinkaya TSK': 930675,
  'Yenicami AK': 277956,
  'Küçük Kaymaklı TSK': 1118203,
  'Cihangir GSK': 280558,
  'Mağusa Türk Gücü': 277539,
  'Esentepe KSKK': 930673,
  'Doğan Türk Birliği': 930680,
  'Dumlupınar TSK': 930681,
  'Alsancak Yeşilova SK': 277538,
  'Mesarya SK': 930677,
  'Karşıyaka SK': 930679,
  // 26/27 yeni takımları — teams tablosuna eklenince ID yazın:
  // 'Baf Ülkü Yurdu': ?, 'Değirmenlik SK': ?, 'Aslanköy GSD': ?,
};

const deent = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/&uuml;/g, 'ü').replace(/&Uuml;/g, 'Ü').replace(/&ouml;/g, 'ö')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

async function fetchPage(page) {
  const url = BASE + (page > 1 ? `&page=${page}` : '');
  const res = await fetch(url, { headers: { 'User-Agent': 'MatcezBot/1.0' } });
  return res.text();
}

function parseRows(html) {
  const out = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(m => deent(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    if (cells.length >= 7 && /^\d{4,7}$/.test(cells[0])) {
      out.push({ lisans: cells[0], ad: cells[1], soyad: cells[2], dogum: cells[3], kulup: cells[4] });
    }
  }
  return out;
}

const norm = (s) => s.toLocaleUpperCase('tr').replace(/\s+/g, ' ').trim();

async function main() {
  const players = [];
  let page = 1;
  for (;;) {
    const html = await fetchPage(page);
    const rows = parseRows(html);
    if (!rows.length) break;
    players.push(...rows);
    const maxPage = Math.max(1, ...[...html.matchAll(/page=(\d+)/g)].map(m => Number(m[1])));
    if (page >= maxPage) break;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  writeFileSync(new URL('./ktff-oyuncular.json', import.meta.url), JSON.stringify(players, null, 2));
  console.log(`${players.length} lisanslı oyuncu çekildi (${page} sayfa).`);

  // kulüp dağılımı
  const byClub = {};
  for (const p of players) (byClub[p.kulup] ??= []).push(p);
  for (const [k, v] of Object.entries(byClub).sort((a, b) => b[1].length - a[1].length)) {
    console.log(String(v.length).padStart(4), ' ', k, CLUB_MAP[k] ? '' : '  << CLUB_MAP eşleşmesi yok');
  }

  // seed ile isim karşılaştırması
  const seedNames = new Set(PLAYERS.map(p => norm(p.name)));
  const yeni = players.filter(p => !seedNames.has(norm(`${p.ad} ${p.soyad}`)));
  console.log(`\nSeed'de olmayan (yeni/transfer) oyuncu: ${yeni.length}/${players.length}`);
  for (const p of yeni.slice(0, 20)) console.log('  +', p.ad, p.soyad, '·', p.kulup);
  if (yeni.length > 20) console.log(`  … ve ${yeni.length - 20} tane daha (ktff-oyuncular.json)`);

  // içe aktarılabilir taslak (yalnızca CLUB_MAP'te olan kulüpler)
  const bundle = {
    players: yeni.filter(p => CLUB_MAP[p.kulup]).map((p, i) => ({
      id: -(3000000 + Number(p.lisans)),   // KTFF lisans no'dan türetilmiş ID
      name: `${p.ad.charAt(0)}${p.ad.slice(1).toLocaleLowerCase('tr')} ${p.soyad.charAt(0)}${p.soyad.slice(1).toLocaleLowerCase('tr')}`,
      team_id: CLUB_MAP[p.kulup],
      pos: 'M', price: 5.0, pos_guess: true, active: true,
    })),
  };
  writeFileSync(new URL('./out-ktff-yeni-oyuncular.json', import.meta.url), JSON.stringify(bundle, null, 2));
  console.log(`\nout-ktff-yeni-oyuncular.json yazıldı (${bundle.players.length} oyuncu) — Admin > İçe Aktar ile yüklenebilir.`);
}

main().catch(err => { console.error(err); process.exit(1); });
