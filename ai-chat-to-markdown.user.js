// ==UserScript==
// @name         AI 会话导出 Markdown（Claude / ChatGPT / Gemini / Grok）
// @name:en      AI Chat to Markdown (Claude / ChatGPT / Gemini / Grok)
// @namespace    https://github.com/Lord-Eve
// @version      2.4.0
// @description  在 Claude、ChatGPT、Gemini、Grok 的会话页上一键导出逐轮 Markdown
// @description:en  One-click export of Claude chats and share pages, ChatGPT, Gemini and Grok conversations to turn-by-turn Markdown
// @author       Lord Eve
// @license      MIT
// @homepageURL  https://github.com/Lord-Eve/ai-chat-to-markdown
// @supportURL   https://github.com/Lord-Eve/ai-chat-to-markdown/issues
// @downloadURL  https://raw.githubusercontent.com/Lord-Eve/ai-chat-to-markdown/main/ai-chat-to-markdown.user.js
// @updateURL    https://raw.githubusercontent.com/Lord-Eve/ai-chat-to-markdown/main/ai-chat-to-markdown.user.js
// @match        https://claude.ai/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @match        https://grok.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ========================= 可改配置 ========================= */

  const CFG = {
    // 你在 Markdown 里的称呼（AI 的称呼按站点自动取：Claude / ChatGPT / Gemini / Grok）
    USER_LABEL: 'User',
    // 是否遮挡疑似手机号 / QQ 号（默认关）
    REDACT_CONTACTS: false,
    // 导出前自动滚动，把懒加载的早期消息加载出来
    AUTO_LOAD: true,
    // 在右侧「导出」菜单的第二行显示「导出诊断数据」（页面改版导致导出失败时，用它生成排错用的 JSON）
    DIAG_BUTTON: true,
    // 页面上取不到会话标题时（比如 Claude 分享页），导出前弹窗确认标题；关掉则直接用第一条用户消息
    ASK_TITLE: true,
    // 在控制台（F12）打印调试日志
    DEBUG: false,
  };

  /* ========================= 工具函数 ========================= */

  const log = (...a) => CFG.DEBUG && console.log('%c[导出]', 'color:#c96442', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const attr = (el, k) => (el && el.getAttribute && el.getAttribute(k)) || '';
  const cls = (el) => attr(el, 'class');

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function sanitizeFilename(s) {
    return (s || '未命名会话')
      .replace(/[\\/:*?"<>|\n\r\t]/g, '_')
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  function download(filename, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function redact(s) {
    if (!CFG.REDACT_CONTACTS) return s;
    return s
      .replace(/\b(1[3-9]\d)\d{4}(\d{4})\b/g, '$1××××$2')
      .replace(/\b(\d{3})\d{2,7}(\d)\b/g, '$1××××$2');
  }

  function sortDoc(list) {
    return list.sort((x, y) => {
      const pos = x.el.compareDocumentPosition(y.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  // 去掉嵌套在另一条消息里的重复命中
  function dropNested(list) {
    return list.filter((m) => !list.some((o) => o !== m && o.el.contains(m.el)));
  }

  // ChatGPT 新界面切换会话时不刷新页面，上一个会话会藏起来留在 DOM 里。
  // 用网址里的会话 ID 找到当前会话的滚动区，收集只在它里面进行。
  const chatgptConvId = () => (location.pathname.match(/\/c\/([\w-]+)/) || [])[1] || null;

  function chatgptThread() {
    const roots = Array.from(document.querySelectorAll('[data-app-action-timeline-scroll]'));
    if (roots.length <= 1) return roots[0] || null;
    const id = chatgptConvId();
    const own = id && roots.find((r) =>
      r.querySelector(`[data-chatgpt-selection-conversation-id="${CSS.escape(id)}"]`));
    const visible = (r) => r.clientHeight > 0 && (!r.checkVisibility || r.checkVisibility({ visibilityProperty: true }));
    return own || roots.find(visible) || roots[roots.length - 1];
  }

  // 整轮都标着别的会话 ID 的，是残留的旧会话
  function chatgptForeign(unit) {
    const id = chatgptConvId();
    const turn = unit.closest('[data-content-search-turn-key]');
    if (!id || !turn) return false;
    const ids = Array.from(turn.querySelectorAll('[data-chatgpt-selection-conversation-id]'))
      .map((e) => attr(e, 'data-chatgpt-selection-conversation-id'));
    return ids.length > 0 && !ids.includes(id);
  }

  // ChatGPT 新界面：取 AI 单元前面、同一轮里的「思考了 17s」这类活动块，只要第一行
  function chatgptActivity(unit) {
    const turn = unit.closest('[data-content-search-turn-key]');
    if (!turn) return '';
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const prev = Array.from(turn.querySelectorAll('[data-content-search-unit-key]'))
      .filter((u) => u !== unit && !u.contains(unit) && before(u, unit))
      .pop();
    return Array.from(turn.querySelectorAll('[data-chatgpt-agent-turn-start]'))
      .map((s) => s.parentElement)
      .filter((b) => b && !b.contains(unit) && before(b, unit) && (!prev || before(prev, b)))
      .map((b) => (b.innerText || b.textContent || '').trim().split('\n')[0].trim())
      .filter(Boolean)
      .join('；');
  }

  const pickAll = (list, scope = document) => {
    for (const s of list) {
      const found = scope.querySelectorAll(s);
      if (found.length) return { sel: s, nodes: Array.from(found) };
    }
    return { sel: null, nodes: [] };
  };

  const stripTitle = (t, names) => {
    let s = (t || '').replace(/[‎‏]/g, '').trim();
    for (const n of names) {
      s = s.replace(new RegExp(`^${n}\\s*[-–|:：]\\s*`, 'i'), '')
           .replace(new RegExp(`\\s*[-–|:：]\\s*${n}$`, 'i'), '');
    }
    return names.some((n) => new RegExp(`^${n}$`, 'i').test(s)) ? '' : s.trim();
  };

  /* ========================= 站点适配器 ========================= */
  // 各家改版时，优先改这里对应站点的选择器；下面的转换逻辑不用动。

  const CLAUDE_SEL = {
    user: [
      '[data-testid="user-message"]',
      '.font-user-message',
    ],
    ai: [
      '.font-claude-message',
      '.font-claude-response',
      '[data-testid="assistant-message"]',
    ],
  };

  // Claude 分享页的附件缩略图和文字气泡是同一行里的兄弟元素；只发附件的消息根本没有文字气泡
  const CLAUDE_FILE_SEL = '[class*="group/thumbnail"], [data-testid="file-thumbnail"], [data-testid="attachment"]';
  const HIDDEN_FILE_TEXT = /^(files hidden when shared|共享时会隐藏文件)$/i;

  // 不在任何消息里的附件，往上找到它所在的那一行（不越过包含其他消息的容器）
  const claudeConversation = () => /^\/(chat|share)\/[^/]+\/?$/.test(location.pathname);
  const claudeScope = () => document.querySelector('[data-testid="transcript-list"]') || document.querySelector('main') || document;

  function claudeOrphanAttachments(msgs, scope) {
    const inMsg = (el) => msgs.some((m) => m.contains(el));
    const marks = [
      ...scope.querySelectorAll(CLAUDE_FILE_SEL),
      ...Array.from(scope.querySelectorAll('div, span, p'))
        .filter((n) => !n.children.length && HIDDEN_FILE_TEXT.test(n.textContent.trim())),
    ].filter((f) => !inMsg(f) && !f.closest('form, [contenteditable="true"], [data-testid="chat-input"]'));
    const rows = marks.map((f) => {
      let row = f;
      while (row.parentElement && row.parentElement !== scope && row.parentElement !== document.body &&
             !msgs.some((m) => row.parentElement.contains(m))) row = row.parentElement;
      return row;
    });
    return [...new Set(rows)];
  }

  const ADAPTERS = [
    {
      id: 'claude',
      name: 'Claude',
      label: 'Claude',
      test: () => location.hostname === 'claude.ai',
      available: claudeConversation,
      get virtualized() { return location.pathname.startsWith('/chat/'); },
      key: (el) => attr(el, 'data-message-id') || attr(el.closest('[data-message-id]'), 'data-message-id') || null,
      get loadFrom() { return location.pathname.startsWith('/share/') ? 'bottom' : 'top'; },
      get attachNote() { return location.pathname.startsWith('/share/') ? '分享快照中未显示' : '图片或文件，未随文本导出'; },
      probes: [...CLAUDE_SEL.user, ...CLAUDE_SEL.ai],
      collect() {
        if (!claudeConversation()) return [];
        const scope = claudeScope();
        const u = pickAll(CLAUDE_SEL.user, scope);
        const a = pickAll(CLAUDE_SEL.ai, scope);
        const files = claudeOrphanAttachments([...u.nodes, ...a.nodes], scope);
        const list = dropNested(sortDoc([
          ...u.nodes.map((el) => ({ role: 'user', el })),
          ...a.nodes.map((el) => ({ role: 'ai', el })),
          ...files.map((el) => ({ role: 'user', el, attachOnly: true })),
        ]));
        // 附件和文字在同一行：挂到那条文字消息上；行里只有附件：单独算一条用户消息
        return list.filter((m, i) => {
          const next = list[i + 1];
          if (!m.attachOnly || !next || next.role !== 'user' || !m.el.parentElement.contains(next.el)) return true;
          next.attach = true;
          return false;
        });
      },
      content: (el) => el,
      clean: () => {},
      title() {
        // 2026-10 起分享页不再显示会话标题（<title> 和 og:title 都只是 "Claude"），这里留着以防它回来
        const h = document.querySelector('[data-testid="chat-title"], [data-testid="chat-title-button"], [data-testid="share-title"]') ||
          (location.pathname.startsWith('/share/') ? document.querySelector('h1') : null);
        if (h && h.textContent.trim()) return h.textContent.trim();
        const og = document.querySelector('meta[property="og:title"]');
        return stripTitle(document.title, ['Claude']) || stripTitle(og ? attr(og, 'content') : '', ['Claude']);
      },
      noise: [
        /^shared by\b/i,
        /^this is a copy of a chat between\b/i,
        /^content may include unverified\b/i,
        /^shared snapshot may contain attachments\b/i,
        /^turn on web search in search and tools menu/i,
        /^otherwise, links provided may not be accurate/i,
        /^files hidden when shared$/i,
        /^共享时会隐藏文件$/,
      ],
      tool: [
        /^used\s+\d+\s+tools?$/i,
        /^used\s+a\s+tool$/i,
        /^read\s+memory.*/i,
        /^searched\s+the\s+web.*/i,
        /^ran\s+a\s+command.*/i,
        /^thought\s+for\s+.*/i,
        /^使用了.*工具.*/,
        // 中文界面的状态标签只认完整的短标签，免得吞掉以这些字开头的正文
        /^已使用\s*(\d+|一|两|几)?\s*个?工具$/,
        /^已?搜索(了)?\s*(\d+\s*个)?网页$/,
        /^已?运行(了)?\s*(\d+\s*(个|条))?命令$/,
        /^思考了\s*(\d+(\.\d+)?\s*(h|m|s|小时|分钟|分|秒)\s*)+$/i,
        /^已?读取记忆.*/,
      ],
    },

    {
      id: 'chatgpt',
      // ChatGPT 的会话是虚拟列表：只渲染视口附近的消息，要边滚边收集。
      // 页面有两套结构：分享页和未登录页面用 data-message-author-role；
      // 2026-10 起登录后的新界面没有这些标记，角色写在 data-content-search-unit-key 的最后一段
      // （形如 "fallback-turn-0:2:assistant"），下面统称「新界面」。
      virtualized: true,
      scrollRoot: () => chatgptThread() || document.querySelector('[data-scroll-root]'),
      key(el) {
        const ids = el.closest('[data-chatgpt-search-message-ids]');
        return attr(el, 'data-message-id') || attr(ids, 'data-chatgpt-search-message-ids') ||
          attr(el, 'data-content-search-unit-key') || null;
      },
      index(el) {
        const t = el.closest('[data-testid^="conversation-turn-"]');
        const n = t ? parseInt(attr(t, 'data-testid').replace(/\D+/g, ''), 10) : NaN;
        if (Number.isFinite(n)) return n;
        // 新界面：轮次和单元序号都在 key 里；不是 fallback-turn-N 这种格式时退回按收集顺序排。
        // 轮次号从「当前已加载的第一轮」数起，顶上加载出更早的消息后整体后移，收集时要以最新看到的为准
        const m = attr(el, 'data-content-search-unit-key').match(/^fallback-turn-(\d+):(\d+):/);
        return m ? Number(m[1]) * 1000 + Number(m[2]) : null;
      },
      // 顶上正在取更早的消息时，滚动区里（消息之外）有个转圈图标
      loadingMore: (sc) => Array.from(sc.querySelectorAll('[class*="animate-spin"]'))
        .some((el) => !el.closest('[data-content-search-turn-key], [data-testid^="conversation-turn-"]')),
      name: 'ChatGPT',
      label: 'ChatGPT',
      test: () => /(^|\.)chatgpt\.com$/.test(location.hostname) || location.hostname === 'chat.openai.com',
      loadFrom: 'top',
      attachNote: '图片或文件，未随文本导出',
      probes: [
        '[data-message-author-role]',
        '[data-message-author-role="user"]',
        '[data-message-author-role="assistant"]',
        '.markdown',
        'article',
        '[data-message-id]',
        '[data-testid^="conversation-turn-"]',
        '[data-scroll-root]',
        '[data-content-search-unit-key]',
        '[data-user-message-bubble]',
        '[data-markdown-text-style="assistant-message"]',
        '[data-app-action-timeline-scroll]',
        '[data-app-action-timeline-scroll] [class*="animate-spin"]',
      ],
      collect() {
        const legacy = Array.from(document.querySelectorAll('[data-message-author-role]'))
          .map((el) => {
            const r = attr(el, 'data-message-author-role');
            return { role: r === 'user' ? 'user' : r === 'assistant' ? 'ai' : 'skip', el };
          })
          .filter((m) => m.role !== 'skip');
        if (legacy.length) return dropNested(legacy);
        const units = Array.from((chatgptThread() || document).querySelectorAll('[data-content-search-unit-key]'))
          .filter((el) => !chatgptForeign(el))
          .map((el) => {
            const r = attr(el, 'data-content-search-unit-key').split(':').pop();
            return { role: r === 'user' ? 'user' : r === 'assistant' ? 'ai' : 'skip', el };
          })
          .filter((m) => m.role !== 'skip');
        return dropNested(units);
      },
      content(el, role) {
        if (role === 'user') {
          return el.querySelector('.whitespace-pre-wrap') || el.querySelector('[data-user-message-bubble]') || el;
        }
        if (el.hasAttribute('data-message-author-role')) return el.querySelector('.markdown') || el;
        // 新界面：一个 AI 单元里可能有多条消息；「思考了 17s」在单元前面的独立块里，
        // 取出来放在开头，交给下面的 tool 规则压成斜体小注
        const roots = el.querySelectorAll('[data-markdown-text-style="assistant-message"], [class*="MarkdownRoot-"]');
        const box = document.createElement('div');
        const note = chatgptActivity(el);
        if (note && isTool(note)) {
          const p = document.createElement('p');
          p.textContent = note;
          box.appendChild(p);
        }
        const parts = dropNested(Array.from(roots).map((r) => ({ el: r }))).map((m) => m.el);
        (parts.length ? parts : [el]).forEach((r) => box.appendChild(r.cloneNode(true)));
        return box;
      },
      clean(c) {
        c.querySelectorAll('.sr-only').forEach((n) => n.remove());
      },
      title() {
        return stripTitle(document.title, ['ChatGPT']);
      },
      noise: [
        /^(you said|chatgpt said)[:：]?$/i,
        /^你说[:：]?$/,
        /^chatgpt\s*说[:：]?$/i,
        /^copy code$/i,
        /^复制代码$/,
      ],
      tool: [
        /^thought for\b.*/i,
        /^reasoned for\b.*/i,
        /^searched\s+\d+\s+sites?.*/i,
        /^已思考.*/,
        /^思考了\s*(\d+(\.\d+)?\s*(h|m|s|小时|分钟|分|秒)\s*)+$/i,
        /^已搜索.*/,
      ],
    },

    {
      id: 'gemini',
      name: 'Gemini',
      label: 'Gemini',
      test: () => location.hostname === 'gemini.google.com',
      loadFrom: 'top',
      attachNote: '图片或文件，未随文本导出',
      probes: [
        'user-query',
        'model-response',
        'response-container',
        'share-turn-viewer',
        '.query-text',
        'message-content',
        '.markdown',
      ],
      collect() {
        // 普通会话页的回复是 <model-response>；分享页（/share/）没有它，回复直接在 <response-container> 里。
        // 两者同时存在时 response-container 嵌在 model-response 内，由 dropNested 去重。
        const list = Array.from(
          document.querySelectorAll('user-query, model-response, response-container')
        ).map((el) => ({
          role: el.tagName.toLowerCase() === 'user-query' ? 'user' : 'ai',
          el,
        }));
        return dropNested(list);
      },
      content: (el, role) =>
        role === 'user'
          ? el.querySelector('.query-text') || el
          : el.querySelector('message-content .markdown') ||
            el.querySelector('.model-response-text') ||
            el.querySelector('message-content') ||
            el,
      clean(c) {
        c.querySelectorAll(
          'model-thoughts, .code-block-decoration, message-actions, sources-list, ' +
          '.response-footer, .response-container-header, .response-container-footer, .bot-name, ' +
          '.cdk-visually-hidden, .screen-reader-only'
        ).forEach((n) => n.remove());
      },
      title() {
        const s = document.querySelector(
          '.conversation.selected .conversation-title, [data-test-id="conversation-title"], h1'
        );
        if (s && s.textContent.trim()) return stripTitle(s.textContent, ['Gemini', 'Google Gemini']);
        return stripTitle(document.title, ['Gemini', 'Google Gemini']);
      },
      noise: [
        /^(显示思路|隐藏思路|show thinking|hide thinking)$/i,
        /^you said$/i,
        /^你说$/,
        /^gemini\s*(说|said)$/i,
      ],
      tool: [],
    },

    {
      id: 'grok',
      name: 'Grok',
      label: 'Grok',
      test: () => location.hostname === 'grok.com',
      // Grok 的会话也是虚拟列表：只渲染视口附近的消息，滚走的会被卸载，要边滚边收集
      virtualized: true,
      key(el) {
        const row = el.closest('[id^="response-"]');
        return row ? row.id : null;
      },
      loadFrom: 'top',
      attachNote: '图片或文件，未随文本导出',
      probes: [
        '.message-bubble',
        '[class*="items-end"] .message-bubble',
        '[class*="items-start"] .message-bubble',
        '.response-content-markdown',
      ],
      collect() {
        // 用户消息靠右（items-end），AI 靠左（items-start）；只认完整类名，不认 md:items-end 之类的响应式变体
        const list = Array.from(document.querySelectorAll('.message-bubble')).map((el) => {
          let isUser = false;
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            if (p.classList.contains('items-end')) { isUser = true; break; }
            if (p.classList.contains('items-start')) break;
          }
          return { role: isUser ? 'user' : 'ai', el };
        });
        // 虚拟列表里的行可能按挂载先后排在 DOM 里，按屏幕上的位置排回去
        const top = (m) => m.el.getBoundingClientRect().top;
        return dropNested(list).sort((a, b) => top(a) - top(b));
      },
      content: (el) => el.querySelector('.response-content-markdown') || el,
      clean: () => {},
      title() {
        return stripTitle(document.title, ['Shared Grok Conversation', 'Grok']);
      },
      noise: [],
      tool: [
        /^thought for\b.*/i,
        /^思考了.*/,
        /^deep\s*search.*/i,
        /^searched\s+\d+\s+\S+.*/i,
        /^searched\s+(the\s+)?web\b.*/i,
      ],
    },
  ];

  const AD = ADAPTERS.find((a) => a.test());
  if (!AD) return;

  /* ================== 噪音识别 ================== */

  const COMMON_NOISE = [/^retry$/i, /^copy$/i, /^edit$/i, /^重试$/, /^复制$/, /^编辑$/];
  const isNoise = (s) => [...COMMON_NOISE, ...AD.noise].some((re) => re.test(s.trim()));
  // 工具/思考提示都是短行；长句即使以 "Searched…" "Thought for…" 开头也当正文
  const isTool = (s) => s.trim().length <= 80 && AD.tool.some((re) => re.test(s.trim()));

  /* ================== 数学公式 ================== */
  // KaTeX（Claude / ChatGPT）从 annotation 里取 TeX 源码；Gemini 从 data-math 属性取。

  function texOf(el) {
    const a = el.querySelector('annotation[encoding="application/x-tex"]');
    return a ? a.textContent.trim() : null;
  }

  function mathOf(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    const c = cls(node);
    if (/\bkatex-display\b/.test(c)) {
      const t = texOf(node);
      if (t != null) return { tex: t, block: true };
    }
    if (/\bkatex\b/.test(c)) {
      const t = texOf(node);
      if (t != null) return { tex: t, block: false };
    }
    const dm = attr(node, 'data-math');
    if (dm) {
      return { tex: dm.trim(), block: /math-block|math-display/.test(c) || node.tagName === 'DIV' };
    }
    return null;
  }

  const mathMd = (m) => (m.block ? `$$\n${m.tex}\n$$` : `$${m.tex}$`);

  /* ===================== HTML → Markdown ===================== */

  function inline(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const m = mathOf(node);
    if (m) return m.block ? `\n\n${mathMd(m)}\n\n` : mathMd(m);

    const tag = node.tagName.toLowerCase();
    const kids = () => Array.from(node.childNodes).map(inline).join('');

    switch (tag) {
      case 'br': return '\n';
      case 'strong': case 'b': {
        const t = kids().trim();
        return t ? `**${t}**` : '';
      }
      case 'em': case 'i': {
        const t = kids().trim();
        return t ? `*${t}*` : '';
      }
      case 'del': case 's': {
        const t = kids().trim();
        return t ? `~~${t}~~` : '';
      }
      case 'code': {
        const t = node.textContent;
        return t ? `\`${t}\`` : '';
      }
      case 'a': {
        const t = kids().trim();
        const href = attr(node, 'href');
        if (!t) return '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return t;
        return `[${t}](${href})`;
      }
      case 'img': {
        const alt = attr(node, 'alt') || '图片';
        return `![${alt}]`;
      }
      default: return kids();
    }
  }

  const BLOCK_TAGS = /^(p|h[1-6]|ul|ol|pre|blockquote|table|hr|div|section|article)$/i;

  function blockToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim();
      return t ? t : '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const m = mathOf(node);
    if (m) return mathMd(m);

    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes);
    const joinBlocks = (arr) => arr.map((c) => blockToMarkdown(c, depth)).filter(Boolean).join('\n\n');

    switch (tag) {
      case 'h1': return `# ${inline(node).trim()}`;
      case 'h2': return `## ${inline(node).trim()}`;
      case 'h3': return `### ${inline(node).trim()}`;
      case 'h4': case 'h5': case 'h6': return `#### ${inline(node).trim()}`;

      case 'p': {
        const t = inline(node).trim();
        return t && !isNoise(t) ? t : '';
      }

      case 'ul': case 'ol': {
        const ordered = tag === 'ol';
        const items = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === 'li');
        const indent = '  '.repeat(depth);
        return items.map((li, i) => {
          const marker = ordered ? `${i + 1}.` : '-';
          const nested = [];
          const flat = [];
          Array.from(li.childNodes).forEach((c) => {
            const isList = c.nodeType === Node.ELEMENT_NODE && /^(ul|ol)$/i.test(c.tagName);
            (isList ? nested : flat).push(c);
          });
          const head = flat.map(inline).join('').replace(/\n{2,}/g, '\n').trim();
          const sub = nested.map((n) => blockToMarkdown(n, depth + 1)).filter(Boolean).join('\n');
          return `${indent}${marker} ${head}${sub ? '\n' + sub : ''}`;
        }).join('\n');
      }

      case 'pre': {
        const codeEl = node.querySelector('code');
        const raw = (codeEl || node).textContent.replace(/\n+$/, '');
        const lm = ((codeEl && cls(codeEl)) || '').match(/language-([\w+#-]+)/);
        return '```' + (lm ? lm[1] : '') + '\n' + raw + '\n```';
      }

      case 'blockquote': {
        const inner = joinBlocks(children);
        return inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
      }

      case 'hr': return '---';

      case 'table': {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (!rows.length) return '';
        const cells = (tr) => Array.from(tr.children).map((td) => inline(td).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|'));
        const head = cells(rows[0]);
        const out = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
        rows.slice(1).forEach((tr) => out.push(`| ${cells(tr).join(' | ')} |`));
        return out.join('\n');
      }

      case 'br': return '';

      default: {
        const hasBlock = children.some((c) => c.nodeType === Node.ELEMENT_NODE && (BLOCK_TAGS.test(c.tagName) || c.tagName.includes('-')));
        if (hasBlock) return joinBlocks(children);
        const t = inline(node).trim();
        return t && !isNoise(t) ? t : '';
      }
    }
  }

  function nodeToMarkdown(node) {
    return blockToMarkdown(node)
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ===================== 单条消息渲染 ===================== */

  const FILE_SEL = [
    '[data-testid="file-thumbnail"]',
    '[data-testid="attachment"]',
    '[data-testid^="file"]',
    'uploader-file-preview',
    '.file-preview',
  ].join(', ');

  function renderMessage(el, role) {
    const base = AD.content(el, role) || el;
    const clone = base.cloneNode(true);
    markImages(el, clone, role);
    AD.clean(clone);
    // 附件卡片（文件名、缩略图）不进正文，由 attachmentNote 统一标注；卡片里要导出的图片留下
    clone.querySelectorAll(FILE_SEL).forEach(dropKeepingImages);

    // 按钮、图标、读屏隐藏的短文本一律去掉（公式的 MathML 源码除外）。
    // 图片常包在按钮里（点开看大图），要导出的图片留下
    clone.querySelectorAll('button, svg, [role="button"], [aria-hidden="true"]').forEach((n) => {
      // 外层已经删掉的跳过（clone 不在页面上，不能用 isConnected 判断）
      if (n.closest('.katex-mathml') || !clone.contains(n)) return;
      const t = n.textContent.trim();
      if (!t || t.length < 40) dropKeepingImages(n);
    });

    // 图片单独成段
    const md = nodeToMarkdown(clone).replace(/[ \t]*(\uE000\d+\uE001)[ \t]*/g, '\n\n$1\n\n');
    const out = [];
    const tools = [];

    for (const line of md.split('\n')) {
      const bare = line.replace(/^[>\-*\s]+/, '').trim();
      if (!bare) { out.push(line); continue; }
      if (isNoise(bare)) continue;
      // 工具和思考提示只出现在 AI 回复里；用户消息原样保留
      if (role !== 'user' && isTool(bare)) { tools.push(bare); continue; }
      out.push(line);
    }

    let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (tools.length) {
      const uniq = [...new Set(tools.map((t) => t.replace(/\s+/g, ' ')))];
      text = `*（${uniq.join('；')}）*` + (text ? `\n\n${text}` : '');
    }
    return redact(text);
  }

  function attachmentNote(el, role) {
    if (role !== 'user') return null;
    // 只有要导出的图片的附件卡片不再标注；文件和没导出的图片照旧标注
    const hasFile = Array.from(el.querySelectorAll(FILE_SEL))
      .some((f) => !Array.from(f.querySelectorAll('img')).some((i) => !imageSkip(i, role)));
    const imgs = Array.from(el.querySelectorAll('img'))
      .filter((i) => !/avatar|头像|profile/i.test(attr(i, 'alt') + ' ' + cls(i)) && imageSkip(i, role));
    if (hasFile || imgs.length || /files hidden when shared|共享时会隐藏文件/i.test(el.textContent)) {
      return `> *[附件：${AD.attachNote}]*`;
    }
    return null;
  }

  /* ===================== 图片 ===================== */
  // 「带图片」导出时，用户上传的图和模型生成的图一起导出。收集时就开始下载（虚拟列表滚走后 blob: 地址可能失效），
  // 正文里先放占位符，导出时换成「文档名.assets/」下的相对路径（和 Typora、Croquill 的习惯一致），和 md 一起打成 zip。
  // 联网搜索的配图、头像、图标不下载，保持原来的 ![标题] 文字。

  const IMG_MARK = (id) => `\uE000${id}\uE001`;
  const IMG_MARK_RE = /\uE000(\d+)\uE001/g;
  const SKIP_IMG_SEL = '[class*="search-image"], [class*="favicon" i], [class*="avatar" i], [data-citation], [class*="citation" i]';
  let images = new Map(); // img.src -> { id, src, job, blob, error }
  let lastImages = null;
  let imagesOn = false; // 这次导出带不带图片

  // 不导出时返回原因（诊断里用），导出返回 null
  function imageSkip(img, role, on = imagesOn) {
    if (!on) return 'off';
    const src = img.currentSrc || img.src || '';
    if (!/^(https?:|blob:|data:image\/)/.test(src)) return 'src';
    if (/avatar|头像|profile|icon|logo|favicon/i.test(attr(img, 'alt') + ' ' + cls(img))) return 'icon';
    if (img.closest(SKIP_IMG_SEL)) return 'search';
    const r = img.getBoundingClientRect();
    const w = Math.max(img.naturalWidth || 0, r.width);
    const h = Math.max(img.naturalHeight || 0, r.height);
    // 小图标按尺寸排除；没加载出来的图（地址失效）尺寸不可信，照样当图片处理，下载失败时写提示
    if (img.complete && img.naturalWidth > 0 && (w < 48 || h < 48)) return 'small';
    // AI 回复里点了会跳到别的网站的图，是搜索结果卡片
    if (role !== 'user') {
      const a = img.closest('a[href]');
      try { if (a && new URL(a.href, location.href).host !== location.host) return 'link'; } catch (e) { /* 坏链接当站内 */ }
    }
    return null;
  }

  function registerImage(img) {
    let rec = images.get(img.src);
    if (!rec) {
      rec = { id: images.size + 1, src: img.currentSrc || img.src };
      rec.job = fetchImage(rec.src, img).then((b) => { rec.blob = b; }, (e) => { rec.error = String((e && e.message) || e).slice(0, 80); });
      images.set(img.src, rec);
    }
    return rec.id;
  }

  async function fetchImage(src, img) {
    const isImg = (b) => b && b.size > 0 && (!b.type || /^image\//.test(b.type) || b.type === 'application/octet-stream');
    // 带登录信息的跨域请求遇到 Access-Control-Allow-Origin: * 会被拒，再不带试一次
    const tries = /^(blob|data):/.test(src) ? [{}] : [{ credentials: 'include' }, { credentials: 'omit' }];
    let last = 'fetch';
    for (const opt of tries) {
      try {
        const r = await fetch(src, opt);
        if (!r.ok) { last = `HTTP ${r.status}`; continue; }
        const b = await r.blob();
        if (isImg(b)) return b;
        last = `type ${b.type}`;
      } catch (e) { last = e.name || 'fetch'; }
    }
    // 读不到原文件时，从页面上已经显示出来的图里取（对方网站不允许时浏览器会拒绝）
    if (img && img.isConnected && img.complete && img.naturalWidth) {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        const b = await new Promise((res) => c.toBlob(res, 'image/png'));
        if (b) return b;
      } catch (e) { last += ` / canvas ${e.name}`; }
    }
    throw new Error(last);
  }

  // 把 clone 里要导出的图片换成占位符。el 是页面上的原消息：图片大小、加载状态只能在它上面看；
  // 有的平台只取了消息的正文部分，正文外的图（比如生成的图片）补到末尾
  function markImages(el, clone, role) {
    const keep = new Map();
    for (const img of el.querySelectorAll('img')) {
      if (!keep.has(img.src) && !imageSkip(img, role)) keep.set(img.src, img);
    }
    if (!keep.size) return;
    const inClone = new Set(Array.from(clone.querySelectorAll('img')).map((i) => i.src));
    for (const [src, img] of keep) if (!inClone.has(src)) clone.appendChild(img.cloneNode());
    const used = new Set();
    for (const img of clone.querySelectorAll('img')) {
      if (!keep.has(img.src)) continue;
      const id = registerImage(keep.get(img.src));
      // 缩略图和大图常是同一张，只留第一处
      if (used.has(id)) { img.remove(); continue; }
      used.add(id);
      const mark = document.createElement('span');
      mark.setAttribute('data-ai2md-img', '');
      mark.textContent = IMG_MARK(id);
      img.replaceWith(mark);
    }
  }

  function dropKeepingImages(n) {
    const marks = n.querySelectorAll('[data-ai2md-img]');
    if (marks.length) n.replaceWith(...marks);
    else n.remove();
  }

  // 只有附件、没有正文的一行（Claude）：只取图片
  function imageMarks(el, role) {
    const ids = [...new Set(Array.from(el.querySelectorAll('img')).filter((i) => !imageSkip(i, role)).map(registerImage))];
    return ids.map(IMG_MARK).join('\n\n');
  }

  // 链接里的文件夹名：空格、括号、# 和 % 要转义，中文保留
  const linkPath = (s) => s.replace(/[\s%#()<>[\]?]/g, encodeURIComponent);

  // 等图片下载完，把占位符换成「文档名.assets/」下的相对路径；下载失败的写成提示
  async function resolveImages(text, btn, docName) {
    const ids = [...new Set([...text.matchAll(IMG_MARK_RE)].map((m) => Number(m[1])))];
    lastImages = [];
    if (!ids.length) return { text, files: [] };
    const byId = new Map([...images.values()].map((r) => [r.id, r]));
    let done = 0;
    await Promise.all(ids.map((id) => Promise.race([byId.get(id).job, sleep(60000)]).then(() => {
      btn.textContent = `⏳ 下载图片 ${++done}/${ids.length}…`;
    })));
    const files = [];
    const names = new Map();
    for (const id of ids) {
      const r = byId.get(id);
      let host = '';
      try { host = /^(blob|data):/.test(r.src) ? r.src.split(':')[0] : new URL(r.src).host; } catch (e) { host = '?'; }
      lastImages.push({ host, ok: !!r.blob, type: r.blob ? r.blob.type : '', bytes: r.blob ? r.blob.size : 0, error: r.blob ? '' : r.error || 'timeout' });
      if (!r.blob) continue;
      const ext = (r.blob.type.match(/^image\/(png|jpeg|gif|webp|svg\+xml|avif|bmp)/) || [])[1] || 'png';
      const file = `${String(files.length + 1).padStart(3, '0')}.${ext.replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`;
      files.push({ name: `${docName}.assets/${file}`, data: r.blob });
      names.set(id, `${linkPath(docName)}.assets/${file}`);
    }
    const out = text.replace(IMG_MARK_RE, (_, id) => (names.has(Number(id)) ? `![图片](${names.get(Number(id))})` : '*[图片：未能下载]*'));
    return { text: out, files };
  }

  // 最简单的 zip（不压缩，图片本来就是压缩过的）。文件名按 UTF-8 存
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (u8) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  async function makeZip(files) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // 文件名是 UTF-8
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local, name, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry, name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  /* ===================== 组装 Markdown ===================== */

  // 消息在收集时就渲染成 Markdown（虚拟列表里的元素滚走后会被卸载）
  function toItems(tagged) {
    const fileNote = `> *[附件：${AD.attachNote}]*`;
    return tagged.map((m) => m.attachOnly
      ? (() => {
        const md = imageMarks(m.el, 'user');
        return { role: 'user', md, note: md ? null : fileNote };
      })()
      : (() => {
        const md = renderMessage(m.el, m.role);
        const note = attachmentNote(m.el, m.role) || (m.attach ? fileNote : null);
        // 没有文字也没认出附件的用户消息，基本是只发了图片或文件，别留一轮空白
        return { role: m.role, md, note: note || (m.role === 'user' && !md ? fileNote : null) };
      })());
  }

  function firstUserSnippet(items) {
    // 图片占位符不算文字；只发了图片的消息跳过
    const text = (m) => m.md.replace(IMG_MARK_RE, ' ').trim();
    const u = items.find((m) => m.role === 'user' && text(m));
    if (!u) return '';
    const t = text(u).replace(/[#*`>$\[\]()_~|-]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > 30 ? t.slice(0, 30) + '…' : t;
  }

  // 页面上取不到标题时，用第一条用户消息做建议值，按设置弹窗让用户确认或改写
  function resolveTitle(items) {
    const own = AD.title();
    if (own) return own;
    const guess = firstUserSnippet(items) || '未命名会话';
    if (!CFG.ASK_TITLE) return guess;
    const input = prompt('这个页面上没有会话标题。\n确认或修改导出文件的标题：', guess);
    return (input && input.trim()) || guess;
  }

  function build(items, title) {
    const date = todayStr();

    const turns = [];
    let cur = null;
    for (const m of items) {
      if (m.role === 'user') {
        cur = { user: m, ai: [] };
        turns.push(cur);
      } else {
        if (!cur) { cur = { user: null, ai: [] }; turns.push(cur); }
        cur.ai.push(m);
      }
    }

    const parts = [
      `# ${title}`,
      '',
      `- **日期**：${date}`,
      `- **参与者**：${CFG.USER_LABEL} / ${AD.label}`,
      `- **来源**：${AD.name}（${location.href}）`,
      '',
      '---',
      '',
    ];

    turns.forEach((t, i) => {
      parts.push(`## 第 ${i + 1} 轮`, '');

      if (t.user) {
        parts.push(`**${CFG.USER_LABEL}：**`, '');
        if (t.user.note) parts.push(t.user.note, '');
        if (t.user.md) parts.push(t.user.md, '');
      }

      if (t.ai.length) {
        parts.push(`**${AD.label}：**`, '');
        t.ai.forEach((m) => {
          if (m.md) parts.push(m.md, '');
        });
      }

      parts.push('---', '');
    });

    parts.push(
      '## 备注',
      '',
      `- 本文件由油猴脚本 AI Chat to Markdown 从 ${AD.name} 页面导出。`,
      /\uE000\d+\uE001/.test(parts.join('\n'))
        ? '- 用户上传和模型生成的图片保存在同名的 `.assets` 文件夹，正文按原位置引用；下载失败的以 `[图片：未能下载]` 标注。其他附件不随文本导出，原位置以 `[附件：…]` 标注。'
        : '- 附件内容不随文本导出，原位置以 `[附件：…]` 标注。',
      '- 界面提示行已剔除，工具调用与思考过程压缩为斜体小注；公式保留为 TeX。',
      ''
    );

    return { title, date, text: parts.join('\n') };
  }

  /* ===================== 懒加载预处理 ===================== */

  function scrollParent(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  // 页面刚打开或刚切换会话时内容可能还没渲染出来，等一会儿再判断「没有消息」
  async function firstMessage(ms = 8000) {
    for (let t = 0; ; t += 400) {
      const first = AD.collect()[0];
      if (first || t >= ms) return first || null;
      await sleep(400);
    }
  }

  // 最近一次导出时加载早期消息的过程，「导出诊断数据」会一并带上，便于排查长会话没加载全
  let lastHarvest = null;

  // 页面上「正在加载」的转圈：ChatGPT 是 animate-spin，Gemini 是 Material 的 progress spinner
  const SPIN_SEL = '[class*="animate-spin"], [role="progressbar"], mat-progress-spinner, mat-spinner, [class*="progress-spinner"], [class*="loading-spinner"]';

  // 滚动区可见范围里有没有转圈（消息里面的不算，比如回复里正在加载的图片）
  function spinnerVisible(sc, tagged) {
    const box = sc === document.scrollingElement || sc === document.documentElement
      ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    return Array.from(sc.querySelectorAll(SPIN_SEL)).some((el) => {
      if (tagged.some((m) => m.el.contains(el))) return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom > box.top && r.top < box.bottom;
    });
  }

  // 滚到顶（Claude 分享页是底），等更早的消息加载完。
  // 长会话滚到边上才分批去服务器取更早的消息，一批可能要好几秒（回复很长时更慢），
  // 所以要等边上连续 QUIET 毫秒没有变化、也没在转圈，才算到头。
  // 「没有变化」看两样：滚动区总高度，和最边上那条消息是谁。
  const QUIET = 3000;
  const hash = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  async function settleEdge(sc, { toTop, deadline, btn, trace, guard = () => {}, onStep = () => {} }) {
    const edge = toTop ? -1e9 : 1e9;
    const t0 = Date.now();
    const rows = [];
    if (trace) trace.passes.push({ edge: toTop ? 'top' : 'bottom', rows });
    let sig = null;
    let quietSince = t0;
    let changedAt = t0;
    // 时间用完了也至少贴一次边：重收的那一遍要从顶上开始往下走，才能把旧序号刷新掉
    for (let i = 0; i === 0 || Date.now() < deadline; i++) {
      // 每隔几次先往回挪一点再贴边：有的页面只在「滚进边上」那一刻去取更早的消息，停着不动不会再触发
      if (i % 3 === 2) {
        sc.scrollTop = edge;
        sc.scrollTop -= Math.sign(edge) * Math.max(200, Math.floor(sc.clientHeight * 0.5));
        await sleep(150);
      }
      // 设成极大或极小的值：普通容器会停在 0，倒序（flex-col-reverse）容器会停在它真正的顶部
      sc.scrollTop = edge;
      await sleep(400);
      guard();
      onStep();
      const tagged = AD.collect();
      const m = toTop ? tagged[0] : tagged[tagged.length - 1];
      const id = m && AD.key && AD.key(m.el);
      const k = m ? id || `${m.role}|${(m.el.textContent || '').slice(0, 80)}` : '';
      const s = `${sc.scrollHeight}|${k}`;
      if (s !== sig) changedAt = Date.now();
      // 转圈太久（一分钟都没新消息）就不再信它，免得撞上一直在转的无关图标白等三分钟
      const spinning = Date.now() - changedAt < 60000 &&
        (AD.loadingMore ? AD.loadingMore(sc) : spinnerVisible(sc, tagged));
      // [毫秒, 滚动区总高度, 滚动位置, 最边上那条消息, 是否在转圈]。
      // 记录会进诊断文件，没有消息 ID 的只记角色和文字的哈希，不记正文
      const who = !m ? '' : id ? id.slice(0, 120) : `${m.role}#${hash(k)}`;
      if (rows.length < 400) rows.push([Date.now() - t0, sc.scrollHeight, Math.round(sc.scrollTop), who, spinning ? 1 : 0]);
      if (s !== sig || spinning) { sig = s; quietSince = Date.now(); }
      else if (Date.now() - quietSince >= QUIET) break;
      if (btn) btn.textContent = `⏳ 加载更早的消息…（${Math.round((Date.now() - t0) / 1000)}s）`;
    }
  }

  async function preload(btn) {
    if (!CFG.AUTO_LOAD) return;
    const first = await firstMessage();
    if (!first) return;
    const sc = scrollParent(first.el);
    if (!sc) return;
    const trace = { at: new Date().toISOString(), passes: [] };
    lastHarvest = trace;
    const toTop = AD.loadFrom === 'top';
    await settleEdge(sc, { toTop, deadline: Date.now() + 180000, btn, trace });
    if (toTop) sc.scrollTop = sc.scrollHeight;
    trace.items = AD.collect().length;
    log('预加载完成，共', trace.items, '条消息');
  }

  /* ===================== 虚拟列表收集 ===================== */
  // 页面只挂载视口附近的消息，滚走的会被卸载，所以直接取 DOM 会缺轮次。
  // 做法：先滚到顶，再逐屏往下滚，每一步把当前挂载的消息渲染后收进来，按 key 去重。

  function scrollRootFor(el) {
    if (AD.scrollRoot) {
      const r = typeof AD.scrollRoot === 'function' ? AD.scrollRoot() : document.querySelector(AD.scrollRoot);
      if (r && r.scrollHeight > r.clientHeight) return r;
    }
    return scrollParent(el);
  }

  async function harvest(btn) {
    const first = await firstMessage();
    if (!first) return [];
    const sc = scrollRootFor(first.el);
    const seen = new Map();
    let seq = 0;
    let walk = 0;
    let renumbered = false;
    // 单页应用切换会话不会刷新页面；中途换了会话或滚动区被替换，就停下来，免得把两个会话拼在一起
    const startUrl = location.href;
    const guard = () => {
      if (location.href !== startUrl || !sc.isConnected) {
        const e = new Error('导出途中页面切换到了别的会话，已取消。\n请在要导出的会话里重新点一次。');
        e.userFacing = true;
        throw e;
      }
    };

    const grab = () => {
      for (const m of AD.collect()) {
        const item = toItems([m])[0];
        const md = item.md;
        // 附件独立行没有正文或消息 ID；用滚动内容坐标区分，并在卸载重挂后保持一致。
        const viewportTop = sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top + sc.clientTop;
        const attachmentKey = m.attachOnly
          ? `attachment|${Math.round(m.el.getBoundingClientRect().top - viewportTop + sc.scrollTop)}`
          : null;
        const key = (AD.key && AD.key(m.el)) || attachmentKey || `${m.role}|${md.slice(0, 300)}`;
        const idx = AD.index ? AD.index(m.el) : null;
        const prev = seen.get(key);
        if (prev) {
          // 同一条消息可能先挂载了半成品，保留渲染最完整的一次
          if (md.length > prev.md.length) prev.md = md;
          // 序号变了说明顶上又加载出了更早的消息，旧序号作废。
          // 这一趟往下收集里已经看过的又变了，说明这一趟收的序号不可信
          if (idx !== prev.idx) {
            if (prev.walk === walk) renumbered = true;
            prev.idx = idx;
          }
          // 没有序号的平台按看到的先后排：以每一趟从上往下收集里第一次看到的先后为准，
          // 第 1 步在顶上等加载时先看到的那批较新消息，不能排到更早的消息前面
          if (prev.walk !== walk) prev.seq = seq++;
          prev.walk = walk;
          continue;
        }
        seen.set(key, { role: m.role, md, note: item.note, idx, walk, seq: seq++ });
      }
      btn.textContent = `⏳ 已收集 ${seen.size} 条…`;
    };

    const t0 = Date.now();
    const trace = { at: new Date(t0).toISOString(), passes: [] };
    lastHarvest = trace;
    // 第 2 步途中序号又变了（更早的消息来得晚），前面收的序号不可信，从头再走一遍
    for (let pass = 0; pass < 3; pass++) {
      // 1. 滚到顶，等更早的消息加载完
      await settleEdge(sc, { toTop: true, deadline: t0 + 180000, btn, trace, guard, onStep: grab });
      const tp = trace.passes[trace.passes.length - 1];

      // 2. 逐屏往下滚，连续两次滚不动才算到底。
      // 不用 scrollTop + clientHeight >= scrollHeight 判断：倒序容器的 scrollTop 是相对底部的负数，那个条件永远不成立
      walk++;
      renumbered = false;
      const step = Math.max(200, Math.floor(sc.clientHeight * 0.6));
      let bottom = 0;
      for (let i = 0; i < 3000 && bottom < 2; i++) {
        const before = sc.scrollTop;
        sc.scrollTop = before + step;
        await sleep(300);
        guard();
        grab();
        if (Math.abs(sc.scrollTop - before) < 1) bottom++;
        else bottom = 0;
      }

      tp.collected = seen.size;
      tp.renumbered = renumbered;
      if (!renumbered) break;
      log('收集途中顶上又加载出更早的消息，从头再收一遍');
    }

    const items = [...seen.values()];
    const useIdx = items.length > 0 && items.every((x) => x.idx != null);
    items.sort((a, b) => (useIdx ? a.idx - b.idx || a.seq - b.seq : a.seq - b.seq));
    trace.ms = Date.now() - t0;
    trace.items = items.length;
    trace.useIdx = useIdx;
    log('虚拟列表收集完成，共', items.length, '条');
    return items;
  }

  /* ===================== 按钮与入口 ===================== */

  // 导出进行中时菜单保持打开，方便看进度；这时不响应收起
  let exporting = false;

  function setPanelOpen(open) {
    const panel = document.getElementById('ai2md-panel');
    const tab = document.getElementById('ai2md-tab');
    if (!panel) return;
    // 导出还在跑时不允许收起。否则诊断按钮会把进度藏起来，
    // 而标签、空白处和 Esc 又被 exporting 挡住，菜单就打不开了。
    if (!open && exporting) return;
    panel.hidden = !open;
    // hidden 属性在部分页面样式下不够，显式盖住 display
    panel.style.display = open ? 'grid' : 'none';
    if (tab) tab.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // withImages：「带图片」导出。会话里没有图片时，和「不带图片」一样只下载 md
  async function doExport(btn, withImages = true) {
    if (exporting) return;
    const startUrl = location.href;
    const label = btn.textContent;
    const others = Array.from(document.querySelectorAll('[data-ai2md-export]')).filter((b) => b !== btn);
    btn.textContent = '⏳ 加载完整会话…';
    btn.disabled = true;
    others.forEach((b) => { b.disabled = true; });
    exporting = true;
    imagesOn = withImages;
    images = new Map();
    try {
      let items;
      if (AD.virtualized) {
        items = await harvest(btn);
      } else {
        await preload(btn);
        items = toItems(AD.collect());
      }
      if (location.href !== startUrl) {
        const e = new Error('导出途中页面切换到了别的会话，已取消。请重新导出。');
        e.userFacing = true;
        throw e;
      }
      log(AD.name, '共', items.length, '条消息');
      if (!items.length) {
        alert(
          `没在这个 ${AD.name} 页面上找到会话内容。\n\n` +
          '常见原因：还没打开具体某条会话，或页面结构改版了。\n' +
          '仍然失败的话，点右侧「导出」，再点「导出诊断数据」，把下载的 JSON 提交到：\nhttps://github.com/Lord-Eve/ai-chat-to-markdown/issues'
        );
        return;
      }
      const { title, date, text } = build(items, resolveTitle(items));
      const name = `${date}-${AD.name}-${sanitizeFilename(title)}`;
      const out = await resolveImages(text, btn, name);
      if (out.files.length) download(`${name}.zip`, await makeZip([{ name: `${name}.md`, data: out.text }, ...out.files]));
      else download(`${name}.md`, out.text);
    } catch (e) {
      if (e.userFacing) { alert(e.message); return; }
      console.error('[导出] 出错', e);
      alert('导出出错：' + e.message + '\n控制台（F12）里有详细信息，欢迎截图提交到：\nhttps://github.com/Lord-Eve/ai-chat-to-markdown/issues');
    } finally {
      exporting = false;
      imagesOn = false;
      btn.textContent = label;
      btn.disabled = false;
      others.forEach((b) => { b.disabled = false; });
      setPanelOpen(false);
    }
  }

  // 滚动区现在的状态：位置、挂载了哪些消息（只记 key，不记正文）、顶上有没有转圈或「加载更多」之类的控件
  function scrollInfo(tagged) {
    const sc = tagged[0] ? scrollRootFor(tagged[0].el)
      : (typeof AD.scrollRoot === 'function' ? AD.scrollRoot() : null);
    if (!sc) return null;
    const keys = tagged.map((m) => (AD.key && AD.key(m.el)) || m.role);
    const firstEl = tagged[0] && tagged[0].el;
    const before = (n) => firstEl && !!(n.compareDocumentPosition(firstEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    const scTop = sc.getBoundingClientRect().top;
    return {
      scrollTop: Math.round(sc.scrollTop),
      scrollHeight: sc.scrollHeight,
      clientHeight: sc.clientHeight,
      keys: keys.length > 16 ? [...keys.slice(0, 10), '…', ...keys.slice(-5)] : keys,
      spinners: Array.from(sc.querySelectorAll('[class*="animate-spin"]'))
        .map((n) => ({ y: Math.round(n.getBoundingClientRect().top - scTop), inMessage: !!n.closest('[data-content-search-turn-key]') })),
      controlsAboveFirst: Array.from(sc.querySelectorAll('button, a, [role="button"]'))
        .filter(before)
        .map((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 10),
    };
  }

  // 消息里的图片：只记来源域名、尺寸、所在位置和导不导出，不记地址和内容
  function imageInfo(tagged) {
    return tagged.flatMap((m) => Array.from(m.el.querySelectorAll('img')).map((img) => {
      const src = img.currentSrc || img.src || '';
      let host = src.split(':')[0];
      try { if (/^https?:/.test(src)) host = new URL(src).host; } catch (e) { /* 留协议名 */ }
      const r = img.getBoundingClientRect();
      return {
        role: m.role,
        host,
        natural: `${img.naturalWidth}x${img.naturalHeight}`,
        shown: `${Math.round(r.width)}x${Math.round(r.height)}`,
        inButton: !!img.closest('button, [role="button"]'),
        inFileCard: !!img.closest(FILE_SEL),
        skip: imageSkip(img, m.role, true),
        wrap: Array.from(img.closest('div, figure, button, a')?.classList || []).slice(0, 6).join(' '),
      };
    })).slice(0, 40);
  }

  function doDebugDump() {
    const tagged = AD.collect();
    // 只在会话区域里取样；侧边栏元素多，整页取样会被它占满
    const area = document.querySelector('main') || document.body;
    const dump = {
      url: location.href,
      adapter: AD.id,
      title: AD.title(),
      messages: tagged.length,
      roles: {
        user: tagged.filter((m) => m.role === 'user').length,
        ai: tagged.filter((m) => m.role === 'ai').length,
      },
      probes: AD.probes.map((s) => ({ selector: s, count: document.querySelectorAll(s).length })),
      sampleTags: [...new Set(Array.from(area.querySelectorAll('*')).slice(0, 3000)
        .map((n) => n.tagName.toLowerCase()).filter((t) => t.includes('-')))].slice(0, 80),
      sampleClasses: [...new Set(
        Array.from(area.querySelectorAll('div[class]'))
          .slice(0, 400)
          .flatMap((n) => Array.from(n.classList))
      )].slice(0, 200),
      sampleDataAttrs: [...new Set(
        Array.from(area.querySelectorAll('*')).slice(0, 3000)
          .flatMap((n) => n.getAttributeNames().filter((a) => a.startsWith('data-')))
      )].slice(0, 120),
      iframes: document.querySelectorAll('iframe').length,
      bodyTextLength: (document.body.innerText || document.body.textContent || '').length,
      areaTextLength: (area.innerText || area.textContent || '').length,
      scroll: scrollInfo(tagged),
      lastExport: lastHarvest,
      images: imageInfo(tagged),
      lastImages,
    };
    console.log('[导出] 诊断数据', dump);
    download(`${AD.id}-debug-${todayStr()}.json`, JSON.stringify(dump, null, 2));
    setPanelOpen(false);
  }

  function mountButtons() {
    if (!document.body) return;
    const existing = document.getElementById('ai2md-bar');
    const available = !AD.available || AD.available();
    if (existing) {
      existing.style.display = available ? 'flex' : 'none';
      return;
    }
    if (!available) return;

    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const fg = dark ? '#f3f3f3' : '#333';
    const bg = dark ? '#2b2b2b' : '#fff';
    const line = dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.14)';
    const shadow = dark ? '0 2px 10px rgba(0,0,0,.45)' : '0 2px 10px rgba(0,0,0,.14)';
    const font = '14px/1.4 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';

    const bar = document.createElement('div');
    bar.id = 'ai2md-bar';
    // 贴在窗口右下角。只占一条窄边，菜单往上展开，不挡右侧栏里的内容。
    // 层级不用整数最大值，站点自己的弹窗可以盖住它。
    bar.style.cssText = [
      'all:initial',
      'position:fixed',
      'right:0',
      'bottom:16px',
      'z-index:9999',
      'display:flex',
      'flex-direction:row',
      'align-items:flex-end',
      'gap:8px',
      `font:${font}`,
      'color-scheme:light dark',
    ].join(';');

    const panel = document.createElement('div');
    panel.id = 'ai2md-panel';
    panel.hidden = true;
    panel.style.cssText = 'display:none;grid-auto-flow:row;gap:6px;justify-items:stretch;';

    const mk = (label, onClick, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = [
        'all:unset',
        'box-sizing:border-box',
        `font:${font}`,
        'padding:9px 14px',
        'border-radius:8px',
        `border:1px solid ${line}`,
        primary ? 'background:#c96442' : `background:${bg}`,
        primary ? 'color:#fff' : `color:${fg}`,
        'cursor:pointer',
        `box-shadow:${shadow}`,
        'width:100%',
        'text-align:center',
        'white-space:nowrap',
      ].join(';');
      b.addEventListener('click', () => onClick(b));
      return b;
    };

    const exportBtn = mk(`导出 ${AD.name} 会话（带图片）`, (b) => doExport(b, true), true);
    exportBtn.id = 'ai2md-export';
    exportBtn.setAttribute('data-ai2md-export', '');
    panel.appendChild(exportBtn);
    const textBtn = mk(`导出 ${AD.name} 会话（不带图片）`, (b) => doExport(b, false), false);
    textBtn.id = 'ai2md-export-text';
    textBtn.setAttribute('data-ai2md-export', '');
    panel.appendChild(textBtn);
    if (CFG.DIAG_BUTTON) {
      const diagBtn = mk('导出诊断数据', doDebugDump, false);
      diagBtn.id = 'ai2md-diag';
      panel.appendChild(diagBtn);
    }

    const tab = document.createElement('button');
    tab.id = 'ai2md-tab';
    tab.type = 'button';
    tab.textContent = '导出';
    tab.title = `导出 ${AD.name} 会话`;
    tab.setAttribute('aria-expanded', 'false');
    tab.setAttribute('aria-controls', 'ai2md-panel');
    tab.style.cssText = [
      'all:unset',
      'box-sizing:border-box',
      `font:${font}`,
      'padding:12px 7px',
      'border-radius:8px 0 0 8px',
      `border:1px solid ${line}`,
      'border-right:none',
      `background:${bg}`,
      'color:#c96442',
      'cursor:pointer',
      `box-shadow:${shadow}`,
      'writing-mode:vertical-rl',
      'letter-spacing:0.14em',
    ].join(';');
    tab.addEventListener('click', () => {
      // 导出进行中只禁止收起；若菜单已经被收起，仍允许再打开
      if (exporting && !panel.hidden) return;
      setPanelOpen(panel.hidden);
    });

    bar.append(panel, tab);
    document.body.appendChild(bar);
    log('按钮已挂载：', AD.name);
  }

  function bindBarDismiss() {
    if (bindBarDismiss.done) return;
    bindBarDismiss.done = true;
    document.addEventListener('click', (e) => {
      if (exporting) return;
      const bar = document.getElementById('ai2md-bar');
      if (!bar || bar.contains(e.target)) return;
      setPanelOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (exporting || e.key !== 'Escape') return;
      setPanelOpen(false);
    });
  }

  const ready = () => {
    mountButtons();
    bindBarDismiss();
    if (AD.available) setInterval(mountButtons, 500);
    // 单页应用会整块重绘页面，按钮被冲掉时自动补回
    new MutationObserver(() => mountButtons()).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
