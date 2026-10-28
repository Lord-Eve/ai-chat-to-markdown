'use strict';
const status = document.getElementById('status');
let tabId;
async function send(action, extra) {
  return chrome.tabs.sendMessage(tabId, { type: 'ai2md', action, ...extra });
}
async function run(action, extra) {
  try {
    const result = await send(action, extra);
    if (result?.error) status.textContent = result.error;
    else window.close();
  } catch {
    status.textContent = '无法连接页面，请刷新会话页面后重试。';
  }
}
document.getElementById('export').onclick = () => run('export', { images: true });
document.getElementById('export-text').onclick = () => run('export', { images: false });
document.getElementById('diagnostics').onclick = () => run('diagnostics');
document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage();
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;
    const result = await send('status');
    if (result?.error) { status.textContent = result.error; return; }
    status.textContent = result.exporting ? '正在导出，请在页面中查看进度。' : `当前平台：${result.platform}`;
    document.getElementById('export').disabled = result.exporting;
    document.getElementById('export-text').disabled = result.exporting;
    document.getElementById('diagnostics').disabled = false;
  } catch {
    status.textContent = '请打开 Claude、ChatGPT、Gemini 或 Grok 会话。安装扩展后，请刷新已打开的页面。';
  }
})();
