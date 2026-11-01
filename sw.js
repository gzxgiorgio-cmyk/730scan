/* Service worker: l'app funziona offline dopo la prima apertura. Aumenta VERSION a ogni aggiornamento. */
const VERSION = '730scan-2026-10-31-3';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'paddle.js', 'lib/jspdf.umd.min.js', 'ort/ort.wasm.min.js', 'ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm', 'models/det.onnx', 'models/rec.onnx', 'models/chars.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u => c.add(u).catch(err => { if (u !== './') throw err; })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) { e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request))); return; }
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)).catch(() => {}); return r; }).catch(() => caches.match(e.request)));
});
