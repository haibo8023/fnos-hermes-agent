#!/usr/bin/env bash
# 刷新 app/desktop-app：从上游 checkout 构建 desktop renderer 的 web dist → 同步进目标目录 → 叠加我们的 overlay。
#
#   bash scripts/desktop-app/sync-dist.sh [--upstream upstream] [--target app/desktop-app]
#                                        [--dist <已构建好的 dist 目录>] [--strict]
#
# 为什么只跑 vite build、不跑上游的 build.mjs：
#   上游 build.mjs 会连带 electron main/preload 打包和原生依赖 staging（需要 electron 二进制、Rust 工具链），
#   而我们只需要 renderer 的 web 产物（index.html + assets/ + public/ 直拷 + emojibase 插件产物）。
#   vite.config 的 publicDir=public、插件 hermes:emojibase-assets 已经覆盖了全部 web 资源。
#
# 失败策略：默认「告警 + 保留旧 dist + 退出 0」，不阻断上游同步；--strict 时退出 3。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UPSTREAM="$ROOT/upstream"
TARGET="$ROOT/app/desktop-app"
DIST=""
STRICT=0
NODE_DIR="${DESKTOP_DIST_NODE_DIR:-/vol1/@appcenter/nodejs_v24/bin}"

while [ $# -gt 0 ]; do
  case "$1" in
    --upstream) UPSTREAM="$2"; shift 2 ;;
    --target)   TARGET="$2"; shift 2 ;;
    --dist)     DIST="$2"; shift 2 ;;
    --strict)   STRICT=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

fatal() {
  echo "::warning title=desktop dist refresh::$1"
  printf '✗ %s\n' "$1" >&2
  [ "$STRICT" = "1" ] && exit 3
  exit 0
}

# ── 0) 工具链 ────────────────────────────────────────────────────────────────
[ -d "$NODE_DIR" ] && export PATH="$NODE_DIR:$PATH"
command -v node >/dev/null || fatal "环境里没有 node"
command -v npm  >/dev/null || fatal "环境里没有 npm"
export npm_config_engine_strict=false npm_config_fund=false npm_config_audit=false

# 上游 engines 要求 npm <11.10 或 >=11.17；11.10–11.16 装 workspace 会漏装 devDeps
# （实测 11.12.1 漏掉 @rolldown/plugin-babel，vite build 直接 ERR_MODULE_NOT_FOUND）。
NPM="$(command -v npm)"
NPM_V="$("$NPM" -v)"
case "$NPM_V" in
  11.1[0-6].*)
    BOOT="${DESKTOP_DIST_NPM_PREFIX:-/tmp/desktop-dist-npm}"
    if [ ! -x "$BOOT/bin/npm" ]; then
      echo "── npm $NPM_V 不合规，引导一个合规 npm 到 $BOOT"
      mkdir -p "$BOOT"
      npm i -g npm@latest --prefix "$BOOT" --no-audit --no-fund >/dev/null 2>&1 \
        || fatal "引导合规 npm 失败"
    fi
    NPM="$BOOT/bin/npm"
    echo "── 使用 npm $("$NPM" -v) ($NPM)"
    ;;
esac

# ── 1) 构建 renderer（未提供 --dist 时）───────────────────────────────────────
if [ -z "$DIST" ]; then
  [ -d "$UPSTREAM/apps/desktop" ] || fatal "找不到 $UPSTREAM/apps/desktop"
  DIST="$(mktemp -d /tmp/desktop-dist.XXXXXX)"
  # 注意：NODE_ENV=production 会让 npm 跳过 devDependencies，而 vite.config 依赖的
  # @vitejs/plugin-react / @rolldown/plugin-babel 都是 devDep（实测漏装 → vite build ERR_MODULE_NOT_FOUND）。
  echo "── npm ci ($UPSTREAM, apps/desktop workspace)"
  (cd "$UPSTREAM" && env -u NODE_ENV "$NPM" ci --workspace apps/desktop --include-workspace-root \
      --ignore-scripts --no-audit --no-fund) || fatal "npm ci 失败"
  echo "── vite build (renderer) → $DIST"
  (cd "$UPSTREAM/apps/desktop" && NODE_ENV=production npx vite build \
      --outDir "$DIST" --emptyOutDir) || fatal "vite build 失败"
fi

[ -f "$DIST/index.html" ] || fatal "$DIST 里没有 index.html"

# ── 2) 同步（--delete 保持「官方 dist 是什么就是什么」）──────────────────────
echo "── 同步 $DIST → $TARGET"
mkdir -p "$TARGET"
rsync -a --delete \
  --exclude '/main.js' --exclude '/preload.js' --exclude '/preview-guest-preload.js' \
  --exclude '/install-stamp.json' --exclude '/package.json' \
  --exclude '/node_modules/' --exclude '/native/' --exclude '/build/' \
  "$DIST"/ "$TARGET"/ || fatal "rsync 同步失败"
# 注：--delete 会删掉 web-shim.js（overlay 的文件不在 dist 里），下一步 overlay 会补回

# ── 3) overlay（web-shim 层 + index.html 注入）──────────────────────────────
python3 "$ROOT/scripts/desktop-app/apply-overlay.py" \
  --target "$TARGET" --overlay "$ROOT/overlay/desktop-app" || fatal "apply-overlay 失败"
# 静态资源要给应用用户可读（否则 monitor 读不了 → 500 → shim 加载失败，renderer 报 IPC bridge 不可用）
chmod -R a+rX "$TARGET" 2>/dev/null || true

# 桥面检查（warn-only）：上游前端新增了我们既未实现、也不在 ABSENT 清单里的桥能力时打 ::warning::
# 这样上游前端改接口不会悄悄弄坏 web 版，而是在 CI 里显式报出来（详见 fnos-learned §6.18）
python3 "$ROOT/scripts/desktop-app/check-bridge-surface.py" \
  --dist "$TARGET" --shim "$ROOT/overlay/desktop-app/web-shim.js" || true

echo "── 结果（变更文件）"
git -C "$ROOT" status --porcelain app/desktop-app 2>/dev/null | head -30 || true
echo "✓ desktop dist 刷新完成：$TARGET"
