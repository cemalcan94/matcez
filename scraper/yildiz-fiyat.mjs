#!/usr/bin/env node
// Matcez — yıldız (1-5) puanından oyuncu fiyatı üretici
//
// Akış:
//   1) `node yildiz-fiyat.mjs --sablon`  -> yildiz-sablonu.csv üretir
//      (uzman arkadaşınız her oyuncuya 1-5 arası yıldız verir; boş bırakılan = 2 sayılır)
//   2) Doldurulan dosyayı yildiz-dolu.csv adıyla bu klasöre koyun
//   3) `node yildiz-fiyat.mjs`           -> out-fiyatlar.json üretir
//      (Admin > İçe Aktar ile yüklenir; oyuncu fiyatları güncellenir)
//
// Fiyat formülü (mevkiye ve yıldıza göre, milyon):
//   Hücum mevkileri daha pahalıdır (gol puanı düşük ama gol olasılığı yüksek);
//   toplam bütçe dengesi: 15 kişilik ortalama kadro ~%85-95 bütçe kullanmalı.
const PRICE = {
  //        1★   2★   3★   4★   5★
  G: [null, 4.0, 4.5, 5.0, 5.5, 6.5],
  D: [null, 4.0, 4.5, 5.5, 6.5, 7.5],
  M: [null, 4.5, 5.0, 6.0, 7.5, 9.0],
  F: [null, 4.5, 5.5, 6.5, 8.0, 9.5],
};

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { TEAMS, PLAYERS } from '../js/seed-data.js';

const tm = new Map(TEAMS.map(t => [t.id, t]));

if (process.argv.includes('--sablon')) {
  const rows = [...PLAYERS]
    .sort((a, b) => (a.teamId - b.teamId) || a.name.localeCompare(b.name, 'tr'))
    .map(p => `${p.id};${tm.get(p.teamId)?.name ?? p.teamId};${p.name};${p.pos};`);
  const csv = 'id;takim;oyuncu;pozisyon;yildiz(1-5)\n' + rows.join('\n') + '\n';
  writeFileSync(new URL('./yildiz-sablonu.csv', import.meta.url), '﻿' + csv);
  console.log(`yildiz-sablonu.csv yazıldı (${PLAYERS.length} oyuncu). Excel'de açılabilir (UTF-8 BOM'lu, ; ayraçlı).`);
  process.exit(0);
}

const src = new URL('./yildiz-dolu.csv', import.meta.url);
if (!existsSync(src)) {
  console.error('yildiz-dolu.csv bulunamadı. Önce `node yildiz-fiyat.mjs --sablon` ile şablonu üretin,');
  console.error('doldurun ve "yildiz-dolu.csv" adıyla bu klasöre kaydedin.');
  process.exit(1);
}

const lines = readFileSync(src, 'utf8').replace(/^﻿/, '').split('\n').slice(1).filter(Boolean);
const out = [];
let stats = { toplam: 0, bos: 0, hatali: 0 };
for (const line of lines) {
  const [id, , , , yildizRaw] = line.split(';').map(s => s?.trim());
  const p = PLAYERS.find(x => x.id === Number(id));
  if (!p) { stats.hatali++; continue; }
  let yildiz = Number(yildizRaw);
  if (!yildizRaw) { yildiz = 2; stats.bos++; }           // boş = sıradan oyuncu
  if (!(yildiz >= 1 && yildiz <= 5)) { stats.hatali++; continue; }
  out.push({ id: p.id, team_id: p.teamId, name: p.name, pos: p.pos,
             price: PRICE[p.pos][Math.round(yildiz)], pos_guess: p.posGuess, active: true });
  stats.toplam++;
}

writeFileSync(new URL('./out-fiyatlar.json', import.meta.url), JSON.stringify({ players: out }, null, 2));
console.log(`out-fiyatlar.json yazıldı: ${stats.toplam} oyuncu fiyatlandı (${stats.bos} boş→2★, ${stats.hatali} hatalı satır atlandı).`);
console.log('Admin > İçe Aktar sekmesine yapıştırın veya Supabase canlıysa içe aktarın.');
const dagilim = {};
out.forEach(p => { dagilim[p.price] = (dagilim[p.price] ?? 0) + 1; });
console.log('Fiyat dağılımı:', Object.entries(dagilim).sort((a,b)=>a[0]-b[0]).map(([f,n])=>`${f}M×${n}`).join('  '));
