// PDF Kalemi servis çalışanı: uygulama dosyalarını önbelleğe alır, internet yokken de açılır.
// Önbellekteki sürüm hemen gösterilir, arkada yenisi indirilir (bir sonraki açılışta güncel olur).
const CACHE = 'pdfkalemi-v8';
const SHELL = ['./', 'index.html', 'app.js', 'web.js', 'speech.js', 'ai.js', 'claude.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'ai-logo.png',
  'lib/pdf.min.js', 'lib/pdf-lib.min.js', 'lib/pdf.worker.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(r, { ignoreSearch: true });
    const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
