const src = document.getElementById("src");
const out = document.getElementById("out");
const meta = document.getElementById("meta");
function run() {
  const href = src.value.trim();
  if (!href) { out.textContent = "\u2014"; return; }
  const r = WrapperUnwrap.unwrapAll(href);
  if (r.changed) {
    meta.textContent = "Removed: " + r.vendor + (r.note ? " (stopped at " + r.note + ")" : "");
    out.textContent = r.url;
  } else if (r.note) {
    meta.textContent = r.note;
    out.textContent = r.url;
  } else {
    meta.textContent = "No known security wrapper.";
    out.textContent = href;
  }
}
document.getElementById("go").addEventListener("click", run);
src.addEventListener("input", run);
document.getElementById("copy").addEventListener("click", async () => {
  const t = out.textContent;
  if (t && t !== "\u2014") await navigator.clipboard.writeText(t);
});

const rdap = document.getElementById("rdap");
const rdapState = document.getElementById("rdap-state");
const RDAP_ORIGINS = { origins: ["https://*/*"] };
async function showRdapState() {
  try {
    const { rdapEnabled } = await messenger.storage.local.get("rdapEnabled");
    const granted = await messenger.permissions.contains(RDAP_ORIGINS);
    rdap.checked = !!rdapEnabled;
    rdapState.textContent = rdapEnabled && !granted ? "Permission pending: accept it in Thunderbird's main window." : "";
  } catch (_) {}
}
showRdapState();
rdap.addEventListener("change", async function () {
  if (rdap.checked) {
    // Save the choice first: Thunderbird closes this popup when its permission
    // prompt opens, so nothing after request() is guaranteed to run here.
    await messenger.storage.local.set({ rdapEnabled: true });
    rdapState.textContent = "Accept the permission in Thunderbird's main window.";
    try { await messenger.permissions.request(RDAP_ORIGINS); } catch (_) {}
    showRdapState();
  } else {
    await messenger.storage.local.set({ rdapEnabled: false });
    try { await messenger.permissions.remove(RDAP_ORIGINS); } catch (_) {}
    showRdapState();
  }
});
