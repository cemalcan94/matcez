import { App, toast, fmtDate, esc, setActionBar, setHead, mustLogin } from './app.js';
import { RULES, POS_NAMES, POS_ORDER, TRANSFERS, CHIPS } from './config.js';
import { playerPointsForGW, userPointsForGW, validateSquad, EVENT_LABELS, calcTransferInfo } from './points.js';
import { jersey } from './jersey.js';

const DRAFT_KEY = 'matcez_draft_v1';

// ---------------- ortak durum ----------------
async function loadCtx() {
  const store = App.store;
  const [gws, teams, players] = await Promise.all([
    store.gameweeks(), store.teams(), store.players(),
  ]);
  const now = new Date();
  const chips = store.user() ? await store.myChips() : [];
  const editableGw = gws.find(g => new Date(g.deadline) > now) ?? null;
  // Bay tespiti: o haftanın fikstüründe yer almayan takımlar (15 takımlı ligde her hafta 1 takım)
  const gwFixtures = editableGw ? await store.fixtures(editableGw.id) : [];
  const byeSet = new Set();
  if (gwFixtures.length) {
    const playing = new Set(gwFixtures.flatMap(f => [f.home_id, f.away_id]));
    for (const t of teams) if (!playing.has(t.id)) byeSet.add(t.id);
  }
  return {
    store, gws, teams, players, chips, byeSet,
    tm: new Map(teams.map(t => [t.id, t])),
    pm: new Map(players.map(p => [p.id, p])),
    editableGw,
    lockedGws: gws.filter(g => new Date(g.deadline) <= now),
  };
}

// Kullanıcının tüm haftalardaki kadrolarını {gwId: [player_id]} olarak getirir
async function picksByGw(ctx) {
  const rows = await ctx.store.allMyPicks();
  const map = {};
  for (const r of rows) (map[r.gw_id] ??= []).push(r.player_id);
  return map;
}

async function loadSquadState(ctx) {
  const { store, gws, pm, editableGw, chips } = ctx;
  let picks = editableGw ? await store.picks(editableGw.id) : [];
  if (!picks.length && editableGw) {
    // önceki haftadan kopyala — Free Hit oynanan haftalar atlanır (kadro eski hâline döner)
    const below = gws.filter(g => g.number < editableGw.number).sort((a, b) => b.number - a.number);
    for (const g of below) {
      if (chips.some(c => c.gw_id === g.id && c.chip === 'free_hit')) continue;
      const p = await store.picks(g.id);
      if (p.length) { picks = p; break; }
    }
  }
  picks = picks.filter(p => pm.has(p.player_id));
  const st = {
    squad: picks.map(p => ({ player_id: p.player_id })),
    starters: picks.filter(p => p.slot <= 11).sort((a, b) => a.slot - b.slot).map(p => p.player_id),
    bench: picks.filter(p => p.slot > 11).sort((a, b) => a.slot - b.slot).map(p => p.player_id),
    captainId: picks.find(p => p.is_captain)?.player_id ?? null,
    viceId: picks.find(p => p.is_vice)?.player_id ?? null,
  };
  if (!st.starters.length && st.squad.length) autoArrange(ctx, st);
  return st;
}

function autoArrange(ctx, st) {
  const { pm } = ctx;
  const by = (pos) => st.squad.map(s => pm.get(s.player_id)).filter(p => p.pos === pos);
  const g = by('G'), d = by('D'), m = by('M'), f = by('F');
  st.starters = [...g.slice(0, 1), ...d.slice(0, 4), ...m.slice(0, 4), ...f.slice(0, 2)].map(p => p.id);
  st.bench = st.squad.map(s => s.player_id).filter(id => !st.starters.includes(id));
  st.bench.sort((a, b) => (pm.get(a).pos === 'G' ? -1 : 0) - (pm.get(b).pos === 'G' ? -1 : 0));
  if (!st.captainId || !st.squad.some(s => s.player_id === st.captainId)) st.captainId = st.starters[10] ?? null;
  if (!st.viceId || !st.squad.some(s => s.player_id === st.viceId) || st.viceId === st.captainId)
    st.viceId = st.starters.find(id => id !== st.captainId) ?? null;
}

