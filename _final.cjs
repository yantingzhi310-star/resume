/* 成品确认：真实提一个问题，然后截取 AI 助手面板整体 + 移动端首屏 */
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, '_final'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const js = async e => {
    const r = await send('Runtime.evaluate', { expression: `(function(){${e}})()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name, sel, maxH) => {
    await js(`document.documentElement.style.scrollBehavior='auto'; const e=document.querySelector('${sel}'); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 100); return 1;`);
    await sleep(900);
    const box = await js(`const r=document.querySelector('${sel}').getBoundingClientRect();
      return {x:Math.max(0,r.left+window.scrollX-16), y:Math.max(0,r.top+window.scrollY-16),
              width:Math.min(r.width+32,1100), height:Math.min(r.height+32,${maxH || 900})};`);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 2 } });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  ' + name + '.png  ' + Math.round(box.width) + 'x' + Math.round(box.height) + ' @2x');
  };
  await send('Page.enable'); await send('Runtime.enable');

  /* 桌面：提问后截取 AI 面板 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///E:/deepseek/resume-site/index.html' });
  await sleep(4200);
  await js(`
    const i=document.querySelector('#aiInput'); i.value='他 RAG 到底做到什么程度？';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#aiForm').requestSubmit(); return 1;`);
  await sleep(3500);
  await js(`document.querySelector('#aiChat').scrollTop = 0; return 1;`);
  await sleep(400);
  await shot('ai-full', '#aiWrap', 1000);
  await shot('hero-desktop', '.hero__grid', 700);

  /* 移动端首屏 */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'file:///E:/deepseek/resume-site/index.html' });
  await sleep(4200);
  await js('window.scrollTo(0,0); return 1'); await sleep(600);
  await shot('mobile-hero', '.hero__grid', 900);
  ws.close(); process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
