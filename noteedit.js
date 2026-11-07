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
const api={G,MINL,snap,snapDn,clampP,addNote,moveNote,resizeNote,deleteNote,hit,isEdge,hist,hpush,hundo,hredo,diff,toSec,fromSec,clone};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NoteEdit=api})(typeof window!=='undefined'?window:globalThis);
