// 화면 통합 검증 (Playwright + 모의 서버): BASE=http://localhost:8190 node backtest/tests/ui_checks_20261106.js
const {chromium}=require('playwright');const BASE=process.env.BASE||'http://localhost:8190';
let bad=0,n=0;const ok=(c,m,x)=>{n++;console.log((c?'  ✓ ':'  ✗ ')+m+(c||x===undefined?'':' '+JSON.stringify(x)));if(!c)bad++};
const wf=(p,fn,t=120000)=>p.waitForFunction(fn,null,{polling:500,timeout:t});
(async()=>{const br=await chromium.launch();
 const mkPage=async(init)=>{const p=await br.newPage({viewport:{width:430,height:900}});p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));if(init)await p.addInitScript(init);await p.goto(BASE);await p.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));return p};
 const base=async p=>{await p.fill('#sig','QQQ');await p.fill('#trd','TECL');await p.fill('#cmp','');await p.fill('#s','2014-01-01');await p.fill('#tax','22');await p.fill('#fee','0.08');await p.fill('#cash','4')};
 const single=async p=>{for(const [a,b,c,v] of [['a1','b1','c1',60],['a2','b2','c2',200]]){await p.fill('#'+a,''+v);await p.fill('#'+b,''+v);await p.fill('#'+c,'1')}await p.fill('#mn1','60');await p.fill('#mn2','200')};
 const cmpSweep=async(p,tag)=>{await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);const run=await p.evaluate(()=>{const o=window._last[0][0];return[o.st.cagr,o.st.mdd,o.st.so]});
  await p.click('#sw');await wf(p,()=>/완료/.test(document.getElementById('swinfo').textContent),60000);await p.waitForTimeout(300);const sw=await p.evaluate(()=>[window._swrows[0].cagr,window._swrows[0].mdd,window._swrows[0].so]);
  ok(run.every((v,i)=>Math.abs(v-sw[i])<1e-12),tag+': 일반 실행 = 스윕',{run,sw})};
 console.log('A) 일반 실행 = 스윕 (공통/이평별 지연, 상태우선, 이평2 하향매수, 방어 ETF)');
 {const p=await mkPage();await base(p);await single(p);await p.fill('#delay','1');
  await cmpSweep(p,'기본');
  await p.fill('#db1','2');await p.fill('#ds1','1');await p.fill('#db2','4');await cmpSweep(p,'이평별 지연');
  await p.selectOption('#tr2','dn');await cmpSweep(p,'이평2 하향 돌파 매수');await p.selectOption('#tr2','up');
  await p.evaluate(()=>{document.getElementById('stFirst').checked=false;save()});await cmpSweep(p,'상태 우선 끔');await p.evaluate(()=>{document.getElementById('stFirst').checked=true;save()});
  await p.fill('#alt','XLV');await cmpSweep(p,'방어 ETF XLV');ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('B) 방어 ETF 상장 전 = 현금, 스캔 = 일반 실행, 스윕 = 일반 실행');
 {const p=await mkPage(()=>{const of=window.fetch,L={LATE:'2014-03-03',MID:'2016-06-01',EARLY:'2009-01-02'};window.fetch=async(u,...a)=>{const m=/symbol=([^&]+)&start=([^&]+)&end=([^&]+)/.exec(String(u));if(!m||!(m[1] in L))return of(u,...a);const[,sym,s,e]=m,rows=[];let d=new Date(Math.max(+new Date(s),+new Date(L[sym]))),x=100,i=0;const end=new Date(e);for(;d<=end;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6){i++;x*=1+Math.sin(i/11)*.006+.0003;rows.push([d.toISOString().slice(0,10),x])}return{json:async()=>rows,headers:{get:()=>'adj'}}}});
  await base(p);await p.fill('#s','2012-01-02');await p.fill('#e','2019-12-31');await p.fill('#mn1','60');await p.fill('#mn2','200');await p.fill('#alt','LATE');await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);
  const r=await p.evaluate(()=>{const[out,dates]=window._last,alt=out[0].e,cash=out[1].e,L=dates.findIndex(d=>d>='2014-03-03');let md=0;for(let i=0;i<L;i++)md=Math.max(md,Math.abs(alt[i]-cash[i])/Math.max(1,cash[i]));return{start:dates[0],md}});
  ok(r.start==='2012-01-02'&&r.md===0,'상장(2014-03-03) 전 구간 자산이 현금 전략과 같고 시작일은 그대로',r);
  await single(p);await cmpSweep(p,'상장이 늦은 방어 ETF');
  await p.fill('#alt','');await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(500);
  await p.evaluate(()=>{document.querySelector('#defSec details').open=true});await p.fill('#altlist','LATE,MID,EARLY');await p.click('#recbtn');await wf(p,()=>/비교 완료/.test(document.getElementById('recmsg').textContent),90000);await p.waitForTimeout(500);
  const sc=await p.evaluate(async()=>{const d=window._altData,res=[];for(const r of d.rows.filter(x=>!x.base)){const x=await run({silent:true,alt:r.sym});res.push([r.sym,['cagr','mdd','so','tot'].map(k=>Math.abs(r.st[k]-x.st[k])).reduce((a,b)=>Math.max(a,b),0)])}return res});
  ok(sc.length===3&&sc.every(([,d])=>d<1e-12),'스캔 결과 = 일반 실행 (상장 늦은 ETF 포함 3개)',sc);ok(p.errs.length===0,'JS 오류 없음',p.errs);await p.close()}
 console.log('C) 스캔 속도 경로 = 일반 실행 (후보 10개, 돌파/이탈·상태 유지)');
 for(const [name,c] of [['돌파/이탈',{mode:'cross',init:100,delay:1}],['이평별 지연+하향매수',{mode:'cross',init:100,delay:1,db1:2,ds1:1,db2:3,tr2:'dn'}],['상태 유지',{mode:'state',init:0,delay:1}]]){
  const p=await mkPage();await base(p);await p.fill('#s','2013-01-01');await p.selectOption('#mode',c.mode);await p.fill('#init',''+c.init);await p.fill('#delay',''+c.delay);
  if(c.mode==='cross'){await p.fill('#mn1','120');await p.fill('#mn2','250');for(const k of ['db1','ds1','db2'])await p.fill('#'+k,c[k]?''+c[k]:'');await p.selectOption('#tr2',c.tr2||'up')}
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
  await p.fill('#sig','LISTED');await p.fill('#trd','LISTED');await p.fill('#cmp','');await p.fill('#s','2012-01-02');await p.fill('#e','2016-01-04');await p.fill('#mn1','360');await p.fill('#mn2','100');await p.fill('#alt','');await p.click('#run');await wf(p,()=>window._last,30000);await p.waitForTimeout(800);
  const st=await p.evaluate(()=>window._last[1][0]);const exp=await p.evaluate(async()=>(await (await fetch('/api/prices?symbol=LISTED&start=2012-01-02&end=2016-01-04')).json())[359][0]);ok(st===exp,'시작일='+exp,st);await p.close()}
 console.log(bad?`\n실패 ${bad} / ${n}`:`\n모든 화면 검사 통과 (${n}개)`);await br.close();process.exit(bad?1:0)})().catch(e=>{console.error('테스트 오류',e.stack.split('\n').slice(0,4).join(' / '));process.exit(2)});
