/* 오선보 렌더러 (의존성 없음, 약 8KB). window.Staff 로 노출, node 에서는 module.exports.
   - layout(notes,{key,beatsPerBar,bars,clef}): [시작박,길이박,midi] 목록 → 마디별 글리프 기술자(순수 함수, DOM 없음). 높은음/낮은음자리표 자동(중앙값 53–59 는 한 옥타브 낮게 읽는 높은음자리표 treble8, 남성 음역 성악 관례), 조표(장조 12키), 임시표(조표 기준, 마디 안 유지), 쉼표 채움, 마디 넘는 음은 붙임줄, 한 박 안 8분·16분은 보 묶음
   - place(lay,{width}): 줄바꿈(시스템 나누기)과 x 좌표. svg(lay,{width,marks,labels}): SVG 문자열. render(el,lay,opts): el.innerHTML 에 넣거나 문자열 반환
   - 보 묶음 규칙(4/4, 한 가지): 8분·16분은 한 박(4칸) 안에서 묶는다. 단 한 반마디(1–2박, 3–4박)가 쉼표·붙임줄 없이 8분음표 4개로만 차 있으면 4개를 한 보로 묶는다(3박 중앙선 안 넘음). 줄기 방향은 묶음 안에서 가운데 줄에서 가장 먼 음 기준
   - 쉼표: 빈 칸을 박 정렬 규칙 안에서 가장 큰 값으로 합쳐 채운다(점쉼표 없음, 3박 중앙선 안 넘음, 빈 마디는 온쉼표). 코드 기호: layout 의 chords 옵션(마디별 [[칸,글자]])을 오선 위 줄에 그린다
   - 길이는 16분음표 단위로 반올림한다(0.25박). 4/4 기준이며 다른 박자는 숫자만 바꿔 그린다(정렬 규칙은 4/4 만 다룸) */
