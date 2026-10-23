/** Styles for the PeelScout sidebar (rendered in its own shadow root). */
globalThis.PeelSidebarCss = `
:host { all: initial; position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483645; width: var(--peel-width, 380px); }
:host([collapsed]) { width: 30px; }
* { box-sizing: border-box; }
.sb { position: absolute; inset: 0; display: flex; font: 13px/1.4 sans-serif; color: #1c2430; background: #f5f6f8; border-left: 1px solid #c9ced6; box-shadow: -4px 0 14px rgba(0, 0, 0, 0.12); }
.sb-resize { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 2; }
.sb-rail { display: none; width: 30px; flex: none; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0; background: #1c2430; color: #fff; cursor: pointer; border: 0; font: inherit; }
.sb-rail-label { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: 700; letter-spacing: 0.04em; font-size: 12px; }
:host([collapsed]) .sb-rail { display: flex; }
:host([collapsed]) .sb-main, :host([collapsed]) .sb-resize { display: none; }
.sb-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sb-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #1c2430; color: #fff; }
.sb-title { font-weight: 700; }
.sb-badges { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.sb-badge { font-size: 11px; border-radius: 10px; padding: 1px 7px; background: #3a4656; color: #fff; white-space: nowrap; }
.sb-badge-strong { background: #c62828; }
.sb-collapse { flex: none; background: transparent; color: #fff; border: 1px solid #56657a; border-radius: 4px; cursor: pointer; padding: 0 7px; font: 14px/20px sans-serif; }
.sb-rail .sb-badge { padding: 1px 5px; }
.sb-body { flex: 1; overflow: auto; padding: 10px; }
.sb-empty { color: #5c6774; padding: 6px 2px; }
button { font: 12px sans-serif; }
a { color: #0b57d0; }
#wrapper-nested-eml .nest-img-photo { max-width: 100%; }
#wrapper-img-attachments .att-thumb { width: calc(50% - 5px); }
#wrapper-signals .sig-chip-sublime { background: #e3ecfa; color: #17407a; }
#wrapper-signals .sig-hint { color: #5c6774; font-size: 12px; margin: 1px 0 0; }
#wrapper-signals .sig-sev-critical, #wrapper-signals .sig-sev-high { background: #c62828; color: #fff; }
#wrapper-signals .sig-sev-medium { background: #ef8f00; color: #fff; }
#wrapper-signals .sig-sev-low { background: #d8dde3; color: #33404d; }
#wrapper-ics-banner,
#wrapper-img-attachments,
#wrapper-qr-banner {
  font: 13px/1.4 sans-serif; background: #fff6d8; color: #1c2430;
  border: 1px solid #e0c36a; border-radius: 6px; padding: 10px 12px; margin: 0 0 12px;
}
#wrapper-ics-banner .ics-title,
#wrapper-img-attachments .ics-title,
#wrapper-qr-banner .ics-title { font-weight: 700; margin-bottom: 6px; }
#wrapper-ics-banner .ics-row { margin: 8px 0 0; word-break: break-all; }
#wrapper-ics-banner .ics-meta { color: #5c6774; font-size: 12px; }
#wrapper-ics-banner .ics-aws { background: #fde8e8; padding: 6px; border-radius: 4px; }
#wrapper-nested-eml {
  font: 13px/1.45 sans-serif; color: #1c2430; margin: 0 0 12px;
}
#wrapper-nested-eml .nest-block {
  background: #e8f4ec; border: 1px solid #8fbf9a; border-radius: 6px;
  padding: 10px 12px; margin: 0 0 10px;
}
#wrapper-nested-eml .nest-title { font-weight: 700; color: #0f6b4c; }
#wrapper-nested-eml .nest-who { color: #5c6774; font-size: 12px; margin: 2px 0 8px; }
#wrapper-nested-eml .nest-inner {
  background: #fffcf7; border: 1px dashed #8fbf9a; border-radius: 6px; padding: 8px;
}
#wrapper-nested-eml .nest-inner.nest-tight {
  background: transparent; border: 0; padding: 0;
}
#wrapper-nested-eml .nest-frame {
  width: 100%; border: 0;
}
#wrapper-nested-eml .nest-media { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
#wrapper-nested-eml .nest-img {
  border: 1px solid #1c2430; background: #fff; cursor: zoom-in; height: auto;
}
#wrapper-nested-eml .nest-img-photo {
  max-width: min(560px, 100%); width: auto; max-height: 360px; object-fit: contain;
}
#wrapper-nested-eml .nest-img-qr {
  max-width: 168px; max-height: 168px; width: auto;
}
#wrapper-nested-eml .nest-img-only { margin-top: 0; }
#wrapper-unwrap-panel.wup-zoom {
  align-items: center; justify-content: center; padding: 12px;
}
#wrapper-unwrap-panel .wup-zoom-card {
  background: #111; color: #fff; width: min(96vw, 1200px); max-width: 96vw;
  border-radius: 8px; padding: 10px;
}
#wrapper-unwrap-panel .wup-zoom-bar {
  display: flex; justify-content: space-between; gap: 12px; margin: 0 2px 8px; font-size: 12px; color: #c9d1d9;
  word-break: break-all;
}
/* Fixed-size card so the buttons stay put while moving between images. */
#wrapper-unwrap-panel.wup-zoom .wup-zoom-card {
  display: flex; flex-direction: column; height: 90vh; box-sizing: border-box;
}
#wrapper-unwrap-panel .wup-zoom-stage {
  flex: 1; min-height: 0; overflow: auto; display: flex;
}
#wrapper-unwrap-panel .wup-zoom-stage img {
  display: block; margin: auto; max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;
}
#wrapper-unwrap-panel .wup-zoom-stage.wup-actual img {
  max-width: none; max-height: none; cursor: zoom-out;
}
#wrapper-unwrap-panel .wup-zoom-card .wup-actions { justify-content: center; }
#wrapper-nested-eml .nest-qr-box,
#wrapper-qr-banner .nest-qr,
#wrapper-img-attachments .nest-qr,
#wrapper-nested-eml .nest-phone-box {
  margin-top: 8px;
}
#wrapper-nested-eml .nest-qr,
#wrapper-qr-banner .nest-qr,
#wrapper-img-attachments .nest-qr,
#wrapper-nested-eml .nest-phone {
  background: #f8dcdc; border: 1px solid #d9a0a0; border-radius: 4px; padding: 8px 10px;
  word-break: break-all;
}
#wrapper-nested-eml .nest-qr-lbl,
#wrapper-qr-banner .nest-qr-lbl,
#wrapper-img-attachments .nest-qr-lbl,
#wrapper-nested-eml .nest-phone-lbl { font-size: 12px; color: #5c6774; margin-bottom: 4px; }
#wrapper-nested-eml .nest-phone-num { font: 15px/1.4 monospace; color: #1c2430; }
#wrapper-nested-eml a, #wrapper-qr-banner a, #wrapper-img-attachments a { color: #0b57d0; }
#wrapper-unwrap-panel {
  position: fixed; inset: 0; z-index: 2147483646; background: rgba(16, 22, 30, 0.45);
  display: flex; align-items: flex-start; justify-content: center; padding: 24px 16px;
  font: 13px/1.4 sans-serif;
}
#wrapper-unwrap-panel .wup-card {
  background: #fff; color: #1c2430; width: min(560px, 100%); border-radius: 8px;
  padding: 14px 16px 16px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
}
#wrapper-unwrap-panel h3 { margin: 0 0 4px; font-size: 15px; }
#wrapper-unwrap-panel .wup-vendor { margin: 0 0 10px; color: #5c6774; }
#wrapper-unwrap-panel label { display: block; font-weight: 700; margin: 8px 0 4px; }
#wrapper-unwrap-panel textarea { width: 100%; min-height: 64px; font: 11px/1.35 monospace; box-sizing: border-box; }
#wrapper-unwrap-panel .wup-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
#wrapper-unwrap-panel .wup-steps { margin: 0 0 8px 18px; padding: 0; color: #5c6774; }
#wrapper-img-attachments { background: #eef3fb; border-color: #9db4d8; }
#wrapper-img-attachments .att-grid { display: flex; flex-wrap: wrap; gap: 10px; }
#wrapper-img-attachments .att-thumb {
  display: flex; flex-direction: column; width: 150px; padding: 4px; margin: 0;
  background: #fff; border: 1px solid #9db4d8; border-radius: 6px; cursor: zoom-in; font: inherit; color: inherit;
}
#wrapper-img-attachments .att-thumb:hover, #wrapper-img-attachments .att-thumb:focus-visible {
  border-color: #0b57d0; box-shadow: 0 0 0 2px rgba(11, 87, 208, 0.25); outline: none;
}
#wrapper-img-attachments .att-thumb img {
  width: 100%; height: 110px; object-fit: cover; border-radius: 4px; background: #f4f1ea;
}
#wrapper-img-attachments .att-cap {
  margin-top: 4px; font-size: 11px; color: #5c6774; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#wrapper-signals {
  font: 13px/1.4 sans-serif; background: #f3f0fa; color: #1c2430;
  border: 1px solid #b9a8dc; border-radius: 6px; padding: 10px 12px; margin: 0 0 12px;
}
#wrapper-signals .sig-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 6px; }
#wrapper-signals .ics-title { font-weight: 700; }
#wrapper-signals .sig-disclaimer { color: #5c6774; font-size: 12px; }
#wrapper-signals .sig-layer { background: #fff; border: 1px solid #d8cfee; border-radius: 6px; padding: 6px 10px; margin: 6px 0 0; }
#wrapper-signals .sig-layer > summary { cursor: pointer; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
#wrapper-signals .sig-layer-name { font-weight: 700; margin-right: 4px; word-break: break-word; }
#wrapper-signals .sig-chip { font-size: 11px; background: #ece7f7; border-radius: 10px; padding: 1px 8px; color: #3d2e66; }
#wrapper-signals .sig-chip-strong { background: #f8dcdc; color: #7a1f1f; }
#wrapper-signals .sig-chip-none { background: #eef1f4; color: #5c6774; }
#wrapper-signals .sig-route, #wrapper-signals .sig-section { margin: 8px 0 0; }
#wrapper-signals .sig-route-name, #wrapper-signals .sig-sub { font-weight: 700; color: #3d2e66; }
#wrapper-signals .sig-count { font-weight: 400; color: #5c6774; font-size: 12px; margin-left: 6px; }
#wrapper-signals ul { margin: 4px 0 0 18px; padding: 0; }
#wrapper-signals li { margin: 2px 0; word-break: break-word; }
#wrapper-signals code { font: 11px/1.35 monospace; background: #f4f1ea; padding: 0 3px; border-radius: 3px; word-break: break-all; }
#wrapper-signals .sig-str { display: inline-block; font-size: 10px; text-transform: uppercase; border-radius: 3px; padding: 0 4px; }
#wrapper-signals .sig-strong { background: #c62828; color: #fff; }
#wrapper-signals .sig-weak { background: #d8dde3; color: #33404d; }
#wrapper-signals .sig-note { margin: 6px 0 0; color: #5c4a00; background: #fff6d8; border-radius: 4px; padding: 4px 6px; }
#wrapper-signals .sig-none { margin: 4px 0 0; color: #5c6774; }
#wrapper-signals .sig-iocs { border-collapse: collapse; margin-top: 4px; width: 100%; font-size: 12px; }
#wrapper-signals .sig-iocs th, #wrapper-signals .sig-iocs td { border: 1px solid #d8cfee; padding: 3px 6px; text-align: left; vertical-align: top; }
#wrapper-signals .sig-iocs th { background: #f3f0fa; }
#wrapper-signals .wup-actions { margin-top: 8px; }
`;
