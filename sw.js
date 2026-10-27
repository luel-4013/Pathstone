'use strict';

/*
 * Pathstone offline cache.
 *
 * The app is local-first: every core action already works from localStorage,
 * so the service worker only has to answer one question — can the shell load
 * with no network at all? Strategy: stale-while-revalidate for same-origin
 * GETs (serve the cached copy now, refresh quietly in the background), and
 * fall back to the index shell when a navigation cannot reach the network.
 */

const CACHE = 'pathstone-cache-v3';
const SHELL = './index.html';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/core.js',
  './js/db.js',
  './js/seed.js',
  './js/render.js',
  './js/views.js',
  './js/actions.js',
  './js/events.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  /* Never touch the vault API: it must always reach the live SQLite server. */
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(SHELL).then((cached) => cached || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || refresh;
    })
  );
});
