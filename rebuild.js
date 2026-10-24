// Reads an Outlook .msg (also one saved as .eml, or damaged by a line-ending conversion)
// chosen by the analyst, rebuilds it as an .eml with msg.js and opens it in Thunderbird.
// Every value shown comes from the file, so it is written with textContent only.
const input = document.getElementById("file");
const drop = document.getElementById("drop");
const statusEl = document.getElementById("status");
const result = document.getElementById("result");
const save = document.getElementById("save");
let rebuilt = null;

function status(text, error) {
  statusEl.textContent = text;
  statusEl.className = error ? "error" : "";
}

// A token only this add-on knows marks its rebuilt messages, so a header copied into
// another email cannot pass for one.
async function token() {
  const st = await messenger.storage.local.get("rebuildToken");
  if (st.rebuildToken) return st.rebuildToken;
  const t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  await messenger.storage.local.set({ rebuildToken: t });
  return t;
}

async function open() {
  if (rebuilt) await messenger.messageDisplay.open({ file: rebuilt, location: "tab" });
}

async function handle(file) {
  if (!file) return;
  result.hidden = true;
  status("Reading " + file.name + "…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!PeelMsg.isMsg(bytes)) {
      status("“" + file.name + "” is not an Outlook .msg file: open it in Thunderbird as usual.", true);
      return;
    }
    const r = PeelMsg.read(bytes);
    if (!r.ok) {
      status("“" + file.name + "” could not be read: " + r.error + ".", true);
      return;
    }
    const m = r.message;
    const eml = PeelMsg.toEml(m, { token: await token(), note: m.note });
    const name = file.name.replace(/\.(msg|eml)$/i, "") + " (rebuilt).eml";
    rebuilt = new File([eml], name, { type: "message/rfc822" });
    document.getElementById("r-subject").textContent = m.subject || "(no subject)";
    document.getElementById("r-from").textContent = m.from || "(unknown sender)";
    document.getElementById("r-atts").textContent = (m.attachments || []).map((a) => a.name).join(", ") || "none";
    document.getElementById("note").textContent = m.note || "";
    if (save.href) URL.revokeObjectURL(save.href);
    save.href = URL.createObjectURL(rebuilt);
    save.download = name;
    result.hidden = false;
    status("Rebuilt. Opening it in a new tab…");
    await open();
    status("Opened in a new tab.");
  } catch (e) {
    status("Something went wrong: " + String((e && e.message) || e).slice(0, 160), true);
  }
}

document.getElementById("pick").addEventListener("click", () => input.click());
input.addEventListener("change", () => handle(input.files[0]));
document.getElementById("reopen").addEventListener("click", () => open().catch((e) => status(String(e), true)));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  handle(e.dataTransfer.files[0]);
});
