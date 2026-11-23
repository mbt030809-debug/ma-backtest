"""엘리어트 파동 자동 분석 + 워크포워드 검증 (가격만) - 2026-11-23
규칙(고정):
 - 지그재그: 로그가격이 직전 극점에서 θ 이상 반대로 움직이면 그 극점을 '확정 꼭짓점'으로 확정 (확정은 θ만큼 늦게 일어남 → 미래 정보 없음)
 - 충격파(0~5): 2파는 0을 넘지 못함, 4파는 1파와 겹치지 못함(4>1), 3파는 1·3·5파 중 최단이 아님
 - 상승 충격파와 하락 충격파(부호 반전)를 모두 인식
 - 예측(꼭짓점이 확정되는 시점에 발생):
     W3  : 2파 저점 확정 → 3파 진행 예상, 목표 = 2저점 + 1.618×(1파 길이), 무효 = 0점 이탈
     W5  : 4파 저점 확정 → 5파 진행 예상, 목표 = 4저점 + 0.618×(0~3 길이),   무효 = 1파 고점 이탈
     ABC : 5파 고점 확정 → 조정(A-B-C) 예상, 목표 = 5고점 - 0.5×(0~5 길이),   무효 = 5파 고점 상향 돌파
 평가: (1) 목표 도달(무효 이탈 전, 504거래일 내) 확률 vs 같은 거리의 무작위 시점 기준선(그 시점까지의 과거 데이터로만 추정)
       (2) 예측 방향 수익률(126·252일) 적중률 vs 같은 방향의 무조건 확률
 튜닝(≤2010)에서 θ 선택 → 검증(2011~)에서 보고.
"""
import json, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")

TAG = "20261123"; OUT = "/home/user/ma-backtest/"
px = pd.read_csv(OUT + "ndx_close_20261121.csv", index_col=0, parse_dates=True).iloc[:, 0].dropna()
c = px.values; n = len(c); dates = px.index; lp = np.log(c)
MAXH = 504

def zigzag(theta):
    """확정 꼭짓점 목록: (극점 인덱스, 로그가격, 'H'|'L', 확정 인덱스)"""
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

def patterns(piv, sgn):
    """sgn=+1 상승 충격파, -1 하락 충격파. 반환: 확정 시점별 이벤트 [(conf_idx, stage, target_v, invalid_v, p0..)]"""
    ev = []; want0 = 'L' if sgn == 1 else 'H'
    for k in range(len(piv)):
        # P2 확정: piv[k] 이 2파 저점(v공간), piv[k-2] 가 0점
        if k >= 2 and piv[k - 2][2] == want0 and piv[k][2] == want0:
            v = [sgn * piv[j][1] for j in (k - 2, k - 1, k)]   # P0,P1,P2
            if v[2] > v[0] and v[1] > v[0]:
                ev.append(dict(t=piv[k][3], stage="W3", sgn=sgn, T=v[2] + 1.618 * (v[1] - v[0]), I=v[0], pts=[piv[j][0] for j in (k - 2, k - 1, k)]))
        if k >= 4 and piv[k - 4][2] == want0 and piv[k][2] == want0:
            v = [sgn * piv[j][1] for j in range(k - 4, k + 1)]  # P0..P4
            if v[2] > v[0] and v[3] > v[1] and v[4] > v[1] and (v[3] - v[2]) >= (v[1] - v[0]):
                ev.append(dict(t=piv[k][3], stage="W5", sgn=sgn, T=v[4] + 0.618 * (v[3] - v[0]), I=v[1], pts=[piv[j][0] for j in range(k - 4, k + 1)]))
        if k >= 5 and piv[k - 5][2] == want0 and piv[k][2] != want0:
            v = [sgn * piv[j][1] for j in range(k - 5, k + 1)]  # P0..P5
            w1, w3, w5 = v[1] - v[0], v[3] - v[2], v[5] - v[4]
            if v[2] > v[0] and v[3] > v[1] and v[4] > v[1] and v[5] > v[3] and w3 >= min(w1, w5) and (w3 >= w1 or w3 >= w5):
                ev.append(dict(t=piv[k][3], stage="ABC", sgn=-sgn, T=-(v[5] - 0.5 * (v[5] - v[0])), I=-v[5], pts=[piv[j][0] for j in range(k - 5, k + 1)], wave="impulse"))
    return ev

# 예측 방향 sgn_f 의 v공간 = sgn_f * lp. ABC 는 반대 방향이라 sgn=-sgn, T/I 도 그 v공간 값으로 정의
for_path = None
def build_windows():
    m = n - MAXH
    idx = np.arange(m)[:, None] + np.arange(MAXH + 1)[None, :]
    return lp[idx] - lp[:m, None]
REL = build_windows()

