const CONTENT_SCRIPTS = ["inflate-zlib.js", "unwrap.js", "jsqr.min.js", "phones.js", "sidebar-css.js", "message-script.js"];

// Latest message shown in each tab, so slow work for a previous message is not
// pushed into the one the user switched to.
const displayedInTab = new Map();

function asMessageList(result) {
  if (Array.isArray(result)) return result;
  return (result && result.messages) || [];
}

async function injectIntoOpenTabs() {
  const tabs = await messenger.tabs.query({});
  for (const tab of tabs) {
    if (!["mail", "messageDisplay"].includes(tab.type)) continue;
    try {
      const messages = asMessageList(await messenger.messageDisplay.getDisplayedMessages(tab.id));
      if (messages.length !== 1) continue;
      for (const file of CONTENT_SCRIPTS) await messenger.tabs.executeScript(tab.id, { file });
      await messenger.tabs.insertCSS(tab.id, { file: "message-style.css" });
      displayedInTab.set(tab.id, messages[0].id);
      await pushExtrasToTab(tab.id, messages[0].id);
    } catch (_) {}
  }
}

messenger.messageDisplayScripts.register({
  js: CONTENT_SCRIPTS.map((file) => ({ file })),
  css: [{ file: "message-style.css" }],
});

messenger.menus.create({
  id: "wrapper-show-original",
  title: "Show original wrapper",
  contexts: ["link"],
});
messenger.menus.create({
  id: "wrapper-copy-original",
  title: "Copy original wrapped URL",
  contexts: ["link"],
});
messenger.menus.create({
  id: "wrapper-keep-unwrapping",
  title: "Keep unwrapping…",
  contexts: ["link"],
});

async function queryLink(tabId, linkUrl) {
  try {
    return await messenger.tabs.sendMessage(tabId, { type: "wrapper-query", linkUrl: linkUrl || "" });
  } catch (_) {
    return null;
  }
}

// Ask the content script while the menu is open instead of racing a message sent
// from its contextmenu handler.
messenger.menus.onShown.addListener(async (info, tab) => {
  if (!tab || tab.id == null || !info.contexts || !info.contexts.includes("link")) return;
  const link = await queryLink(tab.id, info.linkUrl);
  const hasOriginal = !!(link && link.original && link.original !== link.unwrapped);
  await messenger.menus.update("wrapper-show-original", { visible: hasOriginal });
  await messenger.menus.update("wrapper-copy-original", { visible: hasOriginal });
  messenger.menus.refresh();
});

async function writeClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (_) {}
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (_) {}
  ta.remove();
}

messenger.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "wrapper-copy" && typeof msg.text === "string") return writeClipboard(msg.text);
});

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  const type = info.menuItemId;
  if (type === "wrapper-copy-original") {
    const link = await queryLink(tab.id, info.linkUrl);
    await writeClipboard(link && link.original);
    return;
  }
  if (type !== "wrapper-show-original" && type !== "wrapper-keep-unwrapping") return;
  try {
    await messenger.tabs.sendMessage(tab.id, { type, linkUrl: info.linkUrl || "" });
  } catch (_) {}
});

function walkParts(part, acc) {
  if (!part) return;
  acc.push(part);
  // getFull() also expands attached messages; their inner parts belong to that
  // message and are handled when it is parsed, so do not descend into them here.
  if (part !== acc[0] && /^message\/rfc822/i.test(part.contentType || "")) return;
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) walkParts(child, acc);
  }
}

function isInside(partName, parentName) {
  return partName.indexOf(parentName + ".") === 0;
}

async function sendWithRetry(tabId, messageId, payload) {
  for (const delay of [0, 400]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (displayedInTab.get(tabId) !== messageId) return;
    try {
      await messenger.tabs.sendMessage(tabId, payload);
      return;
    } catch (_) {}
  }
}

