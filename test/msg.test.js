const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const M = require("../msg.js");
const R = require("../repair.js");
const N = require("../nested.js");
const P = require("../pdfscan.js");
require("../phones.js");
const S = require("../signals.js");

// Synthetic text image (no real message content), made for these tests.
const JPEG = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "lure-text.jpg")));

const NOS = 0xffffffff, END = 0xfffffffe, FATSECT = 0xfffffffd, FREE = 0xffffffff;
const MSS = 64, CUTOFF = 4096;
const u32 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; };
const u16 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; };
const utf16 = (s) => new Uint8Array(Buffer.from(s, "utf16le"));
const latin1 = (s) => new Uint8Array(Buffer.from(s, "latin1"));
const u32of = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const concat = (list) => Uint8Array.from(Buffer.concat(list.map((x) => Buffer.from(x))));

// A compound file, version 4 (4096-byte sectors) or 3 (512): node = {name, children} or
// {name, data}.
function buildCfb(root, SS = 4096) {
  const entries = [];
  (function add(node, type) {
    const e = { node, type, left: NOS, right: NOS, child: NOS, start: END, size: 0 };
    entries.push(e);
    // Siblings as a (degenerate) search tree: ordered by name length, then name.
    const kids = (node.children || []).slice().sort((x, y) => x.name.length - y.name.length || (x.name.toUpperCase() < y.name.toUpperCase() ? -1 : 1));
    const ids = kids.map((c) => { const id = entries.length; add(c, c.children ? 1 : 2); return id; });
    for (let i = 0; i + 1 < ids.length; i++) entries[ids[i]].right = ids[i + 1];
    if (ids.length) e.child = ids[0];
  })(root, 5);
  const sectors = [], fat = [];
  function chain(bytes) {
    const n = Math.max(1, Math.ceil(bytes.length / SS)), start = sectors.length;
    for (let i = 0; i < n; i++) {
      const s = new Uint8Array(SS);
      s.set(bytes.subarray(i * SS, (i + 1) * SS));
      sectors.push(s);
      fat.push(i < n - 1 ? start + i + 1 : END);
    }
    return start;
  }
  const mini = [], minifat = [];
  for (const e of entries) {
    if (e.type !== 2) continue;
    const d = e.node.data;
    e.size = d.length;
    if (d.length >= CUTOFF) e.start = chain(d);
    else if (d.length) {
      const n = Math.ceil(d.length / MSS);
      e.start = mini.length;
      for (let i = 0; i < n; i++) {
        const s = new Uint8Array(MSS);
        s.set(d.subarray(i * MSS, (i + 1) * MSS));
        mini.push(s);
        minifat.push(i < n - 1 ? e.start + i + 1 : END);
      }
    }
  }
  const miniBytes = concat(mini);
  entries[0].size = miniBytes.length;
  entries[0].start = miniBytes.length ? chain(miniBytes) : END;
  const mf = new Uint8Array(Math.ceil((minifat.length * 4) / SS) * SS).fill(0xff);
  minifat.forEach((v, i) => u32(mf, i * 4, v));
  const minifatStart = minifat.length ? chain(mf) : END;
  const nMinifat = mf.length / SS;
  const dir = new Uint8Array(Math.ceil((entries.length * 128) / SS) * SS);
  for (let i = entries.length; i < dir.length / 128; i++) for (const o of [68, 72, 76]) u32(dir, i * 128 + o, NOS);
  entries.forEach((e, i) => {
    const b = i * 128;
    dir.set(utf16(e.node.name), b);
    u16(dir, b + 64, (e.node.name.length + 1) * 2);
    dir[b + 66] = e.type;
    dir[b + 67] = 1;
    u32(dir, b + 68, e.left);
    u32(dir, b + 72, e.right);
    u32(dir, b + 76, e.child);
    u32(dir, b + 116, e.start);
    u32(dir, b + 120, e.size);
  });
  const dirStart = chain(dir);
  // FAT sectors, and DIFAT sectors listing those past the header's 109.
  const per = SS / 4;
  let nFat = 1, nDif = 0;
  for (;;) {
    nDif = Math.max(0, Math.ceil((nFat - 109) / (per - 1)));
    if (sectors.length + nFat + nDif <= nFat * per) break;
    nFat++;
  }
  const difStart = sectors.length;
  for (let i = 0; i < nDif; i++) { fat.push(0xfffffffc); sectors.push(new Uint8Array(SS).fill(0xff)); }
  const fatStart = sectors.length;
  for (let i = 0; i < nFat; i++) { fat.push(FATSECT); sectors.push(new Uint8Array(SS)); }
  fat.forEach((v, i) => u32(sectors[fatStart + Math.floor(i / per)], (i % per) * 4, v));
  for (let i = fat.length; i < nFat * per; i++) u32(sectors[fatStart + Math.floor(i / per)], (i % per) * 4, FREE);
  for (let i = 109; i < nFat; i++) {
    const j = i - 109, ds = difStart + Math.floor(j / (per - 1));
    u32(sectors[ds], (j % (per - 1)) * 4, fatStart + i);
  }
  for (let i = 0; i < nDif; i++) u32(sectors[difStart + i], (per - 1) * 4, i + 1 < nDif ? difStart + i + 1 : END);
  const head = new Uint8Array(SS);
  head.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  u16(head, 24, 0x3e); u16(head, 26, SS === 4096 ? 4 : 3); u16(head, 28, 0xfffe); u16(head, 30, SS === 4096 ? 12 : 9); u16(head, 32, 6);
  u32(head, 40, SS === 4096 ? Math.ceil(dir.length / SS) : 0); u32(head, 44, nFat); u32(head, 48, dirStart); u32(head, 56, CUTOFF);
  u32(head, 60, minifatStart); u32(head, 64, minifat.length ? nMinifat : 0); u32(head, 68, nDif ? difStart : END); u32(head, 72, nDif);
  for (let i = 0; i < 109; i++) u32(head, 76 + i * 4, i < nFat ? fatStart + i : FREE);
  return concat([head].concat(sectors));
}

