// OneDrive (okulun / kurumun Microsoft 365 hesabı) bağlantısı: Microsoft ile giriş, OneDrive'da klasör seçme,
// seçilen klasörlerdeki PDF'leri listeleme ve açma. Windows, Android uygulaması ve web sürümünde aynı kod çalışır;
// yalnızca giriş penceresi ve ağ istekleri platforma göre yapılır:
//  - Windows (Electron): giriş ayrı bir pencerede açılır, istekler ana süreçten gider (preload: odAuth, odHttp).
//  - Android (Capacitor): giriş Chrome sekmesinde açılır, uygulamaya io.github.ufukasia.pdfkalemi://auth ile döner;
//    istekler yerel HTTP ile gider.
//  - Web: sayfa Microsoft'a gidip geri döner (tek sayfalık uygulama girişi).
// Dosyalar yalnızca okunur (Files.Read.All). Açılan PDF'lerin kopyası cihazda saklanır; internet yokken de açılır.
(() => {
'use strict';
const CAP = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? window.Capacitor.Plugins : null;
const EL = !!(window.desktop && window.desktop.odHttp);
// Microsoft Entra uygulama kaydı. Boşsa Ayarlar → OneDrive'dan girilir (kurumun bilgi işlemi kaydı oluşturur).
const BUILTIN = { clientId: '', tenant: 'organizations' };
const SCOPE = 'openid profile offline_access User.Read Files.Read.All';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const LS = 'pdfkalemi:onedrive', SS = 'pdfkalemi:onedrive-giris';
const PREFIX = 'onedrive/';
const REDIRECT = EL ? 'https://login.microsoftonline.com/common/oauth2/nativeclient'
  : CAP ? 'io.github.ufukasia.pdfkalemi://auth'
  : location.origin + location.pathname.replace(/index\.html$/, '');

/* ---------- Ayar ve oturum (yenileme anahtarı yalnızca bu cihazda) ---------- */
let st = {};
try { st = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { st = {}; }
let access = null; // { token, exp } yalnızca bellekte
function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }
function conf() { return { clientId: (st.clientId || BUILTIN.clientId || '').trim(), tenant: (st.tenant || BUILTIN.tenant || 'organizations').trim() }; }
const authority = () => 'https://login.microsoftonline.com/' + encodeURIComponent(conf().tenant) + '/oauth2/v2.0';
const listeners = new Set();
function changed() { for (const f of listeners) { try { f(); } catch (e) { console.error(e); } } }

/* ---------- Ağ: Electron ve Android'de yerel istek (tarayıcı kısıtları yok), web'de fetch ---------- */
function fromB64(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function http(url, o = {}) {
  const method = o.method || 'GET', headers = Object.assign({}, o.headers || {});
  const body = o.form ? new URLSearchParams(o.form).toString() : undefined;
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (EL) {
    const r = await window.desktop.odHttp({ url, method, headers, body, bin: !!o.bin });
    if (r.error) throw new Error(r.error);
    return { status: r.status, json: () => JSON.parse(r.text || 'null'), bytes: () => r.bytes };
  }
  if (CAP && CAP.CapacitorHttp) {
    const r = await CAP.CapacitorHttp.request({ url, method, headers, data: body, responseType: o.bin ? 'arraybuffer' : 'text', connectTimeout: 20000, readTimeout: 60000 });
    return { status: r.status, json: () => (typeof r.data === 'string' ? JSON.parse(r.data || 'null') : r.data), bytes: () => fromB64(r.data || '') };
  }
  const r = await fetch(url, { method, headers, body });
  const buf = o.bin && r.ok ? new Uint8Array(await r.arrayBuffer()) : null, text = buf ? '' : await r.text();
  return { status: r.status, json: () => JSON.parse(text || 'null'), bytes: () => buf };
}

/* ---------- Giriş: yetki kodu + PKCE ---------- */
function rnd(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
function b64url(a) { let s = ''; for (const b of a) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function challenge(v) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))); }
class OdError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

// Giriş sayfasını açar, dönüş adresini (kodla birlikte) verir; vazgeçilirse null.
function authorize(url) {
  if (EL) return window.desktop.odAuth(url, REDIRECT);
  return new Promise((resolve) => {
    let done = false, subs = [];
    const finish = (u) => { if (done) return; done = true; subs.forEach((s) => s && s.remove && s.remove()); resolve(u); };
    const on = (p) => p.then((s) => { if (done) s.remove(); else subs.push(s); });
    on(CAP.App.addListener('appUrlOpen', (e) => { if (e && e.url && e.url.startsWith(REDIRECT)) { CAP.Browser.close().catch(() => {}); finish(e.url); } }));
    // Sekme kullanıcı tarafından kapatılırsa: dönüş bağlantısı biraz gecikebilir, kısa süre beklenir.
    on(CAP.Browser.addListener('browserFinished', () => setTimeout(() => finish(null), 1500)));
    CAP.Browser.open({ url, presentationStyle: 'popover' }).catch(() => finish(null));
  });
}
function authUrl(ch, state, hint) {
  const q = { client_id: conf().clientId, response_type: 'code', redirect_uri: REDIRECT, response_mode: 'query', scope: SCOPE,
    code_challenge: ch, code_challenge_method: 'S256', state, prompt: 'select_account' };
  if (hint) q.login_hint = hint;
  return authority() + '/authorize?' + new URLSearchParams(q).toString();
}
async function signIn(resume) {
  if (!conf().clientId) throw new OdError('noclient', 'OneDrive için uygulama kimliği girilmemiş (Ayarlar → OneDrive).');
  const verifier = rnd(48), state = rnd(16), url = authUrl(await challenge(verifier), state, st.account && st.account.user);
  if (!EL && !CAP) {
    // Web: sayfa Microsoft'a gider; dönüşte bu bilgiyle giriş tamamlanır ve kaldığı yerden devam edilir.
    sessionStorage.setItem(SS, JSON.stringify({ verifier, state, resume: resume || '', tenant: conf().tenant }));
    location.assign(url);
    return new Promise(() => {});
  }
  const back = await authorize(url);
  if (!back) return false;
  await finishLogin(back, verifier, state);
  return true;
}
async function finishLogin(back, verifier, state) {
  const q = new URL(back).searchParams;
  if (q.get('state') !== state) throw new OdError('state', 'Giriş yanıtı doğrulanamadı, yeniden dene.');
  if (q.get('error')) throw new OdError(q.get('error'), loginError(q.get('error'), q.get('error_description')));
  await tokenReq({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT, code_verifier: verifier });
  try {
    const me = await graph('/me?$select=displayName,mail,userPrincipalName');
    st.account = { name: me.displayName || '', user: me.userPrincipalName || me.mail || '' };
  } catch (e) { st.account = st.account || { name: '', user: '' }; }
  save(); changed();
}
function loginError(code, desc) {
  const d = String(desc || '');
  if (/AADSTS65001|consent|onay/i.test(d) || code === 'consent_required') return 'Kurum bu uygulamaya henüz izin vermemiş. Bilgi işlemin "yönetici onayı" vermesi gerekiyor.';
  if (/AADSTS50194/.test(d)) return 'Uygulama kaydı yalnızca kurum içi; Ayarlar → OneDrive\'da "Kiracı" kutusuna okulun alan adını yaz (ör. ostimteknik.edu.tr).';
  if (/AADSTS700016|AADSTS700054/.test(d)) return 'Uygulama kimliği bu kurumda bulunamadı; Ayarlar → OneDrive\'daki kimliği kontrol et.';
  if (/AADSTS50011/.test(d)) return 'Dönüş adresi uygulama kaydına eklenmemiş: ' + REDIRECT;
  if (/AADSTS53000|AADSTS53003|compliant|uyumlu/i.test(d)) return 'Kurumun güvenlik kuralı bu cihazdan girişe izin vermiyor (cihaz Intune\'a kayıtlı / uyumlu olmalı).';
  if (code === 'access_denied') return 'Giriş iptal edildi.';
  return 'Microsoft girişi başarısız: ' + (d.split(/\r?\n/)[0] || code);
}
async function tokenReq(form) {
  const r = await http(authority() + '/token', { method: 'POST', form: Object.assign({ client_id: conf().clientId, scope: SCOPE }, form) });
  let j = null; try { j = r.json(); } catch (e) {}
  if (r.status !== 200 || !j || !j.access_token) {
    const err = (j && j.error) || 'http_' + r.status;
    if (err === 'invalid_grant' || err === 'interaction_required') { delete st.rt; access = null; save(); changed(); throw new OdError('login', 'OneDrive oturumunun süresi doldu; yeniden giriş yap.'); }
    throw new OdError(err, loginError(err, j && j.error_description));
  }
  access = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  if (j.refresh_token) st.rt = j.refresh_token;
  save();
  return access.token;
}
let refreshing = null;
async function token() {
  if (access && access.exp > Date.now() + 90e3) return access.token;
  if (!st.rt) throw new OdError('login', 'OneDrive\'a giriş yapılmamış.');
  if (!refreshing) refreshing = tokenReq({ grant_type: 'refresh_token', refresh_token: st.rt }).finally(() => { refreshing = null; });
  return refreshing;
}
function signOut() { delete st.rt; delete st.account; access = null; save(); changed(); }

// Web: Microsoft'tan dönüşte (?code=...&state=...) girişi tamamlar, adres çubuğunu temizler.
const ready = (async () => {
  if (EL || CAP) return '';
  const u = new URL(location.href);
  if (!u.searchParams.has('state') || !(u.searchParams.has('code') || u.searchParams.has('error'))) return '';
  let p = null; try { p = JSON.parse(sessionStorage.getItem(SS) || 'null'); } catch (e) {}
  sessionStorage.removeItem(SS);
  history.replaceState(null, '', location.pathname + location.hash);
  if (!p) return '';
  try { await finishLogin(u.href, p.verifier, p.state); return p.resume || 'ok'; }
  catch (e) { console.error(e); lastError = e.message; return 'error'; }
})();
let lastError = '';

/* ---------- Microsoft Graph ---------- */
async function graph(path) {
  for (let i = 0; i < 2; i++) {
    const t = await token();
    const r = await http(/^https:/.test(path) ? path : GRAPH + path, { headers: { Authorization: 'Bearer ' + t } });
    if (r.status === 401 && i === 0) { access = null; continue; }
    if (r.status === 429 || r.status === 503) { await new Promise((res) => setTimeout(res, 1500)); continue; }
    let j = null; try { j = r.json(); } catch (e) {}
    if (r.status >= 200 && r.status < 300) return j;
    if (r.status === 404) throw new OdError('missing', 'OneDrive\'da bulunamadı.');
    if (r.status === 403) throw new OdError('forbidden', 'Bu OneDrive öğesine erişim izni yok.');
    throw new OdError('http_' + r.status, (j && j.error && j.error.message) || 'OneDrive isteği başarısız (' + r.status + ').');
  }
  throw new OdError('busy', 'OneDrive şu an yanıt vermiyor, biraz sonra yeniden dene.');
}
const SEL = '$select=id,name,folder,file,size,eTag,remoteItem,parentReference,lastModifiedDateTime';
async function children(d, i, max = 5000) {
  const out = []; let next = '/drives/' + encodeURIComponent(d) + '/items/' + encodeURIComponent(i) + '/children?$top=500&' + SEL;
  while (next && out.length < max) { const j = await graph(next); out.push(...(j.value || [])); next = j['@odata.nextLink'] || ''; }
  return out;
}
// Kısayol ya da paylaşılan öğe başka bir sürücüde olabilir: gerçek konumu.
function target(it, d) {
  const r = it.remoteItem;
  if (r) return { d: (r.parentReference && r.parentReference.driveId) || d, i: r.id, folder: !!r.folder, file: !!r.file, etag: r.eTag || it.eTag };
  return { d: (it.parentReference && it.parentReference.driveId) || d, i: it.id, folder: !!it.folder, file: !!it.file, etag: it.eTag };
}

/* ---------- Yerel önbellek (IndexedDB): klasör listeleri ve açılan PDF'lerin kopyaları ---------- */
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('pdf-kalemi-onedrive', 1);
    r.onupgradeneeded = () => { for (const s of ['lists', 'files']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const idb = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function iget(s, k) { try { return await idb((await db()).transaction(s).objectStore(s).get(k)); } catch (e) { return null; } }
async function iput(s, k, v) { try { await idb((await db()).transaction(s, 'readwrite').objectStore(s).put(v, k)); } catch (e) { console.error(e); } }
async function idel(s, k) { try { await idb((await db()).transaction(s, 'readwrite').objectStore(s).delete(k)); } catch (e) {} }
async function ikeys(s) { try { return await idb((await db()).transaction(s).objectStore(s).getAllKeys()); } catch (e) { return []; } }
const MAX_FILES = 60, MAX_BYTES = 800e6;
async function cacheFile(path, rec) {
  await iput('files', path, rec);
  const meta = (await iget('lists', '__dosyalar__')) || {};
  meta[path] = { at: Date.now(), size: rec.bytes.length };
  const list = Object.entries(meta).sort((a, b) => b[1].at - a[1].at); let total = 0;
  for (let k = 0; k < list.length; k++) { total += list[k][1].size; if (k >= MAX_FILES || total > MAX_BYTES) { await idel('files', list[k][0]); delete meta[list[k][0]]; } }
  await iput('lists', '__dosyalar__', meta);
}

/* ---------- Klasör kimliği: onedrive/<sürücü>~<öğe>/<ad>, dosya yolu: <klasör kimliği>/<alt klasör>/<ad>.pdf ---------- */
const coll = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
const owns = (p) => typeof p === 'string' && p.startsWith(PREFIX);
const safe = (s) => String(s || 'OneDrive').replace(/[\\/]/g, '_');
function folderId(d, i, name) { return PREFIX + d + '~' + i + '/' + safe(name); }
function parse(p) {
  const parts = p.split('/'), [d, i] = (parts[1] || '').split('~');
  return { root: parts.slice(0, 3).join('/'), d, i, rel: parts.slice(3) };
}
const where = {}; // dosya yolu → { d, i, etag } (son listeden)

// Aynı klasör aynı anda bir kez taranır (menü art arda yenilense de).
const scanning = {};
function listPdfs(id) {
  if (!scanning[id]) scanning[id] = scan(id).finally(() => { delete scanning[id]; });
  return scanning[id];
}
async function scan(id) {
  const { d, i } = parse(id), cached = await iget('lists', id);
  if (!st.rt) return cached ? Object.assign({}, cached, { offline: true }) : { needsPermission: true, files: [] };
  try {
    const files = [], MAX = 1500; let level = [{ d, i, rel: '' }], depth = 0, truncated = false;
    while (level.length && !truncated) {
      const next = [];
      for (let k = 0; k < level.length && !truncated; k += 6) {
        const part = level.slice(k, k + 6), lists = await Promise.all(part.map((q) => children(q.d, q.i).catch((e) => { if (q.rel) return []; throw e; })));
        part.forEach((q, n) => {
          for (const it of lists[n]) {
            const nm = it.name || ''; if (!nm || nm.startsWith('.') || nm.startsWith('~$')) continue;
            const t = target(it, q.d), rel = q.rel ? q.rel + '/' + safe(nm) : safe(nm);
            if (t.folder) { if (depth < 4) next.push({ d: t.d, i: t.i, rel }); }
            else if (/\.pdf$/i.test(nm)) {
              if (files.length >= MAX) { truncated = true; break; }
              const path = id + '/' + rel; where[path] = { d: t.d, i: t.i, etag: t.etag };
              files.push({ path, name: safe(nm), rel: q.rel, d: t.d, i: t.i, etag: t.etag });
            }
          }
        });
      }
      level = next; depth++;
    }
    files.sort((a, b) => coll.compare(a.rel, b.rel) || coll.compare(a.name, b.name));
    const res = { files, truncated };
    iput('lists', id, res);
    return res;
  } catch (e) {
    console.error(e);
    if (e.code === 'missing') return { missing: true, files: [] };
    if (e.code === 'login') return cached ? Object.assign({}, cached, { offline: true }) : { needsPermission: true, files: [] };
    return cached ? Object.assign({}, cached, { offline: true }) : { error: e.message, files: [] };
  }
}
async function locate(path) {
  if (where[path]) return where[path];
  const { root, d, i, rel } = parse(path), cached = await iget('lists', root);
  const f = cached && cached.files.find((x) => x.path === path);
  if (f && f.i) return (where[path] = { d: f.d, i: f.i, etag: f.etag });
  if (!rel.length) return { d, i };
  // Listede yoksa (ör. tek dosya açıldıysa) klasöre göre yoldan bulunur.
  const it = await graph('/drives/' + encodeURIComponent(d) + '/items/' + encodeURIComponent(i) + ':/' + rel.map(encodeURIComponent).join('/') + ':?' + SEL);
  const t = target(it, d); return (where[path] = { d: t.d, i: t.i, etag: t.etag });
}
async function readPdf(path) {
  const name = path.split('/').pop(), cached = await iget('files', path);
  const fromCache = () => { if (!cached) return null; cacheFile(path, cached); return { path, name, bytes: cached.bytes }; };
  if (!st.rt) return fromCache();
  let item;
  try { const w = await locate(path); item = await graph('/drives/' + encodeURIComponent(w.d) + '/items/' + encodeURIComponent(w.i)); }
  catch (e) { console.error(e); return fromCache(); }
  if (cached && cached.etag && cached.etag === item.eTag) return fromCache();
  const url = item['@microsoft.graph.downloadUrl'];
  if (!url) return fromCache();
  try {
    const r = await http(url, { bin: true });
    if (r.status !== 200) throw new Error('indirme ' + r.status);
    const bytes = r.bytes();
    cacheFile(path, { bytes, etag: item.eTag });
    return { path, name, bytes };
  } catch (e) { console.error(e); return fromCache(); }
}

/* ---------- Klasör seçici: OneDrive'ım ve benimle paylaşılanlar arasında gezip klasör eklenir ---------- */
const ICON_DIR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>';
const ICON_PDF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>';
let ui = null;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function buildUi() {
  const back = el('div', 'od-back'); back.hidden = true;
  const box = el('section', 'od-box'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'OneDrive\'dan klasör seç');
  const head = el('header', 'od-h'), title = el('b', '', 'OneDrive'), who = el('small', 'od-who'), x = el('button', 'od-x', '×');
  x.type = 'button'; x.title = 'Kapat'; x.setAttribute('aria-label', 'Kapat');
  head.append(title, who, x);
  const tabs = el('div', 'od-tabs'); tabs.setAttribute('role', 'tablist');
  const tMe = el('button', '', 'Dosyalarım'), tSh = el('button', '', 'Benimle paylaşılanlar');
  for (const [b, r] of [[tMe, 'me'], [tSh, 'shared']]) { b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.root = r; tabs.appendChild(b); }
  const crumbs = el('nav', 'od-crumbs'); crumbs.setAttribute('aria-label', 'Konum');
  const list = el('div', 'od-list');
  const foot = el('footer', 'od-f'), hint = el('span', 'od-hint'), add = el('button', 'btn primary od-add', 'Bu klasörü ekle'); add.type = 'button';
  foot.append(hint, add);
  box.append(head, tabs, crumbs, list, foot); back.appendChild(box); document.body.appendChild(back);
  ui = { back, box, who, x, tabs, tMe, tSh, crumbs, list, hint, add, stack: [], root: 'me', resolve: null, onFile: null, seq: 0 };
  x.addEventListener('click', () => closeUi(null));
  back.addEventListener('pointerdown', (e) => { if (e.target === back) closeUi(null); });
  back.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeUi(null); } });
  tMe.addEventListener('click', () => openRoot('me')); tSh.addEventListener('click', () => openRoot('shared'));
  add.addEventListener('click', () => { const c = ui.stack[ui.stack.length - 1]; if (c && c.i) closeUi(folderId(c.d, c.i, c.name)); });
}
function closeUi(v) { if (!ui) return; ui.back.hidden = true; ui.seq++; const r = ui.resolve; ui.resolve = null; if (r) r(v); }
function rowBtn(icon, name, sub, cls) {
  const b = el('button', 'od-row' + (cls ? ' ' + cls : '')); b.type = 'button';
  b.innerHTML = icon; b.appendChild(el('b', '', name)); if (sub) b.appendChild(el('small', '', sub)); return b;
}
async function openRoot(r) {
  ui.root = r; ui.tMe.setAttribute('aria-selected', String(r === 'me')); ui.tSh.setAttribute('aria-selected', String(r === 'shared'));
  ui.stack = [];
  if (r === 'me') {
    await show(async () => { const root = await graph('/me/drive/root?$select=id,name,parentReference'); ui.stack = [{ d: root.parentReference.driveId, i: root.id, name: 'OneDrive' }]; return children(ui.stack[0].d, ui.stack[0].i); });
  } else {
    ui.stack = [{ name: 'Benimle paylaşılanlar' }];
    await show(async () => (await graph('/me/drive/sharedWithMe?$top=200')).value || []);
  }
}
function enter(item, d) { const t = target(item, d); ui.stack.push({ d: t.d, i: t.i, name: item.name }); show(() => children(t.d, t.i)); }
async function show(load) {
  const seq = ++ui.seq, cur = ui.stack[ui.stack.length - 1];
  ui.list.textContent = ''; ui.list.appendChild(el('div', 'od-msg', 'Yükleniyor…'));
  drawCrumbs(); ui.add.disabled = true; ui.hint.textContent = '';
  let items;
  try { items = await load(); } catch (e) {
    if (seq !== ui.seq) return;
    ui.list.textContent = ''; ui.list.appendChild(el('div', 'od-msg', e.message || 'OneDrive okunamadı.'));
    if (e.code === 'login') { const b = el('button', 'btn primary', 'Yeniden giriş yap'); b.type = 'button'; b.addEventListener('click', () => loginThen(() => openRoot(ui.root))); ui.list.appendChild(b); }
    return;
  }
  if (seq !== ui.seq) return;
  const now = ui.stack[ui.stack.length - 1] || cur, d = now && now.d;
  drawCrumbs(); ui.list.textContent = '';
  const dirs = [], pdfs = [];
  for (const it of items) {
    const t = target(it, d), nm = it.name || '';
    if (!nm || nm.startsWith('.') || nm.startsWith('~$')) continue;
    if (t.folder) dirs.push(it); else if (t.file && /\.pdf$/i.test(nm)) pdfs.push(it);
  }
  dirs.sort((a, b) => coll.compare(a.name, b.name)); pdfs.sort((a, b) => coll.compare(a.name, b.name));
  for (const it of dirs) {
    const f = (it.remoteItem && it.remoteItem.folder) || it.folder || {}, by = it.remoteItem && it.remoteItem.shared && it.remoteItem.shared.owner && it.remoteItem.shared.owner.user;
    const sub = [f.childCount != null ? f.childCount + ' öğe' : '', by && by.displayName ? by.displayName : ''].filter(Boolean).join(' · ');
    const b = rowBtn(ICON_DIR, it.name, sub, 'dir'); b.addEventListener('click', () => enter(it, d)); ui.list.appendChild(b);
  }
  for (const it of pdfs) {
    const b = rowBtn(ICON_PDF, it.name.replace(/\.pdf$/i, ''), 'PDF · dokununca açılır', 'pdf');
    b.addEventListener('click', () => {
      // Tek dosya açılır, sol menüye klasör eklenmez. Yol, bulunduğu klasöre göredir; tek başına paylaşılmış
      // dosyada yol dosyanın kendisidir.
      const t = target(it, d), path = now && now.i ? folderId(now.d, now.i, now.name) + '/' + safe(it.name) : folderId(t.d, t.i, it.name);
      where[path] = { d: t.d, i: t.i, etag: t.etag };
      const cb = ui.onFile; closeUi(null); if (cb) cb(path);
    });
    ui.list.appendChild(b);
  }
  if (!dirs.length && !pdfs.length) ui.list.appendChild(el('div', 'od-msg', ui.root === 'shared' && ui.stack.length === 1 ? 'Seninle paylaşılan klasör yok.' : 'Bu klasörde alt klasör veya PDF yok.'));
  const canAdd = !!(now && now.i);
  ui.add.disabled = !canAdd;
  ui.hint.textContent = canAdd ? (pdfs.length ? pdfs.length + ' PDF' + (dirs.length ? ', ' + dirs.length + ' klasör' : '') : dirs.length ? dirs.length + ' klasör' : '') : 'Bir klasöre gir';
}
function drawCrumbs() {
  ui.crumbs.textContent = '';
  ui.stack.forEach((c, k) => {
    if (k) ui.crumbs.appendChild(el('span', 'od-sep', '›'));
    const b = el('button', '', c.name); b.type = 'button';
    if (k === ui.stack.length - 1) b.setAttribute('aria-current', 'location');
    else b.addEventListener('click', () => { ui.stack = ui.stack.slice(0, k + 1); if (k === 0 && ui.root === 'shared') openRoot('shared'); else { const c2 = ui.stack[k]; show(() => children(c2.d, c2.i)); } });
    ui.crumbs.appendChild(b);
  });
  ui.crumbs.scrollLeft = ui.crumbs.scrollWidth;
}
async function loginThen(fn) {
  try { if (await signIn('pick')) fn(); } catch (e) { toast(e.message); }
}
const toast = (m) => { if (window.__app && window.__app.toast) window.__app.toast(m); else console.warn(m); };
// Klasör seçiciyi açar; eklenecek klasörün kimliğini verir (vazgeçilirse null). onFile: tek PDF'e dokunulunca.
async function pickFolder(onFile) {
  if (!conf().clientId) throw new OdError('noclient', 'OneDrive bağlantısı için önce Ayarlar → OneDrive\'da uygulama kimliğini gir.');
  if (!st.rt && !(await signIn('pick'))) return null;
  if (!ui) buildUi();
  ui.onFile = onFile || null;
  ui.who.textContent = st.account ? st.account.user || st.account.name : '';
  ui.back.hidden = false; ui.x.focus();
  const p = new Promise((res) => { ui.resolve = res; });
  openRoot('me');
  return p;
}

window.oneDrive = {
  owns, ready, listPdfs, readPdf, pickFolder, signOut,
  redirectUri: REDIRECT,
  configured: () => !!conf().clientId,
  signedIn: () => !!st.rt,
  account: () => st.account || null,
  config: () => Object.assign({ builtin: !!BUILTIN.clientId, custom: !!st.clientId }, conf()),
  setConfig(c) {
    const id = String(c.clientId || '').trim(), tn = String(c.tenant || '').trim();
    if (id !== conf().clientId || (tn || BUILTIN.tenant) !== conf().tenant) { delete st.rt; access = null; }
    if (id && id !== BUILTIN.clientId) st.clientId = id; else delete st.clientId;
    if (tn && tn !== BUILTIN.tenant) st.tenant = tn; else delete st.tenant;
    save(); changed();
  },
  async signIn() { return signIn(''); },
  async grantFolder() { try { return await signIn('list'); } catch (e) { toast(e.message); return false; } },
  lastError: () => lastError,
  onChange(f) { listeners.add(f); }
};
})();
