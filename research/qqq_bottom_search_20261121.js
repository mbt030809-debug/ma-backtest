// QQQ 폭락장 최저점 신호 찾기: 2002·2009·2018·2022·2025 바닥 근처에서만 켜지고, 다른 때는 안 켜지는 지표 조합
// 사용: node research/qqq_bottom_search_20261121.js --data bottom_prices.json [--max 10] [--win 20] [--hold 2009]
// - 지표는 그날 종가까지의 정보만 사용(미래 정보 없음)
// - 바닥 = 나스닥100 지수 종가 최저(배당 없는 가격 = QQQ 차트와 같음). 쌍바닥(최저가 1% 이내 날)은 둘 다 바닥으로 인정
// - 신호가 바닥에서 ±win 거래일 밖에서 하루라도 켜지면 탈락, 신호 총 일수 ≤ max, 5개 바닥 모두 맞혀야 함
// - 순위: 신호 날짜와 바닥 사이 거래일 차이(평균)가 작은 순
const fs = require('fs');
const ARGS = process.argv.slice(2), arg = k => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : null; };
const MAXC = +(arg('--maxcond') || 4), MAXF = +(arg('--maxfal') || 0), MAXS = +(arg('--max') || 10), WIN = +(arg('--win') || 20), HOLD = arg('--hold'), TOPN = +(arg('--top') || 25);
const raw = JSON.parse(fs.readFileSync(arg('--data'), 'utf8'));
const dates = raw.QQQ.map(r => r[0]), n = dates.length, fin = Number.isFinite;
const col = (s, k) => { const m = new Map(raw[s].map(r => [r[0], r])); let last = null; return dates.map(d => { const r = m.get(d) || last; last = r; return r ? r[k] : NaN; }); };
const C = col('QQQ', 1), O = col('QQQ', 2), Hh = col('QQQ', 3), L = col('QQQ', 4), V = col('QQQ', 5), NDX = col('^NDX', 1);

// ---------- 바닥(목표) ----------
const PEAK = ARGS.includes('--peak'); // 고점 모드: 폭락 직전 최고점(나스닥100 종가 최고) 부근에서 켜지는 신호를 찾는다
const TG = (PEAK ? [['2002', '2000-01-01', '2000-12-31', '2003-06-30', '2002-10-09'], ['2009', '2007-06-01', '2008-05-31', '2009-12-31', '2009-03-09'], ['2018', '2018-06-01', '2018-12-31', '2019-03-31', '2018-12-24'], ...(ARGS.includes('--with2020') ? [['2020', '2020-01-01', '2020-03-31', '2020-06-30', '2020-03-23']] : []), ['2022', '2021-06-01', '2022-03-31', '2023-03-31', '2022-12-28'], ['2025', '2024-12-01', '2025-04-30', '2025-08-31', '2025-04-08']]
  : [['2002', '2001-09-01', '2003-06-30'], ['2009', '2008-06-01', '2009-12-31'], ['2018', '2018-09-01', '2019-03-31'], ...(ARGS.includes('--with2020') ? [['2020', '2020-02-01', '2020-06-30']] : []), ['2022', '2022-01-01', '2023-03-31'], ['2025', '2025-01-01', '2025-08-31']])
  .map(([nm, a, b, endc, bot]) => { const end = endc || b; const ix = []; for (let i = 0; i < n; i++) if (dates[i] >= a && dates[i] <= b) ix.push(i);
    if (PEAK) { const hi = Math.max(...ix.map(i => NDX[i])); const zone = ix.filter(i => NDX[i] >= hi * .99); const low = ix.find(i => NDX[i] === hi); return { nm, zone, low, lo: hi, end, bot }; }
    const lo = Math.min(...ix.map(i => NDX[i])); const zone = ix.filter(i => NDX[i] <= lo * 1.01); const low = ix.find(i => NDX[i] === lo); return { nm, zone, low, lo, end }; });
const tgOf = new Int8Array(n).fill(-1), distOf = new Float64Array(n).fill(Infinity);
TG.forEach((t, k) => { for (let i = 0; i < n; i++) { if (t.bot && dates[i] > t.bot) continue; /* 고점 모드: 바닥 이후는 대상 아님 */ const d = Math.min(...t.zone.map(z => Math.abs(i - z))); if (d <= WIN && d < distOf[i]) { distOf[i] = d; tgOf[i] = k; } } });
const ACT = TG.map((t, k) => HOLD !== t.nm); // --hold 연도: 그 바닥은 탐색에서 빼고(정답 숨김) 나중에 맞히는지 확인

