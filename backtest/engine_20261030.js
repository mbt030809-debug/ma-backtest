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
function simulate(dates, px, w, o) {
  const n = px.length, cd = Math.pow(1 + (o.cashRate || 0), 1 / 252) - 1, tax = o.taxRate || 0;
  let S = w[0] * 100, C = 100 - S, B = S, paid = 0, trades = 0;
  const eq = [100], list = [];
  if (S > 0) list.push({ i: 0, si: 0, side: 'B', rule: '시작', price: px[0], qty: S / px[0], amt: S, tax: 0, cash: C, sh: S / px[0] });
  for (let j = 1; j < n; j++) {
    const V = S + C, tS = w[j] * V;
    if (tS < S - 1e-9) { // 매도: 실현이익(매도금액-평균단가 원가)에만 세율 적용, 손실이면 0 (통산·공제 없음)
      const sold = S - tS, cost = B * (sold / S), t = Math.max(0, sold - cost) * tax;
      B -= cost; S = tS; C = V - S - t; paid += t; trades++; if (o.log) o.log.push({ j, sold, cost, t, p: px[j - 1] });
      list.push({ i: j - 1, si: Math.max(0, j - 1 - (o.delay || 0)), side: 'S', rule: '매도 조건', price: px[j - 1], qty: sold / px[j - 1], amt: sold, gain: sold - cost, tax: t, cash: C, sh: S / px[j - 1] });
    }
    else if (tS > S + 1e-9) { const add = tS - S; B += add; S = tS; C = V - S; trades++; list.push({ i: j - 1, si: Math.max(0, j - 1 - (o.delay || 0)), side: 'B', rule: '매수 조건', price: px[j - 1], qty: add / px[j - 1], amt: add, tax: 0, cash: C, sh: S / px[j - 1] }); }
    S *= px[j] / px[j - 1]; C *= 1 + cd;
    eq.push(S + C);
  }
  return { eq, paid, trades, list };
}

const buyHold = px => px.map(v => v / px[0] * 100);

function stats(e, dates) {
  const n = e.length, yrs = (new Date(dates[n - 1]) - new Date(dates[0])) / 31557600000;
  const r = e.map((v, i) => i ? v / e[i - 1] - 1 : 0).slice(1);
  const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  let pk = 100, mdd = 0; e.forEach(v => { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); });
  const by = {}; dates.forEach((d, i) => by[d.slice(0, 4)] = i);
  const yr = {}; let pv = 100; Object.keys(by).forEach(y => { yr[y] = e[by[y]] / pv - 1; pv = e[by[y]]; });
  return { tot: e[n - 1] / 100 - 1, cagr: (e[n - 1] / 100) ** (1 / yrs) - 1, mdd, sh: sd ? m / sd * Math.sqrt(252) : 0, yr };
}

// ---- 돌파/이탈 이벤트 방식 (이평선 백테스터 아티팩트와 동일 규칙) ----
// 가격이 이평선을 위로 돌파한 날(up)/아래로 이탈한 날(dn) 신호. 전일 <= 이평 && 당일 > 이평 (이탈은 반대).
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
  const n = e.length; let sum = 0, pk = 100, mdd = 0;
  for (let i = 1; i < n; i++) { sum += e[i] / e[i - 1] - 1; }
  const m = sum / (n - 1); let ss = 0;
  for (let i = 1; i < n; i++) { const d = e[i] / e[i - 1] - 1 - m; ss += d * d; if (e[i] > pk) pk = e[i]; const dd = e[i] / pk - 1; if (dd < mdd) mdd = dd; }
  const sd = Math.sqrt(ss / (n - 2)); // 표본표준편차: 수익률 개수(n-1)에서 1을 뺌 (stats와 동일)
  return { tot: e[n - 1] / 100 - 1, cagr: (e[n - 1] / 100) ** (1 / yrs) - 1, mdd, sh: sd ? m / sd * Math.sqrt(252) : 0 };
}

// buys: [{r:현금 비율, f:bool[](dates 정렬)}], sells: [{r:보유 비율, f}]. o: {delay>=1, init, cashRate, tax, fee}
// 시작일 종가에 init 비율 매수. 신호일 i의 주문은 i+delay 거래일 종가 체결, 같은 날은 매도 먼저(규칙 순서).
// 현금이자는 달력일 기준 365일 복리, 세금은 매도 건별 평균단가 대비 이익에만(손실 0, 통산·공제 없음).
function simulateEvents(dates, px, buys, sells, o) {
  const n = px.length, ig = o.ig || interestFactors(dates, o.cashRate), fee = o.fee || 0, tax = o.tax || 0, delay = Math.max(1, o.delay | 0);
  let cash = 100, sh = 0, basis = 0, paid = 0, trades = 0; const orders = {}, eq = [], w = [];
  const list = [], amt0 = cash * o.init;
  if (amt0 > 0) { cash -= amt0; sh = amt0 * (1 - fee) / px[0]; basis = amt0; trades++; list.push({ i: 0, si: 0, side: 'B', rule: '시작', price: px[0], qty: sh, amt: amt0, tax: 0, cash, sh }); }
  for (let i = 0; i < n; i++) {
    if (i > 0) cash *= ig[i];
    (orders[i] || []).sort((a, b) => (a.s ? 0 : 1) - (b.s ? 0 : 1) || a.k - b.k).forEach(od => {
      if (od.s) {
        if (!(sh > 0)) return;
        const q = sh * od.r, amt = q * px[i] * (1 - fee), cost = basis * (q / sh), t = Math.max(0, amt - cost) * tax;
        basis -= cost; sh -= q; cash += amt - t; paid += t; trades++; if (o.log) o.log.push({ j: i, sold: amt, cost, t, p: px[i], q });
        list.push({ i, si: od.si, side: 'S', rule: od.label, price: px[i], qty: q, amt, gain: amt - cost, tax: t, cash, sh });
      } else {
        if (!(cash > 0)) return;
        const amt = cash * od.r; const q = amt * (1 - fee) / px[i]; cash -= amt; sh += q; basis += amt; trades++;
        list.push({ i, si: od.si, side: 'B', rule: od.label, price: px[i], qty: q, amt, tax: 0, cash, sh });
      }
    });
    const add = (s, r, k, hit) => { if (r.r > 0 && hit && i + delay < n) (orders[i + delay] = orders[i + delay] || []).push({ s, r: r.r, k, si: i, label: (s ? '매도' : '매수') + (k + 1) + ' ' + (r.n || '') + '일' + (s ? '↓' : '↑') }); };
    sells.forEach((r, k) => add(true, r, k, r.f[i]));
    buys.forEach((r, k) => add(false, r, k, r.f[i]));
    const v = cash + sh * px[i]; eq.push(v); w.push(v ? sh * px[i] / v : 0);
  }
  return { eq, paid, trades, w, list };
}

if (typeof module !== 'undefined') module.exports = { interestFactors, yearsOf, statsLite, crossFlags, simulateEvents, ma, series, evalConds, targets, applied, simulate, buyHold, stats };
