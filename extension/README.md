# 浏览器扩展（Chrome / Edge）

Manifest V3 本地安装版，支持 Claude、ChatGPT、Gemini、Grok。无需油猴或 API Key，不需要服务端。

## 安装

1. 在仓库根目录执行 `npm run build:extension`（构建只使用 Node.js 标准库）。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启「开发者模式」，点击「加载已解压的扩展程序」，选择本目录 `extension/`。
4. 关闭同一浏览器中的油猴版脚本，避免两个导出入口互相干扰。
5. 刷新已打开的 AI 会话页面。

如果使用打包好的 ZIP，先解压，再选择其中包含 `manifest.json` 的目录，无需运行构建。

## 使用

- 点击网页右下角「导出」，或浏览器工具栏中的扩展图标 →「导出 Markdown」。
- Claude 请打开 `/chat/...` 或 `/share/...`。首页不显示网页导出入口。
- 长会话导出时保持当前会话打开，避免滚动或切换会话。进度显示在网页菜单中。
- 工具栏「设置」可修改称呼、脱敏、自动加载、标题确认和诊断选项。保存后刷新会话页面生效。
- 「导出诊断数据」用于排查平台页面改版问题。诊断不包含消息正文，但包含网址及标题，分享前请检查。

## 权限和数据

扩展仅请求 `storage` 权限来保存本地设置，并在 manifest 列出的五个域名中注入内容脚本（ChatGPT 包含新旧两个域名）。不请求全站访问、浏览历史、Cookie 或下载管理权限。通过页面 Blob 下载 Markdown，不上传聊天内容，不同步设置到账号。

## 开发

- `manifest.json`：权限和加载入口。
- `popup.*`：工具栏弹窗。
- `options.*`、`settings.js`：设置界面和配置校验。
- `bridge.js`：扩展消息与导出核心之间的接口。
- `content.js`：构建生成文件，不手工编辑、不提交。

核心仍以根目录 `ai-chat-to-markdown.user.js` 为单一来源。`scripts/build-extension.js` 去掉油猴元数据、注入扩展配置和消息接口；锚点变动时构建会直接报错。修改核心后必须重新构建，并在扩展管理页点击刷新、刷新会话页。

运行 `npm run test:extension`，用真实 Chromium 扩展上下文及四个平台的本地模拟页面验证安装、设置持久化、下载和工具栏消息。可用 `CHROMIUM_PATH` 指定本机 Chromium 可执行文件。

此版本尚未上架商店；测试不代表已经验证各平台当前真实登录页面的所有结构。
