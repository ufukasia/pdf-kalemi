// Tarayıcı / yüklenebilir web uygulaması (PWA) sürümü.
// Masaüstünde preload.js'in verdiği window.desktop köprüsünün web karşılığıdır; Electron'da hiçbir şey yapmaz.
(() => {
'use strict';
if (window.desktop) return;
document.documentElement.classList.add('web');
// Android uygulaması (Capacitor): kaydetme/paylaşma, dışarıdan gelen PDF'ler, klasörler, bağlantılar ve geri tuşu
// yerel köprüyle yapılır. Tarayıcıda CAP boştur ve aşağıdaki web yolları kullanılır.
const CAP = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? window.Capacitor.Plugins : null;
if (CAP) document.documentElement.classList.add('android-app');
function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
// Android: dosyayı uygulamanın önbelleğine yazıp paylaş menüsünü açar (OneDrive, Drive, Claude, ChatGPT...).
async function shareFile(bytes, name, title) {
  const w = await CAP.Filesystem.writeFile({ path: name, data: toB64(bytes), directory: 'CACHE' });
  try { await CAP.Share.share({ title, dialogTitle: title, files: [w.uri] }); return true; }
  catch (e) { if (/cancel/i.test(String(e && e.message))) return false; throw e; }
}

/* ---------- Depolama: küçük durum localStorage'da, çizimler ve dosya kopyaları IndexedDB'de ---------- */
const LS_STATE = 'pdfkalemi:durum';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('pdf-kalemi', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['kv', 'files', 'dirs']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function get(store, key) { const d = await db(); return req(d.transaction(store).objectStore(store).get(key)); }
async function put(store, key, val) { const d = await db(); return req(d.transaction(store, 'readwrite').objectStore(store).put(val, key)); }
async function del(store, key) { const d = await db(); return req(d.transaction(store, 'readwrite').objectStore(store).delete(key)); }
async function keys(store) { const d = await db(); return req(d.transaction(store).objectStore(store).getAllKeys()); }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// Cihazdan açılan PDF'ler son açılanlardan yeniden açılabilsin diye kopyası saklanır (en eski silinir).
const MAX_FILES = 40, MAX_BYTES = 600e6;
async function remember(path, name, bytes) {
  try {
    await put('files', path, { name, bytes });
    const meta = (await get('kv', 'filesMeta')) || {};
    meta[path] = { at: Date.now(), size: bytes.length };
    const list = Object.entries(meta).sort((a, b) => b[1].at - a[1].at);
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      total += list[i][1].size;
      if (i >= MAX_FILES || total > MAX_BYTES) { await del('files', list[i][0]); delete meta[list[i][0]]; }
    }
    await put('kv', 'filesMeta', meta);
  } catch (e) { console.error('Dosya kopyası saklanamadı', e); }
}
const filePath = (f) => 'cihaz/' + (f.size || 0) + '-' + (f.lastModified || 0) + '/' + f.name;
async function fileResult(f) { const bytes = new Uint8Array(await f.arrayBuffer()); const path = filePath(f); remember(path, f.name, bytes); return { path, name: f.name, bytes }; }

function pickFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf';
    inp.addEventListener('change', () => resolve(inp.files[0] || null));
    inp.addEventListener('cancel', () => resolve(null));
    inp.click();
  });
}

