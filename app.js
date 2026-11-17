import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import { analyzePlayable, extname, formatSize, guessChannel, isTextEntry } from "./checker-core.js";

const els = {
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  fileMeta: document.getElementById("fileMeta"),
  channelSelect: document.getElementById("channelSelect"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  guessHint: document.getElementById("guessHint"),
  summary: document.getElementById("summary"),
  results: document.getElementById("results"),
  mountBtn: document.getElementById("mountBtn"),
  portraitBtn: document.getElementById("portraitBtn"),
  landscapeBtn: document.getElementById("landscapeBtn"),
  narrowBtn: document.getElementById("narrowBtn"),
  clearRuntimeBtn: document.getElementById("clearRuntimeBtn"),
  runtimeStats: document.getElementById("runtimeStats"),
  frameShell: document.getElementById("frameShell"),
  runtimeFrame: document.getElementById("runtimeFrame"),
  runtimeLog: document.getElementById("runtimeLog"),
};

const state = {
  pkg: null,
  objectUrls: [],
  runtime: { error: 0, warn: 0, net: 0, raf: "-" },
};

bindEvents();
renderRuntimeStats();

function bindEvents() {
  els.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) await onFile(file);
  });

  ["dragenter", "dragover"].forEach((name) => {
    els.dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    els.dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("drag");
    });
  });
  els.dropzone.addEventListener("drop", async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) await onFile(file);
  });

  els.analyzeBtn.addEventListener("click", runAnalysis);
  els.mountBtn.addEventListener("click", mountSandbox);
  els.portraitBtn.addEventListener("click", () => setFrameSize(390, 844, "切到竖屏 390×844"));
  els.landscapeBtn.addEventListener("click", () => setFrameSize(844, 390, "切到横屏 844×390"));
  els.narrowBtn.addEventListener("click", () => setFrameSize(216, 384, "切到窄框 216×384"));
  els.clearRuntimeBtn.addEventListener("click", () => clearRuntimeLog("运行时日志已清空"));
  window.addEventListener("message", onRuntimeMessage);
}

async function onFile(file) {
  disableRuntimeControls();
  resetReport();
  els.analyzeBtn.disabled = true;
  els.guessHint.textContent = "正在解析文件...";
  els.fileMeta.className = "file-meta show";
  els.fileMeta.innerHTML = `<span>已选择：</span><span class="chip">${escapeHtml(file.name)}</span><span class="chip">${formatSize(file.size)}</span>`;

  try {
    state.pkg = await parseUploadedFile(file);
    els.analyzeBtn.disabled = false;
    const guessed = guessChannel(state.pkg);
    if (guessed.id) els.channelSelect.value = guessed.id;
    els.guessHint.textContent = guessed.id
      ? `自动猜测：${els.channelSelect.options[els.channelSelect.selectedIndex].text}（${guessed.reason}）`
      : guessed.reason;
  } catch (error) {
    state.pkg = null;
    els.guessHint.textContent = `解析失败：${error.message}`;
  }
}

async function parseUploadedFile(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    const text = await file.text();
    const entry = {
      path: file.name,
      size: new Blob([text]).size,
      ext: extname(file.name),
      text,
      bytes: new TextEncoder().encode(text),
    };
    return {
      isZip: false,
      uploadName: file.name,
      sizeBytes: file.size,
      entries: [entry],
      entryMap: new Map([[entry.path, entry]]),
      mainHtmlPath: entry.path,
      mainHtmlText: text,
      allText: text,
    };
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = [];
  const entryMap = new Map();
  const names = Object.keys(zip.files).sort((a, b) => a.localeCompare(b));

  for (const raw of names) {
    const item = zip.files[raw];
    if (item.dir) continue;
    const path = normalizePath(raw);
    const bytes = await item.async("uint8array");
    const ext = extname(path);
    const entry = { path, size: bytes.byteLength, ext, bytes, text: null };
    if (isTextEntry(path)) entry.text = decodeUtf8(bytes);
    entries.push(entry);
    entryMap.set(path, entry);
  }

  const htmlEntries = entries.filter((entry) => entry.ext === "html" || entry.ext === "htm");
  if (!htmlEntries.length) throw new Error("ZIP 内没有 html 文件。");
  const main = htmlEntries.find((entry) => entry.path.toLowerCase() === "index.html")
    || htmlEntries.sort((a, b) => a.path.length - b.path.length)[0];
  const allText = entries.filter((entry) => typeof entry.text === "string").map((entry) => entry.text).join("\n/* --- */\n");

  return {
    isZip: true,
    uploadName: file.name,
    sizeBytes: file.size,
    entries,
    entryMap,
    mainHtmlPath: main.path,
    mainHtmlText: main.text || "",
    allText,
  };
}