def baseline_hit(t0, dT, dI, sgn):
    """t0 까지 결과가 확정된 과거 시점들(시작 s ≤ t0-MAXH)에서 같은 거리로 '목표 먼저 도달' 비율"""
    m = max(0, min(len(REL), t0 - MAXH + 1))
    if m < 300: return np.nan
    r = sgn * REL[:m]; up = r >= dT; dn = r <= -dI
    fu = np.where(up.any(1), up.argmax(1), 10**9); fd = np.where(dn.any(1), dn.argmax(1), 10**9)
    return float(np.mean(fu < fd))
def baseline_dir(t0, h, sgn):
    m = t0 - h + 1
    if m < 300: return np.nan
    return float(np.mean(sgn * (lp[h:m + h] - lp[:m]) > 0))

def run(theta):
    piv = zigzag(theta); rows = []
    for sgn in (1, -1):
        for e in patterns(piv, sgn):
            t0 = e["t"]; sg = e["sgn"] if e["stage"] != "ABC" else e["sgn"]
            # ABC 는 e['sgn'] 이 예측 방향 부호, 그 외도 e['sgn'] = 예측 방향 부호
            cur = sg * lp[t0]; T = e["T"]; I = e["I"]
            if not (T > cur and I < cur): continue
            dT, dI = T - cur, cur - I
            if t0 + MAXH > n - 1: continue
            r = sg * (lp[t0:t0 + MAXH + 1] - lp[t0])
            up = r >= dT; dn = r <= -dI
            fu = up.argmax() if up.any() else 10**9; fd = dn.argmax() if dn.any() else 10**9
            row = dict(theta=theta, date=str(dates[t0].date()), stage=e["stage"], dirn="상승" if sg == 1 else "하락", hit=float(fu < fd),
                       fail=float(fd < fu), dT=dT, dI=dI, base_hit=baseline_hit(t0, dT, dI, sg))
            for h in (126, 252):
                if t0 + h <= n - 1:
                    row[f"dir{h}"] = float(sg * (lp[t0 + h] - lp[t0]) > 0); row[f"bdir{h}"] = baseline_dir(t0, h, sg)
                    row[f"ret{h}"] = float(sg * (lp[t0 + h] - lp[t0]))
            rows.append(row)
    return pd.DataFrame(rows), piv

TUNE_END = "2011-01-01"
allr = []; summ = []
for th in [0.08, 0.12, 0.18]:
    df, piv = run(th); df = df.dropna(subset=["base_hit"]); allr.append(df)
    for part, m in [("튜닝(≤2010)", df.date < TUNE_END), ("검증(2011~)", df.date >= TUNE_END), ("전체", df.date > "")]:
        d = df[m]
        if len(d) == 0: continue
        summ.append(dict(theta=th, part=part, n=len(d), hit=d.hit.mean(), base=d.base_hit.mean(), lift=d.hit.mean() - d.base_hit.mean(),
                         dir126=d.dir126.mean() if "dir126" in d else np.nan, bdir126=d.bdir126.mean() if "bdir126" in d else np.nan,
                         dir252=d.dir252.mean() if "dir252" in d else np.nan, bdir252=d.bdir252.mean() if "bdir252" in d else np.nan,
                         ret126=d.ret126.mean() if "ret126" in d else np.nan))
S = pd.DataFrame(summ); ALL = pd.concat(allr)
ALL.to_csv(OUT + f"ndx_elliott_events_{TAG}.csv", index=False)
best = S[S.part == "튜닝(≤2010)"].sort_values("lift", ascending=False).iloc[0].theta
byst = []
for th in [0.08, 0.12, 0.18]:
    d = ALL[ALL.theta == th]
    for st in ["W3", "W5", "ABC"]:
        x = d[d.stage == st]
        if len(x): byst.append(dict(theta=th, stage=st, n=len(x), hit=x.hit.mean(), base=x.base_hit.mean(), dir252=x.dir252.mean(), bdir252=x.bdir252.mean()))
md = [f"# 엘리어트 파동 자동 분석 검증 ({TAG})\n", "규칙은 코드로 고정, 꼭짓점은 θ 이상 반전해야 확정(미래 정보 없음). 목표 도달(무효 이탈 전, 504거래일 내) 확률을 같은 거리의 무작위 시점 기준선과 비교.\n",
      "- hit: 목표 먼저 도달 비율 / base: 기준선(같은 거리, 그 시점까지의 과거 데이터로 추정) / lift = hit-base (양수여야 파동 분석이 유효)",
      "- dir: 예측 방향으로 126·252거래일 뒤 수익률이 + 였던 비율 / bdir: 같은 방향의 무조건 비율\n",
      "## θ·구간별 요약\n", S.round(3).to_markdown(index=False), f"\n튜닝구간에서 lift가 가장 큰 θ = **{best}**\n",
      "## 단계별 (전체 기간)\n", pd.DataFrame(byst).round(3).to_markdown(index=False)]
