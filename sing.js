/* 시창·청음 연습 코어 (UI 없음). window.SingLab 으로 노출, node 에서는 module.exports.
   - yin: 단음 음높이 추정 (YIN, 누적 평균 정규화 차분 + 포물선 보간)
   - tracker: 마이크 스트림 → 20 ms 간격 [시각, midi(소수), 신뢰도] 기록
   - makeExercise: 키·음역 안에서 순차 진행 위주의 시창 멜로디 생성 (박 단위 [시작박, 길이박, midi])
   - scoreTake: 목표 음별로 ±tol(기본 50) cent 안에 든 유성 프레임 비율, 평균 cent 오차, 판정 + 3단계(맞음·가까움·벗어남) + 시작 음 편차·끝 음 드리프트
   - voicedMask·octaveGuard·suppressOctave: 유성 판정(연속성)과 옥타브 점프 억제(순수). TOL_LEVELS·tolTier: 허용폭 단계
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
/* 철자(장조 기준). 조 이름은 조표와 같게(Db·Eb·F#·Ab·Bb: A#·D#·G# 장조는 겹올림표 조라 쓰지 않음). 조 안 음은 그 장음계 글자대로(F# 장조의 E# 등).
   조 밖 검은 건반 — 선율 음: ♯1·♭3·♯4·♯5·♭7(SOLF·오선보와 같음) / 코드 근음: 로마 숫자 ♭II·♭III·♯IV·♭VI·♭VII, 마이너·dim 근음은 ♯i·♯ii·♯v(♭vii 만 플랫). 조 밖 흰 건반은 제자리.
   슬래시 베이스는 근음에서 센 음정 글자로(D/F#, E/G#: 코드 구성음 철자). 저장 문자열(코드 분석·편집)은 그대로 샤프 표기이고 화면·악보 파일 표시만 이 철자를 쓴다 */
const KEYN=['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'],NFL=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'],LET='CDEFGAB',LPC=[0,2,4,5,7,9,11],pcm=x=>((x%12)+12)%12,accS=a=>a>0?'#'.repeat(a):'b'.repeat(-a);
const CH_FL={1:1,3:1,8:1,10:1},CH_MN={10:1},NT_FL={3:1,10:1},IVL={1:1,2:1,3:2,4:2,5:3,6:4,7:4,8:5,9:5,10:6,11:6};
const RM={0:'I',1:['♭II','♯I'],2:'II',3:['♭III','♯II'],4:'III',5:'IV',6:'♯IV',7:'V',8:['♭VI','♯V'],9:'VI',10:'♭VII',11:'VII'},RQ={'':'',m:'','7':'7',maj7:'maj7',m7:'7',sus4:'sus4',sus2:'sus2',dim:'°'};
function scaleNames(key){const k=pcm(key),l0=LET.indexOf(KEYN[k][0]);return MAJ.map((iv,i)=>{const l=(l0+i)%7;return LET[l]+accS(((pcm(k+iv)-LPC[l]+18)%12)-6)})}
/* pc 의 이름(조 key 기준). o.chord: 코드 근음 규칙, o.minor: 마이너·dim 계열 코드 */
function pcName(pc,key=0,o){const p=pcm(pc),r=pcm(p-key),d=MAJ.indexOf(r);if(d>=0)return scaleNames(key)[d];if(NAMES[p].length===1)return NAMES[p];
 return (o&&o.chord?(o.minor?CH_MN[r]:CH_FL[r]):NT_FL[r])?NFL[p]:NAMES[p]}
const nameStep=n=>{const l=LET.indexOf(n[0]),a=[...n.slice(1)].reduce((s,c)=>s+(c==='#'?1:c==='b'?-1:0),0);return {l,a,pc:pcm(LPC[l]+a)}};
/* 슬래시 베이스 이름: 근음 이름에서 음정만큼 글자를 세어 철자(겹임시표가 되면 조 기준 음 이름) */
function bassName(rootName,bassPc,key=0){const r=nameStep(rootName),i=pcm(bassPc-r.pc),l=(r.l+(IVL[i]||0))%7,a=((pcm(bassPc)-LPC[l]+18)%12)-6;return i&&Math.abs(a)<=1?LET[l]+accS(a):pcName(bassPc,key)}
const isMinQ=q=>q==='m'||q==='m7'||q==='dim';
/* {root,q,bass} → 표시 이름(예: Bb, D/F#, C#m7/G#) */
function chordLabel(c,key=0){const rn=pcName(c.root,key,{chord:1,minor:isMinQ(c.q)});return rn+(c.q||'')+(c.bass!=null?'/'+bassName(rn,c.bass,key):'')}
/* 로마 숫자(장조 key 기준). 마이너·dim 은 소문자, m7·7 은 7, dim 은 °. 슬래시 베이스는 베이스의 음계 도수(철자 기준: D/F# → /♯4) */
function romanOf(c,key=0){const r0=RM[pcm(c.root-key)],mn=isMinQ(c.q);let r=Array.isArray(r0)?r0[mn?1:0]:r0;if(mn)r=r.replace(/[IV]+/,x=>x.toLowerCase());r+=RQ[c.q||'']||'';
 if(c.bass!=null){const t=nameStep(KEYN[pcm(key)]),b=nameStep(bassName(pcName(c.root,key,{chord:1,minor:mn}),c.bass,key)),d=(b.l-t.l+7)%7,a=((b.pc-pcm(key+MAJ[d]))+18)%12-6;r+='/'+(Math.abs(a)>1?BF[pcm(c.bass-key)]:(a>0?'♯':a<0?'♭':'')+(d+1))}return r}
const BF=['1','♭2','2','♭3','3','4','♯4','5','♯5','6','♭7','7']; /* 먼 조에서 겹임시표 도수가 나올 때만 쓰는 대체(선율 음 철자와 같음) */
const noteNmK=(m,key=0)=>pcName(m,key)+(Math.floor(m/12)-1);

/* YIN. 차분 함수를 lag 순서로 한 칸씩 계산하면서 문턱 아래 골을 찾으면 골 바닥+다음 lag 까지만 계산하고 멈춘다(조기 종료).
   결과는 전 lag 를 계산하던 예전 구현과 비트 단위로 같다(d·c 를 Float32 로 저장하는 것까지 동일). */
const _yb={d:null,c:null};
function yin(buf,sr,fmin=70,fmax=1100,thr=.12){const n=buf.length,maxL=Math.min(Math.floor(sr/fmin),n>>1),minL=Math.max(2,Math.floor(sr/fmax));
 let rms=0;for(let i=0;i<n;i++)rms+=buf[i]*buf[i];rms=Math.sqrt(rms/n);if(rms<.008)return null;
 if(!_yb.d||_yb.d.length<maxL+2){_yb.d=new Float32Array(maxL+2);_yb.c=new Float32Array(maxL+2)}
 const d=_yb.d,c=_yb.c,W=n-maxL;c[0]=1;let run=0,tau=-1,hi=0,L=1;
 const cl=L=>{let s=0,i=0;const B=buf;for(;i<W-3;i+=4){const x0=B[i]-B[i+L],x1=B[i+1]-B[i+L+1],x2=B[i+2]-B[i+L+2],x3=B[i+3]-B[i+L+3];s+=x0*x0;s+=x1*x1;s+=x2*x2;s+=x3*x3}for(;i<W;i++){const x=B[i]-B[i+L];s+=x*x}d[L]=s;run+=d[L];c[L]=run?d[L]*L/run:1;hi=L};
 for(;L<=maxL;L++){cl(L);if(L>=minL&&c[L]<thr){let T=L;while(T+1<=maxL){cl(T+1);if(c[T+1]<c[T])T++;else break}tau=T;break}}
 if(tau<0)return null;const a=c[tau-1]??c[tau],b=c[tau],e=tau+1<=hi?c[tau+1]:c[tau],den=a-2*b+e;const t=den?tau+.5*(a-e)/den:tau;
 const f=sr/t;return {f,midi:69+12*Math.log2(f/440),conf:1-b,rms}}

/* 부하 조절(순수). 분석 한 번의 소요 시간 EMA 를 기본 hop 에 견준 부하 u=ema/hop 로 건너뛰기 배수 k(1·2·3)를 정한다.
   u>0.35 → 2, u>0.70 → 3. 되돌아올 때는 히스테리시스(k=2→1: u<0.25, k=3→2: u<0.55). 표본 8개 전에는 바꾸지 않는다.
   take() 는 도착한 프레임을 분석할지 알린다(마지막 분석 뒤 k 프레임이 지났을 때). 타임스탬프는 분석한 프레임의 것을 그대로 쓰므로 정확하다. */
const LOAD={budget:.35,budget3:.70,down2:.25,down3:.55,alpha:.1,minN:8};
function loadCtl(hopMs,o){o={...LOAD,...(o||{})};let ema=null,n=0,k=1,since=1e9;
 const upd=()=>{const u=ema/hopMs;if(k<2&&u>o.budget)k=2;if(k<3&&u>o.budget3)k=3;if(k===3&&u<o.down3)k=2;if(k===2&&u<o.down2)k=1};
 return {get k(){return k},get ema(){return ema},get load(){return ema==null?0:ema/hopMs},get hopMs(){return hopMs},
  take(){if(++since>=k){since=0;return true}return false},
  record(ms){if(!(ms>=0))return k;ema=ema==null?ms:ema+o.alpha*(ms-ema);if(++n>=o.minN)upd();return k}}}


/* 유성 판정(순수). yin 은 c[tau]<0.12 일 때만 값을 내므로 conf=1−c[tau] 는 항상 0.88 초과라 conf 문턱(예전 minConf .5·.6)은 아무것도 거르지 않았다.
   그래서 유성 여부는 "연속성"으로 정한다: 값이 있는 프레임이 이웃 유성 프레임과 ±cent(100) 안으로 이어진 묶음이 minRun(3)프레임 이상일 때만 유성.
   숨소리·배경 소리의 홀로 튀는 프레임과 옥타브 튐 프레임은 묶음이 짧아 빠진다. minConf 는 YIN 이 아닌 다른 신뢰도 출처(합성 곡선 등)용 안전 문턱으로만 남긴다(YIN 곡선에는 영향 없음). 반환: 프레임별 boolean 배열 */
function voicedMask(track,{cent=100,minRun=3,minConf=.5}={}){const T=track||[],n=T.length;const W=frameW(T),m=new Array(n).fill(false),vo=f=>!!f&&f[1]!=null&&f[2]>=minConf;let i=0;
 while(i<n){if(!vo(T[i])){i++;continue}let j=i;while(j+1<n&&vo(T[j+1])&&Math.abs(T[j+1][1]-T[j][1])*100<=cent)j++;if(wr(W,i,j)>=minRun-1e-9)for(let k=i;k<=j;k++)m[k]=true;i=j+1}
 return m}
/* 옥타브 점프 억제(스트리밍). 직전 유성 프레임 n(5)개 중앙값에서 ±1200±band(80) cent 떨어진 프레임은 의심: 이웃과 ±1 반음 안으로 persist(4)프레임 이상 이어질 때만 인정한다.
   그동안 의심 프레임은 fr[1]=null·fr[2]=0 으로 두고(화면·채점에서 무음), 인정되면 같은 배열 객체를 되살린다. step(fr) 은 fr 을 제자리에서 고친다. 사람 소리는 순간 옥타브 이동이 드물다는 설계 가정(값은 벤치로 확인) */
function octaveGuard({n=5,band=80,persist=4,minHist=3}={}){const hist=[];let pend=[];const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s[s.length>>1]};
 return function step(fr){const m=fr[1];if(m==null){pend=[];return fr}
  if(hist.length>=minHist){const d=Math.abs(m-med(hist))*100;
   if(Math.abs(d-1200)<=band){if(pend.length&&Math.abs(m-pend[pend.length-1].m)>1)pend=[];pend.push({fr,m,c:fr[2]});fr[1]=null;fr[2]=0;
    if(pend.length>=persist){for(const p of pend){p.fr[1]=p.m;p.fr[2]=p.c}hist.length=0;for(const p of pend.slice(-n))hist.push(p.m);pend=[]}return fr}}
  pend=[];hist.push(m);if(hist.length>n)hist.shift();return fr}}
/* 기록 전체에 octaveGuard 를 적용한 복사본(순수) */
function suppressOctave(track,o){const g=octaveGuard(o),out=(track||[]).map(f=>f.slice());for(const f of out)g(f);return out}
/* 음 허용폭 단계: 쉬움 ±50(기본·예전 값) / 보통 ±35 / 어려움 ±25 cent. 기본을 50 으로 둔 이유: 기존 판정·벤치 보정이 50 기준이라 조용히 엄해지지 않게. normTol 은 저장값 검증 */
const TOL_LEVELS=[['쉬움',50],['보통',35],['어려움',25]],TOL_DEFAULT=50;
const normTol=v=>{v=+v;return TOL_LEVELS.some(x=>x[1]===v)?v:TOL_DEFAULT};
/* 3단계: |편차| ≤tol 맞음, ≤2·tol 가까움, 그 밖 벗어남. 편차 없음(null)은 null */
function tolTier(dev,tol=TOL_DEFAULT){if(dev==null||!isFinite(dev))return null;const a=Math.abs(dev);return a<=tol?'맞음':a<=2*tol?'가까움':'벗어남'}

/* 낮은 음 모드(기본 꺼짐): yin 하한 55 Hz + 분석 창 4096샘플(48 kHz 약 85 ms, 반응은 느려진다). 표준 모드는 하한 70 Hz·2048 그대로.
   창은 표본 수 기준이라 샘플레이트가 높으면 같은 길이(약 85 ms)가 되도록 2의 거듭제곱으로 키운다 */
const LOW={fmin:55,win:4096};
const lowWin=sr=>{let w=LOW.win;while(w<.085*(sr||48000)&&w<32768)w*=2;return w};
/* 73 Hz(D2, MIDI 38) 미만 음이 반복 잡히거나, 잰 가장 낮은 안정 음이 그 바닥(≤D2)이면 낮은 음 모드를 권한다(순수) */
const LOW_FLOOR=38;
function lowModeAdvice(track,lowMidi,{minFrames=5}={}){const T=track||[],W=frameW(T);let n=0;for(let i=0;i<T.length;i++){const f=T[i];if(f&&f[1]!=null&&f[1]<LOW_FLOOR-.5)n+=W[i]}return n>=minFrames-1e-9||(lowMidi!=null&&lowMidi<=LOW_FLOOR)}
/* ---- 균일 프레임(AudioWorklet) 보조: 순수 함수 ----
   hopFor(sr): 약 11 ms 를 128 샘플(렌더 양자) 배수로 맞춘 hop(48 kHz → 512 = 10.7 ms).
   frameCentre(end,win,sr): 창 끝 표본 번호 → 창 중심 시각(초, 오디오 시계). 예전 경로는 폴링 시각(≈창 끝)을 썼다.
   workletAllowed(env): AudioWorklet 가능 + iOS 17 미만(WebKit 251091: getUserMedia 직후 worklet 왜곡 보고)·판독 불가 iOS 는 예전 경로. env={hasWorklet,ua,platform,touch,force} */
const hopFor=sr=>Math.max(128,128*Math.round(.011*(sr||48000)/128));
const frameCentre=(end,win,sr)=>(end-win/2)/sr;
function iosVersion(ua,platform,touch){ua=String(ua||'');const ios=/iPhone|iPad|iPod/.test(ua)||(platform==='MacIntel'&&touch>1);if(!ios)return null;const m=/OS (\d+)[_.](\d+)/.exec(ua)||/Version\/(\d+)\.(\d+)/.exec(ua);return m?+m[1]+ +m[2]/100:0}
function workletAllowed(e){e=e||{};if(e.force==='analyser')return {ok:false,why:'forced'};if(!e.hasWorklet)return {ok:false,why:'no-worklet'};const v=iosVersion(e.ua,e.platform,e.touch);if(v!==null&&v<17)return {ok:false,why:'ios<17'};return {ok:true,why:v===null?'ok':'ios17+'}}
/* 기록 간격에 맞춰 프레임 수 기준 값을 늘리는 배율: 예전 20 ms 간격=1, 10.7 ms 간격≈1.9. 간격이 16 ms 이상이면 1 */
function frameScale(track){const T=track||[],d=[];for(let i=1;i<T.length&&d.length<40;i++){const x=T[i][0]-T[i-1][0];if(x>0)d.push(x)}if(d.length<3)return 1;d.sort((a,b)=>a-b);const m=d[d.length>>1];return m<.016?Math.round(.02/m*100)/100:1}
/* 프레임별 가중치(순수): 20 ms 기준 프레임 1개 = 1.0. 가중치 = 1/지역 배율, 지역 배율은 그 프레임 둘레 ±FW_HALF 간격의 중앙값으로 frameScale 과 같은 식으로 낸다.
   분석 주기가 한 기록 안에서 바뀌어도(부하 조절 10.7→21→32 ms) 프레임 수 대신 가중치 합(≈ 20 ms 환산 프레임 수)으로 길이 문턱을 비교한다. 균일한 기록에서는 frameScale 과 같은 결과. */
const FW_HALF=8;
function frameW(track){const T=track||[],n=T.length,w=new Array(n).fill(1);if(n<2)return w;const g=new Array(n).fill(0);for(let i=1;i<n;i++)g[i]=T[i][0]-T[i-1][0];
 for(let i=0;i<n;i++){const d=[];for(let k=Math.max(1,i-FW_HALF);k<=Math.min(n-1,i+FW_HALF);k++)if(g[k]>0)d.push(g[k]);if(d.length<3)continue;d.sort((a,b)=>a-b);const m=d[d.length>>1];if(m<.016)w[i]=1/(Math.round(.02/m*100)/100)}
 return w}
const wsum2=(tr,v)=>{const W=frameW(tr),M=new Map(tr.map((f,i)=>[f,W[i]]));let t=0;for(const f of v)t+=M.get(f);return t};
const wr=(w,i,j)=>{let t=0;for(let k=i;k<=j;k++)t+=w[k];return t};
const _now=()=>typeof performance!=='undefined'?performance.now():Date.now();
const _wl=new WeakMap();
function loadWorklet(ctx,url){if(!_wl.has(ctx))_wl.set(ctx,ctx.audioWorklet.addModule(url).catch(e=>{_wl.delete(ctx);throw e}));return _wl.get(ctx)}
const envNow=()=>{const n=typeof navigator!=='undefined'?navigator:{};let force=null;try{force=localStorage.getItem('pr-pitchpath')}catch(_){}return {ua:n.userAgent,platform:n.platform,touch:n.maxTouchPoints,force}};
/* 마이크 → 음높이 기록. ctx 는 호출 쪽 AudioContext. stop() 은 트랙과 노드를 정리한다.
   opts.analyser: 공용 마이크가 만든 AnalyserNode 를 그대로 읽는다(스트림·노드는 호출 쪽 소유라 stop() 은 읽기만 멈춘다).
   opts.stream: 이미 열린 MediaStream 에서 노드만 새로 만든다(트랙은 끄지 않는다). 둘 다 없으면 예전처럼 직접 연다.
   opts.workletUrl + opts.source(공용 MediaStreamSource): AudioWorklet 경로. 불가·실패·1초 무응답이면 예전 AnalyserNode 20 ms 폴링으로 돌아간다.
   반환 info={path:'worklet'|'analyser',hopMs,text}; opts.onInfo(info) 로 경로가 정해질 때 알린다. */
