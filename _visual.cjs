/* 用 Chrome DevTools Protocol 做真实浏览器验证：
 *  - 捕获控制台错误与未处理异常（headless --screenshot 看不到这些）
 *  - 按需滚动到任意区块截图
 *  - 真实交互：切主题、开命令面板、跑终端命令、向 AI 助手提问
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '_shot');
const PORT = 9222;
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (_) { /* 还没起来 */ }
    await sleep(400);
  }
  throw new Error('连接不到 Chrome 调试端口 ' + PORT);
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); } }, 30000);
    });
  }
  async js(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async function(){ ${expr} })()`,
      awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) throw new Error('页面内异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async shot(name, full) {
    const params = { format: 'png' };
    if (full) params.captureBeyondViewport = true;
    const r = await this.send('Page.captureScreenshot', params);
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return fs.statSync(f).size;
  }
}

(async () => {
  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');

  const url = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');
  await cdp.send('Page.navigate', { url });

  // 等待「真正就绪」而不是死等固定秒数：init() 跑完 + 启动动画收尾 + 入场动画启动。
  // 固定 sleep 会把「字体请求拖慢了脚本执行」误判成页面缺陷。
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    try {
      const st = await cdp.js(`
        const b = document.querySelector('#boot');
        return { done: !!b && b.classList.contains('is-done'),
                 subtitle: (document.querySelector('#aiSubtitle')||{}).textContent || '' };
      `);
      if (st.done && /\d/.test(st.subtitle)) { ready = true; break; }
    } catch (_) { /* 导航过程中上下文可能短暂不可用 */ }
  }
  await sleep(1500);   // 给入场动画与技能条留出完成时间

  const report = [];
  const log = (t, s) => { report.push(s); console.log((s === true ? '  PASS  ' : s === false ? '  FAIL  ' : '        ') + t); };

  log('页面在超时前完成初始化并收起启动动画（不再依赖固定 sleep）', ready);

  /* ── 1. 控制台错误 / 未捕获异常 ───────────────────────────────────── */
  const errors = cdp.events.filter(e =>
    (e.method === 'Runtime.exceptionThrown') ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  log('真实浏览器 JS 报错数 = ' + errors.length, errors.length === 0);
  errors.slice(0, 6).forEach(e => console.log('        ' + JSON.stringify(e.params).slice(0, 220)));

  /* ── 2. 页面结构自检 ─────────────────────────────────────────────── */
  const checks = await cdp.js(`
    const q = s => document.querySelector(s);
    const revealed = document.querySelectorAll('.reveal').length;
    const revealedIn = document.querySelectorAll('.reveal.is-in').length;
    return {
      theme: document.documentElement.dataset.theme,
      bootHidden: getComputedStyle(q('#boot')).visibility === 'hidden',
      projects: document.querySelectorAll('#projGrid .proj').length,
      timeline: document.querySelectorAll('#timeline .tl').length,
      skillBars: document.querySelectorAll('.skill__fill').length,
      skillBarFilled: Array.from(document.querySelectorAll('.skill__fill')).filter(f => f.style.width && f.style.width !== '0px').length,
      traits: document.querySelectorAll('#traits .trait').length,
      edu: document.querySelectorAll('#eduGrid .mini').length,
      contact: document.querySelectorAll('#contactGrid .cbox').length,
      chatMsgs: document.querySelectorAll('#aiChat .msg').length,
      sugg: document.querySelectorAll('#aiSugg .sugg').length,
      revealed, revealedIn,
      bodyH: document.body.scrollHeight,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollW: document.documentElement.scrollWidth, winW: window.innerWidth,
      kbCount: (q('#aiSubtitle').textContent.match(/\\d+/) || ['0'])[0],
      subtitle: q('#aiSubtitle').textContent,
      heroName: q('#heroName').textContent,
      role: q('#typedRole').textContent,
      // 「全部」筛选按钮上的计数，用来交叉验证项目卡数量——不写死具体数字
      filterTotal: (function(){ const f=q('#filters .n'); return f ? Number(f.textContent) : 0; })(),
      emptySections: Array.from(document.querySelectorAll('#heroStats,#timeline,#projGrid,#skillsGrid,#eduGrid,#contactGrid,#traits,#aiSugg'))
                        .filter(e => e.children.length === 0).map(e => e.id)
    };
  `);
  console.log('\n--- 结构自检 ---');
  log('主题 = ' + checks.theme, checks.theme === 'dark');
  log('启动动画已隐藏', checks.bootHidden === true);
  log('渲染数量：项目 ' + checks.projects + ' / 经历 ' + checks.timeline + ' / 技能条 ' + checks.skillBars +
      ' / 特质 ' + checks.traits + ' / 教育 ' + checks.edu + ' / 联系 ' + checks.contact,
      checks.projects > 0 && checks.timeline > 0 && checks.skillBars > 0 &&
      checks.traits > 0 && checks.edu > 0 && checks.contact > 0);
  log('筛选按钮计数（' + checks.filterTotal + '）与实际项目卡数量（' + checks.projects + '）一致',
      checks.filterTotal === checks.projects);
  log('没有空区块' + (checks.emptySections.length ? ' → ' + JSON.stringify(checks.emptySections) : ''),
      checks.emptySections.length === 0);
  log('页面宽度无横向溢出 (scrollW=' + checks.scrollW + ' vs winW=' + checks.winW + ')', checks.hOverflow === false);
  log('AI 提示条: "' + checks.subtitle + '"', Number(checks.kbCount) > 0);

  // 打字机是「输入→停顿→删空→下一个词」的循环，单次采样可能正好撞上删空的瞬间，
  // 所以采样多次，验证它确实在变化而不是静止。
  const typing = await cdp.js(`
    const el = document.querySelector('#typedRole');
    const samples = [];
    for (let i = 0; i < 7; i++) { samples.push(el.textContent); await new Promise(r => setTimeout(r, 280)); }
    return { samples, distinct: new Set(samples).size, maxLen: Math.max.apply(null, samples.map(s => s.length)) };
  `);
  log('打字机在轮播职位名（采样 ' + typing.distinct + ' 种状态，最长 ' + typing.maxLen + ' 字）',
      typing.maxLen > 0 && typing.distinct > 1);

  log('首屏只触发可见区块的入场动画 (' + checks.revealedIn + '/' + checks.revealed + '，其余等滚动)', checks.revealedIn > 0 && checks.revealedIn < checks.revealed);

  /* ── 3. 分区块截图 ───────────────────────────────────────────────── */
  console.log('\n--- 截图 ---');
  const go = async (sel, name, h) => {
    await cdp.js(`document.documentElement.style.scrollBehavior='auto'; const e=document.querySelector('${sel}'); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 80); return 1;`);
    await sleep(900);
    const size = await cdp.shot(name);
    console.log('        ' + name + '.png  ' + Math.round(size / 1024) + ' KB');
  };
  await cdp.js(`window.scrollTo(0,0); return 1;`); await sleep(700);
  console.log('        hero.png  ' + Math.round(await cdp.shot('hero') / 1024) + ' KB');
  await go('#about', 'about');
  await go('#experience', 'experience');
  await go('#projects', 'projects');
  await go('#skills', 'skills');
  await go('#education', 'education');
  await go('#contact', 'contact');

  /* ── 3b. 逐屏滚完全页后，入场动画与技能条应全部完成 ──────────────
   *  注意要逐屏滚（模拟真人阅读），瞬间跳转会让中间区块从未进入视口，
   *  那样测出来的是「测试跳过了区块」，而不是页面有 bug。 */
  const totalH = await cdp.js('return document.body.scrollHeight;');
  for (let y = 0; y < totalH; y += 600) {
    await cdp.js(`window.scrollTo(0, ${y}); return 1;`);
    await sleep(180);
  }
  await cdp.js('window.scrollTo(0, document.body.scrollHeight); return 1;');
  await sleep(1500);
  const afterScroll = await cdp.js(`
    const all = Array.from(document.querySelectorAll('.reveal'));
    const bars = Array.from(document.querySelectorAll('.skill__fill'));
    return {
      revealed: all.length,
      revealedIn: all.filter(e => e.classList.contains('is-in')).length,
      bad: all.filter(e => !e.classList.contains('is-in')).map(e => e.className),
      bars: bars.length,
      barsFilled: bars.filter(f => f.style.width && f.style.width !== '0px' && f.style.width !== '').length,
      sampleWidth: bars.length ? bars[0].style.width : ''
    };
  `);
  log('逐屏滚完后入场动画 ' + afterScroll.revealedIn + '/' + afterScroll.revealed + ' 全部触发' +
      (afterScroll.bad.length ? ' → 漏: ' + JSON.stringify(afterScroll.bad) : ''),
      afterScroll.revealedIn === afterScroll.revealed);
  log('技能条 ' + afterScroll.barsFilled + '/' + afterScroll.bars + ' 已按 level 展开（示例 ' + afterScroll.sampleWidth + '）',
      afterScroll.barsFilled === afterScroll.bars);

  /* ── 4. AI 助手真实提问（截图答案） ──────────────────────────────── */
  console.log('\n--- AI 助手交互 ---');
  await go('#ai', 'ai-idle');
  // 问题从页面上的推荐问题胶囊里取，这样测试不依赖简历的具体内容
  const suggs = await cdp.js(`return Array.from(document.querySelectorAll('#aiSugg .sugg')).map(b => b.textContent.trim()).filter(Boolean);`);
  log('推荐问题胶囊 ' + suggs.length + ' 个：' + JSON.stringify(suggs.slice(0, 2)), suggs.length > 0);
  const askAi = async (q, name) => {
    await cdp.js(`
      const i = document.querySelector('#aiInput');
      i.value = ${JSON.stringify(q)};
      i.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('#aiForm').requestSubmit();
      return 1;
    `);
    await sleep(3600);
    console.log('        ' + name + '.png  ' + Math.round(await cdp.shot(name) / 1024) + ' KB');
  };
  await askAi(suggs[0] || '介绍一下他自己', 'ai-q1');
  await askAi(suggs[1] || '有什么项目经验', 'ai-q2');

  const chatState = await cdp.js(`
    const msgs = Array.from(document.querySelectorAll('#aiChat .msg'));
    const last = msgs[msgs.length-1];
    const all = msgs.map(m => m.querySelector('.msg__bubble').innerHTML).join('');
    const plain = msgs.map(m => m.querySelector('.msg__bubble').textContent).join(' ');
    return {
      count: msgs.length,
      lastText: last ? last.querySelector('.msg__bubble').innerText.slice(0,180) : '',
      cites: last ? last.querySelectorAll('.msg__cite a').length : 0,
      acts: last ? last.querySelectorAll('.msg__act').length : 0,
      note: last ? (last.querySelector('.msg__note')||{}).innerText || '' : '',
      anyBold: /<strong>/.test(all),
      anyList: /<ul>/.test(all),
      anyQuote: /<blockquote>/.test(all),
      leftoverMd: /\\*\\*|^>\\s/m.test(plain),
      iframeOrScript: /<script|<iframe|onerror=/i.test(all),
      ariaBusy: document.querySelector('#aiChat').getAttribute('aria-busy'),
      ariaLive: document.querySelector('#aiChat').getAttribute('aria-live'),
      announce: (document.querySelector('#aiAnnounce')||{}).textContent || ''
    };
  `);
  log('对话轮数 = ' + chatState.count + '（1 欢迎 + 2 问 + 2 答）', chatState.count === 5);
  log('末条答案有来源标签 ' + chatState.cites + ' 个', chatState.cites > 0);
  log('末条答案有反馈按钮 ' + chatState.acts + ' 个', chatState.acts === 5);
  log('渲染后的答案里没有残留 Markdown 标记（** / >）', chatState.leftoverMd === false);
  log('答案里有结构化元素（粗体=' + chatState.anyBold + ' 列表=' + chatState.anyList + ' 引用=' + chatState.anyQuote + '）',
      chatState.anyBold || chatState.anyList || chatState.anyQuote);
  log('答案中无注入的 script/iframe/onerror', chatState.iframeOrScript === false);
  log('答案标注「' + chatState.note + '」', /本地检索|大模型/.test(chatState.note));
  log('流式期间 aria-busy=' + chatState.ariaBusy + '、对话区 aria-live=' + chatState.ariaLive +
      '（避免读屏被逐字刷屏）', chatState.ariaBusy === 'false' && chatState.ariaLive === 'off');
  log('结束后由 #aiAnnounce 播报完整答案 ' + chatState.announce.length + ' 字', chatState.announce.length > 10);
  console.log('        答案首段: ' + chatState.lastText.replace(/\n/g, ' / ').slice(0, 130));

  /* ── 5. 命令面板 ─────────────────────────────────────────────────── */
  console.log('\n--- 命令面板 ---');
  await cdp.js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true})); return 1;`);
  await sleep(700);
  const pal = await cdp.js(`
    const o = document.querySelector('#paletteOverlay');
    return { open: o.classList.contains('is-open'), items: o.querySelectorAll('.cmd').length, groups: o.querySelectorAll('.cmdgroup').length,
             firstFocus: document.activeElement && document.activeElement.id };
  `);
  log('Ctrl+K 打开面板，条目 = ' + pal.items + '，分组 = ' + pal.groups, pal.open && pal.items > 15);
  log('焦点自动落到搜索框（' + pal.firstFocus + '）', pal.firstFocus === 'paletteInput');
  // 搜索词从页面上取（第一个项目的名字），不写死具体内容
  const probe = await cdp.js(`const e=document.querySelector('#projGrid .proj__name'); return e ? e.textContent.replace(/\\s+/g,'').slice(0,4) : '项目';`);
  await cdp.js(`const i=document.querySelector('#paletteInput'); i.value=${JSON.stringify(probe)}; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  await sleep(500);
  const palSearch = await cdp.js(`return Array.from(document.querySelectorAll('#paletteList .cmd__t')).map(e=>e.textContent).slice(0,4);`);
  log('搜索 "' + probe + '" → ' + JSON.stringify(palSearch), palSearch.length > 0);  console.log('        palette.png  ' + Math.round(await cdp.shot('palette') / 1024) + ' KB');
  await cdp.js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 1;`);
  await sleep(500);

  /* ── 6. Hero 终端 ────────────────────────────────────────────────── */
  console.log('\n--- Hero 终端 ---');
  await cdp.js(`window.scrollTo(0,0); return 1;`); await sleep(600);
  for (const cmd of ['whoami', 'skills', 'hire']) {
    await cdp.js(`
      const i = document.querySelector('#termInput');
      i.value = ${JSON.stringify(cmd)};
      document.querySelector('#termForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
      return 1;
    `);
    await sleep(700);
  }
  const term = await cdp.js(`
    const lines = Array.from(document.querySelectorAll('#termBody .term-line'));
    return { n: lines.length, text: lines.map(l=>l.innerText).join('\\n').slice(-320) };
  `);
  log('终端输出了 ' + term.n + ' 行', term.n > 8);
  console.log('        末尾输出: ' + term.text.replace(/\n/g, ' | ').slice(-190));
  console.log('        terminal.png  ' + Math.round(await cdp.shot('terminal') / 1024) + ' KB');

  /* ── 7. 项目详情弹窗 ─────────────────────────────────────────────── */
  console.log('\n--- 项目详情 ---');
  await cdp.js(`document.querySelector('#projGrid .proj').click(); return 1;`);
  await sleep(900);
  const modal = await cdp.js(`
    const o = document.querySelector('#detailOverlay');
    return { open: o.classList.contains('is-open'), title: document.querySelector('#detailTitle').textContent,
             metrics: o.querySelectorAll('.metric').length, bullets: o.querySelectorAll('.detail li').length,
             bodyOverflow: document.body.style.overflow };
  `);
  log('详情弹窗打开，标题「' + modal.title + '」', modal.open === true);
  log('含 ' + modal.metrics + ' 个指标卡 + ' + modal.bullets + ' 条明细', modal.metrics >= 3 && modal.bullets >= 4);
  log('打开时锁定页面滚动', modal.bodyOverflow === 'hidden');
  console.log('        modal.png  ' + Math.round(await cdp.shot('modal') / 1024) + ' KB');
  await cdp.js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 1;`);
  await sleep(500);

  /* ── 8. 浅色主题 ─────────────────────────────────────────────────── */
  console.log('\n--- 浅色主题 ---');
  await cdp.js(`document.querySelector('#themeBtn').click(); return 1;`);
  await sleep(700);
  const light = await cdp.js(`return { theme: document.documentElement.dataset.theme, stored: localStorage.getItem('resume.theme'),
    fg: getComputedStyle(document.body).color, bg: getComputedStyle(document.body).backgroundColor };`);
  log('切换到 ' + light.theme + '，已持久化 = ' + light.stored, light.theme === 'light' && light.stored === 'light');
  await go('#skills', 'light-skills');
  await cdp.js(`document.querySelector('#themeBtn').click(); return 1;`); await sleep(500);

  /* ── 9. 移动端视口 ───────────────────────────────────────────────── */
  console.log('\n--- 移动端 390px ---');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1200);
  const mob = await cdp.js(`
    const burger = document.querySelector('#burger');
    return { burgerShown: getComputedStyle(burger).display !== 'none',
             hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
             scrollW: document.documentElement.scrollWidth, winW: window.innerWidth,
             navHidden: getComputedStyle(document.querySelector('#nav')).visibility };
  `);
  log('汉堡菜单在移动端显示', mob.burgerShown === true);
  log('390px 无横向溢出 (scrollW=' + mob.scrollW + ' vs ' + mob.winW + ')', mob.hOverflow === false);
  await cdp.js(`window.scrollTo(0,0); return 1;`); await sleep(600);
  console.log('        mobile.png  ' + Math.round(await cdp.shot('mobile') / 1024) + ' KB');
  await cdp.js(`document.querySelector('#burger').click(); return 1;`); await sleep(600);
  console.log('        mobile-nav.png  ' + Math.round(await cdp.shot('mobile-nav') / 1024) + ' KB');
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  /* ── 10. 打印样式 ────────────────────────────────────────────────── */
  console.log('\n--- 打印 / PDF ---');
  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(900);
  const pr = await cdp.js(`
    const hidden = s => { const e=document.querySelector(s); return !e || getComputedStyle(e).display === 'none'; };
    return { nav: hidden('.topbar'), ai: hidden('.ai-wrap'), term: hidden('.term__inputline'), printOnly: !hidden('.print-only'),
             bodyBg: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(document.body).color };
  `);
  log('打印时隐藏导航 / AI 面板 / 终端输入行', pr.nav && pr.ai && pr.term);
  log('打印时显示静态说明块', pr.printOnly === true);
  log('打印配色 ' + pr.color + ' on ' + pr.bodyBg, pr.bodyBg === 'rgb(255, 255, 255)' && pr.color === 'rgb(13, 17, 23)');
  await cdp.js(`window.scrollTo(0,0); return 1;`); await sleep(500);
  console.log('        print.png  ' + Math.round(await cdp.shot('print') / 1024) + ' KB');
  await cdp.send('Emulation.setEmulatedMedia', { media: '' });

  /* ── 11. 最终错误检查 ────────────────────────────────────────────── */
  const finalErrors = cdp.events.filter(e =>
    (e.method === 'Runtime.exceptionThrown') ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
    (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  console.log('\n=== 全程 JS 报错总数 = ' + finalErrors.length + ' ===');
  finalErrors.slice(0, 8).forEach(e => console.log('   ' + JSON.stringify(e.params).slice(0, 260)));

  const fails = report.filter(x => x === false).length;
  console.log('\n' + (fails === 0 && finalErrors.length === 0 ? '✅ 真实浏览器验证全部通过' : '❌ 失败 ' + fails + ' 项，报错 ' + finalErrors.length + ' 条'));
  ws.close();
  process.exit(0);
})().catch(err => { console.error('测试运行失败:', err.message); process.exit(1); });