open(OUT + f"ndx_elliott_{TAG}.md", "w").write("\n".join(md))
json.dump({"best_theta": float(best)}, open(OUT + f"ndx_elliott_{TAG}.json", "w"))
print("\n".join(md))


# ---------------- 현재 파동 해석 + 앱용 통계 ----------------
def rules_ok(j, v):
    if j == 1: return v[1] > v[0]
    if j == 2: return v[2] > v[0]
    if j == 3: return v[3] > v[1]
    if j == 4: return v[4] > v[1] and (v[3] - v[2]) >= (v[1] - v[0])
    w1, w3, w5 = v[1] - v[0], v[3] - v[2], v[5] - v[4]
    return v[5] > v[3] and w3 >= min(w1, w5) and (w3 >= w1 or w3 >= w5)

def current_count(piv, last_lp):
    m = len(piv); best = None
    for sgn in (1, -1):
        want0 = 'L' if sgn == 1 else 'H'
        for i in range(max(0, m - 14), m):
            if piv[i][2] != want0: continue
            v = [sgn * piv[j][1] for j in range(i, m)]; J = 0
            for j in range(1, min(5, len(v) - 1) + 1):
                if not rules_ok(j, v): break
                J = j
            if J == 0 or i + J != m - 1: continue
            vl = sgn * last_lp
            if (J in (1, 2) and vl <= v[0]) or (J in (3, 4) and vl <= v[1]): continue
            key = (J, sgn == 1)
            if best is None or key > best[0]: best = (key, sgn, i, J)
    return best

def describe(piv, best, last_lp):
    if best is None: return None
    _, sgn, i, J = best; v = [sgn * piv[j][1] for j in range(i, i + J + 1)]; ex = lambda x: float(np.exp(sgn * x))
    out = dict(sgn=sgn, J=J, points=[dict(date=str(dates[piv[j][0]].date()), price=float(c[piv[j][0]])) for j in range(i, i + J + 1)], live=float(np.exp(last_lp)))
    if J == 1: out["levels"] = {str(r): ex(v[1] - r * (v[1] - v[0])) for r in (0.5, 0.618, 0.786)}; out["invalid"] = ex(v[0])
    if J == 2: out["target"] = ex(v[2] + 1.618 * (v[1] - v[0])); out["invalid"] = ex(v[0])
    if J == 3:
        out["levels"] = {str(r): ex(v[3] - r * (v[3] - v[2])) for r in (0.236, 0.382, 0.5)}; out["invalid"] = ex(v[1])
        out["retr_now"] = float((v[3] - sgn * last_lp) / (v[3] - v[2]))
        out["w5_target_if_0382"] = ex(v[3] - 0.382 * (v[3] - v[2]) + 0.618 * (v[3] - v[0]))
    if J == 4: out["target"] = ex(v[4] + 0.618 * (v[3] - v[0])); out["invalid"] = ex(v[1])
    if J == 5: out["levels"] = {str(r): ex(v[5] - r * (v[5] - v[0])) for r in (0.382, 0.5, 0.618)}
    return out

state = {}
for th in [0.08, 0.12, 0.18]:
    piv = zigzag(th); state[str(th)] = dict(describe=describe(piv, current_count(piv, lp[-1]), lp[-1]),
                                            last_pivots=[dict(date=str(dates[p[0]].date()), type=p[2], price=float(c[p[0]])) for p in piv[-10:]])
json.dump(state, open(OUT + f"ndx_elliott_state_{TAG}.json", "w"), indent=1, ensure_ascii=False)

stats = {}
for th in [0.08, 0.12, 0.18]:
    d = ALL[ALL.theta == th]; f = d[d.stage.isin(["W3", "W5"])].dropna(subset=["dir252"]); a = d[d.stage == "ABC"].dropna(subset=["dir252"])
    h = f[f.date >= TUNE_END]
    stats[str(th)] = dict(n=int(len(f)), dir=float(f.dir252.mean()), bdir=float(f.bdir252.mean()), hit=float(f.hit.mean()), bhit=float(f.base_hit.mean()),
                          hn=int(len(h)), hdir=float(h.dir252.mean()) if len(h) else None, hbdir=float(h.bdir252.mean()) if len(h) else None,
                          hhit=float(h.hit.mean()) if len(h) else None, hbhit=float(h.base_hit.mean()) if len(h) else None,
                          an=int(len(a)), adir=float(a.dir252.mean()) if len(a) else None, abdir=float(a.bdir252.mean()) if len(a) else None)
open(OUT + "app_20261121/app/src/main/assets/elliott_stats.js", "w").write("window.ELLIOTT_STATS=" + json.dumps(stats) + ";")
print(json.dumps(state, indent=1, ensure_ascii=False)); print(json.dumps(stats, indent=1))