async function tracker(ctx,onFrame,opts){opts=opts||{};let stream=null,src=null,an=opts.analyser||null,own=false;
 if(!an){if(opts.stream)stream=opts.stream;else{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});own=true}
  try{src=ctx.createMediaStreamSource(stream);an=ctx.createAnalyser();an.fftSize=opts.low?lowWin(ctx.sampleRate):2048;src.connect(an)}catch(e){if(own)stream.getTracks().forEach(t=>t.stop());throw e}}
 const sr=ctx.sampleRate,low=!!opts.low,win=an.fftSize,track=[],info={path:'analyser',hopMs:20,text:'분석: 기본(20 ms)'};let on=true,iv=0,node=null,zero=null,wd=0,ctl=null,wlHop=0; /* ctl·wlHop 은 트래커마다 따로(검수 #14: 선언 없이 전역으로 새던 것) */
 const mkGuard=()=>{if(opts.octave===false)return null;const k=.02/(info.hopMs/1e3);return k>1.2?octaveGuard({n:Math.round(5*k),persist:Math.round(4*k),minHist:Math.round(3*k)}):octaveGuard()};
 let guard=mkGuard(); /* 옥타브 점프는 octaveGuard 로 화면·채점 기록에서 미리 거른다(4프레임=80 ms 지속 시 인정; 균일 프레임 경로는 같은 시간으로 환산) */
 const emit=fr=>{if(guard)guard(fr);track.push(fr);onFrame&&onFrame(fr)};
 const setInfo=(p,hop)=>{info.path=p;info.hopMs=hop;info.text=p==='worklet'?`분석: 오디오 워클릿 ${hop.toFixed(1)} ms 간격${ctl&&ctl.k>1?'(부하 조절)':''}`:'분석: 기본(20 ms)';guard=mkGuard();if(opts.onInfo)try{opts.onInfo(info)}catch(_){}};
 const poll=()=>{setInfo('analyser',20);const buf=new Float32Array(an.fftSize),hw=win/2/sr;iv=setInterval(()=>{if(!on)return;an.getFloatTimeDomainData(buf);const r=low?yin(buf,sr,LOW.fmin):yin(buf,sr);emit([ctx.currentTime-hw,r?r.midi:null,r?r.conf:0])},20)/* 창 중심 시각(워클릿 frameCentre 와 같은 기준) */};
 const killNode=()=>{clearTimeout(wd);if(node){try{node.port.postMessage('stop')}catch(_){}try{node.disconnect()}catch(_){}try{opts.source&&opts.source.disconnect(node)}catch(_){}node=null}if(zero){try{zero.disconnect()}catch(_){}zero=null}};
 let wl=false;if(opts.workletUrl&&opts.source&&ctx.audioWorklet&&typeof AudioWorkletNode!=='undefined'){const env=envNow();wl=workletAllowed({hasWorklet:true,...env}).ok}
 if(wl){try{await loadWorklet(ctx,opts.workletUrl);if(!on)throw new Error('stopped');const hop=hopFor(sr);wlHop=hop/sr*1e3;ctl=loadCtl(wlHop);
   node=new AudioWorkletNode(ctx,'pitch-frames',{numberOfInputs:1,numberOfOutputs:1,channelCount:1,channelCountMode:'explicit',outputChannelCount:[1],processorOptions:{win,hop}});
   let got=0;node.port.onmessage=e=>{if(!on)return;const d=e.data;if(!d||!d.buf)return;if(!got++)clearTimeout(wd);if(!ctl.take())return;const t0=_now(),r=low?yin(d.buf,sr,LOW.fmin):yin(d.buf,sr);const k0=ctl.k;ctl.record(_now()-t0);if(ctl.k!==k0)setInfo('worklet',wlHop*ctl.k);emit([frameCentre(d.end,d.buf.length,sr),r?r.midi:null,r?r.conf:0])};
   zero=ctx.createGain();zero.gain.value=0;node.connect(zero);zero.connect(ctx.destination);opts.source.connect(node);setInfo('worklet',hop/sr*1e3);
   wd=setTimeout(()=>{if(on&&!got){killNode();poll()}},1000)}catch(e){killNode();wl=false}}
 if(!wl)poll();
 return {track,info,stop(){on=false;clearInterval(iv);killNode();if(src)try{src.disconnect()}catch(_){}if(own)stream.getTracks().forEach(t=>t.stop())}}}

function rng(seed){let s=seed>>>0||1;return ()=>(s=(s*1664525+1013904223)>>>0)/4294967296}
/* 키(0–11)·장단조·마디 수·음역[lo,hi] → 으뜸음에서 시작해 으뜸음으로 끝나는 멜로디. 도약은 3도 이하 위주(1단계는 3도까지), 2단계는 가끔 4·5도.
   마지막 음(으뜸음)으로 들어가는 진행도 같은 한도 안(1단계 3도, 2단계 5도): 남은 음 수로 닿을 수 없게 멀어지면 가까운 으뜸음 쪽으로 돌린다(음역 안 으뜸음이 하나뿐일 때 6·7도 도약으로 끝나던 문제) */
/* 입문 단계(level 0·0.5): 으뜸음에서 시작해 으뜸음으로 끝나는 짧은 선율. 입문 1(0) = 도–레–미 3음 순차(제자리 반복은 1번까지), 4–6음.
   입문 2(0.5) = 도–솔 5음 순차 + 3도 도약 최대 1번, 6–8음. 음은 모두 [lo,hi] 안, 도약은 3도(≤4반음) 이하라 끝 으뜸음 진입 한도도 지킨다.
   박은 음마다 1박, 마지막 음 2박. 도약이 없는 순차 위주라 길이가 한 마디를 조금 넘는다. 조건에 맞는 으뜸음이 음역에 없으면 [] */
const BEG_BPM=60;
function beginnerExercise({key,minor,lo,hi,seed,level}){const R=rng(seed),sc=minor?MIN:MAJ;let deg=level<.25?3:5,iv,top,tons;
 for(;;deg--){iv=sc.slice(0,deg);top=iv[deg-1];tons=[];for(let m=lo;m+top<=hi;m++)if(((m-key)%12+12)%12===0)tons.push(m);if(tons.length||deg<=3)break} /* 음역이 좁아 도–솔이 안 들어가면 도–파·도–미로 줄인다(항상 도–솔의 부분집합) */
 if(!tons.length&&hi-lo>=7){/* 위로 올라가는 도–솔이 어느 옥타브에도 안 들어가는 조(예: 57–69 의 Gb·G·Ab)는 으뜸음에서 아래로 내려가는 같은 개수의 음(도–시–라–솔–파)으로 둔다. 스팬이 7반음 이하라 음역 7반음 이상이면 항상 들어간다(검수 #11) */
  for(let d=deg>3?5:3;d>=3&&!tons.length;d--){const dn=[0];for(let k=1;k<d;k++)dn.push(sc[7-k]-12);const mn=dn[d-1];const tt=[];for(let m=lo-mn;m<=hi;m++)if(((m-key)%12+12)%12===0&&m+mn>=lo)tt.push(m);if(tt.length){iv=dn;top=mn;tons=tt;deg=d}}}
 if(!tons.length)return [];
 const ctr=(lo+hi)/2,t=tons.reduce((a,x)=>Math.abs(x+top/2-ctr)<Math.abs(a+top/2-ctr)?x:a);
 const nMin=level<.25?4:6,nMax=level<.25?6:8,maxLeap=level<.25?0:1;let best=null;
 for(let tr=0;tr<200&&!best;tr++){const n=nMin+Math.floor(R()*(nMax-nMin+1)),ix=[0];let rep=0,lp=0,ok=true;
  for(let k=1;k<n&&ok;k++){const c=ix[k-1],last=k===n-1,r=R();let step;
   if(r<.18&&rep<1&&k>1&&!last)step=0;else if(r<.3&&lp<maxLeap&&!last)step=R()<.5?2:-2;else step=R()<.5?-1:1;
   let j=c+step;if(j<0||j>=deg){j=c-step;if(j<0||j>=deg){ok=false;break}}
   if(last&&(j!==0||Math.abs(j-c)>2)){ok=false;break}
   if(Math.abs(j-c)===2)lp++;if(j===c)rep++;ix.push(j)}
  if(ok&&ix[n-1]===0&&ix.every((x,k)=>k===0||x!==ix[k-1]||k<n-1)&&ix[1]!==0)best=ix}
 if(!best)best=level<.25||deg<4?[0,1,2,1,0]:[0,1,2,3,2,1,0];
 const out=[];let b=0;best.forEach((x,k)=>{const d=k===best.length-1?2:1;out.push([b,d,t+iv[x]]);b+=d});return out}
function makeExercise({key=0,minor=false,bars=4,lo=57,hi=69,seed=1,level=1}={}){if(level<1)return beginnerExercise({key,minor,lo,hi,seed,level});const R=rng(seed),sc=minor?MIN:MAJ,pool=[];
 for(let m=lo;m<=hi;m++)if(sc.includes(((m-key)%12+12)%12))pool.push(m);if(pool.length<3)return [];
 const tonics=pool.filter(m=>((m-key)%12+12)%12===0),tI=tonics.map(m=>pool.indexOf(m)),mx=level<2?2:4;let cur=tonics.length?tonics[Math.floor(tonics.length/2)]:pool[pool.length>>1];
 const rhythms=level<2?[[2,2],[1,1,2],[2,1,1],[4]]:[[1,1,1,1],[1.5,.5,2],[1,1,2],[.5,.5,1,2],[2,1,1]];const out=[];let t=0;
 for(let b=0;b<bars;b++){const rh=b===bars-1?[2,2]:rhythms[Math.floor(R()*rhythms.length)];for(let k=0;k<rh.length;k++){
  const last=b===bars-1&&k===rh.length-1;let i=pool.indexOf(cur);
  if(out.length){if(last){const near=tonics.length?tonics.reduce((a,x)=>Math.abs(x-cur)<Math.abs(a-cur)?x:a):cur;i=pool.indexOf(near)}
   else{const i0=i,r=R(),step=r<.6?1:r<.85?2:(level<2?2:R()<.5?3:4);const dir=i<=1?1:i>=pool.length-2?-1:(R()<.5?-1:1);i=Math.max(0,Math.min(pool.length-1,i+dir*step));
    const rem=b<bars-1?rh.length-1-k+Math.max(0,bars-2-b)+2:1,dt=j=>Math.min(...tI.map(x=>Math.abs(j-x)));
    if(tI.length&&dt(i)>mx*rem){const tt=tI.reduce((a,x)=>Math.abs(x-i0)<Math.abs(a-i0)?x:a);i=i0+Math.sign(tt-i0)*Math.min(Math.abs(tt-i0)-1,mx)}}} /* 으뜸음 한 칸 앞(레·시)에서 멈춰 끝 마디가 도–도 반복으로 쏠리지 않게 */
  cur=pool[i];out.push([t,rh[k],cur]);t+=rh[k]}}
 return out}

/* 부르기 전 기준음: 으뜸음 2.0초 + (선택) 으뜸 3화음 1초. 이어서 카운트인 4박. → {ev:[[시작오프셋초,길이초,[midi…]]], total} (순수) */
const REF_TONIC=2,REF_TRIAD=1;
function refPlan(tonic,{triad=false,minor=false}={}){const ev=[[0,REF_TONIC,[tonic]]];if(triad)ev.push([REF_TONIC,REF_TRIAD,[tonic,tonic+(minor?3:4),tonic+7]]);return {ev,total:REF_TONIC+(triad?REF_TRIAD:0)}}
/* 목표 [시작박,길이박,midi] + 기록 [초,midi|null,conf] + 박→초 함수. 각 음의 앞 15%·뒤 10% 는 이동 구간이라 뺀다 */
function scoreTake(target,track,beatToSec,{tol=TOL_DEFAULT,minConf=.5}={}){const mk=voicedMask(track,{minConf}),per=target.map(([s,d,p])=>{const a=beatToSec(s+d*.15),b=beatToSec(s+d*.9);
  const fr=[],v=[];for(let i=0;i<track.length;i++){const f=track[i];if(f[0]>=a&&f[0]<=b){fr.push(f);if(mk[i])v.push(f)}}
  const cents=v.map(f=>{let c=(f[1]-p)*100;return c});const inT=cents.filter(c=>Math.abs(c)<=tol).length;
  const med=cents.length?cents.slice().sort((x,y)=>x-y)[cents.length>>1]:null;
  const oct=med!=null&&Math.abs(Math.abs(med)-1200)<tol*2,dev=med==null?null:oct?med-Math.sign(med)*1200:med;
  const verdict=!v.length?'소리 없음':oct?'옥타브 차이':inT/v.length>=.6?'맞음':med>0?'높음':'낮음';
  return {pitch:p,frames:fr.length,voiced:v.length,hit:v.length?inT/v.length:0,medCents:med,devCents:dev,octave:oct,verdict,
   tier:!v.length?null:verdict==='맞음'?'맞음':!oct&&Math.abs(dev)<=2*tol?'가까움':'벗어남'}});
 const sung=per.filter(x=>x.voiced),tiers={맞음:0,가까움:0,벗어남:0};for(const x of per)if(x.tier)tiers[x.tier]++;
 return {notes:per,tol,tiers,...takeDrift(per),score:sung.length?Math.round(100*per.filter(x=>x.verdict==='맞음').length/per.length):0,
  meanAbsCents:sung.length?Math.round(sung.reduce((a,x)=>a+Math.abs(x.octave?x.medCents-Math.sign(x.medCents)*1200:x.medCents),0)/sung.length):null}}
/* 시작 음 편차·끝 음 드리프트(신호 기반 cent). notes = scoreTake 의 per(음 순서). start = 소리가 잡힌 첫 음의 편차(옥타브 접은 중앙값),
   end = 마지막 음(연습 멜로디는 으뜸음으로 끝남)의 편차, drift = end − start. 첫 음과 마지막 음이 모두 잡혀야 drift 를 낸다(그 둘이 같은 음이면 null) */
function takeDrift(notes){const L=notes||[],fi=L.findIndex(x=>x.devCents!=null),last=L.length-1;if(fi<0)return {start:null,end:null,drift:null};
 const start=Math.round(L[fi].devCents);if(last<=fi||L[last].devCents==null)return {start,end:null,drift:null};const end=Math.round(L[last].devCents);return {start,end,drift:end-start}}

/* 왕복 지연 추정(ms). samples [[초, rms]] 시간순, clicks 예약 시각(초) 배열. 첫 클릭 전 구간 rms 중앙값(잡음 바닥)의 5배와 0.02 중 큰 값을 클릭 뒤 [-30 ms, +450 ms] 안에서 처음 넘는 시각 − 예약 시각의 중앙값. 잡힌 클릭이 2개 미만이면 null */
function latencyStats(samples,clicks,{win=.45,minRms=.02,k=5}={}){const base=samples.filter(s=>s[0]<clicks[0]-.05).map(s=>s[1]).sort((a,b)=>a-b),nf=base.length?base[base.length>>1]:0,thr=Math.max(minRms,nf*k),lat=[];
 for(const c of clicks){const s=samples.find(x=>x[0]>=c-.03&&x[0]<=c+win&&x[1]>thr);if(s)lat.push(Math.max(0,s[0]-c))}
 if(lat.length<2)return null;lat.sort((a,b)=>a-b);const qt=p=>{const x=p*(lat.length-1),i=Math.floor(x);return lat[i]+(lat[Math.min(i+1,lat.length-1)]-lat[i])*(x-i)};
 return {ms:Math.round(1000*lat[lat.length>>1]),iqr:Math.round(1000*(qt(.75)-qt(.25))),n:lat.length}}
function estimateLatency(samples,clicks,o){const r=latencyStats(samples,clicks,o);return r?r.ms:null}
/* 지연 측정 안내(순수). iqr(클릭별 값의 사분위 범위, ms)가 maxIqr(60) 초과면 unstable. outputLatency(초, 있으면)는 참고값으로만 쓴다(실측 우선, 입력 지연 미포함, 일부 브라우저엔 없음).
   labels = 선택된 입·출력 장치 이름: 블루투스 계열 낱말이 있으면 유선 이어폰 권장(블루투스 지연이 크다는 것은 일반 지식이며 이 앱에서 확인한 것은 아님) */
const BT_RE=/bluetooth|airpods|buds|블루투스/i;
function latencyAdvice({iqr=null,outputLatency=null,labels=[]}={},{maxIqr=60}={}){const lines=[],unstable=iqr!=null&&iqr>maxIqr;
 if(unstable)lines.push(`측정이 불안정합니다(클릭마다 ${iqr} ms 퍼짐). 조용한 곳에서 이어폰 소리를 키우지 말고 스피커 음량을 적당히 올려 다시 측정하세요.`);
 const bt=(labels||[]).some(l=>BT_RE.test(String(l||'')));if(bt)lines.push('블루투스 이어폰은 지연이 커서 유선 이어폰을 권장합니다.');
 if(typeof outputLatency==='number'&&isFinite(outputLatency)&&outputLatency>0)lines.push(`참고값: 브라우저가 알려 준 출력 지연 ${Math.round(outputLatency*1000)} ms(입력 지연은 빠져 있어 실측값과 다를 수 있습니다).`);
 return {unstable,bluetooth:bt,lines}}

/* 음높이 곡선 → 음 목록 [시작초,길이초,midi]. 중앙값에서 0.6 반음 이상 벗어나면 새 음, 60 ms 미만 버림 */
function smoothNotes(track,{dev=.6,minDur=.06}={}){const out=[],mk=voicedMask(track);let seg=[];const flush=()=>{if(seg.length>1){const ps=seg.map(f=>f[1]).sort((a,b)=>a-b),m=ps[ps.length>>1],dur=seg[seg.length-1][0]-seg[0][0];if(dur>=minDur)out.push([seg[0][0],dur,Math.round(m)])}seg=[]};
 for(let i=0;i<track.length;i++){const f=track[i];if(!mk[i]){flush();continue}if(seg.length){const ps=seg.map(x=>x[1]).sort((a,b)=>a-b);if(Math.abs(f[1]-ps[ps.length>>1])>dev)flush()}seg.push(f)}flush();return out}

