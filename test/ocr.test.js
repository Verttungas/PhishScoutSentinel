const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
require("../phones.js");
const S = require("../signals.js");

// The vendored OCR files must stay exactly the tesseract.js 5.1.1 / tesseract.js-core 5.1.1 /
// @tesseract.js-data 1.0.0 (4.0.0_best_int) files that were checked against jsDelivr's hashes.
const PINNED = {
  "ocr/tesseract.min.js": "a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8",
  "ocr/worker.min.js": "aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc",
  "ocr/tesseract-core-simd-lstm.wasm.js": "ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf",
  "ocr/lang/eng.traineddata.gz": "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
  "ocr/lang/fra.traineddata.gz": "d611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255",
  "ocr/lang/spa.traineddata.gz": "40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb",
};

test("vendored OCR files match their pinned SHA-256", () => {
  for (const [file, sha] of Object.entries(PINNED)) {
    const got = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "..", file))).digest("hex");
    assert.strictEqual(got, sha, file);
  }
});

test("ocr.js loads everything from the add-on, never from a CDN", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "ocr.js"), "utf8");
  assert.doesNotMatch(src, /https?:\/\//);
  for (const p of ["ocr/tesseract.min.js", "ocr/worker.min.js", "ocr/tesseract-core-simd-lstm.wasm.js", "ocr/lang"]) assert.ok(src.includes(p), p);
  assert.match(src, /workerBlobURL:\s*false/);
  assert.match(src, /cacheMethod:\s*"none"/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.match(manifest.content_security_policy, /'wasm-unsafe-eval'/);
  assert.ok(manifest.background.scripts.includes("ocr.js"));
});

test("text read from an image counts as the body: Interac payment address → BEC", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "Ana <ana.k@uni.example>", to: "office@acme-hr.example", subject: "Re: Invoice 2026", received: "x" },
    text: "COURRIEL EXTERNE / EXTERNAL EMAIL\nCe courriel provient de l'externe. Ne divulguez aucune information confidentielle. / This email is from an external source. Do not disclose any confidential information.",
    attachments: [{ name: "image.png", contentType: "image/png", size: 900000 }],
    files: [S.ocrFile("image.png", "Votre facture est disponible.\nVeuillez effectuer le paiement par virement Interac :\nAdresse courriel pour le paiement :\nbilling.desk77@gmail.com", 81, "ab".repeat(32))],
  });
  assert.strictEqual(res.routes[0].key, "bec");
  assert.ok(res.iocs.some((i) => i.value === "billing.desk77@gmail.com"));
  assert.strictEqual(res.ocrTexts.length, 1);
  assert.match(res.inventory.attachments[0].info, /Read with OCR \(81% confidence\)/);
});

test("a lookalike URL written inside an image is flagged and goes to Verify", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "c@mail.example", to: "b@bank.example", subject: "Possible spam", received: "x" },
    text: "",
    attachments: [{ name: "screenshot.png", contentType: "image/png", size: 300000 }],
    files: [S.ocrFile("screenshot.png", "Your loan is past due. Visit our secure portal https://helps.wells-fargo-pay.example/x/7Kd2", 90)],
  });
  assert.ok(res.general.some((s) => /URL inside the image imitates the “wellsfargo” brand/.test(s.label)));
  assert.ok(res.verify.some((v) => /wells-fargo-pay/.test(v.what)));
});

test("image text is not treated as a PDF (no Docuphish from a picture of a link)", () => {
  const res = S.analyze({
    layer: "nested",
    headers: { from: "a@b.example", to: "c@d.example", received: "x" },
    text: "",
    attachments: [{ name: "flyer.jpg", contentType: "image/jpeg", size: 700000 }],
    files: [S.ocrFile("flyer.jpg", "Join us tonight at 9 PM: https://events.example/zoom", 70)],
  });
  assert.ok(!res.routes.some((r) => r.key === "docuphish"));
});
