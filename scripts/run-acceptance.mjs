import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { brotliCompressSync } from "node:zlib";
import JSZip from "jszip";
import { analyzePlayable, isTextEntry } from "../checker-core.js";
import { decodeBase122 } from "../packed-text.js";

const ROOT = new URL("../", import.meta.url).pathname;
const FIXTURE_DIR = `${ROOT}fixtures/generated`;

const REAL_APPLOVIN_MISSING_AL = "/Users/sven/Desktop/Creatives/Cube Tap Away/Playable/Applovin/CTAP021_APL_260901.html";
const REAL_MINTEGRAL_HTML = "/Users/sven/Desktop/Creatives/Yarn Sort/Playable/Mintegral/HTML/YSP020_MTG_260805.html";
const REAL_APPLOVIN_GOOD = "/Users/sven/Desktop/Creatives/Jigsaw Fall/Playable/Applovin/JFP001_APL_260724.html";
const REAL_TUANJIE_APPLOVIN_AMBIGUOUS = "/Users/sven/Desktop/Creatives/Jigsaw Fall/Playable/Applovin/JFP011_APL_260901.html";
const BASE122_ILLEGALS = [0, 10, 13, 34, 38, 92, 60];
const BASE122_SHORTENED = 0b111;

await mkdir(FIXTURE_DIR, { recursive: true });

const badMtgZip = `${FIXTURE_DIR}/YSP020_bad_structure.zip`;
const goodGoogleZip = `${FIXTURE_DIR}/google_good_sample.zip`;
const goodApplovinHtml = `${FIXTURE_DIR}/applovin_good_sample.html`;
const packedApplovinHtml = `${FIXTURE_DIR}/applovin_base122_sample.html`;
const packedApplovinMissingHtml = `${FIXTURE_DIR}/applovin_base122_missing_sample.html`;

await buildIfExists(REAL_MINTEGRAL_HTML, () => buildBadMintegralZip(REAL_MINTEGRAL_HTML, badMtgZip));
await buildGoodGoogleZip(goodGoogleZip);
await buildGoodApplovinSample(goodApplovinHtml);
await buildPackedApplovinSample(packedApplovinHtml, packedApplovinScript(true));
await buildPackedApplovinSample(packedApplovinMissingHtml, packedApplovinScript(false));

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
    id: "C5",
    title: "团结引擎 AppLovin：静态无埋点特征时应给出“待人工验证”",
    channel: "applovin",
    path: REAL_TUANJIE_APPLOVIN_AMBIGUOUS,
    expect: (result) => findCheck(result, "ALPlayableAnalytics 埋点调用")?.status === "manual",
  },
  {
    id: "C6",
    title: "AppLovin Base122 + Brotli：解压后能看到 DISPLAYED",
    channel: "applovin",
    path: packedApplovinHtml,
    expect: (result) => {
      const analytics = findCheck(result, "ALPlayableAnalytics 埋点调用");
      const displayed = findCheck(result, "DISPLAYED 事件痕迹");
      const mraid = findCheck(result, "click-through API（mraid.open）");
      return analytics?.status === "pass"
        && displayed?.status === "pass"
        && /解压后的脚本/.test(displayed?.what || "")
        && mraid?.status === "pass"
        && result.summary.fail === 0;
    },
  },
  {
    id: "C7",
    title: "AppLovin Base122 + Brotli：解压后仍没有埋点应失败",
    channel: "applovin",
    path: packedApplovinMissingHtml,
    expect: (result) => findCheck(result, "ALPlayableAnalytics 埋点调用")?.status === "fail"
      && findCheck(result, "DISPLAYED 事件痕迹")?.status === "warn",
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
  let pkg;
  try {
    pkg = await parsePlayable(item.path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      outputs.push({ ...item, pass: false, skipped: true, result: emptyResult() });
      continue;
    }
    throw error;
  }
  const result = await analyzePlayable(pkg, item.channel);
  const pass = item.expect(result);
  outputs.push({ ...item, pass, skipped: false, result });
}