// ---------- 지표 ----------
const sma = (a, k) => { const o = Array(n).fill(NaN); let s = 0, c = 0; for (let i = 0; i < n; i++) { if (fin(a[i])) { s += a[i]; c++; } if (i >= k && fin(a[i - k])) { s -= a[i - k]; c--; } if (i >= k - 1 && c === k) o[i] = s / k; } return o; };
const sd = (a, k) => { const m = sma(a, k); return a.map((_, i) => { if (!fin(m[i])) return NaN; let s = 0; for (let j = i - k + 1; j <= i; j++) s += (a[j] - m[i]) ** 2; return Math.sqrt(s / k); }); };
const rmax = (a, k) => a.map((_, i) => { if (i < k - 1) return NaN; let m = -Infinity; for (let j = i - k + 1; j <= i; j++) m = Math.max(m, a[j]); return m; });
const rmin = (a, k) => a.map((_, i) => { if (i < k - 1) return NaN; let m = Infinity; for (let j = i - k + 1; j <= i; j++) m = Math.min(m, a[j]); return m; });
const roc = (a, k) => a.map((v, i) => i >= k ? v / a[i - k] - 1 : NaN);
const dif = (a, k) => a.map((v, i) => i >= k ? v - a[i - k] : NaN);
const rat = (a, b) => a.map((v, i) => v / b[i]);
const ema = (a, k) => { const o = Array(n).fill(NaN), al = 2 / (k + 1); let p = NaN; for (let i = 0; i < n; i++) { if (!fin(a[i])) continue; p = fin(p) ? a[i] * al + p * (1 - al) : a[i]; o[i] = p; } return o; };
const rsi = (a, k) => { const o = Array(n).fill(NaN); let g = 0, l = 0; for (let i = 1; i < n; i++) { const d = a[i] - a[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= k) { g += up / k; l += dn / k; if (i === k) o[i] = l ? 100 - 100 / (1 + g / l) : 100; } else { g = (g * (k - 1) + up) / k; l = (l * (k - 1) + dn) / k; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } } return o; };
const lr = C.map((v, i) => i ? Math.log(v / C[i - 1]) : 0);
const rv = k => sd(lr, k).map(v => v * Math.sqrt(252));
const IND = {}; const add = (nm, a) => { IND[nm] = Float64Array.from(a, v => fin(v) ? v : NaN); };
for (const k of [21, 63, 126, 252, 504]) add(`QQQ ${k}일 고점 대비 하락률`, rat(C, rmax(C, k)).map(v => v - 1));
for (const k of [1, 2, 3, 5, 10, 21, 42, 63, 126, 252]) add(`QQQ ${k}일 수익률`, roc(C, k));
for (const k of [10, 20, 50, 100, 200]) add(`QQQ ${k}일선 이격도`, rat(C, sma(C, k)).map(v => v - 1));
for (const k of [20, 50]) { const m = sma(C, k), s2 = sd(C, k); add(`QQQ ${k}일 z점수`, C.map((v, i) => (v - m[i]) / s2[i])); }
for (const k of [2, 3, 5, 9, 14, 30]) add(`QQQ RSI${k}`, rsi(C, k));
for (const k of [14, 63, 252]) { const lo = rmin(L, k), hi = rmax(Hh, k); add(`QQQ 스토캐스틱${k}`, C.map((v, i) => (v - lo[i]) / (hi[i] - lo[i]))); }
for (const k of [5, 10, 21]) add(`QQQ ${k}일 저점 대비 반등`, rat(C, rmin(C, k)).map(v => v - 1));
for (const k of [63, 252]) { const lo = rmin(C, k); add(`QQQ ${k}일 최저 이후 경과일`, C.map((_, i) => { if (!fin(lo[i])) return NaN; for (let j = i; j > i - k; j--) if (C[j] === lo[i]) return i - j; return NaN; })); }
for (const k of [10, 20]) add(`QQQ ${k}일 중 하락일 비율`, C.map((_, i) => { if (i < k) return NaN; let d = 0; for (let j = i - k + 1; j <= i; j++) d += C[j] < C[j - 1]; return d / k; }));
add('QQQ 연속 하락일', C.map((_, i) => { let k = 0; while (i - k > 0 && C[i - k] < C[i - k - 1]) k++; return k; }));
for (const k of [5, 10, 21]) add(`QQQ ${k}일 변동성`, rv(k));
add('QQQ 변동성 5/63', rat(rv(5), rv(63))); add('QQQ 변동성 10/63', rat(rv(10), rv(63)));
add('QQQ 당일 변동폭', Hh.map((h, i) => (h - L[i]) / C[i])); add('QQQ 5일 평균 변동폭', sma(Hh.map((h, i) => (h - L[i]) / C[i]), 5));
add('QQQ 종가 위치(고저 중)', C.map((c, i) => Hh[i] > L[i] ? (c - L[i]) / (Hh[i] - L[i]) : .5));
add('QQQ 아래꼬리', C.map((c, i) => (Math.min(O[i], c) - L[i]) / c));
add('QQQ 갭(시가/전일종가)', O.map((o, i) => i ? o / C[i - 1] - 1 : NaN));
for (const k of [20, 50]) add(`QQQ 거래량/${k}일 평균`, rat(V, sma(V, k)));
{ const vr = rat(V, sma(V, 50)); add('QQQ 5일 최대 거래량배수', rmax(vr, 5)); }
{ const e26 = ema(C, 26), m = ema(C, 12).map((v, i) => v - e26[i]), sg = ema(m, 9); add('QQQ MACD/가격', m.map((v, i) => v / C[i])); add('QQQ MACD 히스토그램/가격', m.map((v, i) => (v - sg[i]) / C[i])); const h = m.map((v, i) => v - sg[i]); add('QQQ MACD 히스토그램 1일 변화/가격', h.map((v, i) => i ? (v - h[i - 1]) / C[i] : NaN)); }
const VIX = col('^VIX', 1), VXN = col('^VXN', 1), GS = col('^GSPC', 1), RUT = col('^RUT', 1), TNX = col('^TNX', 1), IRX = col('^IRX', 1), TYX = col('^TYX', 1);
add('VIX', VIX); for (const k of [10, 20, 50]) add(`VIX/${k}일 평균`, rat(VIX, sma(VIX, k)));
for (const k of [5, 10, 21]) add(`VIX/${k}일 최고`, rat(VIX, rmax(VIX, k)));
for (const k of [1, 5, 10]) add(`VIX ${k}일 변화율`, roc(VIX, k));
add('VIX 252일 순위', VIX.map((v, i) => { if (i < 252) return NaN; let c = 0; for (let j = i - 251; j <= i; j++) c += VIX[j] <= v; return c / 252; }));
{ const r21 = rv(21); add('VIX - 실현변동성21', VIX.map((v, i) => v / 100 - r21[i])); }
add('VXN', VXN); add('VXN/VIX', rat(VXN, VIX)); add('VXN/20일 평균', rat(VXN, sma(VXN, 20)));
for (const k of [21, 63, 126]) add(`10년금리 ${k}일 변화(%p)`, dif(TNX, k));
for (const k of [63, 126]) add(`3개월금리 ${k}일 변화(%p)`, dif(IRX, k));
add('장단기 금리차(10y-3m)', TNX.map((v, i) => v - IRX[i])); add('장단기 금리차(10y-3m) 63일 변화', dif(TNX.map((v, i) => v - IRX[i]), 63));
add('장단기 금리차(30y-10y)', TYX.map((v, i) => v - TNX[i]));
for (const k of [21, 63]) { add(`소형주/S&P ${k}일 변화`, roc(rat(RUT, GS), k)); add(`나스닥100/S&P ${k}일 변화`, roc(rat(NDX, GS), k)); }
for (const s of ['XLU', 'XLF']) for (const k of [21, 63]) add(`${s}/SPY ${k}일 변화`, roc(rat(col(s, 1), col('SPY', 1)), k));
add('S&P 252일 고점 대비', rat(GS, rmax(GS, 252)).map(v => v - 1));

