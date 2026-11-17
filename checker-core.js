import { unpackPlayableScripts } from "./packed-text.js";

const MB = 1024 * 1024;
const APPLOVIN_PREVIEW_URL = "https://p.applov.in/playablePreview?create=1&qr=1";
const unpackCache = new WeakMap();

export const CHANNEL_OPTIONS = [
  { id: "applovin", label: "AppLovin" },
  { id: "unity", label: "Unity（团结引擎导出）" },
  { id: "mintegral", label: "Mintegral" },
  { id: "google", label: "Google Ads" },
  { id: "meta", label: "Meta（Facebook）" },
  { id: "moloco", label: "Moloco" },
  { id: "tiktok", label: "TikTok" },
];

const TEXT_EXTS = new Set(["html", "htm", "js", "css", "json", "txt", "xml", "svg"]);

export function isTextEntry(path) {
  const ext = extname(path);
  return TEXT_EXTS.has(ext);
}

export function extname(path) {
  const idx = path.lastIndexOf(".");
  if (idx < 0) return "";
  return path.slice(idx + 1).toLowerCase();
}

export function formatSize(bytes) {
  return `${(bytes / MB).toFixed(2)} MB`;
}

export function guessChannel(pkg) {
  const html = pkg.mainHtmlText || "";
  const textBlob = pkg.allText || "";
  const names = pkg.entries.map((e) => e.path.toLowerCase());
  const rootHas = (name) => names.includes(name.toLowerCase());
  const tuanjie = detectTuanjieExport(html);

  if (pkg.isZip && rootHas("config.json")) {
    return { id: "tiktok", reason: "ZIP 根目录发现 config.json（TikTok 特征）", confidence: "high" };
  }
  if (tuanjie.isTuanjie) {
    const mapped = mapTuanjieChannelToChecker(tuanjie.channelName);
    if (mapped) {
      return {
        id: mapped,
        reason: `检测到团结引擎导出特征（标题 + mraid.js + JS_GetCurrentChannelNameInternal=${tuanjie.channelName}）`,
        confidence: "high",
      };
    }
    return {
      id: "unity",
      reason: "检测到团结引擎导出特征（标题 + mraid.js + JS_GetCurrentChannelNameInternal）。",
      confidence: "medium",
    };
  }
  if (/window\.(?:gameReady|gameStart|gameClose|gameEnd|install)\b/.test(textBlob)) {
    return { id: "mintegral", reason: "检测到 Mintegral 生命周期函数", confidence: "medium" };
  }
  if (/exitapi\.js/i.test(textBlob) || /ExitApi\.exit\s*\(/.test(textBlob)) {
    return { id: "google", reason: "检测到 Google ExitApi 特征", confidence: "medium" };
  }
  if (/window\.openAppStore\s*\(/.test(textBlob)) {
    return { id: "tiktok", reason: "检测到 TikTok openAppStore 特征", confidence: "medium" };
  }
  if (/FbPlayableAd\.onCTAClick\s*\(/.test(textBlob)) {
    if (pkg.isZip) {
      return { id: "meta", reason: "ZIP + FbPlayableAd，较像 Meta", confidence: "low" };
    }
    return { id: "moloco", reason: "HTML + FbPlayableAd，较像 Moloco", confidence: "low" };
  }
  if (/ALPlayableAnalytics/.test(textBlob)) {
    return { id: "applovin", reason: "检测到 ALPlayableAnalytics", confidence: "medium" };
  }
  if (/mraid\.open\s*\(/.test(textBlob)) {
    return { id: "applovin", reason: "检测到 mraid.open（AppLovin/Unity 常见）", confidence: "low" };
  }
  return { id: null, reason: "没有足够特征，建议手动选择渠道", confidence: "low" };
}

export async function analyzePlayable(pkg, channel) {
  const checks = [];
  const packed = await cachedUnpack(pkg);
  const html = pkg.mainHtmlText || "";
  const rawText = pkg.allText || "";
  const allText = packed.text
    ? `${rawText}\n/* --- unpacked base122 script --- */\n${packed.text}`
    : rawText;
  const entryNames = pkg.entries.map((entry) => entry.path);
  const lowerText = allText.toLowerCase();
  const urls = extractUrls(allText);
  const tuanjie = detectTuanjieExport(html);

  addGeneralChecks(checks, pkg, channel, html, allText, urls);

  switch (channel) {
    case "applovin":
      addAppLovinChecks(checks, pkg, html, allText, tuanjie, { ...packed, rawText });
      break;
    case "unity":
      addUnityChecks(checks, pkg, html, allText);
      break;
    case "mintegral":
      addMintegralChecks(checks, pkg, html, allText, entryNames, tuanjie);
      break;
    case "google":
      addGoogleChecks(checks, pkg, html, allText, entryNames);
      break;
    case "meta":
      addMetaChecks(checks, pkg, html, allText, entryNames);
      break;
    case "moloco":
      addMolocoChecks(checks, pkg, html, lowerText, urls);
      break;
    case "tiktok":
      addTikTokChecks(checks, pkg, html, allText, entryNames);
      break;
    default:
      checks.push(makeCheck("warn", "未知渠道", "当前渠道未实现规则。", "检查结果不完整。", "请先在下拉框里选择 7 个已支持渠道之一。"));
  }

  const summary = summarize(checks);
  return { checks, summary, packed: { decoded: packed.decoded, failed: packed.failed } };
}

function cachedUnpack(pkg) {
  if (!pkg || typeof pkg !== "object") return Promise.resolve({ text: "", decoded: 0, failed: 0 });
  if (!unpackCache.has(pkg)) unpackCache.set(pkg, unpackPlayableScripts(pkg));
  return unpackCache.get(pkg);
}

function addGeneralChecks(checks, pkg, channel, html, allText, urls) {
  const externalUrlResult = evaluateExternalUrls(urls, channel);
  checks.push(makeCheck(
    externalUrlResult.status,
    "外部 URL / 网络请求风险",
    externalUrlResult.what,
    "Playable 多渠道普遍要求资源内嵌、无外部请求；隐形外链会导致拒审或加载异常。",
    externalUrlResult.fix
  ));

  const hasAssetFallback = /__ASSET_URL/.test(allText) && /\|\|\s*[a-zA-Z_$][\w$]*\s*[;),]/.test(allText);
  checks.push(makeCheck(
    hasAssetFallback ? "warn" : "pass",
    "资源回落陷阱（__ASSET_URL || 原路径）",
    hasAssetFallback
      ? "检测到资源映射+回落写法，可能在漏资源时触发真实网络请求。"
      : "未检测到明显的资源映射回落写法。",
    "这是最常见的隐形外部请求来源之一，肉眼不容易发现。",
    hasAssetFallback
      ? "补齐映射表缺失资源，或在映射层加兜底 data URI（不要返回空字符串）。"
      : "继续配合运行时面板实测胜利/失败页，确认没有实际外部请求。"
  ));

  const hasHtmlDoc = /<html[\s>]/i.test(html) && /<head[\s>]/i.test(html) && /<body[\s>]/i.test(html);
  checks.push(makeCheck(
    hasHtmlDoc ? "pass" : "warn",
    "HTML 基础结构完整性",
    hasHtmlDoc ? "检测到 <html>/<head>/<body>。" : "未完整检测到 <html>/<head>/<body>。",
    "部分渠道（尤其 Mintegral/Google）会做严格结构扫描。",
    hasHtmlDoc ? "无需修复。" : "补齐标准 HTML 结构与必要 meta 标签。"
  ));
}

function addAppLovinChecks(checks, pkg, html, allText, tuanjie, packed = {}) {
  const rawText = packed.rawText ?? allText;
  const packedText = packed.text || "";
  const foundOnlyInPacked = (pattern) => Boolean(packedText) && pattern.test(packedText) && !pattern.test(rawText);
  const packedDecodeMissed = (packed.failed || 0) > 0 && (packed.decoded || 0) === 0;

  checks.push(checkFormat(pkg, false, "AppLovin 只收单 HTML（不要上传 ZIP）"));
  checks.push(checkSize(pkg.sizeBytes <= 5 * MB, pkg.sizeBytes, "<= 5 MB（AppLovin）"));

  const mraidPattern = /mraid\.open\s*\(/;
  const hasMraidOpen = mraidPattern.test(allText);
  checks.push(makeCheck(
    hasMraidOpen ? "pass" : "fail",
    "click-through API（mraid.open）",
    hasMraidOpen
      ? (foundOnlyInPacked(mraidPattern)
        ? "明文里没有 mraid.open()，已在 Base122 + Brotli 解压后的脚本里检测到。"
        : "检测到 mraid.open()。")
      : "未检测到 mraid.open()。",
    "AppLovin 跳商店应使用 mraid.open，否则 CTA 可能失效。",
    "将统一跳转函数改为 mraid.open(url)。"
  ));

  const trackPattern = /ALPlayableAnalytics\s*\??\.\s*trackEvent\s*\(/;
  const hasAlObj = /ALPlayableAnalytics/.test(allText);
  const trackCalls = (allText.match(new RegExp(trackPattern.source, "g")) || []).length;
  let status = "pass";
  let what = foundOnlyInPacked(trackPattern)
    ? `明文里没有埋点调用，已在 Base122 + Brotli 解压后的脚本里检测到 ALPlayableAnalytics.trackEvent ${trackCalls} 次。`
    : `检测到 ALPlayableAnalytics.trackEvent 调用 ${trackCalls} 次。`;
  let importance = "AppLovin 素材至少要有可触发的埋点调用，尤其 DISPLAYED。";
  let fix = "在素材中添加可执行的 ALPlayableAnalytics.trackEvent(...) 调用，并在运行时面板确认有真实触发。";

  if (!hasAlObj || trackCalls === 0) {
    if (tuanjie.isTuanjie) {
      status = "manual";
      what = "检测到团结引擎导出，但静态文本里找不到 ALPlayableAnalytics 调用；这在 WASM / postMessage 路径下可能是假阴性。";
      importance = "团结引擎导出的埋点调用可能编译进 WASM，静态搜代码或本地裸测都不能据此判定“没接埋点”。";
      fix = `请用 AppLovin 官方工具手动验证：1) 打开 ${APPLOVIN_PREVIEW_URL}；2) 上传素材并运行；3) 右键 Inspect -> Console 过滤 ALPlayableEvent；4) 手动玩到 CTA，确认出现 Sent ALPlayableEvent: DISPLAYED 等事件。`;
    } else if (packedDecodeMissed) {
      status = "manual";
      what = "检测到 Base122 内嵌脚本，但 Brotli 解压失败，不能凭外层明文判断有没有埋点。";
      importance = "这类单文件会把真正的玩法脚本压进 pre 标签，解压失败时静态结果是假阴性。";
      fix = `请用 AppLovin 官方工具手动验证：1) 打开 ${APPLOVIN_PREVIEW_URL}；2) 上传素材并运行；3) 右键 Inspect -> Console 过滤 ALPlayableEvent；4) 确认出现 Sent ALPlayableEvent: DISPLAYED。`;
    } else {
      status = "fail";
      what = !hasAlObj
        ? "未检测到 ALPlayableAnalytics。"
        : "检测到 ALPlayableAnalytics 字符串，但未发现 trackEvent 实际调用。";
    }
  }

  checks.push(makeCheck(
    status,
    "ALPlayableAnalytics 埋点调用",
    what,
    importance,
    fix
  ));

  const displayedPattern = /DISPLAYED/;
  const hasDisplayed = displayedPattern.test(allText);
  checks.push(makeCheck(
    hasDisplayed ? "pass" : (packedDecodeMissed ? "manual" : "warn"),
    "DISPLAYED 事件痕迹",
    hasDisplayed
      ? (foundOnlyInPacked(displayedPattern)
        ? "明文里没有 DISPLAYED，已在 Base122 + Brotli 解压后的脚本里检测到。"
        : "检测到 DISPLAYED 事件字样。")
      : (packedDecodeMissed
        ? "检测到 Base122 内嵌脚本，但解压失败，无法确认里面有没有 DISPLAYED。"
        : "未检测到 DISPLAYED 事件字样。"),
    "DISPLAYED 是 AppLovin 文档里最关键的底线事件。",
    hasDisplayed ? "仍建议在运行时面板确认事件不是假日志。" : "至少补一个 DISPLAYED 事件调用。"
  ));

  const hasLoading = /LOADING/.test(allText);
  const hasLoaded = /LOADED/.test(allText);
  checks.push(makeCheck(
    hasLoading === hasLoaded ? "pass" : "warn",
    "LOADING / LOADED 成对性",
    hasLoading === hasLoaded
      ? "LOADING 与 LOADED 看起来成对（或都未使用）。"
      : "检测到 LOADING / LOADED 不成对。",
    "如果发了 LOADING 但没发 LOADED，漏斗数据会断层。",
    "保证 LOADING 与 LOADED 成对上报。"
  ));
}

function addUnityChecks(checks, pkg, html, allText) {
  checks.push(checkFormat(pkg, false, "Unity 渠道应上传单 HTML（不打 ZIP）"));
  checks.push(checkSize(pkg.sizeBytes < 5 * MB, pkg.sizeBytes, "< 5 MB（Unity）"));

  const hasMraidOpen = /mraid\.open\s*\(/.test(allText);
  checks.push(makeCheck(
    hasMraidOpen ? "pass" : "fail",
    "click-through API（mraid.open）",
    hasMraidOpen ? "检测到 mraid.open()。" : "未检测到 mraid.open()。",
    "Unity 规范要求点击下载走 mraid.open。",
    "补充 mraid.open(url) 的下载入口。"
  ));

  const hasGoogleUrl = /play\.google\.com\/store\/apps\/details\?id=/i.test(allText);
  const hasAppleUrl = /apps\.apple\.com\//i.test(allText);
  checks.push(makeCheck(
    hasGoogleUrl && hasAppleUrl ? "pass" : "fail",
    "Unity QA 商店链接（iOS + Android）",
    hasGoogleUrl && hasAppleUrl
      ? "检测到 Android + iOS 两条商店链接。"
      : "未同时检测到 Android + iOS 两条商店链接。",
    "Unity QA 明确把两条链接作为过审静态检查项。",
    "在引擎启动前注入 window.download_google_url / window.download_apple_url。"
  ));

  const hasPlaceholder = /auicreativetestapp|ad-tests\/id1463016906/i.test(allText);
  checks.push(makeCheck(
    hasPlaceholder ? "fail" : "pass",
    "Unity 占位商店链接",
    hasPlaceholder ? "检测到 Unity 官方测试 App 占位链接。" : "未检测到 Unity 测试占位链接。",
    "带占位链接通常会被 Unity QA 打回。",
    hasPlaceholder ? "把占位链接替换成项目真实商店链接。" : "无需修复。"
  ));

  const hasViewableChange = /viewableChange/.test(allText);
  checks.push(makeCheck(
    hasViewableChange ? "pass" : "warn",
    "viewableChange 启动门控",
    hasViewableChange ? "检测到 viewableChange 监听痕迹。" : "未检测到 viewableChange 监听痕迹。",
    "Unity 文档要求按可见性事件控制启动/暂停。",
    hasViewableChange ? "仍建议跑一次运行时验证。 " : "建议把启动逻辑挂到 viewableChange 后执行。"
  ));
}

function addMintegralChecks(checks, pkg, html, allText, entryNames, tuanjie) {
  checks.push(checkSize(pkg.sizeBytes <= 5 * MB, pkg.sizeBytes, "<= 5 MB（Mintegral）"));

  if (pkg.isZip) {
    const base = pkg.uploadName.replace(/\.zip$/i, "");
    const hasSameName = entryNames.includes(`${base}/${base}.html`);
    const hasRootIndex = entryNames.includes("index.html");
    let status = "fail";
    let what = "ZIP 结构不符合常见口径。";
    if (hasSameName) {
      status = "pass";
      what = "检测到三者同名结构（zip/文件夹/html）。";
    } else if (hasRootIndex) {
      status = "warn";
      what = "检测到裸 index.html 结构（未满足三者同名规则）。";
    }
    checks.push(makeCheck(
      status,
      "Mintegral ZIP 结构",
      what,
      "你们现网经验里，结构口径不一致容易在提审时踩坑。",
      "优先按 zip 名 / 文件夹名 / html 名三者同名打包。"
    ));
  } else {
    checks.push(makeCheck(
      "pass",
      "Mintegral 包形态",
      "当前是单 HTML，满足 Mintegral 可接受形态之一。",
      "Mintegral 支持单 HTML 或指定 ZIP 结构。",
      "无需修复。"
    ));
  }

  const hasCharset = /<meta[^>]+charset\s*=\s*["']?utf-8/i.test(html);
  checks.push(makeCheck(
    hasCharset ? "pass" : "fail",
    "HTML 结构与 charset",
    hasCharset ? "检测到 UTF-8 charset。" : "未检测到 <meta charset=\"utf-8\">。",
    "Mintegral 对 HTML 结构扫描更严格。",
    "补齐 <!DOCTYPE html>、<html>/<head>/<body> 和 UTF-8 charset。"
  ));

  const mustExpose = ["gameStart", "gameClose"];
  const mustCall = ["gameReady", "gameEnd", "install"];
  const missExpose = mustExpose.filter((n) => !new RegExp(`(?:window\\.${n}|function\\s+${n}\\s*\\()`).test(allText));
  const missCall = mustCall.filter((n) => !new RegExp(`window\\.${n}\\s*\\(`).test(allText));

  if (tuanjie.isTuanjie) {
    checks.push(makeCheck(
      "pass",
      "Mintegral 静态检测盲区评估（团结引擎）",
      "检测到团结引擎导出；当前文件中已能静态看到 gameStart/gameClose/gameReady/gameEnd/install 桥接函数。",
      "这几项是 Mintegral 的 JS 生命周期桥接入口，是否暴露/调用本身就在外层 JS，可被静态检查覆盖，不属于 AppLovin 埋点那类 WASM 假阴性。",
      "继续按现有静态规则判定；若缺失任一项仍应按失败处理。"
    ));
  }

  checks.push(makeCheck(
    missExpose.length || missCall.length ? "fail" : "pass",
    "Mintegral 生命周期函数",
    missExpose.length || missCall.length
      ? `缺失项：${[...missExpose.map((x) => `${x}(暴露)`), ...missCall.map((x) => `${x}()调用`)].join("，")}`
      : "gameStart/gameClose 暴露 + gameReady/gameEnd/install 调用痕迹齐全。",
    "这些函数是 Mintegral 检测项本体，漏任意一项都可能拒审。",
    "补暴露函数（gameStart/gameClose）并补调用（gameReady/gameEnd/install）。"
  ));

  const moduleRisk = /type\s*=\s*["']module["']/.test(allText) || /\bimport\s+[^;]+from\b/.test(allText);
  checks.push(makeCheck(
    moduleRisk ? "fail" : "pass",
    "file:// 模式兼容（type=\"module\"）",
    moduleRisk ? "检测到 module/import 特征。 " : "未检测到明显 module/import 特征。",
    "Mintegral 检测器常在 file:// 环境执行，module 脚本会触发 CORS 报错。",
    moduleRisk ? "去掉 module 形态并保持执行时序（通常需迁移脚本到 body 末尾）。" : "无需修复。"
  ));

  const hasThreeWarn = /Multiple instances of Three\.js being imported/.test(allText);
  checks.push(makeCheck(
    hasThreeWarn ? "warn" : "pass",
    "__THREE__ 多实例告警风险",
    hasThreeWarn ? "检测到 three.js 多实例告警字符串。" : "未检测到 three.js 多实例告警字符串。",
    "Mintegral 会在同 window 重复执行，warn 也可能被判代码报错。",
    hasThreeWarn ? "移除告警分支，仅保留 __THREE__ 赋值逻辑。" : "无需修复。"
  ));
}

function addGoogleChecks(checks, pkg, html, allText, entryNames) {
  checks.push(checkFormat(pkg, true, "Google Ads 只收 ZIP，不收单 HTML"));
  checks.push(checkSize(pkg.sizeBytes <= 5 * MB, pkg.sizeBytes, "<= 5 MB（Google ZIP）"));

  checks.push(makeCheck(
    pkg.entries.length <= 512 ? "pass" : "fail",
    "ZIP 内文件数量",
    `检测到 ${pkg.entries.length} 个文件。`,
    "Google 明确限制 ZIP 包内不超过 512 文件。",
    "减少资源文件数，建议做图集合并和资源内联。"
  ));

  const hasRootIndex = entryNames.includes("index.html");
  checks.push(makeCheck(
    hasRootIndex ? "pass" : "fail",
    "根目录 index.html",
    hasRootIndex ? "检测到根目录 index.html。" : "未检测到根目录 index.html。",
    "Google ZIP 入口必须明确可定位。",
    "保证 index.html 位于 ZIP 根目录。"
  ));

  const allowed = new Set(["css", "gif", "html", "htm", "jpeg", "jpg", "js", "png", "svg"]);
  const disallowed = pkg.entries
    .filter((e) => !e.path.endsWith("/"))
    .map((e) => extname(e.path))
    .filter((ext) => ext && !allowed.has(ext));
  checks.push(makeCheck(
    disallowed.length ? "fail" : "pass",
    "Google 允许的文件扩展名",
    disallowed.length ? `检测到不允许扩展名：${unique(disallowed).join(", ")}` : "未检测到不允许扩展名。",
    "Google 对包内扩展名有白名单，超出会被拒。",
    disallowed.length ? "移除不允许扩展名文件，或转为允许格式并内联。" : "无需修复。"
  ));

  const hasOrientationMeta = /<meta[^>]+name\s*=\s*["']ad\.orientation["'][^>]*>/i.test(html);
  checks.push(makeCheck(
    hasOrientationMeta ? "pass" : "fail",
    "ad.orientation meta",
    hasOrientationMeta ? "检测到标准 ad.orientation meta。" : "未检测到标准 ad.orientation meta。",
    "Google 通过该 meta 声明方向能力。",
    "在 head 增加 <meta name=\"ad.orientation\" content=\"portrait,landscape\">（按素材实际能力填写）。"
  ));

  const hasExitApiScript = /tpc\.googlesyndication\.com\/pagead\/gadgets\/html5\/api\/exitapi\.js/i.test(allText);
  const hasExitCall = /ExitApi\.exit\s*\(/.test(allText);
  checks.push(makeCheck(
    hasExitApiScript && hasExitCall ? "pass" : "fail",
    "ExitApi 接入完整性",
    hasExitApiScript && hasExitCall
      ? "检测到 exitapi.js + ExitApi.exit() 调用。"
      : `缺失项：${[
        hasExitApiScript ? null : "exitapi.js",
        hasExitCall ? null : "ExitApi.exit()",
      ].filter(Boolean).join("，")}`,
    "Google 要求先引 exitapi.js，再用 ExitApi.exit() 触发 click-through。",
    "补齐 head 脚本和 CTA 调用路径。"
  ));
}

function addMetaChecks(checks, pkg, html, allText, entryNames) {
  checks.push(checkSize(pkg.sizeBytes <= 5 * MB, pkg.sizeBytes, "<= 5 MB（Meta）"));
  if (pkg.isZip) {
    checks.push(makeCheck(
      pkg.entries.length <= 100 ? "pass" : "fail",
      "ZIP 内文件数量",
      `检测到 ${pkg.entries.length} 个文件。`,
      "Meta ZIP 包内文件数量限制是 100。",
      "减少 ZIP 文件数量，优先内联资源。"
    ));
    checks.push(makeCheck(
      entryNames.includes("index.html") ? "pass" : "fail",
      "根目录 index.html",
      entryNames.includes("index.html") ? "检测到根目录 index.html。" : "未检测到根目录 index.html。",
      "Meta ZIP 入口要求在根目录。",
      "把 index.html 放到 ZIP 根目录。"
    ));
  }

  const hasMraid = /mraid\.js|mraid\.open\s*\(/i.test(allText);
  checks.push(makeCheck(
    hasMraid ? "fail" : "pass",
    "禁用 mraid.js / mraid API",
    hasMraid ? "检测到 mraid 相关字样。" : "未检测到 mraid 相关字样。",
    "Meta 规范要求素材不依赖 mraid.js。",
    hasMraid ? "移除 mraid.js 和 mraid 调用，改用 FbPlayableAd.onCTAClick()。" : "无需修复。"
  ));

  const hasCta = /FbPlayableAd\.onCTAClick\s*\(/.test(allText);
  checks.push(makeCheck(
    hasCta ? "pass" : "fail",
    "click-through API（FbPlayableAd.onCTAClick）",
    hasCta ? "检测到 FbPlayableAd.onCTAClick()。" : "未检测到 FbPlayableAd.onCTAClick()。",
    "Meta click-through 需要走 FbPlayableAd API。",
    "把 CTA 跳转改为 FbPlayableAd.onCTAClick()。"
  ));

  const hasPortraitHint = /portrait/i.test(allText);
  checks.push(makeCheck(
    hasPortraitHint ? "pass" : "warn",
    "竖屏取向提示",
    hasPortraitHint ? "检测到 portrait 相关字样。" : "未检测到明显 portrait 提示。",
    "Meta 要求 playable 以竖屏为主并自适应。",
    hasPortraitHint ? "仍建议用竖屏比例实测。 " : "补充竖屏导向配置并在 9:16 设备比实测。"
  ));
}

function addMolocoChecks(checks, pkg, html, lowerText, urls) {
  checks.push(checkFormat(pkg, false, "Moloco 明文要求上传单 HTML（禁止 ZIP）"));
  checks.push(checkSize(pkg.sizeBytes < 5 * MB, pkg.sizeBytes, "< 5 MB（Moloco）"));

  const hasMraid = /mraid\.js|mraid\.open\s*\(/i.test(html);
  checks.push(makeCheck(
    hasMraid ? "fail" : "pass",
    "禁用 mraid.js",
    hasMraid ? "检测到 mraid.js / mraid.open。" : "未检测到 mraid.js / mraid.open。",
    "Moloco checklist 明文禁用 mraid.js。",
    hasMraid ? "移除 mraid 依赖，改用 FbPlayableAd.onCTAClick()。" : "无需修复。"
  ));

  const hasXHR = lowerText.includes("xmlhttprequest");
  checks.push(makeCheck(
    hasXHR ? "fail" : "pass",
    "禁用 XMLHttpRequest 字面量",
    hasXHR ? "检测到 XMLHttpRequest 字面量。" : "未检测到 XMLHttpRequest 字面量。",
    "Moloco checklist 明文会扫 XMLHttpRequest。",
    hasXHR ? "移除 XHR 相关实现；必要时改为不会触发静态字面量扫描的方案。" : "无需修复。"
  ));

  const hasCta = /FbPlayableAd\.onCTAClick\s*\(/.test(html);
  checks.push(makeCheck(
    hasCta ? "pass" : "fail",
    "click-through API（FbPlayableAd.onCTAClick）",
    hasCta ? "检测到 FbPlayableAd.onCTAClick()。" : "未检测到 FbPlayableAd.onCTAClick()。",
    "Moloco CTA 要求调 FbPlayableAd.onCTAClick()。",
    "把 CTA 统一接到 FbPlayableAd.onCTAClick()。"
  ));

  const unknownHttp = urls.filter((u) => u.startsWith("http://") || u.startsWith("https://"));
  checks.push(makeCheck(
    unknownHttp.length ? "warn" : "pass",
    "外部 HTTP 字符串审计",
    unknownHttp.length
      ? `检测到 ${unknownHttp.length} 条 http(s) 字符串（可能含注释/元数据）：${unique(unknownHttp).slice(0, 4).join(" | ")}`
      : "未检测到明显外部 HTTP 字符串。",
    "Moloco 对外部依赖较敏感，明文 URL 可能触发静态审计。",
    unknownHttp.length ? "清理非必要 URL 字符串，仅保留业务必需项并做实测。" : "无需修复。"
  ));
}

function addTikTokChecks(checks, pkg, html, allText, entryNames) {
  checks.push(checkFormat(pkg, true, "TikTok 只收 ZIP（根目录 index.html + config.json）"));
  checks.push(checkSize(pkg.sizeBytes <= 5 * MB, pkg.sizeBytes, "<= 5 MB（TikTok，按压缩后）"));

  const hasRootIndex = entryNames.includes("index.html");
  const hasRootConfig = entryNames.includes("config.json");
  checks.push(makeCheck(
    hasRootIndex && hasRootConfig ? "pass" : "fail",
    "TikTok ZIP 结构",
    hasRootIndex && hasRootConfig
      ? "检测到根目录 index.html + config.json。"
      : `缺失项：${[
        hasRootIndex ? null : "index.html",
        hasRootConfig ? null : "config.json",
      ].filter(Boolean).join("，")}`,
    "TikTok 结构是硬性校验项。",
    "把 index.html 与 config.json 放在 ZIP 一级目录。"
  ));

  let orientationStatus = "warn";
  let orientationText = "未找到 config.json，无法检查 playable_orientation。";
  if (hasRootConfig) {
    const cfg = pkg.entryMap.get("config.json")?.text || "";
    const match = cfg.match(/"playable_orientation"\s*:\s*(\d+)/);
    if (!match) {
      orientationStatus = "fail";
      orientationText = "config.json 缺少 playable_orientation。";
    } else if (["0", "1", "2"].includes(match[1])) {
      orientationStatus = "pass";
      orientationText = `playable_orientation = ${match[1]}。`;
    } else {
      orientationStatus = "fail";
      orientationText = `playable_orientation 值异常：${match[1]}。`;
    }
  }
  checks.push(makeCheck(
    orientationStatus,
    "config.json playable_orientation",
    orientationText,
    "TikTok 通过该字段识别横竖屏能力。",
    "设置为 0/1/2（0=横竖都支持，1=竖屏，2=横屏）。"
  ));

  const hasSdk = /Playable-sdk\.js/i.test(allText);
  const hasOpenStore = /window\.openAppStore\s*\(/.test(allText);
  checks.push(makeCheck(
    hasSdk && hasOpenStore ? "pass" : "fail",
    "TikTok SDK + openAppStore",
    hasSdk && hasOpenStore
      ? "检测到 playable-sdk.js 与 window.openAppStore()。"
      : `缺失项：${[
        hasSdk ? null : "playable-sdk.js",
        hasOpenStore ? null : "window.openAppStore()",
      ].filter(Boolean).join("，")}`,
    "TikTok 的 click-through 应通过官方 SDK API 完成。",
    "引入 TikTok playable-sdk.js，并将 CTA 接到 window.openAppStore()。"
  ));

  const hasMraid = /mraid\.js|mraid\.open\s*\(/i.test(allText);
  checks.push(makeCheck(
    hasMraid ? "fail" : "pass",
    "禁用 mraid.js",
    hasMraid ? "检测到 mraid 相关字样。" : "未检测到 mraid 相关字样。",
    "TikTok 明确不收 mraid 格式素材。",
    hasMraid ? "移除 mraid.js 和 mraid API 调用。" : "无需修复。"
  ));
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
  return unique(matches.map((u) => u.trim()));
}

function evaluateExternalUrls(urls, channel) {
  if (!urls.length) {
    return {
      status: "pass",
      what: "未检测到明显 http(s) URL 字符串。",
      fix: "仍建议在运行时面板确认没有动态请求。",
    };
  }

  const allow = new Set(["http://www.w3.org/", "https://www.w3.org/"]);
  if (channel === "google") {
    allow.add("https://tpc.googlesyndication.com/");
    allow.add("https://fonts.googleapis.com/");
    allow.add("https://ajax.googleapis.com/");
  }
  if (channel === "tiktok") {
    allow.add("https://sf16-muse-va.ibytedtos.com/");
  }

  const suspicious = urls.filter((u) => !startsWithAny(u, [...allow]));
  if (!suspicious.length) {
    return {
      status: "pass",
      what: `检测到 ${urls.length} 条 URL，均在该渠道常见白名单范围内。`,
      fix: "继续用运行时日志确认无真实外发请求。",
    };
  }

  return {
    status: "warn",
    what: `检测到 ${suspicious.length} 条可能外链（示例）：${suspicious.slice(0, 3).join(" | ")}`,
    fix: "清理注释/元数据里的非必要 URL，并结合运行时面板核实是否真的发起网络请求。",
  };
}

function startsWithAny(text, prefixes) {
  return prefixes.some((prefix) => text.startsWith(prefix));
}

function checkFormat(pkg, mustZip, failDesc) {
  if (mustZip) {
    return makeCheck(
      pkg.isZip ? "pass" : "fail",
      "文件格式",
      pkg.isZip ? "当前文件是 ZIP。" : "当前文件不是 ZIP。",
      failDesc,
      mustZip ? "将素材打包为 ZIP 后再检查/上传。" : "改为单 HTML 上传。"
    );
  }
  return makeCheck(
    pkg.isZip ? "fail" : "pass",
    "文件格式",
    pkg.isZip ? "当前文件是 ZIP。" : "当前文件是 HTML。",
    failDesc,
    mustZip ? "将素材打包为 ZIP 后再检查/上传。" : "改为单 HTML 上传。"
  );
}

function checkSize(ok, bytes, ruleText) {
  return makeCheck(
    ok ? "pass" : "fail",
    "体积限制",
    `当前体积 ${formatSize(bytes)}，规则 ${ruleText}。`,
    "体积超限通常会直接拒审。",
    ok ? "无需修复。" : "压缩资源、移除冗余代码或改用更轻量素材。"
  );
}

function makeCheck(status, title, what, importance, fix) {
  return { status, title, what, importance, fix };
}

function summarize(checks) {
  const summary = { pass: 0, warn: 0, fail: 0, manual: 0 };
  for (const check of checks) {
    if (!(check.status in summary)) summary[check.status] = 0;
    summary[check.status] += 1;
  }
  return summary;
}

function unique(list) {
  return [...new Set(list)];
}

export function detectTuanjieExport(html) {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : html;
  const hasTuanjieTitle = /<title[^>]*>\s*Tuanjie\s+PlayableAds\s+Player\b/i.test(html);
  const hasHeadMraidScript = /<script[^>]+src=["']mraid\.js["'][^>]*>/i.test(head);
  const channelBridgeMatch = html.match(
    /globalThis\.JS_GetCurrentChannelNameInternal\s*=\s*function\s*\(\)\s*\{\s*return\s*"([^"]+)"\s*\}/i
  );
  const hasChannelBridge = Boolean(channelBridgeMatch);
  const channelName = channelBridgeMatch?.[1]?.toLowerCase() || null;
  const hasUnityChannelLiteral = channelName === "unity";

  return {
    isTuanjie: hasTuanjieTitle && hasHeadMraidScript && hasChannelBridge,
    hasTuanjieTitle,
    hasHeadMraidScript,
    hasChannelBridge,
    hasUnityChannelLiteral,
    channelName,
  };
}

function mapTuanjieChannelToChecker(channelName) {
  const mapping = {
    applovin: "applovin",
    unity: "unity",
    mintegral: "mintegral",
    google: "google",
    facebook: "meta",
    meta: "meta",
    moloco: "moloco",
    tiktok: "tiktok",
    pangle: "tiktok",
  };
  return mapping[channelName] || null;
}
