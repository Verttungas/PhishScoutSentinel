# Changelog

## 0.1.0 — SOC foundation pilot

- Separate Thunderbird tab; no message content script, automatic link rewriting,
  external resource loading or navigation to evidence URLs.
- Open EML locally or request the displayed message through messagesRead only.
- PostalMime parser in a cancelable worker with time, size and nesting budgets.
- Explicit target selection, parentage, headers, Reply-To, exact body/source and
  SHA-256 per message and attachment. Coverage warnings replace silent omissions.
- Correct hostname checks, bounded unwrap chains, exact calendar URL tokens and
  zlib expansion/corruption checks.
- Local inventory, per-target analyst drafts, taxonomy validation, corroboration
  field required for Simulation, Markdown clipboard report and JSON export.
- No automatic classifier, WHOIS/RDAP, simulation domain catalog, OCR, QR or PDF
  content inspection in this pilot; the interface explicitly reports these gaps.
- Automated foundation regression tests and deterministic XPI packaging.
