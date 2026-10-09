/**
 * Hermes Desktop → Web shim
 *
 * 将 Electron 桌面端的 window.hermesDesktop 桥替换为纯浏览器实现:
 * - 核心通信(api / getConnection / getGatewayWsUrl)走同源 monitor 代理 + session token
 * - Electron 特有能力(fs/git/terminal/hud/pet/剪贴板等)降级为空实现
 * - 未定义方法由 Proxy 兜底返回 null,避免 renderer 崩溃
 *
 * 依赖注入:页面由 monitor serve 时注入 window.__HERMES_WEB_CONFIG__:
 *   { base: '/proxy/dashboard', token: '<session-token>', profile?: '<id>' }
 */
(function () {
  "use strict";
  var CONFIG = window.__HERMES_WEB_CONFIG__;
  if (!CONFIG) {
    // 未注入配置时仍安装桥,但 api/连接抛错,避免白屏
    CONFIG = { base: "/proxy/dashboard", token: "", profile: null };
  }
  // [DIAG] boot 流量记录仪（临时）
  window.__clog = [];
  try {
    var ow = console.warn, oe = console.error;
    console.warn = function () { window.__clog.push('W:' + Array.prototype.map.call(arguments, String).join(' ').slice(0, 240)); return ow.apply(console, arguments); };
    console.error = function () { window.__clog.push('E:' + Array.prototype.map.call(arguments, String).join(' ').slice(0, 240)); return oe.apply(console, arguments); };
    window.addEventListener('hashchange', function () { window.__clog.push('HASH:' + location.hash.slice(0, 80)); });
  } catch (e) {}
  window.__wslog = [];
  try {
    var OW = window.WebSocket;
    var WSlog = window.__wslog;
    window.WebSocket = function (url, protocols) {
      var ws = protocols !== undefined ? new OW(url, protocols) : new OW(url);
      var rec = { k: 'ws-open', url: String(url).replace(/token=[^&]+/, 'token=***').slice(0, 140), t: Math.round(performance.now()), sent: [], got: [] };
      WSlog.push(rec);
      try {
        var os = ws.send.bind(ws);
        // 合成 cron 运行记录（cron_output: 前缀，脚本型 no_agent 任务的每次运行输出文档）
        // 在网关里没有可 resume 的会话。直接发 session.resume 会拿到 4007，renderer 的 catch
        // 只对「归属解析失败」走只读转录路径，于是把 4007 冒成「恢复失败 session not found」弹窗。
        // 这里在本地抛同名错误（SessionOwnerResolutionError），让 renderer 按设计走它自己的
        // 只读转录分支：展示运行输出 + 提示「已以只读方式打开」+ 禁用发送。
        ws.send = function (d) {
          try {
            var _m = JSON.parse(typeof d === 'string' ? d : '');
            if (_m && _m.method === 'session.resume' && _m.params &&
                typeof _m.params.session_id === 'string' &&
                _m.params.session_id.indexOf('cron_output:') === 0) {
              var _e = new Error('run record has no resumable session');
              _e.name = 'SessionOwnerResolutionError';
              _e.sessionId = _m.params.session_id;
              _e.method = _m.method;
              throw _e;
            }
          } catch (_pe) {
            if (_pe && _pe.name === 'SessionOwnerResolutionError') { throw _pe; }
          }
          if (rec.sent.length < 40) rec.sent.push(String(d).slice(0, 160)); return os(d);
        };
        ws.addEventListener('message', function (ev) { if (rec.got.length < 40) rec.got.push(String(ev.data).slice(0, 160)); });
        ws.addEventListener('close', function (ev) { rec.close = ev.code + ' ' + (ev.reason || '').slice(0, 40); });
        ws.addEventListener('error', function () { rec.err = 1; });
      } catch (e) {}
      return ws;
    };
    window.WebSocket.prototype = OW.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k, i) { window.WebSocket[k] = i; });
    var OF = window.fetch;
    window.fetch = function (u, o) {
      var url = String(typeof u === 'string' ? u : (u && u.url) || '');
      var rec = { k: 'fetch', url: url.replace(window.location.origin, '').slice(0, 130), m: (o && o.method) || 'GET', t: Math.round(performance.now()) };
      return OF.apply(this, arguments).then(function (r) { rec.st = r.status; window.__wslog.push(rec); return r; }, function (e) { rec.st = 'ERR ' + String(e).slice(0, 60); window.__wslog.push(rec); throw e; });
    };
  } catch (e) {}
  var base = CONFIG.base.replace(/\/+$/, "");
  var token = CONFIG.token;

  


  // ── 网页版“打开文件夹”降级：弹出路径卡片（浏览器无法启动系统文件管理器）──
  function _showLocalPathModal(path) {
    try {
      var old = document.getElementById("hermes-web-path-modal");
      if (old && old.parentNode) old.parentNode.removeChild(old);
    } catch (e) {}
    var pathText = String(path == null ? "" : path);
    var ov = document.createElement("div");
    ov.id = "hermes-web-path-modal";
    ov.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
    var card = document.createElement("div");
    card.style.cssText = "max-width:560px;width:100%;border-radius:12px;padding:20px 22px;background:var(--ui-bg-elevated,#26262b);color:var(--ui-text-primary,#e8e8e8);border:1px solid var(--ui-stroke-secondary,rgba(255,255,255,.14));box-shadow:0 12px 40px rgba(0,0,0,.35)";
    var title = document.createElement("div");
    title.style.cssText = "font-size:15px;font-weight:600;margin-bottom:10px";
    title.textContent = "文件夹路径";
    var hint = document.createElement("div");
    hint.style.cssText = "font-size:12px;line-height:1.6;color:var(--ui-text-secondary,#b0b0b5);margin-bottom:12px";
    hint.textContent = "网页版无法直接打开文件管理器，请在 fnOS 文件管理器中访问以下路径：";
    var box = document.createElement("div");
    box.style.cssText = "font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;line-height:1.7;word-break:break-all;background:var(--ui-bg-primary,#1b1b1f);border:1px solid var(--ui-stroke-tertiary,rgba(255,255,255,.08));border-radius:8px;padding:10px 12px;margin-bottom:14px;user-select:text";
    box.textContent = pathText || "(无路径)";
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.style.cssText = "padding:6px 14px;font-size:12.5px;border-radius:8px;border:1px solid var(--ui-stroke-secondary,rgba(255,255,255,.18));background:transparent;color:inherit;cursor:pointer";
    copyBtn.textContent = "复制路径";
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.style.cssText = "padding:6px 14px;font-size:12.5px;border-radius:8px;border:none;background:var(--ui-accent,#4c8dff);color:#fff;cursor:pointer";
    closeBtn.textContent = "关闭";
    function close() { try { if (ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {} }
    function legacyCopy(txt) {
      try {
        var ta = document.createElement("textarea");
        ta.value = txt;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        copyBtn.textContent = "已复制";
        setTimeout(function () { copyBtn.textContent = "复制路径"; }, 1200);
      } catch (e) {}
    }
    copyBtn.onclick = function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(pathText).then(function () {
            copyBtn.textContent = "已复制";
            setTimeout(function () { copyBtn.textContent = "复制路径"; }, 1200);
          }, function () { legacyCopy(pathText); });
        } else legacyCopy(pathText);
      } catch (e) { legacyCopy(pathText); }
    };
    closeBtn.onclick = close;
    ov.addEventListener("click", function (ev) { if (ev.target === ov) close(); });
    row.appendChild(copyBtn);
    row.appendChild(closeBtn);
    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(box);
    card.appendChild(row);
    ov.appendChild(card);
    document.body.appendChild(ov);
  }

  function wsUrlFor() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + base + "/api/ws?token=" + encodeURIComponent(token);
  }

  function mkConnection() {
    return {
      baseUrl: base,
      isFullscreen: false,
      mode: "local",
      authMode: "token",
      nativeOverlayWidth: 0,
      token: token,
      wsUrl: wsUrlFor(),
      logs: [],
      source: "env",
      windowButtonPosition: null,
      profile: CONFIG.profile || undefined,
    };
  }

  var _pickedFiles = [];
  var _pickSeq = 0;
  var _usedFakePaths = {};
    function _fakeWinPath(name) {
          // Windows 盘符样式假绝对路径：SPA 见 win 路径 + 网关 POSIX cwd 判为远程，
          // 才会附带 data_url 上传（网关落盘 attachments/）；POSIX 样式路径会被当
          // 网关本地文件直传路径 → "file not found on gateway and no data_url provided"。
          var raw = String(name || 'attachment').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'attachment';
          var dir = 'C:\\Users\\Hermes\\Attachments\\';
          var p = dir + raw;
          if (!_usedFakePaths[p]) { _usedFakePaths[p] = 1; return p; }
          var stem = raw.replace(/\.[^.]*$/, ''), ext = raw.slice(stem.length), k = 2;
          while (_usedFakePaths[(p = dir + stem + ' (' + (k++) + ')' + ext)]) {}
          _usedFakePaths[p] = 1;
          return p;
        }
        function _pickInput(opts) {
    return new Promise(function (resolve) {
      try {
        var input = document.createElement('input');
        input.type = 'file';
        input.multiple = !!(opts && opts.multiple);
        if (opts && opts.directory) input.webkitdirectory = true;
        if (opts && opts.filters && opts.filters.length) {
          var exts = [];
          opts.filters.forEach(function (fl) { (fl.extensions || []).forEach(function (x) { exts.push('.' + x); }); });
          if (exts.length) input.accept = exts.join(',');
        }
        input.style.display = 'none';
        document.body.appendChild(input);
        function cleanup() { try { document.body.removeChild(input); } catch (e) {} }
        input.addEventListener('change', function () {
          var paths = [];
          Array.prototype.forEach.call(input.files || [], function (file) {
            var id = _fakeWinPath(file.webkitRelativePath || file.name);
            _pickedFiles.push({ id: id, path: id, file: file });
            paths.push(id);
          });
          cleanup();
          resolve(paths.length ? paths : null);
        });
        input.addEventListener('cancel', function () { cleanup(); resolve(null); });
        // iOS Safari refuses .click() on hidden (display:none) inputs. Make it
        // briefly visible, trigger the click, then hide again — the picker opens
        // regardless of whether the element is visible at click time.
        input.style.display = 'block';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        setTimeout(function () { input.click(); }, 50);
      } catch (e) { resolve(null); }
    });
  }
  function _findPicked(id) {
    for (var i = 0; i < _pickedFiles.length; i++) if (_pickedFiles[i].id === id) return _pickedFiles[i].file;
    // 兼容按文件名/路径匹配（拖放文件可能直接传 file.name 或本地路径）
    for (var j = 0; j < _pickedFiles.length; j++) {
      var n = _pickedFiles[j].file && _pickedFiles[j].file.name;
      if (n && (n === id || (id && id.indexOf(n) >= 0) || (n && n.indexOf(String(id).replace(/^.*[\\/]/, '')) >= 0))) return _pickedFiles[j].file;
    }
    return null;
  }
  function _readFile(file, asDataUrl) {
    return new Promise(function (resolve) {
      if (!file) return resolve(null);
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { resolve(null); };
      if (asDataUrl) reader.readAsDataURL(file); else reader.readAsText(file);
    });
  }

  var core = {
    // ── 文件/文件夹选择（web 版用 <input type=file>，选中文件以 webpick_ id 关联，读取时按 id 取内容）──
    selectPaths: function (opts) { return _pickInput(opts); },
    selectSavePath: function (opts) { return Promise.resolve((opts && opts.defaultPath) || 'download'); },
    getPathForFile: function (file) {
      if (file && (file.name || file instanceof Blob)) {
        var pid = _fakeWinPath(file.name);
        _pickedFiles.push({ id: pid, path: pid, file: file });
        return pid;
      }
      return '';
    },
    readFileDataUrl: function (id) { return _readFile(_findPicked(id), true); },
    readFileDataUrlForAttach: function (id) { return _readFile(_findPicked(id), true); },
    // ── 图片保存（web 版：内存暂存 Blob + 假 Windows 路径；返回的假路径驱动 SPA
    //    按「远程文件」处理，发送时走 readFileDataUrlForAttach 取 data_url，网关落盘
    //    会话附件目录——与文件上传同一链路）
    //    契约（对照 bundle 调用点）：saveImageBuffer(uint8Array, ext, name)
    //    e.arrayBuffer() → new Uint8Array → saveImageBuffer(n, UVe(e)="​.png", e.name)
    //    返回假路径字符串；falsy 时 SPA 弹「无法将图片写入磁盘」
    saveImageBuffer: function (buffer, ext, name) {
      return Promise.resolve().then(function () {
        var blob = null
        var b = buffer
        try {
          if (b && b.byteLength !== undefined) {
            var u8 = b instanceof ArrayBuffer ? new Uint8Array(b) : b
            var kind = String(ext || 'png').replace(/^\./, '').toLowerCase()
            var mime = /^image\//.test(kind) ? kind : 'image/' + (kind || 'png')
            blob = new Blob([u8], { type: mime })
          } else if (typeof b === 'string') {
            var m2 = /^data:([a-z0-9.+-]+);base64,(.*)$/.exec(b)
            var b64 = m2 ? m2[2] : b
            var bin = atob(b64)
            var arr2 = new Uint8Array(bin.length)
            for (var k2 = 0; k2 < bin.length; k2++) arr2[k2] = bin.charCodeAt(k2)
            blob = new Blob([arr2], { type: (m2 && m2[1]) || 'image/png' })
          } else if (b instanceof Blob) {
            blob = b
          }
        } catch (e3) { return '' }
        if (!blob || !blob.size) return ''
        var rawName = String(name || ('image-' + (++_pickSeq) + (ext || '.png')))
          .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120)
        if (!rawName) rawName = 'image-' + _pickSeq + '.png'
        var pid = _fakeWinPath(rawName)
        _pickedFiles.push({ id: pid, path: pid, file: blob })
        return pid
      })
    },
    // 从系统剪贴板取图片：仅 secure context（https/localhost）可用；
    // 非安全上下文（LAN http）下诚实返回 null → UI 提示「剪贴板中没有图片」，
    // 用户改走编辑器 Ctrl+V 粘贴（paste 事件自带图片项，同一条保存链）。
    saveClipboardImage: function () {
      var nav = navigator.clipboard
      if (!nav || typeof nav.read !== 'function') return Promise.resolve(null)
      return nav.read().then(function (items) {
        for (var i = 0; i < items.length; i++) {
          var types = items[i].types || []
          for (var j = 0; j < types.length; j++) {
            if (String(types[j]).indexOf('image') === 0) {
              return items[i].getType(types[j]).then(function (blob) {
                if (!blob || !blob.size) return null
                var pid = _fakeWinPath('clipboard-' + Date.now() + '.png')
                _pickedFiles.push({ id: pid, path: pid, file: blob })
                return pid
              })
            }
          }
        }
        return null
      }).catch(function () { return null })
    },
    // 文件下载（浏览器模式）：Electron 用原生保存对话框，web 里改为从网关拉流 + <a download> 保存。
    // 必须实现：未实现会落到 makeFallback 兜底 → Promise.resolve(null) → 调用方
    // （media-*.js 里包装 saveGatewayFile 的下载函数）读 .saved 抛
    // "Cannot read properties of null (reading saved)"（2026-10-10 实测：聊天里点下载即报此错）。
    saveGatewayFile: function (opts) {
      opts = opts || {};
      var p = String(opts.path || "");
      if (!p) return Promise.reject(new Error("saveGatewayFile: path is required"));
      var name = String(opts.suggestedName || "");
      var parts = name.split("\\").join("/").split("/");
      var baseName = parts.filter(Boolean).pop() || "download";
      var prof = opts.profile || (CONFIG && CONFIG.profile) || "";
      var q = "path=" + encodeURIComponent(p);
      var url;
      if (opts.sessionId || prof) {
        if (prof) q += "&profile=" + encodeURIComponent(prof);
        if (opts.sessionId) q += "&session_id=" + encodeURIComponent(opts.sessionId);
        url = base + "/api/fs/download?" + q;
      } else {
        url = base + "/api/files/download?" + q;
      }
      return fetch(url, {
        headers: { "X-Hermes-Session-Token": token },
        credentials: "include",
      }).then(function (r) {
        if (r.ok) return r.blob();
        return r.text().catch(function () { return ""; }).then(function (t) {
          throw new Error("HTTP " + r.status + (t ? " " + String(t).slice(0, 200) : ""));
        });
      }).then(function (blob) {
        var objUrl = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = objUrl;
        a.download = baseName;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          try { document.body.removeChild(a); } catch (e) {}
          try { URL.revokeObjectURL(objUrl); } catch (e) {}
        }, 2000);
        return { ok: true, saved: true, canceled: false, path: p, name: baseName, byteSize: blob.size };
      });
    },
    saveImageFromUrl: function (url) {
      return Promise.resolve(fetch(url)).then(function (r) {
        if (!r.ok) return ''
        return r.blob()
      }).then(function (blob) {
        if (!blob || !blob.size) return ''
        var fname = String((url.split('/').pop() || '').split('?')[0] || ('img-' + (++_pickSeq) + '.png')).slice(0, 120) || ('img-' + _pickSeq + '.png')
        var pid = _fakeWinPath(fname)
        _pickedFiles.push({ id: pid, path: pid, file: blob })
        return pid
      }).catch(function () { return '' })
    },
    readClipboard: function () {
      var nav = navigator.clipboard
      if (!nav || typeof nav.readText !== 'function') return Promise.resolve(null)
      return nav.readText().catch(function () { return null })
    },
    requestMicrophoneAccess: function () { return Promise.resolve(false) },
    openSessionWindow: function (sessionId) {
      try {
        var base = window.location.href.split('#')[0];
        var url = base + '#/' + encodeURIComponent(String(sessionId || ''));
        window.open(url, '_blank');
        return Promise.resolve({ ok: true });
      } catch (e) { return Promise.resolve({ ok: false, error: String(e) }); }
    },
    openWindow: function () {
      try { window.open(window.location.href, '_blank'); return Promise.resolve({ ok: true }); }
      catch (e) { return Promise.resolve({ ok: false, error: String(e) }); }
    },
    openSessionInTerminal: function () {
      return Promise.resolve({ ok: false, error: 'web 版不支持在终端中打开会话' });
    },
    // ── 版本信息（关于页「版本号」显示；值由 monitor 注入 __HERMES_WEB_CONFIG__）──
    getVersion: function () {
      var cfg = {};
      try { cfg = (typeof window !== "undefined" && window.__HERMES_WEB_CONFIG__) || CONFIG || {}; } catch (e) {}
      return Promise.resolve({
        appVersion: cfg.appVersion || null,
        electronVersion: "",
        nodeVersion: "",
        platform: "web",
        hermesRoot: cfg.hermesRoot || "",
      });
    },
    // ── 核心:JSON REST(经 monitor 同源代理) ──
    api: function (request) {
      var path = request && request.path ? request.path : "";
      var opts = {
        method: request.method || "GET",
        headers: { "X-Hermes-Session-Token": token },
      };
      if (request.body !== undefined && request.body !== null) {
        opts.method = request.method || "POST";
        if (typeof request.body === "string") {
          opts.body = request.body;
          opts.headers["Content-Type"] = request.headers && request.headers["Content-Type"] ? request.headers["Content-Type"] : "text/plain";
        } else {
          opts.body = JSON.stringify(request.body);
          opts.headers["Content-Type"] = "application/json";
        }
      }
      if (request.timeoutMs) {
        try { opts.signal = AbortSignal.timeout(request.timeoutMs); } catch (e) {}
      }
      return fetch(base + path, opts).then(function (res) {
        if (path === "/api/config") {
          return res.clone().json().then(function (d) {
            if (d && typeof d === "object" && (!d.display || !d.display.language)) {
              d = Object.assign({}, d, { display: Object.assign({}, d.display, { language: "zh" }) });
            }
            return d;
          });
        }
        if (!res.ok) {
          if (path === "/api/config") { return { display: { language: "zh" } }; }
          // 会话 404(重装后旧会话 ID 残留):返回空,不报错不刷屏
          if (res.status === 404 && /\/api\/sessions\//.test(path)) {
            return { session: null, messages: [], sessions: [] };
          }
          var err = new Error("HTTP " + res.status + " " + res.statusText);
          err.status = res.status;
          throw err;
        }
        return res.json().catch(function () {
          return path === "/api/config" ? { display: { language: "zh" } } : {};
        });
      });
    },

    // ── 连接 ──
    getConnection: function () { return Promise.resolve(mkConnection()); },
    getConnectionFor: function () { return Promise.resolve(mkConnection()); },
    getGatewayWsUrl: function () { return Promise.resolve({ ok: true, wsUrl: wsUrlFor() }); },
    getGatewayWsUrlFor: function () { return Promise.resolve({ ok: true, wsUrl: wsUrlFor() }); },
    getConnectionConfig: function () {
      return Promise.resolve({
        envOverride: false, mode: "local", profile: CONFIG.profile || null,
        remoteAuthMode: "token", remoteOauthConnected: false, remoteTokenPreview: null,
        remoteTokenSet: false, secureTokenStorage: false, remoteTokenPlainText: false,
        remoteUrl: "", cloudOrg: "", sshHost: "", sshUser: "", sshPort: null,
        sshKeyPath: "", sshRemoteHermesPath: "", sshRemoteProfile: "",
      });
    },
    getProfileRoutes: function () { return Promise.resolve({}); },
    revalidateConnection: function () { return Promise.resolve(mkConnection()); },
    touchBackend: function () { return Promise.resolve({ ok: true }); },
    getAgentRoster: function () { return Promise.resolve([]); },
    getActiveProfile: function () { return Promise.resolve({ profile: CONFIG.profile || null }); },

    // ── 连接配置(web 仅支持当前注入连接) ──
    testConnectionConfig: function (cfg) {
      var u = cfg && cfg.baseUrl ? cfg.baseUrl : base;
      return fetch(u + "/api/health", { headers: { "X-Hermes-Session-Token": token }, signal: AbortSignal.timeout(8000) })
        .then(function (r) { return r.ok ? { reachable: true, authMode: "unknown", latency_ms: 0 } : { reachable: false, authMode: "unknown", error: "HTTP " + r.status }; })
        .catch(function (e) { return { ok: false, error: e.message }; });
    },
    probeConnectionConfig: function () {
      // 0.21.x 前端启动就绪检查依赖本探测；真实探测 dashboard 健康端点（经 monitor 同源代理）
      return fetch(base + "/api/health", { cache: "no-store" })
        .then(function (r) { return { reachable: r.ok, authMode: "token" }; })
        .catch(function () { return { reachable: false, authMode: "unknown" }; });
    },
    applyConnectionConfig: function () { return Promise.resolve(mkConnection()); },
    oauthLoginConnectionConfig: function () { return Promise.resolve({ ok: false, error: "web: OAuth login unavailable" }); },
    oauthLogoutConnectionConfig: function () { return Promise.resolve({ ok: true }); },
    saveConnectionConfig: function () { return Promise.resolve({ ok: true }); },
    sshConfigHosts: function () { return Promise.resolve({ hosts: [] }); },

    // ── 浏览器能力 ──
    openExternal: function (url) { window.open(url, "_blank"); return Promise.resolve(); },
    // 打开文件夹 / 在文件管理器中显示：web 版降级为路径卡片
    openDir: function (dir) { try { _showLocalPathModal(dir); } catch (e) {} return Promise.resolve({ ok: true }); },
    showItemInFolder: function (p) { try { _showLocalPathModal(p); } catch (e) {} return Promise.resolve({ ok: true }); },
    revealItemInFolder: function (p) { try { _showLocalPathModal(p); } catch (e) {} return Promise.resolve({ ok: true }); },
    desktopPluginsRoot: function () {
      var home = (CONFIG && CONFIG.home) || "";
      return home ? home + "/desktop-plugins" : null;
    },
    notify: function (payload) {
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification((payload && payload.title) || "Hermes", { body: payload && payload.body });
        }
      } catch (e) {}
      return Promise.resolve(true);
    },
    log: function (level, msg) { try { console[level] ? console[level]("[hermes-web]", msg) : console.log("[hermes-web]", msg); } catch (e) {} return Promise.resolve(); },
    writeClipboard: function (text) {
      try { if (navigator.clipboard) navigator.clipboard.writeText(String(text)); } catch (e) {}
      return Promise.resolve();
    },
    getBootProgress: function () { return Promise.resolve({ phase: "ready", progress: 1, label: "" }); },
    emitBootstrapEvent: function () { return Promise.resolve(); },
    continueBootstrapLocal: function () { return Promise.resolve({ ok: true }); },

    // ── 窗口/UI 状态(web 单窗口,返回默认) ──
    lastSessionId: function () { return Promise.resolve(null); },
    lastRoute: function () { return Promise.resolve(null); },
    zoom: {
      get: function () { return Promise.resolve({ percent: 1 }); },
      setPercent: function () { return Promise.resolve(); },
      set: function () { return Promise.resolve(); },
      onChanged: function () { return function () {}; },
    },
    // 错误恢复页的"修复安装":触发 monitor 重启 gateway+dashboard(后端修复)
    // 注意:/api/app/* 是 monitor 级路由,不走 /proxy/dashboard 代理
    repairBootstrap: function () {
      return fetch("/api/app/repair", {
        method: "POST",
        headers: { "X-Monitor-Token": token },
        signal: AbortSignal.timeout(15000),
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (d && d.ok) { setTimeout(function () { location.reload(); }, 4000); }
          return d || {};
        })
        .catch(function (e) { return { ok: false, error: e.message }; });
    },
    resetBootstrap: function () { setTimeout(function () { location.reload(); }, 300); return Promise.resolve(); },
    getWindowState: function () { return Promise.resolve({ isFullscreen: false, isMinimized: false, isVisible: true, nativeOverlayWidth: 0, windowButtonPosition: null }); },
    setWindowState: function () { return Promise.resolve(); },
    getUserTheme: function () { return Promise.resolve({}); },
    setUserTheme: function () { return Promise.resolve(); },
    translucency: function () { return Promise.resolve(false); },
    layoutTree: function () { return Promise.resolve(null); },
    userPlacedPanes: function () { return Promise.resolve([]); },
    sessionListDensity: function () { return Promise.resolve(null); },
    pinnedSessions: function () { return Promise.resolve([]); },
    unreadFinishedSessions: function () { return Promise.resolve([]); },
    sidebarGrouping: function () { return Promise.resolve(null); },
    previewTabs: function () { return Promise.resolve([]); },
    composerPopout: function () { return Promise.resolve(); },
    composer: function () { return Promise.resolve(null); },
    inflightTurnJournal: function () { return Promise.resolve({}); },
    json: function () { return Promise.resolve(null); },
    claimAmbientCue: function () { return Promise.resolve(null); },

    // ── 降级:文件/终端/桌面特有(嵌套对象统一走 nested 定义,带嵌套 Proxy) ──
    workspace: function () { return Promise.resolve({ path: "", exists: false }); },
    writeTextFile: function () { return Promise.resolve(); },
    trashPath: function () { return Promise.resolve(); },
    watchDirectory: function () { return Promise.resolve(function () {}); },
    gitRoot: function () { return Promise.resolve(null); },
    findInPage: function () { return Promise.resolve(); },
    repo_scan_enabled: function () { return Promise.resolve(false); },
    repo_scan_roots: function () { return Promise.resolve([]); },
    repo_scan_exclude_paths: function () { return Promise.resolve([]); },
  };

  // 万能兜底:既是可调用函数(返回 null),又能任意属性访问(返回新的兜底)。
  // 解决 renderer 对未定义键做 updates.onProgress() 这类调用时的崩溃
  // (未定义键兜底成函数后 .onProgress 为 undefined → "xxx is not a function")。
  function makeFbObj() {
    var o = function () {};
    o.toString = function () { return ""; };
    o[Symbol.toPrimitive] = function () { return ""; };
    o[Symbol.iterator] = function () { return [][Symbol.iterator](); };
    return new Proxy(o, {
      get: function (t, prop) { if (prop in t) return t[prop]; return makeFbObj(); },
      apply: function () { return Promise.resolve(makeFbObj()); },
    });
  }
  function makeFallback() {
    var fn = function () { return Promise.resolve(null); };
    fn.toString = function () { return ""; };
    fn[Symbol.toPrimitive] = function () { return ""; };
    fn[Symbol.iterator] = function () { return [][Symbol.iterator](); };
    return new Proxy(fn, {
      get: function (t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop === "string" && /^on[A-Z]/.test(prop)) {
          return function () { return function () {}; };
        }
        return makeFallback();
      },
      apply: function () { return Promise.resolve(null); },
      construct: function () { return makeFallback(); },
    });
  }

  // 显式定义 renderer 高频访问的嵌套对象(含 updates 复数键,renderer 用
  // hermesDesktop.updates.onProgress/subscribe/check)
  var nested = {
    fs: { readDir: function () { return Promise.resolve([]); }, readFileText: function (id) { return _readFile(_findPicked(id), false); }, writeTextFile: function () { return Promise.resolve(); } },
    git: { listBranches: function () { return Promise.resolve([]); } },
    terminal: { list: function () { return Promise.resolve([]); } },
    hud: { open: function () { return Promise.resolve({}); }, close: function () { return Promise.resolve(); }, getState: function () { return Promise.resolve(false); }, setIgnoreMouse: function () { return Promise.resolve(); }, moveBy: function () { return Promise.resolve(); }, setBounds: function () { return Promise.resolve(); }, setVibrancy: function () { return Promise.resolve(false); }, setSession: function () { return Promise.resolve(); }, onChanged: function () { return function () {}; }, onGoto: function () { return function () {}; }, onCursor: function () { return function () {}; } },
    petOverlay: { open: function () { return Promise.resolve({}); }, close: function () { return Promise.resolve(); }, getState: function () { return Promise.resolve(false); }, setBounds: function () { return Promise.resolve(); }, setIgnoreMouse: function () { return Promise.resolve(); }, setFocusable: function () { return Promise.resolve(); }, pushState: function () { return Promise.resolve(); }, onState: function () { return function () {}; }, onControl: function () { return function () {}; } },
    wakeIndicator: { getState: function () { return Promise.resolve(false); }, setState: function () { return Promise.resolve(); }, onState: function () { return function () {}; } },
    _parseReleaseCommits: function (body) {
      var out = [];
      try {
        var lines = String(body || "").split("\n");
        for (var i = 0; i < lines.length; i++) {
          var ln = (lines[i] || "").trim();
          if (ln.indexOf("-") === 0 || ln.indexOf("•") === 0) {
            var txt = ln.replace(/^[-\u2022]\s*/, "").trim();
            if (txt) out.push({ sha: "release-" + i, summary: txt });
          }
        }
      } catch (e) {}
      return out;
    },
    updates: {
      getStatus: function () {
        var v = "";
        var base = (CONFIG && CONFIG.base) ? CONFIG.base : "/proxy/dashboard";
        var url = base.replace(/\/+$/, "") + "/api/app/update/check";
        function fallback() { return { appVersion: v, currentVersion: v, currentSha: null, branch: null, behind: 0, updateAvailable: false, supported: true }; }
        try {
          return fetch(url, { headers: { "X-Hermes-Session-Token": token } })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (d) {
              var ver = (d && d.current) ? d.current : v;
              var _cm = (this && this._parseReleaseCommits) ? this._parseReleaseCommits(d && d.body) : [];
              return { appVersion: ver, currentVersion: ver, currentSha: (d && d.sha) || null, branch: (d && d.branch) || null, behind: (d && d.behind) || 0, commits: _cm, updateAvailable: !!(d && d.updateAvailable), supported: true };
            })
            .catch(function () { return fallback(); });
        } catch (e) { return Promise.resolve(fallback()); }
      },
      onProgress: function () { return Promise.resolve(); },
      subscribe: function () { return function () {}; },
      check: function () {
        var base = (CONFIG && CONFIG.base) ? CONFIG.base : "/proxy/dashboard";
        var url = base.replace(/\/+$/, "") + "/api/app/update/check";
        var fallback = { updateAvailable: false, supported: true, branch: null, currentSha: null, behind: 0, fetchedAt: Date.now() };
        try {
          return fetch(url, { headers: { "X-Hermes-Session-Token": token } })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (d) {
              return {
                updateAvailable: !!(d && d.updateAvailable),
                currentVersion: (d && d.current) || null,
                latestVersion: (d && d.latest) || null,
                branch: (d && d.branch) || null,
                currentSha: (d && d.sha) || null,
                behind: (d && d.behind) || 0,
                commits: this._parseReleaseCommits ? this._parseReleaseCommits(d && d.body) : [],
                supported: true,
                fetchedAt: Date.now(),
              };
            })
            .catch(function () { return fallback; });
        } catch (e) { return Promise.resolve(fallback); }
      },
      install: function (status) { return this.apply ? this.apply(status) : Promise.resolve({ ok: false, error: "unavailable" }); },
      list: function () { return Promise.resolve([]); },
      updateAll: function () { return Promise.resolve(); },
      remove: function () { return Promise.resolve(); },
      setPrimary: function () { return Promise.resolve(); },
      apply: function (status) {
        var base = (CONFIG && CONFIG.base) ? CONFIG.base : "/proxy/dashboard";
        var b = base.replace(/\/+$/, "");
        var ver = (status && (status.latestVersion || status.currentVersion)) || "";
        var hdrs = { "Content-Type": "application/json", "X-Hermes-Session-Token": token };
        function err(e) { return { ok: false, error: "apply-failed", message: String((e && e.message) || e || "update failed") }; }
        // ① 增量更新（hot-patch 链路，小包快更；无增量包时由后端返回"请完整安装"）
        function tryHotPatch() {
          try {
            return fetch(b + "/api/app/hot-patch", { method: "POST", headers: hdrs, body: "{}" })
              .then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (d) {
                if (d && d.ok) return { ok: true, handedOff: true, mode: d.mode || "patch", message: (d && d.note) || "" };
                var msg = (d && d.error) || "";
                // 无增量包 → 回退完整包全量更新
                if (/\u65e0\u70ed\u66f4\u65b0|\u5b8c\u6574\u5b89\u88c5|404/.test(msg)) return tryFull();
                return { ok: false, error: "apply-failed", message: msg || "hot patch failed" };
              })
              .catch(function () { return tryFull(); });
          } catch (e) { return Promise.resolve(tryFull()); }
        }
        // ② 完整包兜底（auto-update，224MB 全量）
        function tryFull() {
          var body = { source: "auto" };
          if (ver) body.version = ver;
          try {
            return fetch(b + "/api/app/auto-update", {
              method: "POST",
              headers: hdrs,
              body: JSON.stringify(body),
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (d) {
                if (d && d.ok) return { ok: true, handedOff: true, mode: "full", message: (d && d.note) || "" };
                return { ok: false, error: "apply-failed", message: (d && d.error) || "update failed" };
              })
              .catch(function (e) { return err(e); });
          } catch (e) { return Promise.resolve(err(e)); }
        }
        return tryHotPatch();
      },
      run: function (status) { return this.apply ? this.apply(status) : Promise.resolve({ ok: false, error: "unavailable" }); },
      test: function () { return Promise.resolve(); },
      save: function () { return Promise.resolve(); },
      emit: function () { return Promise.resolve(); },
    },
    quickEntry: { get: function () { return Promise.resolve(null); }, onToggle: function () { return function () {}; } },
    themeMarketplace: { list: function () { return Promise.resolve([]); }, install: function () { return Promise.resolve(); } },
    cloud: { login: function () { return Promise.resolve({ signedIn: false, error: "web: 未配置云端登录" }); }, logout: function () { return Promise.resolve({ signedIn: false }); }, signOut: function () { return Promise.resolve({ signedIn: false }); }, isSignedIn: function () { return Promise.resolve({ signedIn: false }); }, discover: function () { return Promise.resolve({ agents: [], org: null, needsOrgSelection: false }); }, agentSignIn: function () { return Promise.resolve(null); }, connect: function () { return Promise.resolve({ ok: false, error: "web: 不可用" }); } },
    capabilities: {},
    composerPopout: {},
    composer: {},
    uninstall: {
      summary: function () { return Promise.resolve({ hermes_home: "", agent_installed: false, gui_installed: true, source_built_artifacts: [], packaged_app_paths: [], userdata_dir: "", userdata_exists: true, platform: "web" }); },
      run: function () { return Promise.resolve({ ok: false, error: "web 版请在飞牛应用中心卸载" }); },
    },
    connections: {
      list: function () { return Promise.resolve({ version: 1, primary: "", secureTokenStorage: false, connections: [] }); },
      save: function () { return Promise.resolve({ ok: false, error: "web: 不支持保存连接" }); },
      remove: function () { return Promise.resolve({ ok: false }); },
      setPrimary: function () { return Promise.resolve({ ok: false }); },
      test: function () { return Promise.resolve({ ok: false, reachable: false, authMode: "unknown" }); },
      updateAll: function () { return Promise.resolve({ ok: true, results: [] }); },
      onChanged: function () { return function () {}; },
      onActiveConnectionInvalidated: function () { return function () {}; },
      get: function () { return Promise.resolve(null); },
      setActive: function () { return Promise.resolve(); },
    },
    themes: { list: function () { return Promise.resolve([]); }, get: function () { return Promise.resolve(null); }, set: function () { return Promise.resolve(); }, market: function () { return Promise.resolve({ themes: [] }); } },
    model: { get: function () { return Promise.resolve(null); }, set: function () { return Promise.resolve(); }, list: function () { return Promise.resolve([]); }, test: function () { return Promise.resolve({ ok: true }); } },
    coder: { get: function () { return Promise.resolve(null); }, set: function () { return Promise.resolve(); } },
    research: { get: function () { return Promise.resolve(null); }, set: function () { return Promise.resolve(); } },
    pet: { get: function () { return Promise.resolve(null); }, set: function () { return Promise.resolve(); } },
    git: { listBranches: function () { return Promise.resolve([]); }, getStatus: function () { return Promise.resolve(null); }, review: function () { return Promise.resolve(null); } },
    dataUrlReadMax: {
      get: function () { var v = parseInt(localStorage.getItem("hermes.web.dataUrlMaxMb") || "", 10); var cur = Number.isFinite(v) && v >= 1 ? v : 16; return Promise.resolve({ defaultMaxMb: 16, maxBytes: cur * 1024 * 1024, maxMb: cur }); },
      set: function (maxMb) { var m = Math.max(1, Math.min(512, Math.round(Number(maxMb) || 16))); try { localStorage.setItem("hermes.web.dataUrlMaxMb", String(m)); } catch (e) {} return Promise.resolve({ defaultMaxMb: 16, maxBytes: m * 1024 * 1024, maxMb: m }); },
    },
    settings: {
      getDefaultProjectDir: function () { return Promise.resolve({ dir: "" }); },
      get: function () { return Promise.resolve(null); },
      set: function () { return Promise.resolve(); },
      reset: function () { return Promise.resolve(); },
      getProjectDir: function () { return Promise.resolve({ dir: "" }); },
      pickDefaultProjectDir: function () { return Promise.resolve({ canceled: true, dir: null }); },
      getTheme: function () { return Promise.resolve({}); },
    },
    sanitizeWorkspaceCwd: function () { return Promise.resolve(""); },
    getDefaultProjectDir: function () { return Promise.resolve({ dir: "" }); },
    onBackendExit: function () { return function () {}; },
    onBootProgress: function () { return function () {}; },
    onBootstrapEvent: function () { return function () {}; },
    onConnectionApplied: function () { return function () {}; },
    onPowerResume: function () { return function () {}; },
    onPreviewFileChanged: function () { return function () {}; },
    onWindowStateChanged: function () { return function () {}; },
    onFoundInPage: function () { return function () {}; },
  };

  var proxied = new Proxy(core, {
    get: function (obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop in nested) return nested[prop];
      // 事件订阅方法(onXxx):返回"取消函数"(同步),renderer 用 const unsub = desktop.onXxx(cb); unsub()
      if (typeof prop === "string" && /^on[A-Z]/.test(prop)) {
        return function () { return function () {}; };
      }
      return makeFallback();
    },
  });

  // 嵌套对象的方法访问也走兜底(属性不存在时返回万能兜底,避免 .method() 崩溃)
  Object.keys(nested).forEach(function (k) {
    var base = nested[k];
    if (base && typeof base === "object" && !Array.isArray(base)) {
      nested[k] = new Proxy(base, {
        get: function (t, prop) {
          if (prop in t) return t[prop];
          if (typeof prop === "string" && /^on[A-Z]/.test(prop)) {
            return function () { return function () {}; };
          }
          return makeFallback();
        },
      });
    }
  });

  window.hermesDesktop = proxied;;
  window.__HERMES_WEB_SHIM_LOADED__ = true;
})();

