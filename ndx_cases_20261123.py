"""2000·2008 포함 / 제외 두 케이스 비교 - 2026-11-23
제외 = 닷컴(2000-03-01~2002-12-31)·금융위기(2007-10-01~2009-06-30) 기간과 '표본 경로'가 하나라도 겹치면 그 표본을 사용하지 않음.
포함 = 전체 데이터 그대로(예외·상한 없음).
산출: (1) 변동성 보정 수익률 분포(1개월~3년) (2) 바닥·전고점 탈환(유사 낙폭 사건 방식)
"""
import json
import numpy as np, pandas as pd

TAG = "20261123"; OUT = "/home/user/ma-backtest/"
px = pd.read_csv(OUT + "ndx_close_20261121.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
c = px.values; n = len(c); dates = px.index; lp = np.log(c)
CRISES = [("2000-03-01", "2002-12-31"), ("2007-10-01", "2009-06-30")]
mask = np.zeros(n, bool)
for a, b in CRISES: mask |= (dates >= a) & (dates <= b)
cs = np.r_[0, np.cumsum(mask)]
def ov(a, b): return cs[min(b, n - 1) + 1] - cs[a] > 0
ret = pd.Series(np.r_[np.nan, np.diff(lp)]); v63 = (ret.rolling(63).std() * np.sqrt(252)).values
H252 = pd.Series(c).rolling(252, min_periods=252).max().values; dd = c / H252 - 1
QS = [0.05, 0.25, 0.5, 0.75, 0.95]

def forecast(excl):
    out = {}; sig = v63[-1]
    for h in [21, 63, 126, 252, 756]:
        tv = [t for t in range(300, n - h) if not (excl and ov(t, t + h))]
        y = np.array([lp[t + h] - lp[t] for t in tv]); med = np.median(y); sc = np.sqrt(h / 252)
        z = (y - med) / (v63[tv] * sc); ys = med + z * sig * sc; s = np.exp(ys) - 1
        out[h] = dict(q=[float(np.exp(np.quantile(ys, q)) - 1) for q in QS], pLoss=float((s < 0).mean()), pLtM10=float((s < -.1).mean()), n=len(tv))
    return out

_rec = {}
def rec(s):
    if s not in _rec:
        u = np.where(c[s + 1:] >= H252[s])[0]; _rec[s] = s + 1 + int(u[0]) if len(u) else None
    return _rec[s]
def clusters(idx, gap=63):
    idx = sorted(idx); cid = []; cur = -1; prev = None
    for s in idx:
        if prev is None or s - prev > gap: cur += 1
        cid.append(cur); prev = s
    cnt = {}
    for k in cid: cnt[k] = cnt.get(k, 0) + 1
    return idx, np.array([1.0 / cnt[k] for k in cid]), len(cnt)
def wq(v, w, q):
    v = np.asarray(v, float); o = np.argsort(v, kind="stable"); cw = np.cumsum(np.asarray(w)[o])
    return float(v[o][min(len(v) - 1, np.searchsorted(cw, q * cw[-1] - 1e-12))])

def analogs(excl):
    now = dd[-1]; lastP = c[-1]
    base = [s for s in range(252, n - 1) if abs(dd[s] - now) <= 0.05 and dd[s] < -0.01 and dd[s] <= np.nanmin(dd[max(252, s - 20):s + 1]) + 0.03]
    known = [s for s in base if rec(s) is not None and not (excl and ov(s, rec(s)))]
    idx, w, ne = clusters(known)
    F = np.array([c[s:rec(s) + 1].min() / c[s] - 1 for s in idx]); D = np.array([rec(s) - s for s in idx], float)
    r = dict(events=ne, samples=len(idx), levels={p: wq(F, w, 1 - p) for p in [0.5, 0.75, 0.9]},
             exceed={x: float(w[F <= x].sum() / w.sum()) for x in [-0.05, -0.10, -0.20, -0.30]},
             rec={h: float(w[D <= h].sum() / w.sum()) for h in [21, 63, 126, 252]}, dq={q: wq(D, w, q) for q in [0.25, 0.5, 0.75, 0.9]}, hz={})
    for h in [21, 63, 126]:
        ss = [s for s in base if s + h <= n - 1 and not (excl and ov(s, s + h))]; i2, w2, ne2 = clusters(ss)
        v = np.array([c[s:s + h + 1].min() / c[s] - 1 for s in i2])
        r["hz"][h] = dict(levels={p: wq(v, w2, 1 - p) for p in [0.5, 0.75, 0.9]}, exceed={x: float(w2[v <= x].sum() / w2.sum()) for x in [-0.05, -0.10, -0.20]}, events=ne2)
    return r

res = {"incl": dict(forecast=forecast(False), analog=analogs(False)), "excl": dict(forecast=forecast(True), analog=analogs(True))}
json.dump(res, open(OUT + f"ndx_cases_{TAG}.json", "w"), indent=1, default=float)

P = lambda x: f"{x*100:.1f}%"
mo = lambda d: f"{d/21:.1f}개월" if d < 504 else f"{d/252:.1f}년"
lastP = c[-1]
md = [f"# 2000·2008 포함 / 제외 비교 ({TAG})\n", f"- 기준: NDX {dates[-1].date()} 종가 {lastP:,.0f}, 1년 고점 대비 {dd[-1]*100:.1f}%",
      "- **포함**: 전체 데이터 그대로 (예외·상한 없음)", "- **제외**: 닷컴(2000-03-01~2002-12-31)·금융위기(2007-10-01~2009-06-30)와 경로가 하나라도 겹치는 표본은 사용하지 않음\n",
      "## 1. 수익률 분포 (변동성 보정)\n", "| 기간 | 케이스 | 최악 5% | 25% | 중앙값 | 75% | 상위 5% | 손실확률 | -10%↓ | 표본 |\n|---|---|---|---|---|---|---|---|---|---|"]
nm = {21: "1개월", 63: "3개월", 126: "6개월", 252: "1년", 756: "3년"}
for h in [21, 63, 126, 252, 756]:
    for k, lab in [("incl", "포함"), ("excl", "제외")]:
        f = res[k]["forecast"][h]
        md.append(f"| {nm[h]} | {lab} | " + " | ".join(P(x) for x in f["q"]) + f" | {f['pLoss']*100:.0f}% | {f['pLtM10']*100:.0f}% | {f['n']} |")
md += ["\n## 2. 바닥 예측 (유사 낙폭 사건)\n", "| 확률(최저점이 이 가격 위) | 케이스 | 1개월 | 3개월 | 6개월 | 회복 전까지 |\n|---|---|---|---|---|---|"]
for p in [0.5, 0.75, 0.9]:
    for k, lab in [("incl", "포함"), ("excl", "제외")]:
        a = res[k]["analog"]
        md.append(f"| {p*100:.0f}% | {lab} | " + " | ".join(f"{P(a['hz'][h]['levels'][p])} ({lastP*(1+a['hz'][h]['levels'][p]):,.0f})" for h in [21, 63, 126]) + f" | {P(a['levels'][p])} ({lastP*(1+a['levels'][p]):,.0f}) |")
md += ["\n| 추가 하락 도달 확률 | 케이스 | 1개월 | 3개월 | 6개월 | 회복 전까지 |\n|---|---|---|---|---|---|"]
for x in [-0.05, -0.10, -0.20]:
    for k, lab in [("incl", "포함"), ("excl", "제외")]:
        a = res[k]["analog"]
        md.append(f"| {x*100:.0f}% 이하 | {lab} | " + " | ".join(f"{a['hz'][h]['exceed'][x]*100:.0f}%" for h in [21, 63, 126]) + f" | {a['exceed'][x]*100:.0f}% |")
md += ["\n## 3. 전고점(1년 고점) 탈환\n", "| 케이스 | 사건 수 | 1개월 | 3개월 | 6개월 | 1년 | 50% 이내 | 90% 이내 |\n|---|---|---|---|---|---|---|---|"]
for k, lab in [("incl", "포함"), ("excl", "제외")]:
    a = res[k]["analog"]
    md.append(f"| {lab} | {a['events']} | " + " | ".join(f"{a['rec'][h]*100:.0f}%" for h in [21, 63, 126, 252]) + f" | {mo(a['dq'][0.5])} | {mo(a['dq'][0.9])} |")
open(OUT + f"ndx_cases_{TAG}.md", "w").write("\n".join(md))
print("\n".join(md))
