"""NDX 중장기 확률 예측 (가격만 사용) - 2026-11-21
단계: 데이터 -> 가설검증(평균회귀) -> 모델(조건부 경험분포, 분위수회귀) -> walk-forward 검증 -> 현재 분포
"""
import json, warnings
import numpy as np, pandas as pd, yfinance as yf
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import statsmodels.api as sm
warnings.filterwarnings("ignore")

TAG = "20261121"
OUT = "/home/user/ma-backtest/"
HZ = {"6M": 126, "1Y": 252, "3Y": 756}
QS = [0.05, 0.25, 0.5, 0.75, 0.95]
rng = np.random.default_rng(0)

# ---------- 1. data ----------
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
lp = np.log(px)

# ---------- 2. features (전부 과거 정보만) ----------
F = pd.DataFrame(index=px.index)
F["dd"] = px / px.cummax() - 1
F["z200"] = px / px.rolling(200).mean() - 1
F["r252"] = px / px.shift(252) - 1
F["vol63"] = lp.diff().rolling(63).std() * np.sqrt(252)
F["trend_z"] = (lp - lp.rolling(1260).mean()) / lp.rolling(1260).std()
F["r252_pct"] = F["r252"].expanding(min_periods=504).apply(lambda s: (s[:-1] < s[-1]).mean(), raw=True)
FWD = {k: lp.shift(-h) - lp for k, h in HZ.items()}
for k in HZ: F[f"f{k}"] = FWD[k]
F = F.dropna(subset=["dd", "z200", "r252", "vol63"])  # 1985년 데이터부터 사용(약 1986-10~)
cur = F.iloc[-1]
last_date = px.index[-1]

def pct(x): return f"{x*100:.1f}%"
def simple(x): return np.exp(x) - 1
rep = []
rep.append(f"# NDX 중장기 확률 예측 - 1985년 데이터부터 ({TAG})\n")
rep.append(f"- 데이터: ^NDX {px.index[0].date()} ~ {last_date.date()} ({len(px)}일), 종가 {px.iloc[-1]:,.0f}")
rep.append(f"- 현재 상태: 낙폭 {pct(cur.dd)}, 200일선 이격 {pct(cur.z200)}, 1년 상승률 {pct(cur.r252)} "
           f"(역사 백분위 {cur.r252_pct*100:.0f}%), 5년추세 z={cur.trend_z:.2f}, 변동성 {pct(cur.vol63)}\n")