// ═══ Desktop UI 汉化层（DOM 级，覆盖官方 i18n 未翻译的硬编码英文）═══
(function () {
  "use strict";
  var DICT = { 'Billing':'账单','Connect your Nous account':'连接你的 Nous 账户','Run /portal in the TUI or open the Nous portal to connect your account.':'在 TUI 中运行 /portal 或打开 Nous 门户以连接你的账户。','Open portal':'打开门户','Balance':'余额','Plan':'套餐','Auto-refill':'自动充值','No payment method on file':'未绑定支付方式','Add payment method':'添加支付方式','Buy credits now':'立即购买额度','Choose how much':'选择金额','Custom credit amount':'自定义额度金额','Back to billing':'返回账单','Payment & credits':'支付与额度','Usage':'用量','Free':'免费','credits/mo':'额度/月','No active subscription':'无有效订阅','Renews':'续费于','Changes to':'变更至','Cancels on':'取消于','Change plan':'更换套餐','View plans':'查看套餐','Subscription details are unavailable':'订阅详情不可用','Card confirmation needed':'需要卡片确认','Charge could not':'扣款失败','Check the portal':'请查看门户','Add one on the portal.':'请在门户上添加。','Top-up':'充值','auto-refill card':'自动充值卡','customer default':'客户默认','subscription card':'订阅卡','Remote Spending is allowed for this terminal.':'已允许此终端进行远程消费。','Verification complete':'验证完成','Auto-refill updated.':'自动充值已更新。','Auto-refill turned off.':'自动充值已关闭。','Verification finished without allowing Remote Spending for this terminal.':'验证已完成，但未允许此终端进行远程消费。','Verification was not approved':'验证未获批准','The billing service accepted the request but did not return a charge id.':'计费服务已接受请求但未返回扣款 ID。','Charge could not be tracked':'无法跟踪扣款','Add credits':'添加额度','Buy':'购买','Nous':'诺斯','Midnight':'午夜','Ember':'余烬','Mono':'单色','Cyberpunk':'赛博朋克','Slate':'石板蓝','Glass neutrals with Nous blue accents':'玻璃质感中性色，配诺斯蓝点缀','Deep blue-violet with cool accents':'深蓝紫色，冷色点缀','Warm crimson and bronze — forge vibes':'暖绯红与古铜，锻造氛围','Clean grayscale — minimal and focused':'纯净灰度，极简专注','Neon green on black — matrix terminal':'黑底霓虹绿，矩阵终端风','Cool slate blue — focused developer theme':'冷石板蓝，专注的开发者主题','Search your themes or the VS Code Marketplace...':'搜索你的主题或 VS Code 市场…','Search your themes or the VS Code Marketplace':'搜索你的主题或 VS Code 市场','Theme':'主题','Switch theme':'切换主题','Font':'字体','Theme default':'主题默认','Use the active theme\'s font':'使用当前主题的字体','Helpful':'乐于助人','Concise':'简洁','Technical':'技术向','Creative':'创意向','Teacher':'老师','Kawaii':'可爱','Catgirl':'猫娘','Pirate':'海盗','Shakespeare':'莎士比亚','Surfer':'冲浪手','Noir':'黑色电影','Uwu':'呜呜','Philosopher':'哲学家','Hype':'热血','None':'无','Manual':'手动','Smart':'智能','Off':'关闭','Project':'项目','Strict':'严格','Compressor':'压缩器','Default':'默认','Custom':'自定义','Auto':'自动','Native':'原始','Text':'文本','Local':'本地','Two-note comfort':'双音舒适','Glass ping':'玻璃提示音','Soft marimba':'轻柔马林巴','Tri-tone message':'三音消息','Airy whoosh':'轻快嗖声','Discovery cluster':'发现音组','Systems online':'系统上线','IBM terminal':'IBM 终端','Modem chirp':'调制解调器鸣叫','Wind chimes':'风铃','Terminal execution backend':'终端执行后端','Container image used when the execution backend is Docker.':'执行后端为 Docker 时使用的容器镜像。','Image used when the execution backend is Singularity.':'执行后端为 Singularity 时使用的镜像。','Image used when the execution backend is Modal.':'执行后端为 Modal 时使用的镜像。','Image used when the execution backend is Daytona.':'执行后端为 Daytona 时使用的镜像。','Docker':'Docker','Singularity':'Singularity','Modal':'Modal','Daytona':'Daytona','Browser engine for local mode: auto (default Chrome), lightpanda (faster, no screenshots), chrome':'本地模式浏览器引擎：auto（默认 Chrome）、lightpanda（更快，无截图）、chrome','Get Key':'获取密钥','Optional':'可选','Paste':'粘贴','AGENT BROWSER ENGINE':'智能体浏览器引擎','BRAVE SEARCH':'Brave 搜索','BROWSER USE':'浏览器使用','BROWSERBASE':'BrowserBase','ELEVENLABS':'ElevenLabs','EXA':'Exa','FAL':'Fal','FIRECRAWL':'Firecrawl','Toggle layout edit mode':'切换布局编辑模式','Keyboard Shortcuts':'键盘快捷键','Speech to Text':'语音转文字','Text to Speech':'文字转语音','Speech to text':'语音转文字','Text to speech':'文字转语音','Recording':'录音','Speech-To-Text Provider':'语音转文字提供方','Text-To-Speech Provider':'文字转语音提供方','Echo Transcripts':'回声转录','Post the raw transcript of voice messages back to the chat.':'将语音消息的原始转写文本发回会话。','Transcription Language':'转写语言','Transcription Model':'转写模型','Read Responses Aloud':'朗读回复','Voice Shortcut':'语音快捷键','Max Recording Length':'最长录音时长','System Default':'系统默认','Search...':'搜索…','Custom Endpoints':'自定义端点','Local custom endpoint':'本地自定义端点','Point at any compatible endpoint':'指向任意兼容端点','Open folder':'打开文件夹','Rescan':'重新扫描','Reveal in file manager':'在文件管理器中显示','Send test notification':'发送测试通知','Preview':'预览','Settings':'设置','Search':'搜索','Loading':'加载中','Save':'保存','Cancel':'取消','Apply':'应用','Reset':'重置','Delete':'删除','Edit':'编辑','Add':'添加','Remove':'移除','Enable':'启用','Disable':'停用','Enabled':'已启用','Disabled':'已停用','Connect':'连接','Connected':'已连接','Disconnected':'未连接','Update':'更新','Install':'安装','Uninstall':'卸载','Restart':'重启','Stop':'停止','Start':'启动','Running':'运行中','Stopped':'已停止','Test':'测试','Manage':'管理','Close':'关闭','Back':'返回','Next':'下一步','Previous':'上一步','Refresh':'刷新','Retry':'重试','Clear':'清除','Copy':'复制','Copy path':'复制路径','Show':'显示','Hide':'隐藏','Updated':'更新时间','Status':'状态','Profile':'配置档案','Created':'创建时间','Tokens':'令牌数','Cost':'成本','Open':'打开','Draft':'草稿','Merged':'已合并','Closed':'已关闭','No PR':'无 PR','Needs input':'需要输入','Working':'处理中','Unread':'未读','Idle':'空闲','Filters':'筛选器','Grouping':'分组','Ordering':'排序','Inbox style':'收件箱样式','Pull request':'拉取请求','Archived':'已归档','Reset to defaults':'恢复默认','Expand all':'全部展开','Collapse all':'全部收起','Mark all as read':'全部标为已读','All Configuration Profiles':'全部配置档案','Display':'显示','Danger zone':'危险操作区','Uninstall Hermes':'卸载 Hermes','Choose how much to remove. The app closes to finish the job; reopen the installer any time to come back.':'选择要移除的内容。应用会关闭以完成操作；随时重新打开安装程序即可恢复。','Uninstall Chat GUI only':'仅卸载聊天界面','Remove this desktop app. The Hermes agent, your config, and chats all stay.':'移除这个桌面应用。Hermes 智能体、你的配置和聊天记录都会保留。','Remove Hermes Agent and its data':'移除 Hermes 智能体及其数据','SESSIONS':'会话','BOTS':'机器人','CRONJOBS':'定时任务','Sessions':'会话','Bots':'机器人','Cronjobs':'定时任务','New Agent':'新建智能体','Search bots':'搜索机器人…','Create Cronjob':'创建定时任务','Search bots to add':'搜索要添加的机器人','A named teammate with its own memory, skills, and chat.':'一个拥有独立记忆、技能和聊天的命名队友。','No custom endpoints':'暂无自定义端点','Add an OpenAI-compatible endpoint below.':'在下方添加一个兼容 OpenAI 的端点。','Provider ID':'提供方 ID','Endpoint URL':'端点 URL','Default Model':'默认模型','Use for new chats':'用于新对话','Discover models':'发现模型','Tiny':'微小','Base':'基础','Small':'小','Medium':'中','Large-V3':'大 V3','Large':'大','Stash':'暂存','Discard':'丢弃','Afr':'非洲','Search':'搜索','zh-CN-XiaoxiaoNeural':'晓晓（女·温暖）','zh-CN-XiaoyiNeural':'晓伊（女·活泼）','zh-CN-YunxiNeural':'云希（男·阳光）','zh-CN-YunjianNeural':'云健（男·沉稳）','zh-CN-YunxiaNeural':'云夏（男·少年）','zh-CN-YunyangNeural':'云扬（男·新闻）','zh-CN-liaoning-XiaobeiNeural':'晓北（女·东北）','zh-CN-shaanxi-XiaoniNeural':'晓妮（女·陕西）','zh-CN-XiaomoNeural':'晓墨（女·多风格）','zh-CN-XiaohanNeural':'晓涵（女·温柔）','zh-CN-XiaomengNeural':'晓梦（女·甜美）','zh-CN-XiaoxuanNeural':'晓萱（女·儿童）','zh-CN-XiaoyanNeural':'晓颜（女·儿童）','zh-TW-HsiaoChenNeural':'曉臻（女·台湾）','zh-TW-HsiaoYuNeural':'曉雨（女·台湾）','zh-HK-HiuGaaiNeural':'曉佳（女·粤语）','zh-HK-HiuMaanNeural':'曉曼（女·粤语）','zh-HK-WanLungNeural':'雲龍（男·粤语）','en-US-AriaNeural':'Aria（英文女声）','en-US-JennyNeural':'Jenny（英文女声）','en-US-AndrewNeural':'Andrew（英文男声）','en-US-BrianNeural':'Brian（英文男声）','en-US-GuyNeural':'Guy（英文男声）','en-GB-SoniaNeural':'Sonia（英音女声）','Providers':'提供方','Provider':'提供方','API Keys':'API 密钥','Accounts':'账号','Gateway':'网关','Archived Chats':'已归档对话','About':'关于','Notifications':'通知','Plugins':'插件','Model':'模型','Chat':'对话','Appearance':'外观','Workspace':'工作区','Security':'安全','Memory & Context':'记忆与上下文','Voice':'语音','Advanced':'高级','Safety':'安全','Memory':'记忆','Conversation':'对话','Completion Sound':'完成提示音','Approval Mode':'审批模式','Code Execution Mode':'代码执行模式','Context Engine':'上下文引擎','Working Directory':'工作目录','Execution Backend':'执行后端','Command Timeout':'命令超时','Persistent Shell':'持久化 Shell','Environment Variable Passthrough':'环境变量透传','File Read Limit':'文件读取上限','Max Attachment Size':'最大附件大小','Image Attachments':'图片附件','Personality':'人格','Timezone':'时区','Reasoning Blocks':'推理过程块','Auto-detect':'自动检测','Enabled Toolsets':'启用的工具集','Tools':'工具','Keys':'密钥','Create Agent':'创建智能体','Generate':'生成','Upload':'上传','Pet':'宠物','Bot':'机器人','Pick a pet as this agent\'s profile picture.':'选择宠物作为此智能体的头像。','What should this Bot help with?':'这个机器人帮助做什么？','Name':'名称','Title':'标题','Description':'描述','Create':'创建','Could not load that pet — try another.':'无法加载该宠物——换一只试试。','Pin to top':'置顶','Hide Bot':'隐藏机器人','Edit Profile':'编辑资料','Manage groups...':'管理群组…','Duplicate':'复制','New chat with this agent':'与此智能体新开对话','New chat':'新开对话','Create Agent':'新建智能体' };
  var SKIP = { INPUT:1, TEXTAREA:1, SCRIPT:1, STYLE:1, CODE:1, PRE:1, SELECT:1, OPTION:1 };
  function translate(root, visited) {
    if (!root) return;
    visited = visited || [];
    if (visited.indexOf(root) >= 0) return;
    visited.push(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = w.nextNode())) {
      var t = n.nodeValue; if (!t) continue;
      var k = t.trim(); if (!k || !DICT[k] || k === DICT[k]) continue;
      var p = n.parentNode; if (!p || p.nodeType !== 1) continue;
      if (SKIP[p.tagName] || p.isContentEditable) continue;
      n.nodeValue = t.replace(k, DICT[k]);
    }
    // 递归翻译 Shadow DOM（官方 UI 部分组件用 shadowRoot）
    var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.shadowRoot) translate(el.shadowRoot, visited);
    }
  }
  function run() { try { translate(document.body); } catch (e) {} }
  var obs = null;
  function start() {
    if (obs) return;
    obs = new MutationObserver(function () {
      if (obs) obs.disconnect();
      try { run(); } catch (e) {}
      if (obs) obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(function () { try { translate(document.body); } catch (e) {} }, 500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { run(); start(); });
  } else { run(); start(); }
})();


