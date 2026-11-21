"""누적(Expanding) 3년 블록 백테스트 - 2026-11-21
학습: 1985~(블록 시작 전날) 전체 -> 예측: 이후 3년의 가격 경로 분포(부채꼴) -> 실제 경로와 비교
모델: gbm(로그정규, 표본 적을 때도 가능) / emp(전체 역사 경험분포) / knn(유사 상태=평균회귀 관점)
폴백: knn은 표본<400이면 emp, emp는 표본<120이면 gbm 으로 대체(대체 비율을 같이 보고)
"""
import json, warnings
import numpy as np, pandas as pd
from scipy.stats import norm
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
warnings.filterwarnings("ignore")

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
QS = np.array([0.05, 0.25, 0.5, 0.75, 0.95])
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
lp = np.log(px.values); n = len(lp); dates = px.index
ret = np.r_[np.nan, np.diff(lp)]
s = pd.Series(px.values)
X = np.c_[(s / s.cummax() - 1).values, (s / s.rolling(200).mean() - 1).values, (s / s.shift(252) - 1).values,
          (pd.Series(ret).rolling(63).std() * np.sqrt(252)).values]
SC = np.array([0.15, 0.10, 0.30, 0.10]); START = 252; K = 250
STEP = 5

def pinball(y, q): return float(np.mean(np.maximum(QS * (y - q), (QS - 1) * (y - q))))

def block_forecast(c, H):
    """cutoff 인덱스 c 에서 h=STEP..H 까지 각 모델의 분위수와 PIT 함수 반환"""
    r = ret[1:c + 1]; mu, sg = np.nanmean(r), np.nanstd(r, ddof=1)
    d = np.sqrt((((X[START:c] - X[c]) / SC) ** 2).sum(1)); order = np.argsort(d)   # t = START + order
    out = {"gbm": {}, "emp": {}, "knn": {}}; fb = {"emp": 0, "knn": 0}; hs = list(range(STEP, H + 1, STEP))
    for h in hs:
        q = mu * h + sg * np.sqrt(h) * norm.ppf(QS)
        out["gbm"][h] = (q, lambda y, h=h: norm.cdf((y - mu * h) / (sg * np.sqrt(h))))
        m = c - h - START + 1                      # 결과가 확정된 표본 수 (t+h<=c)
        if m >= 120:
            ye = np.sort(lp[START + h:c + 1] - lp[START:c - h + 1])
            out["emp"][h] = (np.quantile(ye, QS), lambda y, ye=ye: np.searchsorted(ye, y) / len(ye))
        else:
            out["emp"][h] = out["gbm"][h]; fb["emp"] += 1
        if m >= 400:
            tt = START + order; tt = tt[tt + h <= c][:K]
            yk = np.sort(lp[tt + h] - lp[tt])
            out["knn"][h] = (np.quantile(yk, QS), lambda y, yk=yk: np.searchsorted(yk, y) / len(yk))
        else:
            out["knn"][h] = out["emp"][h]; fb["knn"] += 1
    return out, {k: v / len(hs) for k, v in fb.items()}, hs

starts = [pd.Timestamp(f"{y}-01-01") for y in range(1988, 2025, 3)]
rows, store = [], {}
for st in starts:
    en = min(st + pd.DateOffset(years=3) - pd.Timedelta(days=1), dates[-1])
    c = int(np.searchsorted(dates, st) - 1); e = int(np.searchsorted(dates, en, side="right") - 1)
    H = e - c
    fc, fb, hs = block_forecast(c, H)
    lab = f"{st.year}-{en.year}"
    store[lab] = dict(c=c, e=e, hs=hs, fc=fc)
    for m in ["gbm", "emp", "knn"]:
        ys = np.array([lp[c + h] - lp[c] for h in hs]); Q = np.array([fc[m][h][0] for h in hs])
        pit = np.array([fc[m][h][1](y) for h, y in zip(hs, ys)])
        cov90 = np.mean((ys >= Q[:, 0]) & (ys <= Q[:, 4])); cov50 = np.mean((ys >= Q[:, 1]) & (ys <= Q[:, 3]))
        pb = np.mean([pinball(y, q) for y, q in zip(ys, Q)])
        end = lambda h: min(hs, key=lambda x: abs(x - h))
        rows.append(dict(block=lab, model=m, train_end=str(dates[c].date()), train_days=c + 1, fallback=fb.get(m, 0.0),
                         pred_med_end=float(np.exp(Q[-1, 2]) - 1), act_end=float(np.exp(ys[-1]) - 1),
                         pit_end=float(pit[-1]), cov90=cov90, cov50=cov50, pinball=pb,
                         pit_6m=float(pit[hs.index(end(126))]) if H >= 126 else np.nan,
                         pit_1y=float(pit[hs.index(end(252))]) if H >= 252 else np.nan,
                         dir_ok=bool((Q[-1, 2] > 0) == (ys[-1] > 0))))
df = pd.DataFrame(rows)
df.to_csv(OUT + f"ndx_backtest_blocks_{TAG}.csv", index=False)

