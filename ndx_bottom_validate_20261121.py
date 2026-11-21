"""바닥(최저점)·전고점 탈환 예측 검증 v2 - 2000·2008 포함 - 2026-11-21
변경: 낙폭을 '역대 최고점'이 아닌 '최근 1년(252거래일) 고점' 대비로 정의 → 2008 폭락이 2000년 사건(2015년 회복)에 묻히지 않고 별도 사건으로 평가됨.
각 검증 시점 t 에서는 t 까지의 데이터만 사용(학습 사건은 결과가 t 이전에 확정된 것만).
평가: (1) 고점 회복 전 최저점(현재가 대비 추가 하락) (2) 고점 탈환까지 기간 (3) 1/3/6개월 내 최저점
"""
import json, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
rng = np.random.default_rng(7)
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
c = px.values; n = len(c); dates = px.index; lr = np.r_[np.nan, np.diff(np.log(c))]
H = pd.Series(c).rolling(252, min_periods=252).max().values        # 최근 1년 고점 (가격 수준)
dd = c / H - 1
CAP = 6000; HS = [21, 63, 126]; QF = [0.1, 0.25, 0.5, 0.75, 0.9]
vol63 = pd.Series(lr).rolling(63).std().values
_rec = {}
def rec(t):
    """t 시점 기준 고점(H[t]) 탈환 인덱스 (없으면 None)"""
    if t not in _rec:
        u = np.where(c[t + 1:] >= H[t])[0]; _rec[t] = t + 1 + int(u[0]) if len(u) else None
    return _rec[t]

def outcome(t):
    r = rec(t)
    if r is None: return None
    end = min(r, t + CAP); return dict(F=c[t:end + 1].min() / c[t] - 1, D=min(r - t, CAP), r=r)
def hmin(t, h): return c[t:t + h + 1].min() / c[t] - 1

def clusters(idx, gap=63):
    """시간순 시점 목록을 사건(연속 구간, 간격 gap 이하)으로 묶어 시점별 가중치(사건당 합 1) 반환"""
    idx = sorted(idx); cid = []; cur = -1; prev = None
    for s in idx:
        if prev is None or s - prev > gap: cur += 1
        cid.append(cur); prev = s
    cnt = {}
    for k in cid: cnt[k] = cnt.get(k, 0) + 1
    return idx, [1.0 / cnt[k] for k in cid], len(cnt)

def wq(v, w, q):
    v = np.asarray(v, float); w = np.asarray(w, float); o = np.argsort(v, kind="stable"); v = v[o]; cw = np.cumsum(w[o])
    return float(v[min(len(v) - 1, np.searchsorted(cw, q * cw[-1] - 1e-12))])

def analog(t, descent):
    base = [s for s in range(252, t) if np.isfinite(dd[s]) and abs(dd[s] - dd[t]) <= 0.05 and dd[s] < -0.01
            and (not descent or dd[s] <= np.nanmin(dd[max(252, s - 20):s + 1]) + 0.03)]
    known = [s for s in base if rec(s) is not None and rec(s) <= t]
    idx, w, ne = clusters(known)
    if ne < 4: return None
    F = np.array([outcome(s)["F"] for s in idx]); D = np.array([outcome(s)["D"] for s in idx], float); w = np.array(w)
    res = dict(F=[wq(F, w, q) for q in QF], D=[wq(D, w, q) for q in QF],
               P126=float(w[D <= 126].sum() / w.sum()), P252=float(w[D <= 252].sum() / w.sum()), neps=ne)
    for h in HS:
        i2, w2, ne2 = clusters([s for s in base if s + h <= t])
        if ne2 < 4: res[f"H{h}"] = None; continue
        res[f"H{h}"] = [wq([hmin(s, h) for s in i2], w2, q) for q in QF]
    return res

def simulate(t, kind, P=600):
    mu = np.nanmean(lr[1:t + 1]); sig = vol63[t]
    if kind == "boot":
        z = lr[2:t + 1] / vol63[1:t]; z = z[np.isfinite(z)]; r = rng.choice(z, size=(P, CAP)) * sig
    else: r = rng.normal(mu, sig, size=(P, CAP))
    cum = np.cumsum(r, axis=1); gap = np.log(H[t] / c[t])
    hit = cum >= gap; any_ = hit.any(1); j = np.where(any_, hit.argmax(1), CAP - 1)
    D = np.where(any_, j + 1, CAP).astype(float)
    F = np.exp(np.minimum(0, np.where(np.arange(CAP)[None, :] <= j[:, None], cum, 0).min(1))) - 1
    res = dict(F=[float(np.quantile(F, q)) for q in QF], D=[float(np.quantile(D, q)) for q in QF],
               P126=float((D <= 126).mean()), P252=float((D <= 252).mean()), neps=0)
    for h in HS: res[f"H{h}"] = [float(np.quantile(np.exp(np.minimum(0, cum[:, :h].min(1))) - 1, q)) for q in QF]
    return res

MODELS = {"A 유사사건(하락중)": lambda t: analog(t, True), "B 유사사건(조건없음)": lambda t: analog(t, False),
          "C 변동성 부트스트랩": lambda t: simulate(t, "boot"), "D 로그정규": lambda t: simulate(t, "norm")}
def pin(y, qs, qv): return float(np.mean([max(q * (y - v), (q - 1) * (y - v)) for q, v in zip(qs, qv)]))

