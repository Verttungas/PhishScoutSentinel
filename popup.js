const src = document.getElementById("src");
const meta = document.getElementById("meta");
const chain = document.getElementById("chain");
const copyBtn = document.getElementById("copy");
const status = document.getElementById("status");
const DEFAULT_HINT = meta.textContent;
let destination = "";

function step(label, url, final) {
  const li = document.createElement("li");
  if (final) li.className = "final";
  const l = document.createElement("span");
  l.className = "step-label";
  l.textContent = label;
  const u = document.createElement("span");
  u.className = "url";
  u.textContent = url;
  li.appendChild(l);
  li.appendChild(u);
  chain.appendChild(li);
}

// Peel one layer at a time so every intermediate URL is visible.
function run() {
  const href = src.value.trim();
  chain.textContent = "";
  status.textContent = "";
  destination = "";
  copyBtn.disabled = true;
  chain.hidden = true;
  if (!href) {
    meta.textContent = DEFAULT_HINT;
    return;
  }
  let cur = href;
  let stopNote = "";
  const layers = [];
  for (let i = 0; i < 6; i++) {
    const s = WrapperUnwrap.unwrapStep(cur, true);
    if (!s.changed) {
      if (s.vendor) stopNote = s.vendor + ": " + (s.note || "cannot be decoded offline.");
      break;
    }
    layers.push({ vendor: s.vendor, url: cur });
    cur = s.url;
  }
  if (!layers.length) {
    meta.textContent = stopNote || "No known wrapper on this link.";
    return;
  }
  meta.textContent = layers.length + (layers.length === 1 ? " layer" : " layers") + " removed." + (stopNote ? " Stopped at " + stopNote : "");
  for (const l of layers) step(l.vendor, l.url, false);
  step("Destination", cur, true);
  chain.hidden = false;
  destination = cur;
  copyBtn.disabled = false;
}

src.addEventListener("input", run);
copyBtn.addEventListener("click", async () => {
  if (!destination) return;
  try {
    await navigator.clipboard.writeText(destination);
    status.textContent = "Copied";
  } catch (_) {
    status.textContent = "Copy failed; select the URL above instead";
  }
  setTimeout(() => { status.textContent = ""; }, 1800);
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

// Team settings: simulation domains (with their source) and organisation domains.
// Kept in this profile's local storage; the background reads them for every message.
const sim = document.getElementById("sim");
const org = document.getElementById("org");
const settingsState = document.getElementById("settings-state");
let saveTimer = 0;
async function loadSettings() {
  try {
    const st = await messenger.storage.local.get(["simulationDomainsText", "orgDomainsText"]);
    sim.value = st.simulationDomainsText || "";
    org.value = st.orgDomainsText || "";
  } catch (_) {}
}
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await messenger.storage.local.set({ simulationDomainsText: sim.value, orgDomainsText: org.value });
      settingsState.textContent = "Saved. Reopen a message to apply.";
    } catch (_) {
      settingsState.textContent = "Could not save.";
    }
  }, 400);
}
sim.addEventListener("input", saveSettings);
org.addEventListener("input", saveSettings);
loadSettings();

document.getElementById("outlook").addEventListener("click", async () => {
  await messenger.tabs.create({ url: messenger.runtime.getURL("rebuild.html") });
  window.close();
});
