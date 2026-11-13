// TQQQ 다른 지표(변동성·VIX 기간구조·신용·금리·모멘텀 등) 조합 탐색 → 칼마 최대
// 사용: node research/tqqq_indicator_search_20261113.js --data prices.json [--start 2012-01-03] [--until 2019-01-01] [--top 30]
// 1) 빠른 계산(세금 제외)으로 조건 1개 → 2개(AND) → 3개(AND) → 진입/청산 따로(래치)까지 넓게 훑고
// 2) 상위 후보만 앱 세금 규칙(22% 연 1회, 다음해 5월 납부, 마지막 날 전량 매도)으로 다시 계산해 순위.
// 신호는 종가 t에서 판단 → t+1 종가에 체결(지연 1일), 수수료 0.08%.
const fs = require('fs'), path = require('path');
const { simW, metrics } = require('./tqqq_calmar_search_20261113.js');
const ARGS = process.argv.slice(2), arg = k => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : null; };
const START = arg('--start') || '2012-01-03', OOS = arg('--oos'), FEE = 0.0008, TOPN = +(arg('--top') || 30);
const MINC = +(arg('--min-cagr') ?? 0.25); // 거의 안 사서 낙폭만 작은 '가짜 고칼마' 제외: 세금 전 연수익 이 값 미만은 탈락

// ---------- 데이터 ----------
const raw = JSON.parse(fs.readFileSync(arg('--data'), 'utf8'));
const dates0 = raw.TQQQ.map(r => r[0]), C = {}, H = {}, Lo = {};
for (const s of Object.keys(raw)) { const m = new Map(raw[s].map(r => [r[0], r])); let last = null; C[s] = []; H[s] = []; Lo[s] = []; for (const d of dates0) { const r = m.get(d) || last; last = r; C[s].push(r ? r[1] : NaN); H[s].push(r ? r[2] : NaN); Lo[s].push(r ? r[3] : NaN); } }
const n = dates0.length;
const dates = dates0, s0 = dates.findIndex(d => d >= START), nE = OOS ? dates.findIndex(d => d >= OOS) : n; // nE: 탐색에 쓰는 끝(이후는 검증용으로 숨김)
const c = k => C[k].slice(0, n), T = c('TQQQ'), Q = c('QQQ');
const fin = Number.isFinite;

// ---------- 지표 ----------
const roll = (a, k, f) => { const o = new Float64Array(a.length).fill(NaN); for (let i = k - 1; i < a.length; i++) o[i] = f(i - k + 1, i); return o; };
const roc = (a, k) => a.map((v, i) => i >= k ? v / a[i - k] - 1 : NaN);
const ratio = (a, b) => a.map((v, i) => v / b[i]);
const sma = (a, k) => { const o = Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= k) s -= a[i - k]; if (i >= k - 1) o[i] = s / k; } return o; };
const lr = a => a.map((v, i) => i ? Math.log(v / a[i - 1]) : 0);
const rvol = (a, k) => { const r = lr(a), o = Array(a.length).fill(NaN); let s = 0, s2 = 0; for (let i = 0; i < a.length; i++) { s += r[i]; s2 += r[i] * r[i]; if (i >= k) { s -= r[i - k]; s2 -= r[i - k] * r[i - k]; } if (i >= k) o[i] = Math.sqrt(Math.max(0, (s2 - s * s / k) / (k - 1)) * 252); } return o; };
const ddh = (a, k) => roll(a, k, (x, y) => { let m = -Infinity; for (let j = x; j <= y; j++) m = Math.max(m, a[j]); return a[y] / m - 1; });
const pos = (a, k) => roll(a, k, (x, y) => { let mx = -Infinity, mn = Infinity; for (let j = x; j <= y; j++) { mx = Math.max(mx, a[j]); mn = Math.min(mn, a[j]); } return mx > mn ? (a[y] - mn) / (mx - mn) : .5; });
const rsi = (a, k) => { const o = Array(a.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= k) { g += up / k; l += dn / k; if (i === k) o[i] = l ? 100 - 100 / (1 + g / l) : 100; } else { g = (g * (k - 1) + up) / k; l = (l * (k - 1) + dn) / k; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } } return o; };
const upr = (a, k) => roll(a, k + 1, (x, y) => { let u = 0; for (let j = x + 1; j <= y; j++) u += a[j] > a[j - 1]; return u / k; });
const atrp = (k) => { const h = c('QQQ').map((_, i) => H.QQQ[i]), l = Lo.QQQ, tr = Q.map((v, i) => i ? Math.max(h[i] - l[i], Math.abs(h[i] - Q[i - 1]), Math.abs(l[i] - Q[i - 1])) / Q[i - 1] : NaN); return sma(tr, k); };
const diff = (a, k) => a.map((v, i) => i >= k ? v - a[i - k] : NaN);

