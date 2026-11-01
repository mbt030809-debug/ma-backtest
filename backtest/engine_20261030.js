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
  let yr = null, net = 0; const liab = [];
  return {
    step(i) { const y = dates[i].slice(0, 4);
      if (yr === null) yr = y; else if (y !== yr) { liab.push({ due: (+yr + 1) + '-05-01', amt: Math.max(0, net) * rate }); net = 0; yr = y; }
      let due = 0; while (liab.length && liab[0].due <= dates[i]) due += liab.shift().amt; return due; },
    rec(g) { net += g; },
    pending() { let t = 0; for (const l of liab) t += l.amt; return t; },
    liq(unreal) { return rate * Math.max(0, net + unreal); }
  };
}

function simulate(dates, px, w, o) {
  const n = px.length, cd = Math.pow(1 + (o.cashRate || 0), 1 / 252) - 1, tax = o.taxRate || 0;
  const tx = makeTaxer(dates, tax);
  let S = w[0] * 100, C = 100 - S, B = S, paid = 0, trades = 0, bsum = S, ssum = 0, intr = 0;
  const eq = [100], eqL = [100], list = [];
  tx.step(0);
  if (S > 0) list.push({ i: 0, si: 0, side: 'B', rule: '시작', price: px[0], qty: S / px[0], amt: S, tax: 0, cash: C, sh: S / px[0] });
  for (let j = 1; j < n; j++) {
    const due = tx.step(j);
    if (due > 0) { let rem = due, c = Math.min(C, rem); C -= c; rem -= c; let tk = c; if (rem > 0 && S > 0) { const f = Math.min(1, rem / S), v = S * f; ssum += v; B *= 1 - f; S -= v; tk += v } paid += tk;
      list.push({ i: j - 1, si: j - 1, side: 'T', rule: '세금 정산(전년도 순이익)', price: px[j - 1], qty: 0, amt: tk, tax: tk, cash: C, sh: S / px[j - 1] }); }
    const V = S + C, tS = w[j] * V;
    if (tS < S - 1e-9) { // 매도: 실현손익은 연도별로 합산해 다음 해 5/1에 정산(세금은 여기서 내지 않음)
      const sold = S - tS, cost = B * (sold / S);
      tx.rec(sold - cost); B -= cost; S = tS; C = V - S; ssum += sold; trades++; if (o.log) o.log.push({ j, sold, cost, t: 0, p: px[j - 1] });
      list.push({ i: j - 1, si: Math.max(0, j - 1 - (o.delay || 0)), side: 'S', rule: '매도 조건', price: px[j - 1], qty: sold / px[j - 1], amt: sold, gain: sold - cost, tax: 0, cash: C, sh: S / px[j - 1] });
    }
    else if (tS > S + 1e-9) { const add = tS - S; B += add; bsum += add; S = tS; C = V - S; trades++; list.push({ i: j - 1, si: Math.max(0, j - 1 - (o.delay || 0)), side: 'B', rule: '매수 조건', price: px[j - 1], qty: add / px[j - 1], amt: add, tax: 0, cash: C, sh: S / px[j - 1] }); }
    S *= px[j] / px[j - 1]; intr += C * cd; C *= 1 + cd;
    eq.push(S + C); eqL.push(S + C - tx.pending() - tx.liq(S - B)); // eqL: 지금 전부 청산한다고 가정한 세후 가치(미납 세금 + 올해 순이익·미실현 이익에 즉시 과세)
  }
  return { eq, eqL, paid, trades, list, pnl: { x: ssum - bsum + S, y: [], int: intr, tax: paid, fee: 0, unreal: eq[n - 1] - eqL[n - 1] } };
}