/* ---------- Klasörler (bilgisayar tarayıcılarında; Android'de OneDrive aşamasında gelecek) ---------- */
const coll = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
async function dirHandle(id) { try { return await get('dirs', id); } catch (e) { return null; } }
async function readFromFolder(path) {
  const parts = path.split('/'), id = parts.slice(0, 3).join('/'), rest = parts.slice(3);
  const h = await dirHandle(id); if (!h) return null;
  if ((await h.queryPermission({ mode: 'read' })) !== 'granted' && (await h.requestPermission({ mode: 'read' })) !== 'granted') return null;
  let d = h;
  for (const seg of rest.slice(0, -1)) d = await d.getDirectoryHandle(seg);
  const f = await (await d.getFileHandle(rest[rest.length - 1])).getFile();
  return { path, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

// Android: klasörler Android'in klasör seçicisiyle eklenir; dosya adresleri (içerik URI'leri) burada tutulur.
const docUris = {};
async function capList(id) {
  const rec = await dirHandle(id); if (!rec || !rec.uri) return { missing: true, files: [] };
  const r = await CAP.PdfKalemi.listPdfs({ uri: rec.uri });
  if (r.missing) return { missing: true, files: [] };
  const files = (r.files || []).map((f) => { const path = id + '/' + (f.rel ? f.rel + '/' : '') + f.name; docUris[path] = f.uri; return { path, name: f.name, rel: f.rel }; });
  files.sort((a, b) => coll.compare(a.rel, b.rel) || coll.compare(a.name, b.name));
  return { files, truncated: !!r.truncated };
}
async function capReadFromFolder(path) {
  if (!docUris[path]) await capList(path.split('/').slice(0, 3).join('/'));
  const uri = docUris[path]; if (!uri) return null;
  const r = await CAP.PdfKalemi.readFile({ uri, name: path.split('/').pop() });
  return { path, name: r.name, bytes: fromB64(r.data) };
}

/* ---------- Dosya ile açılış (yüklü uygulamada PDF'e çift tıklama; Android'de "Birlikte aç" / "Paylaş") ---------- */
let openCb = null, launched = null, started = false, takeP = null;
if (CAP && CAP.PdfKalemi) {
  const take = async () => {
    try {
      const r = await CAP.PdfKalemi.takePending(); if (!r || !r.data) return;
      const bytes = fromB64(r.data), path = 'cihaz/' + bytes.length + '-0/' + r.name;
      remember(path, r.name, bytes);
      const f = { path, name: r.name, bytes };
      if (started && openCb) openCb(f); else launched = f;
    } catch (e) { console.error(e); }
  };
  takeP = take();
  CAP.PdfKalemi.addListener('pdfOpen', take);
}
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    try { const r = await fileResult(await params.files[0].getFile()); if (started && openCb) openCb(r); else launched = r; } catch (e) { console.error(e); }
  });
}

