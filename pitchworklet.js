/* 마이크 샘플을 모아 일정한 간격(hop)으로 분석 창(win 샘플)을 main 스레드로 보낸다. YIN 은 main 에서 돈다(오디오 스레드를 막지 않는다).
   end = 창 끝의 오디오 시계 표본 번호(currentFrame+128). main 은 (end - win/2)/sampleRate 를 창 중심 시각으로 쓴다.
   AudioWorkletGlobalScope 안에서만 실행된다(node 시험은 sing.js 의 순수 함수를 쓴다). */
class PitchFrames extends AudioWorkletProcessor{
 constructor(o){super();const p=o.processorOptions||{};this.win=p.win|0||2048;this.hop=Math.max(128,p.hop|0||512);
  let c=1;while(c<this.win)c*=2;this.cap=c;this.ring=new Float32Array(c);this.n=0;this.sinceHop=0;this.on=true;
  this.port.onmessage=e=>{if(e.data==='stop')this.on=false}}
 process(inputs){if(!this.on)return false;const ch=inputs[0]&&inputs[0][0],len=ch?ch.length:128,R=this.ring,m=this.cap-1;
  for(let i=0;i<len;i++)R[(this.n+i)&m]=ch?ch[i]:0;this.n+=len;this.sinceHop+=len;
  if(this.n>=this.win&&this.sinceHop>=this.hop){this.sinceHop-=this.hop;const out=new Float32Array(this.win),s=this.n-this.win;
   for(let i=0;i<this.win;i++)out[i]=R[(s+i)&m];this.port.postMessage({end:currentFrame+len,buf:out},[out.buffer])}
  return true}}
registerProcessor('pitch-frames',PitchFrames);