async function collectIcsUrls(messageId) {
  const urls = [];
  const seen = Object.create(null);
  function addAll(list) {
    for (const u of list) {
      if (u && !seen[u]) {
        seen[u] = true;
        urls.push(u);
      }
    }
  }
  try {
    const atts = await messenger.messages.listAttachments(messageId);
    for (const att of atts) {
      if (!IcsLinks.isCalendarPart(att.name, att.contentType)) continue;
      const file = await messenger.messages.getAttachmentFile(messageId, att.partName);
      addAll(IcsLinks.parseIcsUrls(await file.text()));
    }
  } catch (_) {}
  try {
    const full = await messenger.messages.getFull(messageId);
    const parts = [];
    walkParts(full, parts);
    for (const part of parts) {
      if (!IcsLinks.isCalendarPart(part.name || part.filename, part.contentType)) continue;
      if (part.body) addAll(IcsLinks.parseIcsUrls(part.body));
      else if (part.partName) {
        try {
          const file = await messenger.messages.getAttachmentFile(messageId, part.partName);
          addAll(IcsLinks.parseIcsUrls(await file.text()));
        } catch (_) {}
      }
    }
  } catch (_) {}
  return urls;
}

// A client that saves Outlook .msg files with an .eml name: Thunderbird shows no
// headers and a binary body, and keeps the file only up to its first zero byte, so the
// add-on cannot read it from here. The sidebar then offers rebuild.html, which reads the
// file the analyst picks (msg.js) and opens the rebuilt message. Returns {list} with the
// message when Thunderbird did keep the whole file, {truncated: true} when it did not.
const outlookCache = new Map();

async function outlookMessage(messageId) {
  if (outlookCache.has(messageId)) return outlookCache.get(messageId);
  let found = null;
  try {
    const full = await messenger.messages.getFull(messageId);
    const h = full.headers || {};
    if (!h.from && !h.subject && !h.date && !h.received) {
      let raw = await messenger.messages.getRaw(messageId);
      if (raw && typeof raw !== "string") raw = await NestedEml.fileToRaw(raw);
      if (raw && PeelMsg.isMsg(raw)) {
        const list = NestedEml.parse(raw, "");
        if (list.length) list[0].container = true;
        found = list.length ? { list } : { truncated: true };
      }
    }
  } catch (_) {}
  outlookCache.set(messageId, found);
  while (outlookCache.size > 20) outlookCache.delete(outlookCache.keys().next().value);
  return found;
}

function openRebuild() {
  return messenger.tabs.create({ url: messenger.runtime.getURL("rebuild.html") });
}

// JPEG images inside a message's PDFs, for the preview: an image-only PDF is often the
// whole lure.
function pdfImages(m) {
  const out = [];
  for (const f of m.files || []) {
    if (!f.bytes || out.length >= 4) continue;
    const sc = PeelPdf.scan(binaryToBytes(f.bytes), { images: true });
    for (const j of (sc.jpegs || []).slice(0, 2)) {
      out.push({ name: f.name, dataUrl: "data:image/jpeg;base64," + bytesToBase64(j), size: j.length, textless: !String(sc.text || "").trim() });
    }
  }
  return out;
}

async function collectNested(messageId) {
  const outlook = await outlookMessage(messageId);
  if (outlook && outlook.list) return outlook.list.map((m) => Object.assign({}, m, { pdfImages: pdfImages(m) }));
  const candidates = [];
  const seen = Object.create(null);
  function addCandidate(partName, name, contentType) {
    if (!partName || seen[partName]) return;
    if (!NestedEml.isRfc822(name, contentType) && !NestedEml.isOutlookMsg(name, contentType)) return;
    seen[partName] = true;
    candidates.push({ partName, name });
  }
  try {
    const atts = await messenger.messages.listAttachments(messageId);
    for (const att of atts) addCandidate(att.partName, att.name, att.contentType);
  } catch (_) {}
  try {
    const full = await messenger.messages.getFull(messageId);
    const parts = [];
    walkParts(full, parts);
    for (const part of parts) addCandidate(part.partName, part.name || part.filename, part.contentType);
  } catch (_) {}

  // A message inside an attached message is already returned by parsing its parent.
  const top = candidates.filter((c) => !candidates.some((o) => o !== c && isInside(c.partName, o.partName)));
  const list = [];
  for (const c of top) {
    try {
      const file = await messenger.messages.getAttachmentFile(messageId, c.partName);
      const raw = await NestedEml.fileToRaw(file);
      for (const msg of NestedEml.parse(raw, c.name || "message.eml")) list.push(msg);
    } catch (_) {}
  }
  return list.slice(0, 5).map((m) => Object.assign(m, { pdfImages: pdfImages(m) }));
}

