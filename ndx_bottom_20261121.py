"""바닥(이번 하락의 최저점) 확률 분석 - 가격만 사용 - 2026-11-21
현재와 비슷한 낙폭(±5%p) 시점들에서, 전고점 회복 전까지의 최저점(현재가 대비)과 바닥까지 걸린 기간을 측정.
전고점(에피소드) 단위 동일 가중. 아직 회복 못 한 사건(진행 중)은 최저점이 확정 안 되어 제외.
"""
import json
import numpy as np, pandas as pd

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
c = px.values; n = len(c); dates = px.index
peak = np.maximum.accumulate(c); dd = c / peak - 1
pk = np.zeros(n, int); cur = 0
for i in range(n):
    if c[i] >= peak[i] - 1e-12: cur = i
    pk[i] = cur
now = dd[-1]
runmin = np.zeros(n)
for i in range(n): runmin[i] = dd[i] if pk[i] == i else min(runmin[i - 1], dd[i])
TOL = 0.03   # 하락 중(그 사건의 최저점 +3%p 이내)인 시점만 사용: 반등 중인 날이 섞이면 바닥이 과소평가됨
match = [t for t in range(n - 1) if abs(dd[t] - now) <= 0.05 and dd[t] < -0.01 and dd[t] <= runmin[t] + TOL]
eps = {}
for t in match: eps.setdefault(pk[t], []).append(t)

def recov(t):
    u = np.where(c[t + 1:] >= peak[t])[0]
    return t + 1 + u[0] if len(u) else None

S = []   # (drop, days, weight, episode)
ep_rows = []
for p_, ts in sorted(eps.items()):
    w = 1.0 / len(ts); drops = []; days = []
    for t in ts:
        r = recov(t)
        if r is None: continue
        seg = c[t:r + 1]; j = int(np.argmin(seg)); mn = seg[j] / c[t] - 1
        S.append((mn, j, w, p_)); drops.append(mn); days.append(j)
    if drops:
        ep_rows.append(dict(peak=str(dates[p_].date()), matched_days=len(ts), median_further_drop=float(np.median(drops)),
                            worst_further_drop=float(np.min(drops)), median_days_to_bottom=float(np.median(days))))
    else:
        ep_rows.append(dict(peak=str(dates[p_].date()), matched_days=len(ts), median_further_drop=np.nan, worst_further_drop=np.nan,
                            median_days_to_bottom=np.nan))
mn = np.array([s[0] for s in S]); dy = np.array([s[1] for s in S]); w = np.array([s[2] for s in S]); w = w / w.sum()

def wq(v, w, q):
    o = np.argsort(v); v = v[o]; cw = np.cumsum(w[o]); return float(v[np.searchsorted(cw, q * cw[-1])])
lastP = c[-1]
P_LEV = [0.50, 0.75, 0.90, 0.95]
levels = {p: wq(mn, w, 1 - p) for p in P_LEV}       # P(최저점 > 이 수준) = p
days_q = {q: wq(dy.astype(float), w, q) for q in [0.5, 0.75, 0.9]}
exceed = {x: float(w[mn <= x].sum()) for x in [-0.05, -0.10, -0.15, -0.20, -0.30]}
res = {"now_dd": float(now), "episodes_used": len({s[3] for s in S}), "samples": len(S), "lastP": float(lastP),
       "levels_further_drop": {str(p): v for p, v in levels.items()}, "level_prices": {str(p): float(lastP * (1 + v)) for p, v in levels.items()},
       "days_to_bottom_q": {str(q): v for q, v in days_q.items()}, "exceed_prob": {str(x): v for x, v in exceed.items()}}
json.dump(res, open(OUT + f"ndx_bottom_{TAG}.json", "w"), indent=1)
E = pd.DataFrame(ep_rows)
md = [f"# 바닥(이번 하락의 최저점) 분석 ({TAG})\n",
      f"- 현재 {dates[-1].date()} 종가 {lastP:,.0f}, 전고점 대비 {now*100:.1f}%",
      f"- 비슷한 낙폭(±5%p)이면서 **하락 중**(그 사건의 최저점 +3%p 이내, 현재도 최저점 상태)이었고 이후 전고점을 회복한 사건 {res['episodes_used']}개 (진행 중 사건 제외), 에피소드당 동일 가중\n",
      "## 이번 하락의 최저점 (현재가 대비 추가 하락 / 가격)\n", "| 최저점이 이 가격보다 높을 확률 | 추가 하락 | 가격 |\n|---|---|---|"]
for p in P_LEV: md.append(f"| {p*100:.0f}% | {levels[p]*100:.1f}% | {lastP*(1+levels[p]):,.0f} |")
md += ["\n## 추가 하락이 이 수준을 넘을 확률 (전고점 회복 전까지)\n", "| 추가 하락 | 확률 |\n|---|---|"]
for x, v in exceed.items(): md.append(f"| {x*100:.0f}% 이하 | {v*100:.0f}% |")
md += ["\n## 바닥까지 걸린 기간 (거래일 → 개월)\n", "| 분위 | 거래일 | 개월 |\n|---|---|---|"]
for q, v in days_q.items(): md.append(f"| {q*100:.0f}% | {v:.0f} | {v/21:.1f} |")
md += ["\n## 에피소드별\n", E.to_markdown(index=False, floatfmt=".3f"),
       "\n주의: 사건 수가 적고, 2000·2022처럼 같은 낙폭에서 훨씬 더 빠진 사례가 있음. '바닥'은 사후에야 확정되므로 시점 예측이 아니라 확률 범위임."]
open(OUT + f"ndx_bottom_{TAG}.md", "w").write("\n".join(md))
print("\n".join(md))
