// 바닥별 패널: 위 = 나스닥100(=QQQ) 가격(최저가 대비 %), 아래 = 기법별 신호 줄
const fs = require('fs');
const J = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), OUT = process.argv[3];
const COL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const SHORT = ['① 공포 과열', '② 투매+상대약세', '③ 이격+투매', '④ 급반등일', '⑤ 반등 확인'];
const W = 1080, L = 150, R = 24, PH = 170, LANE = 22, GAP = 70, TOP = 96;
const PW = W - L - R, panelH = PH + 14 + LANE * 5 + 30;
const H = TOP + J.chart.length * (panelH + GAP) - GAP + 30;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
let svg = '';
// 범례
svg += `<text x="${L}" y="30" class="t1">QQQ 폭락장 바닥과 기법별 신호 위치</text>`;
svg += `<text x="${L}" y="52" class="t3">회색 선 = 나스닥100 종가(QQQ 차트와 같은 움직임), 최저가 대비 % · 세로 점선 = 실제 최저일 · 점 = 각 기법의 신호일, 옆 숫자 = 그날 가격이 최저가보다 몇 % 위</text>`;
SHORT.forEach((s, k) => { const x = L + k * 170; svg += `<circle cx="${x + 6}" cy="74" r="5" fill="${COL[k]}" stroke="#fcfcfb" stroke-width="2"/><text x="${x + 16}" y="78" class="t2">${esc(s)}</text>`; });
J.chart.forEach((c, p) => {
  const y0 = TOP + p * (panelH + GAP), px = c.px.filter(v => v[0] >= c.from && v[0] <= c.to), nx = px.length;
  const X = i => L + (i / (nx - 1)) * PW, maxv = Math.max(...px.map(v => v[1])), top = Math.ceil(maxv * 10) / 10;
  const Y = v => y0 + 20 + (1 - v / top) * (PH - 20);
  const idx = new Map(px.map((v, i) => [v[0], i]));
  svg += `<text x="${L}" y="${y0 + 6}" class="t1s">${c.nm}년 폭락장 — 최저 ${c.low}${c.zone.length > 1 ? ` (1% 이내 쌍바닥: ${c.zone.filter(z => z !== c.low).join(', ')})` : ''}</text>`;
  for (let g = 0; g <= top + 1e-9; g += top > .6 ? .2 : .1) { const y = Y(g); svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" class="ax" text-anchor="end">+${Math.round(g * 100)}%</text>`; }
  // x축 월 표시
  let lastM = ''; px.forEach((v, i) => { const m = v[0].slice(0, 7); if (m !== lastM && v[0].slice(8) <= '07') { lastM = m; svg += `<text x="${X(i)}" y="${y0 + PH + 12}" class="ax" text-anchor="middle">${m.slice(2).replace('-', '.')}</text>`; } });
  // 최저일 세로선
  for (const z of c.zone) if (idx.has(z)) { const x = X(idx.get(z)); svg += `<line x1="${x}" x2="${x}" y1="${y0 + 14}" y2="${y0 + PH + 18 + LANE * 5}" class="${z === c.low ? 'low' : 'low2'}"/>`; }
  if (idx.has(c.low)) svg += `<text x="${X(idx.get(c.low)) + 4}" y="${y0 + 18}" class="t3">최저 ${c.low.slice(5)}</text>`;
  svg += `<polyline points="${px.map((v, i) => `${X(i).toFixed(1)},${Y(v[1]).toFixed(1)}`).join(' ')}" class="px"/>`;
  // 기법 줄
  J.techniques.forEach((t, k) => {
    const ly = y0 + PH + 26 + k * LANE;
    svg += `<line x1="${L}" x2="${W - R}" y1="${ly}" y2="${ly}" class="lane"/><text x="${L - 8}" y="${ly + 4}" class="t2" text-anchor="end">${esc(SHORT[k])}</text>`;
    const per = t.per.find(q => q.nm === c.nm);
    if (!per || per.miss) return;
    const xs = per.all.filter(a => idx.has(a.d)).map(a => X(idx.get(a.d)));
    per.all.forEach(a => { if (!idx.has(a.d)) return; const x = X(idx.get(a.d)); svg += `<circle cx="${x}" cy="${ly}" r="5" fill="${COL[k]}" stroke="#fcfcfb" stroke-width="2"><title>${esc(SHORT[k])} ${a.d} · 최저가 대비 +${(a.gap * 100).toFixed(1)}%</title></circle>`; });
    if (xs.length) { const f = per.all[0], txt = `첫 신호 ${f.d.slice(5)} +${(f.gap * 100).toFixed(1)}%${per.all.length > 1 ? ` (총 ${per.all.length}일)` : ''}`, xr = Math.max(...xs), xl = Math.min(...xs);
      svg += xr + 190 < W - R ? `<text x="${xr + 10}" y="${ly + 4}" class="lab">${txt}</text>` : `<text x="${xl - 10}" y="${ly + 4}" class="lab" text-anchor="end">${txt}</text>`; }
  });
});
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fcfcfb;font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif}
.t1{font-size:19px;font-weight:700;fill:#1f1f1e}.t1s{font-size:15px;font-weight:700;fill:#1f1f1e}
.t2{font-size:12.5px;fill:#3d3d3a}.t3{font-size:12px;fill:#6b6b66}.ax{font-size:11px;fill:#6b6b66}.lab{font-size:11px;fill:#3d3d3a}
.grid{stroke:#e6e5e0;stroke-width:1}.lane{stroke:#eeede8;stroke-width:1}
.px{fill:none;stroke:#8a8983;stroke-width:2;stroke-linejoin:round}
.low{stroke:#1f1f1e;stroke-width:1.2;stroke-dasharray:4 3}.low2{stroke:#9a9993;stroke-width:1;stroke-dasharray:2 3}
</style></head><body><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg></body></html>`;
fs.writeFileSync(OUT, html);
console.log('ok', W, H);
