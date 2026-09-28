// ==UserScript==
// @name         zhengruioi-copy-markdown
// @namespace    https://github.com/
// @version      2.1.0
// @description  识别 zhengruioi 题目页与题解页内容（含 KaTeX 公式、表格、代码块），转换为 Markdown 并复制到剪贴板；支持标签页切换自动更新
// @author       stripe-python
// @match        *://*.zhengruioi.com/problem/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ============================ 常量 ============================ */

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'SVG', 'PATH', 'IFRAME',
    'CANVAS', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION'
  ]);

  const BTN_ID = 'tm-zr-md-copy-btn';

  /* ========================== 模式判断 ========================== */

  /** 每次调用时实时读取 URL，保证标签页切换后立即生效 */
  function getMode() {
    return location.pathname.includes('/tutorial') ? 'tutorial' : 'problem';
  }

  function getBtnConfig() {
    return getMode() === 'tutorial'
      ? { label: '复制题解 Markdown', bg: '#059669', hoverBg: '#047857', bottom: '70px' }
      : { label: '复制 Markdown',      bg: '#2563eb', hoverBg: '#1d4ed8', bottom: '20px' };
  }

  /* ========================== 基础工具 ========================== */

  function getTex(el) {
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    return ann ? ann.textContent : el.textContent;
  }

  function cmCode(el) {
    const lines = el.querySelectorAll('.cm-line');
    const arr = lines.length
      ? Array.from(lines).map(l => l.textContent)
      : el.textContent.split('\n');
    return '```\n' + arr.join('\n').replace(/\s+$/, '') + '\n```';
  }

  function shouldSkip(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    return false;
  }

  /* ========================== 行内渲染 ========================== */

  function renderInline(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent.replace(/\s+/g, ' ');
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child;
      if (shouldSkip(el)) continue;

      if (el.classList.contains('katex-display')) {
        out += '\n$$' + getTex(el) + '$$\n';
        continue;
      }
      if (el.classList.contains('katex')) {
        out += '$' + getTex(el) + '$';
        continue;
      }

      const tag = el.tagName.toLowerCase();

      if (tag === 'br') { out += '\n'; continue; }
      if (tag === 'code') { out += '`' + el.textContent.trim() + '`'; continue; }
      if (tag === 'strong' || tag === 'b') {
        out += '**' + renderInline(el).trim() + '**'; continue;
      }
      if (tag === 'em' || tag === 'i') {
        out += '*' + renderInline(el).trim() + '*'; continue;
      }
      if (tag === 'del' || tag === 's' || tag === 'strike') {
        out += '~~' + renderInline(el).trim() + '~~'; continue;
      }
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        const text = renderInline(el).trim();
        out += href ? `[${text}](${href})` : text;
        continue;
      }

      out += renderInline(el);
    }
    return out;
  }

  /* ========================== 列表渲染 ========================== */

  function renderList(list, ordered) {
    const lines = [];
    let idx = 1;
    for (const li of list.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const marker = ordered ? `${idx++}. ` : '- ';
      const content = convertNode(li).trim().replace(/\s*\n\s*/g, ' ');
      lines.push(marker + content);
    }
    return lines.join('\n') + '\n';
  }

  /* ========================== 表格渲染 ========================== */

  function renderTable(table) {
    const rows = [];
    (function collect(el) {
      for (const c of el.children) {
        const t = c.tagName.toLowerCase();
        if (t === 'tr' || t === 'th') rows.push(c);
        else if (t === 'thead' || t === 'tbody' || t === 'tfoot') collect(c);
      }
    })(table);

    const matrix = rows
      .map(r =>
        Array.from(r.children)
          .filter(c => /^(td|th)$/i.test(c.tagName))
          .map(c =>
            renderInline(c)
              .replace(/\s+/g, ' ')
              .trim()
              .replace(/\|/g, '\\|')
          )
      )
      .filter(r => r.length > 0);

    if (!matrix.length) return '';

    const width = Math.max(...matrix.map(r => r.length));
    matrix.forEach(r => { while (r.length < width) r.push(''); });

    const toLine = r => '| ' + r.join(' | ') + ' |';
    const head = matrix[0];
    const sep = new Array(width).fill('---');
    const body = matrix.slice(1);

    return [toLine(head), toLine(sep), ...body.map(toLine)].join('\n');
  }

  /* ========================== 块级渲染 ========================== */

  function convertNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node;
    if (shouldSkip(el)) return '';

    const tag = el.tagName.toLowerCase();
    const cls = el.classList;

    if (cls.contains('katex-display')) return '\n$$' + getTex(el) + '$$\n';
    if (cls.contains('katex')) return '$' + getTex(el) + '$';

    if (cls.contains('cm-content')) return '\n' + cmCode(el) + '\n';
    if (cls.contains('cm-gutters')) return '';

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      return '\n' + '#'.repeat(level) + ' ' + renderInline(el).trim() + '\n';
    }

    if (tag === 'p') {
      return '\n' + renderInline(el).trim() + '\n';
    }

    if (tag === 'pre') {
      const codeEl = el.querySelector('code');
      const raw = (codeEl || el).textContent.replace(/\n+$/, '');
      return '\n```\n' + raw + '\n```\n';
    }

    if (tag === 'table') {
      return '\n' + renderTable(el) + '\n';
    }

    if (tag === 'ul' || tag === 'ol') {
      return '\n' + renderList(el, tag === 'ol') + '\n';
    }

    if (tag === 'blockquote') {
      const inner = renderInline(el).trim();
      return '\n' + inner.split('\n').map(l => '> ' + l).join('\n') + '\n';
    }

    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n---\n';
    if (tag === 'code') return '`' + el.textContent.trim() + '`';
    if (tag === 'strong' || tag === 'b') return '**' + renderInline(el).trim() + '**';
    if (tag === 'em' || tag === 'i') return '*' + renderInline(el).trim() + '*';
    if (tag === 'del' || tag === 's') return '~~' + renderInline(el).trim() + '~~';
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      const text = renderInline(el).trim();
      return href ? `[${text}](${href})` : text;
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || '';
      return src ? `![${alt}](${src})` : '';
    }

    let out = '';
    for (const c of el.childNodes) out += convertNode(c);
    return out;
  }

  /* ========================== 结果清理 ========================== */

  function cleanMarkdown(md) {
    const parts = md.split(/(```[\s\S]*?```)/g);
    return parts
      .map((part, i) => {
        if (i % 2 === 1) return part;
        return part
          .replace(/[ \t]+\n/g, '\n')
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n');
      })
      .join('')
      .trim() + '\n';
  }

  /* ========================== 根节点定位 ========================== */

  function isProblemStatement(el) {
    const t = el.textContent || '';
    if (t.includes('题目描述')) return true;
    if (t.includes('输入格式') && t.includes('输出格式') && t.includes('数据范围')) return true;
    return false;
  }

  function collectCandidateContainers() {
    const containers = new Set();
    document.querySelectorAll('p.wrap-break-word').forEach(p => {
      let el = p.parentElement;
      while (el && el !== document.body) {
        if (el.classList.contains('space-y-2')) {
          containers.add(el);
          break;
        }
        el = el.parentElement;
      }
    });
    return containers;
  }

  function findProblemRoot() {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'));
    const desc = headings.find(h => h.textContent.trim() === '题目描述');
    if (!desc) return null;

    let el = desc.parentElement;
    while (el && el !== document.body) {
      const t = el.textContent || '';
      if (t.includes('输入格式') && t.includes('输出格式')) return el;
      el = el.parentElement;
    }
    return desc.parentElement;
  }

  function findTutorialRoot() {
    const containers = collectCandidateContainers();
    for (const el of containers) {
      if (!isProblemStatement(el)) return el;
    }
    const alt = document.querySelector('div.mt-6[permission="view"] .space-y-2');
    if (alt && !isProblemStatement(alt)) return alt;
    return null;
  }

  function findRoot() {
    return getMode() === 'tutorial' ? findTutorialRoot() : findProblemRoot();
  }

  function hasContent() {
    if (getMode() === 'tutorial') {
      const containers = collectCandidateContainers();
      for (const el of containers) {
        if (!isProblemStatement(el)) return true;
      }
      return false;
    }
    return Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .some(h => h.textContent.trim() === '题目描述');
  }

  function generateMarkdown() {
    const root = findRoot();
    if (!root) return null;
    let md = '';
    for (const child of root.childNodes) md += convertNode(child);
    return cleanMarkdown(md);
  }

  /* ========================== 剪贴板 ========================== */

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      throw new Error('clipboard unavailable');
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (err) {
        return false;
      }
    }
  }

  /* ========================== 按钮 UI ========================== */

  /** 根据当前 URL 刷新按钮外观（不重建 DOM） */
  function refreshButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    const cfg = getBtnConfig();

    // 通过 dataset 保存配置，供 hover / click 事件读取最新值
    btn.dataset.label   = cfg.label;
    btn.dataset.bg      = cfg.bg;
    btn.dataset.hoverBg = cfg.hoverBg;

    // 只有在按钮未处于“已复制 / 失败”反馈状态时才覆盖文案
    if (!btn.disabled) btn.textContent = cfg.label;

    btn.style.background = cfg.bg;
    btn.style.bottom     = cfg.bottom;
  }

  function addButton() {
    if (document.getElementById(BTN_ID)) {
      refreshButton();
      return;
    }

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';

    Object.assign(btn.style, {
      position: 'fixed',
      right: '20px',
      zIndex: '999999',
      padding: '9px 16px',
      borderRadius: '8px',
      border: 'none',
      color: '#fff',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 3px 12px rgba(0,0,0,.25)',
      transition: 'background .15s'
    });

    // hover 时从 dataset 实时读取颜色，避免闭包捕获过时值
    btn.addEventListener('mouseenter', () => {
      if (!btn.disabled && btn.dataset.hoverBg) btn.style.background = btn.dataset.hoverBg;
    });
    btn.addEventListener('mouseleave', () => {
      if (btn.dataset.bg) btn.style.background = btn.dataset.bg;
    });

    btn.addEventListener('click', async () => {
      // 每次点击都重新根据当前 URL 计算内容
      const md = generateMarkdown();
      const currentLabel = btn.dataset.label || '复制 Markdown';

      if (!md) {
        btn.textContent = '未找到内容';
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = btn.dataset.label || currentLabel;
          btn.disabled = false;
        }, 1500);
        return;
      }

      const ok = await copyText(md);
      btn.textContent = ok ? '已复制 ✓' : '复制失败 ✗';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = btn.dataset.label || currentLabel;
        btn.disabled = false;
      }, 1500);
    });

    document.body.appendChild(btn);

    // 首次创建后立即套用当前模式的外观
    refreshButton();
  }

  /* ========================== 标签页 / 路由监听 ========================== */

  let lastHref = location.href;

  function checkUrlChange() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    // URL 变化后，先刷新按钮外观；若按钮不存在则补建
    if (document.getElementById(BTN_ID)) {
      refreshButton();
    }
    // 内容可能正在异步渲染，稍后再确保按钮存在并刷新
    setTimeout(() => {
      if (hasContent()) addButton();
      refreshButton();
    }, 200);
  }

  // 1) 监听 SPA 的 pushState / replaceState
  ['pushState', 'replaceState'].forEach(fn => {
    const orig = history[fn];
    history[fn] = function (...args) {
      const ret = orig.apply(this, args);
      window.dispatchEvent(new Event('zr:locationchange'));
      return ret;
    };
  });
  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('zr:locationchange'));
  });
  window.addEventListener('zr:locationchange', checkUrlChange);

  // 2) 兜底轮询：有些站点使用 hash 变化或自定义事件，轮询最保险
  setInterval(checkUrlChange, 300);

  /* ========================== 初始化 ========================== */

  // 首次注入：等内容渲染出来后加按钮
  let tries = 0;
  const initTimer = setInterval(() => {
    tries++;
    if (hasContent()) {
      clearInterval(initTimer);
      setTimeout(addButton, 150);
    } else if (tries >= 40) {
      clearInterval(initTimer);
    }
  }, 500);

})();
