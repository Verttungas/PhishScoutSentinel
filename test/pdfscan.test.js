const test = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");
const P = require("../pdfscan.js");

const bin = (b) => Buffer.from(b).toString("latin1");
const bytesOf = (s) => Uint8Array.from(Buffer.from(s, "latin1"));
const hex4 = (n) => n.toString(16).padStart(4, "0");

// A one-page PDF the way headless Chrome writes lures: Identity-H font with a
// ToUnicode CMap, one glyph per Td, and a link annotation.
function buildPdf(opts) {
  opts = opts || {};
  const msg = opts.text || "View Bid";
  const glyphs = Array.from(new Set(msg.split("")));
  const gid = (c) => glyphs.indexOf(c) + 3;
  let content = "BT\n/F1 20 Tf\n1 0 0 -1 50 100 Tm\n";
  for (let i = 0; i < msg.length; i++) content += (i ? "10 0 Td " : "") + "<" + hex4(gid(msg[i])) + "> Tj\n";
  content += "ET\n";
  const cmap = "/CIDInit /ProcSet findresource begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
    glyphs.length + " beginbfchar\n" + glyphs.map((c) => "<" + hex4(gid(c)) + "> <" + hex4(c.charCodeAt(0)) + ">").join("\n") + "\nendbfchar\nendcmap\n";
  const objs = [];
  const enc = opts.encrypt;
  function str(num, s) {
    if (!enc) return "(" + s + ")";
    return "<" + Buffer.from(enc.objCrypt(num, bytesOf(s))).toString("hex") + ">";
  }
  function stream(num, dict, data) {
    let d = bin(zlib.deflateSync(Buffer.from(data, "latin1")));
    if (enc) d = bin(enc.objCrypt(num, bytesOf(d)));
    return dict.replace(">>", " /Filter /FlateDecode /Length " + d.length + " >>") + "\nstream\n" + d + "\nendstream";
  }
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] = "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [8 0 R] >>";
  objs[4] = stream(4, "<< >>", content);
  objs[5] = "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>";
  objs[6] = "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /DW 500 >>";
  objs[7] = stream(7, "<< >>", cmap);
  objs[8] = "<< /Type /Annot /Subtype /Link /A << /S /URI /URI " + str(8, opts.uri || "https://lure.example/bid") + " >> >>";
  objs[9] = "<< /Producer " + str(9, "Skia/PDF m150") + " /Creator " + str(9, "HeadlessChrome/150.0") + " /Title " + str(9, "about:blank") + " >>";
  let out = "%PDF-1.4\n";
  for (let i = 1; i < objs.length; i++) out += i + " 0 obj\n" + objs[i] + "\nendobj\n";
  if (enc) out += "10 0 obj\n" + enc.dict + "\nendobj\n";
  out += "trailer\n<< /Root 1 0 R /Info 9 0 R" + (enc ? " /Encrypt 10 0 R /ID [<" + enc.idHex + "><" + enc.idHex + ">]" : "") + " >>\n%%EOF\n";
  return bytesOf(out);
}

// Standard security handler, RC4 128-bit, revision 3, for the given user password.
function rc4Encryption(password) {
  const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const id = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const O = Buffer.alloc(32, 7);
  const Pv = -3904;
  const pB = Buffer.alloc(4);
  pB.writeInt32LE(Pv);
  const pw = Buffer.from(password, "latin1").subarray(0, 32);
  let key = P.md5(Buffer.concat([pw, PAD.subarray(0, 32 - pw.length), O, pB, id])).subarray(0, 16);
  for (let i = 0; i < 50; i++) key = P.md5(key).subarray(0, 16);
  let U = P.rc4(key, P.md5(Buffer.concat([PAD, id])));
  for (let i = 1; i <= 19; i++) U = P.rc4(key.map((b) => b ^ i), U);
  const Ufull = Buffer.concat([Buffer.from(U), Buffer.alloc(16)]);
  return {
    idHex: id.toString("hex"),
    dict: "<< /Filter /Standard /V 2 /R 3 /Length 128 /P " + Pv + " /O <" + O.toString("hex") + "> /U <" + Ufull.toString("hex") + "> >>",
    objCrypt(num, data) {
      const k = P.md5(Buffer.concat([Buffer.from(key), Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])])).subarray(0, 16);
      return P.rc4(k, data);
    },
  };
}

test("md5 matches the reference digest", () => {
  assert.strictEqual(Buffer.from(P.md5(new TextEncoder().encode("abc"))).toString("hex"), "900150983cd24fb0d6963f7d28e17f72");
});

test("Chrome-style lure PDF: text through ToUnicode, link, producer", () => {
  const r = P.scan(buildPdf({ text: "View Bid now" }));
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.pages, 1);
  assert.match(r.text, /View Bid now/);
  assert.deepStrictEqual(r.uris, ["https://lure.example/bid"]);
  assert.strictEqual(r.title, "about:blank");
  assert.strictEqual(r.encrypted, false);
});

test("RC4 PDF opens with the password the email gives, not without it", () => {
  const enc = rc4Encryption("victim@client.example");
  const pdf = buildPdf({ encrypt: enc, uri: "https://kit.example/secure" });
  const shut = P.scan(pdf, { passwords: [] });
  assert.ok(shut.encrypted && !shut.decrypted);
  assert.deepStrictEqual(shut.uris, []);
  const hints = P.passwordHints("When prompted, copy and paste your email address into the password field.", ["victim@client.example"]);
  assert.ok(hints.includes("victim@client.example"));
  const open = P.scan(pdf, { passwords: hints });
  assert.ok(open.decrypted);
  assert.strictEqual(open.password, "victim@client.example");
  assert.deepStrictEqual(open.uris, ["https://kit.example/secure"]);
  assert.match(open.text, /View Bid/);
});