# ---- 요약 ----
md = [f"# NDX 누적 3년 블록 백테스트 ({TAG})\n",
      "방법: 학습=1985-10~블록 시작 전날 전체 → 이후 3년(약 756거래일) 가격 경로 분포(5/25/50/75/95%) 예측 → 실제 경로와 비교\n",
      "- cov90/cov50: 실제 경로가 5~95%/25~75% 구간 안에 있던 비율 (목표 0.90/0.50)",
      "- PIT(end): 블록 끝 시점 실제값이 예측분포의 몇 %에 해당 (0.5=중앙값, 0.05 미만/0.95 초과=구간 이탈)",
      "- fallback: 표본 부족으로 더 단순한 모델로 대체된 구간 비율\n"]
for m, nm in [("emp", "emp: 전체 역사 경험분포"), ("knn", "knn: 유사 상태(평균회귀)"), ("gbm", "gbm: 로그정규(표본 적어도 가능)")]:
    d = df[df.model == m]
    md.append(f"## {nm}\n")
    t = d[["block", "train_days", "fallback", "pred_med_end", "act_end", "pit_end", "cov90", "cov50", "pinball", "dir_ok"]].copy()
    for cc in ["pred_med_end", "act_end"]: t[cc] = (t[cc] * 100).round(1).astype(str) + "%"
    t["fallback"] = (t["fallback"] * 100).round(0).astype(int).astype(str) + "%"
    md.append(t.to_markdown(index=False, floatfmt=".2f") + "\n")
    md.append(f"**평균** cov90={d.cov90.mean():.2f}, cov50={d.cov50.mean():.2f}, pinball={d.pinball.mean():.3f}, "
              f"블록끝 90%구간 적중 {int(((d.pit_end>=.05)&(d.pit_end<=.95)).sum())}/{len(d)}, "
              f"50%구간 적중 {int(((d.pit_end>=.25)&(d.pit_end<=.75)).sum())}/{len(d)}, 방향 적중 {int(d.dir_ok.sum())}/{len(d)}\n")
sm = df.groupby("model").agg(cov90=("cov90", "mean"), cov50=("cov50", "mean"), pinball=("pinball", "mean"),
                              pit_end=("pit_end", "mean"), dir_ok=("dir_ok", "mean"))
md.append("## 모델 요약 (전체 블록 평균)\n"); md.append(sm.to_markdown(floatfmt=".3f") + "\n")
# 학습 데이터가 충분한(>=10년) 블록만
d2 = df[df.train_days >= 2520].groupby("model").agg(cov90=("cov90", "mean"), cov50=("cov50", "mean"), pinball=("pinball", "mean"),
                                                   pit_end=("pit_end", "mean"), dir_ok=("dir_ok", "mean"))
md.append("## 학습 10년 이상인 블록만 (1997~)\n"); md.append(d2.to_markdown(floatfmt=".3f") + "\n")
open(OUT + f"ndx_backtest_blocks_{TAG}.md", "w").write("\n".join(md))

# ---- 차트: 블록별 부채꼴 vs 실제 ----
for m, nm in [("emp", "Full-history empirical"), ("knn", "Similar-state (mean reversion)")]:
    fig, axs = plt.subplots(4, 4, figsize=(18, 13)); axs = axs.ravel()
    for a, (lab, S) in zip(axs, store.items()):
        c, hs = S["c"], S["hs"]; p0 = px.values[c]
        Q = np.array([S["fc"][m][h][0] for h in hs]); xs = [dates[c + h] for h in hs]
        a.fill_between(xs, p0 * np.exp(Q[:, 0]), p0 * np.exp(Q[:, 4]), alpha=.2, color="tab:blue")
        a.fill_between(xs, p0 * np.exp(Q[:, 1]), p0 * np.exp(Q[:, 3]), alpha=.35, color="tab:blue")
        a.plot(xs, p0 * np.exp(Q[:, 2]), c="tab:blue", lw=1.3)
        a.plot(dates[c:S["e"] + 1], px.values[c:S["e"] + 1], c="k", lw=1.2)
        r = df[(df.block == lab) & (df.model == m)].iloc[0]
        a.set_title(f"{lab} | PIT {r.pit_end:.2f} | cov90 {r.cov90:.2f}", fontsize=10); a.tick_params(labelsize=7)
    for a in axs[len(store):]: a.axis("off")
    fig.suptitle(f"NDX expanding-window 3Y backtest - {nm} (black=actual, blue=forecast 5-95 / 25-75 / median)")
    plt.tight_layout(); plt.savefig(OUT + f"ndx_backtest_blocks_{m}_{TAG}.png", dpi=95); plt.close()

# PIT 분포 차트
fig, ax = plt.subplots(1, 2, figsize=(13, 4))
for m, col in [("emp", "tab:blue"), ("knn", "tab:orange"), ("gbm", "tab:green")]:
    d = df[df.model == m]; ax[0].plot(range(len(d)), d.pit_end.values, "o-", c=col, label=m)
    ax[1].plot(range(len(d)), d.cov90.values, "o-", c=col, label=m)
ax[0].axhspan(.05, .95, color="gray", alpha=.1); ax[0].axhline(.5, c="k", lw=.7); ax[0].set_title("Actual end-of-block percentile in forecast (0.5 ideal)")
ax[1].axhline(.9, c="k", lw=.7); ax[1].set_title("Path coverage of 5-95% band (0.9 ideal)")
for a in ax: a.set_xticks(range(len(starts))); a.set_xticklabels([str(x.year) for x in starts], rotation=60); a.legend()
plt.tight_layout(); plt.savefig(OUT + f"ndx_backtest_blocks_summary_{TAG}.png", dpi=110)
print("\n".join(md))
