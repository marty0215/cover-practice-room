/* 가운데 소리 줄이기(보컬이 가운데에 있을 때만 효과) — 브라우저 안에서 신호만으로. 모델 없음, 오디오는 어디로도 보내지 않는다.
   STFT(2048/hop 512, 제곱근 Hann) → 프레임·빈마다 가운데 성분(M=(L+R)/2) 우세도 v=(1−|L−R|/|L+R|)^p → 시간 ±2프레임·주파수 ±2빈 평활
   → 이득 g=1−강도·(1−floor)·v·대역창 을 M 에만 곱하고 S=(L−R)/2 는 그대로(옆 소리 보존). 150 Hz 아래는 손대지 않고(킥·베이스), 8 kHz 위도 통과.
   한계: 보컬 잔향·더블링(옆으로 퍼진 소리)은 남고, 가운데에 있는 다른 악기(스네어·솔로 등)도 같이 줄어든다.
   window.VocalReduce / node: module.exports. */
(function(root){
const N=2048,H=512,NB=N/2+1,SM_T=2,SM_F=2;
const DEF={strength:1,floor:.15,lo:150,loRamp:40,hi:8000,hiRamp:1000,p:3,monoDb:-40};
const WIN=(()=>{const w=new Float64Array(N);for(let i=0;i<N;i++)w[i]=Math.sqrt(.5-.5*Math.cos(2*Math.PI*i/N));return w})();
const TW=(()=>{const c=new Float64Array(N/2),s=new Float64Array(N/2);for(let i=0;i<N/2;i++){c[i]=Math.cos(-2*Math.PI*i/N);s[i]=Math.sin(-2*Math.PI*i/N)}return {c,s}})();
const REV=(()=>{const r=new Uint16Array(N);for(let i=0,j=0;i<N;i++){r[i]=j;let b=N>>1;for(;j&b;b>>=1)j^=b;j^=b}return r})();
function fft(re,im,inv){for(let i=0;i<N;i++){const j=REV[i];if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
 for(let len=2;len<=N;len<<=1){const h=len>>1,st=N/len;for(let i=0;i<N;i+=len)for(let j=0,k=0;j<h;j++,k+=st){const wr=TW.c[k],wi=inv?-TW.s[k]:TW.s[k],a=i+j,b=a+h,vr=re[b]*wr-im[b]*wi,vi=re[b]*wi+im[b]*wr;re[b]=re[a]-vr;im[b]=im[a]-vi;re[a]+=vr;im[a]+=vi}}}
/* 모노·거의 모노 판정: 옆(S) 에너지 / 가운데(M) 에너지(dB). 임계 monoDb(−40 dB) 아래면 줄일 가운데·옆 구분이 없다 */
function sideRatioDb(L,R,step){step=step||1;let m=0,s=0;for(let i=0;i<L.length;i+=step){const a=L[i],b=R[i],M=(a+b)*.5,S=(a-b)*.5;m+=M*M;s+=S*S}
 if(m<=1e-20)return {db:-Infinity,silent:true};return {db:s<=0?-Infinity:10*Math.log10(s/m),silent:false}}
function isMono(L,R,opt){const o=Object.assign({},DEF,opt||{}),r=sideRatioDb(L,R,Math.max(1,Math.floor(L.length/2e6)));return {mono:r.silent||r.db<o.monoDb,sideDb:r.db,silent:r.silent}}
/* 작업 하나: job.step(maxFrames) 로 프레임을 나눠 처리(진행·취소는 호출자가 틈틈이 제어). 출력은 sink(pos,l,r) 로 조각마다 전달(float32). 메모리: 프레임 5개 분량만 */
function createJob(L,R,sr,opt,sink,mask){ /* mask=[L,R] 를 주면 마스크는 그 신호에서 계산(벤치용: 합친 믹스의 마스크를 보컬·반주 따로 적용해 재기) */const o=Object.assign({},DEF,opt||{}),len=L.length,nF=Math.ceil((len+N-H)/H)+1; /* 프레임 t 는 표본 (t−3)*H 부터 N 개(앞뒤 0 채움) */
 const binHz=sr/N,gBand=new Float64Array(NB);
 for(let k=0;k<NB;k++){const f=k*binHz;let a=1;if(f<o.lo)a=0;else if(f<o.lo+o.loRamp)a=(f-o.lo)/o.loRamp;if(f>o.hi)a=0;else if(f>o.hi-o.hiRamp)a=Math.min(a,(o.hi-f)/o.hiRamp);gBand[k]=a}
 const R5=5,Mr=[],Mi=[],Sr=[],Si=[],V=[];for(let i=0;i<R5;i++){Mr.push(new Float64Array(NB));Mi.push(new Float64Array(NB));Sr.push(new Float64Array(NB));Si.push(new Float64Array(NB));V.push(new Float64Array(NB))}
 const tmr=mask&&new Float64Array(NB),tmi=mask&&new Float64Array(NB),tsr=mask&&new Float64Array(NB),tsi=mask&&new Float64Array(NB),re=new Float64Array(N),im=new Float64Array(N),vs=new Float64Array(NB),outL=new Float32Array(H),outR=new Float32Array(H);
 const acc={L:new Float64Array(N),R:new Float64Array(N)};
 let t=0,done=false;const TOT=nF+SM_T;
 /* 한 프레임의 스펙트럼: 입력 (a,b) → 가운데 M·옆 S 의 복소 빈(mr,mi,sr_,si) */
 function spec(a,b,f,mr,mi,sr_,si){const s0=(f-3)*H;
  for(let i=0;i<N;i++){const j=s0+i,w=WIN[i];re[i]=j>=0&&j<len?a[j]*w:0;im[i]=j>=0&&j<len?b[j]*w:0}
  fft(re,im,false);
  for(let k=0;k<NB;k++){const k2=(N-k)&(N-1),ar=re[k],ai=im[k],br=re[k2],bi=im[k2];
   const lr=(ar+br)*.5,li=(ai-bi)*.5,rr=(ai+bi)*.5,ri=(br-ar)*.5; /* L=(X[k]+conj X[N−k])/2, R=(X[k]−conj X[N−k])/(2i) */
   mr[k]=(lr+rr)*.5;mi[k]=(li+ri)*.5;sr_[k]=(lr-rr)*.5;si[k]=(li-ri)*.5}}
 function analyze(f){const sl=f%R5,mr=Mr[sl],mi=Mi[sl],sr_=Sr[sl],si=Si[sl],v=V[sl];
  spec(L,R,f,mr,mi,sr_,si);
  let a=mr,b=mi,c=sr_,d=si;if(mask){spec(mask[0],mask[1],f,tmr,tmi,tsr,tsi);a=tmr;b=tmi;c=tsr;d=tsi}
  for(let k=0;k<NB;k++){const mm=Math.hypot(a[k],b[k]),ss=Math.hypot(c[k],d[k]),r=ss/(mm+1e-12); /* S/M 크기 비(가운데 소리면 0) */
   const x=1-Math.min(1,r);v[k]=x>0?Math.pow(x,o.p):0}}
 function emit(u){ /* 프레임 u 의 평활 마스크로 가운데 성분을 줄여 겹쳐 더하기 */
  const sl=u%R5;
  for(let k=0;k<NB;k++){let s=0,n=0;for(let d=-SM_T;d<=SM_T;d++){const f=u+d;if(f<0||f>=nF)continue;const vv=V[f%R5];for(let e=-SM_F;e<=SM_F;e++){const kk=k+e;if(kk<0||kk>=NB)continue;s+=vv[kk];n++}}vs[k]=n?s/n:0}
  const mr=Mr[sl],mi=Mi[sl],sr_=Sr[sl],si=Si[sl];
  for(let k=0;k<NB;k++){const g=1-o.strength*(1-o.floor)*vs[k]*gBand[k],Mr_=mr[k]*g,Mi_=mi[k]*g,lr=Mr_+sr_[k],li=Mi_+si[k],rr=Mr_-sr_[k],ri=Mi_-si[k];
   re[k]=lr-ri;im[k]=li+rr; /* Y=L'+iR' */
   if(k>0&&k<N/2){re[N-k]=lr+ri;im[N-k]=-li+rr} /* Y[N−k]=conj(L')+i·conj(R') */}
  fft(re,im,true);
  const s0=(u-3)*H;for(let i=0;i<N;i++){acc.L[i]+=re[i]/N*WIN[i]*.5;acc.R[i]+=im[i]/N*WIN[i]*.5}
  /* 앞 H 표본은 더 이상 겹치지 않으므로 확정해서 내보낸다 */
  for(let i=0;i<H;i++){outL[i]=acc.L[i];outR[i]=acc.R[i]}
  const p0=s0,a=Math.max(0,-p0),b=Math.min(H,len-p0);
  if(b>a)sink(p0+a,outL.subarray(a,b),outR.subarray(a,b));
  acc.L.copyWithin(0,H);acc.R.copyWithin(0,H);acc.L.fill(0,N-H);acc.R.fill(0,N-H)}
 return {frames:TOT,get pos(){return t},get done(){return done},
  step(maxF){let n=0;while(t<TOT&&n<maxF){if(t<nF)analyze(t);const u=t-SM_T;if(u>=0&&u<nF)emit(u);t++;n++}if(t>=TOT)done=true;return t/TOT}}}
/* 한 번에 처리(시험·벤치용): Float32Array 쌍을 돌려준다 */
function process(L,R,sr,opt,mask){const oL=new Float32Array(L.length),oR=new Float32Array(R.length),job=createJob(L,R,sr,opt,(p,l,r)=>{oL.set(l,p);oR.set(r,p)},mask);while(!job.done)job.step(256);return [oL,oR]}
const api={process,createJob,isMono,sideRatioDb,DEF,N,H};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VocalReduce=api})(typeof window!=='undefined'?window:globalThis);
