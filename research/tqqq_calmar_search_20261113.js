// TQQQ 매매법 100개 백테스트 → 칼마(CAGR ÷ |MDD|) 순위
// 사용: node research/tqqq_calmar_search_20261113.js            (Yahoo에서 시세 받기)
//       node research/tqqq_calmar_search_20261113.js --data prices.json   (저장된 시세 사용)
//       node research/tqqq_calmar_search_20261113.js --mock               (가짜 시세로 코드 점검만)
// 규칙: 종가 신호 → 다음 거래일 종가 체결(지연 1일), 수수료 0.08%, 양도세 22%(연 1회 정산·다음해 5/1 납부·마지막 날 전량 매도 가정),
//       현금 이자 0%(보수적). 앱 엔진(backtest/engine_20261030.js)의 세금 규칙을 그대로 사용.
const fs = require('fs'), path = require('path');
const E = require(path.join(__dirname, '../backtest/engine_20261030.js'));
const ARGS = process.argv.slice(2), arg = k => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : null; };
const START = arg('--start') || '2012-01-03', FEE0 = +(arg('--fee') ?? 0.0008), TAX0 = +(arg('--tax') ?? 0.22), CASH0 = +(arg('--cash') ?? 0), FEE = FEE0, TAX = TAX0, CASH = CASH0;
const SYMS = ['TQQQ', 'QQQ', '^VIX', 'TLT', 'GLD', 'IEF', 'SHY'];

