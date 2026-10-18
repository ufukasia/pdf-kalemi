(() => {
'use strict';

/* ---------- Ayarlar ---------- */
const HL_ALPHA = 0.35;
const PAD = 24, GAP = 28;
const MIN_SCALE = 0.2, MAX_SCALE = 6;
const SWATCHES = [
  ['#16181d', 'Siyah'], ['#d6322b', 'Kırmızı'], ['#1f6feb', 'Mavi'], ['#1a7f4b', 'Yeşil'],
  ['#f08c00', 'Turuncu'], ['#8250df', 'Mor'], ['#ffd400', 'Sarı']
];
const TOOLS = {
  pen:     { ck: 'pen',   sk: 'pen',    min: 0.5, max: 12, step: 0.5, label: 'Kalınlık' },
  hl:      { ck: 'hl',    sk: 'hl',     min: 6,   max: 36, step: 1,   label: 'Kalınlık' },
  line:    { ck: 'shape', sk: 'shape',  min: 0.5, max: 12, step: 0.5, label: 'Kalınlık' },
  arrow:   { ck: 'shape', sk: 'shape',  min: 0.5, max: 12, step: 0.5, label: 'Kalınlık' },
  rect:    { ck: 'shape', sk: 'shape',  min: 0.5, max: 12, step: 0.5, label: 'Kalınlık' },
  ellipse: { ck: 'shape', sk: 'shape',  min: 0.5, max: 12, step: 0.5, label: 'Kalınlık' },
  eraser:  { ck: null,    sk: 'eraser', min: 4,   max: 40, step: 1,   label: 'Silgi' },
  laser:   { ck: 'laser', sk: 'laser',  min: 2,   max: 16, step: 1,   label: 'Kalınlık' }
};
// Lazer kalemin neon renkleri
const NEON = [
  ['#ff1f4b', 'Neon kırmızı'], ['#39ff14', 'Neon yeşil'], ['#00e5ff', 'Neon camgöbeği'], ['#ff2bd6', 'Neon pembe'],
  ['#ffe600', 'Neon sarı'], ['#ff7a00', 'Neon turuncu'], ['#b44bff', 'Neon mor']
];
const KEYS = { p: 'pen', h: 'hl', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', e: 'eraser', z: 'laser' };
// Kalem uçları. ts/te: baş ve son incelme uzunluğu (kalınlığın katı), min: incelmenin en ince hali.
const NIBS = {
  ball:     { ts: 0.6, te: 0.8, min: 0.55 },
  fountain: { ts: 2.2, te: 3,   min: 0.22 },
  brush:    { ts: 4,   te: 7,   min: 0.05 },
  callig:   { ts: 0,   te: 0,   min: 1, flat: true, ang: -40 * Math.PI / 180 }
};
const NIB_KEYS = { 1: 'ball', 2: 'fountain', 3: 'brush', 4: 'callig' };

const $ = (s) => document.querySelector(s);
const viewer = $('#viewer'), pagesEl = $('#pages'), ring = $('#ring');

const state = {
  tool: 'pen',
  colors: { pen: '#16181d', hl: '#ffd400', shape: '#d6322b', laser: '#ff1f4b' },
  sizes: { 'pen:ball': 1.5, 'pen:fountain': 2, 'pen:brush': 3.5, 'pen:callig': 3, hl: 14, shape: 2, eraser: 14, laser: 6 },
  nib: 'fountain', press: 50, hasPressure: false,
  touchDraw: false,
  // Ayarlar paneli (alttan çekilir)
  opts: { tapNav: true, swipeNav: true, wheelNav: true, links: true, laserHold: 900, theme: 'system', barrel: 'lasso' },
  scale: 1,
  pdf: null, bytes: null, name: 'kareli-sayfa.pdf', sample: true,
  pages: [], tops: [],
  undo: [], redo: []
};

/* ---------- Yardımcılar ---------- */
let toastTimer = 0;
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2800);
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* ---------- Çizim fonksiyonları (sayfa birimi = PDF noktası) ---------- */
// Kalem çizgisi orta noktalar arası ikinci derece eğrilerle çizilir. Parça i, P[i-1] kontrol noktasıdır.
function pieceEnds(pts, i) {
  const n = pts.length;
  const start = i === 1 ? pts[0] : mid(pts[i - 2], pts[i - 1]);
  const end = i === n ? pts[n - 1] : mid(pts[i - 1], pts[i]);
  return [start, pts[i - 1], end];
}
function penPiece(ctx, pts, i, w) {
  const [s, c, e] = pieceEnds(pts, i);
  ctx.lineWidth = Math.max(0.2, w * c[2]);
  ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.quadraticCurveTo(c[0], c[1], e[0], e[1]); ctx.stroke();
}
function penDot(ctx, p, w) {
  ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.1, w * p[2] / 2), 0, Math.PI * 2); ctx.fill();
}
function drawPen(ctx, pts, w) {
  if (pts.length === 1) { penDot(ctx, pts[0], w); return; }
  for (let i = 1; i <= pts.length; i++) penPiece(ctx, pts, i, w);
}

/* ---------- Mürekkep motoru ----------
   Ham noktalar [x, y, f] (f: basınç ve hızdan gelen genişlik çarpanı) Hermite eğrisiyle sık örneklenir.
   Örnekler [x, y, f, d] (d: baştan uzaklık). Yuvarlak uçlarda her örnek bir daire, ardışık iki daire
   arası teğet yamuk olur; kesik uçta (kaligrafi) ardışık uç dikdörtgenlerinin dışbükey örtüsü alınır.
   Tüm parçalar aynı yönde sarılıp tek yolda doldurulduğu için (nonzero) birleşim dikişsiz çıkar. */
function inkFactor(k, p, v) {
  if (k === 'ball') return 0.85 + 0.3 * p;
  if (k === 'brush') return (0.05 + 2.2 * Math.pow(p, 1.4)) * (1 - 0.3 * clamp(v / 2, 0, 1));
  if (k === 'callig') return 0.75 + 0.5 * p;
  return (0.25 + 1.5 * p) * (1 - 0.2 * clamp(v / 2.5, 0, 1));
}
const pressGamma = () => Math.pow(2, (50 - state.press) / 36);
const nibStep = (o) => clamp(o.w * 0.22, 0.2, 0.8);
function hermSeg(P, i, step, S) {
  const p1 = P[i], p2 = P[i + 1], p0 = P[i - 1] || p1, p3 = P[i + 2] || p2;
  const l01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), l23 = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  // Teğetler parça uzunluğuna göre ölçeklenir: düzensiz aralıklı noktalarda taşma ve düğüm olmaz.
  const k1 = l12 / ((l01 + l12) || 1), k2 = l12 / ((l12 + l23) || 1);
  const m1x = (p2[0] - p0[0]) * k1, m1y = (p2[1] - p0[1]) * k1, m2x = (p3[0] - p1[0]) * k2, m2y = (p3[1] - p1[1]) * k2;
  const n = Math.max(1, Math.ceil(l12 / step));
  let last = S[S.length - 1];
  for (let j = 1; j <= n; j++) {
    const t = j / n, t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const x = h00 * p1[0] + h10 * m1x + h01 * p2[0] + h11 * m2x, y = h00 * p1[1] + h10 * m1y + h01 * p2[1] + h11 * m2y;
    S.push(last = [x, y, p1[2] + (p2[2] - p1[2]) * t, last[3] + Math.hypot(x - last[0], y - last[1])]);
  }
}
function samplesOf(o, step) {
  const P = o.pts, S = [[P[0][0], P[0][1], P[0][2], 0]];
  for (let i = 0; i < P.length - 1; i++) hermSeg(P, i, step, S);
  return S;
}
// Canlı çizimde örnekler artımlı tutulur; son iki ham parça yeni nokta gelince değişebildiği için geçicidir.
class InkTrack {
  constructor(o) { this.o = o; this.step = nibStep(o); this.S = []; this.seg = 0; this.fixed = 0; }
  update() {
    const P = this.o.pts, n = P.length, S = this.S;
    S.length = this.fixed;
    if (!S.length) { if (!n) return; S.push([P[0][0], P[0][1], P[0][2], 0]); }
    for (let i = this.seg; i < n - 1; i++) {
      hermSeg(P, i, this.step, S);
      if (i === this.seg && i + 2 <= n - 1) { this.seg++; this.fixed = S.length; }
    }
  }
}
function orient(P) {
  let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  if (a < 0) P.reverse(); return P;
}
function hull(P) {
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return orient(lo.concat(up));
}
// Örnekler from..to arasını sink'e (canvas yolu veya PDF yolu) dolu parçalar olarak yazar. L: toplam uzunluk.
function nibGeom(o, S, from, to, L, final, sink) {
  const nib = NIBS[o.k] || NIBS.fountain, w = o.w;
  let ts = nib.ts * w, te = final ? nib.te * w : 0;
  if (ts + te > L && ts + te > 0) { const s = L / (ts + te); ts *= s; te *= s; }
  const amt = clamp((L - w * 0.5) / (w * 2), 0, 1); // nokta ve çok kısa çizgilerde incelme yok
  const size = (s) => {
    let m = 1;
    if (ts > 0 && s[3] < ts) { const t = s[3] / ts; m *= t * (2 - t); }
    if (te > 0 && L - s[3] < te) { const t = Math.max(0, L - s[3]) / te; m *= t * (2 - t); }
    m = nib.min + (1 - nib.min) * m;
    return w * s[2] * (1 - amt * (1 - m));
  };
  if (nib.flat) {
    const ux = Math.cos(nib.ang), uy = Math.sin(nib.ang);
    const rect = (s) => { const a = 0.9 * size(s), b = Math.max(0.12, a * 0.12); return [[s[0] + a * ux - b * uy, s[1] + a * uy + b * ux], [s[0] + a * ux + b * uy, s[1] + a * uy - b * ux], [s[0] - a * ux + b * uy, s[1] - a * uy - b * ux], [s[0] - a * ux - b * uy, s[1] - a * uy + b * ux]]; };
    let prev = rect(S[from]); sink.poly(orient(prev.slice()));
    for (let i = from + 1; i <= to; i++) { const r = rect(S[i]); sink.poly(hull(prev.concat(r))); prev = r; }
    return;
  }
  let pr = null, prA = null, prDrawn = false;
  for (let i = from; i <= to; i++) {
    const s = S[i], r = Math.max(0.06, size(s) / 2);
    let drawn = false;
    if (pr) {
      const dx = s[0] - pr[0], dy = s[1] - pr[1], d = Math.hypot(dx, dy);
      if (d > Math.abs(r - pr[2]) + 1e-4) {
        const a = Math.atan2(dy, dx), ph = Math.acos(clamp((pr[2] - r) / d, -1, 1));
        const ca = Math.cos(a + ph), sa = Math.sin(a + ph), cb = Math.cos(a - ph), sb = Math.sin(a - ph);
        sink.poly(orient([[pr[0] + pr[2] * ca, pr[1] + pr[2] * sa], [s[0] + r * ca, s[1] + r * sa], [s[0] + r * cb, s[1] + r * sb], [pr[0] + pr[2] * cb, pr[1] + pr[2] * sb]]));
        // Dönüşlerde iki yamuk arasında kama boşluğu kalır; onu ortak noktadaki daire kapatır.
        if (!prDrawn && prA !== null) { let da = Math.abs(a - prA); if (da > Math.PI) da = 2 * Math.PI - da; if (da * pr[2] > (sink.eps || 0.012)) sink.circle(pr[0], pr[1], pr[2]); }
        prA = a;
      } else {
        if (!prDrawn) sink.circle(pr[0], pr[1], pr[2]);
        sink.circle(s[0], s[1], r); drawn = true; prA = null;
      }
    }
    if (i === from || (i === to && !drawn)) { sink.circle(s[0], s[1], r); drawn = true; }
    pr = [s[0], s[1], r]; prDrawn = drawn;
  }
}
function canvasSink(ctx) {
  return {
    poly(P) { ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.closePath(); },
    circle(x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath(); }
  };
}
function fillGeom(ctx, o, S, from, to, L, final) { ctx.beginPath(); nibGeom(o, S, from, to, L, final, canvasSink(ctx)); ctx.fill('nonzero'); }
function drawInkObj(ctx, o) {
  const S = o._S || (o._S = samplesOf(o, nibStep(o)));
  fillGeom(ctx, o, S, 0, S.length - 1, S[S.length - 1][3], true);
}
function reachOf(o) {
  if (o.t === 'hl') return o.w / 2;
  if (!o.k) return o.w * 0.9;
  let m = 0; for (const p of o.pts) if (p[2] > m) m = p[2];
  return o.w * m * (NIBS[o.k] && NIBS[o.k].flat ? 0.95 : 0.5);
}
function strokePath(ctx, pts, w) {
  ctx.lineWidth = w;
  if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], w / 2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); return; }
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) { const m = mid(pts[i - 1], pts[i]); ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], m[0], m[1]); }
  const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]); ctx.stroke();
}
function arrowHead(o) {
  const [x1, y1] = o.a, [x2, y2] = o.b, ang = Math.atan2(y2 - y1, x2 - x1), L = Math.max(10, o.w * 5), s = 0.5;
  return [[x2 - L * Math.cos(ang - s), y2 - L * Math.sin(ang - s)], [x2, y2], [x2 - L * Math.cos(ang + s), y2 - L * Math.sin(ang + s)]];
}
const rotPt = (q, cx, cy, t) => { const c = Math.cos(t), s = Math.sin(t), x = q[0] - cx, y = q[1] - cy; return [cx + x * c - y * s, cy + x * s + y * c]; };
const midOf = (o) => [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
function drawShape(ctx, o) {
  if (o.rot) { const [cx, cy] = midOf(o); ctx.translate(cx, cy); ctx.rotate(o.rot); ctx.translate(-cx, -cy); } // döndürülmüş dikdörtgen/elips
  const [x1, y1] = o.a, [x2, y2] = o.b;
  ctx.lineWidth = o.w; ctx.beginPath();
  if (o.t === 'line' || o.t === 'arrow') {
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    if (o.t === 'arrow') { const h = arrowHead(o); ctx.moveTo(h[0][0], h[0][1]); ctx.lineTo(h[1][0], h[1][1]); ctx.lineTo(h[2][0], h[2][1]); }
  } else if (o.t === 'rect') {
    ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else {
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(0.1, Math.abs(x2 - x1) / 2), Math.max(0.1, Math.abs(y2 - y1) / 2), 0, 0, Math.PI * 2);
  }
  ctx.stroke();
}
function setStyle(ctx, o) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = o.c; ctx.fillStyle = o.c;
}
function drawObj(ctx, o) {
  ctx.save(); setStyle(ctx, o);
  if (o.t === 'pen') o.k ? drawInkObj(ctx, o) : drawPen(ctx, o.pts, o.w);
  else if (o.t === 'hl') { ctx.globalAlpha = HL_ALPHA; strokePath(ctx, o.pts, o.w); }
  else drawShape(ctx, o);
  ctx.restore();
}
function bboxOf(o) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pad;
  if (o.pts) { for (const p of o.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } pad = o.t === 'hl' ? o.w : o.k ? reachOf(o) + 1.5 : o.w * 1.1 + 1; }
  else if (o.rot) { const [cx, cy] = midOf(o); for (const q of [o.a, [o.b[0], o.a[1]], o.b, [o.a[0], o.b[1]]]) { const p = rotPt(q, cx, cy, o.rot); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } pad = o.w + 1; }
  else { x0 = Math.min(o.a[0], o.b[0]); x1 = Math.max(o.a[0], o.b[0]); y0 = Math.min(o.a[1], o.b[1]); y1 = Math.max(o.a[1], o.b[1]); pad = o.w + (o.t === 'arrow' ? Math.max(10, o.w * 5) : 0) + 1; }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
