// Puan motoru — supabase/schema.sql içindeki compute_gw_points ile aynı kurallar.
// Demo modunda ve oyuncu puan dökümü gösterirken kullanılır.

export const EVENT_LABELS = {
  played: 'Maça çıkma', goal: 'Gol', pen_goal: 'Penaltı golü', assist: 'Asist',
  yellow: 'Sarı kart', red: 'Kırmızı kart', own_goal: 'Kendi kalesine',
  motm: 'Maçın oyuncusu', clean_sheet: 'Gol yememe',
};

const GOAL_PTS = { G: 10, D: 6, M: 5, F: 4 };

export function eventPoints(type, pos, qty = 1) {
  switch (type) {
    case 'played': return 2 * qty;
    case 'goal':
    case 'pen_goal': return GOAL_PTS[pos] * qty;
    case 'assist': return 3 * qty;
    case 'yellow': return -1 * qty;
    case 'red': return -3 * qty;
    case 'own_goal': return -2 * qty;
    case 'motm': return 3 * qty;
    case 'clean_sheet': return (pos === 'G' || pos === 'D') ? 4 : (pos === 'M' ? 1 : 0);
    default: return 0;
  }
}

// events: [{fixture_id, player_id, event_type, qty}] (sadece ilgili haftanın maçları)
// fixtures: ilgili haftanın maçları; players: tüm oyuncular
// Dönüş: Map(playerId -> {pts, breakdown: [{type, qty, pts}], played})
export function playerPointsForGW(events, fixtures, players) {
  const playerById = new Map(players.map(p => [p.id, p]));
  const fixtureById = new Map(fixtures.map(f => [f.id, f]));
  const out = new Map();

  const get = (pid) => {
    if (!out.has(pid)) out.set(pid, { pts: 0, breakdown: [], played: false });
    return out.get(pid);
  };

  for (const ev of events) {
    const pl = playerById.get(ev.player_id);
    if (!pl || !fixtureById.has(ev.fixture_id)) continue;
    const qty = ev.qty ?? 1;
    const pts = eventPoints(ev.event_type, pl.pos, qty);
    const rec = get(ev.player_id);
    rec.pts += pts;
    rec.breakdown.push({ type: ev.event_type, qty, pts });
    if (ev.event_type === 'played') rec.played = true;
  }

  // Gol yememe: oynadı + takımı gol yemeden bitirdi
  for (const ev of events) {
    if (ev.event_type !== 'played') continue;
    const pl = playerById.get(ev.player_id);
    const fx = fixtureById.get(ev.fixture_id);
    if (!pl || !fx || fx.status !== 'finished') continue;
    const conceded = pl.teamId === fx.home_id ? fx.away_score : pl.teamId === fx.away_id ? fx.home_score : null;
    if (conceded === 0) {
      const pts = eventPoints('clean_sheet', pl.pos);
      if (pts > 0) {
        const rec = get(ev.player_id);
        rec.pts += pts;
        rec.breakdown.push({ type: 'clean_sheet', qty: 1, pts });
      }
    }
  }
  return out;
}

// picks: [{slot, player_id, is_captain, is_vice}] — slot 1-11 ilk 11, 12-15 yedek
// playerPts: playerPointsForGW çıktısı; players: pozisyon için
// opts.chip: o hafta oynanan koz (bench_boost / triple_captain / wildcard / free_hit / null)
// Dönüş: {total, rows: [{player_id, pts, doubled, subbedInFor}]}
export function userPointsForGW(picks, playerPts, players, opts = {}) {
  const chip = opts.chip ?? null;
  const playerById = new Map(players.map(p => [p.id, p]));
  const played = (pid) => playerPts.get(pid)?.played ?? false;
  const pts = (pid) => playerPts.get(pid)?.pts ?? 0;

  const starters = picks.filter(p => p.slot <= 11).sort((a, b) => a.slot - b.slot);
  const bench = picks.filter(p => p.slot > 11).sort((a, b) => a.slot - b.slot);

  let effective;
  if (chip === 'bench_boost') {
    // Bench Boost: 15 oyuncunun tamamı sayılır, oto-yedek yok
    effective = [...starters, ...bench].map(s => ({ ...s, eff: s.player_id }));
  } else {
    // Basit oto-yedek: oynamayan ilk-11 yerine bench sırasındaki ilk oynayan uygun yedek
    const usedBench = new Set();
    effective = starters.map(s => {
      if (played(s.player_id)) return { ...s, eff: s.player_id };
      const sPos = playerById.get(s.player_id)?.pos;
      const sub = bench.find(b => {
        if (usedBench.has(b.player_id) || !played(b.player_id)) return false;
        const bPos = playerById.get(b.player_id)?.pos;
        return sPos === 'G' ? bPos === 'G' : bPos !== 'G';
      });
      if (sub) { usedBench.add(sub.player_id); return { ...s, eff: sub.player_id, subbedInFor: s.player_id }; }
      return { ...s, eff: s.player_id };
    });
  }

  // Kaptan çarpanı (Triple Captain: x3); kaptan oynamadıysa vekil devralır
  const mult = chip === 'triple_captain' ? 3 : 2;
  const capRow = effective.find(e => e.is_captain);
  const viceRow = effective.find(e => e.is_vice);
  let capId = null;
  if (capRow && played(capRow.eff)) capId = capRow.eff;
  else if (viceRow && played(viceRow.eff)) capId = viceRow.eff;

  let total = 0;
  const rows = effective.map(e => {
    const base = pts(e.eff);
    const doubled = e.eff === capId;
    const rowPts = base * (doubled ? mult : 1);
    total += rowPts;
    return { pick: e, player_id: e.eff, pts: rowPts, doubled, subbedInFor: e.subbedInFor };
  });
  return { total, rows };
}

