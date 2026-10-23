# PeelScout

Thunderbird add-on that removes email-security URL wrappers (every known layer) right in the message when you open it, previews image attachments, shows nested `.eml` content (and QR URLs), lists phone numbers found in that nested mail, and lists URLs hidden in calendar invites (`.ics`).

A normal click opens the destination URL in your browser. The stored `.eml` is not changed. PeelScout does not need internet to run (the optional domain-age lookup — RDAP, then whois.com — is the only network use, and it is off by default).

Not in this version: QR inside PDF attachments, OCR of images (an image-only lure is flagged, not read), Outlook `.msg` attachments. Translator is not included.

## Install in Thunderbird

**Use the Release.** Do not download the source ZIP.

1. Open https://github.com/Verttungas/PhishScoutSentinel/releases/latest
2. Download **PeelScout.xpi** (under Assets — not “Source code”)
3. Thunderbird → Settings → Add-ons and Themes → gear → **Install Add-on From File…**
4. Choose `PeelScout.xpi` → Add
5. Restart Thunderbird and confirm PeelScout is still listed and enabled

Release builds are not signed yet. If Thunderbird says the add-on could not be verified, sign that same `.xpi` once at https://addons.thunderbird.net/developers/ (submit as **unlisted**), then Install From File with the signed file.

### Temporary test only

Debug Add-ons → **Load Temporary Add-on…** → `manifest.json` from a source checkout. Unloads when Thunderbird restarts.

Requires Thunderbird 128+.

## 1.9.0

