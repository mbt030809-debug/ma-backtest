"""백테스트 서버: 정적 파일 + Yahoo Finance 프록시 (표준 라이브러리만 사용).
실행: python3 server_20261030.py  ->  http://localhost:8000
MOCK=1 로 실행하면 가짜 랜덤 데이터 사용(오프라인 테스트용)."""
import json, os, random, re, time, urllib.request, urllib.parse
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
MOCK = os.environ.get("MOCK") == "1"
CACHE = {}  # (심볼, 기간) → 시세. 개발용 서버라 메모리 보호를 위해 최대 300개만 보관


def yahoo(symbol, start, end):
    p1 = int(time.mktime(time.strptime(start, "%Y-%m-%d")))
    p2 = int(time.mktime(time.strptime(end, "%Y-%m-%d"))) + 86400
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d"
           "&interval=1d&events=div%%2Csplits" % (urllib.parse.quote(symbol), p1, p2))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        d = json.load(r)
    if not d["chart"].get("result"):
        raise ValueError((d["chart"].get("error") or {}).get("description", "데이터 없음"))
    res = d["chart"]["result"][0]
    ts = res.get("timestamp") or []
    if not ts:
        raise ValueError("해당 기간 데이터 없음")
    ind = res["indicators"]
    kind = "adj" if ind.get("adjclose") else "close"  # adj=배당 재투자 반영 수정종가(총수익), close=가격만
    adj = ind["adjclose"][0]["adjclose"] if ind.get("adjclose") else ind["quote"][0]["close"]
    q0 = ind["quote"][0]; opn = q0.get("open") or [None] * len(ts); cls = q0.get("close") or [None] * len(ts)
    rows = []
    for t, c, o, cl in zip(ts, adj, opn, cls):
        if c is None:
            continue
        ao = o * c / cl if (o is not None and cl) else c  # 수정 시가 = 시가 × (수정종가 ÷ 종가). 시가 체결 옵션용 3번째 값
        rows.append([time.strftime("%Y-%m-%d", time.gmtime(t)), c, ao])
    return rows, kind


def mock(symbol, start, end):
    rnd = random.Random(symbol)
    if symbol == "^VIX":  # 모의 VIX: 20 근처에서 출렁이는 값 (바닥 신호 테스트용)
        d, e, v, out = date.fromisoformat(start), date.fromisoformat(end), 20.0, []
        while d <= e:
            if d.weekday() < 5:
                v = max(9.0, v + 0.1 * (20 - v) + rnd.gauss(0, 1.6))
                out.append([d.isoformat(), v, v])
            d += timedelta(days=1)
        return out, "close"
    lev = 3 if symbol[-1:] in "LX" and len(symbol) > 3 and not symbol.startswith("^") else 1
    d, e, px, out = date.fromisoformat(start), date.fromisoformat(end), 100.0, []
    while d <= e:
        if d.weekday() < 5:
            prev = px
            px *= 1 + lev * rnd.gauss(0.0004, 0.012)
            out.append([d.isoformat(), px, prev * (1 + lev * rnd.gauss(0, 0.004))])  # 3번째 값: 시가(모의)
        d += timedelta(days=1)
    return out, ("close" if symbol.startswith("^") else "adj")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype, kind=""):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if kind:
            self.send_header("X-Price-Type", kind)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/prices":
            q = urllib.parse.parse_qs(u.query)
            try:
                sym, s, e = q["symbol"][0].upper(), q["start"][0], q["end"][0]
                if not sym:
                    raise ValueError("종목이 비었습니다")
                if not re.fullmatch(r"[A-Z0-9.^=\-]{1,15}", sym):
                    raise ValueError("종목 코드가 올바르지 않습니다")
                for d in (s, e):
                    time.strptime(d, "%Y-%m-%d")
                key = (sym, s, e)
                if key not in CACHE:
                    if len(CACHE) >= 300:
                        CACHE.pop(next(iter(CACHE)))
                    CACHE[key] = (mock if MOCK else yahoo)(sym, s, e)
                self.send(200, json.dumps(CACHE[key][0]).encode(), "application/json", CACHE[key][1])
            except Exception as ex:
                self.send(502, json.dumps({"error": "%s" % ex}).encode(), "application/json")
        else:
            name = "index_20261030.html" if u.path == "/" else os.path.basename(u.path)
            fp = os.path.join(HERE, name)
            if not os.path.isfile(fp):
                return self.send(404, b"", "text/plain")
            with open(fp, "rb") as f:
                ct = "application/javascript" if name.endswith(".js") else "application/json" if name.endswith(".json") else "text/html; charset=utf-8"
                self.send(200, f.read(), ct)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print("http://localhost:%d" % port)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
