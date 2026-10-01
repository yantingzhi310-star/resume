/* 把 index.html 里的 DEFAULT_PROFILE 换成真实简历数据。
 *
 * 为什么需要：真实数据原本只烘焙在 siteData 里，而文件里的 DEFAULT_PROFILE
 * 还是示例人设「陈屿」。后果有两个——
 *   ① 站点源码里嵌着另一个人的完整简历数据（虽然不显示）
 *   ② 一旦烘焙数据丢失或解析失败，站点会静默退回那份假简历
 *
 * 做法：大括号配平定位 DEFAULT_PROFILE 的边界，整块替换成 JSON 字面量。
 * JSON 对象字面量本身就是合法的 JS 字面量，不需要另写序列化逻辑。
 */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'index.html');
const DATA = path.join(__dirname, 'resume-final.json');

const html = fs.readFileSync(HTML, 'utf8');
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const profile = data.profile;

const literal = JSON.stringify(profile, null, 2);
if (/<\/script/i.test(literal)) {
  console.error('✗ 数据里含有 </script，直接嵌入会提前闭合脚本标签，已中止');
  process.exit(1);
}

const START = 'const DEFAULT_PROFILE = {';
const start = html.indexOf(START);
if (start === -1) { console.error('✗ 找不到 const DEFAULT_PROFILE = {'); process.exit(1); }

// 从 { 开始做大括号配平（跳过字符串与注释里的括号）
let i = start + START.length - 1;
let depth = 0, inStr = null, inLine = false, inBlock = false, escaped = false;
for (; i < html.length; i++) {
  const c = html[i], n = html[i + 1];
  if (inLine) { if (c === '\n') inLine = false; continue; }
  if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
  if (inStr) {
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === inStr) inStr = null;
    continue;
  }
  if (c === '/' && n === '/') { inLine = true; i++; continue; }
  if (c === '/' && n === '*') { inBlock = true; i++; continue; }
  if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) break; }
}
if (depth !== 0) { console.error('✗ 大括号配平失败，未找到 DEFAULT_PROFILE 的结尾'); process.exit(1); }

const end = i + 1;   // } 之后
const before = html.slice(start, end);
const after = 'const DEFAULT_PROFILE = ' + literal + ';';
const out = html.slice(0, start) + after + html.slice(end);

fs.writeFileSync(HTML, out, 'utf8');

const kb = s => Math.round(Buffer.byteLength(s, 'utf8') / 1024);
console.log('DEFAULT_PROFILE 已替换为真实简历数据');
console.log('  替换前 ' + before.split('\n').length + ' 行 / ' + kb(before) + ' KB');
console.log('  替换后 ' + after.split('\n').length + ' 行 / ' + kb(after) + ' KB');
console.log('  姓名: ' + profile.meta.nameZh + ' · 经历 ' + profile.experience.length +
            ' 段 · 项目 ' + profile.projects.length + ' 个 · FAQ ' + profile.faq.length + ' 条');
console.log('  文件 ' + kb(html) + ' KB → ' + kb(out) + ' KB');
