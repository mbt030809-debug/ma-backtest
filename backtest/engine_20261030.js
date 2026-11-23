// 백테스트 엔진 (순수 함수, 브라우저/Node 공용)
function ma(a, n, ema) {
  const o = Array(a.length).fill(NaN);
  if (ema) {
    const k = 2 / (n + 1); let p = NaN;
    for (let i = 0; i < a.length; i++) {
      if (i == n - 1) { let t = 0; for (let j = 0; j < n; j++) t += a[j]; p = t / n; }
      else if (i >= n) p = a[i] * k + p * (1 - k);
      o[i] = i >= n - 1 ? p : NaN;
    }
  } else {
    for (let i = n - 1; i < a.length; i++) { let t = 0; for (let j = i - n + 1; j <= i; j++) t += a[j]; o[i] = t / n; } // 직접 합산: 누적합 부동소수 오차 방지
  }
  return o;
}
const series = (px, k, n) => k == 'price' ? px : ma(px, n, k == 'ema');

// conds: [{conn:'AND'|'OR', lk,ln, op:'>'|'<', rk,rn}] (첫 조건의 conn은 무시). 위에서 아래로 순서대로 결합.
// 반환 {v: 조건충족, ok: 모든 지표가 계산 가능(이평 워밍업 끝)} 또는 조건이 없으면 null
function evalConds(px, conds) {
  if (!conds.length) return null;
  let v = null, ok = px.map(() => true);
  conds.forEach((c, i) => {
    const L = series(px, c.lk, c.ln), R = series(px, c.rk, c.rn), gt = c.op == '>';
    const cv = px.map((_, j) => isNaN(L[j]) || isNaN(R[j]) ? false : gt ? L[j] > R[j] : L[j] < R[j]);
    ok = ok.map((x, j) => x && !isNaN(L[j]) && !isNaN(R[j]));
    v = i == 0 ? cv : v.map((x, j) => c.conn == 'OR' ? x || cv[j] : x && cv[j]);
  });
  return { v, ok };
}

// 일별 목표 비중(그날 종가 신호 기준). 매도조건 충족 → 0, 매수조건 충족 → 1,
// 매도조건이 없으면 매수조건 불충족 → 0. 그 외·워밍업 중에는 직전 비중 유지(최초=init).
function targets(buy, sell, init) {
  let w = init; const out = [];
  for (let i = 0; i < buy.v.length; i++) {
    if (buy.ok[i] && (!sell || sell.ok[i])) {
      if (sell && sell.v[i]) w = 0;
      else if (buy.v[i]) w = 1;
      else if (!sell) w = 0;
    }
    out.push(w);
  }
  return out;
}

// 신호 후 delay일 뒤 체결: j일 수익률에 적용되는 비중 = target[j-1-delay] (없으면 init)
const applied = (tg, init, delay) => tg.map((_, j) => j - 1 - delay >= 0 ? tg[j - 1 - delay] : init);

// px: 매매종목 가격, w[j]: j일 시작(전일 종가) 시점 목표비중.
// cashRate: 연 현금이자(소수), taxRate: 매도 수익에 대한 세율(소수, 매도 건별)
// ---- 세금 정산기 ----
// 과세 대상: 주식/ETF 매도 손익(현금 이자는 제외). 달력연도(1/1~12/31)별로 (이익+손실)을 합산해
// 순이익이 양수면 rate를 곱해 다음 해 5/1(이후 첫 거래일)에 납부. 매도가 없던 해는 세금 없음. 손실은 이월·환급 없음.
// 마지막 날은 보유분을 전부 즉시 매도한 것으로 보고, 올해 순손익 + 미실현 손익에 즉시 과세.
function makeTaxer(dates, rate) {
  let yr = null, net = 0, lu = 0; const liab = [], by = {};
  return {
    // 귀속연도별 세금: 지난해들은 확정액, 마지막 해는 전량 즉시 청산 가정 세금
    yearTax() { const o = { ...by }; if (yr !== null) o[yr] = rate * Math.max(0, net + lu); return o; },
    step(i) { const y = dates[i].slice(0, 4);
      if (yr === null) yr = y; else if (y !== yr) { const am = Math.max(0, net) * rate; by[yr] = am; liab.push({ due: (+yr + 1) + '-05-01', amt: am }); net = 0; yr = y; }
      let due = 0; while (liab.length && liab[0].due <= dates[i]) due += liab.shift().amt; return due; },
    rec(g) { net += g; },
    pending() { let t = 0; for (const l of liab) t += l.amt; return t; },
    liq(unreal) { lu = unreal; return rate * Math.max(0, net + unreal); }
  };
}

function simulate(dates, px, w, o) {
  const n = px.length, cd = Math.pow(1 + (o.cashRate || 0), 1 / 252) - 1, tax = o.taxRate || 0;
  const tx = makeTaxer(dates, tax);
  let S = w[0] * 100, C = 100 - S, B = S, paid = 0, trades = 0, bsum = S, ssum = 0, intr = 0;
  const eq = [100], eqL = [100], list = [], pd = [0];
  tx.step(0);
  if (S > 0) list.push({ i: 0, si: 0, side: 'B', rule: '시작', price: px[0], qty: S / px[0], amt: S, tax: 0, cash: C, sh: S / px[0] });
  for (let j = 1; j < n; j++) {
    const due = tx.step(j);
    if (due > 0) { let rem = due, c = Math.min(C, rem); C -= c; rem -= c; let tk = c; if (rem > 0 && S > 0) { const f = Math.min(1, rem / S), v = S * f, cost = B * f; tx.rec(v - cost); ssum += v; B -= cost; S -= v; tk += v; trades++; list.push({ i: j - 1, si: j - 1, side: 'S', rule: '세금 납부용 매도', price: px[j - 1], qty: v / px[j - 1], amt: v, gain: v - cost, tax: 0, cash: C, sh: S / px[j - 1] }) } paid += tk;
      list.push({ i: j - 1, si: j - 1, side: 'T', rule: '세금 정산(전년도 순이익, 납부)', price: px[j - 1], qty: 0, amt: tk, tax: tk, cash: C, sh: S / px[j - 1] }); }
    const V = S + C, tS = w[j] * V;
    if (tS < S - 1e-9) { // 매도: 실현손익은 연도별로 합산해 다음 해 5/1에 정산(세금은 여기서 내지 않음)
      const sold = S - tS, cost = B * (sold / S);
      tx.rec(sold - cost); B -= cost; S = tS; C = V - S; ssum += sold; trades++; if (o.log) o.log.push({ j, sold, cost, t: 0, p: px[j - 1] });
      list.push({ i: j - 1, si: Math.max(0, j - 1 - (o.delay || 0)), side: 'S', rule: '매도 조건', price: px[j - 1], qty: sold / px[j - 1], amt: sold, gain: sold - cost, tax: 0, cash: C, sh: S / px[j - 1] });
    }
    else if (tS > S + 1e-9) { const add = tS - S; B += add; bsum += add; S = tS; C = V - S; trades++; list.push({ i: j - 1, si: Math.max(0, j - 1 - (o.delay || 0)), side: 'B', rule: '매수 조건', price: px[j - 1], qty: add / px[j - 1], amt: add, tax: 0, cash: C, sh: S / px[j - 1] }); }
    S *= px[j] / px[j - 1]; intr += C * cd; C *= 1 + cd;
    pd.push(paid); eq.push(S + C); eqL.push(S + C - tx.pending() - tx.liq(S - B)); // eqL: 지금 전부 청산한다고 가정한 세후 가치(미납 세금 + 올해 순이익·미실현 이익에 즉시 과세)
  }
  return { eq, eqL, eqP: eqPay(eq, eqL), pd, taxY: tx.yearTax(), paid, trades, list, pnl: { x: ssum - bsum + S, y: [], int: intr, tax: paid, fee: 0, unreal: eq[n - 1] - eqL[n - 1] } };
}


