/* 시창·청음 연습 코어 (UI 없음). window.SingLab 으로 노출, node 에서는 module.exports.
   - yin: 단음 음높이 추정 (YIN, 누적 평균 정규화 차분 + 포물선 보간)
   - tracker: 마이크 스트림 → 20 ms 간격 [시각, midi(소수), 신뢰도] 기록
   - makeExercise: 키·음역 안에서 순차 진행 위주의 시창 멜로디 생성 (박 단위 [시작박, 길이박, midi])
   - scoreTake: 목표 음별로 ±50 cent 안에 든 유성 프레임 비율, 평균 cent 오차, 판정
   - estimateLatency: 스피커 클릭을 마이크로 다시 듣는 왕복 지연(ms) 추정
   - smoothNotes: pyin+평활 분할과 같은 방식으로 음높이 곡선을 음 목록으로 (2026-11-07 시험 F1 0.755 방식)
   - earQuiz: 키 안의 음정·3화음·7화음 성질·음계 도수(종지 뒤 한 음) 문제 생성
   - makeProgression: 4코드 진행 받아쓰기 문제(곡 코드 창 또는 무작위 다이아토닉) + 보이싱
   - topLine: 채보 음 목록에서 윗선율(단선율) 추출 → 음역에 맞춰 옥타브 이동
   - recStat·lastAcc: 진도 기록(항목별 최근 결과 배열) 갱신·최근 n회 정답률
   - 리듬: makeRhythm(박 단위 [{beat,dur,rest}])·rhythmToSlots/slotsToRhythm(박 칸 ↔ 리듬)·gradeRhythm(박별 정오)·scoreTaps(탭 시각 ↔ 목표, ms 편차)·tapStatItems
   - 적응형 청음: migrateStats·recItem(세부 통계 pr-stats2)·weakness(베타 평활+최근 가중)·pickWeighted·makeRoutine·makeSession(틀린 문제 2–4문제 뒤 재출제)·explain·summary
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

/* 마이크 → 음높이 기록. ctx 는 호출 쪽 AudioContext. stop() 은 트랙과 노드를 정리한다.
   opts.analyser: 공용 마이크가 만든 AnalyserNode 를 그대로 읽는다(스트림·노드는 호출 쪽 소유라 stop() 은 읽기만 멈춘다).
   opts.stream: 이미 열린 MediaStream 에서 노드만 새로 만든다(트랙은 끄지 않는다). 둘 다 없으면 예전처럼 직접 연다. */
async function tracker(ctx,onFrame,opts){opts=opts||{};let stream=null,src=null,an=opts.analyser||null,own=false;
 if(!an){if(opts.stream)stream=opts.stream;else{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});own=true}
  try{src=ctx.createMediaStreamSource(stream);an=ctx.createAnalyser();an.fftSize=2048;src.connect(an)}catch(e){if(own)stream.getTracks().forEach(t=>t.stop());throw e}}
 const buf=new Float32Array(an.fftSize),track=[];let on=true;
 const iv=setInterval(()=>{if(!on)return;an.getFloatTimeDomainData(buf);const r=yin(buf,ctx.sampleRate);const fr=[ctx.currentTime,r?r.midi:null,r?r.conf:0];track.push(fr);onFrame&&onFrame(fr)},20);
 return {track,stop(){on=false;clearInterval(iv);if(src)try{src.disconnect()}catch(_){}if(own)stream.getTracks().forEach(t=>t.stop())}}}

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
/* 청음 문제: type 'interval' | 'triad' | 'seventh' | 'degree'. level 1 은 키 안의 음만(7화음은 maj7·7·m7, 도수는 장음계 7음), 2 는 전부(7화음 5종, 도수 12음).
   dir: 'asc' 상행 | 'desc' 하행 | 'har' 동시 | 'mix' 섞기(음정만). name: 지정하면 그 음정/화음으로 고정. weight: id→가중치 함수(약점 위주). item 은 통계 id */
const SV_ALL=[['메이저7',[0,4,7,11]],['도미넌트7',[0,4,7,10]],['마이너7',[0,3,7,10]],['하프 디미니시',[0,3,6,10]],['디미니시7',[0,3,6,9]]];
function earQuiz({type='interval',key=0,level=1,seed=Date.now(),lo=55,hi=72,dir='asc',name=null,weight=null}={}){const R=rng(seed);
 if(type==='triad'){const all=[['메이저',[0,4,7]],['마이너',[0,3,7]],['디미니시',[0,3,6]],['오그먼트',[0,4,8]]],qs=all.slice(0,level<2?2:4);
  const fixed=name&&all.find(q=>q[0]===name),q=fixed||pickWeighted(qs,weight?qs.map(x=>weight('tr:'+x[0])):null,R),root=lo+Math.floor(R()*(hi-lo-8));
  return {type,answer:q[0],choices:qs.some(x=>x[0]===q[0])?qs.map(x=>x[0]):qs.map(x=>x[0]).concat(q[0]),notes:q[1].map(i=>root+i),label:NAMES[root%12],item:'tr:'+q[0]}}
 if(type==='seventh'){const qs=SV_ALL.slice(0,level<2?3:5),fixed=name&&SV_ALL.find(q=>q[0]===name),q=fixed||pickWeighted(qs,weight?qs.map(x=>weight('sv:'+x[0])):null,R),root=lo+Math.floor(R()*(hi-lo-11));
  return {type,answer:q[0],choices:qs.some(x=>x[0]===q[0])?qs.map(x=>x[0]):qs.map(x=>x[0]).concat(q[0]),notes:q[1].map(i=>root+i),label:NAMES[root%12],item:'sv:'+q[0]}}
 if(type==='degree'){const sems=level<2?MAJ:[0,1,2,3,4,5,6,7,8,9,10,11],fx=name?SOLF.indexOf(name):-1,sm=fx>=0?fx:pickWeighted(sems,weight?sems.map(x=>weight('dg:'+x)):null,R);
  let prev=null;const cad=[0,3,4,0].map(d=>{const v=voiceTriad((key+MAJ[d])%12,'maj',prev);prev=v.notes;return {notes:v.notes,bass:v.bass}}),t=60+(((key+sm-60)%12)+12)%12;
  return {type,answer:SOLF[sm],choices:sems.map(x=>SOLF[x]).concat(fx>=0&&!sems.includes(fx)?[SOLF[fx]]:[]),notes:[t],cad,label:NAMES[key%12]+' 메이저',item:'dg:'+sm}}
 const pool=level<2?INTERVALS.filter(([,s])=>MAJ.includes(s%12)||s===12):INTERVALS,dirs=dir==='mix'?DIRS:[dir==='desc'||dir==='har'?dir:'asc'];let nm,semi,dr;
 const fx=name&&INTERVALS.find(x=>x[0]===name);
 if(fx){[nm,semi]=fx;dr=dirs[Math.floor(R()*dirs.length)]}
 else{const items=[];for(const p of pool)for(const d of dirs)items.push([p[0],p[1],d]);const it=pickWeighted(items,weight?items.map(x=>weight('iv:'+x[0]+':'+x[2])):null,R);[nm,semi,dr]=it}
 let base;if(level<2){const deg=MAJ.filter(d=>MAJ.includes((d+semi)%12));const d=deg[Math.floor(R()*deg.length)]??0;base=lo+((key+d-lo)%12+12)%12}else base=lo+Math.floor(R()*(hi-lo-12));
 const ch=pool.map(p=>p[0]);if(!ch.includes(nm))ch.push(nm);
 return {type,answer:nm,choices:ch,notes:[base,base+semi],label:NAMES[base%12],dir:dr,item:'iv:'+nm+':'+dr}}