const required = outputs.filter((x) => x.id !== "R1" && !x.skipped);
const allRequiredPass = required.length > 0 && required.every((x) => x.pass);

console.log(`\nPlayable Checker Acceptance (${new Date().toISOString()})`);
for (const out of outputs) {
  const mark = out.skipped ? "⏭️" : out.pass ? "✅" : "❌";
  console.log(`${mark} ${out.id} ${out.title}`);
  if (out.skipped) {
    console.log("   skipped: local creative file is not on this machine");
    continue;
  }
  console.log(`   channel=${out.channel} fail=${out.result.summary.fail} warn=${out.result.summary.warn} manual=${out.result.summary.manual || 0} pass=${out.result.summary.pass}`);
}
console.log(allRequiredPass ? "\nAll required cases passed.\n" : "\nSome required cases failed.\n");

const md = renderTestingMarkdown(outputs, allRequiredPass);
await writeFile(`${ROOT}TESTING.md`, md, "utf8");

process.exit(allRequiredPass ? 0 : 1);

async function buildBadMintegralZip(sourceHtmlPath, outZipPath) {
  const zip = new JSZip();
  zip.file("index.html", await readFile(sourceHtmlPath, "utf8"), { date: new Date("2000-01-01T00:00:00Z") });
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await writeIfChanged(outZipPath, buf);
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
  zip.file("index.html", html, { date: new Date("2000-01-01T00:00:00Z") });
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await writeIfChanged(outZipPath, buf);
}

