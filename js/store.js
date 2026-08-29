// Veri katmanı: Supabase yapılandırılmışsa gerçek backend, yoksa DEMO (localStorage).
import { SUPABASE_URL, SUPABASE_ANON_KEY, TRANSFERS } from './config.js';
import { TEAMS, PLAYERS } from './seed-data.js';
import { playerPointsForGW, userPointsForGW, calcTransferInfo } from './points.js';

const LS_KEY = 'fkktc_demo_v2'; // v2: gerçek forma renkleri (eski demo verisi sıfırlanır)

// ---------------- DEMO STORE ----------------
function nextSaturday(offsetWeeks = 0) {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7) + offsetWeeks * 7);
  d.setHours(13, 0, 0, 0);
  return d.toISOString();
}

function demoSeed() {
  const gameweeks = [1, 2, 3].map(n => ({
    id: n, number: n, name: `${n}. Hafta`, deadline: nextSaturday(n - 1),
    is_current: n === 1, is_finished: false,
  }));
  // 1. hafta için örnek fikstür: 25/26 sıralamasına göre eşleştirme
  const fixtures = [];
  for (let i = 0; i < 8; i++) {
    fixtures.push({
      id: -(100 + i), gw_id: 1,
      home_id: TEAMS[i].id, away_id: TEAMS[15 - i].id,
      kickoff: nextSaturday(0), home_score: null, away_score: null, status: 'scheduled',
    });
  }
  return {
    profile: { id: 'demo', username: 'demo', team_name: 'Demo XI', is_admin: true },
    teams: TEAMS.map(t => ({ ...t })),
    players: PLAYERS.map(p => ({ ...p, pos_guess: p.posGuess })),
    gameweeks, fixtures, events: [],
    picks: {}, gwPoints: [], chips: [],
    leagues: [{ id: 1, code: 'DEMO01', name: 'Arkadaş Ligi (Demo)', owner_id: 'demo' }],
    leagueMembers: [{ league_id: 1, user_id: 'demo' }],
    bots: [
      { id: 'bot1', username: 'girne_aslani', team_name: 'Girne Aslanları' },
      { id: 'bot2', username: 'magusa_firtinasi', team_name: 'Mağusa Fırtınası' },
      { id: 'bot3', username: 'lefkosa_kralı', team_name: 'Lefkoşa Kralları' },
      { id: 'bot4', username: 'iskele_gucu', team_name: 'İskele Gücü' },
    ],
  };
}