window.desktop = {
  web: true,
  canPickFolder: !!(CAP || window.showDirectoryPicker),
  // Android: görüntü/PDF'i paylaş menüsüyle başka uygulamaya verir (aktar balonu kullanır).
  shareFile: CAP ? shareFile : undefined,
  async openPdf() { const f = await pickFile(); return f ? fileResult(f) : null; },
  async savePdf(bytes, defaultPath) {
    const name = String(defaultPath || 'cizili.pdf').split(/[\\/]/).pop();
    if (CAP) return (await shareFile(bytes, name, name)) ? { path: name } : null;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    // Telefon/tablet: paylaş menüsü (OneDrive, Drive, WhatsApp, Dosyalar...)
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare) {
      const file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return { path: name }; } catch (e) { if (e.name === 'AbortError') return null; }
      }
    }
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close(); return { path: h.name };
      } catch (e) { if (e.name === 'AbortError') return null; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
    return { path: name };
  },
  async getInitialFile() { await new Promise((r) => setTimeout(r, 150)); if (takeP) await takeP; started = true; const r = launched; launched = null; return r; },
  confirmDiscard: async () => true,
  async readPdf(p) {
    if (typeof p !== 'string') return null;
    try {
      if (p.startsWith('klasor/')) return CAP ? await capReadFromFolder(p) : await readFromFolder(p);
      const rec = await get('files', p);
      return rec ? { path: p, name: rec.name, bytes: rec.bytes } : null;
    } catch (e) { console.error(e); return null; }
  },
  rememberFile(p, name, bytes) { if (typeof p === 'string' && p.startsWith('cihaz/')) remember(p, name, bytes); },
  async loadState() { try { return JSON.parse(localStorage.getItem(LS_STATE) || 'null'); } catch (e) { return null; } },
  async saveState(s) { try { localStorage.setItem(LS_STATE, JSON.stringify(s)); } catch (e) { console.error(e); } return true; },
  saveStateSync(s) { try { localStorage.setItem(LS_STATE, JSON.stringify(s)); } catch (e) {} return true; },
  async loadInk(key) { try { return (await get('kv', 'ink:' + key)) || null; } catch (e) { return null; } },
  async saveInk(key, json) { try { await put('kv', 'ink:' + key, json); } catch (e) { console.error(e); } return true; },
  saveInkSync(key, json) { put('kv', 'ink:' + key, json).catch(() => {}); return true; },
  onOpenFile(cb) { openCb = cb; },
  pathOf(file) { return file && file.name ? filePath(file) : ''; },
  async openExternal(url) {
    if (CAP && /^https?:/i.test(url)) { CAP.Browser.open({ url }).catch((e) => console.error(e)); return true; }
    if (/^(https?:|mailto:)/i.test(url)) window.open(url, '_blank', 'noopener'); return true;
  },
  async openDefaultApps() { return { web: true }; },
  async pickFolder() {
    if (CAP) {
      const r = await CAP.PdfKalemi.pickFolder(); if (!r || !r.uri) return null;
      for (const id of await keys('dirs')) { const o = await dirHandle(id); if (o && o.uri === r.uri) return id; }
      const id = 'klasor/' + Math.random().toString(36).slice(2, 8) + '/' + String(r.name || 'Klasör').replace(/\//g, '_');
      await put('dirs', id, { uri: r.uri }); return id;
    }
    if (!window.showDirectoryPicker) return null;
    let h; try { h = await window.showDirectoryPicker({ mode: 'read' }); } catch (e) { return null; }
    for (const id of await keys('dirs')) { const o = await dirHandle(id); if (o && await o.isSameEntry(h)) return id; }
    const id = 'klasor/' + Math.random().toString(36).slice(2, 8) + '/' + h.name;
    await put('dirs', id, h); return id;
  },
  async grantFolder(id) { if (CAP) return true; const h = await dirHandle(id); return !!h && (await h.requestPermission({ mode: 'read' })) === 'granted'; },
  async listPdfs(id) {
    if (CAP) { try { return await capList(id); } catch (e) { console.error(e); return { missing: true, files: [] }; } }
    const h = await dirHandle(id); if (!h) return { missing: true, files: [] };
    try { if ((await h.queryPermission({ mode: 'read' })) !== 'granted') return { needsPermission: true, files: [] }; } catch (e) { return { missing: true, files: [] }; }
    const files = [], MAX = 1500;
    async function walk(d, rel, depth) {
      for await (const [name, e] of d.entries()) {
        if (files.length >= MAX) return;
        if (name.startsWith('.') || name.startsWith('~$')) continue;
        if (e.kind === 'directory') { if (depth < 4) await walk(e, rel ? rel + '/' + name : name, depth + 1); }
        else if (/\.pdf$/i.test(name)) files.push({ path: id + '/' + (rel ? rel + '/' : '') + name, name, rel });
      }
    }
    try { await walk(h, '', 0); } catch (e) { return { missing: true, files: [] }; }
    files.sort((a, b) => coll.compare(a.rel, b.rel) || coll.compare(a.name, b.name));
    return { files, truncated: files.length >= MAX };
  }
};

// Android: sayfadaki dış bağlantılar uygulama içi tarayıcıda açılır; geri tuşu önce açık paneli kapatır.
if (CAP) {
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="http"]'); if (!a) return;
    e.preventDefault(); window.desktop.openExternal(a.href);
  }, true);
  if (CAP.App) CAP.App.addListener('backButton', () => {
    const q = (s) => document.querySelector(s), A = window.__app;
    if (q('#aiPanel:not([hidden])')) { q('#aiClose').click(); return; }
    if (q('#gotoBox:not([hidden])')) { q('#gotoBox').hidden = true; return; }
    const curtainOpen = q('#curtain.open') && !(A && A.state.pinBar);
    if (q('.side.open, .sheet.open') || curtainOpen || (A && A.getSel && A.getSel())) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return; }
    CAP.App.minimizeApp();
  });
}

// Çevrimdışı çalışma ve "uygulama olarak yükle" için servis çalışanı (Android uygulamasında gerekmez: dosyalar zaten içinde)
if (!CAP && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.error('Servis çalışanı', e)));
}
})();
