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
    headers: { from: "News <news@shop.example>", to: "me@home.example", subject: "Our autumn collection", received: "x", "authentication-results": "spf=pass dkim=pass dmarc=pass" },
    html: '<p>Discover our new autumn collection with dozens of styles for the whole family, shipping is free on orders this weekend.</p><a href="https://shop.example/autumn">Shop now</a><a href="https://shop.example/unsubscribe">Unsubscribe</a>',
  });
  assert.deepStrictEqual(res.routes.map((r) => r.key), ["ntd"], "only the No Threat Detected hypothesis");
  assert.strictEqual(res.iocs.length, 0);
});

test("summary follows the analyst template", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "doris_fleury@hotmail.com", subject: "Doris Fleury", received: "x" }, text: "Allô, Est-il possible de communiquer par courriel ?" });
  const text = S.summary(res);
  assert.match(text, /^\*\*Suggested classification:\*\* pending review/);
  assert.match(text, /\*\*Mark as malicious:\*\*\n\| Type/);
  assert.match(text, /doris_fleury@hotmail\.com` \| Freemail sender that carries out/);
  assert.match(text, /Freemail sender: mark it only/);
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

// --- Reports forwarded in the body (P0-1) ----------------------------------------------

test("Report to the phishing mailbox: the original is rebuilt as its own layer", () => {
  const text = [
    "A customer received this email.",
    "",
    "Pat Doe | Senior Relationship Manager | T: 212 555 0100",
    "",
    "Begin forwarded message:",
    "From: Servicing TDbank Department <noreply@search.example>",
    "Date: October 22, 2026 at 4:00:51 PM EDT",
    "To: Client <client@uni.example>",
    "Subject: TD Secure Email",
    "",
    "TD Secure Email: please log in using your email address and password to view the message.",
    "Click here to open <https://tracking.aff.example/aff_c?offer_id=5&url=https://kit.example/cone/1>",
  ].join("\n");
  const layers = S.analyzeAll({ headers: { from: "Pat Doe <pat.doe@bank.example>", to: "Phishing <phishing@bank.example>", subject: "FW: Secure Email", "in-reply-to": "<abc@sim.example>" }, text, attachments: [] }, [], []);
  assert.deepStrictEqual(layers.map((l) => l.short), ["Report", "Forwarded original"]);
  assert.strictEqual(layers[0].iocs.length, 0, "nothing in the report wrapper is a candidate");
  assert.match(layers[0].notes.join(" "), /Forwarded original/);
  const orig = layers[1];
  assert.match(orig.from, /noreply@search\.example/);
  assert.ok(orig.general.some((s) => /redirect on aff\.example to kit\.example/.test(s.label) && s.strength === "strong"));
  assert.strictEqual(orig.routes[0].key, "phishing", "a malicious route outranks the missing headers");
  assert.ok(orig.iocs.some((i) => i.value.startsWith("https://tracking.aff.example/aff_c")));
  assert.ok(orig.verify.some((v) => v.what === "https://kit.example/cone/1"));
});

test("Narrative report with no forwarded email → Internal Communication", () => {
  const layers = S.analyzeAll({
    headers: { from: "Agent <agent@bank.example>", to: "phishing@bank.example", subject: "phishing attempt" },
    text: "2:08pm October 11\nCall received on 780 555 0198\nCall from 210 555 0142\n\nTold cx a refund was due and asked to confirm the card number.\nCustomer didn't confirm anything with the fraudster.",
  }, [], []);
  assert.strictEqual(layers.length, 1);
  assert.strictEqual(layers[0].routes[0].key, "firInternal");
  assert.strictEqual(layers[0].routes[0].strong, 1);
  assert.strictEqual(layers[0].iocs.length, 0);
});

test("Forwarded message that is itself a customer's report → Internal Communication", () => {
  const text = "Fyi below\n\nFrom: Customer <someone@mail.example>\nSent: Wednesday, September 9, 2026\nTo: Branch <branch@bank.example>\nSubject: [External] Possible Spam at Bank\n\n[cid:image001]";
  const layers = S.analyzeAll({ headers: { from: "Emp <emp@bank.example>", to: "phishing@bank.example", subject: "FW: Possible Spam" }, text, attachments: [{ name: "Screenshot.png", contentType: "image/png", size: 300000 }] }, [], []);
  assert.strictEqual(layers[1].routes[0].key, "firInternal");
});

test("Payment instructions forwarded without headers → Missing Headers (strong)", () => {
  const text = "From: Client <client@mail.example>\nSent: Monday\nTo: Branch <branch@bank.example>\nSubject: Fw: Wire\n\nDe: Ventas <ventas@vendor.example>\nEnviado: miércoles\nPara: Client\nAsunto: Wire / SWIFT en USD\n\nDatos bancarios\nBanco beneficiario: X\nAccount Number: 1234567890\nSWIFT/BIC: XXXXKYKY";
  const layers = S.analyzeAll({ headers: { from: "Emp <emp@bank.example>", to: "phishing@bank.example", subject: "FW: Wire" }, text }, [], []);
  const r = layers[1].routes[0];
  assert.strictEqual(r.key, "firMissingHeaders");
  assert.strictEqual(r.strong, 1);
});

test("A quoted thread in a normal email is not split into layers", () => {
  const layers = S.analyzeAll({ headers: { from: "a@x.example", to: "b@y.example", subject: "RE: renewals" }, text: "Thanks\n\nFrom: C <c@z.example>\nSent: Monday\nTo: B <b@y.example>\nSubject: renewals\n\nPhone : 704-555-0112" }, [], []);
  assert.strictEqual(layers.length, 1);
  assert.ok(!layers[0].iocs.some((i) => i.type === "Cellphone"), "numbers in a quoted thread are not callback numbers");
});

// --- Banners, obfuscation, redirects, callback numbers (P0-3/4/5) -------------------------

test("External-mail banners do not count as the message's words or language", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "x <cell@freemail-example.com>", subject: "Re: Alex", received: "x", "in-reply-to": "<a@b>" },
    text: "Vous n’obtenez pas souvent d’e-mail à partir de x. Pourquoi c’est important<https://aka.ms/LearnAboutSenderIdentification>\n\n**************************************\nPRUDENCE/CAUTION - EXTERNE/EXTERNAL\n**************************************\n\nBest #cell to reach you?\n\nThanks\nAlex",
  });
  assert.ok(res.words <= 8, "words: " + res.words);
  assert.notStrictEqual(res.language, "French");
});

test("Obfuscation: math letters, scattered accents, mixed scripts", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "HR <hr@x.example>", subject: "Ùpdàtéd-pàyròll-schédùlé-fòr-thé-tèàm-Q̈1", received: "x" },
    text: "𝗣𝗿𝗼𝘁𝗲𝗰𝘁𝗲𝗱 𝗗𝗼𝗰𝘂𝗺𝗲𝗻𝘁 Code. Your parcel is at the dеlivеry depot.",
  });
  const labels = res.general.filter((s) => s.strength === "strong").map((s) => s.label).join(" | ");
  assert.match(labels, /math letters/);
  assert.match(labels, /Accents scattered/);
  assert.match(labels, /lookalike Cyrillic/);
});

test("Folded text reaches phrase rules (math letters, Docvment)", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "x@gmail.com", subject: "Document", received: "x" }, html: 'Sam shared a Docvment. <a href="https://kit.example/v">View</a>' });
  assert.ok(res.routes.find((r) => r.key === "o365"));
});

test("Open redirect with the destination in a parameter, base64 email, misspelt wp folder", () => {
  const href = "https://site.example/?theme=m&redirect=https%3A%2F%2Fother.example/wp-inlcudes/a/?id=" + Buffer.from("victim@client.example").toString("base64");
  const res = S.analyze({ layer: "nested", headers: { from: "a@b.example", subject: "Status", received: "x" }, html: '<a href="' + href + '">View Status</a>' });
  const labels = res.general.map((s) => s.label).join(" | ");
  assert.match(labels, /redirect on site\.example to other\.example/);
  assert.match(labels, /base64 \(victim@client\.example\)/);
  assert.match(labels, /Misspelt WordPress folder/);
});

test("A security wrapper with a scheme-less destination is peeled, not a redirect", () => {
  const href = "https://clicktime.symantec.com/15x?h=abc=&u=www.goto.example/webinar";
  const res = S.analyze({ layer: "nested", headers: { from: "a@goto.example", received: "x" }, html: '<a href="' + href + '">www.goto.example/webinar</a>' });
  assert.ok(!res.general.some((s) => /redirect/.test(s.label)));
  assert.strictEqual(res.inventory.links[0].url, "https://www.goto.example/webinar");
});

test("Callback numbers: a call to action is a candidate, a signature number is not", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "billing@random-shop.example", subject: "Your Norton renewal", received: "x" },
    text: "Your order was charged $399.99 for Norton auto-renew. If you did not authorize this, call us at +1 (808) 555-0142.\n\nRegards,\nJane\nTel: 514-555-0166 | Fax: 514-555-0167",
  });
  assert.deepStrictEqual(res.iocs.filter((i) => i.type === "Cellphone").map((i) => i.value), ["+1 (808) 555-0142"]);
});

test("Empty body + one randomly named image from freemail → content-in-attachment and Vishing pattern", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "sam <sam.r1984@hotmail.com>", subject: "a quick note on next steps", received: "x" },
    text: "COURRIEL EXTERNE / EXTERNAL EMAIL\nCe courriel provient de l'externe. Ne divulguez aucune information confidentielle. / This email is from an external source. Do not disclose any confidential information.",
    attachments: [{ name: "QZRT4KLM8XW2.jpeg", contentType: "image/jpeg", size: 101226 }],
  });
  assert.ok(res.general.some((s) => /No text of its own/.test(s.label) && s.strength === "strong"));
  const v = res.routes.find((r) => r.key === "vishing");
  assert.ok(v && v.strong === 1);
});

// --- PDF attachments (P0-2) ----------------------------------------------------------

test("PDF with a call to action and an external link → Docuphish, attachment and URL candidates", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "PM <pm@builder.example>", subject: "Tender Submission Request", received: "x" },
    text: "Please review the attached tender documents.",
    attachments: [{ name: "Tender.pdf", contentType: "application/pdf", size: 120000 }],
    files: [{ name: "Tender.pdf", sha256: "ab".repeat(32), scan: { ok: true, pages: 1, encrypted: false, uris: ["https://random-words-here.kit.example/"], text: "A secure document has been made available to you.\nView Bid", features: [], producer: "Skia/PDF", creator: "Chromium", title: "Document Notification", images: 1 } }],
  });
  const d = res.routes.find((r) => r.key === "docuphish");
  assert.ok(d && d.strong >= 1);
  assert.ok(res.iocs.some((i) => i.type === "Attachment" && /Tender\.pdf · SHA-256 abab/.test(i.value)));
  assert.ok(res.iocs.some((i) => i.type === "URL" && i.value === "https://random-words-here.kit.example/"));
  assert.match(res.inventory.attachments[0].info, /1 page · 1 link/);
});

test("Encrypted PDF with the password given in the email → Docuphish strong; without hint → Content Encrypted", () => {
  const scan = { ok: true, pages: 1, encrypted: true, algorithm: "AES", decrypted: false, uris: [], text: "", features: [], producer: "", creator: "", title: "", images: 0 };
  const hinted = S.analyze({ layer: "nested", headers: { from: "x@y.example", received: "x" }, text: "Protected Document Code: paste your email address into the password field.", attachments: [{ name: "a.pdf", contentType: "application/pdf" }], files: [{ name: "a.pdf", scan }] });
  assert.ok(hinted.routes.find((r) => r.key === "docuphish" && r.strong));
  const bare = S.analyze({ layer: "nested", headers: { from: "x@y.example", received: "x" }, text: "Here is the report.", attachments: [{ name: "a.pdf", contentType: "application/pdf" }], files: [{ name: "a.pdf", scan }] });
  assert.ok(bare.routes.find((r) => r.key === "firEncrypted"));
});

test("Vishing number found inside the PDF text", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "sam <sam.r1984@hotmail.com>", subject: "making sure this reached you", received: "x" },
    text: "Warning: This Message was sent from a source outside of Bank. Please be cautious when opening links or attachments",
    attachments: [{ name: "HVX7Q2ML9PDA.pdf", contentType: "application/pdf", size: 22680 }],
    files: [{ name: "HVX7Q2ML9PDA.pdf", scan: { ok: true, pages: 1, encrypted: false, uris: [], text: "QuickBooks Account Suspension Notice\nYour subscription will be deactivated.\nCall us for more information\nToll Free : 8445550139", features: [], producer: "", creator: "", title: "", images: 0 } }],
  });
  const v = res.routes.find((r) => r.key === "vishing");
  assert.ok(v && v.strong >= 1);
  assert.ok(res.iocs.some((i) => i.type === "Cellphone" && i.value === "8445550139"));
});

// --- Identity, threads, Response routes, simulation, hypotheses (P1/P2) ----------------

const strongLabels = (res) => res.general.filter((s) => s.strength === "strong").map((s) => s.label).join(" | ");
const allLabels = (res) => res.general.map((s) => s.label).join(" | ");

test("Identity: sent to itself, URL fragments in From, date as display name, fake <address>", () => {
  const self = S.analyze({ layer: "nested", headers: { from: "Pat <pat.q@gmail.com>", to: "Pat <pat.q@gmail.com>", subject: "Document", received: "x" }, text: "Sam shared a document with you." });
  assert.match(strongLabels(self), /Sent to itself/);
  const forged = S.analyze({ layer: "nested", headers: { from: '"(3) Held Messages-" <=app%3A%2F%2F&x=1==info@shop.example>', to: "a@b.example", received: "x" }, text: "Storage is Full" });
  assert.match(strongLabels(forged), /URL fragments/);
  assert.match(allLabels(forged), /system notification/);
  const date = S.analyze({ layer: "nested", headers: { from: "03-14-2026 <ops.task9@gmail.com>", to: "a@b.example", received: "x" }, text: "Hi" });
  assert.match(strongLabels(date), /Display name is a date/);
  const fake = S.analyze({ layer: "nested", headers: { from: '"Billing Services <Admins_NDg4ODg4>" <postmaster@shop.example>', to: "a@b.example", received: "x" }, text: "Hi" });
  assert.match(strongLabels(fake), /invented address/);
});

test("Identity: Bcc mass mailing, delivered-for mismatch, greeting with the address, three names", () => {
  const bcc = S.analyze({ layer: "nested", headers: { from: "x@y.example", to: "undisclosed-recipients:;", received: "x" }, text: "Hello" });
  assert.match(allLabels(bcc), /Undisclosed recipients/);
  const moved = S.analyze({ layer: "nested", headers: { from: "x@y.example", to: "info@gov.example", received: "from a by b for <victim@bank.example>; Thu" }, text: "Hello" });
  assert.match(allLabels(moved), /delivered for victim@bank\.example/);
  const greet = S.analyze({ layer: "nested", headers: { from: "HR <hr@x.example>", to: "jane.doe@corp.example", received: "x" }, text: "Dear jane.doe,\nCheck the attached." });
  assert.match(strongLabels(greet), /local part of their address/);
  const three = S.analyze({ layer: "nested", headers: { from: "Rachel Moore <kim.ellis77@gmail.com>", to: "a@b.example", received: "x" }, text: "Hi there, I'm Dana Price!" });
  assert.match(allLabels(three), /three different people/);
});

test("Lookalikes: brand misspelt by one swap, recipient's organisation imitated", () => {
  assert.strictEqual(S.lookalikeBrand("wellsfrago.example"), "wellsfargo");
  assert.strictEqual(S.lookalikeBrand("wellsfargo.com"), null);
  const res = S.analyze({ layer: "nested", headers: { from: "IT <it@contsoso-corp.example>", to: "me@contoso-corp.example", received: "x" }, text: "Hello", orgDomains: ["contoso-corp.example"] });
  assert.match(strongLabels(res), /imitates the recipient's organisation/);
});

test("Filler: a stranger's old thread below the lure, random token strings, bolted-on refs", () => {
  const quoted = "From: Ann <ann@vendor.example>\nSent: Friday\nTo: Bob <bob@shop.example>\nSubject: RE: renewals\n\n" + "Any news on the renewal? They are close to expiry, please let me know as soon as possible. ".repeat(4) + "\nPhone : 704-555-0112";
  const res = S.analyze({
    layer: "nested",
    headers: { from: "Tasks <a@surf.example>", to: "me@corp.example", subject: "Wellness | ID:482-QZ-117", received: "x" },
    html: '<a href="https://track.example/c?u=https://kit.example/x"><img src="cid:1"></a><p>Qx7Lm|PWZTR|k2va|m9ub|7H3QA</p><p>' + quoted.replace(/\n/g, "<br>") + "</p>",
  });
  const labels = allLabels(res);
  assert.match(labels, /Old conversation between unrelated people/);
  assert.match(labels, /Random token string/);
  assert.match(labels, /Reference number bolted onto the subject/);
  assert.ok(!res.iocs.some((i) => i.type === "Cellphone"));
});

test("Fake 'Re:' that quotes only the sender: the quote still counts as the message", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "03-14-2026 <ops.task9@gmail.com>", to: "me@bank.example", subject: "Re: Alex", received: "x", "in-reply-to": "<a@mail.gmail.com>" },
    text: "Need confirmation, thanks.\n\nOn Sat, 14 Mar 2026 at 09:05, 03-14-2026 <ops.task9@gmail.com> wrote:\n\nGood afternoon,\n\nMain #cell to reach you ?\n\nAlex",
  });
  assert.strictEqual(res.routes[0].key, "bec");
  assert.ok(res.routes[0].strong >= 1);
  assert.match(allLabels(res), /Follows up on its own earlier message/);
  assert.ok(res.iocs.some((i) => i.value === "ops.task9@gmail.com"), "freemail sender carrying out the BEC is a candidate");
});

test("Payment to another freemail address (Interac) → BEC with the payment address as candidate", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "Lawn Care <lawn.care.svc@gmail.com>", to: "info@gov.example", received: "x" },
    text: "Your 2026 lawn-care invoice is still unpaid.\n\nPaiement par Interac :\n  * Courriel : lawn.billing@gmail.com\n  * Question : Pelouse\n\nPlease confirm your payment by email.",
  });
  assert.strictEqual(res.routes[0].key, "bec");
  assert.ok(res.iocs.some((i) => i.value === "lawn.billing@gmail.com" && /pay to/.test(i.reason)));
  assert.ok(res.inventory.addresses.some((a) => a.role === "Payment address in the body"));
});

test("419: the To address is the scammer's contact; implausible ROI beats a short-message probe; PII form", () => {
  const debt = S.analyze({
    layer: "nested",
    headers: { from: "Collections <coll.dept03@outlook.com>", to: "collector.anna@gmail.example.com", received: "x" },
    text: "COLLECTIONS & ACCOUNT RESOLUTION DEPARTMENT\nYour outstanding loan balance is $2,565.00. Settlement amount: $2,050.00.\nPlease contact Anna.\nEmail: collector.anna@gmail.example.com",
  });
  assert.match(strongLabels(debt), /To address is the contact/);
  const roi = S.analyze({ layer: "nested", headers: { from: "R <r@greenfuel.example>", to: "me@bank.example", subject: "quick question", received: "x" }, text: "We turn farm residue into jet fuel. Expecting a 520 % ROI. Raising $ 25M currently. Interested in seeing our deck?" });
  assert.strictEqual(roi.routes[0].key, "scam419");
  const form = S.analyze({ layer: "nested", headers: { from: "x@uni.example", to: "undisclosed-recipients:;", "reply-to": "agent77@gmail.com", received: "x" }, text: "Your compensation fund worth $3,400,000 USD has been approved.\nYour-Full Name:\nYour-Address:\nYour-Phone Number:\nYour-Country:\nYour-Birthday:\n" });
  assert.strictEqual(form.routes[0].key, "scam419");
  assert.ok(form.routes[0].strong >= 1);
  assert.ok(form.iocs.some((i) => i.value === "agent77@gmail.com"), "the Reply-To receives the replies");
  assert.ok(!form.routes.some((r) => r.key === "bec"), "a diverted reply alone is not BEC");
});

test("RECON: family-office pitch and dev-shop outreach", () => {
  const fo = S.analyze({ layer: "nested", headers: { from: "J <j@commerce.example>", to: "d@cu.example", received: "x" }, text: "Hey Sam, wanted to get in touch. Our team has direct contacts at family-office philanthropies. Would that be worth discussing? Thank you, J" });
  assert.strictEqual(fo.routes[0].key, "recon");
  const dev = S.analyze({ layer: "nested", headers: { from: "C <c@mail.techco.example>", to: "x@corp.example", received: "x" }, text: "hi, are you expanding your engineering team? we help companies build custom web and mobile applications with senior developers. let me know if you are open to a brief discussion. thanks, team" });
  assert.strictEqual(dev.routes[0].key, "recon");
});

test("Webinar platform with the organiser's Reply-To is not a diversion", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "Lee <noreply@swoogo.com>", "reply-to": "lee@organiser.example", to: "me@bank.example", received: "x", "authentication-results": "spf=pass dkim=pass dmarc=pass" }, html: '<p>Join our virtual forum.</p><a href="https://go.swoogo.com/ls/click?upn=abc">Secure your spot</a><a href="https://go.swoogo.com/unsub">Unsubscribe</a>' });
  assert.ok(!res.routes.some((r) => r.key === "bec"));
  assert.strictEqual(res.iocs.length, 0);
});

test("Secure-message lure of a bank → Link → Phishing; Microsoft storage lure → O365", () => {
  const bank = S.analyze({ layer: "nested", headers: { from: "Servicing TDbank Department <noreply@search.example>", to: "c@uni.example", subject: "Secure Email", received: "x" }, html: '<p>TD Secure Email. Please log in using your email address to view the message.</p><a href="https://kit.example/l">Click here to open</a>' });
  assert.strictEqual(bank.routes[0].key, "phishing");
  const ms = S.analyze({ layer: "nested", headers: { from: "Mail <a@b.example>", to: "c@d.example", received: "x" }, html: '<p>Storage is Full. Your Outlook mailbox has 9 held incoming emails.</p><a href="https://www.google.com/goto?url=CAESXgHrOz">Manage Storage</a>' });
  assert.strictEqual(ms.routes[0].key, "o365");
  assert.match(strongLabels(ms), /Google redirect that hides/);
});

test("Disguised action link without lure words still points to Link → Phishing", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "x@y.example", to: "a@b.example", received: "x" }, html: '<a href="http://xn--gorka-95a.kit.example/abc">----------------------</a><p>A new approach to memory.</p>' });
  assert.strictEqual(res.routes[0].key, "phishing");
  assert.match(strongLabels(res), /punctuation|punycode/);
});

test("Mail-merge tracker named after the sender is tracking, not a mismatch", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "L <l@acmefoundation.org>", to: "a@b.example", received: "x" }, html: '<a href="https://acmefoundation-dot-yamm-track.appspot.com/2xYz">acmefoundation.org</a>' });
  assert.ok(!res.routes.some((r) => r.key === "phishing"));
});

test("Signature social links are not action links", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "a@b.example", to: "c@d.example", received: "x" }, html: '<p>Regards</p><a href="https://www.facebook.com/somepage"><img src="cid:fb"></a>' });
  assert.ok(!res.inventory.links.some((l) => l.action));
});

test("Simulation: generic marker is a weak hint; a listed domain leads and clears candidates", () => {
  const generic = S.analyze({ layer: "forwarded", inline: true, headers: { from: "Teams <t@lookalike.example>", to: "e@corp.example", "message-id": "<threatsim-c4322-7481@app.sim.example>" }, html: '<p>You have been added to a group.</p><img src="https://teams.lookalike.example/pixel_c4322.gif">' });
  const sim = generic.routes.find((r) => r.key === "simulation");
  assert.ok(sim && !sim.strong);
  const listed = S.analyze({
    layer: "nested",
    headers: { from: "Security <notification@lookalike.example>", to: "e@corp.example", received: "x" },
    html: '<p>Verify your identity to review the account activity.</p><a href="https://www.sim-portal.example/profile.html?id=1">Review account activity</a>',
    simulationDomains: [{ domain: "sim-portal.example", vendor: "Vendor X", source: "vendor allowlist page" }],
  });
  assert.strictEqual(listed.routes[0].key, "simulation");
  assert.strictEqual(listed.iocs.length, 0);
  assert.match(listed.routes[0].signals[0].label, /Vendor X.*vendor allowlist page/);
});

test("Hypotheses: DNE with suspicious signs and no route; NTD when nothing is off; never above a strong route", () => {
  const dne = S.analyze({ layer: "nested", headers: { from: "Jo <jo.w4471@gmail.com>", to: "s@bank.example", received: "x", "authentication-results": "spf=pass dkim=fail dmarc=fail" }, text: "Hello, I found your profile and would like to hear how you like working in your field and what the neighbourhood is like for newcomers." });
  assert.strictEqual(dne.routes[dne.routes.length - 1].key, "dne");
  const ntd = S.analyze({ layer: "nested", headers: { from: "Ana <ana@firm.example>", to: "v@client.example", received: "x", "authentication-results": "spf=pass dkim=pass dmarc=pass" }, text: "Bonjour, voici le rapport et la facture pour le dossier. Cordialement, Ana" });
  assert.deepStrictEqual(ntd.routes.map((r) => r.key), ["ntd"]);
  const strong = S.analyze({ layer: "nested", headers: { from: "x@gmail.com", to: "y@z.example", received: "x" }, text: "Main #cell to reach you?" });
  assert.ok(!strong.routes.some((r) => r.key === "dne" || r.key === "ntd"));
});

// --- QR codes and written URLs ------------------------------------------------------

const pdfScan = (extra) => Object.assign({ ok: true, pages: 1, encrypted: false, uris: [], textUris: [], qr: [], text: "", features: [], producer: "", creator: "", title: "", images: 1 }, extra);

test("QR code in the body: its link is an action link even on the sender's domain, and points to O365 with a sign-in lure", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "IT Desk <it@helpdesk-portal.example>", to: "me@corp.example", subject: "Security alert", received: "x" },
    html: '<p>Install the new antivirus: enter your work credentials after scanning the QR code below.</p><img src="cid:qr1">',
    attachments: [{ name: "qr.png", contentType: "image/png", size: 900 }],
    files: [S.qrFile("qr.png", "https://scan.helpdesk-portal.example/i/abc", "body")],
  });
  assert.strictEqual(res.routes[0].key, "o365");
  assert.ok(res.general.some((s) => /Link from a QR code in the body/.test(s.label) && s.strength === "strong"));
  assert.ok(res.iocs.some((i) => i.value === "https://scan.helpdesk-portal.example/i/abc"));
  assert.ok(res.inventory.links.some((l) => l.flags.some((f) => /QR in the body/.test(f))));
});

test("QR code in an attached image → Docuphish with the image and the QR's URL as candidates", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "HR <hr@x.example>", to: "me@corp.example", subject: "Benefits", received: "x" },
    text: "See the attached flyer.",
    attachments: [{ name: "flyer.png", contentType: "image/png", size: 80000 }],
    files: [S.qrFile("flyer.png", "https://benefits-enroll.example/q", "attachment", "cd".repeat(32))],
  });
  const d = res.routes.find((r) => r.key === "docuphish");
  assert.ok(d && d.strong);
  assert.ok(res.iocs.some((i) => i.type === "Attachment" && /flyer\.png · SHA-256 cdcd/.test(i.value)));
  assert.ok(res.iocs.some((i) => i.value === "https://benefits-enroll.example/q"));
});

test("QR code inside a PDF → Docuphish strong; a URL written in a PDF needs a call to action", () => {
  const base = { layer: "nested", headers: { from: "A <a@vendor.example>", to: "me@corp.example", subject: "Remittance", received: "x" }, text: "Please review the attached.", attachments: [{ name: "doc.pdf", contentType: "application/pdf" }] };
  const qr = S.analyze(Object.assign({}, base, { files: [{ name: "doc.pdf", scan: pdfScan({ qr: ["https://qr-lure.example/scan?id=7"], text: "Scan to view" }) }] }));
  assert.ok(qr.routes.find((r) => r.key === "docuphish").signals.some((s) => /has a QR code/.test(s.label) && s.strength === "strong"));
  assert.ok(qr.inventory.links.some((l) => l.flags.includes("QR in doc.pdf")));
  const cta = S.analyze(Object.assign({}, base, { files: [{ name: "doc.pdf", scan: pdfScan({ textUris: ["https://portal-docs.example/view"], text: "To view the secure document copy https://portal-docs.example/view in your browser" }) }] }));
  assert.ok(cta.routes.find((r) => r.key === "docuphish").strong);
  assert.ok(cta.iocs.some((i) => i.value === "https://portal-docs.example/view"));
  const plain = S.analyze(Object.assign({}, base, { files: [{ name: "doc.pdf", scan: pdfScan({ textUris: ["https://www.partner.example"], text: "Our partner: www.partner.example" }) }] }));
  const d = plain.routes.find((r) => r.key === "docuphish");
  assert.ok(!d || !d.strong);
  assert.ok(!plain.iocs.some((i) => i.type === "URL"));
});

test("A QR code that holds text, not a link, is only noted", () => {
  const res = S.analyze({ layer: "nested", headers: { from: "a@b.example", to: "c@d.example", received: "x" }, text: "", attachments: [{ name: "wifi.png", contentType: "image/png", size: 2000 }], files: [S.qrFile("wifi.png", "WIFI:S:Guest;T:WPA;P:pass1234;;", "attachment")] });
  assert.ok(res.general.some((s) => /QR code in the attached image/.test(s.label)));
  assert.ok(!res.routes.some((r) => r.key === "docuphish"));
});
