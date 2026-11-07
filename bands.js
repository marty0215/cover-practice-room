/* 마디별 소리 대역 활동 — 믹스 신호에서 직접 잰 대역 에너지·타격 밀도·평탄도·스테레오 지표(모델 없음, 화면 없음).
   window.Bands / node: module.exports. 악기 판정이 아니다: "그 대역에 소리가 얼마나 있는가"만 잰다.
   1단계 frames(L,R,sr): 프레임(2048, hop 1024)마다 대역 에너지 등 9개 계열을 한 번의 복소 FFT(L+iR)로 얻는다. 박자와 무관하므로 저장해 두고
   2단계 perBar(fr,bpm,offset,bars): 박 격자(첫 박·BPM)에 맞춰 마디별로 모으고 곡 안에서 0~1로 정규화한다(박자를 다시 맞춰도 오디오 없이 다시 계산). */
(function(root){
const N=2048,HOP=1024,KEYS=['low','lm','pres','hi','flat','flux','side','tot','ctr'];
const BANDS={low:[20,150],lm:[150,2000],pres:[2000,6000],hi:[6000,1e9]};
function fftInPlace(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
 for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang),h=len>>1;for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<h;j++){const a=i+j,b=a+h,vr=re[b]*cr-im[b]*ci,vi=re[b]*ci+im[b]*cr;re[b]=re[a]-vr;im[b]=im[a]-vi;re[a]+=vr;im[a]+=vi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t}}}}
/* L·R(같은 길이 Float32Array)에서 프레임 계열을 만든다. 모노(L==R)이면 stereo=false */
function frames(L,R,sr,fft){fft=fft||fftInPlace;const n=Math.max(0,Math.floor((L.length-N)/HOP)+1),win=new Float32Array(N);for(let i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/N);
 const s={};for(const k of KEYS)s[k]=new Float32Array(n);const re=new Float32Array(N),im=new Float32Array(N),H=N/2,sc=1/(N*N),bin=sr/N;
 const k1=Math.max(1,Math.ceil(20/bin)),kLM=Math.ceil(150/bin),kPR=Math.ceil(2000/bin),kHI=Math.ceil(6000/bin),kFl=Math.ceil(1000/bin),kFh=Math.min(H-1,Math.floor(10000/bin));
 let prev=new Float32Array(H),sSide=0,sTot=0,raw=new Float32Array(n);
 for(let f=0;f<n;f++){const o=f*HOP;for(let i=0;i<N;i++){re[i]=L[o+i]*win[i];im[i]=R[o+i]*win[i]}fft(re,im);
  let lo=0,lm=0,pr=0,hi=0,side=0,tot=0,ctr=0,lg=0,ar=0,nf=0,fl=0;
  for(let k=1;k<H;k++){const a=re[k],b=im[k],c=re[N-k],d=im[N-k];
   const Lr=(a+c)/2,Li=(b-d)/2,Rr=(b+d)/2,Ri=-(a-c)/2; /* Z=FFT(L+iR) 에서 L,R 스펙트럼 분리 */
   const Mr=(Lr+Rr)/2,Mi=(Li+Ri)/2,Sr=(Lr-Rr)/2,Si=(Li-Ri)/2,pM=(Mr*Mr+Mi*Mi)*sc,pS=(Sr*Sr+Si*Si)*sc,p=pM+pS;
   if(k>=k1&&k<kLM)lo+=p;else if(k>=kLM&&k<kPR)lm+=p;else if(k>=kPR&&k<kHI)pr+=p;else if(k>=kHI)hi+=p;
   if(k>=kLM&&k<kHI){side+=pS;tot+=p;if(pS<.1*pM)ctr+=p}
   if(k>=kFl&&k<=kFh){lg+=Math.log(p+1e-14);ar+=p;nf++}
   const mg=Math.log1p(1e3*Math.sqrt(pM));if(f>0&&mg>prev[k])fl+=mg-prev[k];prev[k]=mg}
  s.low[f]=lo;s.lm[f]=lm;s.pres[f]=pr;s.hi[f]=hi;s.side[f]=side;s.tot[f]=tot;s.ctr[f]=ctr;s.flat[f]=nf&&ar>1e-12?Math.exp(lg/nf)/(ar/nf):0;raw[f]=fl;sSide+=side;sTot+=tot}
 /* 온셋 세기: 플럭스에서 앞뒤 ±8프레임 평균을 빼고 0 아래는 자른다(채보 박자 추정의 onsetStrength 와 같은 방식) */
 const w=8;for(let i=0;i<n;i++){let t=0,c=0;for(let j=Math.max(0,i-w);j<Math.min(n,i+w);j++){t+=raw[j];c++}s.flux[i]=Math.max(0,raw[i]-t/c)}
 return {n,fps:sr/HOP,hop:HOP,N,sr,stereo:sTot>1e-12&&sSide/sTot>1e-4,s}}