// 지표 범위 제한: --exclude 정규식(빼기), --include 정규식(이것만)
{ const ex = arg('--exclude'), inc = arg('--include'); for (const k of Object.keys(IND)) if ((ex && new RegExp(ex).test(k)) || (inc && !new RegExp(inc).test(k))) delete IND[k]; }
// ---------- 조건(비트셋) ----------
const NW = Math.ceil(n / 32);
const Q = [.002, .004, .007, .01, .015, .02, .03, .05, .075, .1, .15, .2, .3, .5];
const CONDS = [];
for (const [nm, a] of Object.entries(IND)) {
  const v = Array.from(a).filter(fin).sort((x, y) => x - y); if (v.length < 1000) continue;
  const th = new Set(); for (const q of Q) { th.add(+v[Math.floor(q * (v.length - 1))].toPrecision(3) + ''); th.add(+v[Math.floor((1 - q) * (v.length - 1))].toPrecision(3) + ''); }
  for (const ts of th) { const t = +ts; for (const dir of ['<', '>']) {
    const b = new Uint32Array(NW); let cnt = 0; for (let i = 0; i < n; i++) if (fin(a[i]) && (dir === '<' ? a[i] < t : a[i] > t)) { b[i >> 5] |= 1 << (i & 31); cnt++; }
    if (cnt < 3 || cnt > n * .5) continue; // 너무 드물거나 흔한 조건 제외
    CONDS.push({ nm, t, dir, b, cnt, label: `${nm} ${dir} ${fmt(nm, t)}` });
  } }
}
function fmt(nm, t) { if (/금리|VIX - 실현변동성/.test(nm)) return (/VIX/.test(nm) ? (t * 100).toFixed(1) : t.toFixed(2)) + '%p'; if (/수익률|하락률|이격도|반등|변화$|변화율|대비$|갭|꼬리|변동폭|MACD/.test(nm) && !/%p/.test(nm)) return (t * 100).toFixed(2).replace(/\.?0+$/, '') + '%'; return (+t.toPrecision(3)).toString(); }
// 목표 마스크
const allowB = new Uint32Array(NW), tgB = TG.map(() => new Uint32Array(NW));
for (let i = 0; i < n; i++) if (tgOf[i] >= 0) { allowB[i >> 5] |= 1 << (i & 31); tgB[tgOf[i]][i >> 5] |= 1 << (i & 31); }
const pc = x => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
const tmp = new Uint32Array(NW);
// 평가: 신호 수, 바닥 밖 신호 수(숨긴 바닥 근처는 세지 않음), 맞힌 바닥 수
function evalB(b) {
  let cnt = 0, fal = 0, cov = 0;
  for (let w = 0; w < NW; w++) { const x = b[w]; if (!x) continue; cnt += pc(x); fal += pc(x & ~allowB[w]); }
  for (let k = 0; k < TG.length; k++) { if (!ACT[k]) continue; const t = tgB[k]; for (let w = 0; w < NW; w++) if (b[w] & t[w]) { cov++; break; } }
  return { cnt, fal, cov };
}
const NEED = ACT.filter(Boolean).length;
const andInto = (o, a, b) => { for (let w = 0; w < NW; w++) o[w] = a[w] & b[w]; return o; };
const days = b => { const o = []; for (let w = 0; w < NW; w++) { let x = b[w]; while (x) { const t = x & -x, j = 31 - Math.clz32(t); o.push(w * 32 + j); x ^= t; } } return o; };
function score(b) { const ds = days(b); let s = 0, mx = 0; for (const i of ds) { const d = tgOf[i] >= 0 ? distOf[i] : 99; s += d; mx = Math.max(mx, d); } return { mean: s / ds.length, max: mx, ds }; }

