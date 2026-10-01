/* 设置管理员密码，并烘焙进 index.html
 *
 * 为什么需要这个脚本：站点一旦固定了密码，页面内就不再提供修改入口
 * （避免访客用「设置一次密码」盖掉站点固定的那份）。所以改密码要走这里。
 *
 *   node _set-admin-password.cjs "你的新密码" --bake
 *   node _set-admin-password.cjs                  # 随机生成一个强密码并烘焙
 *   node _set-admin-password.cjs "新密码"          # 只看哈希，不写文件
 *
 * 密码用 PBKDF2-SHA256（210,000 次迭代 + 16 字节随机盐）派生，
 * 参数与浏览器 WebCrypto 的实现完全一致，所以在页面上能正常校验。
 *
 * ⚠️ 再说一次：这个哈希是公开在页面源码里的。密码够长才扛得住离线暴力破解；
 *    而且它保护不了任何数据——整份简历本来就是公开的。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ITER = 210000;
const HTML = path.join(__dirname, 'index.html');
const BAKED_KEYS = ['generator', 'exportedAt', 'profile', 'cfg', 'ai', 'admin'];

const argv = process.argv.slice(2);
const bake = argv.includes('--bake');
const pwdArg = argv.find(a => !a.startsWith('--'));

/* 生成一个够长、又能手输的随机密码 */
function randomPassword() {
  const words = ['ember', 'quartz', 'lantern', 'harbor', 'cobalt', 'meadow', 'falcon', 'onyx',
    'willow', 'cinder', 'mosaic', 'pebble', 'tundra', 'zephyr', 'basalt', 'garnet'];
  const pick = () => words[crypto.randomInt(words.length)];
  const digits = String(crypto.randomInt(1000, 9999));
  const sym = '@#%+?*='[crypto.randomInt(7)];
  return pick() + '-' + pick() + '-' + digits + sym;
}

function derive(pwd) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(Buffer.from(pwd, 'utf8'), salt, ITER, 32, 'sha256');
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), iter: ITER, algo: 'PBKDF2-SHA256' };
}

const password = pwdArg || randomPassword();
const generated = !pwdArg;

if (password.length < 8) {
  console.error('✗ 密码至少 8 位。哈希是公开的，短密码扛不住离线爆破。');
  process.exit(1);
}

const rec = derive(password);

console.log('═══════ 管理员密码 ═══════\n');
console.log('  密码      ' + password + (generated ? '   ← 随机生成，请记下来' : ''));
console.log('  强度      ' + password.length + ' 位，字符集 ' +
  (/[a-z]/.test(password) ? '小写 ' : '') + (/[A-Z]/.test(password) ? '大写 ' : '') +
  (/\d/.test(password) ? '数字 ' : '') + (/[^\w\s]/.test(password) ? '符号' : ''));
console.log('  算法      ' + rec.algo + ' · ' + ITER.toLocaleString('en-US') + ' 次迭代 · 16 字节随机盐');
console.log('  盐        ' + rec.salt);
console.log('  哈希      ' + rec.hash);

if (!bake) {
  console.log('\n（未加 --bake，只输出哈希，没有改动文件）');
  process.exit(0);
}

/* ── 烘焙进 index.html 的 siteData ─────────────────────────────────────── */
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script type="application\/json" id="siteData">([\s\S]*?)<\/script>/);
if (!m) { console.error('\n✗ 找不到 siteData 数据块'); process.exit(1); }

let data = {};
try { data = JSON.parse(m[1].trim() || '{}'); } catch (e) {
  console.error('\n✗ siteData 不是合法 JSON：' + e.message); process.exit(1);
}
const had = !!(data.admin);
data.admin = rec;
data.generator = 'resume-site admin';
data.exportedAt = new Date().toISOString();

const json = JSON.stringify(data);
if (/<\/script/i.test(json)) { console.error('\n✗ 数据里含 </script，会提前闭合脚本标签'); process.exit(1); }

const out = html.replace(/(<script type="application\/json" id="siteData">)[\s\S]*?(<\/script>)/,
  (mm, a, b) => a + json + b);
fs.writeFileSync(HTML, out, 'utf8');

console.log('\n' + (had ? '已更新' : '已写入') + ' index.html 里的管理员凭据');
console.log('  文件 ' + Math.round(Buffer.byteLength(html, 'utf8') / 1024) + ' KB → ' +
  Math.round(Buffer.byteLength(out, 'utf8') / 1024) + ' KB');
console.log('\n下一步：重新部署');
console.log('  git add -A && git commit -m "更新管理员密码" && git push');
console.log('\n⚠️  密码忘了就得再跑一次这个脚本——页面内已经没有修改入口了。');