function buildPicks(st) {
  const picks = [];
  st.starters.forEach((id, i) => picks.push({
    player_id: id, slot: i + 1, is_captain: id === st.captainId, is_vice: id === st.viceId,
  }));
  st.bench.forEach((id, i) => picks.push({
    player_id: id, slot: 12 + i, is_captain: id === st.captainId, is_vice: id === st.viceId,
  }));
  return picks;
}

// ---------------- transfer taslağı (sayfalar arası) ----------------
function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)); } catch { return null; }
}
function writeDraft(d) { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); }
export function clearDraft() { sessionStorage.removeItem(DRAFT_KEY); }

async function loadDraft(ctx) {
  let d = readDraft();
  if (d && Array.isArray(d.ids)) {
    d.ids = d.ids.filter(id => ctx.pm.has(id));
    return d;
  }
  const st = await loadSquadState(ctx);
  d = { ids: st.squad.map(s => s.player_id), cap: st.captainId, vice: st.viceId };
  writeDraft(d);
  return d;
}
function draftCost(ctx, ids) {
  return ids.reduce((s, id) => s + (ctx.pm.get(id)?.price ?? 0), 0);
}

// ---------------- saha çizimi ----------------
function slotHtml(ctx, playerId, { pts = null, badgePts = false, cap = null, vice = null, size = 42, showBye = false } = {}) {
  const p = ctx.pm.get(playerId);
  if (!p) return '';
  const t = ctx.tm.get(p.teamId);
  const isCap = playerId === cap, isVice = playerId === vice;
  const isBye = showBye && ctx.byeSet.has(p.teamId);
  const surname = p.name.trim().split(/\s+/).slice(-1)[0];
  return `<div class="pslot" data-pid="${p.id}">
    ${isCap ? '<span class="cap-badge">C</span>' : isVice ? '<span class="cap-badge vice">V</span>' : ''}
    ${isBye ? '<span class="bye-badge">BAY</span>' : ''}
    <div class="pjersey">${jersey(t, size)}</div>
    <div class="plabel">${esc(surname)}</div>
    ${badgePts
      ? `<div class="psub pts">${pts ?? 0} p</div>`
      : isBye
        ? `<div class="psub bye">BAY · ${p.price.toFixed(1)}</div>`
        : `<div class="psub">${esc(t?.short ?? '')} · ${p.price.toFixed(1)}</div>`}
  </div>`;
}

function emptySlotHtml(pos, idx) {
  return `<div class="pslot empty" data-empty="${pos}:${idx}">
    <div class="pjersey">${jersey({ color: '#e6e9de', color2: '#f6f8f0' }, 42)}</div>
    <div class="plabel">${POS_NAMES[pos]} seç</div>
    <div class="psub">—</div>
  </div>`;
}

function pitchHtml(ctx, st, opts = {}) {
  const rows = POS_ORDER.map(pos => {
    const ids = st.starters.filter(id => ctx.pm.get(id)?.pos === pos);
    if (!ids.length) return '';
    return `<div class="pitch-row">${ids.map(id =>
      slotHtml(ctx, id, { ...opts, cap: st.captainId, vice: st.viceId, pts: opts.ptsMap?.get(id) })).join('')}</div>`;
  }).join('');
  return `<div class="pitch">${rows}</div>
    <div class="bench">
      <div class="bench-label">Yedekler — giriş sırasıyla</div>
      ${st.bench.map(id => slotHtml(ctx, id, { ...opts, cap: null, vice: null, pts: opts.ptsMap?.get(id) })).join('')}
      ${st.bench.length ? '' : '<span class="muted small">Yedek yok</span>'}
    </div>`;
}

