# Contributing

Thanks for helping. Three things are especially welcome:

1. **Translations.** Copy the `en` block in `i18n.js`, translate the strings, add the language code to the `<select id="lang">` in `index.html`. Right-to-left languages are handled automatically for `fa` and `ar`; add yours to the `dir` check in `app.js` if needed.
2. **Security review.** Try to make the page leak, or recover redacted content from the output. Open an issue with steps to reproduce.
3. **Detection patterns.** New patterns go into `PATTERNS` in `app.js`. Keep them conservative and `on: false` by default unless false positives are rare.

Rules:

- No build step, no framework, no network requests – ever. Any PR that adds a `fetch`, a CDN link or a tracker will be closed.
- No new dependencies without a vendored, pinned copy and a line in `NOTICE`.
- Keep the PDF writer minimal. If you think it needs more objects, open an issue first.
- Code of conduct: be kind, assume good faith, remember that some users of this tool are in danger.
