/*
 * sw.js ― オフラインでも開けるようにする仕組み（サービスワーカー）
 * 基づく仕様書：GroupSplitter 仕様書 v0.5
 * 自分のサイトのファイルだけを覚える。GASへの通信には触らない。
 * 新しい版は、更新ボタンが押されたときだけ切り替える（install で skipWaiting を呼ばない）。
 */
const CACHE_VERSION = 'groupsplitter-cache-v0.5';
const ASSETS = [
  './', 'index.html', 'manifest.json', 'favicon.ico', 'css/style.css',
  'js/store.js', 'js/assign.js', 'js/roster.js', 'js/ui-roster.js', 'js/ui-result.js', 'js/ui-settings.js', 'js/app.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/favicon-48.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.indexOf('groupsplitter-cache-') === 0 && k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(req, copy)); }
      return res;
    })).catch(() => caches.match('index.html'))
  );
});
