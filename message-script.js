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
    const w = sbCollapsed ? 32 : sbWidth;
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

  const ICON_FOLD = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TABS = [
    { id: "evidence", label: "Evidence" },
    { id: "indicators", label: "Indicators" },
    { id: "previews", label: "Previews" },
  ];
  // Slots per tab, in display order; sections land in their slot whenever they arrive.
  const SLOTS = {
    evidence: ["wrapper-signals"],
    indicators: ["indicators", "wrapper-ics-banner", "wrapper-qr-banner"],
    previews: ["wrapper-img-attachments", "wrapper-nested-eml"],
  };
  let activeTab = "evidence";
  let statusTimer = 0;

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
      '<button type="button" class="sb-rail" aria-label="Show PeelScout sidebar"><span class="sb-rail-label">PeelScout</span><span class="sb-rail-count"></span></button>' +
      '<div class="sb-main" role="complementary" aria-label="PeelScout">' +
      '<div class="sb-head"><span class="sb-title">PeelScout</span><span class="sb-status" role="status" aria-live="polite"></span>' +
      '<button type="button" class="icon-btn sb-collapse" aria-label="Hide sidebar" title="Hide sidebar">' + ICON_FOLD + "</button></div>" +
      '<div class="sb-scroll"><section class="ov" id="sb-overview" aria-label="Overview"><p class="empty">Analysing this message…</p></section>' +
      '<div class="sb-tabs" role="tablist" aria-label="PeelScout sections"></div></div></div>' +
      '<div class="sb-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0"></div>';
    SB.appendChild(sb);
    const scroll = sb.querySelector(".sb-scroll");
    const tablist = sb.querySelector(".sb-tabs");
    for (const t of TABS) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "sb-tab";
      tab.id = "tab-" + t.id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "panel-" + t.id);
      tab.dataset.tab = t.id;
      tab.innerHTML = '<span class="sb-tab-label"></span><span class="sb-tab-count"></span>';
      tab.querySelector(".sb-tab-label").textContent = t.label;
      tab.addEventListener("click", function () { setTab(t.id, true); });
      tablist.appendChild(tab);
      const panel = document.createElement("div");
      panel.className = "sb-panel";
      panel.id = "panel-" + t.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", "tab-" + t.id);
      for (const slotId of SLOTS[t.id]) {
        const slot = document.createElement("div");
        slot.id = "slot-" + slotId;
        panel.appendChild(slot);
      }
      const empty = document.createElement("p");
      empty.className = "empty panel-empty";
      empty.textContent = t.id === "previews" ? "No image attachments or attached emails in this message." : t.id === "indicators" ? "Indicators appear once the message is analysed." : "Evidence appears once the message is analysed.";
      panel.appendChild(empty);
      scroll.appendChild(panel);
    }
    // Arrow keys move between tabs (WAI-ARIA tabs pattern).
    tablist.addEventListener("keydown", function (e) {
      const ids = TABS.map(function (t) { return t.id; });
      let i = ids.indexOf(activeTab);
      if (e.key === "ArrowRight") i = (i + 1) % ids.length;
      else if (e.key === "ArrowLeft") i = (i - 1 + ids.length) % ids.length;
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = ids.length - 1;
      else return;
      e.preventDefault();
      setTab(ids[i], true);
    });
    sb.querySelector(".sb-rail").addEventListener("click", function () { setCollapsed(false); });
    sb.querySelector(".sb-collapse").addEventListener("click", function () { setCollapsed(true); });
    const handle = sb.querySelector(".sb-resize");
    handle.addEventListener("mousedown", function (e) {
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
    handle.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      sbWidth = Math.max(SIDEBAR_MIN, Math.min(Math.round(window.innerWidth * 0.7), sbWidth + (e.key === "ArrowLeft" ? 24 : -24)));
      applyLayout();
      saveLayout();
    });
    (document.documentElement || document.body).appendChild(sbHost);
    setTab(activeTab, false);
    applyLayout();
    try {
      if (api && api.storage && api.storage.local) {
        api.storage.local.get(["sidebarWidth", "sidebarCollapsed", "sidebarTab"]).then(function (v) {
          if (v.sidebarWidth) sbWidth = Math.max(SIDEBAR_MIN, +v.sidebarWidth || 380);
          if (typeof v.sidebarCollapsed === "boolean" && window.innerWidth >= 720) sbCollapsed = v.sidebarCollapsed;
          if (v.sidebarTab && SLOTS[v.sidebarTab]) setTab(v.sidebarTab, false);
          applyLayout();
        }, function () {});
      }
    } catch (_) {}
    return SB;
  }

  function setTab(id, focus) {
    activeTab = id;
    if (!SB) return;
    for (const t of TABS) {
      const tab = SB.getElementById("tab-" + t.id);
      const panel = SB.getElementById("panel-" + t.id);
      const on = t.id === id;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
      if (on && focus) tab.focus();
    }
    try {
      if (focus && api && api.storage && api.storage.local) api.storage.local.set({ sidebarTab: id });
    } catch (_) {}
  }

  function setTabCount(id, n) {
    const tab = SB && SB.getElementById("tab-" + id);
    if (tab) tab.querySelector(".sb-tab-count").textContent = n ? String(n) : "";
  }

  // Empty-state text shows only while a tab has nothing in it.
  function refreshPanels() {
    if (!SB) return;
    for (const t of TABS) {
      const panel = SB.getElementById("panel-" + t.id);
      const filled = SLOTS[t.id].some(function (s) { const slot = SB.getElementById("slot-" + s); return slot && slot.childElementCount; });
      panel.querySelector(".panel-empty").hidden = filled;
    }
    const imgs = byId("wrapper-img-attachments");
    const nested = byId("wrapper-nested-eml");
    setTabCount("previews", (imgs ? imgs.querySelectorAll(".att-thumb").length : 0) + (nested ? nested.querySelectorAll(".nest-block").length : 0));
  }

  function setStatus(text) {
    const el = SB && SB.querySelector(".sb-status");
    if (!el) return;
    el.textContent = text;
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(function () { el.textContent = ""; }, 2500);
  }

  function setRailCount(n) {
    const el = SB && SB.querySelector(".sb-rail-count");
    if (el) el.textContent = n ? String(n) : "";
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

  let returnFocus = null;

  function closePanel() {
    const el = byId("wrapper-unwrap-panel");
    if (el) el.remove();
    document.removeEventListener("keydown", escClose, true);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function escClose(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closePanel();
  }

  // Overlays behave as modal dialogs: labelled, focused on open, Esc closes them and
  // focus goes back where it was.
  function openDialog(panel, label) {
    returnFocus = (SB && SB.activeElement) || document.activeElement;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", label);
    panelRoot().appendChild(panel);
    document.addEventListener("keydown", escClose, true);
    const first = panel.querySelector("button");
    if (first) first.focus();
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
    openDialog(panel, "Original wrapper");
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
    openDialog(panel, "Keep unwrapping");
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
    title.textContent = "Calendar invite links";
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

  // Each section has a fixed slot in its tab, whichever arrives first.
  function insertBanner(el) {
    const root = sidebar();
    const slot = root.getElementById("slot-" + el.id);
    if (!slot) return;
    slot.textContent = "";
    slot.appendChild(el);
    refreshPanels();
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
    lbl.textContent = "Decoded as-is (wrappers not removed)";
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
    panel.querySelector("img").setAttribute("tabindex", "-1");
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
    openDialog(panel, "Image viewer");
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
    title.textContent = "Image attachments";
    bar.appendChild(title);
    const hint = document.createElement("p");
    hint.className = "empty";
    hint.textContent = "Open an image to see it full size; arrow keys move between images.";
    bar.appendChild(hint);
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
        row.querySelector(".nest-qr-lbl").textContent = "QR in " + (it.name || "attachment") + ", decoded as-is";
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
    for (const n of fromText) add(n, "Phone number in the attached email");
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
      h.textContent = msg.subject || "(no subject)";
      const who = document.createElement("div");
      who.className = "nest-who";
      who.textContent = "From " + (msg.from || "(unknown sender)") + (msg.filename ? ", attached as " + msg.filename : "");
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
    title.textContent = "QR codes in this message";
    bar.appendChild(title);
    for (const payload of fresh) bar.appendChild(qrRow(payload));
    insertBanner(bar);
  }


  // --- Insights: overview, Evidence and Indicators tabs ------------------------------
  // Data comes from signals.js in the background. Every value shown comes from the
  // message, so it is written with textContent only.
  const qrHints = [];
  let layersData = [];
  let selectedLayer = 0;

  function noteQr(where, payload, hint) {
    qrHints.push({ where: where, payload: String(payload || ""), hint: hint });
    if (layersData.length) renderEvidence(layersData[selectedLayer]);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function flash(button, label) {
    const old = button.textContent;
    button.textContent = label;
    button.classList.add("done");
    setTimeout(function () {
      button.textContent = old;
      button.classList.remove("done");
    }, 1400);
  }

  function copyWithFeedback(text, button, what) {
    copyText(text);
    setStatus("Copied " + (what || "value"));
    if (button) flash(button, "Copied");
  }

  // An exact value: click copies it; long values are clamped to three lines.
  function valueButton(text, what) {
    const b = el("button", "value", text);
    b.type = "button";
    b.title = "Copy " + (what || "value");
    b.setAttribute("aria-label", "Copy " + (what || "value") + ": " + text);
    b.addEventListener("click", function () { copyWithFeedback(text, null, what); });
    return b;
  }

  function copyButton(text, what) {
    const b = el("button", "copy", "Copy");
    b.type = "button";
    b.setAttribute("aria-label", "Copy " + (what || "value"));
    b.addEventListener("click", function () { copyWithFeedback(text, b, what); });
    return b;
  }

  function externalLink(text, href) {
    const a = el("a", null, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    rawLinks.add(a);
    return a;
  }

  // Up to five dots: filled for strong insights, half for weak ones.
  function meter(strong, weak) {
    const m = el("span", "meter");
    m.setAttribute("role", "img");
    m.setAttribute("aria-label", strong + " strong, " + weak + " weak");
    for (let i = 0; i < 5; i++) m.appendChild(el("i", i < strong ? "on" : i < strong + weak ? "half" : ""));
    return m;
  }

  function splitRoute(name) {
    const parts = String(name).split(" → ");
    return { leaf: parts[parts.length - 1], family: parts.slice(0, -1).join(" → ") };
  }

  function group(title, count, open) {
    const d = el("details", "group");
    d.open = open !== false;
    const s = el("summary");
    s.appendChild(el("span", "group-title", title));
    if (count != null) s.appendChild(el("span", "group-count", String(count)));
    d.appendChild(s);
    const ul = el("ul", "list");
    d.appendChild(ul);
    return { node: d, list: ul };
  }

  function signalItem(sig) {
    const li = el("li", "item " + (sig.strength === "strong" ? "strong" : "weak"));
    const label = el("span", "item-label");
    label.appendChild(el("span", "strength", sig.strength === "strong" ? "Strong" : "Weak"));
    label.appendChild(document.createTextNode(sig.label));
    li.appendChild(label);
    if (sig.evidence) li.appendChild(valueButton(sig.evidence, "evidence"));
    return li;
  }

  function renderOverview(res) {
    const ov = sidebar().getElementById("sb-overview");
    ov.textContent = "";
    if (layersData.length > 1) {
      const seg = el("div", "ov-layers");
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", "Message analysed");
      layersData.forEach(function (l, i) {
        const b = el("button", "ov-layer", l.layer === "outer" ? "Opened message" : "Attached email" + (layersData.length > 2 ? " " + i : ""));
        b.type = "button";
        b.title = l.label || "";
        b.setAttribute("aria-pressed", i === selectedLayer ? "true" : "false");
        b.addEventListener("click", function () {
          selectedLayer = i;
          renderAll();
        });
        seg.appendChild(b);
      });
      ov.appendChild(seg);
    }
    for (const n of res.notes || []) ov.appendChild(el("p", "callout", n));
    ov.appendChild(el("h2", "ov-heading", "Where the evidence points"));
    const routes = res.routes.slice(0, 4);
    if (routes.length) {
      const ul = el("ul", "ov-routes");
      for (const r of routes) {
        const li = el("li", "ov-route");
        const name = el("span", "ov-route-name");
        const parts = splitRoute(r.name);
        name.appendChild(document.createTextNode(parts.leaf));
        name.appendChild(el("span", "ov-route-family", parts.family));
        li.appendChild(name);
        const right = el("span", "ov-route-meter");
        const weak = r.signals.length - r.strong;
        right.appendChild(meter(r.strong, weak));
        right.appendChild(el("span", null, [r.strong ? r.strong + " strong" : "", weak ? weak + " weak" : ""].filter(Boolean).join(", ")));
        li.appendChild(right);
        ul.appendChild(li);
      }
      ov.appendChild(ul);
    } else {
      ov.appendChild(el("p", "ov-none", "No route stands out. Check the technical signals and the domains to verify."));
    }
    const actions = el("div", "ov-actions");
    const copy = el("button", "btn btn-primary", "Copy summary");
    copy.type = "button";
    copy.title = "Copy the analyst summary for this message";
    copy.addEventListener("click", function () { copyWithFeedback(res.summary || "", copy, "summary"); });
    actions.appendChild(copy);
    const meta = [];
    if (res.language) meta.push(res.language);
    if (res.sublime && res.sublime.length) meta.push(res.sublime.length + " Sublime rule" + (res.sublime.length === 1 ? "" : "s"));
    if (meta.length) actions.appendChild(el("span", "ov-meta", meta.join(", ")));
    ov.appendChild(actions);
  }

  function renderEvidence(res) {
    const box = el("div");
    box.id = "wrapper-signals";
    let total = 0;
    res.routes.forEach(function (r, i) {
      const g = group(r.name.replace(/^Malicious → /, ""), r.signals.length + (r.strong ? ", " + r.strong + " strong" : ""), i < 3);
      for (const sig of r.signals) g.list.appendChild(signalItem(sig));
      total += r.signals.length;
      box.appendChild(g.node);
    });
    if (res.sublime && res.sublime.length) {
      const g = group("Sublime Security rules", res.sublime.length);
      for (const m of res.sublime) {
        const li = el("li", "item sev-" + (m.severity || "low"));
        const label = el("span", "item-label");
        label.appendChild(el("span", "sev", (m.severity || "rule").replace(/^./, function (c) { return c.toUpperCase(); })));
        const link = externalLink(m.name, m.url);
        link.className = "rule-link";
        label.appendChild(link);
        li.appendChild(label);
        if (m.routeHint) li.appendChild(el("span", "item-sub", "Points to " + m.routeHint));
        if (m.evidence) li.appendChild(valueButton(m.evidence, "evidence"));
        g.list.appendChild(li);
      }
      total += res.sublime.length;
      box.appendChild(g.node);
    }
    if (res.general.length) {
      const g = group("Technical signals", res.general.length);
      for (const sig of res.general) g.list.appendChild(signalItem(sig));
      total += res.general.length;
      box.appendChild(g.node);
    }
    if (qrHints.length) {
      const g = group("QR codes", qrHints.length);
      for (const q of qrHints) {
        const li = el("li", "item strong");
        li.appendChild(el("span", "item-label", "QR " + q.where));
        li.appendChild(el("span", "item-sub", q.hint));
        li.appendChild(valueButton(q.payload, "QR content"));
        g.list.appendChild(li);
      }
      box.appendChild(g.node);
    }
    if (res.verify.length) {
      const state = res.rdap === "pending" ? "Looking up domain ages…" : res.rdap === "off" ? "Turn on “Look up domain age” in the PeelScout toolbar button to fill these in." : res.rdap === "no-permission" ? "The domain-age permission is still pending in Thunderbird's main window." : "";
      const g = group("Verify", res.verify.length);
      if (state) g.list.appendChild(el("li", "empty", state));
      for (const v of res.verify) {
        const li = el("li", "item" + (v.checked ? " done" : ""));
        li.appendChild(valueButton(v.what, /^https?:/i.test(v.what) ? "URL" : "domain"));
        const sub = el("span", "item-sub", v.why + " ");
        if (v.link) sub.appendChild(externalLink("Open whois.com", v.link));
        li.appendChild(sub);
        g.list.appendChild(li);
      }
      box.appendChild(g.node);
    }
    if (!box.childElementCount) box.appendChild(el("p", "empty", "Nothing worth flagging in this message."));
    insertBanner(box);
    setTabCount("evidence", total);
  }

  function renderIndicators(res) {
    const box = el("div");
    box.id = "indicators";
    const cand = group("Candidates to mark", res.iocs.length || null);
    if (res.iocs.length) {
      for (const i of res.iocs) {
        const li = el("li", "item strong");
        const row = el("div", "ind-row");
        const left = el("div");
        left.appendChild(el("span", "ind-type", i.type));
        left.appendChild(valueButton(i.value, i.type.toLowerCase()));
        left.appendChild(el("span", "item-sub", i.reason));
        row.appendChild(left);
        row.appendChild(copyButton(i.value, i.type.toLowerCase()));
        li.appendChild(row);
        cand.list.appendChild(li);
      }
    } else {
      cand.list.appendChild(el("li", "empty", "None identified with sufficient evidence. Mark items only once a route is supported."));
    }
    box.appendChild(cand.node);
    if (res.senderNote) box.appendChild(el("p", "callout", res.senderNote));

    const inv = res.inventory || {};
    const links = (inv.links || []).filter(function (l) { return l.action || l.flags.length; });
    const others = (inv.links || []).length - links.length;
    if ((inv.links || []).length) {
      const g = group("Links", links.length + (others ? " of " + inv.links.length : ""));
      for (const l of links) {
        const li = el("li", "item" + (l.flags.length ? " strong" : ""));
        const row = el("div", "ind-row");
        const left = el("div");
        if (l.text && l.text !== l.url && l.text !== l.href) left.appendChild(el("span", "link-text", l.text));
        left.appendChild(valueButton(l.url, "URL"));
        const flags = el("div", "flags");
        if (l.layers.length) flags.appendChild(el("span", "flag info", "Unwrapped: " + l.layers.join(", ")));
        for (const f of l.flags) flags.appendChild(el("span", "flag", f));
        if (flags.childElementCount) left.appendChild(flags);
        row.appendChild(left);
        row.appendChild(copyButton(l.url, "URL"));
        li.appendChild(row);
        g.list.appendChild(li);
      }
      if (others) g.list.appendChild(el("li", "empty", others + " unsubscribe, privacy or same-domain link" + (others === 1 ? " is" : "s are") + " not listed."));
      box.appendChild(g.node);
    }
    if ((inv.addresses || []).length) {
      const g = group("Addresses", inv.addresses.length, false);
      for (const a of inv.addresses) {
        const li = el("li", "item");
        const row = el("div", "ind-row");
        const left = el("div");
        left.appendChild(el("span", "ind-type", a.role));
        left.appendChild(valueButton(a.value, a.role + " address"));
        row.appendChild(left);
        row.appendChild(copyButton(a.value, a.role + " address"));
        li.appendChild(row);
        g.list.appendChild(li);
      }
      box.appendChild(g.node);
    }
    if ((inv.phones || []).length) {
      const g = group("Phone numbers", inv.phones.length);
      for (const p of inv.phones) {
        const li = el("li", "item weak");
        const row = el("div", "ind-row");
        row.appendChild(valueButton(p, "phone number"));
        row.appendChild(copyButton(p, "phone number"));
        li.appendChild(row);
        g.list.appendChild(li);
      }
      box.appendChild(g.node);
    }
    if ((inv.attachments || []).length) {
      const g = group("Attachments", inv.attachments.length, false);
      for (const a of inv.attachments) {
        const li = el("li", "item");
        li.appendChild(el("span", "item-label", a.name));
        if (a.type) li.appendChild(el("span", "item-sub", a.type));
        g.list.appendChild(li);
      }
      box.appendChild(g.node);
    }
    insertBanner(box);
    setTabCount("indicators", res.iocs.length);
  }

  function renderAll() {
    const res = layersData[selectedLayer];
    if (!res) return;
    renderOverview(res);
    renderEvidence(res);
    renderIndicators(res);
    const top = res.routes[0];
    setRailCount(top ? top.strong : 0);
  }

  function showSignals(layers) {
    if (!layers || !layers.length) return;
    const first = !layersData.length;
    layersData = layers;
    // With an attached original, that is what gets analysed first.
    if (first || selectedLayer >= layers.length) selectedLayer = layers.length > 1 ? 1 : 0;
    renderAll();
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
