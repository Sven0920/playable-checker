# Playable Checker Testing

执行时间：2026-11-17T10:42:23.590Z

总体结果：✅ 通过（已执行的必测项符合预期，3 项因本机素材不在这台机器上而跳过）

| Case | 用例 | 渠道 | 文件 | 结果 | 汇总 |
| --- | --- | --- | --- | --- | --- |
| C1 | AppLovin 无 ALPlayableAnalytics 调用 | applovin | `/Users/sven/Desktop/Creatives/Cube Tap Away/Playable/Applovin/CTAP021_APL_260901.html` | ⏭️ 跳过 | 本机文件不存在 |
| C2 | Mintegral ZIP 裸 index 结构 | mintegral | `/workspace/fixtures/generated/YSP020_bad_structure.zip` | ✅ | fail 0 / warn 2 / manual 0 / pass 7 |
| C3 | Google ZIP（ad.orientation + exitapi.js + ExitApi.exit） | google | `/workspace/fixtures/generated/google_good_sample.zip` | ✅ | fail 0 / warn 0 / manual 0 / pass 10 |
| C4 | 正向样例：AppLovin 合规最小模板 | applovin | `/workspace/fixtures/generated/applovin_good_sample.html` | ✅ | fail 0 / warn 1 / manual 0 / pass 8 |
| C5 | 团结引擎 AppLovin：静态无埋点特征时应给出“待人工验证” | applovin | `/Users/sven/Desktop/Creatives/Jigsaw Fall/Playable/Applovin/JFP011_APL_260901.html` | ⏭️ 跳过 | 本机文件不存在 |
| C6 | AppLovin Base122 + Brotli：解压后能看到 DISPLAYED | applovin | `/workspace/fixtures/generated/applovin_base122_sample.html` | ✅ | fail 0 / warn 1 / manual 0 / pass 8 |
| C7 | AppLovin Base122 + Brotli：解压后仍没有埋点应失败 | applovin | `/workspace/fixtures/generated/applovin_base122_missing_sample.html` | ✅ | fail 2 / warn 1 / manual 0 / pass 6 |
| R1 | 补充：真实 AppLovin 正向样例 | applovin | `/Users/sven/Desktop/Creatives/Jigsaw Fall/Playable/Applovin/JFP001_APL_260724.html` | ⏭️ 跳过 | 本机文件不存在 |

## 关键断言

- C1：必须命中“ALPlayableAnalytics 埋点调用”失败。
- C2：必须命中“Mintegral ZIP 结构”警告或失败。
- C3：必须通过 ad.orientation + ExitApi 接入检查，且整体无失败。
- C4：至少一个完全合规样例可全绿（无失败）。
- C5：团结引擎导出的 AppLovin 样例在静态未命中埋点时，必须显示“待人工验证”，不能判失败。
- C6：Base122 + Brotli 素材必须在解压后命中 DISPLAYED、埋点调用和 mraid.open，且整体无失败。
- C7：Base122 + Brotli 素材解压后如果仍然没有埋点，必须判失败。

## 说明

- C1 与 C2 使用本机真实素材来源（来自 `Creatives` 目录）。文件不在当前机器上时记为跳过，不记失败。
- C3 为按规则构造的 Google 正向 ZIP（当前创意目录里未保留可直接复用的 Google ZIP 样本）。
- C4 为构造的 AppLovin 合规模板，用于验证工具不会“只会报错”。
- C5 使用真实团结引擎样例 `JFP011_APL_260901.html`，验证 WASM 场景下的“待人工验证”分支。
- C6 为 Base122 + Brotli 打包的 AppLovin 样例，明文不含 DISPLAYED，解压后的脚本里有。
- C7 为同样打包、但解压后仍然没有埋点的样例，必须继续判失败，不能因为“是压缩包”就放过。
- R1 是额外的真实正向样例（Jigsaw Fall AppLovin），用于补充对真实文件的通过路径观察。
