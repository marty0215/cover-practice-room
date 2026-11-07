/* MusicXML 4.0 악보(리드 시트) 만들기 (의존성: staff.js 의 layout/keySig, 순수 함수·DOM 없음). window.MusicXML, node 에서는 module.exports.
   - build(o): 멜로디 1단(+선택 베이스 1단) + 마디/반마디 코드 기호(<harmony> root·kind·bass). 4/4, divisions=4(16분 = 1), 마디마다 길이 합 16.
   - 음높이·조는 이조 반영(o.transpose 반음) 상태 그대로. 템포는 곡 BPM(o.bpm)을 쓰고 연습 템포(o.rate)는 부제에만 적는다. 가사는 다루지 않는다 */
(function(root){
const NS=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],NF=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const KIND={'':['major',''],m:['minor','m'],'7':['dominant','7'],maj7:['major-seventh','maj7'],m7:['minor-seventh','m7'],sus4:['suspended-fourth','sus4'],sus2:['suspended-second','sus2'],dim:['diminished','dim'],m7b5:['half-diminished','m7b5'],dim7:['diminished-seventh','dim7'],m6:['minor-sixth','m6'],'9':['dominant-ninth','9'],'6':['major-sixth','6'],aug:['augmented','aug'],add9:['major','add9']};
const TYPE={16:'whole',12:'half',8:'half',6:'quarter',4:'quarter',3:'eighth',2:'eighth',1:'16th'};
const CRE=/^([A-G]#?)(maj7|m7b5|m7|m6|m|7|sus4|sus2|dim7|dim|aug|add9|9|6)?(?:\/([A-G]#?))?$/,mod=n=>((n%12)+12)%12;
/* XML 1.0 에서 못 쓰는 문자(제어문자·짝 없는 서로게이트)를 빼고 이스케이프 */
const esc=s=>String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function parseChord(c){const m=CRE.exec(String(c||''));if(!m)return null;const r=NS.indexOf(m[1]),b=m[3]?NS.indexOf(m[3]):null;return {root:r,q:m[2]||'',bass:b===r?null:b}}
const sp=(pc,flat)=>{const n=(flat?NF:NS)[mod(pc)];return {step:n[0],alter:n[1]==='#'?1:n[1]==='b'?-1:0,name:n}};
/* 코드 문자열 → <harmony> (이조·조표 철자 반영). 읽을 수 없으면 빈 문자열 */
/* 철자는 sing.js chordLabel 과 같은 규칙(조 안 근음은 조표대로, 조 밖은 ♭II·♭III·♯IV·♭VI·♭VII, 슬래시 베이스는 근음에서 센 음정 글자: C 장조 Bb, D/F#) */
const nm=n=>({step:n[0],alter:[...n.slice(1)].reduce((s,c)=>s+(c==='#'?1:c==='b'?-1:0),0),name:n});
function harmony(c,keyPc,tr,off,St){const p=parseChord(c);if(!p)return '';const SL=root.SingLab||(typeof require!=='undefined'?require('./sing.js'):null),kk=mod(keyPc+tr),rn=SL.pcName(p.root+tr,kk,{chord:1,minor:p.q==='m'||p.q==='m7'||p.q==='dim'||p.q==='m7b5'||p.q==='dim7'||p.q==='m6'}),r=nm(rn),k=KIND[p.q],al=(x,t)=>x.alter?`<${t}-alter>${x.alter}</${t}-alter>`:'';
 let s=`<harmony><root><root-step>${r.step}</root-step>${al(r,'root')}</root><kind${k[1]?` text="${k[1]}"`:''}>${k[0]}</kind>`;
 if(p.bass!=null){const b=nm(SL.bassName(rn,p.bass+tr,kk));s+=`<bass><bass-step>${b.step}</bass-step>${al(b,'bass')}</bass>`}
 if(p.q==='add9')s+='<degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>';
 return s+(off?`<offset>${off}</offset>`:'')+'</harmony>'}
/* 단선율로 줄이기: 16분 격자에 맞춘 뒤 같은 시작이면 윗음(low 면 아랫음), 겹치면 앞 음을 뒤 음 시작에서 자른다 */
/* trip(셋잇단 박 번호 목록)가 있으면 12분의 1 박 격자(그 박은 셋잇단 8분, 나머지는 16분)로 맞추고 박 단위 [시작,길이,음]을 돌려준다. 없으면 예전과 같은 16분 격자 */
function mono(ns,low,trip){const T=new Set(trip||[]),hT=T.size>0,K=hT?12:4,qp=t=>{if(!hT)return Math.round(t*4);const b=Math.floor(t+1e-9),f=t-b;return b*12+(T.has(b)?Math.round(f*3)*4:Math.round(f*4)*3)};
 const q=ns.filter(n=>n&&isFinite(n[0]+n[1]+n[2])&&n[0]>=0&&n[1]>0).map(n=>{const a=qp(n[0]);return {a,b:Math.max(a+(hT?(T.has(Math.floor(a/12))?4:3):1),qp(n[0]+n[1])),m:n[2]}}).sort((x,y)=>x.a-y.a||(low?x.m-y.m:y.m-x.m)),o=[];
 for(const e of q){const l=o[o.length-1];if(l&&l.a===e.a)continue;if(l&&l.b>e.a)l.b=e.a;o.push(e)}return o.map(e=>[e.a/K,(e.b-e.a)/K,e.m])}
const ACCN={'#':'sharp',b:'flat',n:'natural'};
/* 셋잇단: divisions=12 일 때 한 칸(셋잇단 8분)=4, 3:2 time-modification, 묶음 처음·끝에 <tuplet>. 요소 순서는 스키마대로 duration, tie, voice, type, dot, accidental, time-modification, beam, notations */
const TM=it=>it.tr?'<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>':'';
const TUP=it=>it.tup?`<tuplet type="${it.tup}"${it.tup==='start'?' bracket="yes" number="1"':' number="1"'}/>`:'';
function noteXml(it,St,D,sh){D=D||1;sh=sh||0;const t=`<type>${TYPE[it.u]}</type>${it.dots?'<dot/>':''}`,du=it.tr?it.tr.n*4:it.u*D;
 if(it.k==='r')return `<note><rest/><duration>${du}</duration><voice>1</voice>${t}${TM(it)}${it.tup?`<notations>${TUP(it)}</notations>`:''}</note>`;
 const al=it.acc0?`<alter>${it.acc0}</alter>`:'';
 return `<note><pitch><step>${'CDEFGAB'[it.l]}</step>${al}<octave>${it.oct+sh}</octave></pitch><duration>${du}</duration>${it.tiePrev?'<tie type="stop"/>':''}${it.tieNext?'<tie type="start"/>':''}<voice>1</voice>${t}${it.acc?`<accidental>${ACCN[it.acc]}</accidental>`:''}${TM(it)}${(it.bm||[]).map(b=>`<beam number="${b[0]}">${b[1]}</beam>`).join('')}${it.tiePrev||it.tieNext||it.tup?`<notations>${it.tiePrev?'<tied type="stop"/>':''}${it.tieNext?'<tied type="start"/>':''}${TUP(it)}</notations>`:''}</note>`}
/* 건반 파트 한 항목(화음이면 <note> 여러 개, 둘째부터 <chord/>). 요소 순서: chord, pitch|rest, duration, tie, voice, type, dot, accidental, time-modification, staff, beam, notations */
function keyXml(it,D,staff,voice,whole){const du=it.u*D,t=`<type>${TYPE[it.u]}</type>${it.dots?'<dot/>':''}`,sf=`<staff>${staff}</staff>`;
 if(it.k==='r')return whole?`<note><rest measure="yes"/><duration>${du}</duration><voice>${voice}</voice>${sf}</note>`:`<note><rest/><duration>${du}</duration><voice>${voice}</voice>${t}${sf}</note>`;
 return it.notes.map((n,i)=>`<note>${i?'<chord/>':''}<pitch><step>${'CDEFGAB'[n.l]}</step>${n.acc0?`<alter>${n.acc0}</alter>`:''}<octave>${n.oct}</octave></pitch><duration>${du}</duration>${it.tiePrev?'<tie type="stop"/>':''}${it.tieNext?'<tie type="start"/>':''}<voice>${voice}</voice>${t}${n.acc?`<accidental>${ACCN[n.acc]}</accidental>`:''}${sf}${(it.bm||[]).map(b=>`<beam number="${b[0]}">${b[1]}</beam>`).join('')}${it.tiePrev||it.tieNext?`<notations>${it.tiePrev?'<tied type="stop"/>':''}${it.tieNext?'<tied type="start"/>':''}</notations>`:''}</note>`).join('')}
/* 8va/8vb: 음 높이는 연주(실제) 높이 그대로 두고 <octave-shift>(표시 지시)만 쓴다. MusicXML 4.0: 오선 위 8va 는 음 데이터에서 아래로 옮긴 표시이므로 type="down", 8vb 는 "up". 연속한 같은 종류 마디는 한 구간으로 묶는다 */
const OSH=(t,ty,pl)=>`<direction placement="${pl}"><direction-type><octave-shift type="${ty}"${ty==='stop'?'':' size="8"'} number="1"/></direction-type></direction>`;
const osStart=t=>t==='8va'?OSH(t,'down','above'):OSH(t,'up','below'),osStop=t=>OSH(t,'stop',t==='8va'?'above':'below');
const CLEF={treble:'<sign>G</sign><line>2</line>',treble8:'<sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change>',bass:'<sign>F</sign><line>4</line>'};
function keysPart(p,St,D,keyPc,minor,bars,fifths){const g=St.grand(p.keys,{key:keyPc,minor,bars}),L=16*D;let x=`<part id="${p.id}">\n`;
 g.bars.forEach((b,bi)=>{let m=`<measure number="${bi+1}">`;
  if(!bi)m+=`<attributes><divisions>${4*D}</divisions><key><fifths>${fifths}</fifths><mode>${minor?'minor':'major'}</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;
  const stf=(items,staff,voice)=>{const w=items.length===1&&items[0].k==='r'&&items[0].u===16;return items.map(it=>keyXml(it,D,staff,voice,w)).join('')};
  m+=stf(b.t,1,1)+`<backup><duration>${L}</duration></backup>`+stf(b.b,2,5);x+=m+'</measure>\n'});
 return x+'</part>\n'}
function build(o){const St=o.Staff||(typeof require!=='undefined'?require('./staff.js'):root.Staff),tr=o.transpose|0,bars=Math.max(1,o.bars|0),keyPc=mod((o.key|0)+tr),ks=St.keySig(keyPc),fifths=ks.kind==='b'?-ks.n:ks.n,flat=ks.kind==='b';
 const bpm=Math.round((o.bpm||100)*100)/100,pct=Math.round((o.rate||1)*100),minor=!!o.minor,kname=St.keyName(keyPc,minor),title=String(o.title||'cover');
 const ch=(o.chords||[]).slice(0,bars),spl=o.split||[],tA=v=>Array.isArray(v)?v:[],tM=tA(o.melody&&o.melody.trip!=null?o.melody.trip:o.trip),tB=tA(o.bass&&o.bass.trip),D=(tM.length||tB.length)?3:1;/* 격자는 파트마다(스윙 베이스·직선 멜로디가 서로 격자를 빌리지 않게). bass.trip 이 없으면 직선 */
 const harm=bi=>{const c=ch[bi];if(c==null)return [];const s=spl[bi];return s&&s.a&&s.b?(s.a===s.b?[[0,s.a]]:[[0,s.a],[8,s.b]]):[[0,c]]};
 const parts=[{id:'P1',name:o.melody?o.melody.name:'코드 악보',notes:o.melody?mono(o.melody.notes,false,tM):[],lead:true,trip:tM}];if(o.bass)parts.push({id:'P2',name:o.bass.name||'베이스',notes:mono(o.bass.notes,true,tB),lead:false,trip:tB});
 const kn=(o.keys||[]).map(n=>[n[0],n[1],n[2]+tr]).filter(n=>n&&isFinite(n[0]+n[1]+n[2])&&n[0]>=0&&n[1]>0&&n[2]>=0&&n[2]<=127);
 if(o.keys&&o.keys.length)parts.push({id:'P'+(parts.length+1),name:'건반',keys:kn,notes:[],lead:false,trip:[]});
 let x='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0">\n';
 x+=`<work><work-title>${esc(`${title} (${kname} ${minor?'단조':'장조'}${tr?`, 키 ${tr>0?'+':''}${tr}`:''})`)}</work-title></work>\n`;
 x+=`<identification><encoding><software>커버 연습실</software><encoding-date>${esc(o.date||new Date().toISOString().slice(0,10))}</encoding-date></encoding><miscellaneous><miscellaneous-field name="note">${esc('신호 기반 추정. 청취 검증 없음. 가사 없음.')}</miscellaneous-field></miscellaneous></identification>\n`;
 const sub=`${minor?St.keyLabel(keyPc,true):kname+' 장조'} · 4/4${tr?` · 원곡 키에서 ${tr>0?'+':''}${tr}반음 이조해 이 높이로 적음`:''} · ${o.melody?`멜로디: ${o.melody.name}`:'멜로디 없이 코드만'} · 곡 템포 ${bpm} BPM(연습 템포 ${pct}% = ${Math.round(bpm*(o.rate||1))} BPM은 적용 안 함)`;
 x+=`<credit page="1"><credit-type>title</credit-type><credit-words justify="center" valign="top" font-size="20">${esc(title)}</credit-words></credit>\n<credit page="1"><credit-type>subtitle</credit-type><credit-words justify="center" valign="top" font-size="10">${esc(sub)}</credit-words></credit>\n`;
 x+='<part-list>'+parts.map(p=>`<score-part id="${p.id}"><part-name>${esc(p.name)}</part-name></score-part>`).join('')+'</part-list>\n';
 for(const p of parts){if(p.keys){x+=keysPart(p,St,D,keyPc,minor,bars,fifths);continue}
  const lay=St.layout(p.notes.map(n=>[n[0],n[1],n[2]+tr]).filter(n=>n[2]>=0&&n[2]<=127),{key:keyPc,minor,bars,trip:p.trip,clef:p.notes.length?undefined:'treble',ottava:!!(o.ottava&&p.lead)});x+=`<part id="${p.id}">\n`;
  lay.bars.forEach((b,bi)=>{let m=`<measure number="${bi+1}">`;
   if(!bi){m+=`<attributes><divisions>${4*D}</divisions><key><fifths>${fifths}</fifths><mode>${minor?'minor':'major'}</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef>${CLEF[lay.clef]}</clef></attributes>`;
    if(p.lead)m+=`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`}
   const ot=b.ott||null,sh=ot==='8va'?1:ot==='8vb'?-1:0,prevOt=bi?lay.bars[bi-1].ott||null:null;/* 이 마디 표시 8va 는 음 높이를 옮겼으므로 sh 로 되돌려 연주 높이로 적는다 */
   if(ot&&ot!==prevOt)m+=osStart(ot);
   const hs=p.lead?harm(bi).slice():[];
   if(b.items.length===1&&b.items[0].k==='r'&&b.items[0].u===16){for(const h of hs)m+=harmony(h[1],o.key|0,tr,h[0]*D,St);m+=`<note><rest measure="yes"/><duration>${16*D}</duration><voice>1</voice></note>`}
   else for(const it of b.items){while(hs.length&&hs[0][0]<it.pos+(it.tr?it.tr.n*4/3:it.u)-1e-6){const h=hs.shift();m+=harmony(h[1],o.key|0,tr,Math.round((h[0]-it.pos)*D),St)}m+=noteXml(it,St,D,sh)}
   if(ot&&(bi===lay.bars.length-1||lay.bars[bi+1].ott!==ot))m+=osStop(ot);
   x+=m+'</measure>\n'});x+='</part>\n'}
 return x+'</score-partwise>\n'}
const api={build,keysPart,harmony,parseChord,mono,esc};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MusicXML=api})(typeof window!=='undefined'?window:globalThis);
