/*
 * A short, fictional submission generated as a PDF in the browser, for trying the desk.
 * It contains deliberate problems a reviewer should catch (tuning on the evaluation set,
 * a single run, a missing baseline, an anonymity slip, overclaiming, typos).
 */
window.RD = window.RD || {};
(() => {
  'use strict';
  function buildSamplePdf() {
    const W = 612, H = 792, ML = 72, MR = 72, TOP = 74, BOT = 70;
    const AVG = { F1: 0.47, F2: 0.52, F3: 0.45, F4: 0.6 };
    const pdfEsc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const pages = []; let ops = [], y = 0;
    const TITLE = 'LingoSqueeze: Language-Aware Prompt Compression for Multilingual Retrieval-Augmented QA';
    function newPage() {
      if (ops.length) pages.push(ops.join('\n'));
      ops = []; y = H - TOP; const n = pages.length + 1;
      ops.push(`BT /F3 8 Tf ${ML} ${H - 42} Td (${pdfEsc('PRACTICE PAPER: a fictional submission for trying the review desk. Anonymous ACL submission.')}) Tj ET`);
      ops.push(`BT /F1 9 Tf ${W / 2 - 3} 36 Td (${n}) Tj ET`);
    }
    function wrap(str, font, size, width) {
      const max = Math.floor(width / (size * AVG[font])); const out = []; let cur = '';
      for (const w of str.split(/\s+/)) { if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { out.push(cur); cur = w; } }
      if (cur) out.push(cur); return out;
    }
    function para(str, o = {}) {
      const font = o.font || 'F1', size = o.size || 10, lead = o.lead || 12.8, indent = o.indent || 0;
      for (const ln of (o.pre ? [str] : wrap(str, font, size, W - ML - MR - indent))) {
        if (y < BOT) newPage();
        const x = o.center ? (W - ln.length * size * AVG[font]) / 2 : ML + indent;
        ops.push(`BT /${font} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfEsc(ln)}) Tj ET`); y -= lead;
      }
      y -= o.after != null ? o.after : 6;
    }
    const head = s => { if (y < BOT + 50) newPage(); y -= 4; para(s, { font: 'F2', size: 11.5, lead: 14, after: 4 }); };
    newPage();
    para(TITLE, { font: 'F2', size: 15, lead: 19, center: true, after: 4 });
    para('Anonymous ACL submission', { font: 'F3', size: 10, center: true, after: 16 });
    para('Abstract', { font: 'F2', size: 10.5, center: true, after: 4 });
    para('Retrieval-augmented generation (RAG) systems spend most of their inference budget on retrieved passages. Existing prompt compression methods are tuned for English and degrade on other languages. We present LingoSqueeze, a language-aware compressor that scores tokens with a small multilingual encoder and drops low-information subwords before generation. On XOR-TyDi QA, LingoSqueeze keeps 32% of the context tokens while matching full-context exact match, and it reduces end-to-end latency by 3.1x. Because the scorer is trained without language-specific supervision, our approach is language-agnostic and can be applied to any language without further work.', { indent: 24, size: 9.5, lead: 12, after: 12 });
    head('1 Introduction');
    para('Large language models answer open-domain questions more reliably when they are given retrieved evidence (Lewis et al., 2020). The cost is a long prompt: in our setting, five retrieved passages add about 2,000 tokens per question. Prompt compression methods such as LLMLingua (Jiang et al., 2023) remove tokens that a small language model judges unimportant, but these methods were developed and evaluated on English text.');
    para('We argue that compression in multilingual RAG should respect the way each language segments into subwords. Our contributions are: (1) LingoSqueeze, a token-level compressor built on a multilingual encoder; (2) a training recipe that needs no labelled compression data; and (3) experiments on XOR-TyDi QA showing that LingoSqueeze matches full-context accuracy at one third of the tokens.');
    para('In our previous work (Kowalski and Ortiz, 2025) we showed that subword fertility predicts cross-lingual retrieval quality; here we extend that idea to compression.');
    head('2 Method');
    para('Given a question q and retrieved passages P, LingoSqueeze assigns each subword token t an importance score s(t) = sigmoid(w . h_t), where h_t is the final hidden state of a frozen XLM-R base encoder and w is a learned vector. We keep the top-k tokens, where k = r|P| for a compression ratio r, and restore the original token order before passing the compressed context to the generator.');
    para('We train w with a self-supervised objective: the generator should assign the same answer likelihood to the compressed and the full context. We optimise this objective with a straight-through estimator for 2 epochs on 50k English questions from Natural Questions. No multilingual training data is used, which is why we describe the method as language-agnostic.');
    head('3 Experimental Setup');
    para('We evaluate on the XOR-TyDi QA (Asai et al., 2021) development set for four languages: Arabic, Finnish, Japanese and Russian. The generator is an 8B instruction-tuned model with greedy decoding. We compare against the full context, random token dropping, and LLMLingua. The compression ratio r was chosen from {0.2, 0.3, 0.4, 0.5} by selecting the value that gave the best exact match on the evaluation set. All results come from a single run with seed 13.');
    if (y < BOT + 90) newPage();
    para('Table 1: Exact match (EM) on XOR-TyDi QA, averaged over four languages.', { font: 'F3', size: 9.5, after: 4 });
    for (const row of ['Method                  Tokens     EM    Latency', 'Full context             2,048   41.2     1.00x', 'Random drop (50%)        1,024   35.8     0.52x', 'LLMLingua                1,024   39.6     0.61x', 'LingoSqueeze (ours)        660   41.6     0.32x'])
      para(row, { font: 'F4', size: 8.5, lead: 11, pre: true, indent: 24, after: 0 });
    y -= 10;
    head('4 Results');
    para('LingoSqueeze outperforms all baselines and even improves over the full context by 0.4 EM, a significant gain, while using 68% fewer tokens. We hypothesise that removing low-information subwords reduces distraction for the generator, since teh compressed contexts keep named entities and numbers. Latency drops from 1.00x to 0.32x relative to the full context, a 3.1x speedup that matters for multilingual retreival at scale. Results per language follow the same trend; we omit them for space.');
    head('5 Related Work');
    para('Prompt compression has been studied through token pruning with small language models (Jiang et al., 2023) and through data distillation, as in LLMLingua-2 (Pan et al., 2024), which trains a task-agnostic token classifier. Multilingual open-retrieval QA benchmarks include TyDi QA (Clark et al., 2020) and XOR-TyDi QA (Asai et al., 2021). To our knowledge, no prior work studies compression for multilingual RAG.');
    head('Limitations');
    para('Our experiments use one generator.');
    head('Ethics Statement');
    para('We do not foresee ethical risks. Code will be released upon acceptance.');
    head('References');
    for (const ref of [
      'Akari Asai et al. 2021. XOR QA: Cross-lingual Open-Retrieval Question Answering. In Proceedings of NAACL.',
      'Jonathan H. Clark et al. 2020. TyDi QA: A Benchmark for Information-Seeking Question Answering in Typologically Diverse Languages. TACL.',
      'Huiqiang Jiang et al. 2023. LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models. In Proceedings of EMNLP.',
      'Ana Kowalski and Marta Ortiz. 2025. Subword Fertility Predicts Cross-lingual Retrieval Quality. Fictional reference for this practice paper.',
      'Patrick Lewis et al. 2020. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. In Advances in NeurIPS.',
      'Zhuoshi Pan et al. 2024. LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression. In Findings of ACL.']) para(ref, { size: 9, lead: 11.2, after: 4 });
    pages.push(ops.join('\n'));
    const objs = []; objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const fonts = { F1: 'Times-Roman', F2: 'Times-Bold', F3: 'Times-Italic', F4: 'Courier' };
    let n = 3; const fref = {};
    for (const k in fonts) { objs[n] = `<< /Type /Font /Subtype /Type1 /BaseFont /${fonts[k]} /Encoding /WinAnsiEncoding >>`; fref[k] = n++; }
    const fdict = Object.keys(fref).map(k => `/${k} ${fref[k]} 0 R`).join(' ');
    const kids = [];
    for (const c of pages) {
      const cn = n++; objs[cn] = `<< /Length ${c.length} >>\nstream\n${c}\nendstream`;
      const pn = n++; objs[pn] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << ${fdict} >> >> /Contents ${cn} 0 R >>`; kids.push(pn);
    }
    objs[2] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const info = n++; objs[info] = `<< /Title (${pdfEsc('Practice paper: ' + TITLE)}) /Producer (ARR Review Desk) >>`;
    let out = '%PDF-1.4\n'; const offs = [];
    for (let i = 1; i < n; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${n}\n0000000000 65535 f \n` + offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${n} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out);
  }

  RD.samplePdf = buildSamplePdf;
})();