function demoStore() {
  let db = null;
  const load = () => {
    if (db) return db;
    try { db = JSON.parse(localStorage.getItem(LS_KEY)); } catch { db = null; }
    if (!db) { db = demoSeed(); save(); }
    return db;
  };
  const save = () => localStorage.setItem(LS_KEY, JSON.stringify(db));

  return {
    mode: 'demo',
    async init() { load(); },
    user() { return { id: 'demo', email: 'demo@fantazikktc.app' }; },
    profile() { return load().profile; },
    async signIn() { }, async signUp() { }, async signOut() {
      localStorage.removeItem(LS_KEY); db = null; location.reload();
    },
    async resetPassword() { }, async updatePassword() { },
    async updateProfile(patch) { Object.assign(load().profile, patch); save(); },

    async teams() { return [...load().teams].sort((a, b) => a.name.localeCompare(b.name, 'tr')); },
    async players() { return load().players; },
    async gameweeks() { return [...load().gameweeks].sort((a, b) => a.number - b.number); },
    async fixtures(gwId = null) {
      const all = load().fixtures;
      return gwId == null ? all : all.filter(f => f.gw_id === gwId);
    },
    async events(gwId) {
      const fxIds = new Set((await this.fixtures(gwId)).map(f => f.id));
      return load().events.filter(e => fxIds.has(e.fixture_id));
    },

    async picks(gwId, userId = 'demo') {
      return (load().picks[`${userId}:${gwId}`] || []).map(p => ({ ...p }));
    },
    async savePicks(gwId, picksArr) {
      load().picks[`demo:${gwId}`] = picksArr.map(p => ({ ...p, user_id: 'demo', gw_id: gwId }));
      save();
    },

    async allMyPicks(userId = 'demo') {
      const d = load();
      const out = [];
      for (const [key, rows] of Object.entries(d.picks)) {
        if (key.startsWith(`${userId}:`)) out.push(...rows);
      }
      return out;
    },
    async myChips() { return (load().chips ?? []).filter(c => c.user_id === 'demo'); },
    async playChip(gwId, chip) {
      const d = load();
      d.chips ??= [];
      if (d.chips.some(c => c.user_id === 'demo' && c.gw_id === gwId))
        throw new Error('Bu hafta zaten bir koz oynadın.');
      if (d.chips.some(c => c.user_id === 'demo' && c.chip === chip))
        throw new Error('Bu kozu bu sezon zaten kullandın.');
      d.chips.push({ user_id: 'demo', gw_id: gwId, chip });
      save();
    },
    async cancelChip(gwId) {
      const d = load();
      d.chips = (d.chips ?? []).filter(c => !(c.user_id === 'demo' && c.gw_id === gwId));
      save();
    },

    async gwPoints() { return load().gwPoints; },
    async standings() {
      const d = load();
      const users = [d.profile, ...d.bots];
      const totals = users.map(u => ({
        user_id: u.id, username: u.username, team_name: u.team_name,
        total_points: d.gwPoints.filter(g => g.user_id === u.id).reduce((s, g) => s + g.points, 0),
      }));
      return totals.sort((a, b) => b.total_points - a.total_points);
    },

    async myLeagues() {
      const d = load();
      const mine = d.leagueMembers.filter(m => m.user_id === 'demo').map(m => m.league_id);
      return d.leagues.filter(l => mine.includes(l.id));
    },
    async createLeague(name) {
      const d = load();
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const league = { id: Date.now(), code, name, owner_id: 'demo' };
      d.leagues.push(league);
      d.leagueMembers.push({ league_id: league.id, user_id: 'demo' });
      save(); return league;
    },
    async joinLeague(code) {
      const d = load();
      const league = d.leagues.find(l => l.code === code.toUpperCase());
      if (!league) throw new Error('Bu kodla bir lig bulunamadı.');
      if (!d.leagueMembers.some(m => m.league_id === league.id && m.user_id === 'demo'))
        d.leagueMembers.push({ league_id: league.id, user_id: 'demo' });
      save(); return league;
    },
    async leagueStandings(leagueId) {
      const d = load();
      const memberIds = d.leagueMembers.filter(m => m.league_id === leagueId).map(m => m.user_id);
      return (await this.standings()).filter(r => memberIds.includes(r.user_id));
    },

    // ---- admin ----
    async upsertTeams(rows) {
      const d = load();
      for (const r of rows) {
        const i = d.teams.findIndex(t => t.id === r.id);
        if (i >= 0) Object.assign(d.teams[i], r); else d.teams.push(r);
      }
      save();
    },
    async upsertPlayers(rows) {
      const d = load();
      for (const r of rows) {
        const i = d.players.findIndex(p => p.id === r.id);
        if (i >= 0) Object.assign(d.players[i], r); else d.players.push(r);
      }
      save();
    },
    async upsertGameweek(gw) {
      const d = load();
      const i = d.gameweeks.findIndex(g => g.id === gw.id);
      if (gw.is_current) d.gameweeks.forEach(g => g.is_current = false);
      if (i >= 0) Object.assign(d.gameweeks[i], gw);
      else d.gameweeks.push({ ...gw, id: gw.id ?? Math.max(0, ...d.gameweeks.map(g => g.id)) + 1 });
      save();
    },
    async upsertFixture(fx) {
      const d = load();
      const i = d.fixtures.findIndex(f => f.id === fx.id);
      if (i >= 0) Object.assign(d.fixtures[i], fx);
      else d.fixtures.push({ ...fx, id: fx.id ?? -Date.now() });
      save();
    },
    async saveFixtureEvents(fixtureId, rows) {
      const d = load();
      d.events = d.events.filter(e => e.fixture_id !== fixtureId);
      d.events.push(...rows.map(r => ({ ...r, fixture_id: fixtureId })));
      save();
    },
    async computePoints(gwId) {
      const d = load();
      const fixtures = d.fixtures.filter(f => f.gw_id === gwId);
      const events = d.events.filter(e => fixtures.some(f => f.id === e.fixture_id));
      const pp = playerPointsForGW(events, fixtures, d.players);
      const users = [d.profile, ...d.bots];
      d.gwPoints = d.gwPoints.filter(g => g.gw_id !== gwId);
      for (const u of users) {
        let pts;
        if (u.id === 'demo') {
          const picks = d.picks[`demo:${gwId}`] || [];
          const chip = (d.chips ?? []).find(c => c.user_id === 'demo' && c.gw_id === gwId)?.chip ?? null;
          pts = picks.length ? userPointsForGW(picks, pp, d.players, { chip }).total : 0;
          // transfer cezası
          if (picks.length) {
            const picksByGwId = {};
            for (const [key, rows] of Object.entries(d.picks)) {
              if (!key.startsWith('demo:')) continue;
              picksByGwId[Number(key.split(':')[1])] = rows.map(r => r.player_id);
            }
            const info = calcTransferInfo({
              gws: d.gameweeks, gwId, picksByGwId,
              chipsRows: (d.chips ?? []).filter(c => c.user_id === 'demo'),
              ids: picks.map(r => r.player_id),
              freePerGw: TRANSFERS.freePerGw, hitCost: TRANSFERS.hitCost,
            });
            pts -= info.hit;
          }
        } else {
          pts = 25 + (gwId * 7 + u.id.charCodeAt(3) * 13) % 45; // botlara deterministik puan
        }
        d.gwPoints.push({ user_id: u.id, gw_id: gwId, points: pts });
      }
      const gw = d.gameweeks.find(g => g.id === gwId);
      if (gw) gw.is_finished = true;
      save();
      return users.length;
    },
    async importBundle(bundle) {
      if (bundle.teams?.length) await this.upsertTeams(bundle.teams);
      if (bundle.players?.length) await this.upsertPlayers(bundle.players);
      if (bundle.gameweeks?.length) for (const g of bundle.gameweeks) await this.upsertGameweek(g);
      if (bundle.fixtures?.length) for (const f of bundle.fixtures) await this.upsertFixture(f);
      if (bundle.events?.length) {
        const byFx = {};
        bundle.events.forEach(e => { (byFx[e.fixture_id] ??= []).push(e); });
        for (const [fxId, rows] of Object.entries(byFx)) await this.saveFixtureEvents(Number(fxId), rows);
      }
    },
  };
}

