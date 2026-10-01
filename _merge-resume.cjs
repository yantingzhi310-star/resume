/* 把导出的简历数据整理成可发布版本。
 *
 * 输入：resume-data.json（管理员面板导出）
 * 输出：resume-final.json（整理后的干净数据）
 *      加 --bake 参数时，同时写进 index.html 的 siteData 数据块
 *
 * 这份脚本存在的原因：导出的数据里混着三类内容——
 *   ① 你自己的真实信息        → 保留
 *   ② 我当初写的示例人设残留  → 必须清掉（它们读起来像真的，最危险）
 *   ③ 我的面板 bug 写坏的结构 → 修复
 * 每一步改动都打日志，方便逐条核对。
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'D:\\搬运视频\\resume-data.json';
const OUT = path.join(__dirname, 'resume-final.json');
const DO_BAKE = process.argv.includes('--bake');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const P = raw.profile;
const beforeFaq = (P.faq || []).length;
const log = [];

/* ────────────────────────────────────────────────────────────────────────
   ① 结构修复
   ──────────────────────────────────────────────────────────────────────── */

// 面板 bug 把 about.lines 写成了 12 行 "[object Object]"，原始内容已不可恢复。
// 这里按你的真实信息重写（你之前明确让我把「关于我」填好）。
const OLD_LINES_BROKEN = (P.about.lines || []).every(l => l.s === '[object Object]');
P.about.lines = [
  { t: 'c', s: '/**' },
  { t: 'c', s: ' * @file   关于我 · 数字媒体技术 × AI 应用' },
  { t: 'c', s: ' * @author 杨旭阳 <y18234592566@qq.com>' },
  { t: 'c', s: ' * @since  2025' },
  { t: 'c', s: ' */' },
  { t: 'k', s: 'const 杨旭阳 = {' },
  { t: 'p', s: '  定位', v: '"用 AI 工具把想法做成能跑起来的东西"' },
  { t: 'p', s: '  现居', v: '"山西 · 接受线上线下"' },
  { t: 'p', s: '  专业', v: '"数字媒体技术 · 朔州陶瓷职业技术学院"' },
  { t: 'p', s: '  在校', v: '"AI 部负责人（30 人）· 新媒体摄像部部长（10 人）"' },
  { t: 'p', s: '  擅长', v: '["AI 可视化", "RAG 本地知识库", "定制 Agent", "模型本地部署", "拍摄剪辑"]' },
  { t: 'p', s: '  做过', v: '"从 0 到 1 运营 TK 账号 · 带 30 位同学从认识 AI 到独立做出 Agent"' },
  { t: 'p', s: '  信条', v: '"先做出最小可用的东西，再回头补原理。"' },
  { t: 'p', s: '  在找', v: '"能把 AI 真正用进业务的团队"' },
  { t: 'k', s: '};' }
];
log.push(OLD_LINES_BROKEN
  ? '修复 about.lines：原内容被面板 bug 写坏成 [object Object]，已按真实信息重写 15 行'
  : 'about.lines 结构正常，保留原内容');

// 面板的 CSV 解析不认换行，导致技能标签云被塞成「一个含换行的大字符串」
const cloud = P.skills.cloud || [];
if (cloud.length === 1 && /\n/.test(cloud[0])) {
  P.skills.cloud = cloud[0].split(/\n+/).map(s => s.trim()).filter(Boolean);
  log.push('修复 skills.cloud：1 个含换行的字符串 → ' + P.skills.cloud.length + ' 个标签 [' +
    P.skills.cloud.join(' / ') + ']');
} else {
  log.push('skills.cloud 结构正常（' + cloud.length + ' 个标签）');
}

/* ────────────────────────────────────────────────────────────────────────
   ② 字段修正
   ──────────────────────────────────────────────────────────────────────── */

// meta.email 填成了一个不带 @ 的微信号片段。真实邮箱在联系方式列表里。
if (P.meta.email && !/@/.test(P.meta.email)) {
  const mailItem = (P.contact || []).find(c => /@/.test(c.value || ''));
  const fixed = mailItem ? mailItem.value : P.meta.email;
  log.push('修正 meta.email：' + P.meta.email + ' → ' + fixed + '（原值不是合法邮箱）');
  P.meta.email = fixed;
}

// github 还指着占位地址。注意占位形式是 github.com/example（路径里的 example），
// 不是 example.com——只匹配域名会漏掉它。
const GH_PLACEHOLDER = /example\.com|github\.com\/example(\/|$|\?)/i;
if (GH_PLACEHOLDER.test(P.meta.github || '')) {
  log.push('修正 meta.github：原值 ' + P.meta.github + ' 是占位地址 → https://github.com/yantingzhi310-star');
  P.meta.github = 'https://github.com/yantingzhi310-star';
}

/* ────────────────────────────────────────────────────────────────────────
   ③ 清除示例人设残留（这批最危险：读起来像真事）
   ──────────────────────────────────────────────────────────────────────── */

