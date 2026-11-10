/* Review Desk: the reader, marks, assistant, research, review form and settings. */
(() => {
  'use strict';
  const U = RD.util;
  const { $, $$, h, clone, clip, countWords, md, debounceKey, cancelKey, uid, icon, autoGrow, LS, toast, copyText, downloadFile, fmtBytes, fmtAgo, isTyping, sleep, slug, reduced, deepAssign, b64FromBytes, bytesFromB64 } = U;
  const { CATS, CAT, GROUP_TITLES, FORMS, STATUS, STATUS_L, STARTERS, PROMPTS, SHORTCUTS } = RD.config;
  const store = RD.store, ai = RD.ai, research = RD.research, settings = RD.settings;

  const BACKUP_FORMAT = 'review-desk-backup';
  const BACKUP_FORMATS = [BACKUP_FORMAT, 'arr-review-desk-backup']; // the second is from before the rename
  const REPO_URL = 'https://github.com/mnishant2/review-desk';
  const narrow = () => matchMedia('(max-width: 859px)').matches;
  const midWidth = () => matchMedia('(max-width: 1199px)').matches;
  const fmtScore = v => (v == null || v === '' ? '' : (Number(v) % 1 ? Number(v).toFixed(1) : String(Number(v))));

  /* ================= state ================= */
  const S = {
    papers: {}, hls: {}, chats: {}, text: {}, textP: {},
    active: null, tab: LS.get('tab', 'notes'), filter: 'all', sort: LS.get('sort', 'page'), selHl: null,
    pdf: null, pdfPid: null, pv: [], scale: 1, fit: true,
    chatBusy: false, chatDirty: false, deep: !!LS.get('deep', false), rq: '',
    storageOk: true, loaded: false,
  };
  const memBytes = new Map();
  const formOf = pid => FORMS[(S.papers[pid] && S.papers[pid].form) || settings.get().defaultForm] || FORMS.arr;
  const reqOf = form => form.fields.filter(f => f.req);
  const shareOn = pid => { const p = S.papers[pid]; return p && p.shareWithAI != null ? !!p.shareWithAI : !!settings.get().ai.shareDefault; };

  /* ================= saving ================= */
  const pendingSaves = new Map();
  let inflight = 0, saveErr = false;
  const TAB = uid();
  let chan = null;
  try { chan = new BroadcastChannel('arr-review-desk'); /* internal name, unchanged by the rename */ chan.onmessage = e => onRemote(e.data); } catch {}
  const bc = msg => { try { if (chan) chan.postMessage({ ...msg, from: TAB }); } catch {} };

  function schedule(key, delay, fn) {
    pendingSaves.set(key, fn); renderSaveState();
    debounceKey('save:' + key, delay, () => runSave(key));
  }
  async function runSave(key) {
    const fn = pendingSaves.get(key); pendingSaves.delete(key);
    if (!fn) return;
    if (!S.storageOk) { renderSaveState(); return; }
    inflight++; renderSaveState();
    try { await fn(); saveErr = false; }
    catch (e) {
      saveErr = true;
      toast(e && e.name === 'QuotaExceededError' ? 'Your browser’s storage is full. Delete a paper you no longer need, then keep working.' : 'A change couldn’t be saved. Your next edit will try again.');
    }
    inflight--; renderSaveState();
  }
  function flushAll() { for (const key of Array.from(pendingSaves.keys())) { cancelKey('save:' + key); runSave(key); } }

  function savePaper(pid, delay = 0) {
    schedule('p:' + pid, delay, async () => { const p = S.papers[pid]; if (!p) return; await store.put('papers', clone(p)); bc({ kind: 'paper', id: pid }); });
  }
  function saveHl(pid, hid, delay = 0) {
    schedule('h:' + hid, delay, async () => { const x = S.hls[pid] && S.hls[pid][hid]; if (!x) return; await store.put('highlights', clone(x)); bc({ kind: 'hl', id: hid, pid }); });
  }
  function removeHlStored(pid, hid) {
    pendingSaves.delete('h:' + hid); cancelKey('save:h:' + hid);
    schedule('hd:' + hid, 0, async () => { await store.del('highlights', hid); bc({ kind: 'hl-del', id: hid, pid }); });
  }
  function saveChat(pid) {
    const turns = (S.chats[pid] || []).filter(t => t.content && !t.pending && !t.transient).map(t => ({ role: t.role, content: t.content, at: t.at || 0 })).slice(-60);
    schedule('c:' + pid, 0, async () => { await store.put('chats', { paperId: pid, turns, updatedAt: Date.now() }); bc({ kind: 'chat', id: pid }); });
  }
  function paperPatch(pid, patch, delay = 0) {
    const p = S.papers[pid]; if (!p) return;
    deepAssign(p, clone(patch)); p.updatedAt = Date.now();
    savePaper(pid, delay);
  }
  function hlPatch(pid, hid, patch, delay = 0) {
    const x = S.hls[pid] && S.hls[pid][hid]; if (!x) return;
    Object.assign(x, patch, { updatedAt: Date.now() });
    saveHl(pid, hid, delay);
    if ('cat' in patch) hlChanged(pid);
    else if ('note' in patch && pid === S.active) debounceKey('draw', 350, drawHls);
  }

  /* Changes from another open tab of the desk. */
  async function onRemote(m) {
    if (!m || m.from === TAB) return;
    try {
      if (m.kind === 'paper') {
        if (pendingSaves.has('p:' + m.id)) return;
        const p = await store.get('papers', m.id); if (!p) return;
        S.papers[m.id] = p; renderLibrary();
        if (S.active === m.id) { renderHeader(); refreshPanel(); }
      } else if (m.kind === 'paper-del') {
        removePaperLocal(m.id); renderLibrary();
      } else if (m.kind === 'hl') {
        if (pendingSaves.has('h:' + m.id)) return;
        const x = await store.get('highlights', m.id); if (!x) return;
        (S.hls[x.paperId] = S.hls[x.paperId] || {})[x.id] = x; hlChanged(x.paperId);
      } else if (m.kind === 'hl-del') {
        if (S.hls[m.pid]) { delete S.hls[m.pid][m.id]; hlChanged(m.pid); }
      } else if (m.kind === 'chat') {
        if (S.chatBusy && S.active === m.id) return;
        const c = await store.get('chats', m.id); S.chats[m.id] = c ? c.turns || [] : [];
        if (S.active === m.id && S.tab === 'assistant') renderChatMessages(); else S.chatDirty = true;
      } else if (m.kind === 'reload') {
        await loadAll(); if (S.active && !S.papers[S.active]) closePaper(); else { notesFor = reviewFor = chatFor = null; renderAll(); }
      }
    } catch {}
  }

  async function loadAll() {
    if (!S.storageOk) return;
    const [papers, hls, chats] = await Promise.all([store.getAll('papers'), store.getAll('highlights'), store.getAll('chats')]);
    S.papers = {}; for (const p of papers) S.papers[p.id] = p;
    S.hls = {}; for (const x of hls) (S.hls[x.paperId] = S.hls[x.paperId] || {})[x.id] = x;
    S.chats = {}; for (const c of chats) S.chats[c.paperId] = c.turns || [];
  }
  async function requestPersist() {
    if (LS.get('askedPersist', false)) return;
    LS.set('askedPersist', true);
    await store.persist();
  }

  /* ================= library ================= */
  function filledCount(pid) {
    const r = (S.papers[pid] && S.papers[pid].review) || {};
    return reqOf(formOf(pid)).filter(f => f.t === 'text' ? String(r[f.k] || '').trim() : (r[f.k] != null && r[f.k] !== '')).length;
  }
  function renderLibrary() {
    const list = $('#libList');
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains('pi-rename') && list.contains(ae)) return;
    list.replaceChildren();
    if (!S.storageOk) list.append(h('p', { class: 'note warn' }, 'This browser is blocking storage (for example in a private window), so nothing will be kept after you close the page.'));
    const ids = Object.keys(S.papers).sort((a, b) => (S.papers[b].addedAt || 0) - (S.papers[a].addedAt || 0));
    if (!ids.length) list.append(h('div', { class: 'lib-empty' },
      h('p', null, 'No papers yet.'),
      h('p', { class: 'muted' }, 'Add the PDFs you were assigned. Each one keeps its own marks, notes, chat and review draft.')));
    for (const pid of ids) list.append(paperItem(pid));
    const last = LS.get('lastBackup', 0);
    $('#libFoot').replaceChildren(
      h('span', null, 'Saved in this browser. Drop PDFs anywhere to add them.'),
      ids.length ? h('span', null, 'Last backup: ' + fmtAgo(last) + ' · ', h('button', { class: 'linkbtn', onclick: () => openSettings('data') }, 'Back up')) : null);
    const n = S.active ? Object.keys(S.hls[S.active] || {}).length : 0;
    $('#markCount').textContent = n ? String(n) : '';
  }
  function paperItem(pid) {
    const p = S.papers[pid]; const n = Object.keys(S.hls[pid] || {}).length;
    const req = reqOf(formOf(pid)).length; const filled = filledCount(pid);
    const st = p.status || 'reading'; const last = LS.get('page:' + pid, 1) || 1;
    const item = h('div', { class: 'pitem', 'aria-current': String(S.active === pid) });
    const open = h('button', { class: 'pi-open', onclick: () => openPaper(pid) },
      h('div', { class: 'pi-title' }, p.title || p.fileName || 'Untitled paper'),
      h('div', { class: 'pi-meta' },
        h('span', { class: 'pill s-' + st }, STATUS_L[st] || 'Reading'),
        p.sample ? h('span', { class: 'pill practice' }, 'Practice') : null,
        h('span', null, last > 1 && p.numPages ? `p. ${last} of ${p.numPages}` : `${p.numPages || '?'} pp`),
        h('span', null, `${n} mark${n === 1 ? '' : 's'}`)),
      h('div', { class: 'pi-bar', title: `${filled} of ${req} required review fields filled` }, h('i', { style: `width:${req ? (filled / req) * 100 : 0}%` })));
    const actions = h('div', { class: 'pi-actions' },
      h('button', { class: 'btn icon sm ghost', 'aria-label': 'Rename paper', title: 'Rename', html: icon('pencil'), onclick: () => renameItem(item, pid) }),
      h('button', { class: 'btn icon sm ghost', 'aria-label': 'Delete paper', title: 'Delete', html: icon('trash'), onclick: () => confirmDelete(item, pid) }));
    item.append(open, actions);
    return item;
  }
  function renameItem(item, pid) {
    const p = S.papers[pid];
    const inp = h('input', { class: 'input pi-rename', 'aria-label': 'Paper title' }); inp.value = p.title || '';
    let finished = false;
    const done = save => {
      if (finished) return; finished = true;
      if (save && inp.value.trim() && inp.value.trim() !== p.title) { paperPatch(pid, { title: inp.value.trim() }); if (S.active === pid) renderHeader(); }
      renderLibrary();
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { inp.blur(); done(true); } if (e.key === 'Escape') { e.stopPropagation(); inp.blur(); done(false); } });
    inp.addEventListener('blur', () => done(true));
    item.replaceChildren(h('div', { style: 'padding:8px' }, inp)); inp.focus(); inp.select();
  }
  function confirmDelete(item, pid) {
    const p = S.papers[pid];
    const a = item.querySelector('.pi-actions'); if (a) a.remove();
    item.append(h('div', { class: 'pi-confirm' },
      h('span', null, `Delete “${clip(p.title, 60)}” with its PDF, marks, chat and review draft?`),
      h('div', { class: 'row' }, h('button', { class: 'btn sm danger', onclick: () => deletePaper(pid) }, 'Delete'), h('button', { class: 'btn sm', onclick: renderLibrary }, 'Keep'))));
  }
  async function deletePaper(pid) {
    if (!S.papers[pid]) return;
    for (const hid of Object.keys(S.hls[pid] || {})) { pendingSaves.delete('h:' + hid); cancelKey('save:h:' + hid); }
    pendingSaves.delete('p:' + pid); pendingSaves.delete('c:' + pid);
    removePaperLocal(pid); renderLibrary();
    memBytes.delete(pid); LS.set('page:' + pid, null);
    try { await store.deletePaper(pid); bc({ kind: 'paper-del', id: pid }); toast('Paper deleted.'); }
    catch { toast('The paper couldn’t be deleted from storage. Reload and try again.'); }
  }
  function removePaperLocal(pid) {
    delete S.papers[pid]; delete S.hls[pid]; delete S.chats[pid]; delete S.text[pid];
    if (S.active === pid) closePaper();
  }

  /* ================= adding PDFs ================= */
  const loadPdf = bytes => pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
  async function guessTitle(pdf, fileName) {
    try {
      const meta = await pdf.getMetadata(); const t = meta && meta.info && String(meta.info.Title || '').trim();
      if (t && t.length > 8 && !/^(untitled|microsoft word|main|paper|acl|anonymous)/i.test(t) && !/\.(tex|dvi|pdf|docx?)$/i.test(t)) return t;
    } catch {}
    try {
      const page = await pdf.getPage(1); const vp = page.getViewport({ scale: 1 }); const tc = await page.getTextContent();
      const size = it => Math.hypot(it.transform[2], it.transform[3]);
      const items = tc.items.filter(it => it.str && it.str.trim() && it.transform[5] > vp.height * 0.5);
      if (items.length) {
        const max = Math.max(...items.map(size)); const big = items.filter(it => size(it) >= max * 0.92);
        const t = big.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
        if (t.length >= 6 && t.length < 260) return t;
      }
    } catch {}
    return fileName.replace(/\.pdf$/i, '');
  }
  function newPaper(fields) {
    return Object.assign({ id: 'p' + uid(), title: '', fileName: '', fingerprint: '', numPages: 0, sizeBytes: 0, status: 'reading', review: {}, notes: '', shareWithAI: null, form: settings.get().defaultForm, addedAt: Date.now(), updatedAt: Date.now() }, fields);
  }
  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (!files.length) { toast('Choose PDF files.'); return; }
    if (!window.pdfjsLib) { toast('The PDF reader didn’t load. Reload the page.'); return; }
    let first = null;
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const pdf = await loadPdf(bytes.slice());
        const fp = (pdf.fingerprints && pdf.fingerprints[0]) || '';
        const numPages = pdf.numPages; const title = await guessTitle(pdf, f.name);
        pdf.destroy();
        const existing = Object.keys(S.papers).find(pid => fp && S.papers[pid].fingerprint === fp);
        if (existing) {
          memBytes.set(existing, bytes); await store.putPdf(existing, bytes).catch(() => {});
          toast(`“${clip(S.papers[existing].title, 50)}” is already on your desk. The file is reattached.`);
          if (S.active === existing && S.pdfPid !== existing) S.active = null;
          first = first || existing; continue;
        }
        const p = newPaper({ title, fileName: f.name, fingerprint: fp, numPages, sizeBytes: f.size });
        memBytes.set(p.id, bytes);
        S.papers[p.id] = p; savePaper(p.id);
        store.putPdf(p.id, bytes).catch(e => toast(e && e.name === 'QuotaExceededError' ? `No room to store ${clip(f.name, 40)}. You’ll need to add it again after a reload.` : `${clip(f.name, 40)} couldn’t be stored. You’ll need to add it again after a reload.`));
        first = first || p.id;
      } catch { toast(`Couldn’t read ${clip(f.name, 40)}. Is it a valid PDF?`); }
    }
    renderLibrary();
    if (first) { requestPersist(); openPaper(first); }
  }
  function openPractice() {
    const existing = Object.keys(S.papers).find(pid => S.papers[pid].sample);
    if (existing) { openPaper(existing); return; }
    const p = newPaper({ title: 'Practice paper: LingoSqueeze (fictional)', fileName: 'practice-paper.pdf', fingerprint: 'practice-v1', numPages: 2, sample: true });
    memBytes.set(p.id, RD.samplePdf());
    S.papers[p.id] = p; savePaper(p.id); renderLibrary(); openPaper(p.id);
  }

  /* ================= viewer ================= */
  const viewer = $('#viewer'), pagesEl = $('#pages');
  let pageEls = [], io = null, openTok = 0, curPage = 1, scrollRaf = 0, reattachPid = null;
  const rst = new Map(), visible = new Set();

  function setReaderState(kind, node) {
    $('#welcome').hidden = kind !== 'welcome';
    const vs = $('#vstate'); vs.hidden = kind === 'welcome' || kind === 'ready';
    if (node) vs.replaceChildren(node);
  }
  function renderReaderState() {
    if (!S.active) { setReaderState('welcome'); return; }
    if (S.pdf && S.pdfPid === S.active) setReaderState('ready');
  }
  function teardownPdf() {
    if (io) { io.disconnect(); io = null; }
    for (const s of rst.values()) { try { if (s.task) s.task.cancel(); } catch {} }
    rst.clear(); visible.clear(); pagesEl.replaceChildren(); pageEls = [];
    if (S.pdf) { const d = S.pdf; S.pdf = null; d.destroy().catch(() => {}); }
    S.pdfPid = null; S.pv = []; curPage = 1;
    closeFind();
  }
  function closePaper() {
    teardownPdf(); hidePop();
    S.active = null; LS.set('active', null);
    notesFor = chatFor = reviewFor = researchFor = null;
    renderAll();
  }
  async function getPdfBytes(pid) {
    if (memBytes.has(pid)) return memBytes.get(pid);
    const p = S.papers[pid]; if (!p) return null;
    if (p.sample) { const b = RD.samplePdf(); memBytes.set(pid, b); return b; }
    let b = null; try { b = await store.getPdf(pid); } catch {}
    if (b) memBytes.set(pid, b);
    return b;
  }
  async function openPaper(pid, opts = {}) {
    if (!S.papers[pid]) return;
    const tok = ++openTok;
    if (S.active !== pid) { flushAll(); hidePop(); closeFind(); S.selHl = null; S.filter = 'all'; }
    S.active = pid; LS.set('active', pid);
    if (!opts.keepView && narrow()) setView('reader');
    setLibOpen(false);
    renderLibrary(); renderHeader(); refreshPanel();
    if (S.pdf && S.pdfPid === pid) { setReaderState('ready'); return; }
    teardownPdf(); renderHeader();
    if (!window.pdfjsLib) { setReaderState('error', vsCard('The PDF reader didn’t load', 'Reload the page. Your marks and drafts are safe.')); return; }
    setReaderState('loading', h('div', { class: 'vs-card' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, 'Opening the paper…')));
    const bytes = await getPdfBytes(pid);
    if (tok !== openTok) return;
    if (!bytes) { setReaderState('missing', missingCard(pid)); return; }
    try {
      const pdf = await loadPdf(bytes.slice());
      if (tok !== openTok) { pdf.destroy(); return; }
      S.pdf = pdf; S.pdfPid = pid;
      const ok = await buildPages(pdf, tok); if (!ok) return;
      setReaderState('ready'); renderHeader(); drawHls();
      const lp = Math.min(LS.get('page:' + pid, 1) || 1, pdf.numPages);
      requestAnimationFrame(() => { scrollToPage(lp, 0, false); updateCurPage(); });
      if (S.papers[pid] && S.papers[pid].numPages !== pdf.numPages) paperPatch(pid, { numPages: pdf.numPages });
      extractText(pid);
    } catch {
      if (tok !== openTok) return;
      setReaderState('error', vsCard('This PDF couldn’t be opened', 'The file may be damaged or password-protected. Try adding it again.'));
    }
  }
  const vsCard = (title, text) => h('div', { class: 'vs-card' }, h('h2', null, title), h('p', { class: 'muted' }, text));
  function missingCard(pid) {
    return h('div', { class: 'vs-card' },
      h('h2', null, 'This PDF isn’t stored in this browser'),
      h('p', { class: 'muted' }, 'Your marks, notes and draft are here, but the file itself is missing (for example after restoring a backup without PDFs). Choose the same PDF to reattach it and your marks will line up again.'),
      h('button', { class: 'btn primary', onclick: () => { reattachPid = pid; $('#reattachIn').click(); } }, 'Choose the PDF'));
  }
  async function reattach(file) {
    const pid = reattachPid; reattachPid = null; if (!pid || !S.papers[pid] || !file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await loadPdf(bytes.slice()); const fp = (pdf.fingerprints && pdf.fingerprints[0]) || ''; pdf.destroy();
      if (S.papers[pid].fingerprint && fp && fp !== S.papers[pid].fingerprint) toast('This file differs from the one you marked, so some marks may not line up.');
      memBytes.set(pid, bytes); store.putPdf(pid, bytes).catch(() => toast('The PDF couldn’t be stored. You’ll need to reattach it after a reload.'));
      if (S.active === pid) { S.pdfPid = null; openPaper(pid); }
    } catch { toast('That file couldn’t be read as a PDF.'); }
  }
  async function buildPages(pdf, tok) {
    const pv = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i); if (tok !== openTok) return false;
      const vp = pg.getViewport({ scale: 1 }); pv.push({ w: vp.width, h: vp.height });
    }
    S.pv = pv;
    const z = LS.get('zoom', null); S.fit = z == null; S.scale = S.fit ? fitScale() : z;
    pagesEl.replaceChildren();
    pageEls = pv.map((d, i) => { const el = h('div', { class: 'page', 'data-p': i + 1, 'aria-label': `Page ${i + 1}` }, h('div', { class: 'hlLayer' }), h('div', { class: 'findLayer' })); sizePage(el, i); pagesEl.append(el); return el; });
    io = new IntersectionObserver(onIO, { root: viewer, rootMargin: '900px 0px' });
    pageEls.forEach(el => io.observe(el));
    renderZoom();
    return true;
  }
  function sizePage(el, i) { const d = S.pv[i]; el.style.width = d.w * S.scale + 'px'; el.style.height = d.h * S.scale + 'px'; el.style.setProperty('--scale-factor', S.scale); }
  function fitScale() { const maxW = Math.max(...S.pv.map(d => d.w)); const avail = Math.max(200, viewer.clientWidth - 32); return Math.max(0.5, Math.min(2.4, avail / maxW)); }
  function onIO(entries) {
    for (const e of entries) {
      const p = +e.target.dataset.p;
      if (e.isIntersecting) { visible.add(p); renderPage(p); }
      else { visible.delete(p); evict(p); }
    }
  }
  function pst(p) { let s = rst.get(p); if (!s) { s = { c: 0, t: 0, cb: 0, tb: 0, task: null }; rst.set(p, s); } return s; }
  function evict(p) {
    const s = rst.get(p); if (!s) return;
    try { if (s.task) s.task.cancel(); } catch {}
    const el = pageEls[p - 1]; const c = el && el.querySelector('canvas'); if (c) { c.width = 0; c.height = 0; c.remove(); }
    s.c = 0; s.cb = 0;
  }
  function renderPage(p) {
    if (!S.pdf) return; const s = pst(p); const scale = S.scale;
    if (s.c !== scale && s.cb !== scale) renderCanvas(p, S.pdf, s, scale);
    if (s.t !== scale && s.tb !== scale) renderText(p, S.pdf, s, scale);
  }
  async function renderCanvas(p, pdf, s, scale) {
    s.cb = scale; try { if (s.task) s.task.cancel(); } catch {}
    try {
      const page = await pdf.getPage(p); if (pdf !== S.pdf || S.scale !== scale) return;
      const vp = page.getViewport({ scale }); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = document.createElement('canvas'); c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      const task = page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      s.task = task; await task.promise;
      if (pdf !== S.pdf || S.scale !== scale || !visible.has(p)) return;
      const el = pageEls[p - 1]; const old = el.querySelector('canvas');
      if (old) old.replaceWith(c); else el.prepend(c);
      s.c = scale;
    } catch {} finally { if (s.cb === scale) s.cb = 0; }
  }
  async function renderText(p, pdf, s, scale) {
    s.tb = scale;
    try {
      const page = await pdf.getPage(p); const tc = await page.getTextContent();
      if (pdf !== S.pdf || S.scale !== scale) return;
      const vp = page.getViewport({ scale }); const el = pageEls[p - 1];
      const tl = h('div', { class: 'textLayer' });
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise;
      if (pdf !== S.pdf || S.scale !== scale) return;
      /* As in the pdf.js viewer: stretch an end-of-content block under the pointer while
         selecting, so drags in two-column layouts don't jump across columns. */
      const end = h('div', { class: 'endOfContent' }); tl.append(end);
      tl.addEventListener('mousedown', e => {
        if (e.target !== tl) { const b = tl.getBoundingClientRect(); end.style.top = (Math.max(0, (e.clientY - b.top) / b.height) * 100).toFixed(2) + '%'; }
        end.classList.add('active');
      });
      tl.addEventListener('mouseup', () => { end.style.top = ''; end.classList.remove('active'); });
      const old = el.querySelector('.textLayer'); const sel = getSelection();
      if (old && sel && !sel.isCollapsed && old.contains(sel.anchorNode)) { s.t = scale; return; }
      if (old) old.replaceWith(tl); else el.append(tl);
      s.t = scale;
      if (F.pending && F.pending.p === p) markFind();
    } catch {} finally { if (s.tb === scale) s.tb = 0; }
  }
  function setScale(ns, fit = false) {
    if (!S.pv.length) return;
    ns = Math.max(0.5, Math.min(3, ns));
    if (Math.abs(ns - S.scale) < 0.002 && fit === S.fit) return;
    const el = pageEls[curPage - 1]; const frac = el ? (viewer.scrollTop - el.offsetTop) / el.offsetHeight : 0;
    S.scale = ns; S.fit = fit; LS.set('zoom', fit ? null : ns);
    pageEls.forEach((e, i) => sizePage(e, i));
    if (el) viewer.scrollTop = el.offsetTop + frac * el.offsetHeight;
    for (const p of visible) renderPage(p);
    renderZoom();
    if (F.cur) { F.pending = F.cur; F.cur = null; markFind(); }
  }
  function renderZoom() { $('#zoomFit').textContent = Math.round(S.scale * 100) + '%'; $('#zoomFit').title = S.fit ? 'Fitted to width' : 'Fit to width'; }
  function scrollToPage(p, frac = 0, smooth = true) {
    const el = pageEls[p - 1]; if (!el) return;
    const top = el.offsetTop + frac * el.offsetHeight - (frac ? viewer.clientHeight * 0.3 : 12);
    viewer.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduced() ? 'smooth' : 'auto' });
  }
  function updateCurPage() {
    if (!pageEls.length) return;
    const mid = viewer.scrollTop + viewer.clientHeight * 0.35; let p = 1;
    for (const el of pageEls) { if (el.offsetTop <= mid) p = +el.dataset.p; else break; }
    if (p !== curPage) { curPage = p; const pid = S.pdfPid; if (pid) debounceKey('lspage', 700, () => LS.set('page:' + pid, curPage)); }
    renderPageInd();
  }
  function renderPageInd() { $('#pageInd').textContent = S.pdf && S.pdfPid === S.active ? `p. ${curPage} / ${S.pv.length}` : ''; }
  function extractText(pid) {
    if (S.text[pid]) return Promise.resolve(S.text[pid]);
    if (S.textP[pid]) return S.textP[pid];
    if (!S.pdf || S.pdfPid !== pid) return Promise.resolve(null);
    const pdf = S.pdf;
    const pr = (async () => {
      const out = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const tc = await (await pdf.getPage(i)).getTextContent(); let s = '';
        for (const it of tc.items) { if (!('str' in it)) continue; s += it.str; s += it.hasEOL ? '\n' : ' '; }
        out.push(s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/(\w)-\n(?=[a-z])/g, '$1').replace(/\n{3,}/g, '\n\n').trim());
      }
      S.text[pid] = out; return out;
    })().catch(() => null).finally(() => { delete S.textP[pid]; });
    S.textP[pid] = pr; return pr;
  }
  const getPaperText = pid => extractText(pid);

  /* ================= marks on the page ================= */
  function drawHls() {
    if (!S.pdf || S.pdfPid !== S.active) return;
    for (const el of pageEls) el.querySelector('.hlLayer').replaceChildren();
    for (const x of Object.values(S.hls[S.active] || {})) {
      (x.rects || []).forEach((r, i) => {
        const el = pageEls[r.p - 1]; if (!el) return;
        const layer = el.querySelector('.hlLayer'); const style = `--hl:var(--hl-${x.cat});--c:var(--c-${x.cat})`;
        layer.append(h('div', { class: 'hl' + (S.selHl === x.id ? ' on' : ''), 'data-hid': x.id, style: `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;${style}` }));
        if (i === 0 && (x.note || '').trim()) layer.append(h('div', { class: 'hlnote', title: clip(x.note, 120), style: `top:${r.y * 100}%;${style}` }));
      });
    }
  }
  function flashHl(hid) { for (const d of $$(`.hl[data-hid="${hid}"]`)) { d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); } }
  function hlChanged(pid) {
    if (pid === S.active) { drawHls(); if (S.tab === 'notes') renderNotesList(); if (S.tab === 'review') syncReview(); }
    renderLibrary();
  }
  function jumpToHl(hid) {
    const x = S.hls[S.active] && S.hls[S.active][hid]; if (!x || !(x.rects || []).length) return;
    if (narrow()) setView('reader');
    S.selHl = hid; drawHls(); markCard(hid);
    const r = x.rects[0]; scrollToPage(r.p, r.y, true);
    setTimeout(() => flashHl(hid), reduced() ? 0 : 350);
  }
  function stepMark(dir) {
    if (!S.active || !S.pdf) return;
    const list = Object.values(S.hls[S.active] || {}).filter(x => x.rects && x.rects.length).sort((a, b) => a.rects[0].p - b.rects[0].p || a.rects[0].y - b.rects[0].y);
    if (!list.length) { toast('No marks yet. Select text and press 1–7.'); return; }
    let i = list.findIndex(x => x.id === S.selHl);
    if (i === -1) {
      i = dir > 0 ? list.findIndex(x => x.rects[0].p >= curPage) : list.map(x => x.rects[0].p <= curPage).lastIndexOf(true);
      if (i === -1) i = dir > 0 ? 0 : list.length - 1;
    } else i = (i + dir + list.length) % list.length;
    jumpToHl(list[i].id);
  }

  /* ================= selection & popover ================= */
  const pop = $('#pop'); let popMode = null, popHid = null, selInfo = null;
  const normText = s => s.replace(/­/g, '').replace(/(\w)-\s*\n\s*(?=[a-z])/g, '$1').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  function mergeRects(rs) {
    rs.sort((a, b) => a.p - b.p || a.y - b.y || a.x - b.x);
    const out = [];
    for (const r of rs) {
      const l = out[out.length - 1];
      if (l && l.p === r.p && Math.abs((l.y + l.h / 2) - (r.y + r.h / 2)) < Math.max(l.h, r.h) * 0.5 && r.x <= l.x + l.w + 0.012 && r.x + r.w >= l.x - 0.012) {
        const x1 = Math.min(l.x, r.x), y1 = Math.min(l.y, r.y), x2 = Math.max(l.x + l.w, r.x + r.w), y2 = Math.max(l.y + l.h, r.y + r.h);
        Object.assign(l, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      } else out.push({ ...r });
    }
    return out.map(r => ({ p: r.p, x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +r.w.toFixed(4), h: +r.h.toFixed(4) }));
  }
  function rectsFor(range) {
    const boxes = pageEls.map(el => [el, el.getBoundingClientRect()]);
    const rects = []; let anchor = null;
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = boxes.find(([, b]) => cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom); if (!hit) continue;
      const [el, b] = hit; if (r.height > b.height * 0.06) continue;
      rects.push({ p: +el.dataset.p, x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height, w: r.width / b.width, h: r.height / b.height });
      anchor = r;
    }
    return { rects: rects.length ? mergeRects(rects) : [], anchor };
  }
  function readSelection() {
    const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0); if (!pagesEl.contains(range.commonAncestorContainer)) return null;
    const text = normText(sel.toString()); if (text.length < 2) return null;
    const { rects, anchor } = rectsFor(range);
    if (!rects.length) return null;
    return { text, rects, page: rects[0].p, anchor: { x: anchor.right, y: anchor.bottom, top: anchor.top } };
  }
  function checkSelection() {
    if (!S.active || !S.pdf) return;
    const info = readSelection();
    if (!info) { if (popMode === 'sel') hidePop(); return; }
    selInfo = info; showSelPop(info);
  }
  function placePop(a) {
    pop.hidden = false; pop.style.left = '0px'; pop.style.top = '0px';
    const pw = pop.offsetWidth, ph = pop.offsetHeight, vw = innerWidth, vh = innerHeight;
    const x = Math.min(Math.max(12, a.x - pw / 2), vw - pw - 12);
    let y = a.y + 10; if (y + ph > vh - 12) y = Math.max(12, (a.top != null ? a.top : a.y) - ph - 10);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function showSelPop(info) {
    popMode = 'sel'; popHid = null;
    const keep = e => e.preventDefault();
    pop.replaceChildren(
      h('div', { class: 'pop-cats', role: 'group', 'aria-label': 'Mark the selection as' }, CATS.map(c =>
        h('button', { class: 'pop-cat', style: `--c:var(--c-${c.id})`, onmousedown: keep, onclick: () => createHl(c.id) }, h('span', { class: 'dot' }), c.label, h('kbd', null, c.key)))),
      h('div', { class: 'pop-row' },
        h('button', { class: 'btn sm', onmousedown: keep, onclick: askSel }, 'Ask assistant ', h('kbd', null, 'A')),
        h('button', { class: 'btn sm', onmousedown: keep, onclick: lookSel }, 'Look up ', h('kbd', null, 'L'))));
    placePop(info.anchor);
  }
  /* Keep the mark menu next to the selection while the paper scrolls. */
  function repositionSel() {
    if (popMode !== 'sel') return;
    const info = readSelection(); if (!info) { hidePop(); return; }
    selInfo = info;
    const vb = viewer.getBoundingClientRect();
    if (info.anchor.y < vb.top || info.anchor.top > vb.bottom) { pop.hidden = true; return; }
    placePop(info.anchor);
  }
  function hidePop() {
    if (popHid && S.active && pendingSaves.has('h:' + popHid)) { cancelKey('save:h:' + popHid); runSave('h:' + popHid); }
    pop.hidden = true; popMode = null; popHid = null;
  }
  function createHl(cat) {
    const info = selInfo || readSelection(); if (!info || !S.active) return;
    const pid = S.active, hid = 'h' + uid();
    const x = { id: hid, paperId: pid, cat, text: info.text.slice(0, 3000), rects: info.rects, page: info.page, note: '', createdAt: Date.now(), updatedAt: Date.now() };
    (S.hls[pid] = S.hls[pid] || {})[hid] = x;
    const sel = getSelection(); if (sel) sel.removeAllRanges(); selInfo = null;
    saveHl(pid, hid);
    S.selHl = hid; hlChanged(pid);
    showHlPop(hid, info.anchor, true);
  }
  function showHlPop(hid, anchor, focusNote) {
    const pid = S.active; const x = S.hls[pid] && S.hls[pid][hid]; if (!x) return;
    popMode = 'hl'; popHid = hid;
    const ta = h('textarea', { class: 'note-input', id: 'popNote', rows: 2, 'aria-label': 'Note', placeholder: 'Note for your review (optional). Enter saves.' });
    ta.value = x.note || '';
    ta.addEventListener('input', () => { hlPatch(pid, hid, { note: ta.value }, 600); autoGrow(ta); syncCardNote(hid); });
    ta.addEventListener('keydown', e => { if ((e.key === 'Enter' && !e.shiftKey && !e.isComposing) || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePop(); } });
    pop.replaceChildren(
      h('div', { class: 'pop-head' }, h('span', { class: 'muted' }, x.page ? `Mark on p. ${x.page}` : 'Note'),
        h('button', { class: 'btn sm ghost danger', onclick: () => { hidePop(); deleteHl(pid, hid); } }, 'Delete')),
      h('div', { class: 'pop-chips', role: 'group', 'aria-label': 'Kind of mark' }, CATS.map(c =>
        h('button', { class: 'chip', 'aria-pressed': String(c.id === x.cat), style: `--c:var(--c-${c.id})`, title: `${c.label} (${c.key})`,
          onclick: () => { hlPatch(pid, hid, { cat: c.id }); showHlPop(hid, anchor, false); } }, h('span', { class: 'dot' }), c.label))),
      ta,
      h('div', { class: 'pop-row' },
        h('button', { class: 'btn sm', onclick: () => { hidePop(); askAboutHl(pid, hid); } }, 'Ask assistant'),
        h('button', { class: 'btn sm primary', onclick: hidePop }, 'Done')));
    placePop(anchor);
    autoGrow(ta);
    if (focusNote && !matchMedia('(pointer: coarse)').matches) setTimeout(() => ta.focus(), 0);
  }
  function syncCardNote(hid) {
    const el = cardEls.get(hid); const x = S.hls[S.active] && S.hls[S.active][hid];
    if (el && x && document.activeElement !== el._els.ta) { el._els.ta.value = x.note || ''; autoGrow(el._els.ta); }
  }
  function deleteHl(pid, hid) {
    const x = S.hls[pid] && S.hls[pid][hid]; if (!x) return;
    delete S.hls[pid][hid]; if (S.selHl === hid) S.selHl = null;
    removeHlStored(pid, hid); hlChanged(pid);
    toast('Mark deleted.', 'Undo', () => { (S.hls[pid] = S.hls[pid] || {})[hid] = x; saveHl(pid, hid); hlChanged(pid); });
  }
  function selectHlFromPage(e) {
    const sel = getSelection(); if (sel && !sel.isCollapsed) return;
    const pageEl = e.target.closest && e.target.closest('.page'); if (!pageEl || !S.active) return;
    const b = pageEl.getBoundingClientRect(); const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height, p = +pageEl.dataset.p;
    const hits = Object.values(S.hls[S.active] || {}).filter(m => (m.rects || []).some(r => r.p === p && x >= r.x - 0.002 && x <= r.x + r.w + 0.002 && y >= r.y - 0.003 && y <= r.y + r.h + 0.003));
    if (hits.length) { const m = hits[hits.length - 1]; S.selHl = m.id; drawHls(); markCard(m.id); showHlPop(m.id, { x: e.clientX, y: e.clientY + 6, top: e.clientY - 6 }, false); }
    else if (S.selHl) { S.selHl = null; drawHls(); markCard(null); }
  }
  function askSel() {
    const info = selInfo || readSelection(); if (!info) return;
    hidePop(); const sel = getSelection(); if (sel) sel.removeAllRanges();
    prefillChat(`About this passage (p. ${info.page}): "${clip(info.text, 700)}"\n\n`);
  }
  function lookSel() {
    const info = selInfo || readSelection(); if (!info) return;
    hidePop(); S.rq = clip(info.text, 140); if (narrow()) setView('panel'); setTab('research');
    const q = $('#rq'); if (q) { q.value = S.rq; q.focus(); } updateLinks();
  }
  function askAboutHl(pid, hid) {
    const x = S.hls[pid] && S.hls[pid][hid]; if (!x) return;
    prefillChat(`About my ${CAT[x.cat].label.toLowerCase()} mark${x.page ? ` on p. ${x.page}` : ''}: "${clip(x.text, 600)}"${(x.note || '').trim() ? `\nMy note: ${x.note.trim()}` : ''}\n\n`);
  }

  /* ================= find in paper ================= */
  const F = { q: '', hits: [], i: -1, pending: null, cur: null, tok: 0 };
  function openFind() {
    if (!S.pdf || S.pdfPid !== S.active) return;
    if (narrow()) setView('reader');
    $('#findBar').hidden = false;
    const inp = $('#findIn'); inp.focus(); inp.select();
    extractText(S.active);
  }
  function closeFind() {
    $('#findBar').hidden = true; F.q = ''; F.hits = []; F.i = -1; F.pending = null; F.cur = null;
    clearFindMarks(); renderFindCount();
  }
  function clearFindMarks() { for (const l of $$('.findLayer')) l.replaceChildren(); }
  const normFind = s => s.replace(/\s+/g, ' ').toLowerCase();
  async function runFind(q) {
    const tok = ++F.tok; F.q = q; F.hits = []; F.i = -1; F.pending = null; F.cur = null; clearFindMarks();
    const norm = normFind(q.trim());
    if (norm.length < 2 || !S.active) { renderFindCount(); return; }
    const pages = await getPaperText(S.active);
    if (!pages || tok !== F.tok) return;
    pages.forEach((t, pi) => {
      const s = normFind(t); let k = 0, j = 0;
      while ((k = s.indexOf(norm, k)) !== -1) { F.hits.push({ p: pi + 1, j: j++ }); k += norm.length; }
    });
    renderFindCount();
    if (F.hits.length) { const i = F.hits.findIndex(x => x.p >= curPage); gotoFind(i === -1 ? 0 : i); }
  }
  function gotoFind(i) {
    if (!F.hits.length) return;
    F.i = (i + F.hits.length) % F.hits.length; renderFindCount();
    F.pending = F.hits[F.i]; F.cur = null;
    scrollToPage(F.pending.p, 0, false);
    markFind();
  }
  function renderFindCount() {
    const el = $('#findCount'); if (!el) return;
    el.textContent = !F.q.trim() || F.q.trim().length < 2 ? '' : F.hits.length ? `${F.i + 1} of ${F.hits.length}` : 'No matches';
  }
  /* Highlight the j-th match on page p using the rendered text layer. */
  function markFind() {
    const hit = F.pending; if (!hit) return;
    const el = pageEls[hit.p - 1]; if (!el) return;
    const s = rst.get(hit.p); const tl = el.querySelector('.textLayer');
    if (!tl || !s || s.t !== S.scale) return; // renderText calls back when ready
    F.pending = null; F.cur = hit; clearFindMarks();
    const norm = normFind(F.q.trim());
    const map = []; let full = '';
    for (const sp of tl.querySelectorAll('span')) {
      if (sp.classList.contains('markedContent')) continue;
      const tn = sp.firstChild; if (!tn || tn.nodeType !== 3) continue;
      if (full && full[full.length - 1] !== ' ') { full += ' '; map.push(null); }
      const t = tn.data;
      for (let i = 0; i < t.length; i++) {
        const ch = /\s/.test(t[i]) ? ' ' : t[i].toLowerCase();
        if (ch === ' ' && full[full.length - 1] === ' ') continue;
        full += ch; map.push([tn, i]);
      }
    }
    const occ = []; let k = 0;
    while ((k = full.indexOf(norm, k)) !== -1) { occ.push(k); k += norm.length; }
    const layer = el.querySelector('.findLayer');
    occ.forEach((a, n) => {
      let s0 = a, e0 = a + norm.length - 1;
      while (s0 <= e0 && !map[s0]) s0++;
      while (e0 >= s0 && !map[e0]) e0--;
      if (s0 > e0) return;
      const r = document.createRange();
      r.setStart(map[s0][0], map[s0][1]); r.setEnd(map[e0][0], map[e0][1] + 1);
      const { rects } = rectsFor(r);
      const isCur = n === Math.min(hit.j, occ.length - 1);
      for (const q of rects) layer.append(h('div', { class: 'fh' + (isCur ? ' cur' : ''), style: `left:${q.x * 100}%;top:${q.y * 100}%;width:${q.w * 100}%;height:${q.h * 100}%` }));
      if (isCur && rects.length) {
        const top = el.offsetTop + rects[0].y * el.offsetHeight;
        if (top < viewer.scrollTop + 40 || top > viewer.scrollTop + viewer.clientHeight - 60) viewer.scrollTo({ top: Math.max(0, top - viewer.clientHeight * 0.35), behavior: 'auto' });
      }
    });
  }

  /* ================= panel tabs ================= */
  let notesFor = null, chatFor = null, researchFor = null, reviewFor = null;
  const cardEls = new Map(); const rvEls = {};
  function setTab(t) {
    if (!['notes', 'assistant', 'research', 'review'].includes(t)) t = 'notes';
    S.tab = t; LS.set('tab', t);
    for (const b of $$('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const id of ['notes', 'assistant', 'research', 'review']) $('#pane-' + id).hidden = id !== t;
    refreshPanel();
  }
  function refreshPanel() {
    if (S.tab === 'notes') renderNotes();
    else if (S.tab === 'assistant') renderAssistant();
    else if (S.tab === 'research') renderResearch();
    else renderReview();
  }
  const emptyPane = t => h('p', { class: 'empty' }, t);

  /* ---------- marks ---------- */
  function sortedHls(pid) {
    const ci = id => CATS.findIndex(c => c.id === id);
    const pos = x => (x.rects && x.rects.length ? x.rects[0].p * 10 + x.rects[0].y : 1e7 + (x.createdAt || 0) / 1e13);
    return Object.values(S.hls[pid] || {}).sort((a, b) => S.sort === 'kind' ? (ci(a.cat) - ci(b.cat) || pos(a) - pos(b)) : (pos(a) - pos(b) || ci(a.cat) - ci(b.cat)));
  }
  function renderNotes() {
    const pane = $('#pane-notes');
    if (!S.active) { notesFor = null; cardEls.clear(); pane.replaceChildren(emptyPane('Open a paper to see its marks and notes here.')); return; }
    if (notesFor !== S.active) buildNotes(pane);
    const g = $('#paperNotes'); const v = S.papers[S.active].notes || '';
    if (g && document.activeElement !== g && g.value !== v) { g.value = v; autoGrow(g); }
    renderNotesList();
  }
  function buildNotes(pane) {
    notesFor = S.active; cardEls.clear(); const pid = S.active; const p = S.papers[pid];
    const general = h('textarea', { class: 'note-input big', id: 'paperNotes', rows: 3, placeholder: 'Overall impressions, things to check, your verdict so far…' });
    general.value = p.notes || '';
    general.addEventListener('input', () => { paperPatch(pid, { notes: general.value }, 600); autoGrow(general); });
    const newCat = h('select', { class: 'select sm', id: 'newNoteCat', 'aria-label': 'Kind of note' }, CATS.map(c => h('option', { value: c.id }, c.label)));
    newCat.value = 'question';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Sort marks' },
      h('button', { 'data-sort': 'page', 'aria-pressed': String(S.sort === 'page') }, 'By page'),
      h('button', { 'data-sort': 'kind', 'aria-pressed': String(S.sort === 'kind') }, 'By kind'));
    seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.sort = b.dataset.sort; LS.set('sort', S.sort); for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b)); renderNotesList(); });
    pane.replaceChildren(
      h('div', { class: 'sec' }, h('label', { class: 'lbl', for: 'paperNotes' }, 'Paper notes'), general),
      h('div', { class: 'sec' },
        h('div', { class: 'row between' }, h('span', { class: 'lbl' }, 'Marks'), h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', id: 'exportMarks', onclick: () => exportMarks(pid) }, 'Export'), seg)),
        h('div', { class: 'filters', id: 'filters' })),
      h('div', { class: 'hint', id: 'markHint' }, 'Select text in the paper, then press ', h('kbd', null, '1'), '–', h('kbd', null, '7'), ' to mark it as a contribution, strength, weakness, question, typo, related-work gap or limitation. Click a mark to edit it, and use ', h('kbd', null, 'J'), ' / ', h('kbd', null, 'K'), ' to step through them.'),
      h('div', { class: 'cards', id: 'cards' }),
      h('div', { class: 'row addnote' }, h('span', { class: 'muted sm' }, 'Note without a passage:'), newCat, h('button', { class: 'btn sm', onclick: () => addLooseNote(newCat.value, '', '', { focus: true }) }, 'Add')));
    requestAnimationFrame(() => autoGrow(general));
  }
  function renderNotesList() {
    if (!S.active || notesFor !== S.active) { if (S.tab === 'notes') renderNotes(); return; }
    const pid = S.active; const all = sortedHls(pid);
    const counts = {}; for (const x of all) counts[x.cat] = (counts[x.cat] || 0) + 1;
    if (S.filter !== 'all' && !counts[S.filter]) S.filter = 'all';
    $('#filters').replaceChildren(
      all.length ? h('button', { class: 'chip', 'aria-pressed': String(S.filter === 'all'), onclick: () => { S.filter = 'all'; renderNotesList(); } }, `All ${all.length}`) : null,
      ...CATS.filter(c => counts[c.id]).map(c => h('button', { class: 'chip', style: `--c:var(--c-${c.id})`, 'aria-pressed': String(S.filter === c.id), onclick: () => { S.filter = S.filter === c.id ? 'all' : c.id; renderNotesList(); } }, h('span', { class: 'dot' }), `${c.label} ${counts[c.id]}`)));
    $('#markHint').hidden = all.length > 0;
    $('#exportMarks').hidden = !all.length;
    const list = S.filter === 'all' ? all : all.filter(x => x.cat === S.filter);
    const cards = $('#cards'); const keep = new Set(list.map(x => x.id));
    for (const [hid, el] of cardEls) if (!keep.has(hid)) { el.remove(); cardEls.delete(hid); }
    let prev = null;
    for (const x of list) {
      let el = cardEls.get(x.id);
      if (!el) { el = makeCard(pid, x); cardEls.set(x.id, el); } else updateCard(el, x);
      const want = prev ? prev.nextSibling : cards.firstChild;
      if (el !== want) cards.insertBefore(el, want);
      prev = el;
    }
  }
  function makeCard(pid, x) {
    const el = h('article', { class: 'card', 'data-hid': x.id });
    const sel = h('select', { class: 'catsel', 'aria-label': 'Kind of mark' }, CATS.map(c => h('option', { value: c.id }, c.label)));
    sel.addEventListener('change', () => hlPatch(pid, x.id, { cat: sel.value }));
    const loc = h('button', { class: 'loc', title: 'Show in the paper' }); loc.addEventListener('click', () => jumpToHl(x.id));
    const ask = h('button', { class: 'btn icon sm ghost', 'aria-label': 'Ask the assistant about this mark', title: 'Ask the assistant', html: icon('chat') }); ask.addEventListener('click', () => askAboutHl(pid, x.id));
    const del = h('button', { class: 'btn icon sm ghost', 'aria-label': 'Delete mark', title: 'Delete', html: icon('trash') }); del.addEventListener('click', () => deleteHl(pid, x.id));
    const quote = h('div', { class: 'quote', tabindex: '0' });
    quote.addEventListener('click', () => jumpToHl(x.id)); quote.addEventListener('keydown', e => { if (e.key === 'Enter') jumpToHl(x.id); });
    const ta = h('textarea', { class: 'note-input', rows: 1, placeholder: 'Add a note', 'aria-label': 'Note' });
    ta.addEventListener('input', () => { hlPatch(pid, x.id, { note: ta.value }, 600); autoGrow(ta); });
    ta.addEventListener('focus', () => { if (S.selHl !== x.id) { S.selHl = x.id; drawHls(); for (const [id, c] of cardEls) c.classList.toggle('on', id === x.id); } });
    el.append(h('div', { class: 'card-head' }, h('span', { class: 'dot' }), sel, loc, h('span', { class: 'grow' }), ask, del), quote, ta);
    el._els = { sel, loc, quote, ta };
    updateCard(el, x);
    requestAnimationFrame(() => autoGrow(ta));
    return el;
  }
  function updateCard(el, x) {
    const { sel, loc, quote, ta } = el._els;
    el.style.setProperty('--c', `var(--c-${x.cat})`);
    if (sel.value !== x.cat) sel.value = x.cat;
    const anchored = !!(x.rects && x.rects.length);
    loc.textContent = anchored ? `p. ${x.page}` : 'no passage'; loc.disabled = !anchored;
    quote.hidden = !x.text; quote.classList.toggle('loose', !anchored); quote.title = anchored ? 'Show in the paper' : '';
    const qt = clip(x.text, 420); if (quote.textContent !== qt) quote.replaceChildren(h('span', null, qt));
    if (document.activeElement !== ta && ta.value !== (x.note || '')) { ta.value = x.note || ''; autoGrow(ta); }
    el.classList.toggle('on', S.selHl === x.id);
  }
  function markCard(hid, scroll = true) {
    for (const [id, el] of cardEls) el.classList.toggle('on', id === hid);
    const el = hid && cardEls.get(hid);
    if (el && S.tab === 'notes') { if (scroll) el.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); el.classList.remove('flashc'); void el.offsetWidth; el.classList.add('flashc'); }
  }
  function addLooseNote(cat, text, note, opts = {}) {
    if (!S.active) return; const pid = S.active, hid = 'h' + uid();
    const x = { id: hid, paperId: pid, cat, text: text || '', rects: [], page: null, note: note || '', createdAt: Date.now(), updatedAt: Date.now() };
    (S.hls[pid] = S.hls[pid] || {})[hid] = x; saveHl(pid, hid); hlChanged(pid);
    if (opts.focus) setTimeout(() => { const el = cardEls.get(hid); if (el) { el.scrollIntoView({ block: 'nearest' }); el._els.ta.focus(); } }, 30);
    if (opts.silent) toast('Saved to your marks as a related-work note.');
  }
  function marksMarkdown(pid) {
    const p = S.papers[pid]; const all = sortedHls(pid); const out = [`# Marks: ${p.title}`, ''];
    for (const c of CATS) {
      const xs = all.filter(x => x.cat === c.id); if (!xs.length) continue;
      out.push(`## ${c.label}`, '');
      for (const x of xs) {
        const where = x.page ? `p. ${x.page}` : 'general';
        out.push(`- **${where}**${x.text ? ` “${clip(x.text, 500)}”` : ''}${(x.note || '').trim() ? `\n  ${x.note.trim().replace(/\n/g, '\n  ')}` : ''}`);
      }
      out.push('');
    }
    if ((p.notes || '').trim()) out.push('## Paper notes', '', p.notes.trim(), '');
    return out.join('\n');
  }
  function exportMarks(pid) { downloadFile(slug(S.papers[pid].title) + '-marks.md', marksMarkdown(pid)); }

  /* ---------- assistant ---------- */
  let chatCtl = null, bubbleRaf = 0;
  function renderAssistant() {
    const pane = $('#pane-assistant');
    if (!S.active) { chatFor = null; pane.replaceChildren(emptyPane('Open a paper to discuss it with the assistant.')); return; }
    if (!ai.available()) { chatFor = null; pane.replaceChildren(setupCard()); return; }
    const fresh = chatFor !== S.active;
    if (fresh) buildAssistant(pane);
    updateAssistantCtx();
    if (fresh || S.chatDirty) renderChatMessages();
  }
  function setupCard() {
    return h('div', { class: 'setup' },
      h('h3', null, 'Set up an AI assistant (optional)'),
      h('p', { class: 'sm' }, 'Discuss the paper, polish your wording and check your draft for consistency. Choose one:'),
      h('ul', null,
        h('li', null, h('strong', null, 'Claude'), ' with your own Anthropic API key. Requests go straight from this browser to Anthropic.'),
        h('li', null, h('strong', null, 'A local model'), ' through Ollama, LM Studio or any OpenAI-compatible server. The paper never leaves your computer.')),
      policyNote(),
      h('p', { class: 'sm muted' }, 'Nothing is sent anywhere until you set this up.'),
      h('div', null, h('button', { class: 'btn primary', onclick: () => openSettings('ai') }, 'Set up the assistant')));
  }
  const POLICY_URL = 'https://aclrollingreview.org/reviewerguidelines#q-can-i-use-generative-ai';
  function policyNote() {
    return h('p', { class: 'callout' }, 'ARR’s reviewer guidelines don’t allow putting a submission, or your review, into a generative AI tool that isn’t privacy-preserving, and don’t allow AI to write your first draft. A local model keeps everything on your computer. Other venues have their own rules. ',
      h('a', { href: POLICY_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Read the ARR guidance'), '.');
  }
  function buildAssistant(pane) {
    chatFor = S.active; const pid = S.active;
    const share = h('input', { type: 'checkbox', id: 'shareText' }); share.checked = shareOn(pid);
    share.addEventListener('change', () => { paperPatch(pid, { shareWithAI: share.checked }); updateAssistantCtx(); });
    const deep = h('input', { type: 'checkbox', id: 'deepMode' }); deep.checked = S.deep;
    deep.addEventListener('change', () => { S.deep = deep.checked; LS.set('deep', S.deep); updateAssistantCtx(); });
    const ta = h('textarea', { id: 'chatIn', class: 'chat-in', rows: 2, placeholder: 'Ask about the paper, a passage, or your draft. Enter sends, Shift+Enter adds a line.' });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); } });
    ta.addEventListener('input', () => autoGrow(ta));
    pane.replaceChildren(
      h('div', { class: 'chat-ctx' },
        h('label', { class: 'check', title: 'Send the paper’s text with each question' }, share, 'Share paper text'),
        ai.supportsDeep() ? h('label', { class: 'check', title: 'Use the most capable model; answers take longer and cost more' }, deep, 'Think longer') : null,
        h('button', { class: 'btn sm ghost', onclick: clearChat }, 'Clear chat')),
      h('p', { class: 'ctxline', id: 'ctxLine' }),
      h('div', { class: 'msgs', id: 'msgs', 'aria-live': 'polite' }),
      h('div', { class: 'composer' }, ta, h('div', { class: 'row end' },
        h('button', { class: 'btn', id: 'stopBtn', hidden: true, onclick: () => chatCtl && chatCtl.abort() }, 'Stop'),
        h('button', { class: 'btn primary', id: 'sendBtn', onclick: () => sendChat() }, 'Send'))));
    setChatBusy(S.chatBusy);
  }
  function updateAssistantCtx() {
    const el = $('#ctxLine'); if (!el || !S.active) return;
    const n = Object.keys(S.hls[S.active] || {}).length; const share = shareOn(S.active);
    const who = ai.label(S.deep && ai.supportsDeep() ? 'deep' : 'default');
    el.textContent = share
      ? `Sees the paper text, your ${n} mark${n === 1 ? '' : 's'}, paper notes and review draft. Using ${who}.`
      : `Sees your notes on ${n} mark${n === 1 ? '' : 's'}, paper notes and review draft, but not the paper text or passages you marked. Using ${who}.`;
    const box = $('#shareText'); if (box && document.activeElement !== box) box.checked = share;
  }
  function setChatBusy(b) { const s = $('#sendBtn'), st = $('#stopBtn'); if (s) s.disabled = b; if (st) st.hidden = !b; }
  function renderChatMessages() {
    const msgs = $('#msgs'); if (!msgs) return;
    S.chatDirty = false;
    const turns = S.chats[S.active] || [];
    msgs.replaceChildren();
    if (!turns.length) {
      msgs.append(h('div', { class: 'starters' }, h('span', { class: 'lbl' }, 'Try asking'), STARTERS.map(t => h('button', { class: 'starter', onclick: () => sendChat(t) }, t))));
      return;
    }
    for (const t of turns) msgs.append(bubble(t));
    msgs.scrollTop = msgs.scrollHeight;
  }
  function bubble(t) {
    if (t.role === 'user') return h('div', { class: 'msg user' }, h('div', { class: 'body' }, t.content));
    const body = h('div', { class: 'body md', html: t.content ? md(t.content) : '' });
    if (!t.content && t.pending) body.append(h('span', { class: 'thinking' }, 'Thinking…'));
    const el = h('div', { class: 'msg asst' }, body);
    t._body = body;
    if (t.error) el.append(h('p', { class: 'err' }, t.error));
    if (!t.pending && t.content) el.append(h('div', { class: 'msg-actions' },
      h('button', { class: 'btn sm ghost', onclick: () => copyText(t.content, 'Answer copied.') }, 'Copy'),
      h('button', { class: 'btn sm ghost', onclick: () => appendPaperNotes(t.content) }, 'Add to paper notes')));
    return el;
  }
  function scheduleBubble(t) {
    if (bubbleRaf) return;
    bubbleRaf = requestAnimationFrame(() => {
      bubbleRaf = 0; if (!t._body || !t._body.isConnected) return;
      t._body.innerHTML = md(t.content); const m = $('#msgs');
      if (m && m.scrollHeight - m.scrollTop - m.clientHeight < 140) m.scrollTop = m.scrollHeight;
    });
  }
  function appendPaperNotes(text) {
    const pid = S.active; const cur = (S.papers[pid].notes || '').trimEnd();
    const next = cur ? cur + '\n\n' + text.trim() : text.trim();
    paperPatch(pid, { notes: next }); const g = $('#paperNotes'); if (g) { g.value = next; autoGrow(g); }
    toast('Added to paper notes.');
  }
  function prefillChat(text) {
    if (narrow()) setView('panel'); setTab('assistant');
    const ta = $('#chatIn'); if (!ta) return;
    ta.value = text; autoGrow(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function clearChat() {
    const pid = S.active; if (!pid || S.chatBusy) return;
    const old = S.chats[pid] || []; S.chats[pid] = []; saveChat(pid); renderChatMessages();
    toast('Chat cleared.', 'Undo', () => { S.chats[pid] = old; saveChat(pid); renderChatMessages(); });
  }
  function pagedText(pages, max) {
    let out = '';
    for (let i = 0; i < pages.length; i++) {
      const chunk = `[p. ${i + 1}]\n${pages[i]}\n\n`;
      if (out.length + chunk.length > max) { out += `[Pages ${i + 1}–${pages.length} omitted for length]\n`; break; }
      out += chunk;
    }
    return out.trim();
  }
  /* Quoted passages are part of the submission, so they are only sent when paper sharing is on. */
  function marksText(pid, quotes = shareOn(pid)) {
    return sortedHls(pid).map(x => {
      const anchored = x.rects && x.rects.length;
      const q = x.text && (quotes || !anchored) ? ` "${clip(x.text, 320)}"` : '';
      return `- [${CAT[x.cat].label}${x.page ? ', p. ' + x.page : ''}]${q}${(x.note || '').trim() ? ' Note: ' + x.note.trim() : ''}`;
    }).join('\n');
  }
  function reviewText(pid) {
    const r = S.papers[pid].review || {};
    return formOf(pid).fields.map(f => {
      const v = r[f.k];
      if (f.t === 'scale') return v != null && v !== '' ? `${f.label}: ${fmtScore(v)} (${scaleLabel(f, v)})` : `${f.label}: not set`;
      return String(v || '').trim() ? `${f.label}:\n${String(v).trim()}` : '';
    }).filter(Boolean).join('\n\n');
  }
  async function paperBlock(pid, share) {
    const p = S.papers[pid]; let out = `<paper_title>${p.title}</paper_title>\n\n`;
    if (share) {
      const pages = await getPaperText(pid);
      out += pages ? `<paper_text pages="${pages.length}">\n${pagedText(pages, settings.get().ai.maxPaperChars || 120000)}\n</paper_text>` : '<paper_text>Not available yet. Open the paper first.</paper_text>';
    } else out += '<paper_text>The reviewer chose not to share the paper text. Work from their notes and draft, and say when a question needs the paper itself.</paper_text>';
    return out;
  }
  function notesBlock(pid) {
    const p = S.papers[pid];
    return [`<reviewer_marks>\n${marksText(pid) || '(none yet)'}\n</reviewer_marks>`,
      (p.notes || '').trim() ? `<reviewer_paper_notes>\n${p.notes.trim()}\n</reviewer_paper_notes>` : '',
      `<review_draft form="${formOf(pid).name}">\n${reviewText(pid) || '(empty)'}\n</review_draft>`].filter(Boolean).join('\n\n');
  }
  function normalizeTurns(turns) {
    const out = [];
    for (const t of turns) {
      const role = t.role === 'assistant' ? 'assistant' : 'user';
      if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + t.content;
      else out.push({ role, content: t.content });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
  }
  async function sendChat(textArg) {
    const ta = $('#chatIn'); const text = String(textArg != null ? textArg : (ta ? ta.value : '')).trim();
    if (!text || S.chatBusy || !S.active) return;
    if (!ai.available()) { openSettings('ai'); return; }
    const pid = S.active; const turns = (S.chats[pid] = S.chats[pid] || []);
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].transient) turns.splice(i, 1);
    turns.push({ role: 'user', content: text, at: Date.now() });
    if (ta && textArg == null) { ta.value = ''; autoGrow(ta); }
    const a = { role: 'assistant', content: '', at: Date.now(), pending: true }; turns.push(a);
    S.chatBusy = true; setChatBusy(true); renderChatMessages();
    chatCtl = new AbortController();
    try {
      const share = shareOn(pid);
      /* The paper goes in a cached system block, so follow-up questions are cheaper on Claude. */
      const system = [{ text: PROMPTS.chat(formOf(pid).venue) + '\n\n' + (await paperBlock(pid, share)), cache: share }, { text: notesBlock(pid) }];
      const messages = normalizeTurns(turns.slice(0, -1).filter(t => t.content && !t.transient).slice(-16));
      const res = await ai.stream({ system, messages, tier: S.deep && ai.supportsDeep() ? 'deep' : 'default', maxTokens: S.deep ? 8192 : 4096, signal: chatCtl.signal, onText: t => { a.content = t; scheduleBubble(a); } });
      a.content = res.text; if (res.truncated) a.error = 'The answer was cut short. Ask for less at a time.';
    } catch (e) {
      a.content = (e && e.text) || '';
      const m = ai.message(e); if (m) a.error = m; else if (e && e.code === 'cancelled' && a.content) a.error = 'Stopped.';
    }
    delete a.pending;
    if (!a.content) { if (a.error) a.transient = true; else turns.pop(); }
    S.chatBusy = false; setChatBusy(false);
    if (S.active === pid && S.tab === 'assistant') renderChatMessages();
    saveChat(pid);
  }

  /* ---------- research ---------- */
  let searchCtl = null;
  function renderResearch() {
    const pane = $('#pane-research');
    if (researchFor !== (S.active || '') || !$('#rq')) buildResearch(pane);
    updateLinks();
  }
  function buildResearch(pane) {
    researchFor = S.active || '';
    const q = h('input', { type: 'search', id: 'rq', class: 'input', placeholder: 'Method, task or claim to look up', 'aria-label': 'Search query' });
    q.value = S.rq || '';
    q.addEventListener('input', () => { S.rq = q.value; updateLinks(); });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
    const src = h('select', { class: 'select sm', id: 'rsrc', 'aria-label': 'Search source' }, Object.entries(research.SOURCES).map(([v, l]) => h('option', { value: v }, l)));
    src.value = settings.get().researchSource;
    src.addEventListener('change', () => settings.set({ researchSource: src.value }));
    pane.replaceChildren(
      h('div', { class: 'sec' }, h('label', { class: 'lbl', for: 'rq' }, 'Find related work'),
        h('div', { class: 'row' }, q, h('button', { class: 'btn primary', id: 'rgo', onclick: runSearch }, 'Search')),
        h('div', { class: 'row sm muted' }, h('span', null, 'Search'), src, h('span', null, 'for free. Only your query is sent.'))),
      h('div', { class: 'sec' }, h('span', { class: 'lbl' }, 'Open the search in'), h('div', { class: 'links', id: 'rlinks' })),
      h('p', { class: 'callout' }, 'Search for the method or the claim, never the submission’s title or system name. An exact-title search can surface the authors’ preprint and break double-blind review.'),
      S.active ? h('div', { class: 'sec' }, h('div', null, h('button', { class: 'btn sm', id: 'suggestQ', onclick: suggestQueries }, 'Suggest searches from this paper')), h('div', { class: 'qchips', id: 'qchips' })) : null,
      h('div', { class: 'results', id: 'results' }));
  }
  function updateLinks() {
    const el = $('#rlinks'); if (!el) return;
    const q = (S.rq || '').trim();
    el.replaceChildren(...research.links(q).map(([n, u]) => q ? h('a', { class: 'chip', href: u, target: '_blank', rel: 'noopener noreferrer' }, n, ' ↗') : h('span', { class: 'chip dim', 'aria-disabled': 'true', title: 'Type a query first' }, n)));
  }
  async function runSearch() {
    const query = (S.rq || '').trim(); const out = $('#results'); if (!query || !out) return;
    const source = settings.get().researchSource;
    if (searchCtl) searchCtl.abort(); searchCtl = new AbortController();
    out.replaceChildren(h('p', { class: 'muted' }, `Searching ${research.SOURCES[source]}…`));
    const go = $('#rgo'); if (go) go.disabled = true;
    try { renderResults(await research.search(source, query, { signal: searchCtl.signal }), source); }
    catch (e) { const m = research.message(e, source); if (m) out.replaceChildren(h('p', { class: 'err' }, m)); }
    finally { const g = $('#rgo'); if (g) g.disabled = false; }
  }
  function renderResults(papers, source) {
    const out = $('#results'); if (!out) return; out.replaceChildren();
    if (!papers.length) out.append(h('p', { class: 'muted' }, 'No papers found. Try broader terms.'));
    else out.append(h('p', { class: 'sm muted' }, 'Results from ', h('a', { href: research.SOURCE_URLS[source], target: '_blank', rel: 'noopener noreferrer' }, research.SOURCES[source]), '.'));
    for (const r of papers) {
      const url = /^https?:\/\//.test(r.url || '') ? r.url : null;
      const abs = r.abstract ? h('p', { class: 'abs' }, r.abstract) : null;
      const more = r.abstract && r.abstract.length > 240 ? h('button', { class: 'linkbtn', onclick: e => { abs.classList.toggle('open'); e.target.textContent = abs.classList.contains('open') ? 'Show less' : 'Show more'; } }, 'Show more') : null;
      out.append(h('article', { class: 'result' },
        url ? h('a', { class: 'rtitle', href: url, target: '_blank', rel: 'noopener noreferrer' }, r.title) : h('span', { class: 'rtitle' }, r.title),
        h('div', { class: 'rmeta' }, [r.authors, r.year, r.venue, r.citations != null ? `${r.citations} citations` : ''].filter(Boolean).join(' · ')),
        abs, more,
        S.active ? h('div', null, h('button', { class: 'btn sm', onclick: e => { addLooseNote('related', `${r.title}${r.year ? ' (' + r.year + ')' : ''}${url ? '. ' + url : ''}`, '', { silent: true }); e.target.disabled = true; e.target.textContent = 'Saved to marks'; } }, 'Save as related-work note')) : null));
    }
  }
  async function suggestQueries() {
    const btn = $('#suggestQ'); const pid = S.active; if (!btn || !pid) return;
    if (!ai.available()) { openSettings('ai'); return; }
    btn.disabled = true; btn.textContent = 'Thinking…';
    try {
      let excerpt = '';
      if (shareOn(pid)) { const pages = await getPaperText(pid); excerpt = pages ? pages.slice(0, 2).join('\n\n').slice(0, 9000) : ''; }
      if (!excerpt) excerpt = [S.papers[pid].notes || '', marksText(pid)].join('\n').slice(0, 6000);
      if (!excerpt.trim()) { toast('Mark a few passages, or turn on “Share paper text” in the Assistant tab.'); return; }
      const arr = await ai.json({ prompt: PROMPTS.suggest(excerpt), tier: 'quick' });
      const qs = (Array.isArray(arr) ? arr : []).map(String).filter(Boolean).slice(0, 6);
      const box = $('#qchips'); if (box) box.replaceChildren(...qs.map(x => h('button', { class: 'chip', onclick: () => { S.rq = x; const q = $('#rq'); if (q) q.value = x; updateLinks(); runSearch(); } }, x)));
    } catch (e) { const m = ai.message(e); if (m) toast(m); }
    finally { const b = $('#suggestQ'); if (b) { b.disabled = false; b.textContent = 'Suggest searches from this paper'; } }
  }

  /* ---------- review ---------- */
  function scaleLabel(f, v) {
    const n = Number(v); if (f.labels[n]) return f.labels[n];
    const lo = f.labels[Math.floor(n)], hi = f.labels[Math.ceil(n)];
    return lo && hi ? `between ${lo} and ${hi}` : '';
  }
  function renderReview() {
    const pane = $('#pane-review');
    if (!S.active) { reviewFor = null; pane.replaceChildren(emptyPane('Open a paper to draft its review.')); return; }
    const key = S.active + ':' + formOf(S.active).id;
    if (reviewFor !== key) buildReview(pane); else syncReview();
  }
  function buildReview(pane) {
    const pid = S.active; const form = formOf(pid); reviewFor = pid + ':' + form.id;
    const r = S.papers[pid].review || {};
    for (const k in rvEls) delete rvEls[k];
    const statusSel = h('select', { class: 'select sm', id: 'statusSel', 'aria-label': 'Review status' }, STATUS.map(([v, l]) => h('option', { value: v }, l)));
    statusSel.value = S.papers[pid].status || 'reading';
    statusSel.addEventListener('change', () => { paperPatch(pid, { status: statusSel.value }); renderLibrary(); });
    const formSel = h('select', { class: 'select sm', id: 'formSel', 'aria-label': 'Review form' }, Object.values(FORMS).map(f => h('option', { value: f.id }, f.name)));
    formSel.value = form.id;
    formSel.addEventListener('change', () => { paperPatch(pid, { form: formSel.value }); renderReview(); renderLibrary(); });
    const head = h('div', { class: 'rv-head' },
      h('div', { class: 'row between wrap' }, h('div', null, h('div', { class: 'rv-progress', id: 'rvProg' }), h('div', { class: 'pi-bar big' }, h('i', { id: 'rvBar' }))), h('div', { class: 'row' }, statusSel)),
      h('div', { class: 'row wrap' }, h('span', { class: 'sm muted' }, 'Form'), formSel),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', id: 'checkBtn', onclick: checkReview }, 'Check with AI'),
        h('button', { class: 'btn sm', onclick: () => copyText(reviewMarkdown(pid), 'Review copied as Markdown.') }, 'Copy all'),
        h('button', { class: 'btn sm', onclick: () => downloadFile(slug(S.papers[pid].title) + '-review.md', reviewMarkdown(pid)) }, 'Download .md')),
      h('div', { class: 'check-out', id: 'checkOut', hidden: true }));
    const fields = h('div', { class: 'rv-form' });
    for (const f of form.fields) fields.append(f.t === 'text' ? textField(pid, f, r) : scaleField(pid, f));
    pane.replaceChildren(h('p', { class: 'muted sm' }, form.intro), head, fields);
    syncReview();
  }
  function textField(pid, f, r) {
    const id = 'rv-' + f.k;
    const ta = h('textarea', { id, class: 'rv-ta', rows: 4 }); ta.value = r[f.k] || '';
    const wc = h('span', { class: 'wc' }); const upd = () => { wc.textContent = `${countWords(ta.value)} words`; };
    ta.addEventListener('input', () => { paperPatch(pid, { review: { [f.k]: ta.value } }, 600); autoGrow(ta); upd(); updateProgress(); });
    const foot = h('div', { class: 'field-foot' }, wc, h('span', { class: 'grow' }),
      f.pull ? h('button', { class: 'btn sm ghost', 'data-pull': f.k, onclick: () => pullInto(pid, f) }, 'Insert from marks') : null,
      h('button', { class: 'btn sm ghost', onclick: () => polish(pid, f) }, 'Polish'),
      h('button', { class: 'btn sm ghost', onclick: () => copyText(ta.value, `${f.label} copied.`) }, 'Copy'));
    const prev = h('div', { class: 'polish', id: 'pol-' + f.k, hidden: true });
    const wrap = h('div', { class: 'field', id: 'f-' + f.k },
      h('label', { class: 'fl', for: id }, f.label, f.req ? null : h('span', { class: 'opt' }, '  optional')), f.help ? h('p', { class: 'help' }, f.help) : null, ta, foot, prev);
    rvEls[f.k] = { ta, wrap, upd };
    upd(); requestAnimationFrame(() => autoGrow(ta));
    return wrap;
  }
  function scaleField(pid, f) {
    const name = 'rv-' + f.k; const lab = h('span', { class: 'scale-label' });
    const group = h('div', { class: 'scale', role: 'radiogroup', 'aria-labelledby': name + '-t' });
    for (const v of f.values) {
      const id = `${name}-${String(v).replace('.', '_')}`;
      const inp = h('input', { type: 'radio', name, id, value: v });
      inp.addEventListener('change', () => { paperPatch(pid, { review: { [f.k]: v } }); syncReview(); });
      group.append(inp, h('label', { for: id, title: scaleLabel(f, v) }, fmtScore(v)));
    }
    const clear = h('button', { class: 'linkbtn', onclick: () => { paperPatch(pid, { review: { [f.k]: null } }); syncReview(); } }, 'Clear');
    const setLab = () => { const v = (S.papers[pid].review || {})[f.k]; const set = v != null && v !== ''; lab.textContent = set ? `${fmtScore(v)}: ${scaleLabel(f, v)}` : 'Not set'; lab.classList.toggle('muted', !set); clear.hidden = !set; };
    const wrap = h('div', { class: 'field', id: 'f-' + f.k }, h('div', { class: 'fl', id: name + '-t' }, f.label), group, h('div', { class: 'row' }, lab, h('span', { class: 'grow' }), clear));
    rvEls[f.k] = { group, wrap, setLab };
    return wrap;
  }
  function syncReview() {
    const pid = S.active; if (!pid || reviewFor !== pid + ':' + formOf(pid).id) return;
    const r = S.papers[pid].review || {};
    for (const f of formOf(pid).fields) {
      const e = rvEls[f.k]; if (!e) continue;
      if (f.t === 'text') { const v = r[f.k] || ''; if (document.activeElement !== e.ta && e.ta.value !== v) { e.ta.value = v; autoGrow(e.ta); } e.upd(); }
      else { for (const inp of e.group.querySelectorAll('input')) inp.checked = r[f.k] != null && r[f.k] !== '' && Number(inp.value) === Number(r[f.k]); e.setLab(); }
      if (f.showIf) e.wrap.hidden = !f.showIf(r) && !String(r[f.k] || '').trim();
    }
    const hls = sortedHls(pid);
    for (const btn of $$('[data-pull]')) {
      const f = formOf(pid).fields.find(x => x.k === btn.dataset.pull); if (!f) continue;
      const n = hls.filter(x => f.pull.includes(x.cat)).length; btn.textContent = `Insert from marks (${n})`; btn.disabled = !n;
    }
    const st = $('#statusSel'); if (st && document.activeElement !== st) st.value = S.papers[pid].status || 'reading';
    updateProgress();
  }
  function updateProgress() {
    const pid = S.active; if (!pid || reviewFor !== pid + ':' + formOf(pid).id) return;
    const n = filledCount(pid); const req = reqOf(formOf(pid)).length;
    const pr = $('#rvProg'), bar = $('#rvBar');
    if (pr) pr.textContent = `${n} of ${req} required fields filled`;
    if (bar) bar.style.width = (req ? (n / req) * 100 : 0) + '%';
    debounceKey('libprog', 900, renderLibrary);
  }
  function pullItem(x) {
    const note = (x.note || '').trim(); const anchored = x.rects && x.rects.length;
    if (!anchored) return note ? (x.text ? `${note} (${x.text})` : note) : (x.text || '');
    const q = `“${clip(x.text, 160)}”`;
    return note ? `${note} (p. ${x.page}: ${q})` : `p. ${x.page}: ${q}`;
  }
  function buildPull(pid, f, existing) {
    const hls = sortedHls(pid).filter(x => f.pull.includes(x.cat)); if (!hls.length) return { block: '', n: 0 };
    let block;
    if (f.pull.length > 1) {
      block = f.pull.map(c => { const xs = hls.filter(x => x.cat === c); return xs.length ? `${GROUP_TITLES[c] || CAT[c].label}:\n` + xs.map(x => `- ${pullItem(x)}`).join('\n') : ''; }).filter(Boolean).join('\n\n');
    } else if (f.numbered) {
      const nums = (existing.match(/^\s*(\d+)[.)]/gm) || []).map(s => parseInt(s, 10)); let n = nums.length ? Math.max(...nums) : 0;
      block = hls.map(x => `${++n}. ${pullItem(x)}`).join('\n');
    } else block = hls.map(x => `- ${pullItem(x)}`).join('\n');
    return { block, n: hls.length };
  }
  function setField(pid, f, value) { const e = rvEls[f.k]; if (e) { e.ta.value = value; autoGrow(e.ta); e.upd(); } paperPatch(pid, { review: { [f.k]: value } }); updateProgress(); }
  function pullInto(pid, f) {
    const e = rvEls[f.k]; const before = e.ta.value;
    const { block, n } = buildPull(pid, f, before); if (!block) return;
    setField(pid, f, before.trim() ? before.replace(/\s+$/, '') + '\n\n' + block : block);
    if ((S.papers[pid].status || 'reading') === 'reading') { paperPatch(pid, { status: 'drafting' }); syncReview(); renderLibrary(); }
    toast(`Inserted ${n} mark${n === 1 ? '' : 's'} into ${f.label}. Rewrite them in your own words.`, 'Undo', () => setField(pid, f, before));
  }
  async function polish(pid, f) {
    if (!ai.available()) { openSettings('ai'); return; }
    const e = rvEls[f.k]; const val = e.ta.value.trim(); const box = $('#pol-' + f.k);
    if (!val) { toast('Write this section first, then polish it.'); return; }
    const ctl = new AbortController();
    const out = h('div', { class: 'pol-text' }, 'Thinking…');
    const actions = h('div', { class: 'row end' }, h('button', { class: 'btn sm', onclick: () => { ctl.abort(); box.hidden = true; } }, 'Cancel'));
    box.hidden = false; box.replaceChildren(h('span', { class: 'lbl' }, 'Suggested edit'), out, actions);
    try {
      const { text } = await ai.stream({ system: [{ text: PROMPTS.polish(formOf(pid).venue) }], messages: [{ role: 'user', content: `Section: ${f.label}\n\n<section>\n${val}\n</section>` }], signal: ctl.signal, onText: t => { out.textContent = t; } });
      out.textContent = text;
      actions.replaceChildren(
        h('button', { class: 'btn sm', onclick: () => { box.hidden = true; } }, 'Keep mine'),
        h('button', { class: 'btn sm primary', onclick: () => { const before = e.ta.value; setField(pid, f, text.trim()); box.hidden = true; toast('Replaced with the edited version.', 'Undo', () => setField(pid, f, before)); } }, 'Use this version'));
    } catch (err) {
      if (err && err.code === 'cancelled') return;
      out.textContent = (err && err.text) || '';
      actions.replaceChildren(h('span', { class: 'err' }, ai.message(err)), h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => { box.hidden = true; } }, 'Close'));
    }
  }
  async function checkReview() {
    const pid = S.active; const box = $('#checkOut'), btn = $('#checkBtn'); if (!pid || !box) return;
    if (!ai.available()) { openSettings('ai'); return; }
    box.hidden = false; box.replaceChildren(h('p', { class: 'muted' }, 'Reading your draft…')); if (btn) btn.disabled = true;
    try {
      const form = formOf(pid); const keys = form.fields.map(f => f.k).join(', ');
      const share = shareOn(pid);
      const arr = await ai.json({
        system: [{ text: PROMPTS.check(form) + '\n\n' + (await paperBlock(pid, share)), cache: share }, { text: notesBlock(pid) }],
        prompt: `Check my review draft. Reply with only a JSON array (at most 10 items, most important first) of objects {"field": one of [${keys}] or "overall", "severity": "high" | "medium" | "low", "issue": string, "suggestion": string}. Reply [] if nothing needs changing.`,
      });
      renderCheck(Array.isArray(arr) ? arr : []);
    } catch (e) { box.replaceChildren(h('p', { class: 'err' }, ai.message(e) || 'The check was stopped.'), h('button', { class: 'linkbtn', onclick: () => { box.hidden = true; } }, 'Close')); }
    finally { const b = $('#checkBtn'); if (b) b.disabled = false; }
  }
  function renderCheck(items) {
    const box = $('#checkOut'); if (!box) return;
    const fields = formOf(S.active).fields;
    const head = h('div', { class: 'row between' }, h('span', { class: 'lbl' }, items.length ? `${items.length} thing${items.length === 1 ? '' : 's'} to look at` : 'Nothing to fix'), h('button', { class: 'linkbtn', onclick: () => { box.hidden = true; } }, 'Close'));
    if (!items.length) { box.replaceChildren(head, h('p', { class: 'sm' }, 'Scores, text and tone look consistent. Read it once more in the review system’s preview before you submit.')); return; }
    box.replaceChildren(head, ...items.map(it => {
      const f = fields.find(x => x.k === it.field); const sev = ['high', 'medium', 'low'].includes(it.severity) ? it.severity : 'low';
      return h('div', { class: 'issue' },
        h('div', { class: 'row' }, h('span', { class: 'sev ' + sev }, sev), f ? h('button', { class: 'linkbtn', onclick: () => { const w = $('#f-' + f.k); if (w) { w.hidden = false; w.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); const t = w.querySelector('textarea'); if (t) t.focus({ preventScroll: true }); } } }, f.label) : h('span', { class: 'sm muted' }, 'Whole review')),
        h('div', null, String(it.issue || '')), it.suggestion ? h('div', { class: 'muted' }, String(it.suggestion)) : null);
    }));
  }
  function reviewMarkdown(pid) {
    const p = S.papers[pid]; const r = p.review || {}; const form = formOf(pid);
    const out = [`# Review: ${p.title}`, '', `_${form.name}_`, ''];
    for (const f of form.fields) {
      const v = r[f.k];
      if (f.showIf && !f.showIf(r) && !String(v || '').trim()) continue;
      if (f.t === 'scale') out.push(`## ${f.label}`, v != null && v !== '' ? `${fmtScore(v)}: ${scaleLabel(f, v)}` : '_Not set_', '');
      else out.push(`## ${f.label}`, String(v || '').trim() || '_Empty_', '');
    }
    return out.join('\n');
  }

  /* ================= settings ================= */
  const dlg = $('#settingsDlg');
  function setRow(labelText, control, help, forId) {
    return h('div', { class: 'set-row' },
      forId ? h('label', { for: forId }, labelText) : h('span', { class: 'set-label' }, labelText),
      h('div', { class: 'set-ctl' }, control, help ? h('p', { class: 'help' }, help) : null));
  }
  function radios(name, opts, value, onChange) {
    return h('div', { class: 'radios', role: 'radiogroup' }, opts.map(([v, l]) => {
      const inp = h('input', { type: 'radio', name, value: v, id: `${name}-${v}` }); inp.checked = v === value;
      inp.addEventListener('change', () => onChange(v));
      return h('label', { for: `${name}-${v}` }, inp, l);
    }));
  }
  function selectEl(id, opts, value, onChange) {
    const s = h('select', { class: 'select', id }, opts.map(([v, l]) => h('option', { value: v }, l)));
    s.value = value; s.addEventListener('change', () => onChange(s.value)); return s;
  }
  function inputEl(id, value, onInput, attrs = {}) {
    const i = h('input', Object.assign({ class: 'input', id, autocomplete: 'off', spellcheck: 'false' }, attrs)); i.value = value || '';
    i.addEventListener('input', () => debounceKey('set:' + id, 400, () => onInput(i.value.trim())));
    return i;
  }
  function openSettings(section) {
    buildSettings();
    if (!dlg.open) dlg.showModal();
    if (section) { const el = $('#set-' + section); if (el) el.scrollIntoView({ block: 'start' }); }
  }
  function buildSettings() {
    const st = settings.get();
    $('#settingsBody').replaceChildren(
      h('section', { class: 'set-sec', id: 'set-appearance' }, h('h3', null, 'Appearance'),
        setRow('Theme', radios('setTheme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], st.theme, v => settings.set({ theme: v }))),
        setRow('Paper pages', selectEl('setLook', [['auto', 'Match the theme'], ['original', 'Always white'], ['night', 'Night (inverted)']], st.pageLook, v => settings.set({ pageLook: v })), 'Night inverts page colours for reading in the dark. Figures are inverted too.', 'setLook')),
      h('section', { class: 'set-sec', id: 'set-ai' }, h('h3', null, 'AI assistant'), aiSettings()),
      h('section', { class: 'set-sec', id: 'set-research' }, h('h3', null, 'Research'),
        setRow('Search source', selectEl('setSrc', Object.entries(research.SOURCES), st.researchSource, v => { settings.set({ researchSource: v }); const r = $('#rsrc'); if (r) r.value = v; }), 'Both are free and need no account. Only the words you search for are sent.', 'setSrc')),
      h('section', { class: 'set-sec', id: 'set-form' }, h('h3', null, 'Review form'),
        setRow('Default form', selectEl('setForm', Object.values(FORMS).map(f => [f.id, f.name]), st.defaultForm, v => settings.set({ defaultForm: v })), 'Used for papers you add from now on. Change the form of any paper from its Review tab. To add a venue’s form, see the README.', 'setForm')),
      h('section', { class: 'set-sec', id: 'set-data' }, h('h3', null, 'Your data'), dataSettings()),
      h('section', { class: 'set-sec', id: 'set-about' }, h('h3', null, 'About'),
        h('p', { class: 'sm' }, 'Review Desk is free, open-source software under the MIT license. ', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Source code, issues and suggestions on GitHub'), '.'),
        h('p', { class: 'sm muted' }, 'An independent project, not affiliated with or endorsed by the Association for Computational Linguistics or ACL Rolling Review. Search results come from OpenAlex and Semantic Scholar. PDFs are displayed with pdf.js.')));
  }
  function aiSettings() {
    const st = settings.get().ai; const k = settings.keys();
    const box = h('div', { class: 'sec' });
    const status = h('p', { class: 'sm', id: 'aiStatus', 'aria-live': 'polite' });
    const provider = selectEl('setProvider', [['none', 'Off'], ['anthropic', 'Claude (Anthropic API key)'], ['openai', 'OpenAI-compatible server (Ollama, LM Studio, …)']], st.provider, v => { settings.set({ ai: { provider: v } }); fill(); });
    function fill() {
      const c = settings.get().ai; const rows = [];
      if (c.provider === 'anthropic') {
        rows.push(setRow('API key', inputEl('setAKey', k.anthropicKey, v => settings.setKeys({ anthropicKey: v }), { type: 'password', placeholder: 'sk-ant-…' }), h('span', null, 'Create one at ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener noreferrer' }, 'console.anthropic.com'), '. It is sent only to api.anthropic.com, and usage is billed to your account.'), 'setAKey'));
        rows.push(setRow('Model', inputEl('setAModel', c.anthropicModel, v => settings.set({ ai: { anthropicModel: v || RD.settings.DEFAULTS.ai.anthropicModel } })), 'Used for chat, polishing and checks.', 'setAModel'));
        rows.push(setRow('Quick model', inputEl('setAQuick', c.anthropicQuick, v => settings.set({ ai: { anthropicQuick: v || RD.settings.DEFAULTS.ai.anthropicQuick } })), 'Used for small jobs such as suggesting searches.', 'setAQuick'));
        rows.push(setRow('“Think longer” model', inputEl('setADeep', c.anthropicDeep, v => settings.set({ ai: { anthropicDeep: v || RD.settings.DEFAULTS.ai.anthropicDeep } })), null, 'setADeep'));
      } else if (c.provider === 'openai') {
        rows.push(setRow('Server URL', inputEl('setOBase', c.openaiBase, v => settings.set({ ai: { openaiBase: v } }), { placeholder: 'http://localhost:11434/v1' }), 'Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1 · OpenAI: https://api.openai.com/v1', 'setOBase'));
        rows.push(setRow('Model', inputEl('setOModel', c.openaiModel, v => settings.set({ ai: { openaiModel: v } }), { placeholder: 'for example llama3.1:8b or qwen2.5:14b' }), 'The exact model name your server lists.', 'setOModel'));
        rows.push(setRow('API key', inputEl('setOKey', k.openaiKey, v => settings.setKeys({ openaiKey: v }), { type: 'password', placeholder: 'Leave empty for local servers' }), null, 'setOKey'));
        rows.push(h('p', { class: 'set-note' }, 'Local servers must accept requests from this page. For Ollama, start it with OLLAMA_ORIGINS set to this page’s address (see the README). Small local models have short context windows, so lower “Paper text sent” if answers ignore the paper.'));
      }
      if (c.provider === 'anthropic' || (c.provider === 'openai' && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(c.openaiBase || ''))) rows.push(policyNote());
      if (c.provider !== 'none') {
        const remember = h('input', { type: 'checkbox', id: 'setRemember' }); remember.checked = c.rememberKeys;
        remember.addEventListener('change', () => settings.set({ ai: { rememberKeys: remember.checked } }));
        const shareDef = h('input', { type: 'checkbox', id: 'setShare' }); shareDef.checked = c.shareDefault;
        shareDef.addEventListener('change', () => settings.set({ ai: { shareDefault: shareDef.checked } }));
        const maxC = h('input', { class: 'input', id: 'setMax', type: 'number', min: 5000, max: 1000000, step: 5000 }); maxC.value = c.maxPaperChars;
        maxC.addEventListener('change', () => { const v = Math.max(5000, Math.min(1000000, parseInt(maxC.value, 10) || 120000)); maxC.value = v; settings.set({ ai: { maxPaperChars: v } }); });
        rows.push(setRow('Keys', h('label', { class: 'check' }, remember, 'Remember API keys on this device'), 'When off, keys are forgotten when you close the tab.'));
        rows.push(setRow('Paper text', h('label', { class: 'check' }, shareDef, 'Share paper text with the assistant by default'), 'You can change this for each paper in the Assistant tab.'));
        rows.push(setRow('Paper text sent', maxC, 'Maximum characters of the paper sent with each question. 120,000 is roughly 30,000 tokens.', 'setMax'));
        rows.push(h('div', { class: 'row' }, h('button', { class: 'btn', id: 'testAi', onclick: testAi }, 'Test connection'), status));
      }
      box.replaceChildren(setRow('Provider', provider, c.provider === 'none' ? 'Off: nothing is sent anywhere.' : null, 'setProvider'), ...rows);
      if (chatFor) { chatFor = null; if (S.tab === 'assistant') refreshPanel(); }
    }
    fill();
    return box;
  }
  async function testAi() {
    flushSettingsInputs();
    const s = $('#aiStatus'); const b = $('#testAi'); if (!s) return;
    if (!ai.available()) { s.className = 'sm err'; s.textContent = 'Fill in the key or the server and model first.'; return; }
    s.className = 'sm muted'; s.textContent = 'Testing…'; if (b) b.disabled = true;
    try { const t = await ai.test(); s.className = 'sm okmsg'; s.textContent = `Connected. ${ai.model('quick')} replied “${clip(t, 30)}”.`; }
    catch (e) { s.className = 'sm err'; s.textContent = ai.message(e) || 'Stopped.'; }
    finally { if (b) b.disabled = false; }
  }
  function flushSettingsInputs() {
    for (const id of ['setAKey', 'setAModel', 'setAQuick', 'setADeep', 'setOBase', 'setOModel', 'setOKey']) {
      const el = $('#' + id); if (!el) continue; cancelKey('set:' + id); const v = el.value.trim(); const c = settings.get().ai;
      if (id === 'setAKey') settings.setKeys({ anthropicKey: v });
      else if (id === 'setOKey') settings.setKeys({ openaiKey: v });
      else if (id === 'setAModel') settings.set({ ai: { anthropicModel: v || c.anthropicModel } });
      else if (id === 'setAQuick') settings.set({ ai: { anthropicQuick: v || c.anthropicQuick } });
      else if (id === 'setADeep') settings.set({ ai: { anthropicDeep: v || c.anthropicDeep } });
      else if (id === 'setOBase') settings.set({ ai: { openaiBase: v } });
      else if (id === 'setOModel') settings.set({ ai: { openaiModel: v } });
    }
  }
  function dataSettings() {
    const info = h('p', { class: 'sm', id: 'storageInfo' }, 'Checking storage…');
    const protect = h('div', { id: 'persistRow' });
    const incl = h('input', { type: 'checkbox', id: 'bkPdfs' }); incl.checked = true;
    const confirmBox = h('div', { class: 'row wrap', hidden: true },
      h('span', { class: 'sm' }, 'Delete every paper, PDF, mark, chat and draft in this browser?'),
      h('button', { class: 'btn sm danger solid', onclick: async () => { confirmBox.hidden = true; await deleteEverything(); } }, 'Delete everything'),
      h('button', { class: 'btn sm', onclick: () => { confirmBox.hidden = true; } }, 'Cancel'));
    refreshStorageInfo(info, protect);
    return h('div', { class: 'sec' },
      h('p', { class: 'set-note' }, 'Everything lives in this browser profile on this device. Browsers can clear site data, and other browsers or devices can’t see it, so back up regularly and before switching computers.'),
      info, protect,
      setRow('Back up', h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => exportBackup(incl.checked) }, 'Download backup'), h('label', { class: 'check' }, incl, 'Include PDFs')), `Last backup: ${fmtAgo(LS.get('lastBackup', 0))}. A backup holds papers, marks, chats and drafts. Settings and API keys are not included.`),
      setRow('Restore', h('div', null, h('button', { class: 'btn', onclick: () => $('#importIn').click() }, 'Restore from a backup…')), 'Adds the papers in the backup. Papers already here with the same ID are replaced by the backup’s copy.'),
      setRow('Delete', h('div', { class: 'sec' }, h('div', null, h('button', { class: 'btn danger', onclick: () => { confirmBox.hidden = false; } }, 'Delete all papers and notes…')), confirmBox)));
  }
  async function refreshStorageInfo(info, protect) {
    const est = await store.estimate();
    const n = Object.keys(S.papers).length; const m = Object.values(S.hls).reduce((a, x) => a + Object.keys(x).length, 0);
    if (info) info.textContent = `${n} paper${n === 1 ? '' : 's'} and ${m} mark${m === 1 ? '' : 's'}` + (est.usage != null ? `, using about ${fmtBytes(est.usage)} of this browser’s storage.` : '.');
    if (!protect) return;
    if (est.persisted) protect.replaceChildren(h('p', { class: 'sm okmsg' }, 'This browser won’t clear your data automatically when space runs low.'));
    else if (est.persisted === false) protect.replaceChildren(h('div', { class: 'row wrap' }, h('span', { class: 'sm muted' }, 'The browser may clear this data if your disk gets full.'), h('button', { class: 'btn sm', onclick: async () => { const ok = await store.persist(); toast(ok ? 'Your data is now protected from automatic clean-up.' : 'The browser didn’t allow it. Keep regular backups instead.'); refreshStorageInfo(info, protect); } }, 'Keep my data')));
    else protect.replaceChildren();
  }
  async function exportBackup(includePdfs) {
    flushAll();
    const data = {
      format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), app: 'Review Desk',
      papers: Object.values(S.papers).map(clone),
      highlights: Object.values(S.hls).flatMap(m => Object.values(m)).map(clone),
      chats: Object.entries(S.chats).map(([paperId, turns]) => ({ paperId, turns: (turns || []).filter(t => t.content && !t.pending && !t.transient).map(t => ({ role: t.role, content: t.content, at: t.at || 0 })) })).filter(c => c.turns.length),
      pdfs: {},
    };
    if (includePdfs) {
      for (const p of data.papers) { if (p.sample) continue; const b = await getPdfBytes(p.id); if (b) data.pdfs[p.id] = b64FromBytes(b); }
    }
    downloadFile(`review-desk-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
    LS.set('lastBackup', Date.now()); renderLibrary();
    toast(`Backup downloaded: ${data.papers.length} paper${data.papers.length === 1 ? '' : 's'}${includePdfs ? ' with their PDFs' : ' (without PDFs)'}.`);
    if (dlg.open) buildSettings();
  }
  async function importBackup(file) {
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t a valid backup.'); return; }
    if (!data || !BACKUP_FORMATS.includes(data.format) || !Array.isArray(data.papers)) { toast('That file isn’t a Review Desk backup.'); return; }
    if (!S.storageOk) { toast('This browser is blocking storage, so a backup can’t be restored here.'); return; }
    flushAll();
    try {
      const papers = data.papers.filter(p => p && p.id).map(p => {
        const q = Object.assign(newPaper({}), p);
        if (q.shareWithAI == null && p.shareWithClaude != null) q.shareWithAI = !!p.shareWithClaude;
        delete q.shareWithClaude; delete q.assetId;
        if (!FORMS[q.form]) q.form = 'arr';
        return q;
      });
      const ids = new Set(papers.map(p => p.id));
      const hls = (data.highlights || []).filter(x => x && x.id && ids.has(x.paperId));
      const chats = (data.chats || []).filter(c => c && ids.has(c.paperId)).map(c => ({ paperId: c.paperId, turns: Array.isArray(c.turns) ? c.turns : [], updatedAt: Date.now() }));
      await store.putMany('papers', papers);
      await store.putMany('highlights', hls);
      await store.putMany('chats', chats);
      let pdfCount = 0;
      for (const [pid, b64] of Object.entries(data.pdfs || {})) { if (!ids.has(pid)) continue; try { await store.putPdf(pid, bytesFromB64(b64)); memBytes.delete(pid); pdfCount++; } catch {} }
      await loadAll(); bc({ kind: 'reload' });
      notesFor = reviewFor = chatFor = researchFor = null;
      if (S.active && S.papers[S.active]) { S.pdfPid = null; openPaper(S.active); } else renderAll();
      const missing = papers.filter(p => !p.sample && !(data.pdfs || {})[p.id]).length;
      toast(`Restored ${papers.length} paper${papers.length === 1 ? '' : 's'} and ${hls.length} mark${hls.length === 1 ? '' : 's'}${missing ? `. ${missing} PDF${missing === 1 ? ' needs' : 's need'} reattaching when you open ${missing === 1 ? 'it' : 'them'}` : ''}.`);
      if (dlg.open) buildSettings();
      void pdfCount;
    } catch (e) { toast(e && e.name === 'QuotaExceededError' ? 'There isn’t enough storage to restore this backup.' : 'The backup couldn’t be restored.'); }
  }
  async function deleteEverything() {
    try {
      for (const k of Array.from(pendingSaves.keys())) { pendingSaves.delete(k); cancelKey('save:' + k); }
      await store.clearAll();
      for (const pid of Object.keys(S.papers)) LS.set('page:' + pid, null);
      S.papers = {}; S.hls = {}; S.chats = {}; S.text = {}; memBytes.clear();
      closePaper(); bc({ kind: 'reload' });
      toast('Everything was deleted from this browser.');
      if (dlg.open) buildSettings();
    } catch { toast('Couldn’t delete the data. Reload the page and try again.'); }
  }

  /* ================= chrome ================= */
  function applyTheme() {
    const st = settings.get(); const root = document.documentElement;
    if (st.theme === 'light' || st.theme === 'dark') root.dataset.theme = st.theme; else delete root.dataset.theme;
    if (st.pageLook && st.pageLook !== 'auto') root.dataset.pages = st.pageLook; else delete root.dataset.pages;
    const b = $('#themeBtn'); const next = { system: 'light', light: 'dark', dark: 'system' }[st.theme] || 'light';
    const names = { system: 'System', light: 'Light', dark: 'Dark' };
    b.innerHTML = icon(st.theme === 'light' ? 'sun' : st.theme === 'dark' ? 'moon' : 'system');
    b.title = `Theme: ${names[st.theme] || 'System'}. Click for ${names[next]}.`;
    b.setAttribute('aria-label', b.title);
    b.dataset.next = next;
  }
  function renderHeader() {
    const p = S.papers[S.active];
    $('#docTitle').textContent = p ? (p.title || p.fileName) : '';
    $('#docTitle').title = p ? (p.title || '') : '';
    const ready = !!(S.pdf && S.pdfPid === S.active);
    $('#zoomCtl').hidden = !ready; $('#findBtn').disabled = !ready;
    renderPageInd(); renderZoom();
  }
  function renderSaveState() {
    const el = $('#saveState');
    if (!S.loaded) { el.textContent = ''; return; }
    if (!S.storageOk) { el.textContent = 'Not saving: storage blocked'; el.classList.add('bad'); return; }
    el.classList.toggle('bad', saveErr);
    el.textContent = saveErr ? 'Some changes weren’t saved' : (inflight > 0 || pendingSaves.size) ? 'Saving…' : 'Saved on this device';
  }
  function renderWelcomeMap() {
    const form = FORMS[settings.get().defaultForm] || FORMS.arr;
    $('#mapBody').replaceChildren(...CATS.map(c => {
      const f = form.fields.find(x => x.pull && x.pull.includes(c.id));
      return h('tr', null, h('td', null, h('kbd', null, c.key)), h('td', null, h('span', { class: 'mk', style: `--c:var(--c-${c.id})` }, h('span', { class: 'dot' }), c.label)), h('td', { class: 'field-name' }, f ? f.label : '—'), h('td', null, c.use));
    }));
  }
  function renderAll() { renderLibrary(); renderHeader(); renderReaderState(); refreshPanel(); renderSaveState(); renderWelcomeMap(); }
  function setView(v) {
    $('#shell').dataset.view = v;
    for (const b of $$('#viewSwitch button')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
    if (v === 'panel') refreshPanel();
    if (v === 'reader' && S.fit && S.pv.length) requestAnimationFrame(() => setScale(fitScale(), true));
  }
  function setLibOpen(open) { $('#shell').dataset.libOpen = String(open); $('#libToggle').setAttribute('aria-expanded', String(open)); }
  function renderFs() {
    const b = $('#fsBtn'); if (!document.fullscreenEnabled) { b.hidden = true; return; }
    b.hidden = false; const on = !!document.fullscreenElement;
    b.innerHTML = icon(on ? 'collapse' : 'expand'); b.title = on ? 'Exit full screen' : 'Full screen'; b.setAttribute('aria-label', b.title);
  }

  /* ================= events ================= */
  function bindUI() {
    $('#libToggle').innerHTML = icon('menu'); $('#findBtn').innerHTML = icon('search'); $('#keysBtn').innerHTML = icon('keyboard'); $('#settingsBtn').innerHTML = icon('gear');
    $('#findPrev').innerHTML = icon('up'); $('#findNext').innerHTML = icon('down'); $('#findClose').innerHTML = icon('close');
    for (const b of $$('[data-close]')) { b.innerHTML = icon('close'); b.addEventListener('click', () => b.closest('dialog').close()); }
    const keyCell = k => k.split(/(\s\/\s|\s\+\s|\s–\s|\sor\s)/).map(t => (/^\s(\/|\+|–|or)\s$/.test(t) ? ` ${t.trim()} ` : h('kbd', null, t)));
    $('#keysTable').replaceChildren(...SHORTCUTS.map(([k, d]) => h('tr', null, h('td', null, ...keyCell(k)), h('td', null, d))));
    for (const d of $$('dialog.modal')) d.addEventListener('click', e => { if (e.target === d) d.close(); });

    $('#addBtn').addEventListener('click', () => $('#fileIn').click());
    $('#fileIn').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
    $('#reattachIn').addEventListener('change', e => { reattach(e.target.files[0]); e.target.value = ''; });
    $('#importIn').addEventListener('change', e => { importBackup(e.target.files[0]); e.target.value = ''; });
    $('#welcome').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'add') $('#fileIn').click(); else if (b.dataset.act === 'import') $('#importIn').click(); else openPractice();
    });
    for (const b of $$('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));
    $('#viewSwitch').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
    $('#libToggle').addEventListener('click', () => setLibOpen($('#shell').dataset.libOpen !== 'true'));
    $('#zoomIn').addEventListener('click', () => setScale(Math.round(S.scale * 1.15 * 100) / 100));
    $('#zoomOut').addEventListener('click', () => setScale(Math.round((S.scale / 1.15) * 100) / 100));
    $('#zoomFit').addEventListener('click', () => setScale(fitScale(), true));
    $('#themeBtn').addEventListener('click', e => settings.set({ theme: e.currentTarget.dataset.next }));
    $('#settingsBtn').addEventListener('click', () => openSettings());
    $('#keysBtn').addEventListener('click', () => $('#keysDlg').showModal());
    $('#findBtn').addEventListener('click', openFind);
    $('#fsBtn').addEventListener('click', async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
      catch { toast('Full screen isn’t available here. Press F11, or Ctrl+Cmd+F on a Mac.'); }
    });
    document.addEventListener('fullscreenchange', renderFs);
    const fi = $('#findIn');
    fi.addEventListener('input', () => debounceKey('find', 220, () => runFind(fi.value)));
    fi.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (F.q !== fi.value) runFind(fi.value); else gotoFind(F.i + (e.shiftKey ? -1 : 1)); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); viewer.focus({ preventScroll: true }); }
    });
    $('#findNext').addEventListener('click', () => gotoFind(F.i + 1));
    $('#findPrev').addEventListener('click', () => gotoFind(F.i - 1));
    $('#findClose').addEventListener('click', closeFind);

    viewer.addEventListener('scroll', () => {
      if (popMode === 'hl' && !pop.contains(document.activeElement)) hidePop();
      if (popMode === 'sel') debounceKey('selpos', 60, repositionSel);
      if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateCurPage(); });
    }, { passive: true });
    viewer.addEventListener('mouseup', () => setTimeout(checkSelection, 0));
    viewer.addEventListener('keyup', e => { if (e.shiftKey) checkSelection(); });
    viewer.addEventListener('click', selectHlFromPage);
    let selT = null;
    document.addEventListener('selectionchange', () => {
      clearTimeout(selT);
      selT = setTimeout(() => {
        const s = getSelection();
        if ((!s || s.isCollapsed) && popMode === 'sel') { hidePop(); return; }
        if (matchMedia('(pointer: coarse)').matches) checkSelection();
      }, 280);
    });
    document.addEventListener('pointerdown', e => {
      if (!pop.hidden && !pop.contains(e.target)) hidePop();
      if ($('#shell').dataset.libOpen === 'true' && midWidth() && !narrow() && !e.target.closest('#library') && !e.target.closest('#libToggle')) setLibOpen(false);
    }, true);
    document.addEventListener('keydown', onKey);

    let depth = 0; const hasFiles = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
    window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('#dropover').hidden = false; });
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('#dropover').hidden = true; });
    window.addEventListener('drop', e => {
      if (!hasFiles(e)) return; e.preventDefault(); depth = 0; $('#dropover').hidden = true;
      const files = Array.from(e.dataTransfer.files || []);
      const json = files.find(f => /\.json$/i.test(f.name)); if (json && !files.some(f => /\.pdf$/i.test(f.name))) importBackup(json); else addFiles(files);
    });
    new ResizeObserver(() => { if (S.fit && S.pv.length && S.pdf) debounceKey('fit', 120, () => setScale(fitScale(), true)); }).observe(viewer);
    addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
    settings.onChange((st, patch) => {
      applyTheme();
      if (patch.external || patch.ai || patch.keys) { if (S.tab === 'assistant' && !S.chatBusy) { chatFor = null; refreshPanel(); } else chatFor = null; }
      if (patch.defaultForm || patch.external) renderWelcomeMap();
      if (patch.external && dlg.open) buildSettings();
    });
  }
  function onKey(e) {
    const anyDialog = $$('dialog[open]').length > 0;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F') && S.pdf && S.pdfPid === S.active && !anyDialog) { e.preventDefault(); openFind(); return; }
    if (anyDialog) return;
    if (e.key === 'Escape') {
      if (!pop.hidden) { hidePop(); return; }
      if (!$('#findBar').hidden) { closeFind(); return; }
      if ($('#shell').dataset.libOpen === 'true') { setLibOpen(false); return; }
      return;
    }
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const c = CATS.find(x => x.key === e.key); const sk = /^[aAlL]$/.test(e.key);
    if ((c || sk) && popMode !== 'hl' && S.pdf) {
      const info = (popMode === 'sel' && selInfo) || readSelection();
      if (info) {
        selInfo = info; e.preventDefault();
        if (c) createHl(c.id); else if (e.key === 'a' || e.key === 'A') askSel(); else lookSel();
        return;
      }
    }
    if (e.key === '?') { e.preventDefault(); $('#keysDlg').showModal(); return; }
    if (!S.pdf || S.pdfPid !== S.active) return;
    if (e.key === 'j' || e.key === 'J') { e.preventDefault(); stepMark(1); }
    else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); stepMark(-1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setScale(Math.round(S.scale * 1.15 * 100) / 100); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setScale(Math.round((S.scale / 1.15) * 100) / 100); }
    else if (e.key === '0') { e.preventDefault(); setScale(fitScale(), true); }
  }

  /* ================= start ================= */
  async function boot() {
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    applyTheme(); renderFs(); bindUI(); setTab(S.tab);
    S.storageOk = await store.open();
    try { await loadAll(); } catch { S.storageOk = false; }
    S.loaded = true; renderAll();
    const want = LS.get('active', null);
    if (want && S.papers[want]) openPaper(want, { keepView: true });
    window.addEventListener('beforeunload', flushAll);
  }
  boot();
})();
