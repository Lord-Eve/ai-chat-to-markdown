// 用 Playwright 在模拟页面上跑油猴脚本，检查导出的 Markdown 结构。
// 用法：npm test        （或 node tests/run.js）
// 指定别的脚本版本：SCRIPT=path/to/other.user.js node tests/run.js
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(
  process.env.SCRIPT || path.join(ROOT, 'ai-chat-to-markdown.user.js'),
  'utf8'
);
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

/* ---------- 从导出的 Markdown 里拆出结构 ---------- */

function parse(md) {
  const title = (md.match(/^# (.+)$/m) || [])[1];
  const body = md.split(/^## 备注$/m)[0];
  const turns = body.split(/^## 第 \d+ 轮$/m).slice(1).map((t) => {
    const user = t.match(/\*\*User：\*\*\n\n([\s\S]*?)(?=\n\*\*\w+：\*\*|\n---\n|$)/);
    const ai = t.match(/\*\*(Claude|ChatGPT|Gemini|Grok)：\*\*\n\n([\s\S]*?)(?=\n---\n|$)/);
    return {
      user: user ? user[1].trim() : null,
      ai: ai ? ai[2].trim() : null,
    };
  });
  return { title, turns };
}

/* ---------- 测试用例 ---------- */

const CASES = [
  {
    name: 'Claude 分享页',
    url: 'https://claude.ai/share/test-123',
    html: fixture('claude-share.html'),
    check(md, { title, turns }) {
      assert.strictEqual(title, '勾股定理小测验');
      assert.strictEqual(turns.length, 2);
      assert.match(md, /参与者\*\*：User \/ Claude/);
      assert.match(turns[0].user, /^> \*\[附件：分享快照中未显示\]\*/);
      assert.match(turns[0].user, /什么是勾股定理？/);
      assert.doesNotMatch(turns[0].user, /notes\.pdf/, '附件名不应进正文');
      assert.match(turns[0].ai, /^\*（Used 2 tools）\*/, '工具调用应压成开头的斜体小注');
      assert.match(turns[0].ai, /\$a\^2\+b\^2=c\^2\$/, '行内公式');
      assert.match(turns[0].ai, /\$\$\nc=\\sqrt\{a\^2\+b\^2\}\n\$\$/, '块级公式');
      assert.match(turns[0].ai, /```python\nprint\(3\*\*2 \+ 4\*\*2\)\n```/);
      assert.match(turns[0].ai, /\| a \| b \| c \|\n\| --- \| --- \| --- \|\n\| 3 \| 4 \| 5 \|/);
      assert.doesNotMatch(md, /Shared by|^Copy$/m, '界面提示行应被剔除');
      assert.match(turns[1].ai, /不客气，\*\*加油\*\*！/);
      assert.match(turns[1].ai, /- 第一点\n  - 子项\n- 第二点/, '嵌套列表');
    },
  },
  {
    name: 'ChatGPT 静态页',
    url: 'https://chatgpt.com/c/static-test',
    html: fixture('chatgpt-static.html'),
    check(md, { title, turns }) {
      assert.strictEqual(title, 'Static Test');
      assert.strictEqual(turns.length, 2);
      assert.strictEqual(turns[0].user, 'Hello there');
      assert.strictEqual(turns[0].ai, '*（Thought for 5 seconds）*\n\nGeneral *Kenobi*.');
      assert.doesNotMatch(md, /You said|ChatGPT said/);
      assert.strictEqual(turns[1].ai, 'Second answer with `code`.');
    },
  },
  {
    name: 'ChatGPT 虚拟列表（60 条消息，只挂载视口附近）',
    url: 'https://chatgpt.com/c/virtual-test',
    html: fixture('chatgpt-virtual.html'),
    timeout: 120000,
    async before(page) {
      const n = await page.evaluate(() => document.querySelectorAll('[data-message-author-role]').length);
      assert.ok(n < 20, `模拟页应只挂载一部分消息，实际挂载了 ${n} 条`);
    },
    check(md, { turns }) {
      assert.strictEqual(turns.length, 30, '30 轮一轮不缺');
      turns.forEach((t, i) => {
        assert.strictEqual(t.user, `Question ${i + 1}`, `第 ${i + 1} 轮用户`);
        assert.strictEqual(t.ai, `Answer ${i + 1}`, `第 ${i + 1} 轮 AI`);
      });
    },
  },
  {
    name: 'Gemini 会话页',
    url: 'https://gemini.google.com/app/abc123',
    html: fixture('gemini-chat.html'),
    check(md, { title, turns }) {
      assert.strictEqual(title, '公式对话');
      assert.strictEqual(turns.length, 2);
      assert.strictEqual(turns[0].user, '写出欧拉公式');
      assert.match(turns[0].ai, /\$e\^\{i\\pi\}\+1=0\$/);
      assert.match(turns[0].ai, /\$\$\ne\^\{ix\}=\\cos x\+i\\sin x\n\$\$/);
      assert.doesNotMatch(turns[0].ai, /thinking text|显示思路|复制/);
      assert.doesNotMatch(md, /^Gemini$/m, '回复头部的 bot 名不应进正文');
      assert.strictEqual(turns[1].ai, '不客气。');
    },
  },
  {
    name: 'Gemini 分享页（无 model-response）',
    url: 'https://gemini.google.com/share/f00dcafe',
    html: fixture('gemini-share.html'),
    diag: { user: 2, ai: 2 },
    check(md, { title, turns }) {
      assert.strictEqual(title, '分享页测试标题');
      assert.strictEqual(turns.length, 2);
      assert.strictEqual(turns[0].user, '第一问');
      assert.strictEqual(turns[0].ai, '第一答');
      assert.strictEqual(turns[1].user, '第二问');
      assert.strictEqual(turns[1].ai, '第二答\n\n1. 甲\n2. 乙');
      assert.doesNotMatch(md, /^Gemini$|分享$/m);
    },
  },
  {
    name: 'Grok（含容易误判的排版类名）',
    url: 'https://grok.com/share/test-abc',
    html: fixture('grok.html'),
    diag: { user: 2, ai: 2 },
    check(md, { title, turns }) {
      assert.strictEqual(title, 'Tricky Grok Test', '去掉 “| Shared Grok Conversation” 后缀');
      assert.strictEqual(turns.length, 2);
      assert.strictEqual(turns[0].user, 'User asks one');
      assert.match(turns[0].ai, /^\*（Thought for 12s）\*/);
      assert.match(turns[0].ai, /Searched the literature carefully/, '以 Searched 开头的长句是正文，不能被当成工具小注');
      assert.match(turns[0].ai, /Grok answer one\./);
      assert.strictEqual(turns[1].user, 'User asks two', '用户气泡里嵌 items-start 也要认成用户');
      assert.strictEqual(turns[1].ai, '*（Searched 8 web pages）*\n\nGrok answer two.');
    },
  },
];

/* ---------- 运行 ---------- */

async function runCase(browser, c) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  // 把真实域名的请求拦下来，换成本地模拟页，这样 location.hostname 和真实站点一致
  await page.route('**/*', (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: c.html })
      : route.abort()
  );
  // 记录脚本设置的下载文件名（无头 Chromium 对非 ASCII 文件名会退化成 "download"）
  await page.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__dlName = this.download;
      return click.call(this);
    };
  });
  await page.goto(c.url);
  if (c.before) await c.before(page);
  await page.addScriptTag({ content: SCRIPT });

  const exportBtn = page.locator('#ai2md-bar button').first();
  await exportBtn.waitFor();

  if (c.diag) {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#ai2md-bar button', { hasText: '诊断' }).click(),
    ]);
    const dump = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.deepStrictEqual(dump.roles, c.diag, '诊断数据里的角色计数');
  }

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: c.timeout || 30000 }),
    exportBtn.click(),
  ]);
  const md = fs.readFileSync(await dl.path(), 'utf8');
  const fname = await page.evaluate(() => window.__dlName);
  assert.match(fname, /^\d{4}-\d{2}-\d{2}-(Claude|ChatGPT|Gemini|Grok)-.+\.md$/, '文件名格式');
  try {
    c.check(md, parse(md));
  } catch (e) {
    e.message += `\n----- 导出内容 -----\n${md}`;
    throw e;
  }
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const c of CASES) {
    const t0 = Date.now();
    try {
      await runCase(browser, c);
      console.log(`✔ ${c.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`✘ ${c.name}\n  ${e.message.split('\n').join('\n  ')}`);
    }
  }
  await browser.close();
  console.log(failed ? `\n${failed} 个用例失败` : `\n全部 ${CASES.length} 个用例通过`);
  process.exit(failed ? 1 : 0);
})();
