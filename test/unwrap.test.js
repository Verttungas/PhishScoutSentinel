const test = require("node:test");
const assert = require("node:assert");
const { unwrapOnce, unwrapStep } = require("../unwrap.js");

test("Microsoft Safe Links keeps inner encoding", () => {
  const inner = "https://example.com/a?b=%2Fc";
  const r = unwrapOnce("https://nam10.safelinks.protection.outlook.com/?url=" + encodeURIComponent(inner) + "&data=x");
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.url, inner);
  assert.strictEqual(r.vendor, "Microsoft Safe Links");
});

test("Proofpoint v2", () => {
  const r = unwrapOnce("https://urldefense.proofpoint.com/v2/url?u=https-3A__example.com_path-3Fq-3D1&d=x");
  assert.strictEqual(r.url, "https://example.com/path?q=1");
});

test("Proofpoint v3 replaces * with whole UTF-8 characters", () => {
  const enc = Buffer.from("é", "utf8").toString("base64url");
  const r = unwrapOnce("https://urldefense.com/v3/__https://example.com/caf*__;" + enc + "!!abc$");
  assert.strictEqual(r.url, "https://example.com/café");
});

test("Proofpoint v3 run-length token", () => {
  const enc = Buffer.from("?=", "utf8").toString("base64url");
  const r = unwrapOnce("https://urldefense.com/v3/__https://example.com/a**Ab__;" + enc + "!!x$");
  assert.strictEqual(r.url, "https://example.com/a?=b");
});

test("token-only wrappers are reported but not changed", () => {
  const r = unwrapOnce("https://protect-us.mimecast.com/s/abc?domain=example.com");
  assert.strictEqual(r.changed, false);
  assert.match(r.note, /example\.com/);
});

test("unwrapStep follows Google redirects only when asked", () => {
  const href = "https://www.google.com/url?q=https://example.com/";
  assert.strictEqual(unwrapStep(href, false).changed, false);
  assert.strictEqual(unwrapStep(href, true).url, "https://example.com/");
});

test("plain links are untouched", () => {
  assert.strictEqual(unwrapOnce("https://example.com/").changed, false);
});

test("unwrapAll peels nested wrappers down to the destination", () => {
  const dest = "https://dest.example/p?q=%2F1";
  const pp = "https://urldefense.proofpoint.com/v2/url?u=" + dest.replace(/-/g, "-2D").replace(/%/g, "-25").replace(/\//g, "_").replace(/:/g, "-3A").replace(/\?/g, "-3F").replace(/=/g, "-3D") + "&d=x";
  const google = "https://www.google.com/url?q=" + encodeURIComponent(pp);
  const sl = "https://eur01.safelinks.protection.outlook.com/?url=" + encodeURIComponent(google) + "&data=x";
  const r = require("../unwrap.js").unwrapAll(sl);
  assert.strictEqual(r.url, dest);
  assert.deepStrictEqual(r.layers, ["Microsoft Safe Links", "Google /url redirect", "Proofpoint URL Defense"]);
});

test("unwrapAll stops at token-only wrappers and explains why", () => {
  const sl = "https://nam10.safelinks.protection.outlook.com/?url=" + encodeURIComponent("https://protect-us.mimecast.com/s/abc?domain=t.example");
  const r = require("../unwrap.js").unwrapAll(sl);
  assert.strictEqual(r.url, "https://protect-us.mimecast.com/s/abc?domain=t.example");
  assert.match(r.note, /Mimecast/);
});
