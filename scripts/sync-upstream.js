#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// fnos-hermes-agent-web 上游同步脚本（轻量版）
// 检测官方 NousResearch/hermes-agent 新版本，更新 VERSION，推送触发 GitHub Actions
//
// 版本规则：
//   官方版本变化（pyproject 0.20.4 → 0.20.5）→ 重置 Build V01
//   官方版本不变但 main 有新 commit → Build +1
//   官方无更新 → 不推送
//
// GitHub Actions 的 sync-upstream.yml 会检测 VERSION 变化后自动克隆上游+构建+发布
//
// 用法：
//   node scripts/sync-upstream.js [--proxy socks5://127.0.0.1:10808] [--push]
//   或 GH_PROXY=... node scripts/sync-upstream.js
//   --push 表示更新 VERSION 后自动 git 提交+推送（触发 CI）
// ═══════════════════════════════════════════════════════════════════
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UPSTREAM_REPO = 'NousResearch/hermes-agent';
const STATE_FILE = path.join(ROOT, '.upstream-state');
const VERSION_FILE = path.join(ROOT, 'VERSION');

// ── 参数 ───────────────────────────────────────────────────────────
let GH_PROXY = process.env.GH_PROXY || '';
const argv = process.argv.slice(2);
let DO_PUSH = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--proxy' && argv[i + 1]) { GH_PROXY = argv[i + 1]; i++; }
  if (argv[i] === '--push') DO_PUSH = true;
}
if (GH_PROXY) console.log('使用代理:', GH_PROXY);

// ── 网络请求（支持 socks 代理）────────────────────────────────────
function curl(url) {
  const proxyArg = GH_PROXY ? ['--socks5', GH_PROXY] : [];
  const out = execSync(`curl -sS --max-time 25 ${proxyArg.join(' ')} "${url}"`, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  }).trim();
  return out;
}

console.log('═══ 检测上游', UPSTREAM_REPO, '═══');

// ── 获取官方版本（GitHub Releases API 权威）──────────────────────
//   上游 tag 用 calendar-version（v2026.9.24），但真正的 semver 在 Release
//   name 里（"Hermes Agent v0.21.5 (v2026.9.24)"）。main 分支的 pyproject.toml
//   在发布后重置为 version="0.0.0" 占位符，不能直接读。
//   方案：用 Releases API 取 latest release，从 name 解析 semver。
let LATEST_VER = '';
let LATEST_TAG = '';
try {
  const relJson = curl(`https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`);
  const rel = JSON.parse(relJson);
  LATEST_TAG = rel.tag_name || '';
  // Release name 格式: "Hermes Agent v0.21.5 (v2026.9.24)"
  const nameMatch = (rel.name || '').match(/v(\d+\.\d+\.\d+)/);
  const bodyMatch = (rel.body || '').match(/v(\d+\.\d+\.\d+)/);
  LATEST_VER = (nameMatch && nameMatch[1]) || (bodyMatch && bodyMatch[1]) || '';
  if (LATEST_VER) console.log(`（Release: ${rel.name}）`);
} catch (e) { console.log('⚠ GitHub Releases API 获取失败:', e.message.slice(0, 80)); }
if (!LATEST_VER) {
  console.log('✗ 无法从上游 Release 解析 semver 版本号');
  process.exit(1);
}
console.log('官方最新版本:', LATEST_VER, '(tag:', LATEST_TAG + ')');

// ── 获取上游 main 最新 commit sha ─────────────────────────────────
let LATEST_SHA = '';
try {
  const info = JSON.parse(curl(`https://api.github.com/repos/${UPSTREAM_REPO}/commits/main`));
  LATEST_SHA = info.sha || '';
} catch (e) { console.log('⚠ 无法获取 commit sha:', e.message.slice(0, 80)); }
if (!LATEST_SHA) { console.log('⚠ 无法获取上游 commit，跳过变更检测'); LATEST_SHA = 'unknown'; }
console.log('上游 main commit:', LATEST_SHA.slice(0, 12));

