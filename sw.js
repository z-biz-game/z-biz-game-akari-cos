'use strict';
// 离线可用 + 永不被旧缓存钉住。
//
// 两条实测换来的口径：
//   1) 一律 **网络优先**，命中网络才回填缓存。手工 VERSION + cache-first 的组合，
//      发出去的 HTML 会配上上一版的 js/css，出一个"新界面配旧逻辑"的鬼状态，
//      而且玩家自己无法恢复（只能等缓存过期）。这个仓走 GitHub Pages，改版频繁，
//      所以宁可牺牲一次离线首屏，也不把代码钉死。
//   2) 缓存名带版本号（activate 时清掉非本版的名字）。改版**不需要**同步 bump：
//      同名文件重绘之后，网络优先这一条保证客户端下一次联网就拿到新字节。
const VERSION = 'akari-v1';
const CACHE = `${VERSION}-shell`;
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

// 位图也走网络优先：assets/gen/make_art.py 重绘时写的是**同一批文件名**，
// 而 VERSION 是手写的常量——没人保证改版时同步 bump 它。cache-first 于是会让
// 已装过的客户端永远读到旧图，而且玩家自己恢复不了。离线的兜底并不依赖 cache-first：
// 下面的 catch 用 caches.match，它跨全部缓存名查，回填进 CACHE 的图照样命中。
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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
