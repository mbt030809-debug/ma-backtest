// NDX 확률 예측 모델 (가격만 사용). 브라우저/노드 공용.
(function (root) {
  var QS = [0.05, 0.25, 0.5, 0.75, 0.95];
  var SC = [0.15, 0.10, 0.30, 0.10];     // 거리 스케일: 낙폭, 200일선 이격, 1년 상승률, 변동성
  var START = 252;                       // 1985년 데이터부터 사용(특성 계산 가능 시점)
  var START_V = 300;                     // 변동성 보정 분포 표본 시작(검증 실험과 동일)
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
                grid: GRID, uncond: {}, knn: {}, vol: {}, keyStats: {}, samp: { uncond: {}, knn: {}, vol: {} } };
    GRID.forEach(function (h) {
      var yu = [], yk = [], ts = [], t2;
      for (t2 = START; t2 + h <= last; t2++) yu.push(lp[t2 + h] - lp[t2]);
      // 변동성 보정(드리프트 고정): y = 중앙값 + z * σ_now * sqrt(h/252), z = (y-중앙값)/(σ_t*sqrt(h/252))
      var yv = [], zs = [], sc = Math.sqrt(h / 252);
      for (t2 = START_V; t2 + h <= last; t2++) yv.push(lp[t2 + h] - lp[t2]);
      var med = quantile(sortNum(yv), 0.5);
      for (var a = 0, t3 = START_V; a < yv.length; a++, t3++) zs.push((yv[a] - med) / (F.v[t3] * sc));
      var szs = sortNum(zs), yvs = zs.map(function (z) { return med + z * state[3] * sc; });
      out.vol[h] = QS.map(function (q) { return med + quantile(szs, q) * state[3] * sc; });
      for (var o = 0; o < order.length && yk.length < K; o++) {
        t2 = idx[order[o]];
        if (t2 + h <= last) { yk.push(lp[t2 + h] - lp[t2]); ts.push(t2); }
      }
      var su = sortNum(yu), sk = sortNum(yk);
      out.uncond[h] = QS.map(function (q) { return quantile(su, q); });
      out.knn[h] = QS.map(function (q) { return quantile(sk, q); });
      out.samp.uncond[h] = su; out.samp.knn[h] = sk; out.samp.vol[h] = sortNum(yvs);   // 히트맵(확률 밀도)용 표본
      if (KEY.indexOf(h) >= 0) {
        ts.sort(function (a, b) { return a - b; });
        var ep = 0; for (var i = 0; i < ts.length; i++) if (i === 0 || ts[i] - ts[i - 1] > 42) ep++;
        out.keyStats[h] = { uncond: stats(yu), knn: stats(yk), vol: stats(yvs), episodes: ep };
      }
    });
    return out;
  }

  // 낙폭 회복 분석: 현재와 비슷한 낙폭(±5%p) 시점들, 전고점(에피소드) 단위 동일 가중
  function recovery(c) {
    var n = c.length, peak = new Float64Array(n), pk = new Int32Array(n), dd = new Float64Array(n), mx = -Infinity, cur = 0, i, t;
    for (i = 0; i < n; i++) { if (c[i] > mx) mx = c[i]; peak[i] = mx; dd[i] = c[i] / mx - 1; if (c[i] >= mx - 1e-12) cur = i; pk[i] = cur; }
    var now = dd[n - 1], eps = {}, matched = 0;
    for (t = 0; t < n - 1; t++) if (Math.abs(dd[t] - now) <= 0.05 && dd[t] < -0.01) { (eps[pk[t]] = eps[pk[t]] || []).push(t); matched++; }
    var HZR = [126, 252, 504, 756], FUR = [-0.10, -0.20, -0.30], res = {}, fur = {};
    HZR.forEach(function (h) { res[h] = [0, 0]; }); FUR.forEach(function (x) { fur[x] = [0, 0]; });
    var keys = Object.keys(eps);
    keys.forEach(function (k) {
      var ts = eps[k], w = 1 / ts.length;
      ts.forEach(function (t) {
        var r = -1, u; for (u = t + 1; u < n; u++) if (c[u] >= peak[t]) { r = u; break; }
        HZR.forEach(function (h) {
          var ok = (r >= 0 && r - t <= h);
          if (ok || t + h <= n - 1) { res[h][0] += w * (ok ? 1 : 0); res[h][1] += w; }
        });
        var mn = Infinity; for (u = t + 1; u < Math.min(n, t + 253); u++) if (c[u] < mn) mn = c[u];
        mn = mn / c[t] - 1;
        if (t + 252 <= n - 1 || mn <= -0.10) FUR.forEach(function (x) {
          if (t + 252 <= n - 1 || mn <= x) { fur[x][0] += w * (mn <= x ? 1 : 0); fur[x][1] += w; }
        });
      });
    });
    var rec = {}, further = {};
    HZR.forEach(function (h) { rec[h] = res[h][1] ? res[h][0] / res[h][1] : null; });
    FUR.forEach(function (x) { further[x] = fur[x][1] ? fur[x][0] / fur[x][1] : null; });
    return { now: now, episodes: keys.length, matched: matched, rec: rec, further: further };
  }
  root.NDXModel = { forecast: forecast, features: features, recovery: recovery, QS: QS, KEY: KEY, GRID: GRID };
  if (typeof module !== 'undefined') module.exports = root.NDXModel;
})(typeof window !== 'undefined' ? window : globalThis);
