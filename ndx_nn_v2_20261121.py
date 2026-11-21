"""가격 전용 신경망 v2 - 2026-11-21
개선점: (1) 다중 시간척도 가격 특성 (2) 기간(h)을 입력으로 넣은 통합 분위수망(표본 공유)
        (3) 기준선(경험분포) 대비 잔차 학습 + 가중치 감쇠 (4) 시드 앙상블
        (5) 튜닝구간(1997~2010)에서만 하이퍼파라미터 선택 -> 검증구간(2011~2026)에서 성능 보고 (과적합 방지)
"""
import json, time, warnings
import numpy as np, pandas as pd, torch
from scipy.stats import norm
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
warnings.filterwarnings("ignore"); torch.set_num_threads(4)

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
QS = np.array([0.05, 0.25, 0.5, 0.75, 0.95])
GRID = list(range(21, 757, 21)); HZ = {"6M": 126, "1Y": 252, "3Y": 756}
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
lp = np.log(px.values); n = len(lp); dates = px.index
ret = np.r_[np.nan, np.diff(lp)]; s = pd.Series(px.values); rs = pd.Series(ret)
START = 505
feat = np.c_[lp - np.r_[np.full(21, np.nan), lp[:-21]], lp - np.r_[np.full(63, np.nan), lp[:-63]],
             lp - np.r_[np.full(126, np.nan), lp[:-126]], lp - np.r_[np.full(252, np.nan), lp[:-252]],
             lp - np.r_[np.full(504, np.nan), lp[:-504]],
             np.log(rs.rolling(21).std() * np.sqrt(252)), np.log(rs.rolling(63).std() * np.sqrt(252)),
             np.log(rs.rolling(252).std() * np.sqrt(252)),
             (s / s.cummax() - 1).values, (s / s.rolling(252).max() - 1).values,
             (s / s.rolling(50).mean() - 1).values, (s / s.rolling(200).mean() - 1).values]
NF = feat.shape[1]
def pinball(y, q): return float(np.mean(np.maximum(QS * (y - q), (QS - 1) * (y - q))))

def base_grid(c):
    """cutoff c 시점 학습표본으로 grid 각 h 의 경험분포 분위수 (n_h x 5)"""
    return np.array([np.quantile(lp[START + h:c + 1] - lp[START:c - h + 1], QS) for h in GRID])

CFG = {"A h8 wd1e-2": (8, 1e-2, 60), "B h16 wd1e-2": (16, 1e-2, 100), "C h32 wd1e-3": (32, 1e-3, 100), "D h16 wd1e-1": (16, 1e-1, 100)}

def train_nn(c, cfg, seeds=2, tstep=10):
    hid, wd, ep = CFG[cfg]; BG = base_grid(c)
    ts = np.arange(START, c - GRID[0] + 1, tstep)
    rows = [(t, j) for j, h in enumerate(GRID) for t in ts if t + h <= c]
    T = np.array([r[0] for r in rows]); J = np.array([r[1] for r in rows]); H = np.array(GRID)[J]
    Xt = feat[T]; mu, sd = Xt.mean(0), Xt.std(0) + 1e-9
    Xs = np.c_[(Xt - mu) / sd, np.log(H / 252)[:, None]]
    y = lp[T + H] - lp[T]; B = BG[J]
    Xs, y, B = [torch.tensor(a, dtype=torch.float32) for a in (Xs, y[:, None], B)]
    q = torch.tensor(QS, dtype=torch.float32)[None]; nets = []
    for sd_ in range(seeds):
        torch.manual_seed(sd_)
        net = torch.nn.Sequential(torch.nn.Linear(NF + 1, hid), torch.nn.Tanh(), torch.nn.Linear(hid, hid), torch.nn.Tanh(), torch.nn.Linear(hid, 5))
        torch.nn.init.zeros_(net[4].weight); torch.nn.init.zeros_(net[4].bias)
        opt = torch.optim.Adam(net.parameters(), lr=3e-3, weight_decay=wd)
        for _ in range(ep):
            opt.zero_grad(); e = y - (B + net(Xs)); torch.mean(torch.maximum(q * e, (q - 1) * e)).backward(); opt.step()
        nets.append(net)
    def predict(i):
        x = np.c_[np.repeat(((feat[i] - mu) / sd)[None], len(GRID), 0), np.log(np.array(GRID) / 252)[:, None]]
        x = torch.tensor(x, dtype=torch.float32)
        with torch.no_grad(): out = np.mean([nt(x).numpy() for nt in nets], 0)
        return np.sort(BG + out, axis=1)   # (n_h, 5)
    return predict, BG

