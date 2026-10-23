(function () {
  if (!globalThis.WrapperUnwrap) return;
  // Scripts can be injected twice into one tab (startup injection plus the registered
  // display script, or an add-on reload); keep a single set of listeners.
  if (globalThis.__peelScoutLoaded) return;
  globalThis.__peelScoutLoaded = true;
  const api = globalThis.browser || globalThis.messenger;
  let lastLink = null;
  let gotNested = false;
  let qrScanGen = 0;
  const qrShown = Object.create(null);
  // What we peeled lives here, not in DOM attributes: the message HTML could carry
  // its own data-wrapper-* attributes to fake an "original" URL or block unwrapping.
  const peeled = new WeakMap();
  const peeledByUrl = new Map();
  const rawLinks = new WeakSet();

  // --- Sidebar ----------------------------------------------------------------------
  // Everything PeelScout shows lives in a fixed panel on the right, inside its own
  // shadow root, so the email's HTML is left as it is (it only gets narrower, and the
  // whole width comes back when the panel is collapsed).
  const BANNER_ORDER = ["wrapper-signals", "wrapper-img-attachments", "wrapper-nested-eml", "wrapper-ics-banner", "wrapper-qr-banner"];
  const SIDEBAR_MIN = 300;
  let SB = null;
  let sbHost = null;
  let sbWidth = 380;
  let sbCollapsed = window.innerWidth < 720;

  function byId(id) {
    return SB ? SB.getElementById(id) : null;
  }

  function applyLayout() {
    if (!sbHost) return;
    let st = document.getElementById("peelscout-layout");
    if (!st) {
      st = document.createElement("style");
      st.id = "peelscout-layout";
      (document.head || document.documentElement).appendChild(st);
    }
    const w = sbCollapsed ? 30 : sbWidth;
    sbHost.style.setProperty("--peel-width", sbWidth + "px");
    sbHost.toggleAttribute("collapsed", sbCollapsed);
    st.textContent = "html{margin-right:" + w + "px !important}";
  }

  function saveLayout() {
    try {
      if (api && api.storage && api.storage.local) api.storage.local.set({ sidebarWidth: sbWidth, sidebarCollapsed: sbCollapsed });
    } catch (_) {}
  }

  function setCollapsed(v) {
    sbCollapsed = !!v;
    applyLayout();
    saveLayout();
  }

  function sidebar() {
    if (SB) return SB;
    sbHost = document.createElement("peelscout-sidebar");
    SB = sbHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = globalThis.PeelSidebarCss || "";
    SB.appendChild(style);
    const sb = document.createElement("div");
    sb.className = "sb";
    sb.innerHTML =
      '<button type="button" class="sb-rail" title="Show PeelScout"><span class="sb-rail-label">PeelScout</span><span class="sb-rail-badges"></span></button>' +
      '<div class="sb-main"><div class="sb-head"><span class="sb-title">PeelScout</span><span class="sb-badges"></span>' +
      '<button type="button" class="sb-collapse" title="Hide sidebar">›</button></div><div class="sb-body"><div class="sb-empty">Analysing…</div></div></div>' +
      '<div class="sb-resize" title="Drag to resize"></div>';
    SB.appendChild(sb);
    const body = sb.querySelector(".sb-body");
    for (const id of BANNER_ORDER) {
      const slot = document.createElement("div");
      slot.id = "slot-" + id;
      body.appendChild(slot);
    }
    sb.querySelector(".sb-rail").addEventListener("click", function () { setCollapsed(false); });
    sb.querySelector(".sb-collapse").addEventListener("click", function () { setCollapsed(true); });
    sb.querySelector(".sb-resize").addEventListener("mousedown", function (e) {
      e.preventDefault();
      function move(ev) {
        sbWidth = Math.max(SIDEBAR_MIN, Math.min(Math.round(window.innerWidth * 0.7), window.innerWidth - ev.clientX));
        applyLayout();
      }
      function up() {
        document.removeEventListener("mousemove", move, true);
        document.removeEventListener("mouseup", up, true);
        saveLayout();
      }
      document.addEventListener("mousemove", move, true);
      document.addEventListener("mouseup", up, true);
    });
    (document.documentElement || document.body).appendChild(sbHost);
    applyLayout();
    try {
      if (api && api.storage && api.storage.local) {
        api.storage.local.get(["sidebarWidth", "sidebarCollapsed"]).then(function (v) {
          if (v.sidebarWidth) sbWidth = Math.max(SIDEBAR_MIN, +v.sidebarWidth || 380);
          if (typeof v.sidebarCollapsed === "boolean" && window.innerWidth >= 720) sbCollapsed = v.sidebarCollapsed;
          applyLayout();
        }, function () {});
      }
    } catch (_) {}
    return SB;
  }

  function setBadges(items) {
    if (!SB) return;
    for (const sel of [".sb-badges", ".sb-rail-badges"]) {
      const box = SB.querySelector(sel);
      if (!box) continue;
      box.textContent = "";
      const list = sel === ".sb-rail-badges" ? items.filter(function (b) { return b.rail; }) : items;
      for (const b of list) {
        const span = document.createElement("span");
        span.className = "sb-badge" + (b.strong ? " sb-badge-strong" : "");
        span.textContent = sel === ".sb-rail-badges" ? b.rail : b.text;
        if (b.title) span.title = b.title;
        box.appendChild(span);
      }
    }
  }

  // Overlays (lightbox, original-wrapper panel) live in the sidebar's shadow root too.
  function panelRoot() {
    return sidebar();
  }

  function normUrl(href) {
    try {
      return new URL(href).href;
    } catch (_) {
      return String(href || "").trim();
    }
  }

  function rememberPeel(a, original, url, vendor) {
    const rec = { original: original, unwrapped: url, vendor: vendor || "" };
    peeled.set(a, rec);
    peeledByUrl.set(normUrl(url), rec);
  }

  // QR payloads listed in the image-attachment banner, which survives the rescans
  // that clear qrShown; Thunderbird also renders those attachments inline below.
  const attachmentQr = Object.create(null);

  function clearQrShown() {
    for (const k of Object.keys(qrShown)) delete qrShown[k];
    for (const k of Object.keys(attachmentQr)) qrShown[k] = true;
  }

  function rewriteAnchors(root) {
    if (!root || !root.querySelectorAll) return;
    const links = root.querySelectorAll("a[href], area[href]");
    for (const a of links) {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("mailto:") || href.startsWith("#")) continue;
      if (peeled.has(a) || rawLinks.has(a)) continue;
      const out = WrapperUnwrap.unwrapAll(href);
      if (!out.changed) continue;
      rememberPeel(a, href, out.url, out.vendor);
      a.setAttribute("href", out.url);
      a.setAttribute(
        "title",
        "Unwrapped " + (out.vendor || "security wrapper") + "\nRight-click for original or keep unwrapping"
      );
      a.classList.add("wrapper-unwrapped");
      rewriteLinkText(a, href, out.url);
    }
  }

  // Plain-text mail (and many HTML mails) show the wrapped URL as the link text.
  // Show the destination instead: it is what the click opens, and Thunderbird's
  // scam check warns when a URL-looking text and the href point to different hosts.
  function rewriteLinkText(a, original, url) {
    const walker = a.ownerDocument.createTreeWalker(a, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue.trim();
      if (!text || !/^(https?:\/\/|www\.)/i.test(text)) continue;
      const same = text === original || WrapperUnwrap.unwrapAll(text).url === url || normUrl(text) === normUrl(original);
      if (same) node.nodeValue = node.nodeValue.replace(text, url);
    }
  }

  function closePanel() {
    const el = byId("wrapper-unwrap-panel");
    if (el) el.remove();
  }

  // Clipboard writes from the message pane fail silently in Thunderbird, so the
  // background page (which holds clipboardWrite) does the copy.
  function copyText(text) {
    if (!text) return;
    if (api && api.runtime && api.runtime.sendMessage) {
      api.runtime.sendMessage({ type: "wrapper-copy", text: String(text) }).catch(function () {
        copyTextFallback(text);
      });
      return;
    }
    copyTextFallback(text);
  }

  function copyTextFallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.documentElement.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (_) {}
    ta.remove();
  }

  function showOriginal(info) {
    closePanel();
    if (!info || !info.original) return;
    const panel = document.createElement("div");
    panel.id = "wrapper-unwrap-panel";
    panel.innerHTML =
      '<div class="wup-card"><h3>Original wrapper</h3><p class="wup-vendor"></p><label>Wrapped URL</label><textarea readonly id="wup-orig"></textarea><label>Unwrapped URL</label><textarea readonly id="wup-clean"></textarea><div class="wup-actions"><button type="button" id="wup-copy-orig">Copy wrapped</button><button type="button" id="wup-copy-clean">Copy unwrapped</button><button type="button" id="wup-more">Keep unwrapping…</button><button type="button" id="wup-close">Close</button></div></div>';
    panelRoot().appendChild(panel);
    panel.querySelector(".wup-vendor").textContent = info.vendor || "security wrapper";
    panel.querySelector("#wup-orig").value = info.original;
    panel.querySelector("#wup-clean").value = info.unwrapped || "";
    panel.querySelector("#wup-copy-orig").addEventListener("click", function () {
      copyText(info.original);
    });
    panel.querySelector("#wup-copy-clean").addEventListener("click", function () {
      copyText(info.unwrapped || "");
    });
    panel.querySelector("#wup-more").addEventListener("click", function () {
      showStepper(info);
    });
    panel.querySelector("#wup-close").addEventListener("click", closePanel);
    panel.addEventListener("click", function (e) {
      if (e.target === panel) closePanel();
    });
  }

  function showStepper(info) {
    closePanel();
    if (!info) return;
    const start = info.unwrapped || info.original || "";
    const steps = [];
    if (info.original && info.unwrapped && info.original !== info.unwrapped) {
      for (const layer of String(info.vendor || "Wrapper").split(" → ")) steps.push("Removed " + layer + " (automatic)");
    }
    const panel = document.createElement("div");
    panel.id = "wrapper-unwrap-panel";
    panel.innerHTML =
      '<div class="wup-card"><h3>Keep unwrapping</h3><p class="wup-vendor" id="wup-status">Current URL after automatic unwrapping. Unwrap again tries any layer left; edit the URL to try another one.</p><ol class="wup-steps" id="wup-steps"></ol><label>Current URL</label><textarea id="wup-current"></textarea><div class="wup-actions"><button type="button" id="wup-again">Unwrap again</button><button type="button" id="wup-copy">Copy</button><button type="button" id="wup-open">Open</button><button type="button" id="wup-close">Close</button></div></div>';
    panelRoot().appendChild(panel);
    const currentEl = panel.querySelector("#wup-current");
    const stepsEl = panel.querySelector("#wup-steps");
    const statusEl = panel.querySelector("#wup-status");
    currentEl.value = start;
    function renderSteps() {
      stepsEl.innerHTML = "";
      for (const label of steps) {
        const li = document.createElement("li");
        li.textContent = label;
        stepsEl.appendChild(li);
      }
    }
    renderSteps();
    panel.querySelector("#wup-again").addEventListener("click", function () {
      const cur = currentEl.value.trim();
      const out = WrapperUnwrap.unwrapStep(cur, true);
      if (!out.changed) {
        statusEl.textContent = out.note ? out.vendor + " — " + out.note : "No more known wrappers on this URL.";
        return;
      }
      steps.push("Removed " + (out.vendor || "wrapper"));
      currentEl.value = out.url;
      statusEl.textContent = "Removed " + out.vendor + ". Unwrap again, copy, or open.";
      renderSteps();
    });
    panel.querySelector("#wup-copy").addEventListener("click", function () {
      copyText(currentEl.value.trim());
    });
    panel.querySelector("#wup-open").addEventListener("click", function () {
      const href = currentEl.value.trim();
      if (href) window.open(href, "_blank", "noopener,noreferrer");
    });
    panel.querySelector("#wup-close").addEventListener("click", closePanel);
    panel.addEventListener("click", function (e) {
      if (e.target === panel) closePanel();
    });
  }

  function onContextMenu(e) {
    // composedPath()[0] is the real target; e.target is retargeted to the shadow host
    // when the click is inside a nested message body.
    const path = e.composedPath ? e.composedPath() : [];
    const t = path[0] || e.target;
    const a = t && t.closest && t.closest("a[href], area[href]");
    if (!a) {
      lastLink = null;
      return;
    }
    const rec = peeled.get(a);
    const href = a.getAttribute("href") || "";
    lastLink = rec ? { original: rec.original, unwrapped: rec.unwrapped, vendor: rec.vendor } : { original: href, unwrapped: href, vendor: "" };
  }

  document.addEventListener("contextmenu", onContextMenu, true);

  // The link the menu was opened on. The menu API's linkUrl is authoritative; lastLink
  // is only used when it matches, so a stale right-click never answers for another link.
  function linkFor(linkUrl) {
    if (!linkUrl) return lastLink;
    const key = normUrl(linkUrl);
    if (lastLink && normUrl(lastLink.unwrapped) === key) return lastLink;
    const rec = peeledByUrl.get(key);
    if (rec) return { original: rec.original, unwrapped: rec.unwrapped, vendor: rec.vendor };
    return { original: linkUrl, unwrapped: linkUrl, vendor: "" };
  }

  function showIcsBanner(urls) {
    const old = byId("wrapper-ics-banner");
    if (old) old.remove();
    if (!urls || !urls.length) return;
    const bar = document.createElement("div");
    bar.id = "wrapper-ics-banner";
    const title = document.createElement("div");
    title.className = "ics-title";
    title.textContent = "Calendar invite links (" + urls.length + ")";
    bar.appendChild(title);
    for (const raw of urls) {
      const out = WrapperUnwrap.unwrapAll(raw);
      const href = out.changed ? out.url : raw;
      let host = href;
      try {
        host = new URL(href).hostname;
      } catch (_) {}
      const row = document.createElement("div");
      row.className = "ics-row";
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = href;
      if (out.changed) {
        rememberPeel(a, raw, href, out.vendor);
        a.classList.add("wrapper-unwrapped");
      } else {
        rawLinks.add(a);
      }
      if (/amazonaws\.com|cloudfront\.net|\.aws\b/i.test(host + href)) row.classList.add("ics-aws");
      const meta = document.createElement("div");
      meta.className = "ics-meta";
      meta.textContent = host + (out.changed ? " · unwrapped " + out.vendor : "");
      row.appendChild(meta);
      row.appendChild(a);
      bar.appendChild(row);
    }
    insertBanner(bar);
  }

  // Each section has a fixed slot in the sidebar, whichever arrives first.
  function insertBanner(el) {
    const root = sidebar();
    const slot = root.getElementById("slot-" + el.id);
    if (!slot) return;
    slot.textContent = "";
    slot.appendChild(el);
    const empty = root.querySelector(".sb-empty");
    if (empty) empty.remove();
  }

  function cidMap(images) {
    const map = Object.create(null);
    for (const im of images || []) {
      if (im.cid && im.dataUrl) map[im.cid.toLowerCase()] = im.dataUrl;
    }
    return map;
  }

  // Returns the sanitized body as nodes of this document. Thunderbird does not render
  // srcdoc iframes in the message pane, so nested bodies go into a shadow root instead
  // (styles stay scoped; remote loads also fall under Thunderbird's remote-content block).
  function sanitizeHtml(html, images) {
    const map = cidMap(images);
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script, iframe, frame, object, embed, applet, form, link, meta, base, video, audio, source, track").forEach(function (el) {
      el.remove();
    });
    const all = doc.querySelectorAll("*");
    for (const el of all) {
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        const n = attr.name;
        const v = attr.value || "";
        if (/^on/i.test(n) || n === "srcdoc" || n === "srcset" || n === "background" || n === "poster" || n === "ping") {
          el.removeAttribute(n);
          continue;
        }
        if ((n === "href" || n === "src" || n === "xlink:href") && /^\s*javascript:/i.test(v)) el.removeAttribute(n);
        if (n === "src" && !/^\s*(data:|cid:)/i.test(v)) el.removeAttribute(n);
        if (n === "style" && /url\s*\(|@import|expression\s*\(/i.test(v)) el.removeAttribute(n);
      }
    }
    for (const st of doc.querySelectorAll("style")) {
      st.textContent = st.textContent.replace(/@import[^;]*;?/gi, "").replace(/url\s*\([^)]*\)/gi, "none");
    }
    for (const a of doc.querySelectorAll("a[href]")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
    for (const img of doc.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src") || "";
      const m = src.match(/^cid:(.+)$/i);
      if (m) {
        const key = m[1].replace(/[<>]/g, "").toLowerCase();
        if (map[key]) img.setAttribute("src", map[key]);
      }
    }
    const frag = document.createDocumentFragment();
    for (const node of Array.from((doc.body && doc.body.childNodes) || [])) frag.appendChild(document.importNode(node, true));
    return frag;
  }

  const NESTED_BODY_CSS =
    ":host{display:block;max-height:420px;overflow:auto;background:#fff;border-radius:4px}" +
    ".nest-body{padding:8px;font:13px/1.45 sans-serif;color:#1c2430}" +
    ".nest-body img{max-width:220px;height:auto}.nest-body img.nest-zoomable{cursor:zoom-in}.nest-body a{color:#0b57d0}.nest-body pre{white-space:pre-wrap;margin:0}";

  function renderBody(host, frag) {
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = NESTED_BODY_CSS;
    const wrap = document.createElement("div");
    wrap.className = "nest-body";
    wrap.appendChild(frag);
    root.appendChild(style);
    root.appendChild(wrap);
    rewriteAnchors(wrap);
    const imgs = Array.from(wrap.querySelectorAll("img")).filter(function (im) {
      return /^data:image\//i.test(im.getAttribute("src") || "") && !im.closest("a");
    });
    const group = imgs.map(function (im) {
      return { src: im.getAttribute("src"), name: im.getAttribute("alt") || "Nested image" };
    });
    imgs.forEach(function (im, idx) {
      im.classList.add("nest-zoomable");
      im.addEventListener("click", function () {
        showLightbox(group, idx);
      });
    });
  }

  function decodeQrImage(img) {
    const fn = globalThis.jsQR;
    if (!fn) return null;
    try {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w < 8 || h < 8 || w * h > 16000000) return null;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h);
      const code = fn(data.data, data.width, data.height);
      return code && code.data ? String(code.data) : null;
    } catch (_) {
      return null;
    }
  }

  function decodeQr(dataUrl) {
    return new Promise(function (resolve) {
      if (!globalThis.jsQR || !dataUrl) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = function () {
        resolve(decodeQrImage(img));
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = dataUrl;
    });
  }

  function looksLikeUrl(s) {
    return /^(https?:\/\/|www\.)/i.test(String(s || "").trim());
  }

  function qrRow(payload) {
    const row = document.createElement("div");
    row.className = "nest-qr";
    const lbl = document.createElement("div");
    lbl.className = "nest-qr-lbl";
    lbl.textContent = "QR URL (extracted, not peeled)";
    row.appendChild(lbl);
    if (looksLikeUrl(payload)) {
      const href = /^https?:\/\//i.test(payload) ? payload : "http://" + payload;
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = payload;
      rawLinks.add(a);
      row.appendChild(a);
    } else {
      const pre = document.createElement("div");
      pre.className = "nest-qr-text";
      pre.textContent = payload;
      row.appendChild(pre);
    }
    return row;
  }

  function takeQr(payload) {
    const key = String(payload || "").trim();
    if (!key || qrShown[key]) return false;
    qrShown[key] = true;
    return true;
  }

  async function fillQr(box, images, imgByUrl) {
    for (const im of images || []) {
      if (!im.dataUrl) continue;
      const data = await decodeQr(im.dataUrl);
      if (!data) continue;
      if (imgByUrl && imgByUrl[im.dataUrl]) {
        imgByUrl[im.dataUrl].classList.remove("nest-img-photo");
        imgByUrl[im.dataUrl].classList.add("nest-img-qr");
      }
      if (!takeQr(data)) continue;
      box.appendChild(qrRow(data));
      noteQr("in an image of the attached email", data, "Link → O365 / Phishing if it is in the body; Payload → Docuphish if it is inside a file");
    }
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    return (doc.body && doc.body.textContent) || "";
  }

  function thinText(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/[\u00a0\r\n\t]+/g, " ")
      .replace(/[-_=.*~]{3,}/g, " ")
      .replace(/\\r\\n/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasMeaningfulBody(msg) {
    const t = thinText(msg.text) + " " + thinText(htmlToText(msg.html));
    const compact = t.replace(/\s+/g, " ").trim();
    if (compact.length < 16) return false;
    if (/^(confiance|confidential|disclaimer)(\s|$)/i.test(compact) && compact.length < 40) return false;
    return true;
  }

  // Lightbox for a group of images: arrows / ← → to move, click the image to switch
  // between fit-to-window and actual size, Esc or the backdrop to close.
  function showLightbox(items, index) {
    closePanel();
    if (!items || !items.length) return;
    let i = Math.max(0, Math.min(index || 0, items.length - 1));
    let actual = false;
    const panel = document.createElement("div");
    panel.id = "wrapper-unwrap-panel";
    panel.className = "wup-zoom";
    panel.innerHTML =
      '<div class="wup-zoom-card"><div class="wup-zoom-bar"><span class="wup-zoom-name"></span><span class="wup-zoom-count"></span></div>' +
      '<div class="wup-zoom-stage"><img alt=""></div><div class="wup-actions"><button type="button" id="wup-prev">‹ Previous</button>' +
      '<button type="button" id="wup-next">Next ›</button><button type="button" id="wup-size">Actual size</button><button type="button" id="wup-close">Close</button></div></div>';
    const img = panel.querySelector("img");
    const stage = panel.querySelector(".wup-zoom-stage");
    const nameEl = panel.querySelector(".wup-zoom-name");
    const countEl = panel.querySelector(".wup-zoom-count");
    const sizeBtn = panel.querySelector("#wup-size");
    const multi = items.length > 1;
    panel.querySelector("#wup-prev").hidden = !multi;
    panel.querySelector("#wup-next").hidden = !multi;
    function render() {
      const it = items[i];
      img.src = it.src;
      img.alt = it.name || "Image";
      nameEl.textContent = (it.name || "Image") + (it.meta ? " · " + it.meta : "");
      countEl.textContent = multi ? i + 1 + " / " + items.length : "";
      stage.classList.toggle("wup-actual", actual);
      sizeBtn.textContent = actual ? "Fit to window" : "Actual size";
    }
    function move(d) {
      if (!multi) return;
      i = (i + d + items.length) % items.length;
      render();
    }
    function onKey(e) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    }
    function close() {
      document.removeEventListener("keydown", onKey, true);
      closePanel();
    }
    function toggleSize() {
      actual = !actual;
      render();
    }
    panel.querySelector("#wup-prev").addEventListener("click", function () { move(-1); });
    panel.querySelector("#wup-next").addEventListener("click", function () { move(1); });
    sizeBtn.addEventListener("click", toggleSize);
    img.addEventListener("click", toggleSize);
    panel.querySelector("#wup-close").addEventListener("click", close);
    panel.addEventListener("click", function (e) {
      if (e.target === panel) close();
    });
    document.addEventListener("keydown", onKey, true);
    panelRoot().appendChild(panel);
    render();
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function showImageAttachments(items) {
    const old = byId("wrapper-img-attachments");
    if (old) old.remove();
    const list = (items || []).filter(function (it) { return it && it.dataUrl; });
    if (!list.length) return;
    const bar = document.createElement("div");
    bar.id = "wrapper-img-attachments";
    const title = document.createElement("div");
    title.className = "ics-title";
    title.textContent = "Image attachments (" + list.length + ") — click to preview";
    bar.appendChild(title);
    const grid = document.createElement("div");
    grid.className = "att-grid";
    const group = list.map(function (it) {
      return { src: it.dataUrl, name: it.name, meta: formatSize(it.size) };
    });
    const qrBox = document.createElement("div");
    list.forEach(function (it, idx) {
      const fig = document.createElement("button");
      fig.type = "button";
      fig.className = "att-thumb";
      fig.title = it.name || "";
      const img = document.createElement("img");
      img.src = it.dataUrl;
      img.alt = it.name || "Image attachment";
      img.loading = "lazy";
      const cap = document.createElement("span");
      cap.className = "att-cap";
      cap.textContent = (it.name || "image") + (it.size ? " · " + formatSize(it.size) : "");
      fig.appendChild(img);
      fig.appendChild(cap);
      fig.addEventListener("click", function () {
        showLightbox(group, idx);
      });
      grid.appendChild(fig);
      decodeQr(it.dataUrl).then(function (data) {
        if (!data || !takeQr(data)) return;
        attachmentQr[String(data).trim()] = true;
        noteQr("in the attachment " + (it.name || "(image)"), data, "QR inside a file: consider Payload → Docuphish");
        const row = qrRow(data);
        row.querySelector(".nest-qr-lbl").textContent = "QR in " + (it.name || "attachment") + " (extracted, not peeled)";
        qrBox.appendChild(row);
      });
    });
    bar.appendChild(grid);
    bar.appendChild(qrBox);
    insertBanner(bar);
  }

  function phoneRow(num, source) {
    const row = document.createElement("div");
    row.className = "nest-phone";
    const lbl = document.createElement("div");
    lbl.className = "nest-phone-lbl";
    lbl.textContent = source;
    const val = document.createElement("div");
    val.className = "nest-phone-num";
    val.textContent = num;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Copy";
    btn.addEventListener("click", function () {
      copyText(num);
    });
    row.appendChild(lbl);
    row.appendChild(val);
    row.appendChild(btn);
    return row;
  }

  function fillPhones(box, msg) {
    const apiPhones = globalThis.PeelPhones;
    const extract = apiPhones && apiPhones.extractPhones ? apiPhones.extractPhones : function () { return []; };
    const seen = Object.create(null);
    function add(num, source) {
      const key = String(num).replace(/\D/g, "");
      if (!key || seen[key]) return;
      seen[key] = true;
      box.appendChild(phoneRow(num, source));
    }
    const fromText = extract((msg.text || "") + "\n" + htmlToText(msg.html || ""));
    for (const n of fromText) add(n, "Phone in nested message text");
  }

  function showNested(messages) {
    gotNested = true;
    const old = byId("wrapper-nested-eml");
    if (old) old.remove();
    const oldQr = byId("wrapper-qr-banner");
    if (oldQr) oldQr.remove();
    clearQrShown();
    if (!messages || !messages.length) {
      scanOuterQr();
      return;
    }
    const wrap = document.createElement("div");
    wrap.id = "wrapper-nested-eml";
    const pending = [];
    messages.forEach(function (msg, idx) {
      const art = document.createElement("article");
      art.className = "nest-block";
      const h = document.createElement("div");
      h.className = "nest-title";
      h.textContent = "Nested message (" + (idx + 1) + ")";
      const who = document.createElement("div");
      who.className = "nest-who";
      who.textContent =
        (msg.filename ? msg.filename + " · " : "") +
        "Subject: " +
        (msg.subject || "(no subject)") +
        " · From: " +
        (msg.from || "(unknown)");
      const inner = document.createElement("div");
      const hasBody = hasMeaningfulBody(msg);
      inner.className = "nest-inner" + (hasBody ? "" : " nest-tight");
      if (hasBody) {
        const body = document.createElement("div");
        body.className = "nest-frame";
        if (!msg.html && msg.text) {
          const frag = document.createDocumentFragment();
          const pre = document.createElement("pre");
          pre.textContent = msg.text;
          frag.appendChild(pre);
          renderBody(body, frag);
        } else {
          renderBody(body, sanitizeHtml(msg.html, msg.images));
        }
        inner.appendChild(body);
      }
      const media = document.createElement("div");
      media.className = "nest-media" + (hasBody ? "" : " nest-img-only");
      const imgByUrl = Object.create(null);
      const htmlLower = hasBody ? String(msg.html || "").toLowerCase() : "";
      for (const im of msg.images || []) {
        if (!im.dataUrl) continue;
        // Already shown inline in the body.
        if (im.cid && htmlLower.indexOf("cid:" + im.cid.toLowerCase()) !== -1) continue;
        const img = document.createElement("img");
        img.src = im.dataUrl;
        img.alt = im.name || "Inner image";
        img.className = "nest-img nest-img-photo";
        img.addEventListener("click", function () {
          const group = (msg.images || []).filter(function (x) { return x.dataUrl; }).map(function (x) {
            return { src: x.dataUrl, name: x.name || "Nested image" };
          });
          showLightbox(group, group.findIndex(function (x) { return x.src === im.dataUrl; }));
        });
        media.appendChild(img);
        imgByUrl[im.dataUrl] = img;
      }
      if (media.childElementCount) inner.appendChild(media);
      const qrBox = document.createElement("div");
      qrBox.className = "nest-qr-box";
      const phoneBox = document.createElement("div");
      phoneBox.className = "nest-phone-box";
      pending.push(
        fillQr(qrBox, msg.images, imgByUrl).then(function () {
          if (qrBox.childElementCount) inner.appendChild(qrBox);
        })
      );
      fillPhones(phoneBox, msg);
      if (phoneBox.childElementCount) inner.appendChild(phoneBox);
      art.appendChild(h);
      art.appendChild(who);
      art.appendChild(inner);
      wrap.appendChild(art);
    });
    insertBanner(wrap);
    Promise.all(pending).then(function () {
      scanOuterQr();
    });
  }

  async function scanOuterQr() {
    const gen = ++qrScanGen;
    const imgs = document.querySelectorAll("img");
    const found = [];
    for (const img of imgs) {
      if (img.closest("#wrapper-nested-eml, #wrapper-unwrap-panel, #wrapper-img-attachments")) continue;
      const src = img.currentSrc || img.src;
      // Only images that are part of the stored message. Remote (http/https) images
      // are skipped: fetching them would leak the open, and their canvas is tainted anyway.
      if (!src || !/^(data|mailbox|imap|news|cid):/i.test(src)) continue;
      const data = img.complete && img.naturalWidth ? decodeQrImage(img) : await decodeQr(src);
      if (gen !== qrScanGen) return;
      if (data) found.push(data);
    }
    if (gen !== qrScanGen) return;
    const old = byId("wrapper-qr-banner");
    if (old) old.remove();
    const fresh = found.filter(takeQr);
    for (const payload of fresh) noteQr("in the message", payload, "QR in the body: consider Link → O365 / Phishing");
    if (!fresh.length) return;
    const bar = document.createElement("div");
    bar.id = "wrapper-qr-banner";
    const title = document.createElement("div");
    title.className = "ics-title";
    title.textContent = "QR in this message (" + fresh.length + ") — extracted, not peeled";
    bar.appendChild(title);
    for (const payload of fresh) bar.appendChild(qrRow(payload));
    insertBanner(bar);
  }


  // --- Insights panel ---------------------------------------------------------------
  // Hints computed by signals.js in the background. Every value shown comes from the
  // message, so it is written with textContent only.
  const qrHints = [];

  function noteQr(where, payload, hint) {
    qrHints.push({ where: where, payload: String(payload || ""), hint: hint });
    const box = SB && SB.querySelector("#wrapper-signals .sig-qr");
    if (box) renderQrHints(box);
  }

  function renderQrHints(box) {
    box.textContent = "";
    if (!qrHints.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const h = document.createElement("div");
    h.className = "sig-sub";
    h.textContent = "QR codes found";
    box.appendChild(h);
    const ul = document.createElement("ul");
    for (const q of qrHints) {
      const li = document.createElement("li");
      li.appendChild(document.createTextNode("QR " + q.where + " — " + q.hint + ": "));
      const code = document.createElement("code");
      code.textContent = q.payload;
      li.appendChild(code);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function signalItem(sig) {
    const li = el("li");
    li.appendChild(el("span", "sig-str sig-" + (sig.strength === "strong" ? "strong" : "weak"), sig.strength));
    li.appendChild(document.createTextNode(" " + sig.label));
    if (sig.evidence) {
      li.appendChild(document.createTextNode(" "));
      li.appendChild(el("code", null, sig.evidence));
    }
    return li;
  }

  function section(title, items, render) {
    const box = el("div", "sig-section");
    box.appendChild(el("div", "sig-sub", title));
    const ul = el("ul");
    for (const it of items) ul.appendChild(render(it));
    box.appendChild(ul);
    return box;
  }

  function renderLayer(res, open) {
    const det = el("details", "sig-layer");
    det.open = !!open;
    const sum = el("summary");
    sum.appendChild(el("span", "sig-layer-name", res.label || (res.layer === "outer" ? "Opened message" : "Attached email")));
    const top = res.routes.slice(0, 3);
    for (const r of top) sum.appendChild(el("span", "sig-chip" + (r.strong ? " sig-chip-strong" : ""), r.name.replace(/^Malicious → /, "") + " · " + r.signals.length));
    if (!top.length) sum.appendChild(el("span", "sig-chip sig-chip-none", "no routes stand out"));
    if (res.sublime && res.sublime.length) sum.appendChild(el("span", "sig-chip sig-chip-sublime", "Sublime · " + res.sublime.length));
    if (res.language) sum.appendChild(el("span", "sig-chip sig-chip-none", res.language));
    det.appendChild(sum);

    for (const n of res.notes || []) det.appendChild(el("p", "sig-note", n));
    for (const r of res.routes) {
      const box = el("div", "sig-route");
      const head = el("div", "sig-route-name", r.name);
      head.appendChild(el("span", "sig-count", r.signals.length + " insight" + (r.signals.length === 1 ? "" : "s") + (r.strong ? " · " + r.strong + " strong" : "")));
      box.appendChild(head);
      const ul = el("ul");
      for (const sig of r.signals) ul.appendChild(signalItem(sig));
      box.appendChild(ul);
      det.appendChild(box);
    }
    if (res.sublime && res.sublime.length) {
      det.appendChild(
        section("Sublime Security rules matched (offline ports)", res.sublime, function (m) {
          const li = el("li");
          li.appendChild(el("span", "sig-str sig-sev-" + (m.severity || "low"), m.severity || "rule"));
          li.appendChild(document.createTextNode(" "));
          const a = el("a", null, m.name);
          a.href = m.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          rawLinks.add(a);
          li.appendChild(a);
          if (m.evidence) {
            li.appendChild(document.createTextNode(" "));
            li.appendChild(el("code", null, m.evidence));
          }
          if (m.routeHint) li.appendChild(el("div", "sig-hint", "→ " + m.routeHint));
          return li;
        })
      );
    }
    if (res.general.length) det.appendChild(section("Technical signals", res.general, signalItem));
    if (res.verify.length) {
      const rdapNote = res.rdap === "pending" ? " · looking up domain ages…" : res.rdap === "off" ? " · enable “Look up domain age” in the PeelScout button" : res.rdap === "no-permission" ? " · the domain-age permission is still pending" : "";
      det.appendChild(
        section("Verify" + rdapNote, res.verify, function (v) {
          const li = el("li");
          li.appendChild(el("code", null, v.what));
          li.appendChild(document.createTextNode(" — " + v.why + " "));
          if (v.link) {
            const a = el("a", null, "whois.com");
            a.href = v.link;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            rawLinks.add(a);
            li.appendChild(a);
          }
          return li;
        })
      );
    }
    const cat = el("div", "sig-section");
    cat.appendChild(el("div", "sig-sub", "Candidates to mark (only if the route is supported)"));
    if (res.iocs.length) {
      const table = el("table", "sig-iocs");
      const hr = el("tr");
      for (const t of ["Type", "Exact value", "Reason"]) hr.appendChild(el("th", null, t));
      table.appendChild(hr);
      for (const i of res.iocs) {
        const tr = el("tr");
        tr.appendChild(el("td", null, i.type));
        const td = el("td");
        td.appendChild(el("code", null, i.value));
        tr.appendChild(td);
        tr.appendChild(el("td", null, i.reason));
        table.appendChild(tr);
      }
      cat.appendChild(table);
    } else {
      cat.appendChild(el("p", "sig-none", "None identified with sufficient evidence."));
    }
    if (res.senderNote) cat.appendChild(el("p", "sig-note", res.senderNote));
    det.appendChild(cat);

    const actions = el("div", "wup-actions");
    const copy = el("button", null, "Copy summary");
    copy.type = "button";
    copy.addEventListener("click", function () {
      copyText(res.summary || "");
      copy.textContent = "Copied";
      setTimeout(function () { copy.textContent = "Copy summary"; }, 1500);
    });
    actions.appendChild(copy);
    det.appendChild(actions);
    return det;
  }

  function showSignals(layers) {
    const old = byId("wrapper-signals");
    // Ages arrive in a second pass: keep the sections the analyst opened or closed.
    const wasOpen = old ? Array.from(old.querySelectorAll(".sig-layer")).map(function (d) { return d.open; }) : null;
    if (old) old.remove();
    if (!layers || !layers.length) return;
    const panel = el("div");
    panel.id = "wrapper-signals";
    const head = el("div", "sig-head");
    head.appendChild(el("span", "ics-title", "Insights"));
    head.appendChild(el("span", "sig-disclaimer", "Hints to review against the classification guide; not a classification."));
    panel.appendChild(head);
    // With an attached original, that is what gets analysed: open it, fold the wrapper.
    const primary = layers.length > 1 ? 1 : 0;
    const main = layers[primary];
    const badges = [];
    if (main.routes[0]) {
      const r = main.routes[0];
      badges.push({ text: r.name.replace(/^Malicious → /, "") + " · " + r.signals.length, strong: r.strong > 0, rail: r.strong ? String(r.strong) : "", title: r.name });
    }
    if (main.sublime && main.sublime.length) badges.push({ text: "Sublime · " + main.sublime.length, strong: main.sublime.some(function (m) { return /high|critical/.test(m.severity); }) });
    setBadges(badges);
    layers.forEach(function (res, i) {
      panel.appendChild(renderLayer(res, wasOpen && wasOpen.length === layers.length ? wasOpen[i] : i === primary));
    });
    const qr = el("div", "sig-section sig-qr");
    panel.appendChild(qr);
    renderQrHints(qr);
    insertBanner(panel);
  }

  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.type === "wrapper-query") return Promise.resolve(linkFor(msg.linkUrl));
      if (msg.type === "wrapper-show-original") showOriginal(linkFor(msg.linkUrl));
      if (msg.type === "wrapper-keep-unwrapping") showStepper(linkFor(msg.linkUrl));
      if (msg.type === "ics-links") showIcsBanner(msg.urls || []);
      if (msg.type === "nested-eml") showNested(msg.messages || []);
      if (msg.type === "image-attachments") showImageAttachments(msg.images || []);
      if (msg.type === "signals") showSignals(msg.layers || []);
    });
  }

  rewriteAnchors(document);
  const mo = new MutationObserver(function (muts) {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) rewriteAnchors(node);
      }
    }
  });
  mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
  // Fallback when the background never reports nested mail for this document.
  setTimeout(function () {
    if (!gotNested) scanOuterQr();
  }, 800);
})();
