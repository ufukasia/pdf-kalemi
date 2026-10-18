/* PDF Kalemi — Claude balonu.
   Balona basınca o anki sayfanın (kalemle seçili bir alan varsa yalnızca o alanın) görüntüsü panoya kopyalanır
   ve Claude açılır. Hiçbir şey otomatik gönderilmez: kullanıcı Claude'da Ctrl+V yapar, sorusunu yazar ya da
   sesli modda söyler ve Gönder'e kendisi basar. Android'de görüntü Paylaş menüsüyle doğrudan Claude uygulamasına verilir. */
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const LS = 'pdfkalemi:claude';
const cfg = Object.assign({ fab: true, target: 'app', pos: null }, (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } })());
const saveCfg = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {} };
const desk = !!(window.desktop && window.desktop.claudeHandoff);
const android = /Android/i.test(navigator.userAgent);
const fab = $('#clFab');
const toast = (t, ms) => { if (window.__app && window.__app.toast) window.__app.toast(t, ms); };

/* ---------- Görüntü: o anki sayfa + çizimler; seçim varsa seçili alan ---------- */
async function capture() {
  const A = window.__app; if (!A || !A.state.pages.length) return null;
  const s = A.getSel && A.getSel(), pv = s ? s.pv : A.state.pages[A.currentIndex()];
  // Seçili alanın çevresine biraz pay bırak; seçim yoksa bütün sayfa.
  let [x0, y0, x1, y1] = s ? s.bb : [0, 0, pv.w, pv.h];
  if (s) { const m = Math.max(24, 0.06 * Math.max(x1 - x0, y1 - y0)); x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(pv.w, x1 + m); y1 = Math.min(pv.h, y1 + m); }
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return null;
  const k = Math.min(2000 / Math.max(w, h), 4);
  const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  c.translate(-x0 * k, -y0 * k);
  await pv.page.render({ canvasContext: c, viewport: pv.page.getViewport({ scale: k }) }).promise;
  if (pv.ink && pv.ink.width) c.drawImage(pv.ink, 0, 0, pv.w * k, pv.h * k);
  return { canvas: cv, page: A.state.pages.indexOf(pv) + 1, part: !!s };
}
const toBlob = (cv) => new Promise((r) => cv.toBlob(r, 'image/png'));

/* ---------- Claude'a hazırla ---------- */
let busy = false;
function flash(state) { fab.dataset.state = state; clearTimeout(flash.t); if (state !== 'busy') flash.t = setTimeout(() => { fab.dataset.state = 'idle'; }, 1800); }
async function send() {
  if (busy) return;
  if (!window.__app || !window.__app.state.pages.length) { toast('Önce bir PDF aç.'); return; }
  busy = true; flash('busy');
  try {
    if (desk) {
      const shot = await capture(); if (!shot) throw new Error('Görüntü alınamadı.');
      const r = await window.desktop.claudeHandoff(shot.canvas.toDataURL('image/png'), cfg.target);
      if (!r || !r.ok) throw new Error('Görüntü panoya kopyalanamadı.');
      flash('done');
      toast((shot.part ? 'Seçili alan' : 'Sayfa ' + shot.page) + ' panoya kopyalandı. ' + (r.app ? 'Claude uygulamasında' : 'claude.ai\'de') + ' Ctrl+V yap, sorunu yaz ya da söyle, Gönder\'e sen bas.', 6000);
      return;
    }
    // Web / telefon: tarayıcılar dokunuştan sonraki kısa süre içinde izin verir; görüntü hazırlanırken bu süre korunur.
    const shotP = capture();
    if (android && navigator.canShare) {
      const shot = await shotP; if (!shot) throw new Error('Görüntü alınamadı.');
      const file = new File([await toBlob(shot.canvas)], 'pdf-kalemi-sayfa-' + shot.page + '.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); flash('done'); toast('Paylaş menüsünden Claude\'u seç; görüntü ekli gelir, Gönder\'e sen bas.', 5000); }
        catch (err) { if (err && err.name === 'AbortError') flash('idle'); else throw err; }
        return;
      }
    }
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Bu tarayıcı görüntüyü panoya kopyalayamıyor.');
    const blobP = shotP.then((s) => { if (!s) throw new Error('Görüntü alınamadı.'); return toBlob(s.canvas); });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]);
    const shot = await shotP;
    const w = window.open('https://claude.ai/new', '_blank', 'noopener');
    flash('done');
    toast((shot.part ? 'Seçili alan' : 'Sayfa ' + shot.page) + ' panoya kopyalandı. ' + (w === null ? 'claude.ai\'yi aç, ' : 'Açılan claude.ai\'de ') + 'Ctrl+V yap, Gönder\'e sen bas.', 6000);
  } catch (err) {
    flash('error'); toast('Claude\'a hazırlanamadı: ' + ((err && err.message) || err), 5000);
  } finally { busy = false; }
}

