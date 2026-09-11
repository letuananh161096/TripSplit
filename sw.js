const CACHE_NAME = 'tripsplit-v2.0.0-tropical';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
  './js/banks.js',
  './js/vietqr.js',
  './js/debt.js',
  './js/export.js',
  './js/realtime.js',
  './js/auth.js',
  './js/jsqr.min.js',
  './js/html5-qrcode.min.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  // Bỏ qua thời gian chờ để kích hoạt ngay service worker mới
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  // Xóa toàn bộ cache cũ để lấy phiên bản code mới nhất
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Xóa cache cũ:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Bỏ qua các request tới API bên ngoài như vietqr.io hoặc API /api/ đồng bộ dữ liệu
  if (!event.request.url.startsWith(self.location.origin) || event.request.url.includes('/api/')) {
    return;
  }

  // Chiến lược: NETWORK FIRST (ưu tiên tải code mới từ server khi có mạng)
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Khi mất mạng hoàn toàn (offline) mới dùng tài nguyên trong cache
        return caches.match(event.request).then((cachedResponse) => {
          return cachedResponse || caches.match('./index.html');
        });
      })
  );
});
