"""바닥(최저점)·전고점 탈환 기간 예측 검증 (가격만, 미래 정보 없이) - 2026-11-21
각 검증 시점 t 에서는 t 까지의 데이터만 사용(분석 대상 사건의 결과가 t 이전에 확정된 것만 학습에 사용).
평가 대상: (1) 전고점 회복 전 최저점(현재가 대비 추가 하락) (2) 전고점 탈환까지 걸린 기간 (3) 1/3/6개월 내 최저점
모델: A 유사사건(하락 중 조건) / B 유사사건(조건 없음) / C 변동성 부트스트랩 시뮬레이션 / D 로그정규 시뮬레이션
"""
import json, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
rng = np.random.default_rng(7)
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
c = px.values; n = len(c); dates = px.index; lr = np.r_[np.nan, np.diff(np.log(c))]
peak = np.maximum.accumulate(c); dd = c / peak - 1
pk = np.zeros(n, int); cur = 0
for i in range(n):
    if c[i] >= peak[i] - 1e-12: cur = i
    pk[i] = cur
runmin = np.zeros(n)
for i in range(n): runmin[i] = dd[i] if pk[i] == i else min(runmin[i - 1], dd[i])
ups = [i for i in range(n) if pk[i] == i]; R = {a: b for a, b in zip(ups[:-1], ups[1:])}   # 에피소드(전고점 index) -> 회복 index
CAP = 1260; HS = [21, 63, 126]
vol63 = pd.Series(lr).rolling(63).std().values

def outcome(t):
    """t 의 실제 결과 (회복된 에피소드만)"""
    r = R.get(pk[t]);
    if r is None: return None
    end = min(r, t + CAP); seg = c[t:end + 1]
    return dict(F=seg.min() / c[t] - 1, D=min(r - t, CAP), r=r)

def hmin(t, h): return c[t:t + h + 1].min() / c[t] - 1

def wq(v, w, q):
    o = np.argsort(v); v = np.asarray(v)[o]; cw = np.cumsum(np.asarray(w)[o]); return float(v[min(len(v) - 1, np.searchsorted(cw, q * cw[-1]))])

QF = [0.1, 0.25, 0.5, 0.75, 0.9]
def analog(t, descent):
    """t 시점에서 쓸 수 있는 유사 사건로 분포 추정 (결과가 t 이전에 확정된 것만)"""
    cand = [s for s in range(t) if abs(dd[s] - dd[t]) <= 0.05 and dd[s] < -0.01 and (not descent or dd[s] <= runmin[s] + 0.03)]
    byep = {}
    for s in cand:
        r = R.get(pk[s])
        if r is not None and r <= t: byep.setdefault(pk[s], []).append(s)
    if len(byep) < 4: return None
    F, D, w = [], [], []
    for p_, ss in byep.items():
        for s in ss:
            o = outcome(s); F.append(o["F"]); D.append(o["D"]); w.append(1.0 / len(ss))
    F, D, w = np.array(F), np.array(D, float), np.array(w)
    res = dict(F=[wq(F, w, q) for q in QF], D=[wq(D, w, q) for q in QF],
               P126=float(w[D <= 126].sum() / w.sum()), P252=float(w[D <= 252].sum() / w.sum()), neps=len(byep))
    for h in HS:   # 기간 내 최저점: 결과가 t 이전에 확정(s+h<=t)
        cs = [s for s in cand if s + h <= t]; eps2 = {}
        for s in cs: eps2.setdefault(pk[s], []).append(s)
        if len(eps2) < 4: res[f"H{h}"] = None; continue
        v, ww = [], []
        for ss in eps2.values():
            for s in ss: v.append(hmin(s, h)); ww.append(1.0 / len(ss))
        res[f"H{h}"] = [wq(np.array(v), np.array(ww), q) for q in QF]
    return res

def simulate(t, kind, P=600):
    hist = lr[1:t + 1]; mu = np.nanmean(hist); sig = vol63[t]
    if kind == "boot":
        z = lr[2:t + 1] / vol63[1:t]; z = z[np.isfinite(z)]; z = z - z.mean() + mu / sig if False else z
        r = rng.choice(z, size=(P, CAP)) * sig
    else:
        r = rng.normal(mu, sig, size=(P, CAP))
    cum = np.cumsum(r, axis=1); gap = np.log(peak[t] / c[t])
    hit = cum >= gap; any_ = hit.any(1); j = np.where(any_, hit.argmax(1), CAP - 1)
    D = np.where(any_, j + 1, CAP).astype(float)
    mask = np.arange(CAP)[None, :] <= j[:, None]
    F = np.minimum(0, np.where(mask, cum, 0).min(1)); F = np.exp(F) - 1
    res = dict(F=[float(np.quantile(F, q)) for q in QF], D=[float(np.quantile(D, q)) for q in QF],
               P126=float((D <= 126).mean()), P252=float((D <= 252).mean()), neps=0)
    for h in HS:
        m = np.exp(np.minimum(0, cum[:, :h].min(1))) - 1; res[f"H{h}"] = [float(np.quantile(m, q)) for q in QF]
    return res