// Formats Thunderbird can render in an <img>.
const IMAGE_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon",
};
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES = 30;

function imageMime(name, contentType) {
  let ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (ct === "image/jpg" || ct === "image/pjpeg") ct = "image/jpeg";
  if (Object.values(IMAGE_TYPES).includes(ct)) return ct;
  // Mislabelled attachments (application/octet-stream) are recognised by extension.
  const ext = (String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  return (ext && IMAGE_TYPES[ext]) || null;
}

function headerValue(part, name) {
  const v = part.headers && part.headers[name];
  return String(Array.isArray(v) ? v[0] || "" : v || "").toLowerCase();
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Image files attached to the displayed message itself (not inside an attached
// message, and not the cid: images its HTML body already shows inline).
async function collectImageAttachments(messageId) {
  const out = [];
  try {
    const full = await messenger.messages.getFull(messageId);
    const parts = [];
    walkParts(full, parts);
    for (const part of parts) {
      if (out.length >= MAX_IMAGES) break;
      if (!part.partName || part === full) continue;
      const name = part.name || part.filename || "";
      // The page image of an image-only PDF: often the whole lure.
      if (PeelPdf.isPdf(name, part.contentType) && !(part.size > MAX_PDF_BYTES)) {
        try {
          const file = await messenger.messages.getAttachmentFile(messageId, part.partName);
          const sc = PeelPdf.scan(new Uint8Array(await file.arrayBuffer()), { images: true });
          if (!String(sc.text || "").trim()) for (const j of (sc.jpegs || []).slice(0, 2)) out.push({ name: "Image in " + name, size: j.length, dataUrl: "data:image/jpeg;base64," + bytesToBase64(j) });
        } catch (_) {}
        continue;
      }
      const mime = imageMime(name, part.contentType);
      if (!mime) continue;
      const disposition = headerValue(part, "content-disposition");
      if (headerValue(part, "content-id") && disposition.indexOf("attachment") !== 0) continue;
      if (part.size && part.size > MAX_IMAGE_BYTES) continue;
      try {
        const file = await messenger.messages.getAttachmentFile(messageId, part.partName);
        if (file.size > MAX_IMAGE_BYTES) continue;
        const dataUrl = await readAsDataUrl(new Blob([file], { type: mime }));
        out.push({ name: name || "image", size: file.size, dataUrl });
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

const SIGNAL_HEADERS = ["from", "sender", "reply-to", "return-path", "to", "cc", "subject", "date", "message-id", "in-reply-to", "references", "authentication-results", "received"];

async function sha256Hex(bytes) {
  try {
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (_) {
    return "";
  }
}

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function binaryToBytes(bin) {
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i) & 0xff;
  return b;
}

const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_PDFS = 5;

// The displayed message as one layer for the "Indicios" panel: its own headers,
// first plain/HTML bodies and attachments (attached messages are separate layers).
// PDF attachments are read for the static scan in signals.js (pdfscan.js).
async function collectOuterLayer(messageId) {
  const layer = { layer: "outer", label: "", headers: {}, text: "", html: "", attachments: [], files: [], hasNestedEml: false };
  const outlook = await outlookMessage(messageId);
  if (outlook) {
    // Its binary "body" is the .msg file itself, not text to analyse.
    layer.attachments.push({ name: "Outlook message (.msg)", contentType: "application/vnd.ms-outlook" });
    layer.hasNestedEml = !!outlook.list;
    layer.outlookContainer = !!outlook.list;
    layer.outlookTruncated = !!outlook.truncated;
    return layer;
  }
  try {
    const full = await messenger.messages.getFull(messageId);
    // A message rebuilt by rebuild.js carries this install's token.
    const { rebuildToken } = await messenger.storage.local.get("rebuildToken");
    const marked = (v) => !!rebuildToken && String(Array.isArray(v) ? v[0] : v || "").toLowerCase().indexOf(rebuildToken) === 0;
    if (full.headers && marked(full.headers["x-peelscout-rebuilt"])) {
      const note = full.headers["x-peelscout-note"];
      layer.rebuiltNote = NestedEml.decodeWord(String((Array.isArray(note) ? note[0] : note) || "Rebuilt from an Outlook .msg file."));
    }
    for (const k of SIGNAL_HEADERS) {
      const v = full.headers && full.headers[k];
      // Every Received hop matters (their IPs are checked); other headers keep the first value.
      const first = Array.isArray(v) ? (k === "received" ? v.join(", ") : v[0]) : v;
      if (first) layer.headers[k] = NestedEml.decodeWord(String(first));
    }
    const parts = [];
    walkParts(full, parts);
    for (const part of parts) {
      if (part === full) continue;
      const ct = String(part.contentType || "").toLowerCase();
      const name = part.name || part.filename || "";
      const disposition = headerValue(part, "content-disposition");
      if (/^message\/rfc822/.test(ct) || NestedEml.isRfc822(name, ct) || NestedEml.isOutlookMsg(name, ct)) {
        layer.hasNestedEml = true;
        layer.attachments.push({ name: name || "message.eml", contentType: ct });
        continue;
      }
      if (name || disposition.indexOf("attachment") === 0) {
        // A file the damage repair touched may differ from the original: no hash.
        const rebuilt = layer.rebuiltNote && marked(part.headers && part.headers["x-peelscout-rebuilt"]) ? { verified: /checked/.test(headerValue(part, "x-peelscout-rebuilt")) } : undefined;
        layer.attachments.push({ name, contentType: ct, size: part.size || 0, rebuilt });
        if (PeelPdf.isPdf(name, ct) && part.partName && layer.files.length < MAX_PDFS && !(part.size > MAX_PDF_BYTES)) {
          try {
            const file = await messenger.messages.getAttachmentFile(messageId, part.partName);
            if (file.size <= MAX_PDF_BYTES) {
              const bytes = new Uint8Array(await file.arrayBuffer());
              layer.files.push({ name, contentType: ct, size: file.size, bytes, sha256: rebuilt ? "" : await sha256Hex(bytes), rebuilt });
            }
          } catch (_) {}
        }
        continue;
      }
      if (ct.indexOf("text/plain") === 0 && !layer.text && part.body) layer.text = part.body;
      if (ct.indexOf("text/html") === 0 && !layer.html && part.body) layer.html = part.body;
    }
  } catch (_) {}
  return layer;
}

// Team settings from the popup: "domain | vendor | source" lines and plain domains.
async function teamSettings() {
  try {
    const st = await messenger.storage.local.get(["simulationDomainsText", "orgDomainsText"]);
    const lines = (t) => String(t || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    return {
      simulationDomains: lines(st.simulationDomainsText).map((l) => {
        const [domain, vendor, source] = l.split("|").map((x) => (x || "").trim());
        return { domain: domain.toLowerCase().replace(/^\*\./, ""), vendor: vendor || "", source: source || "" };
      }).filter((e) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(e.domain)),
      orgDomains: lines(st.orgDomainsText).map((l) => l.toLowerCase().replace(/^@|^\*\./, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
    };
  } catch (_) {
    return {};
  }
}

// --- QR codes (jsQR) for the insights ---------------------------------------------
// Images of the message and of attached messages, and JPEG images inside PDFs, are
// decoded here so the links they hold go through the same checks as the email's links.
const QR_MAX_IMAGES = 12;
const QR_MAX_BYTES = 5 * 1024 * 1024;
const QR_MAX_SIDE = 1000;
const qrCache = new Map();

async function qrFromBlob(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, QR_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    if (w < 21 || h < 21) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // A QR drawn on a transparent background reads as black on white.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    return hit && hit.data ? hit.data : null;
  } catch (_) {
    return null;
  }
}

// QR codes in the displayed message's images (inline = in the body) and in the images
// of attached messages, as files the engine reads. Cached per message.
async function qrFiles(messageId, nested) {
  if (qrCache.has(messageId)) return qrCache.get(messageId);
  const result = { outer: [], nested: [] };
  try {
    const full = await messenger.messages.getFull(messageId);
    const parts = [];
    walkParts(full, parts);
    let n = 0;
    for (const part of parts) {
      if (n >= QR_MAX_IMAGES || part === full || !part.partName) continue;
      const mime = imageMime(part.name || part.filename, part.contentType);
      if (!mime || mime === "image/svg+xml" || mime === "image/x-icon" || (part.size && part.size > QR_MAX_BYTES)) continue;
      n++;
      try {
        const file = await messenger.messages.getAttachmentFile(messageId, part.partName);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const payload = await qrFromBlob(new Blob([bytes], { type: mime }));
        if (!payload) continue;
        const inline = !!headerValue(part, "content-id") && headerValue(part, "content-disposition").indexOf("attachment") !== 0;
        result.outer.push(PeelSignals.qrFile(part.name || part.filename || "image", payload, inline ? "body" : "attachment", await sha256Hex(bytes)));
      } catch (_) {}
    }
  } catch (_) {}
  for (let i = 0; i < nested.length; i++) {
    result.nested[i] = [];
    for (const img of (nested[i].images || []).slice(0, QR_MAX_IMAGES)) {
      try {
        const payload = await qrFromBlob(await (await fetch(img.dataUrl)).blob());
        if (payload) result.nested[i].push(PeelSignals.qrFile(img.name || "image", payload, img.inline ? "body" : "attachment", ""));
      } catch (_) {}
    }
  }
  qrCache.set(messageId, result);
  while (qrCache.size > 50) qrCache.delete(qrCache.keys().next().value);
  return result;
}

// PDF attachments scanned once here, so the JPEG images inside them can be decoded for
// QR codes (raw images are decoded during the scan itself).
async function scanPdfs(msg) {
  const files = PeelSignals.scanFiles(msg, PeelSignals.addressesIn((msg.headers || {}).to));
  for (const f of files) {
    const sc = f.scan;
    if (!sc || !sc.jpegs) continue;
    for (const bytes of sc.jpegs) {
      const payload = await qrFromBlob(new Blob([bytes], { type: "image/jpeg" }));
      if (payload && sc.qr.indexOf(payload) < 0) sc.qr.push(payload);
    }
    delete sc.jpegs;
  }
  return files;
}

// Layers for the sidebar: the opened message (or, for a report with the original
// forwarded in its body, the report and the rebuilt original) and attached messages.
async function analyzeLayers(outer, nested, icsUrls, messageId) {
  try {
    const qr = messageId != null ? await qrFiles(messageId, nested) : { outer: [], nested: [] };
    const withHashes = [];
    for (let i = 0; i < nested.length; i++) {
      const m = nested[i];
      const files = [];
      for (const f of m.files || []) {
        if (!f.bytes) {
          files.push(f);
          continue;
        }
        const bytes = binaryToBytes(f.bytes);
        // A file rebuilt from a damaged .msg may differ from the original: no hash.
        files.push({ name: f.name, contentType: f.contentType, size: f.size, bytes, sha256: f.rebuilt ? "" : await sha256Hex(bytes), rebuilt: f.rebuilt });
      }
      const n = Object.assign({}, m, { files });
      n.files = (await scanPdfs(n)).concat(qr.nested[i] || []);
      withHashes.push(n);
    }
    outer.files = (await scanPdfs(outer)).concat(qr.outer);
    return PeelSignals.analyzeAll(outer, withHashes, icsUrls, await teamSettings());
  } catch (_) {
    return [];
  }
}

// What the message tab needs of an attached message (not the PDF bytes).
function forDisplay(nested) {
  return nested.map((m) => Object.assign({}, m, { files: undefined }));
}

// Analysis needs the PDFs, not their preview images.
function forAnalysis(nested) {
  return nested.map((m) => Object.assign({}, m, { pdfImages: undefined }));
}

// --- Optional domain-age lookup (RDAP, then whois.com) -----------------------------
// Off by default. When the analyst enables it in the popup (which also grants the
// host permission), only the bare domain name is sent: to rdap.org, which redirects
// to the registry's RDAP server, and to whois.com when RDAP has no answer. Nothing
// from the message itself leaves the machine.
const RDAP_ORIGINS = { origins: ["https://*/*"] };
const MAX_AGE_LOOKUPS = 8;
const ageCache = new Map();

async function rdapEnabled() {
  try {
    const { rdapEnabled } = await messenger.storage.local.get("rdapEnabled");
    return !!rdapEnabled && (await messenger.permissions.contains(RDAP_ORIGINS));
  } catch (_) {
    return false;
  }
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({ credentials: "omit", referrerPolicy: "no-referrer", signal: ctrl.signal }, opts));
  } finally {
    clearTimeout(timer);
  }
}

async function rdapAge(domain) {
  try {
    const r = await fetchWithTimeout("https://rdap.org/domain/" + encodeURIComponent(domain), { headers: { Accept: "application/rdap+json" } }, 8000);
    if (r.status === 404) return { error: "no-rdap" };
    if (!r.ok) return { error: "http-" + r.status };
    const j = await r.json();
    const ev = (j.events || []).find((e) => /^registration$/i.test(e.eventAction || ""));
    return ev && ev.eventDate ? { created: ev.eventDate, source: "RDAP " + new URL(r.url).hostname } : { error: "no-date" };
  } catch (_) {
    return { error: "no-response" };
  }
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Creation dates as registries print them: 2003-04-21, 19990518, 21-Apr-2003, 21/04/2003, 2003.04.21.
function parseWhoisDate(raw) {
  const s = String(raw || "").trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + "-" + m[2] + "-" + m[3];
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})\b/))) return m[1] + "-" + m[2] + "-" + m[3];
  if ((m = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/))) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})/)) && MONTHS[m[2].toLowerCase()]) return m[3] + "-" + String(MONTHS[m[2].toLowerCase()]).padStart(2, "0") + "-" + m[1].padStart(2, "0");
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/))) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return null;
}