const prop = (tag, data) => ({ name: "__substg1.0_" + tag, data });
function fixedProps(header, list) {
  const b = new Uint8Array(header + list.length * 16);
  list.forEach(([tag, value], i) => { u32(b, header + i * 16, tag); u32(b, header + i * 16 + 4, 6); u32(b, header + i * 16 + 8, value); });
  return { name: "__properties_version1.0", data: b };
}

// A one-page PDF: a JPEG page image and a zlib content stream, with LF line ends and a
// cross-reference table. The content text is padded until its zlib form holds CR and LF
// bytes, so the damage touches it.
function buildPdf(jpeg) {
  let content, z;
  for (let pad = 0; ; pad++) {
    content = "q 612 0 0 120 0 0 cm /Im0 Do Q\nBT /F1 12 Tf 20 20 Td (Call our billing desk at +1 888 555 0142) Tj ET\n%" + "x".repeat(pad) + "\n";
    z = zlib.deflateSync(Buffer.from(content, "latin1"), { level: 9 });
    if (z.includes(0x0a) && z.includes(0x0d)) break;
  }
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 120] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>",
    ["<< /Type /XObject /Subtype /Image /Width 612 /Height 120 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>", jpeg],
    ["<< /Filter /FlateDecode /Length " + z.length + " >>", new Uint8Array(z)],
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const parts = [latin1("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  let at = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(at);
    const chunk = Array.isArray(o) ? concat([latin1(i + 1 + " 0 obj\n" + o[0] + "\nstream\n"), o[1], latin1("\nendstream\nendobj\n")]) : latin1(i + 1 + " 0 obj\n" + o + "\nendobj\n");
    parts.push(chunk);
    at += chunk.length;
  });
  const xref = "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + at + "\n%%EOF\n";
  parts.push(latin1(xref));
  return { pdf: concat(parts), content };
}

const HEADERS = "Received: from mail.sender.example ([192.0.2.10]) by mx.example.org\r\nFrom: \"Billing Team\" <billing@sender.example>\r\nTo: <analyst@example.org>\r\nSubject: Your plan renewal\r\nDate: Fri, 23 Oct 2026 10:00:00 +0000\r\nMessage-ID: <synthetic-1@sender.example>\r\nMIME-Version: 1.0\r\n\r\n";
const HTML = "<html><head>\r\n<meta charset=\"utf-8\">\r\n</head><body>\n<p>Please see the attached notice.</p>\r\n<p>Thank you.</p></body></html>";

