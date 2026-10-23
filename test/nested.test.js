const test = require("node:test");
const assert = require("node:assert");
const N = require("../nested.js");

const inner = "Subject: inner\nContent-Type: text/plain\n\nhola mundo desde el mensaje interno";

test("MIME preamble is not used as the body", () => {
  const raw =
    "Subject: outer\nContent-Type: multipart/mixed; boundary=b1\n\nThis is a multi-part message in MIME format.\n\nPreamble text\n" +
    "--b1\nContent-Type: text/plain\n\nreal outer body\n--b1--\n";
  assert.strictEqual(N.parse(raw)[0].text, "real outer body");
});

test("attached message is flattened once", () => {
  const raw =
    "Subject: outer\nContent-Type: multipart/mixed; boundary=b1\n\n--b1\nContent-Type: text/plain\n\nouter body text\n" +
    "--b1\nContent-Type: message/rfc822\n\n" + inner + "\n--b1--\n";
  const list = N.parse(raw);
  assert.deepStrictEqual(list.map((m) => m.subject), ["outer", "inner"]);
});

test("non-UTF-8 charsets decode", () => {
  const raw =
    "Subject: =?iso-8859-1?Q?Informaci=F3n?=\nContent-Type: text/plain; charset=windows-1252\n" +
    "Content-Transfer-Encoding: quoted-printable\n\nPrecio =80100 se=F1or";
  const [m] = N.parse(raw);
  assert.strictEqual(m.subject, "Información");
  assert.strictEqual(m.text, "Precio €100 señor");
});

test("unlabelled 8-bit text falls back from UTF-8 to windows-1252", () => {
  const raw = "Subject: x\n\n" + String.fromCharCode(0x63, 0x61, 0x66, 0xe9) + " con texto suficiente";
  assert.strictEqual(N.parse(raw)[0].text, "café con texto suficiente");
});

test("adjacent RFC 2047 words join without the space between them", () => {
  const raw = "Subject: =?UTF-8?B?SG9sYQ==?= =?UTF-8?B?IG11bmRv?= final\n\nbody text";
  assert.strictEqual(N.parse(raw)[0].subject, "Hola mundo final");
});

test("multibyte character split across encoded words survives", () => {
  const bytes = Buffer.from("ñ", "utf8");
  const a = "=?UTF-8?B?" + Buffer.from([0x61, bytes[0]]).toString("base64") + "?=";
  const b = "=?UTF-8?B?" + Buffer.from([bytes[1], 0x62]).toString("base64") + "?=";
  assert.strictEqual(N.parse("Subject: " + a + " " + b + "\n\nbody text")[0].subject, "añb");
});

test("Outlook .msg is not treated as RFC 822", () => {
  assert.strictEqual(N.isRfc822("x.msg", "application/vnd.ms-outlook"), false);
  assert.strictEqual(N.isRfc822("x.eml", "application/octet-stream"), true);
  assert.strictEqual(N.isRfc822("", "message/rfc822"), true);
});
