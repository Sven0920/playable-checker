import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, basename, extname } from "node:path";
import JSZip from "jszip";
import { analyzePlayable, isTextEntry } from "../checker-core.js";

const ROOT = new URL("../", import.meta.url).pathname;
const FIXTURE_DIR = `${ROOT}fixtures/generated`;

const REAL_APPLOVIN_MISSING_AL = "/Users/sven/Desktop/Creatives/Cube Tap Away/Playable/Applovin/CTAP021_APL_260901.html";
const REAL_MINTEGRAL_HTML = "/Users/sven/Desktop/Creatives/Yarn Sort/Playable/Mintegral/HTML/YSP020_MTG_260805.html";
const REAL_APPLOVIN_GOOD = "/Users/sven/Desktop/Creatives/Jigsaw Fall/Playable/Applovin/JFP001_APL_260724.html";

await mkdir(FIXTURE_DIR, { recursive: true });

const badMtgZip = `${FIXTURE_DIR}/YSP020_bad_structure.zip`;
const goodGoogleZip = `${FIXTURE_DIR}/google_good_sample.zip`;
const goodApplovinHtml = `${FIXTURE_DIR}/applovin_good_sample.html`;

await buildBadMintegralZip(REAL_MINTEGRAL_HTML, badMtgZip);
await buildGoodGoogleZip(goodGoogleZip);
await buildGoodApplovinSample(goodApplovinHtml);

const cases = [
  {
    id: "C1",
    title: "AppLovin 无 ALPlayableAnalytics 调用",
    channel: "applovin",
    path: REAL_APPLOVIN_MISSING_AL,
    expect: (result) => findCheck(result, "ALPlayableAnalytics 埋点调用")?.status === "fail",
  },
  {
    id: "C2",
    title: "Mintegral ZIP 裸 index 结构",
    channel: "mintegral",
    path: badMtgZip,
    expect: (result) => ["warn", "fail"].includes(findCheck(result, "Mintegral ZIP 结构")?.status),
  },
  {
    id: "C3",
    title: "Google ZIP（ad.orientation + exitapi.js + ExitApi.exit）",
    channel: "google",
    path: goodGoogleZip,
    expect: (result) => {
      const orientation = findCheck(result, "ad.orientation meta")?.status === "pass";
      const exitApi = findCheck(result, "ExitApi 接入完整性")?.status === "pass";
      return orientation && exitApi && result.summary.fail === 0;
    },
  },
  {
    id: "C4",
    title: "正向样例：AppLovin 合规最小模板",
    channel: "applovin",
    path: goodApplovinHtml,
    expect: (result) => result.summary.fail === 0,
  },
  {
    id: "R1",
    title: "补充：真实 AppLovin 正向样例",
    channel: "applovin",
    path: REAL_APPLOVIN_GOOD,
    expect: () => true,
  },
];

const outputs = [];
for (const item of cases) {
  const pkg = await parsePlayable(item.path);
  const result = analyzePlayable(pkg, item.channel);
  const pass = item.expect(result);
  outputs.push({ ...item, pass, result });
}

const allRequiredPass = outputs.filter((x) => x.id !== "R1").every((x) => x.pass);

console.log(`\nPlayable Checker Acceptance (${new Date().toISOString()})`);
for (const out of outputs) {
  console.log(`${out.pass ? "✅" : "❌"} ${out.id} ${out.title}`);
  console.log(`   channel=${out.channel} fail=${out.result.summary.fail} warn=${out.result.summary.warn} pass=${out.result.summary.pass}`);
}
console.log(allRequiredPass ? "\nAll required cases passed.\n" : "\nSome required cases failed.\n");

const md = renderTestingMarkdown(outputs, allRequiredPass);
await writeFile(`${ROOT}TESTING.md`, md, "utf8");

process.exit(allRequiredPass ? 0 : 1);

async function buildBadMintegralZip(sourceHtmlPath, outZipPath) {
  const zip = new JSZip();
  zip.file("index.html", await readFile(sourceHtmlPath, "utf8"));
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await writeFile(outZipPath, buf);
}

async function buildGoodGoogleZip(outZipPath) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="ad.orientation" content="portrait,landscape">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>
  <style>html,body{margin:0;height:100%;font-family:sans-serif}button{position:fixed;left:50%;bottom:8%;transform:translateX(-50%);padding:12px 20px}</style>
</head>
<body>
  <button onclick="ExitApi.exit()">Install</button>
