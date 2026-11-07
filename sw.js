/* 커버 연습실 서비스 워커: 코드(index.html·sing.js·manifest 등 같은 출처 비미디어)는 네트워크 우선(HTTP 캐시 우회, 실패하면 캐시), 큰 정적 자원(audio/·vendor/·icons/·samples/)은 캐시 우선, 외부 CDN·글꼴은 stale-while-revalidate.
   코드가 네트워크 우선이라 sing.js 를 고쳐도 낡은 파일이 남지 않는다. 캐시 우선 자원(audio·vendor·icons·samples)을 바꿀 때만 V 를 올리면 옛 캐시는 정리된다 */
const V='pr-v11',SHELL=['./','index.html','help.html','sing.js','noteedit.js','vocal.js','staff.js','vendor/basicpitch.js','vendor/model/model.json','vendor/model/weights.json','audio/onedream_s59.mp3','samples/index.json','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'];
const CDN=['https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.21.0/dist/tf.min.js'];
const EXT=u=>u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com'||u.hostname==='cdn.jsdelivr.net';
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(V);await Promise.all(SHELL.map(u=>fetch(new Request(u,{cache:'reload'})).then(r=>{if(!r.ok)throw new Error(u);return c.put(u,r)})));
  try{const ix=await (await c.match('samples/index.json')).json(),fs=new Set();JSON.stringify(ix,(k,v)=>{if(typeof v==='string'&&/\.mp3$/.test(v))fs.add('samples/'+v);return v});
    await Promise.all([...fs].map(f=>fetch(f).then(r=>{if(r.ok&&r.status===200)return c.put(f,r)}).catch(()=>{})))}catch(_){} /* 샘플 음색도 오프라인에서 쓰도록 미리 담는다(실패해도 설치는 계속, 없으면 합성음으로 대신) */
  await Promise.all(CDN.map(u=>fetch(new Request(u,{mode:'no-cors'})).then(r=>c.put(u,r)).catch(()=>{})));
  const all=await self.clients.matchAll();all.forEach(x=>x.postMessage('cached'))})())});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('pr-v')&&k!==V)await caches.delete(k);await self.clients.claim();
  const all=await self.clients.matchAll();all.forEach(x=>x.postMessage('cached'))})())});
self.addEventListener('message',e=>{if(e.data==='skip')self.skipWaiting()});
async function ranged(req,res){const m=/bytes=(\d*)-(\d*)/.exec(req.headers.get('range')||'');if(!m||!res||res.status!==200)return res;
  const b=await res.arrayBuffer(),n=b.byteLength;let s=m[1]===''?Math.max(0,n-+m[2]):+m[1],t=m[1]!==''&&m[2]!==''?Math.min(+m[2],n-1):n-1;if(m[1]===''&&m[2]==='')return res;
  if(s>=n||s<0)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+n}});
  const h=new Headers(res.headers);h.set('Content-Range',`bytes ${s}-${t}/${n}`);h.set('Content-Length',t-s+1);return new Response(b.slice(s,t+1),{status:206,statusText:'Partial Content',headers:h})}
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.origin===location.origin){
    if(u.pathname.endsWith('/index.html')||u.pathname.endsWith('/')||(r.mode==='navigate'&&!/\.[a-z0-9]+$/i.test(u.pathname))){e.respondWith((async()=>{const c=await caches.open(V);
      try{const n=await fetch(r,{cache:'no-cache'});if(n.ok)c.put('index.html',n.clone());return n}catch(_){return(await c.match('index.html'))||(await c.match('./'))||Response.error()}})());return}
    if(!/\/(audio|vendor|icons|samples)\//.test(u.pathname)){e.respondWith((async()=>{const c=await caches.open(V);
      try{const n=await fetch(new Request(r.url,{cache:'no-cache'}));if(n.ok&&n.status===200)c.put(r.url,n.clone());return r.headers.has('range')?ranged(r,n):n}catch(_){const h=await c.match(r.url);return h?(r.headers.has('range')?ranged(r,h):h):Response.error()}})());return}
    e.respondWith((async()=>{const c=await caches.open(V);let h=await c.match(r.url);
      if(!h){try{h=await fetch(r.headers.has('range')?new Request(r.url):r);if(h.ok&&h.status===200)c.put(r.url,h.clone())}catch(_){return Response.error()}}
      return r.headers.has('range')?ranged(r,h):h})());return}
  if(EXT(u)){e.respondWith((async()=>{const c=await caches.open(V);const h=await c.match(r);
    const n=fetch(r).then(x=>{if(x.ok||x.type==='opaque')c.put(r,x.clone());return x}).catch(()=>null);
    return h||(await n)||Response.error()})())}});