const IND = {}; const add = (name, a) => { IND[name] = Float64Array.from(a, v => fin(v) ? v : NaN); };
const VIX = c('^VIX'), V3 = c('^VIX3M'), V9 = c('^VIX9D'), VXN = c('^VXN');
add('VIX', VIX); add('VIX/VIX3M', ratio(VIX, V3)); add('VIX9D/VIX', ratio(V9, VIX)); add('VXN', VXN); add('VXN/VIX', ratio(VXN, VIX));
for (const k of [3, 5, 10, 21]) add(`VIX ${k}일 변화율`, roc(VIX, k));
for (const k of [10, 21, 63]) add(`VIX/${k}일 최저`, roll(VIX, k, (x, y) => { let m = Infinity; for (let j = x; j <= y; j++) m = Math.min(m, VIX[j]); return VIX[y] / m; }));
for (const k of [5, 10, 20, 40, 60, 120]) add(`QQQ ${k}일 변동성`, rvol(Q, k));
add('QQQ 변동성 10/60', ratio(rvol(Q, 10), rvol(Q, 60))); add('QQQ 변동성 20/120', ratio(rvol(Q, 20), rvol(Q, 120)));
add('VIX - QQQ 20일 변동성', VIX.map((v, i) => v / 100 - rvol(Q, 20)[i]));
for (const k of [2, 5, 14, 30]) add(`QQQ RSI${k}`, rsi(Q, k));
for (const k of [5, 10, 21, 42, 63, 126, 189, 252]) add(`QQQ ${k}일 수익률`, roc(Q, k));
for (const k of [10, 21, 63, 126, 252]) add(`QQQ ${k}일 고점 대비`, ddh(Q, k));
for (const k of [20, 55, 126, 252]) add(`QQQ ${k}일 범위 위치`, pos(Q, k));
for (const k of [10, 20, 40]) add(`QQQ ${k}일 상승일 비율`, upr(Q, k));
for (const k of [14, 30]) add(`QQQ ATR${k}%`, atrp(k));
const HYG = c('HYG'), IEF = c('IEF'), LQD = c('LQD'), JNK = c('JNK'), TLT = c('TLT'), SPY = c('SPY');
for (const k of [10, 21, 63, 126]) { add(`HYG/IEF ${k}일 변화`, roc(ratio(HYG, IEF), k)); add(`HYG ${k}일 수익률`, roc(HYG, k)); add(`JNK/TLT ${k}일 변화`, roc(ratio(JNK, TLT), k)); }
for (const k of [21, 63]) add(`HYG/LQD ${k}일 변화`, roc(ratio(HYG, LQD), k));
for (const k of [21, 63]) add(`HYG ${k}일 고점 대비`, ddh(HYG, k));
const TNX = c('^TNX'), IRX = c('^IRX');
for (const k of [21, 63, 126]) add(`10년금리 ${k}일 변화`, diff(TNX, k));
add('장단기 금리차(10y-3m)', TNX.map((v, i) => v - IRX[i])); add('3개월 금리', IRX);
for (const k of [21, 63, 126]) add(`달러 UUP ${k}일 수익률`, roc(c('UUP'), k));
for (const k of [21, 63, 126]) add(`반도체/QQQ ${k}일 변화`, roc(ratio(c('SOXX'), Q), k));
for (const k of [21, 63, 126]) add(`동일가중/SPY ${k}일 변화`, roc(ratio(c('RSP'), SPY), k));
for (const k of [21, 63, 126]) add(`소형주/SPY ${k}일 변화`, roc(ratio(c('IWM'), SPY), k));
for (const k of [21, 63]) add(`유틸리티/SPY ${k}일 변화`, roc(ratio(c('XLU'), SPY), k));
for (const k of [21, 63]) add(`금 GLD ${k}일 수익률`, roc(c('GLD'), k));
for (const k of [21, 63]) add(`원자재 DBC ${k}일 수익률`, roc(c('DBC'), k));
for (const k of [21, 63]) add(`국채 TLT ${k}일 수익률`, roc(TLT, k));
add('SKEW', c('^SKEW')); add('MOVE(채권 변동성)', c('^MOVE')); for (const k of [10, 21]) add(`MOVE ${k}일 변화율`, roc(c('^MOVE'), k));
// 비교용 이평선 지표(조합 재료로만)
for (const k of [50, 100, 150, 200]) add(`QQQ/${k}일선`, ratio(Q, sma(Q, k)));

