const CACHE_NAME = 'syllabustrakt-v11'; // lighter fonts, fewer re-renders, throttled notifications, runtime font caching
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon.png',
  './favicon-active.png'
];

// Separate, unversioned-by-release cache for stable cross-origin assets
// that almost never change (Google Fonts, the Supabase client script)
// but were previously re-fetched from the network on every single load —
// including every open of the installed PWA. Kept apart from CACHE_NAME
// so a shell update doesn't needlessly evict these too.
const RUNTIME_CACHE_NAME = 'syllabustrakt-runtime-v1';
const RUNTIME_CACHE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names
        .filter((n) => n !== CACHE_NAME && n !== RUNTIME_CACHE_NAME)
        .map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Only cache-serve the app shell itself. Everything else (Supabase API
// calls, etc.) always goes to the network so your data stays live —
// except the runtime-cacheable hosts below, handled separately.
const SHELL_FILENAMES = SHELL_FILES.filter(f => f !== './').map(f => f.replace('./', ''));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if(event.request.method !== 'GET') return;

  if(RUNTIME_CACHE_HOSTS.includes(url.hostname)){
    // Stale-while-revalidate: answer instantly from cache when we have
    // it (fonts/CDN scripts don't need to be perfectly fresh), while
    // quietly re-fetching in the background so next time stays current.
    event.respondWith(
      caches.open(RUNTIME_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const network = fetch(event.request).then((response) => {
            if(response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  const isRoot = url.pathname === '/' || url.pathname.endsWith('/');
  const isShellFile = isRoot || SHELL_FILENAMES.some((f) => url.pathname.endsWith(f));

  if(url.origin !== self.location.origin || !isShellFile) {
    return; // let the browser handle it normally (network) — includes all Supabase API calls
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