// ================================================================
// TAKIMIM
// ================================================================
export async function renderPickTeam(el) {
  const ctx = await loadCtx();
  const { store, pm, editableGw } = ctx;

  if (!editableGw) {
    el.innerHTML = `<div class="card">
      <p class="muted">Şu an düzenlenebilir hafta yok. Geçmiş haftalar için Puanlar sekmesine bak.</p></div>`;
    return;
  }

  const st = await loadSquadState(ctx);

  if (st.squad.length < RULES.squadSize) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px">
      <h3 style="font-size:17px">Önce kadronu kur</h3>
      <p class="muted small" style="margin:8px 0 18px">${RULES.budget}M bütçeyle ${RULES.squadSize} oyuncu
      seçmen gerekiyor${st.squad.length ? ` (şu an ${st.squad.length} seçili)` : ''}.</p>
      <a class="btn primary block" href="#/transferler">Transferlere git</a>
    </div>`;
    return;
  }

  let swapSource = null;

  function chipStripHtml() {
    return `<div class="chip-strip">
      ${Object.keys(CHIPS).map(key => {
        const c = CHIPS[key];
        const row = ctx.chips.find(x => x.chip === key);
        const activeNow = row && row.gw_id === editableGw.id;
        const cls = activeNow ? 'active' : row ? 'used' : '';
        const status = activeNow ? 'Aktif' : row ? 'Kullanıldı' : 'Hazır';
        return `<div class="chip ${cls}" data-chip="${key}">
          <div class="cb">${c.short}</div>
          <div class="cn">${c.name}</div>
          <div class="cs">${status}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function draw() {
    setHead(`<h1 class="ph-title">Takımım</h1>
      <div class="ph-sub">${esc(editableGw.name)} · son teslim <b>${fmtDate(editableGw.deadline)}</b></div>`);

    el.innerHTML = `
      ${chipStripHtml()}
      ${swapSource ? `<p class="small" style="margin-bottom:8px;font-weight:700">
        ${esc(pm.get(swapSource)?.name)} için değişim: başka bir oyuncuya dokun (iptal: aynı oyuncu)</p>` : ''}
      ${pitchHtml(ctx, st, { showBye: true })}
      <p class="muted small" style="margin-top:10px">Oyuncuya dokunarak kaptan seç veya oyuncu değiştir.
      Kaptan çift puan alır; oynamazsa vekil devreye girer. Kozlar hakkında bilgi için Kurallar sayfasına bak.</p>`;

    el.querySelectorAll('[data-chip]').forEach(elm => elm.onclick = async () => {
      if (mustLogin('Koz oynamak için giriş yapmalısın.')) return;
      const key = elm.dataset.chip;
      const c = CHIPS[key];
      const row = ctx.chips.find(x => x.chip === key);
      const activeNow = row && row.gw_id === editableGw.id;
      try {
        if (activeNow) {
          if (confirm(`${c.name} iptal edilsin mi?`)) {
            await store.cancelChip(editableGw.id);
            toast(`${c.name} iptal edildi.`);
            renderPickTeam(el);
          }
        } else if (row) {
          toast(`${c.name} bu sezon kullanıldı. ${c.desc}`, false);
        } else if (ctx.chips.some(x => x.gw_id === editableGw.id)) {
          toast('Bu hafta zaten bir koz aktif.', true);
        } else if (confirm(`${c.name} oynansın mı?\n\n${c.desc}\n\nSezonda her koz yalnızca 1 kez kullanılabilir; son teslim saatine kadar iptal edebilirsin.`)) {
          await store.playChip(editableGw.id, key);
          toast(`${c.name} bu hafta için aktif.`);
          renderPickTeam(el);
        }
      } catch (err) { toast(err.message, true); }
    });

    const bar = setActionBar(`
      <div class="info">Kaptan<br><b>${esc(pm.get(st.captainId)?.name ?? '—')}</b></div>
      <button class="btn primary" id="btn-save">Takımı Kaydet</button>`);

    el.querySelectorAll('.pslot[data-pid]').forEach(s => s.onclick = (e) => {
      e.stopPropagation();
      const pid = Number(s.dataset.pid);
      if (swapSource) {
        if (swapSource !== pid) trySwap(pid);
        swapSource = null;
        draw();
        return;
      }
      openMenu(pid, e.clientX, e.clientY);
    });

    bar.querySelector('#btn-save').onclick = async () => {
      if (mustLogin()) return;
      const picks = buildPicks(st);
      const check = validateSquad(picks, ctx.players, RULES);
      if (!check.ok) { toast(check.errors[0], true); return; }
      try {
        await store.savePicks(editableGw.id, picks);
        toast('Takımın kaydedildi.');
      } catch (err) { toast(err.message, true); }
    };
  }

  function trySwap(target) {
    const a = swapSource, b = target;
    const aStart = st.starters.includes(a), bStart = st.starters.includes(b);
    if (aStart === bStart) { toast('Değişim için biri ilk 11\'de biri yedekte olmalı.', true); return; }
    const starter = aStart ? a : b, sub = aStart ? b : a;
    const newStarters = st.starters.map(id => id === starter ? sub : id);
    const count = { G: 0, D: 0, M: 0, F: 0 };
    newStarters.forEach(id => count[pm.get(id).pos]++);
    for (const pos of POS_ORDER) {
      if (count[pos] < RULES.formationMin[pos] || count[pos] > RULES.formationMax[pos]) {
        toast(`Bu değişiklik geçersiz diziliş oluşturur (${POS_NAMES[pos]}).`, true);
        return;
      }
    }
    st.starters = newStarters;
    st.bench = st.bench.map(id => id === sub ? starter : id);
    if (st.captainId === starter) st.captainId = sub;
    if (st.viceId === starter) st.viceId = sub;
  }

  function openMenu(pid, x, y) {
    closeMenu();
    const isStarter = st.starters.includes(pid);
    const menu = document.createElement('div');
    menu.className = 'pmenu';
    menu.id = 'pmenu';
    menu.innerHTML = `
      ${isStarter ? `
        <button data-act="cap">Kaptan yap</button>
        <button data-act="vice">Vekil yap</button>
        <button data-act="swap">Oyuncu değiştir</button>` : `
        <button data-act="swap">İlk 11'e al</button>`}
      <button data-act="profile">Profili gör</button>`;
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - 190) + 'px';
    menu.style.top = Math.min(y + 6, window.innerHeight - 170) + 'px';
    menu.onclick = (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      closeMenu();
      if (act === 'profile') { location.hash = `#/oyuncu?id=${pid}`; return; }
      if (act === 'cap') { if (st.viceId === pid) st.viceId = st.captainId; st.captainId = pid; }
      if (act === 'vice') { if (st.captainId === pid) st.captainId = st.viceId; st.viceId = pid; }
      if (act === 'swap') swapSource = pid;
      draw();
    };
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }));
  }
  function closeMenu() { document.getElementById('pmenu')?.remove(); }

  draw();
}

