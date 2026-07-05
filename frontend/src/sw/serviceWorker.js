const CACHE_VERSION = "v1";
const SHELL_CACHE   = `nicu-shell-${CACHE_VERSION}`;
const DATA_CACHE    = `nicu-data-${CACHE_VERSION}`;

// App shell files — cached on install, served cache-first
const SHELL_FILES = [
  "/",
  "/index.html",
  "/offline.html",
  "/manifest.json",
];

// API patterns — network-first with cache fallback
const API_PATTERNS = [
  /\/api\//,
  /\/auth\//,
];

// Static asset patterns — cache-first
const ASSET_PATTERNS = [
  /\.js$/,
  /\.css$/,
  /\.woff2?$/,
  /\.png$/,
  /\.svg$/,
  /\.ico$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(SHELL_FILES).catch((err) => {
        console.warn("[sw] shell pre-cache partial failure:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => {
            console.log("[sw] deleting old cache:", k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // API calls — network first, fall back to cache
  if (API_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // Static assets — cache first
  if (ASSET_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Navigation requests — cache first, fall back to /offline.html
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Everything else — network first
  event.respondWith(networkFirst(request, DATA_CACHE));
});

// Cache-first: serve from cache, fall back to network and update cache
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Resource unavailable offline", { status: 503 });
  }
}

// Network-first: try network, update cache, fall back to cache
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: "You are offline", offline: true }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Navigation: try network, fall back to cached index, then offline page
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached =
      (await caches.match(request)) ||
      (await caches.match("/index.html")) ||
      (await caches.match("/offline.html"));
    return cached || new Response("Offline", { status: 503 });
  }
}

// Listen for skip-waiting message from the app
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