// ---------- 빠른 계산(세금 제외) ----------
const r = new Float64Array(n); for (let i = 1; i < n; i++) r[i] = T[i] / T[i - 1] - 1;
const yrs = (Date.parse(dates[nE - 1]) - Date.parse(dates[s0])) / 864e5 / 365.25;
function fast(w) { // w[i] = 종가 i 판단 목표 비중(0/1), 종가 i+1 체결
  let e = 1, pk = 1, mdd = 0, p = 0;
  for (let i = s0; i < nE; i++) {
    if (i > s0) e *= 1 + p * r[i];
    const t = w[i - 1];
    if (t !== p) { e *= 1 - FEE * Math.abs(t - p); p = t; }
    if (e > pk) pk = e; else if (e / pk - 1 < mdd) mdd = e / pk - 1;
  }
  const cagr = Math.pow(e, 1 / yrs) - 1;
  return { cal: cagr < MINC ? -1 : mdd < 0 ? cagr / -mdd : 0, cagr, mdd };
}

// ---------- 조건 만들기: 지표 × 분위수 기준값 × 방향 ----------
const QS = [.05, .1, .15, .2, .25, .3, .35, .4, .45, .5, .55, .6, .65, .7, .75, .8, .85, .9, .95];
const CONDS = [];
for (const [name, a] of Object.entries(IND)) {
  const v = Array.from(a.slice(s0, nE)).filter(fin).sort((x, y) => x - y); if (v.length < 500) continue;
  const th = [...new Set(QS.map(q => +v[Math.floor(q * (v.length - 1))].toPrecision(3)))];
  for (const t of th) for (const dir of ['<', '>']) {
    const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = fin(a[i]) ? (dir === '<' ? a[i] < t : a[i] > t) : 1; // 값 없으면 보유 허용
    CONDS.push({ name, t, dir, b, label: `${name} ${dir} ${/금리|MOVE|SKEW|VIX$|VXN$/.test(name) && !/변화율/.test(name) ? (/금리/.test(name) ? t.toFixed(2) + '%p' : +t.toPrecision(3)) : fmt(t)}` });
  }
}
function fmt(t) { return Math.abs(t) < 1 && t !== 0 && Math.abs(t) < .5 ? (Math.abs(t) < .2 ? (t * 100).toFixed(1) + '%' : t.toFixed(3)) : (+t.toPrecision(3)).toString(); }
const andB = (...bs) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { let v = 1; for (const b of bs) if (!b[i]) { v = 0; break; } o[i] = v; } return o; };
const latchB = (en, ex) => { const o = new Uint8Array(n); let s = 1; for (let i = 0; i < n; i++) { if (!ex[i]) s = 0; else if (en[i]) s = 1; o[i] = s; } return o; }; // ex = 보유 허용 조건(거짓이면 청산)
// 후보 = { en, ex, ands } → 신호 배열은 필요할 때 다시 만듦(메모리 절약)
const build = x => { let b = x.ex ? latchB(x.en.b, x.ex.b) : null; for (const a of x.ands) b = b ? andB(b, a.b) : a.b; return b; };
const lab = x => (x.ex ? `{보유: ${x.ex.label} 깨지면 매도, 다시 ${x.en.label} 이면 매수}` : '') + x.ands.map((a, k) => (k || x.ex ? ' & ' : '') + a.label).join('');

const t0 = Date.now(), log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
log(`지표 ${Object.keys(IND).length}개 · 조건 ${CONDS.length}개 · 기간 ${dates[s0]} ~ ${dates[n - 1]}`);
const seen = new Set(), cand = [];
const key = b => { let h = 2166136261, g = 0; for (let i = s0; i < nE; i++) { h = Math.imul(h ^ b[i], 16777619); g = (g * 31 + b[i] * (i & 255)) | 0; } return h + ':' + g; };
function test(x, b = build(x)) { const k = key(b); if (seen.has(k)) return null; seen.add(k); const f = fast(b); Object.assign(x, f); cand.push(x); return x; }
const best = () => cand.reduce((a, b) => b.cal > a.cal ? b : a);

