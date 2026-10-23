/**
 * Insights engine: turns one message layer into hints grouped by possible route.
 * It never classifies. Every signal carries the evidence it was built from so the
 * analyst can check it; strength is "strong" or "weak", never a percentage.
 * Sublime Security's open-source rules and lists (sublime-rules.js) run alongside.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rules.js"), require("./unwrap.js"), require("./phones.js") && globalThis.PeelPhones, require("./sublime-rules.js"));
  } else {
    root.PeelSignals = factory(root.PeelRules, root.WrapperUnwrap, root.PeelPhones, root.SublimeRules);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (R, Unwrap, Phones, Sublime) {
  "use strict";

  function lower(s) {
    return String(s || "").toLowerCase();
  }

  function parseAddress(raw) {
    const s = String(raw || "").trim();
    const angle = s.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>/);
    let name = "";
    let email = "";
    if (angle) {
      name = angle[1].trim().replace(/^"|"$/g, "").trim();
      email = angle[2];
    } else {
      const bare = s.match(/[^\s<>"',;]+@[^\s<>"',;]+/);
      email = bare ? bare[0] : "";
      name = bare ? s.replace(bare[0], "").replace(/[<>"()]/g, "").trim() : s;
    }
    // Keep the address as written: the catalogue needs the exact value.
    email = email.replace(/^mailto:/i, "");
    const at = email.lastIndexOf("@");
    return { raw: s, name, email, domain: at > 0 ? lower(email.slice(at + 1)) : "" };
  }

  function hostOf(url) {
    try {
      return lower(new URL(url).hostname).replace(/^\[|\]$/g, "");
    } catch (_) {
      // Malformed hosts (invalid punycode, odd characters) are exactly the ones to keep.
      const m = String(url || "").match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i);
      return m ? lower(m[1]) : "";
    }
  }

  // Registrable domain, approximated with a short list of multi-level suffixes.
  function regDomain(host) {
    const h = lower(host).replace(/\.$/, "");
    if (!h || /^[\d.]+$/.test(h) || h.indexOf(":") !== -1) return h;
    const labels = h.split(".");
    if (labels.length <= 2) return h;
    const last2 = labels.slice(-2).join(".");
    if (R.MULTI_LEVEL_SUFFIXES.indexOf(last2) !== -1) return labels.slice(-3).join(".");
    return last2;
  }

  function isFreemail(domain) {
    const d = regDomain(domain);
    if (!d) return false;
    if (Sublime && (Sublime.lists.isFreemail(d) || Sublime.lists.isFreemail(domain))) return true;
    return R.FREEMAIL.some(function (f) {
      return f.charAt(f.length - 1) === "." ? d.indexOf(f) === 0 : d === f;
    });
  }

  // Script first (non-Latin alphabets), then stop-word scoring for Latin-script
  // languages. Phrase rules cover the LATIN_COVERED languages; others get a note.
  const SCRIPTS = [
    ["Cyrillic (Russian, Ukrainian…)", /[\u0400-\u04FF]/g],
    ["Chinese", /[\u4E00-\u9FFF]/g],
    ["Japanese", /[\u3040-\u30FF]/g],
    ["Korean", /[\uAC00-\uD7AF]/g],
    ["Arabic", /[\u0600-\u06FF]/g],
    ["Hebrew", /[\u0590-\u05FF]/g],
    ["Greek", /[\u0370-\u03FF]/g],
    ["Thai", /[\u0E00-\u0E7F]/g],
    ["Devanagari (Hindi…)", /[\u0900-\u097F]/g],
  ];
  const STOPWORDS = {
    English: ["the", "and", "you", "your", "for", "please", "with", "this", "that", "have", "are", "will", "our", "we", "is", "of", "to", "from", "been", "would"],
    Spanish: ["el", "la", "los", "las", "que", "de", "por", "para", "usted", "con", "una", "está", "y", "del", "hoy", "necesito", "muy", "también", "su"],
    French: ["le", "les", "des", "vous", "votre", "est", "pour", "avec", "une", "dans", "nous", "être", "au", "aux", "sur", "pas", "merci", "cette", "sont"],
    Portuguese: ["o", "os", "você", "não", "para", "com", "uma", "seu", "sua", "está", "obrigado", "são", "e", "hoje", "preciso", "muito", "também", "pelo", "ao"],
    German: ["der", "die", "das", "und", "sie", "ihr", "ist", "nicht", "mit", "für", "bitte", "ein", "ihre", "uns", "wir", "über", "wurde", "unter", "falls", "bei", "auf", "werden", "sich", "zu"],
    Italian: ["il", "gli", "che", "di", "per", "non", "una", "sono", "con", "della", "grazie", "questo", "del", "alla", "nel", "anche", "suo", "tuo", "ci"],
    Dutch: ["de", "het", "een", "en", "van", "niet", "je", "u", "uw", "voor", "met", "is", "wij", "ons", "naar", "bij", "ook", "dit", "deze", "zijn"],
    Polish: ["nie", "się", "jest", "na", "że", "do", "to", "dla", "pan", "pani", "proszę", "jak"],
    Turkish: ["ve", "bir", "bu", "için", "ile", "değil", "lütfen", "siz", "sizin", "çok", "olarak", "da"],
    Romanian: ["și", "este", "pentru", "care", "nu", "cu", "vă", "dumneavoastră", "una", "sunt", "mulțumim", "acest"],
  };
  const STOPWORD_LANGS = {};
  for (const lang of Object.keys(STOPWORDS)) for (const w of STOPWORDS[lang]) STOPWORD_LANGS[w] = (STOPWORD_LANGS[w] || 0) + 1;
  const LATIN_COVERED = ["English", "Spanish", "French", "Portuguese", "German", "Italian", "Dutch"];

  function detectLanguage(text) {
    // URLs and addresses are not language (encoded ones look like "a", "e", "q" tokens).
    const t = String(text || "").replace(/\b(?:https?:\/\/|www\.)\S+|\S+@\S+/gi, " ");
    const letters = (t.match(/\p{L}/gu) || []).length;
    if (letters < 20) return null;
    for (const [name, re] of SCRIPTS) {
      const n = (t.match(re) || []).length;
      if (n / letters > 0.3) return { name, covered: false };
    }
    const tokens = t.toLowerCase().match(/\p{L}+/gu) || [];
    let best = null;
    let bestScore = 0;
    let second = 0;
    for (const lang of Object.keys(STOPWORDS)) {
      const set = new Set(STOPWORDS[lang]);
      let score = 0;
      // Words shared by several languages ("de", "para") count for less.
      for (const w of tokens) if (set.has(w)) score += 1 / (STOPWORD_LANGS[w] || 1);
      if (score > bestScore) {
        second = bestScore;
        best = lang;
        bestScore = score;
      } else if (score > second) second = score;
    }
    // Too little text, or two languages too close to call: say nothing.
    if (!best || bestScore < 3 || bestScore < second * 1.5) return null;
    return { name: best, covered: LATIN_COVERED.indexOf(best) !== -1 };
  }

  const ATTACK_ROUTES = {
    "Credential Phishing": "Link → Phishing / O365 (Payload → Docuphish if delivered in a file)",
    "BEC/Fraud": "Response → BEC / 419 Scam",
    "Callback Phishing": "Response → Vishing",
    "Malware/Ransomware": "Payload → Docuphish / Link → Link to Payload",
    "Extortion": "Response → 419 Scam",
    "Spam": "NTD / DNE (spam)",
  };

  function urlParts(url) {
    try {
      const u = new URL(url);
      return { scheme: u.protocol.replace(/:$/, ""), path: u.pathname || "", query: u.search.replace(/^\?/, ""), fragment: u.hash.replace(/^#/, "") };
    } catch (_) {
      const m = String(url || "").match(/^([a-z][a-z0-9+.-]*):\/\/[^\/?#]*([^?#]*)(?:\?([^#]*))?(?:#(.*))?/i) || [];
      return { scheme: lower(m[1]), path: m[2] || "", query: m[3] || "", fragment: m[4] || "" };
    }
  }

  // IPv4 addresses in Received headers, private and loopback ranges left out.
  function receivedIps(received) {
    const out = [];
    const re = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g;
    let m;
    while ((m = re.exec(String(received || "")))) {
      const ip = m[1];
      if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(ip) || out.indexOf(ip) !== -1) continue;
      out.push(ip);
    }
    return out;
  }

  function hostIn(host, list) {
    const h = lower(host);
    return list.some(function (d) {
      return h === d || h.endsWith("." + d);
    });
  }

  // Brand token inside a domain that the brand does not use.
  function lookalikeBrand(domain) {
    const d = regDomain(domain);
    if (!d) return null;
    const name = d.split(".")[0];
    for (const brand of Object.keys(R.BRANDS)) {
      if (name.indexOf(brand) === -1) continue;
      if (R.BRANDS[brand].some(function (o) { return regDomain(o) === d; })) return null;
      return brand;
    }
    return null;
  }

  function officialFor(domain) {
    const d = regDomain(domain);
    for (const brand of Object.keys(R.BRANDS)) {
      if (R.BRANDS[brand].some(function (o) { return regDomain(o) === d; })) return brand;
    }
    return null;
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
  }

  function htmlToText(html) {
    return decodeEntities(
      String(html || "")
        .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
      .replace(/[ \t ]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
  }

  function extractLinks(html, text) {
    const links = [];
    const seen = Object.create(null);
    const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(String(html || "")))) {
      const href = decodeEntities(m[1] || m[2] || m[3] || "").trim();
      if (!/^https?:/i.test(href)) continue;
      links.push({ href, text: htmlToText(m[4]).slice(0, 300) });
      seen[href] = true;
    }
    const plain = String(text || "");
    const ure = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
    while ((m = ure.exec(plain))) {
      const href = m[0].replace(/[.,;:!?]+$/, "");
      if (seen[href]) continue;
      seen[href] = true;
      links.push({ href, text: href });
    }
    for (const l of links) {
      const out = Unwrap && Unwrap.unwrapAll ? Unwrap.unwrapAll(l.href) : { url: l.href, changed: false };
      l.final = out.url || l.href;
      l.wrapped = !!out.changed;
      l.layers = out.layers || [];
      l.host = hostOf(l.final);
      l.reg = regDomain(l.host);
    }
    return links;
  }

  // http(s) URLs carried in query values or the path of a redirector link.
  function embeddedUrls(url) {
    const out = [];
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return out;
    }
    u.searchParams.forEach(function (v) {
      if (/^https?:\/\//i.test(v)) out.push(v);
      else if (/^https?%3a/i.test(v)) {
        try { out.push(decodeURIComponent(v)); } catch (_) {}
      }
    });
    const inPath = u.pathname.match(/\/(https?:\/\/?.+)$/i) || u.pathname.match(/\/(https?%3a.+)$/i);
    if (inPath) {
      try { out.push(decodeURIComponent(inPath[1]).replace(/^(https?:)\/(?!\/)/i, "$1//")); } catch (_) {}
    }
    return out;
  }

  // Elements hidden with inline CSS that still carry text (filter-evasion filler).
  function hiddenText(html) {
    const re = /<([a-z][a-z0-9]*)\b[^>]*\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/\1>/gi;
    const hidden = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?\s*(?:;|$|!)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)|max-height\s*:\s*0(?:px)?\s*(?:;|$|!)/i;
    let total = 0;
    let sample = "";
    let m;
    while ((m = re.exec(String(html || "")))) {
      if (!hidden.test(m[2] || m[3] || "")) continue;
      const t = htmlToText(m[4]);
      if (t.length < 3) continue;
      total += t.length;
      if (!sample) sample = t.slice(0, 120);
    }
    return { chars: total, sample };
  }

  function words(text) {
    return (String(text || "").match(/[\p{L}\p{N}]+/gu) || []).length;
  }

  function matchPhrases(list, text) {
    const hits = [];
    for (const [re, label] of list) {
      const m = text.match(re);
      if (m) hits.push({ label, quote: m[0].slice(0, 80) });
    }
    return hits;
  }

  function parseAuth(value) {
    const v = lower(value);
    function get(k) {
      const m = v.match(new RegExp("\\b" + k + "\\s*=\\s*([a-z]+)"));
      return m ? m[1] : "";
    }
    return { spf: get("spf"), dkim: get("dkim"), dmarc: get("dmarc") };
  }

  /**
   * msg: { layer: "outer" | "nested", label, headers: {name: value}, subject, text, html,
   *        attachments: [{name, contentType}], hasNestedEml }
   */
  function analyze(msg) {
    const h = msg.headers || {};
    const from = parseAddress(h.from || msg.from);
    const replyTo = parseAddress(h["reply-to"] || "");
    const returnPath = parseAddress(h["return-path"] || "");
    const subject = String(h.subject || msg.subject || "");
    const bodyText = msg.text || htmlToText(msg.html);
    // A report wrapper copies the original's subject; judge the wrapper by its own text.
    const isWrapper = msg.layer === "outer" && !!msg.hasNestedEml;
    const text = (isWrapper ? "" : subject + "\n") + bodyText;
    const attachments = msg.attachments || [];
    const links = extractLinks(msg.html, msg.text);
    const actionLinks = links.filter(function (l) {
      return l.host && !R.UNSUBSCRIBE.test(l.text + " " + l.href) && !hostIn(l.host, R.DEFENSIVE_HOSTS) &&
        !(from.domain && regDomain(from.domain) === l.reg && !isFreemail(from.domain));
    });
    const phones = Phones && Phones.extractPhones ? Phones.extractPhones(bodyText) : [];
    const fromFree = isFreemail(from.domain);
    const nWords = words(bodyText);

    const routes = Object.create(null);
    const general = [];
    const verify = [];
    const iocs = [];
    const notes = [];

    function add(route, strength, label, evidence) {
      const sig = { strength, label, evidence: evidence || "" };
      if (!route) {
        general.push(sig);
        return;
      }
      if (!routes[route]) routes[route] = { key: route, name: R.ROUTES[route] || route, signals: [] };
      routes[route].signals.push(sig);
    }
    function addIoc(type, value, reason) {
      if (!value || iocs.some(function (i) { return i.type === type && i.value === value; })) return;
      iocs.push({ type, value, reason });
    }
    function phraseSignals(route, list, strength) {
      const hits = matchPhrases(list, text);
      for (const hit of hits) add(route, strength, "Phrase: " + hit.label, "“" + hit.quote + "”");
      return hits.length;
    }

    // --- Report / forwarding layer -------------------------------------------------
    if (msg.layer === "outer" && msg.hasNestedEml) {
      notes.push("Forwarding message with the original attached: analyse the attachment. The reporting channel (phishing mailbox → PhishLabs) does not decide the classification.");
      if (R.PHRASES.reportNarrative.test(bodyText) || nWords > 80) {
        add("firInternal", "weak", "Narrative text addressed to security", "Check the substantive message's To and purpose; “please review this email” is not enough.");
      }
    } else if (!msg.hasNestedEml && /^(fwd?|rv|tr|enc|wg)\s*:/i.test(subject) && R.PHRASES.forwardedBlock.test(bodyText)) {
      notes.push("Inline forward: the original's headers are not available; header insights describe the forward.");
      add("firMissingHeaders", "weak", "Original forwarded in the body, without its headers", "Use only if the missing headers prevent a decision.");
    }

    // --- Sender and headers -------------------------------------------------------
    if (from.email) {
      if (fromFree) add(null, "weak", "Freemail / ISP sender", from.email);
      const look = lookalikeBrand(from.domain);
      if (look) add(null, "strong", "Sender domain imitates the “" + look + "” brand", from.domain);
      if (from.name && from.name.indexOf("@") !== -1) {
        const shown = parseAddress(from.name);
        if (shown.domain && regDomain(shown.domain) !== regDomain(from.domain)) {
          add(null, "strong", "Display name contains another address", from.name + " ≠ " + from.email);
        }
      }
      const brandInName = from.name && Object.keys(R.BRANDS).find(function (b) { return lower(from.name).replace(/\s+/g, "").indexOf(b) !== -1; });
      if (brandInName && officialFor(from.domain) === null) {
        add(null, "strong", "Display name uses the “" + brandInName + "” brand from an unrelated domain", from.raw);
      }
      if (EXEC(from.name) || EXEC(subject)) {
        if (fromFree) add("bec", "strong", "Executive title with a freemail address", from.raw);
        else add("bec", "weak", "Executive title in display name or subject", from.name || subject);
      }
    }
    if (replyTo.email && from.email && regDomain(replyTo.domain) !== regDomain(from.domain)) {
      const strong = isFreemail(replyTo.domain) && !fromFree;
      add("bec", strong ? "strong" : "weak", "Reply-To diverts the reply to another domain" + (isFreemail(replyTo.domain) ? " (freemail)" : ""), "From: " + from.email + " · Reply-To: " + replyTo.email);
      addIoc("Email address", replyTo.email, "Reply-To that receives the reply; mark if a Response route is supported");
    }
    if (returnPath.email && from.email && regDomain(returnPath.domain) !== regDomain(from.domain)) {
      add(null, "weak", "Return-Path on another domain (common for bulk senders)", returnPath.email);
    }
    const auth = parseAuth(h["authentication-results"]);
    const fails = ["spf", "dkim", "dmarc"].filter(function (k) { return /^(fail|softfail|permerror)$/.test(auth[k]); });
    if (h["authentication-results"]) {
      if (fails.length) add(null, "weak", "Authentication failures: " + fails.map(function (k) { return k.toUpperCase() + "=" + auth[k]; }).join(", "), "A lone fail does not prove an attack; check the header comes from the first trusted hop.");
    } else if (msg.layer === "nested" && !h.received) {
      add("firMissingHeaders", "weak", "The original has no Received or Authentication-Results headers", "Use only if it prevents a decision.");
    }
    if (/^(re|aw|rv|res|sv|antw)\s*:/i.test(subject) && !h["in-reply-to"] && !h.references) {
      add("recon", "weak", "“Re:” without In-Reply-To/References: the thread is not in the message", subject);
    }

    // --- Links ---------------------------------------------------------------------
    const tracking = Object.create(null);
    for (const l of links) {
      const shownUrl = l.text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s<>"']*)?/i);
      if (shownUrl && l.reg) {
        const shownHref = /^https?:/i.test(shownUrl[0]) ? shownUrl[0] : "http://" + shownUrl[0];
        const shownFinal = Unwrap && Unwrap.unwrapAll ? Unwrap.unwrapAll(shownHref).url : shownHref;
        const shownReg = regDomain(hostOf(shownFinal));
        if (shownReg && shownReg !== l.reg && shownReg.indexOf(".") !== -1) {
          // Click-tracking redirectors carry the destination in a parameter; when that
          // destination is the domain the text shows, it is tracking, not a mismatch.
          const declared = embeddedUrls(l.final).some(function (u) { return regDomain(hostOf(u)) === shownReg; });
          if (declared || hostIn(l.host, R.ESP_TRACKING)) {
            (tracking[l.reg] = tracking[l.reg] || []).push(l.final);
          } else {
            add("phishing", "strong", "Link text shows one domain, the link goes to another", shownReg + " → " + l.final);
            addIoc("URL", l.final, "Link whose text poses as another domain");
          }
        }
      }
    }
    for (const reg of Object.keys(tracking)) {
      add(null, "weak", "Tracking links: " + tracking[reg].length + " go through " + reg + " and their declared destination matches the text", tracking[reg][0]);
    }
    const flagged = Object.create(null);
    function flagLink(l, label, strength, route) {
      const key = label + "|" + l.final;
      if (flagged[key]) return;
      flagged[key] = true;
      add(route || null, strength, label, l.final);
    }
    for (const l of actionLinks) {
      if (/^[\d.]+$/.test(l.host) || l.host.indexOf(":") !== -1) flagLink(l, "Link to an IP address", "strong");
      if (/(^|\.)xn--/.test(l.host)) flagLink(l, "IDN / punycode domain", "strong");
      if (/\.dev$/.test(l.host)) flagLink(l, "URL on .dev (SEA p. 16)", "weak");
      if (hostIn(l.host, R.SHORTENERS) || (Sublime && Sublime.lists.isShortener(l.host))) flagLink(l, "URL shortener", "weak");
      if (hostIn(l.host, R.FREE_HOSTING) || (Sublime && (Sublime.lists.isFreeFileHost(l.host, l.reg) || Sublime.lists.isFreeSubdomainHost(l.reg) || Sublime.lists.isSelfServicePlatform(l.host, l.reg)))) {
        flagLink(l, "Free hosting / file share / site builder often abused", "weak");
      }
      if (Sublime && Sublime.lists.isSuspiciousTld(l.host)) flagLink(l, "Link on a TLD in Sublime's suspicious-TLD list", "weak");
      const look = lookalikeBrand(l.host);
      if (look) {
        flagLink(l, "Link domain imitates the “" + look + "” brand", "strong", "phishing");
        addIoc("URL", l.final, "Link to a domain imitating “" + look + "”");
      }
    }

    // --- Content by route ----------------------------------------------------------
    const docAttachments = attachments.filter(function (a) { return R.DOC_ATTACHMENT.test(a.name || ""); });
    const htmlAttachments = attachments.filter(function (a) { return R.HTML_ATTACHMENT.test(a.name || "") || /text\/html|image\/svg/i.test(a.contentType || ""); });
    const credHits = matchPhrases(R.PHRASES.o365, text);
    if (credHits.length) {
      const suspicious = actionLinks.filter(function (l) { return !officialFor(l.host); });
      const viaFile = docAttachments.length > 0;
      const route = viaFile && !suspicious.length ? "docuphish" : "o365";
      for (const hit of credHits) add(route, "weak", "Keyword: " + hit.label, "“" + hit.quote + "”");
      if (suspicious.length && route === "o365") {
        add("o365", "strong", "Document/access lure linking outside Microsoft/Google", suspicious[0].final);
        for (const l of suspicious.slice(0, 3)) addIoc("URL", l.final, "Action link of the access lure");
        verify.push({ what: suspicious[0].final, why: "Check in the VM whether it opens a fake sign-in (O365/Google)." });
      }
      if (viaFile) {
        add("docuphish", "weak", "The lure comes with attachment(s) to inspect", docAttachments.map(function (a) { return a.name; }).join(", "));
      }
    }
    for (const a of htmlAttachments) {
      add("docuphish", "strong", "HTML/SVG attachment (may hold a self-contained phish)", a.name || a.contentType);
      addIoc("Attachment", a.name || "(no name)", "HTML/SVG attachment; mark if it holds the phish (compute the hash)");
    }

    const becHits = phraseSignals("bec", R.PHRASES.bec, "weak");
    if (becHits && replyTo.email && regDomain(replyTo.domain) !== regDomain(from.domain)) {
      add("bec", "strong", "Business request with a diverted reply (Adobe Development precedent)", replyTo.email);
    }

    const reconHits = phraseSignals("recon", R.PHRASES.recon, "weak");
    if (!isWrapper && nWords > 0 && nWords <= 60 && !links.length && !attachments.length) {
      add("recon", reconHits || /\?/.test(text) ? "strong" : "weak", "Very short message without links or attachments that seeks a reply", nWords + " words");
    }

    const s419 = phraseSignals("scam419", R.PHRASES.scam419, "weak");
    if (s419 && fromFree) add("scam419", "weak", "Financial proposal from freemail", from.email);

    const vishHits = matchPhrases(R.PHRASES.vishing, text);
    const vishBrand = text.match(R.PHRASES.vishingBrands);
    if (phones.length && (vishHits.length || vishBrand)) {
      add("vishing", vishBrand && vishHits.length ? "strong" : "weak", "Phone number next to " + (vishBrand ? "the “" + vishBrand[0] + "” brand" : "") + (vishBrand && vishHits.length ? " and " : "") + (vishHits.length ? vishHits.map(function (x) { return x.label.toLowerCase(); }).join(", ") : ""), phones.join(" · "));
      for (const p of phones.slice(0, 3)) addIoc("Cellphone", p, "Callback number of the lure (do not mark a legitimate signature number)");
    } else if (vishBrand && vishHits.length) {
      add("vishing", "weak", "“" + vishBrand[0] + "” invoice lure (look for the phone number in images, PDF or invite)", vishHits.map(function (x) { return x.label; }).join(", "));
    }

    const jobHits = phraseSignals("job", R.PHRASES.job, "weak");
    if (jobHits && (fromFree || actionLinks.some(function (l) { return !from.domain || l.reg !== regDomain(from.domain); }))) {
      add("job", "weak", "Offer from freemail or linking to another domain", from.email);
    }
    phraseSignals("techsupport", R.PHRASES.techsupport, "weak");

    phraseSignals("phishing", R.PHRASES.phishing, "weak");
    const hidden = hiddenText(msg.html);
    if (hidden.chars) {
      add(null, hidden.chars >= 200 ? "strong" : "weak", "Text hidden with CSS (" + hidden.chars + " characters)" + (hidden.chars < 200 ? "; marketing preheaders do this too" : ""), "“" + hidden.sample + "”");
    }
    const dating = text.match(R.PHRASES.dating);
    if (dating && actionLinks.length) {
      const obfuscated = hidden.chars >= 200 || actionLinks.some(function (l) { return /(^|\.)xn--/.test(l.host) || l.wrapped || hostIn(l.host, R.SHORTENERS); });
      add("phishing", obfuscated ? "strong" : "weak", "Dating lure with a link" + (obfuscated ? " that is obfuscated / with hidden filler (Carlos's 30/09 rule)" : ""), "“" + dating[0] + "” → " + actionLinks[0].final);
      if (obfuscated) addIoc("URL", actionLinks[0].final, "Action link of the dating lure");
    }

    if (R.PHRASES.attachmentMention.test(bodyText) && !attachments.length && !msg.hasNestedEml) {
      add("firMissingContent", "weak", "Mentions an attachment that is not there", "Before FIR, check whether the lure and Reply-To already support BEC.");
    }

    // --- Sublime Security rules (offline ports) and lists ---------------------------
    const sublime = [];
    if (Sublime) {
      const to = parseAddress(h.to || "");
      const ctx = {
        sender: { raw: from.raw, email: from.email, local: from.email.split("@")[0] || "", domain: from.domain, root: regDomain(from.domain), name: from.name },
        replyTo: replyTo.email ? [{ email: replyTo.email, domain: replyTo.domain, root: regDomain(replyTo.domain) }] : [],
        to: to.email ? [{ email: to.email, local: to.email.split("@")[0], domain: to.domain, root: regDomain(to.domain) }] : [],
        subject,
        subjectBase: subject.replace(/^(\s*(re|fwd?|fw|aw|rv|tr|wg|sv|antw|res|enc)\s*:\s*)+/i, ""),
        isReplyOrFwd: /^(re|fwd?|fw|aw|rv|tr|wg|sv|antw|res|enc)\s*:/i.test(subject),
        text: bodyText,
        plain: msg.text || bodyText,
        links: links.map(function (l) {
          const parts = urlParts(l.final);
          const sub = l.host && l.reg && l.host !== l.reg ? l.host.slice(0, -(l.reg.length + 1)) : "";
          return { href: l.href, url: l.final, host: l.host, root: l.reg, sub, path: parts.path, query: parts.query, fragment: parts.fragment, scheme: parts.scheme, display: l.text, layers: l.layers };
        }),
        attachments: attachments.map(function (a) { return { name: a.name || "", contentType: a.contentType || "" }; }),
        headers: h,
        dmarcPass: auth.dmarc ? auth.dmarc === "pass" : null,
        ips: receivedIps(h.received),
      };
      for (const m of Sublime.evaluate(ctx)) {
        const routes = m.attackTypes.map(function (t) { return ATTACK_ROUTES[t]; }).filter(Boolean);
        sublime.push(Object.assign(m, { routeHint: routes.join(" · ") }));
      }
      const sus = Sublime.lists.suspiciousSubject(subject);
      if (sus && !isWrapper) add(null, "weak", "Subject matches Sublime's suspicious-subject list", subject);
    }

    const language = detectLanguage(bodyText);
    if (language && !language.covered) {
      add(null, "weak", "Language: " + language.name + " — phrase rules cover " + LATIN_COVERED.join(", ") + " only; translate before deciding (an untranslated language is not grounds for DNE, SEA p. 3)", "");
    }

    // --- What the add-on cannot check ----------------------------------------------
    const domains = [];
    function wantAge(d, why) {
      const r = regDomain(d);
      if (!r || isFreemail(r) || officialFor(r) || hostIn(r, R.FREE_HOSTING) || hostIn(r, R.SHORTENERS) || domains.some(function (x) { return x.domain === r; })) return;
      domains.push({ domain: r, why });
    }
    if (from.domain) wantAge(from.domain, "sender");
    if (replyTo.domain) wantAge(replyTo.domain, "Reply-To");
    for (const l of actionLinks.slice(0, 8)) {
      wantAge(l.host, hostIn(l.host, R.ESP_TRACKING) || tracking[l.reg] ? "tracking redirector" : "link destination");
      // The destination a tracking redirector declares is the one the click reaches.
      for (const u of tracking[l.reg] ? embeddedUrls(l.final).slice(0, 1) : []) wantAge(hostOf(u), "redirector's declared destination");
    }
    for (const d of domains) verify.push({ what: d.domain, domain: d.domain, role: d.why, why: "Age not verified (" + d.why + "): check the creation date in RDAP/WHOIS and web presence.", link: "https://www.whois.com/whois/" + d.domain });

    // Sender exception (Carlos): do not mark a non-freemail sender, or one older than
    // a year with an active site, even if the email is malicious.
    const senderNote = from.email
      ? fromFree
        ? "Freemail sender: mark it only if it carries out the malicious action (freemail alone is not enough)."
        : "Non-freemail sender: per the operating exception, do not mark " + from.email + " even if the email is malicious."
      : "";

    const list = Object.keys(routes).map(function (k) { return routes[k]; });
    for (const r of list) {
      r.strong = r.signals.filter(function (s) { return s.strength === "strong"; }).length;
    }
    list.sort(function (a, b) { return b.strong - a.strong || b.signals.length - a.signals.length; });

    return {
      layer: msg.layer,
      label: msg.label || "",
      from: from.raw,
      replyTo: replyTo.raw,
      subject,
      date: h.date || "",
      ages: [],
      words: nWords,
      linkCount: links.length,
      routes: list,
      general,
      verify,
      iocs,
      senderNote,
      notes,
      sublime,
      language: language ? language.name : "",
    };
  }

  function daysBetween(a, b) {
    return Math.floor((b.getTime() - a.getTime()) / 86400000);
  }

  function humanDays(d) {
    if (d < 60) return d + " days";
    if (d < 730) return Math.round(d / 30.4) + " months";
    return (d / 365.25).toFixed(1).replace(/\.0$/, "") + " years";
  }

  /**
   * Fold domain-age lookups (RDAP, whois.com fallback) into a result.
   * ages: {domain: {created, source} | {error}}.
   * Age counts at the analysis date and, when the Date header parses, at the email date.
   * Under a year raises suspicion but is never proof on its own (guide, step 3).
   */
  function applyAges(result, ages, now) {
    const today = now || new Date();
    const sent = result.date ? new Date(result.date) : null;
    result.ages = [];
    result.general = result.general.filter(function (s) { return !s.fromAge; });
    for (const v of result.verify) {
      const a = v.domain && ages[v.domain];
      if (!a) continue;
      if (a.created) {
        const created = new Date(a.created);
        if (isNaN(created)) continue;
        const d = daysBetween(created, today);
        const atSend = sent && !isNaN(sent) ? daysBetween(created, sent) : null;
        const day = created.toISOString().slice(0, 10);
        v.why = "Created " + day + " (" + humanDays(d) + (atSend != null && atSend !== d ? "; " + humanDays(Math.max(atSend, 0)) + " at the email date" : "") + ") · " + a.source + " · " + v.role + ". Check web presence.";
        v.checked = true;
        result.ages.push({ domain: v.domain, created: day, days: d, source: a.source, role: v.role });
        if (d < 365) {
          result.general.push({ strength: d < 90 ? "strong" : "weak", label: "Domain registered less than a year ago (" + v.role + ")", evidence: v.domain + " · " + day + " · " + humanDays(d), fromAge: true });
        }
      } else if (a.error === "captcha") {
        v.why = "No RDAP data and whois.com asked for a captcha (" + v.role + "): open whois.com to check the creation date.";
      } else if (a.error === "no-rdap" || a.error === "not-found") {
        v.why = "No RDAP or whois.com data for this domain/TLD (" + v.role + "): check the registry's WHOIS.";
      } else if (a.error) {
        v.why = "Lookup failed (" + v.role + "): age not verified; check whois.com.";
      }
    }
    return result;
  }

  function EXEC(s) {
    return R.EXEC_TITLES.test(String(s || ""));
  }

  // Text in the analyst's response template, filled with what was observed.
  function summary(result) {
    const lines = [];
    const top = result.routes.filter(function (r) { return r.key.indexOf("fir") !== 0; }).slice(0, 3);
    lines.push("**Suggested classification:** pending review — routes with insights: " + (top.length ? top.map(function (r) { return r.name + " (" + r.signals.length + ")"; }).join("; ") : "none stand out"));
    lines.push("**Summary:** ");
    lines.push("**Rationale:**");
    const strong = [];
    for (const r of result.routes) for (const s of r.signals) if (s.strength === "strong") strong.push(s);
    for (const s of result.general) if (s.strength === "strong") strong.push(s);
    for (const s of strong.slice(0, 5)) lines.push("- " + s.label + (s.evidence ? ": `" + s.evidence + "`" : ""));
    for (const m of (result.sublime || []).slice(0, 5)) lines.push("- Sublime rule “" + m.name + "” (" + m.severity + "): `" + m.evidence + "`");
    for (const a of result.ages || []) lines.push("- Domain age (" + a.role + "): `" + a.domain + "` created " + a.created + " (" + humanDays(a.days) + "; " + a.source + ")");
    if (!strong.length && !(result.ages || []).length && !(result.sublime || []).length) lines.push("- ");
    lines.push("**Mark as malicious:**");
    if (result.iocs.length) {
      lines.push("| Type | Exact value | Reason |");
      lines.push("|---|---|---|");
      for (const i of result.iocs) lines.push("| " + i.type + " | `" + i.value + "` | " + i.reason + " |");
    } else {
      lines.push("None identified with sufficient evidence");
    }
    if (result.senderNote) lines.push("_" + result.senderNote + "_");
    const vm = result.verify.filter(function (v) { return /^https?:/i.test(v.what); });
    if (vm.length) {
      lines.push("**Review in VM:**");
      for (const v of vm) lines.push("- `" + v.what + "` — " + v.why);
    }
    return lines.join("\n");
  }

  return { analyze, summary, applyAges, regDomain, isFreemail, parseAddress, extractLinks, hiddenText, lookalikeBrand, detectLanguage, receivedIps };
});
