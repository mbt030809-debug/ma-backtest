"""가격만 사용한 모델 비교 (워크포워드) - 2026-11-21
기준선 / 변동성 스케일 / GARCH-t 몬테카를로 / HMM 레짐 몬테카를로 / 분위수 신경망 / 앙상블
"""
import json, time, warnings
import numpy as np, pandas as pd, torch
from arch import arch_model
from hmmlearn.hmm import GaussianHMM
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
warnings.filterwarnings("ignore"); torch.set_num_threads(4)

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
HZ = {"6M": 126, "1Y": 252, "3Y": 756}
QS = np.array([0.05, 0.25, 0.5, 0.75, 0.95])
rng = np.random.default_rng(1)

px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
lp = np.log(px.values); n = len(lp); dates = px.index
ret = np.r_[np.nan, np.diff(lp)]
s = pd.Series(px.values)
X = np.c_[(s / s.cummax() - 1).values, (s / s.rolling(200).mean() - 1).values, (s / s.shift(252) - 1).values,
          (pd.Series(ret).rolling(63).std() * np.sqrt(252)).values, (s / s.shift(63) - 1).values]
START = 260
FIRST = 3000   # 첫 평가 시점(약 1997년)
PTS = list(range(FIRST, n - 126, 63))

def fwd(h): return np.r_[lp[h:] - lp[:-h], np.full(h, np.nan)]
Y = {k: fwd(h) for k, h in HZ.items()}

def pinball(y, q): return float(np.mean(np.maximum(QS * (y - q), (QS - 1) * (y - q))))

# ---- 모델들 ----
def m_base(i, h, y): return np.quantile(y[START:i - h + 1], QS)

def m_volscale(i, h, y):
    idx = np.arange(START, i - h + 1); sc = X[idx, 3] * np.sqrt(h / 252)
    z = y[idx] / sc
    return np.quantile(z, QS) * X[i, 3] * np.sqrt(h / 252)

def m_nn(i, h, y, base_q, seeds=3):
    idx = np.arange(START, i - h + 1)[::3]
    Xt = X[idx]; yt = y[idx]; mu, sd = Xt.mean(0), Xt.std(0) + 1e-9
    Xs = torch.tensor((Xt - mu) / sd, dtype=torch.float32); xq = torch.tensor(((X[i] - mu) / sd)[None], dtype=torch.float32)
    yy = torch.tensor(yt, dtype=torch.float32)[:, None]; q = torch.tensor(QS, dtype=torch.float32)[None]
    b = torch.tensor(base_q, dtype=torch.float32)[None]
    outs = []
    for sd_ in range(seeds):
        torch.manual_seed(sd_)
        net = torch.nn.Sequential(torch.nn.Linear(5, 16), torch.nn.Tanh(), torch.nn.Linear(16, 5))
        torch.nn.init.zeros_(net[2].weight); torch.nn.init.zeros_(net[2].bias)
        opt = torch.optim.Adam(net.parameters(), lr=3e-3, weight_decay=1e-2)
        for _ in range(100):
            opt.zero_grad(); p = b + net(Xs); e = yy - p
            torch.mean(torch.maximum(q * e, (q - 1) * e)).backward(); opt.step()
        outs.append((b + net(xq)).detach().numpy()[0])
    return np.sort(np.mean(outs, 0))

def garch_paths(i):
    am = arch_model(ret[1:i + 1] * 100, mean="Constant", vol="GARCH", p=1, q=1, dist="t")
    r = am.fit(disp="off")
    f = r.forecast(horizon=756, method="simulation", simulations=1000, reindex=False)
    return np.cumsum(f.simulations.values[-1], axis=1) / 100

def hmm_paths(i, K=3, P=1000, H=756):
    R = (ret[1:i + 1] * 100)[:, None]
    best = None
    for seed in (0, 1):
        m = GaussianHMM(K, covariance_type="diag", n_iter=100, tol=1e-3, random_state=seed).fit(R)
        sc = m.score(R)
        if best is None or sc > best[0]: best = (sc, m)
    m = best[1]; post = m.predict_proba(R)[-1]
    mean = m.means_.ravel(); sdv = np.sqrt(np.array([np.ravel(c)[0] for c in m.covars_]))
    cur = rng.choice(K, size=P, p=post); cum = np.zeros((P, H)); acc = np.zeros(P)
    cp = np.cumsum(m.transmat_, axis=1)
    for t in range(H):
        u = rng.random(P); cur = (u[:, None] > cp[cur]).sum(1).clip(0, K - 1)
        acc += rng.normal(mean[cur], sdv[cur]); cum[:, t] = acc
    return cum / 100

