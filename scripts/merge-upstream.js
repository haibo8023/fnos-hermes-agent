#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// fnos-hermes-agent-web 上游「受控合并」脚本（移植版原则）
//
// 上游 NousResearch/hermes-agent 是桌面端 monorepo；我们是飞牛移植版。
// 本脚本只把官方「运行时核心」同步进 app/hermes-src，并保证：
//   1. 桌面端/非运行时内容（apps/native/web/website/docs/evals/assets…）不同步
//   2. 我们移植层的修改（PORT_OVERRIDES）一律保留，官方更新不覆盖
//   3. 其余官方更新（bug 修复/新功能）正常吸收
//
// 用法： node scripts/merge-upstream.js [--upstream <dir>] [--write]
//   --upstream  官方克隆目录（缺省 upstream/，不存在则自动浅克隆）
//   --write     实际写入 app/hermes-src（不带则仅 dry-run 报告）
// ═══════════════════════════════════════════════════════════════════
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'app', 'hermes-src');
const UPSTREAM = 'NousResearch/hermes-agent';
const STATE_FILE = path.join(ROOT, '.upstream-state');

// ── 参数 ───────────────────────────────────────────────────────────
let upstreamDir = path.join(ROOT, 'upstream');
let WRITE = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--upstream' && argv[i + 1]) { upstreamDir = path.resolve(argv[i + 1]); i++; }
  if (argv[i] === '--write') WRITE = true;
}

// ── 同步范围：官方顶层白名单（运行时核心）─────────────────────────
const INCLUDE_TOP = new Set([
  // 已知上游顶层运行时包；白名单外的顶层包会被静默跳过（漏包=载荷缺文件），
  // 因此下方 pyprojectTopPackages() 还会依官方 pyproject 动态补齐，此处仅作审阅基准。
  'hermes_platform',
  'hermes_cli', 'tui_gateway', 'agent', 'gateway', 'providers', 'skills', 'tools',
  'plugins', 'cron', 'acp_adapter', 'locales', 'optional-mcps', 'optional-skills',
  'datagen-config-examples', 'docker', 'nix', 'scripts',
  'cli.py', 'run_agent.py', 'hermes', 'hermes_bootstrap.py', 'hermes_constants.py',
  'hermes_logging.py', 'hermes_state.py', 'hermes_state_common.py', 'hermes_state_portability.py',
  'hermes_state_schema.py', 'hermes_state_search.py', 'hermes_time.py', 'setup.py',
  'pyproject.toml', 'uv.lock', 'package.json', 'package-lock.json', 'toolsets.py',
  'toolset_distributions.py', 'trajectory_compressor.py', 'utils.py', 'model_tools.py',
  'registration_lifecycle.py', 'mcp_serve.py', 'mini_swe_runner.py', 'batch_runner.py',
  'setup-hermes.sh', 'hermes_socket.py', 'hermes_config.py', 'hermes_telemetry.py',
  'hermes_auth.py', 'hermes_cache.py', 'hermes_utils.py', 'hermes_tools.py',
]);
// 桌面端/非运行时：明确不同步（即使官方有更新）
const EXCLUDE_TOP = new Set([
  'apps', 'native', 'web', 'website', 'docs', 'evals', 'assets', 'mcp-research-data',
  '.github', '.coderabbit.yaml', '.dockerignore', '.env.example', '.envrc',
  '.gitattributes', '.gitignore', '.hadolint.yaml', '.mailmap', '.npmrc', '.nvmrc',
  '.prettierignore', '.prettierrc', '.python-version', 'AGENTS.md', 'README.md',
  'README.es.md', 'README.zh-CN.md', 'README.ur-pk.md', 'CONTRIBUTING.md',
  'CONTRIBUTING.es.md', 'SECURITY.md', 'SECURITY.es.md', 'Dockerfile',
  'docker-compose.yml', 'docker-compose.windows.yml', 'LICENSE', 'flake.lock', 'flake.nix',
  'constraints-termux.txt', 'eslint.config.shared.mjs', 'cli-config.yaml.example',
  'evals', 'tests-js', 'tests', 'website', 'assets', 'contributors', 'contributors',
]);

