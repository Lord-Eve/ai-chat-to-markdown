// ==UserScript==
// @name         AI 会话导出 Markdown（Claude / ChatGPT / Gemini / Grok）
// @name:en      AI Chat to Markdown (Claude / ChatGPT / Gemini / Grok)
// @namespace    https://github.com/Lord-Eve
// @version      2.2.0
// @description  在 Claude 分享页、ChatGPT、Gemini、Grok 的会话页上一键导出逐轮 Markdown
// @description:en  One-click export of Claude share pages, ChatGPT, Gemini and Grok conversations to turn-by-turn Markdown
// @author       Lord Eve
// @license      MIT
// @homepageURL  https://github.com/Lord-Eve/ai-chat-to-markdown
// @supportURL   https://github.com/Lord-Eve/ai-chat-to-markdown/issues
// @downloadURL  https://raw.githubusercontent.com/Lord-Eve/ai-chat-to-markdown/main/ai-chat-to-markdown.user.js
// @updateURL    https://raw.githubusercontent.com/Lord-Eve/ai-chat-to-markdown/main/ai-chat-to-markdown.user.js
// @match        https://claude.ai/share/*
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
    // 显示「导出诊断数据」按钮（页面改版导致导出失败时，用它生成排错用的 JSON）
    DIAG_BUTTON: true,
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
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
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

  const pickAll = (list) => {
    for (const s of list) {
      const found = document.querySelectorAll(s);
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

  const ADAPTERS = [
    {
      id: 'claude',
      name: 'Claude',
      label: 'Claude',
      test: () => location.hostname === 'claude.ai' && location.pathname.startsWith('/share/'),
      loadFrom: 'bottom',
      btnBottom: 16,
      attachNote: '分享快照中未显示',
      probes: [...CLAUDE_SEL.user, ...CLAUDE_SEL.ai],
      collect() {
        const u = pickAll(CLAUDE_SEL.user);
        const a = pickAll(CLAUDE_SEL.ai);
        return dropNested(sortDoc([
          ...u.nodes.map((el) => ({ role: 'user', el })),
          ...a.nodes.map((el) => ({ role: 'ai', el })),
        ]));
      },
      content: (el) => el,
      clean: () => {},
      title() {
        const h = document.querySelector('h1, [data-testid="chat-title"]');
        if (h && h.textContent.trim()) return h.textContent.trim();
        return stripTitle(document.title, ['Claude']);
      },
      noise: [
        /^shared by\b/i,
        /^this is a copy of a chat between\b/i,
        /^content may include unverified\b/i,
        /^shared snapshot may contain attachments\b/i,
        /^turn on web search in search and tools menu/i,
        /^otherwise, links provided may not be accurate/i,
        /^files hidden when shared$/i,
      ],
      tool: [
        /^used\s+\d+\s+tools?$/i,
        /^used\s+a\s+tool$/i,
        /^read\s+memory.*/i,
        /^searched\s+the\s+web.*/i,
        /^ran\s+a\s+command.*/i,
        /^thought\s+for\s+.*/i,
        /^使用了.*工具.*/,
        /^已?读取记忆.*/,
      ],
    },

    {
      id: 'chatgpt',
      // ChatGPT 的会话是虚拟列表：只渲染视口附近的消息，要边滚边收集
      virtualized: true,
      scrollRoot: '[data-scroll-root]',
      key: (el) => attr(el, 'data-message-id') || null,
      index(el) {
        const t = el.closest('[data-testid^="conversation-turn-"]');
        const n = t ? parseInt(attr(t, 'data-testid').replace(/\D+/g, ''), 10) : NaN;
        return Number.isFinite(n) ? n : null;
      },
      name: 'ChatGPT',
      label: 'ChatGPT',
      test: () => /(^|\.)chatgpt\.com$/.test(location.hostname) || location.hostname === 'chat.openai.com',
      loadFrom: 'top',
      btnBottom: 120,
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
      ],
      collect() {
        const list = Array.from(document.querySelectorAll('[data-message-author-role]'))
          .map((el) => {
            const r = attr(el, 'data-message-author-role');
            return { role: r === 'user' ? 'user' : r === 'assistant' ? 'ai' : 'skip', el };
          })
          .filter((m) => m.role !== 'skip');
        return dropNested(list);
      },
      content: (el, role) =>
        role === 'user'
          ? el.querySelector('.whitespace-pre-wrap') || el
          : el.querySelector('.markdown') || el,
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
        /^已搜索.*/,
      ],
    },

    {
      id: 'gemini',
      name: 'Gemini',
      label: 'Gemini',
      test: () => location.hostname === 'gemini.google.com',
      loadFrom: 'top',
      btnBottom: 120,
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
      loadFrom: 'top',
      btnBottom: 120,
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
        return dropNested(list);
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
    AD.clean(clone);
    // 附件卡片（文件名、缩略图）不进正文，由 attachmentNote 统一标注
    clone.querySelectorAll(FILE_SEL).forEach((n) => n.remove());

    // 按钮、图标、读屏隐藏的短文本一律去掉（公式的 MathML 源码除外）
    clone.querySelectorAll('button, svg, [role="button"], [aria-hidden="true"]').forEach((n) => {
      if (n.closest('.katex-mathml')) return;
      const t = n.textContent.trim();
      if (!t || t.length < 40) n.remove();
    });

    const md = nodeToMarkdown(clone);
    const out = [];
    const tools = [];

    for (const line of md.split('\n')) {
      const bare = line.replace(/^[>\-*\s]+/, '').trim();
      if (!bare) { out.push(line); continue; }
      if (isNoise(bare)) continue;
      if (isTool(bare)) { tools.push(bare); continue; }
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
    const hasFile = !!el.querySelector(FILE_SEL);
    const imgs = Array.from(el.querySelectorAll('img'))
      .filter((i) => !/avatar|头像|profile/i.test(attr(i, 'alt') + ' ' + cls(i)));
    if (hasFile || imgs.length || /files hidden when shared/i.test(el.textContent)) {
      return `> *[附件：${AD.attachNote}]*`;
    }
    return null;
  }

  /* ===================== 组装 Markdown ===================== */

  // 消息在收集时就渲染成 Markdown（虚拟列表里的元素滚走后会被卸载）
  function toItems(tagged) {
    return tagged.map((m) => ({
      role: m.role,
      md: renderMessage(m.el, m.role),
      note: attachmentNote(m.el, m.role),
    }));
  }

  function firstUserSnippet(items) {
    const u = items.find((m) => m.role === 'user' && m.md);
    if (!u) return '';
    const t = u.md.replace(/[#*`>$\[\]()_~|-]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > 30 ? t.slice(0, 30) + '…' : t;
  }

  function build(items) {
    const title = AD.title() || firstUserSnippet(items) || '未命名会话';
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
      '- 附件内容不随文本导出，原位置以 `[附件：…]` 标注。',
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

  async function preload() {
    if (!CFG.AUTO_LOAD) return;
    const first = AD.collect()[0];
    if (!first) return;
    const sc = scrollParent(first.el);
    if (!sc) return;
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 40 && stable < 2; i++) {
      sc.scrollTop = AD.loadFrom === 'top' ? 0 : sc.scrollHeight;
      await sleep(450);
      const n = AD.collect().length;
      if (n === last) stable++;
      else { stable = 0; last = n; }
    }
    if (AD.loadFrom === 'top') sc.scrollTop = sc.scrollHeight;
    log('预加载完成，共', last, '条消息');
  }

  /* ===================== 虚拟列表收集 ===================== */
  // 页面只挂载视口附近的消息，滚走的会被卸载，所以直接取 DOM 会缺轮次。
  // 做法：先滚到顶，再逐屏往下滚，每一步把当前挂载的消息渲染后收进来，按 key 去重。

  function scrollRootFor(el) {
    if (AD.scrollRoot) {
      const r = document.querySelector(AD.scrollRoot);
      if (r && r.scrollHeight > r.clientHeight) return r;
    }
    return scrollParent(el);
  }

  async function harvest(btn) {
    const first = AD.collect()[0];
    if (!first) return [];
    const sc = scrollRootFor(first.el);
    const seen = new Map();
    let seq = 0;

    const grab = () => {
      for (const m of AD.collect()) {
        const md = renderMessage(m.el, m.role);
        const key = (AD.key && AD.key(m.el)) || `${m.role}|${md.slice(0, 300)}`;
        const prev = seen.get(key);
        if (prev) {
          // 同一条消息可能先挂载了半成品，保留渲染最完整的一次
          if (md.length > prev.md.length) prev.md = md;
          continue;
        }
        seen.set(key, {
          role: m.role,
          md,
          note: attachmentNote(m.el, m.role),
          idx: AD.index ? AD.index(m.el) : null,
          seq: seq++,
        });
      }
      btn.textContent = `⏳ 已收集 ${seen.size} 条…`;
    };

    // 1. 滚到顶，等顶部懒加载稳定
    let lastH = -1;
    let stable = 0;
    for (let i = 0; i < 30 && stable < 2; i++) {
      sc.scrollTop = 0;
      await sleep(400);
      grab();
      if (sc.scrollHeight === lastH) stable++;
      else { stable = 0; lastH = sc.scrollHeight; }
    }

    // 2. 逐屏往下滚，连续两次停在底部才算完
    const step = Math.max(200, Math.floor(sc.clientHeight * 0.6));
    let bottom = 0;
    for (let i = 0; i < 3000 && bottom < 2; i++) {
      sc.scrollTop = Math.min(sc.scrollTop + step, sc.scrollHeight);
      await sleep(300);
      grab();
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) bottom++;
      else bottom = 0;
    }

    const items = [...seen.values()];
    const useIdx = items.length > 0 && items.every((x) => x.idx != null);
    items.sort((a, b) => (useIdx ? a.idx - b.idx || a.seq - b.seq : a.seq - b.seq));
    log('虚拟列表收集完成，共', items.length, '条');
    return items;
  }

  /* ===================== 按钮与入口 ===================== */

  async function doExport(btn) {
    const label = btn.textContent;
    btn.textContent = '⏳ 加载完整会话…';
    btn.disabled = true;
    try {
      let items;
      if (AD.virtualized) {
        items = await harvest(btn);
      } else {
        await preload();
        items = toItems(AD.collect());
      }
      log(AD.name, '共', items.length, '条消息');
      if (!items.length) {
        alert(
          `没在这个 ${AD.name} 页面上找到会话内容。\n\n` +
          '常见原因：还没打开具体某条会话，或页面结构改版了。\n' +
          '仍然失败的话，点「🔧 导出诊断数据」，把下载的 JSON 提交到：\nhttps://github.com/Lord-Eve/ai-chat-to-markdown/issues'
        );
        return;
      }
      const { title, date, text } = build(items);
      download(`${date}-${AD.name}-${sanitizeFilename(title)}.md`, text);
    } catch (e) {
      console.error('[导出] 出错', e);
      alert('导出出错：' + e.message + '\n控制台（F12）里有详细信息，欢迎截图提交到：\nhttps://github.com/Lord-Eve/ai-chat-to-markdown/issues');
    } finally {
      btn.textContent = label;
      btn.disabled = false;
    }
  }

  function doDebugDump() {
    const tagged = AD.collect();
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
      sampleTags: [...new Set(Array.from(document.querySelectorAll('body *')).slice(0, 3000)
        .map((n) => n.tagName.toLowerCase()).filter((t) => t.includes('-')))].slice(0, 80),
      sampleClasses: [...new Set(
        Array.from(document.querySelectorAll('body div[class]'))
          .slice(0, 400)
          .flatMap((n) => Array.from(n.classList))
      )].slice(0, 200),
      bodyTextLength: (document.body.innerText || document.body.textContent || '').length,
    };
    console.log('[导出] 诊断数据', dump);
    download(`${AD.id}-debug-${todayStr()}.json`, JSON.stringify(dump, null, 2));
  }

  function mountButtons() {
    if (!document.body || document.getElementById('ai2md-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'ai2md-bar';
    bar.style.cssText = [
      'position:fixed', 'right:16px', `bottom:${AD.btnBottom}px`, 'z-index:2147483647',
      'display:flex', 'flex-direction:column', 'gap:8px',
      'font:14px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif',
    ].join(';');

    const mk = (label, onClick, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = [
        'padding:9px 14px',
        'border-radius:8px',
        'border:1px solid rgba(0,0,0,.12)',
        primary ? 'background:#c96442' : 'background:#fff',
        primary ? 'color:#fff' : 'color:#333',
        'cursor:pointer',
        'box-shadow:0 2px 10px rgba(0,0,0,.14)',
        'white-space:nowrap',
      ].join(';');
      b.addEventListener('click', () => onClick(b));
      return b;
    };

    bar.appendChild(mk(`⬇ 导出 ${AD.name} 会话`, doExport, true));
    if (CFG.DIAG_BUTTON) bar.appendChild(mk('🔧 导出诊断数据', doDebugDump, false));
    document.body.appendChild(bar);
    log('按钮已挂载：', AD.name);
  }

  const ready = () => {
    mountButtons();
    // 单页应用会整块重绘页面，按钮被冲掉时自动补回
    new MutationObserver(() => mountButtons()).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