test("Not a PDF / garbage is reported, never thrown", () => {
  assert.strictEqual(P.scan(bytesOf("hello")).error, "not a PDF");
  assert.strictEqual(P.scan(bytesOf("%PDF-1.4\n1 0 obj << /Length 9 /Filter /FlateDecode >>\nstream\nxx\nendobj")).ok, true);
});

// --- Written URLs and embedded images (QR codes) -----------------------------------

const jsQR = require("../jsqr.min.js");
const QR_URL = "https://qr-lure.example/scan?id=7";
// Module matrix of a QR code for QR_URL (generated once with CoreImage; synthetic URL).
const MATRIX = require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", "qr-matrix.txt"), "utf8").trim().split("\n");

// Grey pixels of the QR code: 4 px per module and a 4-module quiet zone.
function qrPixels() {
  const n = MATRIX.length, s = 4, q = 4, w = (n + 2 * q) * s;
  const px = new Uint8Array(w * w).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (MATRIX[y][x] !== "1") continue;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) px[((y + q) * s + dy) * w + (x + q) * s + dx] = 0;
  }
  return { w, px };
}

// A PDF whose page shows one image XObject (and optional text).
function imagePdf(opts) {
  const { w, px } = qrPixels();
  let data, extra = "";
  if (opts.kind === "jpeg") {
    data = bin(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]));
    extra = "/Filter /DCTDecode /BitsPerComponent 8 /ColorSpace /DeviceRGB";
  } else if (opts.kind === "1bit") {
    const rowLen = Math.ceil(w / 8);
    const packed = Buffer.alloc(rowLen * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (px[y * w + x]) packed[y * rowLen + (x >> 3)] |= 0x80 >> (x & 7);
    data = bin(zlib.deflateSync(packed));
    extra = "/Filter /FlateDecode /BitsPerComponent 1 /ColorSpace /DeviceGray";
  } else if (opts.kind === "predictor") {
    const rows = [];
    for (let y = 0; y < w; y++) {
      const row = Buffer.alloc(w + 1);
      row[0] = 2; // PNG "Up"
      for (let x = 0; x < w; x++) row[x + 1] = (px[y * w + x] - (y ? px[(y - 1) * w + x] : 0)) & 0xff;
      rows.push(row);
    }
    data = bin(zlib.deflateSync(Buffer.concat(rows)));
    extra = "/Filter /FlateDecode /BitsPerComponent 8 /ColorSpace /DeviceGray /DecodeParms << /Predictor 15 /Colors 1 /Columns " + w + " >>";
  } else {
    data = bin(zlib.deflateSync(Buffer.from(px)));
    extra = "/Filter /FlateDecode /BitsPerComponent 8 /ColorSpace /DeviceGray";
  }
  const text = opts.text ? "BT /F1 12 Tf 1 0 0 1 40 40 Tm (" + opts.text + ") Tj ET" : "";
  const content = bin(zlib.deflateSync(Buffer.from("q 200 0 0 200 50 300 cm /Im1 Do Q " + text)));
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] = "<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>";
  objs[4] = "<< /Filter /FlateDecode /Length " + content.length + " >>\nstream\n" + content + "\nendstream";
  objs[5] = "<< /Type /XObject /Subtype /Image /Width " + w + " /Height " + w + " " + extra + " /Length " + data.length + " >>\nstream\n" + data + "\nendstream";
  objs[6] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n";
  for (let i = 1; i < objs.length; i++) out += i + " 0 obj\n" + objs[i] + "\nendobj\n";
  return bytesOf(out + "trailer\n<< /Root 1 0 R >>\n%%EOF\n");
}

test("the QR fixture decodes to its URL", () => {
  const { w, px } = qrPixels();
  const rgba = new Uint8ClampedArray(w * w * 4);
  for (let i = 0; i < px.length; i++) rgba.set([px[i], px[i], px[i], 255], i * 4);
  assert.strictEqual(jsQR(rgba, w, w).data, QR_URL);
});

test("QR codes in images embedded in a PDF are decoded (8-bit, PNG predictor, 1-bit)", () => {
  for (const kind of ["gray", "predictor", "1bit"]) {
    const r = P.scan(imagePdf({ kind }), { images: true, qr: jsQR });
    assert.ok(r.ok, kind + ": " + r.error);
    assert.deepStrictEqual(r.qr, [QR_URL], kind);
  }
});

test("JPEG images are handed back for the caller to decode; no images without opts.images", () => {
  const r = P.scan(imagePdf({ kind: "jpeg" }), { images: true, qr: jsQR });
  assert.strictEqual(r.jpegs.length, 1);
  assert.strictEqual(r.jpegs[0][0], 0xff);
  const quiet = P.scan(imagePdf({ kind: "gray" }));
  assert.strictEqual(quiet.qr, undefined);
});

test("URLs written in the PDF text are listed apart from its links; email domains are not URLs", () => {
  const r = P.scan(imagePdf({ kind: "gray", text: "Copy www.portal-docs.example/view into your browser. Contact ana@firm.example" }));
  assert.deepStrictEqual(r.textUris, ["https://www.portal-docs.example/view"]);
  assert.deepStrictEqual(P.urlsInText("see invoice.pdf, http://a.example/x. and mail bob@corp.example"), ["http://a.example/x"]);
});