</body>
</html>`;
  const zip = new JSZip();
  zip.file("index.html", html);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await writeFile(outZipPath, buf);
}

async function buildGoodApplovinSample(outPath) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>
  <button id="cta">Play</button>
  <script>
    function track(name){
      if(typeof window.ALPlayableAnalytics !== "undefined"){
        window.ALPlayableAnalytics.trackEvent(name);
      }
    }
    track("LOADING");
    track("LOADED");
    track("DISPLAYED");
    document.getElementById("cta").addEventListener("click", function(){
      track("CTA_CLICKED");
      if(window.mraid){ mraid.open("https://play.google.com/store/apps/details?id=com.example"); }
    });
  </script>
</body>
</html>`;
  await writeFile(outPath, html, "utf8");
}

async function parsePlayable(path) {
  const bytes = await readFile(path);
  const name = basename(path);
  const isZip = extname(path).toLowerCase() === ".zip";

  if (!isZip) {
    const text = bytes.toString("utf8");
    const entry = {
      path: name,
      size: bytes.length,
      ext: extname(name).slice(1).toLowerCase(),
      text,
      bytes: new Uint8Array(bytes),
    };
    return {
      isZip: false,
      uploadName: name,
      sizeBytes: bytes.length,
      entries: [entry],
      entryMap: new Map([[entry.path, entry]]),
      mainHtmlPath: entry.path,
      mainHtmlText: text,
      allText: text,
    };
  }

  const zip = await JSZip.loadAsync(bytes);
  const entries = [];
  const entryMap = new Map();
  for (const rawPath of Object.keys(zip.files).sort((a, b) => a.localeCompare(b))) {
    const item = zip.files[rawPath];
    if (item.dir) continue;
    const normalized = normalizePath(rawPath);
    const data = await item.async("uint8array");
    const ext = extname(normalized).slice(1).toLowerCase();
    const entry = { path: normalized, size: data.byteLength, ext, bytes: data, text: null };
    if (isTextEntry(normalized)) entry.text = new TextDecoder("utf-8").decode(data);
    entries.push(entry);
    entryMap.set(normalized, entry);
  }

  const htmls = entries.filter((e) => e.ext === "html" || e.ext === "htm");
  const main = htmls.find((e) => e.path === "index.html") || htmls[0];
  const allText = entries.filter((e) => typeof e.text === "string").map((e) => e.text).join("\n/* --- */\n");

  return {
    isZip: true,
    uploadName: name,
    sizeBytes: bytes.length,
    entries,
    entryMap,
    mainHtmlPath: main.path,
    mainHtmlText: main.text || "",
    allText,
  };
}

function findCheck(result, title) {
  return result.checks.find((check) => check.title === title);
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function renderTestingMarkdown(outputs, allRequiredPass) {
  const rows = outputs.map((out) => {
    const summary = `fail ${out.result.summary.fail} / warn ${out.result.summary.warn} / pass ${out.result.summary.pass}`;
    return `| ${out.id} | ${out.title} | ${out.channel} | \`${out.path}\` | ${out.pass ? "✅" : "❌"} | ${summary} |`;
  }).join("\n");

  const notes = [
    "- C1 与 C2 使用本机真实素材来源（来自 `Creatives` 目录）。",
    "- C3 为按规则构造的 Google 正向 ZIP（当前创意目录里未保留可直接复用的 Google ZIP 样本）。",
    "- C4 为构造的 AppLovin 合规模板，用于验证工具不会“只会报错”。",
    "- R1 是额外的真实正向样例（Jigsaw Fall AppLovin），用于补充对真实文件的通过路径观察。",
  ];

  return `# Playable Checker Testing

执行时间：${new Date().toISOString()}

总体结果：${allRequiredPass ? "✅ 通过（必测 4 项全部符合预期）" : "❌ 未通过（至少 1 项不符合预期）"}

| Case | 用例 | 渠道 | 文件 | 结果 | 汇总 |
| --- | --- | --- | --- | --- | --- |
${rows}

## 关键断言

- C1：必须命中“ALPlayableAnalytics 埋点调用”失败。
- C2：必须命中“Mintegral ZIP 结构”警告或失败。
- C3：必须通过 ad.orientation + ExitApi 接入检查，且整体无失败。
- C4：至少一个完全合规样例可全绿（无失败）。

## 说明

${notes.join("\n")}
`;
}
