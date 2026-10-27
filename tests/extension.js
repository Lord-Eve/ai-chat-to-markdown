'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const root = path.join(__dirname, '..');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai2md-extension-'));
  const extension = path.join(root, 'extension');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.route('https://claude.ai/**', route => route.fulfill({
      contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, 'fixtures/claude-chat.html'), 'utf8'),
    }));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const worlds = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await cdp.send('Runtime.enable');
    await page.goto('https://claude.ai/chat/extension-test');
    await page.locator('#ai2md-tab').waitFor();
    const world = worlds.find(w => w.origin.startsWith('chrome-extension://'));
    assert.ok(world, 'Real extension isolated world must be present');
    const id = new URL(world.origin).hostname;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.locator('button').waitFor();
    await options.locator('input[name=USER_LABEL]').fill('测试用户');
    await options.locator('button').click();
    await options.getByText('已保存。请刷新会话页面使设置生效。').waitFor();
    await options.reload();
    assert.equal(await options.locator('input[name=USER_LABEL]').inputValue(), '测试用户');
    await page.reload();
    await page.locator('#ai2md-tab').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#ai2md-export').click();
    const download = await downloadPromise;
    const markdown = fs.readFileSync(await download.path(), 'utf8');
    assert.match(markdown, /\*\*测试用户：\*\*/);
    assert.match(markdown, /看到了图片/);
    // Exercise the same runtime messaging API used by the toolbar popup from an extension page.
    const result = await options.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, { type: 'ai2md', action: 'status' });
          if (result?.platform) return { result, tabId: tab.id };
        } catch {}
      }
    });
    assert.equal(result.result.platform, 'Claude');
    const secondDownload = page.waitForEvent('download');
    assert.equal((await options.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'ai2md', action: 'export' }), result.tabId)).started, true);
    await secondDownload;
    await page.goto('https://claude.ai/new');
    await page.waitForTimeout(600);
    const home = await options.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'ai2md', action: 'status' }), result.tabId);
    assert.match(home.error, /具体会话/);
    for (const [url, fixture, expected] of [
      ['https://chatgpt.com/c/test', 'chatgpt-static.html', 'General'],
      ['https://gemini.google.com/app/test', 'gemini-chat.html', '欧拉'],
      ['https://grok.com/share/test', 'grok.html', 'Grok answer one'],
    ]) {
      await context.route(url, route => route.fulfill({ contentType: 'text/html',
        body: fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8') }));
      await page.goto(url);
      await page.locator('#ai2md-tab').click();
      const downloaded = page.waitForEvent('download');
      await page.locator('#ai2md-export').click();
      const file = await downloaded;
      assert.ok(fs.readFileSync(await file.path(), 'utf8').includes(expected));
    }
    console.log('✔ Four-platform exports; real MV3 installation, persistent settings, Markdown downloads, toolbar messaging, homepage guard');
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