// ================================================================
// TRANSFERLER — saha görünümü (FPL tarzı)
// ================================================================
export async function renderTransfers(el) {
  const ctx = await loadCtx();
  const { store, pm, editableGw } = ctx;

  if (!editableGw) {
    el.innerHTML = `<div class="card">
      <p class="muted">Şu an düzenlenebilir hafta yok (tüm son teslim tarihleri geçti).</p></div>`;
    return;
  }

  const draft = await loadDraft(ctx);
  const pbg = await picksByGw(ctx);

  function transferInfo() {
    return calcTransferInfo({
      gws: ctx.gws, gwId: editableGw.id, picksByGwId: pbg, chipsRows: ctx.chips,
      ids: draft.ids, freePerGw: TRANSFERS.freePerGw, hitCost: TRANSFERS.hitCost,
    });
  }

  function transferPitchHtml() {
    const rows = POS_ORDER.map(pos => {
      const ids = draft.ids
        .filter(id => pm.get(id)?.pos === pos)
        .sort((a, b) => pm.get(b).price - pm.get(a).price);
      const empties = RULES.slots[pos] - ids.length;
      return `<div class="pitch-row">
        ${ids.map(id => slotHtml(ctx, id, { size: 40, showBye: true })).join('')}
        ${Array.from({ length: Math.max(0, empties) }, (_, i) => emptySlotHtml(pos, i)).join('')}
      </div>`;
    }).join('');
    return `<div class="pitch">${rows}</div>`;
  }

  function draw() {
    const cost = draftCost(ctx, draft.ids);
    const info = transferInfo();
    const infoLine = info.first
      ? 'İlk kadron — bu hafta transferler serbest.'
      : info.waived
        ? `<b>${CHIPS[info.chip].name} aktif</b> — sınırsız ücretsiz transfer.`
        : `Transfer: <b>${info.used}</b> · ücretsiz hak: ${TRANSFERS.freePerGw}
           · puan cezası: <b${info.hit > 0 ? ' style="color:var(--danger)"' : ''}>−${info.hit}</b>`;
    setHead(`<h1 class="ph-title">Transferler</h1>
      <div class="ph-sub">${esc(editableGw.name)} · son teslim <b>${fmtDate(editableGw.deadline)}</b></div>
      <div class="ph-sub">${infoLine}</div>`);

    el.innerHTML = `
      ${transferPitchHtml()}
      <p class="muted small" style="margin-top:10px">Boş formaya dokunup oyuncu seç; dolu formaya dokunup
      değiştir veya çıkar. ${RULES.slots.G} kaleci, ${RULES.slots.D} defans, ${RULES.slots.M} orta saha,
      ${RULES.slots.F} forvet · aynı takımdan en fazla ${RULES.maxPerTeam} oyuncu.</p>`;

    const savedKey = (pbg[editableGw.id] ?? []).slice().sort((a, b) => a - b).join(',');
    const draftKey = draft.ids.slice().sort((a, b) => a - b).join(',');
    const dirty = savedKey !== draftKey;
    const complete = draft.ids.length === RULES.squadSize;
    const bar = setActionBar(`
      <div class="info">Kalan bütçe<br><b>${(RULES.budget - cost).toFixed(1)}M</b></div>
      <div class="info">Kadro<br><b>${draft.ids.length}/${RULES.squadSize}</b></div>
      <button class="btn sm" id="btn-reset" title="Kayıtlı kadroya dön">Sıfırla</button>
      <button class="btn primary" id="btn-confirm" ${complete && dirty ? '' : 'disabled'}>
        ${complete && !dirty ? 'Onaylandı' : 'Onayla'}</button>`);

    el.querySelectorAll('.pslot[data-empty]').forEach(s => s.onclick = () => {
      const pos = s.dataset.empty.split(':')[0];
      location.hash = `#/transferler/sec?pos=${pos}`;
    });

    el.querySelectorAll('.pslot[data-pid]').forEach(s => s.onclick = (e) => {
      e.stopPropagation();
      openMenu(Number(s.dataset.pid), e.clientX, e.clientY);
    });

    bar.querySelector('#btn-reset').onclick = () => {
      if (!confirm('Taslak değişiklikler atılsın, kayıtlı kadroya dönülsün mü?')) return;
      clearDraft();
      renderTransfers(el);
    };

    bar.querySelector('#btn-confirm').onclick = async () => {
      if (mustLogin()) return;
      const info = transferInfo();
      if (info.hit > 0 &&
          !confirm(`Bu transferler ${info.hit} puan cezaya yol açacak (${info.used} transfer, ${TRANSFERS.freePerGw} ücretsiz hak). Devam edilsin mi?`)) {
        return;
      }
      const st = {
        squad: draft.ids.map(id => ({ player_id: id })),
        starters: [], bench: [], captainId: draft.cap, viceId: draft.vice,
      };
      // mevcut kayıtlı ilk 11'i koru (hâlâ kadrodaysa)
      const saved = await loadSquadState(ctx);
      const savedStarters = saved.starters.filter(id => draft.ids.includes(id));
      if (savedStarters.length === 11) {
        st.starters = savedStarters;
        st.bench = draft.ids.filter(id => !savedStarters.includes(id));
        st.bench.sort((a, b) => (pm.get(a).pos === 'G' ? -1 : 0) - (pm.get(b).pos === 'G' ? -1 : 0));
        if (!st.captainId || !draft.ids.includes(st.captainId)) st.captainId = null;
        if (!st.viceId || !draft.ids.includes(st.viceId)) st.viceId = null;
        if (!st.captainId) st.captainId = st.starters[10] ?? null;
        if (!st.viceId || st.viceId === st.captainId) st.viceId = st.starters.find(id => id !== st.captainId) ?? null;
      } else {
        autoArrange(ctx, st);
      }
      const picks = buildPicks(st);
      const check = validateSquad(picks, ctx.players, RULES);
      if (!check.ok) { toast(check.errors[0], true); return; }
      try {
        await store.savePicks(editableGw.id, picks);
        clearDraft();
        pbg[editableGw.id] = [...draft.ids];
        toast('Transferler kaydedildi. İlk 11\'i Takımım\'dan ayarla.');
        draw();
      } catch (err) { toast(err.message, true); }
    };
  }

  function openMenu(pid, x, y) {
    closeMenu();
    const p = pm.get(pid);
    const menu = document.createElement('div');
    menu.className = 'pmenu';
    menu.id = 'pmenu';
    menu.innerHTML = `
      <button data-act="swap">Oyuncu değiştir</button>
      <button data-act="remove">Kadrodan çıkar</button>
      <button data-act="profile">Profili gör</button>`;
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - 190) + 'px';
    menu.style.top = Math.min(y + 6, window.innerHeight - 140) + 'px';
    menu.onclick = (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      closeMenu();
      if (act === 'profile') { location.hash = `#/oyuncu?id=${pid}`; return; }
      if (act === 'swap') location.hash = `#/transferler/sec?pos=${p.pos}&out=${pid}`;
      if (act === 'remove') {
        draft.ids = draft.ids.filter(id => id !== pid);
        if (draft.cap === pid) draft.cap = null;
        if (draft.vice === pid) draft.vice = null;
        writeDraft(draft);
        draw();
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }));
  }
  function closeMenu() { document.getElementById('pmenu')?.remove(); }

  draw();
}

