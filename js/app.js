import { createStore } from './store.js';
import { renderHome, renderLeagues, renderAuth, renderRules, renderPlayer, renderProfile, renderPasswordReset, renderTerms } from './views.js';
import { renderPickTeam, renderTransfers, renderTransferSelect, renderPoints } from './squad.js';
import { renderAdmin } from './admin.js';

export const App = {
  store: null,
  el: null,
  cache: {},
};

export function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3200);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Misafirler her sayfayı gezebilir ve kadro taslağı kurabilir;
// giriş yalnızca kaydetme anında (mustLogin ile) istenir.
const routes = {
  '': { key: 'home', fn: renderHome, title: 'Matcez' },
  'takimim': { key: 'squad', fn: renderPickTeam, title: 'Takımım' },
  'puanlar': { key: 'points', fn: renderPoints, title: 'Puanlar' },
  'transferler': { key: 'transfers', fn: renderTransfers, title: 'Transferler' },
  'transferler/sec': { key: 'transfers', fn: renderTransferSelect, title: 'Oyuncu Seç' },
  'kurallar': { key: 'rules', fn: renderRules, title: 'Kurallar' },
  'oyuncu': { key: 'player', fn: renderPlayer, title: 'Oyuncu' },
  'fikstur': { key: 'home', fn: renderHome, title: 'Matcez' },
  'ligler': { key: 'leagues', fn: renderLeagues, title: 'Ligler' },
  'admin': { key: 'admin', fn: renderAdmin, title: 'Admin', needsAuth: true },
  'giris': { key: 'auth', fn: renderAuth, title: 'Giriş' },
  'profil': { key: 'profile', fn: renderProfile, title: 'Profil' },
  'sifre-yenile': { key: 'auth', fn: renderPasswordReset, title: 'Şifre Yenile' },
  'sartlar': { key: 'rules', fn: renderTerms, title: 'Koşullar' },
};

// Giriş gerektiren bir eylem öncesi kontrol: misafirse giriş sayfasına yönlendirir.
export function mustLogin(msg = 'Kadron kaybolmasın — kaydetmek için giriş yap.') {
  if (App.store.user()) return false;
  toast(msg, true);
  location.hash = '#/giris';
  return true;
}

async function render() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  const route = routes[hash] ?? routes[''];

  document.querySelectorAll('#main-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route.key);
  });
  setHead(`<h1 class="ph-title">${route.title}</h1>`);

  const el = App.el;
  el.dataset.route = route.key;
  el.classList.remove('has-actionbar');
  document.querySelectorAll('.actionbar').forEach(n => n.remove());
  el.innerHTML = '<p class="muted" style="padding:30px;text-align:center">Yükleniyor…</p>';

  try {
    if (route.needsAuth && !App.store.user()) {
      renderAuth(el);
      return;
    }
    await route.fn(el);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="card"><h3>Bir hata oluştu</h3>
      <p class="muted">${esc(err.message)}</p></div>`;
  }
}

// Siyah sayfa başlığı bölgesi — sayfalar zengin içerik basabilir
export function setHead(html) {
  document.getElementById('page-head').innerHTML = html;
}

// Aksiyon çubuğu: sayfalar kendi kaydet/onayla çubuğunu buraya kurar
export function setActionBar(html) {
  document.querySelectorAll('.actionbar').forEach(n => n.remove());
  if (!html) { App.el.classList.remove('has-actionbar'); return null; }
  const bar = document.createElement('div');
  bar.className = 'actionbar';
  bar.innerHTML = html;
  document.querySelector('.app').appendChild(bar);
  App.el.classList.add('has-actionbar');
  return bar;
}

const ICONS = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4L9.8 5.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4H6v16h9"/><path d="M11 12h10"/><path d="m17 8 4 4-4 4"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
};

function renderAuthArea() {
  const area = document.getElementById('auth-area');
  const profile = App.store.profile();
  const user = App.store.user();

  let html = `<a class="iconbtn" href="#/kurallar" title="Kurallar">${ICONS.info}</a>`;
  if (profile?.is_admin) {
    html += `<a class="iconbtn" href="#/admin" title="Admin">${ICONS.gear}</a>`;
  }
  if (App.store.mode === 'demo' || user) {
    html += `<a class="iconbtn" href="#/profil" title="Profil">${ICONS.person}</a>`;
    if (App.store.mode === 'demo') html += `<a class="btn sm primary" href="#/giris">Giriş</a>`;
  } else {
    html += `<a class="btn sm primary" href="#/giris">Giriş</a>`;
  }
  area.innerHTML = html;
}

async function main() {
  App.el = document.getElementById('view');
  App.store = await createStore();

  renderAuthArea();

  window.addEventListener('hashchange', render);
  window.addEventListener('auth-changed', () => { renderAuthArea(); render(); });
  render();
}

main().catch((err) => {
  // Uygulama açılışta çökerse asla boş ekran bırakma
  console.error(err);
  const el = document.getElementById('view');
  if (el) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:32px 20px">
      <h3 style="font-size:16px">Bir şeyler ters gitti</h3>
      <p class="muted small" style="margin:8px 0 16px">Sayfa yüklenirken bir sorun oluştu.
      Yenilemek genellikle çözer.</p>
      <button class="btn primary block" onclick="location.reload()">Yenile</button>
    </div>`;
  }
});