function buildMsg() {
  const { pdf, content } = buildPdf(JPEG);
  const root = {
    name: "Root Entry",
    children: [
      prop("0037001F", utf16("Your plan renewal")),
      prop("0C1A001F", utf16("Billing Team")),
      prop("0C1F001F", utf16("billing@sender.example")),
      prop("007D001F", utf16(HEADERS)),
      prop("10130102", latin1(HTML)),
      fixedProps(32, [[0x3ffd0003, 1252]]),
      { name: "__recip_version1.0_#00000000", children: [prop("3001001F", utf16("Analyst")), prop("3003001F", utf16("analyst@example.org")), fixedProps(8, [[0x0c150003, 1]])] },
      { name: "__attach_version1.0_#00000000", children: [prop("3707001F", utf16("NOTICE.pdf")), prop("370E001F", utf16("application/pdf")), prop("37010102", pdf), fixedProps(8, [])] },
    ],
  };
  return { msg: buildCfb(root), pdf, content };
}

// What a text conversion does: a CR LF first, every lone CR or LF byte becomes CR LF.
function damage(b) {
  const out = [0x0d, 0x0a];
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0x0d && b[i + 1] === 0x0a) { out.push(0x0d, 0x0a); i++; }
    else if (b[i] === 0x0d || b[i] === 0x0a) out.push(0x0d, 0x0a);
    else out.push(b[i]);
  }
  return Uint8Array.from(out);
}
const pairsIn = (b) => { let n = 0; for (let i = 0; i + 1 < b.length; i++) if (b[i] === 0x0d && b[i + 1] === 0x0a) { n++; i++; } return n; };
const unify = (s) => String(s).replace(/\r\n?/g, "\n");

// Random messages for the layout tests (fixed seed): text with CR LF and LF line ends,
// small and large binary attachments, in a different order each time.
function randomMessages(seed, count, sectorSize) {
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const words = ["invoice", "payment", "account", "update", "please", "review", "attached", "notice"];
  const text = (n, eol) => { let t = ""; while (t.length < n) t += words[Math.floor(rnd() * words.length)] + (rnd() < 0.1 ? eol() : " "); return t; };
  const out = [];
  for (let k = 0; k < count; k++) {
    const subject = text(10 + Math.floor(rnd() * 60), () => " ").trim();
    const headers = "Subject: " + subject + "\r\nMessage-ID: <m" + k + "@x.example>\r\n" + text(Math.floor(rnd() * 6000), () => "\r\nX-H: ") + "\r\n\r\n";
    const html = "<html><body>" + text(Math.floor(rnd() * 9000), () => (rnd() < 0.5 ? "\r\n" : "\n")) + "</body></html>";
    const atts = [];
    for (let a = Math.floor(rnd() * 3); a > 0; a--) {
      const data = new Uint8Array(rnd() < 0.4 ? Math.floor(rnd() * 4000) + 10 : Math.floor(rnd() * 120000) + 4096).map(() => Math.floor(rnd() * 256));
      data.set([0x89, 0x50, 0x4e, 0x47]);
      atts.push({ name: "file" + a + ".png", data });
    }
    const children = [prop("0037001F", utf16(subject)), prop("007D001F", utf16(headers)), prop("10130102", latin1(html)), fixedProps(32, [[0x3ffd0003, 1252]])]
      .concat(atts.map((a, i) => ({ name: "__attach_version1.0_#0000000" + i, children: [prop("3707001F", utf16(a.name)), prop("37010102", a.data), fixedProps(8, [])] })));
    if (rnd() < 0.5) children.reverse();
    out.push({ msg: buildCfb({ name: "Root Entry", children }, sectorSize), subject, id: "<m" + k + "@x.example>", html, atts });
  }
  return out;
}

test("an Outlook .msg is recognised, also behind the CR LF a conversion adds", () => {
  const { msg } = buildMsg();
  assert.ok(M.isMsg(msg));
  assert.ok(M.isMsg(damage(msg)));
  assert.ok(!M.isMsg(latin1("From: someone@example.org\r\n\r\nhi")));
});

test("an intact .msg gives its message, recipients and the attachment byte for byte", () => {
  const { msg, pdf } = buildMsg();
  const r = M.read(msg);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.damaged, false);
  const m = r.message;
  assert.strictEqual(m.subject, "Your plan renewal");
  assert.strictEqual(m.from, '"Billing Team" <billing@sender.example>');
  assert.strictEqual(m.headers["message-id"], "<synthetic-1@sender.example>");
  assert.match(m.headers.received, /192\.0\.2\.10/);
  assert.strictEqual(m.html, HTML);
  assert.deepStrictEqual(m.attachments.map((a) => [a.name, a.contentType, a.size, !!a.rebuilt]), [["NOTICE.pdf", "application/pdf", pdf.length, false]]);
  assert.deepStrictEqual(latin1(m.files[0].bytes), pdf);
});