function ellipsePoly(o, n = 48) {
  const cx = (o.a[0] + o.b[0]) / 2, cy = (o.a[1] + o.b[1]) / 2, rx = Math.abs(o.b[0] - o.a[0]) / 2, ry = Math.abs(o.b[1] - o.a[1]) / 2, out = [];
  for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2; out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
  return out;
}
function polyDist(poly, x, y) { let d = Infinity; for (let i = 1; i < poly.length; i++) d = Math.min(d, distSeg(x, y, poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1])); return d; }
function hit(o, x, y, r) {
  const bb = o.bb; if (x < bb[0] - r || x > bb[2] + r || y < bb[1] - r || y > bb[3] + r) return false;
  if (o.pts) { const tol = r + reachOf(o); if (o.pts.length === 1) return Math.hypot(x - o.pts[0][0], y - o.pts[0][1]) <= tol; return polyDist(o.pts, x, y) <= tol; }
  if (o.rot) { const [cx, cy] = midOf(o); [x, y] = rotPt([x, y], cx, cy, -o.rot); } // noktayı şeklin kendi eksenine çevir
  const tol = r + o.w / 2, [x1, y1] = o.a, [x2, y2] = o.b;
  if (o.t === 'line') return distSeg(x, y, x1, y1, x2, y2) <= tol;
  if (o.t === 'arrow') return distSeg(x, y, x1, y1, x2, y2) <= tol || polyDist(arrowHead(o), x, y) <= tol;
  if (o.t === 'rect') return polyDist([[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]], x, y) <= tol;
  return polyDist(ellipsePoly(o), x, y) <= tol;
}

/* ---------- Sayfa görünümü ---------- */
class PageView {
  constructor(i, page) {
    this.i = i; this.page = page; this.vp = page.getViewport({ scale: 1 });
    this.w = this.vp.width; this.h = this.vp.height; this.objs = [];
    this.el = document.createElement('div'); this.el.className = 'page'; this.el.dataset.i = String(i);
    this.ink = document.createElement('canvas'); this.ctx = null; this.pdfCanvas = null;
    this.active = false; this.token = 0; this.task = null; this.k = 1;
    this.layout();
  }
  layout() { this.el.style.width = (this.w * state.scale) + 'px'; this.el.style.height = (this.h * state.scale) + 'px'; }
  pxScale() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    return Math.max(0.1, Math.min(state.scale * dpr, Math.sqrt(14e6 / (this.w * this.h)), 8192 / Math.max(this.w, this.h)));
  }
  activate() { if (this.active) return; this.active = true; this.refresh(); if (!this.links) this.loadLinks(); }
  // PDF bağlantı açıklamaları sayfanın üstüne yüzde konumlu görünmez alanlar olarak eklenir (yakınlaştırmayla ölçeklenir).
  loadLinks() {
    this.links = [];
    this.page.getAnnotations({ intent: 'display' }).then((anns) => {
      for (const a of anns) {
        if (a.subtype !== 'Link') continue;
        const link = a.url ? { url: a.url } : a.dest ? { dest: a.dest } : a.action ? { action: a.action } : null;
        if (!link) continue;
        const r = this.vp.convertToViewportRectangle(a.rect), x0 = Math.min(r[0], r[2]), y0 = Math.min(r[1], r[3]), x1 = Math.max(r[0], r[2]), y1 = Math.max(r[1], r[3]);
        const el = document.createElement('div'); el.className = 'lnk'; el._link = link;
        el.style.left = (x0 / this.w * 100) + '%'; el.style.top = (y0 / this.h * 100) + '%';
        el.style.width = ((x1 - x0) / this.w * 100) + '%'; el.style.height = ((y1 - y0) / this.h * 100) + '%';
        if (a.url) el.title = a.url;
        // PDF bağlantıya çerçeve tanımlamışsa (ör. hyperref kutuları) onu da göster.
        if (a.borderStyle && a.borderStyle.width > 0 && a.color && a.color.length === 3) el.style.boxShadow = `inset 0 0 0 1px rgb(${a.color[0]}, ${a.color[1]}, ${a.color[2]})`;
        this.el.appendChild(el); this.links.push(el);
      }
    }).catch((err) => console.error('Bağlantılar okunamadı', err));
  }
  deactivate() {
    if (!this.active) return; if (sel && sel.pv === this) clearSel(); this.active = false; this.token++;
    if (this.task) { try { this.task.cancel(); } catch (e) {} this.task = null; }
    if (this.pdfCanvas) { this.pdfCanvas.remove(); this.pdfCanvas.width = 0; this.pdfCanvas = null; }
    this.ink.remove(); this.ink.width = 0; this.ctx = null;
    if (!cur && ov.cv.parentNode === this.el) detachOverlay();
  }
  refresh() {
    if (!this.active) return;
    const k = this.pxScale(), token = ++this.token; this.k = k;
    if (!this.ink.parentNode) { this.ink.className = 'ink'; this.el.appendChild(this.ink); }
    this.ink.width = Math.ceil(this.w * k); this.ink.height = Math.ceil(this.h * k);
    this.ctx = this.ink.getContext('2d'); this.drawInk();
    if (this.task) { try { this.task.cancel(); } catch (e) {} }
    const cv = document.createElement('canvas'); cv.className = 'pdf'; cv.width = Math.ceil(this.w * k); cv.height = Math.ceil(this.h * k);
    const task = this.page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: this.page.getViewport({ scale: k }), background: '#ffffff' });
    this.task = task;
    task.promise.then(() => {
      if (token !== this.token || !this.active) { cv.width = 0; return; }
      const old = this.pdfCanvas; this.pdfCanvas = cv;
      if (old) { old.replaceWith(cv); old.width = 0; } else this.el.insertBefore(cv, this.el.firstChild);
    }).catch((err) => { if (!err || err.name !== 'RenderingCancelledException') console.error(err); });
  }
  drawInk() {
    if (!this.ctx) return;
    const c = this.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.ink.width, this.ink.height);
    c.setTransform(this.k, 0, 0, this.k, 0, 0);
    for (const o of this.objs) drawObj(c, o);
  }
}

/* ---------- Canlı çizim katmanı (düşük gecikme) ---------- */
const ov = { cv: document.createElement('canvas'), pr: document.createElement('canvas'), cx: null, px: null, owner: null };
ov.cv.className = 'ov'; ov.pr.className = 'ov';
ov.cx = ov.cv.getContext('2d', { desynchronized: true });
ov.px = ov.pr.getContext('2d', { desynchronized: true });
function detachOverlay() { ov.cv.remove(); ov.pr.remove(); ov.cv.width = ov.cv.height = ov.pr.width = ov.pr.height = 0; ov.owner = null; }
function attachOverlay(pv) {
  if (ov.cv.parentNode !== pv.el) { pv.el.appendChild(ov.cv); pv.el.appendChild(ov.pr); }
  const w = pv.ink.width, h = pv.ink.height;
  if (ov.cv.width !== w || ov.cv.height !== h || ov.owner !== pv || ov.k !== pv.k) {
    ov.cv.width = ov.pr.width = w; ov.cv.height = ov.pr.height = h;
  }
  ov.owner = pv; ov.k = pv.k;
  for (const c of [ov.cx, ov.px]) c.setTransform(pv.k, 0, 0, pv.k, 0, 0);
}
const clearBB = (ctx, bb) => ctx.clearRect(bb[0] - 2, bb[1] - 2, bb[2] - bb[0] + 4, bb[3] - bb[1] + 4);
const unionBB = (a, b) => a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b;

/* ---------- Geçmiş (geri al / ileri al) ---------- */
function pushAction(a) { state.dirty = true; scheduleInkSave(); state.undo.push(a); state.redo.length = 0; updateHist(); }
function updateHist() { $('#btnUndo').disabled = !state.undo.length; $('#btnRedo').disabled = !state.redo.length; }
function revealPage(pv) { const r = pv.el.getBoundingClientRect(), v = viewer.getBoundingClientRect(); if (r.bottom < v.top || r.top > v.bottom) pv.el.scrollIntoView({ block: 'center' }); }
function undo() {
  if (sel) clearSel();
  const a = state.undo.pop(); if (!a) return;
  if (a.k === 'move') { for (const o of a.objs) translateObj(o, -a.dx, -a.dy); a.pv.drawInk(); revealPage(a.pv); state.redo.push(a); state.dirty = true; scheduleInkSave(); updateHist(); return; }
  if (a.k === 'xform') { applyXform(a, true); a.pv.drawInk(); revealPage(a.pv); state.redo.push(a); state.dirty = true; scheduleInkSave(); updateHist(); return; }
  if (a.k === 'add') { const i = a.pv.objs.indexOf(a.o); if (i >= 0) a.pv.objs.splice(i, 1); }
  else for (let j = a.items.length - 1; j >= 0; j--) a.items[j].pv.objs.splice(a.items[j].idx, 0, a.items[j].o);
  const pvs = a.k === 'add' ? [a.pv] : [...new Set(a.items.map((x) => x.pv))];
  pvs.forEach((p) => p.drawInk()); revealPage(pvs[0]);
  state.redo.push(a); state.dirty = true; scheduleInkSave(); updateHist();
}
function redo() {
  if (sel) clearSel();
  const a = state.redo.pop(); if (!a) return;
  if (a.k === 'move') { for (const o of a.objs) translateObj(o, a.dx, a.dy); a.pv.drawInk(); revealPage(a.pv); state.undo.push(a); state.dirty = true; scheduleInkSave(); updateHist(); return; }
  if (a.k === 'xform') { applyXform(a, false); a.pv.drawInk(); revealPage(a.pv); state.undo.push(a); state.dirty = true; scheduleInkSave(); updateHist(); return; }
  if (a.k === 'add') a.pv.objs.push(a.o);
  else for (const it of a.items) { const i = it.pv.objs.indexOf(it.o); if (i >= 0) it.pv.objs.splice(i, 1); }
  const pvs = a.k === 'add' ? [a.pv] : [...new Set(a.items.map((x) => x.pv))];
  pvs.forEach((p) => p.drawInk()); revealPage(pvs[0]);
  state.undo.push(a); state.dirty = true; scheduleInkSave(); updateHist();
}

/* ---------- Lazer kalem ----------
   Neon iz: geniş renkli parıltı + parlak renkli çizgi + beyaza yakın çekirdek. Yazarken izler durur,
   kalem kalktıktan ayarlardaki süre (opts.laserHold) sonra hepsi birlikte LASER_FADE ms içinde söner. PDF'e kaydedilmez.
   Noktalar kaydırmaya göre saklanır; sayfa kayarsa iz sayfayla birlikte kayar. */
