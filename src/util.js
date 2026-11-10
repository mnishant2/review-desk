/* Small DOM, text and storage helpers shared by every module. */
window.RD = window.RD || {};
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /** Create an element. attrs: class, text, html, on<event> handlers, or plain attributes. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const countWords = s => (String(s || '').trim().match(/\S+/g) || []).length;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function deepMerge(a, b) {
    const out = isObj(a) ? { ...a } : {};
    for (const k in b) out[k] = isObj(b[k]) ? deepMerge(isObj(out[k]) ? out[k] : {}, b[k]) : b[k];
    return out;
  }
  function deepAssign(t, s) {
    for (const k in s) { if (isObj(s[k])) { if (!isObj(t[k])) t[k] = {}; deepAssign(t[k], s[k]); } else t[k] = s[k]; }
    return t;
  }

  /* localStorage, prefixed and failure-tolerant (private windows can throw). */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('ard:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem('ard:' + k); else localStorage.setItem('ard:' + k, JSON.stringify(v)); } catch {} },
  };

  const timers = new Map();
  function debounceKey(key, ms, fn) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, ms));
  }
  function cancelKey(key) { clearTimeout(timers.get(key)); timers.delete(key); }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const isTyping = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const slug = s => (String(s || 'paper').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'paper');
  function autoGrow(ta) {
    if (!ta || !ta.isConnected) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 1200) + 'px';
  }

  /* Icons: 16px strokes, currentColor. */
  const PATHS = {
    pencil: '<path d="M3 13l.8-3.2L10.6 3a1.2 1.2 0 011.7 0l.7.7a1.2 1.2 0 010 1.7L6.2 12.2z"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.5h5.6l.6-8.5"/>',
    chat: '<path d="M3 4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v5a1.5 1.5 0 01-1.5 1.5H7.2L4.5 13v-2A1.5 1.5 0 013 9.5z"/>',
    menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
    search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13.5 13.5"/>',
    sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
    moon: '<path d="M13 9.6A5.4 5.4 0 016.4 3a5.4 5.4 0 106.6 6.6z"/>',
    system: '<rect x="2" y="3" width="12" height="8" rx="1.2"/><path d="M6 13.5h4M8 11v2.5"/>',
    gear: '<path d="M2.5 4.5h6.5M12.5 4.5h1M2.5 8h1.5M7.5 8h6M2.5 11.5h5.5M11.5 11.5h2"/><circle cx="10.75" cy="4.5" r="1.6"/><circle cx="5.75" cy="8" r="1.6"/><circle cx="9.75" cy="11.5" r="1.6"/>',
    keyboard: '<rect x="1.5" y="4" width="13" height="8" rx="1.2"/><path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6"/>',
    expand: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
    collapse: '<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/>',
    up: '<path d="M4 10l4-4 4 4"/>',
    down: '<path d="M4 6l4 4 4-4"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    download: '<path d="M8 2.5v8M4.8 7.6L8 10.8l3.2-3.2M3 13.5h10"/>',
  };
  const icon = n => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[n] || ''}</svg>`;

  /* Minimal, escaping Markdown renderer for assistant replies. */
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function mdInline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function md(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n'); let out = ''; let i = 0;
    const isUl = l => /^\s*[-*•]\s+/.test(l), isOl = l => /^\s*\d+[.)]\s+/.test(l), isH = l => /^#{1,4}\s+/.test(l), isF = l => /^```/.test(l);
    while (i < lines.length) {
      const l = lines[i];
      if (isF(l)) { const buf = []; i++; while (i < lines.length && !isF(lines[i])) buf.push(lines[i++]); i++; out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; continue; }
      if (isH(l)) { out += `<h4>${mdInline(l.replace(/^#{1,4}\s+/, ''))}</h4>`; i++; continue; }
      if (isUl(l)) { out += '<ul>'; while (i < lines.length && isUl(lines[i])) out += `<li>${mdInline(lines[i++].replace(/^\s*[-*•]\s+/, ''))}</li>`; out += '</ul>'; continue; }
      if (isOl(l)) { const start = parseInt(l, 10) || 1; out += `<ol start="${start}">`; while (i < lines.length && isOl(lines[i])) out += `<li>${mdInline(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`; out += '</ol>'; continue; }
      if (!l.trim()) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !isF(lines[i]) && !isH(lines[i]) && !isUl(lines[i]) && !isOl(lines[i])) buf.push(lines[i++]);
      out += `<p>${mdInline(buf.join(' '))}</p>`;
    }
    return out;
  }

  /** Parse JSON from a model reply that may wrap it in prose or code fences. */
  function parseJsonLoose(text) {
    const t = String(text || '').replace(/```(?:json)?/gi, '').trim();
    try { return JSON.parse(t); } catch {}
    const starts = [t.indexOf('['), t.indexOf('{')].filter(i => i >= 0);
    if (!starts.length) return undefined;
    const s = Math.min(...starts); const closer = t[s] === '[' ? ']' : '}'; const e = t.lastIndexOf(closer);
    if (e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
    return undefined;
  }

  let toastT = null;
  function toast(msg, actionLabel, fn) {
    const t = $('#toast'); if (!t) return;
    t.replaceChildren(h('span', null, msg));
    if (actionLabel) t.append(h('button', { class: 'toast-act', onclick: () => { t.hidden = true; fn(); } }, actionLabel));
    t.hidden = false; clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, actionLabel ? 6500 : 3600);
  }

  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || 'Copied.'); }
    catch {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0', 'aria-hidden': 'true' });
      ta.value = text; document.body.append(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch {}
      ta.remove(); toast(ok ? (msg || 'Copied.') : 'Copying was blocked. Select the text and copy it yourself.');
    }
  }

  function downloadFile(name, data, type = 'text/markdown') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function fmtBytes(n) {
    if (!n && n !== 0) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function fmtAgo(ts) {
    if (!ts) return 'never';
    const d = (Date.now() - ts) / 1000;
    if (d < 90) return 'just now';
    if (d < 3600) return Math.round(d / 60) + ' minutes ago';
    if (d < 86400 * 1.5) return Math.round(d / 3600) + ' hours ago';
    return Math.round(d / 86400) + ' days ago';
  }

  function b64FromBytes(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function bytesFromB64(b) {
    const s = atob(b); const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  RD.util = {
    $, $$, h, clone, sleep, clip, countWords, isObj, deepMerge, deepAssign, LS, debounceKey, cancelKey, uid,
    isTyping, reduced, slug, autoGrow, icon, esc, md, parseJsonLoose, toast, copyText, downloadFile, fmtBytes,
    fmtAgo, b64FromBytes, bytesFromB64,
  };
})();
