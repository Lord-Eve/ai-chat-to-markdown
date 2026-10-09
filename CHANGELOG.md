# 更新日志 · Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
每个版本都有对应的 [GitHub Release](https://github.com/Lord-Eve/ai-chat-to-markdown/releases)。

## [2.2.3] - 2026-10-09

### 修复
- **ChatGPT：不刷新页面切换会话后，导出会混入上一个会话的内容**，有时还只导出一部分。ChatGPT 切换会话时会把上一个会话藏起来留在页面里；现在按网址里的会话 ID 找到当前会话的滚动区域，只在它里面收集，并丢弃标着其他会话 ID 的轮次。

## [2.2.2] - 2026-10-09

### 修复
- **ChatGPT：登录状态下导出 chat 会话一直卡在「已收集 N 条」。** 新界面的滚动容器是倒序排列（`flex-col-reverse`），在底部时滚动位置为 0、往上为负数，原来的「回到顶部」和「到底」判断都失效。现在用与方向无关的方式滚动和判断到底。
- **ChatGPT：导出途中切换会话，会把两个会话拼在一起下载。** 现在网址变化或滚动区域被替换时立即中止，并提示「已取消」。

## [2.2.1] - 2026-10-09

### 新增
- **适配 ChatGPT 登录后的新界面（2026-10 改版）。** 新界面去掉了 `data-message-author-role` 等标记，改从 `data-content-search-unit-key` 识别用户和 AI；一个 AI 单元里有多条消息时全部导出；「思考了 17s」压成回复开头的斜体小注。

### 改进
- 打开页面后会话还没渲染出来时，最多等 8 秒再判断「没找到会话」。
- 「导出诊断数据」改为只在会话区域取样，并增加 `data-*` 属性名、iframe 数量、会话区域字数，排查改版问题更有效。

## [2.2.0] - 2026-09-22

首个公开版本。

### 新增
- 支持 Claude 分享页、ChatGPT、Gemini、Grok，统一输出逐轮 Markdown：文件头（日期、参与者、来源）、「第 N 轮」分节、末尾备注。
- KaTeX 与 Gemini 公式导出为 TeX；工具调用、思考过程压成斜体小注；附件只标注不导出。
- ChatGPT 虚拟列表逐屏滚动收集，按消息 ID 去重。
- 「导出诊断数据」按钮：不含消息正文，用于提交问题。
- 发布到 GitHub、[Greasy Fork](https://greasyfork.org/scripts/597047)、[脚本猫](https://scriptcat.org/zh-CN/script-show-page/8113)，自动同步更新。

### 修复（相对私用版 2.1.0）
- Gemini 分享页没有 `<model-response>`，AI 回复全部丢失。
- Grok 角色判断只认完整类名，避开 `md:items-end` 这类响应式变体；标题去掉「| Shared Grok Conversation」后缀。
- 工具提示只匹配 80 字以内的短行，不再吞掉以「Searched…」开头的正文。

[2.2.3]: https://github.com/Lord-Eve/ai-chat-to-markdown/compare/v2.2.2...v2.2.3
[2.2.2]: https://github.com/Lord-Eve/ai-chat-to-markdown/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/Lord-Eve/ai-chat-to-markdown/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/Lord-Eve/ai-chat-to-markdown/releases/tag/v2.2.0
