/* 生成社交分享卡片 og-image.png（1200×630）
 * 为什么要脚本：这张图必须和站点内容一致。改了简历却忘了换分享图，
 * 转发出去就是旧名字。改完内容跑一次 `node _og-image.cjs` 即可。
 *
 * 用法：先起一个带调试端口的 Chrome，再运行本脚本。
 *   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/p about:blank
 */
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const W = 1200, H = 630;

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
    const r = await send('Runtime.evaluate', { expression: `(async function(){ ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');

  // 从站点本身读数据，保证分享图和站内内容同源
  const sitePath = path.join(__dirname, 'index.html').replace(/\\/g, '/');
  await send('Page.navigate', { url: 'file:///' + sitePath });
  await sleep(4200);

  const d = await js(`
    return {
      name: PROFILE.meta.nameZh,
      nameEn: PROFILE.meta.nameEn,
      roles: PROFILE.meta.roles.slice(0, 2),
      location: PROFILE.meta.location,
      status: PROFILE.meta.status,
      stats: PROFILE.stats.slice(0, 4).map(s => ({ n: s.num + s.suffix, l: s.label })),
      top: (PROFILE.projects[0] || {}).metric || '',
      site: (SITE.cfg && SITE.cfg.siteUrl) || PROFILE.meta.site
    };
  `);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const html = `<!doctype html><html><head><meta charset="utf-8" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet" />
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    width:${W}px;height:${H}px;overflow:hidden;position:relative;
    background:#0b0e13;color:#e6edf3;
    font-family:'Inter','Noto Sans SC','Segoe UI','Microsoft YaHei',sans-serif;
    display:flex;flex-direction:column;justify-content:center;padding:72px 80px;
  }
  .grid{position:absolute;inset:0;
    background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);
    background-size:60px 60px;
    mask-image:radial-gradient(ellipse 70% 70% at 30% 40%,#000,transparent 78%);
    -webkit-mask-image:radial-gradient(ellipse 70% 70% at 30% 40%,#000,transparent 78%);}
  .blob{position:absolute;border-radius:50%;filter:blur(90px)}
  .b1{width:520px;height:520px;background:#3ddc97;opacity:.16;top:-190px;left:-120px}
  .b2{width:420px;height:420px;background:#22d3ee;opacity:.13;bottom:-180px;right:-80px}
  .inner{position:relative;z-index:2}
  .pill{display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:99px;
    border:1px solid rgba(61,220,151,.32);background:rgba(61,220,151,.1);
    color:#3ddc97;font-family:'JetBrains Mono',Consolas,monospace;font-size:16px;margin-bottom:30px}
  .dot{width:9px;height:9px;border-radius:50%;background:#3ddc97}
  h1{font-size:78px;line-height:1.08;letter-spacing:-.03em;font-weight:700;margin-bottom:20px}
  h1 em{font-style:normal;color:#3ddc97;font-family:'JetBrains Mono',Consolas,monospace}
  .role{font-family:'JetBrains Mono',Consolas,monospace;font-size:25px;color:#22d3ee;margin-bottom:34px}
  .stats{display:flex;gap:52px}
  .stat .n{font-family:'JetBrains Mono',Consolas,monospace;font-size:34px;font-weight:700;color:#3ddc97;line-height:1.1}
  .stat .l{font-size:16px;color:#8b949e;margin-top:5px}
  .foot{position:absolute;left:80px;right:80px;bottom:46px;display:flex;justify-content:space-between;align-items:center;
    font-family:'JetBrains Mono',Consolas,monospace;font-size:16px;color:#7d8792;
    border-top:1px solid rgba(255,255,255,.1);padding-top:22px;z-index:2}
  .foot b{color:#3ddc97;font-weight:400}
</style></head><body>
  <div class="grid"></div><div class="blob b1"></div><div class="blob b2"></div>
  <div class="inner">
    <div class="pill"><span class="dot"></span>${esc(d.status)}</div>
    <h1>${esc(d.name)} <em>${esc(d.nameEn)}</em></h1>
    <div class="role">${esc(d.roles.join('  /  '))}</div>
    <div class="stats">
      ${d.stats.map(s => `<div class="stat"><div class="n">${esc(s.n)}</div><div class="l">${esc(s.l)}</div></div>`).join('')}
    </div>
  </div>
  <div class="foot">
    <span>${esc(d.location)}</span>
    <span>${esc(d.top)} &nbsp;·&nbsp; <b>${esc(String(d.site).replace(/^https?:\/\//, ''))}</b></span>
  </div>
</body></html>`;

  // 用一个离屏页面渲染这张卡片，保证字体和站点一致
  const tmp = path.join(__dirname, '_og-template.html');
  fs.writeFileSync(tmp, html, 'utf8');
  await send('Page.navigate', { url: 'file:///' + tmp.replace(/\\/g, '/') });
  await sleep(2600);

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(__dirname, 'og-image.png');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');

  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log('已生成 og-image.png  ' + W + '×' + H + '  ' + kb + ' KB');
  console.log('  姓名: ' + d.name + ' / ' + d.nameEn);
  console.log('  职位: ' + d.roles.join(' · '));
  console.log('  数字: ' + d.stats.map(s => s.n + ' ' + s.l).join(' | '));
  if (kb > 300) console.log('  提示: 超过 300KB，部分平台会拒绝或压缩，可以考虑降低色彩复杂度');
  fs.unlinkSync(tmp);
  ws.close();
  process.exit(0);
})().catch(e => { console.error('生成失败:', e.message); process.exit(1); });
