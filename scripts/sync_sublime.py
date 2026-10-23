#!/usr/bin/env python3
"""Regenerate sublime-data.js from Sublime Security's open-source repositories.

    python3 scripts/sync_sublime.py            # clones both repos into a temp dir
    python3 scripts/sync_sublime.py --src DIR  # DIR holds sublime-rules/ and static-files/

Both repositories are MIT licensed (Copyright (c) Sublime Security). Only data is
imported here: lists, hashed IOCs, CIDR ranges and open-redirect hosts. The rules that
can run offline are ported by hand in sublime-rules.js. Spamhaus-derived rules are
skipped because the Spamhaus DROP data has its own terms.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile

REPOS = {
    "sublime-rules": "https://github.com/sublime-security/sublime-rules.git",
    "static-files": "https://github.com/sublime-security/static-files.git",
}

LISTS = {
    "freeEmailProviders": "free_email_providers.txt",
    "disposableEmailProviders": "disposable_email_providers.txt",
    "urlShorteners": "url_shorteners.txt",
    "freeFileHosts": "free_file_hosts.txt",
    "freeSubdomainHosts": "free_subdomain_hosts.txt",
    "selfServiceCreationPlatforms": "self_service_creation_platform_domains.txt",
    "socialLandingHosts": "social_landing_hosts.txt",
    "suspiciousTlds": "suspicious_tlds.txt",
    "suspiciousSubjects": "suspicious_subjects.txt",
    "suspiciousSubjectsRegex": "suspicious_subjects_regex.txt",
    "suspiciousContent": "suspicious_content.txt",
    "bulkMailerUrlRootDomains": "bulk_mailer_url_root_domains.txt",
    "highTrustSenderRootDomains": "high_trust_sender_root_domains.txt",
    "fileExtensionsExecutables": "file_extensions_executables.txt",
    "fileExtensionsMacros": "file_extensions_macros.txt",
    "fileExtensionsSuspicious": "file_extensions_suspicious.txt",
}

# Observed IOC rules: file -> (key, what was hashed)
IOC_RULES = {
    "observed_malicious_sender_emails.yml": "senderEmail",
    "observed_malicious_sender_domains.yml": "senderDomain",
    "observed_malicious_sender_root_domains.yml": "senderRootDomain",
    "observed_malicious_reply_to_emails.yml": "replyToEmail",
    "observed_malicious_reply_to_domains.yml": "replyToDomain",
    "observed_malicious_reply_to_root_domains.yml": "replyToRootDomain",
    "observed_malicious_body_link_domains.yml": "linkDomain",
    "observed_malicious_body_link_root_domains.yml": "linkRootDomain",
    "observed_malicious_body_link_urls.yml": "linkUrl",
    "observed_malicious_attachment_sha256.yml": "attachmentSha256",
}

# Rules ported by hand in sublime-rules.js; their name, severity and attack types are
# taken from the YAML so the panel shows Sublime's own wording.
PORTED = [
    "punycode_sender_domain", "link_contains_punycode_characters", "headers_reply_to_wildcard_sender",
    "impersonation_free_email_masquerade_vip", "sus_tollfree_number", "link_invoice_fake_customer_service_freemail_sender",
    "evasion_zero_width_char_stuffing", "evasion_variation_selectors_subject", "body_unicode_slashes_in_url",
    "sus_urllink_hTTPs", "malformed_url_prefix", "link_randomly_generated_subdomain", "recon_email_address_harvesting_attempt",
    "bec_contract_order_lure_reply_to_mismatch", "sender_suspicious_cc_display_name", "link_telegraph", "link_catbox",
    "disposable_sender_unsolicited", "link_ipv4_in_ipv6", "link_numeric_ip_obfuscation", "spam_emoji_cash_lures",
    "recon_numeric_hex_subject", "subject_sus_bracket_ref", "link_hidden_dir", "link_double_encoded_url_path",
    "link_userinfo_excessive_padding", "fake_warning_banner_confusables", "link_multiple_rewrite_encoders_high",
    "sender_local_part_built_from_recipient", "suspicious_matching_subject_sender_display_name",
    "link_malfrom_subdomain_hyphen", "abuse_domains_by_proxy", "link_fake_rfp_reference_number_lure",
    "bec_romance_scam", "body_author_engagement_scam",
    "observed_malicious_sender_emails", "observed_malicious_sender_root_domains",
    "observed_malicious_headers_ips_aeza_group", "observed_malicious_headers_ips_media_land",
    "observed_malicious_headers_ips_smartape",
]

IP_RULES = [
    "observed_malicious_headers_ips_aeza_group.yml",
    "observed_malicious_headers_ips_media_land.yml",
    "observed_malicious_headers_ips_smartape.yml",
]


def git_head(path):
    try:
        out = subprocess.run(["git", "-C", path, "log", "-1", "--format=%H %cs"], capture_output=True, text=True, check=True)
        sha, date = out.stdout.strip().split()
        return {"commit": sha[:12], "date": date}
    except Exception:
        return {"commit": "", "date": ""}


def read_list(path):
    items = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                items.append(line.lower() if not path.endswith("_regex.txt") else line)
    return sorted(set(items)) if not path.endswith("_regex.txt") else items


def yaml_field(text, name):
    m = re.search(r'^%s:\s*"?(.*?)"?\s*$' % name, text, re.M)
    return m.group(1) if m else ""


def source_of(text):
    m = re.search(r"^source:\s*\|\s*\n([\s\S]*?)\n(?=[a-z_]+:)", text, re.M)
    return m.group(1) if m else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="directory containing sublime-rules/ and static-files/")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "sublime-data.js"))
    args = ap.parse_args()

    src = args.src
    if not src:
        src = tempfile.mkdtemp(prefix="sublime-")
        for name, url in REPOS.items():
            subprocess.run(["git", "clone", "-q", "--depth", "1", url, os.path.join(src, name)], check=True)

    rules_dir = os.path.join(src, "sublime-rules", "detection-rules")
    static_dir = os.path.join(src, "static-files")

    data = {
        "meta": {
            "generated": datetime.date.today().isoformat(),
            "rules": git_head(os.path.join(src, "sublime-rules")),
            "staticFiles": git_head(static_dir),
            "license": "MIT License, Copyright (c) 2025 Sublime Security (github.com/sublime-security/sublime-rules, github.com/sublime-security/static-files)",
        },
        "lists": {},
        "ioc": {},
        "badNetworks": [],
        "openRedirects": [],
        "ruleMeta": {},
    }

    for key, fname in LISTS.items():
        data["lists"][key] = read_list(os.path.join(static_dir, fname))

    for fname, key in IOC_RULES.items():
        path = os.path.join(rules_dir, fname)
        hashes = []
        if os.path.exists(path):
            src_text = source_of(open(path, encoding="utf-8").read())
            hashes = sorted(set(re.findall(r"'([0-9a-f]{64})'", src_text)))
        data["ioc"][key] = hashes

    for base in PORTED:
        path = os.path.join(rules_dir, base + ".yml")
        if not os.path.exists(path):
            print("missing rule:", base, file=sys.stderr)
            continue
        text = open(path, encoding="utf-8").read()
        attack = re.search(r"^attack_types:\s*\n((?:\s+-\s+.*\n)+)", text, re.M)
        data["ruleMeta"][base] = {
            "name": yaml_field(text, "name"),
            "severity": yaml_field(text, "severity"),
            "id": yaml_field(text, "id"),
            "attackTypes": re.findall(r'-\s+"?([^"\n]+)"?', attack.group(1)) if attack else [],
        }

    for fname in IP_RULES:
        path = os.path.join(rules_dir, fname)
        if not os.path.exists(path):
            continue
        text = open(path, encoding="utf-8").read()
        cidrs = sorted(set(re.findall(r'"(\d{1,3}(?:\.\d{1,3}){3}/\d{1,2})"', source_of(text))))
        data["badNetworks"].append({"name": yaml_field(text, "name"), "file": fname, "cidrs": cidrs})

    for fname in sorted(os.listdir(rules_dir)):
        if not fname.startswith("open_redirect_") or not fname.endswith(".yml"):
            continue
        text = open(os.path.join(rules_dir, fname), encoding="utf-8").read()
        src_text = source_of(text)
        hosts = set(re.findall(r"href_url\.domain\.domain\s*==\s*['\"]([^'\"]+)['\"]", src_text))
        roots = set(re.findall(r"href_url\.domain\.root_domain\s*==\s*['\"]([^'\"]+)['\"]", src_text))
        if hosts or roots:
            data["openRedirects"].append({"name": yaml_field(text, "name"), "file": fname, "hosts": sorted(hosts), "roots": sorted(roots)})

    body = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("/* Generated by scripts/sync_sublime.py — do not edit by hand.\n")
        f.write(" * Data from Sublime Security's open-source repositories.\n")
        f.write(" * MIT License, Copyright (c) 2025 Sublime Security. See LICENSE-SUBLIME. */\n")
        f.write("(function (root, data) {\n")
        f.write('  if (typeof module === "object" && module.exports) module.exports = data;\n')
        f.write("  else root.SublimeData = data;\n")
        f.write('})(typeof globalThis !== "undefined" ? globalThis : this, ')
        f.write(body)
        f.write(");\n")
    counts = {k: len(v) for k, v in data["lists"].items()}
    counts.update({"ioc." + k: len(v) for k, v in data["ioc"].items()})
    counts["openRedirects"] = len(data["openRedirects"])
    counts["badNetworks"] = sum(len(n["cidrs"]) for n in data["badNetworks"])
    print(json.dumps(counts, indent=1))


if __name__ == "__main__":
    sys.exit(main())
