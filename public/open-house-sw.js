const CACHE_NAME = "falcon-open-house-v1";
const OPEN_HOUSE_URL = "/open-house";
const PORTRAIT_URL = "/open-house/mike-ehinger-hq.jpg.png";

async function precacheOpenHouse() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(OPEN_HOUSE_URL, { cache: "reload" });

  if (!response.ok) {
    throw new Error(`Open House precache failed: ${response.status}`);
  }

  const html = await response.clone().text();
  await cache.put(OPEN_HOUSE_URL, response.clone());

  const assetUrls = new Set([PORTRAIT_URL]);
  const matches = html.matchAll(/(?:src|href)=["']([^"']+)["']/g);

  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;

    try {
      const url = new URL(raw, self.location.origin);
      if (url.origin !== self.location.origin) continue;
      if (
        url.pathname.startsWith("/_next/static/") ||
        url.pathname.startsWith("/open-house/") ||
        url.pathname === "/favicon.ico"
      ) {
        assetUrls.add(url.pathname + url.search);
      }
    } catch {
      // Ignore malformed/non-URL attributes.
    }
  }

  await Promise.all(
    [...assetUrls].map(async (url) => {
      try {
        const assetResponse = await fetch(url, { cache: "reload" });
        if (assetResponse.ok) await cache.put(url, assetResponse);
      } catch {
        // One optional asset should not prevent the rest of the offline shell from installing.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOpenHouse().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("falcon-open-house-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isOpenHouseNavigation =
    request.mode === "navigate" && url.pathname === OPEN_HOUSE_URL;
  const isOpenHouseAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/open-house/") ||
    url.pathname === "/favicon.ico";

  if (!isOpenHouseNavigation && !isOpenHouseAsset) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      if (isOpenHouseNavigation) {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await cache.put(OPEN_HOUSE_URL, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cached = await cache.match(OPEN_HOUSE_URL);
          if (cached) return cached;
          throw new Error("Open House is not cached for offline use yet.");
        }
      }

      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) await cache.put(request, networkResponse.clone());
        return networkResponse;
      } catch {
        const pathFallback = await cache.match(url.pathname + url.search);
        if (pathFallback) return pathFallback;
        throw new Error(`Offline asset unavailable: ${url.pathname}`);
      }
    })(),
  );
});
