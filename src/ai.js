/*
 * Optional AI assistant. Calls go straight from the browser to the provider you choose:
 *   anthropic  Claude via the Anthropic Messages API, with your own API key
 *   openai     any OpenAI-compatible server: Ollama, LM Studio, vLLM, llama.cpp, OpenAI, ...
 * Nothing is sent anywhere until a provider is set up in Settings.
 */
window.RD = window.RD || {};
(() => {
  'use strict';
  const { parseJsonLoose } = RD.util;
  const cfg = () => RD.settings.get().ai;
  const keys = () => RD.settings.keys();

  function available() {
    const c = cfg();
    if (c.provider === 'anthropic') return !!keys().anthropicKey;
    if (c.provider === 'openai') return !!(c.openaiBase && c.openaiModel);
    return false;
  }
  function model(tier) {
    const c = cfg();
    if (c.provider === 'anthropic') return (tier === 'quick' ? c.anthropicQuick : tier === 'deep' ? c.anthropicDeep : c.anthropicModel) || c.anthropicModel;
    return c.openaiModel;
  }
  function label(tier) {
    const c = cfg();
    if (c.provider === 'anthropic') return `${model(tier)} via the Anthropic API`;
    if (c.provider === 'openai') { let host = c.openaiBase; try { host = new URL(c.openaiBase).host; } catch {} return `${c.openaiModel || 'no model set'} on ${host}`; }
    return 'no provider';
  }
  const supportsDeep = () => cfg().provider === 'anthropic';

  const err = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra || {});

  /* Read a server-sent-events body, yielding {event, data}. */
  async function* sse(resp) {
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
    const parse = raw => {
      let event = 'message'; const data = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      return { event, data: data.join('\n') };
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let m;
      while ((m = buf.match(/\r?\n\r?\n/))) { const raw = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length); if (raw.trim()) yield parse(raw); }
    }
    if (buf.trim()) yield parse(buf);
  }

  async function httpError(resp) {
    let body = null, msg = '';
    try { body = await resp.json(); } catch {}
    if (body) msg = (body.error && (body.error.message || body.error)) || body.message || '';
    msg = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const s = resp.status;
    if (s === 401) return err('auth', msg);
    if (s === 403) return err('forbidden', msg);
    if (s === 404) return err('model', msg);
    if (s === 429) return err('rate_limited', msg);
    if (s === 413 || /prompt is too long|too many tokens|context length|maximum context|context window/i.test(msg)) return err('too_large', msg);
    if (s === 529 || s === 503) return err('overloaded', msg);
    return err('http', msg || `HTTP ${s}`);
  }
  const mapStreamError = t => (t === 'overloaded_error' ? 'overloaded' : t === 'rate_limit_error' ? 'rate_limited' : t === 'authentication_error' ? 'auth' : 'http');

  async function anthropic({ system, messages, tier, maxTokens, signal, onText }) {
    const key = keys().anthropicKey;
    if (!key) throw err('not_configured');
    const sys = (system || []).filter(p => p && p.text).map(p => (p.cache ? { type: 'text', text: p.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: p.text }));
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: model(tier), max_tokens: maxTokens || 4096, system: sys, messages, stream: true }),
      });
    } catch { throw err(signal && signal.aborted ? 'cancelled' : 'network'); }
    if (!resp.ok) throw await httpError(resp);
    let text = '', stop = null;
    try {
      for await (const ev of sse(resp)) {
        if (!ev.data) continue;
        let d; try { d = JSON.parse(ev.data); } catch { continue; }
        if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') { text += d.delta.text; if (onText) onText(text); }
        else if (d.type === 'message_delta' && d.delta) stop = d.delta.stop_reason || stop;
        else if (d.type === 'error') throw err(mapStreamError(d.error && d.error.type), d.error && d.error.message);
      }
    } catch (e) {
      if (signal && signal.aborted) throw err('cancelled', '', { text });
      if (e && e.code) { e.text = text; throw e; }
      throw err('network', '', { text });
    }
    return { text, truncated: stop === 'max_tokens' };
  }

  async function openai({ system, messages, signal, onText }) {
    const c = cfg(); const key = keys().openaiKey;
    if (!c.openaiBase || !c.openaiModel) throw err('not_configured');
    const base = c.openaiBase.replace(/\/+$/, '');
    const sys = (system || []).map(p => p && p.text).filter(Boolean).join('\n\n');
    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = 'Bearer ' + key;
    let resp;
    try {
      resp = await fetch(base + '/chat/completions', {
        method: 'POST', signal, headers,
        body: JSON.stringify({ model: c.openaiModel, stream: true, messages: (sys ? [{ role: 'system', content: sys }] : []).concat(messages) }),
      });
    } catch { throw err(signal && signal.aborted ? 'cancelled' : 'network'); }
    if (!resp.ok) throw await httpError(resp);
    let text = '', stop = null;
    try {
      for await (const ev of sse(resp)) {
        const data = (ev.data || '').trim();
        if (!data) continue;
        if (data === '[DONE]') break;
        let d; try { d = JSON.parse(data); } catch { continue; }
        if (d.error) throw err('http', d.error.message || String(d.error));
        const ch = d.choices && d.choices[0];
        if (!ch) continue;
        const t = ch.delta && ch.delta.content;
        if (t) { text += t; if (onText) onText(text); }
        if (ch.finish_reason) stop = ch.finish_reason;
      }
    } catch (e) {
      if (signal && signal.aborted) throw err('cancelled', '', { text });
      if (e && e.code) { e.text = text; throw e; }
      throw err('network', '', { text });
    }
    return { text, truncated: stop === 'length' };
  }

  /** Stream a reply. system: [{text, cache?}], messages: [{role, content}] ending with the user. */
  function stream(opts) {
    const p = cfg().provider;
    if (p === 'anthropic') return anthropic(opts);
    if (p === 'openai') return openai(opts);
    return Promise.reject(err('not_configured'));
  }

  /** Ask for JSON and parse it. */
  async function json({ system, prompt, tier, signal, maxTokens }) {
    const { text } = await stream({ system: system || [], messages: [{ role: 'user', content: prompt }], tier, signal, maxTokens: maxTokens || 2048 });
    const v = parseJsonLoose(text);
    if (v === undefined) throw err('invalid_json', '', { text });
    return v;
  }

  async function test() {
    const { text } = await stream({ system: [], messages: [{ role: 'user', content: 'Reply with the single word: ready' }], tier: 'quick', maxTokens: 16 });
    return text.trim();
  }

  function message(e) {
    const c = cfg();
    switch (e && e.code) {
      case 'cancelled': return '';
      case 'not_configured': return 'Set up an AI provider in Settings first.';
      case 'auth': return c.provider === 'anthropic' ? 'Anthropic rejected the API key. Check it in Settings.' : 'The server rejected the API key. Check it in Settings.';
      case 'forbidden': return 'This key can’t use that model. Check your account or the model name in Settings.';
      case 'model': return `The model “${model()}” wasn’t found. Check the model name in Settings.`;
      case 'rate_limited': return 'Rate limit reached. Wait a moment, then try again.';
      case 'overloaded': return 'The model is busy right now. Try again in a minute.';
      case 'too_large': return 'The paper and your notes are too long for this model. Lower “Paper text sent” in Settings, turn off paper sharing, or clear the chat.';
      case 'network': return c.provider === 'openai'
        ? `Couldn’t reach ${c.openaiBase}. Check that the server is running and accepts requests from this page (see the README).`
        : 'Couldn’t reach the Anthropic API. Check your connection.';
      case 'invalid_json': return 'The answer came back in the wrong shape. Try again.';
      default: return e && e.message && e.message !== e.code ? `The request failed: ${e.message}` : 'The request failed. Try again.';
    }
  }

  RD.ai = { available, model, label, supportsDeep, stream, json, test, message };
})();