// ── 读取上次同步状态 ──────────────────────────────────────────────
let PREV_SHA = '';
try {
  const st = fs.readFileSync(STATE_FILE, 'utf8');
  const m = st.match(/PREV_SHA="?([a-f0-9]+)"?/);
  if (m) PREV_SHA = m[1];
} catch {}

// ── 当前 Build 版本 ────────────────────────────────────────────────
const CUR_VERSION = fs.readFileSync(VERSION_FILE, 'utf8').trim();
const CUR_OFFICIAL = CUR_VERSION.split('.').slice(0, 3).join('.');
const CUR_BUILD = parseInt(CUR_VERSION.split('.').pop(), 10) || 0;

// ── 变更检测 ──────────────────────────────────────────────────────
let NEW_VERSION = '';
if (LATEST_VER !== CUR_OFFICIAL) {
  // 版本规则：版本号 = 官方版本 + 迭代号；官方升版（0.20.4→0.20.5）时
  // 版本线跟随官方，迭代重置为 1（0.20.4.54 → 0.20.5.1）
  NEW_VERSION = `${LATEST_VER}.1`;
  console.log(`◈ 官方版本 ${LATEST_VER}（原线 ${CUR_OFFICIAL}），版本线切换、迭代重置 → ${NEW_VERSION}`);
} else if (LATEST_SHA === 'unknown') {
  // 无法确认上游是否有新提交：官方版本未变时保守处理，保持现状不 bump
  //（避免 commit sha 获取失败（网络）被误判为"有新提交"而错误递增版本）
  console.log('⚠ 无法获取上游 commit sha，官方版本未变 → 保持当前版本，不递增');
  process.exit(0);
} else if (PREV_SHA && LATEST_SHA.slice(0, 12) === PREV_SHA.slice(0, 12)) {
  // 必须按 12 位短 sha 比较：.upstream-state 由 merge-upstream.js 写的是短 sha，
  // 而这里 LATEST_SHA 来自 API 是全 40 位 —— 直接全等比永远不等，
  // 于是「上游无新提交」这一天永远走不到，每次运行都自增 build 号并发布
  // （2026-09-29 实测：一次上游同步把版本从 .06 一路推到 .03/.08 等多余版本）。
  console.log(`◈ 上游无新提交（${LATEST_SHA.slice(0, 12)}），无需同步`);
  process.exit(0);
} else {
  const nb = CUR_BUILD + 1;
  NEW_VERSION = `${CUR_OFFICIAL}.${String(nb).padStart(2, '0')}`;
  console.log(`◈ 官方版本不变，main 有新提交 → Build V${String(CUR_BUILD).padStart(2, '0')} → V${String(nb).padStart(2, '0')}`);
}
console.log('新版本:', NEW_VERSION);

// ── 更新 VERSION 与状态 ───────────────────────────────────────────
fs.writeFileSync(VERSION_FILE, NEW_VERSION + '\n');
fs.writeFileSync(STATE_FILE, `PREV_OFFICIAL="${LATEST_VER}"\nPREV_SHA="${LATEST_SHA.slice(0, 12)}"\n`);
console.log('VERSION →', NEW_VERSION);
console.log('状态已记录: upstream', LATEST_VER, '@', LATEST_SHA.slice(0, 12));

// ── 推送触发 CI（--push）──────────────────────────────────────────
if (DO_PUSH) {
  console.log('\n── 提交并推送（触发 GitHub Actions 构建）──');
  try {
    execSync(`git add VERSION .upstream-state && git commit -m "sync: 上游 ${LATEST_VER} → ${NEW_VERSION}"`, {
      cwd: ROOT, stdio: 'inherit', timeout: 30000,
    });
    execSync('git push origin HEAD:main', { cwd: ROOT, stdio: 'inherit', timeout: 60000 });
    console.log('✓ 已推送，GitHub Actions 将自动构建发布');
  } catch (e) {
    console.log('⚠ 推送失败（可能无新提交或 SSH 未配置）:', e.message.slice(0, 100));
  }
}

console.log('\n═══ 同步完成 ═══');
console.log('GitHub Actions 的 sync-upstream.yml 会自动完成：克隆上游 → 构建 → 发布 Release');
