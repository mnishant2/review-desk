/*
 * Related-work search through free, keyless scholarly APIs.
 * Only the query you type is sent. The paper itself never leaves the browser here.
 */
window.RD = window.RD || {};
(() => {
  'use strict';

  const SOURCES = { openalex: 'OpenAlex', s2: 'Semantic Scholar' };

  const stripTags = s => String(s || '').replace(/<[^>]+>/g, '');
  function authorsStr(list) {
    const n = list.filter(Boolean);
    return n.length > 3 ? n.slice(0, 3).join(', ') + ' et al.' : n.join(', ');
  }
  /* OpenAlex ships abstracts as an inverted index: {word: [positions]}. */
  function invAbstract(idx) {
    if (!idx) return '';
    const words = [];
    for (const w in idx) for (const p of idx[w]) words[p] = w;
    return words.filter(x => x != null).join(' ');
  }

  async function getJson(url, signal) {
    let r;
    try { r = await fetch(url, { signal, headers: { accept: 'application/json' } }); }
    catch { throw { code: signal && signal.aborted ? 'cancelled' : 'network' }; }
    if (r.status === 429) throw { code: 'rate_limited' };
    if (!r.ok) throw { code: 'http', status: r.status };
    return r.json();
  }

  async function search(source, q, { signal, limit = 10 } = {}) {
    const e = encodeURIComponent(q);
    if (source === 's2') {
      const d = await getJson(`https://api.semanticscholar.org/graph/v1/paper/search?query=${e}&limit=${limit}&fields=title,authors,year,venue,abstract,url,citationCount,externalIds`, signal);
      return (d.data || []).map(p => ({
        title: p.title || 'Untitled',
        url: p.url || (p.externalIds && p.externalIds.DOI ? 'https://doi.org/' + p.externalIds.DOI : ''),
        authors: authorsStr((p.authors || []).map(a => a.name)),
        year: p.year || '',
        venue: p.venue || '',
        citations: p.citationCount != null ? p.citationCount : null,
        abstract: p.abstract || '',
      }));
    }
    const d = await getJson(`https://api.openalex.org/works?search=${e}&per-page=${limit}&select=id,display_name,publication_year,doi,cited_by_count,authorships,primary_location,abstract_inverted_index`, signal);
    return (d.results || []).map(w => {
      const loc = w.primary_location || {};
      return {
        title: stripTags(w.display_name) || 'Untitled',
        url: loc.landing_page_url || w.doi || w.id || '',
        authors: authorsStr((w.authorships || []).map(a => a.author && a.author.display_name)),
        year: w.publication_year || '',
        venue: (loc.source && loc.source.display_name) || '',
        citations: w.cited_by_count != null ? w.cited_by_count : null,
        abstract: invAbstract(w.abstract_inverted_index),
      };
    });
  }

  function message(e, source) {
    const name = SOURCES[source] || 'The search service';
    switch (e && e.code) {
      case 'cancelled': return '';
      case 'rate_limited': return `${name} is limiting requests right now. Wait a minute, or switch the source.`;
      case 'network': return `Couldn’t reach ${name}. Check your connection, or use the links above.`;
      default: return `${name} returned an error${e && e.status ? ` (${e.status})` : ''}. Try different terms.`;
    }
  }

  function links(q) {
    const e = encodeURIComponent(q);
    return [
      ['Semantic Scholar', `https://www.semanticscholar.org/search?q=${e}`],
      ['ACL Anthology', `https://aclanthology.org/search/?q=${e}`],
      ['Google Scholar', `https://scholar.google.com/scholar?q=${e}`],
      ['arXiv', `https://arxiv.org/search/?query=${e}&searchtype=all`],
    ];
  }

  RD.research = { SOURCES, search, message, links };
})();
