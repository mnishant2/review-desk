/* User settings, kept in localStorage. API keys are kept separately so they can stay session-only. */
window.RD = window.RD || {};
(() => {
  'use strict';
  const { LS, deepMerge } = RD.util;

  const DEFAULTS = {
    theme: 'system', // system | light | dark
    pageLook: 'auto', // auto (dim in dark theme) | original | night
    defaultForm: 'arr',
    researchSource: 'openalex', // openalex | s2
    ai: {
      provider: 'none', // none | anthropic | openai
      anthropicModel: 'claude-sonnet-5-5',
      anthropicQuick: 'claude-haiku-5-5',
      anthropicDeep: 'claude-opus-5-5',
      openaiBase: 'http://localhost:11434/v1',
      openaiModel: '',
      rememberKeys: true,
      shareDefault: false,
      maxPaperChars: 120000,
    },
  };

  const load = () => deepMerge(DEFAULTS, LS.get('settings', {}) || {});
  let cur = load();

  function readKeys() {
    const saved = LS.get('keys', null);
    if (saved) return saved;
    try { return JSON.parse(sessionStorage.getItem('ard:keys') || '{}') || {}; } catch { return {}; }
  }
  let keys = readKeys();

  function writeKeys() {
    if (cur.ai.rememberKeys) {
      LS.set('keys', keys);
      try { sessionStorage.removeItem('ard:keys'); } catch {}
    } else {
      LS.set('keys', null);
      try { sessionStorage.setItem('ard:keys', JSON.stringify(keys)); } catch {}
    }
  }

  const subs = new Set();
  const emit = patch => subs.forEach(f => { try { f(cur, patch); } catch (e) { console.error(e); } });

  function set(patch) {
    cur = deepMerge(cur, patch);
    LS.set('settings', cur);
    if (patch.ai && 'rememberKeys' in patch.ai) writeKeys();
    emit(patch);
  }
  function setKeys(patch) { keys = { ...keys, ...patch }; writeKeys(); emit({ keys: true }); }

  /* Keep other open tabs in step. */
  window.addEventListener('storage', e => {
    if (e.key === 'ard:settings') { cur = load(); emit({ external: true }); }
    if (e.key === 'ard:keys') keys = readKeys();
  });

  RD.settings = { DEFAULTS, get: () => cur, set, keys: () => keys, setKeys, onChange: f => subs.add(f) };
})();
