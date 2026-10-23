/**
 * On-demand OCR for images in a message (background page only). Uses the copy of
 * tesseract.js 5.1.1 in ocr/ (Apache-2.0): its worker, the SIMD LSTM core and the
 * English, French and Spanish "best_int" models. Everything loads from the add-on
 * itself; nothing is fetched from the network and nothing is cached outside memory.
 *
 * The library and the worker are loaded on the first request (about 10 MB) and the
 * worker is closed after a few idle minutes.
 */
(function (root) {
  "use strict";

  const LANGS = ["eng", "fra", "spa"];
  const IDLE_MS = 3 * 60 * 1000;
  let workerPromise = null;
  let idleTimer = 0;

  function url(path) {
    return root.messenger && root.messenger.runtime ? root.messenger.runtime.getURL(path) : path;
  }

  function loadLibrary() {
    if (root.Tesseract) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = url("ocr/tesseract.min.js");
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("The OCR library is missing from the add-on.")); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function worker() {
    if (!workerPromise) {
      workerPromise = loadLibrary()
        .then(function () {
          return root.Tesseract.createWorker(LANGS, 1, {
            workerPath: url("ocr/worker.min.js"),
            corePath: url("ocr/tesseract-core-simd-lstm.wasm.js"),
            langPath: url("ocr/lang"),
            workerBlobURL: false,
            cacheMethod: "none",
            gzip: true,
          });
        })
        .catch(function (e) {
          workerPromise = null;
          throw e;
        });
    }
    return workerPromise;
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      const p = workerPromise;
      workerPromise = null;
      if (p) p.then(function (w) { return w.terminate(); }).catch(function () {});
    }, IDLE_MS);
  }

  // image: Blob, File or data: URL. Returns {text, confidence}.
  async function recognize(image) {
    const w = await worker();
    try {
      const { data } = await w.recognize(image);
      return { text: String(data.text || "").trim(), confidence: Math.round(data.confidence || 0) };
    } finally {
      scheduleIdle();
    }
  }

  root.PeelOcr = { recognize, LANGS };
})(typeof globalThis !== "undefined" ? globalThis : this);
