"""백테스트 서버: 정적 파일 + Yahoo Finance 프록시 (표준 라이브러리만 사용).
실행: python3 server_20261030.py  ->  http://localhost:8000
MOCK=1 로 실행하면 가짜 랜덤 데이터 사용(오프라인 테스트용)."""
import json, os, random, time, urllib.request, urllib.parse
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
MOCK = os.environ.get("MOCK") == "1"
CACHE = {}


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
    adj = ind["adjclose"][0]["adjclose"] if ind.get("adjclose") else ind["quote"][0]["close"]
    return [[time.strftime("%Y-%m-%d", time.gmtime(t)), c] for t, c in zip(ts, adj) if c is not None]


def mock(symbol, start, end):
    rnd = random.Random(symbol)
    lev = 3 if symbol[-1:] in "LX" and len(symbol) > 3 else 1
    d, e, px, out = date.fromisoformat(start), date.fromisoformat(end), 100.0, []
    while d <= e:
        if d.weekday() < 5:
            px *= 1 + lev * rnd.gauss(0.0004, 0.012)
            out.append([d.isoformat(), px])
        d += timedelta(days=1)
    return out


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
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
                key = (sym, s, e)
                if key not in CACHE:
                    CACHE[key] = (mock if MOCK else yahoo)(sym, s, e)
                self.send(200, json.dumps(CACHE[key]).encode(), "application/json")
            except Exception as ex:
                self.send(502, json.dumps({"error": "%s" % ex}).encode(), "application/json")
        else:
            name = "index_20261030.html" if u.path == "/" else os.path.basename(u.path)
            fp = os.path.join(HERE, name)
            if not os.path.isfile(fp):
                return self.send(404, b"", "text/plain")
            with open(fp, "rb") as f:
                ct = "application/javascript" if name.endswith(".js") else "text/html; charset=utf-8"
                self.send(200, f.read(), ct)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print("http://localhost:%d" % port)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
