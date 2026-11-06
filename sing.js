/* 시창·청음 연습 코어 (UI 없음). window.SingLab 으로 노출, node 에서는 module.exports.
   - yin: 단음 음높이 추정 (YIN, 누적 평균 정규화 차분 + 포물선 보간)
   - tracker: 마이크 스트림 → 20 ms 간격 [시각, midi(소수), 신뢰도] 기록
   - makeExercise: 키·음역 안에서 순차 진행 위주의 시창 멜로디 생성 (박 단위 [시작박, 길이박, midi])
   - scoreTake: 목표 음별로 ±50 cent 안에 든 유성 프레임 비율, 평균 cent 오차, 판정
   - estimateLatency: 스피커 클릭을 마이크로 다시 듣는 왕복 지연(ms) 추정
   - smoothNotes: pyin+평활 분할과 같은 방식으로 음높이 곡선을 음 목록으로 (2026-11-07 시험 F1 0.755 방식)
   - earQuiz: 키 안의 음정·3화음 문제 생성
   - makeProgression: 4코드 진행 받아쓰기 문제(곡 코드 창 또는 무작위 다이아토닉) + 보이싱
   - topLine: 채보 음 목록에서 윗선율(단선율) 추출 → 음역에 맞춰 옥타브 이동
   - recStat·lastAcc: 진도 기록(항목별 최근 결과 배열) 갱신·최근 n회 정답률
   신호 기반 판정이며 사람 청취 평가가 아니다. */
