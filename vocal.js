/* 원곡 보컬 멜로디(추정) — 브라우저 안에서 신호만으로. 큰 모델·가사 인식 없음. window.VocalLine / node: module.exports.
   - fromNotes(notes,dur): (a) 채보 음 후보에서 시간마다 한 음(진폭 × 보컬 음역 사전 × 연속성) 비터비
   - stereoSalience / trackSalience: (b) 가운데 채널(중앙 마스크) 하모닉 합 살리언스 + 비터비
   - combo: (c) (b)의 살리언스에 (a)의 음 후보를 더해 같이 비터비
   - framesToNotes: 10 ms 프레임 곡선 → 음 목록(소수 midi)
   결과 프레임: {hop:.01, midi:[소수 midi | null]}. 정확도는 낮은 추정이며 정답이 아니다. */
(function(root){
const HOP=.01,FMIN=70,FMAX=1100,CENT=20,NB=Math.floor(1200*Math.log2(FMAX/FMIN)/CENT)+1;
const binMidi=b=>69+12*Math.log2(FMIN/440)+b*CENT/100;
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
 for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang),h=len>>1;for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<h;j++){const a=i+j,b=a+h,vr=re[b]*cr-im[b]*ci,vi=re[b]*ci+im[b]*cr;re[b]=re[a]-vr;im[b]=im[a]-vi;re[a]+=vr;im[a]+=vi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t}}}}
/* 보컬 음역 사전(MIDI): 55~79 은 1, 밖은 부드럽게 감소 */
const prior=m=>m<55?Math.exp(-Math.pow((55-m)/6,2)):m>79?Math.exp(-Math.pow((m-79)/5,2)):1;

/* 범용 비터비: 프레임마다 후보 [{m:midi, s:점수, id}] + 무성 상태. 반환: 프레임별 선택 후보 index(-1 = 무성) */
function viterbiCands(cands,P){const n=cands.length,T=P.theta,uv=P.uvPen;
 const back=[];let prevU=0,prevD=[];
 for(let t=0;t<n;t++){const c=cands[t],d=new Float64Array(c.length),b=new Int32Array(c.length),bu=[];let bestVal=-1e18,bestI=-1;for(let i=0;i<prevD.length;i++)if(prevD[i]>bestVal){bestVal=prevD[i];bestI=i}
  for(let j=0;j<c.length;j++){let v=prevU-uv,bi=-2;/* 무성에서 옴 */
   for(let i=0;i<prevD.length;i++){const p=cands[t-1][i];const x=prevD[i]-(p.id===c[j].id?0:switchFor(p.m,c[j].m,P));if(x>v){v=x;bi=i}}
   d[j]=v+c[j].s-T;b[j]=bi}
  let uvv=prevU,ub=-2;if(bestI>=0&&bestVal-uv>uvv){uvv=bestVal-uv;ub=bestI}if(t===0){uvv=0;ub=-2}
  back.push({b,ub});prevD=d;prevU=uvv}
 const out=new Int32Array(n).fill(-1);let st=-2,v=prevU;for(let i=0;i<prevD.length;i++)if(prevD[i]>v){v=prevD[i];st=i}
 for(let t=n-1;t>=0;t--){if(st>=0){out[t]=st;st=back[t].b[st]}else{out[t]=-1;st=back[t].ub}}
 return out}
function switchFor(a,b,P){const d=Math.abs(a-b);return P.switchPen+P.semiPen*Math.min(d,12)}