// ---- 방어자산(현금 대신 보유할 ETF) 버전 ----
// 매도하면 그 대금으로 방어자산(Y)을 사고, 매수하면 방어자산(Y)을 팔아 X를 삼. 두 쪽 모두 이익에는 세율 적용(손실 0, 건별).
// py: 방어자산 가격(배당 포함 수정종가). 여러 개면 [[...],[...]]로 주고 동일 비중 바구니로 보유(각 자산을 따로 사고팔며 따로 과세).
// 매수 규칙의 r은 "방어자산 평가금액의 r%".
// 방어자산 시세에 NaN이 있으면(상장 전) 그 구간은 '정보 없음': 매도 대금은 현금으로 두고, 시세가 생긴 날부터 방어 ETF로 보유(남은 현금도 그날 전환).
function simulateEventsAlt(dates, px, py, buys, sells, o) {
  const ys0 = Array.isArray(py[0]) ? py : [py], K = ys0.length;
  const av = ys0.map(a => a.map(v => Number.isFinite(v) && v > 0)), ys = ys0.map(a => a.map(v => Number.isFinite(v) && v > 0 ? v : 0));
  const avail = i => { const r = []; for (let k = 0; k < K; k++) if (av[k][i]) r.push(k); return r; };
  const n = px.length, ig = o.ig || interestFactors(dates, o.cashRate), fee = o.fee || 0, tax = o.tax || 0, delay = Math.max(1, o.delay | 0), dB = Math.max(1, (o.delayBuy != null ? o.delayBuy : o.delay) | 0), dS = Math.max(1, (o.delaySell != null ? o.delaySell : o.delay) | 0); const sf = o.stateFirst !== false; const maxD = Math.max(dB, dS, ...buys.map(x => x.d | 0), ...sells.map(x => x.d | 0)); // 이평선(규칙)마다 d(지연)를 따로 줄 수 있음 // 매수·매도 지연을 따로 줄 수 있음(없으면 delay)
  const tx = makeTaxer(dates, tax);
  // 규칙에 f2/r2 가 있으면 같은 이평선의 두 번째 매수 신호(예: 이평2 하향 돌파 x% · 상향 돌파 100−x%): f 는 첫 번째 신호·r, f2 는 두 번째 신호·r2
  const bs2 = buys.map(r => r.f2 ? { ...r, r: r.r2 || 0, a: '↓', f: r.f2, f2: null } : null);
  let cash = 0, sh = 0, basis = 0, paid = 0, trades = 0, bX = 0, sX = 0, intr = 0, fees = 0;
  const shy = Array(K).fill(0), basy = Array(K).fill(0), bY = Array(K).fill(0), sY = Array(K).fill(0), orders = {}, eq = [], eqL = [], pd = [], w = [], list = [];
  const a0 = 100 * o.init, y0 = 100 - a0;
  if (a0 > 0) { sh = a0 * (1 - fee) / px[0]; basis = a0; bX += a0; fees += a0 * fee; trades++; list.push({ i: 0, si: 0, side: 'B', asset: 'X', rule: '시작', price: px[0], qty: sh, amt: a0, tax: 0, cash, sh }); }
  const A0 = avail(0);
  if (y0 > 0 && !A0.length) cash += y0;
  if (y0 > 0) for (const k of A0) { const a = y0 / A0.length; shy[k] = a * (1 - fee) / ys[k][0]; basy[k] = a; bY[k] += a; fees += a * fee; trades++; list.push({ i: 0, si: 0, side: 'B', asset: 'Y', yi: k, rule: '시작(방어자산)', price: ys[k][0], qty: shy[k], amt: a, tax: 0, cash, sh: shy[k] }); }
  for (let i = 0; i < n; i++) {
    if (i > 0) { const c0 = cash; cash *= ig[i]; intr += cash - c0; }
    if (i > 0 && cash > 1e-12) { const A = avail(i), newly = A.filter(k => !av[k][i - 1]); // 방어 ETF 시세가 처음 생긴 날: 들고 있던 현금을 ETF로 전환
      if (newly.length) { const amtAll = cash; cash = 0; for (const k of A) { const a = amtAll / A.length, qy = a * (1 - fee) / ys[k][i]; shy[k] += qy; basy[k] += a; bY[k] += a; fees += a * fee; trades++;
        list.push({ i, si: i, side: 'B', asset: 'Y', yi: k, rule: '방어 ETF 시세 시작 → 현금 전환', price: ys[k][i], qty: qy, amt: a, tax: 0, cash, sh: shy[k] }); } } }
    const due = tx.step(i);
    if (due > 0) { let rem = due, c = Math.min(cash, rem); cash -= c; rem -= c; let tk = c;
      if (rem > 0) { let V = sh * px[i]; for (let k = 0; k < K; k++) V += shy[k] * ys[k][i];
        if (V > 0) { const f = Math.min(1, rem / (V * (1 - fee)));
          if (sh > 0) { const q = sh * f, amt = q * px[i] * (1 - fee), cost = basis * f; tx.rec(amt - cost); basis -= cost; sh -= q; sX += amt; tk += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++;
            list.push({ i, si: i, side: 'S', asset: 'X', rule: '세금 납부용 매도', price: px[i], qty: q, amt, gain: amt - cost, tax: 0, cash, sh }) }
          for (let k = 0; k < K; k++) if (shy[k] > 0) { const q = shy[k] * f, amt = q * ys[k][i] * (1 - fee), cost = basy[k] * f; tx.rec(amt - cost); basy[k] -= cost; shy[k] -= q; sY[k] += amt; tk += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++;
            list.push({ i, si: i, side: 'S', asset: 'Y', yi: k, rule: '세금 납부용 매도', price: ys[k][i], qty: q, amt, gain: amt - cost, tax: 0, cash, sh: shy[k] }) } } }
      paid += tk; list.push({ i, si: i, side: 'T', rule: '세금 정산(전년도 순이익, 납부)', price: px[i], qty: 0, amt: tk, tax: tk, cash, sh }); }
    const add = (s, r, k, hit) => { const d = r.d != null ? Math.max(1, r.d | 0) : (s ? dS : dB);
      // 지연은 '판단만 미루는 것': 이평선 아래(이탈)면 매도, 위(돌파)면 매수가 우선이므로 반대 신호가 나오면 대기 주문을 정리한다(stateFirst, 기본 켜짐).
      //  - 같은 이평선의 반대 신호 → 대기 중인 반대 주문 취소
      //  - 다른 이평선끼리 충돌 → 장기선이 우세: 장기선의 실제 주문(비율>0)은 단기선의 반대 대기 주문을 취소하고,
      //    장기선의 반대 대기 주문이 남아 있으면 단기선의 새 주문은 내지 않음(보류)
      let sup = false;
      // r.free(바닥 신호): 다른 규칙과 서로 취소·보류하지 않고 독립적으로 체결됨
      if (hit && sf && !r.free) for (let q = i; q <= i + maxD; q++) (orders[q] || []).forEach(od => {
        if (od.dead || od.free || od.s === s) return;
        if (od.k === k) od.dead = true;
        else if (r.r > 0 && od.n < r.n) od.dead = true;
        else if (r.r > 0 && od.n > r.n) sup = true;
      });
      if (r.r > 0 && hit && i + d < n && !sup) (orders[i + d] = orders[i + d] || []).push({ s, r: r.r, k, n: r.n, free: !!r.free, si: i, label: (s ? '매도' : '매수') + (k + 1) + ' ' + (r.lbl || ((r.n || '') + '일' + (r.a || (s ? '↓' : '↑')))) }); };
    const signals = () => {
      sells.forEach((r, k) => add(true, r, k, r.f[i]));
      buys.forEach((r, k) => { add(false, r, k, r.f[i]); if (bs2[k]) add(false, bs2[k], k, bs2[k].f[i]); });
    };
    if (sf) signals(); // 상태 우선: 오늘 신호로 대기 주문을 먼저 정리한 뒤 체결
    let soldToday = false; // 같은 날 이평 매도가 체결되면 같은 날 바닥 신호 매수는 건너뜀(그날은 매도 우선, 바닥 신호가 이어지면 다음 날 매수)
    (orders[i] || []).sort((a, b) => (a.s ? 0 : 1) - (b.s ? 0 : 1) || a.k - b.k).forEach(od => {
      if (od.dead) return; // 반대 신호로 취소된 주문
      if (!od.s && od.free && soldToday) return;
      if (od.s && !od.free) soldToday = true;
      if (od.s) { // X 매도 → 방어자산(들) 매수
        if (!(sh > 0)) return;
        const q = sh * od.r, amt = q * px[i] * (1 - fee), cost = basis * (q / sh), t = 0;
        tx.rec(amt - cost); basis -= cost; sh -= q; sX += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++;
        list.push({ i, si: od.si, side: 'S', asset: 'X', rule: od.label, price: px[i], qty: q, amt, gain: amt - cost, tax: t, cash, sh });
        const net = amt, AI = avail(i);
        if (!AI.length) cash += net; // 방어 ETF 시세가 아직 없으면 현금으로 보유
        for (const k of AI) { const a = net / AI.length, qy = a * (1 - fee) / ys[k][i]; shy[k] += qy; basy[k] += a; bY[k] += a; fees += a * fee; trades++;
          list.push({ i, si: od.si, side: 'B', asset: 'Y', yi: k, rule: od.label + ' 대금', price: ys[k][i], qty: qy, amt: a, tax: 0, cash, sh: shy[k] }); }
      } else { // 방어자산(들) 매도 → X 매수
        let net = 0;
        for (let k = 0; k < K; k++) { if (!(shy[k] > 0)) continue;
          const qy = shy[k] * od.r, amtY = qy * ys[k][i] * (1 - fee), costY = basy[k] * od.r, tY = 0;
          tx.rec(amtY - costY); basy[k] -= costY; shy[k] -= qy; sY[k] += amtY; fees += fee < 1 ? amtY / (1 - fee) * fee : 0; trades++; net += amtY - tY;
          list.push({ i, si: od.si, side: 'S', asset: 'Y', yi: k, rule: od.label + ' 자금', price: ys[k][i], qty: qy, amt: amtY, gain: amtY - costY, tax: tY, cash, sh: shy[k] }); }
        const c = cash * od.r; cash -= c; net += c;
        if (!(net > 0)) return;
        const q = net * (1 - fee) / px[i]; sh += q; basis += net; bX += net; fees += net * fee; trades++;
        list.push({ i, si: od.si, side: 'B', asset: 'X', rule: od.label, price: px[i], qty: q, amt: net, tax: 0, cash, sh });
      }
    });
    if (!sf) signals();
    const vx = sh * px[i]; let vy = 0, ut = 0; for (let k = 0; k < K; k++) { const v = shy[k] * ys[k][i]; vy += v; ut += v - basy[k]; }
    const v = cash + vx + vy; pd.push(paid); eq.push(v); eqL.push(v - tx.pending() - tx.liq(vx - basis + ut)); w.push(v ? vx / v : 0);
  }
  return { eq, eqL, eqP: eqPay(eq, eqL), pd, taxY: tx.yearTax(), paid, trades, w, list, pnl: { x: sX - bX + sh * px[n - 1], y: shy.map((q, k) => sY[k] - bY[k] + q * ys[k][n - 1]), int: intr, tax: paid, fee: fees, unreal: eq[n - 1] - eqL[n - 1] } };
}
// ---- 목표 주식비율 방식 ----
// evs: 이벤트 배열(우선순위 오름차순 — 같은 날 여러 신호가 켜지면 배열에서 뒤에 있는 것이 이김).
//   각 이벤트 { f: boolean[] (신호가 켜진 날), t: 목표 주식 비중 0~1, d: 지연(거래일, 1 이상), label, rk(규칙 번호), dir('up'|'dn'|'bt') }
// 이벤트가 켜지는 날 그 이벤트의 목표 비중으로 '대기 주문' 1개를 만들고 이전 대기 주문은 버린다(마지막 신호만 따름).
// 체결일에 총자산(주식+현금+방어자산) 대비 주식 비중을 t 로 맞춘다: 부족하면 매수, 넘치면 매도(예: 0%→50% 는 50% 매수, 100%→50% 는 50% 매도).
// 비중은 체결일에만 맞추고, 그 뒤 가격이 변해 비중이 달라져도 다음 신호까지 그대로 둔다.
// py: 방어자산 가격(없으면 null=현금). 팔면 방어자산(들)을 동일 비중으로 사고, 살 때는 현금 → 방어자산 순으로 자금을 만든다.
// 세금·수수료·현금 이자·방어 ETF 상장 전 현금 처리는 simulateEventsAlt 와 같다.
function simulateTargets(dates, px, py, evs, o) {
  const ys0 = py ? (Array.isArray(py[0]) ? py : [py]) : [], K = ys0.length;
  const av = ys0.map(a => a.map(v => Number.isFinite(v) && v > 0)), ys = ys0.map(a => a.map(v => Number.isFinite(v) && v > 0 ? v : 0));
  const avail = i => { const r = []; for (let k = 0; k < K; k++) if (av[k][i]) r.push(k); return r; };
  const n = px.length, ig = o.ig || interestFactors(dates, o.cashRate), fee = o.fee || 0, tax = o.tax || 0, dflt = Math.max(1, o.delay | 0);
  const tx = makeTaxer(dates, tax);
  let cash = 0, sh = 0, basis = 0, paid = 0, trades = 0, bX = 0, sX = 0, intr = 0, fees = 0, pend = null;
  const sgs = o.sigs ? [] : null; // 신호 기록(화면 표시용): st = 'p' 대기 / 'x' 체결 / 'c' 새 신호로 취소
  const shy = Array(K).fill(0), basy = Array(K).fill(0), bY = Array(K).fill(0), sY = Array(K).fill(0), eq = [], eqL = [], pd = [], w = [], list = [];
  const a0 = 100 * o.init, y0 = 100 - a0;
  if (a0 > 0) { sh = a0 * (1 - fee) / px[0]; basis = a0; bX += a0; fees += a0 * fee; trades++; list.push({ i: 0, si: 0, side: 'B', asset: 'X', rule: '시작', price: px[0], qty: sh, amt: a0, tax: 0, cash, sh }); }
  const A0 = avail(0);
  if (y0 > 0 && !A0.length) cash += y0;
  if (y0 > 0) for (const k of A0) { const a = y0 / A0.length; shy[k] = a * (1 - fee) / ys[k][0]; basy[k] = a; bY[k] += a; fees += a * fee; trades++; list.push({ i: 0, si: 0, side: 'B', asset: 'Y', yi: k, rule: '시작(방어자산)', price: ys[k][0], qty: shy[k], amt: a, tax: 0, cash, sh: shy[k] }); }
  for (let i = 0; i < n; i++) {
    if (i > 0) { const c0 = cash; cash *= ig[i]; intr += cash - c0; }
    if (i > 0 && cash > 1e-12 && K) { const A = avail(i), newly = A.filter(k => !av[k][i - 1]); // 방어 ETF 시세가 처음 생긴 날: 들고 있던 현금을 ETF로 전환
      if (newly.length) { const amtAll = cash; cash = 0; for (const k of A) { const a = amtAll / A.length, qy = a * (1 - fee) / ys[k][i]; shy[k] += qy; basy[k] += a; bY[k] += a; fees += a * fee; trades++;
        list.push({ i, si: i, side: 'B', asset: 'Y', yi: k, rule: '방어 ETF 시세 시작 → 현금 전환', price: ys[k][i], qty: qy, amt: a, tax: 0, cash, sh: shy[k] }); } } }
    const due = tx.step(i);
    if (due > 0) { let rem = due, c = Math.min(cash, rem); cash -= c; rem -= c; let tk = c;
      if (rem > 0) { let V = sh * px[i]; for (let k = 0; k < K; k++) V += shy[k] * ys[k][i];
        if (V > 0) { const f = Math.min(1, rem / (V * (1 - fee)));
          if (sh > 0) { const q = sh * f, amt = q * px[i] * (1 - fee), cost = basis * f; tx.rec(amt - cost); basis -= cost; sh -= q; sX += amt; tk += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++;
            list.push({ i, si: i, side: 'S', asset: 'X', rule: '세금 납부용 매도', price: px[i], qty: q, amt, gain: amt - cost, tax: 0, cash, sh }) }
          for (let k = 0; k < K; k++) if (shy[k] > 0) { const q = shy[k] * f, amt = q * ys[k][i] * (1 - fee), cost = basy[k] * f; tx.rec(amt - cost); basy[k] -= cost; shy[k] -= q; sY[k] += amt; tk += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++;
            list.push({ i, si: i, side: 'S', asset: 'Y', yi: k, rule: '세금 납부용 매도', price: ys[k][i], qty: q, amt, gain: amt - cost, tax: 0, cash, sh: shy[k] }) } } }
      paid += tk; list.push({ i, si: i, side: 'T', rule: '세금 정산(전년도 순이익, 납부)', price: px[i], qty: 0, amt: tk, tax: tk, cash, sh }); }
    // 신호: 켜진 이벤트 중 마지막(우선순위 가장 높은) 것이 대기 주문이 됨. 새 신호는 이전 대기 주문을 대체한다.
    for (const ev of evs) if (ev.f[i]) { const d = ev.d != null ? Math.max(1, ev.d | 0) : dflt; if (pend && pend.s) pend.s.st = 'c'; const sg = sgs ? { si: i, day: i + d, d, t: ev.t, label: ev.label, rk: ev.rk, dir: ev.dir, fill: ev.fill, st: 'p' } : null; if (sg) sgs.push(sg); pend = { day: i + d, t: ev.t, label: ev.label, si: i, rk: ev.rk, dir: ev.dir, fill: ev.fill, s: sg }; } // day >= n 이면 끝까지 체결되지 않는 대기 주문
    if (pend && pend.day === i) {
      const od = pend; pend = null;
      // 체결 가격: 이벤트마다 종가(기본) 또는 시가(o.ox, 매매 종목에만 적용. 방어 ETF 매매는 같은 날 종가). 하루 평가는 항상 종가.
      const pe = od.fill === 'o' && o.ox && o.ox[i] > 0 ? o.ox[i] : px[i];
      const vx0 = sh * pe; let vy0 = 0; for (let k = 0; k < K; k++) vy0 += shy[k] * ys[k][i];
      const total = cash + vx0 + vy0, want = od.t * total, eps = 1e-9 * Math.max(total, 1);
      if (od.s) { od.s.st = 'x'; od.s.px = pe; od.s.w0 = total > 0 ? vx0 / total : 0; od.s.did = ''; }
      if (vx0 > want + eps) { // 주식 비중 줄이기: 매도 → 방어자산 또는 현금
        const f = (vx0 - want) / vx0, q = sh * f, amt = q * pe * (1 - fee), cost = basis * f;
        tx.rec(amt - cost); basis -= cost; sh -= q; sX += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++;
        list.push({ i, si: od.si, side: 'S', asset: 'X', rule: od.label, rk: od.rk, dir: od.dir, tgt: od.t, price: pe, qty: q, amt, gain: amt - cost, tax: 0, cash, sh }); if (od.s) od.s.did = 'S';
        const AI = avail(i);
        if (!AI.length) cash += amt; // 방어 ETF 시세가 아직 없으면 현금으로 보유
        for (const k of AI) { const a = amt / AI.length, qy = a * (1 - fee) / ys[k][i]; shy[k] += qy; basy[k] += a; bY[k] += a; fees += a * fee; trades++;
          list.push({ i, si: od.si, side: 'B', asset: 'Y', yi: k, rule: od.label + ' 대금', price: ys[k][i], qty: qy, amt: a, tax: 0, cash, sh: shy[k] }); }
      } else if (want > vx0 + eps) { // 주식 비중 늘리기: 현금 → 방어자산 순으로 자금을 만들어 매수
        const need = (want - vx0) / (1 - fee); let net = Math.min(cash, need); cash -= net; const rem = need - net;
        if (rem > 1e-12 && K) { let Vy = 0; for (let k = 0; k < K; k++) Vy += shy[k] * ys[k][i] * (1 - fee);
          if (Vy > 0) { const f = Math.min(1, rem / Vy);
            for (let k = 0; k < K; k++) { if (!(shy[k] > 0)) continue; const qy = shy[k] * f, amtY = qy * ys[k][i] * (1 - fee), costY = basy[k] * f;
              tx.rec(amtY - costY); basy[k] -= costY; shy[k] -= qy; sY[k] += amtY; fees += fee < 1 ? amtY / (1 - fee) * fee : 0; trades++; net += amtY;
              list.push({ i, si: od.si, side: 'S', asset: 'Y', yi: k, rule: od.label + ' 자금', price: ys[k][i], qty: qy, amt: amtY, gain: amtY - costY, tax: 0, cash, sh: shy[k] }); } } }
        if (net > 0) { const q = net * (1 - fee) / pe; sh += q; basis += net; bX += net; fees += net * fee; trades++;
          list.push({ i, si: od.si, side: 'B', asset: 'X', rule: od.label, rk: od.rk, dir: od.dir, tgt: od.t, price: pe, qty: q, amt: net, tax: 0, cash, sh }); if (od.s) od.s.did = 'B'; }
      }
    }
    const vx = sh * px[i]; let vy = 0, ut = 0; for (let k = 0; k < K; k++) { const v = shy[k] * ys[k][i]; vy += v; ut += v - basy[k]; }
    const v = cash + vx + vy; pd.push(paid); eq.push(v); eqL.push(v - tx.pending() - tx.liq(vx - basis + ut)); w.push(v ? vx / v : 0);
  }
  return { eq, eqL, eqP: eqPay(eq, eqL), pd, taxY: tx.yearTax(), paid, trades, w, list, sigs: sgs, pnl: { x: sX - bX + sh * px[n - 1], y: shy.map((q, k) => sY[k] - bY[k] + q * ys[k][n - 1]), int: intr, tax: paid, fee: fees, unreal: eq[n - 1] - eqL[n - 1] } };
}
// 상태 유지 방식(목표 비중 w[j])의 방어자산 버전: X 비중 w, 나머지는 방어자산(들)
function simulateAlt(dates, px, py, w, o) {
  const ys0 = Array.isArray(py[0]) ? py : [py], K = ys0.length;
  const av = ys0.map(a => a.map(v => Number.isFinite(v) && v > 0)), ys = ys0.map(a => a.map(v => Number.isFinite(v) && v > 0 ? v : 0));
  const avail = i => { const r = []; for (let k = 0; k < K; k++) if (av[k][i]) r.push(k); return r; };
  const n = px.length, cd = Math.pow(1 + (o.cashRate || 0), 1 / 252) - 1, tax = o.taxRate || 0;
  const tx = makeTaxer(dates, tax);
  let X = w[0] * 100, bX = X, C = 0, paid = 0, trades = 0, bXs = X, sXs = 0, intr = 0; tx.step(0);
  const A0 = avail(0); if (X < 100 && !A0.length) C = 100 - X;
  const Y = ys.map((_, k) => A0.includes(k) ? (100 - X) / A0.length : 0), bY = Y.slice(), bYs = Y.slice(), sYs = Array(K).fill(0), eq = [100], eqL = [100], list = [], pd = [0];
  if (X > 0) list.push({ i: 0, si: 0, side: 'B', asset: 'X', rule: '시작', price: px[0], qty: X / px[0], amt: X, tax: 0, cash: C, sh: X / px[0] });
  if (100 - X > 0) for (const k of A0) list.push({ i: 0, si: 0, side: 'B', asset: 'Y', yi: k, rule: '시작(방어자산)', price: ys[k][0], qty: Y[k] / ys[k][0], amt: Y[k], tax: 0, cash: C, sh: Y[k] / ys[k][0] });
  for (let j = 1; j < n; j++) {
    { const A = avail(j - 1), newly = A.filter(k => j < 2 || !av[k][j - 2]); // 방어 ETF 시세가 처음 생기면 현금을 ETF로 전환
      if (newly.length && C > 1e-12) { const amtAll = C; C = 0; for (const k of A) { const a = amtAll / A.length; Y[k] += a; bY[k] += a; bYs[k] += a; trades++;
        list.push({ i: j - 1, si: j - 1, side: 'B', asset: 'Y', yi: k, rule: '방어 ETF 시세 시작 → 현금 전환', price: ys[k][j - 1], qty: a / ys[k][j - 1], amt: a, tax: 0, cash: C, sh: Y[k] / ys[k][j - 1] }); } } }
    const due = tx.step(j);
    if (due > 0) { let rem = due, c = Math.min(C, rem); C -= c; rem -= c; let tk = c; const V0 = X + Y.reduce((a, b) => a + b, 0);
      if (rem > 0 && V0 > 0) { const f = Math.min(1, rem / V0); if (X > 0) { const v = X * f, cost = bX * f; tx.rec(v - cost); sXs += v; bX -= cost; X -= v; tk += v; trades++; list.push({ i: j - 1, si: j - 1, side: 'S', asset: 'X', rule: '세금 납부용 매도', price: px[j - 1], qty: v / px[j - 1], amt: v, gain: v - cost, tax: 0, cash: C, sh: X / px[j - 1] }) }
        for (let k = 0; k < K; k++) if (Y[k] > 0) { const v = Y[k] * f, cost = bY[k] * f; tx.rec(v - cost); sYs[k] += v; bY[k] -= cost; Y[k] -= v; tk += v; trades++; list.push({ i: j - 1, si: j - 1, side: 'S', asset: 'Y', yi: k, rule: '세금 납부용 매도', price: ys[k][j - 1], qty: v / ys[k][j - 1], amt: v, gain: v - cost, tax: 0, cash: C, sh: Y[k] / ys[k][j - 1] }) } }
      paid += tk; list.push({ i: j - 1, si: j - 1, side: 'T', rule: '세금 정산(전년도 순이익, 납부)', price: px[j - 1], qty: 0, amt: tk, tax: tk, cash: C, sh: X / px[j - 1] }); }
    const sy = Y.reduce((a, b) => a + b, 0), V = X + sy + C, tX = w[j] * V, si = Math.max(0, j - 1 - (o.delay || 0));
    if (tX < X - 1e-9) { // X 일부 매도 → 방어자산(들) 매수
      const sold = X - tX, cost = bX * (sold / X), t = 0;
      tx.rec(sold - cost); bX -= cost; X = tX; sXs += sold; trades++;
      list.push({ i: j - 1, si, side: 'S', asset: 'X', rule: '매도 조건', price: px[j - 1], qty: sold / px[j - 1], amt: sold, gain: sold - cost, tax: t, cash: C, sh: X / px[j - 1] });
      const AJ = avail(j - 1); if (!AJ.length) C += sold - t;
      for (const k of AJ) { const a = (sold - t) / AJ.length; Y[k] += a; bY[k] += a; bYs[k] += a; trades++;
        list.push({ i: j - 1, si, side: 'B', asset: 'Y', yi: k, rule: '매도 대금', price: ys[k][j - 1], qty: a / ys[k][j - 1], amt: a, tax: 0, cash: C, sh: Y[k] / ys[k][j - 1] }); }
    } else if (tX > X + 1e-9) { // 방어자산(들) 일부 매도 → X 매수
      const need = Math.min(tX - X, sy + C), fromY = Math.min(need, sy), fromC = need - fromY; let net = fromC;
      if (fromY > 0) { const frac = fromY / sy; for (let k = 0; k < K; k++) { const f = Y[k] * frac, costY = bY[k] * frac, tY = 0; tx.rec(f - costY); bY[k] -= costY; Y[k] -= f; sYs[k] += f; net += f - tY; trades++;
        list.push({ i: j - 1, si, side: 'S', asset: 'Y', yi: k, rule: '매수 자금', price: ys[k][j - 1], qty: f / ys[k][j - 1], amt: f, gain: f - costY, tax: tY, cash: C, sh: Y[k] / ys[k][j - 1] }); } }
      C -= fromC; X += net; bX += net; bXs += net; trades++;
      list.push({ i: j - 1, si, side: 'B', asset: 'X', rule: '매수 조건', price: px[j - 1], qty: net / px[j - 1], amt: net, tax: 0, cash: C, sh: X / px[j - 1] });
    }
    X *= px[j] / px[j - 1]; for (let k = 0; k < K; k++) if (av[k][j] && av[k][j - 1]) Y[k] *= ys[k][j] / ys[k][j - 1]; intr += C * cd; C *= 1 + cd;
    let ut = 0, sY = 0; for (let k = 0; k < K; k++) { sY += Y[k]; ut += Y[k] - bY[k]; }
    pd.push(paid); eq.push(X + sY + C); eqL.push(X + sY + C - tx.pending() - tx.liq(X - bX + ut));
  }
  return { eq, eqL, eqP: eqPay(eq, eqL), pd, taxY: tx.yearTax(), paid, trades, list, pnl: { x: sXs - bXs + X, y: Y.map((v, k) => sYs[k] - bYs[k] + v), int: intr, tax: paid, fee: 0, unreal: eq[n - 1] - eqL[n - 1] } };
}

