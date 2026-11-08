// 엔진 검증 (Node, 네트워크 불필요): node backtest/tests/engine_checks_20261106.js
const E=require('../engine_20261030.js');
let seed=12345;const rnd=()=>(seed=(seed*1664525+1013904223)%4294967296)/4294967296;const g=()=>{let u=0;for(let i=0;i<12;i++)u+=rnd();return u-6};
const mkDates=(N,st='2012-01-02')=>{const a=[];let d=new Date(st);while(a.length<N){if(d.getDay()%6)a.push(d.toISOString().slice(0,10));d=new Date(+d+864e5)}return a};
let bad=0,checks=0;const fail=(m,x)=>{bad++;if(bad<15)console.log('  실패:',m,JSON.stringify(x))};const ok=(c,m,x)=>{checks++;if(!c)fail(m,x)};
const close=(a,b,t=1e-6)=>Math.abs(a-b)<=t*Math.max(1,Math.abs(a),Math.abs(b));
const idn=r=>{const n=r.eq.length-1;return close(r.eq[n]-100,r.pnl.x+r.pnl.y.reduce((p,q)=>p+q,0)+r.pnl.int-r.pnl.tax)}; // 최종−100 = TECL손익+방어손익+이자−납부세금
console.log('1) 세금 규칙');
{const dates=mkDates(700,'2013-01-02'),fl=a=>dates.map((_,i)=>a.includes(i));
 let px=dates.map((_,i)=>100*Math.pow(1.001,i)),r=E.simulateEvents(dates,px,[{r:1,n:5,f:fl([])}],[{r:1,n:5,f:fl([])}],{delay:1,init:1,cashRate:0,tax:.22,fee:0});
 ok(r.paid===0&&close(r.eqP[699],r.eq[699]-.22*(r.eq[699]-100)),'매도 없으면 세금 없음, 마지막 즉시 22%',[r.paid]);
 px=dates.map(()=>100);for(let i=20;i<700;i++)px[i]=150;for(let i=60;i<700;i++)px[i]=120;
 r=E.simulateEvents(dates,px,[{r:1,n:5,f:fl([24])}],[{r:1,n:5,f:fl([19,59])}],{delay:1,init:1,cashRate:0,tax:.22,fee:0});
 const T=r.list.filter(x=>x.side==='T');ok(T.length===1&&T[0].i===dates.findIndex(d=>d>='2014-05-01')&&close(T[0].amt,4.4),'이익 50·손실 30 통산 순이익 20의 22%를 다음해 5/1 납부',T.map(x=>x.amt));
 px=dates.map(()=>100);for(let i=20;i<700;i++)px[i]=80;r=E.simulateEvents(dates,px,[{r:1,n:5,f:fl([])}],[{r:1,n:5,f:fl([19])}],{delay:1,init:1,cashRate:0,tax:.22,fee:0});ok(r.paid===0,'손실만 있으면 세금 0',r.paid);
 px=dates.map(()=>100);r=E.simulateEvents(dates,px,[{r:1,n:5,f:fl([])}],[{r:1,n:5,f:fl([10])}],{delay:1,init:1,cashRate:.1,tax:.22,fee:0});ok(r.paid===0&&close(r.eqL[699],r.eq[699]),'현금 이자는 과세 제외',[r.paid]);}
console.log('2) 조합 퍼즈(이평별 지연·상태우선·이평2 하향매수·방어 ETF·세금·수수료)');
for(let t=0;t<1500;t++){const N=[30,200,900][t%3],dates=mkDates(N);let a=100,b=100;const px=[],py=[],sig=[];for(let i=0;i<N;i++){a*=Math.max(.05,1+g()*[.01,.03,.08][t%3]);b*=1+g()*.004+.0002;px.push(a);py.push(b);sig.push(a*(1+g()*.012))}
 const n1=[3,10,40][(t>>1)%3],n2=n1*[2,3,5][(t>>2)%3],f1=E.crossFlags(sig,Math.min(n1,N-1)),f2=E.crossFlags(sig,Math.min(n2,N-1)),dn2=t%4===0,D=()=>rnd()<.4?undefined:1+Math.floor(rnd()*4);
 const B=[{r:[1,.5][t%2],n:n1,d:D(),f:f1.up},{r:[1,.3][(t>>1)%2],n:n2,d:D(),a:dn2?'↓':undefined,f:dn2?f2.dn:f2.up}],S=[{r:1,n:n1,d:D(),f:f1.dn},{r:0,n:n2,d:D(),f:dn2?dates.map(()=>false):f2.dn}];
 const o={delay:1+(t%3),delayBuy:rnd()<.5?undefined:1+Math.floor(rnd()*4),delaySell:rnd()<.5?undefined:1+Math.floor(rnd()*4),stateFirst:rnd()<.8,init:[0,.5,1][t%3],cashRate:[0,.04][t%2],tax:[0,.22][(t>>1)%2],fee:[0,.0008,.01][t%3]};
 const pyL=py.map((v,i)=>i<Math.floor(N*.4)?NaN:v); // 상장 전 NaN 포함
 for(const [nm,r] of [['현금',E.simulateEvents(dates,px,B,S,o)],['방어',E.simulateEventsAlt(dates,px,py,B,S,o)],['방어(상장전NaN)',E.simulateEventsAlt(dates,px,pyL,B,S,o)]]){
  ok(idn(r),nm+' 항등식',t);ok(!r.eq.some(v=>!Number.isFinite(v)||v<-1e-9)&&!r.eqL.some(v=>!Number.isFinite(v))&&!r.w.some(v=>!(v>=-1e-9&&v<=1+1e-9)),nm+' 비정상값',t);
  ok(r.eqL[N-1]<=r.eq[N-1]+1e-9,nm+' eqL>eq',t);ok(!r.list.some(x=>!/시작|세금/.test(x.rule)&&x.i<=x.si),nm+' 체결일<=신호일',t);ok(!(dn2&&r.list.some(x=>/매도2/.test(x.rule||''))),nm+' 하향매수 모드 매도2 체결',t)}}
