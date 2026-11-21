"""바닥(최저점)·전고점 탈환 예측 - 검증에서 채택된 '유사 낙폭 사건' 방식 - 2026-11-21
현재와 비슷한 낙폭(±5%p)이었던 과거 시점들을 에피소드(전고점) 단위 동일 가중으로 모아:
 - 전고점 회복 전 최저점(현재가 대비), 1/3/6개월 내 최저점, 전고점 탈환 확률·기간
검증(ndx_bottom_validate_*.md)에서 시뮬레이션 방식(변동성 부트스트랩·로그정규)과 '하락 중 조건' 방식보다 정확해 채택.
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
ups = [i for i in range(n) if pk[i] == i]; R = {a: b for a, b in zip(ups[:-1], ups[1:])}
CAP = 1260; now = dd[-1]; lastP = c[-1]
cand = [s for s in range(n - 1) if abs(dd[s] - now) <= 0.05 and dd[s] < -0.01]

def wq(v, w, q):
    v = np.asarray(v, float); w = np.asarray(w, float); o = np.argsort(v, kind="stable"); v = v[o]; cw = np.cumsum(w[o])
    return float(v[min(len(v) - 1, np.searchsorted(cw, q * cw[-1] - 1e-12))])

def episodes_weights(samples):
    byep = {}
    for s in samples: byep.setdefault(pk[s], []).append(s)
    return {s: 1.0 / len(v) for v in byep.values() for s in v}, len(byep)

# --- 전고점 회복 전 최저점 + 탈환 기간 (결과가 확정된 사건만) ---
known = [s for s in cand if pk[s] in R]
w_k, ne_k = episodes_weights(known)
F = np.array([c[s:min(R[pk[s]], s + CAP) + 1].min() / c[s] - 1 for s in known])
D = np.array([min(R[pk[s]] - s, CAP) for s in known], float); W = np.array([w_k[s] for s in known])
levels = {p: wq(F, W, 1 - p) for p in [0.5, 0.75, 0.9]}
exceed = {x: float(W[F <= x].sum() / W.sum()) for x in [-0.05, -0.10, -0.15, -0.20, -0.30]}
rec = {h: float(W[D <= h].sum() / W.sum()) for h in [21, 63, 126, 252]}
dq = {q: wq(D, W, q) for q in [0.25, 0.5, 0.75, 0.9]}
# --- 1/3/6개월 내 최저점 ---
hz = {}
for h in [21, 63, 126]:
    ss = [s for s in cand if s + h <= n - 1]; w_h, ne = episodes_weights(ss)
    v = np.array([c[s:s + h + 1].min() / c[s] - 1 for s in ss]); ww = np.array([w_h[s] for s in ss])
    hz[h] = dict(levels={p: wq(v, ww, 1 - p) for p in [0.5, 0.75, 0.9]},
                 exceed={x: float(ww[v <= x].sum() / ww.sum()) for x in [-0.05, -0.10, -0.20]}, episodes=ne)
res = dict(now_dd=float(now), lastP=float(lastP), episodes=ne_k, samples=len(known),
           until=dict(levels={str(k): v for k, v in levels.items()}, prices={str(k): float(lastP * (1 + v)) for k, v in levels.items()},
                      exceed={str(k): v for k, v in exceed.items()}, rec={str(k): v for k, v in rec.items()}, dq={str(k): v for k, v in dq.items()}),
           hz={str(h): dict(levels={str(k): v for k, v in d["levels"].items()}, exceed={str(k): v for k, v in d["exceed"].items()}, episodes=d["episodes"]) for h, d in hz.items()})
json.dump(res, open(OUT + f"ndx_bottom_{TAG}.json", "w"), indent=1)

md = [f"# 바닥·전고점 탈환 예측 ({TAG})\n", f"- 현재 {dates[-1].date()} 종가 {lastP:,.0f}, 전고점 대비 {now*100:.1f}%",
      f"- 비슷한 낙폭(±5%p)이었던 과거 시점 중 결과 확정 {len(known)}개, 에피소드 {ne_k}개 (에피소드당 동일 가중)",
      "- 채택 근거: 검증(`ndx_bottom_validate_20261121.md`)에서 시뮬레이션·'하락 중 조건' 방식보다 최저점 pinball·보정이 좋았음\n",
      "## 1/3/6개월 내 최저점 (현재가 대비)\n", "| 확률(최저점이 이 가격 위) | 1개월 | 3개월 | 6개월 | 회복 전까지 |\n|---|---|---|---|---|"]
for p in [0.5, 0.75, 0.9]:
    md.append(f"| {p*100:.0f}% | " + " | ".join(f"{hz[h]['levels'][p]*100:.1f}% ({lastP*(1+hz[h]['levels'][p]):,.0f})" for h in [21, 63, 126]) +
              f" | {levels[p]*100:.1f}% ({lastP*(1+levels[p]):,.0f}) |")
md += ["\n## 추가 하락 도달 확률\n", "| 추가 하락 | 1개월 | 3개월 | 6개월 | 회복 전까지 |\n|---|---|---|---|---|"]
for x, xe in [(-0.05, -0.05), (-0.10, -0.10), (-0.20, -0.20)]:
    md.append(f"| {x*100:.0f}% 이하 | " + " | ".join(f"{hz[h]['exceed'][x]*100:.0f}%" for h in [21, 63, 126]) + f" | {exceed[x]*100:.0f}% |")
md += ["\n## 전고점 탈환\n", "| 기간 내 탈환 확률 | 1개월 | 3개월 | 6개월 | 1년 |\n|---|---|---|---|---|",
       "| 확률 | " + " | ".join(f"{rec[h]*100:.0f}%" for h in [21, 63, 126, 252]) + " |",
       "\n| 탈환까지 걸린 기간 | 25% 이내 | 50% 이내 | 75% 이내 | 90% 이내 |\n|---|---|---|---|---|",
       "| 개월 | " + " | ".join((f"{dq[q]/21:.1f}" if dq[q] < CAP else ">60") for q in [0.25, 0.5, 0.75, 0.9]) + " |",
       "\n주의: 사건 수가 적고(에피소드 약 %d개) 바닥은 사후에 확정되므로 시점이 아닌 확률 범위임. 2000년처럼 15년 걸린 사례는 5년으로 상한 처리." % ne_k]
open(OUT + f"ndx_bottom_{TAG}.md", "w").write("\n".join(md))
print("\n".join(md))