// ── 我们移植层改过的文件（官方更新绝不覆盖，冲突时保留我们的）─────
// 2026-09-09 起 PORT_OVERRIDES 清空：0.20.6 时代的三件手工补丁
// （tui_gateway runtime_check/WS 守卫、web_server dashboard 守卫）在 0.21.x
// 官方已全部内建且更强（heartbeat refresher / event replay / keepalive /
// ticket 走 WS subprotocol）；保留旧分叉反而让新 chat_ws 调不到
// _start_backend_heartbeat_refresher → WS 握手即崩（网关永远"连接中"）。
const PORT_OVERRIDES = new Set([]);

// ── 工具 ───────────────────────────────────────────────────────────
function walk(dir, base) {
  const out = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(base, p).split(path.sep).join('/');
      if (e.isDirectory()) out.push(...walk(p, base));
      else out.push(rel);
    }
  } catch {}
  return out;
}

// ── 确保官方克隆 ───────────────────────────────────────────────────
const upExists = fs.existsSync(upstreamDir) && (fs.readdirSync(upstreamDir).length > 0);
if (!upExists) {
  console.log(`克隆官方 ${UPSTREAM}（浅克隆）...`);
  fs.mkdirSync(path.dirname(upstreamDir), { recursive: true });
  execSync(`git clone --depth 1 https://github.com/${UPSTREAM}.git "${upstreamDir}"`, { stdio: 'inherit', cwd: ROOT });
}
// 官方仓库根 = 运行时核心（hermes_cli/tui_gateway 在顶层；无 hermes-src 包装）
const SRC = upstreamDir;
if (!fs.existsSync(path.join(SRC, 'hermes_cli')) || !fs.existsSync(path.join(SRC, 'tui_gateway'))) {
  console.error('✗ 官方克隆无效（缺 hermes_cli/tui_gateway）');
  process.exit(1);
}
if (!fs.existsSync(TARGET)) { console.error('✗ 未找到 app/hermes-src'); process.exit(1); }

// ── 动态补充白名单：以官方 pyproject 的 packages.find include 为准 ──────
// 硬编码白名单必然滞后于上游：0.21.1 把 hermes_state.py 拆成 hermes_state_* 一组、
// 0.21.4 新增顶层包 hermes_platform，两次都因「白名单外的顶层目录被静默跳过」导致
// app/hermes-src 缺包 → 设备上网关启动即 ModuleNotFoundError（2026-09-23 事故）。
// 这里把官方声明、白名单里没有的顶层包自动纳入（EXCLUDE_TOP 仍优先排除）。
function pyprojectTopPackages(dir) {
  try {
    const txt = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8');
    const m = txt.match(/\[tool\.setuptools\.packages\.find\][\s\S]*?include\s*=\s*\[([\s\S]*?)\]/);
    if (!m) return [];
    const tops = new Set();
    for (const s of (m[1].match(/["']([^"']+)["']/g) || [])) {
      const top = s.slice(1, -1).split('.')[0];
      if (top && !top.includes('*') && !EXCLUDE_TOP.has(top)) tops.add(top);
    }
    return [...tops].sort();
  } catch { return []; }
}
const OFFICIAL_TOP = pyprojectTopPackages(SRC);
const DYN_TOP = OFFICIAL_TOP.filter((t) => !INCLUDE_TOP.has(t));
for (const t of DYN_TOP) INCLUDE_TOP.add(t);
if (DYN_TOP.length) console.log('◈ 依官方 pyproject 动态纳入顶层包: ' + DYN_TOP.join(', '));

// ── 合并 ───────────────────────────────────────────────────────────
const report = { updated: [], kept: [], added: [], same: 0, desktopSkipped: 0 };
const upstreamFiles = walk(SRC, SRC);