// 1단계: 조건 1개
const S1 = CONDS.map(cd => test({ ands: [cd] })).filter(Boolean).sort((a, b) => b.cal - a.cal);
log('1단계 최고', lab(S1[0]), S1[0].cal.toFixed(2));
// 2단계: 상위 조건 × 전체 조건 (AND)
for (const a of S1.slice(0, 200)) for (const cd of CONDS) if (cd.name !== a.ands[0].name) test({ ands: [a.ands[0], cd] }, andB(a.ands[0].b, cd.b));
log('2단계 최고', lab(best()), best().cal.toFixed(2));
// 3단계: 상위 2개 조합 × 전체 조건 (AND 3개)
const top2 = cand.filter(x => x.ands.length === 2 && !x.ex).sort((a, b) => b.cal - a.cal).slice(0, 120);
for (const a of top2) { const ab = build(a); for (const cd of CONDS) if (!a.ands.some(q => q.name === cd.name)) test({ ands: [...a.ands, cd] }, andB(ab, cd.b)); }
log('3단계 최고', lab(best()), best().cal.toFixed(2));
// 4단계: 청산 조건과 재진입 조건을 따로(래치)
const topC = S1.slice(0, 150).map(x => x.ands[0]);
for (const ex of topC) for (const en of CONDS) if (en.name !== ex.name) test({ ex, en, ands: [] });
log('4단계 최고', lab(best()), best().cal.toFixed(2));
// 5단계: 상위 래치 × 추가 필터(AND)
const topL = cand.filter(x => x.ex && !x.ands.length).sort((a, b) => b.cal - a.cal).slice(0, 100);
for (const a of topL) { const ab = build(a); for (const cd of CONDS) test({ ...a, ands: [cd] }, andB(ab, cd.b)); }
log('5단계 최고', lab(best()), best().cal.toFixed(2), `· 후보 ${cand.length}개`);
cand.sort((a, b) => b.cal - a.cal);

// ---------- 세금 포함 재계산 ----------
const mid = dates.findIndex(d => d >= '2019-01-01');
const full = (b, from = s0, to = n) => { const Dx = { dates: dates.slice(0, to), px: T.slice(0, to), s0: from }; const sim = simW(Dx, Array.from(b.slice(0, to)), null); return { ...metrics(sim.e, dates.slice(from, to)), trades: sim.trades }; };
const top = cand.slice(0, 400).map(x => { const b = build(x); return { ...x, b, label: lab(x), ...full(b, s0, nE) }; }).sort((a, b) => b.calmar - a.calmar);
const p = v => (v * 100).toFixed(1) + '%';
console.log(`탐색 기간 ${dates[s0]} ~ ${dates[nE - 1]}${OOS ? ` (검증 기간 ${dates[nE]} ~ ${dates[n - 1]}은 탐색에 안 씀)` : ''} · 지표 ${Object.keys(IND).length}개 · 조건 ${CONDS.length}개 · 시험한 신호 ${cand.length}개 · 세금 22%(5월 납부) · 수수료 0.08% · 지연 1일 · 최소 연수익 ${MINC * 100}%`);
// 근처 기준값 검사: 조건 하나씩 기준값을 옆 분위수(±1, ±2칸)로 바꿔도 칼마가 유지되는지
const sib = cd => { const L = CONDS.filter(q => q.name === cd.name && q.dir === cd.dir).sort((a, b) => a.t - b.t), k = L.findIndex(q => q.t === cd.t); return [-2, -1, 1, 2].map(d => L[k + d]).filter(Boolean); };
function robust(x) {
  const vs = [];
  const slots = [...(x.ex ? ['ex', 'en'] : []), ...x.ands.map((_, k) => k)];
  for (const sl of slots) { const cd = typeof sl === 'number' ? x.ands[sl] : x[sl]; for (const alt of sib(cd)) { const y = { ex: x.ex, en: x.en, ands: [...x.ands] }; if (typeof sl === 'number') y.ands[sl] = alt; else y[sl] = alt; vs.push(full(build(y), s0, nE).calmar); } }
  vs.sort((a, b) => a - b); return vs.length ? `근처 ${vs.length}개 중앙 ${vs[vs.length >> 1].toFixed(2)} 최저 ${vs[0].toFixed(2)}` : '';
}
console.log(OOS ? '순위 | 전략 | 탐색 칼마 | CAGR | MDD | 매매 | ▶ 검증 칼마 · CAGR · MDD | 근처 기준값' : '순위 | 전략 | 칼마 | CAGR | MDD | 매매 | 칼마 ~2018 / 2019~ | 근처 기준값');
top.slice(0, TOPN).forEach((x, k) => {
  let h = '';
  if (OOS) { const t = full(x.b, nE, n); h = ` | ▶ ${t.calmar.toFixed(2)} · ${p(t.cagr)} · ${p(t.mdd)}`; }
  else if (mid > s0 && mid < n) h = ` | ${full(x.b, s0, mid).calmar.toFixed(2)} / ${full(x.b, mid).calmar.toFixed(2)}`;
  console.log(`${k + 1}. ${x.label} | ${x.calmar.toFixed(2)} | ${p(x.cagr)} | ${p(x.mdd)} | ${x.trades}${h} | ${k < (+arg('--robust') || 10) ? robust(x) : ''}`);
});
const slim = q => q && { name: q.name, t: q.t, dir: q.dir };
const out = arg('--out'); if (out) fs.writeFileSync(out, JSON.stringify(top.slice(0, 200).map(x => ({ label: x.label, ex: slim(x.ex), en: slim(x.en), ands: x.ands.map(slim), calmar: x.calmar, cagr: x.cagr, mdd: x.mdd, trades: x.trades })), null, 1));
