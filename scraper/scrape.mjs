#!/usr/bin/env node
// KKTC Süper Lig — Sofascore scraper
//
// Sofascore API'si düz HTTP isteklerini engellediği için (Cloudflare),
// Playwright ile gerçek bir tarayıcı açıp istekleri sayfa içinden yapar.
//
// Kullanım:
//   cd scraper && npm install && npx playwright install chromium
//   node scrape.mjs                    -> out.json üretir (admin panelinden "İçe Aktar" ile yükleyin)
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scrape.mjs --push
//                                      -> doğrudan Supabase'e yazar (service_role key gerekir)
//
// Ne çeker: sezonun tüm haftaları (round), maçlar + skorlar, gol olayları (normal/penaltı),
// ve veritabanında olmayan yeni oyuncuları (gol atanlardan tespit eder).
// Ne ÇEKEMEZ: kadrolar/ilk 11 (Sofascore bu ligde tutmuyor) — "Oynadı" işaretleri
// admin panelinden girilir.

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const TOURNAMENT_ID = 23800; // KTFF Süper Lig
const SEASON_ID = process.env.SEASON_ID || null; // boşsa en yeni sezon
const PUSH = process.argv.includes('--push');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  console.log('Sofascore açılıyor…');
  await page.goto('https://www.sofascore.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const api = (path) => page.evaluate(async (p) => {
    const r = await fetch('/api/v1' + p);
    if (!r.ok) return { __err: r.status };
    return r.json();
  }, path);

  // 1) Sezon
  const seasons = await api(`/unique-tournament/${TOURNAMENT_ID}/seasons`);
  if (seasons.__err) throw new Error('Sezonlar alınamadı: ' + seasons.__err);
  const season = SEASON_ID
    ? seasons.seasons.find(s => s.id === Number(SEASON_ID))
    : seasons.seasons[0];
  console.log(`Sezon: ${season.name || season.year} (id ${season.id})`);

  // 2) Haftalar ve maçlar
  const roundsData = await api(`/unique-tournament/${TOURNAMENT_ID}/season/${season.id}/rounds`);
  const rounds = roundsData.rounds?.map(r => r.round) ?? [];
  console.log(`${rounds.length} hafta bulundu.`);

  const gameweeks = [];
  const fixtures = [];
  const events = [];
  const newPlayers = new Map();
  const teamIds = new Set();

  for (const round of rounds) {
    const data = await api(`/unique-tournament/${TOURNAMENT_ID}/season/${season.id}/events/round/${round}`);
    if (data.__err || !data.events?.length) continue;

    const kickoffs = data.events.map(e => e.startTimestamp * 1000);
    gameweeks.push({
      id: round, number: round, name: `${round}. Hafta`,
      deadline: new Date(Math.min(...kickoffs) - 2 * 3600 * 1000).toISOString(),
      is_current: false, is_finished: false,
    });

    for (const ev of data.events) {
      teamIds.add(ev.homeTeam.id); teamIds.add(ev.awayTeam.id);
      const finished = ev.status?.type === 'finished';
      fixtures.push({
        id: ev.id, gw_id: round,
        home_id: ev.homeTeam.id, away_id: ev.awayTeam.id,
        kickoff: new Date(ev.startTimestamp * 1000).toISOString(),
        home_score: finished ? ev.homeScore?.current ?? null : null,
        away_score: finished ? ev.awayScore?.current ?? null : null,
        status: finished ? 'finished' : (ev.status?.type === 'postponed' ? 'postponed' : 'scheduled'),
      });

      if (finished) {
        const inc = await api(`/event/${ev.id}/incidents`);
        if (!inc.__err && inc.incidents) {
          const goalCount = new Map(); // "pid:type" -> qty
          for (const i of inc.incidents) {
            if (i.incidentType !== 'goal' || !i.player) continue;
            const type = i.incidentClass === 'penalty' ? 'pen_goal'
              : i.incidentClass === 'ownGoal' ? 'own_goal' : 'goal';
            const key = `${i.player.id}:${type}`;
            goalCount.set(key, (goalCount.get(key) ?? 0) + 1);
            const scoringTeam = i.isHome ^ (type === 'own_goal') ? ev.homeTeam.id : ev.awayTeam.id;
            newPlayers.set(i.player.id, {
              id: i.player.id, name: i.player.name,
              team_id: scoringTeam, pos: 'M', price: 5.0, pos_guess: true, active: true,
            });
          }
          for (const [key, qty] of goalCount) {
            const [pid, type] = key.split(':');
            events.push({ fixture_id: ev.id, player_id: Number(pid), event_type: type, qty });
          }
        }
        await page.waitForTimeout(400); // nazik ol
      }
    }
    console.log(`Hafta ${round}: ${data.events.length} maç işlendi.`);
    await page.waitForTimeout(400);
  }

  // 3) Takım kadroları (varsa yeni oyuncular için)
  const players = [];
  for (const tid of teamIds) {
    const d = await api(`/team/${tid}/players`);
    if (!d.__err && d.players) {
      for (const p of d.players) {
        players.push({
          id: p.player.id, name: p.player.name, team_id: tid,
          pos: ['G', 'D', 'M', 'F'].includes(p.player.position) ? p.player.position : 'M',
          price: 5.0, pos_guess: !['G', 'D', 'M', 'F'].includes(p.player.position),
          active: true,
        });
      }
    }
    await page.waitForTimeout(300);
  }
  for (const p of newPlayers.values()) {
    if (!players.some(x => x.id === p.id)) players.push(p);
  }

  await browser.close();

  const bundle = { gameweeks, fixtures, events, players };
  writeFileSync(new URL('./out.json', import.meta.url), JSON.stringify(bundle, null, 2));
  console.log(`\nout.json yazıldı: ${gameweeks.length} hafta, ${fixtures.length} maç, ${events.length} gol olayı, ${players.length} oyuncu.`);
  console.log('NOT: Yeni oyuncular varsayılan 5.0M fiyat ve tahmini pozisyonla gelir; players[] içindeki');
  console.log('mevcut oyuncuların fiyatını ezmemek için --push modunda fiyat/pozisyon güncellenmez, sadece yeni oyuncu eklenir.');

  if (PUSH) {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL ve SUPABASE_SERVICE_KEY ortam değişkenleri gerekli.');
    const sb = createClient(url, key);

    const { data: existing } = await sb.from('players').select('id');
    const existingIds = new Set((existing ?? []).map(r => r.id));
    const freshPlayers = players.filter(p => !existingIds.has(p.id));

    for (const gw of gameweeks) {
      const { error } = await sb.from('gameweeks')
        .upsert(gw, { onConflict: 'id', ignoreDuplicates: false });
      if (error) console.warn('gameweek', gw.id, error.message);
    }
    if (freshPlayers.length) {
      const { error } = await sb.from('players').insert(freshPlayers);
      if (error) console.warn('players:', error.message);
    }
    for (const chunk of chunks(fixtures, 100)) {
      const { error } = await sb.from('fixtures').upsert(chunk);
      if (error) console.warn('fixtures:', error.message);
    }
    for (const chunk of chunks(events, 200)) {
      const { error } = await sb.from('player_events')
        .upsert(chunk, { onConflict: 'fixture_id,player_id,event_type' });
      if (error) console.warn('events:', error.message);
    }
    console.log(`Supabase güncellendi (${freshPlayers.length} yeni oyuncu).`);
  }
}

function* chunks(arr, n) {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}

main().catch(err => { console.error(err); process.exit(1); });