async function buildIfExists(source, build) {
  try {
    await readFile(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await build();
}

function emptyResult() {
  return { summary: { fail: 0, warn: 0, manual: 0, pass: 0 }, checks: [] };
}

function packedApplovinScript(withAnalytics) {
  if (!withAnalytics) {
    return `function start(){ console.log("packed playable without analytics"); }
start();`;
  }
  return `function track(name){
  if(typeof window.ALPlayableAnalytics?.trackEvent==="function"){
    window.ALPlayableAnalytics.trackEvent(name);
  }
}
track("LOADING");
track("LOADED");
track("DISPLAYED");
document.addEventListener("click",function(){mraid.open("https://play.google.com/store/apps/details?id=com.example.game");});`;
}

async function buildPackedApplovinSample(outPath, script) {
  const compressed = brotliCompressSync(Buffer.from(script, "utf8"));
  const payload = encodeBase122(compressed);
  const roundtrip = decodeBase122(payload);
  if (Buffer.compare(Buffer.from(roundtrip), compressed) !== 0) {
    throw new Error(`Base122 roundtrip failed for ${outPath}`);
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>packed applovin</title></head>
<body>
<pre hidden id="b122-game-code" data-base122>${payload}</pre>
<script>function F(name){return name.startsWith("@b122:b122-game-code");}F("@b122:b122-game-code");</script>
</body>
</html>`;
  await writeIfChanged(outPath, html, "utf8");
}

function encodeBase122(rawData) {
  let curIndex = 0;
  let curBit = 0;
  const outData = [];

  function get7() {
    if (curIndex >= rawData.length) return false;
    const firstByte = rawData[curIndex];
    let firstPart = ((0b11111110 >>> curBit) & firstByte) << curBit;
    firstPart >>= 1;
    curBit += 7;
    if (curBit < 8) return firstPart;
    curBit -= 8;
    curIndex += 1;
    if (curIndex >= rawData.length) return firstPart;
    const secondByte = rawData[curIndex];
    let secondPart = ((0xff00 >>> curBit) & secondByte) & 0xff;
    secondPart >>= 8 - curBit;
    return firstPart | secondPart;
  }

  while (true) {
    const bits = get7();
    if (bits === false) break;
    const illegalIndex = BASE122_ILLEGALS.indexOf(bits);
    if (illegalIndex !== -1) {
      let nextBits = get7();
      let firstByte = 0b11000010;
      let secondByte = 0b10000000;
      if (nextBits === false) {
        firstByte |= (0b111 & BASE122_SHORTENED) << 2;
        nextBits = bits;
      } else {
        firstByte |= (0b111 & illegalIndex) << 2;
      }
      const firstBit = (nextBits & 0b01000000) > 0 ? 1 : 0;
      firstByte |= firstBit;
      secondByte |= nextBits & 0b00111111;
      outData.push(firstByte, secondByte);
    } else {
      outData.push(bits);
    }
  }

  return new TextDecoder("utf-8").decode(Uint8Array.from(outData));
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
  await writeIfChanged(outPath, html, "utf8");
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
    if (out.skipped) {
      return `| ${out.id} | ${out.title} | ${out.channel} | \`${out.path}\` | ⏭️ 跳过 | 本机文件不存在 |`;
    }
    const summary = `fail ${out.result.summary.fail} / warn ${out.result.summary.warn} / manual ${out.result.summary.manual || 0} / pass ${out.result.summary.pass}`;
    return `| ${out.id} | ${out.title} | ${out.channel} | \`${out.path}\` | ${out.pass ? "✅" : "❌"} | ${summary} |`;
  }).join("\n");

  const skipped = outputs.filter((out) => out.skipped).length;
  const headline = allRequiredPass
    ? (skipped
      ? `✅ 通过（已执行的必测项符合预期，${skipped} 项因本机素材不在这台机器上而跳过）`
      : "✅ 通过（必测项全部符合预期）")
    : "❌ 未通过（至少 1 项不符合预期）";

  const notes = [
    "- C1 与 C2 使用本机真实素材来源（来自 `Creatives` 目录）。文件不在当前机器上时记为跳过，不记失败。",
    "- C3 为按规则构造的 Google 正向 ZIP（当前创意目录里未保留可直接复用的 Google ZIP 样本）。",
    "- C4 为构造的 AppLovin 合规模板，用于验证工具不会“只会报错”。",
    "- C5 使用真实团结引擎样例 `JFP011_APL_260901.html`，验证 WASM 场景下的“待人工验证”分支。",
    "- C6 为 Base122 + Brotli 打包的 AppLovin 样例，明文不含 DISPLAYED，解压后的脚本里有。",
    "- C7 为同样打包、但解压后仍然没有埋点的样例，必须继续判失败，不能因为“是压缩包”就放过。",
    "- R1 是额外的真实正向样例（Jigsaw Fall AppLovin），用于补充对真实文件的通过路径观察。",
  ];

  return `# Playable Checker Testing

执行时间：${new Date().toISOString()}

总体结果：${headline}

| Case | 用例 | 渠道 | 文件 | 结果 | 汇总 |
| --- | --- | --- | --- | --- | --- |
${rows}

## 关键断言

- C1：必须命中“ALPlayableAnalytics 埋点调用”失败。
- C2：必须命中“Mintegral ZIP 结构”警告或失败。
- C3：必须通过 ad.orientation + ExitApi 接入检查，且整体无失败。
- C4：至少一个完全合规样例可全绿（无失败）。
- C5：团结引擎导出的 AppLovin 样例在静态未命中埋点时，必须显示“待人工验证”，不能判失败。
- C6：Base122 + Brotli 素材必须在解压后命中 DISPLAYED、埋点调用和 mraid.open，且整体无失败。
- C7：Base122 + Brotli 素材解压后如果仍然没有埋点，必须判失败。

## 说明

${notes.join("\n")}
`;
}

async function writeIfChanged(path, content, encoding = null) {
  try {
    const current = await readFile(path, encoding ? { encoding } : undefined);
    if (encoding) {
      if (current === content) return;
    } else if (Buffer.compare(current, content) === 0) {
      return;
    }
  } catch {
    // file missing; proceed write
  }
  await writeFile(path, content, encoding ? { encoding } : undefined);
}