P.about.intro = [
  '我是杨旭阳，数字媒体技术专业在读。在校内带两个部门——AI 部（30 人）和摄像部（10 人），一边教同学怎么用 AI 做出自己的东西，一边负责校级活动的拍摄和剪辑。',
  '我的路线比较特别：<strong>不是先学理论再动手，而是先做出东西再补原理。</strong>从 0 到 1 跑过 TK 账号的完整链路（策划、选题、创作、剪辑、发布），也在 AI 部带着同学从「认识 AI」一路走到能独立做出自己的 Agent。',
  '现在想找一个能把 AI 真正用进业务的团队，实习或全职都可以。'
];
log.push('补写 about.intro：3 段叙事（原数据里是空的）');

// 特质卡原来是示例人设的（40% 无效排期 / 3.8s→1.1s / P99 800ms→90ms / 60+ 篇文档），
// 那些数字和你毫无关系，全部按你的真实经历重写。
const OLD_TRAIT_TITLES = (P.about.traits || []).map(t => t.title).join('、');
P.about.traits = [
  { icon: 'sparkles', title: 'AI 落地能力', 
    desc: '在 AI 部带着 30 位同学，从「认识 AI」讲到每个人能独立做出自己的 Agent。自己也做过本地知识库、模型本地部署、AI 生图生视频。' },
  { icon: 'zap', title: '内容全流程独立完成',
    desc: 'TK 账号从策划、选题、创作、剪辑到发布一个人跑完。能对标热点做爆款复刻，也能独立完成有难度的剪辑。' },
  { icon: 'layers', title: '同时带两个部门',
    desc: 'AI 部（30 人）+ 新媒体摄像部（10 人），负责部门日常运转、任务分配，以及校级活动的拍摄与剪辑。' },
  { icon: 'target', title: '实战优先的学习方式',
    desc: '习惯先做出最小可用的东西，再回头补原理。学新工具的方式，是直接拿它做一个真项目出来。' }
];
log.push('重写 about.traits：原来是示例人设的「' + OLD_TRAIT_TITLES + '」，全部换成你的真实经历');

/* ────────────────────────────────────────────────────────────────────────
   ④ 工作经历：排序 + 时间格式 + 性质标签
   ──────────────────────────────────────────────────────────────────────── */

// 页面写的是「按时间倒序」，但数据是正序的
const before = P.experience.map(e => e.period).join(' | ');
P.experience = P.experience.slice().sort((a, b) => {
  const key = s => (String(s).match(/\d{4}\.\d{1,2}/) || ['0'])[0].replace(/\.(\d)$/, '.0$1');
  return key(b.period).localeCompare(key(a.period));
});

// 时间格式统一，并把校内学生职务从「全职」改掉（写「全职」会让 HR 误判）
P.experience.forEach(e => {
  e.period = String(e.period).replace(/今日|现在/g, '至今').replace(/^(\d{4})\.(\d)\b/, '$1.0$2');
  if (/学院|学校|大学/.test(e.company) && e.type === '全职') {
    log.push('  · 「' + e.role + '」性质：全职 → 校内任职（这是学生职务，写「全职」会让 HR 误判）');
    e.type = '校内任职';
  }
});
log.push('工作经历改为倒序、时间格式统一：' + before + '  →  ' + P.experience.map(e => e.period).join(' | '));

/* ────────────────────────────────────────────────────────────────────────
   ⑤ 常见问答：清掉我编的故事
   ──────────────────────────────────────────────────────────────────────── */

/* 顺序很重要：先「用真实素材重写」，再「删除没有素材可替换的」。
   反过来的话，我写好的真实答案会连着虚构内容一起被删掉。 */

const rewrite = {
  '最有成就感的项目是什么？最大的成果':
    'AI 部。\n\n它不算一个技术项目，但是我认为自己做得最完整的一件事：从 0 到 1 把部门跑起来，给完全不懂 AI 的同学讲课，一路带到每个人能独立做出自己的 Agent，还带队参加各类比赛。\n\n比起自己做出一两个作品，能让 30 个人具备做出作品的能力，我觉得更值。',
  '职业规划是什么？未来想做什么':
    '目标很明确：带团队。\n\n短期想先成为团队里 AI 应用落地最靠谱的那个人——RAG、Agent、AI 工具集成这几块能独立扛下来。\n\n长期想做统筹策划方向，带更大规模的团队，把「想法 → 落地」这条链路管起来。',
  '优点和缺点是什么？':
    '**优点**：学习快、动手快，习惯先做出最小可用的东西再补原理，所以上手新工具比较快；同时带两个部门，协调和沟通还算擅长。\n\n**缺点**：理论底子不如科班扎实——我是靠做项目学起来的，遇到需要推导底层原理的场合会比较吃力，这块在补。英语也是短板。',
  '他最擅长的技术方向是什么？技术强项':
    'AI 工具的实际落地，具体是这几块：\n\n- **AI 可视化**：AI 生图、生视频、做 IP 形象\n- **RAG 检索**：能本地创建知识库\n- **定制 Agent**：给企业或个人做专属 Agent\n- **模型本地部署**：本地跑各类开源模型\n\n另外新媒体这块也熟：拍摄、剪辑、账号运营。特点是工具用得熟、能直接落地出东西。',
  '期望薪资是多少？':
    '底薪 5k+，具体会结合岗位职责和团队情况谈。\n\n如果业务方向特别匹配、成长空间大，薪资上有一定弹性。',
  '什么时候可以到岗？到岗时间':
    '2027 年 6 月后可随时到岗。',
  '带过团队吗？管理经验、团队规模':
    '带过。校内担任两个职务：新媒体摄像部（10 人）和 AI 部负责人（30 人）。\n\n管理风格偏「技术带头 + 授权」：关键的地方我亲自上手示范，具体执行放手让成员做，出问题我兜底。',
  '学历背景？哪个学校毕业的':
    '朔州陶瓷职业技术学院，数字媒体技术专业，专科，2025 年 9 月入学，预计 2028 年 6 月毕业。\n\n在校期间获得国家级奖学金。',
  '英语水平怎么样？':
    '英语是我的短板，还在提升中。',
  '能接受远程办公吗？加班情况':
    '接受线上线下混合。'
};

