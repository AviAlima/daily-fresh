declare const sw: ServiceWorkerGlobalScope;

const CACHE = 'daily-fresh-v35';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './dist/app.js',
  './dist/sync.js',
  './dist/firebase-config.js',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js',
  './vendor/qrcode.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png'
];

sw.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url: URL;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => { c.put(req, copy); });
        }
        return res;
      })
      .catch(() => {
        return caches.match(req).then((m) => {
          if (m) return m;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return undefined;
        }) as Promise<Response>;
      })
  );
});