# ---------------- 워크포워드 ----------------
PTS = [i for i in range(3000, n - 126, 63)]
TUNE_END = dates.searchsorted(pd.Timestamp("2011-01-01"))
rec = {k: [] for k in ["i", "h", "y", "base", "gbm"] + list(CFG)}
t0 = time.time()
for jn, i in enumerate(PTS):
    BG = base_grid(i); r = ret[1:i + 1]; mu_, sg_ = np.nanmean(r), np.nanstd(r, ddof=1)
    preds = {cfg: train_nn(i, cfg)[0](i) for cfg in CFG}
    for k, h in HZ.items():
        if i + h > n - 1: continue
        j = GRID.index(h)
        rec["i"].append(i); rec["h"].append(k); rec["y"].append(lp[i + h] - lp[i])
        rec["base"].append(BG[j]); rec["gbm"].append(mu_ * h + sg_ * np.sqrt(h) * norm.ppf(QS))
        for cfg in CFG: rec[cfg].append(preds[cfg][j])
    if jn % 10 == 0: print(f"{jn}/{len(PTS)} {time.time()-t0:.0f}s", flush=True)
D = pd.DataFrame({"i": rec["i"], "h": rec["h"], "y": rec["y"]})
Qm = {m: np.array(rec[m]) for m in ["base", "gbm"] + list(CFG)}
Qm["avg(base,best)"] = None
def score(mask, m):
    Q = Qm[m]; yv = D.y.values
    return np.array([pinball(yv[k], Q[k]) for k in np.where(mask)[0]])
tune = (D.i < TUNE_END).values; hold = ~tune
# 설정 선택: 튜닝구간 평균 상대 pinball
sel = {}
for cfg in CFG:
    rel = np.mean([score(tune & (D.h == k).values, cfg).mean() / score(tune & (D.h == k).values, "base").mean() - 1 for k in HZ])
    sel[cfg] = rel
best = min(sel, key=sel.get)
Qm["avg(base,best)"] = (Qm["base"] + Qm[best]) / 2
md = [f"# 신경망 v2 결과 ({TAG})\n", "가격만 사용. 통합 분위수망(기간 h 입력), 기준선 대비 잔차 학습, 시드 2개 앙상블.\n",
      f"튜닝구간: 1997~2010, 검증구간: 2011~2026 (선택은 튜닝구간 성적으로만 함)\n",
      "## 설정별 튜닝구간 상대 pinball (기준선 대비, 낮을수록 좋음)\n", pd.Series(sel).map(lambda x: f"{x:+.1%}").to_frame("tune").to_markdown() + f"\n\n선택: **{best}**\n"]
rows = []
for label, mask in [("튜닝(1997~2010)", tune), ("검증(2011~2026)", hold), ("전체", np.ones(len(D), bool))]:
    for k in HZ:
        mk = mask & (D.h == k).values; b = score(mk, "base").mean()
        for m in ["base", "gbm", best, "avg(base,best)"]:
            Q = Qm[m][mk]; yv = D.y.values[mk]
            rows.append((label, k, m if m != best else f"nn_v2 [{best}]", score(mk, m).mean(), score(mk, m).mean() / b - 1,
                         np.mean((yv >= Q[:, 0]) & (yv <= Q[:, 4])), np.mean((yv >= Q[:, 1]) & (yv <= Q[:, 3])), np.mean(yv <= Q[:, 2]), int(mk.sum())))
R = pd.DataFrame(rows, columns=["구간", "기간", "모델", "pinball", "기준선대비", "cov90", "cov50", "below_med", "n"])
md.append("## 워크포워드 성능\n"); md.append(R.to_markdown(index=False, floatfmt=".3f") + "\n")
R.to_csv(OUT + f"ndx_nn_v2_walkforward_{TAG}.csv", index=False)