async function runAnalysis() {
  if (!state.pkg) return;
  els.analyzeBtn.disabled = true;
  try {
    const report = await analyzePlayable(state.pkg, els.channelSelect.value);
    renderSummary(report.summary);
    renderChecks(report.checks);
    enableRuntimeControls();
  } catch (error) {
    els.results.className = "results";
    els.results.textContent = `检查失败：${error.message}`;
  } finally {
    els.analyzeBtn.disabled = false;
  }
}

function renderSummary(summary) {
  els.summary.className = "summary";
  els.summary.innerHTML = [
    `<span class="badge fail">失败 ${summary.fail}</span>`,
    `<span class="badge warn">警告 ${summary.warn}</span>`,
    `<span class="badge manual">待人工验证 ${summary.manual || 0}</span>`,
    `<span class="badge ok">通过 ${summary.pass}</span>`,
  ].join("");
}

function renderChecks(checks) {
  if (!checks.length) {
    els.results.className = "results empty";
    els.results.textContent = "没有可展示检查项";
    return;
  }
  els.results.className = "results";
  els.results.innerHTML = checks.map((check) => {
    const statusText = statusLabel(check.status);
    return `
      <article class="check ${check.status}">
        <div class="check-head">
          <div class="check-title">${escapeHtml(check.title)}</div>
          <span class="check-status ${check.status}">${statusText}</span>
        </div>
        <div class="check-body">
          <p><strong>检查内容：</strong>${escapeHtml(check.what)}</p>
          <p><strong>为什么重要：</strong>${escapeHtml(check.importance)}</p>
          <p><strong>怎么修：</strong>${escapeHtml(check.fix)}</p>
        </div>
      </article>`;
  }).join("");
}

async function mountSandbox() {
  if (!state.pkg) return;
  cleanupObjectUrls();
  resetRuntimeState();
  clearRuntimeLog("沙盒加载后，这里会实时显示 console / 网络 / rAF 信号。");
  setFrameSize(390, 844);

  try {
    const runtime = buildRuntimeHtml(state.pkg);
    els.runtimeFrame.srcdoc = injectMonitor(runtime.html, runtime.assetMap);
    addRuntimeRow("tick", "沙盒已加载，请在 iframe 内手动游玩并触发 CTA。");
  } catch (error) {
    addRuntimeRow("error", `沙盒加载失败：${error.message}`);
  }
}

function buildRuntimeHtml(pkg) {
  if (!pkg.mainHtmlText.trim()) throw new Error("主 HTML 为空。");
  if (!pkg.isZip) return { html: pkg.mainHtmlText, assetMap: {} };

  const assetMap = {};
  for (const entry of pkg.entries) {
    const url = URL.createObjectURL(new Blob([entry.bytes], { type: mimeFromExt(entry.ext) }));
    state.objectUrls.push(url);
    assetMap[entry.path] = url;
  }
  return {
    html: rewriteAssetRefs(pkg.mainHtmlText, dirname(pkg.mainHtmlPath), assetMap),
    assetMap,
  };
}