console.log('3) 지연 중 이평선 상태 우선: 최종 상태가 마지막 신호와 일치(지연 1~4, 같거나 다름)');
{const N=400,dates=mkDates(N);let tot=0;for(let t=0;t<2000;t++){const px=dates.map(()=>100+rnd()),up=Array(N).fill(false),dn=Array(N).fill(false);let state=rnd()<.5?'up':'dn',i=3+Math.floor(rnd()*5),lastIdx=-1,lastDir=null;
  while(i<N-6){(state==='up'?up:dn)[i]=true;lastIdx=i;lastDir=state;state=state==='up'?'dn':'up';i+=1+Math.floor(rnd()*(t%2?3:15))}
  const dB=1+Math.floor(rnd()*4),dS=1+Math.floor(rnd()*4),r=E.simulateEvents(dates,px,[{r:1,n:5,f:up}],[{r:1,n:5,f:dn}],{init:rnd()<.5?1:0,cashRate:0,tax:0,fee:0,delay:1,delayBuy:dB,delaySell:dS});
  if(lastIdx+Math.max(dB,dS)>=N)continue;tot++;ok((r.w.at(-1)>.5)===(lastDir==='up'),'최종 상태≠마지막 신호',{dB,dS,lastDir})}console.log('   검사',tot,'건')}
console.log('4) 장기선 우세(서로 다른 이평선 충돌)');
{const N=200,dates=mkDates(N),px=dates.map((_,i)=>100+i*.1),mk=a=>dates.map((_,i)=>a.includes(i));
 const run=(bs,ss,init,dB,dS,sellLong=1)=>E.simulateEvents(dates,px,[{r:1,n:152,f:mk(bs[0])},{r:1,n:451,f:mk(bs[1])}],[{r:1,n:152,f:mk(ss[0])},{r:sellLong,n:451,f:mk(ss[1])}],{init,cashRate:0,tax:0,fee:0,delay:1,delayBuy:dB,delaySell:dS});
 const cnt=r=>r.list.filter(x=>x.rule!=='시작'&&!/세금/.test(x.rule)).length;
 ok(cnt(run([[],[101]],[[100],[]],1,1,3))===0,'단기 이탈 후 장기 돌파: 매도 취소');ok(cnt(run([[102],[]],[[],[100]],0,1,3))===0,'장기 이탈 대기 중 단기 돌파: 매수 보류');
 ok(cnt(run([[102],[]],[[],[100]],0,1,3,0))===1,'장기 매도비율 0%면 단기 매수 정상');}
console.log('5) 방어 ETF 상장 전 = 현금, 시세 전부 있으면 NaN 처리 영향 없음');
{for(let t=0;t<200;t++){const N=[60,300,1000][t%3],dates=mkDates(N);let a=100,b=100;const px=[],py=[],sig=[];for(let i=0;i<N;i++){a*=1+g()*.02;b*=1+g()*.004+.0002;px.push(a);py.push(b);sig.push(a*(1+g()*.01))}
  const f=E.crossFlags(sig,Math.min(10,N-2)),B=[{r:1,n:10,f:f.up}],S=[{r:1,n:10,f:f.dn}],o={delay:1,init:[0,.5,1][t%3],cashRate:.04,tax:.22,fee:.0008},L=Math.floor(N*(.2+rnd()*.6));
  const rc=E.simulateEvents(dates,px,B,S,o),rl=E.simulateEventsAlt(dates,px,py.map((v,i)=>i<L?NaN:v),B,S,o);let md=0;for(let i=0;i<L;i++)md=Math.max(md,Math.abs(rc.eq[i]-rl.eq[i])/Math.max(1,rc.eq[i]));ok(md<1e-9,'상장 전 자산이 현금 전략과 다름',{t,md})}}
