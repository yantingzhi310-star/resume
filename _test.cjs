/* 冒烟测试：用 DOM 桩在 Node 里跑通整站脚本，并核验 AI 助手的真实回答质量 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const lines = html.split(/\r?\n/);
const s = lines.findIndex(l => l.trim() === '<script>');
let e = -1;
for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim() === '</script>') { e = i; break; } }
if (s < 0 || e < 0) { console.error('FAIL: 找不到内联脚本块'); process.exit(1); }
const code = lines.slice(s + 1, e).join('\n');

/* ── 极简 DOM 桩：任何属性访问都返回可调用的自身 ─────────────────────── */
function makeStub() {
  const store = new Map();
  const t = function () {};
  return new Proxy(t, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return undefined;
      if (k === 'toString') return () => '[stub]';
      if (k === 'valueOf') return () => 0;
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

function mkStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() };
}

const domStub = makeStub();
const documentStub = makeStub();
documentStub.readyState = 'complete';
documentStub.documentElement = makeStub();
documentStub.body = makeStub();
documentStub.createElement = () => makeStub();
documentStub.addEventListener = () => {};

const ctx = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: id => clearTimeout(id),
  performance: { now: () => Date.now() },
  document: documentStub,
  location: { hash: '', href: 'file:///index.html', scrollTo() {} },
  navigator: { clipboard: null },
  localStorage: mkStore(),
  sessionStorage: mkStore(),
  AbortController, TextDecoder, TextEncoder,
  URL, JSON, Math, Date, Set, Map, Array, Object, String, Number, RegExp, Error, Promise, Symbol,
  fetch: () => Promise.reject(new Error('network disabled in test')),
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.window.isSecureContext = false;
ctx.window.matchMedia = () => ({ matches: false, addEventListener() {} });
ctx.window.addEventListener = () => {};
ctx.window.innerWidth = 1440;
ctx.window.scrollY = 0;
ctx.window.scrollTo = () => {};
ctx.window.print = () => {};

/* 导出内部符号以便断言 */
const instrumented = code + '\n;globalThis.__T = { PROFILE, localAnswer, retrieve, tokenize, bestFaq, KB, esc, svg, ICON_PATHS, miniMd, ansFallback, buildKB, detectIntent, rich, linesToText, textToLines, findTerm };';

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) failed++; };