// whois.com is the guide's preferred WHOIS source and covers ccTLDs without RDAP
// (.mx, .com.co…). It is an HTML page, so this reads its "Registered On" field or the
// raw WHOIS text; when it shows a captcha instead, the analyst gets the link.
async function whoisComAge(domain) {
  try {
    const r = await fetchWithTimeout("https://www.whois.com/whois/" + encodeURIComponent(domain), {}, 10000);
    if (!r.ok) return { error: "http-" + r.status };
    const html = await r.text();
    const field = html.match(/Registered On:<\/div>\s*<div class="df-value">([^<]+)/i);
    const rawText = html.replace(/<[^>]+>/g, "\n");
    const raw = rawText.match(/(?:Creation Date|Created On|Registered on|Registration Time|Domain Registration Date|Fecha de Creaci[oó]n|created)\s*:\s*([0-9][^\n]{5,40})/i);
    const date = parseWhoisDate(field ? field[1] : raw ? raw[1] : "");
    if (date) return { created: date + "T00:00:00Z", source: "whois.com" };
    if (/captcha/i.test(html)) return { error: "captcha" };
    return { error: "not-found" };
  } catch (_) {
    return { error: "no-response" };
  }
}

async function lookupAge(domain) {
  if (ageCache.has(domain)) return ageCache.get(domain);
  let res = await rdapAge(domain);
  if (!res.created) {
    const w = await whoisComAge(domain);
    if (w.created || w.error === "captcha") res = w;
    else if (res.error === "no-rdap") res = { error: w.error === "not-found" ? "not-found" : "no-rdap" };
  }
  // Failures are not cached for long, so a flaky network does not stick.
  ageCache.set(domain, res);
  if (res.error && res.error !== "not-found" && res.error !== "no-rdap") setTimeout(() => ageCache.delete(domain), 60000);
  return res;
}

