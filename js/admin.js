import { App, toast, fmtDate, esc } from './app.js';
import { POS_NAMES, POS_ORDER } from './config.js';

const EVENT_COLS = [
  ['played', 'Oynadı', 'cb'],
  ['goal', 'Gol', 'num'],
  ['pen_goal', 'P.Gol', 'num'],
  ['assist', 'Asist', 'num'],
  ['yellow', 'Sarı', 'cb'],
  ['red', 'Kırmızı', 'cb'],
  ['own_goal', 'K.K.', 'num'],
  ['motm', 'MOTM', 'cb'],
];

export async function renderAdmin(el) {
  const store = App.store;
  const profile = store.profile();
  if (!profile?.is_admin) {
    el.innerHTML = '<div class="card"><h2>Yetkisiz</h2><p class="muted">Bu sayfa sadece adminler içindir.</p></div>';
    return;
  }

  let tab = 'haftalar';
  let selGw = null, selFixture = null, playerQuery = '';

  async function draw() {
    const [gws, teams, players] = await Promise.all([
      store.gameweeks(), store.teams(), store.players(),
    ]);
    const tm = new Map(teams.map(t => [t.id, t]));
    if (selGw == null) selGw = (gws.find(g => g.is_current) ?? gws[0])?.id ?? null;

    el.innerHTML = `
      <h2 style="margin-bottom:14px">Admin Paneli</h2>
      <div class="admin-tabs">
        ${[['haftalar', 'Haftalar'], ['fikstur', 'Fikstür & Sonuçlar'], ['olaylar', 'Maç Olayları'],
           ['oyuncular', 'Oyuncular'], ['takimlar', 'Takımlar'], ['puanlar', 'Puan Hesabı'], ['aktar', 'İçe Aktar']]
          .map(([k, l]) => `<button class="btn sm ${tab === k ? 'primary' : ''}" data-tab="${k}">${l}</button>`).join('')}
      </div>
      <div id="admin-body"></div>`;

    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; selFixture = null; draw(); });
    const body = el.querySelector('#admin-body');

    // ---------- HAFTALAR ----------
    if (tab === 'haftalar') {
      body.innerHTML = `<div class="card">
        <h3>Hafta yönetimi</h3>
        <div class="table-wrap"><table>
          <tr><th>No</th><th>Ad</th><th>Son teslim</th><th>Aktif</th><th>Bitti</th><th></th></tr>
          ${gws.map(g => `<tr>
            <td>${g.number}</td>
            <td>${esc(g.name)}</td>
            <td><input type="datetime-local" data-gwdl="${g.id}" value="${toLocalInput(g.deadline)}" style="width:auto"></td>
            <td><input type="radio" name="gw-current" data-gwcur="${g.id}" ${g.is_current ? 'checked' : ''}></td>
            <td>${g.is_finished ? '✅' : '—'}</td>
            <td><button class="btn sm" data-gwsave="${g.id}">Kaydet</button></td>
          </tr>`).join('')}
        </table></div>
        <h3 style="margin-top:18px">Yeni hafta ekle</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <div><label>Hafta no</label><input id="ngw-no" type="number" style="width:90px" value="${(gws.at(-1)?.number ?? 0) + 1}"></div>
          <div><label>Son teslim</label><input id="ngw-dl" type="datetime-local" style="width:auto"></div>
          <button class="btn green" id="ngw-add">Ekle</button>
        </div>
      </div>`;

      body.querySelectorAll('[data-gwsave]').forEach(b => b.onclick = async () => {
        const id = Number(b.dataset.gwsave);
        const g = gws.find(x => x.id === id);
        const dl = body.querySelector(`[data-gwdl="${id}"]`).value;
        const cur = body.querySelector(`[data-gwcur="${id}"]`).checked;
        await store.upsertGameweek({ ...g, deadline: new Date(dl).toISOString(), is_current: cur });
        toast('Hafta güncellendi.'); draw();
      });
      body.querySelector('#ngw-add').onclick = async () => {
        const no = Number(body.querySelector('#ngw-no').value);
        const dl = body.querySelector('#ngw-dl').value;
        if (!no || !dl) return toast('Hafta no ve son teslim tarihi gerekli.', true);
        await store.upsertGameweek({
          number: no, name: `${no}. Hafta`,
          deadline: new Date(dl).toISOString(), is_current: false, is_finished: false,
        });
        toast('Hafta eklendi.'); draw();
      };
    }

    // ---------- FİKSTÜR ----------
    if (tab === 'fikstur') {
      const fixtures = selGw ? await store.fixtures(selGw) : [];
      body.innerHTML = `<div class="card">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">Fikstür</h3>
          <select id="fx-gw" style="width:auto">${gws.map(g =>
            `<option value="${g.id}" ${g.id === selGw ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
        </div>
        <div class="table-wrap"><table>
          <tr><th>Ev</th><th>Skor</th><th>Dep</th><th>Tarih</th><th>Durum</th><th></th></tr>
          ${fixtures.map(f => `<tr>
            <td>${esc(tm.get(f.home_id)?.name)}</td>
            <td><input type="number" min="0" data-hs="${f.id}" value="${f.home_score ?? ''}" style="width:52px"> -
                <input type="number" min="0" data-as="${f.id}" value="${f.away_score ?? ''}" style="width:52px"></td>
            <td>${esc(tm.get(f.away_id)?.name)}</td>
            <td class="small muted">${fmtDate(f.kickoff)}</td>
            <td><select data-st="${f.id}" style="width:auto">
              ${['scheduled', 'finished', 'postponed'].map(s =>
                `<option value="${s}" ${f.status === s ? 'selected' : ''}>${{ scheduled: 'Oynanacak', finished: 'Bitti', postponed: 'Ertelendi' }[s]}</option>`).join('')}
            </select></td>
            <td><button class="btn sm" data-fxsave="${f.id}">Kaydet</button></td>
          </tr>`).join('')}
        </table></div>
        <h3 style="margin-top:18px">Maç ekle</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <div><label>Ev sahibi</label><select id="nfx-home" style="width:auto">${teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
          <div><label>Deplasman</label><select id="nfx-away" style="width:auto">${teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
          <div><label>Tarih</label><input id="nfx-ko" type="datetime-local" style="width:auto"></div>
          <button class="btn green" id="nfx-add">Ekle</button>
        </div>
      </div>`;

      body.querySelector('#fx-gw').onchange = (e) => { selGw = Number(e.target.value); draw(); };
      body.querySelectorAll('[data-fxsave]').forEach(b => b.onclick = async () => {
        const id = Number(b.dataset.fxsave);
        const f = fixtures.find(x => x.id === id);
        const hs = body.querySelector(`[data-hs="${id}"]`).value;
        const as = body.querySelector(`[data-as="${id}"]`).value;
        const st = body.querySelector(`[data-st="${id}"]`).value;
        await store.upsertFixture({
          ...f,
          home_score: hs === '' ? null : Number(hs),
          away_score: as === '' ? null : Number(as),
          status: st,
        });
        toast('Maç güncellendi.');
      });
      body.querySelector('#nfx-add').onclick = async () => {
        const home = Number(body.querySelector('#nfx-home').value);
        const away = Number(body.querySelector('#nfx-away').value);
        const ko = body.querySelector('#nfx-ko').value;
        if (home === away) return toast('Aynı takım iki tarafta olamaz.', true);
        await store.upsertFixture({
          id: -Date.now(), gw_id: selGw, home_id: home, away_id: away,
          kickoff: ko ? new Date(ko).toISOString() : null,
          home_score: null, away_score: null, status: 'scheduled',
        });
        toast('Maç eklendi.'); draw();
      };
    }

    // ---------- MAÇ OLAYLARI ----------
    if (tab === 'olaylar') {
      const fixtures = selGw ? await store.fixtures(selGw) : [];
      const fx = fixtures.find(f => f.id === selFixture) ?? null;
      let gridHtml = '<p class="muted">Bir maç seçin.</p>';

      if (fx) {
        const events = await store.events(selGw);
        const fxEvents = events.filter(e => e.fixture_id === fx.id);
        const evMap = {};
        fxEvents.forEach(e => { evMap[`${e.player_id}:${e.event_type}`] = e.qty; });
        const matchPlayers = players
          .filter(p => p.teamId === fx.home_id || p.teamId === fx.away_id)
          .sort((a, b) => (a.teamId - b.teamId) || POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos));

        gridHtml = `
          <p class="small muted" style="margin-bottom:8px">Hızlı yol: gol atanları scraper/içe aktarma doldurur;
          burada "Oynadı" işaretleri ve kartları girmen yeterli. Oynadı işaretlenmeyen oyuncu maç puanı ve gol yememe puanı almaz.</p>
          <div class="table-wrap"><table class="event-grid">
            <tr><th>Oyuncu</th>${EVENT_COLS.map(([, l]) => `<th class="num">${l}</th>`).join('')}</tr>
            ${matchPlayers.map(p => `<tr>
              <td><span class="team-dot" style="background:${tm.get(p.teamId)?.color}"></span>
                <b>${esc(p.name)}</b> <span class="pill ${p.pos}">${p.pos}</span></td>
              ${EVENT_COLS.map(([type, , kind]) => {
                const v = evMap[`${p.id}:${type}`] ?? 0;
                return kind === 'cb'
                  ? `<td class="num"><input type="checkbox" data-ev="${p.id}:${type}" ${v ? 'checked' : ''}></td>`
                  : `<td class="num"><input type="number" min="0" max="9" data-ev="${p.id}:${type}" value="${v || ''}"></td>`;
              }).join('')}
            </tr>`).join('')}
          </table></div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn primary" id="ev-save">Olayları Kaydet</button>
            <button class="btn sm" id="ev-mark-all">Tümünü "Oynadı" işaretle</button>
          </div>`;
      }

      body.innerHTML = `<div class="card">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <h3 style="margin:0">Maç olayları</h3>
          <select id="ev-gw" style="width:auto">${gws.map(g =>
            `<option value="${g.id}" ${g.id === selGw ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
          <select id="ev-fx" style="width:auto">
            <option value="">Maç seçin…</option>
            ${fixtures.map(f => `<option value="${f.id}" ${f.id === selFixture ? 'selected' : ''}>
              ${esc(tm.get(f.home_id)?.short)} - ${esc(tm.get(f.away_id)?.short)}
              ${f.status === 'finished' ? `(${f.home_score}-${f.away_score})` : ''}</option>`).join('')}
          </select>
        </div>
        ${gridHtml}
      </div>`;

      body.querySelector('#ev-gw').onchange = (e) => { selGw = Number(e.target.value); selFixture = null; draw(); };
      body.querySelector('#ev-fx').onchange = (e) => { selFixture = Number(e.target.value) || null; draw(); };

      if (fx) {
        body.querySelector('#ev-mark-all').onclick = () => {
          body.querySelectorAll('[data-ev]').forEach(inp => {
            if (inp.dataset.ev.endsWith(':played') && inp.type === 'checkbox') inp.checked = true;
          });
        };
        body.querySelector('#ev-save').onclick = async () => {
          const rows = [];
          body.querySelectorAll('[data-ev]').forEach(inp => {
            const [pid, type] = inp.dataset.ev.split(':');
            const qty = inp.type === 'checkbox' ? (inp.checked ? 1 : 0) : Number(inp.value || 0);
            if (qty > 0) rows.push({ player_id: Number(pid), event_type: type, qty });
          });
          try {
            await store.saveFixtureEvents(fx.id, rows);
            toast(`${rows.length} olay kaydedildi.`);
          } catch (e) { toast(e.message, true); }
        };
      }
    }

    // ---------- OYUNCULAR ----------
    if (tab === 'oyuncular') {
      const q = playerQuery.toLocaleLowerCase('tr');
      const list = players
        .filter(p => !q || p.name.toLocaleLowerCase('tr').includes(q) || tm.get(p.teamId)?.name.toLocaleLowerCase('tr').includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
        .slice(0, 60);

      body.innerHTML = `<div class="card">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <h3 style="margin:0">Oyuncular (${players.length})</h3>
          <input id="pq" placeholder="Oyuncu / takım ara…" value="${esc(playerQuery)}" style="max-width:260px">
        </div>
        <div class="table-wrap"><table>
          <tr><th>Oyuncu</th><th>Takım</th><th>Poz</th><th>Fiyat</th><th></th></tr>
          ${list.map(p => `<tr ${p.pos_guess ?? p.posGuess ? 'style="background:#2a2410"' : ''}>
            <td><b>${esc(p.name)}</b>${(p.pos_guess ?? p.posGuess) ? ' <span class="small muted">poz. tahmini</span>' : ''}</td>
            <td class="small">${esc(tm.get(p.teamId)?.name)}</td>
            <td><select data-ppos="${p.id}" style="width:auto">
              ${POS_ORDER.map(x => `<option value="${x}" ${p.pos === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
            <td><input type="number" step="0.5" min="3" max="15" data-pprice="${p.id}" value="${p.price}" style="width:74px"></td>
            <td><button class="btn sm" data-psave="${p.id}">Kaydet</button></td>
          </tr>`).join('')}
        </table></div>
        <h3 style="margin-top:18px">Oyuncu ekle</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <div><label>İsim</label><input id="np-name" style="width:200px"></div>
          <div><label>Takım</label><select id="np-team" style="width:auto">${teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
          <div><label>Poz</label><select id="np-pos" style="width:auto">${POS_ORDER.map(x => `<option value="${x}">${POS_NAMES[x]}</option>`).join('')}</select></div>
          <div><label>Fiyat</label><input id="np-price" type="number" step="0.5" value="5.0" style="width:80px"></div>
          <button class="btn green" id="np-add">Ekle</button>
        </div>
      </div>`;

      const pq = body.querySelector('#pq');
      pq.oninput = () => { playerQuery = pq.value; clearTimeout(pq._t); pq._t = setTimeout(draw, 300); };
      body.querySelectorAll('[data-psave]').forEach(b => b.onclick = async () => {
        const id = Number(b.dataset.psave);
        const p = players.find(x => x.id === id);
        await store.upsertPlayers([{
          ...p, team_id: p.teamId,
          pos: body.querySelector(`[data-ppos="${id}"]`).value,
          price: Number(body.querySelector(`[data-pprice="${id}"]`).value),
          pos_guess: false,
        }]);
        toast('Oyuncu güncellendi.');
      });
      body.querySelector('#np-add').onclick = async () => {
        const name = body.querySelector('#np-name').value.trim();
        if (!name) return toast('İsim girin.', true);
        await store.upsertPlayers([{
          id: -Date.now(),
          name, team_id: Number(body.querySelector('#np-team').value),
          pos: body.querySelector('#np-pos').value,
          price: Number(body.querySelector('#np-price').value || 5),
          pos_guess: false, active: true,
        }]);
        toast('Oyuncu eklendi.'); draw();
      };
    }

    // ---------- TAKIMLAR ----------
    if (tab === 'takimlar') {
      body.innerHTML = `<div class="card">
        <h3>Takımlar ve forma renkleri</h3>
        <p class="muted small" style="margin-bottom:10px">1. renk forma gövdesi, 2. renk kollardır.
        Renkler tahmini girildi — gerçek kulüp renklerine göre düzeltebilirsiniz.</p>
        <div class="table-wrap"><table>
          <tr><th>Takım</th><th>Kısa</th><th>1. Renk</th><th>2. Renk</th><th></th></tr>
          ${teams.map(t => `<tr>
            <td><input data-tname="${t.id}" value="${esc(t.name)}" style="min-width:170px"></td>
            <td><input data-tshort="${t.id}" value="${esc(t.short)}" style="width:64px"></td>
            <td><input type="color" data-tc1="${t.id}" value="${t.color}" style="width:44px;height:34px;padding:2px"></td>
            <td><input type="color" data-tc2="${t.id}" value="${t.color2 ?? '#ffffff'}" style="width:44px;height:34px;padding:2px"></td>
            <td><button class="btn sm" data-tsave="${t.id}">Kaydet</button></td>
          </tr>`).join('')}
        </table></div>
      </div>`;

      body.querySelectorAll('[data-tsave]').forEach(b => b.onclick = async () => {
        const id = Number(b.dataset.tsave);
        await store.upsertTeams([{
          id,
          name: body.querySelector(`[data-tname="${id}"]`).value.trim(),
          short: body.querySelector(`[data-tshort="${id}"]`).value.trim(),
          color: body.querySelector(`[data-tc1="${id}"]`).value,
          color2: body.querySelector(`[data-tc2="${id}"]`).value,
        }]);
        toast('Takım güncellendi.');
      });
    }

    // ---------- PUAN HESABI ----------
    if (tab === 'puanlar') {
      body.innerHTML = `<div class="card">
        <h3>Hafta puanlarını hesapla</h3>
        <p class="muted small" style="margin-bottom:12px">Maç sonuçları ve olaylar girildikten sonra çalıştırın.
        Tüm kullanıcıların hafta puanları hesaplanır ve hafta "bitti" olarak işaretlenir. Tekrar çalıştırmak puanları günceller.</p>
        ${gws.map(g => `<div class="fixture-row">
          <span class="tname">${esc(g.name)} ${g.is_finished ? '✅' : ''}</span>
          <span class="muted small">son teslim: ${fmtDate(g.deadline)}</span>
          <button class="btn sm primary" data-compute="${g.id}">Puanları Hesapla</button>
        </div>`).join('')}
      </div>`;

      body.querySelectorAll('[data-compute]').forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = 'Hesaplanıyor…';
        try {
          const n = await store.computePoints(Number(b.dataset.compute));
          toast(`Puanlar hesaplandı (${n ?? 'ok'}).`);
        } catch (e) { toast(e.message, true); }
        draw();
      });
    }

    // ---------- İÇE AKTAR ----------
    if (tab === 'aktar') {
      body.innerHTML = `<div class="card">
        <h3>JSON içe aktar</h3>
        <p class="muted small">Scraper çıktısını (<code>scraper/</code> klasörüne bakın) veya elle hazırlanmış veriyi yapıştırın.
        Format: <code>{"teams":[], "players":[], "gameweeks":[], "fixtures":[], "events":[]}</code> — hepsi isteğe bağlı, olanlar güncellenir.</p>
        <textarea id="imp-json" rows="12" style="font-family:monospace;font-size:12px;margin-top:10px"
          placeholder='{"fixtures":[{"id":123,"gw_id":1,"home_id":930682,"away_id":280558,"home_score":2,"away_score":1,"status":"finished"}],"events":[{"fixture_id":123,"player_id":1127613,"event_type":"goal","qty":2}]}'></textarea>
        <div style="margin-top:10px"><button class="btn primary" id="imp-btn">İçe Aktar</button></div>
      </div>`;

      body.querySelector('#imp-btn').onclick = async () => {
        try {
          const bundle = JSON.parse(body.querySelector('#imp-json').value);
          await store.importBundle(bundle);
          toast('Veri içe aktarıldı.');
        } catch (e) { toast('Hata: ' + e.message, true); }
      };
    }
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  await draw();
}
