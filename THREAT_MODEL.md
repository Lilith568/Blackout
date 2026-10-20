# Threat model

This document says who Blackout protects, against what, and – just as important – against what it does not.

## Users

Primary: people who must pass a document to someone else and whose safety depends on parts of it not being seen. Journalists and their sources, human rights defenders, lawyers, whistleblowers, people living under surveillance, people in abusive relationships, tenants and job applicants who are asked for more paperwork than is proportionate.

Many of these users are **not technical**, are under **time pressure**, may be on a **slow or censored connection**, and may be using a **borrowed or old device**. Blackout is therefore a single page with no installation, no account, no build step and a UI that explains each guarantee in plain words.

## Assets

1. The content being redacted (names, addresses, account numbers, the letterhead, the signature).
2. Metadata that identifies the device, software, person or time (PDF `/Info` and XMP, EXIF, GPS, document IDs, embedded thumbnails).
3. The fact that this person is redacting this document at all.

## Adversaries

| Adversary | Capability | Addressed? |
|---|---|---|
| **The recipient** (and anyone they forward to) opens the file in a PDF viewer, copies text, removes the black box, inspects properties. | Full access to the output file, unlimited time. | **Yes.** Output is pixels only; nothing under the box exists. No metadata is written. |
| **A forensic examiner** uses `pdftotext`, `exiftool`, `qpdf --show-object`, hex editors, incremental-update recovery. | Expert tooling on the output. | **Yes.** The writer emits one JPEG per page, a page tree, a catalog and a trailer. There are no other objects to find. We encourage auditors to confirm this with any tool they like. |
| **A network observer / the operator of an "online redaction" service** sees documents in transit or stores them. | Passive or active network position. | **Yes.** `connect-src 'none'` in the CSP makes the page incapable of any request. The claim is enforced by the browser, is visible in the source, and is verifiable in DevTools. |
| **A supply-chain attacker** compromises a dependency. | Code execution inside the page. | **Partially.** The only third-party code is pdf.js, vendored at a pinned version. Even a malicious pdf.js could not exfiltrate anything because of the CSP. It could, however, draw boxes in the wrong place – which the user sees before export. |
| **A hosting provider / CDN** serves a tampered page. | Modify HTML/JS on the way to the user. | **Partially.** Users at risk should save the page once and run it locally, or clone the repository. Subresource integrity is not possible for a page's own inline CSP, so the recommendation is: don't trust the hosted copy if your life depends on it; use the local copy. |
| **Malware on the user's device**, a malicious browser extension, screen capture. | Full control of the endpoint. | **No.** Out of scope for any web page. |
| **Correlation by content**: the source is identified from what the document says, its wording, fonts, layout, printer tracking dots, scanner noise patterns. | Document analysis. | **No**, and Blackout says so in the UI and README. Grayscale export and JPEG recompression reduce (not eliminate) printer dots and scanner fingerprints; they are offered as mitigations, not guarantees. |
| **Shoulder surfing / seizure during use.** | Physical. | **Partially.** Nothing is stored; closing the tab destroys all state. The page holds no history. |

## Design decisions that follow

- **Pixels, not objects.** Redaction by editing the PDF object tree is fragile (incremental updates, form XObjects, optional content, hidden annotations, text in unusual encodings). Rendering to a bitmap and rebuilding is slower and larger, but it fails safe.
- **Own PDF writer.** The output writer is ~40 lines and emits a fixed structure. A full PDF library would reintroduce the risk of copying something from the input.
- **CSP before code.** The privacy property must not depend on the correctness of application code.
- **No storage.** No localStorage, IndexedDB, cookies, service worker or cache. A user who closes the tab leaves nothing behind.
- **Suggestions are conservative and never silent.** Automatic detection adds boxes the user can see and must export themselves. We would rather miss a phone number (and say loudly that detection is incomplete) than let someone believe a document is clean.
- **Noise fill option.** A solid black box reveals the exact extent of the redaction; noise with cryptographic randomness leaks the same geometry but cannot be mistaken for a rendering artefact and cannot be "enhanced".
- **Plain language, many languages.** The guarantees are stated on the start screen, in the user's language, because a safety tool whose properties the user cannot understand is not a safety tool.

## Known gaps and roadmap

- No OCR for scans – an offline OCR (e.g. Tesseract compiled to WebAssembly) would allow suggestions on scanned documents; it must run under the same CSP.
- No detection of printer tracking dots (yellow dot patterns); a detector/eraser would be valuable for printed leaks.
- No "redact by search term" yet (type a name, redact all occurrences on all pages).
- No support for office formats (DOCX, ODT) – convert to PDF first.
- Mobile UI is usable but not optimised for small screens.
- No independent security audit has been performed. Funding for one is being sought.
