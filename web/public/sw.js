/* Tangkortet offline service worker, ported from Svampekortet (0024b43). Hand-rolled (no workbox): the app is one
 * JS chunk + one CSS file + a few icons + a small JSON data payload, all fetched
 * on first visit, so a runtime cache is enough to make it work on the beach
 * with no signal. Map tiles are NOT cached (cross-origin, large, OSM tile policy)
 * -- offline you get the data and the UI, not fresh map imagery.
 *
 * Freshness vs offline: the shell (index.html) and the JSON payload are
 * network-first, so a deploy's new bundle and data show on the next online
 * visit, not one visit late; both fall back to the cache when offline. The
 * content-hashed build assets are cache-first (their URL changes when they do).
 *
 * Species photos are hotlinked from iNaturalist's open-data bucket. The app
 * requests them with CORS (thumb.ts), so they can be kept here: cache-first in
 * a cache of their own, capped at PHOTO_MAX entries (oldest out first). A photo
 * seen once (the list's thumbnails, a species page) shows again offline; one
 * never seen fails, and the app falls back to its placeholder or the plain
 * heading. Opaque (non-CORS) responses are never stored.
 *
 * The place cards' photos come from Wikimedia Commons (upload.wikimedia.org,
 * which also answers CORS with "*"); they share the photo cache.
 */

const CACHE = "tangkortet-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg"];
const PHOTOS = "tangkortet-photos-v1";
const PHOTO_HOSTS = new Set(["inaturalist-open-data.s3.amazonaws.com", "upload.wikimedia.org"]);
// ~17 thumbnails in two sizes plus a few species pages of medium/large photos,
// and the place cards' photos of the spots visited
const PHOTO_MAX = 160;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== PHOTOS).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (PHOTO_HOSTS.has(url.hostname) && request.mode === "cors") {
    event.respondWith(photo(request, event));
    return;
  }
  if (url.origin !== self.location.origin) return; // tiles, DMI, live map servers: straight to network

  if (request.mode === "navigate" || url.pathname.startsWith("/data/")) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request)); // hashed build assets + icons
  }
});

async function put(request, response) {
  if (response && response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function cacheFirst(request) {
  return (await caches.match(request)) || put(request, await fetch(request));
}

async function networkFirst(request) {
  try {
    // Bypass the browser HTTP cache so a stale index.html can't pin an old
    // bundle after a deploy; the SW cache below is the offline fallback.
    return await put(request, await fetch(request, { cache: "no-store" }));
  } catch {
    return (
      (await caches.match(request)) ||
      (await caches.match("/")) ||
      new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

async function photo(request, event) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request); // a network error fails the <img>: the app falls back
  if (response.ok && response.type === "cors") {
    event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache)));
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys(); // in insertion order
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - PHOTO_MAX)).map((k) => cache.delete(k)),
  );
}
