// גרסה: לשנות את המספר בכל עדכון של index.html כדי שהמורים יקבלו את הגרסה החדשה
const CACHE = 'gordon-staff-v5';
const CORE = ['./', './index.html', './me.js', './activities.json', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // העמוד עצמו: קודם מהרשת (כדי לקבל עדכונים), ואם אין אינטרנט – מהמטמון
  if (req.mode === 'navigate' || (url.origin === location.origin && /\.(html|json)$/.test(url.pathname))) {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? './index.html' : req, copy)); return r; })
      .catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req, {ignoreSearch: true})));
    return;
  }
  // גופנים, אייקונים וקבצים קבועים: מהמטמון, ובמקביל מתעדכנים ברקע
  const cacheable = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|www\.gstatic\.com|cdnjs\.cloudflare\.com/.test(url.host);
  if (!cacheable) return;
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