const LASER_FADE = 550;
const L = { cv: $('#laser'), ctx: null, dot: $('#laserDot'), strokes: [], drawing: false, last: 0, raf: 0, dpr: 1 };
L.ctx = L.cv.getContext('2d', { desynchronized: true });
function neonCore(hex) {
  const n = parseInt(hex.slice(1), 16), m = (v) => Math.round(v + (255 - v) * 0.72);
  return 'rgb(' + m((n >> 16) & 255) + ',' + m((n >> 8) & 255) + ',' + m(n & 255) + ')';
}
function laserStart(e) {
  const vr = viewer.getBoundingClientRect(), c = state.colors.laser, w = state.sizes.laser;
  const s = { c, core: neonCore(c), w, pts: [[e.clientX - vr.left + viewer.scrollLeft, e.clientY - vr.top + viewer.scrollTop]] };
  L.strokes.push(s); if (L.strokes.length > 60) L.strokes.shift();
  cur = { id: e.pointerId, tool: 'laser', laser: true, ls: s, vr, ptype: e.pointerType, link: linkAt(e), x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: 0, erased: [] };
  L.drawing = true; L.last = performance.now(); showDot(e, e.pointerType !== 'touch'); laserKick();
}
function laserMove(c, e) {
  const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [], P = c.ls.pts, sl = viewer.scrollLeft, st = viewer.scrollTop;
  for (const ev of (list.length ? list : [e])) {
    const x = ev.clientX - c.vr.left + sl, y = ev.clientY - c.vr.top + st, l = P[P.length - 1];
    if (Math.hypot(x - l[0], y - l[1]) >= 0.8) P.push([x, y]);
  }
  if (c.ptype !== 'touch') showDot(e, true);
  L.last = performance.now(); laserKick();
}
function laserEnd(c, e, cancel) {
  L.drawing = false; L.last = performance.now();
  if (!cancel && c.link && c.moved < 6 && e.timeStamp - c.t0 < 450) { const i = L.strokes.indexOf(c.ls); if (i >= 0) L.strokes.splice(i, 1); followLink(c.link._link, c.link); }
  laserKick();
}
function laserClear() { if (!L.strokes.length) return; L.strokes.length = 0; laserKick(); }
function laserKick() { if (!L.raf) L.raf = requestAnimationFrame(laserTick); }
function laserTick() {
  L.raf = 0;
  const dpr = window.devicePixelRatio || 1, W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
  if (L.cv.width !== W || L.cv.height !== H) { L.cv.width = W; L.cv.height = H; }
  L.dpr = dpr;
  const c = L.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
  let a = 1;
  if (!L.drawing) { const t = performance.now() - L.last - state.opts.laserHold; if (t > 0) a = 1 - t / LASER_FADE; }
  if (a <= 0 || !L.strokes.length) { L.strokes.length = 0; return; }
  drawNeon(c, a);
  L.raf = requestAnimationFrame(laserTick);
}
function drawNeon(c, a) {
  const d = L.dpr, vr = viewer.getBoundingClientRect();
  c.setTransform(d, 0, 0, d, (vr.left - viewer.scrollLeft) * d, (vr.top - viewer.scrollTop) * d);
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const s of L.strokes) {
    const P = s.pts, p = new Path2D();
    p.moveTo(P[0][0], P[0][1]);
    if (P.length === 1) p.lineTo(P[0][0] + 0.01, P[0][1]);
    for (let i = 1; i < P.length; i++) { const m = mid(P[i - 1], P[i]); p.quadraticCurveTo(P[i - 1][0], P[i - 1][1], m[0], m[1]); }
    if (P.length > 1) { const l = P[P.length - 1]; p.lineTo(l[0], l[1]); }
    c.strokeStyle = s.c; c.shadowColor = s.c;
    c.globalAlpha = a * 0.35; c.shadowBlur = s.w * 11 * d; c.lineWidth = s.w * 3.6; c.stroke(p); // geniş hale
    c.globalAlpha = a * 0.75; c.shadowBlur = s.w * 5 * d; c.lineWidth = s.w * 1.9; c.stroke(p);  // yakın parıltı
    c.globalAlpha = a; c.shadowBlur = s.w * 2 * d; c.lineWidth = s.w; c.stroke(p);               // neon tüp
    c.shadowBlur = 0; c.strokeStyle = s.core; c.lineWidth = Math.max(1, s.w * 0.36); c.stroke(p); // parlak çekirdek
  }
  c.shadowBlur = 0; c.globalAlpha = 1;
}
// Kalem ekranın üstünde gezinirken ucunda parlayan lazer noktası.
function showDot(e, on) {
  const d = L.dot;
  if (!on || !e) { if (d.style.display !== 'none') d.style.display = 'none'; return; }
  const col = state.colors.laser, w = state.sizes.laser, s = Math.max(12, w * 3);
  if (d._c !== col || d._s !== s) {
    d._c = col; d._s = s; d.style.width = d.style.height = s + 'px';
    d.style.background = 'radial-gradient(circle, ' + neonCore(col) + ' 0 32%, ' + col + ' 62%)';
    d.style.boxShadow = '0 0 ' + (w * 1.6) + 'px ' + (w * 0.5) + 'px ' + col + ', 0 0 ' + (w * 4.5) + 'px ' + w + 'px ' + col + '88';
  }
  d.style.transform = 'translate(' + (e.clientX - s / 2) + 'px, ' + (e.clientY - s / 2) + 'px)'; d.style.display = 'block';
}

/* ---------- Kalem / fare girdisi ---------- */
let cur = null;           // sürmekte olan çizim
let lastPenTime = 0;
const touches = new Map(); // parmak hareketleri

function pageOf(e) { const el = e.target && e.target.closest ? e.target.closest('.page') : null; return el ? state.pages[+el.dataset.i] : null; }
function toolFor(e) {
  if (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32))) return 'eraser'; // kalemin silgi ucu
  const side = (e.pointerType === 'pen' && (e.buttons & 2)) || (e.pointerType === 'mouse' && (e.button === 2 || (e.buttons & 2)));
  if (side) return e.pointerType === 'pen' && state.opts.barrel === 'eraser' ? 'eraser' : 'lasso'; // yan tuş / sağ tuş
  return state.tool;
}
function showRing(e, on) {
  if (!on) { ring.style.display = 'none'; return; }
  const d = state.sizes.eraser * 2; ring.style.width = ring.style.height = d + 'px';
  ring.style.transform = `translate(${e.clientX - d / 2}px, ${e.clientY - d / 2}px)`; ring.style.display = 'block';
}
function setPtr() {}

viewer.addEventListener('contextmenu', (e) => e.preventDefault());
// Bir olay işleyicisinde beklenmeyen hata olursa yarım kalan çizim sıfırlanır; kalem kilitli kalmaz.
function safe(fn) {
  return (e) => { try { fn(e); } catch (err) { console.error(err); cur = null; touches.clear(); try { clearOverlayNow(); } catch (e2) {} } };
}
viewer.addEventListener('pointerdown', safe((e) => {
  if (anyDrawerOpen()) { closeCurtain(); closeSides(); e.preventDefault(); return; }
  if (e.pointerType === 'pen') lastPenTime = performance.now();
  if (e.pointerType === 'touch' && !state.touchDraw && !onSelection(e)) {
    if (performance.now() - lastPenTime < 700) return; // avuç içi
    try { viewer.setPointerCapture(e.pointerId); } catch (err) {} stopSlide();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, link: linkAt(e), idx: currentIndex(), multi: false });
    if (touches.size > 1) touches.forEach((t) => { t.multi = true; });
    e.preventDefault(); return;
  }
  if (e.pointerType === 'mouse' && e.button === 3) { e.preventDefault(); goBack(); return; }
  if (e.pointerType === 'mouse' && e.button === 4) { e.preventDefault(); goForward(); return; }
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  if (toolFor(e) === 'laser' && !onSelection(e)) { if (cur) return; e.preventDefault(); try { viewer.setPointerCapture(e.pointerId); } catch (err) {} laserStart(e); return; }
  const pv = pageOf(e); if (!pv || !pv.active || !pv.ctx || cur) return;
  e.preventDefault(); try { viewer.setPointerCapture(e.pointerId); } catch (err) {}
  startStroke(e, pv);
}));
viewer.addEventListener('pointermove', safe((e) => {
  if (e.pointerType === 'pen') lastPenTime = performance.now();
  if (touches.has(e.pointerId)) { touchMove(e); return; }
  const t = cur ? cur.tool : toolFor(e);
  showRing(e, t === 'eraser' && e.pointerType !== 'touch');
  showDot(e, t === 'laser' && e.pointerType !== 'touch');
  if (!cur && sel && e.pointerType !== 'touch') hoverSel(e);
  if (cur && e.pointerId === cur.id) { e.preventDefault(); if (cur.raw) predictInk(e); else moveStroke(e); }
}));
// pointerrawupdate ekran karesini beklemeden gelir: kalem ucunun gecikmesini azaltır.
viewer.addEventListener('pointerrawupdate', safe((e) => {
  if (cur && e.pointerId === cur.id && (cur.trk || cur.laser)) { cur.raw = true; moveStroke(e); }
}));
function endPointer(e, cancel) {
  if (touches.has(e.pointerId)) {
    const t = touches.get(e.pointerId); touches.delete(e.pointerId); prevPinch = null;
    if (cancel || t.multi || touches.size) return;
    const dx = e.clientX - t.x0, dy = e.clientY - t.y0, dt = Math.max(1, e.timeStamp - t.t0), dist = Math.hypot(dx, dy);
    if (t.link && dist < 10 && dt < 450) { followLink(t.link._link, t.link); return; }
    if (dist < 10 && dt < 350) { fingerTap(e); return; }
    if (state.paged && state.opts.swipeNav) {
      // Sunum modu: kaydırma yarım kalmaz; yeterince çekilirse sonraki/önceki slayta geçer, yoksa geri yaylanır.
      const v = dy / dt; let to = t.idx;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) to += dx < 0 ? 1 : -1;
      else if (dy < -60 || v < -0.45) to += 1;
      else if (dy > 60 || v > 0.45) to -= 1;
      slideTo(to);
    }
    return;
  }
  if (cur && e.pointerId === cur.id) endStroke(e, cancel);
}
viewer.addEventListener('pointerup', safe((e) => endPointer(e, false)));
viewer.addEventListener('pointercancel', safe((e) => endPointer(e, true)));
viewer.addEventListener('pointerleave', (e) => { if (!cur) { showRing(e, false); showDot(e, false); } });
viewer.addEventListener('lostpointercapture', safe((e) => { if (cur && e.pointerId === cur.id) endStroke(e, false); }));

function toPage(cx, cy, r) { return [(cx - r.left) / state.scale, (cy - r.top) / state.scale]; }

