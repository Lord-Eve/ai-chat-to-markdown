# AI Chat to Markdown

[![Greasy Fork 版本](https://img.shields.io/greasyfork/v/597047?label=Greasy%20Fork&color=670000)](https://greasyfork.org/scripts/597047)
[![Greasy Fork 安装量](https://img.shields.io/greasyfork/dt/597047?label=installs&color=670000)](https://greasyfork.org/scripts/597047)
[![最新版本](https://img.shields.io/github/v/release/Lord-Eve/ai-chat-to-markdown?label=release)](https://github.com/Lord-Eve/ai-chat-to-markdown/releases/latest)
[![测试](https://img.shields.io/github/actions/workflow/status/Lord-Eve/ai-chat-to-markdown/test.yml?branch=main&label=tests)](https://github.com/Lord-Eve/ai-chat-to-markdown/actions/workflows/test.yml)
[![许可证](https://img.shields.io/github/license/Lord-Eve/ai-chat-to-markdown)](LICENSE)

一键把 AI 会话导出成**逐轮 Markdown** 的油猴脚本。支持 Claude（分享页）、ChatGPT、Gemini、Grok。

**它适合谁：** 想把 AI 会话当资料长期归档、日后还要翻阅和检索的人。它不做多格式备份，只输出一种结构固定、方便阅读的 Markdown：文件头写明日期、参与者和来源，正文按「第 N 轮」分节，公式保留为 TeX，工具调用和思考过程压成一行小注，不打断正文。所有站点导出的格式都一样，放进笔记软件或 Git 仓库里能直接对比、搜索。如果你要的是 PDF、JSON 等多种格式，或者需要支持更多站点，Greasy Fork 上有覆盖面更广的同类脚本。

*English summary at the bottom.*

## 安装

需要先装一个用户脚本管理器：[Tampermonkey](https://www.tampermonkey.net/)、[Violentmonkey](https://violentmonkey.github.io/) 或 [脚本猫](https://scriptcat.org/)。

然后任选一个来源安装：

- **GitHub**：[点这里安装](https://raw.githubusercontent.com/Lord-Eve/ai-chat-to-markdown/main/ai-chat-to-markdown.user.js)
- **Greasy Fork**：[greasyfork.org/scripts/597047](https://greasyfork.org/scripts/597047)
- **脚本猫**：[scriptcat.org/script-show-page/8113](https://scriptcat.org/zh-CN/script-show-page/8113)

三个来源是同一份代码，Greasy Fork 和脚本猫都从本仓库自动同步。

## 使用

打开一条会话，页面右下角会出现两个按钮：

- **⬇ 导出 XX 会话**：自动滚动加载完整会话，然后下载 `.md` 文件
- **🔧 导出诊断数据**：导出失败时用来排错（见下文）

导出过程中别滚动页面，长会话可能要等几十秒。中途切换到别的会话，导出会自动取消，不会把两个会话混在一起。

## 支持的站点

| 站点 | 支持的页面 | 说明 |
| --- | --- | --- |
| Claude | 仅分享页 `claude.ai/share/*` | 普通会话页不支持，先点「Share」生成分享链接再导出 |
| ChatGPT | `chatgpt.com`、`chat.openai.com` 的会话页，含登录后的新界面 | 虚拟列表，会从顶到底逐屏滚动收集；切换会话后不用刷新 |
| Gemini | `gemini.google.com` 的会话页和分享页 | |
| Grok | `grok.com` 的会话页和分享页 | 不支持 X（Twitter）里的 Grok |

## 导出格式

```markdown
# 会话标题

- **日期**：2026-09-22
- **参与者**：User / ChatGPT
- **来源**：ChatGPT（https://chatgpt.com/c/...）

---

## 第 1 轮

**User：**

问题……

**ChatGPT：**

*（Thought for 8 seconds）*

回答……

---

## 备注
...
```

- 标题、列表、代码块（带语言）、表格、引用、链接、粗斜体都会转换
- KaTeX 公式（Claude / ChatGPT）和 Gemini 的公式导出为 TeX：`$...$`、`$$...$$`
- 工具调用、思考过程压成回答开头的一行斜体小注
- 「复制」「重试」之类的界面文字会被剔除

## 设置

在脚本管理器里编辑脚本，改开头的 `CFG`：

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `USER_LABEL` | `'User'` | 你在 Markdown 里的称呼，比如改成 `'我'` |
| `REDACT_CONTACTS` | `false` | 遮挡疑似手机号 / QQ 号 |
| `AUTO_LOAD` | `true` | 导出前自动滚动加载早期消息 |
| `DIAG_BUTTON` | `true` | 显示「导出诊断数据」按钮 |
| `DEBUG` | `false` | 在控制台打印调试日志 |

注意：直接改脚本的话，脚本自动更新时会被覆盖，更新后需要重新改。

## 已知限制

- **附件和图片不导出**，只在原位置标注 `[附件：…]`。
- **「日期」是导出当天**，不是会话发生的日期。
- 编辑过的消息、重新生成的回答，只导出页面上当前显示的那个版本。
- Canvas、Artifacts、代码运行结果这类特殊组件可能缺失或只剩文字。
- 脚本靠页面结构识别消息，**网站改版后可能失效**。Grok 靠排版类名（靠右是用户、靠左是 AI）区分角色，最容易受改版影响。

## 版本与更新

- 通过任一来源安装后，脚本管理器会**自动更新**到最新版，不用手动重装。
- 每个版本改了什么，见 [CHANGELOG](CHANGELOG.md) 和 [Releases](https://github.com/Lord-Eve/ai-chat-to-markdown/releases)。
- 当前版本可以在脚本管理器的脚本列表里看到。

## 导出失败怎么办

1. 确认打开的是具体某条会话，并且 Claude 用的是分享页。
2. 刷新页面再试一次；顺便确认脚本已经是[最新版本](https://github.com/Lord-Eve/ai-chat-to-markdown/releases/latest)。
3. 还不行的话，点 **🔧 导出诊断数据**，然后[提交问题](https://github.com/Lord-Eve/ai-chat-to-markdown/issues/new/choose)。表单会引导你填写站点、页面类型和版本号，下载的 JSON 直接拖进去就行。

诊断 JSON **不含消息正文**，只包含：页面网址和会话标题、识别到的消息数和角色数、几个选择器的命中数、页面上的标签名和类名样本。介意的话，可以在提交前把网址和标题删掉。

## 开发与测试

`tests/` 里是 Playwright 测试：把站点域名的请求拦截到本地模拟页，注入脚本，点击导出，再检查 Markdown 的结构（轮数、角色、公式、代码块、表格、工具小注等）。模拟页包括四个站点的静态页、Gemini 分享页、一个只挂载视口附近消息的 ChatGPT 虚拟列表页，以及 ChatGPT 登录后的新界面（2026-10 改版：没有角色标记、倒序滚动容器、内容延迟出现、上一个会话残留在页面里），另有一个「导出途中切换会话」的用例。每次推送和 PR 都会在 [GitHub Actions](https://github.com/Lord-Eve/ai-chat-to-markdown/actions/workflows/test.yml) 上自动运行。

```bash
npm install
npx playwright install chromium
npm test
```

模拟页只能保证转换逻辑正确，不能代替真实页面：改选择器之后，请在真实站点上再试一遍。

各站点的选择器都集中在脚本里的 `ADAPTERS`，每个站点一个适配器（`collect` / `content` / `clean` / `title` / `noise` / `tool`）；HTML → Markdown 的转换逻辑是共用的。欢迎 PR。

## 许可证

[MIT](LICENSE) © Lord Eve

---

## English

A userscript that exports AI conversations to turn-by-turn Markdown with one click. Supports **Claude** (share pages `claude.ai/share/*` only), **ChatGPT**, **Gemini** and **Grok** (grok.com only).

Built for archiving rather than backup: every site produces the same fixed, readable layout — a header with date, participants and source, one section per turn, math kept as TeX, and tool calls / thinking collapsed into a one-line note — so exports sit well in a notes app or a Git repo. If you need PDF/JSON or more sites, broader exporters exist on Greasy Fork.

- Install a userscript manager (Tampermonkey / Violentmonkey / ScriptCat), then [install from GitHub](https://raw.githubusercontent.com/Lord-Eve/ai-chat-to-markdown/main/ai-chat-to-markdown.user.js), [Greasy Fork](https://greasyfork.org/scripts/597047) or [ScriptCat](https://scriptcat.org/zh-CN/script-show-page/8113).
- Open a conversation and click **⬇ 导出 … 会话** (Export) in the bottom-right corner.
- Math is exported as TeX; tool calls and thinking are collapsed into a short italic note; attachments are marked but not exported.
- The UI and output labels are in Chinese. Set `USER_LABEL` in `CFG` to change your name in the output.
- The script updates itself automatically; see the [changelog](CHANGELOG.md) and [releases](https://github.com/Lord-Eve/ai-chat-to-markdown/releases) for what changed.
- If export breaks, click **🔧 导出诊断数据** (Export diagnostics) and [open an issue](https://github.com/Lord-Eve/ai-chat-to-markdown/issues/new/choose) with the JSON attached. It contains the page URL and title plus selector counts and page-structure samples, but no message text.