// ---------- 시세 ----------
async function yahoo(sym) {
  const p1 = Math.floor(Date.parse('2009-01-01') / 1000), p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits`;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw Error('HTTP ' + r.status);
      const j = (await r.json()).chart.result[0], ts = j.timestamp, q = j.indicators;
      const adj = q.adjclose ? q.adjclose[0].adjclose : q.quote[0].close, hi = q.quote[0].high, lo = q.quote[0].low;
      const rows = [];
      for (let i = 0; i < ts.length; i++) if (adj[i] != null) rows.push([new Date(ts[i] * 1000).toISOString().slice(0, 10), adj[i], hi[i] ?? adj[i], lo[i] ?? adj[i]]);
      return rows;
    } catch (e) { if (t === 3) throw Error(sym + ': ' + e.message); await new Promise(r => setTimeout(r, 1500 * (t + 1))); }
  }
}
function mock() { // 코드 점검용 가짜 시세 (결과를 보고하지 않음)
  let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const out = {}, dates = []; let d = new Date('2009-01-02');
  while (dates.length < 4600) { if (d.getUTCDay() % 6) dates.push(d.toISOString().slice(0, 10)); d = new Date(+d + 864e5); }
  let q = 100, v = 20; const qq = [], vx = [], tq = [], o = [[], [], [], []]; let t = 100, b = [100, 100, 100, 100];
  for (let i = 0; i < dates.length; i++) { const r = (rnd() - .5) * .03 + .0005; q *= 1 + r; t *= 1 + 3 * r - .0001; v = Math.max(10, v * .97 + (rnd() * 3) + (r < 0 ? 2 : 0)); qq.push(q); tq.push(t); vx.push(v); for (let k = 0; k < 4; k++) { b[k] *= 1 + (rnd() - .5) * .01 + .0001; o[k].push(b[k]); } }
  const mk = a => dates.map((x, i) => [x, a[i], a[i] * 1.01, a[i] * .99]);
  out.TQQQ = mk(tq); out.QQQ = mk(qq); out['^VIX'] = mk(vx); ['TLT', 'GLD', 'IEF', 'SHY'].forEach((k, i) => out[k] = mk(o[i]));
  return out;
}

// ---------- 지표 ----------
const sma = (a, n) => { const o = Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const ema = (a, n) => { const o = Array(a.length).fill(NaN), k = 2 / (n + 1); let p = NaN; for (let i = 0; i < a.length; i++) { if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += a[j]; p = s / n; } else if (i >= n) p = a[i] * k + p * (1 - k); if (i >= n - 1) o[i] = p; } return o; };
const roc = (a, n) => a.map((v, i) => i >= n ? v / a[i - n] - 1 : NaN);
const vol = (a, n) => { const r = a.map((v, i) => i ? Math.log(v / a[i - 1]) : 0), o = Array(a.length).fill(NaN); for (let i = n; i < a.length; i++) { let m = 0, s = 0; for (let j = i - n + 1; j <= i; j++) m += r[j]; m /= n; for (let j = i - n + 1; j <= i; j++) s += (r[j] - m) ** 2; o[i] = Math.sqrt(s / (n - 1) * 252); } return o; };
const rmax = (a, n) => a.map((_, i) => i >= n - 1 ? Math.max(...a.slice(i - n + 1, i + 1)) : NaN);
const rmin = (a, n) => a.map((_, i) => i >= n - 1 ? Math.min(...a.slice(i - n + 1, i + 1)) : NaN);
const rsi = (a, n) => { const o = Array(a.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; };
const fin = Number.isFinite;
// 상태 기계: enter(i)면 1, exit(i)면 0, 아니면 직전 유지
const latch = (n, enter, exit, init = 0) => { const w = Array(n).fill(init); let s = init; for (let i = 0; i < n; i++) { if (exit(i)) s = 0; else if (enter(i)) s = 1; w[i] = s; } return w; };

// ---------- 가중치 시뮬레이터 (앱 세금 규칙 동일, 수수료·방어자산 지원) ----------
// w[t] = 종가 t에서 정한 TQQQ 목표 비중 → t+1 종가에 체결. 나머지는 현금 또는 방어자산 py.
function simW(D, w, py, band = 0.02, opt = {}) {
  const FEE = opt.fee ?? FEE0, TAX = opt.tax ?? TAX0, CASH = opt.cash ?? CASH0;
  const { dates, px, s0 } = D, n = dates.length, tx = E.makeTaxer(dates, TAX);
  let cash = 100, sx = 0, bx = 0, sy = 0, by = 0, trades = 0; const eq = [], eqL = [];
  const sell = (isY, frac, i) => { if (frac <= 0) return 0; const p = isY ? py[i] : px[i], sh = isY ? sy : sx, b = isY ? by : bx; const q = sh * Math.min(1, frac), amt = q * p * (1 - FEE), cost = b * Math.min(1, frac); tx.rec(amt - cost); if (isY) { sy -= q; by -= cost; } else { sx -= q; bx -= cost; } trades++; return amt; };
  const buy = (isY, amt, i) => { if (amt <= 1e-9) return; const p = isY ? py[i] : px[i], q = amt * (1 - FEE) / p; if (isY) { sy += q; by += amt; } else { sx += q; bx += amt; } cash -= amt; trades++; };
  for (let i = s0; i < n; i++) {
    if (i > s0 && CASH) cash *= Math.pow(1 + CASH, (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 864e5 / 365);
    const due = tx.step(i);
    if (due > 0) { let rem = due, c = Math.min(cash, rem); cash -= c; rem -= c; if (rem > 0) { const V = sx * px[i] + (py ? sy * py[i] : 0); if (V > 0) { const f = rem / (V * (1 - FEE)); cash += sell(false, f, i); if (py) cash += sell(true, f, i); const c2 = Math.min(cash, rem); cash -= c2; } } }
    const raw = w[i - 1]; // NaN = 그날은 리밸런싱 안 함(월초 리밸런싱 전략)
    const tgt = fin(raw) ? Math.min(1, Math.max(0, raw)) : NaN, V = cash + sx * px[i] + (py ? sy * py[i] : 0), cur = V > 0 ? sx * px[i] / V : 0;
    const need = (tgt === 0 || tgt === 1) ? Math.abs(cur - tgt) > 1e-9 : Math.abs(cur - tgt) > band;
    if (need && fin(tgt)) {
      if (tgt < cur) { cash += sell(false, (cur - tgt) * V / (sx * px[i]), i); if (py) buy(true, cash, i); }
      else { let want = (tgt - cur) * V; if (cash < want && py && sy > 0) cash += sell(true, Math.min(1, (want - cash) / (sy * py[i] * (1 - FEE))), i); buy(false, Math.min(cash, want), i); if (py && cash > 1e-9 && tgt < 1) buy(true, cash, i); }
    }
    if (py && cash > 1e-9 && fin(py[i])) buy(true, cash, i); // 남는 현금은 방어자산으로
    const vx = sx * px[i], vy = py ? sy * py[i] : 0, v = cash + vx + vy; eq.push(v); eqL.push(v - tx.pending() - tx.liq(vx - bx + vy - by));
  }
  const e = eq.slice(); e[e.length - 1] = eqL[eqL.length - 1];
  return { e, trades };
}
function metrics(e, dts) {
  let pk = e[0], mdd = 0; for (const v of e) { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); }
  const yrs = (Date.parse(dts[dts.length - 1]) - Date.parse(dts[0])) / 864e5 / 365.25, cagr = Math.pow(e[e.length - 1] / e[0], 1 / yrs) - 1;
  const r = e.slice(1).map((v, i) => v / e[i] - 1), m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
  return { cagr, mdd, calmar: mdd < 0 ? cagr / -mdd : 0, sharpe: sd ? m / sd * Math.sqrt(252) : 0, tot: e[e.length - 1] / e[0] - 1 };
}

// ---------- 100개 전략 ----------
function strategies(D) {
  const n = D.dates.length, Q = D.c.QQQ, T = D.px, VX = D.c['^VIX'], L = [];
  const add = (fam, name, f) => L.push({ fam, name, f });
  const W = fn => () => ({ w: Array.from({ length: n }, (_, i) => { const v = fn(i); return fin(v) ? v : 0; }) });
  const sQ = {}, eQ = {}, sT = {}; const SQ = k => sQ[k] || (sQ[k] = sma(Q, k)), EQ = k => eQ[k] || (eQ[k] = ema(Q, k)), ST = k => sT[k] || (sT[k] = sma(T, k));
  const vQ20 = vol(Q, 20), vT20 = vol(T, 20), vT60 = vol(T, 60), r = k => roc(Q, k);
  add('기준', 'TQQQ 계속 보유', W(() => 1));
  for (const k of [50, 100, 150, 200, 250]) add('TQQQ 이평', `TQQQ > ${k}일선이면 보유`, W(i => T[i] > ST(k)[i] ? 1 : 0));
  for (const k of [50, 100, 150, 200, 250, 300]) add('QQQ 이평', `QQQ > ${k}일선이면 보유`, W(i => Q[i] > SQ(k)[i] ? 1 : 0));
  for (const k of [50, 100, 150, 200]) add('QQQ EMA', `QQQ > EMA${k}이면 보유`, W(i => Q[i] > EQ(k)[i] ? 1 : 0));
  for (const [a, b] of [[10, 50], [20, 100], [50, 150], [50, 200], [100, 200], [100, 300]]) add('이평 교차', `QQQ ${a}일선 > ${b}일선이면 보유`, W(i => SQ(a)[i] > SQ(b)[i] ? 1 : 0));
  for (const [k, x] of [[200, 1], [200, 2], [200, 3], [200, 5], [150, 2]]) add('이평 밴드', `QQQ ${k}일선 +${x}% 위 진입 / -${x}% 아래 이탈`, () => ({ w: latch(n, i => Q[i] > SQ(k)[i] * (1 + x / 100), i => Q[i] < SQ(k)[i] * (1 - x / 100)) }));
  for (const k of [21, 63, 126, 189, 252]) add('모멘텀', `QQQ ${k}일 수익률 > 0이면 보유`, W(i => r(k)[i] > 0 ? 1 : 0));
  { const m = [21, 63, 126, 252].map(k => roc(Q, k)); add('모멘텀', 'QQQ 1·3·6·12개월 중 플러스 개수/4 비중', W(i => m.filter(a => a[i] > 0).length / 4)); add('모멘텀', 'QQQ 1·3·6·12개월 중 3개 이상 플러스면 보유', W(i => m.filter(a => a[i] > 0).length >= 3 ? 1 : 0)); }
  for (const t of [20, 30, 40, 50, 60]) add('변동성 목표', `TQQQ 변동성 목표 ${t}% (20일)`, () => ({ w: vT20.map(v => fin(v) ? Math.min(1, t / 100 / v) : 0), band: .05 }));
  for (const t of [30, 50]) add('변동성 목표', `TQQQ 변동성 목표 ${t}% (60일)`, () => ({ w: vT60.map(v => fin(v) ? Math.min(1, t / 100 / v) : 0), band: .05 }));
  for (const t of [15, 20, 25, 30]) add('변동성 필터', `QQQ 20일 변동성 < ${t}%면 보유`, W(i => vQ20[i] < t / 100 ? 1 : 0));
  add('추세+변동성', 'QQQ > 200일선 & 변동성 < 25%', W(i => Q[i] > SQ(200)[i] && vQ20[i] < .25 ? 1 : 0));
  add('추세+변동성', 'QQQ > 200일선이면 변동성 목표 40%', () => ({ w: vT20.map((v, i) => Q[i] > SQ(200)[i] && fin(v) ? Math.min(1, .4 / v) : 0), band: .05 }));
  add('추세+변동성', 'QQQ > 150일선 & 변동성 < 30%', W(i => Q[i] > SQ(150)[i] && vQ20[i] < .30 ? 1 : 0));
  for (const t of [18, 20, 25, 30]) add('VIX', `VIX < ${t}이면 보유`, W(i => VX[i] < t ? 1 : 0));
  add('VIX', 'VIX < 25 & QQQ > 200일선', W(i => VX[i] < 25 && Q[i] > SQ(200)[i] ? 1 : 0));
  { const r2 = rsi(Q, 2), r14 = rsi(Q, 14);
    add('RSI', 'QQQ RSI(2) < 10 매수 / > 70 매도', () => ({ w: latch(n, i => r2[i] < 10, i => r2[i] > 70) }));
    add('RSI', 'QQQ RSI(2) < 10 매수 / > 70 매도 (200일선 위에서만)', () => ({ w: latch(n, i => r2[i] < 10 && Q[i] > SQ(200)[i], i => r2[i] > 70 || Q[i] < SQ(200)[i]) }));
    add('RSI', 'QQQ RSI(14) > 50이면 보유', W(i => r14[i] > 50 ? 1 : 0));
    add('RSI', 'QQQ RSI(14) 55 넘으면 매수 / 45 밑이면 매도', () => ({ w: latch(n, i => r14[i] > 55, i => r14[i] < 45) })); }
  for (const [a, b] of [[20, 10], [50, 25], [100, 50], [200, 100]]) { const hi = rmax(Q, a), lo = rmin(Q, b); add('돈치안', `QQQ ${a}일 신고가 매수 / ${b}일 신저가 매도`, () => ({ w: latch(n, i => i > 0 && Q[i] >= hi[i - 1], i => i > 0 && Q[i] <= lo[i - 1]) })); }
  { const m = ema(Q, 12).map((v, i) => v - ema(Q, 26)[i]), sg = ema(m.map(v => fin(v) ? v : 0), 9);
    add('MACD', 'QQQ MACD > 시그널이면 보유', W(i => m[i] > sg[i] ? 1 : 0)); add('MACD', 'QQQ MACD > 0이면 보유', W(i => m[i] > 0 ? 1 : 0));
    add('MACD', 'QQQ MACD > 시그널 & 200일선 위', W(i => m[i] > sg[i] && Q[i] > SQ(200)[i] ? 1 : 0)); }
  { const h = rmax(Q, 252); for (const x of [5, 10, 15, 20]) add('52주 고점', `QQQ가 52주 고점 대비 -${x}% 이내면 보유`, W(i => Q[i] >= h[i] * (1 - x / 100) ? 1 : 0)); }
  for (const x of [25, 50]) add('부분 비중', `QQQ 200일선 위 100% / 아래 ${x}%`, W(i => fin(SQ(200)[i]) ? (Q[i] > SQ(200)[i] ? 1 : x / 100) : 0));
  add('부분 비중', 'QQQ 50·200일선 둘 다 위 100% / 하나 50% / 둘 다 아래 0%', W(i => ((Q[i] > SQ(50)[i]) + (Q[i] > SQ(200)[i])) / 2));
  for (const x of [30, 50, 70]) { add('고정 비중', `TQQQ ${x}% + 현금 (월초 리밸런싱)`, () => ({ w: Array(n).fill(x / 100), band: 0, monthly: true })); }
  { const winter = i => { const m = +D.dates[i].slice(5, 7); return m >= 11 || m <= 4; };
    add('계절성', '11~4월만 보유', W(i => winter(i) ? 1 : 0)); add('계절성', '11~4월 & QQQ 200일선 위', W(i => winter(i) && Q[i] > SQ(200)[i] ? 1 : 0)); }
  for (const x of [20, 30, 40]) add('손절', `TQQQ 고점 대비 -${x}%면 매도 · QQQ 200일선 위에서 재진입`, () => { const w = Array(n).fill(0); let s = 1, pk = 0; for (let i = 0; i < n; i++) { if (s) { pk = Math.max(pk, T[i]); if (T[i] <= pk * (1 - x / 100)) s = 0; } else if (Q[i] > SQ(200)[i]) { s = 1; pk = T[i]; } w[i] = s; } return { w }; });
  for (const y of ['TLT', 'GLD', 'IEF', 'SHY']) add('방어자산', `QQQ 200일선 위 TQQQ / 아래 ${y}`, () => ({ w: Q.map((v, i) => v > SQ(200)[i] ? 1 : 0), py: D.c[y] }));
  add('방어자산', 'TQQQ 변동성 목표 40% + 나머지 GLD', () => ({ w: vT20.map(v => fin(v) ? Math.min(1, .4 / v) : 0), py: D.c.GLD, band: .05 }));
  // 앱 규칙(돌파/이탈 이벤트, 엔진 그대로)
  const ev = (rules) => () => ({ events: rules });
  for (const k of [100, 137, 150, 200]) add('앱 규칙', `QQQ ${k}일선 돌파 매수 / 이탈 매도`, ev([[k, 'up', 1, 1]]));
  add('앱 규칙', 'QQQ 137 돌파/이탈 + 512 상향 매수', ev([[137, 'up', 1, 1], [512, 'up', 1, 0]]));
  add('앱 규칙', 'QQQ 152 돌파/이탈 + 451 상향 매수', ev([[152, 'up', 1, 1], [451, 'up', 1, 0]]));
  add('앱 규칙', 'QQQ 184 돌파/이탈 + 450 하향 매수', ev([[184, 'up', 1, 1], [450, 'dn', 1, 0]]));
  add('앱 규칙', 'QQQ 184/450 하향 + 900 하향 전액(이평3)', ev([[184, 'up', 1, 1], [450, 'dn', 1, 0], [900, 'dn', 1, 0]]));
  { const tl = D.c.TLT, rT = roc(T, 252), rL = roc(tl, 252), rQ = roc(Q, 63), rL3 = roc(tl, 63);
    add('듀얼 모멘텀', 'TQQQ 12개월 수익이 플러스이고 TLT보다 크면 TQQQ, 아니면 TLT', () => ({ w: T.map((_, i) => rT[i] > rL[i] && rT[i] > 0 ? 1 : 0), py: tl }));
    add('듀얼 모멘텀', 'QQQ vs TLT 3개월 수익 큰 쪽(TQQQ/TLT)', () => ({ w: Q.map((_, i) => rQ[i] > rL3[i] ? 1 : 0), py: tl })); }
  add('볼린저', 'QQQ > 20일 중심선이면 보유', W(i => Q[i] > SQ(20)[i] ? 1 : 0));
  { const hi = D.h.QQQ, lo = D.l.QQQ, tr = Q.map((v, i) => i ? Math.max(hi[i] - lo[i], Math.abs(hi[i] - Q[i - 1]), Math.abs(lo[i] - Q[i - 1])) : hi[i] - lo[i]), atr = sma(tr, 22), hh = rmax(Q, 22);
    add('ATR 스톱', 'QQQ 샹들리에 스톱(22일 고점-3ATR) 이탈 매도 · 50일선 위 재진입', () => ({ w: latch(n, i => Q[i] > SQ(50)[i], i => Q[i] < hh[i] - 3 * atr[i], 1) })); }
  add('복합', 'TQQQ 200일선 & QQQ 200일선 둘 다 위', W(i => T[i] > ST(200)[i] && Q[i] > SQ(200)[i] ? 1 : 0));
  add('복합', 'TQQQ 200일선 또는 QQQ 200일선 위', W(i => T[i] > ST(200)[i] || Q[i] > SQ(200)[i] ? 1 : 0));
  add('추세 기울기', 'QQQ 50일선이 20일 전보다 높으면 보유', W(i => i >= 20 && SQ(50)[i] > SQ(50)[i - 20] ? 1 : 0));
  add('추세 기울기', 'QQQ 200일선이 20일 전보다 높으면 보유', W(i => i >= 20 && SQ(200)[i] > SQ(200)[i - 20] ? 1 : 0));
  return L;
}

function runOne(D, st, s0 = D.s0, end = D.dates.length) {
  const sub = { dates: D.dates.slice(0, end), px: D.px.slice(0, end), s0 };
  const r = st.f();
  let e, trades;
  if (r.events) { // 앱 엔진 그대로(돌파/이탈 이벤트, 상태 우선, 지연 1일)
    const fl = {}, F = (k, d) => (fl[k] = fl[k] || E.crossFlags(D.c.QQQ.slice(0, end), k))[d], idx = Array.from({ length: end - s0 }, (_, i) => s0 + i);
    const B = r.events.map(([k, d, b]) => ({ r: b, n: k, f: idx.map(i => F(k, d)[i]) })), S = r.events.map(([k, d, b, s]) => ({ r: s, n: k, f: s ? idx.map(i => F(k, 'dn')[i]) : idx.map(() => false) }));
    const dts = idx.map(i => D.dates[i]), sim = E.simulateEvents(dts, idx.map(i => D.px[i]), B, S, { init: 1, delay: 1, cashRate: CASH, tax: TAX, fee: FEE, stateFirst: true });
    e = sim.eqP; trades = sim.trades;
  } else {
    let w = r.w.slice(0, end);
    // 고정 비중: 매달 마지막 거래일 신호 → 다음 달 첫 거래일 리밸런싱(첫날 포함), 나머지 날은 NaN(그대로 둠)
    if (r.monthly) w = w.map((v, i) => (i === s0 - 1 || (i + 1 < end && D.dates[i + 1].slice(0, 7) !== D.dates[i].slice(0, 7))) ? v : NaN);
    const py = r.py ? r.py.slice(0, end) : null;
    const sim = simW(sub, w, py, r.band ?? .02);
    e = sim.e; trades = sim.trades;
  }
  return { ...metrics(e, D.dates.slice(s0, end)), trades, e };
}

if (require.main === module) (async () => {
  let raw;
  if (ARGS.includes('--mock')) raw = mock();
  else if (arg('--data')) raw = JSON.parse(fs.readFileSync(arg('--data'), 'utf8'));
  else { raw = {}; for (const s of SYMS) { raw[s] = await yahoo(s); console.error(`${s}: ${raw[s].length}일 ${raw[s][0][0]} ~ ${raw[s].at(-1)[0]}`); } if (arg('--save')) fs.writeFileSync(arg('--save'), JSON.stringify(raw)); }
  // TQQQ 날짜 기준으로 정렬(다른 종목은 직전 값 유지)
  const dates = raw.TQQQ.map(r => r[0]), c = {}, h = {}, l = {};
  for (const s of SYMS) { const m = new Map(raw[s].map(r => [r[0], r])); let last = null; c[s] = []; h[s] = []; l[s] = []; for (const d of dates) { const r = m.get(d) || last; last = r; c[s].push(r ? r[1] : NaN); h[s].push(r ? r[2] : NaN); l[s].push(r ? r[3] : NaN); } }
  const s0 = dates.findIndex(d => d >= START), D = { dates, px: c.TQQQ, c, h, l, s0 };
  const L = strategies(D);
  console.log(`기간 ${dates[s0]} ~ ${dates.at(-1)} (${dates.length - s0}거래일) · 전략 ${L.length}개 · 수수료 ${FEE * 100}% · 세율 ${TAX * 100}% · 현금이자 ${CASH * 100}% · 지연 1일`);
  const res = L.map((st, i) => { const r = runOne(D, st); return { id: i + 1, fam: st.fam, name: st.name, ...r }; });
  // 기간 나눠 안정성: 앞(시작~2018) / 뒤(2019~)
  const mid = dates.findIndex(d => d >= '2019-01-01');
  res.forEach(r => { const st = L[r.id - 1]; const a = runOne(D, st, s0, mid), b = runOne(D, st, mid); r.cal1 = a.calmar; r.cal2 = b.calmar; delete r.e; });
  res.sort((a, b) => b.calmar - a.calmar);
  const p = v => (v * 100).toFixed(1) + '%';
  console.log('\n순위 | 전략 | 칼마 | CAGR | MDD | 샤프 | 매매 | 칼마(~2018) | 칼마(2019~)');
  res.forEach((r, k) => console.log(`${k + 1}. [${r.fam}] ${r.name} | ${r.calmar.toFixed(2)} | ${p(r.cagr)} | ${p(r.mdd)} | ${r.sharpe.toFixed(2)} | ${r.trades} | ${r.cal1.toFixed(2)} | ${r.cal2.toFixed(2)}`));
  const out = arg('--out'); if (out) fs.writeFileSync(out, JSON.stringify({ period: [dates[s0], dates.at(-1)], fee: FEE, tax: TAX, cash: CASH, res }, null, 1));
})().catch(e => { console.error('오류:', e.message); process.exit(1); });

module.exports = { simW, metrics, sma, ema, rsi, vol, latch };