async function addAges(tabId, messageId, layers, ocrInfo) {
  if (!(await rdapEnabled())) return;
  const domains = [];
  for (const layer of layers) for (const v of layer.verify) if (v.domain && !domains.includes(v.domain)) domains.push(v.domain);
  const ages = {};
  for (const d of domains.slice(0, MAX_AGE_LOOKUPS)) {
    if (displayedInTab.get(tabId) !== messageId) return;
    ages[d] = await lookupAge(d);
  }
  for (const layer of layers) {
    PeelSignals.applyAges(layer, ages);
    layer.summary = PeelSignals.summary(layer);
    layer.rdap = "on";
  }
  await sendWithRetry(tabId, messageId, { type: "signals", layers, ocr: ocrInfo });
}

async function pushExtrasToTab(tabId, messageId) {
  const images = await collectImageAttachments(messageId);
  await sendWithRetry(tabId, messageId, { type: "image-attachments", images });
  const nested = await collectNested(messageId);
  await sendWithRetry(tabId, messageId, { type: "nested-eml", messages: forDisplay(nested) });
  const urls = await collectIcsUrls(messageId);
  await sendWithRetry(tabId, messageId, { type: "ics-links", urls: urls });
  await pushSignals(tabId, messageId, nested, urls);
}

// Insights for the message, with the text of any images read with OCR so far.
async function pushSignals(tabId, messageId, nested, urls) {
  const outer = await collectOuterLayer(messageId);
  const ocr = ocrResults.get(messageId);
  if (ocr) {
    outer.files = outer.files.concat(ocr.outer);
    nested = nested.map((m, i) => Object.assign({}, m, { files: (m.files || []).concat(ocr.nested[i] || []) }));
  }
  const layers = await analyzeLayers(outer, forAnalysis(nested), urls, messageId);
  const ocrInfo = { images: await countOcrImages(messageId, nested), state: ocrRunning.has(messageId) ? "running" : ocr ? "done" : "idle" };
  const rdap = await rdapEnabled();
  let state = rdap ? "pending" : "off";
  if (!rdap) {
    try {
      if ((await messenger.storage.local.get("rdapEnabled")).rdapEnabled) state = "no-permission";
    } catch (_) {}
  }
  for (const layer of layers) layer.rdap = state;
  await sendWithRetry(tabId, messageId, { type: "signals", layers, ocr: ocrInfo });
  await addAges(tabId, messageId, layers, ocrInfo);
}