function startStroke(e, pv) {
  closeCurtain();
  const tool = toolFor(e), r = pv.el.getBoundingClientRect(), p = toPage(e.clientX, e.clientY, r);
  cur = { id: e.pointerId, pv, tool, r, ptype: e.pointerType, dirty: null, obj: null, erased: [], shift: e.shiftKey, link: linkAt(e), x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: 0 };
  if (tool === 'lasso') { clearSel(); flushOvClear(); attachOverlay(pv); ov.cv.style.opacity = '1'; cur.lasso = [p]; return; }
  if (sel && sel.pv === pv) {
    const h = handleAt(p);
    if (h === 'tr') { // sağ üst: döndür (seçimin merkezi etrafında)
      const cx = (sel.bb[0] + sel.bb[2]) / 2, cy = (sel.bb[1] + sel.bb[3]) / 2;
      cur.tool = 'rotate'; cur.xf = { op: 'rotate', cx, cy, a0: Math.atan2(p[1] - cy, p[0] - cx), t: 0 }; sel.view = { bb: sel.bb.slice(), cx, cy, t: 0 }; return;
    }
    if (h) { // diğer köşeler: karşı köşe sabit, orantılı büyüt/küçült
      const b = sel.bb, ax = h === 'tl' || h === 'bl' ? b[2] : b[0], ay = h === 'tl' ? b[3] : b[1];
      cur.tool = 'scale'; cur.xf = { op: 'scale', ax, ay, d0: Math.max(1e-3, Math.hypot(p[0] - ax, p[1] - ay)), s: 1, h }; return;
    }
    if (insideSel(p)) { cur.tool = 'move'; cur.drag = true; cur.p0 = p; cur.dx = 0; cur.dy = 0; return; }
  }
  if (sel) clearSel();
  const meta = TOOLS[tool];
  if (tool === 'eraser') { showRing(e, true); eraseAt(p[0], p[1]); return; }
  const color = state.colors[meta.ck], w = state.sizes[sizeKey(tool)];
  flushOvClear(); attachOverlay(pv);
  ov.cv.style.opacity = tool === 'hl' ? String(HL_ALPHA) : '1';
  if (tool === 'pen') {
    cur.obj = { t: 'pen', k: state.nib, c: color, w, pts: [] };
    cur.trk = new InkTrack(cur.obj); cur.commit = 0; cur.v = 0; cur.ps = null; cur.minD = 0.3 / state.scale;
    cur.lt = e.timeStamp; cur.lx = e.clientX; cur.ly = e.clientY;
    setStyle(ov.cx, cur.obj); setStyle(ov.px, cur.obj);
    inkInput(cur, e); renderLive(cur);
  } else if (tool === 'hl') {
    cur.obj = { t: tool, c: color, w, pts: [[p[0], p[1], 1]] };
    setStyle(ov.cx, cur.obj); strokePath(ov.cx, cur.obj.pts, w); cur.dirty = bboxOf(cur.obj);
  } else {
    cur.obj = { t: tool, c: color, w, a: p, b: p.slice() };
    setStyle(ov.cx, cur.obj);
  }
}
// Bir kalem örneğini işler: basınç (yoksa hızdan taklit), basınç eğrisi, yumuşatma ve uç tipine göre genişlik.
function inkInput(c, ev) {
  const o = c.obj, P = o.pts, p = toPage(ev.clientX, ev.clientY, c.r);
  if (P.length) {
    const dt = Math.max(1, ev.timeStamp - c.lt), sp = Math.hypot(ev.clientX - c.lx, ev.clientY - c.ly) / dt;
    c.v += (Math.min(sp, 8) - c.v) * 0.35;
  }
  c.lt = ev.timeStamp; c.lx = ev.clientX; c.ly = ev.clientY;
  const pen = c.ptype === 'pen';
  if (pen && ev.pressure > 0 && ev.pressure !== 0.5) state.hasPressure = true;
  let pr = pen && state.hasPressure ? (ev.pressure > 0 ? ev.pressure : 0.05) : 0.72 - 0.52 * clamp(c.v / 1.6, 0, 1); // basınç yoksa: yavaş = kalın, hızlı = ince
  pr = Math.pow(clamp(pr, 0, 1), pressGamma());
  c.ps = c.ps == null ? pr : c.ps + (pr - c.ps) * 0.5;
  const f = inkFactor(o.k, c.ps, c.v);
  c.rawPt = p;
  const last = P[P.length - 1];
  if (!last) { P.push([p[0], p[1], f]); return; }
  // Yavaşken titremeyi süzer, hızlıyken gecikme yaratmaz.
  const a = 0.4 + 0.5 * clamp(c.v / 1.2, 0, 1), q = [last[0] + (p[0] - last[0]) * a, last[1] + (p[1] - last[1]) * a];
  if (Math.hypot(q[0] - last[0], q[1] - last[1]) < c.minD) { last[2] = f; return; }
  P.push([q[0], q[1], f]);
}
// Canlı çizim: kesinleşen eski kısım alt katmana bir kez basılır, kalan kuyruk üst katmanda her olayda yeniden çizilir.
function renderLive(c) {
  const o = c.obj, T = c.trk; T.update();
  const S = T.S; if (!S.length) return;
  const L = S[S.length - 1][3], nib = NIBS[o.k];
  if (T.fixed - c.commit > 200 && L > (nib.ts + 3) * o.w) { const k = T.fixed - 1; fillGeom(ov.cx, o, S, c.commit, k, L, false); c.commit = k; }
  const tail = S.slice(c.commit);
  if (c.pred) for (const q of c.pred) { const l = tail[tail.length - 1]; tail.push([q[0], q[1], l[2], l[3] + Math.hypot(q[0] - l[0], q[1] - l[1])]); }
  if (c.tailBB) clearBB(ov.px, c.tailBB);
  fillGeom(ov.px, o, tail, 0, tail.length - 1, tail[tail.length - 1][3], false);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, fm = 0;
  for (const s of tail) { if (s[0] < x0) x0 = s[0]; if (s[0] > x1) x1 = s[0]; if (s[1] < y0) y0 = s[1]; if (s[1] > y1) y1 = s[1]; if (s[2] > fm) fm = s[2]; }
  const pad = o.w * fm + 2; c.tailBB = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
function predictInk(e) {
  const c = cur; if (!c.trk) return;
  const pe = e.getPredictedEvents ? e.getPredictedEvents() : null;
  c.pred = pe && pe.length ? pe.slice(0, 3).map((ev) => toPage(ev.clientX, ev.clientY, c.r)) : null;
  renderLive(c);
}
function moveStroke(e) {
  const c = cur, o = c.obj;
  c.moved = Math.max(c.moved, Math.hypot(e.clientX - c.x0, e.clientY - c.y0));
  if (c.laser) { laserMove(c, e); return; }
  const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [], evs = list.length ? list : [e];
  if (c.lasso) { for (const ev of evs) c.lasso.push(toPage(ev.clientX, ev.clientY, c.r)); drawLasso(c.lasso); return; }
  if (c.xf) {
    const p = toPage(e.clientX, e.clientY, c.r), x = c.xf;
    if (x.op === 'rotate') {
      let t = Math.atan2(p[1] - x.cy, p[0] - x.cx) - x.a0;
      while (t - x.t > Math.PI) t -= 2 * Math.PI; while (t - x.t < -Math.PI) t += 2 * Math.PI; // ±180°'de sıçrama olmasın
      const deg = t * 180 / Math.PI, near = Math.round(deg / 90) * 90; if (Math.abs(deg - near) < 4) t = near * Math.PI / 180; // düz açılara oturt
      for (const o of sel.objs) rotateObj(o, x.cx, x.cy, t - x.t); x.t = t; sel.view.t = t;
      sel.label = Math.round(((t * 180 / Math.PI) % 360 + 540) % 360 - 180) + '°';
    } else {
      const s = clamp(Math.hypot(p[0] - x.ax, p[1] - x.ay) / x.d0, 0.1, 10);
      for (const o of sel.objs) scaleObj(o, x.ax, x.ay, s / x.s); x.s = s; sel.bb = selBox(sel.objs);
      sel.label = Math.round(s * 100) + '%';
    }
    redrawSelSoon(); return;
  }
  if (c.drag) {
    const p = toPage(e.clientX, e.clientY, c.r), dx = p[0] - c.p0[0], dy = p[1] - c.p0[1];
    for (const o of sel.objs) translateObj(o, dx - c.dx, dy - c.dy);
    sel.bb = [sel.bb[0] + dx - c.dx, sel.bb[1] + dy - c.dy, sel.bb[2] + dx - c.dx, sel.bb[3] + dy - c.dy];
    c.dx = dx; c.dy = dy; redrawSelSoon(); return;
  }
  if (c.tool === 'eraser') { for (const ev of evs) { const p = toPage(ev.clientX, ev.clientY, c.r); eraseAt(p[0], p[1]); } return; }
  if (!o) return;
  if (c.trk) {
    for (const ev of evs) inkInput(c, ev);
    c.pred = null;
    if (e.type === 'pointermove') predictInk(e); else renderLive(c);
  } else if (o.pts) {
    const min = 0.35 / state.scale;
    for (const ev of evs) {
      const p = toPage(ev.clientX, ev.clientY, c.r), last = o.pts[o.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) o.pts.push([p[0], p[1], 1]);
    }
    if (c.dirty) clearBB(ov.cx, c.dirty); strokePath(ov.cx, o.pts, o.w); c.dirty = bboxOf(o);
  } else {
    const p = toPage(e.clientX, e.clientY, c.r); o.b = constrain(o.a, p, o.t, e.shiftKey);
    if (c.dirty) clearBB(ov.cx, c.dirty); drawShape(ov.cx, o); c.dirty = bboxOf(o);
  }
}
// Kalem kalkınca bitmiş çizgi sayfaya basılır; canlı katman bir kare sonra temizlenir (titreme olmasın).
let ovClear = 0;
function clearOverlayNow() {
  cancelAnimationFrame(ovClear); ovClear = 0;
  for (const [cv, cx] of [[ov.cv, ov.cx], [ov.pr, ov.px]]) { cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); cx.restore(); }
}
function flushOvClear() { if (ovClear) clearOverlayNow(); }
function scheduleOvClear() { cancelAnimationFrame(ovClear); ovClear = requestAnimationFrame(() => { ovClear = requestAnimationFrame(clearOverlayNow); }); }
function constrain(a, p, t, shift) {
  if (!shift) return p;
  const dx = p[0] - a[0], dy = p[1] - a[1];
  if (t === 'rect' || t === 'ellipse') { const s = Math.max(Math.abs(dx), Math.abs(dy)); return [a[0] + Math.sign(dx || 1) * s, a[1] + Math.sign(dy || 1) * s]; }
  const len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)];
}
function eraseAt(x, y) {
  const c = cur, pv = c.pv, r = state.sizes.eraser / state.scale; let any = false;
  for (let i = pv.objs.length - 1; i >= 0; i--) {
    const o = pv.objs[i];
    if (hit(o, x, y, r)) { pv.objs.splice(i, 1); c.erased.push({ pv, o, idx: i }); any = true; }
  }
  if (any) pv.drawInk();
}
/* ---------- Seç ve taşı (kement) ----------
   Kalemin yan tuşuna basılı tutarak (ya da farenin sağ tuşuyla) bir alanın etrafını çiz: noktalarının en az
   yarısı içeride kalan yazı ve çizimler seçilir. Seçimin içinden tutup sürükle: taşınır (tek geri al adımı).
   Delete siler, Esc ya da seçimin dışına dokunmak bırakır. */
let sel = null, selRaf = 0;
function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}
function objIn(o, P) {
  const pts = o.pts || (o.t === 'rect' || o.t === 'ellipse' ? [o.a, o.b, [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2]] : [o.a, o.b, [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2]]);
  const step = Math.max(1, Math.floor(pts.length / 60)); let n = 0, t = 0;
  for (let i = 0; i < pts.length; i += step) { t++; if (inPoly(pts[i][0], pts[i][1], P)) n++; }
  return t > 0 && n / t >= 0.5;
}
function translateObj(o, dx, dy) {
  if (o.pts) for (const q of o.pts) { q[0] += dx; q[1] += dy; }
  else { o.a = [o.a[0] + dx, o.a[1] + dy]; o.b = [o.b[0] + dx, o.b[1] + dy]; }
  delete o._S; o.bb = bboxOf(o); // mürekkep örnekleri yeni yerinde yeniden hesaplanır
}
function selBox(objs) { let bb = null; for (const o of objs) bb = unionBB(bb, o.bb || bboxOf(o)); return bb; }
function scaleObj(o, ax, ay, s) {
  if (o.pts) for (const q of o.pts) { q[0] = ax + (q[0] - ax) * s; q[1] = ay + (q[1] - ay) * s; }
  else { o.a = [ax + (o.a[0] - ax) * s, ay + (o.a[1] - ay) * s]; o.b = [ax + (o.b[0] - ax) * s, ay + (o.b[1] - ay) * s]; }
  o.w *= s; delete o._S; o.bb = bboxOf(o); // kalem kalınlığı da orantılı değişir
}
function rotateObj(o, cx, cy, t) {
  if (o.pts) for (const q of o.pts) { const r = rotPt(q, cx, cy, t); q[0] = r[0]; q[1] = r[1]; }
  else if (o.t === 'rect' || o.t === 'ellipse') {
    const m = midOf(o), hx = (o.b[0] - o.a[0]) / 2, hy = (o.b[1] - o.a[1]) / 2, n = rotPt(m, cx, cy, t);
    o.a = [n[0] - hx, n[1] - hy]; o.b = [n[0] + hx, n[1] + hy]; o.rot = (o.rot || 0) + t;
  } else { o.a = rotPt(o.a, cx, cy, t); o.b = rotPt(o.b, cx, cy, t); }
  delete o._S; o.bb = bboxOf(o);
}
function applyXform(a, inverse) {
  for (const o of a.objs) {
    if (a.op === 'rotate') rotateObj(o, a.cx, a.cy, inverse ? -a.t : a.t);
    else scaleObj(o, a.ax, a.ay, inverse ? 1 / a.s : a.s);
  }
}
// Seçim çerçevesinin köşeleri (sırasıyla sol üst, sağ üst, sağ alt, sol alt); döndürülürken çerçeve de döner.
function selFrame() {
  const m = 5 / state.scale, v = sel.view, [x0, y0, x1, y1] = v ? v.bb : sel.bb;
  const P = [[x0 - m, y0 - m], [x1 + m, y0 - m], [x1 + m, y1 + m], [x0 - m, y1 + m]];
  return v ? P.map((q) => rotPt(q, v.cx, v.cy, v.t)) : P;
}
const HANDLES = ['tl', 'tr', 'br', 'bl'];
function handleAt(p) {
  const F = selFrame(), tol = 16 / state.scale; let best = null, bd = tol;
  F.forEach((q, i) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d <= bd) { bd = d; best = HANDLES[i]; } });
  return best;
}
const CURSORS = { tl: 'nwse-resize', br: 'nwse-resize', bl: 'nesw-resize', tr: 'grab', in: 'move' };
function hoverSel(e) {
  const pv = pageOf(e), p = pv === sel.pv ? toPage(e.clientX, e.clientY, pv.el.getBoundingClientRect()) : null;
  const h = p ? (handleAt(p) || (insideSel(p) ? 'in' : null)) : null;
  viewer.style.cursor = h ? CURSORS[h] : '';
  if (h !== sel.hover) { sel.hover = h; drawSel(); }
}
function insideSel(p) { const m = 6 / state.scale, b = sel.bb; return p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m; }
function onSelection(e) {
  if (!sel || toolFor(e) === 'lasso') return false;
  const pv = pageOf(e); if (!pv || pv !== sel.pv) return false; const p = toPage(e.clientX, e.clientY, pv.el.getBoundingClientRect()); return insideSel(p) || !!handleAt(p);
}
function drawLasso(P) {
  clearOverlayNow(); const c = ov.cx, s = state.scale;
  c.save(); c.strokeStyle = '#1f6feb'; c.fillStyle = 'rgba(31, 111, 235, .06)'; c.lineWidth = 1.6 / s; c.setLineDash([6 / s, 4 / s]); c.lineJoin = 'round';
  c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]); c.closePath(); c.fill(); c.stroke(); c.restore();
}
// Seçim çerçevesi: sağ üstte döndürme tutamağı (yuvarlak, oklu), diğer köşelerde boyut tutamakları (kare).
function drawSel() {
  clearOverlayNow(); if (!sel) return;
  attachOverlay(sel.pv); ov.cv.style.opacity = '1';
  const c = ov.cx, s = state.scale, F = selFrame(), blue = '#1f6feb';
  c.save(); c.fillStyle = 'rgba(31, 111, 235, .07)'; c.strokeStyle = blue; c.lineWidth = 1.6 / s; c.setLineDash([6 / s, 4 / s]);
  c.beginPath(); F.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.closePath(); c.fill(); c.stroke();
  c.setLineDash([]);
  F.forEach((q, i) => {
    const name = HANDLES[i], on = sel.hover === name; c.fillStyle = on ? blue : '#fff'; c.strokeStyle = blue; c.lineWidth = 1.6 / s;
    if (name === 'tr') {
      const R = 9 / s; c.beginPath(); c.arc(q[0], q[1], R, 0, Math.PI * 2); c.fill(); c.stroke();
      const r = R * 0.55, a1 = Math.PI * 1.25, ex = q[0] + r * Math.cos(a1), ey = q[1] + r * Math.sin(a1);
      c.strokeStyle = on ? '#fff' : blue; c.beginPath(); c.arc(q[0], q[1], r, -Math.PI * 0.25, a1); c.stroke();
      c.fillStyle = on ? '#fff' : blue; c.beginPath(); c.moveTo(ex + 3 / s, ey - 1 / s); c.lineTo(ex - 3.2 / s, ey - 1.5 / s); c.lineTo(ex - 0.5 / s, ey + 3.5 / s); c.closePath(); c.fill();
    } else { const h = 5.5 / s; c.fillRect(q[0] - h, q[1] - h, 2 * h, 2 * h); c.strokeRect(q[0] - h, q[1] - h, 2 * h, 2 * h); }
  });
  if (sel.label) { // açı ya da oran
    const q = F[1], fs = 12 / s; c.font = '600 ' + fs + 'px "Segoe UI", system-ui, sans-serif';
    const w = c.measureText(sel.label).width + 10 / s, x = q[0] + 14 / s, y = q[1] - 26 / s;
    c.fillStyle = blue; c.beginPath(); c.roundRect ? c.roundRect(x, y, w, 18 / s, 9 / s) : c.rect(x, y, w, 18 / s); c.fill();
    c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(sel.label, x + 5 / s, y + 9 / s);
  }
  c.restore();
}
function redrawSelSoon() { if (!selRaf) selRaf = requestAnimationFrame(() => { selRaf = 0; if (sel) { sel.pv.drawInk(); drawSel(); } }); }
function clearSel() { sel = null; cancelAnimationFrame(selRaf); selRaf = 0; viewer.style.cursor = ''; clearOverlayNow(); }
function finishLasso(c, cancel) {
  const P = c.lasso;
  if (cancel || P.length < 4 || c.moved < 8) { clearSel(); return; }
  const objs = c.pv.objs.filter((o) => objIn(o, P));
  if (!objs.length) { clearSel(); toast('Bu alanda yazı ya da çizim yok.'); return; }
  sel = { pv: c.pv, objs, bb: selBox(objs) }; drawSel();
  if (!state.selHinted) { state.selHinted = true; toast(objs.length + ' öğe seçildi: içinden sürükle taşı · sağ üst köşe döndür · diğer köşeler büyüt/küçült · Delete sil'); }
}
function deleteSel() {
  const pv = sel.pv, items = [];
  for (let i = pv.objs.length - 1; i >= 0; i--) if (sel.objs.includes(pv.objs[i])) { items.push({ pv, o: pv.objs[i], idx: i }); pv.objs.splice(i, 1); }
  clearSel(); pv.drawInk(); if (items.length) pushAction({ k: 'erase', items });
}
function endStroke(e, cancel) {
  const c = cur; cur = null;
  try { viewer.releasePointerCapture(c.id); } catch (err) {}
  if (c.laser) { laserEnd(c, e, cancel); return; }
  if (c.lasso) { finishLasso(c, cancel); return; }
  if (c.xf) {
    const x = c.xf, a = x.op === 'rotate' ? { k: 'xform', op: 'rotate', pv: c.pv, objs: sel.objs.slice(), cx: x.cx, cy: x.cy, t: x.t } : { k: 'xform', op: 'scale', pv: c.pv, objs: sel.objs.slice(), ax: x.ax, ay: x.ay, s: x.s };
    const changed = x.op === 'rotate' ? Math.abs(x.t) > 1e-4 : Math.abs(x.s - 1) > 1e-4;
    if (changed) { if (cancel) applyXform(a, true); else pushAction(a); }
    sel.view = null; sel.label = ''; sel.bb = selBox(sel.objs);
    cancelAnimationFrame(selRaf); selRaf = 0; c.pv.drawInk(); drawSel(); return;
  }
  if (c.drag) {
    if (c.dx || c.dy) {
      if (cancel) { for (const o of sel.objs) translateObj(o, -c.dx, -c.dy); sel.bb = selBox(sel.objs); c.pv.drawInk(); }
      else pushAction({ k: 'move', pv: c.pv, objs: sel.objs.slice(), dx: c.dx, dy: c.dy });
    }
    cancelAnimationFrame(selRaf); selRaf = 0; c.pv.drawInk(); drawSel(); return;
  }
  // Bağlantı üstünde kısa dokunuş çizim değil, tıklamadır: nokta silinir, bağlantıya gidilir.
  if (!cancel && c.link && c.moved < 6 && e.timeStamp - c.t0 < 450 && !c.erased.length) {
    clearOverlayNow(); showRing(e, false); followLink(c.link._link, c.link); return;
  }
  if (c.tool === 'eraser') { if (c.erased.length) pushAction({ k: 'erase', items: c.erased }); showRing(e, e.pointerType !== 'touch' && state.tool === 'eraser'); return; }
  const o = c.obj;
  if (c.trk) {
    if (cancel || !o.pts.length) { clearOverlayNow(); return; }
    const last = o.pts[o.pts.length - 1];
    if (c.rawPt && Math.hypot(c.rawPt[0] - last[0], c.rawPt[1] - last[1]) > 0.05) o.pts.push([c.rawPt[0], c.rawPt[1], last[2]]);
    o.bb = bboxOf(o); c.pv.objs.push(o);
    if (c.pv.ctx) drawObj(c.pv.ctx, o);
    scheduleOvClear();
    pushAction({ k: 'add', pv: c.pv, o });
    return;
  }
  if (!o || cancel) { if (c.dirty) clearBB(ov.cx, c.dirty); return; }
  if (!o.pts) { const dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1]; if (Math.hypot(dx, dy) < 2) { if (c.dirty) clearBB(ov.cx, c.dirty); return; } }
  o.bb = bboxOf(o);
  c.pv.objs.push(o);
  if (c.pv.ctx) drawObj(c.pv.ctx, o);
  if (c.dirty) clearBB(ov.cx, unionBB(c.dirty, o.bb));
  pushAction({ k: 'add', pv: c.pv, o });
}