NAMES = ["base", "volscale", "garch", "hmm", "nn"]
pred = {k: {m: [] for m in NAMES} for k in HZ}   # (i, q)
t0 = time.time()
for j, i in enumerate(PTS):
    gp = garch_paths(i); hp = hmm_paths(i)
    for k, h in HZ.items():
        if i + h > n - 1: continue
        y = Y[k]
        b = m_base(i, h, y)
        P = {"base": b, "volscale": m_volscale(i, h, y), "garch": np.quantile(gp[:, h - 1], QS),
             "hmm": np.quantile(hp[:, h - 1], QS), "nn": m_nn(i, h, y, b)}
        for m, q in P.items(): pred[k][m].append((i, q))
    if j % 10 == 0: print(f"{j}/{len(PTS)} {time.time()-t0:.0f}s", flush=True)

# ---- 평가 ----
rows = []; res = {}
for k, h in HZ.items():
    idxs = [i for i, _ in pred[k]["base"]]; ys = np.array([Y[k][i] for i in idxs])
    allq = {m: np.array([q for _, q in pred[k][m]]) for m in NAMES}
    allq["avg(base,vol,garch,nn)"] = np.mean([allq[m] for m in ["base", "volscale", "garch", "nn"]], 0)
    allq["avg(base,nn)"] = np.mean([allq[m] for m in ["base", "nn"]], 0)
    b = np.mean([pinball(y, q) for y, q in zip(ys, allq["base"])])
    for m, Q in allq.items():
        pb = np.mean([pinball(y, q) for y, q in zip(ys, Q)])
        c90 = np.mean((ys >= Q[:, 0]) & (ys <= Q[:, 4])); c50 = np.mean((ys >= Q[:, 1]) & (ys <= Q[:, 3]))
        med = np.mean(ys <= Q[:, 2])
        rows.append((k, m, pb, pb / b - 1, c90, c50, med, len(ys)))
        res.setdefault(k, {})[m] = dict(pinball=pb, rel=pb / b - 1, cov90=c90, cov50=c50, below_median=med)
df = pd.DataFrame(rows, columns=["horizon", "model", "pinball", "vs_base", "cov90", "cov50", "below_median", "n"])
md = ["# 가격 전용 모델 비교 (워크포워드, " + TAG + ")\n",
      "평가 시점 " + f"{dates[PTS[0]].date()} ~ {dates[PTS[-1]].date()}, 63거래일 간격. pinball은 낮을수록 좋음. "
      "cov90/cov50은 각각 90%/50%에 가까울수록 보정이 좋음, below_median은 50%에 가까울수록 중앙값 편향 없음\n",
      df.to_markdown(index=False, floatfmt=".3f")]
open(OUT + f"ndx_models_compare_{TAG}.md", "w").write("\n".join(md))

# ---- 현재 시점 예측 ----
cur = {}
gp = garch_paths(n - 1); hp = hmm_paths(n - 1)
for k, h in HZ.items():
    y = Y[k]; i = n - 1; b = m_base(i, h, y)
    Pq = {"base": b, "volscale": m_volscale(i, h, y), "garch": np.quantile(gp[:, h - 1], QS),
          "hmm": np.quantile(hp[:, h - 1], QS), "nn": m_nn(i, h, y, b)}
    Pq["avg(base,vol,garch,nn)"] = np.mean([Pq[m] for m in ["base", "volscale", "garch", "nn"]], 0)
    cur[k] = {m: [float(np.exp(v) - 1) for v in q] for m, q in Pq.items()}
json.dump({"asof": str(dates[-1].date()), "close": float(px.values[-1]), "quantiles_5_25_50_75_95": cur, "eval": res},
          open(OUT + f"ndx_models_compare_{TAG}.json", "w"), indent=1, ensure_ascii=False)

# ---- 차트 ----
fig, ax = plt.subplots(1, 2, figsize=(14, 4.8))
ms = list(df.model.unique()); w = 0.8 / len(ms)
for j, m in enumerate(ms):
    ax[0].bar(np.arange(3) + j * w, [df[(df.horizon == k) & (df.model == m)].vs_base.values[0] * 100 for k in HZ], w, label=m)
ax[0].axhline(0, c="k", lw=.8); ax[0].set_xticks(np.arange(3) + .4); ax[0].set_xticklabels(list(HZ))
ax[0].set_ylabel("pinball vs baseline (%) lower=better"); ax[0].legend(fontsize=7); ax[0].set_title("Walk-forward score")
k = "1Y"; ms2 = list(cur[k]); yv = np.arange(len(ms2))
for yi, m in zip(yv, ms2):
    q = np.array(cur[k][m]) * 100
    ax[1].plot([q[0], q[4]], [yi, yi], c="tab:blue", lw=2); ax[1].plot([q[1], q[3]], [yi, yi], c="tab:blue", lw=6); ax[1].plot(q[2], yi, "wo", mec="k")
ax[1].set_yticks(yv); ax[1].set_yticklabels(ms2); ax[1].axvline(0, c="r", lw=.8); ax[1].set_title("Current 1Y return forecast (5/25/50/75/95%)"); ax[1].set_xlabel("%")
plt.tight_layout(); plt.savefig(OUT + f"ndx_models_compare_{TAG}.png", dpi=130)
print("\n".join(md)); print(json.dumps(cur, indent=1))