console.log('\n=== 1. 加载与 init() ===');
try {
  vm.runInNewContext(instrumented, ctx, { filename: 'index-inline.js' });
  ok(true, '脚本加载 + init() 执行无异常');
} catch (err) {
  ok(false, 'init() 抛异常: ' + err.message + '\n' + (err.stack || '').split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}

const T = ctx.__T;
const P = T.PROFILE;

console.log('\n=== 2. PROFILE 数据完整性 ===');
ok(!!P && !!P.meta && !!P.projects, 'PROFILE 结构存在');
// 数量不写死：内容是你自己的，测试只保证「结构成立、非空、互相一致」
ok(Array.isArray(P.projects) && P.projects.length > 0, '项目数 = ' + P.projects.length);
ok(Array.isArray(P.experience) && P.experience.length > 0, '经历数 = ' + P.experience.length);
ok(P.skills && P.skills.groups.length > 0, '技能组 = ' + P.skills.groups.length);

const iconNames = new Set(Object.keys(T.ICON_PATHS));
const usedIcons = [];
P.about.traits.forEach(t => usedIcons.push(['trait', t.icon]));
P.projects.forEach(p => usedIcons.push(['project:' + p.id, p.icon]));
P.skills.groups.forEach(g => usedIcons.push(['skill:' + g.name, g.icon]));
P.education.forEach(x => usedIcons.push(['edu:' + x.title, x.icon]));
P.contact.forEach(c => usedIcons.push(['contact:' + c.key, c.icon]));
const badIcons = usedIcons.filter(([, n]) => !iconNames.has(n));
ok(badIcons.length === 0, '所有图标名有效' + (badIcons.length ? ' → 缺失: ' + JSON.stringify(badIcons) : ''));

const badAnchor = P.contact.filter(c => c.action === 'link' && !c.href);
ok(badAnchor.length === 0, '所有 link 类型联系方式都有 href');

ok(P.faq.length >= 8, 'FAQ 条目数 = ' + P.faq.length);
ok(P.faq.every(f => f.q && f.a && f.a.length > 20), '每条 FAQ 都有问答内容');
ok(P.experience.every(x => x.points.length > 0 && x.period && x.role), '每段经历都有职位/时间/要点');
ok(P.projects.every(x => x.highlights && x.highlights.length && x.metrics && x.metrics.length), '每个项目都有 highlights + metrics');

console.log('\n=== 3. 知识库与分词 ===');
ok(T.KB.length > 0, '知识库条数 = ' + T.KB.length);
const toks = T.tokenize('他 RAG 做到什么程度？');
ok(toks.includes('rag'), '分词能识别英文技术词 rag');
ok(toks.includes('程度') && toks.includes('什么'), '分词能切出中文 bigram');
ok(toks.some(t => t.length === 3), '分词包含中文 3-gram');

const hits = T.retrieve('RAG 检索增强做到什么程度', 5);
ok(hits.length > 0 && hits[0].score > 0, '检索有结果，最高分 = ' + (hits[0] ? hits[0].score.toFixed(2) : 'n/a'));
ok(hits[0] && /知识库|RAG|技能/i.test(hits[0].doc.title + hits[0].doc.text.slice(0, 60)), 'Top1 命中 RAG 相关内容');

console.log('\n=== 4. AI 助手端到端问答（人工核验）===');
const QUESTIONS = [
  '你好',
  '他最擅长的技术方向是什么？',
  '做过什么项目？',
  '工作经历介绍一下',
  'Kubernetes 用过吗？到什么程度',
  '带过团队吗？管理规模多大？',
  '期望薪资和到岗时间？',
  '为什么想换工作？',
  '英语怎么样？',
  '学历是哪个学校？',
  '怎么联系他？',
  '你觉得他适合我们公司吗？',
  '他结婚了吗？',
];
for (const q of QUESTIONS) {
  const a = T.localAnswer(q);
  if (!a) { ok(false, '「' + q + '」返回 null'); continue; }
  const plain = a.text.replace(/<[^>]+>/g, '');
  const good = plain.length >= 12 && !/undefined|NaN|\[object/.test(plain);
  ok(good, '「' + q + '」→ ' + plain.split('\n')[0].slice(0, 46) +
    '  [' + plain.length + ' 字, ' + a.cites.length + ' 来源]');
  console.log('     ' + plain.split('\n').filter(Boolean).slice(1, 3).join(' / ').slice(0, 150));
}

console.log('\n=== 5. 渲染输出无 undefined / 转义正确 ===');
ok(T.esc('<script>x</script>') === '&lt;script&gt;x&lt;/script&gt;', 'esc() 正确转义尖括号');
ok(/<strong>/.test(T.miniMd('**加粗**')), 'miniMd 支持 ** 粗体');
ok(/<ul>/.test(T.miniMd('- a\n- b')), 'miniMd 支持列表');
ok(/<code>/.test(T.miniMd('`x`')), 'miniMd 支持行内代码');
const rendered = [T.svg('rocket'), T.miniMd(P.about.traits[0].desc)].join('');
ok(!/undefined/.test(rendered), '渲染片段不含 undefined');

console.log('\n=== 6. 风险输入不崩溃 ===');
for (const bad of ['', '   ', '???', 'a'.repeat(2000), '<img src=x onerror=alert(1)>', '🙂🙂🙂', '1+1=?']) {
  try {
    const r = T.localAnswer(bad);
    const blank = bad.trim() === '';
    // 空白输入按约定返回 null（上层 ask() 已拦截）；其余必须返回可用回答
    ok(blank ? r === null : (r && typeof r.text === 'string'),
      '输入 ' + JSON.stringify(bad.slice(0, 22)) + ' ' + (blank ? '按约定返回 null' : '安全返回'));
  } catch (err) {
    ok(false, '输入 ' + JSON.stringify(bad.slice(0, 22)) + ' 抛异常: ' + err.message);
  }
}

console.log('\n=== 8. 引用的「原文」必须是通顺句子（不能漏出源码/标记）===');
const BAD_SNIPPET = /const\s|@author|@file|\*\/|\/\*\*|&lt;|&amp;|\{[^}]*"|\.map\(|=>/;
for (const q of ['他 RAG 到底做到什么程度？', 'Kubernetes 到什么程度', 'TypeScript 用了几年', '教育背景', '怎么联系', 'Docker 会用吗']) {
  const a = T.localAnswer(q);
  const txt = a ? a.text : '';
  ok(!BAD_SNIPPET.test(txt), '「' + q + '」引用干净' + (BAD_SNIPPET.test(txt) ? ' → ' + txt.match(BAD_SNIPPET)[0] : ''));
}
const ragAns = T.localAnswer('他 RAG 到底做到什么程度？');
console.log('\n--- RAG 问题的完整回答 ---');
console.log(ragAns.text);

const CASES = [
  ['他结婚了吗？', /没有写|超出|直接问本人/],
  ['Kubernetes 到什么程度', /Kubernetes|工程化|Docker/],
  ['RAG 做到什么程度', /RAG|检索|重排序|命中率/],
  ['带过团队吗', /8 人|跨职能|带过/],
  ['期望薪资', /万|薪资|涨幅/],
  ['他适合我们公司吗', /判断依据|匹配度|上手/],
];
for (const [q, re] of CASES) {
  const a = T.localAnswer(q);
  const plain = (a ? a.text : '').replace(/<[^>]+>/g, '');
  ok(!!a && re.test(plain), '「' + q + '」命中预期 → ' + plain.split('\n')[0].slice(0, 50));
}

console.log('\n=== 9. 「关于我」区块 ===');
const A = P.about;
ok(Array.isArray(A.intro) && A.intro.length >= 2, '叙事段落 ' + (A.intro ? A.intro.length : 0) + ' 段');
ok(A.intro.every(s => typeof s === 'string' && s.length > 20), '每段都有实质内容');
ok(A.intro.every(s => !/<(?!\/?(b|strong)\b)[^>]*>/.test(s)), '叙事段落只用了允许的加粗标签');
ok(A.lines.length >= 6, '速查卡 ' + A.lines.length + ' 行');
ok(A.lines.every(l => l.t && l.s), '每行都有类型和内容');
ok(A.traits.length >= 3, '特质卡 ' + A.traits.length + ' 张');

console.log('\n=== 10. 关于我的数据要和全站其他板块自洽 ===');
// 这一节校验的是「示例人设内部有没有自相矛盾」。
// 换成你自己的真实简历后这些具体数字不存在了，自动跳过——不会误报。
const IS_DEMO = P.meta.nameZh === '陈屿';
if (!IS_DEMO) {
  console.log('  SKIP  当前不是示例人设（nameZh = ' + P.meta.nameZh + '），跳过示例数字的交叉校验');
} else {
  const siteText = JSON.stringify(P);
  const aboutText = A.intro.join(' ') + JSON.stringify(A.traits) + JSON.stringify(A.lines);
  for (const [claim, re] of [
    ['团队规模 8 人', /8 人(的)?跨职能小组/],
    ['首屏 3.8s→1.1s', /3\.8s[^"]{0,14}1\.1s/],
    ['后端 P99 800ms→90ms', /800ms[^"]{0,14}90ms/],
    ['知识库采纳率 82%', /82%/]
  ]) {
    ok(re.test(siteText), '「' + claim + '」在全站有出处' + (re.test(aboutText) ? '，关于我也提到了' : ''));
  }
}

console.log('\n=== 11. 速查卡的结构化往返（管理员编辑器依赖它）===');
const roundTrip = T.textToLines(T.linesToText(A.lines));
ok(roundTrip.length === A.lines.length, '往返后行数一致：' + A.lines.length + ' → ' + roundTrip.length);
const typeDiffs = A.lines.map((l, i) => (roundTrip[i] || {}).t === l.t ? null : l.t + '→' + (roundTrip[i] || {}).t).filter(Boolean);
ok(typeDiffs.length === 0, '每行类型（注释 / 键值 / 关键字）都保持原样' + (typeDiffs.length ? ' → 差异: ' + JSON.stringify(typeDiffs) : ''));
ok(roundTrip[roundTrip.length - 1].t === 'k', '结尾的 "};" 仍是关键字行，没被降级成注释（曾经的真实回归点）');
const pairs = A.lines.filter(l => l.t === 'p');
ok(pairs.every(l => { const r = roundTrip.find(x => x.s === l.s); return r && r.v === l.v; }),
  pairs.length + ' 组键值对的键和值都无损还原');

console.log('\n=== 12. 叙事段落的转义与加粗 ===');
const introHtml = A.intro.map(s => T.rich(s)).join('');
ok(/<strong>/.test(introHtml), '叙事段落里的 <strong> 生效');
ok(!/<script|onerror=/i.test(introHtml), '叙事段落不会引入脚本');
ok(T.esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', '危险字符被正确转义');

console.log('\n=== 13. 技术词识别：短英文别名不能被当成子串命中 ===');
const TERM_CASES = [
  ['Kubernets 用过吗', 'Kubernetes', '拼错一个字母也能纠对（不能错答成 TypeScript）'],
  ['Kuberneteees 用过吗', 'Kubernetes', '距离 2 以内仍然纠（容错边界之内）'],
  ['Kubeflow 用过吗', null, '是另一个技术、距离太远，不硬纠'],
  ['kubernetes 用过吗', 'Kubernetes', '正确拼写要能命中'],
  ['ts 熟吗', 'TypeScript', '独立的 ts 应该命中 TypeScript'],
  ['google analytics 用过吗', null, 'google 不该命中技能 Go'],
  ['Go 写过吗', 'Go', '独立的 Go 要能命中'],
  ['pg 调优做过吗', 'PostgreSQL', 'pg 应该映射到 PostgreSQL'],
  ['向量数据库用过吗', 'pgvector', '中文别名要能命中'],
  ['他做过什么项目', null, '没有技术词时不该乱匹配']
];
for (const [q, expect, why] of TERM_CASES) {
  const got = T.findTerm(q);
  const okCase = expect === null ? got === null : (got && got.toLowerCase() === expect.toLowerCase());
  ok(okCase, '「' + q + '」→ ' + (got === null ? 'null' : got) + '（' + why + '）');
}

console.log('\n=== 14. 并列提问要分别作答，不能只答一半 ===');
const MULTI = [
  ['他做过什么项目，期望薪资多少？', 2, '项目 + 薪资'],
  ['他有什么技能？带过团队吗？', 2, '技能 + 团队'],
  ['你好', 1, '单纯寒暄不该被拆成多段'],
  ['他做过什么项目？', 1, '单个问题保持单段回答']
];
for (const [q, minParts, why] of MULTI) {
  const a = T.localAnswer(q);
  const txt = a ? a.text : '';
  // 多段回答会带「你问了几件事」，用编号 1. 2. 标记
  const parts = (txt.match(/\*\*\d+\.\*\*/g) || []).length;
  if (minParts === 1) {
    ok(parts === 0, '「' + q + '」保持单段（' + why + '）');
  } else {
    ok(parts >= 2, '「' + q + '」拆成 ' + parts + ' 段作答（' + why + '）');
  }
}
const multi = T.localAnswer('他做过什么项目，期望薪资多少？');
console.log('\n--- 并列提问的完整回答 ---');
console.log(multi.text.split('\n').slice(0, 6).join('\n'));
ok(/项目|代表作/.test(multi.text) && /万|薪/.test(multi.text), '两部分内容都在回答里，没有被丢掉');

console.log('\n' + (failed === 0 ? '✅ 全部通过（0 失败）' : '❌ ' + failed + ' 项失败'));
process.exit(failed === 0 ? 0 : 1);