test("a .msg damaged by a line-ending conversion is rebuilt: headers, body and a checked PDF", () => {
  const { msg, pdf, content } = buildMsg();
  const r = M.read(damage(msg));
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.damaged, true);
  assert.strictEqual(r.repaired.pairs, pairsIn(msg));
  const m = r.message;
  assert.strictEqual(m.subject, "Your plan renewal");
  assert.strictEqual(m.from, '"Billing Team" <billing@sender.example>');
  assert.strictEqual(m.headers.subject, "Your plan renewal");
  assert.strictEqual(m.headers["message-id"], "<synthetic-1@sender.example>");
  assert.strictEqual(unify(m.html), unify(HTML));
  const att = m.attachments[0];
  assert.strictEqual(att.name, "NOTICE.pdf");
  assert.strictEqual(att.size, pdf.length);
  assert.ok(att.rebuilt && att.rebuilt.verified, JSON.stringify(att.rebuilt));
  assert.strictEqual(att.rebuilt.streams, 2);
  // The zlib stream is exact (its checksum says so); the page image decodes.
  const fixed = latin1(m.files[0].bytes);
  const scan = P.scan(fixed, { images: true });
  assert.ok(scan.ok);
  assert.match(scan.text, /billing desk/);
  const zAt = Buffer.from(pdf).indexOf("/FlateDecode");
  assert.deepStrictEqual(fixed.subarray(zAt, zAt + 200), pdf.subarray(zAt, zAt + 200));
  assert.strictEqual(scan.jpegs.length, 1);
  assert.match(m.note, /line-ending conversion/);
  assert.match(m.note, /no hash/);
  assert.ok(content.length);
});

test("JPEG repair settles most rebuilt bytes of a scan and decodes it to the end", () => {
  const lone = new Set();
  const b = JPEG.slice();
  let wrongIfLf = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0x0d || b[i] === 0x0a) {
      lone.add(i);
      if (b[i] === 0x0d) wrongIfLf++;
      b[i] = 0x0a;
    }
  }
  assert.ok(lone.size > 200 && wrongIfLf > 100);
  const r = R.jpeg(b, lone, new Set(), {});
  assert.ok(r.ok && r.verified);
  let wrong = 0;
  for (const i of lone) if (r.bytes[i] !== JPEG[i]) wrong++;
  assert.ok(wrong < lone.size * 0.1, wrong + " of " + lone.size + " still wrong");
});

test("a zlib stream with rebuilt bytes is fixed exactly by its checksum", () => {
  let z;
  for (let pad = 0; ; pad++) {
    z = new Uint8Array(zlib.deflateSync(Buffer.from("BT (Pay invoice 4471) Tj ET " + "y".repeat(pad))));
    if (z.includes(0x0d)) break;
  }
  const lone = new Set();
  const b = z.slice();
  for (let i = 0; i < b.length; i++) if (b[i] === 0x0d || b[i] === 0x0a) { lone.add(i); b[i] = 0x0a; }
  const u = R.units(b, 0, b.length, lone, new Set());
  const ch = new Int8Array(u.n).fill(-1);
  assert.ok(R.flateChoices(u, ch, 0, u.n, 0));
  assert.deepStrictEqual(R.realize(u, ch), z);
});

test("a .msg attached to an email, and a .msg opened as the message, become layers", () => {
  const { msg } = buildMsg();
  const b64 = Buffer.from(msg).toString("base64").replace(/.{76}/g, "$&\r\n");
  const eml = "From: reporter@example.org\r\nTo: soc@example.org\r\nSubject: FW: suspicious\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b1\"\r\n\r\n--b1\r\nContent-Type: text/plain\r\n\r\nSee attached.\r\n--b1\r\nContent-Type: application/vnd.ms-outlook; name=\"orig.msg\"\r\nContent-Disposition: attachment; filename=\"orig.msg\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" + b64 + "\r\n--b1--\r\n";
  const list = N.parse(eml, "report.eml");
  assert.ok(list.some((m) => m.subject === "Your plan renewal"));

  const opened = N.parse(Buffer.from(damage(msg)).toString("latin1"), "");
  assert.strictEqual(opened[0].subject, "Your plan renewal");
  assert.match(opened[0].note, /damaged/);
  opened[0].container = true;
  const outer = { headers: {}, text: "", html: "", attachments: [{ name: "Outlook message (.msg)", contentType: "application/vnd.ms-outlook" }], files: [], hasNestedEml: true };
  const layers = S.analyzeAll(outer, opened, [], {});
  assert.strictEqual(layers[1].short, "Outlook message");
  const att = layers[1].inventory.attachments.find((a) => a.name === "NOTICE.pdf");
  assert.match(att.info, /rebuilt from a damaged \.msg/);
  assert.strictEqual(att.sha256, "");
});

