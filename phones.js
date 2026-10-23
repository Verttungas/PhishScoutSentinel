/**
 * Phone numbers from nested-EML text.
 */
(function (root) {
  "use strict";

  function extractPhones(text) {
    var s = String(text || "").replace(/ /g, " ");
    var out = [];
    var seen = Object.create(null);
    var re =
      /(?:\+|00)\d{1,3}[\s./-]*\(?\d{2,4}\)?[\s./-]*\d{2,4}[\s./-]*\d{2,4}(?:[\s./-]*\d{2,4})?|\(?\d{2,4}\)?[\s./-]\d{2,4}[\s./-]\d{3,4}(?:[\s./-]\d{3,4})?|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{2}[\s.-]\d{4}[\s.-]\d{4}\b|\b\d{10,13}\b/g;
    var m;
    while ((m = re.exec(s))) {
      var raw = m[0].trim().replace(/[.]{2,}/g, " ");
      var digits = raw.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) continue;
      if (/^(.)\1+$/.test(digits)) continue;
      // Dates such as 2024-10-23 10:30 or 23/10/2024 1030.
      if (/^(19|20)\d{2}[\s./-]\d{1,2}[\s./-]\d{1,2}\b/.test(raw) || /^\d{1,2}[\s./-]\d{1,2}[\s./-](19|20)\d{2}\b/.test(raw)) continue;
      // Bare digit runs: keep only 10-digit national numbers (no leading 0/1). This drops
      // Unix timestamps (1698000000), millisecond timestamps and long order/reference IDs.
      if (/^\d+$/.test(raw) && (digits.length !== 10 || /^[01]/.test(digits))) continue;
      if (seen[digits]) continue;
      seen[digits] = true;
      out.push(raw.replace(/\s+/g, " "));
    }
    return out;
  }

  root.PeelPhones = { extractPhones: extractPhones };
})(typeof globalThis !== "undefined" ? globalThis : this);