/* (a) 채보 음 → 프레임 곡선 */
const PA={theta:.07,switchPen:.10,semiPen:.012,uvPen:.08,gamma:1,bendOn:0};
function fromNotes(notes,dur,opt){const P=Object.assign({},PA,opt||{}),n=Math.max(1,Math.ceil(dur/HOP)),cands=Array.from({length:n},()=>[]);
 notes.forEach((nt,id)=>{const m0=nt.pitchMidi;if(m0<40||m0>90)return;const a=Math.pow(Math.min(1,nt.amplitude),P.gamma),s=a*prior(m0),f0=Math.max(0,Math.ceil(nt.startTimeSeconds/HOP)),f1=Math.min(n-1,Math.floor((nt.startTimeSeconds+nt.durationSeconds)/HOP)),bd=nt.pitchBends,L=f1-f0+1;
  for(let f=f0;f<=f1;f++){let m=m0;if(P.bendOn&&bd&&bd.length){const x=Math.min(bd.length-1,Math.floor((f-f0)/L*bd.length));m=m0+bd[x]/3}cands[f].push({m,s:s*(1+.15*Math.min(1,L*HOP/.5)),id})}});
 /* 프레임당 후보가 너무 많으면 점수 상위 8개만 */
 for(const c of cands)if(c.length>8)c.sort((x,y)=>y.s-x.s),c.length=8;
 const sel=viterbiCands(cands,P);return {hop:HOP,midi:Array.from(sel,(k,t)=>k<0?null:cands[t][k].m),cands}}

/* (b) 스테레오 → 가운데 마스크 하모닉 살리언스. L,R: Float32Array(같은 길이 가능), sr. 반환 {sal:Float32Array(nF*NB), nF, hopS} */
const PB={N:2048,hopN:441,H:14,hw:.92,center:3,hp:120,whiten:1,pr:1};
function stereoSalience(L,R,sr,opt){const P=Object.assign({},PB,opt||{}),N=P.N,hop=P.hopN,nF=Math.max(1,Math.floor((L.length-N)/hop)+1),win=new Float32Array(N);for(let i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/N);
 const re1=new Float32Array(N),im1=new Float32Array(N),re2=new Float32Array(N),im2=new Float32Array(N),K=N/2,sal=new Float32Array(nF*NB),Z=new Float32Array(K+2),kLo=Math.ceil(P.hp*N/sr),kHi=Math.min(K-1,Math.floor(5000*N/sr));
 const isMono=R===L,hr=[];for(let h=1;h<=P.H;h++)hr.push(Math.pow(P.hw,h-1));
 const fk=new Float32Array(NB);for(let b=0;b<NB;b++)fk[b]=FMIN*Math.pow(2,b*CENT/1200)*N/sr;
 const pri=new Float32Array(NB);for(let b=0;b<NB;b++)pri[b]=P.pr?prior(binMidi(b)):1;
 const Y=new Float32Array(K+2),tmp=new Float32Array(K+2);
 for(let f=0;f<nF;f++){const o=f*hop;for(let i=0;i<N;i++){const w=win[i];re1[i]=L[o+i]*w;im1[i]=0;re2[i]=isMono?0:R[o+i]*w;im2[i]=0}
  if(isMono){fft(re1,im1);for(let k=0;k<=K;k++)Y[k]=Math.hypot(re1[k],im1[k])}
  else{/* 복소수 FFT 한 번으로 L,R 두 신호: z=L+iR */for(let i=0;i<N;i++){re1[i]=L[o+i]*win[i];im1[i]=R[o+i]*win[i]}fft(re1,im1);
   for(let k=0;k<=K;k++){const k2=(N-k)&(N-1),lr=(re1[k]+re1[k2])/2,li=(im1[k]-im1[k2])/2,rr=(im1[k]+im1[k2])/2,ri=-(re1[k]-re1[k2])/2;
    const mr=(lr+rr)/2,mi=(li+ri)/2,sr_=(lr-rr)/2,si=(li-ri)/2,m=Math.hypot(mr,mi),s=Math.hypot(sr_,si);
    Y[k]=P.center?m*Math.pow(Math.max(0,1-s/(m+1e-9)),P.center):m}}
  /* 로그 압축 후 국소 평균 빼기(스펙트럼 백색화) */
  for(let k=0;k<=K;k++)tmp[k]=Math.log1p(30*Y[k]);
  if(P.whiten){const W=Math.max(6,Math.round(300*N/sr));let acc=0,cnt=0;for(let k=0;k<Math.min(K,W);k++){acc+=tmp[k];cnt++}for(let k=0;k<=K;k++){if(k+W<=K){acc+=tmp[k+W];cnt++}if(k-W-1>=0){acc-=tmp[k-W-1];cnt--}Z[k]=Math.max(0,tmp[k]-acc/cnt)}}else for(let k=0;k<=K;k++)Z[k]=tmp[k];
  for(let k=0;k<kLo;k++)Z[k]=0;for(let k=kHi+1;k<=K;k++)Z[k]=0;
  const so=f*NB;for(let b=0;b<NB;b++){let s=0;for(let h=0;h<P.H;h++){const x=fk[b]*(h+1);if(x>=kHi)break;const i=Math.round(x);s+=hr[h]*Math.max(Z[i-1]||0,Z[i],Z[i+1]||0)}sal[so+b]=s*pri[b]}}
 return {sal,nF,hopS:hop/sr}}
