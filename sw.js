// Service worker: network-first, cache fallback (so the UI works offline). Bump CACHE when adding files.
const CACHE='prompter-v11';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./css/style.css','./js/match.js','./js/markdown.js','./js/search.js','./js/track.js','./js/engine-local.js','./js/mic-worklet.js','./js/app.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).pathname.includes('/models/'))return;   // big model files are cached by the app itself
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));
});