let rewritten = 0;
const rewrittenList = [];
P.faq.forEach(f => {
  if (rewrite[f.q] !== undefined) { f.a = rewrite[f.q]; rewritten++; rewrittenList.push(f.q); }
});
log.push('重写 ' + rewritten + ' 条 FAQ 答案（删掉我的虚构细节，改用你提供的真实素材）：');
rewrittenList.forEach(q => log.push('  · ' + q));

// 只剩这一条我完全没有真实素材可替换——与其编，不如删掉。
// 等你有真实的技术难点素材，再加回来。
const NO_MATERIAL = ['遇到过最大的技术挑战是什么？'];
const dropped = P.faq.filter(f => NO_MATERIAL.includes(f.q)).map(f => f.q);
P.faq = P.faq.filter(f => !NO_MATERIAL.includes(f.q));
if (dropped.length) {
  log.push('删除 ' + dropped.length + ' 条 FAQ（我完全没有你的真实素材，编一个比不答更糟）：');
  dropped.forEach(q => log.push('  · 「' + q + '」'));
}

// 清理答案里的多余空白
P.faq.forEach(f => { f.a = String(f.a).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim(); });

/* ────────────────────────────────────────────────────────────────────────
   ⑥ 推荐问题：原来还写着「6 年经验」
   ──────────────────────────────────────────────────────────────────────── */
P.suggestions = [
  '他最擅长的 AI 工具是哪些？',
  '有没有从 0 到 1 做过 AI 项目？',
  '带过团队吗？管理规模多大？',
  'AI 部负责人具体做什么？',
  'RAG 和 Agent 他做到什么程度？',
  '期望薪资和到岗时间？',
  '他是学什么专业的？',
  '英语水平怎么样？'
];
log.push('重写推荐问题：原来还带着「6 年里最能拿得出手的成果」这类示例人设的问法');

/* ────────────────────────────────────────────────────────────────────────
   ⑦ 发布前必须处理，但需要你提供素材的
   ──────────────────────────────────────────────────────────────────────── */
const blockers = [];
if (!P.projects || P.projects.length === 0) {
  blockers.push('projects 是空的——「项目作品」整块会是空白。需要你提供 3–5 个真实项目' +
    '（名称、时间、做什么、结果、用了什么工具）。');
}
if (!P.experience.some(e => /RAG|Agent|知识库/.test(JSON.stringify(e)))) {
  blockers.push('技能里写了 RAG / 定制 Agent，但工作经历里没有对应的项目描述——' +
    'AI 助手被问到细节时答不出来。');
}

/* ──────────────────────────────────────────────────────────────────────── */
const out = { profile: P, cfg: raw.cfg || {} };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log('═══════ 数据整理报告 ═══════\n');
log.forEach(l => console.log(l.startsWith('  ') ? l : '\n▸ ' + l));
if (blockers.length) {
  console.log('\n\n═══════ 需要你补的素材 ═══════\n');
  blockers.forEach((b, i) => console.log((i + 1) + '. ' + b));
}
console.log('\n──────────────────────────────');
console.log('FAQ: ' + beforeFaq + ' → ' + P.faq.length + ' 条');
console.log('经历: ' + P.experience.length + ' 段   项目: ' + P.projects.length + ' 个   技能组: ' + P.skills.groups.length);
console.log('已写出 ' + OUT);

if (DO_BAKE) {
  const htmlPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const json = JSON.stringify(out).replace(/</g, '\\u003c');
  const re = /(<script type="application\/json" id="siteData">)[\s\S]*?(<\/script>)/;
  if (!re.test(html)) { console.error('\n✗ 找不到 siteData 数据块，未写入'); process.exit(1); }
  html = html.replace(re, (m, a, b) => a + json + b);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('已写入 index.html 的 siteData 数据块');
}
