#!/usr/bin/env node
/**
 * Reads the images of a folder of .eml samples the way the add-on does — QR codes with
 * jsQR (every image, and the JPEG images inside PDFs) and text with its own OCR
 * (ocr/, images ≥ 15 KB, six largest per message) — and writes the cache
 * eval-samples.js takes with --image-cache. Images are decoded by a browser, so this
 * script serves a page on 127.0.0.1 only:
 *
 *   node scripts/image-samples.js "/path/to/EML Samples" image-cache.json [port]
 *   → open http://127.0.0.1:8765/ in a browser; the script exits when it is done.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const N = require(path.join(__dirname, "..", "nested.js"));
require(path.join(__dirname, "..", "phones.js"));
const S = require(path.join(__dirname, "..", "signals.js"));

const [root, outFile, portArg] = process.argv.slice(2);
if (!root || !outFile) {
  console.error('Usage: node scripts/image-samples.js "/path/to/EML Samples" image-cache.json [port]');
  process.exit(1);
}
const port = +(portArg || 8765);
const OCR_DIR = path.join(__dirname, "..", "ocr");

function walk(dir, acc) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== "Documents") walk(p, acc);
    } else if (/\.eml$/i.test(f)) acc.push(p);
  }
  return acc;
}

const images = new Map();
function add(bytes, mime, job) {
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const cur = images.get(sha) || { mime, bytes, qr: false, ocr: false };
  cur[job] = true;
  images.set(sha, cur);
}
function collect(msg) {
  const all = (msg.images || [])
    .map((img) => ({ mime: img.mime, bytes: Buffer.from(String(img.dataUrl).split(",")[1] || "", "base64") }))
    .filter((img) => !/svg|icon/.test(img.mime || ""));
  for (const img of all.slice(0, 12)) add(img.bytes, img.mime, "qr");
  for (const img of all.filter((x) => x.bytes.length >= 15000).sort((a, b) => b.bytes.length - a.bytes.length).slice(0, 6)) add(img.bytes, img.mime, "ocr");
  // JPEG images inside PDF attachments (raw ones are decoded by pdfscan.js itself).
  for (const f of S.scanFiles(msg, S.addressesIn((msg.headers || {}).to))) {
    for (const j of (f.scan && f.scan.jpegs) || []) add(Buffer.from(j), "image/jpeg", "qr");
  }
  for (const m of msg.nested || []) collect(m);
}
for (const file of walk(root, [])) collect(N.parseMessage(fs.readFileSync(file).toString("latin1"), 0));
console.log(images.size + " images to read. Open http://127.0.0.1:" + port + "/");

const results = {};
const PAGE = `<!doctype html><meta charset="utf-8"><title>OCR samples</title>
<body style="font:14px system-ui;margin:24px"><p id="s">Loading…</p>
<script src="/ocr/tesseract.min.js"></script>
<script src="/jsqr.min.js"></script>
<script>
(async () => {
  const s = document.getElementById("s");
  const list = await (await fetch("/list")).json();
  async function qr(sha) {
    const bmp = await createImageBitmap(await (await fetch("/img/" + sha)).blob());
    const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    if (w < 21 || h < 21) return null;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(bmp, 0, 0, w, h);
    const hit = jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    return hit ? hit.data : null;
  }
  const w = await Tesseract.createWorker(["eng", "fra", "spa"], 1, {
    workerPath: location.origin + "/ocr/worker.min.js",
    corePath: location.origin + "/ocr/tesseract-core-simd-lstm.wasm.js",
    langPath: location.origin + "/ocr/lang",
    workerBlobURL: false, cacheMethod: "none", gzip: true,
  });
  let i = 0;
  for (const item of list) {
    s.textContent = "Reading " + (++i) + " of " + list.length;
    const out = { sha: item.sha };
    if (item.qr) out.qr = await qr(item.sha).catch(() => null);
    if (item.ocr) {
      const { data } = await w.recognize("/img/" + item.sha);
      out.text = data.text;
      out.confidence = data.confidence;
    }
    await fetch("/result", { method: "POST", body: JSON.stringify(out) });
  }
  await w.terminate();
  await fetch("/done", { method: "POST" });
  s.textContent = "Done: " + list.length + " images.";
  window.__ocrDone = true;
})().catch((e) => { document.getElementById("s").textContent = "Error: " + e; window.__ocrError = String(e); });
</script>`;

const TYPES = { ".js": "text/javascript", ".gz": "application/gzip", ".wasm": "application/wasm" };
http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (url === "/result") {
          const r = JSON.parse(body);
          results[r.sha] = {};
          if (r.text !== undefined) Object.assign(results[r.sha], { text: String(r.text || "").trim(), confidence: Math.round(r.confidence || 0) });
          if (r.qr !== undefined) results[r.sha].qr = r.qr;
        }
        res.end("ok");
        if (url === "/done") {
          fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
          console.log("Wrote " + Object.keys(results).length + " results to " + outFile);
          setTimeout(() => process.exit(0), 200);
        }
      });
      return;
    }
    if (url === "/") return res.end(PAGE);
    if (url === "/list") return res.end(JSON.stringify(Array.from(images, ([sha, v]) => ({ sha, qr: v.qr, ocr: v.ocr }))));
    if (url === "/jsqr.min.js") {
      res.setHeader("Content-Type", "text/javascript");
      return fs.createReadStream(path.join(__dirname, "..", "jsqr.min.js")).pipe(res);
    }
    if (url.startsWith("/img/")) {
      const img = images.get(url.slice(5));
      if (!img) return (res.statusCode = 404), res.end();
      res.setHeader("Content-Type", img.mime || "image/png");
      return res.end(img.bytes);
    }
    if (url.startsWith("/ocr/")) {
      const p = path.join(OCR_DIR, path.normalize(url.slice(5)).replace(/^(\.\.[/\\])+/, ""));
      if (!p.startsWith(OCR_DIR) || !fs.existsSync(p)) return (res.statusCode = 404), res.end();
      res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream");
      return fs.createReadStream(p).pipe(res);
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(port, "127.0.0.1");
