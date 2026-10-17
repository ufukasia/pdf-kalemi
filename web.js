// Tarayıcı / yüklenebilir web uygulaması (PWA) sürümü.
// Masaüstünde preload.js'in verdiği window.desktop köprüsünün web karşılığıdır; Electron'da hiçbir şey yapmaz.
(() => {
'use strict';
if (window.desktop) return;
document.documentElement.classList.add('web');

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

/* ---------- Dosya ile açılış (yüklü uygulamada PDF'e çift tıklama) ---------- */
let openCb = null, launched = null, started = false;
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    try { const r = await fileResult(await params.files[0].getFile()); if (started && openCb) openCb(r); else launched = r; } catch (e) { console.error(e); }
  });
}

window.desktop = {
  web: true,
  canPickFolder: !!window.showDirectoryPicker,
  async openPdf() { const f = await pickFile(); return f ? fileResult(f) : null; },
  async savePdf(bytes, defaultPath) {
    const name = String(defaultPath || 'cizili.pdf').split(/[\\/]/).pop();
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
  async getInitialFile() { await new Promise((r) => setTimeout(r, 150)); started = true; const r = launched; launched = null; return r; },
  confirmDiscard: async () => true,
  async readPdf(p) {
    if (typeof p !== 'string') return null;
    try {
      if (p.startsWith('klasor/')) return await readFromFolder(p);
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
  async openExternal(url) { if (/^(https?:|mailto:)/i.test(url)) window.open(url, '_blank', 'noopener'); return true; },
  async openDefaultApps() { return { web: true }; },
  async pickFolder() {
    if (!window.showDirectoryPicker) return null;
    let h; try { h = await window.showDirectoryPicker({ mode: 'read' }); } catch (e) { return null; }
    for (const id of await keys('dirs')) { const o = await dirHandle(id); if (o && await o.isSameEntry(h)) return id; }
    const id = 'klasor/' + Math.random().toString(36).slice(2, 8) + '/' + h.name;
    await put('dirs', id, h); return id;
  },
  async grantFolder(id) { const h = await dirHandle(id); return !!h && (await h.requestPermission({ mode: 'read' })) === 'granted'; },
  async listPdfs(id) {
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

// Çevrimdışı çalışma ve "uygulama olarak yükle" için servis çalışanı
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.error('Servis çalışanı', e)));
}
})();
