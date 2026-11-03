// Service worker: o app abre sem internet. Rede primeiro (pega atualizações), cache como reserva.
const CACHE = "motion-studio-v2";
const SHELL = ["./", "index.html", "css/style.css", "manifest.webmanifest", "js/app.js", "js/util.js", "js/store.js", "js/link.js", "js/ch340.js",
  "js/viewer.js", "js/timeline.js", "js/storage.js", "vendor/web-serial-polyfill.js", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
    .catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
});
