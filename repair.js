/**
 * Repairs binary files whose CR/LF bytes were rebuilt after a line-ending conversion (see
 * msg.js). Each "token" left by the conversion was a lone LF, a lone CR or a CR LF pair;
 * msg.js wrote lone tokens as LF and placed the right number of pairs per region. The
 * file's own structure settles the rest: zlib streams must inflate to their Adler-32, a
 * JPEG scan must decode to the end into a smooth image, PDF streams have a /Length.
 *
 * Positions are given as Sets: `lone` (offsets of rebuilt single bytes) and `pairs`
 * (offsets of the CR of a rebuilt CR LF pair). Nothing here executes file content.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./inflate-zlib.js").inflateZlib);
  else root.PeelRepair = factory(root.inflateZlib);
})(typeof globalThis !== "undefined" ? globalThis : this, function (inflateZlib) {
  "use strict";

  const LF = 0, CR = 1, PAIR = 2;
  const BYTES = [[0x0a], [0x0d], [0x0d, 0x0a]];

  // Units of bytes[start, end): plain bytes and tokens.
  function units(bytes, start, end, lone, pairs) {
    const val = [], tok = [];
    let nPairs = 0;
    for (let i = start; i < end; i++) {
      if (pairs.has(i) && i + 1 < end) {
        val.push(0); tok.push(1); nPairs++; i++;
      } else if (lone.has(i)) {
        val.push(0); tok.push(1);
      } else {
        val.push(bytes[i]); tok.push(0);
      }
    }
    return { val, tok, nPairs, n: val.length };
  }
  function realize(u, ch, from, to) {
    const out = [];
    for (let i = from || 0; i < (to === undefined ? u.n : to); i++) {
      if (!u.tok[i]) out.push(u.val[i]);
      else for (const b of BYTES[ch[i] > 0 ? ch[i] : LF]) out.push(b);
    }
    return Uint8Array.from(out);
  }
  const tokensIn = (u, from, to) => {
    const t = [];
    for (let i = from; i < to; i++) if (u.tok[i]) t.push(i);
    return t;
  };

  // --- zlib ------------------------------------------------------------------------------
  function adler32(b) {
    let a = 1, s = 0;
    for (let i = 0; i < b.length; i++) {
      a = (a + b[i]) % 65521;
      s = (s + a) % 65521;
    }
    return ((s << 16) | a) >>> 0;
  }
  function zlibOk(z) {
    if (z.length < 6 || (z[0] & 0x0f) !== 8 || ((z[0] << 8) | z[1]) % 31) return false;
    let out;
    try {
      out = inflateZlib(z);
    } catch (_) {
      return false;
    }
    const want = adler32(out);
    for (let end = z.length; end >= z.length - 3 && end >= 6; end--) {
      if ((((z[end - 4] << 24) | (z[end - 3] << 16) | (z[end - 2] << 8) | z[end - 1]) >>> 0) === want) return true;
    }
    return false;
  }
  const FLATE_TRIES = 1 << 14;
  // Choices for the tokens of a zlib stream (units from..to) that make it inflate to its
  // checksum, with exactly nPairs pairs; null when none is found within the budget.
  function flateChoices(u, ch, from, to, nPairs) {
    const toks = tokensIn(u, from, to);
    if (!toks.length) return zlibOk(realize(u, ch, from, to));
    let combos = 1;
    for (let k = 0; k < nPairs; k++) combos = (combos * (toks.length - k)) / (k + 1);
    combos *= Math.pow(2, toks.length - nPairs);
    if (combos > FLATE_TRIES) return false;
    function walk(t, pairsLeft) {
      if (t === toks.length) return pairsLeft === 0 && zlibOk(realize(u, ch, from, to));
      const left = toks.length - t;
      for (const opt of [LF, CR, PAIR]) {
        if (opt === PAIR ? pairsLeft === 0 : pairsLeft >= left) continue;
        ch[toks[t]] = opt;
        if (walk(t + 1, pairsLeft - (opt === PAIR ? 1 : 0))) return true;
      }
      return false;
    }
    return walk(0, nPairs);
  }

  // --- JPEG ------------------------------------------------------------------------------
  const NATURAL = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
  const STD_L = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const STD_C = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99].concat(new Array(32).fill(99));
  const scaledCache = new Map();
  // A standard table at IJG quality q, in the zig-zag order a DQT stores it.
  function scaled(std, q) {
    const key = (std === STD_L ? "l" : "c") + q;
    if (!scaledCache.has(key)) {
      const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
      scaledCache.set(key, NATURAL.map((n) => Math.min(255, Math.max(1, Math.floor((std[n] * scale + 50) / 100)))));
    }
    return scaledCache.get(key);
  }

  // DQT tokens: most encoders scale the standard tables, so every value but the rebuilt
  // ones must match one quality; the rebuilt ones then take that table's values.
  function fitDqt(u, ch, from, to, nPairs) {
    function match(i, exp, j, pairsLeft, picks) {
      if (j === 64) return { next: i, pairsLeft, picks };
      if (i >= to) return null;
      if (!u.tok[i]) return u.val[i] === exp[j] ? match(i + 1, exp, j + 1, pairsLeft, picks) : null;
      if (exp[j] === 13 && exp[j + 1] === 10 && pairsLeft > 0) {
        const m = match(i + 1, exp, j + 2, pairsLeft - 1, picks.concat([[i, PAIR]]));
        if (m) return m;
      }
      if (exp[j] === 10 || exp[j] === 13) return match(i + 1, exp, j + 1, pairsLeft, picks.concat([[i, exp[j] === 10 ? LF : CR]]));
      return null;
    }
    function tables(i, pairsLeft) {
      if (i === to) return pairsLeft === 0 ? [] : null;
      if (u.tok[i] || u.val[i] >> 4) return null;
      for (const std of u.val[i] & 15 ? [STD_C, STD_L] : [STD_L, STD_C]) {
        for (let q = 100; q >= 1; q--) {
          const m = match(i + 1, scaled(std, q), 0, pairsLeft, []);
          if (!m) continue;
          const rest = tables(m.next, m.pairsLeft);
          if (rest) return m.picks.concat(rest);
        }
      }
      return null;
    }
    const picks = tables(from, nPairs);
    if (!picks) return false;
    for (const [i, opt] of picks) ch[i] = opt;
    return true;
  }

  function buildLut(counts, symbols) {
    const lut = new Int32Array(65536);
    let code = 0, k = 0;
    for (let len = 1; len <= 16; len++) {
      for (let i = 0; i < counts[len - 1]; i++) {
        const shift = 16 - len;
        const base = code << shift;
        if (base + (1 << shift) > 65536) return null;
        lut.fill((len << 8) | symbols[k++], base, base + (1 << shift));
        code++;
      }
      code <<= 1;
    }
    return lut;
  }

  // Header segments up to SOS: settles their tokens (lengths say how many pairs each
  // holds) and reads the tables. Returns null for what is not a baseline JPEG.
  function jpegHeader(u, ch, opts) {
    const { val, tok, n } = u;
    if (tok[0] || tok[1] || val[0] !== 0xff || val[1] !== 0xd8) return null;
    const h = { q: [], dc: [], ac: [], comps: [], ri: 0, pairs: 0 };
    let i = 2;
    while (i + 3 < n) {
      if (tok[i] || val[i] !== 0xff || tok[i + 1]) return null;
      const m = val[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd9 || tok[i + 2] || tok[i + 3]) return null;
      const L = (val[i + 2] << 8) | val[i + 3];
      const from = i + 4;
      let found = null;
      for (let q = 0; q <= 8 && !found; q++) {
        const to = from + L - 2 - q;
        if (to < from || to + 1 >= n) continue;
        if (tokensIn(u, from, to).length < q) continue;
        if (m !== 0xda && (tok[to] || val[to] !== 0xff || tok[to + 1] || val[to + 1] === 0)) continue;
        found = { to, q };
      }
      if (!found) return null;
      const { to, q } = found;
      if (m !== 0xdb || !fitDqt(u, ch, from, to, q)) {
        tokensIn(u, from, to).forEach((t, k) => { ch[t] = k < q ? PAIR : LF; });
      }
      h.pairs += q;
      const seg = realize(u, ch, from, to);
      if (m === 0xdb) {
        for (let p = 0; p + 65 <= seg.length; p += 65 + (seg[p] >> 4) * 64) {
          const wide = seg[p] >> 4;
          h.q[seg[p] & 15] = Array.from({ length: 64 }, (_, k) => (wide ? (seg[p + 1 + 2 * k] << 8) | seg[p + 2 + 2 * k] : seg[p + 1 + k]));
        }
      } else if (m === 0xc4) {
        for (let p = 0; p + 17 <= seg.length;) {
          const counts = Array.from(seg.subarray(p + 1, p + 17));
          const total = counts.reduce((a, b) => a + b, 0);
          const lut = buildLut(counts, seg.subarray(p + 17, p + 17 + total));
          if (!lut) return null;
          (seg[p] >> 4 ? h.ac : h.dc)[seg[p] & 15] = lut;
          p += 17 + total;
        }
      } else if (m === 0xc0 || m === 0xc1) {
        h.height = opts.height || (seg[1] << 8) | seg[2];
        h.width = opts.width || (seg[3] << 8) | seg[4];
        for (let c = 0; c < seg[5]; c++) h.comps.push({ id: seg[6 + c * 3], H: seg[7 + c * 3] >> 4, V: seg[7 + c * 3] & 15, tq: seg[8 + c * 3] });
      } else if (m === 0xdd) {
        h.ri = (seg[0] << 8) | seg[1];
      } else if (m === 0xda) {
        if (!h.comps.length) return null;
        h.scan = [];
        for (let c = 0; c < seg[0]; c++) {
          const comp = h.comps.find((x) => x.id === seg[1 + c * 2]);
          if (!comp) return null;
          h.scan.push({ comp, dc: h.dc[seg[2 + c * 2] >> 4], ac: h.ac[seg[2 + c * 2] & 15] });
        }
        if (h.scan.some((s) => !s.dc || !s.ac)) return null;
        h.start = to;
        return h;
      } else if ((m >= 0xc2 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)) {
        return null; // progressive, lossless, arithmetic
      }
      i = to;
    }
    return null;
  }

  // Block layout of one MCU. The cost that tells a right token from a wrong one: a wrong
  // byte desynchronises the Huffman codes, and the blocks decoded from then on no longer
  // continue their neighbours, so the pixels along each block's top and left edges are
  // compared with the block above and the block to the left, in every component.
  function scanLayout(h) {
    const single = h.scan.length === 1;
    const Hmax = Math.max.apply(null, h.comps.map((c) => c.H));
    const Vmax = Math.max.apply(null, h.comps.map((c) => c.V));
    const blocks = [];
    h.scan.forEach((s, si) => {
      const H = single ? 1 : s.comp.H, V = single ? 1 : s.comp.V;
      const qz = h.q[s.comp.tq] || new Array(64).fill(1);
      for (let v = 0; v < V; v++) for (let x = 0; x < H; x++) blocks.push({ si, dc: s.dc, ac: s.ac, x, v, H, V, qz });
    });
    const s0 = h.scan[0].comp;
    const cols = single ? Math.ceil((h.width * s0.H) / Hmax / 8) : Math.ceil(h.width / (8 * Hmax));
    const rows = single ? Math.ceil((h.height * s0.V) / Vmax / 8) : Math.ceil(h.height / (8 * Vmax));
    const comps = h.scan.map((s) => (single ? { H: 1, V: 1 } : { H: s.comp.H, V: s.comp.V }));
    return { blocks, cols, total: cols * rows, ri: h.ri, comps };
  }

  // Edge pixels of a block from its coefficients, accumulated as they are decoded:
  // acc[0..7] row 0, [8..15] row 7, [16..23] column 0, [24..31] column 7, per frequency.
  const A0 = [], A7 = [], BX = [];
  for (let i = 0; i < 8; i++) {
    const c = (i === 0 ? Math.SQRT1_2 : 1) / 2;
    A0[i] = c * Math.cos((i * Math.PI) / 16);
    A7[i] = c * Math.cos((15 * i * Math.PI) / 16);
    for (let x = 0; x < 8; x++) BX[x * 8 + i] = c * Math.cos(((2 * x + 1) * i * Math.PI) / 16);
  }
  function addCoef(acc, n, F) {
    const v = n >> 3, u = n & 7;
    acc[u] += A0[v] * F;
    acc[8 + u] += A7[v] * F;
    acc[16 + v] += A0[u] * F;
    acc[24 + v] += A7[u] * F;
  }
  const EDGE = new Float64Array(32);
  function edges(acc) {
    for (let e = 0; e < 4; e++) {
      for (let x = 0; x < 8; x++) {
        let sum = 0;
        for (let u = 0; u < 8; u++) sum += BX[x * 8 + u] * acc[e * 8 + u];
        EDGE[e * 8 + x] = sum;
      }
    }
    return EDGE;
  }

  // Per component: bottom rows of the MCU row above (shared, read-only) and of the row
  // being decoded, and the bottom rows / right columns of the current and previous MCU.
  function newState(lay) {
    const per = (f) => lay.comps.map(f);
    return { buf: 0, cnt: 0, ff: false, rst: false, mcu: 0, b: 0, k: 0, phase: 0, need: 0, isDc: false, dc: new Int32Array(lay.comps.length), acc: new Float64Array(32), prevBot: per(() => null), curBot: per((c) => new Int16Array(lay.cols * c.H * 8)), mcuBot: per((c) => new Int16Array(c.H * c.V * 8)), mcuRight: per((c) => new Int16Array(c.H * c.V * 8)), leftRight: per((c) => new Int16Array(c.V * 8)), cost: 0, pairs: 0, dead: false, node: null };
  }
  const copies = (list) => list.map((a) => a.slice());
  function clone(s) {
    return { buf: s.buf, cnt: s.cnt, ff: s.ff, rst: s.rst, mcu: s.mcu, b: s.b, k: s.k, phase: s.phase, need: s.need, isDc: s.isDc, dc: s.dc.slice(), acc: s.acc.slice(), prevBot: s.prevBot, curBot: copies(s.curBot), mcuBot: copies(s.mcuBot), mcuRight: copies(s.mcuRight), leftRight: copies(s.leftRight), cost: s.cost, pairs: s.pairs, dead: false, node: s.node };
  }
  const extend = (v, n) => (n && v < 1 << (n - 1) ? v - (1 << n) + 1 : v);

  function blockCost(s, lay, blk) {
    const E = edges(s.acc);
    const c = blk.si, H = blk.H, col = s.mcu % lay.cols;
    let cost = 0;
    const above = blk.v > 0 ? [s.mcuBot[c], ((blk.v - 1) * H + blk.x) * 8] : s.prevBot[c] ? [s.prevBot[c], (col * H + blk.x) * 8] : null;
    if (above) for (let x = 0; x < 8; x++) cost += Math.abs(E[x] - above[0][above[1] + x]);
    const left = blk.x > 0 ? [s.mcuRight[c], (blk.v * H + blk.x - 1) * 8] : col > 0 ? [s.leftRight[c], blk.v * 8] : null;
    if (left) for (let y = 0; y < 8; y++) cost += Math.abs(E[16 + y] - left[0][left[1] + y]);
    for (let i = 0; i < 32; i++) if (Math.abs(E[i]) > 160) cost += Math.abs(E[i]) - 160;
    const at = (blk.v * H + blk.x) * 8;
    for (let i = 0; i < 8; i++) {
      s.mcuBot[c][at + i] = E[8 + i];
      s.mcuRight[c][at + i] = E[24 + i];
    }
    if (blk.v === blk.V - 1) for (let i = 0; i < 8; i++) s.curBot[c][(col * H + blk.x) * 8 + i] = E[8 + i];
    s.cost += cost;
  }
  function endBlock(s, lay) {
    blockCost(s, lay, lay.blocks[s.b]);
    s.k = 0;
    s.acc.fill(0);
    if (++s.b < lay.blocks.length) return;
    s.b = 0;
    lay.comps.forEach((c, ci) => {
      for (let v = 0; v < c.V; v++) for (let i = 0; i < 8; i++) s.leftRight[ci][v * 8 + i] = s.mcuRight[ci][(v * c.H + c.H - 1) * 8 + i];
    });
    s.mcu++;
    if (s.mcu % lay.cols === 0) {
      s.prevBot = s.curBot;
      s.curBot = s.curBot.map((a) => new Int16Array(a.length));
    }
    if (lay.ri && s.mcu % lay.ri === 0 && s.mcu < lay.total) s.rst = true;
  }
  function gotDc(s, lay, diff) {
    const blk = lay.blocks[s.b];
    addCoef(s.acc, 0, (s.dc[blk.si] += diff) * blk.qz[0]);
    s.k = 1;
  }
  function decode(s, lay) {
    for (;;) {
      if (s.dead || s.rst || s.mcu >= lay.total) return;
      if (s.phase === 0) {
        if (s.cnt < 16) return;
        const blk = lay.blocks[s.b];
        const e = (s.k === 0 ? blk.dc : blk.ac)[(s.buf >>> (s.cnt - 16)) & 0xffff];
        if (!e) { s.dead = true; return; }
        s.cnt -= e >> 8;
        const sym = e & 0xff;
        if (s.k === 0) {
          if (sym > 11) { s.dead = true; return; }
          if (sym === 0) { gotDc(s, lay, 0); continue; }
          s.need = sym; s.isDc = true; s.phase = 1;
        } else {
          const r = sym >> 4, size = sym & 15;
          if (size === 0) {
            if (r === 15) {
              s.k += 16;
              if (s.k > 64) { s.dead = true; return; }
              if (s.k === 64) endBlock(s, lay);
              continue;
            }
            endBlock(s, lay);
            continue;
          }
          if (size > 10) { s.dead = true; return; }
          s.k += r;
          if (s.k > 63) { s.dead = true; return; }
          s.need = size; s.isDc = false; s.phase = 1;
        }
      } else {
        if (s.cnt < s.need) return;
        const v = (s.buf >>> (s.cnt - s.need)) & ((1 << s.need) - 1);
        s.cnt -= s.need;
        s.phase = 0;
        if (s.isDc) gotDc(s, lay, extend(v, s.need));
        else {
          addCoef(s.acc, NATURAL[s.k], extend(v, s.need) * lay.blocks[s.b].qz[s.k]);
          if (++s.k === 64) endBlock(s, lay);
        }
      }
    }
  }
  function bits8(s, lay, byte) {
    s.buf = ((s.buf << 8) | byte) >>> 0;
    s.cnt += 8;
    decode(s, lay);
  }
  // One byte of the scan: 0xFF waits for the next byte (stuffing, or a restart marker,
  // before which the interval's last bits are completed with 1-bit padding).
  function push(s, lay, byte) {
    if (s.dead) return;
    if (s.ff) {
      s.ff = false;
      if (byte === 0x00) return bits8(s, lay, 0xff);
      if (byte >= 0xd0 && byte <= 0xd7) {
        for (let k = 0; k < 3 && !s.rst && !s.dead; k++) bits8(s, lay, 0xff);
        if (!s.rst) { s.dead = true; return; }
        s.rst = false; s.buf = 0; s.cnt = 0; s.phase = 0; s.k = 0; s.dc.fill(0);
        return;
      }
      s.dead = true;
      return;
    }
    if (byte === 0xff) { s.ff = true; return; }
    if (s.rst) { s.dead = true; return; }
    bits8(s, lay, byte);
  }
  function finish(s, lay) {
    for (let k = 0; k < 3 && !s.dead && s.mcu < lay.total; k++) bits8(s, lay, 0xff);
    return !s.dead && s.mcu >= lay.total;
  }
  const signature = (s) => [s.mcu, s.b, s.k, s.phase, s.need, s.cnt, s.cnt ? s.buf & ((1 << s.cnt) - 1) : 0, s.ff ? 1 : 0, s.rst ? 1 : 0, s.pairs].concat(Array.from(s.dc)).join(",");

  const BEAM = 16;
  /**
   * Settles the tokens of a JPEG (units 0..u.n, SOI first) holding nPairs pairs. Returns
   * {ok, verified} — verified when the scan decodes to its last block with nothing left
   * over; ch gets the choices either way.
   */
  function jpegChoices(u, ch, nPairs, opts) {
    const h = jpegHeader(u, ch, opts || {});
    if (!h) return { ok: false };
    let eoi = -1;
    for (let i = u.n - 2; i >= h.start; i--) if (!u.tok[i] && !u.tok[i + 1] && u.val[i] === 0xff && u.val[i + 1] === 0xd9) { eoi = i; break; }
    if (eoi < 0) return { ok: false };
    const lay = scanLayout(h);
    if (!lay.total || lay.total > 400000) return { ok: false };
    const toks = tokensIn(u, h.start, eoi);
    const need = nPairs - h.pairs;
    if (need < 0 || need > toks.length) return { ok: false };
    function feed(s, from, to) {
      for (let i = from; i < to && !s.dead; i++) push(s, lay, u.val[i]);
    }
    let states = [newState(lay)];
    feed(states[0], h.start, toks.length ? toks[0] : eoi);
    for (let t = 0; t < toks.length; t++) {
      const next = new Map();
      const left = toks.length - t - 1;
      const until = t + 1 < toks.length ? toks[t + 1] : eoi;
      for (const s of states) {
        for (const opt of [LF, CR, PAIR]) {
          const p = s.pairs + (opt === PAIR ? 1 : 0);
          if (p > need || need - p > left) continue;
          const c = clone(s);
          c.pairs = p;
          c.node = { t, opt, up: s.node };
          for (const b of BYTES[opt]) push(c, lay, b);
          feed(c, toks[t] + 1, until);
          if (c.dead) continue;
          const sig = signature(c);
          const prev = next.get(sig);
          if (!prev || c.cost < prev.cost) next.set(sig, c);
        }
      }
      states = Array.from(next.values()).sort((a, b) => a.cost - b.cost).slice(0, BEAM);
      if (!states.length) return { ok: false };
    }
    let best = null, verified = false;
    for (const s of states) {
      if (s.pairs !== need) continue;
      const done = finish(clone(s), lay);
      if (!best || (done && !verified) || (done === verified && s.cost < best.cost)) {
        best = s;
        verified = done;
      }
    }
    if (!best) return { ok: false };
    for (let node = best.node; node; node = node.up) ch[toks[node.t]] = node.opt;
    return { ok: true, verified };
  }

  // --- Files -----------------------------------------------------------------------------
  function latin1(b) {
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return s;
  }

  /** A JPEG file. Returns {bytes, verified, ok}. */
  function jpeg(bytes, lone, pairs, opts) {
    const u = units(bytes, 0, bytes.length, lone, pairs);
    const ch = new Int8Array(u.n).fill(-1);
    const r = jpegChoices(u, ch, u.nPairs, opts);
    if (!r.ok) return { bytes, ok: false, verified: false };
    const out = realize(u, ch);
    return out.length === bytes.length ? { bytes: out, ok: true, verified: r.verified } : { bytes, ok: false, verified: false };
  }

  /**
   * A PDF: its zlib and JPEG streams are repaired in place (each keeps its length).
   * Returns {bytes, streams, repaired, verified, unresolved}.
   */
  function pdf(bytes, lone, pairs) {
    const out = Uint8Array.from(bytes);
    const s = latin1(out);
    const rep = { bytes: out, streams: 0, repaired: 0, verified: 0, unresolved: 0 };
    const objAt = (num) => {
      const m = new RegExp("(?:^|[\\r\\n\\s])" + num + "\\s+0\\s+obj\\s*(\\d+)\\s*endobj").exec(s);
      return m ? +m[1] : null;
    };
    const re = /stream(?=[\r\n])/g;
    let m;
    while ((m = re.exec(s))) {
      if (s.slice(m.index - 3, m.index) === "end") continue;
      const dictStart = s.lastIndexOf(" obj", m.index);
      if (dictStart < 0) continue;
      const dict = s.slice(dictStart, m.index);
      if (!/>>\s*$/.test(dict)) continue;
      let len = (dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)\b/) || [])[1];
      if (len === undefined) {
        const ind = dict.match(/\/Length\s+(\d+)\s+\d+\s+R/);
        len = ind ? objAt(ind[1]) : null;
      }
      if (len == null) continue;
      len = +len;
      let start = m.index + 6;
      if (pairs.has(start)) start += 2;
      else {
        if (lone.has(start)) out[start] = 0x0a;
        start += 1;
      }
      const end = s.indexOf("endstream", start + len - 2);
      if (end < 0 || end - start > len + 2) continue;
      rep.streams++;
      const u = units(out, start, end, lone, pairs);
      if (!u.tok.some(Boolean)) continue;
      // The EOL before "endstream" is the last unit when the region is longer than /Length.
      const tail = end - start - len;
      const ch = new Int8Array(u.n).fill(-1);
      let dataUnits = u.n, dataPairs = u.nPairs;
      if (tail > 0) {
        if (!u.tok[u.n - 1]) continue;
        ch[u.n - 1] = tail === 2 ? PAIR : LF;
        dataUnits--;
        dataPairs -= tail === 2 ? 1 : 0;
      }
      if (dataPairs < 0 || dataUnits + dataPairs !== len) continue;
      const data = { val: u.val.slice(0, dataUnits), tok: u.tok.slice(0, dataUnits), n: dataUnits };
      const filter = (dict.match(/\/Filter\s*\[?\s*\/(\w+)/) || [])[1];
      let ok = false, verified = false;
      if (filter === "FlateDecode") {
        ok = verified = flateChoices(data, ch, 0, dataUnits, dataPairs);
      } else if (filter === "DCTDecode") {
        const r = jpegChoices(data, ch, dataPairs, { width: +((dict.match(/\/Width\s+(\d+)/) || [])[1] || 0), height: +((dict.match(/\/Height\s+(\d+)/) || [])[1] || 0) });
        ok = r.ok;
        verified = r.verified;
      }
      if (!ok) {
        rep.unresolved++;
        continue;
      }
      const fixed = realize(u, ch);
      if (fixed.length !== end - start) {
        rep.unresolved++;
        continue;
      }
      out.set(fixed, start);
      rep.repaired++;
      if (verified) rep.verified++;
    }
    return rep;
  }

  return { pdf, jpeg, units, realize, jpegChoices, flateChoices, adler32 };
});
