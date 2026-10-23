const test = require("node:test");
const assert = require("node:assert");
const S = require("../signals.js");

function route(res, key) {
  return res.routes.find((r) => r.key === key);
}

test("BEC precedent: Adobe Development RFQ with freemail Reply-To", () => {
  const res = S.analyze({
    layer: "nested",
    headers: {
      from: "Juan Lara, President <Jlara@adobe-development.com>",
      "reply-to": "Jlaraadobe-development@outlook.com",
      subject: "Request for Quotation",
      "authentication-results": "mx.example.org; spf=fail smtp.mailfrom=adobe-development.com; dkim=none; dmarc=fail",
      received: "from x",
    },
    text: "Hello, please send us a quotation for the products in the attached RFQ. Regards, Juan Lara, President",
  });
  const bec = route(res, "bec");
  assert.ok(bec, "BEC route expected");
  assert.ok(bec.strong >= 2);
  assert.ok(res.iocs.some((i) => i.type === "Email address" && i.value === "Jlaraadobe-development@outlook.com"));
  assert.match(res.senderNote, /do not mark Jlara@adobe-development\.com/);
  assert.ok(res.general.some((s) => /SPF=fail/.test(s.label)));
});

test("RECON precedent: Nick Li, Re: without thread headers", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "Nick Li <cl5613@nyu.edu>", subject: "Re: Arrived Last Week to Saskatchewan <> Chat", received: "x" },
    text: "Hi Loren, thanks in advance. Would you be open to a 15 min online meeting next week? Nick",
  });
  const recon = route(res, "recon");
  assert.ok(recon, "RECON expected");
  assert.ok(recon.signals.some((s) => /Re:/.test(s.label)));
  assert.ok(recon.signals.some((s) => /Very short/.test(s.label)));
  assert.strictEqual(res.routes[0].key, "recon");
});

test("419 precedent: Doris asks to continue by email from hotmail", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "doris_fleury@hotmail.com", subject: "Doris Fleury", received: "x" },
    text: "Allô, Est-il possible de communiquer par courriel ? À très bientôt, Doris",
  });
  assert.ok(res.general.some((s) => /freemail/i.test(s.label)));
  assert.ok(route(res, "recon").signals.some((s) => /talk by email/.test(s.label)));
});

test("Vishing: brand invoice with callback number", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "billing@random-shop.xyz", subject: "Your Norton subscription renewal", received: "x" },
    text: "Your order has been charged $399.99 for Norton auto-renew. If you did not authorize this, call us at +1 (808) 555-0142.",
  });
  const v = route(res, "vishing");
  assert.ok(v && v.strong === 1);
  assert.ok(res.iocs.some((i) => i.type === "Cellphone"));
});

test("O365: SharePoint lure linking to a random domain", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "HR <hr@client.example>", subject: "Payroll Benefits handbook shared with you", received: "x" },
    html: '<p>A SharePoint file was shared with you. <a href="https://docs-view.pages.dev/login?u=1">Review Document</a></p>',
  });
  const o = route(res, "o365");
  assert.ok(o && o.strong >= 1);
  assert.ok(res.iocs.some((i) => i.value === "https://docs-view.pages.dev/login?u=1"));
  assert.ok(res.verify.some((v) => v.what === "https://docs-view.pages.dev/login?u=1"));
  assert.ok(res.general.some((s) => /\.dev/.test(s.label)));
});

test("Dating lure with hidden filler and IDN link (Carlos 30/09)", () => {
  const filler = "ANZ bank statement curriculum vitae ".repeat(10);
  const res = S.analyze({
    layer: "nested",
    headers: { from: "Anna <anna@mail.bose.ru.com>", subject: "Lonely tonight?", received: "x" },
    html: '<div>Meet beautiful Ukrainian girls today! <a href="https://xn--cbseneetjeechemistry-abc.in/r">Join</a></div><div style="display:none">' + filler + "</div>",
  });
  const p = route(res, "phishing");
  assert.ok(p && p.signals.some((s) => /Dating lure/.test(s.label) && s.strength === "strong"));
  assert.ok(res.general.some((s) => /hidden with CSS/.test(s.label) && s.strength === "strong"));
  assert.strictEqual(S.regDomain("mail.bose.ru.com"), "bose.ru.com");
});

test("link text shows one domain, href goes to another (after unwrapping)", () => {
  const href = "https://nam10.safelinks.protection.outlook.com/?url=" + encodeURIComponent("https://evil.example/x") + "&data=1";
  const res = S.analyze({ layer: "nested", headers: { from: "a@b.com", received: "x" }, html: '<a href="' + href + '">https://www.paypal.com/signin</a>' });
  assert.ok(route(res, "phishing").signals.some((s) => /Link text shows/.test(s.label)));
  assert.ok(res.iocs.some((i) => i.value === "https://evil.example/x"));
});

