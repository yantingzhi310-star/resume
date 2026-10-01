/* 用站点自己的导出逻辑重建 index.html
 *
 * 烘焙数据之后，静态的 <title> / meta description / og:* / schema.org 结构化数据
 * 还是旧的——因为它们不在运行时渲染，而是写在 HTML 里的。
 *
 * 这段更新逻辑页面里本来就有（管理员面板的「导出 index.html」按钮用的就是它）。
 * 所以这里直接在浏览器里调用 buildExportHtml()，把结果写回 index.html。
 * 在 Node 里另写一份等价实现是下策：两份代码迟早会漂移。
 *
 * 用法：先起一个带调试端口的 Chrome，再 node _rebuild.cjs
 */
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HTML = path.join(__dirname, 'index.html');

(async () => {
  const before = fs.readFileSync(HTML, 'utf8');

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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'file:///' + HTML.replace(/\\/g, '/') });
  await sleep(4200);

  const info = await js(`return { name: PROFILE.meta.nameZh, projects: PROFILE.projects.length, faq: PROFILE.faq.length };`);
  const out = await js(`return buildExportHtml();`);

  if (typeof out !== 'string' || out.length < 5000) throw new Error('导出结果异常，长度 ' + (out ? out.length : 0));
  fs.writeFileSync(HTML, out, 'utf8');

  // 报告实际变化，而不是笼统说「已重建」
  const pick = (s, re) => { const m = s.match(re); return m ? m[1] : '(未找到)'; };
  const rows = [
    ['<title>', /<title>([\s\S]*?)<\/title>/],
    ['og:title', /property="og:title" content="([^"]*)"/],
    ['og:image', /property="og:image" content="([^"]*)"/],
    ['schema name', /"@type":\s*"Person",\s*"name":\s*"([^"]*)"/]
  ];
  console.log('以 ' + info.name + ' 的数据重建 index.html（项目 ' + info.projects + ' 个 · FAQ ' + info.faq + ' 条）\n');
  rows.forEach(([label, re]) => {
    const a = pick(before, re), b = pick(out, re);
    console.log('  ' + label.padEnd(13) + (a === b ? '不变  ' + b : a + '  →  ' + b));
  });
  // 用字节数，不要用 String.length——中文 1 个字符占 3 个 UTF-8 字节，
  // 用字符数会把 263 KB 的文件报成 217 KB。
  const kb = s => Math.round(Buffer.byteLength(s, 'utf8') / 1024);
  console.log('\n  体积 ' + kb(before) + ' KB → ' + kb(out) + ' KB');

  // 幂等性：再导一次应该只差 exportedAt 时间戳，其余完全一致。
  // 直接比字符串会把「时间戳不同」误判成「导出逻辑不稳定」。
  const strip = s => s.replace(/"exportedAt":"[^"]*"/, '"exportedAt":"X"');
  const again = await js(`return buildExportHtml();`);
  console.log('  幂等性: ' + (strip(again) === strip(out)
    ? '剔除时间戳后两次导出完全一致 ✓'
    : '⚠ 剔除时间戳后仍不一致，导出逻辑可能不稳定'));

  ws.close();
  process.exit(0);
})().catch(e => { console.error('重建失败:', e.message); process.exit(1); });
