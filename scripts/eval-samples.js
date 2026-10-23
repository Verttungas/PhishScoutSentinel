#!/usr/bin/env node
/**
 * Runs the insights engine over a folder of classified .eml samples and compares the
 * route it points to with the folder each sample sits in (e.g. Malicious/Link/O365,
 * NTD, FIR). Layers are built the way background.js builds them.
 *
 *   node scripts/eval-samples.js "/path/to/EML Samples" [--json out.json] [--verbose]
 *
 * The samples hold real customer mail: keep them outside the repository.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = path.join(__dirname, "..");
require(path.join(REPO, "phones.js"));
const S = require(path.join(REPO, "signals.js"));
const N = require(path.join(REPO, "nested.js"));
const ICS = require(path.join(REPO, "ics.js"));

const args = process.argv.slice(2);
const root = args.find((a, i) => !a.startsWith("--") && !["--json", "--settings", "--image-cache"].includes(args[i - 1]));
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const verbose = args.includes("--verbose");
// Optional JSON with the popup's settings: {"simulationDomains": [{"domain", "vendor", "source"}], "orgDomains": []}.
const settings = args.includes("--settings") ? JSON.parse(fs.readFileSync(args[args.indexOf("--settings") + 1], "utf8")) : {};
// Optional image results from scripts/image-samples.js: {"<sha256 of the image>":
// {"qr": "payload" | null, "text": "...", "confidence": 90}}. QR codes are decoded by the
// add-on on its own; the OCR text is what "Read images (OCR)" adds (--no-ocr leaves it out).
const imageCache = args.includes("--image-cache") ? JSON.parse(fs.readFileSync(args[args.indexOf("--image-cache") + 1], "utf8")) : null;
const withOcr = !args.includes("--no-ocr");
if (!root) {
  console.error("Usage: node scripts/eval-samples.js <samples folder> [--json out.json] [--verbose]");
  process.exit(1);
}

// Folder → route key the engine should put first (null = no Malicious route expected).
const EXPECTED = [
  [/Malicious\/Link\/O365/i, "o365"],
  [/Malicious\/Link\/Phishing/i, "phishing"],
  [/Malicious\/Link\/Link to Payload/i, "linkpayload"],
  [/Malicious\/Payload/i, "docuphish"],
  [/Malicious\/Response\/419/i, "scam419"],
  [/Malicious\/Response\/BEC/i, "bec"],
  [/Malicious\/Response\/RECON/i, "recon"],
  [/Malicious\/Response\/Vishing/i, "vishing"],
  [/Malicious\/Response\/Job/i, "job"],
  [/Malicious\/Response\/Tech/i, "techsupport"],
  [/^FIR/i, "fir"],
  [/^(NTD|DNE|Simulation)/i, null],
];

function expectedFor(truth) {
  for (const [re, key] of EXPECTED) if (re.test(truth)) return { key };
  return { key: undefined };
}

function walk(dir, acc) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    // A "Documents" folder copied into the samples is not a sample.
    if (st.isDirectory()) {
      if (f !== "Documents") walk(p, acc);
    } else if (/\.eml$/i.test(f)) acc.push(p);
  }
  return acc;
}

function withHashes(files) {
  return (files || []).map((f) => Object.assign({}, f, { sha256: crypto.createHash("sha256").update(Buffer.from(f.bytes, "latin1")).digest("hex") }));
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// Files the add-on adds for a message's images: QR codes (every image, as the background
// decodes them) and OCR text (≥ 15 KB, six largest), taken from the image cache.
function imageFiles(msg) {
  if (!imageCache) return [];
  const imgs = (msg.images || [])
    .map((img) => ({ name: img.name || "image", inline: img.inline, mime: img.mime, bytes: Buffer.from(String(img.dataUrl).split(",")[1] || "", "base64") }))
    .filter((img) => !/svg|icon/.test(img.mime || ""));
  const out = [];
  for (const img of imgs.slice(0, 12)) {
    const hit = imageCache[sha256(img.bytes)];
    if (hit && hit.qr) out.push(S.qrFile(img.name, hit.qr, img.inline ? "body" : "attachment", sha256(img.bytes)));
  }
  if (withOcr) {
    for (const img of imgs.filter((x) => x.bytes.length >= 15000).sort((a, b) => b.bytes.length - a.bytes.length).slice(0, 6)) {
      const hit = imageCache[sha256(img.bytes)];
      if (hit && hit.text !== undefined) out.push(S.ocrFile(img.name, hit.text, hit.confidence, sha256(img.bytes)));
    }
  }
  return out;
}

// PDFs scanned up front (as background.js does), with the QR codes of their JPEG images
// taken from the image cache; then the image files.
function scannedFiles(msg) {
  const files = S.scanFiles(Object.assign({}, msg, { files: withHashes(msg.files) }), S.addressesIn((msg.headers || {}).to));
  for (const f of files) {
    const sc = f.scan;
    if (!sc || !sc.jpegs) continue;
    for (const j of sc.jpegs) {
      const hit = imageCache && imageCache[sha256(Buffer.from(j))];
      if (hit && hit.qr && sc.qr.indexOf(hit.qr) < 0) sc.qr.push(hit.qr);
    }
    delete sc.jpegs;
  }
  return files.concat(imageFiles(msg));
}

function icsUrls(raw) {
  const urls = [];
  for (const c of raw.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/g) || []) for (const u of ICS.parseIcsUrls(c)) if (!urls.includes(u)) urls.push(u);
  return urls;
}

function analyse(raw) {
  const top = N.parseMessage(raw, 0);
  const outer = {
    layer: "outer",
    headers: top.headers,
    subject: top.subject,
    text: top.text,
    html: top.html,
    attachments: top.attachments,
    files: scannedFiles(top),
    hasNestedEml: !!(top.nested && top.nested.length),
  };
  const nested = [];
  (function push(list) {
    for (const m of list || []) {
      if (m.html || m.text || (m.images && m.images.length)) nested.push(Object.assign({}, m, { files: scannedFiles(m), hasNestedEml: !!(m.nested && m.nested.length) }));
      push(m.nested);
    }
  })(top.nested);
  if (S.analyzeAll) return S.analyzeAll(outer, nested.slice(0, 5), icsUrls(raw), settings);
  // Engines before analyzeAll: outer layer plus attached messages.
  const layers = [S.analyze(Object.assign({ label: "Opened message" }, outer))];
  for (const m of nested.slice(0, 5)) layers.push(S.analyze(Object.assign({ layer: "nested" }, m)));
  return layers;
}

const rows = [];
for (const file of walk(root, []).sort()) {
  const rel = path.relative(root, file);
  const truth = path.dirname(rel);
  const raw = fs.readFileSync(file).toString("latin1");
  let layers;
  try {
    layers = analyse(raw);
  } catch (e) {
    rows.push({ file: rel, truth, error: String(e && e.stack || e) });
    continue;
  }
  // The sidebar opens on the second layer when there is one (attached or forwarded original).
  const shown = layers[layers.length > 1 ? 1 : 0];
  const NOT_MALICIOUS = ["simulation", "dne", "ntd"];
  const malicious = shown.routes.filter((r) => r.key.indexOf("fir") !== 0 && !NOT_MALICIOUS.includes(r.key));
  const hint = shown.routes.find((r) => ["simulation", "dne", "ntd"].includes(r.key));
  rows.push({
    file: rel,
    truth,
    expected: expectedFor(truth).key,
    layers: layers.map((l) => l.short || l.label || l.layer),
    top: shown.routes[0] ? shown.routes[0].key : null,
    topStrong: shown.routes[0] ? shown.routes[0].strong : 0,
    topMalicious: malicious[0] ? malicious[0].key : null,
    hint: hint ? hint.key + (hint.strong ? "*" : "") : null,
    // Counted only when the malicious route is what the sidebar puts first.
    topMaliciousStrong: malicious[0] && malicious[0] === shown.routes[0] ? malicious[0].strong : 0,
    routes: shown.routes.map((r) => r.key + (r.strong ? "*" + r.strong : "") + "/" + r.signals.length),
    iocs: shown.iocs.map((i) => i.type + ": " + i.value),
    general: shown.general.filter((g) => g.strength === "strong").map((g) => g.label),
    detail: verbose ? shown : undefined,
  });
}

// --- Scoring -----------------------------------------------------------------------
function hit(r) {
  if (r.error) return false;
  if (r.expected === "fir") return !!r.top && r.top.indexOf("fir") === 0;
  if (r.expected === null) return !r.topMaliciousStrong;
  return r.top === r.expected;
}
const mal = rows.filter((r) => r.expected && r.expected !== "fir");
const non = rows.filter((r) => r.expected === null || r.expected === "fir");
const score = {
  samples: rows.length,
  maliciousTop1: mal.filter(hit).length + " / " + mal.length,
  maliciousTop1Strong: mal.filter((r) => hit(r) && r.topStrong).length + " / " + mal.length,
  maliciousAnywhere: mal.filter((r) => r.routes.some((x) => x.split(/[*/]/)[0] === r.expected)).length + " / " + mal.length,
  firTop1: rows.filter((r) => r.expected === "fir" && hit(r)).length + " / " + rows.filter((r) => r.expected === "fir").length,
  nonMaliciousWithStrongMaliciousRoute: non.filter((r) => r.topMaliciousStrong).length + " / " + non.length,
  // DNE → dne, NTD → ntd, Simulation → simulation hypothesis on the analysed layer.
  nonMaliciousHypothesis: rows.filter((r) => r.expected === null && r.hint && r.hint.replace("*", "") === r.truth.split("/")[0].toLowerCase()).length + " / " + rows.filter((r) => r.expected === null).length,
  candidatesOnNonMalicious: non.reduce((n, r) => n + (r.iocs ? r.iocs.length : 0), 0),
  errors: rows.filter((r) => r.error).length,
};

for (const r of rows) {
  const mark = r.error ? "ERR" : hit(r) ? " ok" : " --";
  console.log(mark + "  " + r.truth.padEnd(28) + " " + (r.routes ? r.routes.slice(0, 4).join(", ") || "-" : r.error.split("\n")[0]));
  if (r.layers && r.layers.length > 1) console.log("       layers: " + r.layers.join(" | "));
  if (r.iocs && r.iocs.length) console.log("       candidates: " + r.iocs.slice(0, 5).join(" · "));
}
console.log("\n" + JSON.stringify(score, null, 2));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ score, rows }, null, 1));
