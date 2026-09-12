/* 局部高清截图：先滚完全页触发所有入场动画，再按元素绝对坐标裁切特写，
 * 这样视觉工具看到的是紧凑区域而不是整屏缩略图。同时做对比度数值核算。 */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '_crop');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function lum(hex) {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const js = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'file:///E:/deepseek/resume-site/index.html' });
  await sleep(4200);

  // 逐屏滚动，触发全部入场动画
  const h = await js('return document.body.scrollHeight');
  for (let y = 0; y < h; y += 500) { await js(`window.scrollTo(0,${y}); return 1`); await sleep(150); }
  await js('window.scrollTo(0,0); return 1'); await sleep(1200);

  /* ── 对比度核算 ─────────────────────────────────────────────────── */
  const tokens = await js(`
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    return { bg: g('--bg-base'), fg: g('--fg'), muted: g('--fg-muted'), dim: g('--fg-dim'),
             accent: g('--accent'), accent2: g('--accent-2'), accent3: g('--accent-3'), violet: g('--violet'), card: g('--bg-elev') };
  `);
  console.log('=== 深色主题对比度（WCAG AA 正文需 ≥4.5:1）===');
  const pairs = [
    ['正文 --fg', tokens.fg, tokens.bg], ['次要 --fg-muted', tokens.muted, tokens.bg],
    ['弱化 --fg-dim', tokens.dim, tokens.bg], ['终端绿 --accent', tokens.accent, tokens.bg],
    ['青 --accent-2', tokens.accent2, tokens.bg], ['琥珀 --accent-3', tokens.accent3, tokens.bg],
    ['紫 --violet', tokens.violet, tokens.bg], ['正文 on 卡片', tokens.fg, tokens.card],
    ['次要 on 卡片', tokens.muted, tokens.card], ['弱化 on 卡片', tokens.dim, tokens.card]
  ];
  for (const [name, f, b] of pairs) {
    const r = ratio(f, b);
    console.log(`  ${r >= 4.5 ? 'PASS' : r >= 3 ? 'WARN' : 'FAIL'}  ${name.padEnd(18)} ${f} on ${b}  = ${r.toFixed(2)}:1`);
  }

  /* ── 局部特写 ───────────────────────────────────────────────────── */
  const crops = [
    ['c-hero-left', '.hero__grid > div:first-child'],
    ['c-term', '#term'],
    ['c-nav', '.topbar'],
    ['c-proj-card', '#projGrid .proj'],
    ['c-filters', '#filters'],
    ['c-skillgrp', '#skillsGrid .card'],
    ['c-timeline', '#timeline .tl'],
    ['c-ai-panel', '.ai-head'],
    ['c-ai-msg', '#aiChat .msg:last-child']
  ];
  console.log('\n=== 局部特写 ===');
  for (const [name, sel] of crops) {
    // 先把目标滚进视口，否则 Chrome 不会绘制视口外的区域，截出来是空白
    const visible = await js(`
      const e = document.querySelector('${sel}');
      if (!e) return false;
      window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 120);
      return true;
    `);
    if (!visible) { console.log('  SKIP ' + name + '（元素不存在）'); continue; }
    await sleep(700);
    const box = await js(`
      const e = document.querySelector('${sel}');
      const r = e.getBoundingClientRect();
      return { x: Math.max(0, r.left + window.scrollX - 10), y: Math.max(0, r.top + window.scrollY - 10),
               width: Math.min(r.width + 20, 900), height: Math.min(r.height + 20, 780) };
    `);
    if (!box || box.width < 5) { console.log('  SKIP ' + name + '（不可见）'); continue; }
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 2 } });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log(`  ${name.padEnd(14)} ${Math.round(box.width)}x${Math.round(box.height)} @2x  ${Math.round(fs.statSync(f).size / 1024)} KB`);
  }

  ws.close(); process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
