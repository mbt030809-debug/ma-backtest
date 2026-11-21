// ② 투매+상대약세형 신호만: 위 = 1999~현재 전체(로그), 아래 = 바닥별 확대
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), J = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), OUT = process.argv[4];
const T = J.techniques[+(process.argv[5] || 0)], ACC = '#eb6834', INK = '#1f1f1e', INK2 = '#3d3d3a', MUTED = '#6b6b66';
const qd = raw.QQQ.map(r => r[0]), nd = new Map(raw['^NDX'].map(r => [r[0], r[1]]));
let last = NaN; const S = qd.map(d => { const v = nd.get(d); if (v != null) last = v; return [d, last]; });
const idx = new Map(S.map((v, i) => [v[0], i]));
const sigs = T.per.flatMap(p => p.miss ? [] : p.all.map(a => ({ ...a, nm: p.nm, more: p.more, r252: p.r252, first: a.d === p.first })));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const W = 1080, L = 70, R = 30; let svg = '';
svg += `<text x="${L}" y="32" class="t1">산 뒤 추가 하락이 가장 적은 신호 (2020 포함 바닥 6개)</text>`;
svg += `<text x="${L}" y="54" class="t3">조건 4개가 모두 맞는 날: QQQ가 14일 범위 맨 바닥(하위 1.2%) · QQQ가 1년 범위 하위 10.7% · 3개월간 소형주가 S&amp;P보다 약함 · S&amp;P500 1년 고점 대비 -16% 이하</text>`;
svg += `<text x="${L}" y="72" class="t3">바닥 6개를 모두 맞히고 바닥 밖 신호가 0인 조합 중 첫 신호 뒤 추가 하락이 가장 작음. 회색 선 = 나스닥100(QQQ와 같은 움직임), 주황 점 = 신호일, 빨간 ▼ = 신호 뒤 실제 최저점</text>`;
// ---- 전체 기간(로그) ----
const y0 = 96, PH = 330, PW = W - L - R;
const vals = S.map(v => v[1]), lmin = Math.log(Math.min(...vals)), lmax = Math.log(Math.max(...vals));
const X = i => L + i / (S.length - 1) * PW, Y = v => y0 + (1 - (Math.log(v) - lmin) / (lmax - lmin)) * PH;
for (const g of [1000, 2000, 5000, 10000, 20000]) { if (Math.log(g) < lmin || Math.log(g) > lmax) continue; const y = Y(g); svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" class="ax" text-anchor="end">${g.toLocaleString()}</text>`; }
let ly = ''; S.forEach((v, i) => { const y = v[0].slice(0, 4); if (y !== ly) { ly = y; if (+y % 2 === 0 || y === '1999') svg += `<text x="${X(i)}" y="${y0 + PH + 18}" class="ax" text-anchor="middle">${y === '1999' ? '' : y}</text><line x1="${X(i)}" x2="${X(i)}" y1="${y0 + PH}" y2="${y0 + PH + 4}" stroke="#c9c8c2"/>`; } });
svg += `<polyline points="${S.map((v, i) => `${X(i).toFixed(1)},${Y(v[1]).toFixed(1)}`).join(' ')}" class="px"/>`;
// 연도별로 한 번만 라벨(같은 바닥의 연속 신호는 묶음)
const groups = {}; for (const s of sigs) (groups[s.nm] = groups[s.nm] || []).push(s);
Object.values(groups).forEach(g => { g.forEach(s => { const i = idx.get(s.d); svg += `<circle cx="${X(i)}" cy="${Y(S[i][1])}" r="6" fill="${ACC}" stroke="#fcfcfb" stroke-width="2"/>`; });
  const s = g[0], i = idx.get(s.d), x = X(i), y = Y(S[i][1]); const lines = g.map(q => `${q.d} (최저가 +${(q.gap * 100).toFixed(1)}%)`);
  const tg = { '2002': [x + 26, y - 100, 'start'], '2009': [x + 30, y - 150, 'start'], '2018': [x - 24, y - 56, 'end'], '2020': [x, 332, 'middle'], '2022': [x - 6, 364, 'end'], '2025': [Math.min(x, W - R - 80), 396, 'middle'] }[s.nm];
  const [lx, lyy, an] = tg, above = lyy < y;
  svg += above ? `<line x1="${x + (an === 'end' ? -4 : 4)}" y1="${y - 7}" x2="${lx + (an === 'end' ? 4 : -4)}" y2="${lyy + (lines.length - 1) * 15 + 4}" class="lead"/>` : `<line x1="${x}" y1="${y + 7}" x2="${lx}" y2="${lyy - 12}" class="lead"/>`;
  lines.forEach((t, k) => svg += `<text x="${lx}" y="${lyy + k * 15}" class="lab" text-anchor="${an}">${t}</text>`); });
// ---- 바닥별 확대 ----
const PANEL = { w: 455, h: 200 }, gx = 70, top2 = y0 + PH + 70;
svg += `<text x="${L}" y="${top2 - 22}" class="t1s">바닥별 확대 — 점선 = 실제 최저일, 주황 점 = 신호일(가격선 위)</text>`;
J.chart.forEach((c, p) => {
  const col = p % 2, row = Math.floor(p / 2), ox = L + col * (PANEL.w + gx), oy = top2 + row * (PANEL.h + 90);
  const px = c.px.filter(v => v[0] >= c.from && v[0] <= c.to), n = px.length, top = Math.ceil(Math.max(...px.map(v => v[1])) * 10) / 10;
  const x = i => ox + i / (n - 1) * PANEL.w, y = v => oy + 40 + (1 - v / top) * (PANEL.h - 40), id = new Map(px.map((v, i) => [v[0], i]));
  const per = T.per.find(q => q.nm === c.nm);
  svg += `<text x="${ox}" y="${oy + 4}" class="t2b">${c.nm} 폭락장 · 최저 ${c.low}${c.zone.length > 1 ? ` (쌍바닥 ${c.zone.filter(z => z !== c.low).map(z => z.slice(2).replace(/-/g, '.')).join(', ')})` : ''}</text>`;
  for (let g = 0; g <= top + 1e-9; g += top > .6 ? .2 : .1) { const yy = y(g); svg += `<line x1="${ox}" x2="${ox + PANEL.w}" y1="${yy}" y2="${yy}" class="grid"/><text x="${ox - 6}" y="${yy + 4}" class="ax" text-anchor="end">+${Math.round(g * 100)}%</text>`; }
  let lm = ''; px.forEach((v, i) => { const m = v[0].slice(0, 7); if (m !== lm && v[0].slice(8) <= '07') { lm = m; if (+m.slice(5) % 2 === 1) svg += `<text x="${x(i)}" y="${oy + PANEL.h + 16}" class="ax" text-anchor="middle">${m.slice(2).replace('-', '.')}</text>`; } });
  for (const z of c.zone) if (id.has(z)) { const xx = x(id.get(z)); svg += `<line x1="${xx}" x2="${xx}" y1="${oy + 32}" y2="${oy + PANEL.h}" class="${z === c.low ? 'low' : 'low2'}"/>`; }
  svg += `<polyline points="${px.map((v, i) => `${x(i).toFixed(1)},${y(v[1]).toFixed(1)}`).join(' ')}" class="px"/>`;
  per.all.forEach(a => { if (!id.has(a.d)) return; const i = id.get(a.d); svg += `<circle cx="${x(i)}" cy="${y(px[i][1])}" r="6" fill="${ACC}" stroke="#fcfcfb" stroke-width="2"/>`; });
  { const f = id.get(per.all[0].d); let mj = f; for (let j = f; j < n; j++) if (px[j][1] < px[mj][1]) mj = j; const dd = px[mj][1] === px[f][1] ? 0 : (1 + px[mj][1]) / (1 + px[f][1]) - 1;
    if (mj !== f && dd < -0.0005) { svg += `<line x1="${x(f)}" x2="${x(mj)}" y1="${y(px[f][1])}" y2="${y(px[f][1])}" stroke="#d03a3a" stroke-width="1.2" stroke-dasharray="3 3"/><line x1="${x(mj)}" x2="${x(mj)}" y1="${y(px[f][1])}" y2="${y(px[mj][1])}" stroke="#d03a3a" stroke-width="1.5"/><path d="M${x(mj) - 6},${y(px[mj][1]) - 3} L${x(mj) + 6},${y(px[mj][1]) - 3} L${x(mj)},${y(px[mj][1]) + 7} Z" fill="#d03a3a" stroke="#fcfcfb" stroke-width="1.5"/><text x="${x(mj) + 10}" y="${(y(px[f][1]) + y(px[mj][1])) / 2 + 4}" class="lab" fill="#b02a2a" style="fill:#b02a2a">추가 하락 ${(dd * 100).toFixed(1)}% (${px[mj][0].slice(5)})</text>`; }
    else svg += `<text x="${x(f) + 10}" y="${y(px[f][1]) - 8}" class="lab" style="fill:#2f7d4f">추가 하락 없음</text>`; }
  const txt = per.all.map(a => `${a.d} (최저가 +${(a.gap * 100).toFixed(1)}%)`).join(', ');
  svg += `<circle cx="${ox + 5}" cy="${oy + 19}" r="5" fill="${ACC}" stroke="#fcfcfb" stroke-width="2"/><text x="${ox + 15}" y="${oy + 23}" class="lab">신호 ${txt}</text>`;
  svg += `<text x="${ox}" y="${oy + PANEL.h + 36}" class="t3">산 뒤 추가 하락 ${(per.more * 100).toFixed(1)}% · 3개월 뒤 ${per.r63 >= 0 ? '+' : ''}${(per.r63 * 100).toFixed(1)}% · 1년 뒤 +${(per.r252 * 100).toFixed(1)}% (첫 신호에 QQQ 샀다면)</text>`;
});
// 요약(패널 아래 한 줄)
const nP = J.chart.length, rowsP = Math.ceil(nP / 2), sy = top2 + rowsP * (PANEL.h + 90);
{ const h = T.per.filter(x => !x.miss), av = f => h.reduce((a, x) => a + f(x), 0) / h.length, pc = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const worst = h.reduce((a, x) => x.more < a.more ? x : a);
  const items = [['신호', `${T.cnt}일 (27년)`], ['바닥 밖 신호', `${T.other.length}일`], ['맞힌 바닥', `${h.length}/${T.per.length}`], ['바닥과 평균 차이', `${av(x => Math.abs(x.dNear)).toFixed(1)}거래일`], ['매수가 vs 최저가', `평균 ${pc(av(x => x.gapFirst))}`], ['산 뒤 추가 하락', `평균 ${pc(av(x => x.more))} · 최악 ${pc(worst.more)} (${worst.nm})`], ['1년 뒤 수익', `평균 ${pc(av(x => x.r252))}`]];
  svg += `<text x="${L}" y="${sy}" class="t2b">요약</text>`;
  items.forEach(([a, b], k) => { const cx = L + (k % 3) * 330, cy = sy + 26 + Math.floor(k / 3) * 24; svg += `<text x="${cx}" y="${cy}" class="t3">${a}</text><text x="${cx + 98}" y="${cy}" class="t2b">${b}</text>`; });
  svg += `<text x="${L}" y="${sy + 106}" class="t3">6번의 바닥에 맞춰 찾은 조건이라 미래 바닥을 보장하지 않음</text>`; }
const H = sy + 124;
fs.writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fcfcfb;font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif}
.t1{font-size:20px;font-weight:700;fill:${INK}}.t1s{font-size:15px;font-weight:700;fill:${INK}}.t2{font-size:13px;fill:${INK2}}.t2b{font-size:13.5px;font-weight:700;fill:${INK}}
.t3{font-size:12px;fill:${MUTED}}.ax{font-size:11px;fill:${MUTED}}.lab{font-size:12px;font-weight:600;fill:${INK2}}
.grid{stroke:#e6e5e0;stroke-width:1}.lead{stroke:#9a9993;stroke-width:1}.px{fill:none;stroke:#8a8983;stroke-width:1.6;stroke-linejoin:round}
.low{stroke:${INK};stroke-width:1.2;stroke-dasharray:4 3}.low2{stroke:#9a9993;stroke-width:1;stroke-dasharray:2 3}
</style></head><body><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg></body></html>`);
console.log('ok', H);
