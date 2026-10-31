declare const sw: ServiceWorkerGlobalScope;

const CACHE = 'daily-fresh-v97';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './styles-v2.css',
  './dist/app.js',
  './dist/update.js',
  './dist/sync.js',
  './dist/logic.js',
  './dist/firebase-config.js',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js',
  './vendor/qrcode.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png',
  './install/install.css',
  './install/leaf.html',
  './icons/home/leaf-180.png',
  './icons/home/leaf-512.png',
  './install/check.html',
  './icons/home/check-180.png',
  './icons/home/check-512.png',
  './install/sunrise.html',
  './icons/home/sunrise-180.png',
  './icons/home/sunrise-512.png',
  './install/orbit.html',
  './icons/home/orbit-180.png',
  './icons/home/orbit-512.png',
  './install/bloom.html',
  './icons/home/bloom-180.png',
  './icons/home/bloom-512.png',
  './install/spark.html',
  './icons/home/spark-180.png',
  './icons/home/spark-512.png',
  './install/pages.html',
  './icons/home/pages-180.png',
  './icons/home/pages-512.png',
  './install/focus.html',
  './icons/home/focus-180.png',
  './icons/home/focus-512.png'
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

sw.addEventListener('message', (e: any) => {
  if (e.data && e.data.type === 'SKIP_WAITING') sw.skipWaiting();
});

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url: URL;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(req, { cache: 'no-cache' })
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