// --- On-demand OCR (ocr.js, tesseract.js in ocr/) ------------------------------------
// Runs only when the analyst asks for it in the sidebar. Images of the displayed message
// (inline or attached) and of attached messages are read locally; the text goes into
// the insights as if it were the body.
const OCR_MIN_BYTES = 15000;
const OCR_MAX_IMAGES = 6;
const ocrResults = new Map();
const ocrRunning = new Set();

function dataUrlBytes(dataUrl) {
  const b64 = String(dataUrl || "").split(",")[1] || "";
  return Math.floor((b64.length * 3) / 4);
}

// Images worth reading: large images of the message and of attached messages, and the
// page images of PDFs that have no text of their own (image-only PDFs).
const ocrOuterCache = new Map();

async function ocrOuterImages(messageId) {
  if (ocrOuterCache.has(messageId)) return ocrOuterCache.get(messageId);
  const outer = [];
  try {
    const full = await messenger.messages.getFull(messageId);
    const parts = [];
    walkParts(full, parts);
    for (const part of parts) {
      if (part === full || !part.partName) continue;
      const name = part.name || part.filename || "";
      if (PeelPdf.isPdf(name, part.contentType) && !(part.size > MAX_PDF_BYTES)) {
        try {
          const file = await messenger.messages.getAttachmentFile(messageId, part.partName);
          const sc = PeelPdf.scan(new Uint8Array(await file.arrayBuffer()), { images: true });
          if (String(sc.text || "").trim()) continue;
          for (const j of (sc.jpegs || []).filter((x) => x.length >= OCR_MIN_BYTES).slice(0, 2)) outer.push({ name: name + " (page image)", bytes: j, size: j.length });
        } catch (_) {}
        continue;
      }
      const mime = imageMime(name, part.contentType);
      if (!mime || mime === "image/svg+xml" || mime === "image/x-icon") continue;
      if (part.size && (part.size < OCR_MIN_BYTES || part.size > MAX_IMAGE_BYTES)) continue;
      outer.push({ name: name || "image", partName: part.partName, size: part.size || 0 });
    }
  } catch (_) {}
  outer.sort((a, b) => b.size - a.size);
  ocrOuterCache.set(messageId, outer.slice(0, OCR_MAX_IMAGES));
  while (ocrOuterCache.size > 20) ocrOuterCache.delete(ocrOuterCache.keys().next().value);
  return ocrOuterCache.get(messageId);
}

