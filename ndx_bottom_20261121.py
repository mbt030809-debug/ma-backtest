"""바닥(최저점)·전고점 탈환 예측 - 2000·2008 포함, 예외·상한 없음 - 2026-11-21
낙폭 = 최근 1년(252거래일) 고점 대비. 현재와 비슷한 낙폭(±5%p)이면서 하락 중(최근 20일 최저 낙폭 +3%p 이내)이었던 과거 시점을
사건(연속 구간) 단위 동일 가중으로 모아: 고점 회복 전 최저점, 1/3/6개월 내 최저점, 고점 탈환 확률·기간.
검증(ndx_bottom_validate_*.md)에서 시뮬레이션(변동성 부트스트랩·로그정규)과 같거나 더 정확해 채택. 회복 기간 상한·이상치 제외 없음.
"""
import json
import numpy as np, pandas as pd

TAG = "20261121"; OUT = "/home/user/ma-backtest/"
px = pd.read_csv(OUT + f"ndx_close_{TAG}.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
c = px.values; n = len(c); dates = px.index
H = pd.Series(c).rolling(252, min_periods=252).max().values; dd = c / H - 1
now = dd[-1]; lastP = c[-1]; t = n - 1
_rec = {}
def rec(s):
    if s not in _rec:
        u = np.where(c[s + 1:] >= H[s])[0]; _rec[s] = s + 1 + int(u[0]) if len(u) else None
    return _rec[s]
def clusters(idx, gap=63):
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
def hmin(s, h): return c[s:s + h + 1].min() / c[s] - 1

base = [s for s in range(252, n - 1) if abs(dd[s] - now) <= 0.05 and dd[s] < -0.01 and dd[s] <= np.nanmin(dd[max(252, s - 20):s + 1]) + 0.03]
known = [s for s in base if rec(s) is not None]
idx, w, ne = clusters(known); w = np.array(w)
F = np.array([c[s:rec(s) + 1].min() / c[s] - 1 for s in idx]); D = np.array([rec(s) - s for s in idx], float)
levels = {p: wq(F, w, 1 - p) for p in [0.5, 0.75, 0.9]}
exceed = {x: float(w[F <= x].sum() / w.sum()) for x in [-0.05, -0.10, -0.15, -0.20, -0.30]}
recp = {h: float(w[D <= h].sum() / w.sum()) for h in [21, 63, 126, 252]}
dq = {q: wq(D, w, q) for q in [0.25, 0.5, 0.75, 0.9]}
hz = {}
for h in [21, 63, 126]:
    i2, w2, ne2 = clusters([s for s in base if s + h <= n - 1]); w2 = np.array(w2); v = np.array([hmin(s, h) for s in i2])
    hz[h] = dict(levels={p: wq(v, w2, 1 - p) for p in [0.5, 0.75, 0.9]}, exceed={x: float(w2[v <= x].sum() / w2.sum()) for x in [-0.05, -0.10, -0.20]}, events=ne2)
cl_dates = []
cl = {}
for s in idx: cl.setdefault(str(dates[s].date())[:7], 0)
res = dict(now_dd=float(now), lastP=float(lastP), events=ne, samples=len(idx),
           until=dict(levels={str(k): v for k, v in levels.items()}, prices={str(k): float(lastP * (1 + v)) for k, v in levels.items()},
                      exceed={str(k): v for k, v in exceed.items()}, rec={str(k): v for k, v in recp.items()}, dq={str(k): v for k, v in dq.items()}),
           hz={str(h): dict(levels={str(k): v for k, v in d["levels"].items()}, exceed={str(k): v for k, v in d["exceed"].items()}, events=d["events"]) for h, d in hz.items()})
json.dump(res, open(OUT + f"ndx_bottom_{TAG}.json", "w"), indent=1)

# 사건 목록(투명성): 포함된 모든 사건 (2000·2008 포함)
ev = []
cur_ids = []; prev = None; grp = []
for s in idx:
    if prev is None or s - prev > 63:
        if grp: cur_ids.append(grp)
        grp = []
    grp.append(s); prev = s
cur_ids.append(grp)
for g in cur_ids:
    Fg = [c[s:rec(s) + 1].min() / c[s] - 1 for s in g]; Dg = [rec(s) - s for s in g]
    ev.append(dict(start=str(dates[g[0]].date()), end=str(dates[g[-1]].date()), days=len(g), median_further_drop=f"{np.median(Fg)*100:.0f}%",
                   worst_further_drop=f"{min(Fg)*100:.0f}%", median_days_to_recover=int(np.median(Dg))))
mo = lambda d: f"{d/21:.1f}개월" if d < 504 else f"{d/252:.1f}년"
md = [f"# 바닥·전고점 탈환 예측 ({TAG}) - 2000·2008 포함, 예외·상한 없음\n", f"- 현재 {dates[-1].date()} 종가 {lastP:,.0f}, 최근 1년 고점 대비 {now*100:.1f}%",
      f"- 비슷한 낙폭(±5%p)이면서 하락 중이었던 과거 사건 {ne}개 (결과 확정 시점 {len(idx)}개, 사건 단위 동일 가중). 이상치 제외·회복 기간 상한 없음",
      "- 방식 선정: `ndx_bottom_validate_20261121.md` 참고\n",
      "## 1/3/6개월 내 최저점 (현재가 대비)\n", "| 확률(최저점이 이 가격 위) | 1개월 | 3개월 | 6개월 | 회복 전까지 |\n|---|---|---|---|---|"]
for p in [0.5, 0.75, 0.9]:
    md.append(f"| {p*100:.0f}% | " + " | ".join(f"{hz[h]['levels'][p]*100:.1f}% ({lastP*(1+hz[h]['levels'][p]):,.0f})" for h in [21, 63, 126]) + f" | {levels[p]*100:.1f}% ({lastP*(1+levels[p]):,.0f}) |")
md += ["\n## 추가 하락 도달 확률\n", "| 추가 하락 | 1개월 | 3개월 | 6개월 | 회복 전까지 |\n|---|---|---|---|---|"]
for x in [-0.05, -0.10, -0.20]:
    md.append(f"| {x*100:.0f}% 이하 | " + " | ".join(f"{hz[h]['exceed'][x]*100:.0f}%" for h in [21, 63, 126]) + f" | {exceed[x]*100:.0f}% |")
md.append(f"| -30% 이하 | - | - | - | {exceed[-0.30]*100:.0f}% |")
md += ["\n## 고점 탈환\n", "| 기간 내 탈환 확률 | 1개월 | 3개월 | 6개월 | 1년 |\n|---|---|---|---|---|", "| 확률 | " + " | ".join(f"{recp[h]*100:.0f}%" for h in [21, 63, 126, 252]) + " |",
       "\n| 탈환까지 걸린 기간 | 25% 이내 | 50% 이내 | 75% 이내 | 90% 이내 |\n|---|---|---|---|---|", "| 기간 | " + " | ".join(mo(dq[q]) for q in [0.25, 0.5, 0.75, 0.9]) + " |",
       "\n## 포함된 사건 (전부)\n", pd.DataFrame(ev).to_markdown(index=False),
       "\n주의: 바닥은 사후에 확정되므로 시점이 아닌 확률 범위임. 사건 수가 적어 불확실성이 큼."]
open(OUT + f"ndx_bottom_{TAG}.md", "w").write("\n".join(md))
print("\n".join(md))
