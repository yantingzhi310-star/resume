/* 管理员模式专项测试（真实浏览器 + CDP）
 * 覆盖：首次设置密码、密码强度校验、登录、错误密码限速、会话锁定、
 *       各分页编辑、列表增删排序、站点设置、导出、以及「导出的文件能不能真的用」。
 */
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXPORT_PATH = path.join(__dirname, '_exported.html');

let fails = 0, warns = 0;
const check = (ok, msg) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + msg); if (!ok) fails++; };
const warn = (ok, msg) => { if (!ok) { console.log('  WARN  ' + msg); warns++; } };

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
    if (r.exceptionDetails) throw new Error('页面内异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const reload = async (url) => {
    await send('Page.navigate', { url: url });
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      try { const ok = await js(`return !!document.querySelector('#adminEntry')`); if (ok) break; } catch (_) {}
    }
    await sleep(1200);
  };

  await send('Page.enable'); await send('Runtime.enable');

  const base = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');
  await reload(base);
  console.log('\n=== 1. 环境与入口 ===');

  const env = await js(`
    let sd = {}, parses = true;
    try { sd = JSON.parse((document.querySelector('#siteData').textContent || '{}').trim() || '{}'); }
    catch (e) { parses = false; }
    return { subtle: !!(window.crypto && window.crypto.subtle),
             secure: window.isSecureContext,
             entry: !!document.querySelector('#adminEntry'),
             panelHidden: document.querySelector('#adminPanel').hidden,
             siteDataParses: parses,
             siteDataHasProfile: !!sd.profile,
             bakedName: sd.profile ? sd.profile.meta.nameZh : '',
             bakedAdmin: !!(sd.admin && sd.admin.hash && sd.admin.salt),
             bakedIter: sd.admin ? sd.admin.iter : 0,
             siteDataCfg: sd.cfg ? Object.keys(sd.cfg).join(',') : '' };
  `);
  check(env.subtle, 'file:// 下 WebCrypto 可用（PBKDF2 密码哈希的前提）');
  // 烘焙内容与否都合法：空 → 用文件里的默认值；有 → 用烘焙的（真实简历）
  check(env.siteDataParses, 'siteData 数据块可解析：' +
    (env.siteDataHasProfile ? '已烘焙简历（' + env.bakedName + '）' : '空，使用文件默认值') +
    (env.siteDataCfg ? ' · 站点配置 ' + env.siteDataCfg : ''));
  check(env.entry && env.panelHidden, '页脚有「管理」入口，面板默认隐藏');

  /* 管理员密码有两种状态，测试必须都能跑：
       ① 未烘焙 → 首次进入走「设置密码」流程（本地密码，可改）
       ② 已烘焙 → 首次进入走「登录」流程（站点固定密码，页面内不可改）
     已烘焙时需要一个已知密码，用环境变量传入：ADMIN_PWD=xxx node _admin.cjs */
  const PWD = process.env.ADMIN_PWD || 'test1234';
  const PWDJS = JSON.stringify(PWD);   // 注入到页面脚本里时的字面量形式
  const BAKED = env.bakedAdmin;

  console.log('\n=== 2. 进入管理面板（' + (BAKED ? '已烘焙固定密码' : '未烘焙 → 走设置流程') + '）===');
  await js(`document.querySelector('#adminEntry').click(); return 1;`);
  await sleep(600);
  const l0 = await js(`return { open: document.querySelector('#adminLoginOverlay').classList.contains('is-open'),
                               setup: document.querySelector('#adminPwd2Field').style.display !== 'none',
                               title: document.querySelector('#adminLoginTitle').textContent };`);
  check(l0.open, '点「管理」弹出登录层');

  if (BAKED) {
    check(!l0.setup && /登录/.test(l0.title),
      '已固定密码时走「登录」而不是「设置」：' + l0.title + '（访客不会看到「请设置密码」）');
    if (!process.env.ADMIN_PWD) {
      console.log('  SKIP  未提供 ADMIN_PWD 环境变量，跳过需要登录的后续检查');
      console.log('       用法：ADMIN_PWD="你的密码" node _admin.cjs');
      ws.close();
      process.exit(0);
    }
    await js(`document.querySelector('#adminPwd').value='definitely-wrong';
              document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
    await sleep(4500);
    const wrong = await js(`return { msg: document.querySelector('#adminLoginMsg').textContent,
                                     panel: document.querySelector('#adminPanel').hidden };`);
    check(/密码错误/.test(wrong.msg) && wrong.panel, '错误密码被拒绝且未解锁：' + wrong.msg.trim());
    await js(`document.querySelector('#adminPwd').value=${JSON.stringify(PWD)};
              document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
    await sleep(4500);
  } else {
    check(l0.setup && /设置/.test(l0.title), '未烘焙时走「设置密码」流程：' + l0.title);

    await js(`document.querySelector('#adminPwd').value='123'; document.querySelector('#adminPwd2').value='123';
              document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
    await sleep(500);
    const weak = await js(`return document.querySelector('#adminLoginMsg').textContent`);
    check(/至少 6 位/.test(weak), '拒绝过短密码：' + weak.trim());

    await js(`document.querySelector('#adminPwd').value='test1234'; document.querySelector('#adminPwd2').value='test9999';
              document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
    await sleep(500);
    const mismatch = await js(`return document.querySelector('#adminLoginMsg').textContent`);
    check(/不一致/.test(mismatch), '拒绝两次不一致：' + mismatch.trim());

    await js(`document.querySelector('#adminPwd').value=${JSON.stringify(PWD)}; document.querySelector('#adminPwd2').value=${JSON.stringify(PWD)};
              document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
    await sleep(2500);
  }

  const unlocked = await js(`return { panel: !document.querySelector('#adminPanel').hidden,
                                      rail: document.querySelectorAll('#adminRail .admin-tab').length,
                                      badge: document.querySelector('#adminDirty').textContent,
                                      paneHas: document.querySelector('#adminPane').innerHTML.length > 200 };`);
  check(unlocked.panel, '进入面板成功');
  check(unlocked.rail === 12 && unlocked.paneHas, '左侧 ' + unlocked.rail + ' 个分页，内容已渲染');
  check(/未修改/.test(unlocked.badge), '初始状态徽章为「未修改」');

  // 站点固定密码时，页面内不允许修改或清除密码
  if (BAKED) {
    await js(`document.querySelector('[data-tab="security"]').click(); return 1;`);
    await sleep(500);
    const sec = await js(`
      return { changeBtn: !!document.querySelector('#admChangePwd'),
               forgetBtn: !!document.querySelector('#admForgetPwd'),
               fixedText: /页面内无法修改|由站点固定/.test(document.querySelector('#adminPane').innerText),
               pwdInput: !!document.querySelector('#admNewPwd') };
    `);
    check(!sec.changeBtn && !sec.pwdInput, '安全页不再提供「修改密码」入口');
    check(!sec.forgetBtn, '安全页不再提供「清除密码」入口');
    check(sec.fixedText, '明确告知密码已由站点固定、页面内不可改');

    // 光隐藏按钮不够：直接把处理器喊一遍，也必须被拒绝
    const guard = await js(`
      const before = localStorage.getItem('resume.admin.v1');
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const fake = document.createElement('button'); fake.id = 'admChangePwd';
      document.body.appendChild(fake); fake.click();
      await new Promise(r => setTimeout(r, 300));
      return { stored: localStorage.getItem('resume.admin.v1'), before: before, toast: (document.querySelector('#toasts')||{}).innerText || '' };
    `);
    check(guard.stored === guard.before && /不可修改/.test(guard.toast),
      '即使手工触发修改处理器也被拒绝：' + guard.toast.trim().slice(0, 30));

    // 本地存的密码不能盖掉站点固定的那份
    const override = await js(`
      localStorage.setItem('resume.admin.v1', JSON.stringify({ salt: 'x', hash: 'y', iter: 1 }));
      return 1;
    `);
    await reload('file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/'));
    await js(`document.querySelector('#adminEntry').click(); return 1;`);
    await sleep(600);
    await js(`document.querySelector('#adminPwd').value=${JSON.stringify(PWD)};
              document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
    await sleep(4500);
    const stillWorks = await js(`return !document.querySelector('#adminPanel').hidden`);
    check(stillWorks, '本地伪造的凭据无法覆盖站点固定的密码（固定密码优先级更高）');
    await js(`localStorage.removeItem('resume.admin.v1'); return 1;`);
    await reload('file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/'));
    await js(`document.querySelector('#adminEntry').click(); return 1;`);
    await sleep(600);
    await js(`document.querySelector('#adminPwd').value=${JSON.stringify(PWD)};
              document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
    await sleep(4500);
  }

  console.log('\n=== 3. 凭据存储方式 ===');
  // 烘焙模式下凭据在 index.html 里，localStorage 是空的——要分别检查
  const stored = await js(`
    const raw = localStorage.getItem('resume.admin.v1');
    const rec = raw ? JSON.parse(raw) : null;
    const sd = JSON.parse((document.querySelector('#siteData').textContent || '{}').trim() || '{}');
    const pick = rec || sd.admin || {};
    return { from: rec ? 'localStorage' : (sd.admin ? 'index.html 烘焙' : '无'),
             hasSalt: !!pick.salt, hasHash: !!pick.hash, iter: pick.iter || 0,
             algo: pick.algo || '(未记录)',
             saltLen: pick.salt ? pick.salt.length : 0,
             hashLen: pick.hash ? pick.hash.length : 0,
             leaksPwd: raw ? raw.indexOf(${JSON.stringify(PWD)}) !== -1 : false };
  `);
  check(!stored.leaksPwd, '密码以哈希形式存储，不落明文（来源：' + stored.from + '）');
  check(stored.hasSalt && stored.hasHash && stored.iter >= 100000,
    stored.from + '：' + stored.algo + ' · salt ' + stored.saltLen + ' 字符 · hash ' + stored.hashLen +
    ' 字符 · ' + Number(stored.iter).toLocaleString('en-US') + ' 次迭代');
  warn(stored.iter >= 200000, 'PBKDF2 迭代次数 ' + stored.iter + '，建议 ≥ 200000');

  console.log('\n=== 4. 编辑内容并实时预览 ===');
  await js(`const el=document.querySelector('[data-path="meta.nameZh"]');
            el.value='张伟'; el.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  await sleep(900);
  const renamed = await js(`return { hero: document.querySelector('#heroName').textContent,
                                     title: document.title,
                                     badge: document.querySelector('#adminDirty').textContent,
                                     draft: !!localStorage.getItem('resume.profile.draft.v1') };`);
  check(renamed.hero === '张伟', '站点标题与首屏已同步：' + renamed.hero + ' / ' + renamed.title);
  check(/未发布/.test(renamed.badge), '徽章变为「有未发布的改动」');
  check(renamed.draft, '改动已自动存为本地草稿');

  await js(`const el=document.querySelector('[data-path="meta.pitch"]');
            el.value='这是改过的自我定位。'; el.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  await sleep(700);
  const pitch = await js(`return document.querySelector('#heroPitch').textContent.trim()`);
  check(pitch === '这是改过的自我定位。', '长文本双向同步正常');

  console.log('\n=== 5. 列表增删与排序 ===');
  await js(`document.querySelector('[data-tab="exp"]').click(); return 1;`);
  await sleep(400);
  const exp0 = await js(`return { cards: document.querySelectorAll('#timeline .tl').length,
                                  editors: document.querySelectorAll('#adminPane .adm-item').length };`);
  check(exp0.cards === exp0.editors && exp0.cards > 0, '经历列表：站点 ' + exp0.cards + ' 条 / 编辑器 ' + exp0.editors + ' 条');

  await js(`document.querySelector('[data-act="add"][data-list="experience"]').click(); return 1;`);
  await sleep(900);
  const exp1 = await js(`return { cards: document.querySelectorAll('#timeline .tl').length,
                                  role0: (document.querySelector('#timeline .tl__role')||{}).textContent };`);
  check(exp1.cards === exp0.cards + 1, '新增一条经历：' + exp0.cards + ' → ' + exp1.cards);

  await js(`document.querySelector('[data-act="up"][data-list="experience"][data-idx="${exp1.cards - 1}"]').click(); return 1;`);
  await sleep(900);
  const exp2 = await js(`return Array.from(document.querySelectorAll('#timeline .tl__role')).map(e=>e.textContent)`);
  check(exp2.length === exp1.cards && exp2[exp1.cards - 2] === '新职位',
    '上移生效，第 ' + (exp1.cards - 1) + ' 位变成「新职位」：' + JSON.stringify(exp2.slice(0, exp1.cards)));

  await js(`window.confirm = () => true;
            document.querySelector('[data-act="del"][data-list="experience"][data-idx="${exp1.cards - 2}"]').click(); return 1;`);
  await sleep(900);
  const exp3 = await js(`return document.querySelectorAll('#timeline .tl').length`);
  check(exp3 === exp0.cards, '删除生效，恢复为 ' + exp3 + ' 条');

  console.log('\n=== 6. 项目编辑与 AI 知识库联动 ===');
  await js(`document.querySelector('[data-tab="proj"]').click(); return 1;`);
  await sleep(400);

  // 简历里可能还没有项目（该区块会自动隐藏）。先通过面板新增一个——
  // 这样既让后续断言成立，也顺带测了「新增项目」这条路径。
  const projCount0 = await js(`return document.querySelectorAll('#projGrid .proj').length`);
  if (projCount0 === 0) {
    await js(`document.querySelector('[data-act="add"][data-list="projects"]').click(); return 1;`);
    await sleep(1200);
    const projCount1 = await js(`return document.querySelectorAll('#projGrid .proj').length`);
    check(projCount1 === 1, '原本没有项目 → 通过管理面板新增成功，区块自动显示');
  }

  await js(`const el=document.querySelector('[data-path="projects.0.name"]');
            el.value='全新项目名'; el.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  await sleep(900);
  const projName = await js(`return document.querySelector('#projGrid .proj__name').textContent.replace(/\\s+/g,'')`);
  check(/全新项目名/.test(projName), '项目卡标题已更新：' + projName);
  // 记下导出前的经历条数，导出后按它比对（不写死 4）
  const expCountBefore = await js(`return document.querySelectorAll('#timeline .tl').length`);

  const kbHit = await js(`
    const q = document.querySelector('#aiInput'); q.value = '全新项目名是什么';
    document.querySelector('#aiForm').requestSubmit();
    await new Promise(r => setTimeout(r, 2600));
    const msgs = document.querySelectorAll('#aiChat .msg');
    return msgs[msgs.length-1].querySelector('.msg__bubble').textContent;
  `);
  check(/全新项目名/.test(kbHit), 'AI 知识库已重建，能检索到新项目名');

  console.log('\n=== 7. 站点设置 ===');
  await js(`document.querySelector('[data-tab="site"]').click(); return 1;`);
  await sleep(400);
  await js(`const el=document.querySelector('[data-path="cfg.theme"]');
            el.value='light'; el.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  await sleep(700);
  const themeOff = await js(`localStorage.removeItem('resume.theme');
    const el=document.querySelector('[data-path="cfg.aiEnabled"]');
    return { stored: JSON.parse(localStorage.getItem('resume.site.cfg.v1')||'{}').theme };`);
  check(themeOff.stored === 'light', '站点默认主题已保存为 light：' + themeOff.stored);

  await js(`const el=document.querySelector('[data-path="cfg.title"]');
            el.value='张伟的个人主页'; el.dispatchEvent(new Event('input',{bubbles:true})); return 1;`);
  await sleep(700);
  const t = await js(`return document.title`);
  check(t === '张伟的个人主页', '自定义浏览器标题生效：' + t);

  console.log('\n=== 8. 导出 index.html ===');
  const html = await js(`return buildExportHtml();`);
  fs.writeFileSync(EXPORT_PATH, html, 'utf8');
  const size = fs.statSync(EXPORT_PATH).size;
  console.log('        已写出 _exported.html  ' + Math.round(size / 1024) + ' KB');

  check(/张伟/.test(html), '导出文件包含编辑后的姓名');
  check(/全新项目名/.test(html), '导出文件包含新增的项目名');
  check(/张伟的个人主页/.test(html), '导出文件的 <title> 已静态写入（不依赖 JS）');
  check(html.indexOf(PWD) === -1, '导出文件不含明文密码');
  check(/data-theme="light"/.test(html), '导出文件的 html 标签已写入主题，避免首帧闪烁');

  // 结构化数据（schema.org）以前是硬编码的，导出不会更新——搜索引擎会一直索引最初那个人
  const lde = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  check(!!lde, '导出文件里有 schema.org 结构化数据块');
  if (lde) {
    let ld = null;
    try { ld = JSON.parse(lde[1].replace(/\\u003c/g, '<')); } catch (e) { check(false, '结构化数据不是合法 JSON：' + e.message); }
    if (ld) {
      check(ld.name === '张伟', '导出的结构化数据已跟随内容重建：name = ' + ld.name);
      check(/^mailto:/.test(ld.email || ''), '结构化数据邮箱格式正确：' + ld.email);
      check(ld.name !== env.bakedName && !!env.bakedName, '导出前的姓名（' + env.bakedName + '）已被新内容替换');
      check(ld['@type'] === 'Person' && !!ld['@context'], '结构化数据保留了 @context / @type');
      const undef = /:\s*undefined/.test(lde[1]);
      check(!undef, '结构化数据里没有 undefined 字段泄漏');
    }
  }

  const m = html.match(/<script type="application\/json" id="siteData">([\s\S]*?)<\/script>/);
  check(!!m, '找到 siteData 数据块');
  let baked = null;
  try { baked = JSON.parse(m[1].replace(/\\u003c/g, '<')); } catch (e) { check(false, 'siteData JSON 解析失败：' + e.message); }
  if (baked) {
    check(!!baked.profile && baked.profile.meta.nameZh === '张伟', 'siteData.profile 内容正确');
    check(!!baked.admin && !!baked.admin.hash && !!baked.admin.salt, 'siteData.admin 已烘焙管理员凭据');
    check(!!baked.cfg && baked.cfg.theme === 'light', 'siteData.cfg 已烘焙站点设置');
    check(JSON.stringify(baked).indexOf(PWD) === -1, '烘焙数据里没有明文密码');
  }
  // 不能直接数源码里的 "<script" —— 导出逻辑的正则字面量本身也含这个序列。
  // 真正该验证的是「浏览器解析出来的结构对不对」，放到第 9 步加载后检查。
  const bakedTail = html.slice(-400);
  check(/<\/html>\s*$/.test(html.trim()), '导出文件以 </html> 正常结尾，没有被数据截断');
  check(!/\{\s*"generator"/.test(html.slice(html.length - 600)), '页面末尾没有泄露未闭合的 JSON 文本');

  console.log('\n=== 9. 导出的文件能不能真的用（重新加载验证）===');
  await reload('file:///' + EXPORT_PATH.replace(/\\/g, '/'));
  const bakedView = await js(`
    return { hero: document.querySelector('#heroName').textContent,
             title: document.title,
             theme: document.documentElement.dataset.theme,
             proj: document.querySelector('#projGrid .proj__name').textContent.replace(/\\s+/g,''),
             exp: document.querySelectorAll('#timeline .tl').length,
             kb: document.querySelector('#aiSubtitle').textContent,
             scripts: document.querySelectorAll('script').length,
             scriptsWithSrc: document.querySelectorAll('script[src]').length,
             bodyLeak: /"generator"|"exportedAt"|"salt":/.test(document.body.innerText) };
  `);
  check(bakedView.hero === '张伟', '导出的文件直接显示烘焙后的内容：' + bakedView.hero + ' / ' + bakedView.title);
  check(bakedView.theme === 'light', '导出的文件默认主题为 light（管理员设置生效）');
  check(/全新项目名/.test(bakedView.proj), '项目内容已烘焙：' + bakedView.proj);
  check(bakedView.exp === expCountBefore, '经历条数与导出前一致：' + bakedView.exp + ' / ' + expCountBefore);
  check(/已索引 \d+ 条/.test(bakedView.kb), 'AI 知识库在导出的文件里正常构建：' + bakedView.kb);
  check(bakedView.scripts === 3 && bakedView.scriptsWithSrc === 0,
    '浏览器解析出 ' + bakedView.scripts + ' 个 script（JSON-LD + siteData + 主程序），结构完整');
  check(!bakedView.bodyLeak, '烘焙的 JSON 没有泄漏到页面可见文本里');

  console.log('\n=== 10. 导出的文件里登录管理员 ===');
  // sessionStorage 在同一标签页内跨页面导航是保留的，所以第 8 步的登录态会带过来。
  // 这是刻意设计（同一标签页内不必反复输密码），这里先清掉，才能测到真正的登录路径。
  await js(`sessionStorage.clear(); localStorage.removeItem('resume.admin.attempts'); return 1;`);
  await reload('file:///' + EXPORT_PATH.replace(/\\/g, '/'));
  await js(`document.querySelector('#adminEntry').click(); return 1;`);
  await sleep(700);
  const l1 = await js(`return { overlay: document.querySelector('#adminLoginOverlay').classList.contains('is-open'),
                               setup: document.querySelector('#adminPwd2Field').style.display !== 'none',
                               title: document.querySelector('#adminLoginTitle').textContent,
                               panelHidden: document.querySelector('#adminPanel').hidden };`);
  check(l1.overlay && l1.panelHidden, '清掉会话后进入需要密码，面板保持关闭');
  check(!l1.setup && /登录/.test(l1.title), '有烘焙凭据时走「登录」而不是「设置」：' + l1.title);

  await js(`document.querySelector('#adminPwd').value='wrongpwd'; document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
  await sleep(5000);   // PBKDF2 210k 次迭代在无头环境下要 2s 以上
  const bad = await js(`return { msg: document.querySelector('#adminLoginMsg').textContent,
                                panelOpen: !document.querySelector('#adminPanel').hidden,
                                overlayOpen: document.querySelector('#adminLoginOverlay').classList.contains('is-open') };`);
  check(/密码错误/.test(bad.msg) && !bad.panelOpen && bad.overlayOpen,
    '错误密码被拒绝且未解锁（面板 ' + (bad.panelOpen ? '已打开' : '仍关闭') + '）：' + bad.msg.trim());

  await js(`document.querySelector('#adminPwd').value=${PWDJS}; document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
  await sleep(5000);
  const good = await js(`return { panel: !document.querySelector('#adminPanel').hidden };`);
  check(good.panel, '正确密码在导出的文件里也能登录');

  console.log('\n=== 11. 锁定与限速 ===');
  await js(`document.querySelector('#adminLockBtn').click(); return 1;`);
  await sleep(600);
  const locked = await js(`return { hidden: document.querySelector('#adminPanel').hidden,
                                    session: sessionStorage.getItem('resume.admin.session') };`);
  check(locked.hidden && locked.session === null, '「锁定」退出面板并清除会话解锁标记');

  await js(`document.querySelector('#adminEntry').click(); return 1;`);
  await sleep(600);
  const needPwd = await js(`return document.querySelector('#adminLoginOverlay').classList.contains('is-open')`);
  check(needPwd, '锁定后再次进入仍需密码');

  // 连错 5 次 → 第 6 次应被限速拦下
  for (let i = 0; i < 5; i++) {
    await js(`document.querySelector('#adminPwd').value='bad${i}';
              document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
    await sleep(4200);
  }
  const after5 = await js(`return { msg: document.querySelector('#adminLoginMsg').textContent,
                                   attempts: JSON.parse(localStorage.getItem('resume.admin.attempts')||'{}') };`);
  check(after5.attempts.n >= 5 && after5.attempts.until > Date.now(),
    '连续 ' + after5.attempts.n + ' 次失败后记入限速状态');
  console.log('        第 5 次失败的提示：' + after5.msg.trim());

  await js(`document.querySelector('#adminPwd').value=${PWDJS};
            document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
  await sleep(1500);
  const blocked = await js(`return { msg: document.querySelector('#adminLoginMsg').textContent,
                                    panel: document.querySelector('#adminPanel').hidden };`);
  check(/频繁|等待/.test(blocked.msg) && blocked.panel,
    '限速生效：即使密码正确也被拒绝 → ' + blocked.msg.trim());

  console.log('\n=== 12. 会话持久化的真实语义 ===');
  await js(`localStorage.removeItem('resume.admin.attempts'); sessionStorage.clear(); return 1;`);
  await reload('file:///' + EXPORT_PATH.replace(/\\/g, '/'));
  await js(`document.querySelector('#adminEntry').click(); return 1;`);
  await sleep(700);
  await js(`document.querySelector('#adminPwd').value=${PWDJS}; document.querySelector('#adminLoginForm').requestSubmit(); return 1;`);
  await sleep(5000);
  const s1 = await js(`return { panel: !document.querySelector('#adminPanel').hidden,
                                flag: sessionStorage.getItem('resume.admin.session') };`);
  check(s1.panel && s1.flag === '1', '登录成功后写入会话标记');

  await reload('file:///' + EXPORT_PATH.replace(/\\/g, '/'));
  await js(`document.querySelector('#adminEntry').click(); return 1;`);
  await sleep(700);
  const s2 = await js(`return { panel: !document.querySelector('#adminPanel').hidden,
                                overlay: document.querySelector('#adminLoginOverlay').classList.contains('is-open') };`);
  check(s2.panel && !s2.overlay, '同一标签页内刷新后无需重新输密码（sessionStorage 语义）');

  await js(`sessionStorage.clear(); return 1;`);
  await reload('file:///' + EXPORT_PATH.replace(/\\/g, '/'));
  await js(`document.querySelector('#adminEntry').click(); return 1;`);
  await sleep(700);
  const s3 = await js(`return { panel: document.querySelector('#adminPanel').hidden,
                                overlay: document.querySelector('#adminLoginOverlay').classList.contains('is-open') };`);
  check(s3.panel && s3.overlay, '新标签页 / 关掉标签页后必须重新输密码');

  console.log('\n' + (fails === 0 ? '✅ 管理员模式测试全部通过' + (warns ? '（' + warns + ' 条提示）' : '') : '❌ ' + fails + ' 项失败'));
  ws.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('测试运行失败:', e.message); process.exit(1); });
