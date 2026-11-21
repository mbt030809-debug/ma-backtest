"""낙폭 회복 분석 + 변동성 보정 현재 분포 (가격만) - 2026-11-21
현재와 비슷한 낙폭(±5%p) 시점들에서: 전고점 회복까지 걸린 기간, 추가 하락 확률. 에피소드(전고점 단위)로 가중해 한 사건이 지배하지 않게 함.
"""
import json
import numpy as np, pandas as pd

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
c = px.values; n = len(c); dates = px.index
peak = np.maximum.accumulate(c); dd = c / peak - 1
# 전고점 에피소드 id = 해당 전고점이 생긴 인덱스
pk_idx = np.zeros(n, int); cur = 0
for i in range(n):
    if c[i] >= peak[i] - 1e-12: cur = i
    pk_idx[i] = cur
now = dd[-1]; BAND = 0.05
match = [t for t in range(n - 1) if abs(dd[t] - now) <= BAND and dd[t] < -0.01]
HZ = [126, 252, 504, 756]; FURTHER = [-0.10, -0.20, -0.30]

# 회복일: t 이후 처음 c >= peak[t]
def recov_day(t):
    u = np.where(c[t + 1:] >= peak[t])[0]
    return (t + 1 + u[0]) if len(u) else None

eps = {}
for t in match: eps.setdefault(pk_idx[t], []).append(t)
w = {t: 1.0 / len(v) for v in eps.values() for t in v}
rows = []; res = {h: [0.0, 0.0] for h in HZ}            # [회복 가중합, 가중 표본합]
fur = {x: [0.0, 0.0] for x in FURTHER}; days_rec = []
for pk, ts in sorted(eps.items()):
    rd = [recov_day(t) for t in ts]
    rec_days = [r - t for r, t in zip(rd, ts) if r is not None]
    rows.append(dict(peak=str(dates[pk].date()), matched_days=len(ts), recovered=any(r is not None for r in rd),
                     first_match=str(dates[ts[0]].date()), median_days_to_recover=float(np.median(rec_days)) if rec_days else np.nan))
    for t, r in zip(ts, rd):
        for h in HZ:
            known = (r is not None and r - t <= h) or (t + h <= n - 1)   # 회복했거나 추적기간이 충분
            if known:
                res[h][0] += w[t] * (r is not None and r - t <= h); res[h][1] += w[t]
        if r is not None: days_rec.append((r - t, w[t]))
        if t + 252 <= n - 1 or (c[t + 1:t + 253].min() / c[t] - 1 <= -0.10):
            mn = c[t + 1:min(n, t + 253)].min() / c[t] - 1
            for x in FURTHER:
                if t + 252 <= n - 1 or mn <= x: fur[x][0] += w[t] * (mn <= x); fur[x][1] += w[t]
rec_p = {h: res[h][0] / res[h][1] if res[h][1] else None for h in HZ}
fur_p = {x: fur[x][0] / fur[x][1] if fur[x][1] else None for x in FURTHER}
E = pd.DataFrame(rows)
md = [f"# 낙폭 회복 분석 ({TAG})\n", f"- 현재(2026-11-20): 전고점 대비 {now*100:.1f}%, 비교 구간 {(now-BAND)*100:.1f}% ~ {(now+BAND)*100:.1f}%",
      f"- 해당 상태였던 에피소드(전고점 단위) {len(eps)}개, 해당 일수 {len(match)}일 (에피소드당 동일 가중)\n",
      "## 전고점 회복 확률 (이후 N개월 내)\n", "| 기간 | 회복 확률 |\n|---|---|"]
for h in HZ: md.append(f"| {h//21}개월 | {rec_p[h]*100:.0f}% |")
md += ["\n## 이후 1년 내 현재가 대비 추가 하락 도달 확률\n", "| 추가 하락 | 확률 |\n|---|---|"]
for x in FURTHER: md.append(f"| {x*100:.0f}% 이하 | {fur_p[x]*100:.0f}% |")
md += ["\n## 에피소드별 (비슷한 낙폭이었던 사건)\n", E.to_markdown(index=False, floatfmt=".0f") + "\n",
       "주의: 독립 에피소드 수가 적어 확률의 불확실성이 큼 (표본 수 자체가 한계)"]
open(OUT + f"ndx_recovery_{TAG}.md", "w").write("\n".join(md))

# ---- 변동성 보정 현재 분포 (JS 검증용) ----
QS = np.array([0.05, 0.25, 0.5, 0.75, 0.95]); lp = np.log(c); ret = pd.Series(np.r_[np.nan, np.diff(lp)])
sig = (ret.rolling(63).std()).values * np.sqrt(252)   # 튜닝구간 선택: vol63 + 드리프트 고정
cur = {}
for h in [126, 252, 756]:
    tr = np.arange(300, n - h); y = lp[tr + h] - lp[tr]; md_ = np.median(y); z = (y - md_) / (sig[tr] * np.sqrt(h / 252))
    ys = md_ + z * sig[-1] * np.sqrt(h / 252); s = np.exp(ys) - 1
    cur[h] = dict(q=[float(np.exp(np.quantile(ys, q)) - 1) for q in QS], pLoss=float((s < 0).mean()), pLtM10=float((s < -.1).mean()),
                  pGt10=float((s > .1).mean()), pGt20=float((s > .2).mean()))
json.dump({"sigma_now": float(sig[-1]), "recovery": {str(k): v for k, v in rec_p.items()}, "further": {str(k): v for k, v in fur_p.items()},
           "episodes": len(eps), "vol_scaled_current": cur}, open(OUT + f"ndx_recovery_{TAG}.json", "w"), indent=1)
print("\n".join(md)); print(json.dumps(cur, indent=1)); print("sigma_now", sig[-1])
