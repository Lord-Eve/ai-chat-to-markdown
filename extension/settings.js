'use strict';
// Shared by the settings page and generated content script. Ignore unknown keys.
const SETTINGS_DEFAULTS = {
  USER_LABEL: 'User', REDACT_CONTACTS: false, AUTO_LOAD: true,
  DIAG_BUTTON: true, ASK_TITLE: true, DEBUG: false,
};
function normalizeSettings(value) {
  const result = { ...SETTINGS_DEFAULTS };
  if (!value || typeof value !== 'object') return result;
  for (const key of Object.keys(result)) {
    if (key === 'USER_LABEL' && typeof value[key] === 'string') {
      result[key] = value[key].replace(/[\r\n]/g, ' ').trim().slice(0, 80) || 'User';
    } else if (typeof result[key] === 'boolean' && typeof value[key] === 'boolean') {
      result[key] = value[key];
    }
  }
  return result;
}