// Transfer bilgisi: referans kadro (bir önceki haftanın kadrosu, Free Hit haftaları atlanır)
// ile karşılaştırıp yapılan transferi ve puan cezasını hesaplar.
// gws: tüm haftalar; picksByGwId: {gwId: [player_id,...]}; chipsRows: [{gw_id, chip}]
export function calcTransferInfo({ gws, gwId, picksByGwId, chipsRows, ids, freePerGw, hitCost }) {
  const gw = gws.find(g => g.id === gwId);
  const chip = chipsRows.find(c => c.gw_id === gwId)?.chip ?? null;
  if (!gw) return { first: true, used: 0, hit: 0, chip, waived: false };
  const below = gws.filter(g => g.number < gw.number).sort((a, b) => b.number - a.number);
  let refIds = null;
  for (const g of below) {
    if (chipsRows.some(c => c.gw_id === g.id && c.chip === 'free_hit')) continue;
    const p = picksByGwId[g.id];
    if (p?.length) { refIds = p; break; }
  }
  if (!refIds) return { first: true, used: 0, hit: 0, chip, waived: false };
  const used = ids.filter(id => !refIds.includes(id)).length;
  const waived = chip === 'wildcard' || chip === 'free_hit';
  const hit = waived ? 0 : Math.max(0, used - freePerGw) * hitCost;
  return { first: false, used, hit, chip, waived };
}

// Kadro doğrulama (kayıttan önce)
export function validateSquad(picks, players, rules) {
  const playerById = new Map(players.map(p => [p.id, p]));
  const errors = [];
  if (picks.length !== rules.squadSize) errors.push(`Kadro ${rules.squadSize} oyuncudan oluşmalı (şu an ${picks.length}).`);

  const posCount = { G: 0, D: 0, M: 0, F: 0 };
  const teamCount = {};
  let cost = 0;
  for (const pk of picks) {
    const pl = playerById.get(pk.player_id);
    if (!pl) continue;
    posCount[pl.pos]++;
    teamCount[pl.teamId] = (teamCount[pl.teamId] || 0) + 1;
    cost += pl.price;
  }
  for (const pos of Object.keys(rules.slots)) {
    if (posCount[pos] !== rules.slots[pos]) errors.push(`${pos} pozisyonunda ${rules.slots[pos]} oyuncu olmalı (şu an ${posCount[pos]}).`);
  }
  for (const [tid, n] of Object.entries(teamCount)) {
    if (n > rules.maxPerTeam) errors.push(`Aynı takımdan en fazla ${rules.maxPerTeam} oyuncu seçilebilir.`);
  }
  if (cost > rules.budget + 1e-9) errors.push(`Bütçe aşıldı: ${cost.toFixed(1)} / ${rules.budget.toFixed(1)}M.`);

  const starters = picks.filter(p => p.slot <= 11);
  if (starters.length === 11) {
    const sc = { G: 0, D: 0, M: 0, F: 0 };
    starters.forEach(p => { const pl = playerById.get(p.player_id); if (pl) sc[pl.pos]++; });
    for (const pos of ['G', 'D', 'M', 'F']) {
      if (sc[pos] < rules.formationMin[pos]) errors.push(`İlk 11'de en az ${rules.formationMin[pos]} ${pos} olmalı.`);
      if (sc[pos] > rules.formationMax[pos]) errors.push(`İlk 11'de en fazla ${rules.formationMax[pos]} ${pos} olabilir.`);
    }
  }
  const caps = picks.filter(p => p.is_captain).length;
  const vices = picks.filter(p => p.is_vice).length;
  if (caps !== 1) errors.push('Bir kaptan seçilmeli.');
  if (vices !== 1) errors.push('Bir kaptan vekili seçilmeli.');
  return { ok: errors.length === 0, errors, cost };
}
