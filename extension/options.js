'use strict';
const form = document.getElementById('settings');
const status = document.getElementById('status');
(async () => {
  try {
    const stored = await chrome.storage.local.get('settings');
    const settings = normalizeSettings(stored.settings);
    for (const [key, value] of Object.entries(settings)) {
      const input = form.elements.namedItem(key);
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    }
    form.querySelector('button').disabled = false;
  } catch { status.textContent = '读取设置失败，请重新打开此页面。'; }
})();
form.onsubmit = async (event) => {
  event.preventDefault();
  const settings = {};
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    const input = form.elements.namedItem(key);
    settings[key] = input.type === 'checkbox' ? input.checked : input.value;
  }
  try {
    await chrome.storage.local.set({ settings: normalizeSettings(settings) });
    status.textContent = '已保存。请刷新会话页面使设置生效。';
  } catch { status.textContent = '保存失败，请重试。'; }
};