const PT={theta:.45,uvPen:1,a:.1,W:8,jump:3.0,norm:.9,vp:0};
/* 살리언스 → 비터비 곡선. add: 프레임별 보너스 함수(c)에서 쓰는 선택적 Float32Array(nF*NB) */
function trackSalience(S,dur,opt,add){const P=Object.assign({},PT,opt||{}),{sal,nF,hopS}=S;
 /* 프레임 최대값의 norm 분위수로 정규화 */
 const mx=new Float32Array(nF);for(let f=0;f<nF;f++){let m=0;for(let b=0;b<NB;b++)if(sal[f*NB+b]>m)m=sal[f*NB+b];mx[f]=m}
 const sm=Array.from(mx).sort((a,b)=>a-b),ref=sm[Math.floor(sm.length*P.norm)]||1;
 const gf=new Float32Array(nF).fill(1);if(P.vp){const pk=new Float32Array(nF);for(let f=0;f<nF;f++){let s=0;for(let b=0;b<NB;b++)s+=sal[f*NB+b];pk[f]=mx[f]/(s/NB+1e-9)}const q=Array.from(pk).sort((a,b)=>a-b),r2=q[Math.floor(q.length*P.norm)]||1;for(let f=0;f<nF;f++)gf[f]=Math.pow(Math.min(1.5,pk[f]/r2),P.vp)}
 const em=new Float32Array(NB);let Dp=new Float32Array(NB),Dn=new Float32Array(NB);const bk=new Int16Array(nF*NB),bu=new Int16Array(nF),W=P.W,ucode=-1;let Up=0;const bkU=new Int32Array(nF);
 for(let f=0;f<nF;f++){let best=-1e9,bi=0;for(let b=0;b<NB;b++){if(Dp[b]>best){best=Dp[b];bi=b}}
  for(let b=0;b<NB;b++){let v=Up-P.uvPen,from=-1;const lo=Math.max(0,b-W),hi=Math.min(NB-1,b+W);for(let i=lo;i<=hi;i++){const x=Dp[i]-P.a*Math.abs(i-b);if(x>v){v=x;from=i}}
   if(f>0&&best-P.jump>v){v=best-P.jump;from=bi}
   const e=(sal[f*NB+b]+(add?add[f*NB+b]:0))/ref*gf[f]-P.theta;Dn[b]=(f===0?0:v)+e;bk[f*NB+b]=from}
  let uv=Up,ub=-1;if(f>0&&best-P.uvPen>uv){uv=best-P.uvPen;ub=bi}bkU[f]=ub;
  const tmp=Dp;Dp=Dn;Dn=tmp;Up=f===0?0:uv}
 let st=-1,v=Up;for(let b=0;b<NB;b++)if(Dp[b]>v){v=Dp[b];st=b}
 const path=new Int16Array(nF).fill(-1);for(let f=nF-1;f>=0;f--){if(st>=0){path[f]=st;st=bk[f*NB+st]}else{path[f]=-1;st=bkU[f]}}
 const nOut=Math.max(1,Math.ceil(dur/HOP)),midi=new Array(nOut).fill(null);
 for(let t=0;t<nOut;t++){const f=Math.min(nF-1,Math.round(t*HOP/hopS-(PB.N/2/PB.hopN)));const g=Math.max(0,f);if(path[g]>=0){/* 포물선 보간 */const b=path[g],i=g*NB;const y0=sal[i+Math.max(0,b-1)],y1=sal[i+b],y2=sal[i+Math.min(NB-1,b+1)],d=y0-2*y1+y2,off=d<0?.5*(y0-y2)/d:0;midi[t]=binMidi(b+Math.max(-.5,Math.min(.5,off)))}}
 return {hop:HOP,midi}}
