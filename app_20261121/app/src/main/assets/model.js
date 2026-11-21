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

  // 유사 낙폭 사건 방식: 현재와 비슷한 낙폭(±5%p)이었던 과거 시점을 전고점(에피소드) 단위 동일 가중으로 모음
  function analogs(c) {
    var n = c.length, peak = new Float64Array(n), pk = new Int32Array(n), dd = new Float64Array(n), mx = -Infinity, cur = 0, i, s;
    for (i = 0; i < n; i++) { if (c[i] > mx) mx = c[i]; peak[i] = mx; dd[i] = c[i] / mx - 1; if (c[i] >= mx - 1e-12) cur = i; pk[i] = cur; }
    var ups = []; for (i = 0; i < n; i++) if (pk[i] === i) ups.push(i);
    var Rec = {}; for (i = 0; i + 1 < ups.length; i++) Rec[ups[i]] = ups[i + 1];   // 전고점 -> 회복(다음 신고가) 인덱스
    var CAP = 1260, now = dd[n - 1], lastP = c[n - 1], cand = [];
    for (s = 0; s < n - 1; s++) if (Math.abs(dd[s] - now) <= 0.05 && dd[s] < -0.01) cand.push(s);

    function weights(list) {
      var cnt = {}; list.forEach(function (s) { cnt[pk[s]] = (cnt[pk[s]] || 0) + 1; });
      return { w: list.map(function (s) { return 1 / cnt[pk[s]]; }), ne: Object.keys(cnt).length };
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

    // 전고점 회복 전 최저점 + 탈환 기간 (결과가 확정된 사건만)
    var known = cand.filter(function (s) { return Rec[pk[s]] !== undefined; }), wk = weights(known);
    var Fv = known.map(function (s) { return minOver(s, Math.min(Rec[pk[s]], s + CAP)); });
    var Dv = known.map(function (s) { return Math.min(Rec[pk[s]] - s, CAP); });
    var until = { levels: {}, prices: {}, exceed: {}, rec: {}, dq: {} };
    [0.5, 0.75, 0.9].forEach(function (p) { var l = wq(Fv, wk.w, 1 - p); until.levels[p] = l; until.prices[p] = lastP * (1 + l); });
    [-0.05, -0.10, -0.15, -0.20, -0.30].forEach(function (x) { until.exceed[x] = shareLE(Fv, wk.w, x); });
    [21, 63, 126, 252].forEach(function (h) { until.rec[h] = shareLE(Dv, wk.w, h); });
    [0.25, 0.5, 0.75, 0.9].forEach(function (q) { until.dq[q] = wq(Dv, wk.w, q); });
    // 1/3/6개월 내 최저점
    var hz = {};
    [21, 63, 126].forEach(function (h) {
      var ss = cand.filter(function (s) { return s + h <= n - 1; }), wh = weights(ss);
      var v = ss.map(function (s) { return minOver(s, s + h); }), o = { levels: {}, prices: {}, exceed: {}, episodes: wh.ne };
      [0.5, 0.75, 0.9].forEach(function (p) { var l = wq(v, wh.w, 1 - p); o.levels[p] = l; o.prices[p] = lastP * (1 + l); });
      [-0.05, -0.10, -0.20].forEach(function (x) { o.exceed[x] = shareLE(v, wh.w, x); });
      hz[h] = o;
    });
    return { now: now, lastP: lastP, episodes: wk.ne, samples: known.length, cap: CAP, until: until, hz: hz };
  }
  root.NDXModel = { forecast: forecast, features: features, analogs: analogs, QS: QS, KEY: KEY, GRID: GRID };
  if (typeof module !== 'undefined') module.exports = root.NDXModel;
})(typeof window !== 'undefined' ? window : globalThis);
