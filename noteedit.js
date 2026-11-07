/* 음 고치기 순수 함수 — 채보 음(score)·보컬 멜로디(vocal) 층을 손으로 고칠 때 쓰는 계산만 모았다(화면·오디오 없음). window.NoteEdit / node: module.exports.
   음 = [시작(박), 길이(박), 음높이(midi), 세기]. 박 단위, 16분음표 = 0.25박. 모든 함수는 새 배열을 돌려주고 받은 배열은 바꾸지 않는다.
   단선율(mono)이면 새로 놓인(또는 옮긴) 음이 이기고, 겹친 다른 음은 앞음 꼬리를 자르거나 뒷음 머리를 자르고, 다 덮이면 지운다. 여러 음(poly)이면 같은 높이끼리만 같은 규칙을 쓴다. */
(function(root){
const G=.25,MINL=.125,q=x=>Math.round(x*1000)/1000,clone=ns=>ns.map(n=>n.slice()),sortN=ns=>ns.sort((a,b)=>a[0]-b[0]||a[2]-b[2]);
const snap=(b,g)=>{g=g||G;return q(Math.round(b/g+1e-9)*g)},snapDn=(b,g)=>{g=g||G;return q(Math.floor(b/g+1e-9)*g)};
const clampP=p=>Math.max(21,Math.min(108,Math.round(p)));
const ov=(w,o,mono)=>mono||w[2]===o[2]; // 이 둘이 겹침 검사 대상인가
/* 이긴 음 w(배열 안에 있음) 위에 겹친 다른 음 정리. 정리 뒤 w 의 새 위치(index)를 함께 돌려준다 */
function settle(ns,w,mono){const e=w[0]+w[1],out=[];for(const o of ns){if(o===w){out.push(o);continue}if(!ov(w,o,mono)){out.push(o);continue}const oe=o[0]+o[1];
  if(o[0]<w[0]-1e-9&&oe>w[0]+1e-9){const d=q(w[0]-o[0]);if(d>=MINL/2){o[1]=d;out.push(o)}} // 앞음 꼬리 자름(너무 짧아지면 지움)
  else if(o[0]>=w[0]-1e-9&&o[0]<e-1e-9){if(oe>e+1e-9){const d=q(oe-e);if(d>=MINL/2){o[0]=q(e);o[1]=d;out.push(o)}} } // 뒷음 머리 자름 / 완전히 덮이면 지움
  else out.push(o)}
 sortN(out);return {notes:out,idx:out.indexOf(w)}}
/* 새 음 앞에 자리가 모자라면 길이를 줄인다: 같은 선(단선율이면 전부)에서 시작이 s 뒤인 가장 가까운 음 앞까지 */
function room(ns,skip,s,mono,w){let r=1e9;for(const o of ns){if(o===skip||!ov(w,o,mono))continue;if(o[0]>s+1e-9)r=Math.min(r,o[0]-s)}return r}
function addNote(ns,a,o){o=o||{};const mono=!!o.mono,tot=o.total||1e9,s=Math.max(0,Math.min(snapDn(a.s),tot-G)),p=clampP(a.p),v=Math.max(1,Math.min(127,Math.round(a.v||96)));
 const out=clone(ns),w=[s,0,p,v];let d=Math.max(MINL,q(a.d||1));d=Math.min(d,Math.max(MINL,q(tot-s)));d=Math.min(d,Math.max(MINL,room(out,null,s,mono,w)));w[1]=q(d);out.push(w);return settle(out,w,mono)}
function moveNote(ns,i,ds,dp,o){o=o||{};const mono=!!o.mono,tot=o.total||1e9,out=clone(ns),w=out[i];if(!w)return {notes:out,idx:-1};
 let s=o.snap===false?q(w[0]+ds):snap(w[0]+ds);s=Math.max(0,Math.min(s,Math.max(0,q(tot-w[1]))));w[0]=s;w[2]=clampP(w[2]+dp);return settle(out,w,mono)}
function resizeNote(ns,i,end,o){o=o||{};const mono=!!o.mono,tot=o.total||1e9,out=clone(ns),w=out[i];if(!w)return {notes:out,idx:-1};
 let d=Math.max(G,snap(end)-w[0]);d=Math.min(d,Math.max(MINL,q(tot-w[0])));d=Math.min(d,Math.max(MINL,room(out,w,w[0],mono,w)));w[1]=q(d);return {notes:sortN(out),idx:out.indexOf(w)}}
function deleteNote(ns,i){const out=clone(ns);if(i>=0&&i<out.length)out.splice(i,1);return {notes:out,idx:-1}}
/* 눌린 자리(b박, 음높이 p)에 있는 음의 index, 없으면 -1. tolP: 음높이 허용 반음, tolB: 박 허용 */
function hit(ns,b,p,o){o=o||{};const tp=o.tolP||0,tb=o.tolB||0;let best=-1,bs=1e9;ns.forEach((n,i)=>{if(b<n[0]-tb||b>n[0]+n[1]+tb)return;const dp=Math.abs(n[2]-p);if(dp>tp+1e-9)return;const sc=dp*10+Math.abs(b-(n[0]+n[1]/2));if(sc<bs){bs=sc;best=i}});return best}
const isEdge=(n,b,tb)=>b>=n[0]+n[1]-tb;
/* 되돌리기/다시하기: 항목 {l:층 id, notes:그 층의 음 목록 복사본}. 한도 기본 200단계 */
const hist=()=>({u:[],r:[]});
function hpush(h,l,notes,lim){h.u.push({l,notes:clone(notes)});while(h.u.length>(lim||200))h.u.shift();h.r.length=0}
function hundo(h,cur){const e=h.u.pop();if(!e)return null;h.r.push({l:e.l,notes:clone(cur(e.l))});return e}
function hredo(h,cur){const e=h.r.pop();if(!e)return null;h.u.push({l:e.l,notes:clone(cur(e.l))});return e}
/* 자동 결과(orig)와 지금(cur) 비교: 각 음이 자동 음과 같은지(시작·길이 tol 박 이내, 같은 높이). 고친 음 수 = max(바뀐·새 음, 사라진 음) */
function diff(orig,cur,tol){tol=tol||.02;const used=new Set(),by=new Map();orig.forEach((o,j)=>{if(!by.has(o[2]))by.set(o[2],[]);by.get(o[2]).push(j)});
 const mask=cur.map(n=>{const c=by.get(n[2]);if(c)for(const j of c){if(used.has(j))continue;const o=orig[j];if(Math.abs(o[0]-n[0])<=tol&&Math.abs(o[1]-n[1])<=tol){used.add(j);return false}}return true});
 const ch=mask.filter(Boolean).length,gone=orig.length-used.size;return {mask,count:Math.max(ch,gone),changed:ch,removed:gone}}
/* 저장용: 박 ↔ 초(원본 BPM·첫 박 기준). 박자를 다시 맞춰도 시간 위치가 유지된다 */
const r5=x=>Math.round(x*1e5)/1e5;
const toSec=(ns,bpm,off)=>{const spb=60/bpm;return ns.map(n=>[r5(n[0]*spb+off),r5(n[1]*spb),n[2],n[3]])};
const fromSec=(arr,bpm,off,total)=>{const spb=60/bpm,o=[];for(const n of arr){if(!Array.isArray(n)||n.length<3||!n.slice(0,3).every(isFinite))continue;const s=q((n[0]-off)/spb);if(s<0||s>=(total||1e9))continue;o.push([s,Math.max(MINL,q(n[1]/spb)),clampP(n[2]),Math.max(1,Math.min(127,Math.round(isFinite(n[3])?n[3]:96)))])}return sortN(o)};
/* ---------- 스텝 입력(키보드로 음 넣기): 순수 부분만. 화면 연결은 index.html ----------
   키(음 고치기 켠 동안, 롤에 초점): 1–6 길이(16분·8분·4분·2분·점2분·온음표), A–G 음 넣기(제자리음, 선택한 음/커서 뒤), ↑↓ 반음, Ctrl/Cmd+↑↓ 옥타브, Backspace·Delete 지우기. ←→·Shift+방향키는 기존 그대로 */
const STEP_DUR={1:.25,2:.5,3:1,4:2,5:3,6:4},STEP_NAME={.25:'16분음표',.5:'8분음표',1:'4분음표(1박)',2:'2분음표(2박)',3:'점2분음표(3박)',4:'온음표(4박)'},LET_PC={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
/* 키 이벤트({key,ctrl,meta,shift,alt}) → 동작 {t:'dur',beats}|{t:'letter',l,pc}|{t:'semi',d}|{t:'oct',d}|{t:'del'} 또는 null(이 키는 스텝 입력이 아님) */
function stepKey(e){if(!e||e.alt)return null;const k=e.key,cd=/^Key([A-G])$/.exec(e.code||''),mod=!!(e.ctrl||e.meta);
 if(mod)return k==='ArrowUp'?{t:'oct',d:1}:k==='ArrowDown'?{t:'oct',d:-1}:null;
 if(k==='Backspace'||k==='Delete')return {t:'del'};if(e.shift)return null;
 if(/^[1-6]$/.test(k))return {t:'dur',beats:STEP_DUR[k]};
 const lt=/^[a-g]$/i.test(k)?k.toLowerCase():cd?cd[1].toLowerCase():null;/* 한글 자판 등 IME 에서는 e.key 가 'ㅁ' 이라 e.code(KeyA–KeyG)로 */
 if(lt)return {t:'letter',l:lt.toUpperCase(),pc:LET_PC[lt]};
 if(k==='ArrowUp'||k==='ArrowDown')return {t:'semi',d:k==='ArrowUp'?1:-1};return null}
/* 음 이름 글자의 음높이: 기준음(ref)에 가장 가까운 옥타브, 같으면 아래. lo..hi 안에서 */
function letterPitch(pc,ref,lo,hi){lo=lo==null?21:lo;hi=hi==null?108:hi;if(!isFinite(ref))ref=(lo+hi)/2;let best=null;for(let p=lo;p<=hi;p++)if(p%12===pc&&(best===null||Math.abs(p-ref)<Math.abs(best-ref)))best=p;return best}
/* 다음 음이 들어갈 박: 고른 음이 있으면 그 음 끝, 아니면 커서(cur), 그것도 없으면 지금 박(now)을 16분 칸으로 내림 */
function stepCursor(ns,sel,cur,now){if(sel>=0&&ns[sel])return q(ns[sel][0]+ns[sel][1]);if(cur!=null&&isFinite(cur))return snapDn(cur);return snapDn(now||0)}
/* 기준 음높이: 고른 음, 없으면 커서 앞에서 가장 가까운 음, 없으면 null */
function stepRef(ns,sel,cursor){if(sel>=0&&ns[sel])return ns[sel][2];let b=null;for(const n of ns)if(n[0]<cursor-1e-9&&(b===null||n[0]>=b[0]))b=n;return b?b[2]:null}
/* ---------- 셋잇단·스윙 감지(제안만, 자동 적용 아님) ----------
   채보 음의 박 단위 시작(양자화 전 값)에서 박 안 위상 f(0~1)를 뽑는다. 16분 격자는 0·.25·.5·.75, 셋잇단 8분은 0·.333·.667 에 봉우리가 선다.
   박 위(박에서 .08 이내) 음은 두 격자가 같아 빼고, 나머지(박 사이 음)를 두 격자 중 어느 쪽에 더 가까운지 센다.
   swingDetect: 박 사이 음 >= min(40) 이고 셋잇단 격자가 더 가까운 비율 >= frac(.6) 이고 제곱오차도 셋잇단이 작을 때만 hit.
   tripBeats: 박마다 두 격자의 제곱오차를 비교해 셋잇단이 더 맞는 박 번호 목록(같으면 16분 격자). 임계값은 합성 조정 집합으로만 정했고 실제 곡 정답은 없다 */
const SW_NEAR=.08,SW_D16=f=>{const k=Math.round(f*4);return Math.abs(f-k/4)},SW_D3=f=>{const k=Math.round(f*3);return Math.abs(f-k/3)};
function swingStats(notes){let n=0,all=0,t3=0,s16=0,s3=0;const ph=[];
 for(const x of notes||[]){const s=x&&x[0];if(!isFinite(s)||s<0)continue;all++;const f=s-Math.floor(s);if(Math.min(f,1-f)<=SW_NEAR)continue;n++;const a=SW_D16(f),b=SW_D3(f);if(b<a)t3++;s16+=a*a;s3+=b*b;if(f>=.4&&f<=.8)ph.push(f)}
 ph.sort((a,b)=>a-b);const m=ph.length?ph[ph.length>>1]:null;
 return {all,n,t3,frac:n?t3/n:0,rms16:n?Math.sqrt(s16/n):0,rms3:n?Math.sqrt(s3/n):0,median:m,ratio:m==null?null:m/(1-m)}}
function swingDetect(notes,o){o=o||{};const s=swingStats(notes);s.hit=s.n>=(o.min==null?40:o.min)&&s.frac>=(o.frac==null?.6:o.frac)&&s.rms3<s.rms16;return s}
function tripBeats(notes){const B={};for(const x of notes||[]){const s=x&&x[0];if(!isFinite(s)||s<0)continue;const b=Math.floor(s),f=s-b,a=SW_D16(f),c=SW_D3(f),e=B[b]||(B[b]={a:0,c:0});e.a+=a*a;e.c+=c*c}
 return Object.keys(B).map(Number).filter(b=>B[b].c+1e-4<B[b].a).sort((p,q)=>p-q)}
const SWG={swingStats,swingDetect,tripBeats};
const api={STEP_DUR,STEP_NAME,stepKey,letterPitch,stepCursor,stepRef,G,MINL,snap,snapDn,clampP,addNote,moveNote,resizeNote,deleteNote,hit,isEdge,hist,hpush,hundo,hredo,diff,toSec,fromSec,clone};
Object.assign(api,SWG);
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NoteEdit=api})(typeof window!=='undefined'?window:globalThis);
