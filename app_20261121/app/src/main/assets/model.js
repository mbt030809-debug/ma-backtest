// NDX 확률 예측 모델 (가격만 사용). 브라우저/노드 공용.
(function (root) {
  var QS = [0.05, 0.25, 0.5, 0.75, 0.95];
  var SC = [0.15, 0.10, 0.30, 0.10];     // 거리 스케일: 낙폭, 200일선 이격, 1년 상승률, 변동성
  var START = 252;                       // 1985년 데이터부터 사용(특성 계산 가능 시점)
  var K = 250;
  var KEY = [126, 252, 756];
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

  function forecast(c) {
    var n = c.length, F = features(c), lp = F.lp, last = n - 1;
    var state = [F.dd[last], F.z[last], F.r[last], F.v[last]];
    // 거리 사전 계산 (표본: START..n-2)
    var idx = [], dist = [];
    for (var t = START; t < n - 1; t++) {
      var d = 0;
      d += Math.pow((F.dd[t] - state[0]) / SC[0], 2);
      d += Math.pow((F.z[t] - state[1]) / SC[1], 2);
      d += Math.pow((F.r[t] - state[2]) / SC[2], 2);
      d += Math.pow((F.v[t] - state[3]) / SC[3], 2);
      idx.push(t); dist.push(d);
    }
    var order = idx.map(function (_, i) { return i; }).sort(function (a, b) { return dist[a] - dist[b]; });
    var out = { n: n, last: last, state: { dd: state[0], z200: state[1], r252: state[2], vol63: state[3] },
                grid: GRID, uncond: {}, knn: {}, keyStats: {} };
    GRID.forEach(function (h) {
      var yu = [], yk = [], ts = [], t2;
      for (t2 = START; t2 + h <= last; t2++) yu.push(lp[t2 + h] - lp[t2]);
      for (var o = 0; o < order.length && yk.length < K; o++) {
        t2 = idx[order[o]];
        if (t2 + h <= last) { yk.push(lp[t2 + h] - lp[t2]); ts.push(t2); }
      }
      var su = sortNum(yu), sk = sortNum(yk);
      out.uncond[h] = QS.map(function (q) { return quantile(su, q); });
      out.knn[h] = QS.map(function (q) { return quantile(sk, q); });
      if (KEY.indexOf(h) >= 0) {
        ts.sort(function (a, b) { return a - b; });
        var ep = 0; for (var i = 0; i < ts.length; i++) if (i === 0 || ts[i] - ts[i - 1] > 42) ep++;
        out.keyStats[h] = { uncond: stats(yu), knn: stats(yk), episodes: ep };
      }
    });
    return out;
  }
  root.NDXModel = { forecast: forecast, features: features, QS: QS, KEY: KEY, GRID: GRID };
  if (typeof module !== 'undefined') module.exports = root.NDXModel;
})(typeof window !== 'undefined' ? window : globalThis);
