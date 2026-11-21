"""단기~중기 변동성 기반 구간 보정 검증 (가격만) - 2026-11-21
기준선(경험분포) vs 변동성 표준화 분포(σ 추정기 4종). 튜닝(1997~2010)에서 선택, 검증(2011~)에서 확인.
"""
import json
import numpy as np, pandas as pd
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
QS = np.array([0.05, 0.25, 0.5, 0.75, 0.95]); HS = [21, 42, 63, 126, 252]
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
lp = np.log(px.values); n = len(lp); dates = px.index
ret = pd.Series(np.r_[np.nan, np.diff(lp)])
SIG = {"vol21": ret.rolling(21).std(), "vol63": ret.rolling(63).std(),
       "ewma94": np.sqrt((ret ** 2).ewm(alpha=0.06, adjust=False).mean()),
       "mix(ewma94,vol252)": 0.5 * np.sqrt((ret ** 2).ewm(alpha=0.06, adjust=False).mean()) + 0.5 * ret.rolling(252).std()}
SIG = {k: v.values * np.sqrt(252) for k, v in SIG.items()}
START = 300
def pinball(y, q): return float(np.mean(np.maximum(QS * (y - q), (QS - 1) * (y - q))))

rows = []
TUNE_END = dates.searchsorted(pd.Timestamp("2011-01-01"))
for h in HS:
    y = np.r_[lp[h:] - lp[:-h], np.full(h, np.nan)]
    for i in range(3000, n - h, 21):
        tr = np.arange(START, i - h + 1); yy = y[tr]
        rec = dict(h=h, i=i, y=y[i], tune=i < TUNE_END, base=np.quantile(yy, QS))
        for k, sg in SIG.items():
            sc = sg[tr] * np.sqrt(h / 252); rec[k] = np.quantile(yy / sc, QS) * sg[i] * np.sqrt(h / 252)
        rows.append(rec)
D = pd.DataFrame(rows); names = ["base"] + list(SIG)
out = []
for part, mask in [("tune", D.tune), ("hold", ~D.tune)]:
    for h in HS:
        d = D[mask & (D.h == h)]; b = np.mean([pinball(y, q) for y, q in zip(d.y, d.base)])
        for m in names:
            Q = np.vstack(d[m].values); yv = d.y.values
            pb = np.mean([pinball(a, q) for a, q in zip(yv, Q)])
            out.append(dict(part=part, h=h, model=m, rel=pb / b - 1, cov90=np.mean((yv >= Q[:, 0]) & (yv <= Q[:, 4])),
                            cov50=np.mean((yv >= Q[:, 1]) & (yv <= Q[:, 3])), n=len(d)))
R = pd.DataFrame(out)
tune_rank = R[(R.part == "tune") & (R.model != "base")].groupby("model").rel.mean().sort_values()
best = tune_rank.index[0]
md = [f"# 변동성 기반 구간 보정 검증 ({TAG})\n", "σ로 표준화한 경험분포 vs 기준선(경험분포). rel은 기준선 대비 pinball 변화(음수=개선)\n",
      "## 튜닝구간(1997~2010) 평균 rel (전 기간)\n", tune_rank.map(lambda x: f"{x:+.1%}").to_frame("rel").to_markdown() + f"\n\n선택: **{best}**\n",
      "## 기간별 상세 (cov90 목표 0.90, cov50 목표 0.50)\n"]
for part in ["tune", "hold"]:
    t = R[(R.part == part) & (R.model.isin(["base", best]))].pivot(index="h", columns="model", values=["rel", "cov90", "cov50"])
    md.append(f"### {'튜닝 1997~2010' if part=='tune' else '검증 2011~2026'}\n"); md.append(t.round(3).to_markdown() + "\n")
open(OUT + f"ndx_vol_horizon_{TAG}.md", "w").write("\n".join(md))
R.to_csv(OUT + f"ndx_vol_horizon_{TAG}.csv", index=False)
json.dump({"best": best}, open(OUT + f"ndx_vol_horizon_{TAG}.json", "w"))
print("\n".join(md))