/* (a) 음 후보 → 살리언스 격자 보너스 */
function noteBonus(notes,S,beta){const {nF,hopS}=S,add=new Float32Array(nF*NB);for(const nt of notes){const m0=nt.pitchMidi;if(m0<45||m0>85)continue;const a=nt.amplitude*beta*prior(m0),f0=Math.max(0,Math.floor((nt.startTimeSeconds-PB.N/2/PB.hopN*hopS)/hopS)),f1=Math.min(nF-1,Math.ceil((nt.startTimeSeconds+nt.durationSeconds-PB.N/2/PB.hopN*hopS)/hopS)),bc=(m0-binMidi(0))*100/CENT;
  for(let f=f0;f<=f1;f++)for(let b=Math.max(0,Math.floor(bc-6));b<=Math.min(NB-1,Math.ceil(bc+6));b++){const d=(b-bc)*CENT/60;add[f*NB+b]+=a*Math.exp(-.5*d*d)}}return add}

/* 프레임 곡선 → 음 목록 [시작초, 길이초, 소수 midi]. 연속 3프레임 이상 .65 반음 넘게 벗어나면 새 음 */
function framesToNotes(fr,opt){const o=Object.assign({dev:.7,minDur:.08,gap:.05},opt||{}),m=fr.midi,out=[];let seg=[];const hop=fr.hop;
 const flush=()=>{if(seg.length){const ps=seg.map(x=>x[1]).sort((a,b)=>a-b),med=ps[ps.length>>1],d=(seg[seg.length-1][0]-seg[0][0]+hop);if(d>=o.minDur)out.push([seg[0][0],d,med])}seg=[]};
 for(let t=0;t<m.length;t++){if(m[t]==null){flush();continue}
  if(seg.length){const ps=seg.slice(-9).map(x=>x[1]).sort((a,b)=>a-b),med=ps[ps.length>>1];if(Math.abs(m[t]-med)>o.dev){let k=1;while(t+k<m.length&&k<3&&m[t+k]!=null&&Math.abs(m[t+k]-m[t])<o.dev)k++;if(k>=3)flush();else{seg.push([t*hop,med]);continue}}}
  seg.push([t*hop,m[t]])}flush();
 /* 같은 음 사이 짧은 틈 메우기 */
 const r=[];for(const n of out){const p=r[r.length-1];if(p&&n[0]-(p[0]+p[1])<=o.gap&&Math.abs(n[2]-p[2])<.5){p[1]=n[0]+n[1]-p[0];p[2]=(p[2]+n[2])/2}else r.push(n.slice())}return r}
/* 곡 전체 튜닝 어긋남(반음 소수부의 원형 중앙값) */
function detune(notes){if(!notes.length)return 0;let sx=0,sy=0,w=0;for(const n of notes){const a=2*Math.PI*(n[2]-Math.round(n[2])),d=n[1];sx+=Math.cos(a)*d;sy+=Math.sin(a)*d;w+=d}return w?Math.atan2(sy,sx)/(2*Math.PI):0}
/* 앱용 한 번에: 스테레오(L,R; 모노면 같은 배열) + 채보 음 → {fr, notes[[시작,길이,소수 midi]]} (방식 c) */
function estimate(L,R,sr,notes,dur,opt){const S=stereoSalience(L,R,sr,opt&&opt.b),add=notes&&notes.length?noteBonus(notes,S,opt&&opt.beta!=null?opt.beta:8):null,fr=trackSalience(S,dur,opt&&opt.t,add);return {fr,notes:framesToNotes(fr)}}
const api={estimate,fromNotes,stereoSalience,trackSalience,noteBonus,framesToNotes,detune,prior,NB,binMidi,HOP};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VocalLine=api})(typeof window!=='undefined'?window:globalThis);
