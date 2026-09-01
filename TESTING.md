# Playable Checker Testing

执行时间：2026-09-01T10:21:10.394Z

总体结果：✅ 通过（必测 4 项全部符合预期）

| Case | 用例 | 渠道 | 文件 | 结果 | 汇总 |
| --- | --- | --- | --- | --- | --- |
| C1 | AppLovin 无 ALPlayableAnalytics 调用 | applovin | `/Users/sven/Desktop/Creatives/Cube Tap Away/Playable/Applovin/CTAP021_APL_260901.html` | ✅ | fail 1 / warn 1 / pass 7 |
| C2 | Mintegral ZIP 裸 index 结构 | mintegral | `/Users/sven/Desktop/UA_Work_Tools/playable-checker/fixtures/generated/YSP020_bad_structure.zip` | ✅ | fail 0 / warn 2 / pass 7 |
| C3 | Google ZIP（ad.orientation + exitapi.js + ExitApi.exit） | google | `/Users/sven/Desktop/UA_Work_Tools/playable-checker/fixtures/generated/google_good_sample.zip` | ✅ | fail 0 / warn 0 / pass 10 |
| C4 | 正向样例：AppLovin 合规最小模板 | applovin | `/Users/sven/Desktop/UA_Work_Tools/playable-checker/fixtures/generated/applovin_good_sample.html` | ✅ | fail 0 / warn 1 / pass 8 |
| R1 | 补充：真实 AppLovin 正向样例 | applovin | `/Users/sven/Desktop/Creatives/Jigsaw Fall/Playable/Applovin/JFP001_APL_260724.html` | ✅ | fail 0 / warn 1 / pass 8 |

## 关键断言

- C1：必须命中“ALPlayableAnalytics 埋点调用”失败。
- C2：必须命中“Mintegral ZIP 结构”警告或失败。
- C3：必须通过 ad.orientation + ExitApi 接入检查，且整体无失败。
- C4：至少一个完全合规样例可全绿（无失败）。

## 说明

- C1 与 C2 使用本机真实素材来源（来自 `Creatives` 目录）。
- C3 为按规则构造的 Google 正向 ZIP（当前创意目录里未保留可直接复用的 Google ZIP 样本）。
- C4 为构造的 AppLovin 合规模板，用于验证工具不会“只会报错”。
- R1 是额外的真实正向样例（Jigsaw Fall AppLovin），用于补充对真实文件的通过路径观察。
