const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const SR = require("../sublime-rules.js");
const S = require("../signals.js");

const names = (res) => res.sublime.map((m) => m.name);

test("sha256 matches Node's implementation (used for hashed IOC lists)", () => {
  for (const v of ["", "abc", "evil@example.com", "ñandú€"]) {
    assert.strictEqual(SR.sha256(v), crypto.createHash("sha256").update(v).digest("hex"));
  }
});

test("Sublime: punycode sender, Telegraph link and suspicious subject", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "Support <help@xn--micrsoft-abc.com>", subject: "Action required: mailbox almost full", received: "from x" },
    html: '<a href="https://telegra.ph/view-123">Open</a>',
  });
  assert.ok(names(res).includes("Punycode sender domain"));
  assert.ok(names(res).includes("Link: Telegraph-hosted content"));
  const tg = res.sublime.find((m) => /Telegraph/.test(m.name));
  assert.match(tg.url, /^https:\/\/github\.com\/sublime-security\/sublime-rules\/blob\/main\/detection-rules\/link_telegraph\.yml$/);
  assert.match(tg.routeHint, /Phishing/);
  assert.ok(res.general.some((s) => /suspicious-subject/.test(s.label)));
});

test("Sublime: mail transiting a bulletproof host network (Received IPs)", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "a@b.example", subject: "Hello", received: "from mx.bad (unknown [5.182.86.10]) by mx.client.example, from internal (10.0.0.5)" },
    text: "Hello there, see you soon at the event next week.",
  });
  assert.ok(names(res).some((n) => /Aeza Group/.test(n)));
  assert.deepStrictEqual(S.receivedIps("from a [10.1.1.1] by b [8.8.8.8]"), ["8.8.8.8"]);
});

test("Sublime: freemail list covers providers outside the guide's list", () => {
  assert.ok(S.isFreemail("yandex.com"));
  assert.ok(S.isFreemail("gmx.de"));
});

test("languages: Portuguese and German phrases map to routes", () => {
  const pt = S.analyze({ layer: "nested", headers: { from: "ceo.empresa@gmail.com", subject: "Urgente", received: "x" }, text: "Preciso que você compre cartões de presente hoje e me passe seu número de whatsapp." });
  assert.ok(pt.routes.find((r) => r.key === "bec"));
  assert.strictEqual(pt.language, "Portuguese");
  const de = S.analyze({ layer: "nested", headers: { from: "x@y.example", subject: "Rechnung", received: "x" }, text: "Ihre Rechnung über 399 EUR wurde verlängert. Rufen Sie uns an unter +49 30 1234 5678, falls nicht autorisiert." });
  assert.ok(de.routes.find((r) => r.key === "vishing"));
  assert.strictEqual(de.language, "German");
});

test("languages: other scripts are flagged for translation, not classified", () => {
  const ru = S.analyze({ layer: "nested", headers: { from: "x@y.example", subject: "Привет", received: "x" }, text: "Здравствуйте, пожалуйста, проверьте документ и подтвердите получение сегодня." });
  assert.match(ru.language, /Cyrillic/);
  assert.ok(ru.general.some((s) => /translate before deciding/.test(s.label)));
});