const INTERVALS=[['단2도',1],['장2도',2],['단3도',3],['장3도',4],['완전4도',5],['증4도',6],['완전5도',7],['단6도',8],['장6도',9],['단7도',10],['장7도',11],['옥타브',12]];
/* 청음 문제: type 'interval' | 'triad' | 'seventh' | 'degree'. level 1 은 키 안의 음만(7화음은 maj7·7·m7, 도수는 장음계 7음), 2 는 전부(7화음 5종, 도수 12음).
   dir: 'asc' 상행 | 'desc' 하행 | 'har' 동시 | 'mix' 섞기(음정만). name: 지정하면 그 음정/화음으로 고정. weight: id→가중치 함수(약점 위주). item 은 통계 id */
const SV_ALL=[['메이저7',[0,4,7,11]],['도미넌트7',[0,4,7,10]],['마이너7',[0,3,7,10]],['하프 디미니시',[0,3,6,10]],['디미니시7',[0,3,6,9]]];
/* 으뜸음 찾기: 무작위 장조(key 0–11)에서 으뜸화음(I)이 한 번도 안 나오는 다이아토닉 4코드. 1 은 V 로 끝(끌림 강함), 2 는 IV·ii 로 끝. 처음·끝·가운데 모두 I 아님. 도수 0–6 */
const TK_P={1:[[3,5,1,4],[1,2,3,4],[1,5,3,4],[3,2,5,4],[2,5,1,4],[2,3,1,4]],2:[[1,4,5,3],[2,1,4,3],[1,2,4,3],[2,5,4,3],[3,4,2,1],[3,5,4,1],[4,5,3,1]]},TK_LAB={1:'V 화음으로 끝남',2:'IV·ii 화음으로 끝남'}; /* vi 로 끝내면 나란한 단조(vi 가 으뜸)로 들려 답이 둘이 되므로 2단계 끝은 IV·ii. vi 로 시작해도 첫 화음이 으뜸으로 들려(vi–IV–ii–V = 단조 i–VI–iv–VII, vi–iii–V–IV = i–v–VII–VI) 같은 문제가 생기므로 시작도 vi 아님 */
function tonicQuiz({level=1,seed=1}={}){const lv=level<2?1:2,R=rng(seed);for(let i=0;i<4;i++)R(); /* 작은 연속 시드의 첫 출력 상관을 버림 */
 const key=Math.floor(R()*12),ps=TK_P[lv],degs=ps[Math.floor(R()*ps.length)].slice();let prev=null;const cad=degs.map(d=>{const v=voiceTriad((key+MAJ[d])%12,DEG_Q[d],prev);prev=v.notes;return {notes:v.notes,bass:v.bass}}),t=voiceTriad(key,'maj',prev);
 return {type:'tonic',level:lv,key,degs,answer:KEYN[key],choices:KEYN.slice(),cad,tonic:{notes:t.notes,bass:t.bass},notes:[],label:KEYN[key]+' 메이저',item:'tk:'+lv}}
/* 카덴스(종지) 듣기: 무작위 장조(key 0–11). I → (IV 또는 ii) → 종지 2화음. 종지는 마지막 두 화음으로만 정해진다: V–I 정격 / IV–I 변격 / (I·IV·ii)–V 반종지 / V–vi 거짓.
   답이 둘이 되지 않게: 앞 두 화음(I, IV|ii)에는 V 가 없고, 열린 둘째 화음은 종지 첫 화음과 같지 않다(IV–IV 반복 없음). 1단계는 정격·반종지만, 2단계는 넷 다. 모두 직전 화음과 가장 가까운 전위 + 근음 베이스 */
const CD_T={auth:{ko:'정격 종지',pat:'V–I'},plag:{ko:'변격 종지',pat:'IV–I'},half:{ko:'반종지',pat:'I·IV·ii–V'},decp:{ko:'거짓 종지',pat:'V–vi'}},CD_L1=['auth','half'],CD_ALL=['auth','plag','half','decp'];
function cadenceQuiz({level=1,seed=1,name=null,weight=null}={}){const lv=level<2?1:2,R=rng(seed);for(let i=0;i<4;i++)R();
 const types=lv<2?CD_L1:CD_ALL,key=Math.floor(R()*12),t=name&&CD_T[name]?name:pickWeighted(types,weight?types.map(x=>weight('cd:'+x)):null,R);
 const last=t==='auth'?[4,0]:t==='plag'?[3,0]:t==='decp'?[4,5]:[[0,3,1][Math.floor(R()*3)],4],cand=[1,3].filter(d=>d!==last[0]),degs=[0,cand[Math.floor(R()*cand.length)],...last];
 let prev=null;const cad=degs.map(d=>{const v=voiceTriad((key+MAJ[d])%12,DEG_Q[d],prev);prev=v.notes;return {notes:v.notes,bass:v.bass}}),
  cs=degs.map(d=>({root:(key+MAJ[d])%12,q:DEG_Q[d]==='min'?'m':''})),romans=cs.map(c=>romanOf(c,key)),names=cs.map(c=>chordLabel(c,key)),ch=types.map(x=>CD_T[x].ko),reveal={};
 for(const x of CD_ALL)reveal[CD_T[x].ko]='('+CD_T[x].pat+')';if(!ch.includes(CD_T[t].ko))ch.push(CD_T[t].ko);
 return {type:'cadence',level:lv,key,degs,cd:t,answer:CD_T[t].ko,choices:ch,reveal,cad,romans,names,notes:[],label:KEYN[key]+' 메이저',
  info:`${KEYN[key]} 메이저: ${names.join(' – ')} (${romans.join('–')})`,item:'cd:'+t}}
/* 7화음(근음 위치 기준 가장 가까운 전위). notes 4개, 베이스는 36–47 의 근음 */
function voiceSeventh(rootPc,prev){let best=null;const pcs=[0,4,7,10].map(i=>(rootPc+i)%12),mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
 for(let inv=0;inv<4;inv++){const rot=pcs.slice(inv).concat(pcs.slice(0,inv));let n=55;while(n%12!==rot[0])n++;const notes=[n];for(let k=1;k<4;k++){let m=notes[k-1]+1;while(m%12!==rot[k])m++;notes.push(m)}
  const cost=Math.abs(mean(notes)-(prev?mean(prev):64));if(!best||cost<best.cost)best={cost,notes}}
 let b=36;while(b%12!==rootPc)b++;return {notes:best.notes,bass:b}}
/* 화음 기능(T/S/D): 장조 key 에서 I–IV–V–I 로 조성을 세운 뒤 목표 화음 하나. 토닉 I·vi / 서브도미넌트 IV·ii / 도미넌트 V·V7.
   iii 와 vii° 는 뺀다: iii 는 토닉(I·vi 와 공통음 2개)으로도 도미넌트(V 와 공통음 2개)로도 들리고, vii° 는 V7 의 근음 없는 모양이라 도미넌트로 읽혀 기능이 하나로 정해지지 않는다 */
const FN_POOL={T:[[0,''],[5,'m']],S:[[3,''],[1,'m']],D:[[4,''],[4,'7']]},FN_KO={T:'토닉(T)',S:'서브도미넌트(S)',D:'도미넌트(D)'},FN_ALL=['T','S','D'];
function funcQuiz({key=0,seed=1,name=null,weight=null}={}){const R=rng(seed);for(let i=0;i<4;i++)R();key=pcm(key);
 const f=name&&FN_POOL[name]?name:pickWeighted(FN_ALL,weight?FN_ALL.map(x=>weight('fn:'+x)):null,R),pl=FN_POOL[f],[deg,q]=pl[Math.floor(R()*pl.length)];
 let prev=null;const cad=[0,3,4,0].map(d=>{const v=voiceTriad((key+MAJ[d])%12,'maj',prev);prev=v.notes;return {notes:v.notes,bass:v.bass}});
 const root=(key+MAJ[deg])%12,c={root,q};let tv=q==='7'?voiceSeventh(root,prev):voiceTriad(root,q==='m'?'min':'maj',prev);/* I 목표가 카덴스 끝 화음과 똑같은 소리면 「같은 화음 반복 = 토닉」으로 답이 드러남: 맨 아래 음을 한 옥타브 올려 다른 자리바꿈으로 */if(tv.notes.join()===prev.join()){const n=tv.notes.slice().sort((x,y)=>x-y);n[0]+=12;tv={notes:n.sort((x,y)=>x-y),bass:tv.bass}}const rn=romanOf(c,key),nm=chordLabel(c,key);
 return {type:'func',key,fn:f,deg,answer:FN_KO[f],choices:FN_ALL.map(x=>FN_KO[x]),cad,target:{notes:tv.notes,bass:tv.bass},notes:[],roman:rn,chordName:nm,label:KEYN[key]+' 메이저',
  info:`${KEYN[key]} 메이저에서 ${rn} = ${nm} → ${FN_KO[f]}`,item:'fn:'+f}}
/* 전위 듣기: 무작위 근음의 메이저·마이너 3화음. 가장 낮은 음이 전위의 베이스음(근음·3음·5음)이고 베이스를 따로 겹치지 않는다. 가장 낮은 음은 E3–D#4(52–63) */
const INV_KO=['기본형','1전위(3음 베이스)','2전위(5음 베이스)'];
function inversionQuiz({seed=1,name=null,weight=null}={}){const R=rng(seed);for(let i=0;i<4;i++)R();
 const root=Math.floor(R()*12),minor=R()<.5,inv=name!=null&&INV_KO[+name]?+name:pickWeighted([0,1,2],weight?[0,1,2].map(x=>weight('inv:'+x)):null,R);
 const pcs=[root,(root+(minor?3:4))%12,(root+7)%12],rot=pcs.slice(inv).concat(pcs.slice(0,inv)),notes=[52+((rot[0]-52)%12+12)%12];
 for(let k=1;k<3;k++){let m=notes[k-1]+1;while(m%12!==rot[k])m++;notes.push(m)}
 /* 철자: 메이저는 근음 이름의 장조(Db·Eb·F#·Ab·Bb), 마이너는 C 장조 기준(C#m·D#m·F#m·G#m·Bbm) */
 const label=chordLabel({root,q:minor?'m':'',bass:inv?pcs[inv]:null},minor?0:root);
 return {type:'inversion',root,minor,inv,bassPc:pcs[inv],answer:INV_KO[inv],choices:INV_KO.slice(),notes,label,info:`${label} (${minor?'마이너':'메이저'} 3화음, ${INV_KO[inv]})`,item:'inv:'+inv}}
/* 악보 읽기: 온음표 한 개를 자리표 위에 보이고 음 이름(과학적 표기, C4=가운데 도)을 고른다. 자연음만(덧줄 세기에 집중).
   step = 옥타브*7+글자(C=0). 높은음자리표 오선 E4(30)–F5(38), 낮은음자리표 G2(18)–A3(26). 덧줄 수 = floor(오선 끝에서 벗어난 단계/2).
   1단계 오선 안+덧줄 1개까지, 2단계 덧줄 3개까지, 3단계 덧줄 4–6개(오선 안 문제 없음). 보기 4개: 정답·오선 쪽으로 한 단계(덧줄을 잘못 센 흔한 오답)·반대로 한 단계·한 옥타브 차이 */
const RD_CL={g:{bot:30,ko:'높은음자리표',clef:'treble'},f:{bot:18,ko:'낮은음자리표',clef:'bass'}},RD_ORD=['첫째','둘째','셋째','넷째','다섯째'],RD_Z={in:'오선 안',up:'오선 위 덧줄',dn:'오선 아래 덧줄'};
const rdName=s=>'CDEFGAB'[s%7]+Math.floor(s/7),rdMidi=s=>(Math.floor(s/7)+1)*12+[0,2,4,5,7,9,11][s%7];
function rdRange(zone,lv){if(zone==='in')return [0,8];return [lv===3?8:1,lv===1?3:lv===2?7:12]} /* up·dn: 오선 끝에서 벗어난 단계 d */
function rdHint(clef,step){const c=RD_CL[clef],top=c.bot+8,nm=rdName(step);
 if(step>=c.bot&&step<=top){const o=step-c.bot;return o%2?`${c.ko} ${RD_ORD[(o-1)/2]} 칸 = ${nm}`:`${c.ko} ${RD_ORD[o/2]} 줄${o===0?'(맨 아래)':o===8?'(맨 위)':''} = ${nm}`}
 const up=step>top,d=up?step-top:c.bot-step,k=Math.floor(d/2),ln=[];for(let i=1;i<=k;i++)ln.push(rdName(up?top+2*i:c.bot-2*i));const side=up?'오선 위':'오선 아래';
 if(d%2===0)return `${c.ko} ${side} 덧줄 ${k}번째 = ${nm} (덧줄을 하나씩 세기: ${ln.join(', ')})`;
 return d===1?`${c.ko} ${up?'맨 윗줄 바로 위':'맨 아랫줄 바로 아래'} 칸 = ${nm}`:`${c.ko} ${side} 덧줄 ${k}번째와 ${k+1}번째 사이 칸 = ${nm} (덧줄을 하나씩 세기: ${ln.join(', ')})`}
function readingQuiz({level=1,seed=1,name=null,weight=null}={}){const lv=level<2?1:level<3?2:3,R=rng(seed);for(let i=0;i<4;i++)R();
 const items=[];for(const cl of ['g','f'])for(const z of lv===3?['up','dn']:['in','up','dn'])items.push(cl+'-'+z);
 const nm=name&&/^[gf]-(in|up|dn)$/.test(name)?name:pickWeighted(items,weight?items.map(x=>weight('rd:'+x)):null,R),clef=nm[0],zone=nm.slice(2),c=RD_CL[clef],top=c.bot+8;
 const [lo,hi]=rdRange(zone,lv),d=lo+Math.floor(R()*(hi-lo+1)),step=zone==='in'?c.bot+d:zone==='up'?top+d:c.bot-d;
 const mid=c.bot+4,tw=step<mid?1:step>mid?-1:1,oc=R()<.5?7:-7,ch=[step,step+tw,step-tw,step+oc>=7&&step+oc<=62?step+oc:step-oc],at=ch.map(rdName);
 for(let i=at.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[at[i],at[j]]=[at[j],at[i]]}
 const led=zone==='in'?0:Math.floor(d/2),hint=rdHint(clef,step);
 return {type:'reading',level:lv,clef:c.clef,zone,step,ledger:led,midi:rdMidi(step),notes:[rdMidi(step)],answer:rdName(step),choices:at,label:c.ko,hint,info:hint,item:'rd:'+nm}}
/* 모드 식별(md2:): 같은 으뜸음에서 모드 음계를 올라갔다 내려온 뒤 짧은 선율. 해설은 "장조 대비 바뀐 음". 항목 id md2:<ion|dor|phr|lyd|mix|aeo> (md: 는 멜로디 받아쓰기라 겹치지 않게 md2).
   1단계 이오니안·에올리안·믹솔리디안·도리안, 2단계 리디안·프리지안 추가. 선율은 그 모드의 특징음(ch, 음계 안 순서 0–6)을 두 번 넣고 으뜸음으로 끝난다.
   으뜸음 철자: 음계 일곱 음이 글자 순서대로 이어지고 겹올림·겹내림이 없는 으뜸음만 쓴다(예: 에올리안 Db 는 B 가 겹내림이라 제외) */
const MODES={ion:{ko:'이오니안(장음계)',iv:[0,2,4,5,7,9,11],ch:6},dor:{ko:'도리안',iv:[0,2,3,5,7,9,10],ch:5},phr:{ko:'프리지안',iv:[0,1,3,5,7,8,10],ch:1},lyd:{ko:'리디안',iv:[0,2,4,6,7,9,11],ch:3},mix:{ko:'믹솔리디안',iv:[0,2,4,5,7,9,10],ch:6},aeo:{ko:'에올리안(단음계)',iv:[0,2,3,5,7,8,10],ch:5}};
const MODE_ALL=['ion','dor','phr','lyd','mix','aeo'],MODE_L1=['ion','aeo','mix','dor'],MD2_ITEMS=MODE_ALL.map(x=>'md2:'+x);
function modeSpell(tpc,id){const m=MODES[id],t=pcm(tpc),l0=LET.indexOf(KEYN[t][0]);if(!m)return null;return m.iv.map((iv,i)=>{const l=(l0+i)%7;return {l:LET[l],a:((pcm(t+iv)-LPC[l]+18)%12)-6}}).map(x=>x.l+accS(x.a))}
const modeSpellOk=(t,id)=>{const m=MODES[id],l0=LET.indexOf(KEYN[pcm(t)][0]);return m.iv.every((iv,i)=>{const l=(l0+i)%7;return Math.abs(((pcm(t+iv)-LPC[l]+18)%12)-6)<=1})};
/* 장조(같은 으뜸음) 대비 바뀐 음: 반음 낮으면 ♭, 높으면 ♯ + 음계 도수 번호 */
function modeAlts(id){const m=MODES[id];return m?m.iv.map((x,i)=>x===MAJ[i]?null:(x<MAJ[i]?'♭':'♯')+(i+1)).filter(Boolean):[]}
const modeAltText=id=>{const a=modeAlts(id);return a.length?'장조 대비 바뀐 음: '+a.join(', '):'장조 대비 바뀐 음 없음(장음계 그대로)'};
function modeQuiz({level=1,seed=1,name=null,weight=null}={}){const lv=level<2?1:2,R=rng(seed);for(let i=0;i<4;i++)R();
 const ids=lv<2?MODE_L1:MODE_ALL,id=name&&MODES[name]?name:pickWeighted(ids,weight?ids.map(x=>weight('md2:'+x)):null,R),m=MODES[id];
 const ts=[0,1,2,3,4,5,6,7,8,9,10,11].filter(t=>modeSpellOk(t,id)),tpc=ts[Math.floor(R()*ts.length)],tm=57+((tpc-57)%12+12)%12; /* 으뜸음 A3–G#4 */
 const sc=m.iv.map(x=>tm+x).concat(tm+12),scale=sc.concat(sc.slice(0,-1).reverse()),c=m.ch,tp=R()<.5?[0,2,c,4,c,2,0]:[4,c,4,2,c,0],melody=tp.map(i=>tm+m.iv[i]);
 const ch=ids.map(x=>MODES[x].ko);if(!ch.includes(m.ko))ch.push(m.ko);const tn=KEYN[tpc],names=modeSpell(tpc,id);
 return {type:'mode',level:lv,mode:id,tonic:tpc,tonicName:tn,names,alts:modeAlts(id),answer:m.ko,choices:ch,scale,melody,notes:scale.concat(melody),label:tn+' '+m.ko,
  info:`${tn} ${m.ko}: ${names.join(' ')} (${modeAltText(id)})`,item:'md2:'+id}}
