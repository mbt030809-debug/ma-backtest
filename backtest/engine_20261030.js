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
// cashRate: 연 현금이자(소수), taxRate: 양도차익 세율(소수, 연 단위 손익통산 후 해당 연도 마지막 거래일에 납부)
function simulate(dates, px, w, o) {
  const n = px.length, cd = Math.pow(1 + (o.cashRate || 0), 1 / 252) - 1, tax = o.taxRate || 0;
  let S = w[0] * 100, C = 100 - S, B = S, yg = 0, paid = 0, trades = 0;
  const eq = [100];
  for (let j = 1; j < n; j++) {
    const V = S + C, tS = w[j] * V;
    if (tS < S - 1e-9) { const sold = S - tS, g = sold - B * (sold / S); B -= B * (sold / S); yg += g; S = tS; C = V - S; trades++; }
    else if (tS > S + 1e-9) { B += tS - S; S = tS; C = V - S; trades++; }
    S *= px[j] / px[j - 1]; C *= 1 + cd;
    if (j == n - 1 || dates[j].slice(0, 4) != dates[j + 1].slice(0, 4)) {
      if (yg > 0 && tax > 0) { const t = Math.min(yg * tax, S + C), f = 1 - t / (S + C); S *= f; C *= f; B *= f; paid += t; }
      yg = 0;
    }
    eq.push(S + C);
  }
  return { eq, paid, trades };
}

const buyHold = px => px.map(v => v / px[0] * 100);

function stats(e, dates) {
  const n = e.length, yrs = (new Date(dates[n - 1]) - new Date(dates[0])) / 31557600000;
  const r = e.map((v, i) => i ? v / e[i - 1] - 1 : 0).slice(1);
  const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  let pk = e[0], mdd = 0; e.forEach(v => { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); });
  const by = {}; dates.forEach((d, i) => by[d.slice(0, 4)] = i);
  const yr = {}; let prev = 0; Object.keys(by).forEach(y => { yr[y] = e[by[y]] / e[prev] - 1; prev = by[y]; });
  return { tot: e[n - 1] / e[0] - 1, cagr: (e[n - 1] / e[0]) ** (1 / yrs) - 1, mdd, sh: sd ? m / sd * Math.sqrt(252) : 0, yr };
}

if (typeof module !== 'undefined') module.exports = { ma, series, evalConds, targets, applied, simulate, buyHold, stats };
