// Network first for the app shell so updates show up immediately;
// the cache is only the offline fallback. API calls are never cached here.
const CACHE = "bushof-v6";
const SHELL = [
  "/",
  "/anzeige",
  "/css/led.css",
  "/css/app.css",
  "/css/anzeige.css",
  "/js/core.js",
  "/js/led.js",
  "/js/search.js",
  "/js/app.js",
  "/js/anzeige.js",
  "/fonts/jersey10-latin.woff2",
  "/fonts/jersey10-latin-ext.woff2",
  "/icons/favicon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === location.origin && !url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
  }
});
