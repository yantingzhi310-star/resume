/* 抽查本地 AI 回答里有没有编造内容。
 * 这些回答函数曾经写死示例人设的整段叙述，访客问一句「他会什么技能」
 * 就会拿编造的项目细节去回答招聘方——这个脚本专门盯这类回归。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const code = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];

function stub() {
  const s = new Map();
  return new Proxy(function () {}, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return undefined;
      if (k === 'toString') return () => '[stub]';
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      if (k === 'nodeType') return 1;
      if (k === 'tagName') return 'DIV';
      if (!s.has(k)) s.set(k, stub());
      return s.get(k);
    },
    set(_, k, v) { s.set(k, v); return true; },
    apply() { return stub(); },
    has() { return true; }
  });
}
const doc = stub();
doc.readyState = 'complete';
doc.createElement = () => stub();
doc.addEventListener = () => {};
const sd = (html.match(/<script type="application\/json" id="siteData">([\s\S]*?)<\/script>/) || [, '{}'])[1];
doc.getElementById = id => (id === 'siteData' ? { textContent: sd } : stub());

const mkStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const silent = { log() {}, info() {}, warn() {}, error() {} };

const ctx = {
  console: silent, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: cb => setTimeout(() => cb(1), 0), cancelAnimationFrame: clearTimeout,
  performance: { now: () => Date.now() }, document: doc,
  location: { hash: '', href: '' }, navigator: { clipboard: null },
  localStorage: mkStore(), sessionStorage: mkStore(),
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

vm.runInNewContext(code + '\n;globalThis.__T = { localAnswer, PROFILE, KB };', ctx, { filename: 'inline.js' });
const T = ctx.__T;

console.log('当前简历：' + T.PROFILE.meta.nameZh + ' · 经历 ' + T.PROFILE.experience.length +
  ' 段 · 项目 ' + T.PROFILE.projects.length + ' 个 · FAQ ' + T.PROFILE.faq.length + ' 条\n');

/* 允许出现的词 = 真实数据里本来就有的词。任何回答里出现数据中没有的
   具体项目名 / 公司名 / 数字，都算编造。 */
const corpus = JSON.stringify(T.PROFILE) + JSON.stringify(T.KB.map(d => d.text));
const SUSPECT = [
  '企业知识库', '知识库问答平台', '客服工单', '示例科技', '示例网络', '示例信息', '示例软件',
  '权限隔离', 'ACL', '480 条', '黄金问答集', '3.8s', 'P99', '800ms', '1.2 万 QPS',
  '8 人跨职能', 'vLLM', 'Kubernetes', 'PostgreSQL', '组件库', '设计系统', '开源 CLI'
];

const QUESTIONS = [
  '他会什么技能', '他最擅长的技术方向是什么', '工作经历介绍一下', '做过什么项目',
  '有什么代表作', '学历背景', '他适合我们公司吗', '最有成就感的项目是什么',
  '职业规划是什么', '优点和缺点是什么', '期望薪资是多少', '怎么联系他',
  '遇到过最大的技术挑战是什么', '带过团队吗', '英语怎么样'
];

let bad = 0;
console.log('--- 逐题检查 ---');
for (const q of QUESTIONS) {
  let a;
  try { a = T.localAnswer(q); } catch (e) { console.log('  ✗ 「' + q + '」抛异常: ' + e.message); bad++; continue; }
  const txt = a ? a.text : '';
  const hit = SUSPECT.filter(w => txt.includes(w) && !corpus.includes(w));
  if (hit.length) {
    console.log('  ✗ 「' + q + '」含数据里没有的内容: ' + hit.join('、'));
    console.log('      ' + txt.replace(/\s+/g, ' ').slice(0, 110));
    bad++;
  } else {
    console.log('  ✓ 「' + q + '」→ ' + (txt ? txt.replace(/\s+/g, ' ').slice(0, 62) : '(空/null)'));
  }
}

console.log('');
console.log(bad ? '✗ ' + bad + ' 条回答含编造内容' : '✓ 全部回答都能在真实数据里找到出处，无编造');
process.exit(bad ? 1 : 0);
