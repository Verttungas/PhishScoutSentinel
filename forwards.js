/**
 * Inline forwards: splits a body at the header blocks mail clients write when a
 * message is forwarded in the body (Outlook "From:/Sent:/To:/Subject:", Gmail
 * "---------- Forwarded message ---------", Apple "Begin forwarded message:") in
 * English, French, Spanish, Portuguese, German, Italian and Dutch.
 *
 * Employees report suspicious mail this way far more often than as an attached .eml,
 * so the original has to be rebuilt from the body: its own sender, subject, text and
 * only the links that sit below its header block. Its real headers are gone.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PeelForwards = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Field labels; a colon may follow a space ("De :" in French Outlook).
  const FIELDS = {
    from: "from|de|von|da|van|od|fr[aå]n",
    date: "sent|date|envoy[eé]|enviado|enviada|gesendet|datum|inviato|verzonden|verstuurd|data|fecha",
    to: "to|[aà]|para|an|aan|destinatario|destinataire|destinat[aá]rio",
    cc: "cc|cco|bcc",
    subject: "subject|objet|asunto|assunto|betreff|oggetto|onderwerp|sujet",
  };
  const LINE = {};
  for (const k of Object.keys(FIELDS)) LINE[k] = new RegExp("^[\\s>*]*(?:" + FIELDS[k] + ")\\s?:\\s*(.*)$", "i");
  const SEPARATOR = /^[\s>]*(?:-{2,}\s*(?:forwarded message|original message|mensaje (?:original|reenviado)|message (?:d'origine|transf[eé]r[eé])|mensagem (?:original|encaminhada)|weitergeleitete nachricht|urspr[uü]ngliche nachricht|messaggio (?:originale|inoltrato)|doorgestuurd bericht|oorspronkelijk bericht)\s*-{2,}|begin forwarded message:?|d[eé]but du message (?:r[eé]exp[eé]di[eé]|transf[eé]r[eé]):?|inicio del mensaje reenviado:?|_{8,}|-{8,})\s*$/i;

  // Header block starting at line i: a From line, then a Subject line within a few
  // lines, with only other header fields (or nothing) in between.
  function headerBlockAt(lines, i) {
    const m = lines[i].match(LINE.from);
    if (!m || !/@|\S/.test(m[1])) return null;
    const fields = { from: m[1].trim() };
    let fieldCount = 1;
    let end = i + 1;
    // Field lines in any order (Outlook: Sent/To/Subject; Gmail: Date/Subject/To; Apple:
    // Subject/Date/To). Before the Subject, blank lines and wrapped To/Cc lists may sit
    // between them; after it, the first line that is not a field starts the body.
    for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
      const line = lines[j];
      if (!line.trim()) {
        if (fields.subject !== undefined) break;
        continue;
      }
      let matched = false;
      for (const k of ["date", "to", "cc", "subject"]) {
        const f = line.match(LINE[k]);
        if (f && fields[k] === undefined) {
          fields[k] = f[1].trim();
          fieldCount++;
          matched = true;
          end = j + 1;
          break;
        }
      }
      if (matched) continue;
      if (fields.subject === undefined && /@/.test(line) && (fields.to !== undefined || fields.cc !== undefined)) continue;
      break;
    }
    if (fields.subject === undefined || fieldCount < 3) return null;
    return { start: i, end, fields };
  }

  // Header blocks of a plain text, with character offsets.
  function findBlocks(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const offsets = [];
    let pos = 0;
    for (const l of lines) {
      offsets.push(pos);
      pos += l.length + 1;
    }
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      const b = headerBlockAt(lines, i);
      if (!b) continue;
      // A separator line right above belongs to the block.
      let s = b.start;
      while (s > 0 && (SEPARATOR.test(lines[s - 1]) || !lines[s - 1].trim()) && s > b.start - 3) s--;
      if (!SEPARATOR.test(lines[s] || "")) s = b.start;
      blocks.push({ start: offsets[s], bodyStart: b.end < lines.length ? offsets[b.end] : pos, fields: b.fields });
      i = b.end - 1;
    }
    return blocks;
  }

  // Tag-stripped HTML with a map from each text character back to the HTML offset,
  // so a block found in the text can cut the HTML at the same place.
  const BLOCK_TAGS = /^(br|p|div|tr|li|h[1-6]|table|blockquote|hr|section|article|header|footer)$/i;
  const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#160": " " };
  function htmlTextMap(html) {
    const s = String(html || "");
    let text = "";
    const map = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "<") {
        const skip = s.slice(i).match(/^<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/i);
        if (skip) {
          i += skip[0].length;
          continue;
        }
        const end = s.indexOf(">", i);
        if (end < 0) break;
        const name = (s.slice(i + 1, end).match(/^\/?\s*([a-z0-9]+)/i) || [])[1] || "";
        if (BLOCK_TAGS.test(name)) {
          text += "\n";
          map.push(i);
        }
        i = end + 1;
        continue;
      }
      if (c === "&") {
        const m = s.slice(i, i + 10).match(/^&(#?[a-z0-9]+);/i);
        if (m) {
          const k = m[1].toLowerCase();
          let ch = ENTITIES[k];
          if (ch === undefined && /^#\d+$/.test(k)) ch = String.fromCharCode(+k.slice(1));
          if (ch === undefined && /^#x[0-9a-f]+$/.test(k)) ch = String.fromCharCode(parseInt(k.slice(2), 16));
          if (ch !== undefined) {
            text += ch;
            map.push(i);
            i += m[0].length;
            continue;
          }
        }
      }
      text += c === "\r" ? "" : c;
      if (c !== "\r") map.push(i);
      i++;
    }
    map.push(s.length);
    return { text, map };
  }

  function addressOf(field) {
    const m = String(field || "").match(/[^\s<>"'(),;:\[\]]+@[^\s<>"'(),;:\[\]]+/);
    return m ? m[0].replace(/^mailto:/i, "") : "";
  }

  // Outlook writes "Name <a@b.c<mailto:a@b.c>>" in plain text; keep "Name <a@b.c>".
  function cleanField(v) {
    return String(v || "").replace(/<mailto:[^>]*>/gi, "").replace(/\s+/g, " ").trim();
  }

  /**
   * Split a body into the forwarding text and the forwarded messages, outermost first.
   * Returns null when the body has no header block.
   * { wrapper: {text, html}, messages: [{headers: {from, date, to, cc, subject}, text, html}] }
   */
  function split(text, html) {
    const plain = String(text || "").replace(/\r\n?/g, "\n");
    const tBlocks = plain ? findBlocks(plain) : [];
    const hm = html ? htmlTextMap(html) : null;
    const hBlocks = hm ? findBlocks(hm.text) : [];
    const count = Math.max(tBlocks.length, hBlocks.length);
    if (!count) return null;
    function piece(blocks, src, k, mapper) {
      // The k-th message counted from the innermost one.
      const idx = blocks.length - 1 - k;
      if (idx < 0) return { text: "", fields: null };
      const b = blocks[idx];
      const next = blocks[idx + 1];
      const from = mapper ? mapper(b.bodyStart) : b.bodyStart;
      const to = next ? (mapper ? mapper(next.start) : next.start) : src.length;
      return { body: src.slice(from, to), fields: b.fields };
    }
    const mapHtml = hm ? function (pos) { return hm.map[Math.min(pos, hm.map.length - 1)]; } : null;
    const messages = [];
    for (let k = count - 1; k >= 0; k--) {
      const t = piece(tBlocks, plain, k);
      const h = hm ? piece(hBlocks, html, k, mapHtml) : { body: "", fields: null };
      const f = t.fields || h.fields || {};
      messages.push({
        headers: {
          from: cleanField(f.from),
          date: cleanField(f.date),
          to: cleanField(f.to),
          cc: cleanField(f.cc),
          subject: cleanField(f.subject),
        },
        fromAddress: addressOf(f.from),
        text: t.body || "",
        html: h.body || "",
      });
    }
    const wrapperText = tBlocks.length ? plain.slice(0, tBlocks[0].start) : hm ? hm.text.slice(0, hBlocks[0].start) : "";
    const wrapperHtml = hm && hBlocks.length ? html.slice(0, mapHtml(hBlocks[0].start)) : "";
    return { wrapper: { text: wrapperText, html: wrapperHtml }, messages };
  }

  // Mailboxes that collect reports (phishing@, abuse@, protection-phishing@…).
  const REPORT_MAILBOX = /^(?:[a-z0-9._-]*[._-])?(?:phish(?:ing)?|abuse|spam|report(?:[._-]?phish(?:ing)?)?|suspicious|security|infosec|soc|cert|csirt|fraud|protection(?:[._-]phishing)?)(?:[._-][a-z0-9._-]*)?@/i;
  function isReportMailbox(address) {
    return REPORT_MAILBOX.test(String(address || "").trim());
  }

  return { split, findBlocks, htmlTextMap, isReportMailbox, addressOf };
});
