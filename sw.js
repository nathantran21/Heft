// Heft offline shell — cache the app so it opens with no connection.
const CACHE='heft-v10';
const ASSETS=['./','./index.html','./manifest.json',
  './icons/icon-192.png','./icons/icon-512.png','./icons/apple-icon-180.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(
    fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r;})
    .catch(()=>caches.match(e.request).then(m=>m||caches.match('./index.html')))
  );
});