// ---------- 안정성 검증 ----------
// --stab "지표|<,지표|>,...": 지표 구조는 고정, 기준값을 촘촘한 격자(상·하위 0.2%~QMAX 분위, 로그 간격)로 전부 바꿔 가며
//   ① 통과 조합이 얼마나 넓은지 ② 이웃 칸(±1)도 같이 통과하는 안정한 값 ③ 바닥 하나씩 빼고 맞히는지
// --scan K: 지표 구조까지 전부 바꿔 가며 '넓게 통과하는' 구조(K=2: 쌍, K=3: 상위 쌍 + 1개)를 찾는다
const QMAX = +(arg('--qmax') || .6), F = +(arg('--F') || 0), CMAX = +(arg('--cmax') || 15), NB = TG.length, FULL = (1 << NB) - 1;
function gridEval(spec, G) {
  const K = spec.length;
  const grids = spec.map(sp => { const a = IND[sp.nm], v = sp.v || (sp.v = Array.from(a).filter(fin).sort((x, y) => x - y)), ths = [];
    for (let k = 0; k < G; k++) { const q = .002 * Math.pow(QMAX / .002, k / (G - 1)), t = v[Math.floor((sp.dir === '<' ? q : 1 - q) * (v.length - 1))]; if (!ths.includes(t)) ths.push(t); }
    const key = sp.nm + sp.dir + G, bs = (gridEval.cache[key] = gridEval.cache[key] || ths.map(t => { const b = new Uint32Array(NW); for (let i = 0; i < n; i++) if (fin(a[i]) && (sp.dir === '<' ? a[i] < t : a[i] > t)) b[i >> 5] |= 1 << (i & 31); return b; }));
    return { sp, ths, bs }; });
  const sizes = grids.map(g => g.ths.length), total = sizes.reduce((a, b) => a * b, 1);
  const covM = new Uint8Array(total), falA = new Uint16Array(total), cntA = new Uint16Array(total), meanA = new Float32Array(total).fill(NaN);
  const lvl = Array.from({ length: K }, () => new Uint32Array(NW));
  (function rec(d, base) {
    for (let j = 0; j < sizes[d]; j++) {
      const b = grids[d].bs[j], cur = lvl[d]; if (d === 0) cur.set(b); else { const pv = lvl[d - 1]; for (let w = 0; w < NW; w++) cur[w] = pv[w] & b[w]; }
      const id = base * sizes[d] + j; if (d < K - 1) { rec(d + 1, id); continue; }
      let cnt = 0, fal = 0, cm = 0;
      for (let w = 0; w < NW; w++) { const x = cur[w]; if (!x) continue; cnt += pc(x); fal += pc(x & ~allowB[w]); for (let k = 0; k < NB; k++) if (x & tgB[k][w]) cm |= 1 << k; }
      covM[id] = cm; falA[id] = Math.min(65535, fal); cntA[id] = Math.min(65535, cnt);
      if (cnt > 0 && cnt <= 300 && (cm === FULL || (cm & (cm + 1)) !== 0 || true) && fal <= F + 2) { let sm = 0; for (let w = 0; w < NW; w++) { let x = cur[w]; while (x) { const t = x & -x, i = w * 32 + 31 - Math.clz32(t); sm += distOf[i] === Infinity ? 99 : distOf[i]; x ^= t; } } meanA[id] = sm / cnt; }
    } })(0, 0);
  const E = { spec, grids, sizes, total, covM, falA, cntA, meanA, K };
  E.ok = (id, need) => (covM[id] & need) === need && falA[id] <= F && cntA[id] > 0 && cntA[id] <= CMAX;
  E.coords = id => { const c = Array(K); for (let d = K - 1; d >= 0; d--) { c[d] = id % sizes[d]; id = Math.floor(id / sizes[d]); } return c; };
  E.toId = c => c.reduce((a, v, d) => a * sizes[d] + v, 0);
  E.offs = gridEval.offs[K] || (gridEval.offs[K] = (() => { const o = []; const r2 = (d, cur) => { if (d === K) { if (cur.some(v => v)) o.push(cur.slice()); return; } for (const q of [-1, 0, 1]) { cur.push(q); r2(d + 1, cur); cur.pop(); } }; r2(0, []); return o; })());
  E.nbr = (id, need) => { const c = E.coords(id); let t = 0, g = 0; for (const o of E.offs) { const cc = c.map((v, d) => v + o[d]); if (cc.some((v, d) => v < 0 || v >= sizes[d])) continue; t++; if (E.ok(E.toId(cc), need)) g++; } return t ? g / t : 0; };
  E.label = id => E.coords(id).map((j, d) => `${spec[d].nm} ${spec[d].dir} ${fmt(spec[d].nm, grids[d].ths[j])}`).join(' & ');
  E.th = id => E.coords(id).map((j, d) => ({ nm: spec[d].nm, dir: spec[d].dir, t: grids[d].ths[j] }));
  return E;
}
gridEval.cache = {}; gridEval.offs = {};
function analyze(E, need = FULL, thr = .75) { // 합격 조합, 안정 조합(이웃 합격률 ≥ thr), 1위
  const ps = []; for (let id = 0; id < E.total; id++) if (E.ok(id, need)) ps.push(id);
  const cs = ps.map(id => ({ id, nb: E.nbr(id, need), mean: E.meanA[id] })).sort((x, y) => y.nb - x.nb || x.mean - y.mean);
  return { ps, cs, stable: cs.filter(x => x.nb >= thr).length };
}
if (arg('--stab')) {
  const spec = arg('--stab').split(',').map(x => { const [nm, dir] = x.split('|'); if (!IND[nm]) throw Error('지표 없음: ' + nm); return { nm, dir }; });
  const E = gridEval(spec, +(arg('--grid') || 24)), { K, sizes, total, grids } = E;
  console.log(`구조: ${spec.map(x => x.nm + ' ' + x.dir).join(' & ')}\n기준값 격자 ${sizes.join('×')} = ${total.toLocaleString()}조합 · 합격 = 바닥 ${NB}개 모두 맞힘 · 바닥 밖 신호 ≤ ${F}일 · 신호 ≤ ${CMAX}일`);
  const A = analyze(E);
  console.log(`합격 조합 ${A.ps.length}개 (격자의 ${(A.ps.length / total * 100).toFixed(3)}%) · 이웃 칸이 75% 이상 같이 합격하는 안정 조합 ${A.stable}개`);
  if (arg('--orig')) { const ov = arg('--orig').split(',').map(Number), c = ov.map((t, d) => { let bj = 0; grids[d].ths.forEach((x, j) => { if (Math.abs(x - t) < Math.abs(grids[d].ths[bj] - t)) bj = j; }); return bj; }), id = E.toId(c);
    console.log(`[기존 기준값] ${E.label(id)} (가장 가까운 격자) → ${E.ok(id, FULL) ? '합격' : '불합격'} · 이웃 합격률 ${(E.nbr(id, FULL) * 100).toFixed(0)}% · 신호 ${E.cntA[id]}일 · 바닥 밖 ${E.falA[id]}일`); }
  if (A.ps.length) {
    console.log('\n[가장 안정적인 기준값 TOP 5] (이웃 합격률 높은 순 → 바닥과 평균 거리 짧은 순)');
    A.cs.slice(0, 5).forEach((x, k) => console.log(`${k + 1}. ${E.label(x.id)}\n    이웃 합격률 ${(x.nb * 100).toFixed(0)}% · 신호 ${E.cntA[x.id]}일 · 바닥 밖 ${E.falA[x.id]}일 · 바닥과 평균 거리 ${x.mean.toFixed(1)}일`));
    const best = A.cs[0], bc = E.coords(best.id);
    console.log('\n[1위 기준값을 하나씩 바꿔 볼 때 합격하는 범위] (다른 조건은 고정)');
    spec.forEach((sp, d) => { const okj = []; for (let j = 0; j < sizes[d]; j++) { const c = bc.slice(); c[d] = j; if (E.ok(E.toId(c), FULL)) okj.push(j); } let lo = bc[d], hi = bc[d]; while (okj.includes(lo - 1)) lo--; while (okj.includes(hi + 1)) hi++;
      console.log(`  ${sp.nm} ${sp.dir}: ${fmt(sp.nm, grids[d].ths[lo])} ~ ${fmt(sp.nm, grids[d].ths[hi])} 에서 합격 (격자 ${sizes[d]}칸 중 ${hi - lo + 1}칸 연속, 고른 값 ${fmt(sp.nm, grids[d].ths[bc[d]])})`); });
    if (arg('--stab-out')) fs.writeFileSync(arg('--stab-out'), JSON.stringify([{ name: '안정 1위', rule: E.th(best.id) }, ...A.cs.slice(1, 3).map((x, k) => ({ name: `안정 ${k + 2}위`, rule: E.th(x.id) }))]));
  }
  console.log('\n[바닥 하나씩 빼고 고른 기준값이 빠진 바닥도 맞히는지]');
  let hits = 0;
  for (let h = 0; h < NB; h++) {
    const need = FULL & ~(1 << h), B = analyze(E, need);
    if (!B.ps.length) { console.log(`  ${TG[h].nm} 제외: 나머지 바닥을 모두 맞히는 값 없음`); continue; }
    const b = B.cs[0], hit = (E.covM[b.id] >> h) & 1, share = B.ps.filter(id => (E.covM[id] >> h) & 1).length / B.ps.length; if (hit) hits++;
    console.log(`  ${TG[h].nm} 제외: 합격 ${B.ps.length}개 → 고른 값(안정 1위) ${hit ? '맞힘' : '못 맞힘'} · 합격 조합 중 ${TG[h].nm}도 맞힌 비율 ${(share * 100).toFixed(0)}%`);
  }
  console.log(`  → 빼고 찾아도 맞힌 바닥 ${hits}/${NB}`);
  process.exit(0);
}
if (arg('--scan')) {
  const K = +arg('--scan'), G1 = +(arg('--grid') || 28), TOP = +(arg('--top') || 15), pool = [];
  for (const nm of Object.keys(IND)) for (const dir of ['<', '>']) { const E = gridEval([{ nm, dir }], G1); let any = false; for (let id = 0; id < E.total; id++) if ((E.covM[id] & FULL) === FULL) { any = true; break; } if (any) pool.push({ nm, dir }); }
  console.log(`단독으로 바닥 ${NB}개를 모두 덮는 조건 후보 ${pool.length}개`);
  const res = [];
  const evalSpec = (spec, G) => { const E = gridEval(spec, G), A = analyze(E); if (A.ps.length) res.push({ spec, G, E, A }); };
  if (K === 2) { for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) if (pool[a].nm !== pool[b].nm) evalSpec([pool[a], pool[b]], G1); }
  else { const pairs = []; for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) if (pool[a].nm !== pool[b].nm) { const E = gridEval([pool[a], pool[b]], 20), A = analyze(E, FULL); pairs.push({ spec: [pool[a], pool[b]], sc: A.ps.length }); }
    pairs.sort((x, y) => y.sc - x.sc); const G3 = +(arg('--grid3') || 14);
    for (const pr of pairs.slice(0, +(arg('--pairs') || 60))) for (const c of pool) if (!pr.spec.some(q => q.nm === c.nm)) evalSpec([...pr.spec, c], G3); }
  res.sort((x, y) => y.A.stable - x.A.stable || (y.A.ps.length / y.E.total) - (x.A.ps.length / x.E.total));
  console.log(`합격 조합이 있는 구조 ${res.length}개 · 안정 조합 수(이웃 75% 이상 합격) 순`);
  res.slice(0, TOP).forEach((r, k) => { const b = r.A.cs[0]; console.log(`${k + 1}. ${r.spec.map(q => q.nm + ' ' + q.dir).join(' & ')}\n    격자 ${r.E.sizes.join('×')} 중 합격 ${r.A.ps.length}개 · 안정 ${r.A.stable}개 · 고른 값: ${r.E.label(b.id)} (이웃 합격률 ${(b.nb * 100).toFixed(0)}%, 신호 ${r.E.cntA[b.id]}일, 바닥 밖 ${r.E.falA[b.id]}일, 평균 거리 ${b.mean.toFixed(1)}일)`); });
  if (arg('--scan-out')) fs.writeFileSync(arg('--scan-out'), JSON.stringify(res.slice(0, TOP).map((r, k) => ({ name: `구조${k + 1}`, rule: r.E.th(r.A.cs[0].id), spec: r.spec, stable: r.A.stable, pass: r.A.ps.length }))));
  process.exit(0);
}