# ---------------- 누적 3년 블록 백테스트 (1997~) ----------------
rows2 = []; figd = {}
for yr in range(1997, 2025, 3):
    st = pd.Timestamp(f"{yr}-01-01"); en = min(st + pd.DateOffset(years=3) - pd.Timedelta(days=1), dates[-1])
    c = int(dates.searchsorted(st) - 1); e = int(dates.searchsorted(en, side="right") - 1); Hh = e - c
    pr, BG = train_nn(c, best); NNq = pr(c); r = ret[1:c + 1]; mu_, sg_ = np.nanmean(r), np.nanstd(r, ddof=1)
    hs = [h for h in GRID if h <= Hh]
    ys = np.array([lp[c + h] - lp[c] for h in hs])
    mods = {"emp": BG[:len(hs)], f"nn_v2": NNq[:len(hs)], "gbm": np.array([mu_ * h + sg_ * np.sqrt(h) * norm.ppf(QS) for h in hs])}
    mods["avg(emp,nn_v2)"] = (mods["emp"] + mods["nn_v2"]) / 2
    for m, Q in mods.items():
        rows2.append(dict(block=f"{yr}-{min(yr+2, 2026)}", model=m, pred_med_end=float(np.exp(Q[-1, 2]) - 1), act_end=float(np.exp(ys[-1]) - 1),
                          end_in90=bool(Q[-1, 0] <= ys[-1] <= Q[-1, 4]), end_in50=bool(Q[-1, 1] <= ys[-1] <= Q[-1, 3]),
                          cov90=float(np.mean((ys >= Q[:, 0]) & (ys <= Q[:, 4]))), cov50=float(np.mean((ys >= Q[:, 1]) & (ys <= Q[:, 3]))),
                          pinball=float(np.mean([pinball(y, q) for y, q in zip(ys, Q)]))))
    figd[yr] = (c, e, hs, mods)
B2 = pd.DataFrame(rows2); B2.to_csv(OUT + f"ndx_nn_v2_blocks_{TAG}.csv", index=False)
sm = B2.groupby("model").agg(cov90=("cov90", "mean"), cov50=("cov50", "mean"), pinball=("pinball", "mean"),
                              end_in90=("end_in90", "sum"), end_in50=("end_in50", "sum"))
md.append("## 누적 3년 블록 백테스트 (1997~2026, 10블록) 요약\n"); md.append(sm.to_markdown(floatfmt=".3f") + "\n")
t = B2[B2.model.isin(["emp", "nn_v2"])].pivot(index="block", columns="model", values=["pred_med_end", "act_end", "cov90", "pinball"])
md.append("### 블록별 emp vs nn_v2\n"); md.append(t.round(3).to_markdown() + "\n")

# 현재 예측
BGc = base_grid(n - 1); prc, _ = train_nn(n - 1, best); Nq = prc(n - 1)
cur = {k: {"base": [float(np.exp(v) - 1) for v in BGc[GRID.index(h)]], "nn_v2": [float(np.exp(v) - 1) for v in Nq[GRID.index(h)]]} for k, h in HZ.items()}
md.append("## 현재 예측 (분위수 5/25/50/75/95%)\n")
for k in HZ:
    md.append(f"- {k} 기준선: " + " / ".join(f"{v*100:+.1f}%" for v in cur[k]["base"]))
    md.append(f"- {k} nn_v2 : " + " / ".join(f"{v*100:+.1f}%" for v in cur[k]["nn_v2"]))
json.dump({"best": best, "tune_scores": sel, "current": cur}, open(OUT + f"ndx_nn_v2_{TAG}.json", "w"), indent=1, ensure_ascii=False)
open(OUT + f"ndx_nn_v2_{TAG}.md", "w").write("\n".join(md))

# 차트
fig, axs = plt.subplots(2, 5, figsize=(20, 7)); axs = axs.ravel()
for a, (yr, (c, e, hs, mods)) in zip(axs, figd.items()):
    p0 = px.values[c]; xs = [dates[c + h] for h in hs]; Q = mods["nn_v2"]; E = mods["emp"]
    a.fill_between(xs, p0 * np.exp(Q[:, 0]), p0 * np.exp(Q[:, 4]), alpha=.2, color="tab:red"); a.fill_between(xs, p0 * np.exp(Q[:, 1]), p0 * np.exp(Q[:, 3]), alpha=.35, color="tab:red")
    a.plot(xs, p0 * np.exp(E[:, 2]), c="tab:blue", ls="--", lw=1); a.plot(xs, p0 * np.exp(Q[:, 2]), c="tab:red", lw=1.3)
    a.plot(dates[c:e + 1], px.values[c:e + 1], c="k", lw=1.1); a.set_title(f"{yr}~", fontsize=10); a.tick_params(labelsize=7)
fig.suptitle("NN v2 backtest (red=NN 5-95/25-75/median, blue dashed=empirical median, black=actual)")
plt.tight_layout(); plt.savefig(OUT + f"ndx_nn_v2_blocks_{TAG}.png", dpi=95)
print("\n".join(md))
