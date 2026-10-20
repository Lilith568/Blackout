# Blackout

**Redact documents. Offline. Permanently.**

Blackout is a single web page that lets journalists, human rights defenders, lawyers and ordinary people black out sensitive parts of a PDF or image *before* they share it – without the document ever leaving their computer.

- **No upload, ever.** The page ships with a Content-Security-Policy of `connect-src 'none'`. The browser itself refuses every network request from the page, even if a bug or a malicious dependency tried to make one. Open the developer tools and watch: zero requests.
- **Permanent.** Most "redaction" tools draw a black rectangle on top of text that is still in the file. Blackout renders every page to pixels, paints over the pixels, and writes a brand-new PDF that contains nothing but those pixels. There is no text layer, no hidden layer, no annotation, no revision history to recover.
- **Metadata-free.** Author, producer software, creation date, document IDs, XMP packets, EXIF, GPS coordinates: Blackout shows you what the original contained and writes none of it into the output.
- **Air-gap ready.** Save the page (`Ctrl+S`, "Web page, complete") and run it from a USB stick on a machine that has never seen the internet.
- **Small and auditable.** One HTML file, one CSS file, two JavaScript files you can read in an afternoon, plus [pdf.js](https://github.com/mozilla/pdf.js) from Mozilla for rendering. No build step, no framework, no telemetry, no accounts.

[Try it](https://lilith568.github.io/blackout/) · [Threat model](THREAT_MODEL.md) · [Contributing](CONTRIBUTING.md)

## Who is this for

People who need to pass on a document that contains more than the recipient should see:

- a reporter forwarding a leaked memo to a colleague, with the source's name and the letterhead removed;
- an activist publishing a police notice without their home address;
- someone in a country with pervasive surveillance sharing a screenshot of a chat without exposing phone numbers;
- a lawyer sending a contract to a translator;
- a tenant sending a bank statement to a landlord.

The common thread: the person cannot or must not upload the file to a "free online redaction service", and desktop software that phones home is just as unacceptable.

## How to use it

1. Open `index.html` (or the hosted page). Drop a PDF, PNG, JPEG or WebP onto it.
2. Look at the **Metadata** panel – it lists what the original file reveals about you.
3. If the PDF has a text layer, Blackout suggests redactions for IBANs, e-mail addresses, phone numbers, card numbers, links, IP addresses and (optionally) dates, ID-like numbers and capitalised names. Tick what applies and press *Add all selected*. **Always review**: pattern matching is a help, not a guarantee.
4. Draw additional boxes with the mouse or finger. *Remove box* deletes one, *Undo* steps back.
5. Choose fill (black, white or cryptographic noise), resolution and optional grayscale, then *Download redacted PDF* or *Download pages as PNG*.
6. Close the tab. Nothing is stored anywhere.

### Scanned documents

A scan is a picture. There is no text to search, so automatic suggestions will be empty and you mark everything by hand. The output is still permanent and metadata-free.

## What Blackout does **not** do

Being honest about limits is part of the security promise.

- It does not OCR. Suggestions only work when the PDF has a text layer.
- It does not detect everything. Names, addresses and context-specific identifiers must be found by a human.
- It does not remove **printer tracking dots**, **watermarks** or **stylometric fingerprints** in the text itself. If the source could be identified by *what* the document says, redacting *who* sent it is not enough.
- It does not protect against a compromised computer or browser. If your device is already owned, nothing in a web page can save you.
- It does not strip metadata from the *input* file on your disk. Delete the original yourself if you must.

Read [THREAT_MODEL.md](THREAT_MODEL.md) for the full picture.

## Running locally

There is nothing to build.

```sh
git clone https://github.com/lilith568/blackout
cd blackout
python3 -m http.server 8000     # any static server works; needed only because ES modules won't load from file://
```

Then open <http://localhost:8000>. For a truly offline copy, serve it once, save the page with your browser's "Web page, complete", and keep the folder.

## Verifying the offline claim

1. Open the page, open DevTools → Network, tick *Preserve log*.
2. Load a document, redact, export.
3. The only entries are the page's own files loaded at startup. No request carries document data; after the initial load there are no requests at all.
4. Look at the `<meta http-equiv="Content-Security-Policy">` tag in `index.html`: `connect-src 'none'` is enforced by the browser, not by our code.

## Languages

English, German, Spanish, French, Russian, Persian, Arabic, Turkish, Ukrainian, Chinese. The interface picks your browser language; strings live in [`i18n.js`](i18n.js) and translations are the easiest way to contribute.

## Security

If you find a way to make the page leak data or to recover redacted content from its output, please open an issue or contact the maintainer through GitHub. There is no bug bounty – this is an unfunded project – but every report is taken seriously and credited.

## License

Apache-2.0 – see [LICENSE](LICENSE). pdf.js is Apache-2.0, © Mozilla Foundation, in `vendor/pdfjs/`.
