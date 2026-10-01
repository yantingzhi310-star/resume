/* 布局审计：找出横向溢出、被裁切的文本、空区块、孤行等真实排版问题 */
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const js = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');

  let fails = 0, warns = 0;
  const check = (ok, msg) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + msg); if (!ok) fails++; };
  const warn = (ok, msg) => { if (!ok) { console.log('  WARN  ' + msg); warns++; } };

  for (const [label, w, h] of [['桌面 1440', 1440, 1000], ['平板 834', 834, 1112], ['手机 390', 390, 844], ['小屏 320', 320, 700]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
    await send('Page.navigate', { url: 'file:///E:/deepseek/resume-site/index.html' });
    await sleep(3800);
    const hs = await js('return document.body.scrollHeight');
    for (let y = 0; y < hs; y += 400) { await js(`window.scrollTo(0,${y}); return 1`); await sleep(250); }
    await js('window.scrollTo(0,0); return 1'); await sleep(1800);
    const missing = await js(`
      return Array.from(document.querySelectorAll('.reveal')).filter(e => !e.classList.contains('is-in'))
        .map(e => (e.className||'') + '|h=' + Math.round(e.getBoundingClientRect().height));
    `);

    const r = await js(`
      const docW = document.documentElement.clientWidth;
      const overflow = [];
      document.querySelectorAll('*').forEach(e => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.right > docW + 1.5 || r.left < -1.5) {
          const cs = getComputedStyle(e);
          if (cs.position === 'fixed') return;
          overflow.push(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0,2).join('.') : '') + ' right=' + Math.round(r.right));
        }
      });
      const clipped = [];
      document.querySelectorAll('.proj__name,.tl__role,.stat__num,.sec-title,.hero__name,.cbox__v,.cmd__t,.metric__v,.skill__name').forEach(e => {
        if (e.scrollWidth > e.clientWidth + 2) clipped.push(e.className + ':' + e.textContent.trim().slice(0,20));
      });
      // 空的列表区块会被页面自动隐藏（内容还没填完时），这不算缺陷。
      // 只统计「可见却为空」的容器，以及「可见却没触发入场动画」的元素。
      const shown = e => e.getClientRects().length > 0;
      const empty = [];
      document.querySelectorAll('#heroStats,#timeline,#projGrid,#skillsGrid,#eduGrid,#contactGrid,#traits,#aiSugg,#filters').forEach(e => {
        if (e.children.length === 0 && shown(e)) empty.push(e.id);
      });
      const hidden = Array.from(document.querySelectorAll('.reveal')).filter(e => shown(e) && !e.classList.contains('is-in')).length;
      const tiny = Array.from(document.querySelectorAll('button')).filter(b => { const r=b.getBoundingClientRect(); return r.width>0 && (r.height<32||r.width<32); }).length;
      return { docW, scrollW: document.documentElement.scrollWidth, bodyH: document.body.scrollHeight,
               overflow: overflow.slice(0,5), clipped: clipped.slice(0,5), empty, hidden, tiny,
               secCount: document.querySelectorAll('section').length };
    `);

    console.log('\\n=== ' + label + 'px ===');
    check(r.scrollW <= r.docW + 1, '无横向溢出 (scrollW=' + r.scrollW + ' clientW=' + r.docW + ')' + (r.overflow.length ? ' → ' + JSON.stringify(r.overflow) : ''));
    check(r.clipped.length === 0, '无文字被裁切' + (r.clipped.length ? ' → ' + JSON.stringify(r.clipped) : ''));
    check(r.empty.length === 0, '无空区块' + (r.empty.length ? ' → ' + JSON.stringify(r.empty) : ''));
    check(r.hidden === 0, '入场动画全部触发' + (missing.length ? ' → 漏: ' + JSON.stringify(missing.slice(0,4)) : ''));
    warn(r.tiny === 0, r.tiny + ' 个可点击元素小于 32px（触控目标建议 ≥44px）');
    console.log('        页面总高 ' + r.bodyH + 'px，' + r.secCount + ' 个 section');
  }
  await send('Emulation.clearDeviceMetricsOverride');
  console.log('\\n' + (fails === 0 ? '✅ 布局审计通过' + (warns ? '（' + warns + ' 条提示）' : '') : '❌ ' + fails + ' 项失败'));
  ws.close(); process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('审计失败:', e.message); process.exit(1); });