const DEG_L=['I','ii','iii','IV','V','vi','vii°'],DEG_Q=['maj','min','min','maj','maj','min','dim'],QIV={maj:[0,4,7],min:[0,3,7],dim:[0,3,6]};
/* 한 화음의 보이싱: 이전 화음과 가장 가깝게 이어지는 전위를 고른다. 베이스는 36–47 의 근음 */
function voiceTriad(rootPc,q,prev){let best=null;const pcs=QIV[q].map(i=>(rootPc+i)%12);
 for(let inv=0;inv<3;inv++){const rot=pcs.slice(inv).concat(pcs.slice(0,inv));let n=55;while(n%12!==rot[0])n++;const notes=[n];for(let k=1;k<3;k++){let m=notes[k-1]+1;while(m%12!==rot[k])m++;notes.push(m)}
  const cost=prev?notes.reduce((a,x,i)=>a+Math.abs(x-prev[i]),0):Math.abs(notes.reduce((a,x)=>a+x,0)/3-64);if(!best||cost<best.cost)best={cost,notes}}
 let b=36;while(b%12!==rootPc)b++;return {notes:best.notes,bass:b}}
/* 코드 진행 문제. level 1: songChords([{root,minor}] 마디별, songKey 기준)에서 모두 다이아토닉인 4마디 창을 무작위로 고름(없으면 무작위로 대체).
   level 2: I 로 시작하는 무작위 다이아토닉 4코드(vii° 는 가끔). key 는 연주 키(0–11). degs 는 장음계 도수 0–6 */