/* 저장용 정리·복원. 이상하면 null (옛 저장 분석에는 없음) */
function pack(fr){return fr?{v:1,n:fr.n,fps:fr.fps,hop:fr.hop,N:fr.N,sr:fr.sr,stereo:!!fr.stereo,s:fr.s}:null}
function unpack(o){if(!o||o.v!==1||!(o.n>0)||!(o.fps>0)||!o.s)return null;const s={};for(const k of KEYS){const a=o.s[k];if(!a||a.length!==o.n)return null;const f=a instanceof Float32Array?a:Float32Array.from(a);for(let i=0;i<f.length;i++)if(!isFinite(f[i]))return null;s[k]=f}return {n:o.n,fps:o.fps,hop:o.hop,N:o.N,sr:o.sr,stereo:!!o.stereo,s}}
const pctl=(a,q)=>{if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y),i=(b.length-1)*q,l=Math.floor(i),h=Math.ceil(i);return b[l]+(b[h]-b[l])*(i-l)};
/* 곡 안 0~1: 5~95 백분위로 늘린다(빈 마디 null 은 0). 5~95 백분위 폭이 minSpan 미만이면(거의 일정; 일정한 소리의 계산 잡음을 늘려 무늬로 보이지 않게) 전부 0. 행마다 단위가 달라 MIN_SPAN 으로 정한다(검수 #11) */
function norm01(v,minSpan=1e-9){const x=v.filter(a=>a!=null&&isFinite(a)),lo=pctl(x,.05),hi=pctl(x,.95),sp=hi-lo;return v.map(a=>a==null||!isFinite(a)||!(sp>=minSpan&&sp>1e-12)?0:Math.max(0,Math.min(1,(a-lo)/sp)))}
/* 온셋 세기 절대 하한: 일정한 소리의 계산 잡음(곡 평균+0.5 표준편차가 이 아래로 내려가는 경우)을 타격으로 세지 않는다 */
const FLUX_FLOOR=0.2;
const MIN_SPAN={low:.5,lm:.5,pres:.5,hi:.5,perc:.3,flat:0,width:.01,ctr:.01}; /* 에너지 행은 dB(0.5 dB 미만 차이는 구분 안 함), perc 는 초당 횟수, width·ctr 은 0~1 비율, flat 은 곡 중앙값의 10% 미만이면 일정으로 본다 */
const db=e=>10*Math.log10(e+1e-12);
const ROWS=[
 {id:'low',label:'저음 대역(베이스·킥 등)',sub:'20~150 Hz 에너지'},
 {id:'lm',label:'중저음 대역',sub:'150 Hz~2 kHz 에너지'},
 {id:'pres',label:'중고음 대역',sub:'2~6 kHz 에너지(말소리·선율이 자리하는 영역)'},
 {id:'hi',label:'고음 대역(하이햇·심벌 등)',sub:'6 kHz 위 에너지'},
 {id:'perc',label:'타격 밀도',sub:'소리가 갑자기 커지는 횟수(초당)'},
 {id:'flat',label:'잡음 정도',sub:'스펙트럼 평탄도 1~10 kHz(높을수록 잡음 같은 소리)'},
 {id:'width',label:'스테레오 폭',sub:'좌우가 다른 소리의 비중'},
 {id:'ctr',label:'가운데 소리 비중',sub:'150 Hz~6 kHz 에서 좌우가 같은 소리의 비중. 보컬 유무 지표가 아님(시험한 곡에서 보컬과 상관 없음)'}];
