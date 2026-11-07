/* 곡 구간(반복 구조) 추정 — 모델 없음. 마디별 특징(크로마 12차원 + 소리 대역 몇 개) → 마디×마디 자기유사도 → Foote 체커보드 커널 신기성 곡선
   → 4마디 배수 선호 경계 선택 → 구간끼리 비슷하면 같은 글자(A·B·C…). "같은 소리끼리 묶은 이름"일 뿐 절·후렴 판정이 아니다.
   window.Sections / node: module.exports. 마디 0부터, 구간은 [a,b) 반열림. */
(function(root){
const DEF={ctr:0,sm:4,L:2,wB:.3,bd:.5,lam:.7,k:0,minAbs:.06,minRange:.03,minLen:3,snap:.7,tau:.6,minBars:8,silE:.02};
/* 마디별 특징. chroma={C,n,fps}(audioChroma 결과), bandRows={rows:[{id,v}]}(Bands.perBar). 둘 다 없으면 null */
function barFeatures(chroma,bandRows,bars,bpm,offset,o){o=Object.assign({},DEF,o);if(!(bars>0)||!(bpm>0))return null;const bs=240/bpm,hasC=chroma&&chroma.C&&chroma.n>0&&chroma.fps>0;
 const ids=['low','lm','pres','hi','perc'],br=bandRows&&bandRows.rows?ids.map(id=>bandRows.rows.find(r=>r.id===id)).filter(Boolean):[];
 if(!hasC&&!br.length)return null;const D=(hasC?12:0)+br.length,F=Array.from({length:bars},()=>new Float64Array(D));
 if(hasC){const cnt=new Float64Array(bars);for(let f=0;f<chroma.n;f++){const t=(f+2)/chroma.fps,b=Math.floor((t-offset)/bs+1e-9);if(b<0||b>=bars)continue;cnt[b]++;for(let p=0;p<12;p++)F[b][p]+=chroma.C[f*12+p]}
  for(let b=0;b<bars;b++){let s=0;for(let p=0;p<12;p++)s+=F[b][p]*F[b][p];s=Math.sqrt(s)||1;for(let p=0;p<12;p++)F[b][p]/=s}}
 const w=1,off=hasC?12:0;br.forEach((r,j)=>{for(let b=0;b<bars;b++){const v=r.v[b];F[b][off+j]=isFinite(v)?v:0}});
 /* ctr=1이면 곡 평균을 빼서(공통 성분 제거) 코사인이 마디 사이 차이를 드러내게 한다(곡 대부분이 한 소리면 그 소리의 벡터가 작아져 불안정해서 기본은 끔) */
 const m=new Float64Array(D);for(const x of F)for(let d=0;d<D;d++)m[d]+=x[d]/bars;if(o.ctr)for(const x of F)for(let d=0;d<(hasC?12:0);d++)x[d]-=m[d];
 /* 2·4마디 주기로 도는 코드 진행이 마디마다 위상 차이로 가짜 변화를 만들지 않게, 가운데 정렬 가중 이동평균(sm=4: [½,1,1,1,½], 주기 2·4 위상에 무관)으로 거른다 */
 if(o.sm>=2&&bars>2){const h=o.sm/2,G=F.map(x=>new Float64Array(D));for(let i=0;i<bars;i++){let ws=0;for(let k=-h;k<=h;k++){const j=i+k;if(j<0||j>=bars)continue;const w=Math.abs(k)===h?.5:1;ws+=w;for(let d=0;d<D;d++)G[i][d]+=w*F[j][d]}for(let d=0;d<D;d++)G[i][d]/=ws}G.nc=hasC?12:0;return G}
 F.nc=hasC?12:0;return F}
/* 마디 쌍 유사도 = (1-wB)·크로마 코사인 + wB·소리 대역 유사도(1 − 평균제곱차의 제곱근/bd; 대역 값은 곡 안 0~1). 코사인은 크기(조용함/시끄러움)를 못 보므로 대역은 따로 잰다 */
function ssm(F,o){o=Object.assign({},DEF,o);const n=F.length,nc=F.nc==null?12:F.nc,D=n?F[0].length:0,nbd=D-nc,S=Array.from({length:n},()=>new Float64Array(n)),nr=F.map(x=>{let s=0;for(let k=0;k<nc;k++)s+=x[k]*x[k];return Math.sqrt(s)});
 /* 무음 마디(대역 평균이 silE 미만, 대역이 없으면 크로마가 0): 무음끼리는 같고(1) 소리 있는 마디와는 다르다(0). 코사인은 크기를 못 봐서 무음끼리 0 이 되어 도입 무음이 쪼개졌다 */
 const sil=F.map((x,i)=>{if(nbd){let e=0;for(let k=nc;k<D;k++)e+=x[k];return e/nbd<o.silE}return nr[i]<1e-9});
 const wb=nc&&nbd?o.wB:nc?0:1;for(let i=0;i<n;i++)for(let j=i;j<n;j++){if(sil[i]||sil[j]){S[i][j]=S[j][i]=sil[i]&&sil[j]?1:0;continue}let c=0,b=0;if(nc){let d=0;const a=F[i],bb=F[j];for(let k=0;k<nc;k++)d+=a[k]*bb[k];c=nr[i]>1e-9&&nr[j]>1e-9?d/(nr[i]*nr[j]):(i===j?1:0)}
  if(nbd){let q=0;for(let k=nc;k<D;k++){const e=F[i][k]-F[j][k];q+=e*e}b=Math.max(0,1-Math.sqrt(q/nbd)/o.bd)}S[i][j]=S[j][i]=(1-wb)*c+wb*b}return S}
/* 대비 늘리기: 서로 다른 마디 쌍 유사도의 5 백분위를 0, 1을 1로. 폭이 minRange 미만이면(곡 전체가 한 소리) null */
function stretch(S,minRange){const v=[];for(let i=0;i<S.length;i++)for(let j=i+1;j<S.length;j++)v.push(S[i][j]);if(!v.length)return null;v.sort((a,b)=>a-b);const lo=v[Math.floor(.05*(v.length-1))],sp=1-lo;if(!(sp>=minRange))return null;
 return S.map(r=>Float64Array.from(r,x=>Math.max(0,Math.min(1,(x-lo)/sp))))}
/* 경계 i(마디 i-1과 i 사이, 1..n-1)의 신기성: 가우스 테이퍼 체커보드(앞·뒤 블록 안은 +, 가로지르는 블록은 −). 곡 밖은 0으로 채워(전체 가중치로 나눔) 가장자리 값이 부풀어 가짜 봉우리가 되지 않게 한다 */
function novelty(S,L){const n=S.length,nv=new Float64Array(n+1);for(let i=1;i<n;i++){let a=0,wsum=0;for(let u=-L;u<L;u++){const x=i+u;for(let v=-L;v<L;v++){const y=i+v;const inr=x>=0&&x<n&&y>=0&&y<n;
  const g=Math.exp(-((u+.5)*(u+.5)+(v+.5)*(v+.5))/(2*(L/2)*(L/2))),sg=(u<0)===(v<0)?1:-1;if(inr)a+=sg*g*S[x][y];wsum+=g}}nv[i]=wsum?a/wsum:0}return nv}
function segment(S,o){o=Object.assign({},DEF,o);const n=S.length;if(n<o.minBars)return {b:[0,n],nv:null};
 const Ls=Array.isArray(o.L)?o.L:[o.L],nv=new Float64Array(n+1);for(const L of Ls){const x=novelty(S,L);for(let i=0;i<=n;i++)nv[i]+=x[i]/Ls.length}
 let m=0,m2=0,c=0;for(let i=1;i<n;i++){m+=nv[i];m2+=nv[i]*nv[i];c++}m/=c;const sd=Math.sqrt(Math.max(0,m2/c-m*m)),thr=Math.max(o.minAbs,m+o.k*sd);
 const w=i=>nv[i]*(1+o.lam*(i%4===0?1:0)),cand=[];for(let i=o.minLen;i<=n-o.minLen;i++){if(nv[i]<thr&&w(i)<thr)continue;if(nv[i]<=0)continue;let pk=true;for(let d=-2;d<=2;d++){const j=i+d;if(d&&j>=1&&j<n&&w(j)>w(i)+1e-12)pk=false}if(pk)cand.push(i)}
 cand.sort((a,b)=>w(b)-w(a));const acc=[];for(const i of cand)if(acc.every(j=>Math.abs(i-j)>=o.minLen))acc.push(i);
 /* 모호하면 4마디 배수로: 바로 옆(±1) 4배수의 신기성이 이 경계의 snap 배 이상이면 옮긴다 */
 const out=acc.map(i=>{if(i%4===0)return i;for(const j of [i-1,i+1])if(j%4===0&&j>=o.minLen&&j<=n-o.minLen&&nv[j]>=o.snap*nv[i])return j;return i});
 const b=[...new Set(out)].sort((a,b)=>a-b).filter((x,k,a)=>(k===0||x-a[k-1]>=o.minLen));return {b:[0,...b,n],nv}}
/* 구간 쌍 유사도: 같은 위치끼리(i↔i) 자기유사도 평균. 길이가 2배 넘게 다르면 다른 소리로 본다 */
function segSim(S,p,q){const lp=p[1]-p[0],lq=q[1]-q[0],mn=Math.min(lp,lq),mx=Math.max(lp,lq);if(mx>2*mn)return -1;let s=0;for(let i=0;i<mn;i++)s+=S[p[0]+i][q[0]+i];return s/mn}
function label(S,bnd,o){o=Object.assign({},DEF,o);const segs=[];for(let i=0;i+1<bnd.length;i++)segs.push([bnd[i],bnd[i+1]]);
 let cl=segs.map((_,i)=>[i]);const avg=(A,B)=>{let s=0;for(const i of A)for(const j of B)s+=segSim(S,segs[i],segs[j]);return s/(A.length*B.length)};
 for(;;){let best=-9,bi=-1,bj=-1;for(let i=0;i<cl.length;i++)for(let j=i+1;j<cl.length;j++){const v=avg(cl[i],cl[j]);if(v>best){best=v;bi=i;bj=j}}if(best<o.tau)break;cl[bi]=cl[bi].concat(cl[bj]);cl.splice(bj,1)}
 const lab=new Array(segs.length);cl.sort((a,b)=>Math.min(...a)-Math.min(...b)).forEach((c,k)=>{const l=k<26?String.fromCharCode(65+k):'Z'+(k-25);for(const i of c)lab[i]=l});
 return segs.map((s,i)=>({a:s[0],b:s[1],l:lab[i]}))}
function estimate(chroma,bandRows,bars,bpm,offset,o){o=Object.assign({},DEF,o);const one=[{a:0,b:Math.max(0,bars),l:'A'}],res={v:1,bars,bpm,off:offset,segs:one};
 if(!(bars>0)||bars<o.minBars)return res;const F=barFeatures(chroma,bandRows,bars,bpm,offset,o);if(!F)return res;const S0=ssm(F,o),S=stretch(S0,o.minRange);if(!S)return res;const sg=segment(S,o);if(sg.b.length<3)return res;res.segs=label(S,sg.b,o);return res}
/* 저장된 값 검증: 마디 수·BPM·첫 박이 지금과 같고 구간이 [0,bars)을 빈틈없이 덮을 때만 쓴다(옛 저장분에는 없음) */
function valid(sv,bars,bpm,offset){if(!sv||sv.v!==1||sv.bars!==bars||sv.bpm!==bpm||sv.off!==offset||!Array.isArray(sv.segs)||!sv.segs.length)return null;let p=0;for(const s of sv.segs){if(!s||s.a!==p||!(s.b>s.a)||typeof s.l!=='string'||!/^[A-Z][0-9]*$/.test(s.l))return null;p=s.b}return p===bars?sv:null}
const api={DEF,barFeatures,ssm,stretch,novelty,segment,segSim,label,estimate,valid};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Sections=api})(typeof window!=='undefined'?window:globalThis);
