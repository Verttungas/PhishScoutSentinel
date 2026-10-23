/**
 * Insights engine: turns one message layer into hints grouped by possible route.
 * It never classifies. Every signal carries the evidence it was built from so the
 * analyst can check it; strength is "strong" or "weak", never a percentage.
 * Sublime Security's open-source rules and lists (sublime-rules.js) run alongside.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rules.js"), require("./unwrap.js"), require("./phones.js") && globalThis.PeelPhones, require("./sublime-rules.js"), require("./forwards.js"), require("./pdfscan.js"), require("./jsqr.min.js"));
  } else {
    root.PeelSignals = factory(root.PeelRules, root.WrapperUnwrap, root.PeelPhones, root.SublimeRules, root.PeelForwards, root.PeelPdf, root.jsQR);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (R, Unwrap, Phones, Sublime, Forwards, Pdf, QR) {
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
  // Optimal-string-alignment distance (edits and swaps of neighbouring letters).
  function editDistance(a, b) {
    a = String(a || "");
    b = String(b || "");
    if (Math.abs(a.length - b.length) > 3) return 9;
    const d = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  // Brand token inside a domain that the brand does not use, or the brand misspelt by
  // one letter (wellsfrago, rnicrosoft…).
  function lookalikeBrand(domain) {
    const d = regDomain(domain);
    if (!d) return null;
    const name = d.split(".")[0].replace(/-/g, "");
    for (const brand of Object.keys(R.BRANDS)) {
      const near = name.indexOf(brand) !== -1 || (brand.length >= 7 && editDistance(name, brand) === 1);
      if (!near) continue;
      if (R.BRANDS[brand].some(function (o) { return regDomain(o) === d; })) return null;
      return brand;
    }
    return null;
  }

  // Brands matched as words (short or common names such as TD), with their domains.
  function brandWord(text) {
    const t = String(text || "");
    for (const b of R.BRAND_WORDS) if (b.re.test(t)) return b;
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
      const shown = htmlToText(m[4]).slice(0, 300);
      links.push({ href, text: shown, imageOnly: !shown.replace(/[\s​-‏]/g, "") && /<img\b/i.test(m[4]) });
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
      // Redirect hops after the security wrappers: the address the click is sent on to.
      l.hops = [];
      let cur = l.final;
      for (let i = 0; i < 4; i++) {
        const hop = redirectHop(cur);
        if (!hop || l.hops.some(function (x) { return x.url === hop.url; })) break;
        // A security wrapper whose destination was written without a scheme
        // (Symantec "&u=www.example.com") is peeled, not counted as a redirect.
        const vendor = Unwrap && Unwrap.unwrapOnce ? Unwrap.unwrapOnce(cur).vendor : "";
        if (vendor && cur === l.final) {
          l.final = hop.url;
          l.layers = l.layers.concat(vendor);
          l.wrapped = true;
          l.host = hostOf(l.final);
          l.reg = regDomain(l.host);
          cur = hop.url;
          continue;
        }
        l.hops.push({ via: hostOf(cur), param: hop.param, url: hop.url });
        cur = hop.url;
      }
      l.dest = cur;
      l.destHost = hostOf(cur);
      l.destReg = regDomain(l.destHost);
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

  // External-mail banners and legal footers that gateways add to every message. They
  // say nothing about the message itself but skew word counts, language and phrases.
  function stripBanners(text) {
    return String(text || "")
      .replace(/\\r\\n|\\n/g, "\n")
      .replace(/\[cid:[^\]]*\]/gi, " ")
      .split(/\r?\n/)
      .filter(function (line) {
        const l = line.trim();
        if (!l) return true;
        if (/^[\s*\-_=~#⚠️!.|]+$/.test(l)) return false;
        if (l.length < 700 && R.BANNER.test(l)) return false;
        if (l.length < 900 && R.DISCLAIMER.test(l)) return false;
        return true;
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Lookalike letters from other alphabets, folded to Latin inside words that mix them.
  const CONFUSABLE = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ӏ": "l", "ԛ": "q", "ԝ": "w",
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I", "Ј": "J", "Ѕ": "S",
    "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
    "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  };
  const MIXED_WORD = /[\p{L}\p{M}]*(?:\p{Script=Latin}[\p{L}\p{M}]*[\p{Script=Cyrillic}\p{Script=Greek}]|[\p{Script=Cyrillic}\p{Script=Greek}][\p{L}\p{M}]*\p{Script=Latin})[\p{L}\p{M}]*/gu;
  const INVISIBLE = /[​-‏⁠-⁤﻿­͏᠎]/g;

  // Text as phrase rules should see it: compatibility forms (𝗕𝗼𝗹𝗱 math letters,
  // full-width) folded, invisible characters removed, mixed-script words folded.
  function foldText(s) {
    return String(s || "")
      .normalize("NFKC")
      .replace(INVISIBLE, "")
      .replace(MIXED_WORD, function (w) { return w.replace(/[^\p{Script=Latin}\p{M}]/gu, function (c) { return CONFUSABLE[c] || c; }); });
  }
  function stripMarks(s) {
    return String(s || "").normalize("NFKD").replace(/\p{M}/gu, "");
  }

  // Tricks that hide words from keyword filters.
  function obfuscation(parts) {
    const out = [];
    for (const [where, value] of parts) {
      const v = String(value || "");
      if (!v) continue;
      const math = v.match(/[\u{1D400}-\u{1D7FF}]/gu) || [];
      if (math.length >= 3) out.push({ label: "Unicode math letters in the " + where + " (𝗕𝗼𝗹𝗱-style text dodges keyword filters)", evidence: v.match(/[\u{1D400}-\u{1D7FF}\s]{3,}/u)[0].trim().slice(0, 60) + " → " + v.match(/[\u{1D400}-\u{1D7FF}\s]{3,}/u)[0].normalize("NFKC").trim().slice(0, 60) });
      const mixed = (v.normalize("NFC").match(MIXED_WORD) || []).filter(function (w) { return w.length >= 3; });
      if (mixed.length) out.push({ label: "Word mixing Latin with lookalike Cyrillic/Greek letters in the " + where, evidence: mixed.slice(0, 3).join(", ") + " → " + foldText(mixed.slice(0, 3).join(", ")) });
      const ws = v.normalize("NFC").split(/[\s\-_.,:;!?/|]+/).filter(function (w) { return /\p{L}{2,}/u.test(w); });
      if (ws.length >= 4) {
        const marked = ws.filter(function (w) { return /\p{M}/u.test(w.normalize("NFD")); });
        const plain = stripMarks(v).toLowerCase();
        if (marked.length / ws.length >= 0.5 && /\b(of|for|the|and|your|to|from|on|in|is|with)\b/.test(plain)) {
          out.push({ label: "Accents scattered over the letters of the " + where + " (dodges keyword filters)", evidence: v.slice(0, 80) + " → " + stripMarks(v).slice(0, 80) });
        }
      }
    }
    return out;
  }

  function matchPhrases(list, text) {
    const hits = [];
    const folded = foldText(text);
    const plain = stripMarks(folded);
    for (const [re, label] of list) {
      const m = folded.match(re) || plain.match(re);
      if (m) hits.push({ label, quote: m[0].slice(0, 80) });
    }
    return hits;
  }

  // Phone numbers placed as a call to action ("call us at…", "Toll Free:"), not the
  // ones in a signature block (Tel:, Fax, Ext., Cell#).
  function callbackPhones(text, phones) {
    const t = String(text || "");
    return phones.filter(function (p) {
      let at = t.indexOf(p);
      if (at < 0) {
        const digits = p.replace(/\D/g, "");
        const re = new RegExp(digits.split("").join("\\D{0,3}"));
        const m = re.exec(t);
        at = m ? m.index : -1;
      }
      if (at < 0) return false;
      const lineStart = t.lastIndexOf("\n", at) + 1;
      const lineEnd = t.indexOf("\n", at);
      const line = t.slice(lineStart, lineEnd < 0 ? t.length : lineEnd);
      if (R.PHONE_SIGNATURE.test(line)) return false;
      return R.PHONE_CTA.test(t.slice(Math.max(0, at - 160), at + 40));
    });
  }

  // Next hop of a redirector that carries the destination in a parameter or its path
  // (open redirects, affiliate and click-tracking links): {url, param} or null.
  function redirectHop(url) {
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return null;
    }
    const here = regDomain(u.hostname);
    function asUrl(v) {
      let s = String(v || "").trim();
      if (/^https?%3a/i.test(s)) {
        try { s = decodeURIComponent(s); } catch (_) {}
      }
      if (/^\/\/[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(s)) s = "https:" + s;
      if (/^www\.[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(s)) s = "https://" + s;
      if (!/^https?:\/\//i.test(s)) return null;
      const h = regDomain(hostOf(s));
      return h && h !== here ? s : null;
    }
    for (const [k, v] of u.searchParams) {
      const s = asUrl(v);
      if (s) return { url: s, param: k };
    }
    const inPath = u.pathname.match(/\/(https?:\/\/?.+)$/i) || u.pathname.match(/\/(https?%3a.+)$/i);
    if (inPath) {
      let s = inPath[1];
      try { s = decodeURIComponent(s); } catch (_) {}
      s = asUrl(s.replace(/^(https?:)\/(?!\/)/i, "$1//"));
      if (s) return { url: s, param: "(path)" };
    }
    return null;
  }

  // Email addresses carried in a URL as base64 (kits personalise the landing page).
  function base64Emails(url) {
    const out = [];
    let raw = String(url || "");
    try { raw = decodeURIComponent(raw); } catch (_) {}
    const parts = raw.split(/[?&=\/#](?![=]*(?:[?&\/#]|$))/);
    for (const p of parts) {
      if (!/^[A-Za-z0-9+\/_-]{12,}={0,2}$/.test(p)) continue;
      let s = "";
      try {
        s = atob(p.replace(/-/g, "+").replace(/_/g, "/"));
      } catch (_) {
        continue;
      }
      const m = s.match(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/);
      if (m && out.indexOf(m[0]) < 0) out.push(m[0]);
    }
    return out;
  }

  // Where an older message starts below the message itself: a header block, a one-line
  // header, "On … wrote:" or "-----Original Message-----". -1 when there is none.
  function quoteStart(text) {
    const t = String(text || "");
    const found = [];
    if (Forwards) {
      const b = Forwards.findBlocks(t);
      if (b.length) found.push(b[0].start);
    }
    for (const re of [R.PHRASES.inlineHeader, R.PHRASES.replyLine, /-{3,}\s*original message\s*-{3,}/i]) {
      let at = t.search(re);
      if (at < 0) continue;
      // "On Fri, 3 Jun, Name <a@b> wrote:" is sometimes broken over a few lines.
      if (re === R.PHRASES.replyLine) {
        const above = t.slice(Math.max(0, at - 200), at);
        const on = above.search(/(^|\n)\s*(on|le|el|em|am|il|op)\s[^\n]*(\n[^\n]*){0,2}$/i);
        if (on >= 0) at = at - above.length + on;
      }
      found.push(at);
    }
    return found.length ? Math.min.apply(null, found) : -1;
  }

  // Addresses a Received header says the message was delivered for.
  function deliveredFor(received) {
    const out = [];
    const re = /\bfor\s+<?"?([A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;
    let m;
    while ((m = re.exec(String(received || "")))) if (out.indexOf(m[1].toLowerCase()) < 0) out.push(m[1].toLowerCase());
    return out;
  }

  function nameTokens(s) {
    return (lower(s).match(/\p{L}{3,}/gu) || []).filter(function (t) { return !/^(the|and|mr|mrs|ms|dr|team|service|services|inc|ltd|llc)$/.test(t); });
  }

  function looksRandomName(name) {
    const base = String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "");
    return (/^[A-Z0-9]{8,}$/.test(base) && /\d.*\d/.test(base) && /[A-Z].*[A-Z]/.test(base)) || /[0-9a-f]{16,}/i.test(base) || /^ATT\d{8,}$/i.test(base);
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
   * msg: { layer: "outer" | "nested" | "forwarded", label, short, headers: {name: value},
   *        subject, text, html, attachments: [{name, contentType, size}],
   *        files: [{name, size, sha256, scan}] (PDF scans, see analyzeAll), hasNestedEml,
   *        reportWrapper (sent to a reporting mailbox), forwarded (the original found in
   *        its body), chainText, inline (rebuilt from a forward, without its headers) }
   */
  function analyze(msg) {
    const h = msg.headers || {};
    const from = parseAddress(h.from || msg.from);
    const replyTo = parseAddress(h["reply-to"] || "");
    const returnPath = parseAddress(h["return-path"] || "");
    const subject = String(h.subject || msg.subject || "");
    const bodyText = msg.text || htmlToText(msg.html);
    // A report wrapper copies the original's subject; judge the wrapper by its own text.
    const isWrapper = msg.layer === "outer" && (!!msg.hasNestedEml || !!msg.reportWrapper);
    // An older message quoted below: often filler (a hijacked or invented thread) whose
    // words, numbers and language are not the lure's.
    const quotedAt = msg.reportWrapper ? -1 : quoteStart(bodyText);
    const ownPart = quotedAt > 0 ? bodyText.slice(0, quotedAt) : bodyText;
    const quotedPart = quotedAt > 0 ? bodyText.slice(quotedAt) : "";
    const ownOnly = stripBanners(ownPart);
    // Who talks in the quote: filler copied from strangers' mail, or the sender's own
    // earlier message (fake "Re:" threads)?
    const fromReg0 = regDomain(parseAddress(h.from || msg.from).domain);
    const knownDomains = [fromReg0].concat((msg.orgDomains || []).map(regDomain), addressesIn(h.to).concat(addressesIn(h.cc)).map(function (a) { return regDomain(a.split("@")[1]); }));
    const quoteParties = addressesIn(quotedPart).map(function (a) { return regDomain(a.split("@")[1]); });
    const quoteUnrelated = !!quotedPart && words(quotedPart) > 30 && !quoteParties.some(function (d) { return knownDomains.indexOf(d) >= 0; });
    // A message that is little more than its own quote keeps the quote.
    const ownText = !quotedPart || quoteUnrelated || words(ownOnly) >= 15 ? ownOnly : stripBanners(bodyText);
    const allFiles = (msg.files || []).filter(function (f) { return f.scan && f.scan.ok; });
    // Text read from images (OCR, on demand) is what the email shows: it counts as the body.
    const images = allFiles.filter(function (f) { return f.kind === "image"; });
    const imageText = images.map(function (f) { return f.scan.text || ""; }).join("\n");
    const text = (isWrapper ? "" : subject + "\n") + ownText + (imageText && !isWrapper ? "\n" + imageText : "");
    const attachments = msg.attachments || [];
    const files = allFiles.filter(function (f) { return f.kind !== "image" && f.kind !== "qr"; });
    // QR codes found in the message's images: in the body they are a link of the email
    // (Link family); in an attached image they are inside a file (Payload → Docuphish).
    const qrFiles = allFiles.filter(function (f) { return f.kind === "qr"; });
    const fileText = files.map(function (f) { return f.scan.text || ""; }).join("\n") + (imageText ? "\n" + imageText : "");
    // What the lure says, wherever it says it (body or the PDF it comes in).
    const contentText = text + (fileText ? "\n" + fileText : "");
    const links = extractLinks(msg.html, msg.text);
    for (const f of qrFiles.filter(function (x) { return x.where === "body"; })) {
      for (const l of extractLinks("", (f.scan.uris || []).join("\n"))) {
        l.text = "";
        l.qr = f.name;
        links.push(l);
      }
    }
    const actionLinks = links.filter(function (l) {
      // Links to the sender's own site are not action links, unless they redirect
      // elsewhere or come from a QR code (a QR in the body is the action itself).
      return l.host && !R.UNSUBSCRIBE.test(l.text + " " + l.href) && !hostIn(l.host, R.DEFENSIVE_HOSTS) &&
        !(hostIn(l.host, R.SOCIAL_HOSTS) && !l.hops.length) &&
        !/^https?:\/\/[^\/]*googleusercontent\.com\/mail-sig\//i.test(l.final) &&
        !(quotedPart && l.text && quotedPart.indexOf(l.text) >= 0 && ownPart.indexOf(l.text) < 0) &&
        !(from.domain && regDomain(from.domain) === l.reg && l.destReg === l.reg && !isFreemail(from.domain) && !l.qr);
    });
    const phoneText = ownPart + (fileText ? "\n" + fileText : "");
    const phones = Phones && Phones.extractPhones ? Phones.extractPhones(phoneText) : [];
    const cbPhones = callbackPhones(phoneText, phones);
    const fromFree = isFreemail(from.domain);
    const nWords = words(ownText);

    const routes = Object.create(null);
    const general = [];
    const verify = [];
    let iocs = [];
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
    function phraseSignals(route, list, strength, source) {
      const hits = matchPhrases(list, source || text);
      for (const hit of hits) add(route, strength, "Phrase: " + hit.label, "“" + hit.quote + "”");
      return hits.length;
    }

    // --- Report / forwarding layer -------------------------------------------------
    if (msg.layer === "outer" && msg.hasNestedEml) {
      notes.push("Forwarding message with the original attached: analyse the attachment. The reporting channel (phishing mailbox → PhishLabs) does not decide the classification.");
      if (R.PHRASES.reportNarrative.test(bodyText) || nWords > 80) {
        add("firInternal", "weak", "Narrative text addressed to security", "Check the substantive message's To and purpose; “please review this email” is not enough.");
      }
    } else if (msg.reportWrapper) {
      const narrative = (ownText + "\n" + (msg.chainText || "")).match(R.PHRASES.reportNarrative);
      if (msg.forwarded) {
        notes.push("Report sent to " + (parseAddress(h.to || "").email || "the reporting mailbox") + " with the original forwarded in the body: it is analysed as “Forwarded original”, without its headers. The reporting channel does not decide the classification (Carlos, 23/10).");
        if (narrative) add("firInternal", "weak", "The report also narrates what happened", "“" + narrative[0].slice(0, 80) + "” — Internal Communication only if the substantive message is that narrative, not the forwarded email.");
      } else {
        notes.push("Sent to the reporting mailbox with no email forwarded in it. If it describes an event (a call, an SMS, a customer's report) it is FIR → Internal Communication; check it adds no new link, attachment, number or payment request of its own.");
        add("firInternal", narrative ? "strong" : "weak", narrative ? "Narrative report to the security mailbox, with no forwarded email" : "Message to the security mailbox with no forwarded email", narrative ? "“" + narrative[0].slice(0, 80) + "”" : parseAddress(h.to || "").email);
      }
    } else if (msg.inline) {
      notes.push("Rebuilt from the body of a report" + (msg.reportedBy ? " sent by " + msg.reportedBy : "") + ": Received, authentication and Reply-To of the original are not available.");
      const report = (subject + "\n" + ownText).match(R.PHRASES.reportSubject);
      if (report) {
        add("firInternal", "strong", "The forwarded message is itself someone reporting what they received (not the suspicious email)", "“" + report[0].slice(0, 80) + "”");
      }
      const pay = (contentText.match(R.PHRASES.paymentDetails) || []).map(function (x) { return x.toLowerCase(); }).filter(function (x, i, a) { return a.indexOf(x) === i; });
      if (pay.length >= 2) {
        add("firMissingHeaders", "strong", "Payment instructions forwarded without the original headers: spoofed or compromised sender can only be judged from them", pay.slice(0, 5).join(", "));
      }
    } else if (!msg.hasNestedEml && /^(fwd?|rv|tr|enc|wg)\s*:/i.test(subject) && R.PHRASES.forwardedBlock.test(bodyText)) {
      notes.push("Inline forward: the original's headers are not available; header insights describe the forward.");
      add("firMissingHeaders", "weak", "Original forwarded in the body, without its headers", "Use only if the missing headers prevent a decision.");
    }

    // --- Sender and headers -------------------------------------------------------
    const toAddrs = addressesIn(h.to);
    const recipients = toAddrs.concat(addressesIn(h.cc));
    const isRecipient = function (a) { return recipients.some(function (r) { return lower(r) === lower(a); }); };
    // The recipient's organisation: the To/Cc domains plus the ones the analyst set up
    // (and, for a forwarded original, the organisation that reported it).
    const orgDomains = (msg.orgDomains || []).concat(recipients.map(function (a) { return a.split("@")[1]; }))
      .map(regDomain).filter(function (d, i, a) { return d && !isFreemail(d) && a.indexOf(d) === i; });
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
      const wordInName = from.name && brandWord(from.name);
      if (brandInName && officialFor(from.domain) === null) {
        add(null, "strong", "Display name uses the “" + brandInName + "” brand from an unrelated domain", from.raw);
      } else if (wordInName && wordInName.domains.indexOf(regDomain(from.domain)) < 0) {
        add(null, "strong", "Display name uses the “" + wordInName.name + "” brand from an unrelated domain", from.raw);
      }
      if (EXEC(from.name) || EXEC(subject)) {
        if (fromFree) add("bec", "strong", "Executive title with a freemail address", from.raw);
        else add("bec", "weak", "Executive title in display name or subject", from.name || subject);
      }
    }
    // Identity and recipients (mass mailing, forged or invented senders).
    if (from.email && !msg.reportWrapper) {
      const local = from.email.split("@")[0];
      if (toAddrs.length && toAddrs.every(function (a) { return lower(a) === lower(from.email); })) add(null, "strong", "Sent to itself: the real recipients are hidden in Bcc (mass mailing)", from.email);
      if (/undisclosed[-\s]recipients/i.test(h.to || "")) add(null, "weak", "Undisclosed recipients (mass mailing)", h.to);
      else if (!h.to && !msg.inline) add(null, "weak", "No To header: the recipients were hidden in Bcc", "");
      const delivered = deliveredFor(h.received);
      if (delivered.length && toAddrs.length && !delivered.some(isRecipient)) add(null, "weak", "To shows " + toAddrs[0] + " but the message was delivered for " + delivered[0] + " (Bcc, list or forwarding)", "");
      if (/%[0-9a-f]{2}|[=&]/i.test(local)) add(null, "strong", "Sender address carries URL fragments (forged From)", from.email);
      const sender = parseAddress(h.sender || "");
      if (sender.domain && regDomain(sender.domain) !== regDomain(from.domain)) add(null, "weak", "Sender header on another domain than From", sender.email);
      if (from.name) {
        if (/^\s*\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}\s*$/.test(from.name)) add(null, "strong", "Display name is a date, not a person or company", from.raw);
        if (/[<>]/.test(from.name) && from.name.indexOf("@") === -1) add(null, "strong", "Display name holds an invented address in angle brackets", from.name.slice(0, 120));
        if (R.NOTIFICATION_NAME.test(from.name)) add(null, "weak", "Display name reads like a system notification", from.raw);
      }
      const randomBits = from.domain.split(".").slice(0, -2).concat(local.split(/[._+-]/)).filter(function (p) {
        return p.length >= 5 && /[b-df-hj-np-tv-z]{5,}/i.test(p.replace(/\d/g, ""));
      });
      if (randomBits.length) add(null, "weak", "Random-looking parts in the sender address", randomBits.slice(0, 3).join(", "));
      const greet = ownText.match(R.PHRASES.greeting);
      if (greet && /[._\d]/.test(greet[1]) && recipients.some(function (r) { return lower(r.split("@")[0]) === lower(greet[1].replace(/[.;]+$/, "")); })) {
        add(null, "strong", "Greets the recipient by the local part of their address (mass-generated)", greet[0].trim());
      }
      const intro = ownText.match(R.PHRASES.selfIntro);
      if (intro) {
        const shownName = nameTokens(from.name);
        const said = nameTokens(intro[1]);
        const loc = lower(local);
        const overlap = said.some(function (t) { return shownName.indexOf(t) >= 0 || loc.indexOf(t) >= 0; }) || shownName.some(function (t) { return loc.indexOf(t) >= 0; });
        if (shownName.length >= 2 && said.length && !overlap) add(null, "weak", "Display name, address and the name in the text are three different people", from.name + " · " + from.email + " · " + intro[1]);
      }
      const fromReg = regDomain(from.domain);
      for (const org of orgDomains) {
        const label = org.split(".")[0];
        if (fromReg === org || label.length < 5) continue;
        const fromLabel = fromReg.split(".")[0];
        if (label.length >= 6 && fromLabel !== label && editDistance(fromLabel.replace(/-/g, ""), label) <= 2) {
          add(null, "strong", "Sender domain imitates the recipient's organisation (" + fromReg + " ≈ " + org + ")", from.email);
        } else if (lower(from.name).replace(/[\s.-]/g, "").indexOf(label) >= 0 || lower(local).indexOf(label) >= 0) {
          add(null, "weak", "Uses the name of the recipient's organisation (" + label + ") from an unrelated domain", from.raw);
        }
      }
    }
    let replyDiverted = false;
    if (replyTo.email && from.email && regDomain(replyTo.domain) !== regDomain(from.domain)) {
      if (hostIn(regDomain(from.domain), R.SEND_PLATFORMS) && !isFreemail(replyTo.domain)) {
        add(null, "weak", "Sent through " + regDomain(from.domain) + "; replies go to the organiser", replyTo.email);
      } else {
        replyDiverted = true;
        add(null, isFreemail(replyTo.domain) && !fromFree ? "strong" : "weak", "Reply-To diverts the reply to another domain" + (isFreemail(replyTo.domain) ? " (freemail)" : ""), "From: " + from.email + " · Reply-To: " + replyTo.email);
      }
    }
    if (returnPath.email && from.email && regDomain(returnPath.domain) !== regDomain(from.domain)) {
      add(null, "weak", "Return-Path on another domain (common for bulk senders)", returnPath.email);
    }
    const auth = parseAuth(h["authentication-results"]);
    const fails = ["spf", "dkim", "dmarc"].filter(function (k) { return /^(fail|softfail|permerror)$/.test(auth[k]); });
    if (h["authentication-results"]) {
      if (fails.length === 1 && fails[0] === "dkim" && /pass$/.test(auth.dmarc)) add(null, "weak", "DKIM failed but DMARC passed (often a gateway that rewrote the body)", "");
      else if (fails.length) add(null, "weak", "Authentication failures: " + fails.map(function (k) { return k.toUpperCase() + "=" + auth[k]; }).join(", "), "A lone fail does not prove an attack; check the header comes from the first trusted hop.");
    } else if (msg.layer === "nested" && !h.received) {
      add("firMissingHeaders", "weak", "The original has no Received or Authentication-Results headers", "Use only if it prevents a decision.");
    }
    if (!msg.inline && /^(re|aw|rv|res|sv|antw)\s*:/i.test(subject) && !h["in-reply-to"] && !h.references) {
      add("recon", "weak", "“Re:” without In-Reply-To/References: the thread is not in the message", subject);
    }
    for (const o of obfuscation([["subject", subject], ["display name", from.name], ["body", ownText.slice(0, 4000)]])) add(null, "strong", o.label, o.evidence);

    // --- Threads and filler ------------------------------------------------------------
    if (quotedPart && !msg.reportWrapper) {
      if (quoteUnrelated && orgDomains.indexOf(regDomain(from.domain)) < 0) {
        add(null, attachments.length || links.some(function (l) { return l.host; }) ? "strong" : "weak", "Old conversation between unrelated people quoted below the message (filler or hijacked thread)", (quoteParties.length ? addressesIn(quotedPart).slice(0, 3).join(", ") : quotedPart.trim().slice(0, 80)));
      }
      if (/^(re|aw|rv|res|sv|antw)\s*:/i.test(subject) && from.email) {
        const reply = quotedPart.match(R.PHRASES.replyLine);
        if (reply && lower(reply[0]).indexOf(lower(from.email)) >= 0) add(null, "weak", "Follows up on its own earlier message: no reply from the recipient in the thread", reply[0].trim().slice(0, 120));
      }
    }
    const buster = (subject + "\n" + bodyText).match(R.PHRASES.hashBuster);
    if (buster) add(null, "strong", "Random token string (defeats spam fingerprints)", buster[0].slice(0, 60));
    const ref = subject.match(R.PHRASES.subjectRef);
    if (ref && !isWrapper) add(null, "weak", "Reference number bolted onto the subject", ref[0].trim());
    for (const a of attachments) {
      if (looksRandomName(a.name)) add(null, "weak", "Randomly named attachment", a.name);
    }

    // --- Links ---------------------------------------------------------------------
    // A click tracker named after the sender ("acme-dot-yamm-track.appspot.com") is the
    // sender's own mail-merge tool.
    const senderLabel = from.domain && !fromFree ? regDomain(from.domain).split(".")[0] : "";
    function ownTracker(l) {
      return senderLabel.length >= 5 && l.host !== l.reg && l.host.indexOf(senderLabel) >= 0 && l.reg !== regDomain(from.domain);
    }
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
          const declared = embeddedUrls(l.final).some(function (u) { return regDomain(hostOf(u)) === shownReg; }) || l.destReg === shownReg;
          if (declared || hostIn(l.host, R.ESP_TRACKING) || ownTracker(l)) {
            (tracking[l.reg] = tracking[l.reg] || []).push(l.final);
          } else {
            (l.flags = l.flags || []).push("Text shows " + shownReg);
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
    function flagLink(l, label, strength, route, evidence) {
      const key = label + "|" + l.final;
      if (flagged[key]) return;
      flagged[key] = true;
      (l.flags = l.flags || []).push(label);
      if (strength === "strong" && !l.strongFlag) l.strongFlag = label;
      add(route || null, strength, label, evidence || l.final);
    }
    // Hosts a link reaches: the one in the email and the ones it redirects to.
    function hostsOf(l) {
      return [{ host: l.host, reg: l.reg }].concat(l.hops.map(function (x) { return { host: hostOf(x.url), reg: regDomain(hostOf(x.url)) }; }));
    }
    function checkHosts(l, list) {
      for (const t of hostsOf(l)) {
        if (!t.host) continue;
        if (/^[\d.]+$/.test(t.host) || t.host.indexOf(":") !== -1) flagLink(l, "Link to an IP address", "strong");
        if (/(^|\.)xn--/.test(t.host)) flagLink(l, "IDN / punycode domain", "strong");
        if (/\.dev$/.test(t.host)) flagLink(l, "URL on .dev (SEA p. 16)", "weak");
        if (hostIn(t.host, R.SHORTENERS) || (Sublime && Sublime.lists.isShortener(t.host))) flagLink(l, "URL shortener", "weak");
        if (!ownTracker(l) && !hostIn(t.host, R.ESP_TRACKING) && (hostIn(t.host, R.FREE_HOSTING) || (Sublime && (Sublime.lists.isFreeFileHost(t.host, t.reg) || Sublime.lists.isFreeSubdomainHost(t.reg) || Sublime.lists.isSelfServicePlatform(t.host, t.reg))))) {
          flagLink(l, "Free hosting / file share / site builder often abused", "weak");
        }
        if (Sublime && Sublime.lists.isSuspiciousTld(t.host)) flagLink(l, "Link on a TLD in Sublime's suspicious-TLD list", "weak");
        const look = lookalikeBrand(t.host);
        if (look) {
          flagLink(l, "Link domain imitates the “" + look + "” brand", "strong", "phishing");
          addIoc("URL", l.final, "Link to a domain imitating “" + look + "”");
        }
      }
      // Redirect hops after the security wrappers (open redirects, affiliate links).
      if (l.hops.length && !hostIn(l.host, R.ESP_TRACKING) && !tracking[l.reg] && !/\/c?l0\//i.test(l.final)) {
        const via = l.hops.map(function (x) { return x.via + (x.param !== "(path)" ? " ?" + x.param + "=" : ""); }).join(" → ");
        // The sender's own click tracker sending readers elsewhere is common in newsletters.
        const own = from.domain && !fromFree && regDomain(from.domain) === l.reg;
        flagLink(l, "Link bounces through a redirect on " + l.reg + " to " + l.destReg + (own ? " (the sender's own domain)" : ""), own ? "weak" : "strong", null, via + " → " + l.dest);
        verify.push({ what: l.dest, why: "Declared destination of the redirect on " + l.reg + " (not visited): check in the VM what it serves." });
        list.push(l);
      } else if (/(^|\.)google\.[a-z.]+$/.test(l.host) && /^\/(goto|url|amp\/s)\b/.test(urlParts(l.final).path) && !l.hops.length) {
        flagLink(l, "Google redirect that hides its destination", "strong");
        verify.push({ what: l.final, why: "Google redirect with an encoded destination: follow it in the VM." });
        list.push(l);
      }
      for (const u of [l.final].concat(l.hops.map(function (x) { return x.url; }))) {
        for (const e of base64Emails(u)) flagLink(l, "URL carries an email address in base64 (" + e + "): phishing kits personalise the page this way", "strong", null, u);
        if (/\/wp-(?:inlcudes|incldues|includ(?!es)|conten(?!t))/i.test(u)) flagLink(l, "Misspelt WordPress folder in the path (typical of kits on compromised sites)", "strong", null, u);
      }
    }
    const redirected = [];
    for (const l of actionLinks) {
      if (l.qr) flagLink(l, "Link from a QR code in the body (“" + l.qr + "”): a QR hides the link from scanners", "strong");
      if (l.text && !/[\p{L}\p{N}]/u.test(l.text)) flagLink(l, "Link hidden in a line of punctuation", "strong");
      checkHosts(l, redirected);
    }
    for (const l of actionLinks) {
      if (!l.imageOnly || l.reg === regDomain(from.domain) || tracking[l.reg]) continue;
      // A logo linking to the same site as the text links is ordinary layout.
      if (actionLinks.some(function (o) { return o !== l && !o.imageOnly && (o.destReg === l.destReg || o.reg === l.reg); })) continue;
      flagLink(l, "Link made only of an image: the lure may be written inside the image", "weak", "phishing");
      verify.push({ what: l.dest || l.final, why: "The clickable part is an image: read the image and check this URL in the VM." });
    }

    // --- Attachments: what the PDF scan found, and QR codes in attached images -------
    const fileLinks = [];
    const pwHint = R.PHRASES.passwordHint.test(foldText(ownText));
    function fileLinksOf(f, urls, via) {
      const out = [];
      for (const l of extractLinks("", urls.filter(function (u) { return /^https?:/i.test(u); }).join("\n"))) {
        l.text = "";
        l.file = f.name || "(unnamed file)";
        l.via = via;
        if (l.reg === regDomain(from.domain) || officialFor(l.host) || hostIn(l.host, R.DEFENSIVE_HOSTS)) continue;
        if (fileLinks.concat(out).some(function (x) { return x.final === l.final; })) continue;
        out.push(l);
        fileLinks.push(l);
        checkHosts(l, redirected);
      }
      return out;
    }
    function lureFile(f, kind, l, strong, how, quote) {
      add("docuphish", strong ? "strong" : "weak", kind + " “" + f.name + "” " + how + " " + l.destReg + (quote ? " (“" + quote + "”)" : ""), l.final);
      if (!strong) return;
      addIoc("Attachment", f.name + (f.sha256 ? " · SHA-256 " + f.sha256 : ""), kind + " carrying the lure");
      addIoc("URL", l.final, l.via === "qr" ? "URL in the QR code of the " + kind.toLowerCase() : l.via === "text" ? "URL the " + kind.toLowerCase() + " asks to visit" : "Action link inside the PDF");
      verify.push({ what: l.dest, why: (l.via === "qr" ? "From the QR code in “" : l.via === "text" ? "Written in “" : "Link inside “") + f.name + "” (not visited): check in the VM whether it opens a sign-in or a download." });
    }
    for (const f of files) {
      const sc = f.scan;
      if (sc.encrypted && !sc.decrypted) {
        if (pwHint) add("docuphish", "strong", "Encrypted PDF whose password is given in the email (keeps scanners out)", f.name + " (" + sc.algorithm + ", not opened)");
        else add("firEncrypted", "weak", "Encrypted PDF without its password", f.name);
      } else if (sc.encrypted && sc.decrypted && sc.password !== "(empty)") {
        add("docuphish", "strong", "Encrypted PDF opened with the password the email gives (keeps scanners out)", f.name);
      }
      for (const feat of sc.features) add(null, /JavaScript|Launch|Embedded|Submit/.test(feat) ? "strong" : "weak", "PDF has " + feat, f.name);
      if (/headlesschrome/i.test(sc.creator) || /^about:blank$/i.test(sc.title)) add(null, "weak", "PDF printed from a web page by a headless browser (how lure PDFs are often made)", f.name + " · " + (sc.title || sc.creator).slice(0, 60));
      if (!sc.text && !sc.uris.length && !(sc.qr || []).length && sc.images) notes.push("“" + f.name + "” has no text layer (scanned pages or images): read it visually.");
      const cta = (sc.text || "").match(R.PHRASES.fileCta);
      // A QR code inside a file is the Docuphish vehicle the guide describes (SEA p. 15).
      const viaQr = fileLinksOf(f, sc.qr || [], "qr");
      if (viaQr.length) lureFile(f, "PDF", viaQr[0], true, "has a QR code that sends the reader to");
      for (const q of (sc.qr || []).filter(function (x) { return !/^https?:/i.test(x); }).slice(0, 2)) add(null, "weak", "QR code in “" + f.name + "” holds text, not a link", q.slice(0, 120));
      const clickable = fileLinksOf(f, sc.uris, "link");
      if (clickable.length && clickable.length <= 5) {
        lureFile(f, "PDF", clickable[0], !!cta || (clickable[0].flags || []).length > 0, "sends the reader to", cta && cta[0]);
        for (const l of clickable.slice(1, 3)) if (cta) addIoc("URL", l.final, "Action link inside the PDF");
      }
      // Addresses written in the PDF (not clickable) count when the text asks to visit them.
      const written = fileLinksOf(f, sc.textUris || [], "text");
      if (written.length && written.length <= 5 && !viaQr.length && !clickable.length) {
        lureFile(f, "PDF", written[0], !!cta, "asks to visit (written, not a link)", cta && cta[0]);
      }
    }
    for (const f of qrFiles.filter(function (x) { return x.where !== "body"; })) {
      const viaQr = fileLinksOf(f, f.scan.uris || [], "qr");
      if (viaQr.length) lureFile(f, "Image", viaQr[0], true, "has a QR code that sends the reader to");
      else if (f.scan.text) add(null, "weak", "QR code in the attached image “" + f.name + "”", f.scan.text.slice(0, 120));
    }

    for (const f of images) {
      notes.push("Text read from “" + f.name + "” with OCR (" + (f.scan.confidence || 0) + "% confidence): numbers and addresses in it may need a second look.");
      for (const u of f.scan.uris || []) {
        verify.push({ what: u, why: "URL written inside the image “" + f.name + "” (OCR, not a clickable link): check it in the VM." });
        const look = lookalikeBrand(hostOf(u));
        if (look) add(null, "strong", "URL inside the image imitates the “" + look + "” brand", u);
      }
    }

    // --- Lure carried by an attachment instead of the body ---------------------------
    const bigMedia = attachments.filter(function (a) {
      const ct = String(a.contentType || "").toLowerCase();
      return (/^image\//.test(ct) && (a.size || 0) >= 15000) || (Pdf && Pdf.isPdf(a.name, ct));
    });
    if (!isWrapper && nWords <= 15 && bigMedia.length && !actionLinks.length) {
      add(null, "strong", "No text of its own: the content is in the attached " + (bigMedia.some(function (a) { return Pdf && Pdf.isPdf(a.name, a.contentType); }) ? "PDF/image" : "image") + " — open it (SEA p. 8: invoices hidden in images)", bigMedia.map(function (a) { return a.name || a.contentType; }).join(", "));
      if (fromFree && bigMedia.length === 1) {
        const random = looksRandomName(bigMedia[0].name);
        add("vishing", random ? "strong" : "weak", "Callback-scam pattern: freemail sender, empty body, a single " + (random ? "randomly named " : "") + "image/PDF", bigMedia[0].name);
      }
    }

    // --- Content by route ----------------------------------------------------------
    const docAttachments = attachments.filter(function (a) { return R.DOC_ATTACHMENT.test(a.name || ""); });
    const htmlAttachments = attachments.filter(function (a) { return R.HTML_ATTACHMENT.test(a.name || "") || /text\/html|image\/svg/i.test(a.contentType || ""); });
    const credHits = matchPhrases(R.PHRASES.o365, text);
    if (credHits.length) {
      const suspicious = actionLinks.filter(function (l) { return !officialFor(l.host) || redirected.indexOf(l) !== -1; });
      const viaFile = docAttachments.length > 0;
      // Link → O365 when the lure imitates a Microsoft/Google (or document-sharing)
      // sign-in; a bank's or another brand's portal is Link → Phishing.
      const lureText = foldText(subject + "\n" + from.name + "\n" + text);
      const word = brandWord(lureText);
      const claimed = (word && !word.workplace ? word : null) || (Object.keys(R.BRANDS).filter(function (b) { return R.WORKPLACE_BRANDS.indexOf(b) < 0; })
        .map(function (b) { return lower(lureText).replace(/\s+/g, "").indexOf(b) >= 0 ? { name: b } : null; }).filter(Boolean)[0]) || null;
      // Asking for "work credentials" is a sign-in of the organisation, whatever brand is shown.
      const msNamed = R.O365_LURE.test(lureText) || /\b(work|corporate|company|office|network) (credentials|password|account|e-?mail account)\b/i.test(lureText);
      const linkRoute = claimed && !msNamed ? "phishing" : "o365";
      const route = viaFile && !suspicious.length ? "docuphish" : linkRoute;
      for (const hit of credHits) add(route, "weak", "Keyword: " + hit.label, "“" + hit.quote + "”");
      if (suspicious.length && route !== "docuphish") {
        add(route, "strong", route === "o365" ? "Document/access lure linking outside Microsoft/Google" : "“" + claimed.name + "” sign-in lure linking outside the brand's domains", suspicious[0].final);
        for (const l of suspicious.slice(0, 3)) addIoc("URL", l.final, "Action link of the access lure");
        verify.push({ what: suspicious[0].final, why: route === "o365" ? "Check in the VM whether it opens a fake sign-in (O365/Google)." : "Check in the VM whether it opens a fake " + claimed.name + " sign-in." });
      }
      if (viaFile) {
        add("docuphish", "weak", "The lure comes with attachment(s) to inspect", docAttachments.map(function (a) { return a.name; }).join(", "));
      }
    } else {
      // No lure words, but the action link itself is disguised: Link family evidence.
      for (const l of actionLinks.filter(function (x) { return x.strongFlag; }).slice(0, 2)) {
        add("phishing", "weak", "Action link: " + l.strongFlag.charAt(0).toLowerCase() + l.strongFlag.slice(1), l.final);
        addIoc("URL", l.final, "Disguised action link (" + l.strongFlag + ")");
      }
    }
    for (const a of htmlAttachments) {
      add("docuphish", "strong", "HTML/SVG attachment (may hold a self-contained phish)", a.name || a.contentType);
      addIoc("Attachment", a.name || "(no name)", "HTML/SVG attachment; mark if it holds the phish (compute the hash)");
    }

    // --- Response routes: where the reply, call or payment goes ---------------------
    const bodyContacts = [];
    const scanText = ownText + (fileText ? "\n" + fileText : "");
    const scanLower = lower(scanText);
    for (const a of addressesIn(scanText)) {
      const la = lower(a);
      if (la === lower(from.email) || la === lower(replyTo.email) || bodyContacts.some(function (b) { return lower(b.email) === la; })) continue;
      const at = scanLower.indexOf(la);
      const before = scanText.slice(Math.max(0, at - 160), at);
      if (!R.PHRASES.contactContext.test(before)) continue;
      const reg = regDomain(a.split("@")[1]);
      // The sender's own colleagues or support desk are not a diversion.
      if (reg === regDomain(from.domain) && !fromFree) continue;
      bodyContacts.push({ email: a, pay: R.PHRASES.paymentContext.test(before), free: isFreemail(reg), isTo: isRecipient(a) });
    }
    for (const c of bodyContacts) {
      if (c.isTo) add(null, "strong", "The To address is the contact the body points to (the victims are in Bcc)", c.email);
      else if (c.pay) add("bec", c.free ? "strong" : "weak", "Asks to pay to an address that is not the sender's", c.email);
      else add(null, c.free ? "strong" : "weak", "Asks to write to another address" + (c.free ? " (freemail)" : ""), c.email);
    }

    const becHits = phraseSignals("bec", R.PHRASES.bec, "weak", contentText);
    const askPhone = matchPhrases(R.PHRASES.bec.filter(function (x) { return /mobile number/.test(x[1]); }), contentText).length;
    if (askPhone && fromFree) add("bec", "strong", "Asks for a mobile number from a freemail address (SEA p. 7)", from.email);
    if (becHits && replyDiverted) {
      add("bec", "strong", "Business request with a diverted reply (Adobe Development precedent)", replyTo.email);
      if (isFreemail(replyTo.domain)) add("bec", "strong", "Replies go to a freemail mailbox", replyTo.email);
    }

    const s419 = phraseSignals("scam419", R.PHRASES.scam419, "weak", contentText);
    const roi = contentText.match(R.PHRASES.roi);
    const pct = roi ? parseFloat(String(roi[1] || roi[2]).replace(",", ".")) : 0;
    if (pct >= 100) add("scam419", "strong", "Promises a " + pct + " % return (implausible; guide: 419 even before an advance is asked)", roi[0]);
    const pii = contentText.match(R.PHRASES.piiField) || [];
    if (pii.length >= 4) add("scam419", "strong", "Asks for a list of personal details (" + pii.length + " fields)", pii.slice(0, 4).map(function (x) { return x.trim(); }).join(" "));
    const freeAnswer = fromFree || (replyDiverted && isFreemail(replyTo.domain)) || bodyContacts.some(function (c) { return c.free; });
    const debt = matchPhrases(R.PHRASES.scam419.filter(function (x) { return /Debt collection/.test(x[1]); }), contentText).length;
    if (debt && freeAnswer) add("scam419", "strong", "Debt collection run from a freemail address", (bodyContacts.find(function (c) { return c.free; }) || from).email);
    else if (s419 && freeAnswer) add("scam419", "weak", "Financial proposal answered at a freemail address", (replyDiverted ? replyTo : from).email);

    const reconHits = phraseSignals("recon", R.PHRASES.recon, "weak");
    if (!isWrapper && !msg.inline && nWords > 0 && nWords <= 60 && !links.length && !attachments.length) {
      // A short message carrying a business or money pitch is that scam, not a probe.
      const competing = becHits || s419 || pct >= 100;
      if (reconHits || /\?/.test(text)) add("recon", competing ? "weak" : "strong", "Very short message without links or attachments that seeks a reply", nWords + " words");
    }

    const vishHits = matchPhrases(R.PHRASES.vishing, contentText);
    const vishBrand = foldText(contentText).match(R.PHRASES.vishingBrands);
    const inFile = fileText && cbPhones.some(function (p) { return fileText.indexOf(p) !== -1; });
    if (cbPhones.length && (vishHits.length || vishBrand)) {
      add("vishing", vishBrand && vishHits.length ? "strong" : "weak", "Callback number" + (inFile ? " in the attachment" : "") + " next to " + (vishBrand ? "the “" + vishBrand[0] + "” brand" : "") + (vishBrand && vishHits.length ? " and " : "") + (vishHits.length ? vishHits.map(function (x) { return x.label.toLowerCase(); }).join(", ") : ""), cbPhones.join(" · "));
      for (const p of cbPhones.slice(0, 3)) addIoc("Cellphone", p, "Callback number of the lure");
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
    const dating = foldText(text).match(R.PHRASES.dating);
    if (dating && actionLinks.length) {
      const obfuscated = hidden.chars >= 200 || actionLinks.some(function (l) { return /(^|\.)xn--/.test(l.host) || l.wrapped || hostIn(l.host, R.SHORTENERS); });
      add("phishing", obfuscated ? "strong" : "weak", "Dating lure with a link" + (obfuscated ? " that is obfuscated / with hidden filler (Carlos's 30/09 rule)" : ""), "“" + dating[0] + "” → " + actionLinks[0].final);
      if (obfuscated) addIoc("URL", actionLinks[0].final, "Action link of the dating lure");
    }

    if (R.PHRASES.attachmentMention.test(ownText) && !attachments.length && !msg.hasNestedEml && !msg.inline) {
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

    const language = detectLanguage(ownText);
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
    if (from.domain && !isWrapper) wantAge(from.domain, "sender");
    if (replyTo.domain) wantAge(replyTo.domain, "Reply-To");
    for (const l of actionLinks.concat(fileLinks).slice(0, 8)) {
      wantAge(l.host, hostIn(l.host, R.ESP_TRACKING) || tracking[l.reg] ? "tracking redirector" : l.file ? "link in the PDF" : "link destination");
      // The destination a redirector declares is the one the click reaches.
      if (l.destReg && l.destReg !== l.reg) wantAge(l.destHost, "redirect destination");
      else for (const u of tracking[l.reg] ? embeddedUrls(l.final).slice(0, 1) : []) wantAge(hostOf(u), "redirector's declared destination");
    }
    for (const d of domains) verify.push({ what: d.domain, domain: d.domain, role: d.why, why: "Age not verified (" + d.why + "): check the creation date in RDAP/WHOIS and web presence.", link: "https://www.whois.com/whois/" + d.domain });

    // --- Simulation markers ----------------------------------------------------------
    // Traces of simulation platforms only suggest an exercise; a domain the team has
    // attributed to a vendor (popup settings, with its source) supports it (guide, step 8).
    const ids = [h["message-id"], h["in-reply-to"], h.references].filter(Boolean).join(" ");
    for (const m of R.SIMULATION_MARKERS) {
      const hit = ids.match(m.re);
      if (hit) add("simulation", "weak", m.label, hit[0]);
    }
    const campaign = (ids.match(/<[a-z]+-([0-9a-f]{8,})-/i) || [])[1];
    if (campaign && new RegExp("pixel[^\"'\\s]*" + campaign, "i").test(msg.html || "")) add("simulation", "weak", "Tracking pixel tied to the campaign id in the Message-ID", campaign);
    const simList = msg.simulationDomains || [];
    if (simList.length) {
      const seen = [from.domain, replyTo.domain, returnPath.domain, (ids.match(/@([a-z0-9.-]+)>/i) || [])[1]]
        .concat(links.map(function (l) { return l.host; }), links.map(function (l) { return l.destHost; }))
        .concat((String(msg.html || "").match(/<img\b[^>]*\bsrc\s*=\s*["']?https?:\/\/[^\/"'\s>]+/gi) || []).map(function (x) { return x.replace(/^.*:\/\//, ""); }));
      for (const entry of simList) {
        const d = lower(entry.domain);
        const host = seen.find(function (x) { return x && (lower(x) === d || lower(x).endsWith("." + d)); });
        if (!host) continue;
        add("simulation", "strong", "Domain on the team's simulation list" + (entry.vendor ? " (" + entry.vendor + ")" : "") + (entry.source ? " — source: " + entry.source : " — no source recorded: corroborate it"), host);
      }
    }
    if (routes.simulation) {
      notes.push("Simulation needs the domain attributed to the vendor from a current source, not the email's own claims. Without prior notice from the client, share it with team leadership (SEA p. 9).");
    }

    // Missing headers only matter when the body does not already point somewhere (guide:
    // not to be applied mechanically when the content shows the scam).
    if (msg.inline && !routes.firMissingHeaders && !Object.keys(routes).some(function (k) { return k.indexOf("fir") !== 0; })) {
      add("firMissingHeaders", "weak", "Original forwarded in the body, without its headers", "Use only if the missing headers prevent a decision.");
    }

    // --- Non-malicious hypotheses ---------------------------------------------------
    // Shown after the routes, never instead of one with strong evidence.
    const anyStrong = Object.keys(routes).some(function (k) { return routes[k].signals.some(function (x) { return x.strength === "strong"; }); });
    if (!isWrapper && !anyStrong) {
      const suspicious = general.filter(function (x) { return x.strength === "strong" || R.SUSPICIOUS_WEAK.test(x.label); });
      const weakRoutes = Object.keys(routes).filter(function (k) { return k.indexOf("fir") !== 0 && k !== "simulation"; });
      if (suspicious.length || weakRoutes.length) {
        add("dne", "weak", "Suspicious signs but no route that holds up: Do Not Engage unless one is confirmed", suspicious.map(function (x) { return x.label; }).concat(weakRoutes.map(function (k) { return routes[k].name.split(" → ").pop() + " (weak)"; })).slice(0, 4).join(" · "));
      } else if (!routes.simulation && !Object.keys(routes).length) {
        add("ntd", "weak", "Nothing suspicious found: No Threat Detected if it is ordinary correspondence, marketing or an event invitation", links.some(function (l) { return R.UNSUBSCRIBE.test(l.text + " " + l.href); }) ? "Has an unsubscribe link" : "");
      }
    }

    const HINTS = ["dne", "ntd"];
    // On a tie, the guide's more specific mechanism goes first (RECON last of Response).
    const ORDER = ["simulation", "docuphish", "bec", "scam419", "vishing", "job", "techsupport", "o365", "phishing", "recon"];
    const rank = function (k) { const i = ORDER.indexOf(k); return HINTS.indexOf(k) >= 0 ? 99 : i < 0 ? 50 : i; };
    const list = Object.keys(routes).map(function (k) { return routes[k]; });
    for (const r of list) {
      r.strong = r.signals.filter(function (x) { return x.strength === "strong"; }).length;
    }
    // A domain the team attributed to a simulation vendor identifies the exercise
    // (guide, step 8): it goes first; hypotheses go last.
    const tier = function (r) { return r.key === "simulation" && r.strong ? 0 : HINTS.indexOf(r.key) >= 0 ? 2 : 1; };
    list.sort(function (a, b) {
      return tier(a) - tier(b) || b.strong - a.strong || b.signals.length - a.signals.length || rank(a.key) - rank(b.key);
    });

    // Response routes: the mailbox that receives the reply or the payment is a candidate
    // once the route has strong evidence.
    const top = list.find(function (r) { return HINTS.indexOf(r.key) < 0; });
    if (top && top.strong && !msg.reportWrapper && ["bec", "scam419", "recon", "vishing", "job", "techsupport"].indexOf(top.key) >= 0) {
      const leaf = top.name.split(" → ").pop();
      if (replyDiverted) addIoc("Email address", replyTo.email, "Reply-To that receives the reply (" + leaf + ")");
      for (const c of bodyContacts) addIoc("Email address", c.email, c.pay ? "Address the body asks to pay to (" + leaf + ")" : "Address the body asks to write to (" + leaf + ")");
      if (fromFree) addIoc("Email address", from.email, "Freemail sender that carries out the " + leaf);
    }

    // Sender exception (Carlos): do not mark a non-freemail sender, or one older than
    // a year with an active site, even if the email is malicious.
    let senderNote = from.email
      ? fromFree
        ? "Freemail sender: mark it only if it carries out the malicious action (freemail alone is not enough)."
        : "Non-freemail sender: per the operating exception, do not mark " + from.email + " even if the email is malicious."
      : "";
    // The reporter is not part of the attack: nothing in the report wrapper is a candidate.
    if (msg.reportWrapper) {
      iocs = [];
      senderNote = "";
    }
    // An exercise the team attributed to a vendor has nothing to mark (guide).
    if (list[0] && list[0].key === "simulation" && list[0].strong) {
      iocs = [];
      senderNote = "Simulation: nothing is marked as malicious.";
    }

    return {
      layer: msg.layer,
      label: msg.label || "",
      short: msg.short || "",
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
      // Everything observed, for the Indicators tab (candidates stay in iocs).
      ocrTexts: images.map(function (f) { return { name: f.name, text: f.scan.text || "", confidence: f.scan.confidence || 0 }; }),
      inventory: {
        links: links.concat(fileLinks).map(function (l) {
          return { text: l.text, href: l.href, url: l.final, dest: l.dest !== l.final ? l.dest : "", host: l.host, layers: l.layers || [], flags: (l.flags || []).concat(l.file ? [(l.via === "qr" ? "QR in " : l.via === "text" ? "Written in " : "In ") + l.file] : l.qr ? ["QR in the body (" + l.qr + ")"] : []), action: actionLinks.indexOf(l) !== -1 || !!l.file };
        }),
        addresses: [
          { role: "From", value: from.email },
          { role: "Reply-To", value: replyTo.email },
          { role: "Return-Path", value: returnPath.email },
        ].concat(bodyContacts.map(function (c) { return { role: c.pay ? "Payment address in the body" : "Contact address in the body", value: c.email }; }))
          .filter(function (a) { return a.value; }),
        phones: phones,
        attachments: attachments.map(function (a) {
          const f = (msg.files || []).find(function (x) { return x.name === a.name; });
          return { name: a.name || "(no name)", type: a.contentType || "", sha256: f && f.sha256 ? f.sha256 : "", info: f && f.scan ? (f.kind === "image" ? "Read with OCR (" + (f.scan.confidence || 0) + "% confidence)" : pdfSummary(f.scan)) : "" };
        }),
      },
    };
  }

  function pdfSummary(sc) {
    if (!sc.ok) return "PDF not read" + (sc.error ? " (" + sc.error + ")" : "");
    const parts = [sc.pages + " page" + (sc.pages === 1 ? "" : "s")];
    if (sc.encrypted) parts.push(sc.decrypted ? "encrypted, opened with " + (sc.password === "(empty)" ? "an empty password" : "the password from the email") : "encrypted (" + sc.algorithm + "), not opened");
    const web = sc.uris.filter(function (u) { return /^https?:/i.test(u); }).length;
    parts.push(web + " link" + (web === 1 ? "" : "s"));
    if (sc.features.length) parts.push(sc.features.join(", "));
    if (!sc.text && sc.images) parts.push("no text layer");
    return "PDF: " + parts.join(" · ");
  }

  // An image read with OCR, as a "file" the engine reads like a PDF's text.
  // A QR code decoded from an image of the message. where: "body" (shown inline) or
  // "attachment" (an attached image file).
  function qrFile(name, payload, where, sha256) {
    const p = String(payload || "");
    const uris = /^(https?:\/\/|www\.)/i.test(p) ? [/^www\./i.test(p) ? "https://" + p : p] : Pdf ? Pdf.urlsInText(p) : [];
    return { name: name || "image", kind: "qr", where: where === "body" ? "body" : "attachment", sha256: sha256 || "", scan: { ok: true, kind: "qr", uris: uris.slice(0, 3), text: p, features: [], images: 1 } };
  }

  function ocrFile(name, text, confidence, sha256) {
    const t = String(text || "");
    const uris = Pdf ? Pdf.urlsInText(t) : [];
    return { name: name || "image", kind: "image", sha256: sha256 || "", scan: { ok: true, kind: "image", pages: 1, encrypted: false, uris: uris.slice(0, 10), text: t, confidence: Math.round(confidence || 0), features: [], producer: "", creator: "", title: "", images: 1 } };
  }

  function addressesIn(value) {
    return String(value || "").match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data && data.byteLength !== undefined) return new Uint8Array(data);
    const s = String(data || "");
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  // PDF attachments: scanned with the passwords the message itself gives. The bytes are
  // dropped afterwards (results travel to the message tab).
  function scanFiles(msg, recipients) {
    const body = (msg.text || htmlToText(msg.html)) + "\n" + String((msg.headers || {}).subject || msg.subject || "");
    return (msg.files || []).map(function (f) {
      const scan = f.scan || (Pdf && f.bytes ? Pdf.scan(toBytes(f.bytes), { passwords: Pdf.passwordHints(body, recipients), images: true, qr: QR || null }) : null);
      return { name: f.name, kind: f.kind || "pdf", where: f.where, size: f.size, contentType: f.contentType, sha256: f.sha256 || "", scan };
    });
  }

  /**
   * Every layer of a displayed message, in the order the sidebar shows them.
   * outer: the opened message ({headers, subject, text, html, attachments, files,
   * hasNestedEml}); nested: attached messages (nested.js); icsUrls: calendar links.
   * A message sent to a reporting mailbox with the original forwarded in its body is
   * split into the report and the "Forwarded original".
   */
  function analyzeAll(outer, nested, icsUrls, opts) {
    const settings = opts || {};
    const shared = { simulationDomains: settings.simulationDomains || [], orgDomains: settings.orgDomains || [] };
    const o = Object.assign({ layer: "outer" }, outer, shared);
    if (icsUrls && icsUrls.length) o.text = (o.text || "") + "\n" + icsUrls.join("\n");
    const h = o.headers || {};
    const to = addressesIn(h.to);
    o.files = scanFiles(o, to);
    const layers = [];
    const report = !o.hasNestedEml && Forwards && to.some(Forwards.isReportMailbox);
    const split = report ? Forwards.split(o.text, o.html) : null;
    if (split && split.messages.length) {
      const inner = split.messages[split.messages.length - 1];
      const reporter = parseAddress(h.from || "").email;
      layers.push(analyze(Object.assign({}, o, {
        label: "Report sent to " + (to[0] || "the reporting mailbox"),
        short: "Report",
        text: split.wrapper.text,
        html: split.wrapper.html,
        reportWrapper: true,
        forwarded: true,
        chainText: split.messages.slice(0, -1).map(function (m) { return m.text || htmlToText(m.html); }).join("\n"),
        files: [],
      })));
      // Outlook puts the forwarded message's Message-ID in the forward's In-Reply-To.
      const ref = (String(h["in-reply-to"] || "").match(/<[^>]+>/) || [""])[0];
      layers.push(analyze({
        simulationDomains: shared.simulationDomains,
        // The organisation that reported it is the one being imitated, if any.
        orgDomains: shared.orgDomains.concat(addressesIn(h.from).concat(to).map(function (a) { return a.split("@")[1]; })),
        layer: "forwarded",
        label: "Forwarded original (inline, without its headers)" + (inner.headers.subject ? " · " + inner.headers.subject : ""),
        short: "Forwarded original",
        headers: { from: inner.headers.from, to: inner.headers.to, cc: inner.headers.cc, subject: inner.headers.subject, date: inner.headers.date, "message-id": ref },
        text: inner.text,
        html: inner.html,
        attachments: o.attachments,
        files: o.files,
        inline: true,
        reportedBy: reporter,
      }));
    } else if (report) {
      layers.push(analyze(Object.assign({}, o, { label: "Message to " + (to[0] || "the reporting mailbox"), short: "Report", reportWrapper: true })));
    } else {
      layers.push(analyze(Object.assign({ label: "Opened message", short: "Opened message" }, o)));
    }
    (nested || []).forEach(function (m, i) {
      const n = Object.assign({}, m, shared, {
        layer: "nested",
        label: "Attached email " + (i + 1) + (m.filename ? " · " + m.filename : "") + (m.subject ? " · " + m.subject : ""),
        short: "Attached email" + ((nested || []).length > 1 ? " " + (i + 1) : ""),
      });
      n.files = scanFiles(n, addressesIn((m.headers || {}).to));
      layers.push(analyze(n));
    });
    return layers.map(function (r) { return Object.assign(r, { summary: summary(r) }); });
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
    const top = result.routes.filter(function (r) { return r.key.indexOf("fir") !== 0 && r.key !== "dne" && r.key !== "ntd"; }).slice(0, 3);
    const hint = result.routes.find(function (r) { return r.key === "dne" || r.key === "ntd"; });
    lines.push("**Suggested classification:** pending review — routes with insights: " + (top.length ? top.map(function (r) { return r.name + " (" + r.signals.length + ")"; }).join("; ") : "none stand out") + (hint ? "; hypothesis: " + hint.name.replace(/ \(hypothesis\)$/, "") : ""));
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

  return { analyze, analyzeAll, ocrFile, qrFile, scanFiles, addressesIn, summary, applyAges, regDomain, isFreemail, parseAddress, extractLinks, hiddenText, lookalikeBrand, detectLanguage, receivedIps, stripBanners, foldText, redirectHop, callbackPhones };
});