function makeProgression({key=0,level=1,seed=1,songChords=null,songKey=0,degs:fixed=null}={}){const R=rng(seed);let degs=null,source='random';
 const build=from=>{let prev=null;const chords=degs.map(d=>{const rootPc=(key+MAJ[d])%12,v=voiceTriad(rootPc,DEG_Q[d],prev);prev=v.notes;return {deg:d,label:DEG_L[d],root:rootPc,quality:DEG_Q[d],notes:v.notes,bass:v.bass}});return {degs,source,from,chords}};
 if(fixed&&fixed.length===4){degs=fixed.slice();return build(-1)}
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
function lastAcc(rec,k=10){const h=rec&&Array.isArray(rec.h)?rec.h.filter(x=>typeof x==='number'&&isFinite(x)).slice(-k):[];return h.length?h.reduce((a,x)=>a+x,0)/h.length:null}

/* ---------- 적응형 청음: 세부 통계(pr-stats2) · 약점 · 오늘의 연습 ----------
   stats2 = {v:2, items:{id:{n,h:[결과 0..1 (1=정답), 최근 60개]}}, conf:{id:{고른 답:횟수}}}
   id: iv:<음정>:<asc|desc|har> · tr:<3화음> · sv:<7화음 성질> · dg:<으뜸음 기준 반음 0–11 (음계 도수)> · pg:<로마숫자>:<칸 0–3> · md:d<으뜸음 기준 반음> · md:s<직전 음 대비 반음> · sg:d<반음> · sg:v:<hi|lo> · pm:동음:same · pm:<음정>:<asc|desc> · pm:화음:<3up|3down|5> (음정 부르기) · rh:<리듬 칸 종류> · rt:<탭 종류> · rt:<탭 종류>:<late|early> · all:<옛 항목>(옛 pr-stats 이관분) */
const DIRS=['asc','desc','har'],DIR_KO={asc:'상행',desc:'하행',har:'동시'},SOLF=['도','도#','레','레#','미','파','파#','솔','솔#','라','라#','시'];
const IV_ITEMS=[],TR_ITEMS=['메이저','마이너','디미니시','오그먼트'].map(n=>'tr:'+n),SV_ITEMS=SV_ALL.map(q=>'sv:'+q[0]),DG_ITEMS=SOLF.map((_,i)=>'dg:'+i);for(const [n] of INTERVALS)for(const d of DIRS)IV_ITEMS.push('iv:'+n+':'+d);
const KIND_OF={iv:'ear',tr:'ear',sv:'ear',dg:'ear',pg:'prog',md:'mel',sg:'sight',rh:'rhy',rt:'rhy',pm:'pitch'},KIND_LAB={ear:'음정·화음 듣기',prog:'코드 진행',mel:'멜로디 받아쓰기',rhy:'리듬',sight:'시창',pitch:'음정 부르기'};
const SPQ={ear:15,prog:45,mel:40,rhy:30,sight:40,pitch:30}; // 문제당 예상 초 (블록 최대 문제 수 = 시간/이 값)
const kindOf=id=>KIND_OF[String(id).split(':')[0]]||null;
const clamp01=x=>Math.max(0,Math.min(1,+x||0));
const newStats=()=>({v:2,items:{},conf:{}});
/* v2: 저장된 pr-stats2(없거나 깨졌으면 null), old: 옛 pr-stats {drill:{n,h}}. v2 가 유효하면 그것을 정리해 쓰고, 아니면 옛 기록을 all:<drill> 로 이관 */
function migrateStats(v2,old,cap=60){const s=newStats();
 if(v2&&typeof v2==='object'&&v2.v===2&&v2.items&&typeof v2.items==='object'){
  for(const id of Object.keys(v2.items)){const r=v2.items[id];if(r&&Array.isArray(r.h)){const h=r.h.filter(x=>typeof x==='number'&&isFinite(x)).map(clamp01).slice(-cap);s.items[id]={n:Math.max(h.length,+r.n|0),h}}}
  if(v2.conf&&typeof v2.conf==='object')for(const id of Object.keys(v2.conf)){const c=v2.conf[id];if(c&&typeof c==='object'){const o={};for(const k of Object.keys(c))if(isFinite(c[k])&&c[k]>0)o[k]=Math.floor(c[k]);if(Object.keys(o).length)s.conf[id]=o}}
  return s}
 if(old&&typeof old==='object')for(const k of Object.keys(old)){const r=old[k];if(r&&Array.isArray(r.h)){const h=r.h.filter(x=>typeof x==='number'&&isFinite(x)).map(clamp01).slice(-cap);if(h.length)s.items['all:'+k]={n:Math.max(h.length,+r.n|0),h}}}
 return s}
/* 한 문항 결과 기록. frac 1=정답. 틀렸고 chosen 이 있으면 혼동 쌍(정답 id → 고른 답) 횟수를 올린다. 혼동 종류는 id 당 12개까지 */
function recItem(st,id,frac,chosen,cap=60){const s=st&&st.v===2?st:newStats(),r=s.items[id]||(s.items[id]={n:0,h:[]}),f=clamp01(frac);
 r.n=(r.n||0)+1;r.h=r.h.concat(f).slice(-cap);
 if(f<1&&chosen!=null&&chosen!==''){const c=s.conf[id]||(s.conf[id]={});c[chosen]=(c[chosen]||0)+1;const ks=Object.keys(c);if(ks.length>12){ks.sort((a,b)=>c[a]-c[b]);delete c[ks[0]]}}
 return s}
/* 항목별 오답률 {id:{rate,n}}. 베타(a,b) 사전분포(기본 Beta(1,1)) + 최근일수록 무겁게(반감 half개 전): rate=(a+Σw·오답)/(a+b+Σw) */
function weakness(st,{half=15,a=1,b=1}={}){const out={};if(!st||!st.items)return out;
 for(const id of Object.keys(st.items)){const h=st.items[id]&&st.items[id].h;if(!Array.isArray(h)||!h.length)continue;let e=0,W=0;
  for(let k=0;k<h.length;k++){const w=Math.pow(.5,(h.length-1-k)/half);e+=w*(1-clamp01(h[k]));W+=w}
  out[id]={rate:(a+e)/(a+b+W),n:Math.max(h.length,+st.items[id].n|0)}}
 return out}
/* 가중치 추첨. weights 가 없거나 합이 0 이면 균등. rng() 는 [0,1) */
function pickWeighted(items,weights,rng){const n=items.length;if(!n)return undefined;const w=weights&&weights.length===n?weights.map(x=>x>0?x:0):null,tot=w?w.reduce((a,x)=>a+x,0):0;
 if(!(tot>0))return items[Math.min(n-1,Math.floor(rng()*n))];let r=rng()*tot;for(let i=0;i<n;i++){r-=w[i];if(r<0)return items[i]}return items[n-1]}
/* 추첨 가중치: 기록 없는 항목은 오답률 0.5. only 가 있으면 그 항목만 크게, focus 는 3배 */
function weightFor(wk,id,{only=null,focus=null}={}){const r=wk&&wk[id]?wk[id].rate:.5;let w=.03+r*r*r;if(only&&only.length)w*=only.includes(id)?4:.15;if(focus&&focus.includes(id))w*=3;return w}
const relPc=(p,key)=>((p-key)%12+12)%12;
/* 멜로디 한 줄의 통계 id 들. md 는 둘째 음부터 음 자리·진행(−12..12), sg 는 모든 음의 음 자리 */
function exItems(ex,key,pre){const out=[];ex.forEach((n,i)=>{if(pre==='md'){if(i>0){out.push('md:d'+relPc(n[2],key),'md:s'+Math.max(-12,Math.min(12,n[2]-ex[i-1][2])))}}else out.push('sg:d'+relPc(n[2],key))});return out}
/* only 에 3화음·7화음·도수 항목이 있을 때만 그 항목을 청음 후보에 더한다 */
const extraEar=only=>[['tr:',TR_ITEMS],['sv:',SV_ITEMS],['dg:',DG_ITEMS]].flatMap(([pf,a])=>only&&only.some(i=>i.startsWith(pf))?a:[]);
const sd=R=>Math.floor(R()*4294967294)+1;
function weakest(wk,pool,n,R){const seen=pool.filter(id=>wk[id]&&wk[id].n>=1).sort((x,y)=>wk[y].rate-wk[x].rate||wk[y].n-wk[x].n||(x<y?-1:1)).slice(0,n);
 const rest=pool.filter(id=>!seen.includes(id));while(seen.length<n&&rest.length)seen.push(rest.splice(Math.floor(R()*rest.length),1)[0]);return seen}
/* 블록 종류별 문제 한 개 생성(JSON 으로 저장 가능). ear: 음정·화음, prog: 코드 진행(후보 8개 중 약점 가중 추첨), mel/sight: 2마디 멜로디(후보 6개) */
function genQuestion(kind,{key=0,wk={},R,focus=null,only=null,lo=52,hi=67}={}){const W=id=>weightFor(wk,id,{only,focus});
 if(kind==='ear'){let pool=IV_ITEMS.concat(extraEar(only));if(only&&only.length){const o=pool.filter(i=>only.includes(i));if(o.length)pool=o}
  const item=pickWeighted(pool,pool.map(W),R),p=item.split(':');return item.startsWith('tr:')?{kind,type:'triad',name:p[1],item,seed:sd(R)}:item.startsWith('sv:')?{kind,type:'seventh',name:p[1],item,seed:sd(R)}:item.startsWith('dg:')?{kind,type:'degree',name:SOLF[+p[1]],item,seed:sd(R)}:{kind,type:'interval',name:p[1],dir:p[2],item,seed:sd(R)}}
 if(kind==='prog'){const c=[];for(let i=0;i<8;i++){const q=makeProgression({key,level:2,seed:sd(R)});c.push({degs:q.degs,items:q.degs.map((d,k)=>'pg:'+DEG_L[d]+':'+k)})}
  const x=pickWeighted(c,c.map(o=>o.items.reduce((a,id)=>a+W(id),0)/4),R);return {kind,degs:x.degs,items:x.items,seed:sd(R)}}
 if(kind==='rhy'){const hasRh=!!(only&&only.some(i=>i.startsWith('rh:'))),hasRt=!!(only&&only.some(i=>i.startsWith('rt:'))),m0=R()<.5?'dict':'tap',mode=hasRt&&!hasRh?'tap':hasRh&&!hasRt?'dict':m0, /* 약점 항목이 탭 종류(rt:)면 따라 치기, 칸 종류(rh:)면 받아쓰기로 낸다 */
   l2=!!(only&&only.some(i=>i.startsWith('rh:')&&RCELLS[i.slice(3)]&&RCELLS[i.slice(3)].lv===2||/^rt:(dot|syn|s16)/.test(i))),level=l2||R()<.4?2:1,c=[];
  for(let i=0;i<6;i++){const bars=level>1?2:(R()<.5?1:2),o={level,bars,seed:sd(R)},sl=makeRhythmSlots(o),
    items=mode==='dict'?sl.filter(x=>x!=='~').map(x=>'rh:'+x):[...new Set(rhythmOnsets(slotsToRhythm(sl),60).map(e=>'rt:'+e.cat))];c.push({o,items})}
  const x=pickWeighted(c,c.map(o=>o.items.reduce((a,id)=>a+W(id),0)/o.items.length),R);return {kind,mode,level,bars:x.o.bars,rseed:x.o.seed,items:x.items,seed:sd(R)}}
 if(kind==='pitch'){const po=only&&only.filter(i=>i.startsWith('pm:')),rg=[lo,hi];let q; /* 음정 부르기: 약점 id 가 있으면 그 항목만, 없으면 같은 음 1/3·음정 위/아래 2/3(약점 가중) */
  if(po&&po.length){const item=pickWeighted(po,po.map(W),R),[,iv,d]=item.split(':');q=iv===PM_HAR?pmQuestion({mode:'har',range:rg,seed:sd(R),key,hk:d}):d==='same'?pmQuestion({mode:'same',range:rg,seed:sd(R)}):pmQuestion({mode:'iv',range:rg,seed:sd(R),iv,dir:d})}
  else if(R()<.2)q=pmQuestion({mode:'har',range:rg,seed:sd(R),key,wk}); /* 화음 부르기는 약 20% */
  else{const m=R()<.34?'same':'iv';q=pmQuestion({mode:m,range:rg,seed:sd(R),wk})}
  return {kind,pq:q,items:[q.id],item:q.id,seed:sd(R)}}
 const pre=kind==='mel'?'md':'sg',c=[];for(let i=0;i<6;i++){const ex=makeExercise({key,bars:2,lo:pre==='md'?60:lo,hi:pre==='md'?72:hi,seed:sd(R),level:1});if(ex.length>=3)c.push({ex,items:exItems(ex,key,pre)})}
 if(!c.length)return {kind,ex:[],items:[],seed:1};const x=pickWeighted(c,c.map(o=>o.items.reduce((a,id)=>a+W(id),0)/o.items.length),R);return {kind,ex:x.ex,items:x.items,seed:sd(R)}}
/* 오늘의 연습 계획. minutes 를 음정 27·코드 27·멜로디 받아쓰기 18·리듬 10·시창 18% 로 나눈다(리듬 1분을 위해 나머지를 비례해 줄임). only(약점 항목 id 들)가 있으면 그 종류의 블록만 균등 분배.
   focus = 그 블록에서 가장 약한 항목(음정 블록은 약한 음정 3개) */
function makeRoutine(st,{minutes=10,seed=1,only=null,pm=false}={}){const wk=weakness(st),R=rng(seed),ids=only&&only.length?only:null;
 let kinds=['ear','prog','mel','rhy','sight'],sh={ear:.27,prog:.27,mel:.18,rhy:.1,sight:.18}; // pm(음정 부르기, 마이크)은 pm=true 일 때만 맨 뒤에 덧붙임(고정 90초·최대 4번, 기존 블록 시간·R 순서 불변). only 에 pm: id 가 있으면 항상 포함
 if(ids){kinds=kinds.concat('pitch').filter(k=>ids.some(i=>kindOf(i)===k));sh={};for(const k of kinds)sh[k]=1/kinds.length}else if(pm){kinds.push('pitch');sh.pitch=0}
 const pools={ear:IV_ITEMS.concat(extraEar(ids)),prog:[],mel:[],rhy:[],sight:[],pitch:[]};
 for(const id of Object.keys(wk)){const k=kindOf(id);if(k&&k!=='ear'&&pools[k]&&!id.startsWith('sg:v:')&&!/:(late|early)$/.test(id))pools[k].push(id)}
 return {minutes,seed,only:ids,blocks:kinds.map(k=>{const pt=k==='pitch',secs=pt?90:Math.round(minutes*60*sh[k]),ok=ids?ids.filter(i=>kindOf(i)===k):null;
  return {kind:k,label:KIND_LAB[k],secs,maxQ:pt?4:Math.max(2,Math.round(secs/SPQ[k])),focus:weakest(wk,k==='ear'?pools.ear:pools[k],3,R).filter(i=>wk[i]||k==='ear'),only:ok}})}}
/* 한 블록의 출제기. next() → 문제(없으면 null), answer(q,ok) → 틀리면 다른 문제 2–4개 뒤에 같은 문제를 다시(최대 2번 재출제). log 는 결과 기록 */
function makeSession(block,st,{seed=1,key=0,range=[52,67]}={}){const R=rng(seed),wk=weakness(st),log=[],pend=[];let asked=0;
 return {log,get asked(){return asked},get pending(){return pend.length},
  next(){if(asked>=block.maxQ)return null;const k=asked+1,i=pend.findIndex(p=>p.due<=k);let q;
   if(i>=0)q={...pend.splice(i,1)[0].q,retry:true};else q={...genQuestion(block.kind,{key,wk,R,focus:block.focus,only:block.only,lo:range[0],hi:range[1]}),retry:false,tries:0};
   q.idx=k;asked=k;return q},
  answer(q,ok,items){log.push({idx:q.idx,kind:q.kind,ok:!!ok,retry:!!q.retry,items:items||q.items||(q.item?[q.item]:[])});
   if(!ok&&(q.tries||0)<2){const gap=2+Math.floor(R()*3);pend.push({due:q.idx+gap+1,q:{...q,tries:(q.tries||0)+1}})}}}}
/* 한글 받침 판별 조사 */
const jong=w=>{const c=String(w).charCodeAt(String(w).length-1)-44032;return c>=0&&c<11172?(c%28===0?0:c%28===8?2:1):0};
const eul=w=>w+(jong(w)?'을':'를'),ro=w=>w+(jong(w)===1?'으로':'로');
const PM_SAME='동음',PM_HAR='화음',HK_LAB={'3up':'3도 위','3down':'3도 아래','5':'5도 위'},pmLab=(iv,d)=>iv===PM_HAR?`화음 부르기 ${HK_LAB[d]||d}`:d==='same'||iv===PM_SAME?'같은 음 내기':`${iv} ${d==='desc'?'아래로':'위로'} 부르기`;
const ivLab=(n,d)=>d==='har'?n+' 동시 화음':n+' '+DIR_KO[d],stepKo=s=>+s===0?'같은 음 반복':(s>0?'위로 ':'아래로 ')+Math.abs(s)+'반음 진행';
/* 항목 id 를 쉬운 한국어 문장으로. 혼동 쌍(conf)에서 가장 자주 고른 오답이 2번 이상이고 오답의 40% 이상이면 "자주 ~로 고릅니다" */
function explain(id,conf,rate){const p=String(id).split(':'),c=conf&&conf[id]||{},ks=Object.keys(c).sort((a,b)=>c[b]-c[a]),tot=ks.reduce((a,k)=>a+c[k],0),top=ks[0],often=top!=null&&c[top]>=2&&c[top]/tot>=.4,pct=rate!=null?` (오답률 ${Math.round(rate*100)}%)`:'';
 if(p[0]==='iv'){const l=ivLab(p[1],p[2]);return often?`${eul(l)} 자주 ${ro(top)} 고릅니다.`:`${l}의 정답률이 낮습니다${pct}.`}
 if(p[0]==='tr'){const l=p[1]+' 3화음';return often?`${eul(l)} 자주 ${ro(top)} 고릅니다.`:`${l} 정답률이 낮습니다${pct}.`}
 if(p[0]==='sv'){const l=p[1]+' 7화음';return often?`${eul(l)} 자주 ${ro(top)} 고릅니다.`:`${l} 정답률이 낮습니다${pct}.`}
 if(p[0]==='dg'){const n=SOLF[+p[1]];if(!n)return String(id);return often?`음계 도수 듣기에서 「${n}」${jong(n)?'을':'를'} 자주 「${top}」라고 고릅니다.`:`음계 도수 듣기에서 「${n}」 음의 정답률이 낮습니다${pct}.`}
 if(p[0]==='pg')return often?`${+p[2]+1}번째 코드가 「${p[1]}」일 때 자주 「${top}」라고 적습니다.`:`${+p[2]+1}번째 칸의 「${p[1]}」 정답률이 낮습니다${pct}.`;
 if(p[0]==='md'&&p[1][0]==='d'){const n=SOLF[+p[1].slice(1)];return often?`받아쓰기에서 「${n}」${jong(n)?'을':'를'} 자주 「${top}」라고 적습니다.`:`받아쓰기에서 「${n}」 음의 정답률이 낮습니다${pct}.`}
 if(p[0]==='md'){const s=+p[1].slice(1);return often?`받아쓰기에서 ${eul(stepKo(s))} 자주 「${stepKo(+top)}」이라고 듣습니다.`:`받아쓰기에서 ${stepKo(s)} 정답률이 낮습니다${pct}.`}
 if(p[0]==='sg'&&p[1]==='v')return p[2]==='hi'?`시창에서 목표보다 높게 부르는 경향이 있습니다${pct}.`:`시창에서 목표보다 낮게 부르는 경향이 있습니다${pct}.`;
 if(p[0]==='sg'){const n=SOLF[+p[1].slice(1)];return often?`시창에서 「${n}」${jong(n)?'을':'를'} 자주 ${top==='옥타브'?'옥타브 어긋나게':top+' '}부릅니다.`.replace('  ',' '):`시창에서 「${n}」 음이 자주 어긋납니다${pct}.`}
 if(p[0]==='pm'){const l=pmLab(p[1],p[2]);return often?(top==='옥타브'?`${l}에서 자주 옥타브가 어긋납니다.`:`${l}에서 자주 ${top} 부릅니다.`):`${l}가 자주 어긋납니다${pct}.`}
 if(p[0]==='rh'){const c=RCELLS[p[1]];if(!c)return String(id);return often?`리듬 받아쓰기에서 「${c.ko}」 칸을 자주 「${top}」${jong(top)===1?'으로':'로'} 적습니다.`:`리듬 받아쓰기에서 「${c.ko}」 정답률이 낮습니다${pct}.`}
 if(p[0]==='rt'){const l=RCAT_LAB[p[1]];if(!l)return String(id);if(p[2]==='late')return `${l}에서 늦게 칩니다${pct}.`;if(p[2]==='early')return `${l}에서 빠르게 칩니다${pct}.`;return `${l} 타이밍이 자주 어긋납니다${pct}.`}
 return String(id)}
/* 항목 id 의 짧은 이름 (집중 항목 표시용) */
function itemLabel(id){const p=String(id).split(':');
 if(p[0]==='iv')return ivLab(p[1],p[2]);if(p[0]==='tr')return p[1]+' 3화음';if(p[0]==='sv')return p[1]+' 7화음';if(p[0]==='dg')return SOLF[+p[1]]?`도수 「${SOLF[+p[1]]}」`:String(id);if(p[0]==='pg')return `${+p[2]+1}번째 칸 ${p[1]}`;
 if(p[0]==='md')return p[1][0]==='d'?`받아쓰기 「${SOLF[+p[1].slice(1)]}」`:`받아쓰기 ${stepKo(+p[1].slice(1))}`;
 if(p[0]==='sg')return p[1]==='v'?(p[2]==='hi'?'시창 높게 부름':'시창 낮게 부름'):`시창 「${SOLF[+p[1].slice(1)]}」`;
 if(p[0]==='pm')return pmLab(p[1],p[2]);
 if(p[0]==='rh')return RCELLS[p[1]]?`리듬 「${RCELLS[p[1]].ko}」`:String(id);
 if(p[0]==='rt')return RCAT_LAB[p[1]]?`${RCAT_LAB[p[1]]} 탭${p[2]==='late'?' 늦음':p[2]==='early'?' 빠름':''}`:String(id);return String(id)}
/* 약점 상위 n개: 기록 minN 이상, 오답률 rateMin 이상. within 이 있으면 그 id 만 */
function topWeak(st,{n=3,minN=2,rateMin=.4,within=null}={}){const wk=weakness(st);
 return Object.keys(wk).filter(id=>!id.startsWith('all:')&&wk[id].n>=minN&&wk[id].rate>=rateMin&&(!within||within.includes(id))).sort((x,y)=>wk[y].rate-wk[x].rate||wk[y].n-wk[x].n||(x<y?-1:1)).slice(0,n)
  .map(id=>({id,rate:wk[id].rate,n:wk[id].n,text:explain(id,st.conf,wk[id].rate)}))}
/* 연습 요약: log [{block,kind,label,ok,items}] → 블록별 정답률 + 이번에 다룬 항목 중 약점 상위 n */
function summary(st,log,{n=3}={}){const bl=[];for(const e of log){const b=bl[e.block]||(bl[e.block]={block:e.block,kind:e.kind,label:e.label||KIND_LAB[e.kind],n:0,ok:0});b.n++;if(e.ok)b.ok++}
 const blocks=bl.filter(Boolean).map(b=>({...b,acc:b.n?b.ok/b.n:null})),touched=new Set(log.flatMap(e=>e.items||[]));
 return {blocks,weak:topWeak(st,{n,within:[...touched]})}}

/* ---------- 리듬 받아쓰기·따라 치기 ----------
   박(4분음표) 단위 4/4. 한 칸 = 1박. 2박짜리 칸(2분음표·점4분+8분·당김음)은 첫 칸에 id, 다음 칸에 '~'(이어짐)를 둔다.
   칸 종류: [오프셋 박, 길이 박, 쉼 여부] 목록. 이벤트 {beat,dur,rest} 의 beat 는 곡 처음부터의 박. */
const RCELLS={
 q:{len:1,lv:1,g:'♩',ko:'4분음표',ev:[[0,1,0]],w:4},
 e2:{len:1,lv:1,g:'♪♪',ko:'8분음표 2개',ev:[[0,.5,0],[.5,.5,0]],w:3},
 r:{len:1,lv:1,g:'쉼',ko:'4분쉼표',ev:[[0,1,1]],w:1.2},
 re:{len:1,lv:1,g:'쉼♪',ko:'8분쉼+8분음표',ev:[[0,.5,1],[.5,.5,0]],w:1.2},
 er:{len:1,lv:1,g:'♪쉼',ko:'8분음표+8분쉼',ev:[[0,.5,0],[.5,.5,1]],w:1.2},
 h:{len:2,lv:1,g:'♩–',ko:'2분음표',ev:[[0,2,0]],w:1.5,at:[0,2]},
 hr:{len:2,lv:1,g:'쉼–',ko:'2분쉼표',ev:[[0,2,1]],w:.5,at:[0,2]},
 s4:{len:1,lv:2,g:'♬♬',ko:'16분음표 4개',ev:[[0,.25,0],[.25,.25,0],[.5,.25,0],[.75,.25,0]],w:1},
 es:{len:1,lv:2,g:'♪♬',ko:'8분+16분 2개',ev:[[0,.5,0],[.5,.25,0],[.75,.25,0]],w:1.2},
 se:{len:1,lv:2,g:'♬♪',ko:'16분 2개+8분',ev:[[0,.25,0],[.25,.25,0],[.5,.5,0]],w:1.2},
 ds:{len:1,lv:2,g:'♪.♬',ko:'점8분+16분',ev:[[0,.75,0],[.75,.25,0]],w:1},
 dq:{len:2,lv:2,g:'♩.♪',ko:'점4분+8분',ev:[[0,1.5,0],[1.5,.5,0]],w:1.5,at:[0,2]},
 sy:{len:2,lv:2,g:'♪♩♪',ko:'당김음(8분·4분·8분)',ev:[[0,.5,0],[.5,1,0],[1.5,.5,0]],w:2,at:[0,1,2]}};
const RC_ORDER=['q','e2','r','re','er','h','hr','s4','es','se','ds','dq','sy'];
const RCAT_LAB={beat:'정박',off:'엇박 8분음표',syn:'당김음',dot:'점음표',s16:'16분음표'};
const rr4=x=>Math.round(x*1e4)/1e4;
/* 슬롯 배열: bars*4 칸. null=빈 칸 */
function slotsToRhythm(slots){const out=[];for(let i=0;i<slots.length;i++){const id=slots[i];if(id==='~')continue;const c=RCELLS[id]||RCELLS.r;for(const [o,d,rest] of c.ev)out.push({beat:rr4(i+o),dur:d,rest:!!rest})}return out}
function rhythmToSlots(rhythm,bars){const ev=rhythm.slice().sort((a,b)=>a.beat-b.beat),n=bars?bars*4:Math.ceil(ev.reduce((a,e)=>Math.max(a,e.beat+e.dur),0)-1e-6),slots=new Array(n).fill(null);let k=0;
 const order=RC_ORDER.filter(id=>RCELLS[id].len===2).concat(RC_ORDER.filter(id=>RCELLS[id].len===1));
 for(let i=0;i<n;i++){if(slots[i]!=null)continue;let hit=null;
  for(const id of order){const c=RCELLS[id];if(i+c.len>n)continue;let ok=true;for(let j=0;j<c.ev.length;j++){const e=ev[k+j],x=c.ev[j];if(!e||Math.abs(e.beat-(i+x[0]))>1e-6||Math.abs(e.dur-x[1])>1e-6||!!e.rest!==!!x[2]){ok=false;break}}if(ok){hit=id;break}}
  if(!hit)return null;const c=RCELLS[hit];slots[i]=hit;for(let j=1;j<c.len;j++)slots[i+j]='~';k+=c.ev.length}
 return slots}
/* 무작위 리듬(칸 배열). level 1: 4분·8분·2분·쉼표, level 2: + 점음표·당김음·16분음표(적어도 하나 포함). 첫 박은 쉼표 아님 */
function makeRhythmSlots({level=1,bars=1,seed=1}={}){const R=rng(seed),n=bars*4,lv=level>=2?2:1;
 const gen=()=>{const sl=[];for(let i=0;i<n;i++){if(sl[i]!=null)continue;const pos=i%4,cand=RC_ORDER.filter(id=>{const c=RCELLS[id];if(c.lv>lv||pos+c.len>4)return false;if(c.at&&!c.at.includes(pos))return false;if(i===0&&c.ev[0][2])return false;
    if(c.ev[0][2]&&i>0&&(sl[i-1]==='r'||sl[i-1]==='hr'))return false;return true});
   const id=pickWeighted(cand,cand.map(x=>RCELLS[x].w),R);sl[i]=id;for(let j=1;j<RCELLS[id].len;j++)sl[i+j]='~'}return sl};
 let best=null;for(let t=0;t<40;t++){const sl=gen(),ids=sl.filter(x=>x!=='~'),sound=ids.reduce((a,id)=>a+RCELLS[id].ev.filter(e=>!e[2]).length,0),has2=ids.some(id=>RCELLS[id].lv===2);
  best=sl;if(sound>=2+bars&&(lv<2||has2))break}
 return best}
function makeRhythm(o){return slotsToRhythm(makeRhythmSlots(o))}
/* 한 이벤트의 종류: 16분음표 / 점음표 / 당김음(엇박에서 시작해 1박 이상 이어짐) / 엇박 / 정박 */
function rhythmCat(e){const fr=rr4(e.beat-Math.floor(e.beat+1e-9));if(Math.abs(e.dur-.25)<1e-6)return 's16';if(Math.abs(e.dur-1.5)<1e-6||Math.abs(e.dur-.75)<1e-6)return 'dot';
 if(fr>1e-6&&e.dur>=1-1e-6)return 'syn';if(fr>1e-6)return 'off';return 'beat'}
/* 소리 나는 이벤트의 목표 시각 [{t(ms),beat,dur,cat}] */
function rhythmOnsets(rhythm,bpm){const spb=60000/bpm;return rhythm.filter(e=>!e.rest).map(e=>({t:e.beat*spb,beat:e.beat,dur:e.dur,cat:rhythmCat(e)}))}
/* 박마다 서명: 그 박 안에서 시작하는 소리(오프셋/길이) + 앞에서 이어진 소리면 '~'. 쉼표는 서명에 안 들어가므로 4분쉼표 둘 = 2분쉼표 */
function rhythmSigs(rhythm,nBeats){const sig=[];for(let i=0;i<nBeats;i++){const on=rhythm.filter(e=>!e.rest&&e.beat>=i-1e-6&&e.beat<i+1-1e-6).map(e=>rr4(e.beat-i)+'/'+e.dur),
  tie=rhythm.some(e=>!e.rest&&e.beat<i-1e-6&&e.beat+e.dur>i+1e-6);sig.push((tie?'~':'')+on.join(','))}return sig}
/* 받아쓰기 채점: target·answer 는 칸 배열. 반환 ok[박별], cells[{i,id,ok,chosen}] (칸 시작 박만), correct/total/all */
function gradeRhythm(target,answer){const n=target.length,a=slotsToRhythm(answer.slice(0,n)),t=slotsToRhythm(target),sa=rhythmSigs(a,n),st=rhythmSigs(t,n),ok=st.map((x,i)=>x===sa[i]),cells=[];
 for(let i=0;i<n;i++){const id=target[i];if(id==='~')continue;const len=RCELLS[id].len,all=ok.slice(i,i+len).every(Boolean);cells.push({i,id,ok:all,chosen:answer[i]==null?null:answer[i]})}
 const correct=ok.filter(Boolean).length;return {ok,cells,correct,total:n,all:correct===n}}
/* 탭 채점. target: 목표 시각(ms) 숫자 또는 {t,cat} 배열, taps: 탭 시각(ms, 목표와 같은 기준) 배열. dev>0 = 늦음.
   가까운 탭을 순서대로 하나씩 짝지음(허용 창 = 인접 목표 간격의 60%, 60–400 ms). 점수 = 음별 점수 평균(오차가 tol 이하면 1, 2·tol 에서 0) · 남는 탭 감점 */
function scoreTaps(target,taps,{tolMs=50}={}){const T=target.map(x=>typeof x==='number'?{t:x}:x).slice().sort((a,b)=>a.t-b.t),P=taps.slice().sort((a,b)=>a-b),used=new Array(P.length).fill(false);
 const win=i=>{const g=[];if(i>0)g.push(T[i].t-T[i-1].t);if(i<T.length-1)g.push(T[i+1].t-T[i].t);return Math.min(400,g.length?Math.max(60,.6*Math.min(...g)):400)};
 const notes=T.map((x,i)=>{const w=win(i);let bj=-1,bd=Infinity;for(let j=0;j<P.length;j++){if(used[j])continue;const d=P[j]-x.t;if(Math.abs(d)<=w&&Math.abs(d)<Math.abs(bd)){bd=d;bj=j}}
  if(bj<0)return {...x,tap:null,dev:null,verdict:'놓침',credit:0};used[bj]=true;const ad=Math.abs(bd),credit=ad<=tolMs?1:Math.max(0,1-(ad-tolMs)/tolMs);
  return {...x,tap:P[bj],dev:Math.round(bd),verdict:ad<=tolMs?'정확':bd>0?'늦음':'빠름',credit}});
 const hit=notes.filter(x=>x.dev!=null),extra=used.filter(u=>!u).length,N=notes.length,sum=notes.reduce((a,x)=>a+x.credit,0);
 return {notes,matched:hit.length,missed:N-hit.length,extra,tolMs,
  meanAbs:hit.length?Math.round(hit.reduce((a,x)=>a+Math.abs(x.dev),0)/hit.length):null,meanSigned:hit.length?Math.round(hit.reduce((a,x)=>a+x.dev,0)/hit.length):null,
  score:N?Math.round(100*sum/(N+.5*extra)):0}}
/* 탭 결과 → 통계 [[id,frac,chosen]]: rt:<종류> = 음별 점수(놓침 0), rt:<종류>:late|early = 1 − (tol 밖으로 늦은|빠른 비율) (맞춘 음만) */
function tapStatItems(res){const by={};for(const x of res.notes){if(!x.cat)continue;(by[x.cat]||(by[x.cat]=[])).push(x)}const out=[];
 for(const c of Object.keys(by)){for(const x of by[c])out.push(['rt:'+c,x.credit]);const h=by[c].filter(x=>x.dev!=null);if(h.length){out.push(['rt:'+c+':late',1-h.filter(x=>x.verdict==='늦음').length/h.length],['rt:'+c+':early',1-h.filter(x=>x.verdict==='빠름').length/h.length])}}
 return out}

/* ---------- 음정 부르기 (pm) ----------
   모드 same: 기준음과 같은 음 내기(id pm:동음:same) · 모드 iv: 기준음에서 음정만큼 위/아래로 부르기(id pm:<음정>:<asc|desc>).
   기준음 [lo,hi] 안에서 목표 음도 같은 범위에 들게 고른다. wk(weakness 결과)가 있으면 약한 항목을 더 자주 낸다 */
/* ---------- 화음 부르기 (pm:화음:<3up|3down|5>) ----------
   앱의 키는 장조 으뜸음(0–11)뿐이라 단조는 나란한 장조로 본다. 음계 칸 idx(정수, 7칸=옥타브)의 MIDI = 으뜸음+옥타브*12+MAJ[idx%7].
   기준음 칸 r → 목표: 3up=r+2, 3down=r-2(음계 안의 3도라 칸마다 장3도·단3도가 갈림: I·IV·V 위 장3도, ii·iii·vi·vii 위 단3도), 5=r+4(vii 위만 감5도).
   반주(드론)는 기준음·목표가 둘 다 든 음계 3화음(I·IV·V 장, ii·iii·vi 단, vii 감). */
const QL=['','m','m','','','m','dim'],HK_D={'3up':2,'3down':-2,'5':4},HKS=['3up','3down','5'];
const scMidi=(key,idx)=>key+12*Math.floor(idx/7)+MAJ[((idx%7)+7)%7];
function pmDegOf(key,midi){const o=Math.floor((midi-key)/12),pc=((midi-key)%12+12)%12,d=MAJ.indexOf(pc);return d<0?null:o*7+d}
/* 기준음 midi(음계 안 음) → {deg,tdeg,target,semis} 또는 null(음계 밖·모르는 종류) */
function pmHarmTarget(key,ref,hk){const d=pmDegOf(key,ref),k=HK_D[hk];if(d==null||k==null)return null;const t=scMidi(key,d+k);return {deg:((d%7)+7)%7,tdeg:(((d+k)%7)+7)%7,target:t,semis:t-ref}}
/* 반주 3화음: 뿌리 칸 r0 → {rootDeg,midis(뿌리 위치로 쌓고 맨 위가 lo 이하가 되게 옥타브 내림),pcs,name,q} */
function pmChordOf(key,r0,lo){let m=[0,2,4].map(k=>scMidi(key,r0+k));while(m[2]>lo)m=m.map(x=>x-12);const dg=((r0%7)+7)%7;return {rootDeg:dg,midis:m,pcs:m.map(x=>((x%12)+12)%12),name:NAMES[((m[0]%12)+12)%12]+QL[dg],q:QL[dg]}}
function pmHarmQuestion({range,R,key,hk,wk}){const lo=range[0],hi=Math.max(range[0],range[1]);
 if(!HK_D[hk]){const W=wk?HKS.map(h=>weightFor(wk,'pm:'+PM_HAR+':'+h)):null;hk=pickWeighted(HKS,W,R)}
 const c=[];for(let m=lo;m<=hi;m++){const t=pmHarmTarget(key,m,hk);if(t&&t.target>=lo&&t.target<=hi)c.push([m,t])}
 if(!c.length)return null;const [ref,t]=c[Math.floor(R()*c.length)],d=pmDegOf(key,ref);
 /* 뿌리 칸: 3up 은 기준=뿌리 또는 3음, 3down 은 목표=뿌리 또는 3음, 5 는 기준=뿌리 → 기준·목표가 항상 반주 화음 안에 있다 */
 const r0=hk==='3up'?(R()<.5?d:d-2):hk==='3down'?(R()<.5?d-2:d-4):d,ch=pmChordOf(key,r0,lo);
 return {mode:'har',ref,target:t.target,iv:PM_HAR,dir:hk,hk,semis:t.semis,key,id:'pm:'+PM_HAR+':'+hk,chord:ch.midis,chordPcs:ch.pcs,chordName:ch.name,rootDeg:ch.rootDeg}}
/* 반주 새어듦 의심: 판정 중앙값이 목표가 아닌 반주 화음음(음이름 기준, 옥타브 무시) ±band cent 안이고 p10–p90 폭이 maxSpread(12) cent 이하(사람 목소리보다 훨씬 고른 소리)면 true. 실제 보컬 긴 음은 27% 가 20 cent 이하라 12 로 둔다(bench README §10).
   한계: 이어폰이 가장 확실한 해결이다. 합성음처럼 아주 고른 소리나 반주음(기준음 포함)을 그대로 따라 부른 경우도 같은 안내가 나온다. 목소리가 반주보다 훨씬 커 중앙값이 목소리를 따르면 검출되지 않는다. */
function pmLeak(res,q,{band=30,maxSpread=12}={}){if(!q||q.mode!=='har'||!res||res.medCents==null||res.spread==null||res.spread>maxSpread)return false;
 const m=q.target+res.medCents/100,tp=((q.target%12)+12)%12;return (q.chordPcs||[]).some(pc=>pc!==tp&&Math.abs((((m-pc)%12)+18)%12-6)*100<=band)}
/* 문제 종류별 판정: 화음 부르기는 반주 새어듦 의심 시 verdict '반주 소리 의심'(leak:true, 기록 안 함) */
function pmJudgeQ(track,q,o={}){const r=pmJudge(track,{target:q.target,...o});return pmLeak(r,q)?{...r,leak:true,ok:false,verdict:'반주 소리 의심'}:r}
function pmQuestion({mode='same',range=[52,67],seed=1,iv=null,dir=null,wk=null,key=0,hk=null}={}){const R=rng(seed),lo=range[0],hi=Math.max(range[0],range[1]);
 if(mode==='har'){const h=pmHarmQuestion({range,R,key,hk,wk});if(h)return h}
 if(mode!=='iv'){const ref=lo+Math.floor(R()*(hi-lo+1));return {mode:'same',ref,target:ref,iv:PM_SAME,dir:'same',semis:0,id:'pm:'+PM_SAME+':same'}}
 let c=[];for(const [n,s] of INTERVALS)for(const d of ['asc','desc'])if((!iv||n===iv)&&(!dir||d===dir)&&hi-lo>=s)c.push([n,s,d]);
 if(!c.length)c=[['완전5도',7,'asc']];const W=wk?c.map(x=>weightFor(wk,'pm:'+x[0]+':'+x[2])):null,[n,s,d]=pickWeighted(c,W,R);
 const a=d==='asc'?lo:lo+s,b=d==='asc'?hi-s:hi,ref=a+Math.floor(R()*(Math.max(a,b)-a+1));
 return {mode:'iv',ref,target:ref+(d==='asc'?s:-s),iv:n,dir:d,semis:s,id:'pm:'+n+':'+d}}
/* 기록 [초,midi|null,conf] → 판정. 첫 발성(t0 이후 연속 run 프레임 이상 유성)의 skip 초 뒤부터 win 초 창에서 cent 중앙값을 낸다.
   창 안 유성 프레임이 8개 미만·60% 미만이거나 기록이 창 끝 전에 끝났거나 p10–p90 폭이 spread cent 초과면 '불안정'(기록 안 함). 옥타브 차이는 scoreTake 와 같은 기준(±1200±2·tol). */
function pmJudge(track,{target,t0=0,tol=50,minConf=.5,skip=.15,win=.6,run=3,spread=160}={}){const vo=f=>f[1]!=null&&f[2]>=minConf,tr=track.filter(f=>f[0]>=t0);let on=-1,n=0;
 for(let i=0;i<tr.length;i++){if(vo(tr[i])){if(++n>=run){on=i-run+1;break}}else n=0}
 const base={target,onset:null,frames:0,voiced:0,medCents:null,devCents:null,spread:null,octave:false,ok:false};if(on<0)return {...base,verdict:'소리 없음'};
 const a=tr[on][0]+skip,b=a+win,fr=tr.filter(f=>f[0]>=a&&f[0]<=b),v=fr.filter(vo),r={...base,onset:tr[on][0]-t0,frames:fr.length,voiced:v.length};
 if(v.length<8||v.length/fr.length<.6||tr[tr.length-1][0]<b-.05)return {...r,verdict:'불안정'};
 const c=v.map(f=>(f[1]-target)*100).sort((x,y)=>x-y),med=c[c.length>>1],sp=c[Math.floor(.9*(c.length-1))]-c[Math.floor(.1*(c.length-1))];
 if(sp>spread)return {...r,medCents:med,spread:sp,verdict:'불안정'};
 const oct=Math.abs(Math.abs(med)-1200)<tol*2,dev=oct?med-Math.sign(med)*1200:med,ok=!oct&&Math.abs(med)<=tol;
 return {...r,medCents:med,devCents:dev,spread:sp,octave:oct,ok,verdict:oct?'옥타브 차이':ok?'맞음':med>0?'높음':'낮음'}}
/* 판정 → 통계 [[id,frac,chosen]]. 소리 없음·불안정은 기록하지 않는다([]) */
function pmStatItems(q,res){if(!q||!res||res.medCents==null||res.leak||res.verdict==='불안정'||res.verdict==='소리 없음')return [];
 return [[q.id,res.ok?1:0,res.ok?null:res.octave?'옥타브':res.verdict==='높음'?'높게':'낮게']]}

const api={yin,tracker,makeExercise,scoreTake,pmQuestion,pmJudge,pmJudgeQ,pmLeak,pmHarmTarget,pmChordOf,pmDegOf,scMidi,HK_LAB,pmStatItems,INTERVALS,kindOf,smoothNotes,estimateLatency,earQuiz,makeProgression,topLine,recStat,lastAcc,newStats,migrateStats,recItem,weakness,pickWeighted,weightFor,makeRoutine,makeSession,genQuestion,explain,itemLabel,topWeak,summary,exItems,RCELLS,RC_ORDER,RCAT_LAB,makeRhythmSlots,makeRhythm,rhythmToSlots,slotsToRhythm,rhythmCat,rhythmOnsets,rhythmSigs,gradeRhythm,scoreTaps,tapStatItems,NAMES,DEG_L,SOLF,DIR_KO,IV_ITEMS,SV_ITEMS,DG_ITEMS,KIND_LAB,rng};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SingLab=api})(typeof window!=='undefined'?window:globalThis);
