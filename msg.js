/**
 * Outlook .msg reader (Compound File Binary + MAPI properties), including files that
 * arrive damaged by a text line-ending conversion: a .msg saved or relayed as text gets
 * a CR/LF prepended and every lone CR or LF byte turned into CR LF, which shifts every
 * sector of the binary. That damage is undone here: the original size must be a whole
 * number of sectors, which tells how many CR LF pairs were genuine; anchors inside the
 * file (directory, FAT, stream starts) place them; structure fields where a byte could
 * have been CR or LF are settled by consistency (FAT chains, the directory tree).
 *
 * Returns the message in the shape nested.js gives (subject, from, headers, text, html,
 * images, attachments, files for PDFs, nested for embedded messages), so it is analysed
 * and previewed like any attached email. Nothing is executed.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./repair.js"));
  else root.PeelMsg = factory(root.PeelRepair);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Repair) {
  "use strict";

  const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  // Signatures of files an attachment may hold: PDF, PNG, JPEG, GIF, ZIP (Office).
  const SIGS = [[0x25, 0x50, 0x44, 0x46], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38], [0x50, 0x4b, 0x03, 0x04]];
  const FREE = 0xffffffff, END = 0xfffffffe, FATSECT = 0xfffffffd, DIFSECT = 0xfffffffc, NOSTREAM = 0xffffffff;
  const MAX_BYTES = 30 * 1024 * 1024;

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data && data.byteLength !== undefined) return new Uint8Array(data);
    const s = String(data || "");
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  // Offset of the CFB signature when it sits at the start, after at most a few bytes of
  // stray whitespace (the CR LF a text conversion prepends); -1 otherwise.
  function signatureAt(b) {
    for (let off = 0; off <= 8 && off + 8 <= b.length; off++) {
      if (SIG.every(function (v, i) { return b[off + i] === v; })) return off;
      if (b[off] !== 0x0d && b[off] !== 0x0a && b[off] !== 0x20 && b[off] !== 0x09) return -1;
    }
    return -1;
  }
  function isMsg(data) {
    return signatureAt(toBytes(data)) >= 0;
  }

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  function put32(b, o, v) {
    b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
  }

  // --- Line-ending damage ------------------------------------------------------------
  // Damaged: no lone CR or LF byte anywhere (a binary always has some), but CR LF pairs.
  function lineEndingDamage(d) {
    let crlf = 0, lone = 0;
    for (let i = 0; i < d.length; i++) {
      if (d[i] === 0x0d) {
        if (d[i + 1] === 0x0a) { crlf++; i++; } else lone++;
      } else if (d[i] === 0x0a) lone++;
    }
    return { damaged: lone === 0 && crlf >= 4, crlf };
  }

  /**
   * Undo the CR/LF normalisation. Each CR LF of the damaged data was either a genuine CR LF
   * pair (two bytes) or a lone CR or LF (one byte). Returns {bytes, ambiguous, pairStarts}:
   * ambiguous holds the offsets of the lone bytes (written as LF, maybe a CR), pairStarts
   * those of the pairs placed.
   *
   * The original length is whole sectors (the header takes one), between the length with
   * every CR LF lone and the damaged length. With as many genuine pairs as a sector has
   * bytes, more than one length fits; the one whose FAT ends at its last sector is it.
   */
  function undamage(d) {
    const ss = 1 << u16(d, 30);
    if (ss !== 512 && ss !== 4096) return null;
    const crlf = [];
    for (let i = 0; i + 1 < d.length; i++) if (d[i] === 0x0d && d[i + 1] === 0x0a) { crlf.push(i); i++; }
    const minLen = d.length - crlf.length;
    const base = Math.ceil(minLen / ss) * ss;
    if (base > d.length) return undamageAt(d, crlf, minLen); // a last sector written short
    let first = null;
    for (let total = base; total <= d.length && total <= base + 64 * ss; total += ss) {
      const r = undamageAt(d, crlf, total);
      if (r && r.fits) return r;
      first = first || r;
    }
    return first;
  }

  function undamageAt(d, crlf, total) {
    const ss = 1 << u16(d, 30);
    const pairs = crlf.length - (d.length - total);
    if (pairs < 0) return null;
    let fits = crlf.length < ss;

    // crlfBefore(pos): CR LF starting before pos. orig(pos, p): original offset of damaged
    // offset pos when p of the earlier CR LF were genuine pairs.
    function crlfBefore(pos) {
      let lo = 0, hi = crlf.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (crlf[m] < pos) lo = m + 1; else hi = m; }
      return lo;
    }
    // Damaged offset whose original offset is o, given p pairs before it.
    function damagedAt(o, p) {
      let lo = 0, hi = d.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (m - crlfBefore(m) + p < o) lo = m + 1; else hi = m;
      }
      return lo;
    }

    const anchors = [{ o: 0, p: 0 }, { o: total, p: pairs }];
    // Structure fields settled here (a CR or an LF), written into the rebuilt file, and
    // CR LF known to be genuine pairs (inside a FAT).
    const fixes = [];
    const forced = new Set();
    // PDFs whose lines end in one byte (their xref entries say so): there, a CR LF pair is
    // in stream data, not at the end of a text line.
    const loneEolPdfs = [];
    if (pairs > 0 || !fits) {
      const sector = (k) => (k + 1) * ss;
      // Pair counts p (within what the anchors so far allow) for which the original
      // offset o passes a test.
      const bounds = (o, within) => {
        let lo = 0, hi = pairs;
        for (const a of within || anchors) {
          if (a.o <= o) lo = Math.max(lo, a.p);
          if (a.o >= o) hi = Math.min(hi, a.p);
        }
        return [lo, hi];
      };
      const at = (o, test, within) => {
        const found = [];
        const [lo, hi] = bounds(o, within);
        for (let p = lo; p <= hi; p++) {
          const pos = damagedAt(o, p);
          if (pos < d.length && test(pos, p)) found.push(p);
        }
        return found;
      };
      const anchor = (o, test) => {
        const ps = at(o, test);
        if (ps.length === 1) anchors.push({ o, p: ps[0] });
        return ps.length === 1 ? ps[0] : null;
      };
      // Bytes from damaged position pos on, each CR LF read as one LF (no pair inside),
      // with the indexes of those rebuilt bytes.
      const plainAt = (pos, n) => {
        const out = new Uint8Array(n);
        const amb = new Set();
        for (let k = 0; k < n && pos < d.length; k++, pos++) {
          if (d[pos] === 0x0d && d[pos + 1] === 0x0a) {
            out[k] = 0x0a;
            amb.add(k);
            pos++;
          } else out[k] = d[pos];
        }
        return { out, amb };
      };
      const nSect = total / ss - 1;
      const head = plainAt(0, 512);
      // The directory's first sector starts with the root entry.
      const ROOT = [0x52, 0, 0x6f, 0, 0x6f, 0, 0x74, 0, 0x20, 0, 0x45, 0, 0x6e, 0, 0x74, 0, 0x72, 0, 0x79, 0];
      let dirStart = null;
      for (const ds of fieldValues(head.out, 48, head.amb)) {
        if (ds < nSect && anchor(sector(ds), (pos) => ROOT.every((v, i) => d[pos + i] === v)) !== null) {
          dirStart = ds;
          fixes.push({ o: 48, v: ds });
          break;
        }
      }
      // Entries of a table of sector numbers (FAT), from damaged position pos: a CR LF in
      // an entry was one byte (CR or LF) or a genuine pair (2573 is 0D 0A 00 00). Each
      // entry is read the way that continues its chain (entry i holds i + 1), else as a
      // valid number, lone bytes first. Returns the values, the pairs this takes, how many
      // entries continue their chain, and whether every entry is valid.
      const readTable = (pos, n, first, limit, expect) => {
        const values = [], pairsAt = [];
        let next = 0, ok = true;
        for (let e = 0; e < n; e++) {
          const idx = expect ? expect(values) - 1 : first + e;
          let best = null;
          const walk = (q, bytes, used) => {
            if (bytes.length >= 4) {
              const v = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
              const valid = v < limit || v >= 0xfffffffc;
              const rank = v === idx + 1 ? 3 : valid && !used.length ? 2 : valid ? 1 : 0;
              if (bytes.length === 4 && (!best || rank > best.rank)) best = { v, end: q, used, rank };
              return;
            }
            if (q + 1 < d.length && d[q] === 0x0d && d[q + 1] === 0x0a) {
              walk(q + 2, bytes.concat([0x0a]), used);
              walk(q + 2, bytes.concat([0x0d]), used);
              walk(q + 2, bytes.concat([0x0d, 0x0a]), used.concat([q]));
            } else if (q < d.length) walk(q + 1, bytes.concat([d[q]]), used);
          };
          walk(pos, [], []);
          if (!best || !best.rank) return { ok: false };
          if (best.rank === 3) next++;
          values.push(best.v);
          for (const u of best.used) pairsAt.push(u);
          pos = best.end;
        }
        return { values, pairsAt, next, ok };
      };
      // FAT sectors (listed in the header): every entry a sector number or a chain mark,
      // and the entry of a FAT sector marks it as one. Every shift by whole entries looks
      // valid; at the right one, chains run on to the next sector most often.
      const fat = [];
      const per = ss / 4;
      // FAT sector numbers: 109 in the header, the rest in DIFAT sectors (a chain of lists
      // of FAT sectors, each usually one more than the last).
      const fatSects = [];
      for (let k = 0; k < 109; k++) fatSects.push({ cands: fieldValues(head.out, 76 + k * 4, head.amb).filter((v) => v < nSect), o: 76 + k * 4 });
      let dif = fieldValues(head.out, 68, head.amb).find((v) => v < nSect);
      for (let n = u32(head.out, 72); n > 0 && dif !== undefined; n--) {
        const following = (vals) => (vals.length ? vals[vals.length - 1] + 1 : -1);
        const score = new Map();
        at(sector(dif), (pos, q) => {
          const t = readTable(pos, per, 0, nSect, following);
          if (t.ok) score.set(q, t.next);
          return t.ok;
        });
        const ranked = Array.from(score).sort((x, y) => y[1] - x[1]);
        if (!ranked.length || !ranked[0][1] || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) break;
        const q = ranked[0][0];
        const lists = readTable(damagedAt(sector(dif), q), per, 0, nSect, following);
        anchors.push({ o: sector(dif), p: q }, { o: sector(dif) + ss, p: q + lists.pairsAt.length });
        for (const x of lists.pairsAt) forced.add(x);
        lists.values.forEach((v, i) => fixes.push({ o: sector(dif) + i * 4, v }));
        for (let i = 0; i < per - 1; i++) fatSects.push({ cands: lists.values[i] < nSect ? [lists.values[i]] : [] });
        dif = lists.values[per - 1] < nSect ? lists.values[per - 1] : undefined;
      }
      for (let k = 0; k < fatSects.length; k++) {
        const cands = fatSects[k].cands;
        if (!cands.length) break;
        // The sector (a CR or an LF in its number) and shift whose entries continue their
        // chains most often.
        let best = null;
        for (const fs of cands) {
          const self = fs >= k * per && fs < (k + 1) * per ? fs - k * per : -1;
          const score = new Map();
          at(sector(fs), (pos, q) => {
            const t = readTable(pos, per, k * per, nSect);
            if (!t.ok || (self >= 0 && t.values[self] !== FATSECT)) return false;
            score.set(q, t.next);
            return true;
          });
          const ranked = Array.from(score).sort((x, y) => y[1] - x[1]);
          if (!ranked.length || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) continue;
          if (!best || ranked[0][1] > best.next) best = { fs, p: ranked[0][0], next: ranked[0][1] };
        }
        if (!best) break;
        const { fs, p } = best;
        const read = readTable(damagedAt(sector(fs), p), per, k * per, nSect);
        anchors.push({ o: sector(fs), p }, { o: sector(fs) + ss, p: p + read.pairsAt.length });
        for (const q of read.pairsAt) forced.add(q);
        if (fatSects[k].o) fixes.push({ o: fatSects[k].o, v: fs });
        for (const v of read.values) fat.push(v);
      }
      if (dirStart !== null && fat.length) {
        let last = fat.length - 1;
        while (last >= 0 && fat[last] === 0xffffffff) last--;
        if (last === nSect - 1) fits = true;
      }
      const chainOf = (start) => {
        const out = [];
        for (let c = start; c < nSect && c < fat.length && out.length < nSect && !out.includes(c); c = fat[c]) out.push(c);
        return out;
      };
      // Directory entries, from every directory sector.
      const entries = [];
      if (dirStart !== null) {
        chainOf(dirStart).forEach((ds, k) => {
          let p = k === 0 ? anchors.find((a) => a.o === sector(ds)).p : anchor(sector(ds), (pos) => {
            const e = plainAt(pos, 128).out;
            const len = u16(e, 64);
            return len <= 64 && len % 2 === 0 && [0, 1, 2, 5].includes(e[66]) && (len === 0 || (e[1] === 0 && e[0] >= 0x20));
          });
          if (p === null) return;
          for (let e = 0; e < ss / 128; e++) {
            const { out, amb } = plainAt(damagedAt(sector(ds) + e * 128, p), 128);
            const len = u16(out, 64);
            let name = "";
            for (let i = 0; i + 1 < len - 1 && i < 64; i += 2) name += String.fromCharCode(u16(out, i));
            entries.push({ name, type: out[66], starts: fieldValues(out, 116, amb), sizes: fieldValues(out, 120, amb) });
          }
        });
      }
      // Each stream's first bytes, where they tell what the stream is. Streams under the
      // cutoff sit in the mini stream (the root entry's chain), at 64-byte steps.
      const cutoff = u32(head.out, 56) || 4096;
      // Content tests are bounded by the structure (header, directory, FAT) only.
      const structural = anchors.slice();
      const root = entries[0] && entries[0].type === 5 ? entries[0] : null;
      const isText = (b) => (b >= 0x20 && b < 0x7f) || b === 0x09 || b >= 0xa0;
      // Original offset of byte `off` of a stream: through its sector chain, or for a
      // small stream through the mini stream's chain (its 64-byte blocks taken in order).
      const offsetIn = (sects, off) => (Math.floor(off / ss) < sects.length ? sector(sects[Math.floor(off / ss)]) + (off % ss) : -1);
      const streamAnchors = (miniChain) => {
        const out = [];
        for (const e of entries) {
          if (e.type !== 2) continue;
          const kind = (e.name.match(/^__substg1\.0_([0-9A-F]{4})([0-9A-F]{4})$/i) || []).slice(1).map((x) => x.toUpperCase());
          let first = null;
          if (kind[1] === "001F") first = (pos) => isText(d[pos]) && d[pos + 1] === 0;
          else if (kind[1] === "001E") first = (pos) => isText(d[pos]) && isText(d[pos + 1]);
          else if (kind[0] === "1013") first = (pos) => d[pos] === 0x3c || (d[pos] === 0xef && d[pos + 1] === 0xbb && d[pos + 2] === 0xbf);
          else if (kind[1] === "0102") first = (pos) => SIGS.some((sig) => sig.every((v, i) => d[pos + i] === v));
          if (!first) continue;
          const found = [];
          for (const size of e.sizes) {
            if (!size) continue;
            for (const st of e.starts) {
              let o, oEnd;
              if (size >= cutoff) {
                // A start sector whose chain is not as long as the size needs is not it.
                const sects = st < nSect ? chainOf(st) : [];
                if (sects.length !== Math.ceil(size / ss)) continue;
                o = sector(st);
                oEnd = size % ss ? offsetIn(sects, size) : -1;
              } else {
                o = offsetIn(miniChain, st * 64);
                oEnd = size % 64 ? offsetIn(miniChain, st * 64 + size) : -1;
              }
              if (o < 0) continue;
              // UTF-16 text shifted by whole characters still starts like text; its end,
              // followed by the zero padding of its last block, does not. (UTF-16 holds
              // no CR LF pair, so its end is as many pairs in as its start.)
              const ends = (q) => kind[1] !== "001F" || oEnd < 0 || (d[damagedAt(oEnd, q)] === 0 && d[damagedAt(oEnd - 2, q)] !== 0);
              for (const p of at(o, (pos, q) => first(pos) && ends(q), structural)) if (!found.some((f) => f.o === o && f.p === p)) found.push({ o, p });
            }
          }
          if (found.length === 1) out.push(found[0]);
        }
        return out;
      };
      // The mini stream's start may itself be a rebuilt byte: the candidate under which
      // most small streams are found is the one.
      let best = [], bestStart = null;
      for (const st of root ? root.starts : []) {
        const found = streamAnchors(st < nSect ? chainOf(st) : []);
        if (bestStart === null || found.length > best.length) {
          best = found;
          bestStart = st;
        }
      }
      for (const a of best) anchors.push(a);
      if (root && root.starts.length > 1) fixes.push({ o: sector(dirStart) + 116, v: bestStart });
      // Files attached to the message, at a sector start: the start of their data carries
      // their signature.
      const pdfs = [];
      for (const sig of SIGS) {
        for (let pos = 0; (pos = indexOf(d, sig, pos)) >= 0; pos++) {
          const o0 = pos - crlfBefore(pos);
          for (let p = 0; p <= pairs; p++) {
            if ((o0 + p) % ss === 0 && damagedAt(o0 + p, p) === pos) {
              anchors.push({ o: o0 + p, p });
              if (sig[0] === 0x25) pdfs.push({ pos, o: o0 + p, p });
            }
          }
        }
      }
      // Inside a PDF, its cross-reference table gives the offset of every object.
      if (pdfs.length) {
        const text = latin1(d);
        pdfs.sort((a, b) => a.pos - b.pos);
        pdfs.forEach((pdf, k) => {
          const end = k + 1 < pdfs.length ? pdfs[k + 1].pos : d.length;
          const region = text.slice(pdf.pos, end);
          const objs = new Map();
          for (const m of region.matchAll(/(\d+) (\d+) obj\b/g)) {
            const key = m[1] + " " + m[2];
            if (!objs.has(key)) objs.set(key, []);
            objs.get(key).push(pdf.pos + m.index);
          }
          const fix = (off, positions) => {
            for (const pos of positions || []) {
              const p = pdf.o + off - (pos - crlfBefore(pos));
              if (p >= pdf.p && p <= pairs) return anchors.push({ o: pdf.o + off, p });
            }
          };
          for (const x of region.matchAll(/xref\s+/g)) {
            const head = /(\d+) (\d+)\s+/y;
            const entry = /(\d{10}) (\d{5}) ([nf])[ \r\n]+/y;
            let at = x.index + x[0].length, h;
            while ((head.lastIndex = at, (h = head.exec(region)))) {
              at = head.lastIndex;
              for (let num = +h[1], left = +h[2]; left > 0; left--, num++) {
                entry.lastIndex = at;
                const e = entry.exec(region);
                if (!e) break;
                at = entry.lastIndex;
                if (e[3] === "n") fix(+e[1], objs.get(num + " " + +e[2]));
              }
            }
          }
          if (/\d{10} \d{5} [nf] \r\n/.test(region)) loneEolPdfs.push([pdf.pos, end]);
          const xrefs = [];
          for (const m of region.matchAll(/(?:^|[\r\n])xref\b/g)) xrefs.push(pdf.pos + m.index + (m[0].length - 4));
          for (const m of region.matchAll(/startxref\s+(\d+)/g)) fix(+m[1], xrefs);
        });
      }
    }
    // Keep the largest set of anchors that agree with each other: p grows with o, by no
    // more than the CR LF between them (a content test can match a neighbouring stream).
    const list = [];
    anchors.sort((a, b) => a.o - b.o || a.p - b.p);
    for (const a of anchors) if (!list.some((x) => x.o === a.o && x.p === a.p)) list.push(a);
    const posOf = list.map((a) => damagedAt(a.o, a.p));
    const score = list.map((a, i) => (i === 0 ? 0 : -Infinity));
    const prev = list.map(() => -1);
    for (let j = 1; j < list.length; j++) {
      for (let i = 0; i < j; i++) {
        const dp = list[j].p - list[i].p;
        if (score[i] === -Infinity || list[i].o === list[j].o || dp < 0 || dp > crlfBefore(posOf[j]) - crlfBefore(posOf[i])) continue;
        if (score[i] + 1 > score[j]) {
          score[j] = score[i] + 1;
          prev[j] = i;
        }
      }
    }
    const kept = [];
    let last = list.findIndex((a) => a.o === total && a.p === pairs);
    if (last < 0 || score[last] === -Infinity) last = list.length - 1;
    for (let j = last; j >= 0; j = prev[j]) kept.unshift(list[j]);
    if (kept[0] !== list[0]) kept.unshift(list[0]);
    // Place the genuine pairs between anchors, by what surrounds each CR LF: a line ending
    // in text sits between printable bytes (first ones first); one in binary data has no
    // telling place (latest first); next to a zero byte it is UTF-16 text or a table of
    // numbers, where a CR LF pair does not occur. Formats with their own checks (PDF
    // streams, JPEG) move them to the right byte afterwards.
    const pairSet = new Set();
    const printable = (c) => (c >= 0x20 && c < 0x7f) || c === 0x09;
    const inLonePdf = (c) => loneEolPdfs.some(([a, b]) => c >= a && c < b);
    const kind = (c) => {
      if (!d[c - 1] || !d[c + 2]) return 0;
      if (!(printable(d[c - 1]) && (printable(d[c + 2]) || d[c + 2] === 0x0d))) return 1;
      return inLonePdf(c) ? 0.5 : 2;
    };
    for (let i = 1; i < kept.length; i++) {
      const need = kept[i].p - kept[i - 1].p;
      if (need <= 0) continue;
      const from = damagedAt(kept[i - 1].o, kept[i - 1].p);
      const to = damagedAt(kept[i].o, kept[i].p);
      const cands = crlf.filter((c) => c >= from && c < to);
      const known = cands.filter((c) => forced.has(c));
      for (const c of known.slice(0, need)) pairSet.add(c);
      const of = (k) => cands.filter((c) => kind(c) === k && !forced.has(c));
      const ranked = of(2).concat(of(1).reverse(), of(0.5).reverse(), of(0).reverse());
      for (const c of ranked.slice(0, Math.max(0, need - known.length))) pairSet.add(c);
    }
    const out = new Uint8Array(total);
    const ambiguous = [];
    const pairStarts = new Set();
    let o = 0;
    for (let i = 0; i < d.length && o < total; i++) {
      if (d[i] === 0x0d && d[i + 1] === 0x0a) {
        if (pairSet.has(i)) {
          pairStarts.add(o);
          out[o++] = 0x0d;
          if (o < total) out[o++] = 0x0a;
        } else {
          ambiguous.push(o);
          out[o++] = 0x0a;
        }
        i++;
        continue;
      }
      out[o++] = d[i];
    }
    const rebuilt = new Set(ambiguous);
    for (const f of fixes) {
      put32(out, f.o, f.v);
      for (let i = 0; i < 4; i++) rebuilt.delete(f.o + i);
    }
    return { bytes: out, ambiguous: rebuilt, pairStarts, pairs, crlf: crlf.length, fits };
  }

  function indexOf(d, sig, from) {
    outer: for (let i = from; i <= d.length - sig.length; i++) {
      for (let j = 0; j < sig.length; j++) if (d[i + j] !== sig[j]) continue outer;
      return i;
    }
    return -1;
  }

  // --- Compound File -----------------------------------------------------------------
  // The 2^k values a 32-bit field can take when k of its bytes may be CR instead of LF.
  function fieldValues(b, o, amb) {
    let vals = [u32(b, o)];
    for (let i = 0; i < 4; i++) {
      if (!amb || !amb.has(o + i)) continue;
      const shift = 8 * i;
      vals = vals.concat(vals.map((v) => ((v & ~(0xff << shift)) | (0x0d << shift)) >>> 0));
    }
    return vals;
  }

  const nameOrder = (x, y) => x.length - y.length || (x.toUpperCase() < y.toUpperCase() ? -1 : x.toUpperCase() > y.toUpperCase() ? 1 : 0);

  function readCfb(b, amb) {
    if (!SIG.every((v, i) => b[i] === v)) throw new Error("not a compound file");
    const major = u16(b, 26);
    const ss = 1 << u16(b, 30);
    const mss = 1 << u16(b, 32);
    const nSect = Math.floor(b.length / ss) - 1;
    const cutoff = u32(b, 56) || 4096;
    const sector = (k) => (k + 1) * ss;
    // A header field whose bytes may be CR or LF: the value that passes a check.
    const pick = (off, ok, rank) => {
      const vals = amb ? fieldValues(b, off, amb) : [u32(b, off)];
      const good = vals.filter(ok);
      const v = rank && good.length > 1 ? good.sort((x, y) => rank(y) - rank(x))[0] : good[0];
      if (v !== undefined && v !== u32(b, off)) put32(b, off, v);
      return v !== undefined ? v : vals[0];
    };
    // A FAT sector holds sector numbers (below limit) and chain marks, and marks itself.
    const fatLike = (fs, k, limit) => {
      if (fs >= nSect) return false;
      for (let i = 0; i < ss; i += 4) {
        const v = u32(b, sector(fs) + i);
        if (v >= (limit || nSect) && v < 0xfffffffc && !(amb && amb.has(sector(fs) + i))) return false;
      }
      const self = fs - k * (ss / 4);
      return self < 0 || self >= ss / 4 || u32(b, sector(fs) + self * 4) === FATSECT;
    };
    // Of two valid FAT sectors, the k-th is the one whose entries continue chains (i + 1).
    const fatScore = (fs, k) => {
      let n = 0;
      for (let i = 0; i < ss / 4; i++) if (u32(b, sector(fs) + i * 4) === k * (ss / 4) + i + 1) n++;
      return n;
    };
    const ROOT_NAME = [0x52, 0, 0x6f, 0, 0x6f, 0, 0x74, 0];
    pick(48, (ds) => ds < nSect && ROOT_NAME.every((v, i) => b[sector(ds) + i] === v));
    // FAT from the DIFAT (header, then DIFAT sectors).
    const fatSectors = [];
    for (let i = 0; i < 109; i++) {
      const v = pick(76 + i * 4, (fs) => fatLike(fs, i), (fs) => fatScore(fs, i));
      if (v < nSect) fatSectors.push(v);
    }
    pick(60, (ms) => ms === END || fatLike(ms, -1, b.length / 64));
    let dif = u32(b, 68);
    for (let guard = 0; dif < nSect && guard < 1000; guard++) {
      const base = sector(dif);
      for (let i = 0; i < ss / 4 - 1; i++) {
        const v = u32(b, base + i * 4);
        if (v < nSect) fatSectors.push(v);
      }
      dif = u32(b, base + ss - 4);
    }
    const fat = new Uint32Array(fatSectors.length * (ss / 4));
    const fatAt = [];
    fatSectors.forEach((s, k) => {
      for (let i = 0; i < ss / 4; i++) {
        fat[k * (ss / 4) + i] = u32(b, sector(s) + i * 4);
        fatAt[k * (ss / 4) + i] = sector(s) + i * 4;
      }
    });
    // A FAT entry whose bytes may be CR or LF: prefer the next sector (writers lay chains
    // out in order), else a value that is a real sector or a chain end.
    function settle(table, at, limit) {
      for (let i = 0; i < table.length; i++) {
        if (at[i] === undefined || !amb) continue;
        const vals = fieldValues(b, at[i], amb);
        if (vals.length < 2) continue;
        const pick = vals.find((v) => v === i + 1) || vals.find((v) => v < limit || v >= 0xfffffffc) || vals[0];
        table[i] = pick;
        put32(b, at[i], pick);
      }
    }
    settle(fat, fatAt, nSect);
    function chain(start, table, max) {
      const out = [];
      const seen = new Set();
      for (let c = start; c < max && !seen.has(c) && out.length < 1e6; c = table[c]) {
        seen.add(c);
        out.push(c);
      }
      return out;
    }
    function readChain(start, size) {
      const sects = chain(start, fat, nSect);
      const out = new Uint8Array(sects.length * ss);
      sects.forEach((s, k) => out.set(b.subarray(sector(s), sector(s) + ss), k * ss));
      return size == null ? out : out.subarray(0, Math.min(size, out.length));
    }
    // Directory.
    const dirSects = chain(u32(b, 48), fat, nSect);
    const dirAt = [];
    for (const s of dirSects) for (let e = 0; e < ss / 128; e++) dirAt.push(sector(s) + e * 128);
    const entries = dirAt.map((base, id) => {
      const nameLen = Math.min(u16(b, base + 64), 64);
      let name = "";
      for (let i = 0; i + 1 < nameLen - 1; i += 2) name += String.fromCharCode(u16(b, base + i));
      return { id, base, name, type: b[base + 66], left: u32(b, base + 68), right: u32(b, base + 72), child: u32(b, base + 76), start: u32(b, base + 116), size: major === 3 ? u32(b, base + 120) : u32(b, base + 120) + u32(b, base + 124) * 4294967296 };
    });
    // The root entry's stream is the mini stream: long enough for every small stream in it,
    // on a chain of as many sectors as it needs.
    const r0 = entries[0];
    if (amb && r0 && r0.type === 5) {
      let need = 0;
      for (const e of entries) if (e.type === 2 && e.size < cutoff && e.start < 0xfffffffa) need = Math.max(need, e.start * mss + e.size);
      const sizes = fieldValues(b, r0.base + 120, amb);
      const fit = sizes.filter((v) => v >= need).sort((x, y) => (x % mss) - (y % mss) || x - y);
      r0.size = fit.length ? fit[0] : Math.max.apply(null, sizes);
      const starts = fieldValues(b, r0.base + 116, amb);
      r0.start = starts.find((st) => chain(st, fat, nSect).length === Math.ceil(r0.size / ss)) ?? starts[0];
      put32(b, r0.base + 120, r0.size);
      put32(b, r0.base + 116, r0.start);
    }
    // MiniFAT.
    const miniSects = chain(u32(b, 60), fat, nSect);
    const minifat = new Uint32Array(miniSects.length * (ss / 4));
    const miniAt = [];
    miniSects.forEach((s, k) => {
      for (let i = 0; i < ss / 4; i++) {
        minifat[k * (ss / 4) + i] = u32(b, sector(s) + i * 4);
        miniAt[k * (ss / 4) + i] = sector(s) + i * 4;
      }
    });
    const rootEntry = entries[0] || { start: END, size: 0 };
    const miniStream = rootEntry.start < nSect ? readChain(rootEntry.start, rootEntry.size) : new Uint8Array(0);
    const nMini = Math.floor(miniStream.length / mss);
    settle(minifat, miniAt, nMini);

    // Directory fields that may hold a CR instead of an LF: tree links must be in range and
    // used once; a stream's start must give a chain as long as its size needs.
    if (amb) {
      // Every entry in use but the root is the target of exactly one link: settled links
      // count first, then each open link takes the candidate nothing points to yet.
      const refs = new Array(entries.length).fill(0);
      const open = [];
      for (const e of entries) {
        if (!e.type) continue;
        for (const [key, off] of [["left", 68], ["right", 72], ["child", 76]]) {
          let vals = fieldValues(b, e.base + off, amb).filter((v) => v === NOSTREAM || (v < entries.length && v > 0 && v !== e.id && entries[v].type));
          // Siblings form a search tree ordered by name length, then upper-cased name.
          const ordered = key === "child" ? vals : vals.filter((v) => v === NOSTREAM || (key === "left" ? nameOrder(entries[v].name, e.name) < 0 : nameOrder(entries[v].name, e.name) > 0));
          if (ordered.length) vals = ordered;
          if (vals.length > 1) open.push({ e, key, off, vals });
          else if (e[key] < entries.length) refs[e[key]]++;
        }
      }
      const settleLink = (l, v) => {
        l.e[l.key] = v;
        put32(b, l.e.base + l.off, v);
        if (v !== NOSTREAM) refs[v]++;
      };
      for (let changed = true; changed && open.length;) {
        changed = false;
        for (let i = 0; i < open.length; i++) {
          const l = open[i];
          const free = l.vals.filter((v) => v !== NOSTREAM && refs[v] === 0);
          const pick = free.length === 1 ? free[0] : !free.length && l.vals.includes(NOSTREAM) ? NOSTREAM : undefined;
          if (pick === undefined) continue;
          settleLink(l, pick);
          open.splice(i--, 1);
          changed = true;
        }
      }
      for (const l of open) settleLink(l, l.vals.find((v) => v === NOSTREAM || refs[v] === 0) || l.vals[0]);
      for (const e of entries) {
        if (e.type !== 2) continue;
        const starts = fieldValues(b, e.base + 116, amb);
        const sizes = fieldValues(b, e.base + 120, amb);
        if (starts.length < 2 && sizes.length < 2) continue;
        // The right start gives a chain as long as the size needs; the right size is
        // followed by the zero padding of its last block; UTF-16 text has an even size.
        let best = null;
        const utf16 = /001F$/i.test(e.name);
        for (const st of starts) for (const sz of sizes) {
          const mini = sz < cutoff;
          const unit = mini ? mss : ss;
          const sects = sz === 0 ? [] : chain(st, mini ? minifat : fat, mini ? nMini : nSect);
          let score = sects.length === Math.ceil(sz / unit) ? 4 : 0;
          if (sects.length && sz % unit) {
            const s = sects[Math.floor(sz / unit)];
            const base = s === undefined ? -1 : mini ? s * mss : sector(s);
            const src = mini ? miniStream : b;
            let zero = base >= 0;
            for (let i = sz % unit; zero && i < unit; i++) if (src[base + i]) zero = false;
            if (zero) score += 2;
          }
          if (utf16 && sz % 2 === 0) score += 1;
          if (!best || score > best.score) best = { st, sz, score };
        }
        if (best) {
          e.start = best.st;
          e.size = best.sz;
          put32(b, e.base + 116, best.st);
          put32(b, e.base + 120, best.sz);
        }
      }
    }

    function streamData(e) {
      if (!e || e.type !== 2) return new Uint8Array(0);
      if (e.size < cutoff) {
        const sects = chain(e.start, minifat, nMini);
        const out = new Uint8Array(sects.length * mss);
        sects.forEach((s, k) => out.set(miniStream.subarray(s * mss, s * mss + mss), k * mss));
        return out.subarray(0, Math.min(e.size, out.length));
      }
      return readChain(e.start, e.size);
    }
    // Offsets in b of a stream's bytes, for the ambiguity map.
    function streamOffsets(e) {
      const out = [];
      if (!e || e.type !== 2) return out;
      if (e.size < cutoff) {
        const msects = chain(rootEntry.start, fat, nSect);
        for (const s of chain(e.start, minifat, nMini)) {
          for (let i = 0; i < mss; i++) {
            const o = s * mss + i;
            out.push(sector(msects[Math.floor(o / ss)]) + (o % ss));
          }
        }
      } else {
        for (const s of chain(e.start, fat, nSect)) for (let i = 0; i < ss; i++) out.push(sector(s) + i);
      }
      return out.slice(0, e.size);
    }
    function children(e) {
      const out = [];
      const stack = e && e.child < entries.length ? [e.child] : [];
      const seen = new Set();
      while (stack.length && out.length < 5000) {
        const id = stack.pop();
        if (seen.has(id) || id >= entries.length) continue;
        seen.add(id);
        const c = entries[id];
        out.push(c);
        if (c.left < entries.length) stack.push(c.left);
        if (c.right < entries.length) stack.push(c.right);
      }
      return out;
    }
    return { entries, root: entries[0], children, streamData, streamOffsets };
  }

  // --- Compressed RTF (MS-OXRTFCP) and a plain-text rendering of RTF ----------------
  const RTF_PREBUF = "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\n\r\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";
  function decompressRtf(b) {
    if (b.length < 16) return "";
    const rawSize = u32(b, 4);
    const magic = u32(b, 8);
    if (magic === 0x414c454d) return latin1(b.subarray(16, 16 + rawSize)); // "MELA": stored
    if (magic !== 0x75465a4c) return ""; // "LZFu"
    const dict = new Uint8Array(4096);
    for (let i = 0; i < RTF_PREBUF.length; i++) dict[i] = RTF_PREBUF.charCodeAt(i);
    let w = RTF_PREBUF.length;
    const out = [];
    let i = 16;
    while (i < b.length && out.length < rawSize + 4096) {
      const flags = b[i++];
      for (let bit = 0; bit < 8 && i < b.length; bit++) {
        if (flags & (1 << bit)) {
          const ref = (b[i] << 8) | b[i + 1];
          i += 2;
          const off = ref >> 4;
          const len = (ref & 0xf) + 2;
          if (off === (w & 0xfff)) return latin1(out);
          for (let k = 0; k < len; k++) {
            const c = dict[(off + k) & 0xfff];
            out.push(c);
            dict[w & 0xfff] = c;
            w++;
          }
        } else {
          const c = b[i++];
          out.push(c);
          dict[w & 0xfff] = c;
          w++;
        }
      }
    }
    return latin1(out);
  }
  function latin1(arr) {
    let s = "";
    for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.slice(i, i + 0x8000));
    return s;
  }
  // RTF to text; an HTML body Outlook kept inside RTF (\fromhtml) is given back as HTML.
  function rtfToText(rtf) {
    const html = /\\fromhtml1/.test(rtf);
    let out = "";
    let depth = 0;
    const skipAt = [];
    let htmlrtf = false;
    const re = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([{}\\])|\\\*|([{}])|\r|\n|([^\\{}\r\n]+)/gi;
    let m;
    let starGroup = false;
    while ((m = re.exec(rtf))) {
      const skipping = skipAt.length && depth >= skipAt[skipAt.length - 1];
      if (m[5] === "{") { depth++; starGroup = false; continue; }
      if (m[5] === "}") {
        if (skipAt.length && depth === skipAt[skipAt.length - 1]) skipAt.pop();
        depth--;
        continue;
      }
      if (m[0] === "\\*") { starGroup = true; continue; }
      if (m[1]) {
        const w = m[1].toLowerCase();
        if (w === "htmltag" && html) { starGroup = false; continue; }
        if (starGroup || /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|themedata|colorschememapping|latentstyles|datastore|mhtmltag)$/.test(w)) {
          if (!skipping) skipAt.push(depth);
          starGroup = false;
          continue;
        }
        if (w === "htmlrtf") { htmlrtf = m[2] !== "0"; continue; }
        if (skipping || htmlrtf) continue;
        if (w === "par" || w === "line") out += "\n";
        else if (w === "tab") out += "\t";
        else if (w === "u" && m[2]) out += String.fromCharCode((+m[2] + 65536) % 65536);
        continue;
      }
      if (skipping || htmlrtf) continue;
      if (m[3]) out += String.fromCharCode(parseInt(m[3], 16));
      else if (m[4]) out += m[4];
      else if (m[6]) out += m[6];
    }
    return { text: html ? "" : out.trim(), html: html ? out : "" };
  }

  // --- MAPI properties ---------------------------------------------------------------
  const CODEPAGES = { 1252: "windows-1252", 65001: "utf-8", 1250: "windows-1250", 1251: "windows-1251", 28591: "iso-8859-1", 20127: "us-ascii", 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5" };
  function decode8(bytes, cp) {
    try {
      return new TextDecoder(CODEPAGES[cp] || "windows-1252").decode(bytes).replace(/\0+$/, "");
    } catch (_) {
      return latin1(bytes).replace(/\0+$/, "");
    }
  }
  // UTF-16 text; line breaks whose bytes were rebuilt (CR or LF unknown) are read as CR LF
  // when two follow each other and as LF otherwise.
  function decode16(bytes, offsets, amb) {
    let s = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      let c = bytes[i] | (bytes[i + 1] << 8);
      if (c === 0) break;
      const rebuilt = amb && offsets && amb.has(offsets[i]);
      if (rebuilt && c === 0x0a) {
        const nextRebuilt = amb.has(offsets[i + 2]) && (bytes[i + 2] | (bytes[i + 3] << 8)) === 0x0a;
        if (nextRebuilt) {
          s += "\r\n";
          i += 2;
          continue;
        }
      }
      s += String.fromCharCode(c);
    }
    return s;
  }

  // dmg: {amb, pairStarts} from undamage() when the file was damaged, else null.
  function readMessage(cfb, storage, dmg, depth) {
    const amb = dmg ? dmg.amb : null;
    const props = {};
    const kids = cfb.children(storage);
    for (const e of kids) {
      const m = e.name.match(/^__substg1\.0_([0-9A-F]{4})([0-9A-F]{4})$/i);
      if (m && e.type === 2) props[m[1].toUpperCase() + m[2].toUpperCase()] = e;
    }
    const propsStream = kids.find((e) => e.name === "__properties_version1.0");
    const fixed = {};
    if (propsStream) {
      const pb = cfb.streamData(propsStream);
      const headerLen = depth === 0 ? 32 : storage.name.indexOf("__attach") === 0 || storage.name.indexOf("__recip") === 0 ? 8 : 24;
      for (let o = headerLen; o + 16 <= pb.length; o += 16) {
        const tag = u32(pb, o);
        fixed[tag.toString(16).toUpperCase().padStart(8, "0")] = { lo: u32(pb, o + 8), hi: u32(pb, o + 12) };
      }
    }
    const cpEntry = fixed["3FFD0003"];
    const cp = cpEntry ? cpEntry.lo : 1252;
    function str(id) {
      const w = props[id + "001F"];
      if (w) return decode16(cfb.streamData(w), cfb.streamOffsets(w), amb);
      const a = props[id + "001E"];
      if (a) return decode8(cfb.streamData(a), cp);
      return "";
    }
    function bin(id) {
      const e = props[id + "0102"];
      return e ? cfb.streamData(e) : null;
    }
    const msg = { subject: "", from: "", headers: {}, html: "", text: "", images: [], attachments: [], files: [], nested: [] };
    const transport = str("007D");
    msg.transportHeaders = transport;
    msg.subject = str("0037");
    const senderName = str("0C1A") || str("0042");
    const senderAddr = str("5D01") || str("0C1F") || str("0065");
    msg.from = senderAddr ? (senderName && senderName !== senderAddr ? '"' + senderName + '" <' + senderAddr + ">" : senderAddr) : senderName;
    msg.text = str("1000");
    const htmlBytes = bin("1013") || (props["1013001F"] ? null : null);
    if (htmlBytes) {
      const cpHtml = fixed["3FDE0003"] ? fixed["3FDE0003"].lo : cp;
      msg.html = decode8(htmlBytes, cpHtml);
    } else if (props["1013001F"]) msg.html = str("1013");
    if (!msg.html && !msg.text) {
      const rtf = bin("1009");
      if (rtf) {
        const r = rtfToText(decompressRtf(rtf));
        msg.html = r.html;
        msg.text = r.text;
      }
    }
    // Recipients.
    const to = [];
    const cc = [];
    for (const e of kids) {
      if (e.type !== 1 || e.name.indexOf("__recip_version1.0_") !== 0) continue;
      const r = readProps(cfb, e, amb, cp);
      const addr = r.str("39FE") || r.str("3003");
      const name = r.str("3001");
      const typeE = r.fixed["0C150003"];
      const shown = addr ? (name && name !== addr ? '"' + name + '" <' + addr + ">" : addr) : name;
      if (typeE && typeE.lo === 2) cc.push(shown);
      else to.push(shown);
    }
    // Headers: the original Internet headers when the .msg kept them, else built from MAPI.
    msg.headers = transport ? parseHeaders(transport) : {};
    if (!msg.headers.from && msg.from) msg.headers.from = msg.from;
    if (!msg.headers.subject && msg.subject) msg.headers.subject = msg.subject;
    if (!msg.headers.to && to.length) msg.headers.to = to.join(", ");
    if (!msg.headers.cc && cc.length) msg.headers.cc = cc.join(", ");
    if (!msg.headers["message-id"] && str("1035")) msg.headers["message-id"] = str("1035");
    const sent = fixed["00390040"] || fixed["0E060040"];
    if (!msg.headers.date && sent && (sent.lo || sent.hi)) {
      const ms = (sent.hi * 4294967296 + sent.lo) / 10000 - 11644473600000;
      if (ms > 0 && ms < 8e15) msg.headers.date = new Date(ms).toUTCString().replace("GMT", "+0000");
    }
    if (!msg.subject && msg.headers.subject) msg.subject = msg.headers.subject;
    if (!msg.from && msg.headers.from) msg.from = msg.headers.from;
    // Every attachment's bytes, for toEml() (not shown or analysed from here).
    msg.parts = [];
    // Attachments.
    for (const e of kids) {
      if (e.type !== 1 || e.name.indexOf("__attach_version1.0_") !== 0) continue;
      const a = readProps(cfb, e, amb, cp);
      const name = a.str("3707") || a.str("3704") || a.str("3001") || "attachment";
      const mime = (a.str("370E") || "").toLowerCase();
      const cid = a.str("3712");
      const embedded = cfb.children(e).find((x) => x.type === 1 && /^__substg1\.0_3701000D$/i.test(x.name));
      if (embedded && depth < 3) {
        const inner = readMessage(cfb, embedded, dmg, depth + 1);
        msg.attachments.push({ name: name.match(/\.msg$/i) ? name : (inner.subject || name) + ".msg", contentType: "message/rfc822" });
        msg.nested.push(inner);
        msg.parts.push({ name: (inner.subject || name).replace(/\.msg$/i, "") + ".eml", message: inner });
        continue;
      }
      let data = a.bin("3701");
      if (!data) continue;
      const ct = mime || guessType(name, data);
      // Bytes rebuilt by the damage repair: what the file's own checks could settle is
      // fixed; the copy is still not the original file, so it gives no hash.
      const fix = dmg && repairFile(data, rebuiltIn(cfb, a.entry("3701"), dmg));
      if (fix) data = fix.bytes;
      const rebuilt = fix ? fix.report : undefined;
      msg.attachments.push({ name, contentType: ct, size: data.length, rebuilt });
      msg.parts.push({ name, contentType: ct, cid, bytes: data, rebuilt });
      if (/^image\//.test(ct) && data.length <= 2500000) {
        msg.images.push({ cid, name, mime: ct, dataUrl: "data:" + ct + ";base64," + base64(data), size: data.length, inline: !!cid, rebuilt });
      } else if (/pdf/.test(ct) || /\.pdf$/i.test(name)) {
        msg.files.push({ name, contentType: "application/pdf", size: data.length, bytes: latin1(data), rebuilt });
      } else if (/\.msg$/i.test(name) || ct === "application/vnd.ms-outlook") {
        try {
          const r = read(data);
          if (r.ok) msg.nested.push(r.message);
        } catch (_) {}
      }
    }
    return msg;
  }

  function readProps(cfb, storage, amb, cp) {
    const map = {};
    const fixed = {};
    for (const e of cfb.children(storage)) {
      const m = e.name.match(/^__substg1\.0_([0-9A-F]{4})([0-9A-F]{4})$/i);
      if (m && e.type === 2) map[m[1].toUpperCase() + m[2].toUpperCase()] = e;
      if (e.name === "__properties_version1.0") {
        const pb = cfb.streamData(e);
        for (let o = 8; o + 16 <= pb.length; o += 16) fixed[u32(pb, o).toString(16).toUpperCase().padStart(8, "0")] = { lo: u32(pb, o + 8), hi: u32(pb, o + 12) };
      }
    }
    return {
      fixed,
      str(id) {
        if (map[id + "001F"]) return decode16(cfb.streamData(map[id + "001F"]), cfb.streamOffsets(map[id + "001F"]), amb);
        if (map[id + "001E"]) return decode8(cfb.streamData(map[id + "001E"]), cp);
        return "";
      },
      bin(id) {
        return map[id + "0102"] ? cfb.streamData(map[id + "0102"]) : null;
      },
      entry(id) {
        return map[id + "0102"];
      },
    };
  }

  // Offsets inside a stream of the bytes the repair rebuilt.
  function rebuiltIn(cfb, e, dmg) {
    const offs = cfb.streamOffsets(e);
    const lone = new Set(), pairs = new Set();
    for (let i = 0; i < offs.length; i++) {
      if (dmg.amb.has(offs[i])) lone.add(i);
      else if (dmg.pairStarts.has(offs[i]) && offs[i + 1] === offs[i] + 1) pairs.add(i);
    }
    return { lone, pairs };
  }
  function repairFile(data, at) {
    if (!at.lone.size && !at.pairs.size) return null;
    const report = { bytes: at.lone.size + at.pairs.size * 2, verified: false };
    if (Repair && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
      const r = Repair.pdf(data, at.lone, at.pairs);
      Object.assign(report, { streams: r.streams, repaired: r.repaired, checked: r.verified, unresolved: r.unresolved });
      report.verified = r.unresolved === 0 && r.repaired === r.verified;
      return { bytes: r.bytes, report };
    }
    if (Repair && data[0] === 0xff && data[1] === 0xd8) {
      const r = Repair.jpeg(data, at.lone, at.pairs);
      report.verified = r.verified;
      return { bytes: r.bytes, report };
    }
    return { bytes: data, report };
  }

  function guessType(name, data) {
    if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return "application/pdf";
    if (data[0] === 0x89 && data[1] === 0x50) return "image/png";
    if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
    const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1];
    return { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", htm: "text/html", html: "text/html", svg: "image/svg+xml", zip: "application/zip", msg: "application/vnd.ms-outlook", eml: "message/rfc822" }[String(ext || "").toLowerCase()] || "application/octet-stream";
  }

  function base64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "latin1").toString("base64");
  }

  // Internet headers as nested.js keeps them: lowercase names, repeated ones joined.
  function parseHeaders(text) {
    const block = String(text || "").replace(/\r\n/g, "\n").split(/\n\n/)[0];
    const lines = block.replace(/\n[ \t]+/g, " ").split("\n");
    const h = {};
    for (const line of lines) {
      const i = line.indexOf(":");
      if (i <= 0) continue;
      const k = line.slice(0, i).trim().toLowerCase();
      const v = line.slice(i + 1).trim();
      h[k] = h[k] ? h[k] + ", " + v : v;
    }
    return h;
  }

  function damageNote(rep, attachments) {
    let note = "Outlook .msg file damaged by a line-ending conversion (every lone CR or LF byte became CR LF); rebuilt: " + rep.rebuilt.toLocaleString("en-US") + " bytes were CR or LF and were settled from the file's structure.";
    const files = attachments.filter((a) => a.rebuilt);
    for (const a of files) {
      note += " " + a.name + ": " + (a.rebuilt.verified ? "repaired and checked (" + (a.rebuilt.streams ? "its " + a.rebuilt.streams + " PDF streams decode" : "the image decodes") + ")" : "repaired as far as it could be checked") + "; it may still differ from the original by a few bytes, so no hash is given.";
    }
    return note;
  }

  // --- The message as an .eml -------------------------------------------------------
  const utf8 = (str) => new TextEncoder().encode(String(str));
  const wrap76 = (b64) => b64.replace(/.{76}/g, "$&\r\n");
  // RFC 2047 for header text that is not plain ASCII.
  const word = (str) => (/[^\x20-\x7e]/.test(str) ? "=?UTF-8?B?" + base64(utf8(str)) + "?=" : str);
  const quoted = (str) => '"' + word(String(str)).replace(/["\\\r\n]/g, "") + '"';
  // Headers the rebuilt MIME structure replaces.
  const REPLACED = /^(content-type|content-transfer-encoding|mime-version|content-disposition|x-peelscout-[\w-]+)$/i;

  /**
   * An RFC 822 message for Thunderbird to open: the original Internet headers when the
   * .msg kept them (else ones built from its properties), the bodies, every attachment
   * and embedded message. marker: {token, note} — marks the message, and every file the
   * damage repair touched, as rebuilt (X-PeelScout-Rebuilt), so the add-on knows them.
   */
  function toEml(m, marker) {
    const out = [];
    const id = Math.random().toString(36).slice(2, 10);
    if (m.transportHeaders) {
      const block = String(m.transportHeaders).replace(/\r?\n/g, "\r\n").split("\r\n\r\n")[0];
      for (const field of block.split(/\r\n(?![ \t])/)) {
        const name = field.slice(0, field.indexOf(":")).trim();
        if (name && !REPLACED.test(name)) out.push(field.replace(/[^\x00-\x7f]/g, (c) => word(c)));
      }
    } else {
      const h = m.headers || {};
      const addr = (v) => String(v).replace(/"([^"]*)"/g, (_, n) => quoted(n));
      if (h.from) out.push("From: " + addr(h.from));
      if (h.to) out.push("To: " + addr(h.to));
      if (h.cc) out.push("Cc: " + addr(h.cc));
      if (m.subject) out.push("Subject: " + word(m.subject));
      if (h.date) out.push("Date: " + h.date);
      if (h["message-id"]) out.push("Message-ID: " + h["message-id"]);
    }
    out.push("MIME-Version: 1.0");
    if (marker) {
      out.push("X-PeelScout-Rebuilt: " + marker.token);
      if (marker.note) out.push("X-PeelScout-Note: " + word(marker.note));
    }
    const mixed = "peel-mixed-" + id;
    out.push('Content-Type: multipart/mixed; boundary="' + mixed + '"', "");
    const part = (headers, body) => {
      out.push("--" + mixed);
      for (const h of headers) out.push(h);
      out.push("", body);
    };
    // Bodies, in UTF-8 (an HTML body's own charset declaration then says so too).
    const html = m.html ? String(m.html).replace(/(<meta\b[^>]*charset\s*=\s*["']?)[\w-]+/gi, "$1utf-8") : "";
    const bodies = [];
    if (m.text) bodies.push(["text/plain", m.text]);
    if (html) bodies.push(["text/html", html]);
    if (!bodies.length) bodies.push(["text/plain", ""]);
    const bodyPart = (type, text) => ["Content-Type: " + type + "; charset=utf-8", "Content-Transfer-Encoding: base64"].concat([""], [wrap76(base64(utf8(text)))]).join("\r\n");
    if (bodies.length === 1) part(["Content-Type: " + bodies[0][0] + "; charset=utf-8", "Content-Transfer-Encoding: base64"], wrap76(base64(utf8(bodies[0][1]))));
    else {
      const alt = "peel-alt-" + id;
      part(['Content-Type: multipart/alternative; boundary="' + alt + '"'], bodies.map((b) => "--" + alt + "\r\n" + bodyPart(b[0], b[1])).join("\r\n") + "\r\n--" + alt + "--");
    }
    for (const p of m.parts || []) {
      if (p.message) {
        part(["Content-Type: message/rfc822; name=" + quoted(p.name), "Content-Disposition: attachment; filename=" + quoted(p.name)], toEml(p.message, marker && { token: marker.token }));
        continue;
      }
      const headers = ["Content-Type: " + (p.contentType || "application/octet-stream") + "; name=" + quoted(p.name), "Content-Disposition: " + (p.cid ? "inline" : "attachment") + "; filename=" + quoted(p.name), "Content-Transfer-Encoding: base64"];
      if (p.cid) headers.push("Content-ID: <" + p.cid.replace(/[<>\r\n]/g, "") + ">");
      if (p.rebuilt && marker) headers.push("X-PeelScout-Rebuilt: " + marker.token + (p.rebuilt.verified ? "; checked" : ""));
      part(headers, wrap76(base64(p.bytes)));
    }
    out.push("--" + mixed + "--", "");
    return out.join("\r\n");
  }

  /**
   * data: bytes of a .msg (Uint8Array, ArrayBuffer or binary string), possibly damaged.
   * Returns {ok, damaged, repaired: {crlf, pairs, rebuilt} | null, message, error}.
   */
  function read(data) {
    const res = { ok: false, damaged: false, repaired: null, message: null };
    try {
      let b = toBytes(data);
      if (b.length > MAX_BYTES) return Object.assign(res, { error: "too large" });
      const off = signatureAt(b);
      if (off < 0) return Object.assign(res, { error: "not an Outlook .msg" });
      b = b.subarray(off);
      if (b.length < 1024) return Object.assign(res, { error: "truncated" });
      let amb = null, pairStarts = null;
      if (lineEndingDamage(b).damaged) {
        const u = undamage(b);
        if (!u) return Object.assign(res, { error: "unreadable header" });
        res.damaged = true;
        res.repaired = { crlf: u.crlf, pairs: u.pairs, rebuilt: u.ambiguous.size, prefix: off };
        b = u.bytes;
        amb = u.ambiguous;
        pairStarts = u.pairStarts;
      } else b = Uint8Array.from(b);
      const cfb = readCfb(b, amb);
      res.message = readMessage(cfb, cfb.root, amb ? { amb, pairStarts } : null, 0);
      res.message.note = res.damaged ? damageNote(res.repaired, res.message.attachments) : "Outlook .msg file.";
      res.ok = true;
    } catch (e) {
      res.error = String((e && e.message) || e);
    }
    return res;
  }

  return { read, toEml, isMsg, signatureAt, undamage, decompressRtf, rtfToText, parseHeaders };
});