/* ---------- Parmakla kaydırma ve yakınlaştırma ---------- */
let prevPinch = null;
function touchMove(e) {
  const t = touches.get(e.pointerId), px = t.x, py = t.y; t.x = e.clientX; t.y = e.clientY; e.preventDefault();
  if (touches.size === 1) { if (!(state.paged && state.opts.swipeNav)) viewer.scrollLeft -= e.clientX - px; viewer.scrollTop -= e.clientY - py; return; }
  if (touches.size === 2) {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (prevPinch && prevPinch.d > 0) {
      setScale(state.scale * d / prevPinch.d, m.x, m.y);
      viewer.scrollLeft -= m.x - prevPinch.x; viewer.scrollTop -= m.y - prevPinch.y;
    }
    prevPinch = { d, x: m.x, y: m.y };
  }
}
let wheelAcc = 0, wheelLock = 0, wheelIdle = 0;
viewer.addEventListener('wheel', (e) => {
  if (e.ctrlKey) { e.preventDefault(); setScale(state.scale * Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY); return; }
  if (!state.paged || !state.opts.wheelNav || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  const now = performance.now(); clearTimeout(wheelIdle); wheelIdle = setTimeout(() => { wheelAcc = 0; }, 180);
  if (now < wheelLock) return;
  wheelAcc += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
  if (Math.abs(wheelAcc) >= 40) { const i = currentIndex(); slideTo(i + (wheelAcc > 0 ? 1 : -1)); wheelAcc = 0; wheelLock = now + 320; }
}, { passive: false });

// Parmakla tek dokunuş ileri, çift dokunuş geri (tek dokunuş, çift olup olmadığı anlaşılana kadar kısa süre bekler).
let tapTimer = 0, lastTap = null;
function fingerTap(e) {
  if (anyDrawerOpen() || !state.opts.tapNav) return;
  if (tapTimer && lastTap && e.timeStamp - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 60) {
    clearTimeout(tapTimer); tapTimer = 0; lastTap = null; slideTo(currentIndex() - 1); return;
  }
  lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
  clearTimeout(tapTimer); tapTimer = setTimeout(() => { tapTimer = 0; lastTap = null; slideTo(currentIndex() + 1); }, 270);
}
// Slayta kısa, yumuşak bir kaydırmayla gider.
let slideRaf = 0;
function stopSlide() { if (slideRaf) { cancelAnimationFrame(slideRaf); slideRaf = 0; } }
function slideTo(i) {
  if (!state.pages.length) return;
  i = clamp(i, 0, state.pages.length - 1); stopSlide();
  const from = viewer.scrollTop, to = snapTop(i), t0 = performance.now(), D = 200;
  if (Math.abs(to - from) < 1) { updateStatus(); return; }
  const step = (now) => {
    const k = Math.min(1, (now - t0) / D), ease = 1 - Math.pow(1 - k, 3);
    viewer.scrollTop = from + (to - from) * ease;
    if (k < 1) slideRaf = requestAnimationFrame(step); else { slideRaf = 0; updateStatus(); }
  };
  slideRaf = requestAnimationFrame(step);
}

/* ---------- Yakınlaştırma ---------- */
let refreshTimer = 0;
function setScale(ns, ax, ay) {
  ns = clamp(ns, MIN_SCALE, MAX_SCALE); if (Math.abs(ns - state.scale) < 1e-4) return;
  const vr = viewer.getBoundingClientRect(), ox = ax - vr.left, oy = ay - vr.top;
  const fx = (viewer.scrollLeft + ox) / viewer.scrollWidth, fy = (viewer.scrollTop + oy) / viewer.scrollHeight;
  state.scale = ns; state.fit = false; state.pages.forEach((p) => p.layout()); computeTops(); laserClear(); if (sel) clearSel();
  viewer.scrollLeft = fx * viewer.scrollWidth - ox; viewer.scrollTop = fy * viewer.scrollHeight - oy;
  $('#zoomLbl').textContent = Math.round(ns * 100) + '%';
  clearTimeout(refreshTimer); refreshTimer = setTimeout(() => state.pages.forEach((p) => p.refresh()), 160);
  updateStatus(); persistView();
}
function zoomCenter(f) { const vr = viewer.getBoundingClientRect(); setScale(state.scale * f, vr.left + vr.width / 2, vr.top + vr.height / 2); }
function autoScale(pvs) {
  const w = Math.max(...pvs.map((p) => p.w)), h = Math.max(...pvs.map((p) => p.h)), aw = viewer.clientWidth, ah = viewer.clientHeight;
  const s = w > h ? Math.min((aw - PAD * 2) / w, (ah - 24) / h) : Math.min((aw - PAD * 2) / w, 3);
  return clamp(s, MIN_SCALE, MAX_SCALE);
}
function fitWidth() {
  if (!state.pages.length) return;
  const vr = viewer.getBoundingClientRect(); setScale(autoScale(state.pages), vr.left, vr.top); state.fit = true; goPage(currentIndex()); persistView();
}
function updateGap() {
  const vh = viewer.clientHeight, vw = viewer.clientWidth, s = state.scale, P = state.pages;
  const maxH = P.reduce((m, p) => Math.max(m, p.h), 0) * s, maxW = P.reduce((m, p) => Math.max(m, p.w), 0) * s;
  // Sunum modu: sayfa ekrana tam sığıyorsa sayfa sayfa gezilir. Aralık, ortalanmış slaytın
  // komşusunu ekran dışında tutacak en küçük değerdir (eskiden ekran boyu kadar siyah boşluk kalıyordu).
  state.paged = !!maxH && maxH + 24 <= vh + 1 && maxW <= vw + 1;
  state.gap = state.paged ? Math.max(GAP, Math.ceil((vh - maxH) / 2) + 4) : GAP;
  state.padTop = state.paged ? Math.max(PAD, Math.ceil((vh - P[0].h * s) / 2)) : PAD;
  const padBot = state.paged ? Math.max(PAD, Math.ceil((vh - P[P.length - 1].h * s) / 2)) : PAD;
  pagesEl.style.gap = state.gap + 'px'; pagesEl.style.paddingTop = state.padTop + 'px'; pagesEl.style.paddingBottom = padBot + 'px';
}
function computeTops() {
  updateGap();
  let y = state.padTop; state.tops = state.pages.map((p) => { const t = y; y += p.h * state.scale + state.gap; return t; });
}
window.addEventListener('resize', () => {
  updateBarH(); if (!state.pages.length) return;
  // Boyut değişince eski düzene göre hesap yanlış sayfa verir; ekranda en son gösterilen sayfa esas alınır.
  const i = shownPage >= 0 ? shownPage : currentIndex();
  if (state.fit) {
    const s = autoScale(state.pages);
    if (Math.abs(s - state.scale) > 1e-3) {
      state.scale = s; state.pages.forEach((p) => p.layout()); $('#zoomLbl').textContent = Math.round(s * 100) + '%'; laserClear();
      clearTimeout(refreshTimer); refreshTimer = setTimeout(() => state.pages.forEach((p) => p.refresh()), 160);
    }
  }
  computeTops(); goPage(i);
});
let scrollRaf = 0, shownPage = -1, statusTimer = 0;
function currentIndex() {
  const probe = viewer.scrollTop + viewer.clientHeight * 0.5; let lo = 0, hi = state.tops.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (state.tops[m] <= probe) lo = m; else hi = m - 1; }
  return lo;
}
function snapTop(i) { const pv = state.pages[i], extra = Math.max(0, (viewer.clientHeight - pv.h * state.scale) / 2); return Math.max(0, state.tops[i] - extra); }
function goPage(i) { if (!state.pages.length) return; i = clamp(i, 0, state.pages.length - 1); viewer.scrollTop = snapTop(i); updateStatus(); }
function nextPage() { goPage(currentIndex() + 1); }
function prevPage() { const i = currentIndex(); goPage(viewer.scrollTop - snapTop(i) > 30 ? i : i - 1); }
function flashStatus() { const s = $('#status'); s.classList.add('show'); clearTimeout(statusTimer); statusTimer = setTimeout(() => { if (!$('#curtain').classList.contains('open') || state.pinBar) s.classList.remove('show'); }, 2200); }
function updateStatus() {
  if (!state.pages.length) return;
  const i = currentIndex(); $('#stPage').textContent = String(i + 1); $('#stCount').textContent = String(state.pages.length);
  if (i !== shownPage) { shownPage = i; flashStatus(); markThumb(i); }
}
viewer.addEventListener('scroll', () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateStatus(); persistView(); }); }, { passive: true });