/* ---------- Balon: sürüklenebilir, yeri hatırlanır ---------- */
const FAB = 52;
function applyFab() { fab.hidden = !cfg.fab; }
function placeFab() {
  const p = cfg.pos || { x: 0.94, y: 0.68 };
  const x = Math.round(p.x * Math.max(0, innerWidth - FAB)), y = Math.round(p.y * Math.max(0, innerHeight - FAB));
  fab.style.transform = `translate(${x}px, ${y}px)`; fab._x = x; fab._y = y;
}
let drag = null;
fab.addEventListener('pointerdown', (e) => {
  e.preventDefault(); try { fab.setPointerCapture(e.pointerId); } catch (err) {}
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: fab._x, y0: fab._y, moved: false };
});
fab.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 8) return;
  drag.moved = true; fab.classList.add('drag');
  const x = Math.max(0, Math.min(innerWidth - FAB, drag.x0 + dx)), y = Math.max(0, Math.min(innerHeight - FAB, drag.y0 + dy));
  fab.style.transform = `translate(${x}px, ${y}px)`; fab._x = x; fab._y = y;
});
const dropFab = (e, cancel) => {
  if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; fab.classList.remove('drag');
  if (d.moved) { cfg.pos = { x: fab._x / Math.max(1, innerWidth - FAB), y: fab._y / Math.max(1, innerHeight - FAB) }; saveCfg(); }
  else if (!cancel) send();
};
fab.addEventListener('pointerup', (e) => dropFab(e, false));
fab.addEventListener('pointercancel', (e) => dropFab(e, true));
fab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); send(); } });
window.addEventListener('resize', placeFab);
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((e.key === 'c' || e.key === 'C') && cfg.fab) { e.preventDefault(); send(); }
});

/* ---------- Ayarlar ---------- */
function syncUi() {
  $('#clFabOpt').checked = !!cfg.fab;
  const t = $('#clTarget'); if (t) t.value = cfg.target;
}
$('#clFabOpt').addEventListener('change', (e) => { cfg.fab = e.target.checked; saveCfg(); applyFab(); });
if (desk) {
  document.documentElement.classList.add('claudedesk');
  $('#clTarget').addEventListener('change', (e) => { cfg.target = e.target.value; saveCfg(); });
  window.desktop.claudeHasApp().then((has) => {
    $('#clTargetNote').textContent = has ? 'Claude masaüstü uygulaması bu bilgisayarda kurulu.' : 'Claude masaüstü uygulaması bulunamadı; claude.ai tarayıcıda açılır.';
  }).catch(() => {});
}
$('#clNote').textContent = desk
  ? 'Balona basınca sayfa (kalemle bir alan seçtiysen yalnızca o alan) panoya kopyalanır ve Claude açılır. Ctrl+V yapıp sorunu yazar ya da sesli modda söylersin; Gönder\'e sen basmadıkça hiçbir şey gitmez.'
  : android ? 'Balona basınca Paylaş menüsü açılır; Claude uygulamasını seç, görüntü ekli gelir. Gönder\'e sen basmadıkça hiçbir şey gitmez.'
  : 'Balona basınca sayfa panoya kopyalanır ve claude.ai açılır. Ctrl+V yapıp Gönder\'e sen basarsın.';

syncUi(); applyFab(); placeFab(); fab.dataset.state = 'idle';
window.__claude = { cfg, send, capture };
})();
