# Playable 试玩广告自查工具

纯静态网页工具：把 Playable（`.html/.zip`）拖进页面，按渠道做静态检查，并在页面内做一轮半自动运行时验证。

## 在线部署形态

- 前端静态文件：`index.html` + `styles.css` + `app.js` + `checker-core.js`
- 无后端、无文件上传，检查都在浏览器本地进行
- 适合直接部署到 GitHub Pages

## 支持渠道（仅这 7 个）

- AppLovin
- Unity（团结引擎导出）
- Mintegral
- Google Ads
- Meta（Facebook）
- Moloco
- TikTok

> 不包含 Vungle/Liftoff（团队规范尚未核实完成）。

## 使用方法

1. 打开网页，拖入或选择一个 Playable 文件（`.html/.htm/.zip`）。
2. 页面会尝试自动猜渠道；确认下拉框后点击“开始检查”。
3. 阅读结果中的每条 `通过 / 警告 / 失败`（都带“为什么重要”和“怎么修”）。
4. 点击“加载到沙盒”，在 iframe 内手动游玩并触发 CTA；再切换竖屏/横屏/窄框，观察实时日志：
   - `console error/warn`
   - 外部请求信号（fetch/XHR/DOM 资源）
   - `rAF/s` 心跳（转屏后是否掉到 0）

## 检查覆盖

- 体积限制（各渠道口径）
- 文件格式与 ZIP 结构
- 必需 API / Meta / 配置项（如 `ExitApi`、`ad.orientation`、`config.json`）
- 禁止项（如 `mraid.js`、`XMLHttpRequest`、不合规格式）
- Mintegral 生命周期函数暴露与调用痕迹
- AppLovin `ALPlayableAnalytics` 引用和调用痕迹
- 通用“外部 URL 风险”与“资源回落陷阱（__ASSET_URL）”提示

## 已知局限（如实说明）

- 运行时检测是**半自动**：工具只负责注入监控并记录信号，仍需人工在 iframe 里实际操作触发路径。
- 这不是 headless Chrome 全自动审核替代品；特别是 Unity 转屏黑屏/冻结，建议继续配合团队现有 Node 脚本复测。
- 对 ZIP 多文件运行时加载做了常见路径重写，但无法保证 100% 还原所有复杂资源解析逻辑。
- 静态扫描基于字符串/结构规则，不做完整语义分析，个别项目可能需要人工二次判断。

## 本地验收

```bash
npm install
npm run test:acceptance
```

验收结果会更新到 `TESTING.md`。