// ═══ 关于页版本显示修复：把"版本不可用"替换为真实版本（从 update/check API）═══
(function () {
  "use strict";
  var VER = null, BRANCH = null, SHA = null;
  var tried = false;
  function getBase() {
    try { return (window.__HERMES_WEB_CONFIG__ && window.__HERMES_WEB_CONFIG__.base || '/proxy/dashboard').replace(/\/+$/, ''); } catch (e) { return '/proxy/dashboard'; }
  }
  function fetchVersion() {
    if (tried) return;
    tried = true;
    try {
      fetch(getBase() + '/api/app/update/check', {
        headers: { 'X-Hermes-Session-Token': (window.__HERMES_WEB_CONFIG__ && window.__HERMES_WEB_CONFIG__.token) || '' }
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (d && d.current) { VER = String(d.current); }
          if (d && d.branch) { BRANCH = String(d.branch); }
          if (d && d.sha) { SHA = String(d.sha); }
          if (VER || BRANCH || SHA) { applyVer(); }
        }).catch(function () {});
    } catch (e) {}
  }
  function applyVer() {
    if (!document.body) return;
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = w.nextNode())) {
      var t = n.nodeValue || '';
      if (VER && t.indexOf('版本不可用') >= 0) { n.nodeValue = t.replace('版本不可用', VER); }
      else if (VER && t.indexOf('Version unavailable') >= 0) { n.nodeValue = t.replace('Version unavailable', VER); }
      else if (t.indexOf('分支 unknown') >= 0) {
        n.nodeValue = t.replace(/分支 unknown · 提交 unknown/g, '分支 ' + (BRANCH || 'main') + ' · 提交 ' + (SHA || ''));
      }
      else if (t.indexOf('Branch unknown') >= 0) {
        n.nodeValue = t.replace(/Branch unknown · Commit unknown/g, 'Branch ' + (BRANCH || 'main') + ' · Commit ' + (SHA || ''));
      }
    }
  }
  var obs = null;
  function start() {
    if (obs) return;
    obs = new MutationObserver(function () { if (obs) obs.disconnect(); applyVer(); if (obs) obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(applyVer, 800);
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function () { fetchVersion(); start(); }); }
  else { fetchVersion(); start(); }
})();

