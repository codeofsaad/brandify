// Usage: node scripts/make-mock-shots.mjs <outDir>   Renders two fake customer dashboards for testing the screenshot feature.
import { chromium } from 'playwright';

const dark = `<body style="margin:0;width:1200px;height:720px;background:#0F1B2D;color:#E8EEF6;font:15px Inter,system-ui,sans-serif">
<div style="height:64px;background:#F2711C;display:flex;align-items:center;padding:0 28px;font-weight:700;font-size:20px;color:#fff">ACME Logistics</div>
<div style="display:flex;gap:20px;padding:24px">
 ${['Shipments|12,480','On-time|94.2%','Delayed|312'].map((x)=>`<div style="flex:1;background:#17263B;border-radius:12px;padding:20px"><div style="opacity:.7">${x.split('|')[0]}</div><div style="font-size:30px;font-weight:700;margin-top:6px">${x.split('|')[1]}</div></div>`).join('')}
</div>
<div style="display:flex;gap:20px;padding:0 24px">
 <div style="flex:2;background:#17263B;border-radius:12px;padding:20px;height:380px;display:flex;align-items:flex-end;gap:26px">
  ${[['#F2711C',300],['#1FB5A8',230],['#E5B83B',180],['#8B6FD6',120],['#F2711C',260],['#1FB5A8',200]].map(([c,h])=>`<div style="flex:1;height:${h}px;background:${c};border-radius:6px"></div>`).join('')}
 </div>
 <div style="flex:1;background:#17263B;border-radius:12px;padding:20px"><div style="opacity:.7">Top lanes</div>${[1,2,3,4,5].map(()=>'<div style="height:10px;margin-top:22px;background:#2A3C57;border-radius:5px"></div>').join('')}</div>
</div></body>`;

const light = `<body style="margin:0;width:1200px;height:720px;background:#F4F6F9;color:#1B2430;font:15px Inter,system-ui,sans-serif">
<div style="height:64px;background:#0B2A4A;display:flex;align-items:center;padding:0 28px;font-weight:700;font-size:20px;color:#fff">NORTHWIND Health</div>
<div style="display:flex;gap:20px;padding:24px">
 ${['Admissions|1,204','Readmit rate|6.1%','Avg stay|3.8d'].map((x)=>`<div style="flex:1;background:#fff;border-radius:6px;padding:20px;box-shadow:0 1px 4px #0002"><div style="color:#667">${x.split('|')[0]}</div><div style="font-size:30px;font-weight:700;margin-top:6px;color:#0B2A4A">${x.split('|')[1]}</div></div>`).join('')}
</div>
<div style="display:flex;gap:20px;padding:0 24px">
 <div style="flex:2;background:#fff;border-radius:6px;padding:20px;height:380px;display:flex;align-items:flex-end;gap:26px;box-shadow:0 1px 4px #0002">
  ${[['#2E9E5B',300],['#0B2A4A',230],['#6FB7E9',180],['#2E9E5B',250],['#0B2A4A',160],['#6FB7E9',210]].map(([c,h])=>`<div style="flex:1;height:${h}px;background:${c};border-radius:2px"></div>`).join('')}
 </div>
 <div style="flex:1;background:#fff;border-radius:6px;padding:20px;box-shadow:0 1px 4px #0002"><button style="background:#2E9E5B;color:#fff;border:0;padding:10px 18px;border-radius:4px;font-weight:600">Export report</button></div>
</div></body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
for (const [name, html] of [['dark-dashboard', dark], ['light-dashboard', light]]) {
  await page.setContent(html);
  await page.screenshot({ path: `${process.argv[2]}/${name}.png` });
}
await browser.close();
console.log('wrote', process.argv[2]);
