/**
 * Phone numbers from nested-EML text and inner images (OCRAD if loaded).
 */
(function (root) {
  "use strict";

  function extractPhones(text) {
    var s = String(text || "").replace(/\u00a0/g, " ");
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
      if (/^20(1[6-9]|2[0-9])/.test(digits) && digits.length === 8) continue;
      if (seen[digits]) continue;
      seen[digits] = true;
      out.push(raw.replace(/\s+/g, " "));
    }
    return out;
  }

  root.PeelPhones = { extractPhones: extractPhones };
})(typeof globalThis !== 'undefined' ? globalThis : this);
