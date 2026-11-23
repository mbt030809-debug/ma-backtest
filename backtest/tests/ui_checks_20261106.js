// 화면 통합 검증 (Playwright + 모의 서버): BASE=http://localhost:8190 node backtest/tests/ui_checks_20261106.js
const {chromium}=require('playwright');const BASE=process.env.BASE||'http://localhost:8190';
let bad=0,n=0;const ok=(c,m,x)=>{n++;console.log((c?'  ✓ ':'  ✗ ')+m+(c||x===undefined?'':' '+JSON.stringify(x)));if(!c)bad++};
const wf=(p,fn,t=120000)=>p.waitForFunction(fn,null,{polling:500,timeout:t});
(async()=>{const br=await chromium.launch();
 const mkPage=async(init)=>{const p=await br.newPage({viewport:{width:430,height:900}});p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));if(init)await p.addInitScript(init);await p.goto(BASE);if(!p.noAll)await p.addStyleTag({content:'.tab{display:block!important}'});await p.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));return p};
 const base=async p=>{await p.fill('#sig','QQQ');await p.fill('#trd','TECL');await p.fill('#cmp','');await p.fill('#s','2014-01-01');await p.fill('#tax','22');await p.fill('#fee','0.08');await p.fill('#cash','4')};
 const SR=(p,arr)=>p.evaluate(a=>{RULES=a.map(x=>Object.assign(newRule(137,'',''),x));renderRules();save()},arr);
 const DEF=[{n:60,up:'100',dn:'0'},{n:200,up:'100',dn:''}];
 const single=async(p,r=DEF)=>SR(p,r.map(x=>({...x,na:''+x.n,nb:''+x.n,nc:'1',us:'',ds:''})));
 const cmpSweep=async(p,tag)=>{await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);const run=await p.evaluate(()=>{const o=window._last[0][0];return[o.st.tot,o.st.mdd,o.st.ca]});
  await p.click('#sw');await wf(p,()=>/완료/.test(document.getElementById('swinfo').textContent),60000);await p.waitForTimeout(300);const sw=await p.evaluate(()=>[window._swrows[0].tot,window._swrows[0].mdd,window._swrows[0].ca]);
  ok(run.every((v,i)=>Math.abs(v-sw[i])<1e-12),tag+': 일반 실행 = 스윕',{run,sw})};

 console.log('A) 일반 실행 = 스윕 (공통/이평별 지연, 목표 비율, 방어 ETF)');
 {const p=await mkPage();await base(p);await single(p);await p.fill('#delay','1');
  await cmpSweep(p,'기본');
  await single(p,[{n:60,up:'100',dn:'0',du:'2',dd:'1'},{n:200,up:'100',dn:'',du:'4'}]);await cmpSweep(p,'이평별 지연');
  await single(p,[{n:60,up:'100',dn:'0'},{n:200,up:'0',dn:'100'}]);await cmpSweep(p,'이평2 상향 0%·하향 100%');
  await single(p,[{n:60,up:'100',dn:'0'},{n:200,up:'70',dn:'30'}]);await cmpSweep(p,'이평2 상향 70%·하향 30%');
  await single(p,[{n:60,up:'50',dn:'20'},{n:200,up:'100',dn:'60'}]);await cmpSweep(p,'목표 비율 50/20 · 100/60(부분 비중)');
  await single(p,[{n:60,up:'100',dn:'0'},{n:120,up:'80',dn:'30'},{n:200,up:'100',dn:''}]);await cmpSweep(p,'이평 3개');
  await single(p);await p.fill('#alt','XLV');await cmpSweep(p,'방어 ETF XLV');ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('B) 방어 ETF 상장 전 = 현금, 스캔 = 일반 실행, 스윕 = 일반 실행');
 {const p=await mkPage(()=>{const of=window.fetch,L={LATE:'2014-03-03',MID:'2016-06-01',EARLY:'2009-01-02'};window.fetch=async(u,...a)=>{const m=/symbol=([^&]+)&start=([^&]+)&end=([^&]+)/.exec(String(u));if(!m||!(m[1] in L))return of(u,...a);const[,sym,s,e]=m,rows=[];let d=new Date(Math.max(+new Date(s),+new Date(L[sym]))),x=100,i=0;const end=new Date(e);for(;d<=end;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6){i++;x*=1+Math.sin(i/11)*.006+.0003;rows.push([d.toISOString().slice(0,10),x])}return{json:async()=>rows,headers:{get:()=>'adj'}}}});
  await base(p);await p.fill('#s','2012-01-02');await p.fill('#e','2019-12-31');await SR(p,[{n:60,up:'100',dn:'0'},{n:200,up:'100',dn:''}]);await p.fill('#alt','LATE');await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);
  const r=await p.evaluate(()=>{const[out,dates]=window._last,alt=out[0].e,cash=out[1].e,L=dates.findIndex(d=>d>='2014-03-03');let md=0;for(let i=0;i<L;i++)md=Math.max(md,Math.abs(alt[i]-cash[i])/Math.max(1,cash[i]));return{start:dates[0],md}});
  ok(r.start==='2012-01-02'&&r.md===0,'상장(2014-03-03) 전 구간 자산이 현금 전략과 같고 시작일은 그대로',r);
  await single(p);await cmpSweep(p,'상장이 늦은 방어 ETF');
  await p.fill('#alt','');await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(500);
  await p.evaluate(()=>{document.querySelector('#defSec details').open=true});await p.fill('#altlist','LATE,MID,EARLY');await p.click('#recbtn');await wf(p,()=>/비교 완료/.test(document.getElementById('recmsg').textContent),90000);await p.waitForTimeout(500);
  const sc=await p.evaluate(async()=>{const d=window._altData,res=[];for(const r of d.rows.filter(x=>!x.base)){const x=await run({silent:true,alt:r.sym});res.push([r.sym,['cagr','mdd','so','tot'].map(k=>Math.abs(r.st[k]-x.st[k])).reduce((a,b)=>Math.max(a,b),0)])}return res});
  ok(sc.length===3&&sc.every(([,d])=>d<1e-12),'스캔 결과 = 일반 실행 (상장 늦은 ETF 포함 3개)',sc);ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('C) 스캔 속도 경로 = 일반 실행 (후보 10개)');

 for(const [name,c] of [['돌파/이탈',{init:100,delay:1,rules:[{n:120,up:'100',dn:'0'},{n:250,up:'100',dn:''}]}],['목표 비율+이평별 지연',{init:100,delay:1,rules:[{n:120,up:'80',dn:'20',du:'2',dd:'1'},{n:250,up:'40',dn:'60',du:'3'}]}]]){
  const p=await mkPage();await base(p);await p.fill('#s','2013-01-01');await p.fill('#init',''+c.init);await p.fill('#delay',''+c.delay);await SR(p,c.rules);
 await p.click('#run');await p.waitForTimeout(1500);await p.evaluate(()=>{document.querySelector('#defSec details').open=true});await p.fill('#altlist','TLT,GLD,SPY,XLV,SHY,IEF,BIL,AGG,VNQ,XLU');await p.click('#recbtn');await wf(p,()=>/비교 완료/.test(document.getElementById('recmsg').textContent),90000);await p.waitForTimeout(500);
  const w=await p.evaluate(async()=>{let m=0,cnt=0;for(const r of window._altData.rows.filter(x=>!x.base)){const x=await run({silent:true,alt:r.sym});cnt++;m=Math.max(m,...['tot','cagr','mdd','sh','so','ca'].map(k=>Math.abs(r.st[k]-x.st[k])/Math.max(1,Math.abs(x.st[k]))))}return{cnt,m}});
  ok(w.cnt===10&&w.m<1e-12,name+': 스캔 = 일반 실행',w);ok(p.errs.length===0,name+': JS 오류 없음',p.errs);await p.close()}
 console.log('D) 앱 재시작(새로고침) 후 방어 ETF 결과 복원');
 {const p=await mkPage();await base(p);await p.click('#run');await p.waitForTimeout(1500);await p.evaluate(()=>{document.querySelector('#defSec details').open=true});await p.fill('#altn','60');await p.click('#recbtn');await wf(p,()=>/비교 완료/.test(document.getElementById('recmsg').textContent),90000);await p.waitForTimeout(800);
  const before=await p.evaluate(()=>document.getElementById('altbetter').textContent.slice(0,120));await p.reload();await p.waitForTimeout(5000);
  const after=await p.evaluate(()=>[document.getElementById('recmsg').textContent,document.getElementById('altbetter').textContent.slice(0,120)]);
  ok(/복원/.test(after[0])&&after[1]===before,'새로고침 후 결과 복원',after);await p.close()}
 console.log('E) 이평 워밍업 시작일 보정(2012-06 상장·360일선 → 상장 후 360번째 거래일)');
 {const p=await mkPage(()=>{const of=window.fetch;window.fetch=async(u,...a)=>{const m=/symbol=(LISTED)&start=([^&]+)&end=([^&]+)/.exec(String(u));if(!m)return of(u,...a);const[,,s,e]=m,rows=[];let d=new Date(Math.max(+new Date(s),+new Date('2012-06-01'))),x=100,i=0;const end=new Date(e);for(;d<=end;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6){i++;x*=1+Math.sin(i/9)*.01+.0004;rows.push([d.toISOString().slice(0,10),x])}return{json:async()=>rows,headers:{get:()=>'adj'}}}});
  await p.fill('#sig','LISTED');await p.fill('#trd','LISTED');await p.fill('#cmp','');await p.fill('#s','2012-01-02');await p.fill('#e','2016-01-04');await SR(p,[{n:360,up:'100',dn:'0'},{n:100,up:'100',dn:''}]);await p.fill('#alt','');await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);
  const st=await p.evaluate(()=>window._last[1][0]);const exp=await p.evaluate(async()=>(await (await fetch('/api/prices?symbol=LISTED&start=2012-01-02&end=2016-01-04')).json())[359][0]);ok(st===exp,'시작일='+exp,st);await p.close()}
 console.log('F) 바닥 신호(MACD·VIX 조건 충족 시 전액 매수) — 일반 실행 = 스윕 = 스캔');
 {const p=await mkPage();await base(p);await single(p,[{n:60,up:'100',dn:'0'},{n:150,up:'100',dn:''}]);await p.fill('#bm3','0');await p.fill('#bv3','-5');await p.evaluate(()=>{document.getElementById('en3').checked=true;save()});
  await cmpSweep(p,'바닥 신호 사용');
  const m3=await p.evaluate(()=>[...document.querySelectorAll('#trd2 tr')].slice(1).filter(r=>/바닥 신호/.test(r.cells[4].textContent)).length);ok(m3>0,'바닥 신호 매수 체결이 있음',m3);
  {const r=await p.evaluate(()=>{const L=window._last[2].lines,has=document.querySelectorAll('#lg .lgk[data-k^="ma:"]').length,mk=document.querySelectorAll('#lg .lgk[data-k^="mk:"]').length;return{n:L.length,ok:L.every(o=>o.e.length===window._last[1].length&&o.e.every(Number.isFinite)),has,mk}});
   ok(r.n===2&&r.ok&&r.has===2&&r.mk>=2,'이평선 2개가 차트 데이터·범례에 있고(값 모두 유효) 마커 종류별 범례도 있음',r);
   const t=await p.evaluate(()=>{const el=document.querySelector('#lg .lgk[data-k^="mk:"]'),k=el.dataset.k;el.click();const off=!!HID[k]&&document.querySelector('#lg .lgk[data-k="'+k+'"]').style.opacity==='0.35';document.querySelector('#lg .lgk[data-k="'+k+'"]').click();const on=!HID[k];const m=document.querySelector('#lg .lgk[data-k^="ma:"]'),mk=m.dataset.k;m.click();const moff=!!HID[mk];document.querySelector('#lg .lgk[data-k="'+mk+'"]').click();return{off,on,moff,mon:!HID[mk]}});
   ok(t.off&&t.on&&t.moff&&t.mon,'마커·이평선 범례를 누르면 끄고 다시 켜짐',t)}
  {const lg=await p.evaluate(()=>document.getElementById('lg').innerText);ok(/▲▼ 이평1 60일/.test(lg)&&/★ 바닥 신호/.test(lg),'차트 범례에 신호별 마커(이평1 ▲▼, 바닥 신호 ★)가 구분되어 표시됨',lg)}
  await p.evaluate(()=>{document.querySelector('#defSec details').open=true});await p.fill('#altlist','TLT,GLD,SPY,XLV,SHY,IEF,BIL,AGG,VNQ,XLU');await p.click('#recbtn');await wf(p,()=>/비교 완료/.test(document.getElementById('recmsg').textContent),90000);await p.waitForTimeout(500);
  const w=await p.evaluate(async()=>{let m=0,cnt=0;for(const r of window._altData.rows.filter(x=>!x.base)){const x=await run({silent:true,alt:r.sym});cnt++;m=Math.max(m,...['tot','cagr','mdd','sh','so','ca'].map(k=>Math.abs(r.st[k]-x.st[k])/Math.max(1,Math.abs(x.st[k]))))}return{cnt,m}});
  ok(w.cnt===10&&w.m<1e-12,'바닥 신호 사용: 스캔 = 일반 실행',w);ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('G) 바닥 신호 스윕(고급도구) — 조합 수·바닥신호 열·1위 행 적용 시 일반 실행과 일치');
 {const p=await mkPage();await base(p);await p.fill('#s','2012-01-02');
  await p.evaluate(()=>{RULES[0].na='50';RULES[0].nb='90';RULES[0].nc='20';RULES[1].na='150';RULES[1].nb='250';RULES[1].nc='50';renderSwRules();save()});
  await p.fill('#bm3','0');await p.fill('#bv3','-5');await p.evaluate(()=>{const e=document.getElementById('en3');e.checked=true;e.dispatchEvent(new Event('change'))});
  ok(/9개/.test(await p.evaluate(()=>document.getElementById('swest').textContent)),'예상 조합 9개(3×3, 바닥 신호는 고정)');
  await p.click('#sw');await wf(p,()=>/완료/.test(document.getElementById('swinfo').textContent),90000);await p.waitForTimeout(500);
  const info=await p.evaluate(()=>({n:window._swrows.length,hdr:[...document.getElementById('swt').rows[0].cells].map(c=>c.textContent).join('|')}));
  ok(info.n===9&&/바닥신호/.test(info.hdr),'9개 결과, 바닥 신호 사용 표시, 표에 바닥신호 열',info);
  const top=await p.evaluate(()=>{const r=window._swrows.slice().sort((a,b)=>b.tot-a.tot)[0];return{rules:r.rules,tot:r.tot,mdd:r.mdd,ca:r.ca}});
  await p.evaluate(r=>applyRow(r),top);await p.waitForTimeout(2000);const run=await p.evaluate(()=>{const o=window._last[0][0];return[o.st.tot,o.st.mdd,o.st.ca]});
  ok(Math.abs(run[0]-top.tot)<1e-12&&Math.abs(run[1]-top.mdd)<1e-12&&Math.abs(run[2]-top.ca)<1e-12,'1위 행 적용 → 일반 실행과 같은 값',{run,top});{const tx=await p.evaluate(()=>document.getElementById('tab-sw').innerText+document.getElementById('sk').innerText);ok(!/CAGR|소르티노|종합/.test(tx)&&/수익률 1위/.test(tx)&&/MDD/.test(tx)&&/샤프/.test(tx)&&/칼마/.test(tx),'최적값 찾기 화면: 수익률 1위·MDD·샤프·칼마만 표시(CAGR·소르티노·종합 없음)',tx.match(/CAGR|소르티노|종합/g))};ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}

 console.log('I) 이평 규칙 사용/끄기·추가/삭제 — 끈 규칙은 체결·차트선에서 빠지고, 일반 실행 = 스윕');
 {const p=await mkPage();await base(p);await single(p);
  const info=()=>p.evaluate(()=>{const rows=[...document.querySelectorAll('#trd2 tr')].slice(1).map(r=>r.cells[4].textContent);return{r1:rows.filter(x=>/^이평1/.test(x)).length,r2:rows.filter(x=>/^이평2/.test(x)).length,lines:window._last[2].lines.map(o=>o.name.slice(0,3))}});
  const tog=(k)=>p.click('#rulesBox [data-k="'+k+'"] [data-f="on"]');
  await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);{const x=await info();ok(x.r1>0&&x.lines.join()==='이평1,이평2','둘 다 켜면 이평1 체결과 두 이평선이 있음',x)}
  await tog(0);await cmpSweep(p,'이평1 끔');{const x=await info();ok(x.r1===0&&x.lines.join()==='이평2','이평1 끔: 이평1 체결 없음·이평선은 이평2만',x)}
  await tog(0);await tog(1);await cmpSweep(p,'이평2 끔');{const x=await info();ok(x.r2===0&&x.r1>0&&x.lines.join()==='이평1','이평2 끔: 이평2 체결 없음·이평선은 이평1만',x)}
  await tog(0);await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);{const x=await info();ok(x.r1===0&&x.r2===0&&x.lines.length===0,'둘 다 끔: 이평 체결·이평선 없음(보유만)',x)}
  await p.reload();await p.waitForTimeout(800);{const v=await p.evaluate(()=>RULES.map(r=>r.on));ok(v[0]===false&&v[1]===false,'새로고침 후에도 사용/끄기 상태가 유지됨',v)}
  await p.evaluate(()=>{RULES.forEach(r=>r.on=true);renderRules()});await p.click('#ruleAdd');ok(await p.evaluate(()=>document.querySelectorAll('#rulesBox .rc').length)===3&&await p.evaluate(()=>RULES.length)===3,'+ 이평선 추가 → 규칙 3개');
  await p.click('#run');await wf(p,()=>window._last&&window._last[2].lines.length===3,30000);ok(await p.evaluate(()=>window._last[2].lines.length)===3,'이평 3개가 차트 선·체결에 반영됨');
  await p.click('#rulesBox [data-del="2"]');ok(await p.evaluate(()=>RULES.length)===2,'삭제 → 규칙 2개');
  ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('J) 목표 비율 — 최적값 찾기에서 상향·하향 목표 %도 스윕, 각 조합 결과 = 일반 실행, 행 적용 시 값이 규칙 칸에 들어감');
 {const p=await mkPage();await base(p);await single(p);await p.evaluate(()=>{RULES[1].us='50,100';RULES[1].ds='0,40,100';renderSwRules();estSweep();save()});
  ok(/6개/.test(await p.evaluate(()=>document.getElementById('swest').textContent)),'예상 조합 6개(이평2 상향 2 × 하향 3)');
  await p.click('#sw');await wf(p,()=>/완료/.test(document.getElementById('swinfo').textContent),60000);await p.waitForTimeout(500);
  const rows=await p.evaluate(()=>window._swrows.map(r=>({u:Math.round(r.rules[1].up*100),d:Math.round(r.rules[1].dn*100),tot:r.tot,mdd:r.mdd})));
  ok(rows.length===6,'상향·하향 조합 6개 결과',rows.length);
  let allSame=true;for(const u of [50,100])for(const d of [0,40,100]){await p.evaluate(([u,d])=>{RULES[1].up=''+u;RULES[1].dn=''+d;renderRules()},[u,d]);await p.click('#run');await p.waitForTimeout(1200);const run=await p.evaluate(()=>{const o=window._last[0][0];return[o.st.tot,o.st.mdd]});const r=rows.find(q=>q.u===u&&q.d===d);if(!r||Math.abs(run[0]-r.tot)>1e-12||Math.abs(run[1]-r.mdd)>1e-12){allSame=false;console.log('   up',u,'dn',d,run,r)}}
  ok(allSame,'모든 (상향,하향) 스윕 결과 = 그 값으로 일반 실행');
  await p.evaluate(r=>applyRow(r),await p.evaluate(()=>window._swrows.find(r=>Math.round(r.rules[1].up*100)===50&&Math.round(r.rules[1].dn*100)===40)));await p.waitForTimeout(1500);
  const ud=await p.evaluate(()=>[RULES[1].up,RULES[1].dn]);ok(ud[0]==='50'&&ud[1]==='40','결과 행을 누르면 상향·하향 목표 %가 규칙 칸에 적용됨',ud);
  ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('L) 체결 가격 시가/종가 — 상향·하향 각각, 일반 실행 = 스윕 = 스캔, 시가 체결가 = 그날 시가');
 {const p=await mkPage();await base(p);
  await single(p,[{n:60,up:'100',dn:'0',fu:'o',fd:'c'},{n:200,up:'100',dn:''}]);await cmpSweep(p,'이평1 상향 시가·하향 종가');
  await single(p,[{n:60,up:'100',dn:'0',fu:'c',fd:'o'},{n:200,up:'100',dn:'',fu:'o'}]);await cmpSweep(p,'이평1 하향 시가·이평2 상향 시가');
  await p.fill('#bm3','0');await p.fill('#bv3','-5');await p.evaluate(()=>{document.getElementById('en3').checked=true;document.getElementById('fb3').value='o';save()});await cmpSweep(p,'바닥 신호 시가');
  const chk=await p.evaluate(async()=>{const[out,dates,ctx]=window._last,rows=await (await fetch('/api/prices?symbol=TECL&start=2000-01-01&end='+document.getElementById('e').value)).json(),om=new Map(rows.map(r=>[r[0],r[2]])),cm=new Map(rows.map(r=>[r[0],r[1]]));
   let nOpen=0,bad=0,nClose=0,badC=0;for(const t of ctx.trades){if(t.asset==='Y'||t.side==='T'||/시작|세금/.test(t.rule||''))continue;const d=dates[t.i];if(/시가/.test(t.rule)){nOpen++;if(Math.abs(t.price-om.get(d))>1e-9)bad++}else{nClose++;if(Math.abs(t.price-cm.get(d))>1e-9)badC++}}return{nOpen,bad,nClose,badC}});
  ok(chk.nOpen>0&&chk.bad===0&&chk.badC===0,'시가로 정한 체결은 그날 시가, 종가로 정한 체결은 종가로 체결됨',chk);
  await p.fill('#alt','XLV');await cmpSweep(p,'방어 ETF + 시가 체결');
  await p.evaluate(()=>{document.querySelector('#defSec details').open=true});await p.fill('#altlist','TLT,GLD,SPY,XLV,SHY,IEF,BIL,AGG,VNQ,XLU');await p.fill('#alt','');await p.click('#run');await p.waitForTimeout(1500);await p.click('#recbtn');await wf(p,()=>/비교 완료/.test(document.getElementById('recmsg').textContent),90000);await p.waitForTimeout(500);
  const w=await p.evaluate(async()=>{let m=0,cnt=0;for(const r of window._altData.rows.filter(x=>!x.base)){const x=await run({silent:true,alt:r.sym});cnt++;m=Math.max(m,...['tot','cagr','mdd','sh','so','ca'].map(k=>Math.abs(r.st[k]-x.st[k])/Math.max(1,Math.abs(x.st[k]))))}return{cnt,m}});
  ok(w.cnt===10&&w.m<1e-12,'시가 체결 사용: 스캔 = 일반 실행',w);
  ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('M) 체결 가격(종가·시가 둘 다)도 최적값 찾기에서 스윕 — 조합 수, 각 조합 = 일반 실행, 행 적용');
 {const p=await mkPage();await base(p);await single(p);await p.evaluate(()=>{RULES[0].fus='co';RULES[0].fds='co';RULES[1].fus='co';renderSwRules();estSweep();save()});
  ok(/8개/.test(await p.evaluate(()=>document.getElementById('swest').textContent)),'예상 조합 8개(이평1 상향 2 × 하향 2 × 이평2 상향 2, 이평2 하향은 비어 있어 고정)');
  await p.click('#sw');await wf(p,()=>/완료/.test(document.getElementById('swinfo').textContent),60000);await p.waitForTimeout(500);
  const rows=await p.evaluate(()=>window._swrows.map(r=>({k:r.rules.map(x=>(x.fu||'')+(x.fd||'')).join('|'),tot:r.tot,mdd:r.mdd})));
  ok(rows.length===8,'체결 가격 조합 8개 결과가 나옴',rows.length);
  const combos=await p.evaluate(()=>[...new Set(window._swrows.map(r=>r.rules.map(x=>x.fu+x.fd).join('|')))].sort());ok(combos.length===8,'모든 조합의 체결 가격 구성이 서로 다름(8가지)',combos);
  let allSame=true;for(const r of await p.evaluate(()=>window._swrows.map(r=>r.rules.map(x=>[x.fu,x.fd])))){await p.evaluate(rs=>{RULES[0].fu=rs[0][0];RULES[0].fd=rs[0][1];RULES[1].fu=rs[1][0];RULES[1].fd=rs[1][1];renderRules()},r);await p.click('#run');await p.waitForTimeout(1200);const run=await p.evaluate(()=>{const o=window._last[0][0];return[o.st.tot,o.st.mdd]});const key=r.map(x=>x.join('')).join('|'),hit=await p.evaluate(k=>window._swrows.find(q=>q.rules.map(x=>x.fu+x.fd).join('|')===k),key);if(Math.abs(run[0]-hit.tot)>1e-12||Math.abs(run[1]-hit.mdd)>1e-12){allSame=false;console.log('   ',key,run,[hit.tot,hit.mdd])}}
  ok(allSame,'모든 체결 가격 조합: 스윕 결과 = 그 설정으로 일반 실행');
  await p.evaluate(()=>applyRow(window._swrows.find(r=>r.rules[0].fu==='o'&&r.rules[0].fd==='c')));await p.waitForTimeout(1500);
  const f=await p.evaluate(()=>[RULES[0].fu,RULES[0].fd]);ok(f[0]==='o'&&f[1]==='c','결과 행을 누르면 체결 가격이 규칙 칸에 적용됨',f);
  ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('N) 입력 검증 · 화면 구성: 잘못된 값은 조용히 보정하지 않고 안내, 실행 버튼은 스크롤해도 화면에 고정');
 {const p=await mkPage();await base(p);
  const tryRun=async(rules,init)=>{await SR(p,rules);await p.fill('#init',init||'100');await p.evaluate(()=>{document.getElementById('err').textContent='';window._last=null});await p.click('#run');await p.waitForTimeout(1500);return p.evaluate(()=>({err:document.getElementById('err').textContent,ran:!!window._last}))};
  let r=await tryRun([{n:60,up:'150',dn:'0'}]);ok(!r.ran&&/0~100/.test(r.err),'목표 비율 150% → 안내(0~100)',r);
  r=await tryRun([{n:60,up:'100',dn:'-5'}]);ok(!r.ran&&/0~100/.test(r.err),'목표 비율 -5% → 안내',r);
  r=await tryRun([{n:60,up:'abc',dn:'0'}]);ok(!r.ran&&/0~100/.test(r.err),'목표 비율에 문자 → 안내',r);
  r=await tryRun([{n:60,up:'100',dn:'0'}],'150');ok(!r.ran&&/초기 주식 비율/.test(r.err),'초기 주식 비율 150% → 안내',r);
  r=await tryRun([{n:60,up:'',dn:''}]);ok(r.ran&&r.err==='','목표 비율을 모두 비우면(신호 무시) 보유만 하고 정상 실행',r);
  await p.evaluate(()=>window.scrollTo(0,400));const top=await p.evaluate(()=>{const b=document.getElementById('run').getBoundingClientRect();return{top:b.top,bottom:b.bottom,vh:innerHeight}});
  ok(top.bottom<=top.vh+1&&top.top>0,'스크롤해도 실행 버튼이 화면 안(아래쪽)에 고정됨',top);
  await SR(p,DEF);
  ok(await p.evaluate(()=>document.querySelectorAll('#rulesBox .rc').length)===2&&await p.evaluate(()=>document.querySelectorAll('#rulesBox details.rcd').length)===2,'이평 규칙은 카드(상향·하향 칸 + 접힌 체결 옵션)로 표시됨');
  ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('K) 옛 설정(매수·매도 비율 방식) 자동 이전 + 목표 % 체결 표시');
 {const p=await mkPage(()=>{if(!localStorage.getItem('__seeded')){localStorage.setItem('__seeded','1');localStorage.setItem('mabt_settings_v1',JSON.stringify({buy:[],sell:[],sig:'QQQ',trd:'TECL',mn1:'100',br1:'100',sr1:'100',mn2:'300',x2:'0',y2:'100',s:'2014-01-01',mode:'cross'}))}});
  const r=await p.evaluate(()=>RULES.map(x=>[x.n,x.up,x.dn]));ok(JSON.stringify(r)==='[[100,"100","0"],[300,"100",""]]','옛 설정이 이평1(↑100% ↓0%)·이평2(↑100%)로 이전됨',r);
  await SR(p,[{n:60,up:'50',dn:'0'},{n:200,up:'100',dn:''}]);await p.fill('#sig','QQQ');await p.fill('#trd','TECL');await p.fill('#s','2014-01-01');await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);
  ok(await p.evaluate(()=>window._last[2].trades.some(t=>/↑ → 50%/.test(t.rule||''))),'거래 내역에 목표 비율(→ 50%)이 표시됨');
  ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}

 console.log('H) 탭 화면: 요약 타일 · 설정 요약 · 설정 변경 경고 · 결과 적용 시 백테스트 탭으로');
 {const p=await br.newPage({viewport:{width:430,height:900}});p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));await p.goto(BASE);
  const vis=()=>p.evaluate(()=>[...document.querySelectorAll('.tab')].filter(x=>getComputedStyle(x).display!='none').map(x=>x.id).join(','));
  ok(await vis()==='tab-bt','처음엔 백테스트 탭만 보임',await vis());
  {const st=await p.evaluate(()=>{const c=document.getElementById('cfgBox');c.open=false;const r=['ruleAdd','init','tax','delay','en3'].map(i=>document.getElementById(i).checkVisibility());c.open=true;return r});ok(st.every(v=>v===false),'설정을 접으면 이평선 추가·비용·체결까지 모두 접힘',st)}
  ok(await p.evaluate(()=>{const c=document.getElementById('cfgBox'),n=document.getElementById('tabs');return c.contains(document.getElementById('rulesBox'))&&c.getBoundingClientRect().top<n.getBoundingClientRect().top}),'백테스트 설정이 탭 줄보다 위(모든 탭 공통)');
  await p.fill('#sig','QQQ');await p.fill('#trd','TECL');await p.fill('#s','2014-01-01');await SR(p,[{n:60,up:'100',dn:'0'},{n:200,up:'100',dn:''}]);await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(600);
  ok(await p.evaluate(()=>document.querySelectorAll('#kpi .kpi').length)===4,'요약 타일 4개(CAGR·MDD·누적·칼마)');
  await p.click('#goSw');ok(await p.evaluate(()=>document.querySelector('#rulesBox .rc').offsetParent!==null),'다른 탭에서도 설정 입력이 보임');ok(await vis()==='tab-sw','"최적값 찾기" 버튼 → 스윕 탭',await vis());
  ok(/QQQ/.test(await p.evaluate(()=>document.getElementById('ctx').textContent))&&/TECL/.test(await p.evaluate(()=>document.getElementById('ctx').textContent)),'맨 위 공통 설정 요약에 종목 표시');
  await p.evaluate(()=>{RULES[0].na='60';RULES[0].nb='80';RULES[0].nc='20';RULES[1].na='200';RULES[1].nb='200';RULES[1].nc='1';renderSwRules();save()});
  await p.click('#sw');await wf(p,()=>/완료/.test(document.getElementById('swinfo').textContent),60000);await p.waitForTimeout(400);
  ok(await p.evaluate(()=>getComputedStyle(document.getElementById('swstale')).display)==='none','방금 찾은 결과는 경고 없음');
  await p.click('#tabs button[data-t="bt"]');await p.fill('#fee','0.5');await p.dispatchEvent('#fee','change');await p.click('#tabs button[data-t="sw"]');
  ok(await p.evaluate(()=>getComputedStyle(document.getElementById('swstale')).display)!=='none','수수료를 바꾸면 스윕 결과에 "설정 변경" 경고');
  await p.click('#swt tr.swr');await p.waitForTimeout(1500);ok(await vis()==='tab-bt','스윕 행을 누르면 백테스트 탭으로 돌아와 실행',await vis());
  await p.click('#goDef');await p.evaluate(()=>{document.querySelector('#defSec details').open=true});await p.fill('#altlist','TLT,GLD,XLV');await p.click('#recbtn');await wf(p,()=>/비교 완료/.test(document.getElementById('recmsg').textContent),90000);await p.waitForTimeout(600);
  ok(await p.evaluate(()=>getComputedStyle(document.getElementById('defResCard')).display)!=='none','방어 ETF 결과 카드 표시');
  await p.evaluate(()=>document.querySelector('#altbetter tr.altr, #altt tr.altr').click());await p.waitForTimeout(1500);
  ok(await vis()==='tab-bt'&&(await p.inputValue('#alt')).length>0,'ETF 행을 누르면 방어 ETF로 적용되고 백테스트 탭으로',[await vis(),await p.inputValue('#alt')]);
  await p.click('#tabs button[data-t="def"]');ok(await p.evaluate(()=>getComputedStyle(document.getElementById('defstale')).display)==='none','방어 ETF만 적용한 것은 "설정 변경" 경고 아님');
  ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('O) 하루 한 번 자동 실행 + 최근 신호(±3영업일) 표시');
 {const cx=await br.newContext({viewport:{width:430,height:900}}),p=await cx.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));await p.goto(BASE);
  await wf(p,()=>window._last,30000);await p.waitForTimeout(300);
  const today=new Date().toISOString().slice(0,10);
  ok(await p.evaluate(d=>localStorage.getItem('mabt_auto_day')===d,today),'앱을 열면 오늘 날짜로 자동 백테스트 실행(그날 한 번 표시)');
  const bx=await p.evaluate(()=>document.getElementById('sigBox').innerText);
  ok(/최근 신호/.test(bx)&&(/→/.test(bx)||/신호 없음/.test(bx)),'차트 위에 최근 신호 박스(신호일 → 체결일)',bx);
  ok(/지연 \d+일|취소/.test(bx)||/신호 없음/.test(bx),'지연일수 표시',bx);
  ok(/오[전후] \d+:\d\d/.test(bx)||/신호 없음/.test(bx),'한국시간(오전/오후) 표기',bx);
  ok(await p.evaluate(()=>kst('2026-11-20','o').endsWith('오후 11:30')&&kst('2026-11-20','c').endsWith('오전 6:00')&&kst('2026-11-20','c').startsWith('11/21')&&kst('2026-07-20','o').endsWith('오후 10:30')&&kst('2026-07-20','c').endsWith('오전 5:00')),'미국 시가/종가 → 한국시간(겨울 23:30/06:00, 서머타임 22:30/05:00)');
  await p.reload();await p.waitForTimeout(2500);ok(await p.evaluate(()=>!window._last),'같은 날 다시 열면 자동 실행하지 않음');
  ok(p.errs.length===0,'JS 오류 없음',p.errs);await cx.close()}
 console.log(bad?`\n실패 ${bad} / ${n}`:`\n모든 화면 검사 통과 (${n}개)`);await br.close();process.exit(bad?1:0)})().catch(e=>{console.error('테스트 오류',e.stack.split('\n').slice(0,4).join(' / '));process.exit(2)});