test("report wrapper: outer forward with attached eml is flagged, not classified", () => {
  const res = S.analyze({ layer: "outer", hasNestedEml: true, headers: { from: "employee@client.example", subject: "FW: suspicious" }, text: "Please review." });
  assert.ok(res.notes.some((n) => /reporting channel/.test(n)));
  assert.ok(!route(res, "firInternal"));
});

test("missing attachment mention and missing headers", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "x@corp.example", subject: "Invoice" }, text: "Please see the attached invoice and confirm today, the payment is pending for this week." });
  assert.ok(route(res, "firMissingContent"));
  assert.ok(route(res, "firMissingHeaders"));
});

test("plain marketing mail stays quiet", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "News <news@shop.example>", subject: "Our autumn collection", received: "x", "authentication-results": "spf=pass dkim=pass dmarc=pass" },
    html: '<p>Discover our new autumn collection with dozens of styles for the whole family, shipping is free on orders this weekend.</p><a href="https://shop.example/autumn">Shop now</a><a href="https://shop.example/unsubscribe">Unsubscribe</a>',
  });
  assert.strictEqual(res.routes.length, 0);
  assert.strictEqual(res.iocs.length, 0);
});

test("summary follows the analyst template", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "doris_fleury@hotmail.com", subject: "Doris Fleury", received: "x" }, text: "Allô, Est-il possible de communiquer par courriel ?" });
  const text = S.summary(res);
  assert.match(text, /^\*\*Suggested classification:\*\* pending review/);
  assert.match(text, /\*\*Mark as malicious:\*\*\nNone identified/);
  assert.match(text, /Freemail sender/);
});

test("report wrapper does not inherit routes from the forwarded subject", () => {
  const res = S.analyze({ layer: "outer", hasNestedEml: true, headers: { from: "employee@client.example", subject: "FW: Request for Quotation" }, text: "Revisen este correo por favor." });
  assert.strictEqual(res.routes.length, 0);
});

test("click-tracking redirect to the shown domain is not a mismatch (cumplify case)", () => {
  const href = "https://www.kl-def3.com/k/6ad0e4dfcfaa995cd6a8eae0?lid=&url=https%3A%2F%2Fwww.cumplify.com.mx";
  const res = S.analyze({
    layer: "nested",
    headers: { from: "Martin <martin@cumplify.net>", subject: "Actualización legal", received: "x" },
    html: '<p>Consulta la actualización en <a href="' + href + '">cumplify.com.mx</a></p>',
  });
  assert.ok(!res.routes.find((r) => r.key === "phishing"));
  assert.strictEqual(res.iocs.length, 0);
  assert.ok(res.general.some((s) => /Tracking links/.test(s.label) && s.strength === "weak"));
  assert.deepStrictEqual(res.verify.map((v) => v.domain), ["cumplify.net", "kl-def3.com", "cumplify.com.mx"]);
});

test("tracking redirect pointing elsewhere is still a mismatch", () => {
  const href = "https://www.kl-def3.com/k/1?url=https%3A%2F%2Fevil.example%2Flogin";
  const res = S.analyze({ layer: "nested", headers: { from: "a@b.com", received: "x" }, html: '<a href="' + href + '">www.paypal.com</a>' });
  assert.ok(res.routes.find((r) => r.key === "phishing"));
});

test("RDAP ages: recent sender domain becomes a signal and goes into the summary", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "Martin <martin@cumplify.net>", subject: "Actualización", date: "Thu, 22 Oct 2026 10:00:00 -0600", received: "x" },
    html: '<a href="https://www.cumplify.com.mx/aviso">cumplify.com.mx</a>',
  });
  S.applyAges(res, { "cumplify.net": { created: "2026-06-24T12:24:42Z", source: "RDAP rdap.verisign.com" }, "cumplify.com.mx": { error: "no-rdap" } }, new Date("2026-10-23T12:00:00Z"));
  const sig = res.general.find((s) => /less than a year/.test(s.label));
  assert.ok(sig);
  assert.match(sig.evidence, /cumplify\.net · 2026-06-24/);
  assert.ok(res.verify.find((v) => v.domain === "cumplify.com.mx").why.includes("WHOIS"));
  assert.match(S.summary(res), /Domain age \(sender\): `cumplify\.net` created 2026-06-24/);
  // Re-applying does not duplicate the age signal.
  S.applyAges(res, { "cumplify.net": { created: "2026-06-24T12:24:42Z", source: "rdap.verisign.com" } }, new Date("2026-10-23T12:00:00Z"));
  assert.strictEqual(res.general.filter((s) => /less than a year/.test(s.label)).length, 1);
});