# ---------- 3. 가설 검증 ----------
rep.append("## 1. 가설 검증: 평균회귀가 실제로 있는가\n")
def circ_perm_p(x, y, n=500):
    m = x.notna() & y.notna(); x = x[m].values; y = y[m].values
    r0 = pd.Series(x).corr(pd.Series(y), method="spearman")
    cnt = 0
    for _ in range(n):
        s = rng.integers(len(x) // 10, len(x) - len(x) // 10)
        r = pd.Series(np.roll(x, s)).corr(pd.Series(y), method="spearman")
        cnt += abs(r) >= abs(r0)
    return r0, (cnt + 1) / (n + 1)

rep.append("Spearman 상관(특성 vs 이후 수익률), 순환이동 순열검정 p값 (자기상관 보존)\n")
rep.append("| 특성 | 기간 | 상관 | p |\n|---|---|---|---|")
for feat in ["dd", "z200", "r252_pct", "trend_z"]:
    for k in HZ:
        r, p = circ_perm_p(F[feat], F[f"f{k}"])
        rep.append(f"| {feat} | {k} | {r:+.2f} | {p:.3f} |")
rep.append("\n해석: dd는 값이 낮을수록(낙폭 클수록) 이후 수익률이 높으면 상관이 **음수**. "
           "z200/r252_pct/trend_z는 과열일수록 이후 수익률이 낮으면 **음수**.\n")

def bucket_table(feat, bins, labels, k):
    s = pd.cut(F[feat], bins, labels=labels)
    g = F.groupby(s)[f"f{k}"]
    return pd.DataFrame({"n": g.size(), "mean": g.mean().map(simple), "median": g.median().map(simple),
                         "p5": g.quantile(.05).map(simple), "p95": g.quantile(.95).map(simple),
                         "P(loss)": g.apply(lambda x: (x < 0).mean())})

uncond = {k: FWD[k].dropna() for k in HZ}
DB, DL = [-1, -.4, -.3, -.2, -.1, -.05, 0.001], ["<-40%", "-40~-30", "-30~-20", "-20~-10", "-10~-5", "-5~0"]
OB, OL = [0, .1, .3, .7, .9, .97, 1.001], ["0-10", "10-30", "30-70", "70-90", "90-97", "97-100"]
rep.append(f"### 낙폭 구간별 이후 1년 수익률 (무조건: 평균 {pct(simple(uncond['1Y'].mean()))}, 손실확률 {pct((uncond['1Y']<0).mean())})\n")
rep.append(bucket_table("dd", DB, DL, "1Y").to_markdown(floatfmt=".3f") + "\n")
rep.append("### 낙폭 구간별 이후 3년 수익률\n")
rep.append(bucket_table("dd", DB, DL, "3Y").to_markdown(floatfmt=".3f") + "\n")
rep.append("### 1년 상승률 백분위(과열도)별 이후 1년 수익률\n")
rep.append(bucket_table("r252_pct", OB, OL, "1Y").to_markdown(floatfmt=".3f") + "\n")

fig, ax = plt.subplots(1, 2, figsize=(13, 4.5))
for a, feat, bins, labels, t in [(ax[0], "dd", DB, DL, "Drawdown bucket -> fwd 1Y return"),
                                 (ax[1], "r252_pct", OB, OL, "Trailing-1Y-return percentile -> fwd 1Y return")]:
    s = pd.cut(F[feat], bins, labels=labels)
    data = [simple(F.loc[s == l, "f1Y"].dropna().values) * 100 for l in labels]
    a.boxplot(data, tick_labels=[f"{l}\n(n={len(d)})" for l, d in zip(labels, data)], showfliers=False)
    a.axhline(0, c="r", lw=.8); a.set_title(t); a.set_ylabel("%")
plt.tight_layout(); plt.savefig(OUT + f"ndx_hypothesis_from1985_{TAG}.png", dpi=130); plt.close()

# ---------- 4. 모델 ----------
FEATS = ["dd", "z200", "r252", "vol63"]
SC = np.array([0.15, 0.10, 0.30, 0.10])

def knn_dist(Ftrain, ytrain, x, K=250):
    d = np.sqrt((((Ftrain[FEATS].values - x) / SC) ** 2).sum(1))
    idx = np.argsort(d)[:K]
    return ytrain.values[idx], Ftrain.index[idx]

def qr_dist(Ftrain, ytrain, x):
    X = sm.add_constant(Ftrain[FEATS].values); xx = np.r_[1, x].reshape(1, -1)
    out = [sm.QuantReg(ytrain.values, X).fit(q=q, max_iter=2000).predict(xx)[0] for q in QS]
    return np.maximum.accumulate(np.array(out))

def pinball(y, qp): return np.mean([max(q * (y - p), (q - 1) * (y - p)) for q, p in zip(QS, qp)])

# ---------- 5. walk-forward ----------
rep.append("## 2. Walk-forward 검증 (각 시점에 그때까지 '결과가 확정된' 데이터만 사용)\n")
rep.append("기준선=무조건 경험분포. pinball loss는 낮을수록 좋음. 5~95% 구간 적중률은 90%에 가까울수록 보정이 좋음\n")
rep.append("| 기간 | 모델 | pinball | 기준선 대비 | 5~95% 적중 | 5% 하회 | 95% 상회 | 평가 수 |\n|---|---|---|---|---|---|---|---|")
wf_store = {}
for k, h in HZ.items():
    res = {"base": [], "knn": [], "qr": []}; hit = {m: [] for m in res}; lo = {m: [] for m in res}; hi = {m: [] for m in res}
    first = F.index[0] + pd.Timedelta(days=365 * 5)
    pts = [i for i in range(len(F)) if F.index[i] >= first and not np.isnan(F[f"f{k}"].iloc[i])][::21]
    for i in pts:
        tr = F.iloc[:i - h + 1].dropna(subset=[f"f{k}"])
        y = F[f"f{k}"].iloc[i]; x = F[FEATS].iloc[i].values
        qb = np.quantile(tr[f"f{k}"], QS)
        yy, _ = knn_dist(tr, tr[f"f{k}"], x); qk = np.quantile(yy, QS)
        qq = qr_dist(tr.iloc[::5], tr[f"f{k}"].iloc[::5], x)
        for m, qp in [("base", qb), ("knn", qk), ("qr", qq)]:
            res[m].append(pinball(y, qp)); hit[m].append(qp[0] <= y <= qp[-1])
            lo[m].append(y < qp[0]); hi[m].append(y > qp[-1])
    b = np.mean(res["base"])
    for m, nm in [("base", "무조건(기준선)"), ("knn", "A 유사상태 경험분포"), ("qr", "B 분위수회귀")]:
        rep.append(f"| {k} | {nm} | {np.mean(res[m]):.4f} | {np.mean(res[m])/b-1:+.1%} | {np.mean(hit[m]):.0%} | {np.mean(lo[m]):.0%} | {np.mean(hi[m]):.0%} | {len(res[m])} |")
    wf_store[k] = {m: float(np.mean(res[m])) for m in res}
rep.append("\n중첩 구간이 많아 독립 표본은 훨씬 적음 (3Y는 독립 사례 1~2개 수준)\n")

# ---------- 6. 현재 분포 ----------
rep.append("## 3. 현재 시점 예측 분포\n")
x = cur[FEATS].values.astype(float)
summary = {}
fig, axs = plt.subplots(1, 3, figsize=(16, 4.5))
for a, (k, h) in zip(axs, HZ.items()):
    tr = F.dropna(subset=[f"f{k}"])
    yb = tr[f"f{k}"].values
    yk, idx = knn_dist(tr, tr[f"f{k}"], x)
    qq = qr_dist(tr.iloc[::3], tr[f"f{k}"].iloc[::3], x)
    gaps = pd.Series(idx).sort_values().diff().dt.days.fillna(999)
    ep = int((gaps > 60).sum())
    def stat(s):
        return dict(P_loss=float((s < 0).mean()), P_gt10=float((s > .10).mean()), P_gt20=float((s > .20).mean()),
                    P_lt_m10=float((s < -.10).mean()), q={str(int(q*100)): float(np.quantile(s, q)) for q in QS})
    sb, sk = stat(simple(yb)), stat(simple(yk))
    sq = {str(int(q*100)): float(simple(v)) for q, v in zip(QS, qq)}
    summary[k] = {"baseline": sb, "similar_state": sk, "quantile_reg": sq, "n_neighbors": len(yk), "episodes": ep}
    bins = np.linspace(-60, 150 if k != "3Y" else 400, 60)
    a.hist(simple(yb) * 100, bins=bins, density=True, alpha=.4, label="Unconditional")
    a.hist(simple(yk) * 100, bins=bins, density=True, alpha=.55, label=f"Similar-state (n={len(yk)}, ~{ep} episodes)")
    for v in qq: a.axvline(simple(v) * 100, c="k", ls=":", lw=.8)
    a.axvline(0, c="r", lw=1); a.set_title(f"NDX forward {k} return distribution"); a.set_xlabel("%"); a.legend(fontsize=8)
    rep.append(f"### {k} (유사 상태 이웃 {len(yk)}일, 독립 에피소드 약 {ep}개)\n")
    rep.append("| 분포 | 5% | 25% | 50% | 75% | 95% | 손실확률 | +10%이상 | +20%이상 | -10%이하 |\n|---|---|---|---|---|---|---|---|---|---|")
    for nm, s in [("무조건", sb), ("A 유사상태", sk)]:
        rep.append(f"| {nm} | " + " | ".join(pct(s['q'][str(int(q*100))]) for q in QS) +
                   f" | {pct(s['P_loss'])} | {pct(s['P_gt10'])} | {pct(s['P_gt20'])} | {pct(s['P_lt_m10'])} |")
    rep.append("| B 분위수회귀 | " + " | ".join(pct(sq[str(int(q*100))]) for q in QS) + " | - | - | - | - |\n")
plt.tight_layout(); plt.savefig(OUT + f"ndx_forecast_dist_from1985_{TAG}.png", dpi=130); plt.close()

fig, ax = plt.subplots(2, 1, figsize=(13, 7), sharex=True)
ax[0].semilogy(px); ax[0].set_title("NDX (log)")
ax[1].fill_between(F.index, F["dd"] * 100, 0, color="tab:red", alpha=.5); ax[1].set_title("Drawdown from ATH (%)")
plt.tight_layout(); plt.savefig(OUT + f"ndx_price_dd_from1985_{TAG}.png", dpi=110); plt.close()

json.dump({"asof": str(last_date.date()), "close": float(px.iloc[-1]),
           "state": {k: float(v) for k, v in cur[["dd", "z200", "r252", "r252_pct", "trend_z", "vol63"]].items()},
           "forecast": summary, "walkforward_pinball": wf_store},
          open(OUT + f"ndx_forecast_from1985_{TAG}.json", "w"), ensure_ascii=False, indent=1)
open(OUT + f"ndx_report_from1985_{TAG}.md", "w").write("\n".join(rep))
print("\n".join(rep))