// 연도별 손익(시작 자산=100 기준 금액): 세전 수익 = (자산 + 누적 납부세금)의 연간 증가, 세금 = 그 연도 귀속 세금(다음 해 5/1 납부분 + 마지막 해는 즉시 청산 세금),
// 순수익 = 세전 수익 − 세금. 순수익 합 = 최종 세후 청산가치 − 100.
// 실제 현금흐름 기준 자산: 세금 납부일(5/1)에 계단으로 줄고, 마지막 날만 전량 즉시 청산 세금을 반영(차트·통계용)
function eqPay(eq, eqL) { const a = eq.slice(); a[a.length - 1] = eqL[a.length - 1]; return a; }
function yearlyPnl(dates, sim) {
  const rows = [], n = dates.length; let i0 = 0, startPre = 100, startNet = 100;
  const years = []; for (let i = 0; i < n; i++) { const y = dates[i].slice(0, 4); if (!years.length || years[years.length - 1] !== y) years.push(y); }
  for (const y of years) {
    let last = i0; while (last + 1 < n && dates[last + 1].slice(0, 4) === y) last++;
    const pre = sim.eq[last] + sim.pd[last], gross = pre - startPre, tax = sim.taxY[y] || 0, net = gross - tax;
    let real = 0; for (const t of sim.list) if (t.side === 'S' && t.gain != null && dates[t.i].slice(0, 4) === y) real += t.gain;
    rows.push({ y, gross, real, tax, net, ret: startNet > 0 ? net / startNet : 0, endL: startNet + net });
    startPre = pre; startNet += net; i0 = last + 1; if (i0 >= n) break;
  }
  return rows;
}

