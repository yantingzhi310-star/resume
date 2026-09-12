# 部署上线

让**别人也能打开**你的简历，只需要把两个文件放到公网上：

```
index.html      ← 网站本体
og-image.png    ← 分享卡片（微信 / LinkedIn 转发时显示的那张图）
```

下面是三条路线，按「多快能出链接」排序。

---

## 第 0 步：发布前自检（必做）

```bash
node _preflight.cjs
```

它会检查：内容是否还留着示例人设、分享卡片地址对不对、有没有把 API Key 烘焙进页面、体积、AI 知识库是否正常。

**必须看到绿色的「可以发布」再往下走。** 有红色阻塞项就按提示改——尤其别跳过「内容是否已替换」，否则招聘方打开看到的是「陈屿 / hi@example.com」这份虚构简历。

---

## 路线 A：Netlify Drop（最快，约 2 分钟）

不用装任何东西，不用命令行。

1. 打开 <https://app.netlify.com/drop>
2. 把 `E:\deepseek\resume-site` 这个**文件夹**直接拖进网页
3. 等几秒，得到形如 `https://random-name-123.netlify.app` 的地址
4. 注册一下（GitHub / 邮箱都行）就能保留这个站点并改名字

适合：想立刻看到效果、先发给朋友看看。

缺点：域名不好看；以后更新内容要重新拖一次。

---

## 路线 B：Vercel（推荐长期使用）

你机器上已经有 Node，所以最省事。

```bash
# 1. 安装一次（全局）
npm i -g vercel

# 2. 在项目目录里执行
cd E:\deepseek\resume-site
vercel
```

第一次会问几个问题，一路回车即可：

| 提问 | 选什么 |
|---|---|
| Set up and deploy? | `Y` |
| Which scope? | 选你自己的账号 |
| Link to existing project? | `N` |
| Project name? | 随便，比如 `my-resume` |
| In which directory is your code located? | `./` |
| Want to modify these settings? | `N`（这是纯静态站，不需要构建） |

它会先给一个**预览地址**，确认没问题后发布正式版：

```bash
vercel --prod
```

得到 `https://my-resume.vercel.app` 这样的正式域名。

`vercel.json` 已经配好了：`index.html` 不缓存（你更新内容后访客立刻看到新版）、`og-image.png` 缓存一天、外加几个安全响应头。

适合：长期用、想要干净域名、每次更新一条命令就发布。

---

## 路线 C：GitHub Pages（免费、开源、可写进简历）

好处是**天然就是一个 Git 仓库**，面试官点进去能看到你的提交记录。

### 1. 本地已经是一个仓库了

我已经帮你 `git init` 并做了首次提交，你可以先确认一下：

```bash
cd E:\deepseek\resume-site
git log --oneline
git status
```

### 2. 在 GitHub 上建一个空仓库

打开 <https://github.com/new>：

- **Repository name**：比如 `resume`
- **Public**（Pages 免费版需要公开仓库；不想公开就选 Private，但 Pages 要付费）
  > 注意：仓库公开意味着 `_test.cjs` 这些开发脚本也会被看到。它们只是测试工具，不含任何秘密——管理员密码只以哈希形式存在 `index.html` 里，本来就是公开的。不想公开就把这些 `_*.cjs` 文件移到仓库外。
- **不要**勾选 Add a README / .gitignore / license（我们本地已经有了）

### 3. 推上去

把下面的 `<你的用户名>` 和 `<仓库名>` 换成你的：

```bash
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

第一次推送会弹出浏览器让你登录 GitHub 授权。

### 4. 打开 Pages

仓库页面 → **Settings** → 左侧 **Pages** →

- **Source**：`Deploy from a branch`
- **Branch**：`main`，目录选 `/ (root)`
- 点 **Save**

等 1～2 分钟，地址就是：

```
https://<你的用户名>.github.io/<仓库名>/
```

`.nojekyll` 已经放好了——它会禁用 Jekyll，保证仓库里有什么就发布什么（否则以 `_` 开头的文件会被 GitHub 静默丢掉）。

---

## 上线后必做的两件事

### 1. 填上真实域名，重新导出

分享卡片要求**绝对 URL**，不填的话微信和 LinkedIn 抓不到图。

1. 打开线上站点 → `Ctrl+Shift+A` 进管理员模式
2. 「站点设置 → **站点地址**」填你的完整地址

   | 路线 | 填什么 |
   |---|---|
   | Netlify | `https://你的站点.netlify.app` |
   | Vercel | `https://你的项目.vercel.app` |
   | GitHub Pages | `https://用户名.github.io/仓库名` ← **要带子路径** |

3. 点「导出 index.html」，用下载的文件覆盖本地的 `index.html`
4. 重新发布一次（Vercel：`vercel --prod`；GitHub：`git add . && git commit -m "set site url" && git push`）

### 2. 重新生成分享卡片

```bash
node _og-image.cjs
```

它会按当前简历内容画一张 1200×630 的图。**改了简历内容就要重跑一次**，否则转发出去还是旧名字。

---

## 以后更新内容的完整流程

```bash
# 1. 改内容（二选一）
#    a) 打开页面 → Ctrl+Shift+A → 管理员面板里改 → 点「导出 index.html」
#    b) 直接编辑 index.html 里的 DEFAULT_PROFILE

# 2. 让分享卡片跟上新内容
node _og-image.cjs

# 3. 自检
node _preflight.cjs

# 4. 发布
vercel --prod                      # Vercel
# 或
git add . && git commit -m "更新简历" && git push   # GitHub Pages
```

---

## 常见问题

**Q：部署后管理员模式还能用吗？密码安全吗？**

能。但要清楚：**这是纯前端校验，不是安全边界。** 密码哈希公开在页面里，任何人查看源码都能绕过。它只挡随手点开的访客。所以不要拿它保护敏感数据，也不要把高额度 API Key 烘焙进去。

**Q：线上版本的 AI 助手会走哪个模式？**

默认本地检索（完全离线、无需联网）。只有你在管理员面板里填了大模型 API 并导出，访客才会走大模型——**但那等于把你的 Key 公开**，见 `_preflight.cjs` 的第 4 项检查。

**Q：为什么不把开发脚本（`_*.cjs`）发布出去？**

可以发布，它们只是测试工具。真不想公开就移到仓库外，或者把仓库设为 Private（Pages 需要付费套餐）。

**Q：`og-image.png` 忘记上传会怎样？**

网站照常能用，但分享到微信 / LinkedIn / Twitter 时没有配图，只有一行文字，点击率会明显差。它必须和 `index.html` 一起部署。

**Q：想换域名 / 加自定义域名？**

Vercel：项目 Settings → Domains → 添加你的域名，按提示改 DNS。
GitHub Pages：仓库 Settings → Pages → Custom domain。

**Q：国内访问慢怎么办？**

Vercel / Netlify / GitHub Pages 的节点都在境外，国内访问可能不稳定。要稳定的国内访问，可以用对象存储 + CDN（阿里云 OSS、腾讯云 COS 都支持静态网站托管），把两个文件传上去即可。
