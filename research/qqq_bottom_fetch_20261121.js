// QQQ 폭락장 바닥 찾기용 시세 받기(1998~): 시가·고가·저가·종가(수정)·거래량
// 사용: node research/qqq_bottom_fetch_20261121.js out.json
const fs = require('fs');
const SYMS = ['QQQ', '^NDX', '^GSPC', '^RUT', '^VIX', '^VXN', '^TNX', '^IRX', '^TYX', 'TLT', 'GLD', 'HYG', '^VIX3M', 'SPY', 'DIA', 'IWM', 'XLK', 'XLF', 'XLU', 'SMH'];
async function yahoo(sym) {
  const p1 = Math.floor(Date.parse('1998-01-01') / 1000), p2 = Math.floor(Date.now() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits`;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw Error('HTTP ' + r.status);
      const j = (await r.json()).chart.result[0], ts = j.timestamp, q = j.indicators.quote[0], adj = j.indicators.adjclose ? j.indicators.adjclose[0].adjclose : q.close;
      const rows = [];
      for (let i = 0; i < ts.length; i++) {
        if (adj[i] == null || q.close[i] == null) continue;
        const f = adj[i] / q.close[i]; // 시가·고가·저가도 수정주가 기준으로 맞춤
        rows.push([new Date(ts[i] * 1000).toISOString().slice(0, 10), +(adj[i]).toPrecision(8), +((q.open[i] ?? q.close[i]) * f).toPrecision(8), +((q.high[i] ?? q.close[i]) * f).toPrecision(8), +((q.low[i] ?? q.close[i]) * f).toPrecision(8), q.volume[i] || 0]);
      }
      return rows;
    } catch (e) { if (t === 3) throw Error(sym + ': ' + e.message); await new Promise(r => setTimeout(r, 1500 * (t + 1))); }
  }
}
(async () => {
  const out = {};
  for (const s of SYMS) { try { out[s] = await yahoo(s); console.error(`${s}: ${out[s].length}일 ${out[s][0][0]} ~ ${out[s].at(-1)[0]}`); } catch (e) { console.error(`${s}: 실패 ${e.message}`); } }
  fs.writeFileSync(process.argv[2] || 'bottom_prices.json', JSON.stringify(out));
})();