// ================================================================
// OYUNCU SEÇ — transfer alt sayfası
// ================================================================
export async function renderTransferSelect(el) {
  const ctx = await loadCtx();
  const { tm, pm, players, teams, editableGw } = ctx;

  if (!editableGw) { location.hash = '#/transferler'; return; }

  const q = new URLSearchParams((location.hash.split('?')[1] ?? ''));
  const pos = ['G', 'D', 'M', 'F'].includes(q.get('pos')) ? q.get('pos') : 'M';
  const outId = q.get('out') ? Number(q.get('out')) : null;

  const draft = await loadDraft(ctx);
  const outPlayer = outId ? pm.get(outId) : null;
  const baseIds = draft.ids.filter(id => id !== outId);
  const baseCost = draftCost(ctx, baseIds);
  const budgetLeft = RULES.budget - baseCost;
  const posCount = baseIds.filter(id => pm.get(id)?.pos === pos).length;
  const teamCount = (tid) => baseIds.filter(id => pm.get(id)?.teamId === tid).length;

  let filter = { team: '', q: '' };

  function goBack() {
    if (history.length > 1) history.back();
    else location.hash = '#/transferler';
  }

  function draw() {
    let list = players.filter(p => p.pos === pos && !baseIds.includes(p.id) && p.id !== outId);
    if (filter.team) list = list.filter(p => p.teamId === Number(filter.team));
    if (filter.q) {
      const s = filter.q.toLocaleLowerCase('tr');
      list = list.filter(p => p.name.toLocaleLowerCase('tr').includes(s));
    }
    list.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name, 'tr'));

    el.innerHTML = `
      <div class="sel-head">
        <button class="back" id="btn-back" aria-label="Geri">‹</button>
        <div class="t">
          <b>${POS_NAMES[pos]} seç</b>
          <span>${outPlayer ? `${esc(outPlayer.name)} yerine · ` : ''}kalan bütçe <b>${budgetLeft.toFixed(1)}M</b></span>
        </div>
      </div>
      <div class="market-filters">
        <select id="mf-team">
          <option value="">Takım: tümü</option>
          ${teams.map(t => `<option value="${t.id}" ${filter.team == t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
        <input id="mf-q" placeholder="Oyuncu ara" value="${esc(filter.q)}">
      </div>
      <div class="card" style="padding:6px 12px">
        ${!outId && posCount >= RULES.slots[pos] ? `<p class="muted small" style="padding:10px 2px">Bu pozisyon dolu. Sahadan bir oyuncuyu değiştirmeyi dene.</p>` : `
        <div class="plist">
          ${list.map(p => {
            const t = tm.get(p.teamId);
            const teamFull = teamCount(p.teamId) >= RULES.maxPerTeam;
            const noBudget = p.price > budgetLeft;
            const disabled = teamFull || noBudget;
            return `<div class="prow sel ${disabled ? 'disabled' : ''}" data-pick="${p.id}">
              <span class="jr" style="width:26px;height:26px">${jersey(t, 26)}</span>
              <div class="grow">
                <div class="pname">${esc(p.name)}${ctx.byeSet.has(p.teamId) ? ' <span class="pill bay">BAY</span>' : ''}</div>
                <div class="muted small">${esc(t?.name ?? '')}${teamFull ? ' · takım limiti' : noBudget ? ' · bütçe yetersiz' : ''}</div>
              </div>
              <span class="num" style="min-width:42px"><b>${p.price.toFixed(1)}</b><span class="muted small">M</span></span>
              <button class="iconbtn" data-profile="${p.id}" title="Profil" style="border:1px solid var(--line)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>
              </button>
            </div>`;
          }).join('')}
          ${list.length ? '' : '<p class="muted small" style="padding:12px 2px">Filtreyle eşleşen oyuncu yok.</p>'}
        </div>`}
      </div>`;

    el.querySelector('#btn-back').onclick = goBack;
    const mfTeam = el.querySelector('#mf-team'), mfQ = el.querySelector('#mf-q');
    mfTeam.onchange = () => { filter.team = mfTeam.value; draw(); };
    mfQ.oninput = () => { filter.q = mfQ.value; clearTimeout(mfQ._t); mfQ._t = setTimeout(draw, 300); };

    el.querySelectorAll('[data-profile]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      location.hash = `#/oyuncu?id=${b.dataset.profile}`;
    });
    el.querySelectorAll('[data-pick]').forEach(r => r.onclick = () => {
      const pid = Number(r.dataset.pick);
      draft.ids = [...baseIds, pid];
      if (outId && draft.cap === outId) draft.cap = pid;
      if (outId && draft.vice === outId) draft.vice = pid;
      writeDraft(draft);
      toast(`${pm.get(pid).name} kadroya eklendi.`);
      goBack();
    });
  }

  draw();
}

