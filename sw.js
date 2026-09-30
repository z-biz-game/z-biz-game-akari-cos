'use strict';
// 离线可用 + 永不被旧缓存钉住。
//
// 两条实测换来的口径：
//   1) 一律 **网络优先**，命中网络才回填缓存。手工 VERSION + cache-first 的组合，
//      发出去的 HTML 会配上上一版的 js/css，出一个"新界面配旧逻辑"的鬼状态，
//      而且玩家自己无法恢复（只能等缓存过期）。这个仓走 GitHub Pages，改版频繁，
//      所以宁可牺牲一次离线首屏，也不把代码钉死。
//   2) 缓存名带版本号：只有**资产**（图标/纹理/字体类不可变文件）可以缓存优先，
//      改图必然同时改文件名或 VERSION；js/css/html 则全走网络优先。
const VERSION = 'akari-v1';
const CACHE = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const PRECACHE = ['index.html', 'manifest.webmanifest'];

self.addEventListener('install', (ev) => {
  // 首屏两件套先抓下来：断网时至少能打开界面，而不是浏览器的错误页。
  ev.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 位图资产是不可变的（改了图就等于改了文件名/版本），它们才配 cache-first。
const IMMUTABLE = /\.(png|jpg|jpeg|webp|svg|woff2?)$/i;

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    ev.respondWith(
      caches.open(DATA).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  ev.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // 导航请求（地址栏/刷新/桌面图标）离线时回落到缓存的那份壳，不白屏。
        if (req.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
