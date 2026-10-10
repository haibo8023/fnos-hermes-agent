# app/desktop-app 的 overlay 层（我们的那一层）

`app/desktop-app/` = **官方 desktop renderer 的构建产物（web dist）** + 本目录的 overlay。
上游同步（`scripts/merge-upstream.js`）只管 `app/hermes-src/**`，**不碰桌面端**；
`app/desktop-app` 由 `scripts/desktop-app/sync-dist.sh` 负责刷新（CI 已自动化）。

## 本目录内容

| 文件 | 作用 |
|---|---|
| `web-shim.js` | Electron→浏览器桥。把 `window.hermesDesktop` 换成纯浏览器实现：`api` / `getConnection` / `getGatewayWsUrl` 走同源 monitor 代理 + session token；fs/git/terminal/hud/pet/剪贴板等 Electron 能力降级为空实现；未定义方法由 Proxy 兜底返回 null，避免 renderer 崩溃。**改这里 = 改线上前端**（静态资源 `no-cache`，无需重启）。 |
| `index-extra-head.html` | 注入到 `index.html` 的 `</head>` 之前的片段：`window.__HERMES_WEB_CONFIG__` 兜底、`#hermes-webline-overrides` 样式、`<script src="./web-shim.js?v={{SHIM_VERSION}}">`。`{{SHIM_VERSION}}` 由 `apply-overlay.py` 替换为 `web-shim.js` 内容 sha256 的前 8 位（内容变了自动换版本号，浏览器不会吃旧 shim）。 |

## 刷新流程（自动）

`.github/workflows/sync-upstream.yml` 在「受控合并」之后、「Commit sync & merge」之前插入：

```bash
bash scripts/desktop-app/sync-dist.sh --upstream upstream --target app/desktop-app
```

脚本做的事：

1. `npm ci`（`apps/desktop` workspace，`--ignore-scripts` 跳过 electron 二进制；npm 版本不合规会自动引导一个合规 npm）
2. `npx vite build` → renderer web dist（`index.html` + `assets/` + `public/` 直拷 + `hermes:emojibase-assets` 插件产物）
3. `rsync -a --delete` 同步进 `app/desktop-app`（官方 dist 是什么就是什么）
4. `python3 scripts/desktop-app/apply-overlay.py` 把本目录的层叠回去

只跑 `vite build`、不跑上游的 `build.mjs`：后者会连带 electron main/preload 打包与原生依赖 staging（需要 electron 二进制 / Rust 工具链），而 web 端只需要 renderer 产物。

**失败策略**：构建失败只打 `::warning::` 并保留旧 dist，不阻断上游同步；需要严格失败时加 `--strict`（退出 3）。

## 注意事项

- **改了 `web-shim.js` 之后必须让 `sync-dist.sh` 跑一遍**（CI 会自动），因为 `app/desktop-app/web-shim.js` 是生成物。
- 新 dist 可能改变 DOM / 桥的假设：刷新后必须按 `fnos-learned/references/hermes-agent-fpk-troubleshooting.md` §6.15 的 CDP 配方冒烟 ——
  应用能启动（body 含「就绪」）、`typeof window.hermesDesktop === 'object'`、各面板可用、控制台无错误。
- `app/desktop-app/index.html` 里的 `web-shim.js?v=<hash>` 由脚本维护，不要手改。
- 想在本地试：`bash scripts/desktop-app/sync-dist.sh --upstream /path/to/upstream --target /tmp/out`，
  或已构建好 dist 时 `--dist /path/to/dist`（跳过 npm/vite）。