// ================================================================
// PUANLAR
// ================================================================
export async function renderPoints(el) {
  const ctx = await loadCtx();
  const { store, pm, players, lockedGws } = ctx;

  if (!store.user()) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px">
      <h3 style="font-size:17px">Puanların burada görünecek</h3>
      <p class="muted small" style="margin:8px 0 18px">Haftalık puanlarını takip etmek için giriş yap.</p>
      <a class="btn primary block" href="#/giris">Giriş Yap / Kayıt Ol</a>
    </div>`;
    return;
  }

  if (!lockedGws.length) {
    el.innerHTML = `<div class="card">
      <p class="muted">Henüz kilitlenmiş hafta yok. İlk haftanın son teslim saati geçince puanların burada görünecek.</p></div>`;
    return;
  }

  let selGw = lockedGws[lockedGws.length - 1].id;

  async function draw() {
    const gw = lockedGws.find(g => g.id === selGw);
    const [events, fixtures, picks] = await Promise.all([
      store.events(gw.id), store.fixtures(gw.id), store.picks(gw.id),
    ]);

    const selector = `<select id="pts-gw" style="width:auto;min-width:130px">
      ${lockedGws.map(g => `<option value="${g.id}" ${g.id === selGw ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
    </select>`;

    if (!picks.length) {
      el.innerHTML = `<div class="squad-meta">${selector}</div>
        <div class="card"><p class="muted">${esc(gw.name)} için kadro kaydetmemişsin.</p></div>`;
      bindSel();
      return;
    }

    const chip = ctx.chips.find(c => c.gw_id === gw.id)?.chip ?? null;
    const pp = playerPointsForGW(events, fixtures, players);
    const result = userPointsForGW(picks, pp, players, { chip });
    const pbg = await picksByGw(ctx);
    const tInfo = calcTransferInfo({
      gws: ctx.gws, gwId: gw.id, picksByGwId: pbg, chipsRows: ctx.chips,
      ids: picks.map(p => p.player_id), freePerGw: TRANSFERS.freePerGw, hitCost: TRANSFERS.hitCost,
    });
    const netTotal = result.total - tInfo.hit;
    const ptsMap = new Map(result.rows.map(r => [r.player_id, r.pts]));
    const st = {
      starters: picks.filter(p => p.slot <= 11).sort((a, b) => a.slot - b.slot).map(p => p.player_id),
      bench: picks.filter(p => p.slot > 11).sort((a, b) => a.slot - b.slot).map(p => p.player_id),
      captainId: picks.find(p => p.is_captain)?.player_id ?? null,
      viceId: picks.find(p => p.is_vice)?.player_id ?? null,
    };
    st.bench.forEach(id => { if (!ptsMap.has(id)) ptsMap.set(id, pp.get(id)?.pts ?? 0); });

    el.innerHTML = `
      <div class="hero" style="padding:14px 16px;margin-bottom:12px">
        <div class="hero-row" style="align-items:center">
          <div class="hero-cell">
            <div class="k">Hafta</div>
            ${selector}
          </div>
          <div class="hero-divider"></div>
          <div class="hero-cell" style="text-align:right">
            <div class="k">Hafta Puanın</div>
            <div class="v lime" style="font-size:32px">${netTotal}</div>
          </div>
        </div>
        ${chip || tInfo.hit > 0 ? `<div class="k" style="margin-top:10px">
          ${chip ? `Koz: ${CHIPS[chip].name}` : ''}${chip && tInfo.hit > 0 ? ' · ' : ''}${tInfo.hit > 0 ? `Transfer cezası: −${tInfo.hit}` : ''}
        </div>` : ''}
      </div>
      ${pitchHtml(ctx, st, { badgePts: true, ptsMap })}
      <div class="card" style="margin-top:12px">
        <h2>Puan Dökümü</h2>
        <div class="table-wrap"><table>
          <tr><th>Oyuncu</th><th>Olaylar</th><th class="num">Puan</th></tr>
          ${result.rows.map(r => {
            const p = pm.get(r.player_id);
            const br = pp.get(r.player_id)?.breakdown ?? [];
            return `<tr>
              <td><b>${esc(p?.name)}</b>${r.doubled ? ' <span class="pill">x2</span>' : ''}
                ${r.subbedInFor ? `<div class="muted small">${esc(pm.get(r.subbedInFor)?.name)} yerine girdi</div>` : ''}</td>
              <td class="muted small">${br.length ? br.map(b => `${EVENT_LABELS[b.type]}${b.qty > 1 ? ' x' + b.qty : ''} (${b.pts > 0 ? '+' : ''}${b.pts})`).join(', ') : 'Oynamadı'}</td>
              <td class="num"><b>${r.pts}</b></td>
            </tr>`;
          }).join('')}
        </table></div>
      </div>`;
    bindSel();
    el.querySelectorAll('.pslot[data-pid]').forEach(s => s.onclick = () => {
      location.hash = `#/oyuncu?id=${s.dataset.pid}`;
    });
  }

  function bindSel() {
    el.querySelector('#pts-gw').onchange = (e) => { selGw = Number(e.target.value); draw(); };
  }

  await draw();
}