for (const rel of upstreamFiles) {
  const top = rel.split('/')[0];
  let include = INCLUDE_TOP.has(top) || INCLUDE_TOP.has(rel);
  if (!include) {
    // 根目录顶层 .py 模块自动收录：上游会把旧模块拆分出新的顶层文件
    // （0.21.1 把 hermes_state.py 拆出 hermes_state_errors/repair/dbfile... 等 18 个，
    //  硬编码白名单不认识 → 载荷缺文件 → 网关启动即 ModuleNotFoundError）。
    const isRootPy = !rel.includes('/') && rel.endsWith('.py');
    if (isRootPy) {
      include = true;
    } else {
      if (EXCLUDE_TOP.has(top) || EXCLUDE_TOP.has(rel)) { report.desktopSkipped++; }
      continue; // 白名单外的非桌面文件也跳过（未归类）
    }
  }
  const src = path.join(SRC, rel);
  const dst = path.join(TARGET, rel);
  const upstreamBuf = fs.readFileSync(src);

  if (PORT_OVERRIDES.has(rel)) {
    if (fs.existsSync(dst) && !fs.readFileSync(dst).equals(upstreamBuf)) {
      report.kept.push(rel); // 保留我们的，官方更新忽略
    }
    continue;
  }
  if (!fs.existsSync(dst)) {
    report.added.push(rel);
    if (WRITE) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, upstreamBuf); }
    continue;
  }
  const oursBuf = fs.readFileSync(dst);
  if (oursBuf.equals(upstreamBuf)) { report.same++; continue; }
  report.updated.push(rel);
  if (WRITE) fs.writeFileSync(dst, upstreamBuf);
}

// ── 完整性校验：官方 pyproject 声明的运行时包必须都落到 app/hermes-src ──
// 拦住「载荷缺包」类发布事故：缺包只有真机才暴露（CI 没有能跑起来的 venv 冒烟）。
const missingPkgs = OFFICIAL_TOP.filter((t) =>
  !fs.existsSync(path.join(TARGET, t)) && !fs.existsSync(path.join(TARGET, t + '.py')));
if (missingPkgs.length) {
  const msg = '官方 pyproject 声明但 app/hermes-src 缺失的运行时包: ' + missingPkgs.join(', ');
  if (WRITE) {
    console.error('✗ ' + msg);
    console.error('  发布出去会让设备网关启动即 ModuleNotFoundError（参见 2026-09-23 hermes_platform 事故）。');
    process.exit(2);
  }
  console.warn('⚠ (dry-run) ' + msg);
} else if (OFFICIAL_TOP.length) {
  console.log('✓ 运行时包完整性校验通过（' + OFFICIAL_TOP.length + ' 个顶层包）');
}

// ── 官方 SHA/版本记录 ──────────────────────────────────────────────
let latestSha = '';
let latestVer = '';
try {
  latestSha = execSync(`git -C "${upstreamDir}" rev-parse HEAD`, { encoding: 'utf8' }).trim().slice(0, 12);
  // 版本号读 VERSION 文件（sync-upstream.js 已用 git tag 更新），不再读 pyproject.toml
  // （上游 2026-09-28 起 pyproject.toml version="0.0.0" 是占位符）
  try {
    latestVer = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim().split('.').slice(0, 3).join('.');
  } catch {}
} catch {}

// ── 输出报告 ───────────────────────────────────────────────────────
console.log('════════ 上游受控合并报告 ════════');
console.log(`官方版本: ${latestVer || '?'} @ ${latestSha || '?'}`);
console.log(`更新文件: ${report.updated.length}  | 新增文件: ${report.added.length}  | 保留(我们的): ${report.kept.length}  | 相同: ${report.same}  | 跳过桌面端: ${report.desktopSkipped}`);
if (report.updated.length) console.log('  UPDATED:\n   ' + report.updated.slice(0, 30).join('\n   '));
if (report.added.length) console.log('  ADDED:\n   ' + report.added.slice(0, 20).join('\n   '));
if (report.kept.length) console.log('  KEPT(移植修改保留):\n   ' + report.kept.join('\n   '));
if (!WRITE) console.log('（dry-run：未写入，加 --write 实际应用）');

// ── 更新 .upstream-state ───────────────────────────────────────────
if (WRITE && latestSha) {
  fs.writeFileSync(STATE_FILE, `PREV_OFFICIAL="${latestVer}"\nPREV_SHA="${latestSha}"\n`);
  console.log('已更新 .upstream-state');
}
