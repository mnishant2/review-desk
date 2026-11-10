/*
 * Mark categories, review forms, prompts and defaults.
 *
 * To add a review form for another venue, add an entry to FORMS below.
 * Each field is either a text field (t: 'text') or a score (t: 'scale').
 * `pull` lists the mark categories that "Insert from marks" copies into a text field.
 * Keep field keys stable once people use a form: drafts are stored by key.
 */
window.RD = window.RD || {};
(() => {
  'use strict';

  /* Mark categories. Colours live in styles.css as --c-<id> and --hl-<id>. */
  const CATS = [
    { id: 'contrib', key: '1', label: 'Contribution', use: 'What the paper claims to do and find' },
    { id: 'strength', key: '2', label: 'Strength', use: 'Reasons to publish at a selective venue' },
    { id: 'weakness', key: '3', label: 'Weakness', use: 'Problems that would make you rank it lower' },
    { id: 'question', key: '4', label: 'Question', use: 'What you would ask the authors' },
    { id: 'presentation', key: '5', label: 'Typo / clarity', use: 'Presentation fixes, unclear notation' },
    { id: 'related', key: '6', label: 'Related work', use: 'Missing citations or baselines to check' },
    { id: 'limits', key: '7', label: 'Limitations / ethics', use: 'Unstated limits, risks, data concerns' },
  ];
  const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
  /* Headings used when one field pulls several kinds of marks. */
  const GROUP_TITLES = { question: 'Questions for the authors', presentation: 'Presentation and typos', related: 'Related work' };

  const HALF = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const WHOLE = [1, 2, 3, 4, 5];

  /* ACL Rolling Review form: https://aclrollingreview.org/reviewform */
  const ARR = {
    id: 'arr',
    name: 'ACL Rolling Review (ARR)',
    venue: 'ACL Rolling Review (ARR)',
    intro: 'Fields and scales follow the ARR reviewer form. When you are done, copy each section into OpenReview.',
    checkNotes: 'Weaknesses should be numbered. A Best Paper Justification is required when Overall Assessment is 4.5 or 5.',
    fields: [
      { k: 'summary', t: 'text', label: 'Paper Summary', help: 'What the paper is about, so the area chair can catch any misunderstanding.', pull: ['contrib'], req: true },
      { k: 'strengths', t: 'text', label: 'Summary of Strengths', help: 'The main reasons to publish this paper at a selective *ACL venue.', pull: ['strength'], req: true },
      { k: 'weaknesses', t: 'text', label: 'Summary of Weaknesses', help: 'Concerns that would lead you to prioritise other papers. Number them so the authors can respond to each.', pull: ['weakness'], req: true, numbered: true },
      { k: 'comments', t: 'text', label: 'Comments, Suggestions and Typos', help: 'Suggestions beyond the concerns above, questions for the authors, presentation issues and typos.', pull: ['question', 'presentation', 'related'], req: true },
      { k: 'confidence', t: 'scale', label: 'Reviewer Confidence', values: WHOLE, req: true, labels: { 5: 'Positive that my evaluation is correct', 4: 'Quite sure', 3: 'Pretty sure, but I may have missed something', 2: 'Willing to defend, but I may have missed details', 1: 'Not my area, or the paper is very hard to understand' } },
      { k: 'soundness', t: 'scale', label: 'Soundness', values: HALF, req: true, labels: { 5: 'Excellent', 4: 'Strong', 3: 'Acceptable', 2: 'Poor', 1: 'Major issues' } },
      { k: 'excitement', t: 'scale', label: 'Excitement', values: HALF, req: true, labels: { 5: 'Highly exciting', 4: 'Exciting', 3: 'Interesting', 2: 'Potentially interesting', 1: 'Not exciting' } },
      { k: 'overall', t: 'scale', label: 'Overall Assessment', values: HALF, req: true, labels: { 5: 'Consider for award', 4.5: 'Borderline award', 4: 'Conference', 3.5: 'Borderline conference', 3: 'Findings', 2.5: 'Borderline Findings', 2: 'Resubmit next cycle', 1.5: 'Resubmit after next cycle', 1: 'Do not resubmit' } },
      { k: 'bestPaper', t: 'text', label: 'Best Paper Justification', help: 'Needed only when the overall assessment is Consider for award or Borderline award.', showIf: r => Number(r.overall) >= 4.5 },
      { k: 'limitations', t: 'text', label: 'Limitations and Societal Impact', help: 'Do the authors discuss limitations and positive and negative societal impacts adequately? What would improve the discussion?', pull: ['limits'] },
      { k: 'ethics', t: 'text', label: 'Ethical Concerns', help: 'Ethical issues, and whether the authors acknowledged or addressed them (ACL Code of Ethics, the authors’ responsible NLP checklist).' },
      { k: 'needsEthics', t: 'text', label: 'Needs Ethics Review', help: 'Only if the paper should go to the ethics committee: say why.' },
      { k: 'reproducibility', t: 'scale', label: 'Reproducibility', values: WHOLE, req: true, labels: { 5: 'Could easily reproduce the results', 4: 'Could mostly reproduce, with some variation', 3: 'Could reproduce with some difficulty', 2: 'Would be hard pressed to reproduce', 1: 'Would not be able to reproduce' } },
      { k: 'datasets', t: 'scale', label: 'Datasets', values: WHOLE, req: true, labels: { 5: 'Enabling', 4: 'Useful', 3: 'Potentially useful', 2: 'Documentary', 1: 'No usable datasets submitted' } },
      { k: 'software', t: 'scale', label: 'Software', values: WHOLE, req: true, labels: { 5: 'Enabling', 4: 'Useful', 3: 'Potentially useful', 2: 'Documentary', 1: 'No usable software released' } },
      { k: 'authorGuess', t: 'scale', label: 'Knowledge of or Educated Guess at Author Identity', values: WHOLE, req: true, labels: { 5: 'Known or guessable from a double-blind violation', 4: 'Known or guessable from a preprint or allowed workshop paper', 3: 'Known or guessable from the submission’s contents', 2: 'Known or guessable from social media, a talk or informal communication', 1: 'No educated guess' } },
      { k: 'authorConjecture', t: 'text', label: 'Conjecture as to Author Identity', help: 'Authors never see this field.' },
    ],
  };

  /* A neutral structure for venues without their own form here. */
  const GENERIC = {
    id: 'generic',
    name: 'General conference review',
    venue: 'a peer-reviewed conference',
    intro: 'A general review structure that fits most venues. Copy each section into the venue’s review system.',
    checkNotes: 'Weaknesses should be numbered.',
    fields: [
      { k: 'summary', t: 'text', label: 'Summary', help: 'What the paper claims and how it supports those claims.', pull: ['contrib'], req: true },
      { k: 'strengths', t: 'text', label: 'Strengths', help: 'What the paper does well and why it matters.', pull: ['strength'], req: true },
      { k: 'weaknesses', t: 'text', label: 'Weaknesses', help: 'Concerns that limit the contribution. Number them so the authors can respond to each.', pull: ['weakness'], req: true, numbered: true },
      { k: 'questions', t: 'text', label: 'Questions for the Authors', help: 'Points whose answers could change your assessment.', pull: ['question'], req: true },
      { k: 'minor', t: 'text', label: 'Minor Comments and Typos', help: 'Presentation issues, missing references and typos.', pull: ['presentation', 'related'] },
      { k: 'limitations', t: 'text', label: 'Limitations and Broader Impact', help: 'Are limitations and possible harms discussed adequately?', pull: ['limits'] },
      { k: 'recommendation', t: 'scale', label: 'Recommendation', values: WHOLE, req: true, labels: { 5: 'Strong accept', 4: 'Accept', 3: 'Borderline', 2: 'Reject', 1: 'Strong reject' } },
      { k: 'g_confidence', t: 'scale', label: 'Confidence', values: WHOLE, req: true, labels: { 5: 'Certain', 4: 'Confident', 3: 'Fairly confident', 2: 'Willing to defend, but may have missed details', 1: 'Educated guess' } },
    ],
  };

  const FORMS = { arr: ARR, generic: GENERIC };

  const STATUS = [['reading', 'Reading'], ['drafting', 'Drafting'], ['ready', 'Ready to submit'], ['submitted', 'Submitted']];
  const STATUS_L = Object.fromEntries(STATUS);

  const STARTERS = [
    'List the claimed contributions, each with the page where the paper supports it.',
    'Which claims in the abstract and introduction are not backed by the experiments? Cite pages.',
    'Check the experimental setup: data splits, baselines, tuning, seeds and significance. What is missing or unclear?',
    'Make the strongest case for accepting this paper, given my marks.',
    'Read my weaknesses. Are any unfair, vague, or already answered somewhere in the paper?',
    'Explain the method step by step for a reviewer from a neighbouring area.',
  ];

  const PROMPTS = {
    chat: venue => `You are assisting a peer reviewer for ${venue} who is reading a submission. The reviewer forms every judgment and writes the review. Your job is to help them understand the paper, test their reasoning, and check details against the paper text.
- Cite pages like (p. 4) whenever you rely on the paper text. If the answer is not in the text you were given, say so plainly.
- Never invent references, numbers or results. If you mention related work from memory, label it "to verify".
- Be direct and specific. No flattery or filler. Keep answers short unless asked for depth.
- Do not write review sections or a first draft of the review: the reviewer writes it. If asked, decline briefly and offer to critique their own draft instead.
- Use plain Markdown: short paragraphs and lists.
The paper and the reviewer's working notes follow.`,
    polish: venue => `Edit this section of my peer review for ${venue}. Improve clarity, concision and tone so it reads as constructive and professional. Keep every judgment, number, page reference and list numbering. Do not add new criticism, praise, claims or requests, and do not soften or strengthen my conclusions. Keep my wording where it is already clear. Return only the edited section text, with no preamble.`,
    check: form => `You are checking a draft peer review for ${form.venue} before the reviewer submits it. Report problems with the review, not with the paper. Look for: scores that do not match the text (for example a high soundness score alongside serious methodological weaknesses); weaknesses that are vague, not actionable, or missing page or section references; statements about the paper that the paper text contradicts; requests for unreasonable extra work; dismissive or rude tone; empty required fields; anything that could reveal the reviewer's identity. ${form.checkNotes || ''} Do not rewrite the review and do not raise new criticism of the paper.`,
    suggest: excerpt => `You help a peer reviewer check related work for a submission.
Propose 5 short search queries (3 to 7 words each) that would find closely related prior work, competing methods and missing baselines. Describe methods, tasks and datasets in general terms. Never reuse the submission's title or its system name, because that could reveal the authors.
Reply with only a JSON array of 5 strings.

<excerpt>
${excerpt}
</excerpt>`,
  };

  const SHORTCUTS = [
    ['1 – 7', 'Mark the selected text (Contribution … Limitations)'],
    ['A', 'Ask the assistant about the selected text'],
    ['L', 'Look up the selected text in related work'],
    ['J / K', 'Next / previous mark'],
    ['Ctrl or ⌘ + F', 'Find in the paper'],
    ['Enter / Shift + Enter', 'Next / previous match while finding'],
    ['+ / − / 0', 'Zoom in / zoom out / fit to width'],
    ['?', 'Show these shortcuts'],
    ['Esc', 'Close the open menu, find bar or dialog'],
  ];

  RD.config = { CATS, CAT, GROUP_TITLES, FORMS, STATUS, STATUS_L, STARTERS, PROMPTS, SHORTCUTS };
})();