// ═══ 移动端适配层（iOS 安全区 + 输入框防缩放 + 触摸优化）═══
(function () {
  "use strict";
  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (window.innerWidth || 0) <= 820;
  }
  function apply() {
    if (!isMobile()) return;
    var style = document.getElementById('hermes-mobile-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'hermes-mobile-style';
      document.head.appendChild(style);
    }
    // 1) iOS/Android 输入框 ≥16px，防止聚焦时页面自动缩放
    // 2) safe-area 适配：底部横条（iPhone）/ 刘海屏
    // 3) 聊天输入区贴底，不被手势条遮挡
    style.textContent = [
      'html,body{height:100%;overflow-y:auto;-webkit-text-size-adjust:100%;}',
      'input,textarea,select{font-size:16px!important;}',
      '@supports (padding: env(safe-area-inset-bottom)){',
      '  body{padding-bottom:env(safe-area-inset-bottom);}',
      '  .composer-shell,.composer{padding-bottom:calc(env(safe-area-inset-bottom) + 0.5rem)!important;}',
      '  .hud-root,.pet-root{bottom:env(safe-area-inset-bottom)!important;}',
      '}',
      '@supports (padding: constant(safe-area-inset-bottom)){',
      '  body{padding-bottom:constant(safe-area-inset-bottom);}',
      '}',
      // 移动端触控：增大可点区域、禁双击缩放
      'button,[role=button]{touch-action:manipulation;}',
      '*{-webkit-tap-highlight-color:transparent;}',
      // 移动端侧边栏抽屉全屏
      '@media (max-width: 640px){',
      '  .app-sidebar{width:min(85vw,20rem)!important;}',
      '}'
    ].join('\n');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else { apply(); }
  // 竖屏/横屏切换与窗口尺寸变化时重新应用（安全区数值会变）
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', function () { setTimeout(apply, 200); });
})();