/* 혼동 쌍 대조: 고정 쌍 + 내 혼동 쌍. 내 쌍 = 기존 explain 규칙(가장 자주 고른 오답이 2번 이상, 오답의 40% 이상)을 만족하는 음정 항목 중 횟수가 가장 많은 (정답→고른 답). 같으면 id 가 앞선 쪽 */
const CONTRAST_FIXED=[['완전4도','완전5도'],['단6도','장6도'],['단7도','장7도'],['단3도','장3도'],['단2도','장2도']],CONTRAST_N=8;
function confusedPair(st){let best=null;const conf=st&&st.conf||{};
 for(const id of Object.keys(conf).sort()){const p=id.split(':');if(p[0]!=='iv'||!INTERVALS.some(x=>x[0]===p[1]))continue;const c=conf[id],ks=Object.keys(c).sort((a,b)=>c[b]-c[a]||(a<b?-1:1)),tot=ks.reduce((a,k)=>a+c[k],0),top=ks[0];
  if(top==null||c[top]<2||c[top]/tot<.4||top===p[1]||!INTERVALS.some(x=>x[0]===top))continue;if(!best||c[top]>best.n)best={a:p[1],b:top,dir:p[2],n:c[top]}}
 return best}
/* sel: 'auto'(내 혼동 쌍, 없으면 첫 고정 쌍) 또는 고정 쌍 번호 0–4. 반환 {a,b,dir|null,src:'conf'|'fixed'} (a·b 는 반음 수 순) */
function contrastPair(st,sel='auto'){let a,b,dir=null,src='fixed';const f=CONTRAST_FIXED[+sel];
 if(sel==='auto'||!f){const c=confusedPair(st);if(c){a=c.a;b=c.b;dir=c.dir;src='conf'}else[a,b]=CONTRAST_FIXED[0]}else[a,b]=f;
 const s=n=>INTERVALS.find(x=>x[0]===n)[1];if(s(a)>s(b))[a,b]=[b,a];return {a,b,dir,src}}
/* 한 세션(8문제)의 idx 번째 문제: 두 음정을 번갈아(짝수 번째 a, 홀수 번째 b). 통계 항목은 보통 음정 문제와 같은 iv:<이름>:<방향> */
/* 세션(8문제) 안 정답 순서: a 4번 + b 4번을 세션 시드로 섞고, 같은 쪽이 4번 이어지지 않게 한다(교대 규칙을 못 맞추게, 검수 #11). 값 0=a, 1=b */
function contrastOrder(sess=1,n=CONTRAST_N){const R=rng((sess>>>0)+977);for(let t=0;t<200;t++){const o=[];for(let i=0;i<n;i++)o.push(i<n/2?0:1);for(let i=n-1;i>0;i--){const j=Math.floor(R()*(i+1));[o[i],o[j]]=[o[j],o[i]]}let run=1,mx=1;for(let i=1;i<n;i++){run=o[i]===o[i-1]?run+1:1;if(run>mx)mx=run}if(mx<=3&&o.some((x,i)=>i&&x===o[i-1]))return o}return Array.from({length:n},(_,i)=>(i>>1)%2)} /* 완전 교대(a,b,a,b…)도 짐작 가능하므로 버린다(약 4% 세션, smoke 간헐 실패 원인) */
function contrastQuiz({pair,idx=0,seed=1,dir='asc',lo=55,hi=72,sess=1}={}){const R=rng(seed);for(let i=0;i<4;i++)R();const [a,b]=pair||CONTRAST_FIXED[0],ans=contrastOrder(sess)[((idx%CONTRAST_N)+CONTRAST_N)%CONTRAST_N]?b:a,semi=INTERVALS.find(x=>x[0]===ans)[1],dr=dir==='desc'||dir==='har'?dir:'asc',base=lo+Math.floor(R()*(hi-lo-12));
 return {type:'interval',contrast:true,idx,answer:ans,choices:[a,b],notes:[base,base+semi],label:pcName(dr==='desc'?base+semi:base,0),dir:dr,item:'iv:'+ans+':'+dr}}
/* 탭 템포: 탭 시각(초) 배열 → {bpm,n}. 마지막 탭 기준 pause(2 s) 넘게 끊긴 앞은 버리고, 최근 max(9)탭의 간격 중앙값에서 25% 넘게 벗어난 간격은 제외한 평균으로 BPM. 간격 2개 미만이면 null */
function tapBpm(times,{pause=2,max=9,tol=.25}={}){const t=(Array.isArray(times)?times:[]).filter(x=>typeof x==='number'&&isFinite(x));if(t.length<3)return null;let st=t.length-1;while(st>0&&t[st]-t[st-1]<=pause&&t[st]-t[st-1]>0)st--;const w=t.slice(Math.max(st,t.length-max));if(w.length<3)return null;
 const iv=[];for(let i=1;i<w.length;i++)iv.push(w[i]-w[i-1]);const sr=iv.slice().sort((a,b)=>a-b),h=sr.length>>1,med=sr.length%2?sr[h]:(sr[h-1]+sr[h])/2;if(!(med>0))return null;
 const ok=iv.filter(x=>Math.abs(x-med)<=tol*med);if(ok.length<2)return null;const m=ok.reduce((a,x)=>a+x,0)/ok.length;return {bpm:Math.round(600/m)/10,n:ok.length+1}}
/* 탭 BPM 과 분석 BPM 비교: 절반·두 배(±8%)면 그 배율을 돌려준다(0.5·2), 아니면 1 */
function tapRatio(tap,an){if(!(tap>0&&an>0))return 1;const r=tap/an;return Math.abs(r-2)<=.16?2:Math.abs(r-.5)<=.04?.5:1}
function earQuiz({type='interval',key=0,level=1,seed=Date.now(),lo=55,hi=72,dir='asc',name=null,weight=null,active=null,pair=null,idx=0,sess=1,songs=null,has=null}={}){const R=rng(seed);
 if(type==='missing')return missingQuiz({level,seed,songs,name,weight,has});if(type==='tonic')return tonicQuiz({level,seed});if(type==='mode')return modeQuiz({level,seed,name,weight});if(type==='contrast')return contrastQuiz({pair,idx,seed,dir,lo,hi,sess});
 if(type==='reading')return readingQuiz({level,seed,name,weight});if(type==='cadence')return cadenceQuiz({level,seed,name,weight});if(type==='func')return funcQuiz({key,seed,name,weight});if(type==='inversion')return inversionQuiz({seed,name,weight});
 if(type==='triad'){const all=[['메이저',[0,4,7]],['마이너',[0,3,7]],['디미니시',[0,3,6]],['오그먼트',[0,4,8]]],qs=active&&active.length?all.filter(q=>active.includes(q[0])):all.slice(0,level<2?2:4);
  const fixed=name&&all.find(q=>q[0]===name),q=fixed||pickWeighted(qs,weight?qs.map(x=>weight('tr:'+x[0])):null,R),root=lo+Math.floor(R()*(hi-lo-8));
  return {type,answer:q[0],choices:qs.some(x=>x[0]===q[0])?qs.map(x=>x[0]):qs.map(x=>x[0]).concat(q[0]),notes:q[1].map(i=>root+i),label:pcName(root,key,{chord:1,minor:q[1][1]===3}),item:'tr:'+q[0]}}
 if(type==='seventh'){const qs=active&&active.length?SV_ALL.filter(q=>active.includes(q[0])):SV_ALL.slice(0,level<2?3:5),fixed=name&&SV_ALL.find(q=>q[0]===name),q=fixed||pickWeighted(qs,weight?qs.map(x=>weight('sv:'+x[0])):null,R),root=lo+Math.floor(R()*(hi-lo-11));
  return {type,answer:q[0],choices:qs.some(x=>x[0]===q[0])?qs.map(x=>x[0]):qs.map(x=>x[0]).concat(q[0]),notes:q[1].map(i=>root+i),label:pcName(root,key,{chord:1,minor:q[1][1]===3}),item:'sv:'+q[0]}}
 if(type==='degree'){const sems=active&&active.length?active.slice().sort((x,y)=>x-y):level<2?MAJ:[0,1,2,3,4,5,6,7,8,9,10,11],fx=name?SOLF.indexOf(name):-1,sm=fx>=0?fx:pickWeighted(sems,weight?sems.map(x=>weight('dg:'+x)):null,R);
  let prev=null;const cad=[0,3,4,0].map(d=>{const v=voiceTriad((key+MAJ[d])%12,'maj',prev);prev=v.notes;return {notes:v.notes,bass:v.bass}}),t=60+(((key+sm-60)%12)+12)%12;
  return {type,answer:SOLF[sm],choices:sems.map(x=>SOLF[x]).concat(fx>=0&&!sems.includes(fx)?[SOLF[fx]]:[]),notes:[t],cad,label:KEYN[pcm(key)]+' 메이저',item:'dg:'+sm}}
 const pool=active&&active.length?INTERVALS.filter(([n])=>active.includes(n)):level<2?INTERVALS.filter(([,s])=>MAJ.includes(s%12)||s===12):INTERVALS,dirs=dir==='mix'?DIRS:[dir==='desc'||dir==='har'?dir:'asc'];let nm,semi,dr;
 const fx=name&&INTERVALS.find(x=>x[0]===name);
 if(fx){[nm,semi]=fx;dr=dirs[Math.floor(R()*dirs.length)]}
 else{const items=[];for(const p of pool)for(const d of dirs)items.push([p[0],p[1],d]);const it=pickWeighted(items,weight?items.map(x=>weight('iv:'+x[0]+':'+x[2])):null,R);[nm,semi,dr]=it}
 let base;if(level<2&&!(active&&active.length)){const deg=MAJ.filter(d=>MAJ.includes((d+semi)%12));const d=deg[Math.floor(R()*deg.length)]??0;base=lo+((key+d-lo)%12+12)%12}else base=lo+Math.floor(R()*(hi-lo-12));
 const ch=pool.map(p=>p[0]);if(!ch.includes(nm))ch.push(nm);
 return {type,answer:nm,choices:ch,notes:[base,base+semi],label:pcName(dr==='desc'?base+semi:base,key),dir:dr,item:'iv:'+nm+':'+dr}} /* 하행은 위 음에서 시작하므로 라벨(「~에서 시작한」)도 위 음 */

const DEG_L=['I','ii','iii','IV','V','vi','vii°'],DEG_Q=['maj','min','min','maj','maj','min','dim'],QIV={maj:[0,4,7],min:[0,3,7],dim:[0,3,6]};
/* 한 화음의 보이싱: 이전 화음과 가장 가깝게 이어지는 전위를 고른다. 베이스는 36–47 의 근음 */
function voiceTriad(rootPc,q,prev){let best=null;const pcs=QIV[q].map(i=>(rootPc+i)%12);
 for(let inv=0;inv<3;inv++){const rot=pcs.slice(inv).concat(pcs.slice(0,inv));let n=55;while(n%12!==rot[0])n++;const notes=[n];for(let k=1;k<3;k++){let m=notes[k-1]+1;while(m%12!==rot[k])m++;notes.push(m)}
  const cost=prev?notes.reduce((a,x,i)=>a+Math.abs(x-prev[i]),0):Math.abs(notes.reduce((a,x)=>a+x,0)/3-64);if(!best||cost<best.cost)best={cost,notes}}
 let b=36;while(b%12!==rootPc)b++;return {notes:best.notes,bass:b}}
/* 코드 진행 문제. level 1: songChords([{root,minor,bar?}] 코드별, songKey 기준)에서 모두 다이아토닉인 4코드 창을 무작위로 고름(없으면 무작위로 대체). 반마디로 나뉜 마디는 앞·뒤 코드를 각각 한 항목으로 넘기면 된다(bar=마디 번호, 0부터). 결과 bars=[첫 코드의 마디, 끝 코드의 마디](bar 가 있을 때만), from=songChords 안의 창 시작 인덱스.
   level 2: I 로 시작하는 무작위 다이아토닉 4코드(vii° 는 가끔). key 는 연주 키(0–11). degs 는 장음계 도수 0–6 */
function makeProgression({key=0,level=1,seed=1,songChords=null,songKey=0,degs:fixed=null}={}){const R=rng(seed);let degs=null,source='random';
 const build=from=>{let prev=null;const chords=degs.map(d=>{const rootPc=(key+MAJ[d])%12,v=voiceTriad(rootPc,DEG_Q[d],prev);prev=v.notes;return {deg:d,label:DEG_L[d],root:rootPc,quality:DEG_Q[d],notes:v.notes,bass:v.bass}});const sc=from>=0&&songChords?songChords:null,bars=sc&&sc[from]&&sc[from+3]&&sc[from].bar!=null&&sc[from+3].bar!=null?[sc[from].bar,sc[from+3].bar]:null;return {degs,source,from,chords,bars}};
 if(fixed&&fixed.length===4){degs=fixed.slice();return build(-1)}
 if(level<2&&songChords&&songChords.length>=4){const dg=songChords.map(c=>{const i=MAJ.indexOf(((c.root-songKey)%12+12)%12);return i>=0&&(DEG_Q[i]==='min')===!!c.minor&&DEG_Q[i]!=='dim'?i:-1});
  const ws=[];for(let i=0;i+4<=dg.length;i++)if(dg.slice(i,i+4).every(d=>d>=0))ws.push(i);
  if(ws.length){const w=ws[Math.floor(R()*ws.length)];degs=dg.slice(w,w+4);source='song';return build(w)}}
 degs=[0];while(degs.length<4){const d=R()<(level>1?.08:0)?6:1+Math.floor(R()*5);if(d!==degs[degs.length-1])degs.push(d)}
 return build(-1)}

/* 윗선율 추출. notes [시작박,길이박,midi,…]. 구간 [from,to) 박 안에서 시작하는 음만 쓰고, 같은 순간(eps 박)에 시작한 음 중 가장 높은 음을 고르며,
   이미 울리는 더 높은 음 밑에서 시작한 낮은 음은 무시하고 더 낮은 음이 울리던 중이면 그 음을 자른다. 같은 음이 이어지면 합치고 minBeats 미만은 버린다.
   fixed 이면 옥타브 이동·접기를 하지 않는다. 아니면 중앙값이 [lo,hi] 중앙에 가깝도록 전체를 옥타브 이동한 뒤 음역 밖 음은 옥타브 접기. 시작은 from 을 0 으로 옮긴다. 반환 [시작박,길이박,midi] */
function topLine(notes,{from=0,to=Infinity,lo=52,hi=67,minBeats=.125,eps=.06,fixed=false}={}){
 const sel=notes.filter(n=>n[0]>=from-1e-6&&n[0]<to-1e-6).slice().sort((a,b)=>a[0]-b[0]),cl=[];
 for(const n of sel){const c=cl[cl.length-1];if(c&&n[0]-c.s<=eps){if(n[2]>c.p){c.p=n[2];c.d=n[1]}else if(n[2]===c.p&&n[1]>c.d)c.d=n[1]}else cl.push({s:n[0],d:n[1],p:n[2]})}
 const out=[];for(const c of cl){const q=out[out.length-1];if(q&&q.s+q.d>c.s+eps&&q.p>c.p)continue;if(q&&q.s+q.d>c.s)q.d=c.s-q.s;out.push({...c})}
 const mg=[];for(const c of out){const q=mg[mg.length-1];if(q&&q.p===c.p&&q.s+q.d>=c.s-eps)q.d=Math.max(q.d,c.s+c.d-q.s);else mg.push({...c})}
 const keep=mg.filter(c=>c.d>=minBeats-1e-9);if(!keep.length)return [];
 const ps=keep.map(c=>c.p).sort((a,b)=>a-b),med=ps[ps.length>>1],ctr=(lo+hi)/2,sh=fixed?0:Math.round((ctr-med)/12)*12;
 const fold=p=>{if(fixed)return p;p+=sh;while(p>hi)p-=12;while(p<lo)p+=12;return p};
 return keep.map(c=>[Math.round((c.s-from)*1e4)/1e4,Math.round(Math.min(c.d,isFinite(to)?to-c.s:c.d)*1e4)/1e4,fold(c.p)])}

/* 진도 기록: stats {id:{n:총횟수,h:[최근 결과 0..1, 최대 cap개]}} 를 갱신해 돌려준다. lastAcc 는 최근 k회 평균(없으면 null) */
function recStat(stats,id,frac,cap=30){const s=stats&&typeof stats==='object'?stats:{},r=s[id]&&Array.isArray(s[id].h)?s[id]:{n:0,h:[]};
 const f=Math.max(0,Math.min(1,+frac||0));r.n=(r.n||0)+1;r.h=r.h.concat(f).slice(-cap);s[id]=r;return s}
function lastAcc(rec,k=10){const h=rec&&Array.isArray(rec.h)?rec.h.filter(x=>typeof x==='number'&&isFinite(x)).slice(-k):[];return h.length?h.reduce((a,x)=>a+x,0)/h.length:null}

/* ---------- 적응형 청음: 세부 통계(pr-stats2) · 약점 · 오늘의 연습 ----------
   stats2 = {v:2, items:{id:{n,h:[결과 0..1 (1=정답), 최근 60개]}}, conf:{id:{고른 답:횟수}}}
   id: iv:<음정>:<asc|desc|har> · tr:<3화음> · sv:<7화음 성질> · tk:<으뜸음 찾기 난이도 1|2> · dg:<으뜸음 기준 반음 0–11 (음계 도수)> · cd:<auth|plag|half|decp> (카덴스 듣기) · fn:<T|S|D> (화음 기능) · inv:<0|1|2> (전위 듣기) · md2:<ion|dor|phr|lyd|mix|aeo> (모드 식별) · mp:<score|keys|bass|drums|두 파트 score-bass 등> (빠진 파트 찾기: 빠진 파트, 두 파트는 파트 순서 score,keys,bass,drums) · rd:<g|f>-<in|up|dn> (악보 읽기: 자리표×오선 안/위 덧줄/아래 덧줄) · pg:<로마숫자>:<칸 0–3> · md:d<으뜸음 기준 반음> · md:s<직전 음 대비 반음> · sg:d<반음> · sg:v:<hi|lo> · pm:동음:same · pm:<음정>:<asc|desc> · pm:화음:<3up|3down|5> (음정 부르기) · rh:<리듬 칸 종류> · rt:<탭 종류> · rt:<탭 종류>:<late|early> · sd:<vocal|score|bass> (곡 받아쓰기, 창마다 정답률 0..1; 루틴에는 안 씀) · all:<옛 항목>(옛 pr-stats 이관분) */