(function(root){
const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const MAJ=[0,2,4,5,7,9,11],MIN=[0,2,3,5,7,8,10];

function yin(buf,sr,fmin=70,fmax=1100,thr=.12){const n=buf.length,maxL=Math.min(Math.floor(sr/fmin),n>>1),minL=Math.max(2,Math.floor(sr/fmax));
 let rms=0;for(let i=0;i<n;i++)rms+=buf[i]*buf[i];rms=Math.sqrt(rms/n);if(rms<.008)return null;
 const W=n-maxL,d=new Float32Array(maxL+1);for(let L=1;L<=maxL;L++){let s=0;for(let i=0;i<W;i++){const x=buf[i]-buf[i+L];s+=x*x}d[L]=s}
 let run=0,tau=-1;const c=new Float32Array(maxL+1);c[0]=1;for(let L=1;L<=maxL;L++){run+=d[L];c[L]=run?d[L]*L/run:1}
 for(let L=minL;L<=maxL;L++){if(c[L]<thr){while(L+1<=maxL&&c[L+1]<c[L])L++;tau=L;break}}
 if(tau<0)return null;const a=c[tau-1]??c[tau],b=c[tau],e=c[tau+1]??c[tau],den=a-2*b+e;const t=den?tau+.5*(a-e)/den:tau;
 const f=sr/t;return {f,midi:69+12*Math.log2(f/440),conf:1-b,rms}}

/* 마이크 → 음높이 기록. ctx 는 호출 쪽 AudioContext. stop() 은 트랙과 노드를 정리한다 */
async function tracker(ctx,onFrame){const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
 let src,an;try{src=ctx.createMediaStreamSource(stream);an=ctx.createAnalyser();an.fftSize=2048;src.connect(an)}catch(e){stream.getTracks().forEach(t=>t.stop());throw e}
 const buf=new Float32Array(an.fftSize),track=[];let on=true;
 const iv=setInterval(()=>{if(!on)return;an.getFloatTimeDomainData(buf);const r=yin(buf,ctx.sampleRate);const fr=[ctx.currentTime,r?r.midi:null,r?r.conf:0];track.push(fr);onFrame&&onFrame(fr)},20);
 return {track,stop(){on=false;clearInterval(iv);src.disconnect();stream.getTracks().forEach(t=>t.stop())}}}

function rng(seed){let s=seed>>>0||1;return ()=>(s=(s*1664525+1013904223)>>>0)/4294967296}
/* 키(0–11)·장단조·마디 수·음역[lo,hi] → 으뜸음에서 시작해 으뜸음으로 끝나는 멜로디. 도약은 3도 이하 위주, 가끔 4·5도 */
function makeExercise({key=0,minor=false,bars=4,lo=57,hi=69,seed=1,level=1}={}){const R=rng(seed),sc=minor?MIN:MAJ,pool=[];
 for(let m=lo;m<=hi;m++)if(sc.includes(((m-key)%12+12)%12))pool.push(m);if(pool.length<3)return [];
 const tonics=pool.filter(m=>((m-key)%12+12)%12===0);let cur=tonics.length?tonics[Math.floor(tonics.length/2)]:pool[pool.length>>1];
 const rhythms=level<2?[[2,2],[1,1,2],[2,1,1],[4]]:[[1,1,1,1],[1.5,.5,2],[1,1,2],[.5,.5,1,2],[2,1,1]];const out=[];let t=0;
 for(let b=0;b<bars;b++){const rh=b===bars-1?[2,2]:rhythms[Math.floor(R()*rhythms.length)];for(let k=0;k<rh.length;k++){
  const last=b===bars-1&&k===rh.length-1;let i=pool.indexOf(cur);
  if(out.length){if(last){const near=tonics.length?tonics.reduce((a,x)=>Math.abs(x-cur)<Math.abs(a-cur)?x:a):cur;i=pool.indexOf(near)}
   else{const r=R(),step=r<.6?1:r<.85?2:(level<2?2:R()<.5?3:4);const dir=i<=1?1:i>=pool.length-2?-1:(R()<.5?-1:1);i=Math.max(0,Math.min(pool.length-1,i+dir*step))}}
  cur=pool[i];out.push([t,rh[k],cur]);t+=rh[k]}}
 return out}

/* 목표 [시작박,길이박,midi] + 기록 [초,midi|null,conf] + 박→초 함수. 각 음의 앞 15%·뒤 10% 는 이동 구간이라 뺀다 */
function scoreTake(target,track,beatToSec,{tol=50,minConf=.5}={}){const per=target.map(([s,d,p])=>{const a=beatToSec(s+d*.15),b=beatToSec(s+d*.9);
  const fr=track.filter(f=>f[0]>=a&&f[0]<=b);const v=fr.filter(f=>f[1]!=null&&f[2]>=minConf);
  const cents=v.map(f=>{let c=(f[1]-p)*100;return c});const inT=cents.filter(c=>Math.abs(c)<=tol).length;
  const med=cents.length?cents.slice().sort((x,y)=>x-y)[cents.length>>1]:null;
  const oct=med!=null&&Math.abs(Math.abs(med)-1200)<tol*2;
  return {pitch:p,frames:fr.length,voiced:v.length,hit:v.length?inT/v.length:0,medCents:med,octave:oct,
   verdict:!v.length?'소리 없음':oct?'옥타브 차이':inT/v.length>=.6?'맞음':med>0?'높음':'낮음'}});
 const sung=per.filter(x=>x.voiced);return {notes:per,score:sung.length?Math.round(100*per.filter(x=>x.verdict==='맞음').length/per.length):0,
  meanAbsCents:sung.length?Math.round(sung.reduce((a,x)=>a+Math.abs(x.octave?x.medCents-Math.sign(x.medCents)*1200:x.medCents),0)/sung.length):null}}

/* 왕복 지연 추정(ms). samples [[초, rms]] 시간순, clicks 예약 시각(초) 배열. 첫 클릭 전 구간 rms 중앙값(잡음 바닥)의 5배와 0.02 중 큰 값을 클릭 뒤 [-30 ms, +450 ms] 안에서 처음 넘는 시각 − 예약 시각의 중앙값. 잡힌 클릭이 2개 미만이면 null */
function estimateLatency(samples,clicks,{win=.45,minRms=.02,k=5}={}){const base=samples.filter(s=>s[0]<clicks[0]-.05).map(s=>s[1]).sort((a,b)=>a-b),nf=base.length?base[base.length>>1]:0,thr=Math.max(minRms,nf*k),lat=[];
 for(const c of clicks){const s=samples.find(x=>x[0]>=c-.03&&x[0]<=c+win&&x[1]>thr);if(s)lat.push(Math.max(0,s[0]-c))}
 if(lat.length<2)return null;lat.sort((a,b)=>a-b);return Math.round(1000*lat[lat.length>>1])}

/* 음높이 곡선 → 음 목록 [시작초,길이초,midi]. 중앙값에서 0.6 반음 이상 벗어나면 새 음, 60 ms 미만 버림 */
function smoothNotes(track,{dev=.6,minDur=.06}={}){const out=[];let seg=[];const flush=()=>{if(seg.length>1){const ps=seg.map(f=>f[1]).sort((a,b)=>a-b),m=ps[ps.length>>1],dur=seg[seg.length-1][0]-seg[0][0];if(dur>=minDur)out.push([seg[0][0],dur,Math.round(m)])}seg=[]};
 for(const f of track){if(f[1]==null||f[2]<.5){flush();continue}if(seg.length){const ps=seg.map(x=>x[1]).sort((a,b)=>a-b);if(Math.abs(f[1]-ps[ps.length>>1])>dev)flush()}seg.push(f)}flush();return out}

const INTERVALS=[['단2도',1],['장2도',2],['단3도',3],['장3도',4],['완전4도',5],['증4도',6],['완전5도',7],['단6도',8],['장6도',9],['단7도',10],['장7도',11],['옥타브',12]];
/* 청음 문제: type 'interval' | 'triad'. level 1 은 키 안의 음만, 2 는 전부 */
function earQuiz({type='interval',key=0,level=1,seed=Date.now(),lo=55,hi=72}={}){const R=rng(seed);
 if(type==='triad'){const qs=[['메이저',[0,4,7]],['마이너',[0,3,7]],['디미니시',[0,3,6]],['오그먼트',[0,4,8]]].slice(0,level<2?2:4);const [name,iv]=qs[Math.floor(R()*qs.length)];const root=lo+Math.floor(R()*(hi-lo-8));return {type,answer:name,choices:qs.map(q=>q[0]),notes:iv.map(i=>root+i),label:NAMES[root%12]}}
 const pool=level<2?INTERVALS.filter(([,s])=>MAJ.includes(s%12)||s===12):INTERVALS;const [name,semi]=pool[Math.floor(R()*pool.length)];
 let base;if(level<2){const deg=MAJ.filter(d=>MAJ.includes((d+semi)%12));const d=deg[Math.floor(R()*deg.length)]??0;base=lo+((key+d-lo)%12+12)%12}else base=lo+Math.floor(R()*(hi-lo-12));
 return {type,answer:name,choices:pool.map(p=>p[0]),notes:[base,base+semi],label:NAMES[base%12]}}

const DEG_L=['I','ii','iii','IV','V','vi','vii°'],DEG_Q=['maj','min','min','maj','maj','min','dim'],QIV={maj:[0,4,7],min:[0,3,7],dim:[0,3,6]};
/* 한 화음의 보이싱: 이전 화음과 가장 가깝게 이어지는 전위를 고른다. 베이스는 36–47 의 근음 */
function voiceTriad(rootPc,q,prev){let best=null;const pcs=QIV[q].map(i=>(rootPc+i)%12);
 for(let inv=0;inv<3;inv++){const rot=pcs.slice(inv).concat(pcs.slice(0,inv));let n=55;while(n%12!==rot[0])n++;const notes=[n];for(let k=1;k<3;k++){let m=notes[k-1]+1;while(m%12!==rot[k])m++;notes.push(m)}
  const cost=prev?notes.reduce((a,x,i)=>a+Math.abs(x-prev[i]),0):Math.abs(notes.reduce((a,x)=>a+x,0)/3-64);if(!best||cost<best.cost)best={cost,notes}}
 let b=36;while(b%12!==rootPc)b++;return {notes:best.notes,bass:b}}
/* 코드 진행 문제. level 1: songChords([{root,minor}] 마디별, songKey 기준)에서 모두 다이아토닉인 4마디 창을 무작위로 고름(없으면 무작위로 대체).
   level 2: I 로 시작하는 무작위 다이아토닉 4코드(vii° 는 가끔). key 는 연주 키(0–11). degs 는 장음계 도수 0–6 */
function makeProgression({key=0,level=1,seed=1,songChords=null,songKey=0}={}){const R=rng(seed);let degs=null,source='random';
 const build=from=>{let prev=null;const chords=degs.map(d=>{const rootPc=(key+MAJ[d])%12,v=voiceTriad(rootPc,DEG_Q[d],prev);prev=v.notes;return {deg:d,label:DEG_L[d],root:rootPc,quality:DEG_Q[d],notes:v.notes,bass:v.bass}});return {degs,source,from,chords}};
 if(level<2&&songChords&&songChords.length>=4){const dg=songChords.map(c=>{const i=MAJ.indexOf(((c.root-songKey)%12+12)%12);return i>=0&&(DEG_Q[i]==='min')===!!c.minor&&DEG_Q[i]!=='dim'?i:-1});
  const ws=[];for(let i=0;i+4<=dg.length;i++)if(dg.slice(i,i+4).every(d=>d>=0))ws.push(i);
  if(ws.length){const w=ws[Math.floor(R()*ws.length)];degs=dg.slice(w,w+4);source='song';return build(w)}}
 degs=[0];while(degs.length<4){const d=R()<(level>1?.08:0)?6:1+Math.floor(R()*5);if(d!==degs[degs.length-1])degs.push(d)}
 return build(-1)}

/* 윗선율 추출. notes [시작박,길이박,midi,…]. 구간 [from,to) 박 안에서 시작하는 음만 쓰고, 같은 순간(eps 박)에 시작한 음 중 가장 높은 음을 고르며,
   이미 울리는 더 높은 음 밑에서 시작한 낮은 음은 무시하고 더 낮은 음이 울리던 중이면 그 음을 자른다. 같은 음이 이어지면 합치고 minBeats 미만은 버린다.
   중앙값이 [lo,hi] 중앙에 가깝도록 전체를 옥타브 이동한 뒤 음역 밖 음은 옥타브 접기. 시작은 from 을 0 으로 옮긴다. 반환 [시작박,길이박,midi] */
function topLine(notes,{from=0,to=Infinity,lo=52,hi=67,minBeats=.125,eps=.06}={}){
 const sel=notes.filter(n=>n[0]>=from-1e-6&&n[0]<to-1e-6).slice().sort((a,b)=>a[0]-b[0]),cl=[];
 for(const n of sel){const c=cl[cl.length-1];if(c&&n[0]-c.s<=eps){if(n[2]>c.p){c.p=n[2];c.d=n[1]}else if(n[2]===c.p&&n[1]>c.d)c.d=n[1]}else cl.push({s:n[0],d:n[1],p:n[2]})}
 const out=[];for(const c of cl){const q=out[out.length-1];if(q&&q.s+q.d>c.s+eps&&q.p>c.p)continue;if(q&&q.s+q.d>c.s)q.d=c.s-q.s;out.push({...c})}
 const mg=[];for(const c of out){const q=mg[mg.length-1];if(q&&q.p===c.p&&q.s+q.d>=c.s-eps)q.d=Math.max(q.d,c.s+c.d-q.s);else mg.push({...c})}
 const keep=mg.filter(c=>c.d>=minBeats-1e-9);if(!keep.length)return [];
 const ps=keep.map(c=>c.p).sort((a,b)=>a-b),med=ps[ps.length>>1],ctr=(lo+hi)/2,sh=Math.round((ctr-med)/12)*12;
 const fold=p=>{p+=sh;while(p>hi)p-=12;while(p<lo)p+=12;return p};
 return keep.map(c=>[Math.round((c.s-from)*1e4)/1e4,Math.round(Math.min(c.d,isFinite(to)?to-c.s:c.d)*1e4)/1e4,fold(c.p)])}

/* 진도 기록: stats {id:{n:총횟수,h:[최근 결과 0..1, 최대 cap개]}} 를 갱신해 돌려준다. lastAcc 는 최근 k회 평균(없으면 null) */
function recStat(stats,id,frac,cap=30){const s=stats&&typeof stats==='object'?stats:{},r=s[id]&&Array.isArray(s[id].h)?s[id]:{n:0,h:[]};
 const f=Math.max(0,Math.min(1,+frac||0));r.n=(r.n||0)+1;r.h=r.h.concat(f).slice(-cap);s[id]=r;return s}
function lastAcc(rec,k=10){const h=rec&&rec.h?rec.h.slice(-k):[];return h.length?h.reduce((a,x)=>a+x,0)/h.length:null}

const api={yin,tracker,makeExercise,scoreTake,smoothNotes,estimateLatency,earQuiz,makeProgression,topLine,recStat,lastAcc,NAMES,DEG_L};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SingLab=api})(typeof window!=='undefined'?window:globalThis);