/* 마디 b 의 구간 = [offset+4·spb·b, +4·spb). 프레임 중심 시각으로 마디에 넣는다 */
function perBar(fr,bpm,offset,bars){if(!fr||!(bpm>0)||!(bars>0))return null;const spb=60/bpm,bs=4*spb,n=fr.n,s=fr.s,idx=new Int32Array(n);
 for(let f=0;f<n;f++){const t=(f*fr.hop+fr.N/2)/fr.sr,b=Math.floor((t-offset)/bs+1e-9);idx[f]=b>=0&&b<bars?b:-1}
 const cnt=new Float64Array(bars),acc={};for(const k of KEYS)acc[k]=new Float64Array(bars);
 for(let f=0;f<n;f++){const b=idx[f];if(b<0)continue;cnt[b]++;for(const k of KEYS)if(k!=='flux')acc[k][b]+=s[k][f]}
 /* 타격 밀도: 온셋 세기의 지역 최대(±2프레임) 가운데 곡 평균+0.5 표준편차를 넘는 것의 수 / 마디 길이 */
 let m=0,m2=0;for(let f=0;f<n;f++){m+=s.flux[f];m2+=s.flux[f]*s.flux[f]}m/=n||1;const sd=Math.sqrt(Math.max(0,m2/(n||1)-m*m)),thr=Math.max(m+.5*sd,FLUX_FLOOR),pk=new Float64Array(bars);
 for(let f=0;f<n;f++){const b=idx[f],v=s.flux[f];if(b<0||v<=thr)continue;let ok=true;for(let d=-2;d<=2&&ok;d++){const g=f+d;if(d&&g>=0&&g<n&&(s.flux[g]>v||(s.flux[g]===v&&d<0)))ok=false}if(ok)pk[b]++}
 const per=(k,fn)=>Array.from({length:bars},(_,b)=>cnt[b]?fn(acc[k][b]/cnt[b],b):null);
 const raw={low:per('low',db),lm:per('lm',db),pres:per('pres',db),hi:per('hi',db),perc:Array.from({length:bars},(_,b)=>cnt[b]?pk[b]/bs:null),flat:per('flat',x=>x)};
 if(fr.stereo){raw.width=Array.from({length:bars},(_,b)=>cnt[b]&&acc.tot[b]>1e-14?acc.side[b]/acc.tot[b]:null);raw.ctr=Array.from({length:bars},(_,b)=>cnt[b]&&acc.tot[b]>1e-14?acc.ctr[b]/acc.tot[b]:null)}
 /* 소리가 거의 없는 마디(합이 곡 중앙값의 1/1000 미만)는 flat·width·ctr 이 의미 없으므로 비운다 */
 const tt=Array.from({length:bars},(_,b)=>cnt[b]?(acc.low[b]+acc.lm[b]+acc.pres[b]+acc.hi[b])/cnt[b]:0),med=pctl(tt.filter(x=>x>0),.5);
 for(const k of ['flat','width','ctr'])if(raw[k])raw[k]=raw[k].map((x,b)=>tt[b]<med*1e-3?null:x);
 const rows=ROWS.filter(r=>raw[r.id]).map(r=>({id:r.id,label:r.label,sub:r.sub,raw:raw[r.id],v:norm01(raw[r.id],r.id==='flat'?.1*Math.abs(pctl(raw.flat.filter(x=>x!=null&&isFinite(x)),.5)):MIN_SPAN[r.id]).map(x=>Math.round(x*100)/100)}));
 return {bars,stereo:fr.stereo,rows}}
const api={frames,pack,unpack,perBar,norm01,ROWS,KEYS,N,HOP,fft:fftInPlace};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Bands=api})(typeof window!=='undefined'?window:globalThis);