const DIRS=['asc','desc','har'],DIR_KO={asc:'상행',desc:'하행',har:'동시'},SOLF=['도','도#','레','미♭','미','파','파#','솔','솔#','라','시♭','시']; /* 반음 계이름은 오선보 철자와 같게 ♯1·♭3·♯4·♯5·♭7 (레#·라# 는 증2도·증6도 철자라 단3도·단7도 위 음에 쓰지 않음) */
const IV_ITEMS=[],TR_ITEMS=['메이저','마이너','디미니시','오그먼트'].map(n=>'tr:'+n),SV_ITEMS=SV_ALL.map(q=>'sv:'+q[0]),TK_ITEMS=['tk:1','tk:2'],DG_ITEMS=SOLF.map((_,i)=>'dg:'+i),CD_ITEMS=CD_ALL.map(x=>'cd:'+x),FN_ITEMS=FN_ALL.map(x=>'fn:'+x),INVR_ITEMS=[0,1,2].map(x=>'inv:'+x),RD_ITEMS=['g','f'].flatMap(c=>['in','up','dn'].map(z=>'rd:'+c+'-'+z));for(const [n] of INTERVALS)for(const d of DIRS)IV_ITEMS.push('iv:'+n+':'+d);
const KIND_OF={mp:'ear',iv:'ear',tr:'ear',sv:'ear',dg:'ear',tk:'ear',cd:'ear',fn:'ear',inv:'ear',rd:'ear',md2:'ear',pg:'prog',md:'mel',sg:'sight',rh:'rhy',rt:'rhy',pm:'pitch'},KIND_LAB={ear:'음정·화음 듣기',prog:'코드 진행',mel:'멜로디 받아쓰기',rhy:'리듬',sight:'시창',pitch:'음정 부르기'};
const rdLab=z=>/^[gf]-(in|up|dn)$/.test(z)?(z[0]==='g'?'높은음자리표':'낮은음자리표')+' '+RD_Z[z.slice(2)]:null;
const SPQ={ear:15,prog:45,mel:40,rhy:30,sight:40,pitch:30}; // 문제당 예상 초 (블록 최대 문제 수 = 시간/이 값)
/* ---------- 단계 진도(승급): 음정·3화음·7화음·음계 도수 퀴즈에서 활성 항목을 적게 시작해 하나씩 연다 ----------
   저장 pr-ladder1 = {v:1,t:{<종류>:{on:0|1,k:활성 항목 수,h:[최근 결과 0|1, 최대 20]}}}. 승급: 켠 종류에서 답한 문제 12개 이상이고 최근 20문제(활성 항목 기준) 정답률 90% 이상이면 k+1 하고 h 를 비운다(새 항목 집합으로 다시 잰다).
   강등 없음(약점 가중이 처리). 시작 항목 수: 음정·음계 도수 4, 3화음 2(메이저·마이너), 7화음 3. 순서는 서로 확연히 다른 것부터(음정: 5도·8도·3도 / 도수: 1·3·5·2 …, 반음계 음은 단3→단7→단6→감5→단2) */
const LAD_TYPES=['interval','triad','seventh','degree'],LAD_WIN=20,LAD_MIN=12,LAD_PCT=.9,LAD_N0={interval:4,triad:2,seventh:3,degree:4};
const LAD_ORDER={interval:['완전5도','옥타브','장3도','단3도','완전4도','장2도','장6도','단6도','장7도','단7도','단2도','증4도'],triad:['메이저','마이너','디미니시','오그먼트'],seventh:['도미넌트7','메이저7','마이너7','하프 디미니시','디미니시7'],degree:[0,4,7,2,5,9,11,3,10,8,6,1]};
const LAD_DIRS=['asc','desc','har'],LAD_DIR_KO=['상행','하행','화성(동시)'];/* 음정만 방향 단계 d: 0 상행 → 1 하행 → 2 화성(동시). 각 방향에서 항목을 4→12개로 열고 12개가 다 열린 뒤 승급 기준을 채우면 다음 방향(항목 4개부터, 화성은 12개 전부). d 없는 옛 저장은 상행 */
const ladNew=()=>({v:1,t:{}}),ladOf=(L,ty)=>L&&L.t&&L.t[ty]||null;
function ladClean(v){const o=ladNew();if(!v||typeof v!=='object'||Array.isArray(v)||v.v!==1||!v.t||typeof v.t!=='object')return o;
 for(const ty of LAD_TYPES){const r=v.t[ty];if(!r||typeof r!=='object')continue;const n=LAD_ORDER[ty].length,kk=Math.floor(+r.k);o.t[ty]={on:r.on?1:0,k:Math.max(LAD_N0[ty],Math.min(n,isFinite(kk)?kk:LAD_N0[ty])),h:(Array.isArray(r.h)?r.h:[]).filter(x=>x===0||x===1).slice(-LAD_WIN)};
  if(ty==='interval'){const dd=Math.floor(+r.d);o.t[ty].d=Math.max(0,Math.min(2,isFinite(dd)?dd:0));if(o.t[ty].d===2)o.t[ty].k=n}}
 return o}
function ladSet(L,ty,on){const o=ladClean(L),r=o.t[ty]||(o.t[ty]=ty==='interval'?{on:0,k:LAD_N0[ty],h:[],d:0}:{on:0,k:LAD_N0[ty],h:[]});r.on=on?1:0;return o}
const ladOn=(L,ty)=>!!(ladOf(L,ty)&&ladOf(L,ty).on);
/* 음정 사다리가 켜져 있을 때 방향 단계의 방향('asc'|'desc'|'har'), 아니면 null */
const ladDir=L=>{const r=ladOf(L,'interval');return r&&r.on?LAD_DIRS[r.d|0]||'asc':null};
/* 켠 종류의 활성 항목 목록(음정·3화음·7화음은 이름, 도수는 반음 수). 꺼져 있으면 null */
function ladItems(L,ty){const r=ladOf(L,ty);return r&&r.on&&LAD_ORDER[ty]?LAD_ORDER[ty].slice(0,r.k):null}
/* 한 문제 결과 기록 → {L,promoted:새로 열린 항목|null}. 꺼진 종류는 그대로 */
function ladRec(L,ty,ok){const o=ladClean(L),r=o.t[ty];if(!r||!r.on)return {L:o,promoted:null};const ord=LAD_ORDER[ty];r.h=r.h.concat(ok?1:0).slice(-LAD_WIN);
 const acc=r.h.reduce((a,x)=>a+x,0)/r.h.length;let promoted=null;
 let stageUp=null;if(r.h.length>=LAD_MIN&&acc>=LAD_PCT-1e-9){if(r.k<ord.length){promoted=ord[r.k];r.k++;r.h=[]}
  else if(ty==='interval'&&(r.d|0)<2){r.d=(r.d|0)+1;r.k=r.d===2?ord.length:LAD_N0[ty];r.h=[];stageUp=LAD_DIR_KO[r.d]}}
 return {L:o,promoted,stageUp}}
const ladLab=(ty,it)=>ty==='degree'?'「'+SOLF[it]+'」':String(it);
function ladStatus(L,ty){const r=ladOf(L,ty),ord=LAD_ORDER[ty];if(!ord)return null;const on=!!(r&&r.on),k=r?r.k:LAD_N0[ty],h=r?r.h:[],n=h.length,acc=n?h.reduce((a,x)=>a+x,0)/n:null,next=k<ord.length?ord[k]:null;
 const d=ty==='interval'&&r?r.d|0:0,dk=ty==='interval'?LAD_DIR_KO[d]:null,nd=ty==='interval'&&d<2?LAD_DIR_KO[d+1]:null;
 const text=on?`${dk?'단계: '+dk+' · ':''}활성 ${k}/${ord.length} 항목 · 최근 20문제 ${acc==null?'—':Math.round(acc*100)+'%'}${n?` (${n}문제 답함)`:''} · ${next==null?(nd?'모든 항목이 열렸습니다 · 다음 단계: '+nd:'모든 항목이 열렸습니다'):'다음 항목: '+ladLab(ty,next)}`:'';
 return {on,k,total:ord.length,n,acc,next,nextLabel:next==null?null:ladLab(ty,next),text,dir:dk?LAD_DIRS[d]:null,dirLabel:dk,stage:d}}