MODELS = {"A 유사사건(하락중)": lambda t: analog(t, True), "B 유사사건(조건없음)": lambda t: analog(t, False),
          "C 변동성 부트스트랩": lambda t: simulate(t, "boot"), "D 로그정규": lambda t: simulate(t, "norm")}

def pin(y, qs, qv): return float(np.mean([max(q * (y - v), (q - 1) * (y - v)) for q, v in zip(qs, qv)]))

def evaluate(events, label):
    """events: list of (t, weight)"""
    rows = {m: [] for m in MODELS}; used = []
    for t, w in events:
        o = outcome(t)
        if o is None: continue
        preds = {m: f(t) for m, f in MODELS.items()}
        if any(p is None for p in preds.values()): continue
        used.append((t, w))
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
        df = pd.DataFrame(rs); w = df.w / df.w.sum()
        agg = {k: float((df[k] * w).sum()) for k in df.columns if k != "w" and df[k].notna().all()}
        for h in HS:
            if f"pinH{h}" in df:
                ok = df[f"pinH{h}"].notna(); ww = df.w[ok] / df.w[ok].sum()
                agg[f"pinH{h}"] = float((df[f"pinH{h}"][ok] * ww).sum()); agg[f"covH{h}_75"] = float((df[f"covH{h}_75"][ok] * ww).sum())
        agg["model"] = m; agg["n_events"] = len(df); agg["episodes"] = len({pk[t] for t, _ in used}); out.append(agg)
    return pd.DataFrame(out), used

# ---- 평가 사건 구성 ----
# (1) 사건 기준: 각 에피소드에서 낙폭이 처음 -10/-15/-20/-25/-30%에 닿은 날 (그 날의 정보만으로 예측)
ev1 = []
for p_ in R:
    for thr in [-0.10, -0.15, -0.20, -0.25, -0.30]:
        idx = np.where((pk == p_) & (dd <= thr))[0]
        if len(idx) and idx[0] >= 1500: ev1.append((int(idx[0]), 1.0))
# 에피소드 단위 동일 가중
cnt = {}
for t, _ in ev1: cnt[pk[t]] = cnt.get(pk[t], 0) + 1
ev1 = [(t, 1.0 / cnt[pk[t]]) for t, _ in ev1]
# (2) 일별 기준(5거래일 간격): 하락 중(최저점+3%p 이내)이고 낙폭 -10~-35% 인 날, 에피소드 동일 가중
ev2 = [t for t in range(1500, n, 5) if -0.35 <= dd[t] <= -0.10 and dd[t] <= runmin[t] + 0.03 and pk[t] in R]
cnt = {}
for t in ev2: cnt[pk[t]] = cnt.get(pk[t], 0) + 1
ev2 = [(t, 1.0 / cnt[pk[t]]) for t in ev2]

res1, u1 = evaluate(ev1, "event"); print("사건 기준 평가 완료", len(u1), flush=True)
res2, u2 = evaluate(ev2, "daily"); print("일별 기준 평가 완료", len(u2), flush=True)

def fmt(df):
    cols = ["model", "n_events", "episodes", "pinF", "cov50", "cov75", "cov90", "pinD", "dmed", "d1080", "b126", "b252",
            "pinH21", "pinH63", "pinH126", "covH21_75", "covH63_75", "covH126_75"]
    return df[[x for x in cols if x in df.columns]].round(3).to_markdown(index=False)
md = [f"# 바닥·전고점 탈환 예측 검증 ({TAG})\n",
      "검증 시점마다 그때까지의 데이터만 사용(학습 사건은 결과가 확정된 것만). 평가 구간: 1991년 이후 (6년 이상 학습 후)\n",
      "- pinF: 추가 하락(최저점) 분위수 pinball (낮을수록 좋음) / cov50·75·90: 실제 최저점이 예측 가격 위였던 비율 (이상값 0.5/0.75/0.9)",
      "- pinD: 탈환 기간(로그) 분위수 pinball / dmed: 실제 탈환일이 예측 중앙값 이내였던 비율(0.5 이상적) / d1080: 10~90% 구간 적중(0.8 이상적)",
      "- b126·b252: 6개월·1년 내 탈환 확률 Brier 점수(낮을수록 좋음) / pinH: 1·3·6개월 내 최저점 pinball, covH: 75% 수준 적중(0.75 이상적)\n",
      f"## 사건 기준 (에피소드가 -10/-15/-20/-25/-30%에 처음 닿은 날, 사건 {len(u1)}개, 에피소드 {res1.episodes.iloc[0]}개)\n", fmt(res1) + "\n",
      f"## 일별 기준 (하락 중인 날 5거래일 간격, 표본 {len(u2)}개, 에피소드 {res2.episodes.iloc[0]}개)\n", fmt(res2) + "\n"]
open(OUT + f"ndx_bottom_validate_{TAG}.md", "w").write("\n".join(md))
res1.to_csv(OUT + f"ndx_bottom_validate_event_{TAG}.csv", index=False); res2.to_csv(OUT + f"ndx_bottom_validate_daily_{TAG}.csv", index=False)
print("\n".join(md))
