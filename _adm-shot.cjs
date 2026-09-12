/* 管理员面板截图：登录页 + 各分页 */
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, '_adm-shot'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const js = async e => {
    const r = await send('Runtime.evaluate', { expression: `(async function(){${e}})()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  ' + name + '.png ' + Math.round(fs.statSync(path.join(OUT, name + '.png')).size / 1024) + ' KB');
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1380, height: 940, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///E:/deepseek/resume-site/index.html' });
  await sleep(4200);
  await js(`localStorage.clear(); sessionStorage.clear(); return 1;`);
  await send('Page.navigate', { url: 'file:///E:/deepseek/resume-site/index.html' });
  await sleep(4200);

  // 登录页（首次设置密码）
  await js(`document.querySelector('#adminEntry').click(); return 1;`);
  await sleep(700);
  await shot('01-login');
  // 设置密码进入
  await js(`document.querySelector('#adminPwd').value='demo123456';
            document.querySelector('#adminPwd2').value='demo123456';
            document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
  await sleep(4000);
  await shot('02-panel-basic');
  for (const [tab, name] of [['exp', '03-exp'], ['proj', '04-proj'], ['ai', '05-ai'], ['faq', '06-faq'], ['site', '07-site'], ['data', '08-data'], ['security', '09-security']]) {
    await js(`document.querySelector('[data-tab="${tab}"]').click(); return 1;`);
    await sleep(500);
    await shot(name);
  }
  // 展开一个项目卡片，看嵌套指标编辑器
  await js(`document.querySelector('[data-tab="proj"]').click(); return 1;`);
  await sleep(400);
  await js(`const b=document.querySelector('#adminPane .adm-item__bar'); b.click(); return 1;`);
  await sleep(500);
  await js(`window.scrollTo(0,0); document.querySelector('.admin__main').scrollTop = 260; return 1;`);
  await sleep(400);
  await shot('10-proj-expanded');
  // 移动端
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  await js(`document.querySelector('[data-tab="basic"]').click(); return 1;`);
  await sleep(500);
  await shot('11-mobile');
  await send('Emulation.clearDeviceMetricsOverride');
  ws.close(); process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