// ---------- 기법 비교(--compare rules.json): 각 기법의 신호일, 최저점과의 거래일·가격 차이, 매수 후 추가 하락, 이후 수익 ----------
if (arg('--compare')) {
  const L = JSON.parse(fs.readFileSync(arg('--compare'), 'utf8')), out = [];
  const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const fwd = (i, k) => i + k < n ? C[i + k] / C[i] - 1 : NaN;
  for (const R of L) {
    const sigd = []; for (let i = 0; i < n; i++) if (R.rule.every(p => { const v = IND[p.nm][i]; return fin(v) && (p.dir === '<' ? v < p.t : v > p.t); })) sigd.push(i);
    const per = TG.map(t => {
      const ds = sigd.filter(i => tgOf[i] >= 0 && TG[tgOf[i]] === t); if (!ds.length) return { nm: t.nm, miss: true };
      const f = ds[0], after = Math.min(...Array.from({ length: n - f }, (_, j) => f + j).filter(i => dates[i] <= t.end).map(i => NDX[i]));
      const best = ds.reduce((a, i) => NDX[i] < NDX[a] ? i : a);
      const nz = t.zone.reduce((a, z) => Math.abs(f - z) < Math.abs(f - a) ? z : a); // 쌍바닥이면 가까운 바닥 기준
      return { nm: t.nm, low: dates[t.low], near: dates[nz], dNear: f - nz, first: dates[f], dFirst: f - t.low, gapFirst: NDX[f] / t.lo - 1, more: after / NDX[f] - 1, best: dates[best], gapBest: NDX[best] / t.lo - 1, r63: fwd(f, 63), r252: fwd(f, 252), all: ds.map(i => ({ d: dates[i], gap: NDX[i] / t.lo - 1, dd: i - t.zone.reduce((a, z) => Math.abs(i - z) < Math.abs(i - a) ? z : a) })) };
    });
    const other = sigd.filter(i => tgOf[i] < 0).map(i => dates[i]);
    out.push({ name: R.name, label: R.rule.map(p => `${p.nm} ${p.dir} ${fmt(p.nm, p.t)}`).join(' & '), cnt: sigd.length, other, per });
    console.log(`\n■ ${R.name} — 신호 ${sigd.length}일${other.length ? ` (바닥 밖 ${other.length}일: ${other.join(', ')})` : ''}\n  ${out.at(-1).label}`);
    console.log('  바닥 | 가까운 바닥일 | 첫 신호일 | 거래일 차이 | 첫 신호 가격(최저가 대비) | 매수 후 추가 하락 | 3개월 뒤 | 1년 뒤 | 신호 전체');
    for (const x of per) console.log(x.miss ? `  ${x.nm} | 못 맞힘` : `  ${x.nm} | ${x.near} | ${x.first} | ${x.dNear >= 0 ? '+' : ''}${x.dNear} | ${pct(x.gapFirst)} | ${pct(x.more)} | ${pct(x.r63)} | ${pct(x.r252)} | ${x.all.map(a => `${a.d}(${pct(a.gap)})`).join(' ')}`);
    const h = per.filter(x => !x.miss), av = f => h.reduce((a, x) => a + f(x), 0) / h.length;
    console.log(`  평균: 거래일 차이 ${av(x => Math.abs(x.dNear)).toFixed(1)}일 · 첫 신호 가격 ${pct(av(x => x.gapFirst))} · 추가 하락 ${pct(av(x => x.more))} (최악 ${pct(Math.min(...h.map(x => x.more)))}) · 1년 뒤 ${pct(av(x => x.r252))}`);
  }
  // 차트용: 바닥 앞뒤 가격(최저가 대비 %)
  const chart = TG.map(t => { const a = Math.max(0, Math.min(...t.zone) - 70), b = Math.min(n - 1, Math.max(...t.zone) + 70); return { nm: t.nm, low: dates[t.low], from: dates[a], to: dates[b], zone: t.zone.map(z => dates[z]), px: Array.from({ length: b - a + 1 }, (_, j) => [dates[a + j], NDX[a + j] / t.lo - 1]) }; });
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify({ techniques: out, chart }));
  process.exit(0);
}

