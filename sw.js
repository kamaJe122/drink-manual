/* ============================================================
   金茂宜咖啡 · 小金人學習手冊 — Service Worker
   功能：離線快取 + 自動更新最新版
   ------------------------------------------------------------
   更新規則：
   - 改版時把下面的 CACHE_VERSION 數字 +1（例如 v1 → v2），
     舊快取會在新版啟用時自動清除，員工就會拿到最新內容。
   ============================================================ */

const CACHE_VERSION = 'v1';
const APP_CACHE  = `kingmauii-manual-${CACHE_VERSION}`;
const FONT_CACHE = `kingmauii-fonts-${CACHE_VERSION}`;

// App 外殼：第一次安裝就快取，離線也打得開
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/maskable.svg'
];

// 這些網域是「動態資料」，永遠走網路、不快取（雲端同步用）
const NETWORK_ONLY_HOSTS = ['script.google.com', 'script.googleusercontent.com'];

// 字型：快取起來，離線也有字
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ---------- 安裝：快取 App 外殼 ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] precache 失敗', err))
  );
});

// ---------- 啟用：清掉舊版快取 ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== FONT_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- 收到「立即更新」指令 ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ---------- 攔截請求 ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只處理 GET
  if (req.method !== 'GET') return;

  // 1) 雲端同步 API → 一律走網路，不碰快取
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) {
    return; // 交給瀏覽器預設行為
  }

  // 2) Google 字型 → cache-first（有就用快取，沒有才下載並存起來）
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 3) 頁面導覽（開 App / 重新整理）→ network-first
  //    有網路就拿最新版手冊，沒網路就用快取（離線可用）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 4) 其他同源資源（圖示等）→ stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(APP_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
