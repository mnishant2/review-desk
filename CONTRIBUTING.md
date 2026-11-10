# Contributing

Thanks for helping make reviewing a little easier.

## Ground rules

- **Keep it local-first.** Data stays in the browser. Don't add analytics, remote logging or a backend. Any network call must be something the user explicitly asks for (a search, or a request to the AI provider they configured).
- **Keep it buildless.** Plain HTML, CSS and JavaScript loaded with classic `<script>` tags, so the app works from a static host and from `file://`. Don't add a bundler or framework.
- **Respect reviewing rules.** The assistant helps reviewers think, check and phrase. It does not write reviews. Keep paper text opt-in per paper.

## Running locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The practice paper (welcome screen → *Open the practice paper*) is the quickest way to exercise marking, find, the review form and backups.

## Good first contributions

- Review forms for other venues in `src/config.js` (NeurIPS, ICLR, COLING, journal templates, …). Please link the official form in the pull request.
- Translations of the interface text.
- Export of marks as PDF annotations.
- Accessibility fixes and keyboard improvements.

## Pull requests

- Describe what changed and how you tested it, in at least Chrome and Firefox.
- Don't change existing field keys (`k`) in a form. Saved drafts are stored by key.
- Keep new strings plain and specific. The interface uses sentence case and active voice.
