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

const claudeChatCheck = (md, { title, turns }) => {
  assert.strictEqual(title, '普通会话');
  assert.strictEqual(turns.length, 2);
  assert.strictEqual(turns[0].user, '> *[附件：图片或文件，未随文本导出]*\n\n解释这份文件');
  assert.match(turns[0].ai, /这是 \*\*回答\*\*。/);
  assert.match(turns[0].ai, /```python\nprint\(1\)\n```/);
  assert.strictEqual(turns[1].user, '> *[附件：图片或文件，未随文本导出]*');
  assert.strictEqual(turns[1].ai, '看到了图片。');
  assert.doesNotMatch(md, /尚未发送|草稿|侧栏|分享快照/);
};

const CASES = [
  {
    name: 'Claude 虚拟列表多条无 ID 纯附件消息（卸载重挂）',
    url: 'https://claude.ai/chat/virtual-attachments',
    html: fixture('claude-virtual-attachments.html'),
    timeout: 120000,
    check(md, { turns }) {
      assert.strictEqual(turns.length, 30);
      turns.forEach((t, i) => {
        assert.strictEqual(t.user, i % 3 === 0
          ? '> *[附件：图片或文件，未随文本导出]*' : `Question ${i + 1}`);
        assert.strictEqual(t.ai, `Answer ${i + 1}`);
      });
    },
  },
  {
    name: 'Claude 虚拟列表（60 条消息，只挂载视口附近）',
    url: 'https://claude.ai/chat/virtual-test',
    html: fixture('claude-virtual.html'),
    timeout: 120000,
    async before(page) {
      assert.ok(await page.locator('[data-message-id]').count() < 20);
    },
    check(md, { turns }) {
      assert.strictEqual(turns.length, 30);
      turns.forEach((t, i) => {
        assert.strictEqual(t.user, `Question ${i + 1}`);
        assert.strictEqual(t.ai, `Answer ${i + 1}`);
      });
    },
  },
  {
    name: 'Claude 普通会话（标题、正文、附件、输入框隔离）',
    url: 'https://claude.ai/chat/chat-test',
    html: fixture('claude-chat.html'),
    diag: { user: 2, ai: 2 },
    check: claudeChatCheck,
  },
  {
    name: 'Claude 从首页无刷新进入会话，再返回首页',
    url: 'https://claude.ai/new',
    html: fixture('claude-chat.html'),
    async afterInject(page) {
      assert.strictEqual(await page.locator('#ai2md-tab').count(), 0);
      await page.evaluate(() => history.pushState({}, '', '/chat/chat-test'));
      await page.locator('#ai2md-tab').waitFor({ state: 'visible' });
      await page.evaluate(() => history.pushState({}, '', '/new'));
      await page.locator('#ai2md-tab').waitFor({ state: 'hidden' });
      await page.evaluate(() => history.pushState({}, '', '/chat/chat-test'));
    },
    check: claudeChatCheck,
  },
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
    name: 'Claude 分享页（中文界面，只发附件的消息、附件与文字并排）',
    url: 'https://claude.ai/share/attach-test',
    html: fixture('claude-share-attach.html'),
    diag: { user: 4, ai: 4 },
    promptAnswer: '复试与试岗准备',
    check(md, { title, turns }, { prompts, fname }) {
      assert.strictEqual(prompts.length, 1, '页面没有标题时应弹窗确认一次');
      assert.strictEqual(prompts[0].defaultValue, '你看看这份简历', '建议标题是第一条有文字的用户消息');
      assert.strictEqual(title, '复试与试岗准备', '用用户填写的标题');
      assert.match(fname, /-Claude-复试与试岗准备\.md$/, '文件名也用用户填写的标题');
      assert.strictEqual(turns.length, 4, '只发附件的那条也要算一轮');
      assert.strictEqual(turns[0].user, '> *[附件：分享快照中未显示]*', '只发附件的消息只留附件标注');
      assert.match(turns[0].ai, /^### 复试科目：选初中数理/);
      assert.strictEqual(turns[1].user, '> *[附件：分享快照中未显示]*\n\n你看看这份简历', '和文字并排的附件也要标注');
      assert.strictEqual(turns[1].ai, '*（已使用 4 个工具）*\n\n简历整体不错。');
      assert.strictEqual(turns[2].user, '能找到真题吗');
      assert.strictEqual(turns[2].ai, '*（已搜索网页）*\n\n能找到，不用下载。');
      assert.strictEqual(turns[3].user, '搜索网页需要注意什么？', '用户消息不套用工具提示规则');
      assert.strictEqual(turns[3].ai, '*（思考了 1m 28s）*\n\n已使用工具前先想清楚要查什么。\n\n思考了很久之后再搜，效果更好。', '只认完整的短标签，正文句子要保留');
      assert.doesNotMatch(md, /共享时会隐藏文件|由 Test User 分享/);
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
    name: '导出进行中点诊断：菜单保持打开，进度不被锁死',
    url: 'https://chatgpt.com/c/virtual-test',
    html: fixture('chatgpt-virtual.html'),
    timeout: 120000,
    async duringExport(page) {
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#ai2md-diag').click(),
      ]);
      const dump = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      assert.strictEqual(dump.adapter, 'chatgpt');
      const panel = page.locator('#ai2md-panel');
      assert.strictEqual(await panel.isVisible(), true, '导出进行中点诊断，菜单不应收起');
      assert.match(await page.locator('#ai2md-export').textContent(), /已收集|加载/, '进度文字还在');
      await page.locator('#ai2md-tab').click();
      assert.strictEqual(await panel.isVisible(), true, '导出进行中点标签，菜单仍应开着');
      await page.keyboard.press('Escape');
      assert.strictEqual(await panel.isVisible(), true, '导出进行中按 Esc，菜单仍应开着');
    },
    check(md, { turns }) {
      assert.strictEqual(turns.length, 30, '诊断没有打断导出');
    },
  },
  {
    name: 'ChatGPT 登录态新界面（无角色标记、倒序滚动、内容延迟出现、旧会话残留在页面里）',
    url: 'https://chatgpt.com/c/app-shell-test',
    html: fixture('chatgpt-app-shell.html'),
    timeout: 120000,
    async before(page) {
      const n = await page.evaluate(() => document.querySelectorAll('#active-thread [data-content-search-unit-key]').length);
      assert.strictEqual(n, 0, '点导出时会话还没加载出来，脚本应等待而不是直接报错');
    },
    check(md, { title, turns }) {
      assert.strictEqual(title, 'App Shell Test');
      assert.strictEqual(turns.length, 20, '20 轮一轮不缺');
      turns.forEach((t, i) => {
        const n = i + 1;
        assert.strictEqual(t.user, `Question ${n}`, `第 ${n} 轮用户`);
        if (n === 1) {
          assert.strictEqual(t.ai, '*（思考了 11s）*\n\nAnswer 1 with **bold** and `code`.\n\n- item one\n- item two');
        } else if (n === 2) {
          assert.strictEqual(t.ai, '先查一下资料。\n\nAnswer 2', '一个 AI 单元里的多条消息都要导出');
        } else if (n % 3 === 1) {
          assert.strictEqual(t.ai, `*（思考了 ${10 + n}s）*\n\nAnswer ${n}`, `第 ${n} 轮思考小注`);
        } else {
          assert.strictEqual(t.ai, `Answer ${n}`, `第 ${n} 轮 AI`);
        }
      });
      assert.doesNotMatch(md, /你说|ChatGPT 说|^复制$|每日关注简报|9月24日/m, '读屏标题、按钮、侧边栏、日期分隔不应进正文');
      assert.doesNotMatch(md, /previous chat/, '藏在页面里的上一个会话不应混进来');
    },
  },
  {
    name: 'ChatGPT 导出途中切换会话：应取消，不能把两个会话拼在一起',
    url: 'https://chatgpt.com/c/app-shell-test',
    html: fixture('chatgpt-app-shell.html'),
    async during(page) {
      await page.waitForTimeout(2500); // 已经开始逐屏收集
      await page.evaluate(() => history.pushState({}, '', '/c/another-conversation'));
    },
    expectAlert: /已取消/,
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

// 点开右侧贴边标签。诊断在点开之前不可见，并且排在导出会话的下一行。
async function openExportMenu(page) {
  const tab = page.locator('#ai2md-tab');
  await tab.waitFor();
  const box = await tab.boundingBox();
  const vp = page.viewportSize();
  assert.ok(box, '导出标签应可见');
  assert.ok(box.x + box.width >= vp.width - 2, `导出标签应贴在窗口右缘，实际 right=${box.x + box.width}，视口 ${vp.width}`);
  const fromBottom = vp.height - (box.y + box.height);
  assert.ok(fromBottom <= 24, `导出标签应贴在右下角，实际离底边 ${fromBottom}px`);
  assert.ok(box.y > vp.height / 2, `导出标签不应留在视口上半部，实际 top=${box.y}`);
  const barStyle = await page.locator('#ai2md-bar').evaluate((el) => {
    const s = getComputedStyle(el);
    return { position: s.position, right: s.right, zIndex: s.zIndex };
  });
  assert.strictEqual(barStyle.position, 'fixed');
  assert.strictEqual(barStyle.right, '0px');
  assert.ok(Number(barStyle.zIndex) < 2147483647, '标签不应再用整数最大层级');
  const diag = page.locator('#ai2md-diag');
  assert.strictEqual(await diag.isVisible(), false, '点开标签之前，诊断不可见');
  await tab.click();
  await page.locator('#ai2md-export').waitFor({ state: 'visible' });
  assert.strictEqual(await diag.isVisible(), true, '点开标签之后，诊断出现在菜单里');
  const labels = await page.locator('#ai2md-panel button').allTextContents();
  assert.match(labels[0], /^导出 .+ 会话$/, '第一行是导出会话');
  assert.strictEqual(labels[1], '导出诊断数据', '第二行是诊断');
}

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
  // 标题确认弹窗：记录下来，按用例给定的内容回答
  const prompts = [];
  if (c.promptAnswer !== undefined) {
    page.on('dialog', async (d) => {
      prompts.push({ type: d.type(), defaultValue: d.defaultValue() });
      if (d.type() === 'prompt') await d.accept(c.promptAnswer);
      else await d.dismiss();
    });
  }
  await page.goto(c.url);
  if (c.before) await c.before(page);
  await page.addScriptTag({ content: SCRIPT });
  if (c.afterInject) await c.afterInject(page);

  const exportBtn = page.locator('#ai2md-export');
  await openExportMenu(page);

  if (c.diag) {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#ai2md-diag').click(),
    ]);
    const dump = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.deepStrictEqual(dump.roles, c.diag, '诊断数据里的角色计数');
    await openExportMenu(page);
  }

  if (c.expectAlert) {
    let downloaded = false;
    page.on('download', () => { downloaded = true; });
    const dialog = page.waitForEvent('dialog', { timeout: 60000 });
    await exportBtn.click();
    if (c.during) await c.during(page);
    const d = await dialog;
    assert.match(d.message(), c.expectAlert, '提示内容');
    await d.accept();
    await page.waitForTimeout(1500);
    assert.ok(!downloaded, '取消后不应下载文件');
    await context.close();
    return;
  }

  let dl;
  if (c.duringExport) {
    // 诊断下载发生在 Markdown 下载之前，必须先单独接住，不能让下面的等待把它拿走
    await exportBtn.click();
    await c.duringExport(page);
    dl = await page.waitForEvent('download', { timeout: c.timeout || 30000 });
  } else {
    [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: c.timeout || 30000 }),
      exportBtn.click(),
    ]);
  }
  const md = fs.readFileSync(await dl.path(), 'utf8');
  const fname = await page.evaluate(() => window.__dlName);
  assert.match(fname, /^\d{4}-\d{2}-\d{2}-(Claude|ChatGPT|Gemini|Grok)-.+\.md$/, '文件名格式');
  try {
    c.check(md, parse(md), { prompts, fname });
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
