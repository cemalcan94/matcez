import { App, toast, fmtDate, esc, setHead, mustLogin } from './app.js';
import { jersey, jerseyInline } from './jersey.js';
import { RULES, POS_NAMES, TRANSFERS, CHIPS, PRIZES, PARTNERS } from './config.js';
import { playerPointsForGW, EVENT_LABELS } from './points.js';

function teamMap(teams) { return new Map(teams.map(t => [t.id, t])); }

function countdown(deadline) {
  const ms = new Date(deadline) - new Date();
  if (ms <= 0) return 'kapandı';
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
  return d > 0 ? `${d}g ${h}s` : `${h}s ${m}dk`;
}

export function fixtureRow(f, tm) {
  const h = tm.get(f.home_id), a = tm.get(f.away_id);
  const score = f.status === 'finished' ? `${f.home_score} - ${f.away_score}` :
    new Date(f.kickoff).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
  return `<div class="fixture-row">
    <span class="tname home">${esc(h?.name ?? '?')} ${jerseyInline(h, 18)}</span>
    <span class="score">${score}</span>
    <span class="tname away">${jerseyInline(a, 18)}${esc(a?.name ?? '?')}</span>
  </div>`;
}

// ---------------- ANA SAYFA ----------------
export async function renderHome(el) {
  const store = App.store;
  const [gws, standings, teams] = await Promise.all([
    store.gameweeks(), store.standings(), store.teams(),
  ]);
  const tm = teamMap(teams);
  const now = new Date();
  const current = gws.find(g => g.is_current) ?? gws.find(g => new Date(g.deadline) > now) ?? gws[0];
  const editableGw = gws.find(g => new Date(g.deadline) > now);
  const me = store.user();
  const myRow = standings.find(r => r.user_id === me?.id);
  const myRank = myRow ? standings.indexOf(myRow) + 1 : null;
  const myPicks = editableGw && me ? await store.picks(editableGw.id) : [];
  const gwPoints = await store.gwPoints();
  const lastFinished = [...gws].reverse().find(g => g.is_finished);
  const lastGwPts = lastFinished
    ? gwPoints.find(x => x.user_id === me?.id && x.gw_id === lastFinished.id)?.points ?? null
    : null;
  let selectedGw = current?.id ?? null;
  let showFullTable = false;

  // Mini ligler (Genel Sıralama bölümünün altında gösterilir)
  const myLeagues = me ? await store.myLeagues() : [];
  const leagueBoards = [];
  for (const lg of myLeagues) {
    leagueBoards.push({ lg, rows: (await store.leagueStandings(lg.id)).slice(0, 3) });
  }

  async function draw() {
    const fixtures = selectedGw ? await store.fixtures(selectedGw) : [];
    const allFixtures = await store.fixtures();
    const table = leagueTable(allFixtures, teams);
    const hasResults = table.some(r => r.o > 0);
    const tableRows = showFullTable ? table : table.slice(0, 6);

    setHead('');

    el.innerHTML = `
      <div class="hero-lime">
        <div class="k">${editableGw ? esc(editableGw.name) + ' · Son Teslim' : 'Sezon'}</div>
        <div class="big">${editableGw ? countdown(editableGw.deadline) : '—'}</div>
        <div class="sub">${editableGw ? fmtDate(editableGw.deadline) : 'Yeni hafta açıldığında burada görünür'}</div>
        <div class="stats">
          <div><span class="sk">Toplam Puan</span><b>${myRow?.total_points ?? 0}</b></div>
          <div><span class="sk">Sıralama</span><b>${myRank ? '#' + myRank : '—'}</b></div>
          <div><span class="sk">Son Hafta</span><b>${lastGwPts ?? '—'}</b></div>
        </div>
        ${editableGw && me && myPicks.length === 0 ? `
          <div class="cta"><a class="btn green block" href="#/transferler">Kadronu Kur — sezona başla</a></div>` : ''}
      </div>`;

    el.innerHTML += `
      ${PRIZES.weekly.enabled ? `
      ${PRIZES.weekly.banner ? `
      <a class="prize-banner-full" href="#/kurallar">
        <img src="${esc(PRIZES.weekly.banner)}" alt="${esc(PRIZES.weekly.eyebrow)}: ${esc(PRIZES.weekly.title).replace(/\n/g, ' ')}"
             onerror="this.closest('.prize-banner-full').style.display='none';document.getElementById('prize-fallback').style.display='flex'">
      </a>` : ''}
      <a class="prize-banner" id="prize-fallback" href="#/kurallar"
         ${PRIZES.weekly.banner ? 'style="display:none"' : ''}>
        <div class="pb-txt">
          <div class="pb-eyebrow">${esc(PRIZES.weekly.eyebrow)}</div>
          <div class="pb-title">${esc(PRIZES.weekly.title).replace(/\n/g, '<br>')}</div>
          <div class="pb-sponsor">${esc(PRIZES.weekly.sponsor)}</div>
        </div>
        <div class="pb-img">
          ${PRIZES.weekly.image ? `<img src="${esc(PRIZES.weekly.image)}" alt="Ödül">` : `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.5" y="8.5" width="17" height="12" rx="1.5"/>
            <path d="M3.5 12.5h17"/><path d="M12 8.5v12"/>
            <path d="M12 8.5c-4.5 0-5.5-2-4.7-3.6C8.1 3.3 11 4.3 12 8.5Z"/>
            <path d="M12 8.5c4.5 0 5.5-2 4.7-3.6C15.9 3.3 13 4.3 12 8.5Z"/>
          </svg>`}
        </div>
      </a>
      ${PRIZES.season.enabled ? `<div class="prize-season">${esc(PRIZES.season.text)}</div>` : ''}` : ''}

      <div class="card">
        <h2>Fikstür</h2>
        <select id="gw-select" style="margin-bottom:8px">
          ${gws.map(g => `<option value="${g.id}" ${g.id === selectedGw ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
        </select>
        ${fixtures.length ? fixtures.map(f => fixtureRow(f, tm)).join('') :
          '<p class="muted small" style="padding:8px 0">Bu hafta için fikstür girilmemiş.</p>'}
        ${(() => {
          if (!fixtures.length) return '';
          const playing = new Set(fixtures.flatMap(f => [f.home_id, f.away_id]));
          const byes = teams.filter(t => !playing.has(t.id));
          return byes.length ? `<p class="bye-line">Bu hafta bay: ${byes.map(t =>
            `${jerseyInline(t, 15)}<b>${esc(t.name)}</b>`).join(', ')}</p>` : '';
        })()}
      </div>

      <div class="card">
        <h2>Genel Sıralama</h2>
        <div class="table-wrap"><table>
          <tr><th style="width:32px">#</th><th>Takım</th><th class="num">Puan</th></tr>
          ${standings.slice(0, 5).map((r, i) => `
            <tr ${r.user_id === me?.id ? 'class="hl"' : ''}>
              <td class="muted">${i + 1}</td>
              <td><b>${esc(r.team_name)}</b><div class="muted small">${esc(r.username)}</div></td>
              <td class="num"><b>${r.total_points}</b></td>
            </tr>`).join('')}
        </table></div>
        ${leagueBoards.map(({ lg, rows }) => `
          <div class="home-league">
            <div class="hl-name">${esc(lg.name)}</div>
            <div class="table-wrap"><table>
              ${rows.map((r, i) => `<tr ${r.user_id === me?.id ? 'class="hl"' : ''}>
                <td class="muted" style="width:32px">${i + 1}</td>
                <td><b>${esc(r.team_name)}</b></td>
                <td class="num"><b>${r.total_points}</b></td>
              </tr>`).join('')}
            </table></div>
          </div>`).join('')}
        <a class="btn sm block" style="margin-top:12px" href="#/ligler">Tüm sıralama ve mini ligler</a>
      </div>

      <div class="card">
        <h2>KKTC Süper Lig</h2>
        ${hasResults ? `
        <div class="table-wrap"><table>
          <tr><th style="width:32px">#</th><th>Takım</th><th class="num">O</th><th class="num">Av</th><th class="num">P</th></tr>
          ${tableRows.map((r, i) => `<tr>
            <td class="muted">${i + 1}</td>
            <td>${jerseyInline(r.team, 17)}${esc(r.team.name)}</td>
            <td class="num">${r.o}</td>
            <td class="num">${r.av > 0 ? '+' : ''}${r.av}</td>
            <td class="num"><b>${r.p}</b></td>
          </tr>`).join('')}
        </table></div>
        ${table.length > 6 ? `<button class="btn sm block" style="margin-top:10px" id="btn-full-table">
          ${showFullTable ? 'Daralt' : 'Tüm tabloyu göster'}</button>` : ''}` :
        '<p class="muted small">Sonuç girildikçe puan tablosu burada oluşacak.</p>'}
      </div>

      <div class="partners">
        <div class="partners-title">Partnerlerimiz</div>
        <div class="partners-row">
          ${PARTNERS.map(p => `<div class="partner ${p.placeholder ? 'ph' : ''}">
            <div class="pn">${esc(p.name)}</div>
            <div class="pr">${esc(p.role)}</div>
          </div>`).join('')}
        </div>
        <p class="muted small" style="text-align:center;margin-top:8px">Sponsorluk için bizimle iletişime geçin.</p>
      </div>`;

    el.querySelector('#gw-select').onchange = (e) => {
      selectedGw = Number(e.target.value); draw();
    };
    el.querySelector('#btn-full-table')?.addEventListener('click', () => {
      showFullTable = !showFullTable; draw();
    });
  }
  await draw();
}

// ---------------- OYUNCU PROFİLİ ----------------
export async function renderPlayer(el) {
  const store = App.store;
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const pid = Number(q.get('id'));
  const [gws, teams, players] = await Promise.all([
    store.gameweeks(), store.teams(), store.players(),
  ]);
  const p = players.find(x => x.id === pid);
  if (!p) {
    el.innerHTML = '<div class="card"><p class="muted">Oyuncu bulunamadı.</p></div>';
    return;
  }
  const tm = teamMap(teams);
  const t = tm.get(p.teamId);
  const now = new Date();
  const lockedGws = gws.filter(g => new Date(g.deadline) <= now);

  // Son haftaların puanları
  const formRows = [];
  let totalPts = 0;
  for (const g of [...lockedGws].reverse().slice(0, 8)) {
    const [events, fixtures] = await Promise.all([store.events(g.id), store.fixtures(g.id)]);
    const fx = fixtures.find(f => f.home_id === p.teamId || f.away_id === p.teamId);
    const oppId = fx ? (fx.home_id === p.teamId ? fx.away_id : fx.home_id) : null;
    const opp = oppId ? tm.get(oppId) : null;
    const home = fx?.home_id === p.teamId;
    const pp = playerPointsForGW(events, fixtures, players);
    const rec = pp.get(pid);
    totalPts += rec?.pts ?? 0;
    formRows.push({
      gw: g, fx, opp, home,
      pts: rec?.pts ?? 0,
      events: rec?.breakdown?.map(b =>
        `${EVENT_LABELS[b.type]}${b.qty > 1 ? ' x' + b.qty : ''}`).join(', ') ?? (fx ? 'Oynamadı' : 'Maç yok'),
    });
  }

  // Gelecek maçlar
  const allFixtures = await store.fixtures();
  const upcoming = allFixtures
    .filter(f => (f.home_id === p.teamId || f.away_id === p.teamId) && f.status !== 'finished')
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .slice(0, 5);

  el.innerHTML = `
    <div class="sel-head">
      <button class="back" id="btn-back" aria-label="Geri">‹</button>
      <div class="t"><b>Oyuncu Profili</b></div>
    </div>

    <div class="card player-head">
      <div class="pj">${jersey(t, 58)}</div>
      <div class="grow">
        <div style="font-size:17px;font-weight:800">${esc(p.name)}</div>
        <div class="muted small">${esc(t?.name ?? '')}</div>
        <div style="margin-top:6px;display:flex;gap:6px;align-items:center">
          <span class="pill ${p.pos}">${POS_NAMES[p.pos]}</span>
          <span class="pill">${p.price.toFixed(1)}M</span>
          <span class="pill">Sezon: ${totalPts} puan</span>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Son Haftalar</h2>
      ${formRows.length ? `
      <div class="table-wrap"><table>
        <tr><th>Hafta</th><th>Rakip</th><th>Olaylar</th><th class="num">Puan</th></tr>
        ${formRows.map(r => `<tr>
          <td class="muted">H${r.gw.number}</td>
          <td>${r.opp ? `${jerseyInline(r.opp, 15)}${esc(r.opp.short)} <span class="muted small">(${r.home ? 'E' : 'D'})</span>` : '—'}
            ${r.fx?.status === 'finished' ? `<div class="muted small">${r.fx.home_score}-${r.fx.away_score}</div>` : ''}</td>
          <td class="muted small">${esc(r.events)}</td>
          <td class="num"><b>${r.pts}</b></td>
        </tr>`).join('')}
      </table></div>` : '<p class="muted small">Henüz tamamlanmış hafta yok.</p>'}
    </div>

    <div class="card">
      <h2>Gelecek Maçlar</h2>
      ${upcoming.length ? `
      <div class="table-wrap"><table>
        <tr><th>Hafta</th><th>Rakip</th><th class="num">Tarih</th></tr>
        ${upcoming.map(f => {
          const home = f.home_id === p.teamId;
          const opp = tm.get(home ? f.away_id : f.home_id);
          const g = gws.find(x => x.id === f.gw_id);
          return `<tr>
            <td class="muted">H${g?.number ?? '?'}</td>
            <td>${jerseyInline(opp, 15)}${esc(opp?.name ?? '?')} <span class="muted small">(${home ? 'Ev' : 'Dep'})</span></td>
            <td class="num muted small">${fmtDate(f.kickoff)}</td>
          </tr>`;
        }).join('')}
      </table></div>` : '<p class="muted small">Planlanmış maç görünmüyor.</p>'}
    </div>`;

  el.querySelector('#btn-back').onclick = () => {
    if (history.length > 1) history.back(); else location.hash = '#/';
  };
}

export function leagueTable(fixtures, teams) {
  const rows = new Map(teams.map(t => [t.id, { team: t, o: 0, g: 0, b: 0, m: 0, av: 0, p: 0 }]));
  for (const f of fixtures) {
    if (f.status !== 'finished' || f.home_score == null) continue;
    const h = rows.get(f.home_id), a = rows.get(f.away_id);
    if (!h || !a) continue;
    h.o++; a.o++;
    h.av += f.home_score - f.away_score;
    a.av += f.away_score - f.home_score;
    if (f.home_score > f.away_score) { h.g++; h.p += 3; a.m++; }
    else if (f.home_score < f.away_score) { a.g++; a.p += 3; h.m++; }
    else { h.b++; a.b++; h.p++; a.p++; }
  }
  return [...rows.values()].sort((x, y) => y.p - x.p || y.av - x.av);
}

// ---------------- LİGLER ----------------
export async function renderLeagues(el) {
  const store = App.store;

  async function draw() {
    const [leagues, standings, gws, gwPoints] = await Promise.all([
      store.myLeagues(), store.standings(), store.gameweeks(), store.gwPoints(),
    ]);
    const finished = gws.filter(g => g.is_finished);
    const me = store.user();

    el.innerHTML = `
      <div class="card">
        <h2>Genel Sıralama</h2>
        <div class="table-wrap"><table>
          <tr><th style="width:32px">#</th><th>Takım</th>
            ${finished.map(g => `<th class="num">H${g.number}</th>`).join('')}
            <th class="num">Toplam</th></tr>
          ${standings.map((r, i) => `
            <tr ${r.user_id === me?.id ? 'class="hl"' : ''}>
              <td class="muted">${i + 1}</td>
              <td><b>${esc(r.team_name)}</b><div class="muted small">${esc(r.username)}</div></td>
              ${finished.map(g => {
                const gp = gwPoints.find(x => x.user_id === r.user_id && x.gw_id === g.id);
                return `<td class="num">${gp?.points ?? '—'}</td>`;
              }).join('')}
              <td class="num"><b>${r.total_points}</b></td>
            </tr>`).join('')}
        </table></div>
      </div>

      <div class="card">
        <h2>Mini Liglerim</h2>
        ${leagues.length ? '' : '<p class="muted small">Henüz bir mini lige üye değilsin. Aşağıdan lig kur veya arkadaşının koduyla katıl.</p>'}
        <div id="league-list"></div>
      </div>

      <div class="card">
        <h2>Lig Kur / Katıl</h2>
        <label>Yeni lig adı</label>
        <div style="display:flex; gap:8px">
          <input id="new-league-name" placeholder="ör. Mahalle Ligi">
          <button class="btn primary" id="btn-create">Kur</button>
        </div>
        <label>Davet koduyla katıl</label>
        <div style="display:flex; gap:8px">
          <input id="join-code" placeholder="ör. A1B2C3" style="text-transform:uppercase">
          <button class="btn green" id="btn-join">Katıl</button>
        </div>
        <p class="muted small" style="margin-top:10px">Lig kurunca sana özel bir davet kodu üretilir;
        arkadaşların bu kodla katılır.</p>
      </div>`;

    const list = el.querySelector('#league-list');
    for (const lg of leagues) {
      const rows = await store.leagueStandings(lg.id);
      const div = document.createElement('div');
      div.style.marginBottom = '16px';
      div.innerHTML = `
        <h3>${esc(lg.name)} <span class="pill">kod: ${esc(lg.code)}</span></h3>
        <div class="table-wrap"><table>
          <tr><th style="width:32px">#</th><th>Takım</th><th class="num">Puan</th></tr>
          ${rows.map((r, i) => `<tr><td class="muted">${i + 1}</td>
            <td><b>${esc(r.team_name)}</b><div class="muted small">${esc(r.username)}</div></td>
            <td class="num"><b>${r.total_points}</b></td></tr>`).join('')}
        </table></div>`;
      list.appendChild(div);
    }

    el.querySelector('#btn-create').onclick = async () => {
      if (mustLogin('Lig kurmak için giriş yapmalısın.')) return;
      const name = el.querySelector('#new-league-name').value.trim();
      if (!name) return toast('Lig adı girin.', true);
      try {
        const lg = await store.createLeague(name);
        toast(`"${lg.name}" kuruldu. Davet kodu: ${lg.code}`);
        draw();
      } catch (e) { toast(e.message, true); }
    };
    el.querySelector('#btn-join').onclick = async () => {
      if (mustLogin('Lige katılmak için giriş yapmalısın.')) return;
      const code = el.querySelector('#join-code').value.trim();
      if (!code) return toast('Davet kodu girin.', true);
      try {
        const lg = await store.joinLeague(code);
        toast(`"${lg.name}" ligine katıldın.`);
        draw();
      } catch (e) { toast(e.message, true); }
    };
  }
  await draw();
}

// ---------------- KURALLAR ----------------
export async function renderRules(el) {
  el.innerHTML = `
    <div class="card rules">
      <h2>Kadro Kuralları</h2>
      <ul>
        <li><b>${RULES.budget}M bütçe</b> ile <b>${RULES.squadSize} oyuncu</b> seçersin:
          ${RULES.slots.G} kaleci, ${RULES.slots.D} defans, ${RULES.slots.M} orta saha, ${RULES.slots.F} forvet.</li>
        <li>Aynı takımdan en fazla <b>${RULES.maxPerTeam} oyuncu</b> alabilirsin.</li>
        <li>İlk 11'in geçerli bir dizilişte olmalı: en az ${RULES.formationMin.D} defans,
          ${RULES.formationMin.M} orta saha, ${RULES.formationMin.F} forvet ve 1 kaleci.</li>
        <li>Bir <b>kaptan</b> ve bir <b>kaptan vekili</b> seçersin. Kaptan o hafta <b>çift puan</b> alır;
          kaptan oynamazsa vekil çift puan alır.</li>
      </ul>

      <h3>Haftalık İşleyiş</h3>
      <ul>
        <li>Her haftanın bir <b>son teslim saati</b> vardır. O saate kadar kadronu ve transferlerini
          değiştirebilirsin, sonrasında hafta kilitlenir.</li>
        <li>Oynamayan ilk 11 oyuncusunun yerine <b>yedekler sırayla otomatik girer</b>
          (kaleci yalnızca kaleciyle değişir).</li>
        <li>Ligde 15 takım olduğu için <b>her hafta bir takım bay geçer</b>. Bay geçen takımın
          oyuncuları o hafta puan kazanamaz; kadrondaki bay oyuncular sahada <b>BAY</b> etiketiyle
          gösterilir ve oto-yedek/vekil kuralları devreye girer.</li>
        <li>Maçlar bitince puanlar hesaplanır ve sıralamalar güncellenir.</li>
      </ul>

      <h3>Transferler</h3>
      <ul>
        <li>İlk kadronu kurarken transferler <b>tamamen serbesttir</b>.</li>
        <li>Sonraki her hafta <b>${TRANSFERS.freePerGw} ücretsiz transfer</b> hakkın vardır;
          her ek transfer <b>−${TRANSFERS.hitCost} puan</b> cezaya yol açar.</li>
        <li>Wildcard veya Free Hit oynadığın haftalarda transfer cezası uygulanmaz.</li>
      </ul>

      <h3>Kozlar</h3>
      <p class="muted small">Sezonda her koz <b>yalnızca 1 kez</b> kullanılabilir ve bir haftada
      en fazla 1 koz oynanabilir. Son teslim saatine kadar iptal edilebilir.</p>
      <div class="table-wrap"><table>
        <tr><th>Koz</th><th>Etkisi</th></tr>
        ${Object.values(CHIPS).map(c => `<tr>
          <td style="white-space:nowrap"><b>${c.name}</b></td>
          <td class="small">${c.desc}</td>
        </tr>`).join('')}
      </table></div>

      <h3>Puanlama</h3>
      <div class="table-wrap"><table>
        <tr><th>Olay</th><th class="num">Puan</th></tr>
        <tr><td>Maça çıkma</td><td class="num">+2</td></tr>
        <tr><td>Gol — Kaleci</td><td class="num">+10</td></tr>
        <tr><td>Gol — Defans</td><td class="num">+6</td></tr>
        <tr><td>Gol — Orta saha</td><td class="num">+5</td></tr>
        <tr><td>Gol — Forvet</td><td class="num">+4</td></tr>
        <tr><td>Asist</td><td class="num">+3</td></tr>
        <tr><td>Gol yememe — Kaleci/Defans</td><td class="num">+4</td></tr>
        <tr><td>Gol yememe — Orta saha</td><td class="num">+1</td></tr>
        <tr><td>Maçın oyuncusu</td><td class="num">+3</td></tr>
        <tr><td>Sarı kart</td><td class="num">−1</td></tr>
        <tr><td>Kırmızı kart</td><td class="num">−3</td></tr>
        <tr><td>Kendi kalesine gol</td><td class="num">−2</td></tr>
      </table></div>
      <p class="muted small" style="margin-top:8px">Gol yememe puanı, maçı oynayan ve takımı gol yemeden
      bitiren oyunculara verilir. Penaltı golü normal gol gibi sayılır.</p>

      <h3>Ödüller</h3>
      <ul>
        <li><b>Haftanın birincisi</b>: her hafta, o haftanın en yüksek puanını toplayan oyuncu
          sponsorumuzun hediye ettiği ödülü kazanır.</li>
        <li><b>Sezon şampiyonu</b>: sezon sonunda genel sıralamada birinci olan oyuncuya
          sponsorumuz tarafından büyük ödül verilir.</li>
        <li>Eşitlik hâlinde sırasıyla: o hafta daha az transfer cezası alan, ardından kura önde sayılır.</li>
        <li>Ödülü kazananla uygulamaya kayıtlı e-posta üzerinden iletişime geçilir —
          bu yüzden kadronu kaydetmek için giriş yapman gerekir.</li>
      </ul>

      <h3>Mini Ligler</h3>
      <ul>
        <li>Ligler sekmesinden kendi ligini kurabilir, sana özel <b>davet kodunu</b> arkadaşlarınla paylaşabilirsin.</li>
        <li>Genel sıralama tüm oyuncuları kapsar; mini ligler sadece üyelerini sıralar.</li>
      </ul>

      <p class="small" style="margin-top:16px"><a href="#/sartlar"
        style="text-decoration:underline;text-underline-offset:3px">Gizlilik ve Kullanım Koşulları →</a></p>
    </div>`;
}

// ---------------- GİRİŞ / KAYIT ----------------
export async function renderAuth(el) {
  const store = App.store;
  const isDemo = store.mode === 'demo';
  if (!isDemo && store.user()) { location.hash = '#/takimim'; return; }

  let mode = 'login';
  function draw() {
    el.innerHTML = `<div class="card auth-box">
      ${isDemo ? `<p class="small" style="margin-bottom:12px;padding:9px 12px;background:#fafdec;border-radius:9px">
        <b>Önizleme:</b> Demo modunda giriş gerekmez; bu ekran gerçek sürümde aktif olur.</p>` : ''}
      ${mode === 'forgot' ? `
        <h3 style="margin-bottom:6px">Şifreni sıfırla</h3>
        <p class="muted small">Kayıtlı e-posta adresini gir; sana şifre yenileme bağlantısı gönderelim.</p>
        <label>E-posta</label><input id="f-email" type="email" autocomplete="email">
        <button class="btn primary block" id="btn-submit" style="margin-top:16px">Sıfırlama Bağlantısı Gönder</button>
        <button class="btn block" id="btn-back-login" style="margin-top:8px">Girişe dön</button>
      ` : `
      <p class="muted small" style="margin-bottom:12px">Uygulamayı üye olmadan gezebilir ve kadro taslağı
      kurabilirsin. Kadronu <b>kaydetmek</b>, lige katılmak ve ödülleri kazanabilmek için giriş gerekir —
      taslağın kaybolmaz.</p>
      <div class="tabs">
        <button id="tab-login" class="${mode === 'login' ? 'active' : ''}">Giriş Yap</button>
        <button id="tab-signup" class="${mode === 'signup' ? 'active' : ''}">Kayıt Ol</button>
      </div>
      ${mode === 'signup' ? `
        <label>Kullanıcı adı</label><input id="f-username" placeholder="ör. cemal42">
        <label>Fantazi takım adın</label><input id="f-teamname" placeholder="ör. Girne Yıldızları">` : ''}
      <label>E-posta</label><input id="f-email" type="email" autocomplete="email">
      <label>Şifre</label><input id="f-pass" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
      <button class="btn primary block" id="btn-submit" style="margin-top:16px">
        ${mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}</button>
      ${mode === 'login' ? `<button class="btn-link" id="btn-forgot">Şifremi unuttum</button>` : `
        <p class="muted small" style="margin-top:12px;text-align:center">Kayıt Ol'a basarak
        <a href="#/sartlar" style="text-decoration:underline;text-underline-offset:3px"><b>Gizlilik ve
        Kullanım Koşulları</b></a>'nı kabul etmiş olursun.</p>`}
      `}
    </div>`;

    el.querySelector('#tab-login')?.addEventListener('click', () => { mode = 'login'; draw(); });
    el.querySelector('#tab-signup')?.addEventListener('click', () => { mode = 'signup'; draw(); });
    el.querySelector('#btn-forgot')?.addEventListener('click', () => { mode = 'forgot'; draw(); });
    el.querySelector('#btn-back-login')?.addEventListener('click', () => { mode = 'login'; draw(); });

    el.querySelector('#btn-submit').onclick = async () => {
      const email = el.querySelector('#f-email').value.trim();
      try {
        if (mode === 'forgot') {
          if (!email) return toast('E-posta adresini gir.', true);
          if (isDemo) return toast('Önizleme: gerçek sürümde bu adrese sıfırlama bağlantısı gönderilir.');
          await store.resetPassword(email);
          toast('Sıfırlama bağlantısı gönderildi — e-postanı kontrol et (gelmezse spam klasörüne bak).');
          mode = 'login'; draw();
          return;
        }
        if (isDemo) { toast('Demo modunda giriş gerekmez — kadronu doğrudan kurabilirsin.'); return; }
        const pass = el.querySelector('#f-pass').value;
        if (mode === 'login') {
          await store.signIn(email, pass);
          toast('Hoş geldin!');
          location.hash = '#/takimim';
        } else {
          const username = el.querySelector('#f-username').value.trim();
          const teamName = el.querySelector('#f-teamname').value.trim() || 'Takımım';
          if (!username) return toast('Kullanıcı adı girin.', true);
          await store.signUp(email, pass, username, teamName);
          toast('Kayıt tamam! E-postana onay bağlantısı gelmiş olabilir.');
        }
      } catch (e) { toast(e.message, true); }
    };
  }
  draw();
}

// ---------------- GİZLİLİK VE KULLANIM KOŞULLARI ----------------
export async function renderTerms(el) {
  el.innerHTML = `
    <div class="card rules">
      <h2>Gizlilik ve Kullanım Koşulları</h2>
      <p class="muted small" style="margin-bottom:14px">Son güncelleme: 29 Ağustos 2026</p>

      <h3>Hangi verileri topluyoruz?</h3>
      <p>Matcez'e kayıt olurken yalnızca <b>e-posta adresini, kullanıcı adını ve fantazi takım adını</b>
      alırız. Oyun içinde yaptığın seçimler (kadron, transferlerin, katıldığın ligler) hesabınla
      birlikte saklanır. Bunların dışında veri toplamayız; verilerini üçüncü kişilerle paylaşmaz
      ve satmayız.</p>

      <h3>Verilerin nerede ve neden tutuluyor?</h3>
      <p>Verilerin, oyunun çalışması için güvenli bir veritabanı hizmetinde (Supabase) saklanır.
      E-posta adresin yalnızca girişin, şifre sıfırlama ve ödül kazanman hâlinde seninle iletişim
      için kullanılır — reklam listelerine eklenmez.</p>

      <h3>Hesabını silmek istersen</h3>
      <p>İstediğin zaman hesabının ve verilerinin silinmesini talep edebilirsin; resmi iletişim
      kanallarımızdan bize yazman yeterlidir. Talebin makul sürede yerine getirilir.</p>

      <h3>Oyun kuralları ve adil kullanım</h3>
      <ul>
        <li>Matcez <b>ücretsiz, beceri bazlı bir fantazi futbol oyunudur</b>; bahis veya şans oyunu değildir.</li>
        <li>Her oyuncu tek hesapla oynar. Birden fazla hesapla sıralamayı etkilemek, açık/hata istismarı
        ve saldırgan kullanıcı adları hesabın kapatılmasına yol açabilir.</li>
        <li>Uygulamadaki maç ve oyuncu verileri özenle derlenir ancak <b>resmi istatistik niteliği taşımaz</b>;
        puanlar, ilan edilen kesinleşme saatine kadar düzeltilebilir.</li>
        <li>Oyun kurallarını, puanlamayı ve bu koşulları geliştirme amacıyla güncelleyebiliriz;
        önemli değişiklikler uygulama içinden duyurulur.</li>
      </ul>

      <p class="muted small" style="margin-top:14px">Sorular için resmi sosyal medya hesaplarımızdan
      bize ulaşabilirsin.</p>
    </div>`;
}

// ---------------- ŞİFRE YENİLEME ----------------
// Sıfırlama e-postasındaki bağlantıya tıklayan kullanıcı buraya yönlendirilir.
export async function renderPasswordReset(el) {
  const store = App.store;
  el.innerHTML = `<div class="card auth-box">
    <h3 style="margin-bottom:6px">Yeni şifre belirle</h3>
    <p class="muted small">Hesabın için yeni bir şifre seç (en az 6 karakter).</p>
    <label>Yeni şifre</label><input id="p1" type="password" autocomplete="new-password">
    <label>Yeni şifre (tekrar)</label><input id="p2" type="password" autocomplete="new-password">
    <button class="btn primary block" id="btn-save" style="margin-top:16px">Şifreyi Kaydet</button>
  </div>`;

  el.querySelector('#btn-save').onclick = async () => {
    const p1 = el.querySelector('#p1').value, p2 = el.querySelector('#p2').value;
    if (p1.length < 6) return toast('Şifre en az 6 karakter olmalı.', true);
    if (p1 !== p2) return toast('Şifreler eşleşmiyor.', true);
    if (store.mode === 'demo') return toast('Önizleme: gerçek sürümde şifren güncellenir.');
    try {
      await store.updatePassword(p1);
      toast('Şifren güncellendi.');
      location.hash = '#/takimim';
    } catch (e) { toast(e.message, true); }
  };
}

// ---------------- PROFİL ----------------
export async function renderProfile(el) {
  const store = App.store;
  const profile = store.profile();
  const user = store.user();
  if (!profile) { location.hash = '#/giris'; return; }
  const isDemo = store.mode === 'demo';

  el.innerHTML = `
    <div class="card">
      <h2>Hesap</h2>
      <label>E-posta</label>
      <input value="${esc(user?.email ?? '')}" disabled>
      <label>Kullanıcı adı</label>
      <input id="pr-username" value="${esc(profile.username)}" maxlength="24">
      <label>Fantazi takım adın</label>
      <input id="pr-teamname" value="${esc(profile.team_name)}" maxlength="30">
      <button class="btn primary block" id="pr-save" style="margin-top:16px">Kaydet</button>
    </div>

    <div class="card" id="pwa-card" hidden>
      <h2>Uygulama</h2>
      <p class="muted small" style="margin-bottom:12px">Matcez'i telefonuna ekle — tam ekran,
      kendi ikonuyla gerçek bir uygulama gibi açılır.</p>
      <button class="btn green block" id="btn-install">Telefona / Bilgisayara Ekle</button>
    </div>

    <div class="card">
      <h2>Oturum</h2>
      ${isDemo
        ? `<button class="btn danger block" id="pr-reset">Demo verilerini sıfırla</button>`
        : `<button class="btn block" id="pr-logout">Çıkış yap</button>`}
    </div>`;

  el.querySelector('#pr-save').onclick = async () => {
    const username = el.querySelector('#pr-username').value.trim();
    const team_name = el.querySelector('#pr-teamname').value.trim();
    if (!username) return toast('Kullanıcı adı boş olamaz.', true);
    if (!team_name) return toast('Takım adı boş olamaz.', true);
    try {
      await store.updateProfile({ username, team_name });
      toast('Profilin güncellendi.');
      window.dispatchEvent(new Event('auth-changed'));
    } catch (e) {
      toast(e.message.includes('duplicate') || e.message.includes('unique')
        ? 'Bu kullanıcı adı alınmış — başka bir tane dene.' : e.message, true);
    }
  };
  el.querySelector('#pr-logout')?.addEventListener('click', async () => {
    await store.signOut();
    location.hash = '#/';
  });
  el.querySelector('#pr-reset')?.addEventListener('click', () => {
    if (confirm('Demo verileri silinsin mi?')) store.signOut();
  });

  // PWA kurulum düğmesi (tarayıcı destekliyorsa görünür)
  const pwaCard = el.querySelector('#pwa-card');
  if (window.__installPrompt) pwaCard.hidden = false;
  window.addEventListener('beforeinstallprompt', () => { pwaCard.hidden = false; }, { once: true });
  el.querySelector('#btn-install').onclick = async () => {
    const p = window.__installPrompt;
    if (!p) return toast('Tarayıcın şu an kuruluma izin vermiyor — tarayıcı menüsünden "Ana ekrana ekle"yi kullanabilirsin.');
    p.prompt();
    const res = await p.userChoice;
    if (res.outcome === 'accepted') { toast('Matcez eklendi!'); window.__installPrompt = null; }
  };
}