const buyHold = px => px.map(v => v / px[0] * 100);

function stats(e, dates) {
  const n = e.length, yrs = (new Date(dates[n - 1]) - new Date(dates[0])) / 31557600000;
  const r = e.map((v, i) => i ? v / e[i - 1] - 1 : 0).slice(1);
  const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  let pk = 100, mdd = 0; e.forEach(v => { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); });
  const dd2 = r.reduce((a, b) => a + (b < 0 ? b * b : 0), 0) / r.length, so = dd2 ? m / Math.sqrt(dd2) * Math.sqrt(252) : 0; // 소르티노: 하락 편차(목표 0%)만 위험으로 봄
  const cg = (e[n - 1] / 100) ** (1 / yrs) - 1, ca = cg / Math.max(Math.abs(mdd), 1e-6); // 칼마: CAGR / |MDD|
  const by = {}; dates.forEach((d, i) => by[d.slice(0, 4)] = i);
  const yr = {}; let pv = 100; Object.keys(by).forEach(y => { yr[y] = e[by[y]] / pv - 1; pv = e[by[y]]; });
  return { tot: e[n - 1] / 100 - 1, cagr: cg, mdd, sh: sd ? m / sd * Math.sqrt(252) : 0, so, ca, yr };
}

// ---- 돌파/이탈 이벤트 방식 (이평선 백테스터 아티팩트와 동일 규칙) ----
// 가격이 이평선을 위로 돌파한 날(up)/아래로 이탈한 날(dn) 신호. 전일 <= 이평 && 당일 > 이평 (이탈은 반대).
// 바닥 신호(이평 3 대체): QQQ 등 신호 종목의 MACD/가격 < mTh 이고 VIX − 실현변동성(21일) > gTh 인 날 true.
//  MACD = EMA12 − EMA26(첫 값으로 시작), 실현변동성 = 최근 21일 일간 로그수익률의 표준편차(모집단)×√252, VIX 는 /100 로 맞춤.
//  px, vix: 같은 날짜로 맞춘 종가 배열(vix 빈 값은 직전 값 유지). 값이 없는 날은 false.
function bottomFlags(px, vix, mTh, gTh) {
  const n = px.length, ema = (a, k) => { const o = new Array(n), al = 2 / (k + 1); let p = NaN; for (let i = 0; i < n; i++) { p = Number.isFinite(p) ? a[i] * al + p * (1 - al) : a[i]; o[i] = p; } return o; };
  const e12 = ema(px, 12), e26 = ema(px, 26), lr = px.map((v, i) => i ? Math.log(v / px[i - 1]) : 0), K = 21, f = new Array(n).fill(false);
  let v = NaN; const vx = vix.map(x => (Number.isFinite(x) ? (v = x) : v));
  for (let i = K - 1; i < n; i++) {
    let m = 0; for (let j = i - K + 1; j <= i; j++) m += lr[j]; m /= K;
    let q = 0; for (let j = i - K + 1; j <= i; j++) q += (lr[j] - m) ** 2;
    const rv = Math.sqrt(q / K) * Math.sqrt(252), macd = (e12[i] - e26[i]) / px[i], gap = vx[i] / 100 - rv;
    f[i] = Number.isFinite(macd) && Number.isFinite(gap) && macd < mTh && gap > gTh;
  }
  return f;
}
function crossFlags(px, n) {
  const m = ma(px, n, false), up = [], dn = [];
  for (let i = 0; i < px.length; i++) {
    const ok = i > 0 && !isNaN(m[i - 1]);
    up.push(ok && px[i - 1] <= m[i - 1] && px[i] > m[i]);
    dn.push(ok && px[i - 1] >= m[i - 1] && px[i] < m[i]);
  }
  return { up, dn };
}
// 달력일 365일 복리 이자 계수 (스윕에서 한 번만 계산해 재사용)
function interestFactors(dates, rate) {
  const dr = Math.pow(1 + (rate || 0), 1 / 365) - 1, g = [1];
  for (let i = 1; i < dates.length; i++) g.push(Math.pow(1 + dr, (new Date(dates[i]) - new Date(dates[i - 1])) / 864e5));
  return g;
}
const yearsOf = dates => (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 31557600000;
// 연도별 수익률 없이 핵심 지표만 빠르게 계산 (stats와 같은 값)
function statsLite(e, yrs) {
  const n = e.length; let sum = 0, pk = Math.max(100, e[0]), mdd = Math.min(0, e[0] / 100 - 1), dn = 0; // 첫날 값(수수료로 100 미만일 수 있음)도 낙폭에 포함 (stats와 동일)
  for (let i = 1; i < n; i++) { sum += e[i] / e[i - 1] - 1; }
  const m = sum / (n - 1); let ss = 0;
  for (let i = 1; i < n; i++) { const r0 = e[i] / e[i - 1] - 1; if (r0 < 0) dn += r0 * r0; const d = r0 - m; ss += d * d; if (e[i] > pk) pk = e[i]; const dd = e[i] / pk - 1; if (dd < mdd) mdd = dd; }
  const sd = Math.sqrt(ss / (n - 2)); // 표본표준편차: 수익률 개수(n-1)에서 1을 뺌 (stats와 동일)
  const cg = (e[n - 1] / 100) ** (1 / yrs) - 1, dd2 = dn / (n - 1);
  return { tot: e[n - 1] / 100 - 1, cagr: cg, mdd, sh: sd ? m / sd * Math.sqrt(252) : 0, so: dd2 ? m / Math.sqrt(dd2) * Math.sqrt(252) : 0, ca: cg / Math.max(Math.abs(mdd), 1e-6) };
}

// buys: [{r:현금 비율, f:bool[](dates 정렬)}], sells: [{r:보유 비율, f}]. o: {delay>=1, init, cashRate, tax, fee}
// 시작일 종가에 init 비율 매수. 신호일 i의 주문은 i+delay 거래일 종가 체결, 같은 날은 매도 먼저(규칙 순서).
// 현금이자는 달력일 기준 365일 복리, 세금은 매도 건별 평균단가 대비 이익에만(손실 0, 통산·공제 없음).
function simulateEvents(dates, px, buys, sells, o) {
  const n = px.length, ig = o.ig || interestFactors(dates, o.cashRate), fee = o.fee || 0, tax = o.tax || 0, delay = Math.max(1, o.delay | 0), dB = Math.max(1, (o.delayBuy != null ? o.delayBuy : o.delay) | 0), dS = Math.max(1, (o.delaySell != null ? o.delaySell : o.delay) | 0); const sf = o.stateFirst !== false; const maxD = Math.max(dB, dS, ...buys.map(x => x.d | 0), ...sells.map(x => x.d | 0)); // 이평선(규칙)마다 d(지연)를 따로 줄 수 있음 // 매수·매도 지연을 따로 줄 수 있음(없으면 delay)
  const tx = makeTaxer(dates, tax);
  // 규칙에 f2/r2 가 있으면 같은 이평선의 두 번째 매수 신호(예: 이평2 하향 돌파 x% · 상향 돌파 100−x%): f 는 첫 번째 신호·r, f2 는 두 번째 신호·r2
  const bs2 = buys.map(r => r.f2 ? { ...r, r: r.r2 || 0, a: '↓', f: r.f2, f2: null } : null);
  let cash = 100, sh = 0, basis = 0, paid = 0, trades = 0, bsum = 0, ssum = 0, intr = 0, fees = 0; const orders = {}, eq = [], eqL = [], pd = [], w = [];
  const list = [], amt0 = cash * o.init;
  if (amt0 > 0) { cash -= amt0; sh = amt0 * (1 - fee) / px[0]; basis = amt0; bsum += amt0; fees += amt0 * fee; trades++; list.push({ i: 0, si: 0, side: 'B', rule: '시작', price: px[0], qty: sh, amt: amt0, tax: 0, cash, sh }); }
  for (let i = 0; i < n; i++) {
    if (i > 0) { const c0 = cash; cash *= ig[i]; intr += cash - c0; }
    const due = tx.step(i);
    if (due > 0) { let rem = due, c = Math.min(cash, rem); cash -= c; rem -= c; let tk = c; const V = sh * px[i]; if (rem > 0 && V > 0) { const f = Math.min(1, rem / (V * (1 - fee))), q = sh * f, amt = q * px[i] * (1 - fee), cost = basis * f; tx.rec(amt - cost); basis -= cost; sh -= q; ssum += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++; tk += amt; list.push({ i, si: i, side: 'S', rule: '세금 납부용 매도', price: px[i], qty: q, amt, gain: amt - cost, tax: 0, cash, sh }) } paid += tk;
      list.push({ i, si: i, side: 'T', rule: '세금 정산(전년도 순이익, 납부)', price: px[i], qty: 0, amt: tk, tax: tk, cash, sh }); }
    const add = (s, r, k, hit) => { const d = r.d != null ? Math.max(1, r.d | 0) : (s ? dS : dB);
      // 매수·매도 지연이 다르면 주문이 뒤늦게 체결돼 최신 신호와 반대 상태가 될 수 있어 정리한다(위 함수와 같은 규칙: 같은 이평선 반대 신호는 취소, 다른 이평선은 장기선 우세).
      let sup = false;
      // r.free(바닥 신호): 다른 규칙과 서로 취소·보류하지 않고 독립적으로 체결됨
      if (hit && sf && !r.free) for (let q = i; q <= i + maxD; q++) (orders[q] || []).forEach(od => {
        if (od.dead || od.free || od.s === s) return;
        if (od.k === k) od.dead = true;
        else if (r.r > 0 && od.n < r.n) od.dead = true;
        else if (r.r > 0 && od.n > r.n) sup = true;
      });
      if (r.r > 0 && hit && i + d < n && !sup) (orders[i + d] = orders[i + d] || []).push({ s, r: r.r, k, n: r.n, free: !!r.free, si: i, label: (s ? '매도' : '매수') + (k + 1) + ' ' + (r.lbl || ((r.n || '') + '일' + (r.a || (s ? '↓' : '↑')))) }); };
    const signals = () => {
      sells.forEach((r, k) => add(true, r, k, r.f[i]));
      buys.forEach((r, k) => { add(false, r, k, r.f[i]); if (bs2[k]) add(false, bs2[k], k, bs2[k].f[i]); });
    };
    if (sf) signals(); // 상태 우선: 오늘 신호로 대기 주문을 먼저 정리한 뒤 체결
    let soldToday = false; // 같은 날 이평 매도가 체결되면 같은 날 바닥 신호 매수는 건너뜀(그날은 매도 우선, 바닥 신호가 이어지면 다음 날 매수)
    (orders[i] || []).sort((a, b) => (a.s ? 0 : 1) - (b.s ? 0 : 1) || a.k - b.k).forEach(od => {
      if (od.dead) return; // 반대 신호로 취소된 주문
      if (!od.s && od.free && soldToday) return;
      if (od.s && !od.free) soldToday = true;
      if (od.s) {
        if (!(sh > 0)) return;
        const q = sh * od.r, amt = q * px[i] * (1 - fee), cost = basis * (q / sh), t = 0;
        tx.rec(amt - cost); basis -= cost; sh -= q; cash += amt; ssum += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++; if (o.log) o.log.push({ j: i, sold: amt, cost, t, p: px[i], q });
        list.push({ i, si: od.si, side: 'S', rule: od.label, price: px[i], qty: q, amt, gain: amt - cost, tax: t, cash, sh });
      } else {
        if (!(cash > 0)) return;
        const amt = cash * od.r; const q = amt * (1 - fee) / px[i]; cash -= amt; sh += q; basis += amt; bsum += amt; fees += amt * fee; trades++;
        list.push({ i, si: od.si, side: 'B', rule: od.label, price: px[i], qty: q, amt, tax: 0, cash, sh });
      }
    });
    if (!sf) signals();
    const v = cash + sh * px[i]; pd.push(paid); eq.push(v); eqL.push(v - tx.pending() - tx.liq(sh * px[i] - basis)); w.push(v ? sh * px[i] / v : 0);
  }
  return { eq, eqL, eqP: eqPay(eq, eqL), pd, taxY: tx.yearTax(), paid, trades, w, list, pnl: { x: ssum - bsum + sh * px[n - 1], y: [], int: intr, tax: paid, fee: fees, unreal: eq[n - 1] - eqL[n - 1] } };
}

if (typeof module !== 'undefined') module.exports = { simulateTargets, bottomFlags, makeTaxer, yearlyPnl, simulateEventsAlt, simulateAlt, interestFactors, yearsOf, statsLite, crossFlags, simulateEvents, ma, series, evalConds, targets, applied, simulate, buyHold, stats };