// ---------- 탐색 ----------
const t0 = Date.now(), log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
log(`기간 ${dates[0]} ~ ${dates[n - 1]} · 지표 ${Object.keys(IND).length}개 · 조건 ${CONDS.length}개 · 바닥 ${TG.map(t => t.nm + ' ' + dates[t.low]).join(', ')}${HOLD ? ` · ${HOLD}은 숨김(검증용)` : ''}`);
const found = new Map(); // 최종 후보
const sig = b => { let h = 2166136261; for (let w = 0; w < NW; w++) h = Math.imul(h ^ b[w], 16777619); return h >>> 0; };
function consider(parts, b, e) { if (e.cov < NEED || e.fal > MAXF || e.cnt > MAXS || e.cnt === 0) return false; const k = sig(b); if (found.has(k)) { const f = found.get(k); if (parts.length < f.parts.length) f.parts = parts; return true; } const s = score(b); found.set(k, { parts, ...e, ...s, b: Uint32Array.from(b) }); return true; }
// 1개
const S1 = [];
for (const c of CONDS) { const e = evalB(c.b); if (e.cov < NEED) continue; consider([c], c.b, e); S1.push({ parts: [c], b: c.b, ...e }); }
log(`1개 조건: 모든 바닥 맞힘 ${S1.length}개 · 최종 후보 ${found.size}`);
// 2개: 모든 바닥을 맞히는 조건끼리 AND
const S2 = [];
for (let a = 0; a < S1.length; a++) for (let c = a + 1; c < S1.length; c++) {
  const A = S1[a], B = S1[c]; if (A.parts[0].nm === B.parts[0].nm) continue;
  andInto(tmp, A.b, B.b); const e = evalB(tmp); if (e.cov < NEED) continue;
  if (!consider([A.parts[0], B.parts[0]], tmp, e)) S2.push({ parts: [A.parts[0], B.parts[0]], b: Uint32Array.from(tmp), ...e });
}
log(`2개 조건: 이어갈 후보 ${S2.length}개 · 최종 후보 ${found.size}`);
if (MAXC >= 3) {
// 3개: 바닥 밖 신호가 적은 상위 2개 조합 × 모든 바닥 맞히는 조건
const rank = x => x.fal * 3 + x.cnt;
S2.sort((x, y) => rank(x) - rank(y));
const B3 = S2.slice(0, +(arg('--beam') || 4000)), S3 = [];
for (const A of B3) for (const c of S1) { const p = c.parts[0]; if (A.parts.some(q => q.nm === p.nm)) continue; andInto(tmp, A.b, p.b); const e = evalB(tmp); if (e.cov < NEED) continue; if (!consider([...A.parts, p], tmp, e)) S3.push({ parts: [...A.parts, p], b: Uint32Array.from(tmp), ...e }); }
log(`3개 조건: 이어갈 후보 ${S3.length}개 · 최종 후보 ${found.size}`);
S3.sort((x, y) => rank(x) - rank(y));
for (const A of S3.slice(0, +(arg('--beam') || 4000) / 2)) for (const c of S1) { const p = c.parts[0]; if (A.parts.some(q => q.nm === p.nm)) continue; andInto(tmp, A.b, p.b); const e = evalB(tmp); if (e.cov < NEED) continue; consider([...A.parts, p], tmp, e); }
log(`4개 조건까지 · 최종 후보 ${found.size}`);
}