- New: reports forwarded **in the body** to a reporting mailbox (`phishing@`, `abuse@`, `protection-phishing@`…) are split into the report and the **Forwarded original**, rebuilt from the Outlook / Gmail / Apple header block (EN, FR, ES, PT, DE, IT, NL) with only its own links; the sidebar opens on the original. Nothing in the report wrapper is offered as a candidate. A narrative report with no forwarded email (a call, an SMS, a customer's report) points to FIR → Internal Communication; payment instructions forwarded without headers point to FIR → Missing Headers
- New: **PDF attachments are read statically** (`pdfscan.js`): text (including Chrome/Skia "Save as PDF" lures through their ToUnicode maps), link targets, JavaScript / launch / embedded-file features, headless-browser producer. RC4-encrypted PDFs are opened when the email itself gives the password (e.g. "your email address is the password"); AES ones are reported as encrypted. The lure link and the file (with SHA-256) become candidates; callback numbers inside the PDF count for Vishing
- New: a message with no text of its own and a large image/PDF is flagged ("the content is in the attachment"); freemail + empty body + one randomly named image/PDF is flagged as the callback-scam pattern
- New: external-mail banners and legal footers are ignored for word counts, language and phrases
- New: obfuscation signals — Unicode math letters (𝗕𝗼𝗹𝗱), accents scattered over every word, words mixing Latin with Cyrillic/Greek lookalikes; phrase rules see the folded text
- New: redirect hops after the security wrappers are followed (`?url=`, `?redirect=`, `?liga=`, affiliate `aff_c`, paths carrying a URL) and flagged with the declared destination; Google redirects that hide their destination, email addresses in base64 inside URLs and misspelt WordPress folders are flagged
- Fix: phone numbers become Vishing candidates only next to a call to action, not in signatures or in a quoted old thread
- Fix: RFC 2231 attachment names (`filename*0=`) in attached messages
- Added: `scripts/eval-samples.js` to measure the engine against a local folder of classified `.eml` samples

## 1.8.0

- New: sidebar on the right holds all of PeelScout's output; the email is no longer modified by banners. Overview with evidence meters, Evidence / Indicators / Previews tabs, light and dark appearance, keyboard navigation and one-click copy
- New: popup shows each unwrapping step and copies the destination
- New: Insights panel (English) — hints per possible route from the classification guide (BEC, RECON, 419, Vishing, Job, Tech Support, O365, Phishing, Docuphish, FIR), with the evidence for each, a Verify list, catalogue candidates and Copy summary in the analyst template. It never classifies
- New: offline ports of Sublime Security rules, lists and IOCs (MIT)
- New: phrase rules in 7 languages, language detection; optional domain-age lookup (RDAP, then whois.com)
- New: links are unwrapped through every known layer, not just the first; wrapped link text is replaced by the destination
- New: image-attachment gallery with a full-window preview; nested-mail images open in the same preview
- Fix: links in the message can no longer fake the "original wrapper" (peel state is kept privately, not in `data-*` attributes)
- Fix: right-click menu works on links inside nested messages and always acts on the clicked link
- Fix: "Copy original wrapped URL" from the menu copies reliably (needs the new `clipboardWrite` permission)
- Fix: nested-mail body was blank (Thunderbird does not paint `srcdoc` iframes); it now renders in a shadow root
- Fix: nested-mail HTML cannot load remote content (sanitizer + Thunderbird's remote-content block); QR scan no longer fetches remote images
- Fix: Copy buttons in panels work (copies go through the background page)
- Inline nested images are no longer shown twice
- Fix: results from a previous message are not shown after switching messages quickly
- Fix: nested `.eml` inside a nested `.eml` is shown once, MIME preamble is no longer shown as the body
- Fix: non-UTF-8 charsets (windows-1252, ISO-8859-x…) and split RFC 2047 subjects decode correctly
- Fix: Proofpoint v3 URLs with accents/ñ decode correctly
- Fix: QR links are really listed raw (not peeled); no duplicate QR banner
- Fewer false phone numbers (timestamps, reference IDs, dates)
- Removed: phone OCR on images (`ocrad.js` was never bundled, so it never ran); `.msg` files are no longer parsed as `.eml`
- Added: `npm test` (Node's built-in test runner)

## 1.7.3

- Nested photos stay medium in the message list
- Click-to-zoom fills most of the window so the receipt text is readable

## What it does

- Peels every known wrapper/redirect layer (e.g. Safe Links → Google redirect → Proofpoint) on every link, in place; a link whose text is the wrapped URL now shows the destination
- Keeps inner `%2` / `%25` encoding so nested redirects still work
- Right-click a peeled link: show original wrapper, copy it, or keep unwrapping
- If the message contains another `.eml` (`message/rfc822`), the inner subject, body, and images are shown automatically
- Image-only nested mail skips the empty body box and shows the photo large enough to read
- Image attachments (PNG, JPEG, GIF, WebP, BMP, AVIF, SVG, ICO) appear as thumbnails at the top; click one for a full-window preview (← / → to move, click the image for actual size, Esc to close). QR codes in them are listed too
- QR codes in that inner (and outer) HTML are decoded; the URL is listed **raw** (not peeled)
- Phone numbers in nested-EML HTML/text are listed to copy
- If the message has `invite.ics` / `text/calendar`, a banner lists those URLs (AWS/S3 rows highlighted)

## Sidebar

Everything PeelScout shows sits in a panel on the right of the message, in its own shadow DOM: the email itself is not modified (only link unwrapping touches it; it gets narrower while the panel is open). It follows Thunderbird's light or dark appearance.

- **Overview** at the top: the routes the evidence points to, each with an evidence meter (filled dot = strong insight, half dot = weak), Copy summary, the detected language and the number of Sublime rules matched. When an original is attached, a switch chooses between the attached email (shown first) and the opened message
- **Evidence** tab: insights per route, Sublime rules, technical signals, QR codes and the domains to verify
- **Indicators** tab: candidates to mark, flagged and action links (with the wrappers removed), addresses, phone numbers, attachments, calendar-invite links and decoded QR codes. Every value copies with one click
- **Previews** tab: image attachments (full-size viewer) and attached emails
- Keyboard: arrow keys move between tabs, Esc closes dialogs and the image viewer, the resize handle takes arrow keys too. Drag the left edge to resize, `›` folds the panel to a thin rail (the email gets its full width back). Width, folded state and last tab are remembered

## Insights

Shown for the opened mail and for each attached `.eml` (the attached original opens first; the report wrapper is folded with a reminder that the reporting channel does not decide the classification). All text is in English.

- Hints are grouped by route with their evidence and a strength of *strong* / *weak* — never a percentage or a verdict
- Header checks: freemail sender, Reply-To to another domain, executive title with freemail, brand lookalike domains, display name with another address, SPF/DKIM/DMARC failures, `Re:` without thread headers, missing Received/Authentication-Results
- Link checks (after unwrapping): text showing one domain while the link goes to another, IP hosts, punycode, `.dev`, shorteners, free hosting, suspicious TLDs, lookalike domains, credential lures pointing outside Microsoft/Google; click-tracking redirectors whose declared destination matches the text are noted as tracking, not as a mismatch
- Content: phrase lists per route in English, Spanish, French, Portuguese, German, Italian and Dutch (from the guide and SEA Training), hidden CSS text, dating lures (Carlos's 30/09 rule), mentioned-but-missing attachments, callback numbers next to invoice lures. The detected language is shown; other languages and scripts (Cyrillic, CJK, Arabic…) are flagged for translation instead of being classified
- **Sublime Security rules**: offline ports of Sublime's open-source detection rules (see below) with severity, evidence, a link to the rule and the route it points to
- **Verify** lists domains whose age matters and URLs to open in the VM, each with a whois.com link. Optional: tick *Look up domain age* in the PeelScout popup (asks for the host permission) and the panel fills in the creation date — RDAP first, then whois.com for TLDs without RDAP (e.g. `.mx`, `.com.co`). Only the bare domain is sent; when whois.com answers with a captcha the panel says so and links to it
- **Candidates to mark** applies the sender exception; **Copy summary** copies the response template (Suggested classification / Summary / Rationale / Mark as malicious / Review in VM) filled with what was observed

Lists and phrases live in `rules.js`; the engine is `signals.js` (tested with the guide's precedents in `test/signals.test.js`).

## Sublime Security rules and lists

`sublime-data.js` holds data from Sublime Security's open-source repositories ([sublime-rules](https://github.com/sublime-security/sublime-rules), [static-files](https://github.com/sublime-security/static-files)), both MIT licensed — see `LICENSE-SUBLIME`:

- Lists: free-email and disposable providers, URL shorteners, free file / subdomain hosts, site builders, suspicious TLDs, suspicious subjects, high-trust sender domains
- Observed IOCs (hashed sender emails and root domains, matched by SHA-256 locally), bulletproof-host networks matched against `Received` IPs, and hosts of known open redirects
- `sublime-rules.js` ports by hand the rules that need nothing beyond headers, body, links and those lists (punycode sender, Telegraph links, zero-width stuffing, userinfo padding, romance scam, fake RFP references…). Rules that rely on Sublime's ML, link crawling or sender history are not included; where a port has to approximate a condition, the code says so

Nothing is sent to Sublime (the guide does not allow uploading EMLs to the public analyzer without authorisation). Refresh the data with:

```bash
python3 scripts/sync_sublime.py
```

## Vendors

Decoded offline when the destination is in the URL:

- Microsoft Defender Safe Links
- Proofpoint URL Defense v1 / v2 / v3
- Barracuda Link Protect
- Symantec Click-time
- Egress Defend (`Base64Url`)
- Sophos, Cisco, Trend Micro, Libraesva, FortiMail, Hornetsecurity, TitanHQ, Intermedia/VIPRE when the target is in a query parameter

Token-only wrappers (Mimecast `protect-*`, some Sophos/VIPRE) stay as-is.

## Development

```bash
npm test
```

Runs the unit tests for the unwrap, nested-EML, ICS, phone, forward and PDF parsers and the insights engine with Node's built-in runner (no dependencies). Leave `test/`, `scripts/` and `package.json` out when zipping the `.xpi`.

To measure the engine against classified samples (folder names give the expected result, e.g. `Malicious/Link/O365`, `FIR`, `NTD`):

```bash
node scripts/eval-samples.js "/path/to/EML Samples" --json results.json
```

Keep the samples outside the repository: they are real customer mail.
