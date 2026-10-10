#!/usr/bin/env python3
"""静态桥面检查（warn-only）：新前端用到的 hermesDesktop.* 能力，是否都被 overlay shim 覆盖。

背景：上游前端每次同步都会重建（scripts/desktop-app/sync-dist.sh）。若上游新增了桥能力而我们既没实现、
也没在 ABSENT（故意不存在）清单里，web 版可能在运行时才崩。这里在构建期扫出来并打 ::warning::。

用法: check-bridge-surface.py --dist app/desktop-app --shim overlay/desktop-app/web-shim.js [--strict]
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HARNESS = r"""
const fs = require('fs'), vm = require('vm')
const src = fs.readFileSync(process.argv[2], 'utf8')
const eb = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains() { return false } },
  setAttribute() {}, getAttribute() { return null }, appendChild() {}, removeChild() {}, addEventListener() {},
  removeEventListener() {}, querySelector() { return null }, querySelectorAll() { return [] }, insertBefore() {},
  cloneNode() { return eb() }, innerHTML: '', textContent: '', children: [], childNodes: [], parentNode: null })
const doc = { documentElement: eb(), body: eb(), head: eb(), createElement: eb, createTextNode: () => ({}),
  createDocumentFragment: eb, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  addEventListener() {}, removeEventListener() {}, readyState: 'complete', createTreeWalker: () => ({ nextNode: () => null }) }
const w = { __HERMES_WEB_CONFIG__: { base: '/proxy/dashboard', token: 't', profile: 'default', appVersion: '', branch: 'main', sha: '', home: '/' },
  location: { origin: 'http://127.0.0.1', pathname: '/desktop-app/', href: 'http://127.0.0.1/desktop-app/', protocol: 'http:', host: '127.0.0.1' },
  navigator: { userAgent: 'node', clipboard: { writeText: async () => {}, readText: async () => '' }, language: 'zh' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
  WebSocket: function () { return { send() {}, close() {}, addEventListener() {} } },
  MutationObserver: function () { return { observe() {}, disconnect() {} } },
  requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame() {},
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000', getRandomValues: (a) => a },
  performance: { now: () => 1 }, ResizeObserver: function () { return { observe() {}, disconnect() {} } },
  URL, URLSearchParams, Blob: function () {}, AbortSignal: { timeout: () => null }, Promise, JSON, Math, Date,
  String, Number, Object, Array, Error, RegExp, Set, Map, Symbol, Proxy, Reflect, TextEncoder, TextDecoder,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  structuredClone: (o) => JSON.parse(JSON.stringify(o)), history: { pushState() {}, replaceState() {}, state: null },
  getComputedStyle: () => ({ getPropertyValue: () => '' }), document: doc, console: { log() {}, warn() {}, error() {} } }
w.window = w; w.self = w; w.globalThis = w; w.top = w
try { vm.runInContext(src, vm.createContext(w), { filename: 'shim.js' }) } catch (e) { console.error('shim 执行失败: ' + e.message); process.exit(2) }
const d = w.hermesDesktop || {}
const ns = {}
for (const k of Object.keys(d)) { const v = d[k]; if (v && typeof v === 'object' && !Array.isArray(v)) ns[k] = Object.keys(v) }
console.log(JSON.stringify({ keys: Object.keys(d), absent: Object.keys(w.__HERMES_SHIM_ABSENT__ || {}), namespaces: ns }))
"""

TOP = re.compile(r'hermesDesktop\s*(?:\?\.|\.)\s*(?!\?)([A-Za-z_$][\w$]*)')
NESTED = re.compile(r'hermesDesktop\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dist', default='app/desktop-app')
    ap.add_argument('--shim', default='overlay/desktop-app/web-shim.js')
    ap.add_argument('--strict', action='store_true', help='发现问题时非零退出（默认仅告警）')
    a = ap.parse_args()

    shim = Path(a.shim)
    assets = Path(a.dist) / 'assets'
    if not shim.is_file() or not assets.is_dir():
        print(f'⚠ 跳过桥面检查（缺 {shim} 或 {assets}）')
        return 0

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as fh:
        fh.write(HARNESS)
        harness = fh.name
    try:
        r = subprocess.run(['node', harness, str(shim)], capture_output=True, text=True, timeout=120)
    finally:
        Path(harness).unlink(missing_ok=True)
    if r.returncode != 0:
        print(f'::warning title=bridge-surface::shim 自省失败: {r.stderr.strip()[:200]}')
        return 0
    surface = json.loads(r.stdout.strip().splitlines()[-1])
    have = set(surface['keys'])
    absent = set(surface['absent'])
    namespaces = surface['namespaces']

    used_top, used_nested = set(), set()
    for p in sorted(assets.glob('*.js')):
        txt = p.read_text(encoding='utf-8', errors='replace')
        used_top |= set(TOP.findall(txt))
        for nsname, member in NESTED.findall(txt):
            used_nested.add((nsname, member))

    known = have | absent
    # 只对「命名空间」类缺口告警：它们决定新前端的能力探测，形状错会直接进错误边界。
    # 扁平方法走 shim 的 makeFallback 兜底（返回 Promise<null>），只有形状敏感时才需要补 —— 归为提示。
    unknown_flat = sorted(n for n in used_top if n not in known)
    unknown_ns = sorted({(n, m) for n, m in used_nested
                         if n in known and n not in absent and n in namespaces and m not in namespaces[n]})
    missing_ns = sorted({n for n, _ in used_nested if n not in known})

    print(f'桥面检查：前端用到 {len(used_top)} 个顶层能力 / {len(used_nested)} 个命名空间成员；'
          f'shim 顶层 {len(have)} 个（其中 {len(absent)} 个标记为"故意不存在"）')
    ok = True
    for n in missing_ns:
        ok = False
        print(f'::warning title=bridge-surface::前端用到命名空间 {n}，但 shim 未定义——'
              f'要么实现它，要么加进 overlay shim 的 SHIM_ABSENT（= Electron 里不存在）')
    for n, m in unknown_ns:
        ok = False
        print(f'::warning title=bridge-surface::前端用到 {n}.{m}，但 shim 的 {n} 没有该成员（缺成员会 TypeError）')
    if unknown_flat:
        print(f'::notice title=bridge-surface::另有 {len(unknown_flat)} 个扁平方法未显式实现（走兜底返回 null）: '
              f'{", ".join(unknown_flat[:8])}{" …" if len(unknown_flat) > 8 else ""}')
        print('  ↳ 仅当上游对其中某个的返回值做字段访问（如 (await d.x()).field）时才需要补形状；')
        print('    本次实测需要形状的只有 getBootstrapState / probeLocalBackend / getSyncStatus 等少数几个。')
    if ok:
        print('✓ 桥面检查通过：命名空间层面无缺口')
    print(f'SUMMARY namespaces_missing={len(missing_ns)} members_missing={len(unknown_ns)} flat_fallback={len(unknown_flat)}')
    return 1 if (a.strict and not ok) else 0


if __name__ == '__main__':
    sys.exit(main())