// ---- 방어자산(현금 대신 보유할 ETF) 버전 ----
// 매도하면 그 대금으로 방어자산(Y)을 사고, 매수하면 방어자산(Y)을 팔아 X를 삼. 두 쪽 모두 이익에는 세율 적용(손실 0, 건별).
// py: 방어자산 가격(배당 포함 수정종가). 여러 개면 [[...],[...]]로 주고 동일 비중 바구니로 보유(각 자산을 따로 사고팔며 따로 과세).
// 매수 규칙의 r은 "방어자산 평가금액의 r%".
function simulateEventsAlt(dates, px, py, buys, sells, o) {
  const ys = Array.isArray(py[0]) ? py : [py], K = ys.length;
  const n = px.length, ig = o.ig || interestFactors(dates, o.cashRate), fee = o.fee || 0, tax = o.tax || 0, delay = Math.max(1, o.delay | 0);
  const tx = makeTaxer(dates, tax);
  let cash = 0, sh = 0, basis = 0, paid = 0, trades = 0, bX = 0, sX = 0, intr = 0, fees = 0;
  const shy = Array(K).fill(0), basy = Array(K).fill(0), bY = Array(K).fill(0), sY = Array(K).fill(0), orders = {}, eq = [], eqL = [], w = [], list = [];
  const a0 = 100 * o.init, y0 = 100 - a0;
  if (a0 > 0) { sh = a0 * (1 - fee) / px[0]; basis = a0; bX += a0; fees += a0 * fee; trades++; list.push({ i: 0, si: 0, side: 'B', asset: 'X', rule: '시작', price: px[0], qty: sh, amt: a0, tax: 0, cash, sh }); }
  if (y0 > 0) for (let k = 0; k < K; k++) { const a = y0 / K; shy[k] = a * (1 - fee) / ys[k][0]; basy[k] = a; bY[k] += a; fees += a * fee; trades++; list.push({ i: 0, si: 0, side: 'B', asset: 'Y', yi: k, rule: '시작(방어자산)', price: ys[k][0], qty: shy[k], amt: a, tax: 0, cash, sh: shy[k] }); }
  for (let i = 0; i < n; i++) {
    if (i > 0) { const c0 = cash; cash *= ig[i]; intr += cash - c0; }
    const due = tx.step(i);
    if (due > 0) { let rem = due, c = Math.min(cash, rem); cash -= c; rem -= c; let tk = c;
      if (rem > 0) { let V = sh * px[i]; for (let k = 0; k < K; k++) V += shy[k] * ys[k][i];
        if (V > 0) { const f = Math.min(1, rem / V); sX += sh * px[i] * f; basis *= 1 - f; sh *= 1 - f; for (let k = 0; k < K; k++) { sY[k] += shy[k] * ys[k][i] * f; basy[k] *= 1 - f; shy[k] *= 1 - f } tk += V * f } }
      paid += tk; list.push({ i, si: i, side: 'T', rule: '세금 정산(전년도 순이익)', price: px[i], qty: 0, amt: tk, tax: tk, cash, sh }); }
    (orders[i] || []).sort((a, b) => (a.s ? 0 : 1) - (b.s ? 0 : 1) || a.k - b.k).forEach(od => {
      if (od.s) { // X 매도 → 방어자산(들) 매수
        if (!(sh > 0)) return;
        const q = sh * od.r, amt = q * px[i] * (1 - fee), cost = basis * (q / sh), t = 0;
        tx.rec(amt - cost); basis -= cost; sh -= q; sX += amt; fees += fee < 1 ? amt / (1 - fee) * fee : 0; trades++;
        list.push({ i, si: od.si, side: 'S', asset: 'X', rule: od.label, price: px[i], qty: q, amt, gain: amt - cost, tax: t, cash, sh });
        const net = amt;
        for (let k = 0; k < K; k++) { const a = net / K, qy = a * (1 - fee) / ys[k][i]; shy[k] += qy; basy[k] += a; bY[k] += a; fees += a * fee; trades++;
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
    const add = (s, r, k, hit) => { if (r.r > 0 && hit && i + delay < n) (orders[i + delay] = orders[i + delay] || []).push({ s, r: r.r, k, si: i, label: (s ? '매도' : '매수') + (k + 1) + ' ' + (r.n || '') + '일' + (s ? '↓' : '↑') }); };
    sells.forEach((r, k) => add(true, r, k, r.f[i]));
    buys.forEach((r, k) => add(false, r, k, r.f[i]));
    const vx = sh * px[i]; let vy = 0, ut = 0; for (let k = 0; k < K; k++) { const v = shy[k] * ys[k][i]; vy += v; ut += v - basy[k]; }
    const v = cash + vx + vy; eq.push(v); eqL.push(v - tx.pending() - tx.liq(vx - basis + ut)); w.push(v ? vx / v : 0);
  }
  return { eq, eqL, paid, trades, w, list, pnl: { x: sX - bX + sh * px[n - 1], y: shy.map((q, k) => sY[k] - bY[k] + q * ys[k][n - 1]), int: intr, tax: paid, fee: fees, unreal: eq[n - 1] - eqL[n - 1] } };
}
// 상태 유지 방식(목표 비중 w[j])의 방어자산 버전: X 비중 w, 나머지는 방어자산(들)
function simulateAlt(dates, px, py, w, o) {
  const ys = Array.isArray(py[0]) ? py : [py], K = ys.length;
  const n = px.length, cd = Math.pow(1 + (o.cashRate || 0), 1 / 252) - 1, tax = o.taxRate || 0;
  const tx = makeTaxer(dates, tax);
  let X = w[0] * 100, bX = X, C = 0, paid = 0, trades = 0, bXs = X, sXs = 0, intr = 0; tx.step(0);
  const Y = Array(K).fill((100 - X) / K), bY = Y.slice(), bYs = Y.slice(), sYs = Array(K).fill(0), eq = [100], eqL = [100], list = [];
  if (X > 0) list.push({ i: 0, si: 0, side: 'B', asset: 'X', rule: '시작', price: px[0], qty: X / px[0], amt: X, tax: 0, cash: C, sh: X / px[0] });
  if (100 - X > 0) for (let k = 0; k < K; k++) list.push({ i: 0, si: 0, side: 'B', asset: 'Y', yi: k, rule: '시작(방어자산)', price: ys[k][0], qty: Y[k] / ys[k][0], amt: Y[k], tax: 0, cash: C, sh: Y[k] / ys[k][0] });
  for (let j = 1; j < n; j++) {
    const due = tx.step(j);
    if (due > 0) { let rem = due, c = Math.min(C, rem); C -= c; rem -= c; let tk = c; const V0 = X + Y.reduce((a, b) => a + b, 0);
      if (rem > 0 && V0 > 0) { const f = Math.min(1, rem / V0); sXs += X * f; bX *= 1 - f; X *= 1 - f; for (let k = 0; k < K; k++) { sYs[k] += Y[k] * f; bY[k] *= 1 - f; Y[k] *= 1 - f } tk += V0 * f }
      paid += tk; list.push({ i: j - 1, si: j - 1, side: 'T', rule: '세금 정산(전년도 순이익)', price: px[j - 1], qty: 0, amt: tk, tax: tk, cash: C, sh: X / px[j - 1] }); }
    const sy = Y.reduce((a, b) => a + b, 0), V = X + sy + C, tX = w[j] * V, si = Math.max(0, j - 1 - (o.delay || 0));
    if (tX < X - 1e-9) { // X 일부 매도 → 방어자산(들) 매수
      const sold = X - tX, cost = bX * (sold / X), t = 0;
      tx.rec(sold - cost); bX -= cost; X = tX; sXs += sold; trades++;
      list.push({ i: j - 1, si, side: 'S', asset: 'X', rule: '매도 조건', price: px[j - 1], qty: sold / px[j - 1], amt: sold, gain: sold - cost, tax: t, cash: C, sh: X / px[j - 1] });
      for (let k = 0; k < K; k++) { const a = (sold - t) / K; Y[k] += a; bY[k] += a; bYs[k] += a; trades++;
        list.push({ i: j - 1, si, side: 'B', asset: 'Y', yi: k, rule: '매도 대금', price: ys[k][j - 1], qty: a / ys[k][j - 1], amt: a, tax: 0, cash: C, sh: Y[k] / ys[k][j - 1] }); }
    } else if (tX > X + 1e-9) { // 방어자산(들) 일부 매도 → X 매수
      const need = Math.min(tX - X, sy + C), fromY = Math.min(need, sy), fromC = need - fromY; let net = fromC;
      if (fromY > 0) { const frac = fromY / sy; for (let k = 0; k < K; k++) { const f = Y[k] * frac, costY = bY[k] * frac, tY = 0; tx.rec(f - costY); bY[k] -= costY; Y[k] -= f; sYs[k] += f; net += f - tY; trades++;
        list.push({ i: j - 1, si, side: 'S', asset: 'Y', yi: k, rule: '매수 자금', price: ys[k][j - 1], qty: f / ys[k][j - 1], amt: f, gain: f - costY, tax: tY, cash: C, sh: Y[k] / ys[k][j - 1] }); } }
      C -= fromC; X += net; bX += net; bXs += net; trades++;
      list.push({ i: j - 1, si, side: 'B', asset: 'X', rule: '매수 조건', price: px[j - 1], qty: net / px[j - 1], amt: net, tax: 0, cash: C, sh: X / px[j - 1] });
    }
    X *= px[j] / px[j - 1]; for (let k = 0; k < K; k++) Y[k] *= ys[k][j] / ys[k][j - 1]; intr += C * cd; C *= 1 + cd;
    let ut = 0, sY = 0; for (let k = 0; k < K; k++) { sY += Y[k]; ut += Y[k] - bY[k]; }
    eq.push(X + sY + C); eqL.push(X + sY + C - tx.pending() - tx.liq(X - bX + ut));
  }
  return { eq, eqL, paid, trades, list, pnl: { x: sXs - bXs + X, y: Y.map((v, k) => sYs[k] - bYs[k] + v), int: intr, tax: paid, fee: 0, unreal: eq[n - 1] - eqL[n - 1] } };
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
  const n = px.length, ig = o.ig || interestFactors(dates, o.cashRate), fee = o.fee || 0, tax = o.tax || 0, delay = Math.max(1, o.delay | 0);
  const tx = makeTaxer(dates, tax);
  let cash = 100, sh = 0, basis = 0, paid = 0, trades = 0, bsum = 0, ssum = 0, intr = 0, fees = 0; const orders = {}, eq = [], eqL = [], w = [];
  const list = [], amt0 = cash * o.init;
  if (amt0 > 0) { cash -= amt0; sh = amt0 * (1 - fee) / px[0]; basis = amt0; bsum += amt0; fees += amt0 * fee; trades++; list.push({ i: 0, si: 0, side: 'B', rule: '시작', price: px[0], qty: sh, amt: amt0, tax: 0, cash, sh }); }
  for (let i = 0; i < n; i++) {
    if (i > 0) { const c0 = cash; cash *= ig[i]; intr += cash - c0; }
    const due = tx.step(i);
    if (due > 0) { let rem = due, c = Math.min(cash, rem); cash -= c; rem -= c; let tk = c; const V = sh * px[i]; if (rem > 0 && V > 0) { const f = Math.min(1, rem / V); ssum += V * f; basis *= 1 - f; sh *= 1 - f; tk += V * f } paid += tk;
      list.push({ i, si: i, side: 'T', rule: '세금 정산(전년도 순이익)', price: px[i], qty: 0, amt: tk, tax: tk, cash, sh }); }
    (orders[i] || []).sort((a, b) => (a.s ? 0 : 1) - (b.s ? 0 : 1) || a.k - b.k).forEach(od => {
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
    const add = (s, r, k, hit) => { if (r.r > 0 && hit && i + delay < n) (orders[i + delay] = orders[i + delay] || []).push({ s, r: r.r, k, si: i, label: (s ? '매도' : '매수') + (k + 1) + ' ' + (r.n || '') + '일' + (s ? '↓' : '↑') }); };
    sells.forEach((r, k) => add(true, r, k, r.f[i]));
    buys.forEach((r, k) => add(false, r, k, r.f[i]));
    const v = cash + sh * px[i]; eq.push(v); eqL.push(v - tx.pending() - tx.liq(sh * px[i] - basis)); w.push(v ? sh * px[i] / v : 0);
  }
  return { eq, eqL, paid, trades, w, list, pnl: { x: ssum - bsum + sh * px[n - 1], y: [], int: intr, tax: paid, fee: fees, unreal: eq[n - 1] - eqL[n - 1] } };
}

if (typeof module !== 'undefined') module.exports = { simulateEventsAlt, simulateAlt, interestFactors, yearsOf, statsLite, crossFlags, simulateEvents, ma, series, evalConds, targets, applied, simulate, buyHold, stats };
