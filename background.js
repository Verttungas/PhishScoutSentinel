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

async function collectNested(messageId) {
  const candidates = [];
  const seen = Object.create(null);
  function addCandidate(partName, name, contentType) {
    if (!partName || seen[partName]) return;
    if (!NestedEml.isRfc822(name, contentType)) return;
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
  return list.slice(0, 5);
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
  try {
    const full = await messenger.messages.getFull(messageId);
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
      if (/^message\/rfc822/.test(ct) || NestedEml.isRfc822(name, ct)) {
        layer.hasNestedEml = true;
        layer.attachments.push({ name: name || "message.eml", contentType: ct });
        continue;
      }
      if (name || disposition.indexOf("attachment") === 0) {
        layer.attachments.push({ name, contentType: ct, size: part.size || 0 });
        if (PeelPdf.isPdf(name, ct) && part.partName && layer.files.length < MAX_PDFS && !(part.size > MAX_PDF_BYTES)) {
          try {
            const file = await messenger.messages.getAttachmentFile(messageId, part.partName);
            if (file.size <= MAX_PDF_BYTES) {
              const bytes = new Uint8Array(await file.arrayBuffer());
              layer.files.push({ name, contentType: ct, size: file.size, bytes, sha256: await sha256Hex(bytes) });
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

// Layers for the sidebar: the opened message (or, for a report with the original
// forwarded in its body, the report and the rebuilt original) and attached messages.
async function analyzeLayers(outer, nested, icsUrls) {
  try {
    const withHashes = [];
    for (const m of nested) {
      const files = [];
      for (const f of m.files || []) {
        const bytes = binaryToBytes(f.bytes);
        files.push({ name: f.name, contentType: f.contentType, size: f.size, bytes, sha256: await sha256Hex(bytes) });
      }
      withHashes.push(Object.assign({}, m, { files }));
    }
    return PeelSignals.analyzeAll(outer, withHashes, icsUrls, await teamSettings());
  } catch (_) {
    return [];
  }
}

// What the message tab needs of an attached message (not the PDF bytes).
function forDisplay(nested) {
  return nested.map((m) => Object.assign({}, m, { files: undefined }));
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

async function addAges(tabId, messageId, layers) {
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
  await sendWithRetry(tabId, messageId, { type: "signals", layers });
}

async function pushExtrasToTab(tabId, messageId) {
  const images = await collectImageAttachments(messageId);
  await sendWithRetry(tabId, messageId, { type: "image-attachments", images });
  const nested = await collectNested(messageId);
  await sendWithRetry(tabId, messageId, { type: "nested-eml", messages: forDisplay(nested) });
  const urls = await collectIcsUrls(messageId);
  await sendWithRetry(tabId, messageId, { type: "ics-links", urls: urls });
  const outer = await collectOuterLayer(messageId);
  const layers = await analyzeLayers(outer, nested, urls);
  const rdap = await rdapEnabled();
  let state = rdap ? "pending" : "off";
  if (!rdap) {
    try {
      if ((await messenger.storage.local.get("rdapEnabled")).rdapEnabled) state = "no-permission";
    } catch (_) {}
  }
  for (const layer of layers) layer.rdap = state;
  await sendWithRetry(tabId, messageId, { type: "signals", layers });
  await addAges(tabId, messageId, layers);
}

if (messenger.messageDisplay && messenger.messageDisplay.onMessageDisplayed) {
  messenger.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
    if (!tab || !message) return;
    displayedInTab.set(tab.id, message.id);
    await pushExtrasToTab(tab.id, message.id);
  });
}

messenger.tabs.onRemoved.addListener((tabId) => displayedInTab.delete(tabId));

injectIntoOpenTabs();
