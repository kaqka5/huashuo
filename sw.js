/* Branch · 离线缓存（改了文件记得把 VERSION 加一） */
var VERSION = 'branch-v1.9';
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './css/app.css',
  './js/core.js',
  './js/shortcuts.js',
  './js/touch.js',
  './js/mathfmt.js',
  './js/markdown.js',
  './js/fileread.js',
  './js/canvas.js',
  './js/boxes.js',
  './js/annotate.js',
  './js/plot.js',
  './js/menu.js',
  './js/tools.js',
  './js/ai.js',
  './js/pdftext.js',
  './js/exporter.js',
  './js/app.js'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).catch(function () { }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;   // AI 接口等外部请求不插手

  /* 页面导航：断网时回到缓存的首页 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); }).catch(function () { });
        }
        return res;
      });
    })
  );
});
