/*
 * Local storage in IndexedDB. Everything stays in this browser profile.
 *   papers      paper records: title, status, review draft, notes
 *   highlights  marks, indexed by paperId
 *   chats       one assistant thread per paper
 *   pdfs        the PDF bytes, keyed by paper id
 */
window.RD = window.RD || {};
(() => {
  'use strict';
  const NAME = 'arr-review-desk';
  const VERSION = 1;
  const STORES = ['papers', 'highlights', 'chats', 'pdfs'];
  let db = null;

  function open() {
    return new Promise(res => {
      try {
        const r = indexedDB.open(NAME, VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('papers')) d.createObjectStore('papers', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('highlights')) d.createObjectStore('highlights', { keyPath: 'id' }).createIndex('paperId', 'paperId');
          if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'paperId' });
          if (!d.objectStoreNames.contains('pdfs')) d.createObjectStore('pdfs');
        };
        r.onsuccess = () => {
          db = r.result;
          db.onversionchange = () => { db.close(); db = null; };
          res(true);
        };
        r.onerror = () => res(false);
        r.onblocked = () => res(false);
      } catch { res(false); }
    });
  }

  function run(names, mode, fn) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(Object.assign(new Error('Storage is unavailable'), { code: 'unavailable' })); return; }
      let out;
      try {
        const t = db.transaction(names, mode);
        out = fn(t);
        t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
      } catch (e) { reject(e); }
    });
  }

  const get = (s, key) => run([s], 'readonly', t => t.objectStore(s).get(key));
  const getAll = s => run([s], 'readonly', t => t.objectStore(s).getAll());
  const put = (s, value, key) => run([s], 'readwrite', t => { t.objectStore(s).put(value, key); });
  const del = (s, key) => run([s], 'readwrite', t => { t.objectStore(s).delete(key); });
  const putMany = (s, values) => run([s], 'readwrite', t => { const os = t.objectStore(s); for (const v of values) os.put(v); });

  const getPdf = async id => { const b = await get('pdfs', id); return b ? new Uint8Array(b) : null; };
  const putPdf = (id, bytes) => put('pdfs', bytes.slice().buffer, id);

  /** Remove a paper and everything attached to it, in one transaction. */
  function deletePaper(pid) {
    return run(STORES, 'readwrite', t => {
      t.objectStore('papers').delete(pid);
      t.objectStore('chats').delete(pid);
      t.objectStore('pdfs').delete(pid);
      const hs = t.objectStore('highlights');
      hs.index('paperId').openKeyCursor(IDBKeyRange.only(pid)).onsuccess = e => {
        const c = e.target.result;
        if (c) { hs.delete(c.primaryKey); c.continue(); }
      };
    });
  }

  const clearAll = () => run(STORES, 'readwrite', t => { for (const s of STORES) t.objectStore(s).clear(); });

  async function estimate() {
    try {
      const [est, persisted] = await Promise.all([
        navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : null,
        navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : null,
      ]);
      return { usage: est ? est.usage : null, quota: est ? est.quota : null, persisted };
    } catch { return { usage: null, quota: null, persisted: null }; }
  }
  async function persist() {
    try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
  }

  RD.store = { open, get, getAll, put, del, putMany, getPdf, putPdf, deletePaper, clearAll, estimate, persist, ready: () => !!db };
})();