test("a one-digit OCR misread of a number the image repeats is dropped", () => {
  const text = "ACCOUNT SUSPENSION NOTICE\nCall us at 8886120417 to keep your QuickBooks plan.\nToll Free : 8886120417\nQuickBooks Billing Team 8886120417\nby phone: 2886120417";
  const layers = S.analyzeAll({ headers: { from: "x@hotmail.com", subject: "renewal" }, text: "", html: "", attachments: [], files: [S.ocrFile("page.jpg", text, 90, "")] }, [], [], {});
  const phones = layers[0].inventory.phones.map((p) => String(p.number || p.value || p).replace(/\D/g, ""));
  assert.ok(phones.some((p) => p.endsWith("8886120417")));
  assert.ok(!phones.some((p) => p.endsWith("2886120417")));
});

test("damaged .msg files of many layouts, 4096- and 512-byte sectors, read back whole", () => {
  for (const size of [4096, 512]) {
    for (const t of randomMessages(size === 4096 ? 11 : 12, 25, size)) {
      const r = M.read(damage(t.msg));
      assert.ok(r.ok, r.error);
      const m = r.message;
      assert.strictEqual(m.subject, t.subject);
      assert.strictEqual(m.headers["message-id"], t.id);
      assert.strictEqual(unify(m.html), unify(t.html));
      for (const a of t.atts) assert.strictEqual((m.attachments.find((x) => x.name === a.name) || {}).size, a.data.length, a.name);
    }
  }
});

test("a large damaged .msg (FAT entries holding CR LF, DIFAT sectors) keeps its attachment", () => {
  let seed = 3;
  const big = new Uint8Array(7.5 * 1024 * 1024).map(() => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 24));
  const msg = buildCfb({ name: "Root Entry", children: [prop("0037001F", utf16("Large")), { name: "__attach_version1.0_#00000000", children: [prop("3707001F", utf16("big.bin")), prop("37010102", big), fixedProps(8, [])] }] }, 512);
  assert.ok(u32of(msg, 72) > 0, "uses DIFAT sectors");
  const r = M.read(damage(msg));
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.message.subject, "Large");
  assert.strictEqual(r.message.attachments[0].size, big.length);
});

test("a .msg is rebuilt as an .eml Thunderbird can open: headers, body, repaired files marked", () => {
  const { msg } = buildMsg();
  const r = M.read(damage(msg));
  const eml = M.toEml(r.message, { token: "0123abcd", note: r.message.note });
  assert.match(eml, /^X-PeelScout-Rebuilt: 0123abcd$/m);
  assert.match(eml, /^X-PeelScout-Note: /m);
  const parsed = N.parseMessage(eml, 0);
  assert.strictEqual(parsed.subject, "Your plan renewal");
  assert.match(parsed.from, /billing@sender\.example/);
  assert.strictEqual(parsed.headers["message-id"], "<synthetic-1@sender.example>");
  assert.strictEqual(unify(parsed.html), unify(HTML));
  assert.strictEqual(parsed.files[0].name, "NOTICE.pdf");
  assert.strictEqual(parsed.files[0].bytes, r.message.files[0].bytes);
  // The part the repair touched says so; the original MIME headers are replaced.
  assert.match(eml, /filename="NOTICE\.pdf"\r\nContent-Transfer-Encoding: base64\r\nX-PeelScout-Rebuilt: 0123abcd; checked/);
  assert.strictEqual((eml.match(/^MIME-Version:/gim) || []).length, 1);
});

test("what Thunderbird keeps of an opened .msg (up to its first zero byte) is reported, not read", () => {
  const { msg } = buildMsg();
  const cut = damage(msg).subarray(0, 10);
  assert.ok(M.isMsg(cut));
  const r = M.read(cut);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "truncated");
  const outer = { headers: {}, text: "", html: "", attachments: [{ name: "Outlook message (.msg)", contentType: "application/vnd.ms-outlook" }], files: [], outlookTruncated: true };
  const layers = S.analyzeAll(outer, [], [], {});
  assert.ok(layers[0].outlookFile);
  assert.ok(layers[0].notes.some((n) => /Rebuild and open/.test(n)));
  assert.deepStrictEqual(layers[0].routes, []);
});