/* ---------- Bağlantılar, içindekiler ve geri dönüş ---------- */
const navBack = [], navFwd = [];
const linkAt = (e) => (state.opts.links && e.target && e.target.closest ? e.target.closest('.lnk') : null);
function remember() { navBack.push(currentIndex()); if (navBack.length > 50) navBack.shift(); navFwd.length = 0; }
function jumpTo(i) { if (!state.pages.length) return; remember(); goPage(i); }
function goBack() { if (!navBack.length) { toast('Geri dönülecek yer yok.'); return; } navFwd.push(currentIndex()); goPage(navBack.pop()); }
function goForward() { if (!navFwd.length) { toast('İleri gidilecek yer yok.'); return; } navBack.push(currentIndex()); goPage(navFwd.pop()); }
// Sayfa numarasına git (beamer gezinme çubuğundaki "sayfaya git" düğmesi ve G tuşu).
function askPage() {
  const box = $('#gotoBox'), inp = $('#gotoNum'); if (!state.pages.length) return;
  inp.max = String(state.pages.length); inp.value = String(currentIndex() + 1); $('#gotoMax').textContent = '/ ' + state.pages.length;
  box.hidden = false; inp.focus(); inp.select();
}
$('#gotoBox').addEventListener('submit', (e) => { e.preventDefault(); const n = parseInt($('#gotoNum').value, 10); $('#gotoBox').hidden = true; viewer.focus(); if (n >= 1) jumpTo(clamp(n, 1, state.pages.length) - 1); });
$('#gotoNum').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); $('#gotoBox').hidden = true; viewer.focus(); } });
$('#gotoNum').addEventListener('blur', () => { setTimeout(() => { $('#gotoBox').hidden = true; }, 150); });
async function followLink(L, el) {
  if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  if (L.url) { window.desktop.openExternal(L.url); toast('Tarayıcıda açılıyor…'); return; }
  if (L.action) {
    const i = currentIndex(), map = { NextPage: i + 1, PrevPage: i - 1, FirstPage: 0, LastPage: state.pages.length - 1 };
    if (L.action === 'GoBack') goBack(); else if (L.action === 'GoForward') goForward(); else if (L.action === 'GoToPage') askPage();
    else if (L.action === 'Find') toast('Metin içinde arama bu sürümde yok.');
    else if (L.action in map) jumpTo(clamp(map[L.action], 0, state.pages.length - 1));
    return;
  }
  if (L.dest) await goDest(L.dest);
}
async function goDest(dest) {
  const pdf = state.pdf;
  try {
    const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(d) || !d.length) return;
    const ref = d[0], i = ref && typeof ref === 'object' ? await pdf.getPageIndex(ref) : Number.isInteger(ref) ? ref : -1;
    if (pdf !== state.pdf || i < 0 || i >= state.pages.length) return;
    const pv = state.pages[i], kind = d[1] && d[1].name, top = kind === 'XYZ' ? d[3] : (kind === 'FitH' || kind === 'FitBH') ? d[2] : null;
    // Sayfa ekrana sığıyorsa (sunum) sayfanın tamamı gösterilir; uzun sayfalarda hedef satıra gidilir.
    if (top == null || pv.h * state.scale <= viewer.clientHeight + 1) { jumpTo(i); return; }
    remember();
    const y = pv.vp.convertToViewportPoint(0, top)[1];
    viewer.scrollTop = state.tops[i] + clamp(y, 0, pv.h) * state.scale - 12; updateStatus();
  } catch (err) { console.error('Bağlantı hedefi bulunamadı', err); toast('Bağlantının hedefi bulunamadı.'); }
}
let tocItems = null;
async function buildToc(doc) {
  const box = $('#toc'), btn = $('#btnToc'); box.textContent = ''; hideToc(); tocItems = null; btn.disabled = true;
  let outline = null; try { outline = await doc.getOutline(); } catch (e) {}
  if (doc !== state.pdf || !outline || !outline.length) return;
  const add = (items, depth) => {
    for (const it of items) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'd' + Math.min(depth, 3); b.textContent = it.title || '(başlıksız)';
      const L = it.url ? { url: it.url } : it.dest ? { dest: it.dest } : it.action ? { action: it.action } : null;
      if (L) b.addEventListener('click', () => { closeCurtain(); followLink(L); });
      box.appendChild(b);
      if (it.items && it.items.length) add(it.items, depth + 1);
    }
  };
  add(outline, 0); tocItems = outline; btn.disabled = false;
}
function showToc() { if (!tocItems) return; $('#toc').hidden = false; $('#btnToc').setAttribute('aria-expanded', 'true'); }
function hideToc() { $('#toc').hidden = true; $('#btnToc').setAttribute('aria-expanded', 'false'); }

/* ---------- Perde (araç çubuğu) ---------- */
const curtain = $('#curtain'), grip = $('#grip');
function curtainH() { return curtain.offsetHeight; }
function openCurtain() { closeSides(); curtain.classList.add('open'); $('#status').classList.add('show'); }
function closeCurtain() { hideToc(); if (state.pinBar) return; curtain.classList.remove('drag'); curtain.style.transform = ''; pull = null; if (!curtain.classList.contains('open')) return; curtain.classList.remove('open'); flashStatus(); }
function toggleCurtain() { curtain.classList.contains('open') ? closeCurtain() : openCurtain(); }
let pull = null;
grip.addEventListener('pointerdown', (e) => {
  e.preventDefault(); grip.setPointerCapture(e.pointerId);
  const H = curtainH(), open = curtain.classList.contains('open');
  pull = { id: e.pointerId, y0: e.clientY, base: open ? 0 : -H, H, moved: false, last: 0, y: open ? 0 : -H };
  curtain.classList.add('drag');
});
grip.addEventListener('pointermove', (e) => {
  if (!pull || e.pointerId !== pull.id) return;
  const dy = e.clientY - pull.y0; if (Math.abs(dy) > 4) pull.moved = true;
  const y = clamp(pull.base + dy, -pull.H, 0); pull.last = y - pull.y; pull.y = y; curtain.style.transform = 'translateY(' + y + 'px)';
});
function endPull(e) {
  if (!pull || e.pointerId !== pull.id) return; const p = pull; pull = null;
  curtain.classList.remove('drag'); curtain.style.transform = '';
  if (!p.moved) { toggleCurtain(); return; }
  const frac = (p.H + p.y) / p.H; // 0 kapalı, 1 açık
  (p.last > 1 ? frac > 0.2 : p.last < -1 ? frac > 0.85 : frac > 0.5) ? openCurtain() : closeCurtain();
}
grip.addEventListener('pointerup', endPull); grip.addEventListener('pointercancel', endPull); grip.addEventListener('lostpointercapture', endPull);

/* ---------- Yan çekmeceler: solda son açılanlar, sağda sayfa şeridi ---------- */
const sides = [];
function anyDrawerOpen() { return (curtain.classList.contains('open') && !state.pinBar) || sides.some((d) => d.isOpen()); }

// Menüyü sabitle: araç çubuğu hep açık kalır, sayfa alanı onun altından başlar.
function updateBarH() { if (state.pinBar) document.documentElement.style.setProperty('--barH', $('#bar').offsetHeight + 'px'); }
function setPin(on) {
  state.pinBar = !!on;
  document.body.classList.toggle('pinned', state.pinBar);
  $('#btnPin').setAttribute('aria-pressed', String(state.pinBar));
  $('#btnPin').title = state.pinBar ? 'Menü sabit. Tıklayınca normale döner' : 'Menüyü sabitle: hep açık kalsın';
  if (state.pinBar) { openCurtain(); flashStatus(); }
  updateBarH();
  if (state.pages.length) { const i = currentIndex(); computeTops(); goPage(i); }
  persistView();
}
$('#btnPin').addEventListener('click', () => setPin(!state.pinBar));
function closeSides() { sides.forEach((d) => d.close()); }
// dir: -1 soldan, +1 sağdan açılır. Tutamağa dokununca açılır/kapanır, sürüklenince parmağı izler.
function sideDrawer(panel, grip, dir, onOpen, axis) {
  const Y = axis === 'y', at = (e) => (Y ? e.clientY : e.clientX);
  const d = {
    isOpen: () => panel.classList.contains('open'),
    open() { if (d.isOpen()) return; closeCurtain(); sides.forEach((o) => o !== d && o.close()); panel.classList.add('open'); safeCall(onOpen); },
    close() { panel.classList.remove('open', 'drag'); panel.style.transform = ''; }
  };
  let pull = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { grip.setPointerCapture(e.pointerId); } catch (err) {}
    const W = (Y ? panel.offsetHeight : panel.offsetWidth) || 1, open = d.isOpen();
    pull = { id: e.pointerId, x0: at(e), W, p0: open ? 1 : 0, p: open ? 1 : 0, dp: 0, moved: false, wasOpen: open };
    panel.classList.add('drag');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!pull || e.pointerId !== pull.id) return;
    const dx = at(e) - pull.x0; if (Math.abs(dx) > 4 && !pull.moved) { pull.moved = true; if (!pull.wasOpen) { closeCurtain(); sides.forEach((o) => o !== d && o.close()); safeCall(onOpen); } }
    const p = clamp(pull.p0 - dir * dx / pull.W, 0, 1); pull.dp = p - pull.p; pull.p = p;
    panel.style.transform = (Y ? 'translateY(' : 'translateX(') + (dir * pull.W * (1 - p)) + 'px)';
  });
  const end = (e) => {
    if (!pull || e.pointerId !== pull.id) return; const p = pull; pull = null;
    panel.classList.remove('drag'); panel.style.transform = '';
    if (!p.moved) { p.wasOpen ? d.close() : d.open(); return; }
    (p.dp > 0.01 ? p.p > 0.2 : p.dp < -0.01 ? p.p > 0.85 : p.p > 0.5) ? (panel.classList.add('open'), sides.forEach((o) => o !== d && o.close())) : d.close();
  };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end); grip.addEventListener('lostpointercapture', end);
  sides.push(d); return d;
}
function safeCall(fn) { try { fn(); } catch (err) { console.error(err); } }

// Son açılanlar
const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
function ago(t) {
  if (!t) return '';
  const s = (t - Date.now()) / 1000, a = Math.abs(s);
  if (a < 60) return 'az önce';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(t).toLocaleDateString('tr');
}
// Sol menü: üstte son açılanlar, altta kullanıcının eklediği klasörler ve içlerindeki PDF'ler.
const folderCache = {};
// Dosyanın nerede olduğunu kısa ve okunur gösterir (web'deki iç yolları da).
function placeOf(p) {
  if (p.startsWith('cihaz/')) return 'Bu cihaz';
  if (p.startsWith('klasor/')) return p.split('/').slice(2, -1).join(' / ');
  const name = p.split(/[\\/]/).pop(); return p.slice(0, Math.max(0, p.length - name.length - 1));
}
function sideEmpty(text) { const e = document.createElement('div'); e.className = 'side-empty'; e.textContent = text; return e; }
function recItem(p, title, sub) {
  const pos = store.positions[p], open = p === state.path;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'rec' + (open ? ' cur' : ''); b.title = p;
  b.dataset.n = (title + ' ' + (sub || '')).toLocaleLowerCase('tr');
  const t = document.createElement('b'); t.textContent = title; b.appendChild(t);
  const meta = [open ? 'Açık' : '', pos ? 'Sayfa ' + ((pos.page || 0) + 1) : '', pos && pos.at ? ago(pos.at) : ''].filter(Boolean).join(' · ');
  if (meta) { const m = document.createElement('small'); m.textContent = meta; b.appendChild(m); }
  if (sub) { const f = document.createElement('small'); f.textContent = sub; b.appendChild(f); }
  b.addEventListener('click', () => openRecent(p));
  return b;
}
function buildRecent() {
  writeState();
  const list = $('#recentList'); list.textContent = '';
  const sec = (txt) => { const e = document.createElement('h4'); e.className = 'side-sec'; e.textContent = txt; return e; };
  list.appendChild(sec('Son açılanlar'));
  const items = Object.entries(store.positions).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 8);
  if (!items.length) list.appendChild(sideEmpty('Henüz açılmış PDF yok.'));
  for (const [p] of items) {
    const name = p.split(/[\\/]/).pop();
    list.appendChild(recItem(p, name.replace(/\.pdf$/i, ''), placeOf(p)));
  }
  const row = document.createElement('div'); row.className = 'side-sec-row';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'add'; add.textContent = '+ Klasör ekle'; add.addEventListener('click', addFolder);
  row.append(sec('Klasörlerim'), add); list.appendChild(row);
  if (!store.folders.length) list.appendChild(sideEmpty('Ders klasörlerini ekle; içlerindeki sunumlar burada listelenir.'));
  for (const dir of store.folders) list.appendChild(folderBlock(dir));
  applyFilter();
}
function folderBlock(dir) {
  const box = document.createElement('div'); box.className = 'fold' + (store.foldOpen[dir] === false ? ' shut' : ''); box.dataset.dir = dir;
  const head = document.createElement('div'); head.className = 'fold-h'; head.tabIndex = 0; head.setAttribute('role', 'button'); head.title = dir;
  const base = dir.split(/[\\/]/).filter(Boolean).pop() || dir, nm = document.createElement('b');
  nm.textContent = store.folderNames[dir] || base; box.dataset.name = nm.textContent.toLocaleLowerCase('tr');
  const cnt = document.createElement('small');
  const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'fold-x fold-e'; ed.title = 'Adını değiştir'; ed.setAttribute('aria-label', 'Klasörün adını değiştir');
  ed.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1z"/></svg>';
  ed.addEventListener('click', (e) => { e.stopPropagation(); renameFolder(box); });
  const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'fold-x'; rm.textContent = '×';
  rm.title = 'Listeden kaldır (dosyalar silinmez)'; rm.setAttribute('aria-label', 'Klasörü listeden kaldır');
  rm.addEventListener('click', (e) => { e.stopPropagation(); store.folders = store.folders.filter((f) => f !== dir); delete store.foldOpen[dir]; delete store.folderNames[dir]; delete folderCache[dir]; persistView(); buildRecent(); });
  const toggle = () => { box.classList.toggle('shut'); store.foldOpen[dir] = !box.classList.contains('shut'); persistView(); };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  head.append(nm, cnt, ed, rm);
  const body = document.createElement('div'); body.className = 'fold-b';
  box.append(head, body);
  const fill = (res) => {
    body.textContent = '';
    if (res.missing) { cnt.textContent = 'bulunamadı'; body.appendChild(sideEmpty('Klasör bulunamadı; taşınmış veya silinmiş olabilir.')); return; }
    if (res.needsPermission) {
      cnt.textContent = 'izin gerekli';
      const g = document.createElement('button'); g.type = 'button'; g.className = 'fold-perm'; g.textContent = 'Klasöre erişime izin ver';
      g.addEventListener('click', async () => { if (await window.desktop.grantFolder(dir)) { delete folderCache[dir]; buildRecent(); } });
      body.appendChild(g); return;
    }
    cnt.textContent = res.files.length + (res.truncated ? '+' : '') + ' PDF';
    if (!res.files.length) body.appendChild(sideEmpty('Bu klasörde PDF yok.'));
    for (const f of res.files) body.appendChild(recItem(f.path, f.name.replace(/\.pdf$/i, ''), f.rel));
    applyFilter();
  };
  if (folderCache[dir]) fill(folderCache[dir]); else cnt.textContent = 'taranıyor…';
  // Her açılışta yeniden taranır (yeni eklenen sunumlar görünsün); önceki sonuç beklerken gösterilir.
  window.desktop.listPdfs(dir).then((res) => { folderCache[dir] = res; if (box.isConnected) fill(res); }).catch((err) => { console.error(err); cnt.textContent = 'okunamadı'; });
  return box;
}
async function addFolder() {
  if (window.desktop.canPickFolder === false) { toast('Bu cihazda klasör eklenemiyor. OneDrive bağlantısı gelince klasörlerin burada da görünecek.'); return; }
  let dir = null; try { dir = await window.desktop.pickFolder(); } catch (e) { console.error(e); }
  if (!dir) return;
  const isNew = !store.folders.includes(dir);
  if (isNew) store.folders.push(dir);
  store.foldOpen[dir] = true; persistView(); buildRecent();
  const box = [...document.querySelectorAll('#recentList .fold')].find((b) => b.dataset.dir === dir);
  if (box) { box.scrollIntoView({ block: 'nearest' }); if (isNew) renameFolder(box); }
}
// Klasör adını yerinde düzenle: Enter kaydeder, Esc vazgeçer, boş bırakılırsa klasörün kendi adına döner.
function renameFolder(box) {
  const dir = box.dataset.dir, nm = box.querySelector('.fold-h b'); if (!nm) return;
  const base = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'fold-in'; inp.maxLength = 60;
  inp.value = nm.textContent; inp.placeholder = base; inp.setAttribute('aria-label', 'Klasör adı');
  nm.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    if (save) { const v = inp.value.trim(); if (v && v !== base) store.folderNames[dir] = v; else delete store.folderNames[dir]; persistView(); }
    buildRecent();
  };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
  for (const k of ['click', 'pointerdown']) inp.addEventListener(k, (e) => e.stopPropagation());
}
function applyFilter() {
  const q = ($('#fileFilter').value || '').trim().toLocaleLowerCase('tr'), list = $('#recentList');
  list.classList.toggle('filtering', !!q);
  list.querySelectorAll('.rec').forEach((b) => {
    const f = b.closest('.fold');
    b.hidden = !!q && !b.dataset.n.includes(q) && !(f && f.dataset.name.includes(q));
  });
}
$('#fileFilter').addEventListener('input', applyFilter);
async function openRecent(p) {
  recentDrawer.close();
  if (p === state.path || cur || loading) return;
  let f = null; try { f = await window.desktop.readPdf(p); } catch (e) { console.error(e); }
  if (!f) { toast('Dosya bulunamadı, listeden kaldırıldı.'); delete store.positions[p]; persistView(); return; }
  await loadPdf(f.bytes, f.name, false, f.path);
}