console.log('6) 이평별 지연');
{const N=60,dates=mkDates(N),px=dates.map((_,i)=>100+i*.1),mk=a=>dates.map((_,i)=>a.includes(i));
 const r=E.simulateEvents(dates,px,[{r:1,n:152,d:2,f:mk([10])},{r:1,n:451,d:4,f:mk([])}],[{r:1,n:152,d:1,f:mk([])},{r:0,n:451,f:mk([])}],{init:0,cashRate:0,tax:0,fee:0,delay:1});ok(r.list.some(x=>x.side==='B'&&x.si===10&&x.i===12),'이평1 매수 지연 2일');}
console.log('7) 독립 구현(기준)과 보유 비중 비교 — 이평 2개/3개(이평3 하향 돌파 전액 매수), 지연·상태우선');
function ref(px,buys,sells,o){const n=px.length,dB=o.delayBuy,dS=o.delaySell;let cash=100,sh=0;const a0=100*o.init;if(a0>0){cash-=a0;sh=a0/px[0]}
 const pend=[];const W=[];const maxD=Math.max(dB,dS,...buys.map(x=>x.d||0),...sells.map(x=>x.d||0));
 for(let i=0;i<n;i++){
  const sig=(isSell,r,k)=>{const hit=r.f[i];if(!hit)return;let sup=false;
   if(o.sf)for(const od of pend){if(od.dead||od.s===isSell||od.day<i||od.day>i+maxD)continue;if(od.k===k)od.dead=true;else if(r.r>0&&od.n<r.n)od.dead=true;else if(r.r>0&&od.n>r.n)sup=true}
   const d=r.d!=null?r.d:(isSell?dS:dB);if(r.r>0&&!sup&&i+d<n)pend.push({s:isSell,r:r.r,k,n:r.n,day:i+d,dead:false})};
  const sigs=()=>{sells.forEach((r,k)=>sig(true,r,k));buys.forEach((r,k)=>sig(false,r,k))};
  if(o.sf)sigs();
  const today=pend.filter(od=>od.day===i&&!od.dead).sort((a,b)=>(a.s?0:1)-(b.s?0:1)||a.k-b.k);
  for(const od of today){if(od.s){if(!(sh>0))continue;const q=sh*od.r;sh-=q;cash+=q*px[i]}else{if(!(cash>0))continue;const amt=cash*od.r;cash-=amt;sh+=amt/px[i]}}
  if(!o.sf)sigs();
  const v=cash+sh*px[i];W.push(v?sh*px[i]/v:0)}
 return W}
{let tot=0;for(let t=0;t<3000;t++){const N=[40,150,500][t%3];let a=100;const px=[],sig=[];for(let i=0;i<N;i++){a*=1+(rnd()-.5)*.05;px.push(a);sig.push(a*(1+(rnd()-.5)*.02))}
 const n1=[3,8,20][t%3],n2=n1*[2,4][t%2],n3=n2*3,f1=E.crossFlags(sig,Math.min(n1,N-2)),f2=E.crossFlags(sig,Math.min(n2,N-2)),f3=E.crossFlags(sig,Math.min(n3,N-2)),dn2=t%3!==0,use3=t%2===0;
 const D=()=>rnd()<.5?undefined:1+Math.floor(rnd()*4);
 const B=[{r:[1,.5][t%2],n:n1,d:D(),f:f1.up},{r:[1,.4][(t>>1)%2],n:n2,d:D(),f:dn2?f2.dn:f2.up}],S=[{r:1,n:n1,d:D(),f:f1.dn},{r:dn2?0:[0,1][(t>>2)%2],n:n2,d:D(),f:dn2?px.map(()=>false):f2.dn}];
 if(use3){B.push({r:1,n:n3,d:D(),a:'↓',f:f3.dn});S.push({r:0,n:n3,f:px.map(()=>false)})}
 const dates=px.map((_,i)=>{const d=new Date('2015-01-02');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10)});
 const o={init:[0,1,.5][t%3],delay:1,delayBuy:1+Math.floor(rnd()*4),delaySell:1+Math.floor(rnd()*4),stateFirst:t%5!==0,cashRate:0,tax:0,fee:0};
 const r=E.simulateEvents(dates,px,B,S,o),W=ref(px,B,S,{init:o.init,delayBuy:o.delayBuy,delaySell:o.delaySell,sf:o.stateFirst});tot++;
 let md=0;for(let i=0;i<N;i++)md=Math.max(md,Math.abs(r.w[i]-W[i]));ok(md<1e-9,'기준 구현과 보유 비중 불일치',{t,use3,dn2,md})}console.log('   검사',tot,'건')}
console.log(bad?`\n실패 ${bad} / 검사 ${checks}`:`\n모든 엔진 검사 통과 (${checks}개 조건 + 퍼즈)`);process.exit(bad?1:0);
