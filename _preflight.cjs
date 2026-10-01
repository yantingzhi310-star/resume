/* 发布前自检 —— 推上公网之前跑一次
 *
 * 为什么需要它：这个站点是纯静态文件，「发布」这个动作没有编译期检查，
 * 也没有任何东西会拦你。最容易犯、也最尴尬的错是——把还没替换的示例人设
 * （陈屿 / hi@example.com）直接发到公网，让招聘方看到一份假人的简历。
 *
 *   node _preflight.cjs
 *
 * 退出码 0 = 可以发布；1 = 有阻塞项。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const HTML = path.join(ROOT, 'index.html');

let blockers = 0, warnings = 0, passed = 0;
const ok   = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); passed++; };
const warn = m => { console.log('  \x1b[33m!\x1b[0m ' + m); warnings++; };
const bad  = m => { console.log('  \x1b[31m✗\x1b[0m ' + m); blockers++; };
const head = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

/* ── 用和 _test.cjs 相同的方式，在 Node 里把站点跑起来读出真实数据 ────── */
function loadProfile() {
  const html = fs.readFileSync(HTML, 'utf8');
  const lines = html.split(/\r?\n/);
  const s = lines.findIndex(l => l.trim() === '<script>');
  let e = -1;
  for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim() === '</script>') { e = i; break; } }
  const code = lines.slice(s + 1, e).join('\n');

  function makeStub() {
    const store = new Map();
    return new Proxy(function () {}, {
      get(_, k) {
        if (k === Symbol.toPrimitive) return () => '';
        if (k === Symbol.iterator) return undefined;
        if (k === 'toString') return () => '[stub]';
        if (k === 'then') return undefined;
        if (k === 'length') return 0;
        if (k === 'nodeType') return 1;
        if (k === 'tagName') return 'DIV';
        if (!store.has(k)) store.set(k, makeStub());
        return store.get(k);
      },
      set(_, k, v) { store.set(k, v); return true; },
      apply() { return makeStub(); },
      has() { return true; }
    });
  }
  const mkStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const doc = makeStub();
  doc.readyState = 'complete';
  doc.createElement = () => makeStub();
  doc.addEventListener = () => {};

  // 屏蔽站点脚本自己的 console 输出，否则自检结果会被渲染日志淹没
  const silent = { log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {} };

  const ctx = {
    console: silent, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: cb => setTimeout(() => cb(1), 0), cancelAnimationFrame: clearTimeout,
    performance: { now: () => Date.now() }, document: doc,
    location: { hash: '', href: '' },
    navigator: { clipboard: null }, localStorage: mkStore(), sessionStorage: mkStore(),
    AbortController, TextDecoder, TextEncoder, URL, JSON, Math, Date, Set, Map,
    Array, Object, String, Number, RegExp, Error, Promise, Symbol,
    fetch: () => Promise.reject(new Error('offline'))
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.window.isSecureContext = false;
  ctx.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  ctx.window.addEventListener = () => {};
  ctx.window.innerWidth = 1440; ctx.window.scrollY = 0;
  ctx.window.scrollTo = () => {}; ctx.window.print = () => {};

  vm.runInNewContext(code + '\n;globalThis.__X = { PROFILE, DEFAULT_PROFILE, SITE, KB };', ctx, { filename: 'inline.js' });
  return { P: ctx.__X.PROFILE, SITE: ctx.__X.SITE, KB: ctx.__X.KB, html };
}

console.log('\x1b[1m═══ 发布前自检 ═══\x1b[0m');

/* ── 1. 必需文件 ─────────────────────────────────────────────────────── */
head('1. 部署文件');
if (!fs.existsSync(HTML)) { bad('index.html 不存在'); process.exit(1); }
ok('index.html  ' + Math.round(fs.statSync(HTML).size / 1024) + ' KB');