def evaluate(events):
    rows = {m: [] for m in MODELS}; used = []; detail = []
    for t, w in events:
        o = outcome(t)
        if o is None: continue
        preds = {m: f(t) for m, f in MODELS.items()}
        if any(p is None for p in preds.values()): continue
        used.append((t, w)); detail.append((t, o, preds))
        for m, p in preds.items():
            Fq, Dq = np.array(p["F"]), np.array(p["D"]); y = o["F"]; d = o["D"]
            row = dict(w=w, pinF=pin(y, QF, Fq), pinD=pin(np.log1p(d), QF, np.log1p(Dq)),
                       cov50=float(y >= Fq[2]), cov75=float(y >= Fq[1]), cov90=float(y >= Fq[0]),
                       dmed=float(d <= Dq[2]), d1080=float(np.log1p(Dq[0]) <= np.log1p(d) <= np.log1p(Dq[4])),
                       b126=(p["P126"] - float(d <= 126)) ** 2, b252=(p["P252"] - float(d <= 252)) ** 2)
            for h in HS:
                if p[f"H{h}"] is not None and t + h <= n - 1:
                    yh = hmin(t, h); row[f"pinH{h}"] = pin(yh, QF, p[f"H{h}"]); row[f"covH{h}_75"] = float(yh >= p[f"H{h}"][1])
            rows[m].append(row)
    out = []
    for m, rs in rows.items():
        df = pd.DataFrame(rs); agg = {}
        for k in df.columns:
            if k == "w": continue
            ok = df[k].notna(); ww = df.w[ok] / df.w[ok].sum(); agg[k] = float((df[k][ok] * ww).sum())
        agg["model"] = m; agg["n_events"] = len(df); out.append(agg)
    return pd.DataFrame(out), used, detail

# ---- 평가 사건 ----
ev1 = []   # 사건 기준: 1년 고점 대비 낙폭이 -10/-15/-20/-25/-30%에 처음 닿은 날 (직전 126거래일 내 같은 수준 없음)
for thr in [-0.10, -0.15, -0.20, -0.25, -0.30]:
    last = -10**9
    for t in range(1000, n):
        if np.isfinite(dd[t]) and dd[t] <= thr and t - last > 126:
            ev1.append(t);
        if np.isfinite(dd[t]) and dd[t] <= thr: last = t
idx, w, _ = clusters(ev1, gap=126)
ev1 = list(zip(idx, w))
ev2 = [t for t in range(1000, n, 5) if np.isfinite(dd[t]) and -0.35 <= dd[t] <= -0.10]
idx, w, _ = clusters(ev2, gap=63); ev2 = list(zip(idx, w))

res1, u1, d1 = evaluate(ev1); print("사건 기준", len(u1), flush=True)
res2, u2, d2 = evaluate(ev2); print("일별 기준", len(u2), flush=True)

def fmt(df):
    cols = ["model", "n_events", "pinF", "cov50", "cov75", "cov90", "pinD", "dmed", "d1080", "b126", "b252", "pinH21", "pinH63", "pinH126", "covH21_75", "covH63_75", "covH126_75"]
    return df[[x for x in cols if x in df.columns]].round(3).to_markdown(index=False)

# 위기 구간별 상세: 2000~2002, 2007~2009 에 걸린 사건에서 모델 B 예측 vs 실제
crisis = []
for t, o, preds in d1:
    y = dates[t].year
    if (2000 <= y <= 2002) or (2007 <= y <= 2009):
        pB = preds["B 유사사건(조건없음)"]; pA = preds["A 유사사건(하락중)"]
        crisis.append(dict(date=str(dates[t].date()), dd=f"{dd[t]*100:.0f}%", actual_further_drop=f"{o['F']*100:.0f}%",
                           B_pred_50_75_90="/".join(f"{x*100:.0f}" for x in (pB["F"][2], pB["F"][1], pB["F"][0])),
                           actual_days=o["D"], B_days_50_90="/".join(f"{x:.0f}" for x in (pB["D"][2], pB["D"][4]))))
md = [f"# 바닥·전고점 탈환 예측 검증 v2 - 2000·2008 포함, 예외·상한 없음 ({TAG})\n",
      "낙폭 정의: 최근 1년 고점 대비 (2008 폭락이 2000년 사건에 묻히지 않도록). 검증 시점마다 그때까지의 데이터만 사용.\n",
      "- pinF: 추가 하락 분위수 pinball(낮을수록 좋음) / cov50·75·90: 실제 최저점이 예측 가격 위였던 비율(이상 0.5/0.75/0.9)",
      "- pinD: 탈환 기간(로그) pinball / dmed: 실제 탈환이 예측 중앙값 이내였던 비율(0.5 이상) / d1080: 10~90% 적중(0.8 이상)",
      "- b126·b252: 6개월·1년 내 탈환 확률 Brier(낮을수록 좋음) / pinH: 1·3·6개월 내 최저점 pinball / covH: 75% 수준 적중(0.75 이상)\n",
      f"## 사건 기준 (1년 고점 대비 -10/-15/-20/-25/-30%에 처음 닿은 날, {len(u1)}개 시점)\n", fmt(res1) + "\n",
      f"## 일별 기준 (낙폭 -10~-35%인 날, 5거래일 간격, {len(u2)}개 시점)\n", fmt(res2) + "\n",
      "## 2000~2002·2007~2009 위기 구간 사건 상세 (모델 B)\n",
      "추가 하락 열: 예측은 '최저점이 이 낙폭 위일 확률 50/75/90%'에 해당하는 추가 하락(%), 실제는 회복 전 최저 추가 하락\n",
      pd.DataFrame(crisis).to_markdown(index=False) if crisis else "(해당 사건 없음)"]
open(OUT + f"ndx_bottom_validate_{TAG}.md", "w").write("\n".join(md))
res1.to_csv(OUT + f"ndx_bottom_validate_event_{TAG}.csv", index=False); res2.to_csv(OUT + f"ndx_bottom_validate_daily_{TAG}.csv", index=False)
print("\n".join(md))