// ---------- 결과 ----------
// 산 뒤 추가 하락: 바닥마다 첫 신호 이후 창 끝까지의 최저 종가가 첫 신호가보다 몇 % 더 낮았나(평균·최악)
for (const x of found.values()) { const mo = []; TG.forEach((t, k) => { const f = x.ds.find(i => tgOf[i] === k); if (f === undefined) return; let m = Infinity; for (let i = f; i < n && dates[i] <= t.end; i++) m = Math.min(m, NDX[i]); mo.push(m / NDX[f] - 1); }); x.avgDD = mo.reduce((a, b) => a + b, 0) / mo.length; x.worstDD = Math.min(...mo); }
const RANK = arg('--rank') || (PEAK ? 'gap' : '');
for (const x of found.values()) { const gp = []; TG.forEach((t, k) => { const f = x.ds.find(i => tgOf[i] === k); if (f !== undefined) gp.push(Math.abs(NDX[f] / t.lo - 1)); }); x.avgGap = gp.reduce((a, b) => a + b, 0) / gp.length; x.worstGap = Math.max(...gp); }
const res = [...found.values()].sort((x, y) => RANK === 'gap' ? (x.fal - y.fal || x.avgGap - y.avgGap || x.mean - y.mean) : RANK === 'drop' ? (y.avgDD - x.avgDD || x.mean - y.mean) : x.fal - y.fal || x.mean - y.mean || x.parts.length - y.parts.length || x.max - y.max);
console.log(`QQQ 폭락장 ${PEAK ? '고점' : '바닥'} 신호 탐색 · ${dates[0]} ~ ${dates[n - 1]} · 지표 ${Object.keys(IND).length}개 · 조건 ${CONDS.length}개 · 신호 ≤ ${MAXS}일 · ${PEAK ? '고점' : '바닥'} ±${WIN}거래일 밖 신호 ≤ ${MAXF}개${HOLD ? ` · ${HOLD} 바닥은 정답에서 숨기고 탐색` : ''}`);
console.log((PEAK ? '고점(나스닥100 종가 최고): ' : '바닥(나스닥100 종가 최저): ') + TG.map(t => `${t.nm}=${dates[t.low]}${t.zone.length > 1 ? `(1% 이내 ${t.zone.filter(z => z !== t.low).map(z => dates[z]).join('·')})` : ''}`).join(', '));
console.log(`후보 ${res.length}개 · 평균 거리(거래일) 순`);
const showDay = i => { const t = tgOf[i] >= 0 ? TG[tgOf[i]] : null; const lowP = t ? (NDX[i] / t.lo - 1) * 100 : NaN; const d = t ? i - t.zone.reduce((a, z) => Math.abs(i - z) < Math.abs(i - a) ? z : a) : NaN; return `${dates[i]}(${t ? t.nm : (PEAK ? '고점 밖' : '바닥 밖')}${t ? ` ${d >= 0 ? '+' : ''}${d}일, ${PEAK ? '최고점 대비 ' + lowP.toFixed(1) : '최저가 +' + lowP.toFixed(1)}%` : ''})`; };
res.slice(0, TOPN).forEach((x, k) => console.log(`${k + 1}. ${x.parts.map(p => p.label).join(' & ')}\n    신호 ${x.cnt}일 · 평균 ${x.mean.toFixed(1)}일 · 최대 ${x.max}일 · ${PEAK ? `첫 신호가 고점 대비 평균 -${(x.avgGap * 100).toFixed(1)}% (최악 -${(x.worstGap * 100).toFixed(1)}%) · 신호 뒤 하락(고점 이후 최저까지) 평균 ` : '산 뒤 추가 하락 평균 '} ${(x.avgDD * 100).toFixed(1)}% 최악 ${(x.worstDD * 100).toFixed(1)}% → ${x.ds.map(showDay).join(', ')}`));
if (HOLD) { const k = TG.findIndex(t => t.nm === HOLD); const hit = res.filter(x => x.ds.some(i => tgOf[i] === k)); console.log(`\n[검증] ${HOLD} 바닥을 숨기고 찾은 후보 ${res.length}개 중 ${HOLD} 바닥(±${WIN}일)에도 신호가 켜진 것 ${hit.length}개 (${res.length ? (hit.length / res.length * 100).toFixed(0) : 0}%)`); hit.slice(0, 5).forEach(x => console.log(`  - ${x.parts.map(p => p.label).join(' & ')} → ${x.ds.map(showDay).join(', ')}`)); }
const out = arg('--out'); if (out) fs.writeFileSync(out, JSON.stringify(res.slice(0, 200).map(x => ({ rule: x.parts.map(p => ({ nm: p.nm, dir: p.dir, t: p.t })), label: x.parts.map(p => p.label).join(' & '), days: x.ds.map(i => dates[i]), mean: x.mean, max: x.max })), null, 1));