const OG = path.join(ROOT, 'og-image.png');
let ogSize = null;
if (!fs.existsSync(OG)) {
  bad('缺少 og-image.png —— 分享到微信 / LinkedIn 会显示成纯文字卡片，没有配图');
} else {
  const b = fs.readFileSync(OG);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  ogSize = b.length;
  if (w !== 1200 || h !== 630) bad('og-image.png 尺寸是 ' + w + '×' + h + '，应为 1200×630');
  else ok('og-image.png  1200×630  ' + Math.round(b.length / 1024) + ' KB');
  if (b.length > 1024 * 1024) warn('og-image.png 超过 1MB，部分平台会拒收或压缩');
}

/* ── 2. 内容是不是还是示例人设 ───────────────────────────────────────── */
head('2. 内容是否已替换（最关键的一项）');
let X;
try { X = loadProfile(); }
catch (err) { bad('读取站点数据失败：' + err.message); process.exit(1); }

const P = X.P;
const text = X.html;
const placeholders = [];

if (P.meta.nameZh === '陈屿') placeholders.push('姓名仍是示例人设「陈屿」');
if (/example\.com/i.test(text)) placeholders.push('仍含 example.com 占位邮箱 / 网址：' +
  (text.match(/[\w.+-]*@example\.com|https?:\/\/example\.com[^\s"']*/i) || [''])[0]);
if (P.experience.some(e => /^示例/.test(e.company || ''))) placeholders.push('公司名仍是「示例…」（' +
  P.experience.filter(e => /^示例/.test(e.company || '')).map(e => e.company).join('、') + '）');
if (/示例大学|示例科技/.test(JSON.stringify(P.education || []))) placeholders.push('教育经历仍是「示例大学」');
if (P.projects.some(p => /新项目|全新项目名/.test(p.name || ''))) placeholders.push('存在未改名的测试项目');

if (placeholders.length) {
  placeholders.forEach(p => bad(p));
  console.log('\n    \x1b[31m→ 这是阻塞项。现在发布，访问者看到的是一份虚构的简历。\x1b[0m');
  console.log('      改法：打开 index.html → 进管理员模式（Ctrl+Shift+A）→ 逐项填写 → 导出，');
  console.log('      或者直接改文件里的 DEFAULT_PROFILE。');
} else {
  ok('姓名：' + P.meta.nameZh);
  ok('邮箱：' + P.meta.email);
  ok('公司：' + P.experience.map(e => e.company).join(' / '));
}

/* ── 3. 分享卡片的 URL 与新鲜度 ──────────────────────────────────────── */
head('3. 社交分享卡片');
const ogUrl = (text.match(/<meta property="og:image" content="([^"]*)"/) || [, ''])[1];
const ogSite = (text.match(/<meta property="og:url" content="([^"]*)"/) || [, ''])[1];
if (/example\.com/i.test(ogUrl) || /example\.com/i.test(ogSite)) {
  warn('og:url / og:image 还是 example.com 占位地址');
  console.log('      → 上线后在管理员面板「站点设置 → 站点地址」填上真实域名，再导出一次。');
  console.log('        分享卡片要求绝对 URL，不填的话微信和 LinkedIn 抓不到图。');
} else {
  ok('og:url  = ' + ogSite);
  ok('og:image = ' + ogUrl);
}
if (ogSize !== null) {
  const dt = fs.statSync(HTML).mtimeMs - fs.statSync(OG).mtimeMs;
  if (dt > 60000) {
    warn('index.html 比 og-image.png 新，分享卡片可能还是旧名字');
    console.log('      → 跑一次 `node _og-image.cjs` 重新生成。');
  } else {
    ok('分享卡片比 index.html 新，内容同步');
  }
}

/* ── 3b. 结构化数据（SEO）────────────────────────────────────────────── */
head('3b. 结构化数据 schema.org');
const ldm = text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!ldm) {
  bad('找不到 schema.org 结构化数据块');
} else {
  try {
    const ld = JSON.parse(ldm[1].replace(/\\u003c/g, '<'));
    if (ld.name !== P.meta.nameZh) {
      bad('结构化数据里的姓名是「' + ld.name + '」，站点内容是「' + P.meta.nameZh + '」——搜索引擎会索引到错误的人');
      console.log('      → 在管理员面板导出一次 index.html，导出会自动重建这段数据。');
    } else {
      ok('姓名一致：' + ld.name);
    }
    const ldEmail = String(ld.email || '').replace(/^mailto:/, '');
    if (ldEmail && P.meta.email && ldEmail !== P.meta.email) {
      warn('结构化数据邮箱「' + ldEmail + '」与站点内容「' + P.meta.email + '」不一致');
    }
    if (/example\.com/i.test(JSON.stringify(ld))) warn('结构化数据里仍有 example.com 占位地址');
    if (/示例/.test(JSON.stringify(ld))) warn('结构化数据里仍有「示例…」占位名称（比如学校名）');
  } catch (e) {
    bad('结构化数据不是合法 JSON：' + e.message);
  }
}

/* ── 4. API Key 安全 ─────────────────────────────────────────────────── */
head('4. API Key 是否会公开');
const baked = X.SITE && X.SITE.ai;
if (baked && baked.key) {
  bad('页面里烘焙了一个 API Key：' + String(baked.key).slice(0, 6) + '…' + String(baked.key).slice(-4));
  console.log('      → 纯静态页面上任何人都能「查看源代码」拿到它，并拿去刷你的额度。');
  console.log('        建议清掉，让访客走本地检索模式；要给所有人用就自建后端代理。');
} else {
  ok('页面里没有烘焙 API Key（AI 助手走本地检索模式，或由访客自己填）');
}
if (X.SITE && X.SITE.admin && X.SITE.admin.hash) {
  warn('管理员密码哈希已烘焙进页面');
  console.log('      → 哈希本身不泄露密码，但它公开可离线爆破。请确保管理员密码足够长、不复用。');
} else {
  ok('没有烘焙管理员凭据（首次访问时自行设置）');
}

/* ── 5. 发布产物体积 ─────────────────────────────────────────────────── */
head('5. 体积');
try {
  const gz = execFileSync(process.execPath, ['-e',
    'const z=require("zlib"),f=require("fs");process.stdout.write(String(z.gzipSync(f.readFileSync(process.argv[1]),{level:9}).length))',
    HTML]).toString();
  const kb = Math.round(Number(gz) / 1024);
  ok('index.html gzip 后 ' + kb + ' KB' + (kb > 200 ? '（偏大）' : '（正常）'));
  if (kb > 200) warn('gzip 超过 200KB，首屏会慢，考虑精简 PROFILE 或拆出测试脚本');
} catch (_) { warn('体积检测跳过'); }

/* ── 6. AI 助手的知识库 ──────────────────────────────────────────────── */
head('6. AI 助手');
if (X.KB && X.KB.length > 0) ok('知识库已建立：' + X.KB.length + ' 条片段');
else bad('知识库是空的，AI 助手将无法回答任何问题');
const faq = (P.faq || []).length;
if (faq >= 8) ok('常见问答 ' + faq + ' 条');
else warn('常见问答只有 ' + faq + ' 条 —— 这是对 AI 回答质量影响最大的字段，建议至少 8 条（期望薪资、到岗时间、离职原因、管理经验…）');

/* ── 收尾 ────────────────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(52));
if (blockers === 0) {
  console.log('\x1b[32m\x1b[1m可以发布\x1b[0m  ' + passed + ' 项通过' + (warnings ? '，' + warnings + ' 条提醒' : ''));
  console.log('下一步见 DEPLOY.md');
  process.exit(0);
} else {
  console.log('\x1b[31m\x1b[1m先别发布\x1b[0m  ' + blockers + ' 项阻塞' + (warnings ? '，' + warnings + ' 条提醒' : ''));
  process.exit(1);
}