(function(root){
const LP=[0,2,4,5,7,9,11],SH=[3,0,4,1,5,2,6],FL=[6,2,5,1,4,0,3],KS={0:[0,''],7:[1,'#'],2:[2,'#'],9:[3,'#'],4:[4,'#'],11:[5,'#'],6:[6,'#'],5:[1,'b'],10:[2,'b'],3:[3,'b'],8:[4,'b'],1:[5,'b']};
const SSH=[38,35,39,36,33,37,34],SFL=[34,37,33,36,32,35,31];/* 높은음자리 조표 위치(오선 단계). 낮은음자리는 14 를 뺀다 */
const DUR={16:'w',12:'h',8:'h',6:'q',4:'q',3:'e',2:'e',1:'s'};
const mod=n=>((n%12)+12)%12;
function keySig(pc){pc=mod(pc);const [n,k]=KS[pc],ls=(k==='#'?SH:k==='b'?FL:[]).slice(0,n);return {pc,n,kind:k,letters:ls,steps:(k==='#'?SSH:SFL).slice(0,n)}}
/* midi → {l:글자 0–6(C=0), acc:-1|0|1, oct, step:오선 단계(옥타브*7+글자)}. 조 안 음은 조표대로, 조 밖 흰 건반은 제자리표.
   조 밖 검은 건반은 으뜸음 기준 도수로: ♭3·♭7 은 플랫, ♯1·♯4·♯5 는 샤프(C 장조 Eb·Bb, F 장조 F#·C#; 예전 규칙은 C 장조 ♭7 을 A#, F 장조 ♯1 을 Gb 로 적었다). sing.js SOLF·pcName 과 같은 규칙 */
function spell(m,pc){const ks=keySig(pc),A=[0,0,0,0,0,0,0];ks.letters.forEach(l=>A[l]=ks.kind==='#'?1:-1);const p=mod(m);
 const mk=(l,a)=>{const o=Math.floor((m-a-LP[l])/12)-1;return {l,acc:a,oct:o,step:o*7+l}};
 for(let l=0;l<7;l++)if(mod(LP[l]+A[l])===p)return mk(l,A[l]);const w=LP.indexOf(p);if(w>=0)return mk(w,0);
 const r=mod(p-pc);return r===3||r===10?mk(LP.indexOf((p+1)%12),-1):mk(LP.indexOf((p+11)%12),1)}
const okAt=(u,p)=>u===16||u===12?p===0:u===8||u===6?p%8===0:u===4||u===3?p%4===0:u===2?p%2===0:true;
function split(pos,len,rest){const set=rest?[16,8,4,2,1]:[16,12,8,6,4,3,2,1],r=[];while(len>0){const u=set.find(x=>x<=len&&okAt(x,pos));r.push(u);pos+=u;len-=u}return r}
/* 한 마디 items 에 보 묶음·줄기 방향을 정한다(순수 함수). 규칙은 파일 머리 주석 참고. bi = 마디 번호(보 id 용) */
function beamGroups(items,mid,bi){const runs=[];let r=[];
 for(const it of items){const bm=it.k==='n'&&it.u<4;if(bm&&(!r.length||r[r.length-1].pos+r[r.length-1].u===it.pos))r.push(it);else{if(r.length)runs.push(r);r=bm?[it]:[]}}if(r.length)runs.push(r);
 const out=[];for(const run of runs){const bt=[];for(const it of run){const k=Math.floor(it.pos/4);if(bt.length&&bt[bt.length-1].k===k)bt[bt.length-1].g.push(it);else bt.push({k,g:[it]})}
  for(let i=0;i<bt.length;i++){const a=bt[i],b=bt[i+1],e8=x=>x.g.length===2&&x.g.every(t=>t.u===2);
   if(b&&a.k%2===0&&b.k===a.k+1&&e8(a)&&e8(b)){out.push(a.g.concat(b.g));i++}else out.push(a.g)}}
 for(const g of out){if(g.length<2)continue;const id=bi*100+g[0].pos;let far=null;for(const x of g){const d=x.step-mid;if(far===null||Math.abs(d)>Math.abs(far))far=d}for(const x of g){x.beam=id;x.dir=far>=0?'d':'u'}}
 for(const it of items)if(it.k==='n'&&it.beam<0)it.dir=it.step>=mid?'d':'u';
 return out.filter(g=>g.length>=2)}
const chordsOf=c=>(Array.isArray(c)?c:c?[[0,c]]:[]).filter(x=>x&&x[1]!=null&&x[1]!=='').map(x=>({pos:Math.max(0,Math.min(15,x[0]|0)),label:String(x[1])}));
function layout(notes,o={}){const bpb=o.beatsPerBar||4,U=bpb*4,ks=keySig(o.key||0),ord=notes.map((_,i)=>i).sort((x,y)=>notes[x][0]-notes[y][0]),q=[];let pe=0;
 for(const i of ord){const n=notes[i],a=Math.max(Math.round(n[0]*4),pe),b=Math.max(Math.round((n[0]+n[1])*4),a+1);q.push({i,a,b,m:n[2]});pe=b}
 const ps=notes.map(n=>n[2]).sort((a,b)=>a-b),med=ps.length?ps[ps.length>>1]:67,clef=o.clef||(med>=60?'treble':med>=53?'treble8':'bass'),bstep=clef==='bass'?18:clef==='treble8'?23:30,mid=bstep+4,nb=o.bars||Math.max(1,Math.ceil(pe/U)),bars=[];
 for(let b=0;b<nb;b++){const s0=b*U,s1=s0+U,items=[],sg=[];for(const e of q)if(e.b>s0&&e.a<s1)sg.push({e,a:Math.max(e.a,s0)-s0,z:Math.min(e.b,s1)-s0,tp:e.a<s0,tn:e.b>s1});
  const fill=(a,z)=>{let p=a;for(const u of split(a,z-a,true)){items.push({k:'r',pos:p,u,dur:DUR[u],dots:0});p+=u}};let cur=0;
  for(const s of sg){if(s.a>cur)fill(cur,s.a);const us=split(s.a,s.z-s.a,false);let p=s.a;const sp=spell(s.e.m,ks.pc);
   us.forEach((u,j)=>{items.push({k:'n',i:s.e.i,pos:p,u,dur:DUR[u],dots:u===12||u===6||u===3?1:0,midi:s.e.m,step:sp.step,l:sp.l,oct:sp.oct,acc0:sp.acc,acc:'',dir:'u',beam:-1,tiePrev:j?true:s.tp,tieNext:j<us.length-1?true:s.tn});p+=u});cur=s.z}
  if(cur<U)fill(cur,U);
  const A=[0,0,0,0,0,0,0];ks.letters.forEach(l=>A[l]=ks.kind==='#'?1:-1);const st={};
  for(const it of items){if(it.k!=='n')continue;const key=it.l+':'+it.oct,c=key in st?st[key]:A[it.l];if(it.acc0!==c&&!it.tiePrev)it.acc=it.acc0===1?'#':it.acc0===-1?'b':'n';st[key]=it.acc0}
  beamGroups(items,mid,bars.length);
  bars.push({items,chords:chordsOf(o.chords&&o.chords[b])})}
 return {clef,bstep,mid,key:ks,bpb,ts:{n:bpb,d:4},U,bars,count:notes.length}}
const CW=it=>(it.acc?9:0)+12+it.u*4.5;
/* 코드 기호의 x: 그 칸에서 시작하는 항목의 머리 왼쪽(임시표가 있으면 그 왼쪽). 쉼표 안쪽(예: 통쉼표 마디의 3박)이면 항목과 다음 항목(또는 마디 끝) 사이를 칸 비율로 나눈다 */
function chordX(cs,its,bx,bw){const R=v=>Math.round(v*10)/10;return cs.map(c=>{let j=-1;for(let i=0;i<its.length;i++)if(its[i].pos<=c.pos)j=i;
  if(j<0)return {...c,x:R(bx+6)};const it=its[j],left=it.acc?it.ax-2:it.x-7;if(it.pos===c.pos)return {...c,x:R(Math.max(bx+3,left))};
  const nx=its[j+1]?its[j+1].x-7:bx+bw-6;return {...c,x:R(Math.max(bx+3,left+(nx-left)*(c.pos-it.pos)/it.u))}})}
/* 한 줄(system)의 코드 기호 행: 글자 폭을 어림해 겹치면 글자를 줄이고(최소 10px), 그래도 겹치면 뒤 기호를 오른쪽으로 민다 */
function chordRow(sys){const cs=sys.bars.flatMap(b=>b.chords||[]);if(!cs.length)return [];
 const wd=(c,fs)=>c.label.length*fs*.62;let fs=13;const bad=f=>cs.some((c,i)=>i&&cs[i].x-cs[i-1].x<wd(cs[i-1],f)+4);while(fs>10&&bad(fs))fs--;
 const out=[];let end=-1e9;for(const c of cs){const x=Math.max(c.x,end);out.push({x:Math.round(x*10)/10,label:c.label,pos:c.pos,fs});end=x+wd(c,fs)+4}return out}
function place(lay,o={}){const W=o.width||640,M=6,hd=f=>30+lay.key.n*7+(f?18:0)+8,nat=lay.bars.map(b=>16+b.items.reduce((a,x)=>a+CW(x),0)),sys=[];let i=0;
 while(i<nat.length){const first=!sys.length,h=hd(first),av=W-2*M-h;let j=i,t=0;while(j<nat.length&&(j===i||t+nat[j]<=av)){t+=nat[j];j++}
  const last=j>=nat.length,f=Math.min(last?1.25:1.7,Math.max(.01,av/t)),bs=[];let x=M+h;
  for(let b=i;b<j;b++){let c=8,its=[];for(const it of lay.bars[b].items){const aw=it.acc?9:0;its.push({...it,x:Math.round((x+(c+aw+6)*f)*10)/10,ax:Math.round((x+(c+4)*f)*10)/10});c+=CW(it)}
   const bw=Math.round(nat[b]*f*10)/10,bx=Math.round(x*10)/10;
   bs.push({b,x:bx,w:bw,items:its,chords:chordX(lay.bars[b].chords||[],its,bx,bw)});x+=nat[b]*f}
  sys.push({first,x0:M,hdr:h,x1:Math.round(x*10)/10,bars:bs});i=j}
 return {W,systems:sys}}
/* 글리프: 임시표·쉼표·자리표(선으로만 그린 모양, 글꼴 의존 없음). 좌표는 오선 간격 8 기준 */
const ACC={'#':'<path d="M-2.2-8V7M2.2-7V8" class="st-s"/><path d="M-4.5-1.5L4.5-4.5M-4.5 4.5L4.5 1.5" class="st-t"/>','b':'<path d="M-2.5-12V4.5M-2.5 4.5C6 0 5-6-2.5-2" class="st-s"/>','n':'<path d="M-2.5-8V3.5M2.5-3.5V8M-2.5-2L2.5-4M-2.5 4L2.5 2" class="st-s"/>'};
const TREB='M-5 20C-6 26 3 28 3 20C3 10 1-10 1-20C0-28 1-38 4-46C9-40 9-30 1-16C-8-12-10-2-8 3C-5 9 5 10 8 5C11 0 7-7 1-7C-3-7-5-3-3 0',BASS='M-9-2C-4-12 9-9 9 2C9 12-2 20-14 25';
const RST={w:'<rect x="-5" y="0" width="10" height="4" class="st-f"/>',h:'<rect x="-5" y="-4" width="10" height="4" class="st-f"/>',q:'<path d="M-2-11L2.5-5.5L-2-1.5L2.5 3.5C-1 3-3 5-1 8" class="st-s"/>',e:'<circle cx="-2" cy="-3" r="1.8" class="st-f"/><path d="M-.5-3C1-3 2-4 3-6L-1.5 6" class="st-s"/>',s:'<circle cx="-2" cy="-3" r="1.8" class="st-f"/><circle cx="-3" cy="2" r="1.8" class="st-f"/><path d="M-.5-3C1-3 2-4 3-6L-2.5 9" class="st-s"/>'};
const CSS='.st-l{stroke:var(--text-muted,#666);stroke-width:1;fill:none}.st-s{stroke:currentColor;fill:none;stroke-width:1.2;stroke-linecap:round}.st-t{stroke:currentColor;fill:none;stroke-width:2}.st-f{fill:currentColor;stroke:none}.st-o{fill:none;stroke:currentColor;stroke-width:1.7}.st-g{color:var(--text,#111)}.st-g.ok{color:var(--ok,#1d7a42)}.st-g.bad{color:var(--warn,#a15c08)}.st-g.none{color:var(--text-muted,#666)}.st-g.cur{color:var(--accent,#0b6bcb)}.st-c{fill:var(--accent,#0b6bcb);opacity:.14}.st-x{font:11px "JetBrains Mono",monospace;fill:var(--text-muted,#666);text-anchor:middle}.st-ch{font:700 13px "JetBrains Mono",monospace;fill:var(--text,#111);text-anchor:start}.st-v{font:700 12px sans-serif;text-anchor:middle;fill:currentColor}.st-n{font:700 17px sans-serif;text-anchor:middle;fill:var(--text,#111)}';
const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const VG={ok:'✓',hi:'↑',lo:'↓',oct:'8',none:'–'};
function svg(lay,o={}){const pl=place(lay,o),mk=o.marks||{},lb=o.labels,hasV=!!(mk.v&&mk.v.length),yv=mk.v||[],P=[],r1=x=>Math.round(x*10)/10;let Y=0,nh=0;
 const nbar=lay.bars.length;lay.bars.forEach(b=>b.items.forEach(it=>{if(it.k==='n'&&!it.tiePrev)nh++}));
 for(const s of pl.systems){const its=s.bars.flatMap(b=>b.items).filter(x=>x.k==='n');let te=18,be=lay.clef==='treble8'?26:14;
  for(const n of its){const off=n.step-lay.bstep;te=Math.max(te,n.dir==='u'?off*4+28-32:off*4+6-32);be=Math.max(be,n.dir==='d'?-off*4+28:-off*4+6)}
  const crow=chordRow(s),CZ=crow.length?18:0,Y0=Y;Y+=CZ;const yb=Y+te+8+32,y=st=>yb-(st-lay.bstep)*4,top=yb-32,x1=s.x1;let g='';
  g+=`<path class="st-l" d="${[0,1,2,3,4].map(i=>`M${s.x0} ${yb-i*8}H${x1}`).join('')}M${s.x0} ${top}V${yb}"/>`;
  const cv=lay.clef==='bass'?14:lay.clef==='treble8'?7:0,gy=lay.clef==='bass'?y(24):y(32-cv);g+=lay.clef==='bass'?`<g transform="translate(${s.x0+16} ${gy}) scale(.8)"><path d="${BASS}" class="st-s" style="stroke-width:2.6"/><circle cx="-8" cy="0" r="3.6" class="st-f"/><circle cx="14" cy="-5" r="1.8" class="st-f"/><circle cx="14" cy="5" r="1.8" class="st-f"/></g>`:`<g transform="translate(${s.x0+15} ${gy}) scale(.8)"><path d="${TREB}" class="st-s" style="stroke-width:2.4"/></g>${lay.clef==='treble8'?`<text class="st-n" x="${s.x0+12}" y="${yb+22}" style="font-size:10px">8</text>`:''}`;
  lay.key.steps.forEach((st,k)=>{g+=`<g class="st-g" transform="translate(${s.x0+32+k*7} ${y(st-cv)}) scale(.85)">${ACC[lay.key.kind]}</g>`});
  if(s.first){const tx=s.x0+32+lay.key.n*7+9;g+=`<g class="st-ts" data-ts="${lay.ts.n}/${lay.ts.d}"><text class="st-n" x="${tx}" y="${yb-20}">${lay.ts.n}</text><text class="st-n" x="${tx}" y="${yb-4}">${lay.ts.d}</text></g>`}
  for(const c of crow)g+=`<text class="st-ch" x="${c.x}" y="${Y0+13}" data-pos="${c.pos}" style="font-size:${c.fs}px">${esc(c.label)}</text>`;
  const beams={};
  for(const b of s.bars){for(const it of b.items){const hx=it.x;
   if(it.k==='r'){g+=it.dur==='w'?`<g class="st-g" transform="translate(${r1(b.x+b.w/2)} ${yb-24})">${RST.w}</g>`:`<g class="st-g" transform="translate(${hx} ${yb-16})">${RST[it.dur]}</g>`;continue}
   const cy=y(it.step),off=it.step-lay.bstep,cls=['st-g'],ci=mk.cur===it.i;const v=yv[it.i];if(v)cls.push(v==='ok'?'ok':v==='none'?'none':'bad');if(ci)cls.push('cur');
   if(ci)g+=`<rect class="st-c" x="${r1(hx-12)}" y="${top-6}" width="24" height="${yb-top+12}" rx="4"/>`;
   let e='';for(let L=-2;L>=off-.5;L-=2)e+=`M${r1(hx-9)} ${yb-L*4}H${r1(hx+9)}`;for(let L=10;L<=off+.5;L+=2)e+=`M${r1(hx-9)} ${yb-L*4}H${r1(hx+9)}`;if(e)g+=`<path class="st-l" d="${e}"/>`;
   let n=`<ellipse cx="${hx}" cy="${cy}" rx="${it.dur==='w'?6.2:5.2}" ry="3.8" transform="rotate(-20 ${hx} ${cy})" class="${it.dur==='w'||it.dur==='h'?'st-o':'st-f'}"/>`;
   if(it.acc)n+=`<g transform="translate(${it.ax} ${cy}) scale(.85)">${ACC[it.acc]}</g>`;
   if(it.dots)n+=`<circle cx="${hx+9}" cy="${off%2?cy:cy-4}" r="1.5" class="st-f"/>`;
   const up=it.dir==='u',sx=up?hx+4.9:hx-4.9;const tip=up?Math.min(cy-28,y(lay.mid)):Math.max(cy+28,y(lay.mid));
   if(it.beam>=0){(beams[it.beam]=beams[it.beam]||{up,m:[]}).m.push({it,sx,cy,hx})}
   else if(it.dur!=='w'){n+=`<path class="st-s" d="M${r1(sx)} ${r1(cy)}V${r1(tip)}"/>`;if(it.u<4)for(let k=0;k<(it.u===1?2:1);k++){const d=up?1:-1,t=tip+(up?k*6:-k*6);n+=`<path class="st-s" style="stroke-width:1.8" d="M${r1(sx)} ${r1(t)}C${r1(sx)} ${r1(t+d*8)} ${r1(sx+9)} ${r1(t+d*10)} ${r1(sx+7)} ${r1(t+d*20)}"/>`}}
   if(it.tieNext){const nx=nextX(s,b,it),dn=!up||it.dur==='w'?1:-1,x2=nx==null?hx+16:nx;n+=`<path class="st-s" d="M${r1(hx+2)} ${r1(cy+dn*5)}Q${r1((hx+x2)/2)} ${r1(cy+dn*12)} ${r1(x2-2)} ${r1(cy+dn*5)}"/>`}
   g+=`<g class="${cls.join(' ')}" data-i="${it.i}">${n}</g>`;
   if(lb&&lb[it.i]!=null&&!it.tiePrev)g+=`<text class="st-x" x="${hx}" y="${yb+be+12}">${lb[it.i]}</text>`;
   if(hasV&&yv[it.i]&&!it.tiePrev)g+=`<text class="st-v st-g ${yv[it.i]==='ok'?'ok':yv[it.i]==='none'?'none':'bad'}" x="${hx}" y="${yb+be+(lb?26:12)}">${VG[yv[it.i]]||''}</text>`}
   const bx=r1(b.x+b.w);g+=s===pl.systems[pl.systems.length-1]&&b===s.bars[s.bars.length-1]?`<path class="st-s" style="color:var(--text,#111)" d="M${bx-4} ${top}V${yb}"/><path class="st-t" style="color:var(--text,#111)" d="M${bx} ${top}V${yb}"/>`:`<path class="st-s" style="color:var(--text,#111)" d="M${bx} ${top}V${yb}"/>`}
  for(const k in beams){const B=beams[k],up=B.up,ys=B.m.map(m=>up?m.cy-28:m.cy+28),by=up?Math.min(...ys):Math.max(...ys),a=B.m[0],z=B.m[B.m.length-1],th=up?4:-4;let q='';
   for(const m of B.m)q+=`M${r1(m.sx)} ${r1(m.cy)}V${r1(by)}`;
   g+=`<path class="st-s" style="color:var(--text,#111)" d="${q}"/><path class="st-t" style="color:var(--text,#111);stroke-width:4" d="M${r1(a.sx-.6)} ${r1(by+th/2)}H${r1(z.sx+.6)}"/>`;
   B.m.forEach((m,j)=>{if(m.it.u!==1)return;const nx=B.m[j+1],pv=B.m[j-1];let xa=m.sx,xb;if(nx&&nx.it.u===1)xb=nx.sx;else if(pv&&pv.it.u===1)return;else xb=nx?m.sx+7:m.sx-7;
    g+=`<path class="st-t" style="color:var(--text,#111);stroke-width:3" d="M${r1(Math.min(xa,xb))} ${r1(by+(up?6.5:-6.5))}H${r1(Math.max(xa,xb))}"/>`})}
  P.push(`<g>${g}</g>`);Y=yb+be+(lb?16:0)+(hasV?16:0)+4}
 const H=Math.ceil(Y)+4,lab=o.label||`오선보: ${nbar}마디, 음 ${lay.count}개`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pl.W} ${H}" width="100%" role="img" aria-label="${lab}" data-notes="${nh}" style="display:block;max-width:${pl.W}px"><style>${CSS}</style>${P.join('')}</svg>`}
function nextX(s,b,it){const a=b.items,i=a.indexOf(it);for(let j=i+1;j<a.length;j++)if(a[j].k==='n'&&a[j].i===it.i)return a[j].x;const bi=s.bars.indexOf(b),nb=s.bars[bi+1];if(nb)for(const x of nb.items)if(x.k==='n'&&x.i===it.i)return x.x;return null}
function render(el,lay,o){const h=svg(lay,o);if(el){el.innerHTML=h;return h}return h}
const api={layout,place,svg,render,keySig,spell,split,beamGroups,chordRow,rests:(a,z)=>split(a,z-a,true)};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Staff=api})(typeof window!=='undefined'?window:globalThis);