async function ocrImages(messageId, nested) {
  const inner = (nested || []).map((m) =>
    (m.images || [])
      .filter((img) => dataUrlBytes(img.dataUrl) >= OCR_MIN_BYTES)
      .concat((m.pdfImages || []).filter((p) => p.textless && p.size >= OCR_MIN_BYTES).map((p) => ({ name: p.name + " (page image)", dataUrl: p.dataUrl })))
      .slice(0, OCR_MAX_IMAGES)
  );
  return { outer: await ocrOuterImages(messageId), nested: inner };
}

async function countOcrImages(messageId, nested) {
  const found = await ocrImages(messageId, nested);
  return found.outer.length + found.nested.reduce((n, list) => n + list.length, 0);
}

async function runOcr(tabId) {
  const messageId = displayedInTab.get(tabId);
  if (messageId == null || ocrRunning.has(messageId)) return;
  ocrRunning.add(messageId);
  const status = (text, state) => sendWithRetry(tabId, messageId, { type: "ocr-status", text, state: state || "running" });
  try {
    const nested = await collectNested(messageId);
    const found = await ocrImages(messageId, nested);
    const total = found.outer.length + found.nested.reduce((n, list) => n + list.length, 0);
    if (!total) {
      await status("No images large enough to read.", "idle");
      return;
    }
    const result = { outer: [], nested: [] };
    let k = 0;
    await status("Loading OCR (the first time takes a few seconds)…");
    for (const img of found.outer) {
      await status("Reading image " + ++k + " of " + total + "…");
      let bytes = img.bytes, type = "image/jpeg";
      if (!bytes) {
        const file = await messenger.messages.getAttachmentFile(messageId, img.partName);
        bytes = new Uint8Array(await file.arrayBuffer());
        type = imageMime(img.name, file.type) || "image/png";
      }
      const out = await PeelOcr.recognize(new Blob([bytes], { type }));
      // The hash of an image taken out of a PDF is not one to mark.
      result.outer.push(PeelSignals.ocrFile(img.name, out.text, out.confidence, img.bytes ? "" : await sha256Hex(bytes)));
    }
    for (let i = 0; i < found.nested.length; i++) {
      result.nested[i] = [];
      for (const img of found.nested[i]) {
        await status("Reading image " + ++k + " of " + total + "…");
        const out = await PeelOcr.recognize(img.dataUrl);
        result.nested[i].push(PeelSignals.ocrFile(img.name || "image", out.text, out.confidence, ""));
      }
    }
    ocrResults.set(messageId, result);
    // Keep the text of the last few messages only.
    while (ocrResults.size > 20) ocrResults.delete(ocrResults.keys().next().value);
    ocrRunning.delete(messageId);
    await status("Read " + total + " image" + (total === 1 ? "" : "s") + " with OCR.", "done");
    if (displayedInTab.get(tabId) === messageId) await pushSignals(tabId, messageId, nested, await collectIcsUrls(messageId));
  } catch (e) {
    await status("OCR failed: " + String((e && e.message) || e).slice(0, 120), "error");
  } finally {
    ocrRunning.delete(messageId);
  }
}

messenger.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "open-rebuild") return openRebuild().then(() => true);
  if (msg && msg.type === "ocr-run" && sender && sender.tab) {
    runOcr(sender.tab.id);
    return Promise.resolve(true);
  }
});

if (messenger.messageDisplay && messenger.messageDisplay.onMessageDisplayed) {
  messenger.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
    if (!tab || !message) return;
    displayedInTab.set(tab.id, message.id);
    await pushExtrasToTab(tab.id, message.id);
  });
}

messenger.tabs.onRemoved.addListener((tabId) => displayedInTab.delete(tabId));

injectIntoOpenTabs();