function rewriteAssetRefs(html, baseDir, assetMap) {
  const remap = (ref) => {
    if (isExternalLike(ref)) return ref;
    const key = resolvePath(baseDir, ref);
    return assetMap[key] || ref;
  };
  return html
    .replace(/\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi, (_m, attr, ref) => `${attr}="${remap(ref)}"`)
    .replace(/url\(\s*(['"]?)([^"')]+)\1\s*\)/gi, (_m, quote, ref) => `url(${quote}${remap(ref)}${quote})`);
}

function injectMonitor(html, assetMap) {
  const payload = JSON.stringify(assetMap).replace(/</g, "\\u003c");
  const script = `<script>${monitorScript(payload)}<\/script>`;
  return /<head[\s>]/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${script}\n`) : `${script}\n${html}`;
}

function monitorScript(payload) {
  return `
  (() => {
    const ASSETS = ${payload};
    const send = (type, payload = {}) => parent.postMessage({ __pc: true, type, payload }, "*");
    const stamp = () => new Date().toLocaleTimeString();
    const note = (level, message, extra = {}) => send("log", { level, message, extra, ts: stamp() });
    const local = (url) => (url || "").replace(/^\\.\\//, "").replace(/^\\//, "");
    const special = (url) => /^(data:|blob:|javascript:|about:|#)/i.test(url || "");
    const mapUrl = (url) => special(url) || /^https?:\\/\\//i.test(url) ? url : (ASSETS[local(url)] || url);

    const c = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
    ["log", "warn", "error"].forEach((k) => {
      console[k] = (...args) => { note(k === "log" ? "info" : k, args.map((x) => String(x)).join(" ")); c[k](...args); };
    });
    window.addEventListener("error", (e) => note("error", e.message || "window error", { file: e.filename, line: e.lineno }));
    window.addEventListener("unhandledrejection", (e) => note("error", "unhandledrejection", { reason: String(e.reason) }));

    if (window.fetch) {
      const oldFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const src = typeof input === "string" ? input : input.url;
        const mapped = mapUrl(src);
        if (/^https?:\\/\\//i.test(src)) note("net", "fetch external request", { url: src });
        return oldFetch(typeof input === "string" ? mapped : new Request(mapped, input), init);
      };
    }
    const oldXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      const mapped = mapUrl(url);
      if (/^https?:\\/\\//i.test(url)) note("net", "XHR external request", { method, url });
      return oldXhrOpen.call(this, method, mapped, ...rest);
    };

    const oldAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      if ((name === "src" || name === "href" || name === "poster") && /^https?:\\/\\//i.test(value || "")) {
        note("net", "DOM external resource", { tag: this.tagName, url: value });
      }
      return oldAttr.call(this, name, value);
    };

    window.addEventListener("resize", () => note("tick", "resize", { w: innerWidth, h: innerHeight }));
    window.addEventListener("orientationchange", () => note("tick", "orientationchange"));

    const raf = window.requestAnimationFrame.bind(window);
    let total = 0; let last = 0;
    window.requestAnimationFrame = (cb) => raf((t) => { total += 1; cb(t); });
    setInterval(() => { const perSecond = total - last; last = total; send("raf", { perSecond }); }, 1000);

    if (!window.mraid) {
      const listeners = {};
      window.mraid = {
        getState: () => "default",
        isViewable: () => true,
        open: (url) => note("info", "mraid.open()", { url }),
        addEventListener: (name, fn) => ((listeners[name] = listeners[name] || []).push(fn)),
      };
      setTimeout(() => {
        (listeners.ready || []).forEach((fn) => fn());
        (listeners.viewableChange || []).forEach((fn) => fn(true));
      }, 10);
    }
    if (!window.ExitApi) window.ExitApi = { exit: () => note("info", "ExitApi.exit()") };
    if (!window.FbPlayableAd) window.FbPlayableAd = { onCTAClick: () => note("info", "FbPlayableAd.onCTAClick()") };
    if (!window.install) window.install = () => note("info", "window.install()");
    if (!window.openAppStore) window.openAppStore = () => note("info", "window.openAppStore()");
    if (!window.ALPlayableAnalytics) window.ALPlayableAnalytics = { trackEvent: (name) => note("info", "ALPlayableAnalytics.trackEvent()", { name }) };

    note("tick", "monitor ready");
  })();`;
}

function onRuntimeMessage(event) {
  if (event.source !== els.runtimeFrame.contentWindow) return;
  const data = event.data;
  if (!data || data.__pc !== true) return;

  if (data.type === "log") {
    const log = data.payload || {};
    if (log.level === "error") state.runtime.error += 1;
    else if (log.level === "warn") state.runtime.warn += 1;
    else if (log.level === "net") state.runtime.net += 1;
    const cls = log.level === "error" ? "error" : log.level === "warn" ? "warn" : log.level === "net" ? "net" : "tick";
    const extra = log.extra && Object.keys(log.extra).length ? ` ${JSON.stringify(log.extra)}` : "";
    addRuntimeRow(cls, `${log.ts || ""} ${log.message || ""}${extra}`.trim());
    renderRuntimeStats();
  } else if (data.type === "raf") {
    state.runtime.raf = data.payload?.perSecond ?? "-";
    renderRuntimeStats();
  }
}

function renderRuntimeStats() {
  const rafText = state.runtime.raf === 0 ? "0（⚠️ 可能卡死）" : state.runtime.raf;
  els.runtimeStats.innerHTML = `
    <span>console error: ${state.runtime.error}</span>
    <span>console warn: ${state.runtime.warn}</span>
    <span>外部请求: ${state.runtime.net}</span>
    <span>rAF/s: ${rafText}</span>`;
}

function statusLabel(status) {
  if (status === "pass") return "通过";
  if (status === "warn") return "警告";
  if (status === "manual") return "待人工验证";
  return "失败";
}

function addRuntimeRow(kind, text) {
  if (els.runtimeLog.classList.contains("empty")) {
    els.runtimeLog.classList.remove("empty");
    els.runtimeLog.textContent = "";
  }
  const row = document.createElement("div");
  row.className = `runtime-row ${kind}`;
  row.textContent = text;
  els.runtimeLog.prepend(row);
}

function setFrameSize(width, height, note) {
  els.frameShell.style.width = `${width}px`;
  els.frameShell.style.height = `${height}px`;
  if (note) addRuntimeRow("tick", note);
}

function clearRuntimeLog(text) {
  els.runtimeLog.className = "runtime-log empty";
  els.runtimeLog.textContent = text;
}

function resetReport() {
  els.summary.className = "summary empty";
  els.summary.textContent = "等待检查";
  els.results.className = "results empty";
  els.results.textContent = "还没有检查结果";
}

function enableRuntimeControls() {
  [els.mountBtn, els.portraitBtn, els.landscapeBtn, els.narrowBtn, els.clearRuntimeBtn].forEach((el) => {
    el.disabled = false;
  });
}

function disableRuntimeControls() {
  [els.mountBtn, els.portraitBtn, els.landscapeBtn, els.narrowBtn, els.clearRuntimeBtn].forEach((el) => {
    el.disabled = true;
  });
}

function resetRuntimeState() {
  state.runtime = { error: 0, warn: 0, net: 0, raf: "-" };
  renderRuntimeStats();
}

function cleanupObjectUrls() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function dirname(path) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function resolvePath(baseDir, target) {
  const stack = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function isExternalLike(ref) {
  return /^(https?:|data:|blob:|javascript:|about:|#)/i.test(ref || "");
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function mimeFromExt(ext) {
  const map = {
    html: "text/html",
    htm: "text/html",
    js: "application/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
  };
  return map[ext] || "application/octet-stream";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
