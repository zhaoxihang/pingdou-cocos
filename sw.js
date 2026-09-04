/**
 * pingdou-cocos service worker
 * Scope: /pingdou-cocos/ on GitHub Pages (register with relative sw.js).
 */
const CACHE_PREFIX = 'pingdou-cocos-';
const CACHE_NAME = 'pingdou-cocos-v1';

const STATIC_EXT_RE = /\.(?:js|css|png|jpg|jpeg|webp|ico|gif|svg|woff2?|ttf|mp3|ogg|wav|json|bin|plist|atlas|fnt)(?:\?.*)?$/i;
const STATIC_PATH_RE = /(?:^|\/)(?:assets|src)\//i;
const STATIC_NAME_RE = /(?:^|\/)(?:cocos2d-js|physics|main|splash|style-mobile|style-desktop|favicon)/i;

function sameOrigin(url) {
  try {
    return new URL(url, self.location.href).origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

function toScopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept') &&
      request.headers.get('accept').indexOf('text/html') !== -1);
}

function isIndexHtml(url) {
  const u = new URL(url);
  const path = u.pathname;
  return path.endsWith('/') || path.endsWith('/index.html') || /\/index\.html$/i.test(path);
}

function isStaticAsset(url) {
  const u = new URL(url);
  const path = u.pathname;
  return STATIC_EXT_RE.test(path) || STATIC_PATH_RE.test(path) || STATIC_NAME_RE.test(path);
}

function discoverShellUrls(htmlText) {
  const found = new Set();
  found.add(toScopeUrl('./'));
  found.add(toScopeUrl('./index.html'));

  const attrRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attrRe.exec(htmlText))) {
    const ref = m[1].trim();
    if (!ref || ref.startsWith('data:') || ref.startsWith('#')) continue;
    if (/^https?:\/\//i.test(ref) && !sameOrigin(ref)) continue;
    found.add(toScopeUrl(ref));
  }

  // Inline loadScript('...') / loadScript("...") string literals
  const litRe = /['"]((?:cocos2d-js[^'"]*|physics[^'"]*|main\.[^'"]+\.js|src\/settings\.[^'"]+\.js|style-mobile\.[^'"]+\.css|splash[^'"]*))['"]/gi;
  while ((m = litRe.exec(htmlText))) {
    found.add(toScopeUrl(m[1]));
  }

  return Array.from(found);
}

async function precacheShell(cache) {
  let html = '';
  try {
    const res = await fetch(toScopeUrl('./index.html'), { cache: 'no-cache' });
    if (res && res.ok) {
      html = await res.text();
      await cache.put(toScopeUrl('./index.html'), new Response(html, {
        headers: res.headers
      }));
      // Also mirror directory URL when possible
      try {
        await cache.put(toScopeUrl('./'), new Response(html, { headers: res.headers }));
      } catch (e) { /* ignore */ }
    }
  } catch (e) {
    console.warn('[sw] precache index fetch failed', e);
  }

  const urls = html ? discoverShellUrls(html) : [
    toScopeUrl('./'),
    toScopeUrl('./index.html')
  ];

  await Promise.all(urls.map(async (url) => {
    if (url === toScopeUrl('./index.html') || url === toScopeUrl('./')) return;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res && res.ok && res.type !== 'opaque') {
        await cache.put(url, res.clone());
      }
    } catch (e) {
      console.warn('[sw] precache miss', url, e);
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await precacheShell(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) {
        return caches.delete(key);
      }
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && sameOrigin(fresh.url) && fresh.type !== 'opaque') {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const fallback = await cache.match(toScopeUrl('./index.html'));
    if (fallback) return fallback;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok && sameOrigin(request.url) && fresh.type !== 'opaque') {
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = request.url;
  if (!sameOrigin(url)) return; // skip opaque/cross-origin caching

  if (isNavigationRequest(request) || isIndexHtml(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});