// NDX 확률 예측 모델 (가격만 사용). 브라우저/노드 공용.
// 검증에서 채택된 방식만 남김: (1) 변동성 보정 수익률 분포 (2) 유사 낙폭 사건 기반 바닥·전고점 탈환 예측
(function (root) {
  var QS = [0.05, 0.25, 0.5, 0.75, 0.95];
  var START_V = 300;                     // 변동성 보정 분포 표본 시작(검증 실험과 동일)
  var KEY = [21, 63, 126, 252, 756];
  var GRID = [];
  for (var g = 21; g <= 756; g += 21) GRID.push(g);

  function quantile(s, q) {
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function sortNum(a) { return Float64Array.from(a).sort(); }

  function features(c) {
    var n = c.length, lp = new Float64Array(n), i;
    for (i = 0; i < n; i++) lp[i] = Math.log(c[i]);
    var dd = new Float64Array(n).fill(NaN), z = new Float64Array(n).fill(NaN),
        r = new Float64Array(n).fill(NaN), v = new Float64Array(n).fill(NaN);
    var mx = -Infinity, sum = 0;
    for (i = 0; i < n; i++) {
      if (c[i] > mx) mx = c[i];
      dd[i] = c[i] / mx - 1;
      sum += c[i]; if (i >= 200) sum -= c[i - 200];
      if (i >= 199) z[i] = c[i] / (sum / 200) - 1;
      if (i >= 252) r[i] = c[i] / c[i - 252] - 1;
      if (i >= 63) {
        var m = 0, j;
        for (j = i - 62; j <= i; j++) m += lp[j] - lp[j - 1];
        m /= 63; var s2 = 0;
        for (j = i - 62; j <= i; j++) { var d = lp[j] - lp[j - 1] - m; s2 += d * d; }
        v[i] = Math.sqrt(s2 / 62) * Math.sqrt(252);
      }
    }
    return { lp: lp, dd: dd, z: z, r: r, v: v };
  }

  function stats(y) { // y: 로그수익률 배열
    var s = sortNum(y), n = s.length, a = 0, b = 0, c10 = 0, c20 = 0;
    for (var i = 0; i < n; i++) {
      var x = Math.exp(s[i]) - 1;
      if (x < 0) a++; if (x < -0.10) b++; if (x > 0.10) c10++; if (x > 0.20) c20++;
    }
    return { n: n, q: QS.map(function (q) { return Math.exp(quantile(s, q)) - 1; }),
             pLoss: a / n, pLtM10: b / n, pGt10: c10 / n, pGt20: c20 / n };
  }

  // 변동성 보정(드리프트 고정): y = 중앙값 + z * σ_now * sqrt(h/252), z = (y-중앙값)/(σ_t*sqrt(h/252))
  function forecast(c) {
    var n = c.length, F = features(c), lp = F.lp, last = n - 1;
    var state = [F.dd[last], F.z[last], F.r[last], F.v[last]];
    var out = { n: n, last: last, state: { dd: state[0], z200: state[1], r252: state[2], vol63: state[3] },
                grid: GRID, vol: {}, keyStats: {}, samp: { vol: {} } };
    GRID.forEach(function (h) {
      var yv = [], zs = [], sc = Math.sqrt(h / 252), t2;
      for (t2 = START_V; t2 + h <= last; t2++) yv.push(lp[t2 + h] - lp[t2]);
      var med = quantile(sortNum(yv), 0.5);
      for (var a = 0, t3 = START_V; a < yv.length; a++, t3++) zs.push((yv[a] - med) / (F.v[t3] * sc));
      var szs = sortNum(zs), yvs = zs.map(function (z) { return med + z * state[3] * sc; });
      out.vol[h] = QS.map(function (q) { return med + quantile(szs, q) * state[3] * sc; });
      out.samp.vol[h] = sortNum(yvs);   // 히트맵(확률 밀도)용 표본
      if (KEY.indexOf(h) >= 0) out.keyStats[h] = { vol: stats(yvs) };
    });
    return out;
  }

  // 유사 낙폭 사건 방식 (검증 채택, 2000·2008 포함·예외/상한 없음):
  // 낙폭 = 최근 1년(252거래일) 고점 대비. 현재와 비슷한 낙폭(±5%p)이면서 하락 중(최근 20일 최저 낙폭 +3%p 이내)이었던 과거 시점을
  // 사건(연속 구간) 단위 동일 가중으로 모음 -> 고점 회복 전 최저점, 1/3/6개월 내 최저점, 고점 탈환 확률·기간
  function analogs(c) {
    var n = c.length, H = new Float64Array(n).fill(NaN), dd = new Float64Array(n).fill(NaN), i, s, u;
    for (i = 251; i < n; i++) { var m = -Infinity; for (u = i - 251; u <= i; u++) if (c[u] > m) m = c[u]; H[i] = m; dd[i] = c[i] / m - 1; }
    var now = dd[n - 1], lastP = c[n - 1], cache = {};
    function rec(s) {   // s 시점 고점(H[s]) 탈환 인덱스, 없으면 -1
      if (cache[s] === undefined) { var r = -1; for (var u = s + 1; u < n; u++) if (c[u] >= H[s]) { r = u; break; } cache[s] = r; }
      return cache[s];
    }
    function clusters(idx, gap) {   // 시간순 시점을 사건(간격 gap 이하 연속 구간)으로 묶고 시점별 가중치(사건당 합 1) 반환
      idx = idx.slice().sort(function (a, b) { return a - b; });
      var cid = [], cur = -1, prev = null, cnt = {};
      idx.forEach(function (s) { if (prev === null || s - prev > gap) cur++; cid.push(cur); prev = s; cnt[cur] = (cnt[cur] || 0) + 1; });
      return { idx: idx, w: cid.map(function (k) { return 1 / cnt[k]; }), ne: cur + 1 };
    }
    function wq(v, w, q) {
      var a = v.map(function (x, k) { return [x, w[k]]; }).sort(function (p, r) { return p[0] - r[0]; }), tot = 0, k;
      a.forEach(function (e) { tot += e[1]; });
      var cw = 0, target = q * tot - 1e-12;
      for (k = 0; k < a.length; k++) { cw += a[k][1]; if (cw >= target) return a[k][0]; }
      return a[a.length - 1][0];
    }
    function shareLE(v, w, x) { var a = 0, t = 0; v.forEach(function (y, k) { t += w[k]; if (y <= x) a += w[k]; }); return a / t; }
    function minOver(s, end) { var m = c[s]; for (var u = s; u <= end; u++) if (c[u] < m) m = c[u]; return m / c[s] - 1; }

    var base = [];
    for (s = 252; s < n - 1; s++) {
      if (!(Math.abs(dd[s] - now) <= 0.05 && dd[s] < -0.01)) continue;
      var mn = Infinity; for (u = Math.max(252, s - 20); u <= s; u++) if (dd[u] < mn) mn = dd[u];
      if (dd[s] <= mn + 0.03) base.push(s);
    }
    var known = base.filter(function (s) { return rec(s) >= 0; }), K = clusters(known, 63);
    var Fv = K.idx.map(function (s) { return minOver(s, rec(s)); }), Dv = K.idx.map(function (s) { return rec(s) - s; });
    var until = { levels: {}, prices: {}, exceed: {}, rec: {}, dq: {} };
    [0.5, 0.75, 0.9].forEach(function (p) { var l = wq(Fv, K.w, 1 - p); until.levels[p] = l; until.prices[p] = lastP * (1 + l); });
    [-0.05, -0.10, -0.15, -0.20, -0.30].forEach(function (x) { until.exceed[x] = shareLE(Fv, K.w, x); });
    [21, 63, 126, 252].forEach(function (h) { until.rec[h] = shareLE(Dv, K.w, h); });
    [0.25, 0.5, 0.75, 0.9].forEach(function (q) { until.dq[q] = wq(Dv, K.w, q); });
    var hz = {};
    [21, 63, 126].forEach(function (h) {
      var C = clusters(base.filter(function (s) { return s + h <= n - 1; }), 63), v = C.idx.map(function (s) { return minOver(s, s + h); });
      var o = { levels: {}, prices: {}, exceed: {}, events: C.ne };
      [0.5, 0.75, 0.9].forEach(function (p) { var l = wq(v, C.w, 1 - p); o.levels[p] = l; o.prices[p] = lastP * (1 + l); });
      [-0.05, -0.10, -0.20].forEach(function (x) { o.exceed[x] = shareLE(v, C.w, x); });
      hz[h] = o;
    });
    return { now: now, lastP: lastP, episodes: K.ne, samples: K.idx.length, until: until, hz: hz };
  }
  root.NDXModel = { forecast: forecast, features: features, analogs: analogs, QS: QS, KEY: KEY, GRID: GRID };
  if (typeof module !== 'undefined') module.exports = root.NDXModel;
})(typeof window !== 'undefined' ? window : globalThis);