// ═══ 时区搜索框 placeholder 修复：时区字段空值特判（placeholder=systemDefault）把
// 官方 SearchableSelect 的搜索框占位符也改成了"系统默认"，这里只修搜索框为"搜索时区…"
//（trigger 上"系统默认"的显示保留，符合"空值时显示系统默认"的预期）═══
(function () {
  "use strict";
  function fixTz() {
    try {
      var inputs = document.querySelectorAll('input[placeholder="系统默认"]');
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].placeholder === "系统默认") inputs[i].placeholder = "搜索时区…";
      }
    } catch (e) {}
  }
  fixTz();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fixTz);
  }
  var obsTz = null;
  try {
    obsTz = new MutationObserver(function () { fixTz(); });
    obsTz.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  setInterval(fixTz, 1200);
})();



// ═══ 宠物图片代理：petdex.dev 资产被 CORS/403 阻止，将 img src 替换为经 monitor 代理加载 ═══
(function () {
  "use strict";
  function getBase() {
    try { return (window.__HERMES_WEB_CONFIG__ && window.__HERMES_WEB_CONFIG__.base || '/proxy/dashboard').replace(/\/+$/, ''); } catch (e) { return '/proxy/dashboard'; }
  }
  function fixPets() {
    try {
      var imgs = document.querySelectorAll('img[src*="petdex.dev"]');
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].getAttribute('src') || '';
        if (src.indexOf('petdex.dev') >= 0 && src.indexOf('petdex-image') < 0) {
          imgs[i].setAttribute('src', getBase() + '/api/petdex-image?u=' + encodeURIComponent(src));
        }
      }
      // 宠物搜索框 placeholder（Search N pets... → 搜索 N 只宠物…）
      var inputs = document.querySelectorAll('input[placeholder]');
      for (var j = 0; j < inputs.length; j++) {
        var ph = inputs[j].getAttribute('placeholder') || '';
        var np = ph.replace(/^Search\s+([\d,]+)\s+pets\.\.\.?$/, '搜索 $1 只宠物…');
        if (np !== ph) inputs[j].setAttribute('placeholder', np);
      }
    } catch (e) {}
  }
  fixPets();
  var obsP = null;
  try {
    obsP = new MutationObserver(function () { fixPets(); });
    obsP.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  setInterval(fixPets, 1500);
})();  // [randomUUID-polyfill] 非安全上下文（LAN http）缺 crypto.randomUUID，
  // SPA 附件身份（createComposerAttachmentOccurrenceId）会抛 TypeError 被吞 →
  // 图片附件静默丢失。用 getRandomValues（非安全上下文可用）补 v4 UUID。
  try {
    if (window.crypto && typeof window.crypto.randomUUID !== 'function' &&
        typeof window.crypto.getRandomValues === 'function') {
      window.crypto.randomUUID = function () {
        var b = window.crypto.getRandomValues(new Uint8Array(16))
        b[6] = (b[6] & 0x0f) | 0x40
        b[8] = (b[8] & 0x3f) | 0x80
        var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0') }).join('')
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)
      }
    }
  } catch (e) {}