// Sayfa şeridi: küçük sayfalar yalnızca görünür olunca, sırayla çizilir; uzaklaşınca bellekten atılır.
const strip = { items: [], io: null, queue: [], busy: false, doc: null, started: false, cur: -1 };
function buildStrip() {
  const box = $('#thumbs'); if (strip.io) strip.io.disconnect();
  strip.items.forEach(dropThumb); box.textContent = ''; strip.items = []; strip.queue = []; strip.doc = state.pdf; strip.started = false; strip.cur = -1;
  $('#stripCount').textContent = state.pages.length ? String(state.pages.length) : '';
  strip.io = new IntersectionObserver((entries) => {
    for (const en of entries) { const it = strip.items[+en.target.dataset.i]; if (!it) continue; it.vis = en.isIntersecting; if (it.vis) queueThumb(it); else dropThumb(it); }
  }, { root: box, rootMargin: '800px 0px' });
  state.pages.forEach((pv, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'th'; b.dataset.i = String(i); b.title = 'Sayfa ' + (i + 1);
    const pg = document.createElement('div'); pg.className = 'pg'; pg.style.aspectRatio = pv.w + ' / ' + pv.h;
    const lab = document.createElement('span'); lab.textContent = String(i + 1);
    b.append(pg, lab); b.addEventListener('click', () => { if (i !== currentIndex()) jumpTo(i); });
    box.appendChild(b); strip.items.push({ i, pv, el: b, pg, cv: null, ink: null, vis: false, queued: false });
  });
  markThumb(currentIndex());
  if (stripDrawer.isOpen()) openStrip();
}
function openStrip() {
  if (!strip.started) { strip.started = true; strip.items.forEach((it) => strip.io.observe(it.el)); }
  strip.items.forEach((it) => { if (it.cv) thumbInk(it); });
  const it = strip.items[currentIndex()]; if (it) it.el.scrollIntoView({ block: 'center' });
}
function markThumb(i) {
  const old = strip.items[strip.cur]; if (old) old.el.classList.remove('cur');
  strip.cur = i; const it = strip.items[i]; if (!it) return; it.el.classList.add('cur');
  if (stripDrawer && stripDrawer.isOpen()) it.el.scrollIntoView({ block: 'nearest' });
}
function queueThumb(it) { if (it.cv || it.queued) return; it.queued = true; strip.queue.push(it); pumpThumbs(); }
function dropThumb(it) { for (const k of ['cv', 'ink']) if (it[k]) { it[k].remove(); it[k].width = 0; it[k] = null; } }
async function pumpThumbs() {
  if (strip.busy) return; strip.busy = true;
  try {
    while (strip.queue.length) {
      const it = strip.queue.shift(); it.queued = false;
      if (!it.vis || it.cv || strip.doc !== state.pdf) continue;
      const doc = strip.doc, dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.max(60, it.pg.clientWidth || 190), k = W * dpr / it.pv.w;
      const cv = document.createElement('canvas'); cv.width = Math.ceil(it.pv.w * k); cv.height = Math.ceil(it.pv.h * k);
      try { await it.pv.page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: it.pv.page.getViewport({ scale: k }), background: '#ffffff' }).promise; }
      catch (err) { cv.width = 0; if (!err || err.name !== 'RenderingCancelledException') console.error(err); continue; }
      if (doc !== state.pdf || !it.vis || strip.items[it.i] !== it) { cv.width = 0; continue; }
      it.cv = cv; it.k = k; it.pg.appendChild(cv); thumbInk(it);
    }
  } finally { strip.busy = false; }
}
function thumbInk(it) {
  if (!it.cv) return;
  if (!it.pv.objs.length) { if (it.ink) { it.ink.remove(); it.ink.width = 0; it.ink = null; } return; }
  if (!it.ink) { it.ink = document.createElement('canvas'); it.pg.appendChild(it.ink); }
  it.ink.width = it.cv.width; it.ink.height = it.cv.height;
  const c = it.ink.getContext('2d'); c.setTransform(it.k, 0, 0, it.k, 0, 0);
  for (const o of it.pv.objs) { try { drawObj(c, o); } catch (err) { console.error(err); } }
}
const recentDrawer = sideDrawer($('#recent'), $('#gripL'), -1, buildRecent);
const stripDrawer = sideDrawer($('#strip'), $('#gripR'), 1, openStrip);
const settingsDrawer = sideDrawer($('#settings'), $('#gripB'), 1, syncOpts, 'y');

