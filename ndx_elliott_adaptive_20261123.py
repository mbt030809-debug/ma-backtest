"""엘리어트 '주관'(스케일·피보나치 비율) 적응형 선택 검증 - 2026-11-23
아이디어: 설정(θ, 3파 목표 배수 r3, 5파 목표 배수 r5) 36가지를 두고, 매 시점 '그때까지 결과가 확정된 신호'의 성적(기준선 대비 lift)이
좋았던 설정을 골라 그 신호만 사용 → 이 선택 절차 자체가 미래에도 통하는지 워크포워드로 검증 (선택에 미래 정보 없음).
신호: 3파 시작(2파 저점 확정) / 5파 시작(4파 저점 확정), 상승·하락 모두. 목표 = 무효 이탈 전 504거래일 내 목표 도달.
"""
import json, itertools, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")

TAG = "20261123"; OUT = "/home/user/ma-backtest/"
px = pd.read_csv(OUT + "ndx_close_20261121.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
c = px.values; n = len(c); dates = px.index; lp = np.log(c); MAXH = 504
THETAS = [0.06, 0.08, 0.10, 0.12, 0.15, 0.18]; R3 = [1.0, 1.618]; R5 = [0.382, 0.618, 1.0]

def zigzag(theta):
    piv = []; d = 0; hi = (0, lp[0]); lo = (0, lp[0]); ext = None
    for t in range(1, n):
        if d == 0:
            if lp[t] > hi[1]: hi = (t, lp[t])
            if lp[t] < lo[1]: lo = (t, lp[t])
            if lp[t] - lo[1] >= theta: piv.append((lo[0], lo[1], 'L', t)); d = 1; ext = (t, lp[t])
            elif hi[1] - lp[t] >= theta: piv.append((hi[0], hi[1], 'H', t)); d = -1; ext = (t, lp[t])
        elif d == 1:
            if lp[t] > ext[1]: ext = (t, lp[t])
            elif ext[1] - lp[t] >= theta: piv.append((ext[0], ext[1], 'H', t)); d = -1; ext = (t, lp[t])
        else:
            if lp[t] < ext[1]: ext = (t, lp[t])
            elif lp[t] - ext[1] >= theta: piv.append((ext[0], ext[1], 'L', t)); d = 1; ext = (t, lp[t])
    return piv

def signals(piv, r3, r5):
    ev = []
    for sgn in (1, -1):
        want0 = 'L' if sgn == 1 else 'H'
        for k in range(len(piv)):
            if k >= 2 and piv[k - 2][2] == want0 and piv[k][2] == want0:
                v = [sgn * piv[j][1] for j in (k - 2, k - 1, k)]
                if v[2] > v[0] and v[1] > v[0]:
                    ev.append(dict(t=piv[k][3], stage="W3", sgn=sgn, T=v[2] + r3 * (v[1] - v[0]), I=v[0]))
            if k >= 4 and piv[k - 4][2] == want0 and piv[k][2] == want0:
                v = [sgn * piv[j][1] for j in range(k - 4, k + 1)]
                if v[2] > v[0] and v[3] > v[1] and v[4] > v[1] and (v[3] - v[2]) >= (v[1] - v[0]):
                    ev.append(dict(t=piv[k][3], stage="W5", sgn=sgn, T=v[4] + r5 * (v[3] - v[0]), I=v[1]))
    return ev

m_ = n - MAXH
REL = (lp[np.arange(m_)[:, None] + np.arange(MAXH + 1)[None, :]] - lp[:m_, None])[::3]; REL_IDX = np.arange(m_)[::3]
def baseline_hit(t0, dT, dI, sgn):
    m = int(np.searchsorted(REL_IDX, t0 - MAXH, side="right"))
    if m < 150: return np.nan
    r = sgn * REL[:m]; up = r >= dT; dn = r <= -dI
    fu = np.where(up.any(1), up.argmax(1), 10**9); fd = np.where(dn.any(1), dn.argmax(1), 10**9)
    return float(np.mean(fu < fd))

def resolve(e):
    t0, sg = e["t"], e["sgn"]; cur = sg * lp[t0]; T, I = e["T"], e["I"]
    if not (T > cur and I < cur) or t0 + MAXH > n - 1: return None
    dT, dI = T - cur, cur - I; r = sg * (lp[t0:t0 + MAXH + 1] - lp[t0]); up = r >= dT; dn = r <= -dI
    fu = up.argmax() if up.any() else 10**9; fd = dn.argmax() if dn.any() else 10**9
    res = min(fu, fd) if min(fu, fd) < 10**9 else MAXH
    return dict(t=t0, stage=e["stage"], sgn=sg, hit=float(fu < fd), tres=t0 + res, base=baseline_hit(t0, dT, dI, sg))

cache = {}
zz = {th: zigzag(th) for th in THETAS}
print("zigzag done", flush=True)
rows = []
for th in THETAS:
    for r3 in R3:
        for e in signals(zz[th], r3, 0.618):
            if e["stage"] != "W3": continue
            o = resolve(e)
            if o: o.update(theta=th, r3=r3, r5=None); rows.append(o)
    for r5 in R5:
        for e in signals(zz[th], 1.618, r5):
            if e["stage"] != "W5": continue
            o = resolve(e)
            if o: o.update(theta=th, r3=None, r5=r5); rows.append(o)
EV = pd.DataFrame(rows).dropna(subset=["base"]); print("events", len(EV), flush=True)
EV["date"] = [str(dates[t].date()) for t in EV.t]

# 설정 = (theta, r3, r5) 36개. 각 설정의 신호 = 해당 theta·r3 의 W3 신호 + theta·r5 의 W5 신호
CFGS = list(itertools.product(THETAS, R3, R5))
def cfg_events(cfg):
    th, r3, r5 = cfg
    a = EV[(EV.theta == th) & (EV.stage == "W3") & (EV.r3 == r3)]; b = EV[(EV.theta == th) & (EV.stage == "W5") & (EV.r5 == r5)]
    return pd.concat([a, b]).sort_values("t")
CE = {cfg: cfg_events(cfg) for cfg in CFGS}

K = 10; MINN = 6
def score(cfg, t):
    e = CE[cfg]; e = e[e.tres <= t]
    if len(e) < MINN: return None
    lift = (e.hit - e.base).mean(); return lift * len(e) / (len(e) + K), len(e), lift

START = int(np.searchsorted(dates, pd.Timestamp("1995-01-01")))
sel_rows = []
for cfg in CFGS:
    for _, e in CE[cfg].iterrows():
        if e.t < START: continue
        sc = {g: score(g, e.t) for g in CFGS}; sc = {g: v for g, v in sc.items() if v is not None}
        if cfg not in sc or len(sc) < 5: continue
        rank = sorted(sc, key=lambda g: -sc[g][0]).index(cfg) + 1
        sel_rows.append(dict(cfg=str(cfg), theta=cfg[0], date=e.date, t=e.t, stage=e.stage, hit=e.hit, base=e.base, rank=rank, n_cfg=len(sc),
                             past_lift=sc[cfg][2], shr=sc[cfg][0]))
S = pd.DataFrame(sel_rows)
S["lift"] = S.hit - S.base
# 같은 날짜·같은 방향 중복 신호는 하나로 취급하기 위해 날짜별 평균이 아닌 전체 이벤트로 평가(설정별 이벤트) - 보고용
def summ(d, lab):
    return dict(select=lab, n=len(d), hit=d.hit.mean(), base=d.base.mean(), lift=d.lift.mean(),
                brier_model=((np.clip(d.base + d.shr, 0, 1) - d.hit) ** 2).mean(), brier_base=((d.base - d.hit) ** 2).mean())
out = [summ(S, "모든 설정(선택 없음)"), summ(S[S["rank"] == 1], "적응형 1위 설정"), summ(S[S["rank"] <= 3], "적응형 상위 3"), summ(S[S["rank"] <= 6], "적응형 상위 6"),
       summ(S[S["rank"] > 18], "과거 하위 절반(대조)"), summ(S[S.theta == 0.18], "고정 θ=0.18(이전 선택)")]
T_ = pd.DataFrame(out)
# 분할: 2011 이전 / 이후
def split(d, lab):
    return [dict(part=p, **summ(x, lab)) for p, x in [("1995~2010", d[d.date < "2011-01-01"]), ("2011~", d[d.date >= "2011-01-01"])] if len(x)]
T2 = pd.DataFrame(split(S, "모든 설정") + split(S[S["rank"] <= 3], "적응형 상위 3") + split(S[S["rank"] == 1], "적응형 1위") + split(S[S["rank"] > 18], "하위 절반"))
# 지속성: 설정의 과거 lift 와 다음 신호의 lift 상관
corr = float(np.corrcoef(S.past_lift, S.lift)[0, 1]) if len(S) > 10 else np.nan
# 현재 시점 점수표
now_t = n - 1
cur = []
for cfg in CFGS:
    sc = score(cfg, now_t)
    if sc: cur.append(dict(theta=cfg[0], r3=cfg[1], r5=cfg[2], n=sc[1], past_lift=sc[2], shrunk=sc[0]))
CUR = pd.DataFrame(cur).sort_values("shrunk", ascending=False)
S.to_csv(OUT + f"ndx_elliott_adaptive_events_{TAG}.csv", index=False)
md = [f"# 엘리어트 '주관' 적응형 선택 검증 ({TAG})\n",
      "36개 설정(θ 6종 × 3파 배수 2종 × 5파 배수 3종) 중, 매 시점 '그때까지 결과가 확정된 신호'의 기준선 대비 lift가 좋았던 설정을 선택하는 절차를 과거 전체(1995~)에 워크포워드로 적용.\n",
      "- lift = 목표 도달률 - 같은 거리 무작위 기준선 / brier_model: 적응형 확률(기준선+축소된 과거 lift) 점수, brier_base: 기준선 점수 (낮을수록 좋음)\n",
      "## 선택 방식별 성과 (신호 단위)\n", T_.round(3).to_markdown(index=False), "\n## 구간 분할\n", T2.round(3).to_markdown(index=False),
      f"\n과거 lift 와 다음 신호 lift 의 상관(지속성): **{corr:.3f}**\n", "## 현재(2026-11-20) 설정별 과거 점수 상위\n", CUR.head(10).round(3).to_markdown(index=False)]
open(OUT + f"ndx_elliott_adaptive_{TAG}.md", "w").write("\n".join(md))
json.dump(dict(corr=corr, top=CUR.head(5).to_dict("records")), open(OUT + f"ndx_elliott_adaptive_{TAG}.json", "w"), indent=1, default=float)
print("\n".join(md))
