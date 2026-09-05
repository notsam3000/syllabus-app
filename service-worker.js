const CACHE_NAME = 'syllabustrakt-v4'; // rebrand: new logo, palette, timer ring, chapter picker, etc.
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Only cache-serve the app shell itself. Everything else (Supabase calls,
// fonts, etc.) always goes to the network so your data stays live.
const SHELL_FILENAMES = SHELL_FILES.filter(f => f !== './').map(f => f.replace('./', ''));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isRoot = url.pathname === '/' || url.pathname.endsWith('/');
  const isShellFile = isRoot || SHELL_FILENAMES.some((f) => url.pathname.endsWith(f));

  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !isShellFile) {
    return; // let the browser handle it normally (network) — includes all Supabase/CDN calls
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
