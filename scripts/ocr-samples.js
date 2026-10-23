#!/usr/bin/env node
/**
 * Reads the images of a folder of .eml samples with the add-on's own OCR (ocr/, the
 * tesseract.js browser build) and writes the cache eval-samples.js takes with
 * --ocr-cache. tesseract.js here is the browser build, so the reading happens in a
 * browser page this script serves on 127.0.0.1 only:
 *
 *   node scripts/ocr-samples.js "/path/to/EML Samples" ocr-cache.json [port]
 *   → open http://127.0.0.1:8765/ in a browser; the script exits when it is done.
 *
 * Images are picked the way the sidebar picks them (≥ 15 KB, six largest per message).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const N = require(path.join(__dirname, "..", "nested.js"));

const [root, outFile, portArg] = process.argv.slice(2);
if (!root || !outFile) {
  console.error('Usage: node scripts/ocr-samples.js "/path/to/EML Samples" ocr-cache.json [port]');
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
function collect(msg) {
  const list = (msg.images || [])
    .map((img) => ({ name: img.name || "image", mime: img.mime, bytes: Buffer.from(String(img.dataUrl).split(",")[1] || "", "base64") }))
    .filter((img) => img.bytes.length >= 15000 && !/svg|icon/.test(img.mime || ""))
    .sort((a, b) => b.bytes.length - a.bytes.length)
    .slice(0, 6);
  for (const img of list) images.set(crypto.createHash("sha256").update(img.bytes).digest("hex"), img);
  for (const m of msg.nested || []) collect(m);
}
for (const file of walk(root, [])) collect(N.parseMessage(fs.readFileSync(file).toString("latin1"), 0));
console.log(images.size + " images to read. Open http://127.0.0.1:" + port + "/");

const results = {};
const PAGE = `<!doctype html><meta charset="utf-8"><title>OCR samples</title>
<body style="font:14px system-ui;margin:24px"><p id="s">Loading…</p>
<script src="/ocr/tesseract.min.js"></script>
<script>
(async () => {
  const s = document.getElementById("s");
  const list = await (await fetch("/list")).json();
  const w = await Tesseract.createWorker(["eng", "fra", "spa"], 1, {
    workerPath: location.origin + "/ocr/worker.min.js",
    corePath: location.origin + "/ocr/tesseract-core-simd-lstm.wasm.js",
    langPath: location.origin + "/ocr/lang",
    workerBlobURL: false, cacheMethod: "none", gzip: true,
  });
  let i = 0;
  for (const sha of list) {
    s.textContent = "Reading " + (++i) + " of " + list.length;
    const { data } = await w.recognize("/img/" + sha);
    await fetch("/result", { method: "POST", body: JSON.stringify({ sha, text: data.text, confidence: data.confidence }) });
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
          results[r.sha] = { text: String(r.text || "").trim(), confidence: Math.round(r.confidence || 0) };
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
    if (url === "/list") return res.end(JSON.stringify(Array.from(images.keys())));
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
