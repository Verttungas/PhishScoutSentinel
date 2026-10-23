const test = require("node:test");
const assert = require("node:assert");
const F = require("../forwards.js");

test("Outlook inline forward: wrapper and original, with the original's links only", () => {
  const text = [
    "A customer received this email.",
    "",
    "Pat Doe | Relationship Manager",
    "",
    "From: Servicing Department <noreply@search.example>",
    "Sent: Thursday, October 22, 2026 4:00 PM",
    "To: Client <client@uni.example>",
    "Subject: Account alert: payoff requested",
    "",
    "Please log in to view the secure message.",
  ].join("\n");
  const html =
    "<p>A customer received this email.</p><p>Pat Doe</p>" +
    "<p><b>From:</b> Servicing Department &lt;noreply@search.example&gt;<br><b>Sent:</b> Thursday<br><b>To:</b> Client<br><b>Subject:</b> Account alert</p>" +
    '<p>Please <a href="https://evil.example/login">log in</a> to view the secure message.</p>';
  const s = F.split(text, html);
  assert.ok(s);
  assert.strictEqual(s.messages.length, 1);
  assert.match(s.wrapper.text, /A customer received this email/);
  assert.doesNotMatch(s.wrapper.html, /evil\.example/);
  const m = s.messages[0];
  assert.strictEqual(m.fromAddress, "noreply@search.example");
  assert.strictEqual(m.headers.subject, "Account alert: payoff requested");
  assert.match(m.text, /log in to view/);
  assert.match(m.html, /evil\.example\/login/);
});

test("Chain of forwards in French and Spanish keeps the innermost original last", () => {
  const text = [
    "________________________________",
    "De : Cliente <cliente@mail.example>",
    "Envoyé : 19 octobre 2026 20:21",
    "À : Agence <agence@bank.example>",
    "Objet : TR: Paiement",
    "",
    "Envoyé de mon téléphone",
    "",
    "De: Ventas <ventas@vendor.example>",
    "Enviado: miércoles, 12 de agosto de 2026",
    "Para: Cliente <cliente@mail.example>",
    "Asunto: Wire / SWIFT en USD",
    "",
    "Datos bancarios: SWIFT/BIC XXXXKYKY, Account Number 0000000000",
  ].join("\n");
  const s = F.split(text, "");
  assert.strictEqual(s.messages.length, 2);
  assert.strictEqual(s.messages[1].fromAddress, "ventas@vendor.example");
  assert.strictEqual(s.messages[1].headers.subject, "Wire / SWIFT en USD");
  assert.match(s.messages[1].text, /SWIFT/);
  assert.strictEqual(s.wrapper.text.trim(), "");
});

test("Gmail forward with To after Subject; Apple 'Begin forwarded message'", () => {
  const gmail = "FYI\n\n---------- Forwarded message ---------\nFrom: A <a@x.example>\nDate: Wed, 2 Apr 2025\nSubject: Hello\nTo: <b@y.example>\n\n\nBody here";
  const g = F.split(gmail, "");
  assert.strictEqual(g.messages[0].headers.to, "<b@y.example>");
  assert.strictEqual(g.messages[0].text.trim(), "Body here");
  const apple = "Did you send this?\n\nBegin forwarded message:\nFrom: Notice <n@z.example>\nDate: October 22, 2026\nTo: me@w.example\nSubject: Secure Email\n\nOpen it";
  const a = F.split(apple, "");
  assert.strictEqual(a.messages[0].fromAddress, "n@z.example");
  assert.match(a.wrapper.text, /Did you send this/);
});

test("No header block → null; a lone From line is not a block", () => {
  assert.strictEqual(F.split("Hello\nFrom: someone who said hi\nbye", ""), null);
});

test("Reporting mailboxes", () => {
  for (const a of ["phishing@bank.example", "abuse@bank.example", "protection-phishing@bank.example", "report.phish@x.example", "soc@x.example"]) {
    assert.ok(F.isReportMailbox(a), a);
  }
  for (const a of ["john.doe@bank.example", "phil@x.example", "info@x.example"]) assert.ok(!F.isReportMailbox(a), a);
});
