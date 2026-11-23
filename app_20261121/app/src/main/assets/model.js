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

  // 케이스: opt.excl 이면 닷컴(2000-03~2002-12)·금융위기(2007-10~2009-06) 기간과 경로가 겹치는 표본은 사용하지 않음 (포함 케이스는 예외 없음)
  var CRISES = [['2000-03-01', '2002-12-31'], ['2007-10-01', '2009-06-30']];
  function mkOv(opt, n) {
    if (!opt || !opt.excl || !opt.dates) return function () { return false; };
    var cs = new Int32Array(n + 1), i, k, inx;
    for (i = 0; i < n; i++) {
      inx = 0; for (k = 0; k < CRISES.length; k++) if (opt.dates[i] >= CRISES[k][0] && opt.dates[i] <= CRISES[k][1]) inx = 1;
      cs[i + 1] = cs[i] + inx;
    }
    return function (a, b) { return cs[Math.min(b, n - 1) + 1] - cs[a] > 0; };
  }

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
  function forecast(c, opt) {
    var n = c.length, F = features(c), lp = F.lp, last = n - 1, ov = mkOv(opt, n);
    var state = [F.dd[last], F.z[last], F.r[last], F.v[last]];
    var out = { n: n, last: last, state: { dd: state[0], z200: state[1], r252: state[2], vol63: state[3] },
                grid: GRID, vol: {}, keyStats: {}, samp: { vol: {} } };
    GRID.forEach(function (h) {
      var yv = [], zs = [], tv = [], sc = Math.sqrt(h / 252), t2;
      for (t2 = START_V; t2 + h <= last; t2++) { if (ov(t2, t2 + h)) continue; yv.push(lp[t2 + h] - lp[t2]); tv.push(t2); }
      var med = quantile(sortNum(yv), 0.5);
      for (var a = 0; a < yv.length; a++) zs.push((yv[a] - med) / (F.v[tv[a]] * sc));
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
  function analogs(c, opt) {
    var ov = mkOv(opt, c.length);
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
    var known = base.filter(function (s) { return rec(s) >= 0 && !ov(s, rec(s)); }), K = clusters(known, 63);
    var Fv = K.idx.map(function (s) { return minOver(s, rec(s)); }), Dv = K.idx.map(function (s) { return rec(s) - s; });
    var until = { levels: {}, prices: {}, exceed: {}, rec: {}, dq: {} };
    [0.5, 0.75, 0.9].forEach(function (p) { var l = wq(Fv, K.w, 1 - p); until.levels[p] = l; until.prices[p] = lastP * (1 + l); });
    [-0.05, -0.10, -0.15, -0.20, -0.30].forEach(function (x) { until.exceed[x] = shareLE(Fv, K.w, x); });
    [21, 63, 126, 252].forEach(function (h) { until.rec[h] = shareLE(Dv, K.w, h); });
    [0.25, 0.5, 0.75, 0.9].forEach(function (q) { until.dq[q] = wq(Dv, K.w, q); });
    var hz = {};
    [21, 63, 126].forEach(function (h) {
      var C = clusters(base.filter(function (s) { return s + h <= n - 1 && !ov(s, s + h); }), 63), v = C.idx.map(function (s) { return minOver(s, s + h); });
      var o = { levels: {}, prices: {}, exceed: {}, events: C.ne };
      [0.5, 0.75, 0.9].forEach(function (p) { var l = wq(v, C.w, 1 - p); o.levels[p] = l; o.prices[p] = lastP * (1 + l); });
      [-0.05, -0.10, -0.20].forEach(function (x) { o.exceed[x] = shareLE(v, C.w, x); });
      hz[h] = o;
    });
    return { now: now, lastP: lastP, episodes: K.ne, samples: K.idx.length, until: until, hz: hz };
  }
  // ---------- 엘리어트 파동 자동 카운트 (규칙 고정, 미래 정보 없음) ----------
  // 지그재그: 로그가격이 직전 극점에서 theta 이상 반전해야 그 극점을 확정 꼭짓점으로 확정
  function zigzag(lp, theta) {
    var n = lp.length, piv = [], d = 0, hi = [0, lp[0]], lo = [0, lp[0]], ext = null, t;
    for (t = 1; t < n; t++) {
      if (d === 0) {
        if (lp[t] > hi[1]) hi = [t, lp[t]];
        if (lp[t] < lo[1]) lo = [t, lp[t]];
        if (lp[t] - lo[1] >= theta) { piv.push({ i: lo[0], v: lo[1], type: 'L', conf: t }); d = 1; ext = [t, lp[t]]; }
        else if (hi[1] - lp[t] >= theta) { piv.push({ i: hi[0], v: hi[1], type: 'H', conf: t }); d = -1; ext = [t, lp[t]]; }
      } else if (d === 1) {
        if (lp[t] > ext[1]) ext = [t, lp[t]];
        else if (ext[1] - lp[t] >= theta) { piv.push({ i: ext[0], v: ext[1], type: 'H', conf: t }); d = -1; ext = [t, lp[t]]; }
      } else {
        if (lp[t] < ext[1]) ext = [t, lp[t]];
        else if (lp[t] - ext[1] >= theta) { piv.push({ i: ext[0], v: ext[1], type: 'L', conf: t }); d = 1; ext = [t, lp[t]]; }
      }
    }
    return piv;
  }
  function rulesOk(j, v) {
    if (j === 1) return v[1] > v[0];
    if (j === 2) return v[2] > v[0];
    if (j === 3) return v[3] > v[1];
    if (j === 4) return v[4] > v[1] && (v[3] - v[2]) >= (v[1] - v[0]);
    var w1 = v[1] - v[0], w3 = v[3] - v[2], w5 = v[5] - v[4];
    return v[5] > v[3] && w3 >= Math.min(w1, w5) && (w3 >= w1 || w3 >= w5);
  }
  function elliott(c, theta, ratios) {
    var R3_ = (ratios && ratios.r3) || 1.618, R5_ = (ratios && ratios.r5) || 0.618;
    var n = c.length, lp = new Float64Array(n), i, j, k;
    for (i = 0; i < n; i++) lp[i] = Math.log(c[i]);
    var piv = zigzag(lp, theta), m = piv.length, last = lp[n - 1], best = null;
    [1, -1].forEach(function (sgn) {
      var want0 = sgn === 1 ? 'L' : 'H';
      for (var i0 = Math.max(0, m - 14); i0 < m; i0++) {
        if (piv[i0].type !== want0) continue;
        var v = [], J = 0;
        for (k = i0; k < m; k++) v.push(sgn * piv[k].v);
        for (j = 1; j <= Math.min(5, v.length - 1); j++) { if (!rulesOk(j, v)) break; J = j; }
        if (J === 0 || i0 + J !== m - 1) continue;
        var vl = sgn * last;
        if (((J === 1 || J === 2) && vl <= v[0]) || ((J === 3 || J === 4) && vl <= v[1])) continue;
        if (best === null || J > best.J || (J === best.J && sgn === 1 && best.sgn !== 1)) best = { sgn: sgn, i0: i0, J: J };
      }
    });
    var out = { theta: theta, piv: piv, count: null, live: c[n - 1], r3: R3_, r5: R5_ };
    if (best) {
      var sg = best.sgn, vv = [], pts = [];
      for (k = best.i0; k <= best.i0 + best.J; k++) { vv.push(sg * piv[k].v); pts.push(piv[k].i); }
      var ex = function (x) { return Math.exp(sg * x); }, J2 = best.J, cn = { sgn: sg, J: J2, i0: best.i0, pts: pts };
      if (J2 === 1) { cn.levels = [[0.5, ex(vv[1] - 0.5 * (vv[1] - vv[0]))], [0.618, ex(vv[1] - 0.618 * (vv[1] - vv[0]))], [0.786, ex(vv[1] - 0.786 * (vv[1] - vv[0]))]]; cn.invalid = ex(vv[0]); }
      if (J2 === 2) { cn.target = ex(vv[2] + R3_ * (vv[1] - vv[0])); cn.invalid = ex(vv[0]); }
      if (J2 === 3) {
        cn.levels = [0.236, 0.382, 0.5].map(function (r) { return [r, ex(vv[3] - r * (vv[3] - vv[2]))]; }); cn.invalid = ex(vv[1]);
        cn.retr = (vv[3] - sg * last) / (vv[3] - vv[2]); cn.w5 = ex(vv[3] - 0.382 * (vv[3] - vv[2]) + R5_ * (vv[3] - vv[0]));
        cn.p4 = ex(vv[3] - 0.382 * (vv[3] - vv[2]));
      }
      if (J2 === 4) { cn.target = ex(vv[4] + R5_ * (vv[3] - vv[0])); cn.invalid = ex(vv[1]); }
      if (J2 === 5) cn.levels = [0.382, 0.5, 0.618].map(function (r) { return [r, ex(vv[5] - r * (vv[5] - vv[0]))]; });
      out.count = cn;
    }
    return out;
  }

  // ---------- 적응형 '주관' 선택: 설정(θ, 3파 배수, 5파 배수) 36가지 중 과거 결과가 확정된 신호의 성적(기준선 대비 lift)이 좋은 설정 ----------
  var A_THETAS = [0.06, 0.08, 0.10, 0.12, 0.15, 0.18], A_R3 = [1.0, 1.618], A_R5 = [0.382, 0.618, 1.0], MAXH = 504, A_K = 10, A_MINN = 6;
  function elSignals(piv, stage, r) {
    var ev = [];
    [1, -1].forEach(function (sgn) {
      var want0 = sgn === 1 ? 'L' : 'H';
      for (var k = 0; k < piv.length; k++) {
        if (stage === 'W3' && k >= 2 && piv[k - 2].type === want0 && piv[k].type === want0) {
          var v = [sgn * piv[k - 2].v, sgn * piv[k - 1].v, sgn * piv[k].v];
          if (v[2] > v[0] && v[1] > v[0]) ev.push({ t: piv[k].conf, sgn: sgn, T: v[2] + r * (v[1] - v[0]), I: v[0] });
        }
        if (stage === 'W5' && k >= 4 && piv[k - 4].type === want0 && piv[k].type === want0) {
          var w = []; for (var j = k - 4; j <= k; j++) w.push(sgn * piv[j].v);
          if (w[2] > w[0] && w[3] > w[1] && w[4] > w[1] && (w[3] - w[2]) >= (w[1] - w[0])) ev.push({ t: piv[k].conf, sgn: sgn, T: w[4] + r * (w[3] - w[0]), I: w[1] });
        }
      }
    });
    return ev;
  }
  function baseHit(lp, t0, dT, dI, sgn) {   // 같은 거리의 무작위 시점(3일 간격, 그 시점까지 결과 확정분)에서 목표를 무효보다 먼저 맞힌 비율
    var m = Math.floor((t0 - MAXH) / 3) + 1; if (m < 150) return NaN;
    var hits = 0;
    for (var q = 0; q < m; q++) {
      var s0 = q * 3, b0 = lp[s0];
      for (var u = 1; u <= MAXH; u++) { var r = sgn * (lp[s0 + u] - b0); if (r >= dT) { hits++; break; } if (r <= -dI) break; }
    }
    return hits / m;
  }
  function adaptiveStart(c, baseCache) {
    var n = c.length, lp = new Float64Array(n), tasks = [];
    for (var i = 0; i < n; i++) lp[i] = Math.log(c[i]);
    A_THETAS.forEach(function (th) {
      A_R3.forEach(function (r) { tasks.push({ th: th, stage: 'W3', r: r }); });
      A_R5.forEach(function (r) { tasks.push({ th: th, stage: 'W5', r: r }); });
    });
    return { n: n, lp: lp, tasks: tasks, done: 0, zz: {}, ev: {}, cache: baseCache || {} };
  }
  // 시간 예산(ms) 안에서 작업을 진행하고 끝났으면 true
  function adaptiveRun(st, budgetMs) {
    var t00 = Date.now(), n = st.n, lp = st.lp;
    while (st.done < st.tasks.length && Date.now() - t00 < budgetMs) {
      var tk = st.tasks[st.done], key = tk.th + '|' + tk.stage + '|' + tk.r;
      if (!st.zz[tk.th]) st.zz[tk.th] = zigzag(lp, tk.th);
      var out = [];
      elSignals(st.zz[tk.th], tk.stage, tk.r).forEach(function (e) {
        var t0 = e.t, cur = e.sgn * lp[t0];
        if (!(e.T > cur && e.I < cur) || t0 + MAXH > n - 1) return;
        var dT = e.T - cur, dI = cur - e.I, fu = 1e9, fd = 1e9, u;
        for (u = 0; u <= MAXH; u++) { var r = e.sgn * (lp[t0 + u] - lp[t0]); if (fu === 1e9 && r >= dT) fu = u; if (fd === 1e9 && r <= -dI) fd = u; if (fu < 1e9 || fd < 1e9) break; }
        var bk = key + '|' + e.sgn + '|' + t0, b = st.cache[bk];
        if (b === undefined) { b = baseHit(lp, t0, dT, dI, e.sgn); st.cache[bk] = b; }
        if (!isFinite(b) || b !== b) return;
        out.push({ t: t0, hit: fu < fd ? 1 : 0, tres: t0 + (Math.min(fu, fd) < 1e9 ? Math.min(fu, fd) : MAXH), base: b });
      });
      st.ev[key] = out; st.done++;
    }
    return st.done >= st.tasks.length;
  }
  function adaptiveResult(st) {
    var cfgs = [];
    A_THETAS.forEach(function (th) { A_R3.forEach(function (r3) { A_R5.forEach(function (r5) {
      var e = (st.ev[th + '|W3|' + r3] || []).concat(st.ev[th + '|W5|' + r5] || []).filter(function (x) { return x.tres <= st.n - 1; });
      if (e.length < A_MINN) return;
      var lift = 0; e.forEach(function (x) { lift += x.hit - x.base; }); lift /= e.length;
      cfgs.push({ th: th, r3: r3, r5: r5, n: e.length, lift: lift, shrunk: lift * e.length / (e.length + A_K) });
    }); }); });
    cfgs.sort(function (a, b) { return b.shrunk - a.shrunk; });   // 안정 정렬(동점은 설정 순서 유지)
    return { best: cfgs[0] || null, top: cfgs.slice(0, 5), count: cfgs.length };
  }
  root.NDXModel = { forecast: forecast, features: features, analogs: analogs, elliott: elliott, adaptiveStart: adaptiveStart, adaptiveRun: adaptiveRun, adaptiveResult: adaptiveResult, QS: QS, KEY: KEY, GRID: GRID };
  if (typeof module !== 'undefined') module.exports = root.NDXModel;
})(typeof window !== 'undefined' ? window : globalThis);
