/**
 * Static look inside a PDF attachment: link targets (/URI), visible text, risky
 * features (JavaScript, launch actions, embedded files, forms) and encryption.
 * Nothing in the file is executed or rendered. FlateDecode streams are inflated with
 * inflate-zlib.js; text in Identity-H fonts (Chrome/Skia "Save as PDF", the usual
 * lure generator) is mapped back through the fonts' ToUnicode CMaps.
 *
 * Files encrypted with the standard RC4 handler (revisions 2–3) are opened when the
 * user password is empty or is one the email itself gives (e.g. "your email address
 * is the password"); the guide allows static analysis with a password the email
 * supplies. AES-encrypted files are reported as encrypted.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./inflate-zlib.js").inflateZlib);
  else root.PeelPdf = factory(root.inflateZlib);
})(typeof globalThis !== "undefined" ? globalThis : this, function (inflateZlib) {
  "use strict";

  const MAX_BYTES = 12 * 1024 * 1024;
  const MAX_STREAM_OUT = 4 * 1024 * 1024;
  const MAX_TEXT = 20000;

  function toBin(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  }
  function toBytes(bin) {
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i) & 0xff;
    return b;
  }

  // --- MD5 and RC4 (standard security handler) ---------------------------------------
  function md5(bytes) {
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    const R = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    const len = bytes.length;
    const padded = new Uint8Array((((len + 8) >> 6) + 1) * 64);
    padded.set(bytes);
    padded[len] = 0x80;
    const bitLen = len * 8;
    for (let i = 0; i < 4; i++) padded[padded.length - 8 + i] = (bitLen >>> (8 * i)) & 0xff;
    padded[padded.length - 4] = Math.floor(len / 0x20000000) & 0xff;
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Array(16);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = padded[off + i * 4] | (padded[off + i * 4 + 1] << 8) | (padded[off + i * 4 + 2] << 16) | (padded[off + i * 4 + 3] << 24);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const tmp = D;
        D = C;
        C = B;
        const x = (A + F + K[i] + M[g]) | 0;
        B = (B + ((x << R[i]) | (x >>> (32 - R[i])))) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach(function (v, i) { for (let j = 0; j < 4; j++) out[i * 4 + j] = (v >>> (8 * j)) & 0xff; });
    return out;
  }

  function rc4(key, data) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    for (let i = 0, j = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    const out = new Uint8Array(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) {
      i = (i + 1) & 0xff;
      j = (j + S[i]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
    }
    return out;
  }

  function concat() {
    let n = 0;
    for (const a of arguments) n += a.length;
    const out = new Uint8Array(n);
    let p = 0;
    for (const a of arguments) { out.set(a, p); p += a.length; }
    return out;
  }

  const PAD = toBytes("\x28\xbf\x4e\x5e\x4e\x75\x8a\x41\x64\x00\x4e\x56\xff\xfa\x01\x08\x2e\x2e\x00\xb6\xd0\x68\x3e\x80\x2f\x0c\xa9\xfe\x64\x53\x69\x7a");

  // --- PDF strings -----------------------------------------------------------------
  // Literal string starting at s[i] === "(": returns {bin, end}.
  function readLiteral(s, i) {
    let depth = 0;
    let out = "";
    let j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === "\\") {
        const n = s[j + 1];
        const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
        if (map[n] !== undefined) { out += map[n]; j++; continue; }
        if (n === "\r" || n === "\n") { j++; if (n === "\r" && s[j + 1] === "\n") j++; continue; }
        const oct = s.slice(j + 1, j + 4).match(/^[0-7]{1,3}/);
        if (oct) { out += String.fromCharCode(parseInt(oct[0], 8) & 0xff); j += oct[0].length; continue; }
        continue;
      }
      if (c === "(") { depth++; if (depth === 1) continue; }
      if (c === ")") { depth--; if (depth === 0) break; }
      out += c;
    }
    return { bin: out, end: j + 1 };
  }
  function readHex(s) {
    const h = s.replace(/[^0-9a-f]/gi, "");
    let out = "";
    for (let i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt((h.slice(i, i + 2) + "0").slice(0, 2), 16));
    return out;
  }
  // The string value following a key in a dictionary text (literal or hex).
  function stringAfter(dict, key) {
    const re = new RegExp("/" + key + "\\s*(\\(|<(?!<))");
    const m = re.exec(dict);
    if (!m) return null;
    const at = m.index + m[0].length - 1;
    if (m[1] === "(") return readLiteral(dict, at).bin;
    const end = dict.indexOf(">", at);
    return end < 0 ? null : readHex(dict.slice(at + 1, end));
  }
  function utf16OrLatin(bin) {
    if (bin.charCodeAt(0) === 0xfe && bin.charCodeAt(1) === 0xff) {
      let out = "";
      for (let i = 2; i + 1 < bin.length; i += 2) out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
      return out;
    }
    return bin;
  }

  // --- Objects and streams ----------------------------------------------------------
  function parseObjects(s) {
    const objs = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      const num = +m[1];
      const gen = +m[2];
      const start = re.lastIndex;
      const end = s.indexOf("endobj", start);
      if (end < 0) break;
      let body = s.slice(start, end);
      let stream = null;
      const sm = body.match(/\bstream\r?\n/);
      if (sm) {
        const dict = body.slice(0, sm.index);
        let data = body.slice(sm.index + sm[0].length);
        const len = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
        const es = data.lastIndexOf("endstream");
        if (len && +len[1] <= data.length) data = data.slice(0, +len[1]);
        else if (es >= 0) data = data.slice(0, es).replace(/\r?\n$/, "");
        stream = data;
        body = dict;
      }
      objs.set(num, { num, gen, dict: body, stream });
      re.lastIndex = end + 6;
    }
    return objs;
  }

  function decodeStream(obj, decrypt) {
    if (obj.decoded !== undefined) return obj.decoded;
    let data = obj.stream;
    obj.decoded = null;
    if (data == null) return null;
    if (decrypt) data = decrypt(obj, data);
    const filter = (obj.dict.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/) || [])[1] || "";
    const names = filter.match(/\/[A-Za-z0-9]+/g) || [];
    if (!names.length) return (obj.decoded = data);
    if (names.length > 1 || !/^\/(FlateDecode|Fl)$/.test(names[0])) return null;
    try {
      const out = inflateZlib(toBytes(data));
      if (out.length > MAX_STREAM_OUT) return null;
      obj.decoded = toBin(out);
    } catch (_) {
      obj.decoded = null;
    }
    return obj.decoded;
  }

  // Objects packed inside /Type /ObjStm streams (PDF 1.5+).
  function expandObjectStreams(objs, decrypt) {
    for (const o of Array.from(objs.values())) {
      if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
      const data = decodeStream(o, decrypt);
      if (!data) continue;
      const n = +((o.dict.match(/\/N\s+(\d+)/) || [])[1] || 0);
      const first = +((o.dict.match(/\/First\s+(\d+)/) || [])[1] || 0);
      const nums = data.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n && i * 2 + 1 < nums.length; i++) {
        const off = first + nums[i * 2 + 1];
        const nextOff = i + 1 < n ? first + nums[i * 2 + 3] : data.length;
        if (!objs.has(nums[i * 2])) objs.set(nums[i * 2], { num: nums[i * 2], gen: 0, dict: data.slice(off, nextOff), stream: null, inObjStm: true });
      }
    }
  }

  // --- Encryption ------------------------------------------------------------------
  function setupDecryption(s, objs, passwords) {
    const encRef = s.match(/\/Encrypt\s+(\d+)\s+\d+\s+R/);
    let encDict = encRef && objs.get(+encRef[1]) ? objs.get(+encRef[1]).dict : null;
    if (!encDict) {
      const inline = s.match(/\/Encrypt\s*<<([\s\S]*?)>>/);
      encDict = inline ? inline[1] : null;
    }
    if (!encDict) return { encrypted: false };
    const V = +((encDict.match(/\/V\s+(\d+)/) || [])[1] || 0);
    const Rv = +((encDict.match(/\/R\s+(\d+)/) || [])[1] || 0);
    const info = { encrypted: true, algorithm: V >= 4 ? "AES" : "RC4", revision: Rv, decrypted: false };
    if (!/\/Filter\s*\/Standard/.test(encDict) || V > 2 || Rv > 3) return info;
    const O = stringAfter(encDict, "O");
    const U = stringAfter(encDict, "U");
    const P = +((encDict.match(/\/P\s+(-?\d+)/) || [])[1] || 0);
    const bits = +((encDict.match(/\/Length\s+(\d+)/) || [])[1] || 40);
    const idm = s.match(/\/ID\s*\[\s*<([0-9a-fA-F]*)>/);
    if (!O || !U || !idm) return info;
    const n = Rv === 2 ? 5 : Math.max(5, Math.min(16, bits / 8));
    const id0 = toBytes(readHex(idm[1]));
    const pBytes = new Uint8Array([P & 0xff, (P >>> 8) & 0xff, (P >>> 16) & 0xff, (P >>> 24) & 0xff]);
    const Ob = toBytes(O.slice(0, 32));
    const Ub = toBytes(U);
    for (const pw of [""].concat(passwords || [])) {
      const pwb = toBytes(unescape(encodeURIComponent(String(pw))).slice(0, 32));
      const padded = concat(pwb, PAD.subarray(0, 32 - pwb.length));
      let key = md5(concat(padded, Ob, pBytes, id0)).subarray(0, n);
      if (Rv >= 3) for (let i = 0; i < 50; i++) key = md5(key).subarray(0, n);
      let check;
      if (Rv === 2) check = rc4(key, PAD);
      else {
        check = rc4(key, md5(concat(PAD, id0)));
        for (let i = 1; i <= 19; i++) check = rc4(key.map(function (b) { return b ^ i; }), check);
      }
      const len = Rv === 2 ? 32 : 16;
      let ok = true;
      for (let i = 0; i < len; i++) if (check[i] !== Ub[i]) { ok = false; break; }
      if (!ok) continue;
      const fileKey = Uint8Array.from(key);
      info.decrypted = true;
      info.password = pw === "" ? "(empty)" : pw;
      info.decrypt = function (obj, bin) {
        const k = md5(concat(fileKey, new Uint8Array([obj.num & 0xff, (obj.num >> 8) & 0xff, (obj.num >> 16) & 0xff, obj.gen & 0xff, (obj.gen >> 8) & 0xff]))).subarray(0, Math.min(n + 5, 16));
        return toBin(rc4(k, toBytes(bin)));
      };
      return info;
    }
    return info;
  }

  // --- Text ----------------------------------------------------------------------
  function parseCMap(text) {
    const map = new Map();
    const hex = function (h) { return parseInt(h, 16); };
    const toStr = function (h) {
      let out = "";
      for (let i = 0; i + 3 < h.length + 0; i += 4) out += String.fromCharCode(hex(h.slice(i, i + 4)));
      if (h.length === 2) out = String.fromCharCode(hex(h));
      return out;
    };
    let m;
    const chars = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = chars.exec(text))) {
      const pairs = m[1].match(/<[0-9a-fA-F]+>\s*<[0-9a-fA-F]*>/g) || [];
      for (const p of pairs) {
        const [src, dst] = p.match(/<([0-9a-fA-F]*)>/g).map(function (x) { return x.slice(1, -1); });
        map.set(hex(src), toStr(dst));
      }
    }
    const ranges = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = ranges.exec(text))) {
      const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g;
      let r;
      while ((r = re.exec(m[1]))) {
        const lo = hex(r[1]);
        const hi = Math.min(hex(r[2]), lo + 0xffff);
        if (r[4]) {
          const base = r[4];
          const last = hex(base.slice(-4));
          for (let c = lo; c <= hi; c++) map.set(c, toStr(base.slice(0, -4) + (last + c - lo).toString(16).padStart(4, "0")));
        } else {
          const list = (r[5].match(/<([0-9a-fA-F]*)>/g) || []).map(function (x) { return x.slice(1, -1); });
          for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, toStr(list[c - lo]));
        }
      }
    }
    return map;
  }

  // Glyph widths: /W of a CID font ("c [w1 w2…]" or "cFirst cLast w") or /Widths of a
  // simple font, in thousandths of the font size.
  function readArray(objs, dict, key) {
    const ref = dict.match(new RegExp("/" + key + "\\s+(\\d+)\\s+\\d+\\s+R"));
    if (ref && objs.get(+ref[1])) return objs.get(+ref[1]).dict.replace(/^\s*\[|\]\s*$/g, "");
    const at = dict.search(new RegExp("/" + key + "\\s*\\["));
    if (at < 0) return null;
    let depth = 0;
    const start = dict.indexOf("[", at);
    for (let i = start; i < dict.length; i++) {
      if (dict[i] === "[") depth++;
      else if (dict[i] === "]" && --depth === 0) return dict.slice(start + 1, i);
    }
    return null;
  }
  function cidWidths(text) {
    const w = new Map();
    const tokens = String(text || "").match(/\[[^\]]*\]|-?[\d.]+/g) || [];
    for (let i = 0; i < tokens.length; ) {
      const first = +tokens[i];
      if (tokens[i + 1] && tokens[i + 1][0] === "[") {
        const list = tokens[i + 1].slice(1, -1).trim().split(/\s+/).map(Number);
        list.forEach(function (v, k) { w.set(first + k, v); });
        i += 2;
      } else if (tokens[i + 2] !== undefined) {
        for (let c = first; c <= +tokens[i + 1] && c - first < 65536; c++) w.set(c, +tokens[i + 2]);
        i += 3;
      } else break;
    }
    return w;
  }

  // Font resource name (/F6) → {cmap, bytes per code, widths}, across all pages
  // (resource names rarely clash between pages of one lure).
  function fontInfos(objs, decrypt) {
    const infoOf = new Map();
    function info(num) {
      if (infoOf.has(num)) return infoOf.get(num);
      const o = objs.get(num);
      const res = { cmap: null, bytes: 1, widths: new Map(), dw: 0 };
      infoOf.set(num, res);
      if (!o) return res;
      const tu = o.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
      if (tu && objs.get(+tu[1])) {
        const data = decodeStream(objs.get(+tu[1]), decrypt);
        if (data) res.cmap = parseCMap(data);
      }
      if (/\/Subtype\s*\/Type0/.test(o.dict)) {
        res.bytes = 2;
        const desc = o.dict.match(/\/DescendantFonts\s*\[?\s*(\d+)\s+\d+\s+R/);
        const d = desc && objs.get(+desc[1]);
        if (d) {
          res.dw = +((d.dict.match(/\/DW\s+(\d+)/) || [])[1] || 1000);
          res.widths = cidWidths(readArray(objs, d.dict, "W"));
        }
      } else {
        const fc = +((o.dict.match(/\/FirstChar\s+(\d+)/) || [])[1] || 0);
        const list = (readArray(objs, o.dict, "Widths") || "").trim().split(/\s+/).filter(Boolean).map(Number);
        list.forEach(function (v, k) { res.widths.set(fc + k, v); });
        res.dw = 500;
      }
      return res;
    }
    const byName = new Map();
    function readFontDict(text) {
      const re = /\/([^\s\/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g;
      let m;
      while ((m = re.exec(text))) if (!byName.has(m[1]) && objs.get(+m[2]) && /\/Type\s*\/Font\b/.test(objs.get(+m[2]).dict)) byName.set(m[1], info(+m[2]));
    }
    for (const o of objs.values()) {
      const inline = o.dict.match(/\/Font\s*<<([\s\S]*?)>>/);
      if (inline) readFontDict(inline[1]);
      const ref = o.dict.match(/\/Font\s+(\d+)\s+\d+\s+R/);
      if (ref && objs.get(+ref[1])) readFontDict(objs.get(+ref[1]).dict);
    }
    return byName;
  }

  // Shown string → {text, advance in thousandths of the font size}.
  function decodeShown(bin, font) {
    let text = "";
    let adv = 0;
    const step = font ? font.bytes : 1;
    for (let i = 0; i + step - 1 < bin.length; i += step) {
      const code = step === 2 ? (bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1) : bin.charCodeAt(i);
      const mapped = font && font.cmap ? font.cmap.get(code) : undefined;
      if (mapped !== undefined) text += mapped;
      else if (step === 1 && code >= 0x20) text += String.fromCharCode(code);
      const w = font ? font.widths.get(code) : undefined;
      adv += w !== undefined ? w : font && font.dw ? font.dw : 500;
    }
    return { text, adv };
  }

  // Text of a content stream, laid out well enough for phrase matching: a space where
  // the next run starts clearly after the previous one ends, a line break where the
  // baseline moves. Lure generators often place every glyph on its own.
  function contentText(data, fonts) {
    let out = "";
    let font = null;
    let size = 12;
    let lineX = 0, lineY = 0, penX = 0, lastY = null, lastEnd = null;
    let arrayAdj = 0;
    const re = /\/([^\s\/<>\[\]()]+)\s+(-?[\d.]+)\s+Tf|\(|<([0-9a-fA-F\s]*)>|\[|\]|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]\b|(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm\b|T\*|\bBT\b|\bTJ\b|\bTj\b|(-?[\d.]+)(?=\s*[\]\-\d.(<])/g;
    let inArray = false;
    function show(bin) {
      const r = decodeShown(bin, font);
      if (!r.text) {
        penX += (r.adv / 1000) * size;
        return;
      }
      const x = penX;
      if (lastY !== null && Math.abs(lineY - lastY) > size * 0.5) out += "\n";
      else if (lastEnd !== null && x - lastEnd > size * 0.18 && !/\s$/.test(out)) out += " ";
      out += r.text;
      penX = x + (r.adv / 1000) * size;
      lastEnd = penX;
      lastY = lineY;
    }
    let m;
    while ((m = re.exec(data))) {
      const tok = m[0];
      if (m[1]) { font = fonts.get(m[1]) || null; size = Math.abs(+m[2]) || size; continue; }
      if (tok === "(") {
        const lit = readLiteral(data, m.index);
        re.lastIndex = lit.end;
        show(lit.bin);
        continue;
      }
      if (m[3] !== undefined) { show(readHex(m[3])); continue; }
      if (tok === "[") { inArray = true; continue; }
      if (tok === "]") { inArray = false; continue; }
      if (m[4] !== undefined) { lineX += +m[4]; lineY += +m[5]; penX = lineX; continue; }
      if (m[6] !== undefined) { lineX = +m[10]; lineY = +m[11]; penX = lineX; continue; }
      if (tok === "BT") { lineX = lineY = penX = 0; continue; }
      if (tok === "T*") { lineY -= size; penX = lineX; continue; }
      if (m[12] !== undefined && inArray) { arrayAdj = +m[12]; penX -= (arrayAdj / 1000) * size; continue; }
    }
    return out;
  }

  // --- Scan --------------------------------------------------------------------------
  /**
   * bytes: Uint8Array of the file. opts.passwords: candidate user passwords.
   * Returns { ok, pages, encrypted, algorithm, decrypted, password, uris, text,
   *           features, producer, creator, title, images, error }
   */
  function scan(bytes, opts) {
    const res = { ok: false, pages: 0, encrypted: false, decrypted: false, uris: [], text: "", features: [], producer: "", creator: "", title: "", images: 0 };
    try {
      if (!bytes || !bytes.length) return Object.assign(res, { error: "empty" });
      if (bytes.length > MAX_BYTES) return Object.assign(res, { error: "too large" });
      const s = toBin(bytes);
      if (s.indexOf("%PDF-") < 0 || s.indexOf("%PDF-") > 1024) return Object.assign(res, { error: "not a PDF" });
      const objs = parseObjects(s);
      const enc = setupDecryption(s, objs, (opts && opts.passwords) || []);
      res.encrypted = !!enc.encrypted;
      if (enc.encrypted) {
        res.algorithm = enc.algorithm;
        res.decrypted = !!enc.decrypted;
        if (enc.password) res.password = enc.password;
      }
      const decrypt = enc.decrypted ? enc.decrypt : null;
      const readable = !res.encrypted || res.decrypted;
      if (readable) expandObjectStreams(objs, decrypt);
      // String values in dictionaries are encrypted too.
      function str(o, key) {
        const v = stringAfter(o.dict, key);
        if (v == null) return null;
        return decrypt && !o.inObjStm ? decrypt(o, v) : v;
      }
      const FEATURES = [
        ["JavaScript", /\/(JavaScript|JS)\b/],
        ["Launch action", /\/Launch\b/],
        ["Embedded file", /\/EmbeddedFiles?\b/],
        ["Form submission", /\/SubmitForm\b/],
        ["XFA form", /\/XFA\b/],
        ["Rich media", /\/RichMedia\b/],
      ];
      const uris = [];
      for (const o of objs.values()) {
        if (/\/Type\s*\/Page\b/.test(o.dict)) res.pages++;
        if (/\/Subtype\s*\/Image\b/.test(o.dict)) res.images++;
        for (const [name, re] of FEATURES) if (re.test(o.dict) && res.features.indexOf(name) < 0) res.features.push(name);
        if (/\/URI\s*[(<]/.test(o.dict) && readable) {
          const u = utf16OrLatin(str(o, "URI") || "").trim();
          if (u && uris.indexOf(u) < 0) uris.push(u);
        }
        if (/\/Producer\s*[(<]/.test(o.dict) && !res.producer && readable) res.producer = utf16OrLatin(str(o, "Producer") || "").slice(0, 120);
        if (/\/Creator\s*[(<]/.test(o.dict) && !res.creator && readable) res.creator = utf16OrLatin(str(o, "Creator") || "").slice(0, 160);
        if (/\/Title\s*[(<]/.test(o.dict) && !res.title && readable) res.title = utf16OrLatin(str(o, "Title") || "").slice(0, 160);
      }
      res.uris = uris.slice(0, 50);
      if (readable) {
        const fonts = fontInfos(objs, decrypt);
        let text = "";
        for (const o of objs.values()) {
          if (o.stream == null || /\/(Type\s*\/(XObject|ObjStm|XRef|Metadata|EmbeddedFile)|Subtype\s*\/Image|FontFile|Length1)\b/.test(o.dict)) continue;
          if (/\/ToUnicode\b|begincmap/.test(o.dict)) continue;
          const data = decodeStream(o, decrypt);
          if (!data || !/\bT[jJ]\b/.test(data)) continue;
          text += contentText(data, fonts) + "\n";
          if (text.length > MAX_TEXT) break;
        }
        res.text = text.replace(/[ \t]+/g, " ").replace(/ *\n[\s\n]*/g, "\n").trim().slice(0, MAX_TEXT);
      }
      res.ok = true;
    } catch (e) {
      res.error = String((e && e.message) || e);
    }
    return res;
  }

  // Passwords a message gives for its attachment: "password: X", "code: X", or the
  // recipient's own address ("enter your email address as the password").
  function passwordHints(text, recipients) {
    const t = String(text || "").normalize("NFKC");
    const out = [];
    const re = /(?:password|passcode|pass code|code|contrase[ñn]a|clave|mot de passe|senha|passwort|kennwort|wachtwoord)\s*(?:is|es|est|[eé]|ist|:|=)?\s*[:=]?\s*["'“«]?([A-Za-z0-9!@#$%^&*._+-]{3,32})/gi;
    let m;
    while ((m = re.exec(t))) if (out.indexOf(m[1]) < 0 && !/^(is|es|est|the|your|votre|su|to|for|field|when|will)$/i.test(m[1])) out.push(m[1]);
    if (/(e-?mail|courriel|correo)(\s+address|\s+adresse)?[^.\n]{0,60}(password|mot de passe|contrase[ñn]a|senha)|(password|mot de passe|contrase[ñn]a|senha)[^.\n]{0,60}(e-?mail|courriel|correo)/i.test(t)) {
      for (const r of recipients || []) if (r && out.indexOf(r) < 0) out.push(r, r.toLowerCase());
    }
    return out.slice(0, 12);
  }

  function isPdf(name, contentType) {
    return /application\/(pdf|x-pdf)/i.test(contentType || "") || /\.pdf$/i.test(name || "");
  }

  return { scan, passwordHints, isPdf, md5, rc4 };
});