// Ayarlar
function applyOpts() {
  const o = state.opts;
  document.body.classList.toggle('nolinks', !o.links);
  if (o.theme === 'light' || o.theme === 'dark') document.documentElement.dataset.theme = o.theme; else delete document.documentElement.dataset.theme;
}
function syncOpts() {
  const o = state.opts;
  $('#touchDraw').checked = state.touchDraw; $('#optTap').checked = o.tapNav; $('#optSwipe').checked = o.swipeNav;
  $('#optWheel').checked = o.wheelNav; $('#optLinks').checked = o.links;
  $('#press').value = state.press; $('#pressOut').textContent = String(state.press);
  document.querySelectorAll('#optLaser button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === o.laserHold)));
  document.querySelectorAll('#optTheme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === o.theme)));
  document.querySelectorAll('#optBarrel button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === o.barrel)));
}
function setOpt(k, v) { state.opts[k] = v; applyOpts(); syncOpts(); persistView(); }
$('#touchDraw').addEventListener('change', (e) => { state.touchDraw = e.target.checked; persistView(); });
$('#optTap').addEventListener('change', (e) => setOpt('tapNav', e.target.checked));
$('#optSwipe').addEventListener('change', (e) => setOpt('swipeNav', e.target.checked));
$('#optWheel').addEventListener('change', (e) => setOpt('wheelNav', e.target.checked));
$('#optLinks').addEventListener('change', (e) => setOpt('links', e.target.checked));
document.querySelectorAll('#optLaser button').forEach((b) => b.addEventListener('click', () => setOpt('laserHold', +b.dataset.v)));
document.querySelectorAll('#optTheme button').forEach((b) => b.addEventListener('click', () => setOpt('theme', b.dataset.v)));
document.querySelectorAll('#optBarrel button').forEach((b) => b.addEventListener('click', () => setOpt('barrel', b.dataset.v)));
$('#btnDefApp').addEventListener('click', async () => {
  let r = null; try { r = await window.desktop.openDefaultApps(); } catch (e) { console.error(e); }
  if (r && r.portable) toast('Bunun için kurulum sürümünü kullan (PDF-Kalemi-Kurulum).');
  else toast('Windows ayarlarında ".pdf" satırında PDF Kalemi\'yi seç.');
});
$('#btnOpen2').addEventListener('click', () => { recentDrawer.close(); openDialog(); });

/* ---------- Kalıcılık: kaldığı yerden devam ---------- */
let ready = false, persistTimer = 0, inkTimer = 0;
const store = { last: '', positions: {}, prefs: {}, folders: [], foldOpen: {}, folderNames: {} };
function inkKey() { return (state.path || '__ornek__') + '|' + (state.bytes ? state.bytes.length : 0); }
function persistView() {
  if (!ready) return; clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { const s = writeState(); if (s) window.desktop.saveState(s); }, 500);
}
function writeState() {
  if (!ready) return;
  if (state.path && state.pages.length) {
    const i = currentIndex(), pv = state.pages[i], off = (viewer.scrollTop - state.tops[i]) / (pv.h * state.scale);
    store.positions[state.path] = { page: i, off: +off.toFixed(4), scale: +state.scale.toFixed(4), fit: !!state.fit, at: Date.now() }; store.last = state.path;
    const keys = Object.keys(store.positions); if (keys.length > 60) { keys.sort((a, b) => store.positions[a].at - store.positions[b].at); delete store.positions[keys[0]]; }
  }
  store.prefs = { tool: state.tool, colors: state.colors, sizes: state.sizes, touchDraw: state.touchDraw, nib: state.nib, press: state.press, hasPressure: state.hasPressure, opts: state.opts, pinBar: !!state.pinBar };
  return store;
}
function inkJson() {
  const r = (v) => Math.round(v * 100) / 100;
  return JSON.stringify(state.pages.map((p) => p.objs.map((o) => o.pts ? { t: o.t, k: o.k, c: o.c, w: o.w, pts: o.pts.map((q) => [r(q[0]), r(q[1]), r(q[2])]) } : { t: o.t, c: o.c, w: o.w, a: o.a.map(r), b: o.b.map(r), rot: o.rot ? +o.rot.toFixed(4) : undefined })));
}
function scheduleInkSave() { if (!ready) return; clearTimeout(inkTimer); inkTimer = setTimeout(() => window.desktop.saveInk(inkKey(), inkJson()), 700); }
function restoreInk(json) {
  try {
    const data = JSON.parse(json);
    data.forEach((objs, i) => { const pv = state.pages[i]; if (!pv) return; pv.objs = objs.map((o) => { o.bb = bboxOf(o); return o; }); });
  } catch (e) { console.error('Çizimler okunamadı', e); }
  state.pages.forEach((p) => p.drawInk());
}
function flushNow() {
  if (!ready) return; clearTimeout(persistTimer); clearTimeout(inkTimer);
  const s = writeState(); if (s) window.desktop.saveStateSync(s);
  if (state.bytes) window.desktop.saveInkSync(inkKey(), inkJson());
}
window.addEventListener('beforeunload', flushNow);
window.addEventListener('pagehide', flushNow);

/* ---------- PDF yükleme ---------- */
let io = null;
let loading = false;
async function loadPdf(bytes, name, isSample, fullPath) {
  if (cur || loading) return;
  loading = true;
  try { await loadPdfNow(bytes, name, isSample, fullPath); }
  catch (err) { console.error(err); toast('PDF açılırken bir sorun oldu.'); }
  finally { loading = false; }
}
async function loadPdfNow(bytes, name, isSample, fullPath) {
  let doc;
  try {
    const task = pdfjsLib.getDocument({ data: bytes.slice(0) });
    doc = await task.promise;
  } catch (err) {
    toast(err && err.name === 'PasswordException' ? 'Şifreli PDF dosyaları desteklenmiyor.' : 'Bu dosya PDF olarak açılamadı.'); console.error(err); return;
  }
  // Önceki belgenin çizimleri ve konumu hemen yazılır (gecikmeli kayıt yeni belgeye karışmasın).
  if (ready && state.bytes && state.pages.length) { clearTimeout(inkTimer); clearTimeout(persistTimer); try { window.desktop.saveInk(inkKey(), inkJson()); const s = writeState(); if (s) window.desktop.saveState(s); } catch (e) { console.error(e); } }
  if (io) io.disconnect(); detachOverlay();
  state.pages.forEach((p) => p.deactivate()); pagesEl.textContent = '';
  if (state.pdf) { try { state.pdf.destroy(); } catch (e) {} }
  if (fullPath && window.desktop.rememberFile) window.desktop.rememberFile(fullPath, name, bytes);
  state.pdf = doc; state.bytes = bytes; state.name = name; state.path = fullPath || ''; state.dirty = false; document.title = isSample ? 'PDF Kalemi' : name + ' - PDF Kalemi'; state.sample = !!isSample; state.pages = []; state.undo = []; state.redo = []; updateHist();
  const first = await doc.getPage(1); const pvs = [new PageView(0, first)];
  for (let i = 2; i <= doc.numPages; i++) pvs.push(new PageView(i - 1, await doc.getPage(i)));
  state.pages = pvs;
  io = new IntersectionObserver((entries) => { for (const en of entries) { const pv = state.pages[+en.target.dataset.i]; if (!pv) continue; if (en.isIntersecting) pv.activate(); else pv.deactivate(); } }, { root: viewer, rootMargin: '120% 0px' });
  state.scale = autoScale(pvs); state.fit = true;
  pvs.forEach((p) => { p.layout(); pagesEl.appendChild(p.el); io.observe(p.el); });
  computeTops(); viewer.scrollTop = 0; viewer.scrollLeft = 0; if (isSample) { const s = state.scale; state.scale = Math.min(s, 1.6); pvs.forEach((p) => p.layout()); computeTops(); }
  $('#zoomLbl').textContent = Math.round(state.scale * 100) + '%';
  $('#stCount').textContent = String(pvs.length); shownPage = -1;
  const pos = fullPath ? store.positions[fullPath] : null;
  try { const ink = await window.desktop.loadInk(inkKey()); if (ink) restoreInk(ink); } catch (e) {}
  if (pos) {
    if (pos.scale && pos.fit === false) {
      state.scale = clamp(pos.scale, MIN_SCALE, MAX_SCALE); state.fit = false; pvs.forEach((p) => p.layout()); computeTops();
      $('#zoomLbl').textContent = Math.round(state.scale * 100) + '%';
    }
    const i = clamp(pos.page || 0, 0, pvs.length - 1);
    if (state.paged) goPage(i); else viewer.scrollTop = state.tops[i] + (pos.off || 0) * pvs[i].h * state.scale;
  }
  updateStatus(); persistView();
  navBack.length = 0; navFwd.length = 0; buildToc(doc); buildStrip();
}
async function makeSample() {
  const { PDFDocument, rgb } = PDFLib, d = await PDFDocument.create(), pg = d.addPage([595, 842]), g = rgb(0.86, 0.88, 0.92);
  for (let x = 28; x < 595; x += 28) pg.drawLine({ start: { x, y: 0 }, end: { x, y: 842 }, thickness: 0.5, color: g });
  for (let y = 28; y < 842; y += 28) pg.drawLine({ start: { x: 0, y }, end: { x: 595, y }, thickness: 0.5, color: g });
  return new Uint8Array(await d.save());
}
async function openFile(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Lütfen bir PDF dosyası seçin.'); return; }
  if (!(await confirmDiscard())) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let p = ''; try { p = window.desktop.pathOf(file) || ''; } catch (e) {}
  await loadPdf(bytes, file.name, false, p);
}
async function openDialog() {
  if (cur) return;
  const f = await window.desktop.openPdf(); if (!f) return;
  if (!(await confirmDiscard())) return;
  await loadPdf(f.bytes, f.name, false, f.path);
}
function confirmDiscard() { return Promise.resolve(true); }

/* ---------- PDF'e kaydet ---------- */
function toPdfPts(pv, pts) { return pts.map((p) => { const q = pv.vp.convertToPdfPoint(p[0], p[1]); return [q[0], q[1]]; }); }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
function svgOf(P, closed) { return 'M ' + P.map((p) => p[0].toFixed(2) + ' ' + (-p[1]).toFixed(2)).join(' L ') + (closed ? ' Z' : ''); }
function quadSamples(pts, i) {
  const [s, c, e] = pieceEnds(pts, i), len = Math.hypot(c[0] - s[0], c[1] - s[1]) + Math.hypot(e[0] - c[0], e[1] - c[1]), n = len > 8 ? 4 : len > 3 ? 2 : 1, out = [s];
  for (let j = 1; j <= n; j++) { const t = j / n, u = 1 - t; out.push([u * u * s[0] + 2 * u * t * c[0] + t * t * e[0], u * u * s[1] + 2 * u * t * c[1] + t * t * e[1]]); }
  return { out, f: c[2] };
}
function smoothPoly(pts) {
  const out = [pts[0]];
  for (let i = 1; i <= pts.length; i++) out.push(...quadSamples(pts, i).out.slice(1));
  return out;
}
async function buildPdf() {
  const { PDFDocument, LineCapStyle } = PDFLib, doc = await PDFDocument.load(state.bytes, { ignoreEncryption: true }), list = doc.getPages();
  for (const pv of state.pages) {
    if (!pv.objs.length) continue; const page = list[pv.i];
    for (const o of pv.objs) {
      const color = hexRgb(o.c);
      if (o.t === 'pen' && o.k) {
        const S = samplesOf(o, clamp(o.w * 0.5, 0.5, 1.6)), parts = [];
        const T = (x, y) => { const q = pv.vp.convertToPdfPoint(x, y); return q[0].toFixed(1) + ' ' + (-q[1]).toFixed(1); };
        nibGeom(o, S, 0, S.length - 1, S[S.length - 1][3], true, {
          eps: 0.04,
          poly(P) { parts.push('M ' + P.map((p) => T(p[0], p[1])).join(' L ') + ' Z'); },
          circle(x, y, r) { const k = 0.5523 * r; parts.push(`M ${T(x + r, y)} C ${T(x + r, y + k)} ${T(x + k, y + r)} ${T(x, y + r)} C ${T(x - k, y + r)} ${T(x - r, y + k)} ${T(x - r, y)} C ${T(x - r, y - k)} ${T(x - k, y - r)} ${T(x, y - r)} C ${T(x + k, y - r)} ${T(x + r, y - k)} ${T(x + r, y)} Z`); }
        });
        page.drawSvgPath(parts.join(' '), { x: 0, y: 0, color });
      } else if (o.t === 'pen') {
        if (o.pts.length === 1) { const q = pv.vp.convertToPdfPoint(o.pts[0][0], o.pts[0][1]); page.drawCircle({ x: q[0], y: q[1], size: Math.max(0.1, o.w * o.pts[0][2] / 2), color, borderWidth: 0 }); continue; }
        for (let i = 1; i <= o.pts.length; i++) {
          const { out, f } = quadSamples(o.pts, i), P = toPdfPts(pv, out);
          for (let j = 1; j < P.length; j++) page.drawLine({ start: { x: P[j - 1][0], y: P[j - 1][1] }, end: { x: P[j][0], y: P[j][1] }, thickness: Math.max(0.2, o.w * f), color, lineCap: LineCapStyle.Round });
        }
      } else if (o.t === 'hl') {
        const P = toPdfPts(pv, o.pts.length === 1 ? [o.pts[0], [o.pts[0][0] + 0.01, o.pts[0][1]]] : smoothPoly(o.pts));
        page.drawSvgPath(svgOf(P, false), { x: 0, y: 0, borderColor: color, borderWidth: o.w, borderOpacity: HL_ALPHA, borderLineCap: LineCapStyle.Round });
      } else {
        let polys;
        if (o.t === 'line') polys = [[o.a, o.b]];
        else if (o.t === 'arrow') polys = [[o.a, o.b], arrowHead(o)];
        else if (o.t === 'rect') polys = [[o.a, [o.b[0], o.a[1]], o.b, [o.a[0], o.b[1]], o.a]];
        else polys = [ellipsePoly(o, 64)];
        if (o.rot) { const [cx, cy] = midOf(o); polys = polys.map((P) => P.map((q) => rotPt(q, cx, cy, o.rot))); }
        for (const poly of polys) page.drawSvgPath(svgOf(toPdfPts(pv, poly), false), { x: 0, y: 0, borderColor: color, borderWidth: o.w, borderLineCap: LineCapStyle.Round });
      }
    }
  }
  return doc.save();
}
async function savePdf() {
  const btn = $('#btnSave'); if (btn.disabled || !state.bytes) return;
  btn.disabled = true;
  try {
    const out = await buildPdf(), base = state.name.replace(/\.pdf$/i, '') + '-cizili.pdf';
    const dest = state.path ? state.path.replace(/\.pdf$/i, '') + '-cizili.pdf' : base;
    const res = await window.desktop.savePdf(out, dest);
    if (res && res.path) { state.dirty = false; toast('Kaydedildi: ' + res.path.split(/[\\/]/).pop()); }
  } catch (err) { console.error(err); toast('PDF oluşturulamadı.'); }
  btn.disabled = false;
}

/* ---------- Araç çubuğu ---------- */
let shownPal = null;
function buildColors(pal) {
  const box = $('#colors'); box.textContent = ''; shownPal = pal;
  pal.forEach(([hex, name]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sw'; b.dataset.c = hex; b.title = name; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', name);
    b.innerHTML = '<span style="background:' + hex + (pal === NEON ? ';box-shadow:0 0 7px 1px ' + hex : '') + '"></span>';
    b.addEventListener('click', () => { const ck = TOOLS[state.tool].ck; if (!ck) return; state.colors[ck] = hex; syncUi(); });
    box.appendChild(b);
  });
}
function syncUi() {
  persistView();
  const meta = TOOLS[state.tool], pal = state.tool === 'laser' ? NEON : SWATCHES;
  if (pal !== shownPal) buildColors(pal);
  document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool)));
  viewer.className = 'tool-' + state.tool;
  $('#colors').classList.toggle('off', !meta.ck);
  const col = meta.ck ? state.colors[meta.ck] : null;
  document.querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.c === col)));
  const s = $('#size'), sk = sizeKey(state.tool); s.min = meta.min; s.max = meta.max; s.step = meta.step; s.value = state.sizes[sk];
  $('#sizeOut').textContent = String(state.sizes[sk]); $('#sizeLbl').textContent = meta.label; s.title = meta.label;
  $('#nibs').hidden = state.tool !== 'pen';
  document.querySelectorAll('.nib').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.nib === state.nib)));
  $('#press').value = state.press; $('#pressOut').textContent = String(state.press);
}
function sizeKey(t) { return t === 'pen' ? 'pen:' + state.nib : TOOLS[t].sk; }
function setTool(t) { state.tool = t; if (t !== 'eraser') showRing(null, false); if (t !== 'laser') showDot(null, false); syncUi(); }
function setNib(n) { state.nib = n; state.tool = 'pen'; showRing(null, false); syncUi(); }

document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('.nib').forEach((b) => b.addEventListener('click', () => setNib(b.dataset.nib)));
$('#size').addEventListener('input', (e) => { state.sizes[sizeKey(state.tool)] = parseFloat(e.target.value); $('#sizeOut').textContent = e.target.value; persistView(); });
$('#press').addEventListener('input', (e) => { state.press = +e.target.value; $('#pressOut').textContent = e.target.value; persistView(); });
$('#btnUndo').addEventListener('click', undo); $('#btnRedo').addEventListener('click', redo);
$('#btnZoomIn').addEventListener('click', () => zoomCenter(1.2)); $('#btnZoomOut').addEventListener('click', () => zoomCenter(1 / 1.2)); $('#btnFit').addEventListener('click', fitWidth);
$('#btnToc').addEventListener('click', () => { $('#toc').hidden ? showToc() : hideToc(); });
$('#btnOpen').addEventListener('click', openDialog);
$('#file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
$('#btnSave').addEventListener('click', savePdf);

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || ''; if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (!mod && !e.altKey) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && state.paged)) { e.preventDefault(); state.paged ? slideTo(currentIndex() + 1) : nextPage(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); state.paged ? slideTo(currentIndex() - 1) : prevPage(); return; }
    if (e.key === 'Home') { e.preventDefault(); goPage(0); return; }
    if (e.key === 'End') { e.preventDefault(); goPage(state.pages.length - 1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); viewer.scrollTop += 90; return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); viewer.scrollTop -= 90; return; }
    if (sel && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteSel(); return; }
    if (sel && e.key === 'Escape') { clearSel(); return; }
    if (e.key === 'Escape') { closeCurtain(); closeSides(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); goBack(); return; }
    if (k === 't') { e.preventDefault(); toggleCurtain(); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(1.15); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCenter(1 / 1.15); return; }
    if (e.key === '0') { e.preventDefault(); fitWidth(); return; }
  }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); return; }
  if (!mod && !e.altKey && k === 'g') { e.preventDefault(); askPage(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod && k === 's') { e.preventDefault(); savePdf(); }
  else if (mod && k === 'o') { e.preventDefault(); openDialog(); }
  else if (!mod && !e.altKey && KEYS[k]) setTool(KEYS[k]);
  else if (!mod && !e.altKey && NIB_KEYS[e.key]) setNib(NIB_KEYS[e.key]);
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop').classList.add('on'); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').classList.remove('on'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').classList.remove('on'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) openFile(f); });

/* ---------- Başlangıç ---------- */
window.addEventListener('error', (e) => console.error('Beklenmeyen hata:', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('Beklenmeyen hata:', e.reason));
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
syncUi();
window.desktop.onOpenFile((f) => { if (f) loadPdf(f.bytes, f.name, false, f.path); });
(async () => {
  try {
    const st = await window.desktop.loadState();
    if (st) {
      store.last = st.last || ''; store.positions = st.positions || {}; store.prefs = st.prefs || {};
      store.folders = Array.isArray(st.folders) ? st.folders.filter((f) => typeof f === 'string' && f) : [];
      store.foldOpen = st.foldOpen && typeof st.foldOpen === 'object' ? st.foldOpen : {};
      store.folderNames = st.folderNames && typeof st.folderNames === 'object' ? st.folderNames : {};
    }
    const p = store.prefs;
    if (p.colors) Object.assign(state.colors, p.colors); if (p.sizes) Object.assign(state.sizes, p.sizes);
    if (p.tool && TOOLS[p.tool]) state.tool = p.tool; if (p.touchDraw) state.touchDraw = true;
    if (p.pinBar) setPin(true);
    if (p.opts && typeof p.opts === 'object') for (const k of Object.keys(state.opts)) if (typeof p.opts[k] === typeof state.opts[k]) state.opts[k] = p.opts[k];
    applyOpts(); syncOpts();
    if (p.nib && NIBS[p.nib]) state.nib = p.nib; if (typeof p.press === 'number') state.press = clamp(p.press, 0, 100); if (p.hasPressure) state.hasPressure = true;
    syncUi();
  } catch (e) { console.error(e); }
  let f = await window.desktop.getInitialFile();
  if (!f && store.last) f = await window.desktop.readPdf(store.last);
  ready = true;
  if (f) await loadPdf(f.bytes, f.name, false, f.path);
  else await loadPdf(await makeSample(), 'kareli-sayfa.pdf', true);
  viewer.focus();
})();
window.__app = { state, toast, getSel: () => sel, loadPdf, buildPdf, undo, redo, setTool, setNib, fitWidth, currentIndex, goBack, goPage, snapTop };
})();