// ---------------- SUPABASE STORE ----------------
function supaStore(client) {
  let _user = null, _profile = null;

  const throwIf = (error) => { if (error) throw new Error(error.message); };

  return {
    mode: 'supabase',
    client,
    async init() {
      const { data } = await client.auth.getSession();
      _user = data.session?.user ?? null;
      if (_user) await this._loadProfile();
      client.auth.onAuthStateChange(async (ev, session) => {
        _user = session?.user ?? null;
        _profile = null;
        if (_user) await this._loadProfile();
        if (ev === 'PASSWORD_RECOVERY') location.hash = '#/sifre-yenile';
        window.dispatchEvent(new Event('auth-changed'));
      });
    },
    async _loadProfile() {
      const { data } = await client.from('profiles').select('*').eq('id', _user.id).single();
      _profile = data;
    },
    user() { return _user; },
    profile() { return _profile; },

    async signUp(email, password, username, teamName) {
      const { error } = await client.auth.signUp({
        email, password,
        options: { data: { username, team_name: teamName } },
      });
      throwIf(error);
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      throwIf(error);
    },
    async signOut() { await client.auth.signOut(); },
    async resetPassword(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      throwIf(error);
    },
    async updatePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword });
      throwIf(error);
    },
    async updateProfile(patch) {
      const { error } = await client.from('profiles').update(patch).eq('id', _user.id);
      throwIf(error);
      await this._loadProfile();
    },

    async teams() {
      const { data, error } = await client.from('teams').select('*').order('name');
      throwIf(error); return data;
    },
    async players() {
      const { data, error } = await client.from('players').select('*').eq('active', true);
      throwIf(error);
      return data.map(p => ({ ...p, teamId: p.team_id, price: Number(p.price) }));
    },
    async gameweeks() {
      const { data, error } = await client.from('gameweeks').select('*').order('number');
      throwIf(error); return data;
    },
    async fixtures(gwId = null) {
      let q = client.from('fixtures').select('*').order('kickoff');
      if (gwId != null) q = q.eq('gw_id', gwId);
      const { data, error } = await q; throwIf(error); return data;
    },
    async events(gwId) {
      const fx = await this.fixtures(gwId);
      if (!fx.length) return [];
      const { data, error } = await client.from('player_events')
        .select('*').in('fixture_id', fx.map(f => f.id));
      throwIf(error); return data;
    },

    async picks(gwId, userId = null) {
      const uid = userId ?? _user?.id;
      if (!uid) return [];
      const { data, error } = await client.from('picks')
        .select('*').eq('user_id', uid).eq('gw_id', gwId).order('slot');
      throwIf(error); return data;
    },
    async savePicks(gwId, picksArr) {
      const { error: delErr } = await client.from('picks')
        .delete().eq('user_id', _user.id).eq('gw_id', gwId);
      throwIf(delErr);
      const rows = picksArr.map(p => ({
        user_id: _user.id, gw_id: gwId, player_id: p.player_id,
        slot: p.slot, is_captain: p.is_captain, is_vice: p.is_vice,
      }));
      const { error } = await client.from('picks').insert(rows);
      throwIf(error);
    },

    async allMyPicks(userId = null) {
      const uid = userId ?? _user?.id;
      if (!uid) return [];
      const { data, error } = await client.from('picks')
        .select('gw_id, player_id, slot, is_captain, is_vice').eq('user_id', uid);
      throwIf(error); return data;
    },
    async myChips() {
      if (!_user) return [];
      const { data, error } = await client.from('chips').select('*').eq('user_id', _user.id);
      throwIf(error); return data;
    },
    async playChip(gwId, chip) {
      const { error } = await client.from('chips')
        .insert({ user_id: _user.id, gw_id: gwId, chip });
      if (error) {
        if (error.message.includes('chips_user_id_gw_id')) throw new Error('Bu hafta zaten bir koz oynadın.');
        if (error.message.includes('chips_user_id_chip')) throw new Error('Bu kozu bu sezon zaten kullandın.');
        throw new Error(error.message);
      }
    },
    async cancelChip(gwId) {
      const { error } = await client.from('chips')
        .delete().eq('user_id', _user.id).eq('gw_id', gwId);
      throwIf(error);
    },

    async gwPoints() {
      const { data, error } = await client.from('gw_points').select('*');
      throwIf(error); return data;
    },
    async standings() {
      const { data, error } = await client.from('standings').select('*');
      throwIf(error); return data;
    },

    async myLeagues() {
      if (!_user) return [];
      const { data, error } = await client.from('league_members')
        .select('league_id, leagues(id, code, name, owner_id)').eq('user_id', _user.id);
      throwIf(error);
      return data.map(r => r.leagues);
    },
    async createLeague(name) {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const { data, error } = await client.from('leagues')
        .insert({ code, name, owner_id: _user.id }).select().single();
      throwIf(error);
      await client.from('league_members').insert({ league_id: data.id, user_id: _user.id });
      return data;
    },
    async joinLeague(code) {
      const { data, error } = await client.from('leagues').select('*').eq('code', code.toUpperCase()).single();
      if (error || !data) throw new Error('Bu kodla bir lig bulunamadı.');
      const { error: e2 } = await client.from('league_members')
        .insert({ league_id: data.id, user_id: _user.id });
      if (e2 && !e2.message.includes('duplicate')) throw new Error(e2.message);
      return data;
    },
    async leagueStandings(leagueId) {
      const { data, error } = await client.from('league_members')
        .select('user_id').eq('league_id', leagueId);
      throwIf(error);
      const ids = data.map(r => r.user_id);
      return (await this.standings()).filter(r => ids.includes(r.user_id));
    },

    // ---- admin ----
    async upsertTeams(rows) {
      const { error } = await client.from('teams').upsert(rows); throwIf(error);
    },
    async upsertPlayers(rows) {
      const clean = rows.map(({ id, name, pos, price, active, pos_guess, teamId, team_id }) => ({
        id, name, pos, price, team_id: team_id ?? teamId,
        pos_guess: pos_guess ?? false, active: active ?? true,
      }));
      const { error } = await client.from('players').upsert(clean); throwIf(error);
    },
    async upsertGameweek(gw) {
      if (gw.is_current) await client.from('gameweeks').update({ is_current: false }).neq('id', gw.id ?? -1);
      const { error } = await client.from('gameweeks').upsert(gw); throwIf(error);
    },
    async upsertFixture(fx) {
      const { error } = await client.from('fixtures').upsert(fx); throwIf(error);
    },
    async saveFixtureEvents(fixtureId, rows) {
      const { error: delErr } = await client.from('player_events').delete().eq('fixture_id', fixtureId);
      throwIf(delErr);
      if (rows.length) {
        const { error } = await client.from('player_events')
          .insert(rows.map(r => ({ ...r, fixture_id: fixtureId })));
        throwIf(error);
      }
    },
    async computePoints(gwId) {
      const { data, error } = await client.rpc('compute_gw_points', { p_gw: gwId });
      throwIf(error); return data;
    },
    async importBundle(bundle) {
      if (bundle.teams?.length) await this.upsertTeams(bundle.teams);
      if (bundle.players?.length) await this.upsertPlayers(bundle.players);
      if (bundle.gameweeks?.length) for (const g of bundle.gameweeks) await this.upsertGameweek(g);
      if (bundle.fixtures?.length) for (const f of bundle.fixtures) await this.upsertFixture(f);
      if (bundle.events?.length) {
        const byFx = {};
        bundle.events.forEach(e => { (byFx[e.fixture_id] ??= []).push(e); });
        for (const [fxId, rows] of Object.entries(byFx)) await this.saveFixtureEvents(Number(fxId), rows);
      }
    },
  };
}

// ---------------- FACTORY ----------------
export async function createStore() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const s = supaStore(client);
    await s.init();
    return s;
  }
  const s = demoStore();
  await s.init();
  return s;
}
