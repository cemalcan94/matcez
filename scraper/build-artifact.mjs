#!/usr/bin/env node
// Matcez — tek dosyalık yayın paketi üretici.
// Uygulamayı (CSS + tüm JS modülleri) tek bir HTML dosyasında birleştirir;
// çıktı claude.ai artifact'ına veya herhangi bir statik hosta yüklenebilir.
// Kullanım: node build-artifact.mjs [çıktıYolu]   (varsayılan: ./matcez-dist.html)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'matcez-dist.html');

const css = readFileSync(join(root, 'css/style.css'), 'utf8');
const order = ['config', 'seed-data', 'jersey', 'points', 'store', 'views', 'squad', 'admin', 'app'];
let js = '';
for (const name of order) {
  let src = readFileSync(join(root, `js/${name}.js`), 'utf8');
  src = src.split('\n').filter(l => !/^import /.test(l.trim())).join('\n');
  src = src.replace(/^export (async function|function|const|let)/gm, '$1');
  js += `\n// ===== ${name}.js =====\n` + src + '\n';
}

const shim = `
function __memStore(){ const m=new Map(); return {
  getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)),
  removeItem:k=>m.delete(k), clear:()=>m.clear() }; }
let localStorage, sessionStorage;
try { window.localStorage.getItem('__t'); localStorage = window.localStorage; } catch { localStorage = __memStore(); }
try { window.sessionStorage.getItem('__t'); sessionStorage = window.sessionStorage; } catch { sessionStorage = __memStore(); }
`;

const bodyHtml = readFileSync(join(root, 'index.html'), 'utf8')
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script type="module" src="js\/app.js"><\/script>/, '')
  .trim();

const html = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Matcez</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Archivo:wght@600;700;800;900&display=swap" rel="stylesheet">
<style>
${css}
</style>
${bodyHtml}
<script type="module">
${shim}
${js}
</script>
`;

writeFileSync(out, html);
console.log(`yazıldı: ${out} (${(html.length / 1024).toFixed(0)}KB)`);
