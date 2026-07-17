// Service Worker של "מתחזה".
// אסטרטגיה: רשת-קודם תמיד (כדי שלעולם לא נגיש גרסה ישנה), עם נפילה
// לקאש רק כשאין רשת. סוקטים ו-API בזמן אמת לא נוגעים בקאש בכלל.
const CACHE = 'mithaze-v1';
const PRECACHE = [
  '/',
  '/css/styles.css',
  '/js/app.js',
  '/js/sfx.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // רק GET מאותו origin; לא נוגעים ב-socket.io וב-API
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // עדכון הקאש ברקע כדי שמצב לא-מקוון יגיש את הגרסה האחרונה שנראתה
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: url.pathname === '/' }))
  );
});
