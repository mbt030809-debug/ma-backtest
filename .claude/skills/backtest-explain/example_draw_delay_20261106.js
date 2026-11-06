// 사용: node example_draw_delay_20261106.js 출력.png  (playwright 필요)
const E=require('../../../backtest/engine_20261030.js');
const {chromium}=require('playwright');
const px=[103,104,105,104,99,97,98,101,99,97,96,98,102,103,104,104,105,105,106,106,107];const N=px.length,MA=100;
const dates=[];{let d=new Date('2026-01-05');while(dates.length<N){if(d.getUTCDay()%6)dates.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1)}}
const up=px.map((v,i)=>i>0&&px[i-1]<=MA&&v>MA),dn=px.map((v,i)=>i>0&&px[i-1]>=MA&&v<MA);
const run=sf=>E.simulateEvents(dates,px,[{r:1,n:50,f:up}],[{r:1,n:50,f:dn}],{init:1,cashRate:0,tax:0,fee:0,delay:1,delayBuy:3,delaySell:1,stateFirst:sf});
const off=run(false),on=run(true);
const col={bg:'#fff',tx:'#222',mut:'#777',ln:'#2b6cf6',ma:'#e8590c',hold:'#b2f2bb',cash:'#ffc9c9',buy:'#2f9e44',sell:'#e03131'};
const W=1060,L=70,R=50,dw=(W-L-R)/(N-1),X=i=>L+i*dw;
let s='';const T=(x,y,t,o={})=>`<text x="${x}" y="${y}" font-size="${o.s||14}" fill="${o.c||col.tx}" text-anchor="${o.a||'start'}" font-weight="${o.b?700:400}">${t}</text>`;
// 패널 1: 가격
const y0=70,h1=190,pmin=94,pmax=108,PY=v=>y0+h1-(v-pmin)/(pmax-pmin)*h1;
s+=T(L,30,'매수 지연 3일 · 매도 지연 1일 — 같은 가격, 같은 신호에서 "옛 방식"과 "상태 우선" 비교',{s:20,b:1});
s+=T(L,52,'종가가 이평선(주황)을 위로 돌파=매수 신호(▲), 아래로 이탈=매도 신호(▼). 신호는 그날 종가에 나오고 체결은 지연 뒤.',{s:13,c:col.mut});
s+=`<rect x="${L}" y="${y0}" width="${W-L-R}" height="${h1}" fill="#f8f9fa" stroke="#dee2e6"/>`;
s+=`<line x1="${L}" x2="${W-R}" y1="${PY(MA)}" y2="${PY(MA)}" stroke="${col.ma}" stroke-width="2.5"/>`+T(W-R-4,PY(MA)-6,'이평선',{a:'end',c:col.ma,s:13,b:1});
s+=`<polyline fill="none" stroke="${col.ln}" stroke-width="2.5" points="${px.map((v,i)=>X(i)+','+PY(v)).join(' ')}"/>`;
px.forEach((v,i)=>{s+=`<circle cx="${X(i)}" cy="${PY(v)}" r="3.5" fill="${col.ln}"/>`;s+=T(X(i),y0+h1+16,i,{a:'middle',s:11,c:col.mut});
 if(up[i])s+=`<polygon points="${X(i)},${PY(v)-26} ${X(i)-9},${PY(v)-9} ${X(i)+9},${PY(v)-9}" fill="${col.buy}"/>`+T(X(i),PY(v)-32,'매수신호',{a:'middle',s:12,c:col.buy,b:1});
 if(dn[i])s+=`<polygon points="${X(i)},${PY(v)+26} ${X(i)-9},${PY(v)+9} ${X(i)+9},${PY(v)+9}" fill="${col.sell}"/>`+T(X(i),PY(v)+42,'매도신호',{a:'middle',s:12,c:col.sell,b:1})});
s+=T(L-8,y0+h1+16,'일',{a:'end',s:11,c:col.mut});
// 패널 2,3
const panel=(y,title,sim,note,cancelled)=>{let o=T(L,y-10,title,{s:16,b:1});o+=T(L+250,y-10,note,{s:13,c:col.mut});
 for(let i=0;i<N;i++){const w=sim.w[i]>.1;o+=`<rect x="${X(i)-dw/2}" y="${y}" width="${dw}" height="34" fill="${w?col.hold:col.cash}"/>`}
 o+=`<rect x="${L-dw/2}" y="${y}" width="${W-L-R+dw}" height="34" fill="none" stroke="#adb5bd"/>`;
 sim.list.filter(t=>t.rule!='시작').forEach(t=>{const b=t.side=='B';o+=`<polygon points="${X(t.i)},${b?y+37:y-2} ${X(t.i)-8},${b?y+52:y-16} ${X(t.i)+8},${b?y+52:y-16}" fill="${b?col.buy:col.sell}"/>`+T(X(t.i),y+(b?68:-22),(b?'매수체결 ':'매도체결 ')+t.i+'일',{a:'middle',s:11,c:b?col.buy:col.sell,b:1})});
 (cancelled||[]).forEach(c=>{o+=`<text x="${X(c.i)}" y="${y+24}" font-size="22" fill="#868e96" text-anchor="middle" font-weight="700">✕</text>`+T(X(c.i),y+68,c.t,{a:'middle',s:11,c:'#868e96',b:1})});return o};
s+=panel(320,'① 옛 방식 (상태 우선 끔)',off,'3일 전에 낸 매수가 이평선 아래에서도 뒤늦게 체결됨(10일, 가격 96)',[]);
s+=panel(470,'② 상태 우선 (켬, 기본)',on,'대기 중이던 매수가 8일 매도신호로 취소(✕) → 12일 재돌파 후 15일에 매수',[{i:10,t:'7일 신호→10일 매수 취소'}]);
// 범례
s+=`<rect x="${L}" y="590" width="18" height="12" fill="${col.hold}"/>`+T(L+24,601,'주식 보유',{s:13})+`<rect x="${L+110}" y="590" width="18" height="12" fill="${col.cash}"/>`+T(L+134,601,'현금',{s:13});
s+=T(L,632,'핵심: 7일에 돌파(매수 신호)했지만 3일 보류 중인 8일에 다시 이탈(매도 신호) → 이평선 아래이므로 매수 판단은 보류(취소)되고 매도가 우선.',{s:14,b:1});
s+=T(L,654,`옛 방식은 10일에 아래(96)에서 매수 체결 → 12일 돌파 뒤 15일 재매수 전까지 보유 기간이 더 길어지고 이평선 아래에서 샀음. (보유일 ${off.w.filter(w=>w>.1).length}일 대 ${on.w.filter(w=>w>.1).length}일)`,{s:14});
s+=T(L,676,'※ 설명용 가상 가격입니다(실제 시세 아님).',{s:12,c:col.mut});
const html=`<body style="margin:0;background:#fff;font-family:sans-serif"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="700">${s}</svg></body>`;
(async()=>{const br=await chromium.launch(),p=await br.newPage({viewport:{width:W,height:700}});await p.setContent(html);await p.screenshot({path:process.argv[2]||'delay_explain_20261106.png'});await br.close();
console.log('OFF 체결',off.list.filter(t=>t.rule!='시작').map(t=>t.side+t.i).join(' '),'| ON 체결',on.list.filter(t=>t.rule!='시작').map(t=>t.side+t.i).join(' '))})();