/* 음정 소리 느낌 한마디(기억 보조: 개인차 있음) */
const IV_FEEL={'단2도':'거칠게 부딪힘','장7도':'거칠게 부딪힘','장2도':'살짝 부딪힘','단7도':'살짝 부딪힘','단3도':'달콤함','장3도':'달콤함','단6도':'달콤함','장6도':'달콤함','완전4도':'비어 있는 소리','완전5도':'비어 있는 소리','옥타브':'비어 있는 소리','증4도':'불안정'};
const ivFeel=n=>IV_FEEL[n]?'소리 느낌(기억 보조): 「'+IV_FEEL[n]+'」':null;
const kindOf=id=>KIND_OF[String(id).split(':')[0]]||null;
const clamp01=x=>Math.max(0,Math.min(1,+x||0));
const newStats=()=>({v:2,items:{},conf:{}});
/* v2: 저장된 pr-stats2(없거나 깨졌으면 null), old: 옛 pr-stats {drill:{n,h}}. v2 가 유효하면 그것을 정리해 쓰고, 아니면 옛 기록을 all:<drill> 로 이관 */
function migrateStats(v2,old,cap=60){const s=newStats();
 if(v2&&typeof v2==='object'&&v2.v===2&&v2.items&&typeof v2.items==='object'){
  for(const id of Object.keys(v2.items)){const r=v2.items[id];if(r&&Array.isArray(r.h)){const h=r.h.filter(x=>typeof x==='number'&&isFinite(x)).map(clamp01).slice(-cap);s.items[id]={n:Math.max(h.length,+r.n|0),h}}}
  if(v2.conf&&typeof v2.conf==='object')for(const id of Object.keys(v2.conf)){const c=v2.conf[id];if(c&&typeof c==='object'){const o={};for(const k of Object.keys(c))if(isFinite(c[k])&&c[k]>0)o[k]=Math.floor(c[k]);const ks=Object.keys(o).sort((a,b)=>o[b]-o[a]);for(const k of ks.slice(12))delete o[k];if(ks.length)s.conf[id]=o}} /* 기록 때와 같은 상한 12(가져오기·합치기 후에도) */
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
const extraEar=only=>[['tr:',TR_ITEMS],['sv:',SV_ITEMS],['dg:',DG_ITEMS],['tk:',TK_ITEMS],['cd:',CD_ITEMS],['fn:',FN_ITEMS],['inv:',INVR_ITEMS],['rd:',RD_ITEMS],['md2:',MD2_ITEMS],['mp:',MP_ITEMS]].flatMap(([pf,a])=>only&&only.some(i=>i.startsWith(pf))?a:[]);
const sd=R=>Math.floor(R()*4294967294)+1;
function weakest(wk,pool,n,R){const seen=pool.filter(id=>wk[id]&&wk[id].n>=1).sort((x,y)=>wk[y].rate-wk[x].rate||wk[y].n-wk[x].n||(x<y?-1:1)).slice(0,n);
 const rest=pool.filter(id=>!seen.includes(id));while(seen.length<n&&rest.length)seen.push(rest.splice(Math.floor(R()*rest.length),1)[0]);return seen}
/* 블록 종류별 문제 한 개 생성(JSON 으로 저장 가능). ear: 음정·화음, prog: 코드 진행(후보 8개 중 약점 가중 추첨), mel/sight: 2마디 멜로디(후보 6개) */
function genQuestion(kind,{key=0,wk={},R,focus=null,only=null,lo=52,hi=67}={}){const W=id=>weightFor(wk,id,{only,focus});
 if(kind==='ear'){let pool=IV_ITEMS.concat(extraEar(only));if(only&&only.length){const o=pool.filter(i=>only.includes(i));if(o.length)pool=o}
  const item=pickWeighted(pool,pool.map(W),R),p=item.split(':');return item.startsWith('tr:')?{kind,type:'triad',name:p[1],item,seed:sd(R)}:item.startsWith('sv:')?{kind,type:'seventh',name:p[1],item,seed:sd(R)}:item.startsWith('tk:')?{kind,type:'tonic',level:+p[1],item,seed:sd(R)}:item.startsWith('cd:')?{kind,type:'cadence',name:p[1],item,seed:sd(R)}:item.startsWith('fn:')?{kind,type:'func',name:p[1],item,seed:sd(R)}:item.startsWith('inv:')?{kind,type:'inversion',name:p[1],item,seed:sd(R)}:item.startsWith('rd:')?{kind,type:'reading',name:p[1],level:2,item,seed:sd(R)}:item.startsWith('md2:')?{kind,type:'mode',name:p[1],level:2,item,seed:sd(R)}:item.startsWith('mp:')?{kind,type:'missing',name:p[1],level:2,item,seed:sd(R)}:item.startsWith('dg:')?{kind,type:'degree',name:SOLF[+p[1]],item,seed:sd(R)}:{kind,type:'interval',name:p[1],dir:p[2],item,seed:sd(R)}}
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
const jong=w=>{const t=String(w),l=t.slice(-1),c=t.charCodeAt(t.length-1)-44032;if(/[#♯b♭]/.test(l))return 1;/* 샵·플랫으로 읽으면 받침 있음 */if(/[0-9]/.test(l))return '178'.includes(l)?2:'036'.includes(l)?1:0;/* 일·칠·팔 ㄹ, 영·삼·육 받침 */return c>=0&&c<11172?(c%28===0?0:c%28===8?2:1):0};
const eul=w=>w+(jong(w)?'을':'를'),ro=w=>w+(jong(w)===1?'으로':'로');
const PM_SAME='동음',PM_HAR='화음',HK_LAB={'3up':'3도 위','3down':'3도 아래','5':'5도 위'},pmLab=(iv,d)=>iv===PM_HAR?`화음 부르기 ${HK_LAB[d]||d}`:d==='same'||iv===PM_SAME?'같은 음 내기':`${iv} ${d==='desc'?'아래로':'위로'} 부르기`;
const ivLab=(n,d)=>d==='har'?n+' 동시 화음':n+' '+DIR_KO[d],stepKo=s=>+s===0?'같은 음 반복':(s>0?'위로 ':'아래로 ')+Math.abs(s)+'반음 진행';
/* 항목 id 를 쉬운 한국어 문장으로. 혼동 쌍(conf)에서 가장 자주 고른 오답이 2번 이상이고 오답의 40% 이상이면 "자주 ~로 고릅니다" */
function explain(id,conf,rate){const p=String(id).split(':'),c=conf&&conf[id]||{},ks=Object.keys(c).sort((a,b)=>c[b]-c[a]),tot=ks.reduce((a,k)=>a+c[k],0),top=ks[0],often=top!=null&&c[top]>=2&&c[top]/tot>=.4,pct=rate!=null?` (오답률 ${Math.round(rate*100)}%)`:'';
 if(p[0]==='iv'){const l=ivLab(p[1],p[2]);return often?`${eul(l)} 자주 ${ro(top)} 고릅니다.`:`${l}의 정답률이 낮습니다${pct}.`}
 if(p[0]==='tr'){const l=p[1]+' 3화음';return often?`${eul(l)} 자주 ${ro(top)} 고릅니다.`:`${l} 정답률이 낮습니다${pct}.`}
 if(p[0]==='sv'){const l=p[1]+' 7화음';return often?`${eul(l)} 자주 ${ro(top)} 고릅니다.`:`${l} 정답률이 낮습니다${pct}.`}
 if(p[0]==='tk'){const l=TK_LAB[p[1]];if(!l)return String(id);return often?`으뜸음 찾기(${l})에서 으뜸음을 자주 「${top}」${jong(top)===1?'으로':'로'} 고릅니다.`:`으뜸음 찾기(${l}) 정답률이 낮습니다${pct}.`}
 if(p[0]==='cd'){const l=CD_T[p[1]]&&CD_T[p[1]].ko;if(!l)return String(id);return often?`카덴스 듣기에서 「${l}」${jong(l)?'을':'를'} 자주 「${top}」${jong(top)===1?'으로':'로'} 고릅니다.`:`카덴스 듣기에서 「${l}」 정답률이 낮습니다${pct}.`}
 if(p[0]==='fn'){const l=FN_KO[p[1]];if(!l)return String(id);return often?`화음 기능 듣기에서 「${l}」 화음을 자주 「${top}」${jong(top)===1?'으로':'로'} 고릅니다.`:`화음 기능 듣기에서 「${l}」 화음의 정답률이 낮습니다${pct}.`}
 if(p[0]==='inv'){const l=INV_KO[+p[1]];if(!l)return String(id);return often?`전위 듣기에서 「${l}」${jong(l)?'을':'를'} 자주 「${top}」${jong(top)===1?'으로':'로'} 고릅니다.`:`전위 듣기에서 「${l}」 정답률이 낮습니다${pct}.`}
 if(p[0]==='rd'){const l=rdLab(p[1]);if(!l)return String(id);return often?`악보 읽기(${l})에서 자주 「${top}」${jong(top)===1?'으로':'로'} 읽습니다.`:`악보 읽기(${l}) 정답률이 낮습니다${pct}.`}
 if(p[0]==='md2'){const m=MODES[p[1]]&&MODES[p[1]].ko;if(!m)return String(id);return often?`모드 식별에서 「${m}」${jong(m)?'을':'를'} 자주 「${top}」${jong(top)===1?'으로':'로'} 고릅니다.`:`모드 식별에서 「${m}」 정답률이 낮습니다${pct}.`}
 if(p[0]==='mp'){const m=mpParts(p[1]);if(!m)return String(id);const l=m.map(x=>MP_GEN[x]).join(' + ');return often?`빠진 파트 찾기에서 「${l}」${jong(l)?'이':'가'} 빠졌을 때 자주 「${top}」${jong(top)===1?'으로':'로'} 고릅니다.`:`빠진 파트 찾기에서 「${l}」${jong(l)?'이':'가'} 빠졌을 때 정답률이 낮습니다${pct}.`}
 if(p[0]==='dg'){const n=SOLF[+p[1]];if(!n)return String(id);return often?`음계 도수 듣기에서 「${n}」${jong(n)?'을':'를'} 자주 「${top}」라고 고릅니다.`:`음계 도수 듣기에서 「${n}」 음의 정답률이 낮습니다${pct}.`}
 if(p[0]==='pg')return often?`${+p[2]+1}번째 코드가 「${p[1]}」일 때 자주 「${top}」라고 적습니다.`:`${+p[2]+1}번째 칸의 「${p[1]}」 정답률이 낮습니다${pct}.`;
 if(p[0]==='md'&&p[1][0]==='d'){const n=SOLF[+p[1].slice(1)];return often?`받아쓰기에서 「${n}」${jong(n)?'을':'를'} 자주 「${top}」라고 적습니다.`:`받아쓰기에서 「${n}」 음의 정답률이 낮습니다${pct}.`}
 if(p[0]==='md'){const s=+p[1].slice(1);return often?`받아쓰기에서 ${eul(stepKo(s))} 자주 「${stepKo(+top)}」이라고 듣습니다.`:`받아쓰기에서 ${stepKo(s)} 정답률이 낮습니다${pct}.`}
 if(p[0]==='sg'&&p[1]==='v')return p[2]==='hi'?`시창에서 목표보다 높게 부르는 경향이 있습니다${pct}.`:`시창에서 목표보다 낮게 부르는 경향이 있습니다${pct}.`;
 if(p[0]==='sg'){const n=SOLF[+p[1].slice(1)];return often?`시창에서 「${n}」${jong(n)?'을':'를'} 자주 ${top==='옥타브'?'옥타브 어긋나게':top+' '}부릅니다.`.replace('  ',' '):`시창에서 「${n}」 음이 자주 어긋납니다${pct}.`}
 if(p[0]==='pm'){const l=pmLab(p[1],p[2]);return often?(top==='옥타브'?`${l}에서 자주 옥타브가 어긋납니다.`:`${l}에서 자주 ${top} 부릅니다.`):`${l}가 자주 어긋납니다${pct}.`}
 if(p[0]==='rh'){const c=RCELLS[p[1]];if(!c)return String(id);return often?`리듬 받아쓰기에서 「${c.ko}」 칸을 자주 「${top}」${jong(top)===1?'으로':'로'} 적습니다.`:`리듬 받아쓰기에서 「${c.ko}」 정답률이 낮습니다${pct}.`}
 if(p[0]==='sd'){const l=DICT_LAB[p[1]];if(!l)return String(id);return `곡 받아쓰기(${l})의 정답률이 낮습니다${pct}.`}
 if(p[0]==='rt'){const l=RCAT_LAB[p[1]];if(!l)return String(id);if(p[2]==='late')return `${l}에서 늦게 칩니다${pct}.`;if(p[2]==='early')return `${l}에서 빠르게 칩니다${pct}.`;return `${l} 타이밍이 자주 어긋납니다${pct}.`}
 return String(id)}
/* 항목 id 의 짧은 이름 (집중 항목 표시용) */
function itemLabel(id){const p=String(id).split(':');
 if(p[0]==='iv')return ivLab(p[1],p[2]);if(p[0]==='tr')return p[1]+' 3화음';if(p[0]==='sv')return p[1]+' 7화음';if(p[0]==='tk')return TK_LAB[p[1]]?`으뜸음 찾기 ${p[1]}단계`:String(id);if(p[0]==='cd')return CD_T[p[1]]?`카덴스 ${CD_T[p[1]].ko}`:String(id);if(p[0]==='fn')return FN_KO[p[1]]?`화음 기능 ${FN_KO[p[1]]}`:String(id);if(p[0]==='inv')return INV_KO[+p[1]]?`전위 ${INV_KO[+p[1]]}`:String(id);if(p[0]==='rd')return rdLab(p[1])?`악보 읽기 ${rdLab(p[1])}`:String(id);if(p[0]==='md2')return MODES[p[1]]?`모드 식별 ${MODES[p[1]].ko}`:String(id);if(p[0]==='mp'){const m=mpParts(p[1]);return m?`빠진 파트 ${m.map(x=>MP_GEN[x]).join(' + ')}`:String(id)}if(p[0]==='dg')return SOLF[+p[1]]?`도수 「${SOLF[+p[1]]}」`:String(id);if(p[0]==='pg')return `${+p[2]+1}번째 칸 ${p[1]}`;
 if(p[0]==='md')return p[1][0]==='d'?`받아쓰기 「${SOLF[+p[1].slice(1)]}」`:`받아쓰기 ${stepKo(+p[1].slice(1))}`;
 if(p[0]==='sg')return p[1]==='v'?(p[2]==='hi'?'시창 높게 부름':'시창 낮게 부름'):`시창 「${SOLF[+p[1].slice(1)]}」`;
 if(p[0]==='pm')return pmLab(p[1],p[2]);
 if(p[0]==='sd')return DICT_LAB[p[1]]?`곡 받아쓰기 ${DICT_LAB[p[1]]}`:String(id);
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

/* ---------- 곡 받아쓰기(이 곡에서): 현재 곡의 층(보컬 멜로디 추정·채보 음·베이스)에서 1–2마디 창을 골라 받아쓴다. 음높이 순서만 채점(박자 제외) ---------- */
const DICT_LAB={vocal:'보컬 멜로디(추정)',score:'채보 음',bass:'베이스'},DICT_LAYERS=['vocal','score','bass'];
/* 단선율화(윗음): [from,to) 박 안에서 시작하는 음만, 절대 박 위치·원래 음높이 유지(옥타브 이동 없음) */
function dictMono(notes,{from=0,to=Infinity}={}){return topLine(Array.isArray(notes)?notes:[],{from,to,fixed:true}).map(n=>[Math.round((n[0]+from)*1e4)/1e4,n[1],n[2]])}
/* 창 목록: size 마디씩 겹치지 않게 자르고, 단선율 음이 min..max 개인 창만 쓴다. 반환 [{a,b,n,notes}] (a,b = 시작·끝 마디 인덱스, notes 절대 박) */
function dictWindows(notes,bars,{size=2,min=3,max=12}={}){const out=[];size=size===1?1:2;for(let a=0;a<(bars|0);a+=size){const b=Math.min(bars,a+size),m=dictMono(notes,{from:a*4,to:b*4});if(m.length>=min&&m.length<=max)out.push({a,b,n:m.length,notes:m})}return out}
/* 층마다 쓸 수 있는 창 수 {vocal:n,…} (창이 0이면 그 층은 못 씀) */
function dictLayers(parts,bars,size=2){const o={};for(const l of DICT_LAYERS){const ns=parts&&parts[l];if(ns&&ns.length){const w=dictWindows(ns,bars,{size});if(w.length)o[l]=w.length}}return o}
/* 입력 건반(C4–C5) 안으로: 접지 않고 들어가는 옥타브가 있으면 그쪽으로, 없으면 가장 낮은 음이 lo..lo+11 에 오도록 옮기고 hi 를 넘는 음은 한 옥타브씩 접는다. 시작은 창 첫 마디 = 0. 반환 {ex:[시작박,길이박,midi],folded} */
function dictRef(win,{lo=60,hi=72}={}){const ns=win&&win.notes||[];if(!ns.length)return {ex:[],folded:false};const from=win.a*4,ps=ns.map(n=>n[2]),mn=Math.min(...ps),mx=Math.max(...ps);let sh=12*Math.ceil((lo-mn)/12),folded=false;
 for(let k=-6;k<=6;k++)if(mn+12*k>=lo&&mx+12*k<=hi&&(!(mn+sh>=lo&&mx+sh<=hi)||Math.abs(12*k-(60-mn))<Math.abs(sh-(60-mn))))sh=12*k; /* 접지 않고 들어가는 옥타브가 있으면 그것(여럿이면 60 에 가까운 쪽) */

 const ex=ns.map(n=>{let p=n[2]+sh;while(p>hi){p-=12;folded=true}return [Math.round((n[0]-from)*1e4)/1e4,n[1],p]});return {ex,folded}}
/* 다음 창 위치. done: 이미 푼 창의 a 집합(Set). dir>0 뒤로, <0 앞으로, 끝에서 돌아온다. skip 이 참이면 안 푼 창만, 전부 풀었으면 바로 옆 */
function dictNext(wins,done,cur,dir=1,skip=true){const n=wins.length;if(!n)return -1;const d=dir<0?-1:1,c=cur==null||cur<0?(d>0?-1:n):cur;
 if(skip)for(let k=1;k<=n;k++){const i=(((c+d*k)%n)+n)%n;if(!done||!done.has(wins[i].a))return i}
 return (((c+d)%n)+n)%n}
/* 채점: ex[0] 은 주어진 첫 음. ans[i] 와 ex[i][2] 를 비교(둘째 음부터). 반환 {n,ok,frac,marks:[null|true|false]} */
function dictGrade(ex,ans){const n=Math.max(0,ex.length-1);let ok=0;const marks=ex.map((x,i)=>{if(!i)return null;const c=!!ans&&ans[i]===x[2];if(c)ok++;return c});return {n,ok,frac:n?ok/n:0,marks}}
/* 창의 원곡 음원 구간(초). 음원 시간 = 박 x 60/bpm (재생 위치 규칙과 같음) */
/* 받아쓰기 오답 진단(순수): ans·user 는 음높이 배열 또는 [시작,길이,음높이] 음 배열. 첫 음(0번)은 주어진 음이라 1번부터 비교.
   cat: cascade(한 음이 틀린 뒤 나머지 음정은 맞음) · octave · interval(앞 정답 음 기준 음정 1–2반음 차) · contour(방향) · repeat(자기 입력의 반복 짐작) · count(음 개수). idx 는 0 기준 음 번호 */
function dictDiag(ans,user,{key=0}={}){const P=a=>(Array.isArray(a)?a:[]).map(x=>Array.isArray(x)?x[2]:x),A=P(ans),U=P(user),out=[],sg=Math.sign;
 const miss=i=>U[i]==null,bad=[];for(let i=1;i<A.length;i++)if(!miss(i)&&U[i]!==A[i])bad.push(i);
 const add=(cat,idx,detail)=>{if(idx.length)out.push({cat,count:idx.length,idx,detail:detail||[]})};
 let casc=null;if(bad.length>=2){const f=bad[0],d=U[f]-A[f];let ok=d%12!==0;for(let i=f;i<A.length&&ok;i++)if(miss(i)||U[i]-A[i]!==d)ok=false;if(ok)casc={from:f,off:d}}
 if(casc){add('cascade',bad,[{from:casc.from,off:casc.off}])}
 else{const oc=[],iv=[],ct=[];for(const i of bad){const a=A[i]-A[i-1],u=U[i]-A[i-1];
   if((U[i]-A[i])%12===0)oc.push(i);else if(sg(u)!==sg(a))ct.push(i);else if(a!==0&&Math.abs(u-a)<=2)iv.push(i)}
  add('octave',oc);add('interval',iv,iv.map(i=>({i,a:A[i]-A[i-1],u:U[i]-A[i-1]})));add('contour',ct,ct.map(i=>({i,a:sg(A[i]-A[i-1]),u:sg(U[i]-A[i-1])})));
  const rp=bad.filter(i=>{if(i<2)return false;for(let k=1;k<i;k++)if(U[i]===U[k]&&U[i-1]===U[k-1]&&A[i]!==A[k])return true;return false});add('repeat',rp)}
 if(U.length!==A.length)out.push({cat:'count',count:Math.abs(A.length-U.length),idx:[],detail:[{ans:A.length,user:U.length}]});
 return out}
const DD_ORDER=['cascade','octave','interval','contour','repeat','count'];
function ivNameSt(n){const a=Math.abs(n);if(a===0)return '같은 음';const e=INTERVALS.find(x=>x[1]===a);return e?`${e[0]} ${n>0?'위':'아래'}(${a}반음)`:`${a}반음 ${n>0?'위':'아래'}`}
/* 진단 -> 짧은 안내문 최대 max 개(우선순위: 연쇄·옥타브·음정 크기·방향·반복·개수) */
function dictHints(diag,{max=2,key=0}={}){const by={};for(const d of diag||[])by[d.cat]=d;const out=[];
 for(const c of DD_ORDER){const d=by[c];if(!d||out.length>=max)continue;const i0=d.idx[0]+1;
  if(c==='cascade')out.push(`${d.detail[0].from+1}번째 음부터 모두 같은 만큼 어긋났습니다. 한 음이 틀린 뒤 나머지 음정은 맞음: 시작 기준만 고치면 됩니다.`);
  else if(c==='octave')out.push(`${i0}번째 음${d.count>1?' 등':''}: 음 이름은 맞고 옥타브가 다릅니다. 앞 음과 비교해 위인지 아래인지 먼저 정하세요.`);
  else if(c==='interval'){const x=d.detail[0];out.push(`${x.i+1}번째 음: 정답은 앞 음에서 ${ivNameSt(x.a)}, 입력은 ${ivNameSt(x.u)}.`)}
  else if(c==='contour'){const x=d.detail[0],w=v=>v>0?'위':v<0?'아래':'같은 높이';out.push(`${x.i+1}번째 음: 정답은 앞 음에서 ${w(x.a)}로 가는데 입력은 ${w(x.u)}입니다. 방향부터 다시 들어 보세요.`)}
  else if(c==='repeat')out.push(`${i0}번째 음: 앞 도막과 반복처럼 보여도 매번 직접 확인하세요.`);
  else if(c==='count')out.push(`입력한 음이 ${d.detail[0].user}개, 정답은 ${d.detail[0].ans}개입니다.`)}
 return out}
function dictSpan(win,bpm){const spb=60/(bpm||100);return {t0:win.a*4*spb,t1:win.b*4*spb}}
/* 층 -> 스템 파트 키. 받아쓰기 층 score(채보 음)=score 스템, bass=bass 스템. 보컬 층·스템 없는 곡은 null */
const DICT_STEM={score:'score',bass:'bass'};
function dictStemFor(layer,stems){const k=DICT_STEM[layer];return k&&stems&&typeof stems[k]==='string'&&stems[k]?k:null}
/* 스템 버퍼에서의 창 구간(초). 스템은 카운트인 없이 0박 = 0초라 dictSpan 과 같은 규칙(박 x 60/bpm). dur 가 있으면 끝을 버퍼 길이로 제한.
   반환 {t0,t1,len,wall}: len = 버퍼에서 읽을 길이, wall = 속도 rate 로 재생할 때 걸리는 실제 시간 */
function dictStemSpan(win,bpm,{dur=Infinity,rate=1}={}){const {t0,t1:e}=dictSpan(win,bpm),t1=Math.min(e,dur),len=Math.max(0,t1-t0);return {t0,t1,len,wall:len/(rate>0?rate:1)}}

/* ---------- 청음 「빠진 파트 찾기」(mp:): 대표 샘플(스템 4개: score·keys·bass·drums)의 1–2마디 창을 전체 소리로 들은 뒤, 같은 창에서 한 파트(3난이도는 두 파트)를 뺀 소리를 듣고 빠진 파트를 고른다.
   난이도 1: 2마디 창, 멜로디·베이스·드럼 중 하나(보기 3개, 건반은 늘 들어 있음) / 2: 1마디 창, 4파트 중 하나(보기 4개) / 3: 1마디 창, 두 파트(보기 4개, 짝 이름). 통계 id mp:<파트> · mp:<파트>-<파트>(파트 순서 score,keys,bass,drums).
   빠지는 파트는 창 안에서 실제로 소리가 있는 파트(악보 음 기준, 앱은 스템 RMS 로 한 번 더 확인)만, 남는 파트도 2개 이상 소리가 있어야 한다. 순수 함수 ---------- */
const MP_PARTS=['score','keys','bass','drums'],MP_L1=['score','bass','drums'],MP_GEN={score:'멜로디',keys:'코드 스탭',bass:'베이스',drums:'드럼·킥'};
const MP_LAB={nova:{score:'리드',keys:'스탭',bass:'베이스',drums:'킥'},summersong:{score:'리드',keys:'스탭',bass:'베이스',drums:'킥'},eot:{score:'플럭',keys:'스탭',bass:'베이스',drums:'드럼'}};
const MP_PAIRS=[];for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)MP_PAIRS.push(MP_PARTS[i]+'-'+MP_PARTS[j]);
const MP_ITEMS=MP_PARTS.concat(MP_PAIRS).map(x=>'mp:'+x);
/* 곡별 파트 이름 {score,keys,bass,drums}. 모르는 곡은 melName(첫 낱말)·일반 이름 */
function mpLabels(sg){const t=sg&&MP_LAB[sg.id];if(t)return {...t};const mn=sg&&typeof sg.melName==='string'&&sg.melName?sg.melName.split(/\s+/)[0]:'';return {score:mn||'멜로디',keys:'코드',bass:'베이스',drums:'드럼'}}
const mpName=(items,lab)=>items.map(p=>lab[p]).join(' + ');
/* 창 [a,b) 마디 안에서 이 파트의 음이 시작하거나(킥처럼 짧은 음) 0.5박 이상 걸쳐 있는가(악보 층 기준) */
function mpHas(sg,p,a,b){const ns=sg&&sg.parts&&sg.parts[p];if(!Array.isArray(ns))return false;const x=a*4,y=b*4;return ns.some(n=>(n[0]>=x-1e-9&&n[0]<y-1e-9)||Math.min(n[0]+(n[1]>0?n[1]:0),y)-Math.max(n[0],x)>=.5)}
/* 항목 id 의 파트들: 'bass' -> ['bass'], 'score-bass' -> ['score','bass'], 잘못된 값 -> null */
function mpParts(x){const k=String(x==null?'':x).split('-');if(!k.length||k.length>2||!k.every(p=>MP_PARTS.includes(p)))return null;if(k.length===2&&MP_PARTS.indexOf(k[0])>=MP_PARTS.indexOf(k[1]))return null;return k}
/* songs: [{id,short,bpm,bars,parts,stems,melName}] (stems 에 4파트가 모두 있는 곡만 씀). has(곡,파트,a,b): 소리 있음 판정(기본 악보 음). name: 항목 지정(루틴). 쓸 곡이 없으면 null */
function missingQuiz({level=1,seed=1,songs=[],name=null,weight=null,has=null}={}){
 const R=rng(seed);for(let i=0;i<4;i++)R();const ss=(Array.isArray(songs)?songs:[]).filter(s=>s&&s.stems&&MP_PARTS.every(p=>typeof s.stems[p]==='string'&&s.stems[p])&&s.bars>=1&&s.bpm>0);if(!ss.length)return null;
 const nm=name!=null?mpParts(name):null;let lv=level>=3?3:level<2?1:2;if(nm)lv=nm.length===2?3:(lv===1&&MP_L1.includes(nm[0])?1:2);
 const size=lv===1?2:1,H=has||mpHas,cands=lv===1?MP_L1.map(p=>[p]):lv===2?MP_PARTS.map(p=>[p]):MP_PAIRS.map(x=>x.split('-')),combos=[];
 for(const s of ss)for(let a=0;a+size<=s.bars;a++)for(const m of cands){const b=a+size;if(!m.every(p=>H(s,p,a,b)))continue;if(MP_PARTS.filter(p=>!m.includes(p)&&H(s,p,a,b)).length<2)continue;combos.push({s,a,b,m})}
 if(!combos.length)return null;
 const idOf=m=>'mp:'+m.join('-'),ids=[...new Set(combos.map(c=>idOf(c.m)))],want=nm&&ids.includes(idOf(nm))?idOf(nm):pickWeighted(ids,weight?ids.map(x=>weight(x)):null,R),pool=combos.filter(c=>idOf(c.m)===want),c=pool[Math.floor(R()*pool.length)];
 const lab=mpLabels(c.s),shuf=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
 const opts=lv===3?[c.m].concat(shuf(MP_PAIRS.map(x=>x.split('-')).filter(x=>x.join('-')!==c.m.join('-'))).slice(0,3)):cands;
 const ch=shuf(opts.slice()),answer=mpName(c.m,lab),spb=60/c.s.bpm;
 return {type:'missing',level:lv,song:c.s.id,songName:c.s.short||c.s.id,a:c.a,b:c.b,size,bpm:c.s.bpm,t0:c.a*4*spb,t1:c.b*4*spb,mutes:c.m.slice(),present:MP_PARTS.filter(p=>!c.m.includes(p)),
  answer,choices:ch.map(m=>mpName(m,lab)),keys:ch.map(m=>m.join('-')),labels:lab,notes:[],label:(c.s.short||c.s.id)+' '+(c.a+1)+(size>1?'–'+c.b:'')+'마디',
  info:`${c.s.short||c.s.id} ${c.a+1}${size>1?'–'+c.b:''}마디에서 「${answer}」${c.m.length>1?' 두 파트를':' 파트를'} 뺀 소리였습니다`,item:want}}

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
function pmChordOf(key,r0,lo){let m=[0,2,4].map(k=>scMidi(key,r0+k));while(m[2]>lo)m=m.map(x=>x-12);while(m[0]<36)m=m.map(x=>x+12);/* 낮은 내 음역이면 뿌리가 20–30Hz(서브소닉)까지 내려가므로 C2(MIDI 36) 아래는 한 옥타브씩 올린다 */const dg=((r0%7)+7)%7;return {rootDeg:dg,midis:m,pcs:m.map(x=>((x%12)+12)%12),name:pcName(m[0],key)+QL[dg],q:QL[dg]}} /* 이름은 조 철자(F 장조 IV = Bb, A# 아님) */
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
 if(!c.length){if(hi-lo<1){const ref=lo+Math.floor(R()*(hi-lo+1));return {mode:'same',ref,target:ref,iv:PM_SAME,dir:'same',semis:0,id:'pm:'+PM_SAME+':same'}}const s=Math.min(7,hi-lo),n=INTERVALS.find(x=>x[1]===s)[0];c=[[n,s,'asc']]} /* 좁은 음역: 들어가는 가장 큰 음정(최대 완전5도)으로 대신 */const W=wk?c.map(x=>weightFor(wk,'pm:'+x[0]+':'+x[2])):null,[n,s,d]=pickWeighted(c,W,R);
 const a=d==='asc'?lo:lo+s,b=d==='asc'?hi-s:hi,ref=a+Math.floor(R()*(Math.max(a,b)-a+1));
 return {mode:'iv',ref,target:ref+(d==='asc'?s:-s),iv:n,dir:d,semis:s,id:'pm:'+n+':'+d}}
/* 기록 [초,midi|null,conf] → 판정. 첫 발성(t0 이후 연속 run 프레임 이상 유성)의 skip 초 뒤부터 win 초 창에서 cent 중앙값을 낸다.
   창 안 유성 프레임이 8개 미만·60% 미만이거나 기록이 창 끝 전에 끝났거나 p10–p90 폭이 spread cent 초과면 '불안정'(기록 안 함). 옥타브 차이는 scoreTake 와 같은 기준(±1200±2·tol). */
function pmJudge(track,{target,t0=0,tol=TOL_DEFAULT,minConf=.5,skip=.15,win=.6,run=3,spread=160}={}){const tr=track.filter(f=>f[0]>=t0),mk=voicedMask(tr,{minRun:run,minConf}),vs=new Set(tr.filter((f,i)=>mk[i])),vo=f=>vs.has(f),on=mk.indexOf(true);
 const base={target,tol,onset:null,frames:0,voiced:0,medCents:null,devCents:null,spread:null,octave:false,ok:false,tier:null};if(on<0)return {...base,verdict:'소리 없음'};
 const a=tr[on][0]+skip,b=a+win,fr=tr.filter(f=>f[0]>=a&&f[0]<=b),v=fr.filter(vo),r={...base,onset:tr[on][0]-t0,frames:fr.length,voiced:v.length};
 if(v.length<1||wsum2(tr,v)<8-1e-9||v.length/fr.length<.6||tr[tr.length-1][0]<b-.05)return {...r,verdict:'불안정'};
 const c=v.map(f=>(f[1]-target)*100).sort((x,y)=>x-y),med=c[c.length>>1],sp=c[Math.floor(.9*(c.length-1))]-c[Math.floor(.1*(c.length-1))];
 if(sp>spread)return {...r,medCents:med,spread:sp,verdict:'불안정'};
 const oct=Math.abs(Math.abs(med)-1200)<tol*2,dev=oct?med-Math.sign(med)*1200:med,ok=!oct&&Math.abs(med)<=tol;
 return {...r,medCents:med,devCents:dev,spread:sp,octave:oct,ok,tier:ok?'맞음':oct?'벗어남':tolTier(dev,tol)==='맞음'?'가까움':tolTier(dev,tol),verdict:oct?'옥타브 차이':ok?'맞음':med>0?'높음':'낮음'}}
/* 판정 → 통계 [[id,frac,chosen]]. 소리 없음·불안정은 기록하지 않는다([]) */
function pmStatItems(q,res){if(!q||!res||res.medCents==null||res.leak||res.verdict==='불안정'||res.verdict==='소리 없음')return [];
 return [[q.id,res.ok?1:0,res.ok?null:res.octave?'옥타브':res.verdict==='높음'?'높게':'낮게']]}

/* ---------- 음역 찾기(순수 함수) ----------
   rangeFromTake: 한 번 부른 기록 [초,midi,conf] 에서 안정된 유성 프레임만 모아 p10(낮은 음) 또는 p90(높은 음)을 낸다.
   안정 = voicedMask 유성(이웃 유성 프레임과 ±100 cent 로 이어진 3프레임 이상 묶음, 잡음·옥타브 튐 제외)이고 MIDI 28–96. minConf 는 YIN 곡선에선 효력 없는 안전 문턱. 그 뒤 중앙값에서 ±maxDev 반음 넘는 프레임도 뺀다. 안정 프레임이 minFrames(20 ms 간격 기준 0.5초) 미만이면 ok:false. */
function rangeFromTake(track,which,{minConf=.6,minFrames=25,maxDev=3}={}){const T=track||[];const W=frameW(T),mk=voicedMask(T,{minConf});let st=[],sw=[];
 for(let i=0;i<T.length;i++){if(mk[i]&&T[i][1]>=28&&T[i][1]<=96){st.push(T[i][1]);sw.push(W[i])}}
 const tw=a=>{let t=0;for(const x of a)t+=x;return t-0};let wt=tw(sw);
 if(wt>=minFrames-1e-9){const o=st.slice().sort((x,y)=>x-y),med=o[o.length>>1],k=st.map(m=>Math.abs(m-med)<=maxDev);st=st.filter((m,i)=>k[i]);sw=sw.filter((m,i)=>k[i]);wt=tw(sw)}
 if(wt<minFrames-1e-9)return {ok:false,n:st.length,reason:'소리가 짧거나 불안정했습니다'};
 const o=st.sort((x,y)=>x-y),q=p=>o[Math.floor(p*(o.length-1))];return {ok:true,n:o.length,midi:Math.round(which==='high'?q(.9):q(.1)),med:o[o.length>>1]}}
const noteNm=m=>NAMES[((m%12)+12)%12]+(Math.floor(m/12)-1);
/* 낮은 음 lo·높은 음 hi → {ok,span,label,hint,reason}. 5반음 미만이거나 뒤집히면 ok:false */
function rangeResult(lo,hi,{minSpan=5}={}){if(lo==null||hi==null)return {ok:false,reason:'낮은 음과 높은 음을 모두 재 주세요'};if(hi<lo)return {ok:false,reason:'낮은 음이 높은 음보다 높게 잡혔습니다. 다시 재 보세요'};
 const span=hi-lo;if(span<minSpan)return {ok:false,span,reason:'음역이 너무 좁게 잡혔습니다. 낮은 음과 높은 음을 더 멀리 내서 다시 재 보세요'};
 return {ok:true,lo,hi,span,label:rangeLabel(lo,hi),hint:voiceHint(lo,hi)}}
function rangeLabel(lo,hi){const s=hi-lo,o=Math.floor(s/12),r=s%12;return noteNm(lo)+'–'+noteNm(hi)+', '+(o?o+'옥타브':'')+(o&&r?' ':'')+(r?r+'반음':'')}
/* 중심 음높이로 본 참고용 추정(신호 기반, 정답 아님): 중심 MIDI 56 미만 낮은 · 62 미만 중간 · 그 이상 높은 */
function voiceHint(lo,hi){const c=(lo+hi)/2;return c<56?'낮은 음역':c<62?'중간 음역':'높은 음역'}
/* 연습용 음역: 양 끝에서 margin 반음 안쪽. 안쪽이 6반음 미만으로 줄면 여유 0 */
function rangeWithMargin(lo,hi,margin=1){return hi-lo>=6+2*margin?[lo+margin,hi-margin]:[lo,hi]}

/* ---------- 연습 기록(pr-days1) · 진도 백업/복원 ----------
   log = {v:1, last:<마지막 답 ms>, days:{'YYYY-MM-DD':{n:답 수, ms:활동 ms}}}. 날짜 키는 로컬 달력(DST 안전: 시각이 아니라 연·월·일 성분으로만 계산) */
const DAY_CAP=400,GAP_CAP=120000,pad2=n=>String(n).padStart(2,'0');
const dayKey=ts=>{const d=ts instanceof Date?ts:new Date(ts);return isFinite(d)?d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()):null};
const isKey=k=>typeof k==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(k)&&dayKey(new Date(+k.slice(0,4),+k.slice(5,7)-1,+k.slice(8,10),12))===k;
const toKey=t=>typeof t==='string'?(isKey(t)?t:null):dayKey(t);
const shiftKey=(k,n)=>{const y=+k.slice(0,4),m=+k.slice(5,7)-1,d=+k.slice(8,10);return dayKey(new Date(y,m,d+n,12))}; // 정오 기준이라 DST 날도 하루씩 정확히 이동
const newLog=()=>({v:1,last:0,days:{}});
/* 깨진 값·이상한 키·음수는 버리고 최근 400일만 남긴다 */
function pruneLog(log,cap=DAY_CAP){const o=newLog();if(!log||typeof log!=='object'||Array.isArray(log)||!log.days||typeof log.days!=='object')return o;
 const ks=Object.keys(log.days).filter(isKey).sort().slice(-cap);for(const k of ks){const r=log.days[k];if(!r||typeof r!=='object')continue;const n=Math.floor(+r.n),ms=Math.floor(+r.ms||0);if(n>=1&&isFinite(n)&&n<1e6)o.days[k]={n,ms:isFinite(ms)&&ms>0?Math.min(ms,864e5):0}}
 o.last=isFinite(+log.last)&&+log.last>0?+log.last:0;return o}
/* 답 하나 기록. 활동 시간 = 직전 답과의 간격(같은 날, 0 초과 capMs 이하일 때만 더함). 자정을 넘긴 간격·시계가 되돌아간 경우는 더하지 않는다 */
function addAnswer(log,ts,capMs=GAP_CAP){const o=pruneLog(log),k=dayKey(ts);if(!k||!isFinite(+ts))return o;
 const d=o.days[k]||(o.days[k]={n:0,ms:0});d.n++;if(o.last>0&&ts>o.last&&ts-o.last<=capMs&&dayKey(o.last)===k)d.ms=Math.min(864e5,d.ms+(ts-o.last));
 o.last=+ts;return pruneLog(o)}
/* 연속 일수: 오늘 답이 1개 이상이면 오늘부터, 아직 없으면 어제부터 거슬러 센다(오늘 안 풀었다고 바로 끊기지 않음) */
function streak(log,today){const o=pruneLog(log);let k=toKey(today);if(!k)return 0;if(!o.days[k])k=shiftKey(k,-1);let n=0;while(o.days[k]&&n<=DAY_CAP){n++;k=shiftKey(k,-1)}return n}
/* 오늘까지 7일: [{key,dow(0=일),n,min}] 오래된 날부터 */
function week(log,today){const o=pruneLog(log),t=toKey(today),out=[];if(!t)return out;for(let i=6;i>=0;i--){const k=shiftKey(t,-i),r=o.days[k];out.push({key:k,dow:new Date(+k.slice(0,4),+k.slice(5,7)-1,+k.slice(8,10),12).getDay(),n:r?r.n:0,min:r?Math.round(r.ms/60000):0})}return out}
/* 백업 파일: 허용 키만, 키마다 검증·정리 후 문자열로 보관 */
const BK_APP='cover-practice-room',BK_VER=1,BK_MAX=2e6,BK_KEYS=['pr-stats','pr-stats2','pr-days1','pr-ear','pr-myrange','pr-miclat','pr-rt-pm','pr-stview','pr-stlab','pr-ladder1','pr-primer','pr-primerlog','pr-timbremix'];
const isObj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const clean1=(k,raw)=>{if(typeof raw!=='string'||raw.length>BK_MAX/2)return null;let v;try{v=JSON.parse(raw)}catch(e){return null}
 switch(k){
  case 'pr-stats':{if(!isObj(v))return null;const o={};for(const id of Object.keys(v).slice(0,200)){const r=v[id];if(r&&Array.isArray(r.h)){const h=r.h.filter(x=>typeof x==='number'&&isFinite(x)).map(clamp01).slice(-30);o[id]={n:Math.max(h.length,Math.min(1e7,+r.n|0)),h}}}return JSON.stringify(o)}
  case 'pr-stats2':{if(!isObj(v)||v.v!==2||!isObj(v.items))return null;return JSON.stringify(migrateStats(v,null))}
  case 'pr-days1':{if(!isObj(v)||!isObj(v.days))return null;return JSON.stringify(pruneLog(v))}
  case 'pr-ear':{if(!isObj(v))return null;const o={};for(const id of Object.keys(v).slice(0,100)){const r=v[id];if(!(isObj(r)&&isFinite(r.n)&&isFinite(r.ok)&&r.n>=0&&r.ok>=0&&r.ok<=r.n))return null;o[id]={n:Math.floor(r.n),ok:Math.floor(r.ok)}}return JSON.stringify(o)}
  case 'pr-myrange':return Array.isArray(v)&&v.length===2&&Number.isInteger(v[0])&&Number.isInteger(v[1])&&v[0]>=28&&v[1]<=96&&v[1]-v[0]>=5?JSON.stringify(v):null;
  case 'pr-miclat':return typeof v==='number'&&isFinite(v)&&v>=0&&v<=500?String(v):null;
  case 'pr-rt-pm':return v===0||v===1?String(v):null;
  case 'pr-stview':return v==='staff'||v==='roll'?v==='staff'?'"staff"':'"roll"':null;
  case 'pr-ladder1':{if(!isObj(v)||v.v!==1||!isObj(v.t))return null;return JSON.stringify(ladClean(v))}
  case 'pr-primer':return PRIMERS.includes(v)?JSON.stringify(v):null;
  case 'pr-primerlog':{if(!isObj(v)||v.v!==1||!isObj(v.p))return null;return JSON.stringify(primerClean(v))}
  case 'pr-timbremix':return v===0||v===1?String(v):null;
  case 'pr-stlab':return v==='sol'||v==='name'?JSON.stringify(v):null}
 return null};
/* 저장소엔 pr-stview/pr-stlab 이 따옴표 없는 문자열로 있으므로 파일 안에서는 JSON 문자열로 감싸 다룬다 */
const RAW_STR=new Set(['pr-stview','pr-stlab','pr-primer']),toFileVal=(k,s)=>s==null?null:RAW_STR.has(k)?JSON.stringify(s):s,fromFileVal=(k,s)=>RAW_STR.has(k)?JSON.parse(s):s;
/* get(key) -> 저장 문자열|null. 허용 키만 담는다 */
function buildBackup(get,now=Date.now()){const data={};for(const k of BK_KEYS){let s=null;try{s=get(k)}catch(e){}const f=toFileVal(k,s);if(f==null)continue;const c=clean1(k,f);if(c!=null)data[k]=fromFileVal(k,c)}
 return {app:BK_APP,kind:'progress',v:BK_VER,exported:new Date(now).toISOString(),data}}
/* 파일 글자 -> {ok,err,data:{키:저장 문자열},sum:{answers,days,keys}}. 던지지 않는다 */
function parseBackup(text){const bad=err=>({ok:false,err});if(typeof text!=='string'||!text.trim())return bad('빈 파일입니다.');if(text.length>BK_MAX)return bad('파일이 너무 큽니다(2MB 초과). 진도 파일이 아닌 것 같습니다.');
 let j;try{j=JSON.parse(text)}catch(e){return bad('JSON 형식이 아닙니다. 「진도 파일로 저장」으로 만든 파일을 골라 주세요.')}
 if(!isObj(j)||j.app!==BK_APP||j.kind!=='progress')return bad('이 앱의 진도 파일이 아닙니다.');if(j.v!==BK_VER)return bad('지원하지 않는 파일 버전입니다(v'+String(j.v).slice(0,8)+').');if(!isObj(j.data))return bad('진도 데이터가 없습니다.');
 const foreign=Object.keys(j.data).filter(k=>!BK_KEYS.includes(k));if(foreign.length)return bad('허용되지 않은 항목이 들어 있습니다: '+foreign.slice(0,3).map(k=>k.slice(0,20)).join(', '));
 const data={};for(const k of BK_KEYS){if(!(k in j.data))continue;const f=toFileVal(k,j.data[k]),c=clean1(k,typeof j.data[k]==='string'&&!RAW_STR.has(k)?j.data[k]:f);if(c==null)return bad('항목 「'+k+'」의 내용이 올바르지 않습니다.');data[k]=RAW_STR.has(k)?fromFileVal(k,c):c}
 if(!Object.keys(data).length)return bad('가져올 진도 항목이 없습니다.');
 return {ok:true,data,sum:backupSummary(data)}}
function backupSummary(data){let answers=0,days=0;try{if(data['pr-stats2']){const s=JSON.parse(data['pr-stats2']);for(const id of Object.keys(s.items))answers+=s.items[id].n}}catch(e){}try{if(data['pr-days1'])days=Object.keys(JSON.parse(data['pr-days1']).days).length}catch(e){}return {answers,days,keys:Object.keys(data)}}
/* 합치기 규칙(단순): 항목 횟수 n 은 더한다. 최근 결과 h 는 더 긴 쪽(같으면 가져온 쪽)을 쓴다. 혼동 횟수·청음 정답 수는 더한다. 연습 일수는 날마다 큰 쪽(같은 파일을 두 번 합쳐도 부풀지 않게). 음역·보정·보기 설정은 지금 값이 있으면 지금 값을 둔다.
   cur/inc: {키:저장 문자열}. 반환: {키:저장 문자열} (inc 에 있는 키만) */
function mergeBackup(cur,inc){const out={},J=s=>{try{return JSON.parse(s)}catch(e){return null}};cur=cur||{};
 const mItems=(a,b,cap)=>{const o={};for(const id of new Set([...Object.keys(a||{}),...Object.keys(b||{})])){const x=a&&a[id],y=b&&b[id];if(x&&y){const h=(y.h.length>=x.h.length?y.h:x.h).slice(-cap);o[id]={n:Math.max(h.length,(+x.n||0)+(+y.n||0)),h}}else o[id]=x||y}return o};
 for(const k of Object.keys(inc)){const a=cur[k]==null?null:J(cur[k]),b=J(inc[k]);
  if(cur[k]==null){out[k]=inc[k];continue}
  if(!['pr-stats','pr-stats2','pr-days1','pr-ear','pr-ladder1','pr-primerlog'].includes(k)){out[k]=cur[k];continue}
  if(a==null||b==null){out[k]=inc[k];continue}
  if(k==='pr-stats'){out[k]=JSON.stringify(mItems(a,b,30))}
  else if(k==='pr-stats2'){const m=migrateStats(a,null),n=migrateStats(b,null),s=newStats();s.items=mItems(m.items,n.items,60);for(const id of new Set([...Object.keys(m.conf),...Object.keys(n.conf)])){const c={},x=m.conf[id]||{},y=n.conf[id]||{};for(const q of new Set([...Object.keys(x),...Object.keys(y)]))c[q]=(x[q]||0)+(y[q]||0);s.conf[id]=c}out[k]=JSON.stringify(migrateStats(s,null))}
  else if(k==='pr-days1'){const x=pruneLog(a),y=pruneLog(b),o=newLog();o.last=Math.max(x.last,y.last);for(const d of new Set([...Object.keys(x.days),...Object.keys(y.days)])){const p=x.days[d]||{n:0,ms:0},q=y.days[d]||{n:0,ms:0};o.days[d]={n:Math.max(p.n,q.n),ms:Math.max(p.ms,q.ms)}}out[k]=JSON.stringify(pruneLog(o))}
  else if(k==='pr-ear'){const o={};for(const id of new Set([...Object.keys(a),...Object.keys(b)])){const x=a[id],y=b[id];o[id]=x&&y?{n:x.n+y.n,ok:x.ok+y.ok}:x||y}out[k]=JSON.stringify(o)}
  else if(k==='pr-primerlog'){const x=primerClean(a),y=primerClean(b),o=primerNew();for(const p of PRIMERS){const u=x.p[p],w=y.p[p];if(u||w)o.p[p]=!u?w:!w?u:w.length>=u.length?w:u}out[k]=JSON.stringify(o)}
  else if(k==='pr-ladder1'){const x=ladClean(a),y=ladClean(b),o=ladNew();for(const ty of LAD_TYPES){const p=x.t[ty],q=y.t[ty];if(p&&q){const pd=p.d|0,qd=q.d|0,w=qd>pd||(qd===pd&&(q.k>p.k||(q.k===p.k&&q.h.length>=p.h.length)))?q:p;o.t[ty]=ty==='interval'?{on:p.on||q.on?1:0,k:w.k,h:w.h,d:w.d|0}:{on:p.on||q.on?1:0,k:w.k,h:w.h}}else if(p||q)o.t[ty]=p||q}out[k]=JSON.stringify(o)}
  else out[k]=cur[k]}
 return out}

/* 으뜸음 프라이머(음계 도수 퀴즈): 질문 음 앞에 조성을 세우는 방법. 어려운 순서 cs -> c -> drone -> none */
const PRIMERS=['cs','c','drone','none'],PRIMER_KO={cs:'카덴스+음계',c:'카덴스',drone:'으뜸음 드론',none:'없음'},PRIMER_DEFAULT='c',PRIMER_CH=.7,PRIMER_SC=.18,PRIMER_GAP=.8,PRIMER_WIN=20,PRIMER_PCT=.9,PRIMER_DAYS=3,MAJ_SC=[0,2,4,5,7,9,11,12,11,9,7,5,4,2,0];
const normPrimer=p=>PRIMERS.includes(p)?p:PRIMER_DEFAULT;
/* 재생 계획(시각은 0 기준, 초). cad: [{notes,bass}] I-IV-V-I, q: 질문 음. 질문 음은 항상 마지막 이벤트 */
function primerPlan(mode,cad,q){mode=normPrimer(mode);const ev=[],tonic=60+(((cad[0].bass-60)%12)+12)%12;let t=0;
 if(mode==='cs'||mode==='c'){cad.forEach((c,i)=>ev.push({k:'chord',t:i*PRIMER_CH,d:PRIMER_CH,notes:c.notes,bass:c.bass}));t=cad.length*PRIMER_CH}
 if(mode==='cs'){MAJ_SC.forEach((s,i)=>ev.push({k:'scale',t:t+i*PRIMER_SC,d:PRIMER_SC+.04,p:tonic+s}));t+=MAJ_SC.length*PRIMER_SC}
 if(mode==='drone'){const dp=36+(((cad[0].bass-36)%12)+12)%12;ev.push({k:'drone',t:0,d:2.6,p:dp});t=.4}
 else if(mode!=='none')t+=PRIMER_GAP;
 ev.push({k:'q',t,d:1.2,p:q});return {mode,ev,qAt:t,end:t+1.2}}
const primerNew=()=>({v:1,p:{}});
/* 로그: {v:1,p:{모드:[[날짜키,0|1],...최근 20]}} */
function primerClean(L){const o=primerNew();if(!isObj(L)||!isObj(L.p))return o;for(const p of PRIMERS){const a=L.p[p];if(!Array.isArray(a))continue;const r=[];for(const e of a){if(Array.isArray(e)&&isKey(e[0])&&(e[1]===0||e[1]===1))r.push([e[0],e[1]])}if(r.length)o.p[p]=r.slice(-PRIMER_WIN)}return o}
function primerRec(L,p,ok,ts){const o=primerClean(L);p=normPrimer(p);const k=toKey(ts);if(!k)return o;o.p[p]=(o.p[p]||[]).concat([[k,ok?1:0]]).slice(-PRIMER_WIN);return o}
/* 제안만(자동 이동 없음): 이 프라이머의 최근 20답이 정답률 90% 이상이고 서로 다른 3일 이상에 걸칠 때 다음 단계를 권한다 */
function primerSuggest(L,p){p=normPrimer(p);const i=PRIMERS.indexOf(p),a=(primerClean(L).p[p]||[]),n=a.length,acc=n?a.reduce((s,e)=>s+e[1],0)/n:null,days=new Set(a.map(e=>e[0])).size;
 return {next:i<PRIMERS.length-1?PRIMERS[i+1]:null,n,acc,days,suggest:i<PRIMERS.length-1&&n>=PRIMER_WIN&&acc>=PRIMER_PCT&&days>=PRIMER_DAYS}}
/* 음색·옥타브 섞기: 이미 있는 음색(기본 합성 sing, 건반 keys, 기타 guitar, 삼각파 score)만. 옥타브는 -1/0/+1 중 모든 음이 C2(36)~C7(96) 안에 남는 것만 */
const MIX_VOICES=['sing','keys','guitar','score'],MIX_KO={sing:'기본 합성',keys:'건반',guitar:'기타',score:'삼각파 합성'},MIX_LO=36,MIX_HI=96,MIX_TYPES=['interval','triad','seventh','degree'];
function octaveShifts(ps){const a=(ps||[]).filter(Number.isFinite);if(!a.length)return [0];const lo=Math.min(...a),hi=Math.max(...a);return [-1,0,1].filter(s=>lo+12*s>=MIX_LO&&hi+12*s<=MIX_HI)}
function mixPlan(ps,rnd=Math.random){const sh=octaveShifts(ps),v=MIX_VOICES[Math.floor(rnd()*MIX_VOICES.length)%MIX_VOICES.length],s=sh.length?sh[Math.floor(rnd()*sh.length)%sh.length]:0;return {voice:v,shift:s}}
function qPitches(q){const o=[];if(!q)return o;for(const k of ['notes','scale','melody'])if(Array.isArray(q[k]))o.push(...q[k]);if(Array.isArray(q.cad))for(const c of q.cad){if(c.notes)o.push(...c.notes);if(Number.isFinite(c.bass))o.push(c.bass)}if(q.target){if(q.target.notes)o.push(...q.target.notes);if(Number.isFinite(q.target.bass))o.push(q.target.bass)}return o.filter(Number.isFinite)}
/* ---------- 샘플로 배우는 5분 수업(순수 단계 계획) ----------
   기존 기능(전체 듣기·파트 솔로·구간 반복·코드 띠·빠진 파트 찾기·곡 받아쓰기)을 5단계로 엮는다. 이 함수들은 화면·오디오 없이 계획만 만든다.
   env: {soloWhy,quizWhy,partWhy: 이유 문장(빈 값이면 가능), label(i): 그 마디 코드 표기(반마디로 나뉘면 'Am │ G'), rootAt(i,half): 근음 글자(키 바꿈 반영용)}. 이유가 있으면 그 단계는 건너뛴다 */
const LESSON_IDS=['listen','bass','chords','quiz','dict'],LESSON_TITLE={listen:'전체 듣기',bass:'베이스만 듣고 근음 따라가기',chords:'코드 띠로 진행 읽기',quiz:'빠진 파트 찾기',dict:'베이스 받아쓰기'};
function lessonRoot(ch){const m=/^[A-G][#b♯♭]?/.exec(String(ch==null?'':ch));return m?m[0]:''}
function lessonSplitBar(split){if(!Array.isArray(split))return -1;return split.findIndex(s=>s&&s.a&&s.b&&s.a!==s.b)}
/* 받아쓰기 후보: 베이스 1마디 -> 베이스 2마디 -> 멜로디(채보 음) 1마디 -> 2마디. 받아쓸 구간이 있는 첫 조합. stems 가 있으면 「이 파트만」 가능(part) */
function lessonDictPlan(parts,bars,stems){const o1=dictLayers(parts,bars,1),o2=dictLayers(parts,bars,2);
 for(const [l,z,o] of [['bass',1,o1],['bass',2,o2],['score',1,o1],['score',2,o2]])if(o[l])return {layer:l,size:z,part:!!dictStemFor(l,stems)};return null}
function lessonPlan(sg,env={}){const bars=sg&&sg.bars|0,id=sg&&sg.id,lab=typeof env.label==='function'?env.label:i=>{const s=sg.split&&sg.split[i];return s&&s.a!==s.b?s.a+' │ '+s.b:String(sg.chords&&sg.chords[i]||'')},why=x=>x?String(x):null;
 const rt=typeof env.rootAt==='function'?env.rootAt:(i,h)=>{const s=sg.split&&sg.split[i];return lessonRoot(s?(h?s.b:s.a):sg.chords[i])},roots=[];for(let i=0;i<bars;i++){const s=sg.split&&sg.split[i];roots.push(s&&s.a!==s.b?rt(i,0)+' │ '+rt(i,1):rt(i,0))}
 const sb=lessonSplitBar(sg.split),cl=sb>=0?[Math.max(1,Math.min(sb,bars-1)),Math.max(1,Math.min(sb,bars-1))+1]:[1,Math.min(2,bars)],dp=lessonDictPlan(sg.parts,bars,sg.stems),prog=Array.from({length:bars},(_,i)=>lab(i)).join(' → ');
 const hasBass=!!(sg.parts&&sg.parts.bass&&sg.parts.bass.length);
 const quizOk=!!missingQuiz({level:1,seed:1,songs:[{...sg,id}]});
 const steps=[
  {id:'listen',title:LESSON_TITLE.listen,text:`먼저 전체 소리를 처음부터 끝까지 들어 보세요. ${bars}마디가 한 바퀴입니다.`,go:'전체 듣기',solo:null,loop:null,skip:null},
  {id:'bass',title:LESSON_TITLE.bass,text:'베이스만 솔로로 들으며, 마디마다 코드의 근음(코드 이름의 첫 글자)을 따라 불러 보세요.',go:'베이스만 듣기',solo:'bass',loop:[1,bars],skip:!hasBass?'이 곡에는 베이스 파트가 없습니다.':why(env.soloWhy),roots},
  {id:'chords',title:LESSON_TITLE.chords,text:sb>=0?`코드 띠에서 진행을 읽어 보세요: ${prog}. ${sb+1}마디는 한 마디 안에서 코드가 둘로 나뉩니다(${lab(sb)}).`:`코드 띠에서 진행을 읽어 보세요: ${prog}. 앞 두 마디를 반복해 들으며 코드가 바뀌는 곳을 찾아 보세요.`,go:`${cl[0]}–${cl[1]}마디 반복해 듣기`,solo:null,loop:cl,split:sb,skip:null},
  {id:'quiz',title:LESSON_TITLE.quiz,text:'이 샘플에서 한 파트가 빠진 소리를 듣고, 어떤 파트가 빠졌는지 1문제를 골라 보세요.',go:'문제 풀러 가기',solo:null,loop:null,quiz:{only:id,level:1},skip:!quizOk?'이 곡에서 낼 수 있는 문제가 없습니다.':why(env.quizWhy)},
  {id:'dict',title:LESSON_TITLE.dict,text:dp?`${dp.layer==='bass'?'베이스':'멜로디(채보 음)'} ${dp.size}마디를 ${dp.part?'「이 파트만」으로':'들리는 대로'} 듣고, 나머지 음을 건반으로 입력해 보세요.${dp.layer!=='bass'?' 이 곡의 베이스는 음이 너무 적어 받아쓰기 구간이 되지 않아 멜로디로 대신합니다.':dp.size>1?' 이 곡의 베이스는 1마디에 음이 적어 2마디 구간으로 합니다.':''}`:'받아쓸 구간이 없습니다.',go:'받아쓰기 열기',solo:null,loop:null,dict:dp,skip:dp?null:'이 곡에는 받아쓸 구간이 없습니다.',note:dp&&!dp.part?'파트 음원을 쓸 수 없어 다른 소리로 들려 드립니다.':''}];
 if(steps[4].note===''&&dp&&dp.part&&env.partWhy)steps[4].note=String(env.partWhy);
 return {id,bars,steps,roots,splitBar:sb}}
/* 저장된 진행(localStorage) 정리: {step:0..n-1, done:[고유 정수], finished}. 이상한 값은 처음부터 */
function lessonNorm(raw,n){n=n|0||5;const r=raw&&typeof raw==='object'?raw:{},st=Number.isInteger(r.step)?Math.max(0,Math.min(n-1,r.step)):0,done=[...new Set((Array.isArray(r.done)?r.done:[]).filter(x=>Number.isInteger(x)&&x>=0&&x<n))].sort((a,b)=>a-b);return {step:st,done,finished:r.finished===true&&done.length===n}}
function lessonProgLabel(st,n){n=n|0||5;if(st.finished)return '완료';return st.done.length||st.step>0?`${Math.min(n,st.step+1)}/${n}단계에서 이어서`:'시작'}
const api={LESSON_IDS,LESSON_TITLE,lessonRoot,lessonSplitBar,lessonDictPlan,lessonPlan,lessonNorm,lessonProgLabel,MP_PARTS,MP_L1,MP_GEN,MP_LAB,MP_PAIRS,MP_ITEMS,mpLabels,mpHas,mpParts,missingQuiz,LAD_DIRS,LAD_DIR_KO,ladDir,IV_FEEL,ivFeel,loadCtl,LOAD,jong,hopFor,frameCentre,workletAllowed,iosVersion,frameScale,PRIMERS,PRIMER_KO,PRIMER_DEFAULT,PRIMER_CH,PRIMER_SC,PRIMER_GAP,PRIMER_WIN,normPrimer,primerPlan,primerNew,primerClean,primerRec,primerSuggest,MIX_VOICES,MIX_KO,MIX_LO,MIX_HI,MIX_TYPES,octaveShifts,mixPlan,qPitches,LAD_TYPES,LAD_ORDER,LAD_N0,ladNew,ladClean,ladSet,ladOn,ladItems,ladRec,ladStatus,MODES,MODE_ALL,MODE_L1,MD2_ITEMS,modeQuiz,modeSpell,modeAlts,modeAltText,CONTRAST_FIXED,CONTRAST_N,confusedPair,contrastPair,contrastQuiz,contrastOrder,dictDiag,dictHints,readingQuiz,rdHint,rdName,RD_ITEMS,cadenceQuiz,funcQuiz,inversionQuiz,CD_T,FN_KO,INV_KO,FN_POOL,KEYN,pcName,bassName,chordLabel,romanOf,scaleNames,noteNmK,dayKey,shiftKey,newLog,pruneLog,addAnswer,streak,week,BK_KEYS,buildBackup,parseBackup,mergeBackup,backupSummary,rangeFromTake,voicedMask,octaveGuard,suppressOctave,TOL_LEVELS,TOL_DEFAULT,normTol,tolTier,takeDrift,latencyStats,latencyAdvice,rangeResult,rangeLabel,voiceHint,rangeWithMargin,noteNm,yin,tracker,LOW,lowWin,LOW_FLOOR,lowModeAdvice,BEG_BPM,REF_TONIC,REF_TRIAD,refPlan,makeExercise,scoreTake,pmQuestion,pmJudge,pmJudgeQ,pmLeak,pmHarmTarget,pmChordOf,pmDegOf,scMidi,HK_LAB,pmStatItems,INTERVALS,kindOf,smoothNotes,estimateLatency,earQuiz,tonicQuiz,tapBpm,tapRatio,TK_ITEMS,makeProgression,topLine,recStat,lastAcc,newStats,migrateStats,recItem,weakness,pickWeighted,weightFor,makeRoutine,makeSession,genQuestion,explain,DICT_LAB,DICT_LAYERS,dictMono,dictWindows,dictLayers,dictRef,dictNext,dictGrade,dictSpan,dictStemFor,dictStemSpan,DICT_STEM,itemLabel,topWeak,summary,exItems,RCELLS,RC_ORDER,RCAT_LAB,makeRhythmSlots,makeRhythm,rhythmToSlots,slotsToRhythm,rhythmCat,rhythmOnsets,rhythmSigs,gradeRhythm,scoreTaps,tapStatItems,NAMES,DEG_L,SOLF,DIR_KO,IV_ITEMS,SV_ITEMS,DG_ITEMS,KIND_LAB,rng};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SingLab=api})(typeof window!=='undefined'?window:globalThis);
