#!/usr/bin/env python3
"""把 overlay 层叠到 app/desktop-app（幂等）：
   - overlay/desktop-app/web-shim.js      -> <target>/web-shim.js
   - overlay/desktop-app/index-extra-head.html 里的片段注入到 <target>/index.html 的 </head> 之前
     （片段里的 {{SHIM_VERSION}} 会替换成 web-shim.js 内容的短哈希，保证浏览器不会吃旧 shim）

用法: apply-overlay.py [--target app/desktop-app] [--overlay overlay/desktop-app]
"""
import argparse
import hashlib
import re
import shutil
import sys
from pathlib import Path

MARK_CONFIG = re.compile(r'<script>window\.__HERMES_WEB_CONFIG__\s*=.*?</script>\n?', re.S)
MARK_STYLE = re.compile(r'<style id="hermes-webline-overrides">.*?</style>\n?', re.S)
MARK_SHIM = re.compile(r'<script src="\./web-shim\.js\?v=[^"]*"></script>\n?')

BLOCKS = [(MARK_CONFIG, 'window.__HERMES_WEB_CONFIG__'),
          (MARK_STYLE, 'hermes-webline-overrides'),
          (MARK_SHIM, 'web-shim.js 引用')]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', default='app/desktop-app')
    ap.add_argument('--overlay', default='overlay/desktop-app')
    a = ap.parse_args()
    target, overlay = Path(a.target), Path(a.overlay)
    index, shim_src = target / 'index.html', overlay / 'web-shim.js'
    extra = overlay / 'index-extra-head.html'
    for p in (index, shim_src, extra):
        if not p.is_file():
            print(f'✗ 缺少 {p}', file=sys.stderr)
            return 1

    # 1) shim
    shim_src_bytes = shim_src.read_bytes()
    ver = hashlib.sha256(shim_src_bytes).hexdigest()[:8]
    shim_dst = target / 'web-shim.js'
    changed = (not shim_dst.is_file()) or shim_dst.read_bytes() != shim_src_bytes
    shutil.copy2(shim_src, shim_dst)
    # 静态资源必须对应用用户（hermes-agent）可读：640 会让 monitor 读文件失败返回 500，
    # shim 加载不了 → renderer 报 "Desktop IPC bridge is unavailable"（2026-10-10 实测踩过）
    shim_dst.chmod(0o644)

    # 2) index.html 注入（先清理旧标记，保证幂等）
    html = index.read_text(encoding='utf-8')
    for rx, name in BLOCKS:
        n = len(rx.findall(html))
        if n:
            html = rx.sub('', html)
            print(f'  · 清理旧的 {name} x{n}')
    snippet = extra.read_text(encoding='utf-8').replace('{{SHIM_VERSION}}', ver).rstrip('\n')
    if '</head>' not in html:
        print('✗ index.html 缺少 </head>', file=sys.stderr)
        return 1
    out = html.replace('</head>', f'{snippet}\n</head>', 1)
    for rx, name in BLOCKS:
        if not rx.search(out):
            print(f'✗ 注入后缺少 {name}', file=sys.stderr)
            return 1
    if not re.search(r'web-shim\.js\?v=[0-9a-f]{8}', out):
        print('✗ web-shim 版本号不是 8 位哈希', file=sys.stderr)
        return 1
    index_changed = out != html
    index.write_text(out, encoding='utf-8')
    index.chmod(0o644)

    print(f'✓ overlay 已应用: shim v={ver} ({"更新" if changed else "内容相同"}), '
          f'index.html {"已注入" if index_changed else "无变化"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
