/**
 * Detection rules from Sublime Security's open-source repository, ported by hand to
 * run offline on one message layer. Only rules that need nothing beyond headers, body,
 * links and Sublime's static lists are here (no ML, link crawling or sender history).
 * Where a condition needs data we do not have, the port says so next to it.
 *
 * Source: github.com/sublime-security/sublime-rules — MIT License,
 * Copyright (c) 2025 Sublime Security (see LICENSE-SUBLIME).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sublime-data.js"));
  else root.SublimeRules = factory(root.SublimeData);
})(typeof globalThis !== "undefined" ? globalThis : this, function (D) {
  "use strict";

  const RULES_URL = "https://github.com/sublime-security/sublime-rules/blob/main/detection-rules/";
  const L = {};
  for (const k of Object.keys((D && D.lists) || {})) L[k] = new Set(D.lists[k]);
  const IOC = {};
  for (const k of Object.keys((D && D.ioc) || {})) IOC[k] = new Set(D.ioc[k]);

  // --- SHA-256 (sync, for the hashed IOC lists) ------------------------------------
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  function sha256(str) {
    const bytes = Array.from(new TextEncoder().encode(String(str)));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return (x >>> 0).toString(16).padStart(8, "0"); }).join("");
  }

  function ipInCidr(ip, cidr) {
    const [net, bits] = cidr.split("/");
    function toInt(s) {
      const p = s.split(".").map(Number);
      return p.length === 4 && p.every(function (n) { return n >= 0 && n <= 255; }) ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : null;
    }
    const a = toInt(ip);
    const b = toInt(net);
    if (a == null || b == null) return false;
    const mask = +bits === 0 ? 0 : (0xffffffff << (32 - +bits)) >>> 0;
    return (a & mask) === (b & mask);
  }

  function has(set, v) {
    return !!(set && v && set.has(String(v).toLowerCase()));
  }
  function first(list, fn) {
    for (const x of list) {
      const r = fn(x);
      if (r) return r;
    }
    return null;
  }
  // Sublime negates many rules for high-trust senders that pass DMARC.
  function trustedPass(c) {
    return has(L.highTrustSenderRootDomains, c.sender.root) && c.dmarcPass === true;
  }
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  // Each test returns the evidence string when the rule matches.
  const PORTS = {
    punycode_sender_domain: function (c) {
      return /xn--/i.test(c.sender.domain) && c.sender.domain;
    },
    link_contains_punycode_characters: function (c) {
      return first(c.links, function (l) { return /(^|\.)xn--/i.test(l.host) && l.url; });
    },
    headers_reply_to_wildcard_sender: function (c) {
      // previous_threads is not available offline; the other conditions are kept.
      return c.headers["in-reply-to"] && !c.isReplyOrFwd && (c.sender.local.match(/\*/g) || []).length >= 2 && c.sender.email;
    },
    impersonation_free_email_masquerade_vip: function (c) {
      return has(L.freeEmailProviders, c.sender.domain) && /^c(?:hair|eo)\d+/i.test(c.sender.local) && c.sender.email;
    },
    sus_tollfree_number: function (c) {
      const m = (c.text + "\n" + c.subject).match(/\b\+?(\d{1}.)?\(?8\d{2}?\)?.555.?0[12]99\b/i);
      return m && m[0];
    },
    link_invoice_fake_customer_service_freemail_sender: function (c) {
      // "sender not previously seen" ($sender_emails) cannot be checked offline.
      if (!has(L.freeEmailProviders, c.sender.root)) return null;
      return first(c.links, function (l) {
        return l.display.trim() === "Unsubscribe" && !l.query && (l.path === "/" || !l.path || (l.root === "google.com" && !/\/forms\//i.test(l.path))) && l.url;
      });
    },
    evasion_zero_width_char_stuffing: function (c) {
      if (!c.links.length && !c.attachments.length) return null;
      if (trustedPass(c)) return null;
      const hit = [c.subject, c.sender.name].find(function (s) { return (String(s).match(/[​-‏­﻿⁠]/g) || []).length >= 10; });
      return hit != null && "zero-width characters in subject or display name";
    },
    evasion_variation_selectors_subject: function (c) {
      return /[A-Za-z0-9][︀-︍]/.test(c.subjectBase) && c.subject;
    },
    body_unicode_slashes_in_url: function (c) {
      const m = c.plain.match(/https?:\/\/[^\s⁄∕]+(?:\/[^\s⁄∕]+)*[⁄∕][^\s⁄∕]+/i);
      return (m && m[0]) || first(c.links, function (l) { return /[⁄∕]/.test(l.href) && l.href; });
    },
    sus_urllink_hTTPs: function (c) {
      return first(c.links, function (l) { return l.href.indexOf("hTTPs://") !== -1 && l.href; });
    },
    malformed_url_prefix: function (c) {
      // First branch of the rule; the Safe Links exception of the second branch is not ported.
      return first(c.links, function (l) { return /:\/\\/i.test(l.href) && l.href; });
    },
    link_randomly_generated_subdomain: function (c) {
      return first(c.links, function (l) { return /^[a-z]{3,30}[0-9a-f]{32}$/i.test(l.sub) && l.url; });
    },
    recon_email_address_harvesting_attempt: function (c) {
      return c.subjectBase.length <= 15 && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(c.text.trim()) &&
        has(L.freeEmailProviders, c.sender.root) && !c.attachments.length && c.links.length === 1 && c.text.trim();
    },
    bec_contract_order_lure_reply_to_mismatch: function (c) {
      return c.replyTo.some(function (r) { return r.email.toLowerCase() !== c.sender.email.toLowerCase(); }) &&
        /(?:contract agreement|order)_\d{8}\b/i.test(c.subject) && /attached (?:contract agreement|order)/i.test(c.text) && c.subject;
    },
    sender_suspicious_cc_display_name: function (c) {
      return /(cc:|CC:)$/.test(c.sender.name) && c.sender.name;
    },
    link_telegraph: function (c) {
      return first(c.links, function (l) { return (l.root === "telegra.ph" || l.root === "graph.org") && l.url; });
    },
    link_catbox: function (c) {
      if (trustedPass(c)) return null;
      return first(c.links, function (l) { return l.root === "catbox.moe" && !/\.json$/i.test(l.path) && l.url; });
    },
    disposable_sender_unsolicited: function (c) {
      // "not a previous recipient" cannot be checked offline.
      return has(L.disposableEmailProviders, c.sender.root) && c.sender.email;
    },
    link_ipv4_in_ipv6: function (c) {
      return first(c.links, function (l) { return /^\[?::ffff:/i.test(l.host) && l.url; });
    },
    link_numeric_ip_obfuscation: function (c) {
      return first(c.links, function (l) {
        return l.scheme === "http" && (/^\d{8,10}$/.test(l.host) || /^0\d+(\.0?\d+){0,3}$/.test(l.host)) && l.url;
      });
    },
    spam_emoji_cash_lures: function (c) {
      // Sublime also excludes the Alexa top 1M; high-trust domains stand in for it here.
      return /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(c.sender.name) &&
        /[$£€¥₿]/.test(c.subject) && c.dmarcPass !== true && !has(L.highTrustSenderRootDomains, c.sender.root) && c.sender.name + " · " + c.subject;
    },
    recon_numeric_hex_subject: function (c) {
      return /^#\d{8}-[a-f0-9]{8}\b/i.test(c.subjectBase) && c.subject;
    },
    subject_sus_bracket_ref: function (c) {
      const m = c.subjectBase.match(/\[(.)(.)\-([^\-]+)\-([^\]]+)\]$/);
      return m && m[1] === m[2] && /^\d+$/.test(m[3]) && /\d+$/.test(m[4]) && m[4].toLowerCase().indexOf(m[1].toLowerCase()) === 0 && c.subject;
    },
    link_hidden_dir: function (c) {
      const real = c.links.filter(function (l) { return l.scheme !== "mailto"; });
      if (!real.length || real.length > 10 || trustedPass(c)) return null;
      return first(real, function (l) {
        const p = l.path;
        const wellKnown = /\/\.well-known\//i.test(p) && ((/\/\.well-known\/[^\/]+\//i.test(p) && !/^\/.well-known\/pki-validation\/(?:godaddy.html)?$/i.test(p)) || l.fragment);
        return (wellKnown || /\/\.(js|env|git|svn|hg|DS_Store|htpasswd|htaccess|bash_history|bashrc|zshrc|profile|wp)\//i.test(p)) && l.url;
      });
    },
    link_double_encoded_url_path: function (c) {
      if (trustedPass(c)) return null;
      const hits = c.links.filter(function (l) {
        const m = l.path.match(/\/([a-zA-Z0-9+\/]{80,}={0,2})/);
        if (!m || !/^\/[a-zA-Z0-9+\/]{80,}={0,2}/.test(l.path)) return false;
        let dec = "";
        try { dec = atob(m[1]); } catch (_) { return false; }
        return /^[a-zA-Z0-9+\/]{60,}={0,2}/.test(dec);
      });
      return hits.length >= 2 && hits[0].url;
    },
    link_userinfo_excessive_padding: function (c) {
      if (!c.links.length || c.links.length >= 100) return null;
      return first(c.links, function (l) {
        return /https?(?:(?:%3a|:)?(?:\/|%2f){2})[^\/]+(?:\s+|%(?:25)?[a-f0-9]{2}|0x[a-f0-9]+){30,}(?:@|%(?:25)?40)[^\/]+(?:\/|%(?:25)?2f)/i.test(l.href) &&
          !(/(^|\.)google\./i.test(l.host) && /^\/maps\/place/i.test(l.path)) && l.href;
      });
    },
    fake_warning_banner_confusables: function (c) {
      // strings.replace_confusables is approximated with Unicode NFKC normalisation.
      const t = c.text.normalize("NFKC");
      const m = t.match(/This sender has been verified fro(?:m|rn) safe senders list/);
      return m && m[0];
    },
    link_multiple_rewrite_encoders_high: function (c) {
      // Sublime counts distinct URL rewrite encoders; here: distinct wrapper layers peeled.
      return first(c.links, function (l) { return new Set(l.layers).size >= 4 && l.href; });
    },
    sender_local_part_built_from_recipient: function (c) {
      const to = c.to[0];
      if (!to) return null;
      const sld = to.root.split(".")[0];
      return c.sender.local.toLowerCase() === (sld + "_" + to.local).toLowerCase() && c.sender.root !== to.root && c.sender.email;
    },
    suspicious_matching_subject_sender_display_name: function (c) {
      const re = /(?:^|[^a-z0-9])([a-z0-9]{32,64})(?=$|[^a-z0-9])/gi;
      let m;
      while ((m = re.exec(c.subject))) if (c.sender.name.indexOf(m[1]) !== -1) return m[1];
      return null;
    },
    link_malfrom_subdomain_hyphen: function (c) {
      return first(c.links, function (l) { return l.scheme !== "mailto" && /-$/.test(l.sub) && l.url; });
    },
    abuse_domains_by_proxy: function (c) {
      return c.sender.root === "domainsbyproxy.com" && c.sender.email;
    },
    link_fake_rfp_reference_number_lure: function (c) {
      if (trustedPass(c)) return null;
      return first(c.links, function (l) {
        return /(?:REF|S?RF[PQI]|BID|PROP)(?:-(?:[A-Z][0-9][A-Z][0-9]|[A-Z]{2}[0-9]{2})){2}/i.test(l.display) && l.root !== c.sender.root && l.display + " → " + l.url;
      });
    },
    bec_romance_scam: function (c) {
      const fewLinks = !c.links.length || (c.links.length === 1 && !has(L.freeEmailProviders, c.sender.root) && c.links[0].root !== c.sender.root);
      if (!fewLinks || c.attachments.length) return null;
      const emails = c.text.match(EMAIL_RE) || [];
      // "any free provider appears in the text" is checked on the addresses found in it.
      const freeInText = emails.some(function (e) { return has(L.freeEmailProviders, e.split("@")[1]); });
      const a = /(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sir|Lady|Rev)\.?[ \t]+/i.test(c.sender.name) && emails.length && freeInText &&
        [/(?:I am|My name is) .* (?:from|staying in) .+\./i, /(?:years old|cm|kg).*\./i, /(?:photo|pictures|sexy).*\./i, /(?:email|contact me|write to me|reply to me) at .*@.*\./i].some(function (r) { return r.test(c.text); });
      const b = has(L.freeEmailProviders, c.sender.root) && /[A-Z][a-z]+ [A-Z][a-z]+/.test(c.sender.name) && c.text.length < 200 &&
        /(?:I am|My name is) [^.!?]{1,30} from [^.!?]{1,50}[.!?,]/i.test(c.text) && /(?:can I|please) (?:talk to|contact|meet|chat with) (?:you|me)/i.test(c.text);
      return (a || b) && c.sender.raw;
    },
    body_author_engagement_scam: function (c) {
      return has(L.freeEmailProviders, c.sender.root) && /goodreads/i.test(c.text) &&
        /\byour (?:books?|work|text|title|novel|manuscript|writing|scholarship|research|reporting|story)\b/i.test(c.text) &&
        /\b(?:featur|spotlight|showcase|introduce your|invite you|selected your|reading (?:cycle|circle|challenge|community|discussion))/i.test(c.text) &&
        !trustedPass(c) && c.sender.email;
    },
    observed_malicious_sender_emails: function (c) {
      return c.sender.email && IOC.senderEmail && IOC.senderEmail.has(sha256(c.sender.email.toLowerCase())) && c.sender.email;
    },
    observed_malicious_sender_root_domains: function (c) {
      return c.sender.root && IOC.senderRootDomain && IOC.senderRootDomain.has(sha256(c.sender.root)) && c.sender.root;
    },
  };

  for (const net of (D && D.badNetworks) || []) {
    const base = net.file.replace(/\.yml$/, "");
    PORTS[base] = function (c) {
      return first(c.ips, function (ip) { return net.cidrs.some(function (cidr) { return ipInCidr(ip, cidr); }) && ip; });
    };
  }

  function evaluate(c) {
    const out = [];
    for (const base of Object.keys(PORTS)) {
      let ev = null;
      try { ev = PORTS[base](c); } catch (_) { ev = null; }
      if (!ev) continue;
      const meta = (D && D.ruleMeta && D.ruleMeta[base]) || {};
      out.push({ file: base + ".yml", url: RULES_URL + base + ".yml", name: meta.name || base, severity: meta.severity || "", attackTypes: meta.attackTypes || [], evidence: String(ev) });
    }
    // Open redirects: Sublime matches each service's redirect path; here the host plus a
    // URL carried in the link is enough to point the analyst at the redirect.
    for (const l of c.links) {
      const rule = ((D && D.openRedirects) || []).find(function (r) { return r.hosts.indexOf(l.host) !== -1 || r.roots.indexOf(l.root) !== -1; });
      if (rule && /https?(:|%3a)/i.test(l.query + l.path.slice(1))) {
        out.push({ file: rule.file, url: RULES_URL + rule.file, name: rule.name, severity: "medium", attackTypes: ["Credential Phishing"], evidence: l.url });
      }
    }
    return out;
  }

  // List lookups other checks reuse (Sublime static-files).
  const lists = {
    isFreemail: function (d) { return has(L.freeEmailProviders, d); },
    isDisposable: function (d) { return has(L.disposableEmailProviders, d); },
    isShortener: function (h) { return has(L.urlShorteners, h); },
    isFreeFileHost: function (h, r) { return has(L.freeFileHosts, h) || has(L.freeFileHosts, r); },
    isFreeSubdomainHost: function (r) { return has(L.freeSubdomainHosts, r); },
    isSelfServicePlatform: function (h, r) { return has(L.selfServiceCreationPlatforms, h) || has(L.selfServiceCreationPlatforms, r); },
    isSuspiciousTld: function (host) {
      const tld = String(host || "").toLowerCase().split(".").pop();
      return has(L.suspiciousTlds, tld) || has(L.suspiciousTlds, "." + tld);
    },
    isHighTrust: function (r) { return has(L.highTrustSenderRootDomains, r); },
    isBulkMailer: function (r) { return has(L.bulkMailerUrlRootDomains, r); },
    suspiciousSubject: function (subject) {
      const s = String(subject || "").toLowerCase();
      for (const p of (D && D.lists && D.lists.suspiciousSubjects) || []) if (p && s.indexOf(p) !== -1) return p;
      for (const p of (D && D.lists && D.lists.suspiciousSubjectsRegex) || []) {
        try { if (new RegExp(p, "i").test(subject)) return p; } catch (_) {}
      }
      return null;
    },
  };

  return { evaluate, lists, sha256, ipInCidr, meta: (D && D.meta) || {} };
});
