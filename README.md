# AI Chat to Markdown

一键把 AI 会话导出成**逐轮 Markdown** 的油猴脚本。支持 Claude（分享页）、ChatGPT、Gemini、Grok。

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

导出过程中别滚动或切换页面，长会话可能要等几十秒。

## 支持的站点

| 站点 | 支持的页面 | 说明 |
| --- | --- | --- |
| Claude | 仅分享页 `claude.ai/share/*` | 普通会话页不支持，先点「Share」生成分享链接再导出 |
| ChatGPT | `chatgpt.com`、`chat.openai.com` 的会话页 | 虚拟列表，会从顶到底逐屏滚动收集；分享页未实测 |
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

## 导出失败怎么办

1. 确认打开的是具体某条会话，并且 Claude 用的是分享页。
2. 刷新页面再试一次。
3. 还不行的话，点 **🔧 导出诊断数据**，把下载的 JSON 附在 [Issue](https://github.com/Lord-Eve/ai-chat-to-markdown/issues/new) 里，并说明：哪个站点、什么页面（会话页 / 分享页）、出了什么问题（没反应、角色分错、内容缺失……）。

诊断 JSON **不含消息正文**，只包含：页面网址和会话标题、识别到的消息数和角色数、几个选择器的命中数、页面上的标签名和类名样本。介意的话，可以在提交前把网址和标题删掉。

## 开发与测试

`tests/` 里是 Playwright 测试：把站点域名的请求拦截到本地模拟页，注入脚本，点击导出，再检查 Markdown 的结构（轮数、角色、公式、代码块、表格、工具小注等）。模拟页包括四个站点的静态页、Gemini 分享页，以及一个只挂载视口附近消息的 ChatGPT 虚拟列表页。

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

- Install a userscript manager (Tampermonkey / Violentmonkey / ScriptCat), then [install from GitHub](https://raw.githubusercontent.com/Lord-Eve/ai-chat-to-markdown/main/ai-chat-to-markdown.user.js), [Greasy Fork](https://greasyfork.org/scripts/597047) or [ScriptCat](https://scriptcat.org/zh-CN/script-show-page/8113).
- Open a conversation and click **⬇ 导出 … 会话** (Export) in the bottom-right corner.
- Math is exported as TeX; tool calls and thinking are collapsed into a short italic note; attachments are marked but not exported.
- The UI and output labels are in Chinese. Set `USER_LABEL` in `CFG` to change your name in the output.
- If export breaks, click **🔧 导出诊断数据** (Export diagnostics) and attach the JSON to an [issue](https://github.com/Lord-Eve/ai-chat-to-markdown/issues/new). It contains the page URL and title plus selector counts and class-name samples, but no message text.
