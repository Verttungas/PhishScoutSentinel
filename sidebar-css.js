/** Styles for the PeelScout sidebar (rendered in its own shadow root). */
globalThis.PeelSidebarCss = `
:host {
  all: initial;
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483645;
  width: var(--peel-width, 380px);
  --canvas: #f2f3f5; --surface: #ffffff; --raised: #f7f8fa;
  --ink: #1d2329; --muted: #5e6873; --rule: #d5d9de; --rule-soft: #e6e9ed;
  --strong: #b3261e; --strong-bg: #fbe9e7; --caution: #8a5a00; --caution-bg: #fff4d6;
  --accent: #1f5fbf; --accent-ink: #ffffff; --sublime: #5b4bc4; --sublime-bg: #eeebfb;
  --ok: #2d7d46; --code-bg: #eef0f3; --shadow: 0 10px 30px rgba(15, 20, 28, 0.22);
  --head: #1d2329; --head-ink: #f2f3f5; --focus: #1f5fbf;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :host {
    --canvas: #17191c; --surface: #202328; --raised: #262a30;
    --ink: #e4e7eb; --muted: #9aa4af; --rule: #353a41; --rule-soft: #2c3036;
    --strong: #ff8a7a; --strong-bg: #3a2220; --caution: #e3b341; --caution-bg: #3a3020;
    --accent: #8ab4f8; --accent-ink: #10213d; --sublime: #b3a7ff; --sublime-bg: #2b2747;
    --ok: #7bc88f; --code-bg: #2b2f35; --shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    --head: #0f1113; --head-ink: #e4e7eb; --focus: #8ab4f8;
    color-scheme: dark;
  }
}
:host([collapsed]) { width: 32px; }
* { box-sizing: border-box; }
button, input, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 3px; }
a { color: var(--accent); text-underline-offset: 2px; }
code, .mono { font-family: var(--mono); font-size: 11.5px; }
@media (prefers-reduced-motion: no-preference) {
  .sb-tab, .btn, .ev-value, .copy { transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
}

/* Frame */
.sb { position: absolute; inset: 0; display: flex; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif; color: var(--ink); background: var(--canvas); border-left: 1px solid var(--rule); }
.sb-resize { position: absolute; left: -3px; top: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 3; }
.sb-resize:hover, .sb-resize:focus-visible { background: var(--accent); opacity: 0.5; outline: none; }
.sb-rail { display: none; width: 32px; flex: none; flex-direction: column; align-items: center; gap: 10px; padding: 10px 0; background: var(--head); color: var(--head-ink); cursor: pointer; border: 0; }
.sb-rail-label { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: 600; font-size: 12px; letter-spacing: 0.02em; }
.sb-rail-count { min-width: 20px; padding: 1px 4px; border-radius: 10px; background: var(--strong); color: #fff; font-size: 11px; font-weight: 700; text-align: center; }
.sb-rail-count:empty { display: none; }
:host([collapsed]) .sb-rail { display: flex; }
:host([collapsed]) .sb-main, :host([collapsed]) .sb-resize { display: none; }
.sb-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sb-head { flex: none; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 8px 0 12px; background: var(--head); color: var(--head-ink); }
.sb-title { font-weight: 650; font-size: 14px; }
.sb-status { flex: 1; min-width: 0; font-size: 12px; color: #aeb7c2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-btn { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.icon-btn:hover { border-color: rgba(255, 255, 255, 0.25); }
.icon-btn svg { width: 16px; height: 16px; }
.sb-scroll { flex: 1; overflow: auto; scrollbar-gutter: stable; }

/* Overview: which routes the evidence points to */
.ov { padding: 12px 12px 10px; background: var(--surface); border-bottom: 1px solid var(--rule); }
.ov-layers { display: flex; gap: 0; margin: 0 0 10px; border: 1px solid var(--rule); border-radius: 7px; overflow: hidden; }
.ov-layer { flex: 1; min-width: 0; padding: 5px 8px; border: 0; background: transparent; font-size: 12px; color: var(--muted); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-layer + .ov-layer { border-left: 1px solid var(--rule); }
.ov-layer[aria-pressed="true"] { background: var(--raised); color: var(--ink); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
.ov-heading { margin: 0 0 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
.ov-routes { list-style: none; margin: 0; padding: 0; }
.ov-route { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 10px; padding: 5px 0; border-top: 1px solid var(--rule-soft); }
.ov-route:first-child { border-top: 0; }
.ov-route-name { font-weight: 600; min-width: 0; }
.ov-route-family { display: block; font-weight: 400; font-size: 11.5px; color: var(--muted); }
.ov-route-meter { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.meter { display: inline-flex; gap: 3px; }
.meter i { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--rule); }
.meter i.on { background: var(--strong); border-color: var(--strong); }
.meter i.half { background: linear-gradient(90deg, var(--caution) 50%, transparent 50%); border-color: var(--caution); }
.ov-none { margin: 2px 0 0; color: var(--muted); }
.ov-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.ov-meta { font-size: 11.5px; color: var(--muted); }
.callout { margin: 0 0 10px; padding: 7px 9px; border-left: 3px solid var(--caution); background: var(--caution-bg); border-radius: 0 5px 5px 0; font-size: 12px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); cursor: pointer; font-size: 12px; }
.btn:hover { border-color: var(--muted); }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
.btn-primary:hover { filter: brightness(1.08); border-color: var(--accent); }

/* Tabs */
.sb-tabs { position: sticky; top: 0; z-index: 2; display: flex; padding: 0 8px; background: var(--surface); border-bottom: 1px solid var(--rule); }
.sb-tab { position: relative; padding: 9px 9px 8px; border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 12.5px; font-weight: 500; }
.sb-tab[aria-selected="true"] { color: var(--ink); font-weight: 650; }
.sb-tab[aria-selected="true"]::after { content: ""; position: absolute; left: 6px; right: 6px; bottom: -1px; height: 2px; background: var(--accent); border-radius: 2px; }
.sb-tab-count { margin-left: 4px; padding: 0 5px; border-radius: 8px; background: var(--code-bg); font-size: 11px; color: var(--muted); }
.sb-tab-count:empty { display: none; }
.sb-panel { padding: 10px 12px 24px; }
.sb-panel[hidden] { display: none; }
.empty { color: var(--muted); padding: 6px 0; margin: 0; }

/* Evidence */
.group { margin: 0 0 12px; }
.group > summary { list-style: none; display: flex; align-items: baseline; gap: 6px; cursor: pointer; padding: 4px 0; }
.group > summary::-webkit-details-marker { display: none; }
.group > summary::before { content: ""; width: 0; height: 0; border-left: 5px solid var(--muted); border-top: 4px solid transparent; border-bottom: 4px solid transparent; transform: translateY(-1px); }
.group[open] > summary::before { transform: rotate(90deg) translateX(-1px); }
.group-title { font-weight: 650; font-size: 13px; }
.group-count { font-size: 11.5px; color: var(--muted); }
.list { list-style: none; margin: 4px 0 0; padding: 0; }
.item { position: relative; padding: 6px 0 6px 12px; border-top: 1px solid var(--rule-soft); }
.item:first-child { border-top: 0; }
.item::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--rule); }
.item.strong::before { background: var(--strong); }
.item.weak::before { background: var(--caution); }
.item.sev-high::before, .item.sev-critical::before { background: var(--strong); }
.item.sev-medium::before { background: var(--caution); }
.item.sev-low::before { background: var(--rule); }
.item.done::before { background: var(--ok); }
.item-label { display: block; }
.item-sub { display: block; margin-top: 2px; font-size: 11.5px; color: var(--muted); }
.strength { font-size: 11px; font-weight: 600; margin-right: 4px; }
.item.strong .strength { color: var(--strong); }
.item.weak .strength { color: var(--caution); }
.value { display: block; width: 100%; margin-top: 3px; padding: 3px 6px; border: 1px solid transparent; border-radius: 4px; background: var(--code-bg); font-family: var(--mono); font-size: 11.5px; text-align: left; color: var(--ink); cursor: copy; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.value:hover { border-color: var(--rule); }
.value.expanded { -webkit-line-clamp: unset; }
.rule-link { font-weight: 600; }
.sev { font-size: 11px; font-weight: 600; margin-right: 4px; color: var(--muted); }
.item.sev-high .sev, .item.sev-critical .sev { color: var(--strong); }
.item.sev-medium .sev { color: var(--caution); }

/* Indicators */
.ind-row { display: grid; grid-template-columns: 1fr auto; gap: 6px; align-items: start; }
.ind-type { font-size: 11.5px; color: var(--muted); }
.copy { flex: none; padding: 2px 7px; border: 1px solid var(--rule); border-radius: 5px; background: var(--surface); font-size: 11.5px; cursor: pointer; }
.copy:hover { border-color: var(--muted); }
.copy.done { color: var(--ok); border-color: var(--ok); }
.flags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.flag { font-size: 11px; padding: 0 6px; border-radius: 8px; background: var(--strong-bg); color: var(--strong); }
.flag.info { background: var(--code-bg); color: var(--muted); }
.link-text { font-weight: 500; overflow-wrap: anywhere; }

/* Calendar links, QR codes */
#wrapper-ics-banner, #wrapper-qr-banner { margin: 0 0 12px; }
.ics-title { font-weight: 650; font-size: 13px; margin: 0 0 4px; }
.ics-row { padding: 6px 0 6px 12px; position: relative; border-top: 1px solid var(--rule-soft); overflow-wrap: anywhere; }
.ics-row::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--rule); }
.ics-row.ics-aws::before { background: var(--strong); }
.ics-meta { font-size: 11.5px; color: var(--muted); }
.nest-qr { padding: 6px 0 6px 12px; position: relative; border-top: 1px solid var(--rule-soft); overflow-wrap: anywhere; }
.nest-qr::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--strong); }
.nest-qr-lbl { font-size: 11.5px; color: var(--muted); }
.nest-qr a, .ics-row a { font-family: var(--mono); font-size: 11.5px; }

/* Previews: image attachments */
#wrapper-img-attachments { margin: 0 0 16px; }
.att-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 6px; }
.att-thumb { display: flex; flex-direction: column; padding: 0; margin: 0; overflow: hidden; border: 1px solid var(--rule); border-radius: 7px; background: var(--surface); cursor: zoom-in; text-align: left; }
.att-thumb:hover { border-color: var(--accent); }
.att-thumb img { display: block; width: 100%; height: 104px; object-fit: cover; background: repeating-conic-gradient(var(--code-bg) 0 25%, var(--surface) 0 50%) 0 0 / 14px 14px; }
.att-cap { padding: 4px 7px 5px; font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#wrapper-img-attachments .nest-qr-box, #wrapper-img-attachments > div:last-child { margin-top: 6px; }

/* Previews: attached messages, shown like small messages */
#wrapper-nested-eml { margin: 0 0 12px; }
.nest-block { margin: 0 0 12px; border: 1px solid var(--rule); border-radius: 8px; background: var(--surface); overflow: hidden; }
.nest-title { padding: 7px 10px 0; font-weight: 650; }
.nest-who { padding: 1px 10px 8px; font-size: 11.5px; color: var(--muted); border-bottom: 1px solid var(--rule-soft); overflow-wrap: anywhere; }
.nest-inner { padding: 8px 10px 10px; }
.nest-inner.nest-tight { padding-top: 10px; }
.nest-frame { width: 100%; border: 1px solid var(--rule-soft); border-radius: 6px; overflow: hidden; }
.nest-media { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.nest-img { border: 1px solid var(--rule); border-radius: 6px; background: #fff; cursor: zoom-in; height: auto; }
.nest-img-photo { max-width: 100%; max-height: 300px; object-fit: contain; }
.nest-img-qr { max-width: 140px; max-height: 140px; }
.nest-img-only { margin-top: 0; }
.nest-qr-box, .nest-phone-box { margin-top: 8px; }
.nest-phone { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 8px; padding: 6px 0 6px 12px; position: relative; border-top: 1px solid var(--rule-soft); }
.nest-phone::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--caution); }
.nest-phone-lbl { grid-column: 1 / -1; font-size: 11.5px; color: var(--muted); }
.nest-phone-num { font-family: var(--mono); font-size: 13px; }
.nest-phone button { padding: 2px 7px; border: 1px solid var(--rule); border-radius: 5px; background: var(--surface); font-size: 11.5px; cursor: pointer; }

/* Overlays: original wrapper, keep unwrapping, image viewer */
#wrapper-unwrap-panel { position: fixed; inset: 0; z-index: 10; display: flex; align-items: flex-start; justify-content: center; padding: 32px 16px; background: rgba(10, 14, 20, 0.55); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); }
#wrapper-unwrap-panel .wup-card { width: min(560px, 100%); padding: 16px 18px 18px; border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); }
#wrapper-unwrap-panel h3 { margin: 0 0 2px; font-size: 15px; font-weight: 650; }
#wrapper-unwrap-panel .wup-vendor { margin: 0 0 12px; color: var(--muted); }
#wrapper-unwrap-panel label { display: block; margin: 10px 0 4px; font-size: 12px; font-weight: 600; color: var(--muted); }
#wrapper-unwrap-panel textarea { width: 100%; min-height: 64px; padding: 6px 8px; border: 1px solid var(--rule); border-radius: 6px; background: var(--code-bg); font: 11.5px/1.4 var(--mono); resize: vertical; }
#wrapper-unwrap-panel .wup-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
#wrapper-unwrap-panel .wup-actions button { padding: 5px 10px; border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); cursor: pointer; font-size: 12px; }
#wrapper-unwrap-panel .wup-actions button:first-child { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
#wrapper-unwrap-panel .wup-steps { margin: 0 0 8px 18px; padding: 0; color: var(--muted); }
#wrapper-unwrap-panel.wup-zoom { align-items: center; padding: 16px; }
#wrapper-unwrap-panel .wup-zoom-card { display: flex; flex-direction: column; width: min(96vw, 1200px); height: 92vh; padding: 10px; border-radius: 10px; background: #111418; color: #e4e7eb; box-shadow: var(--shadow); }
#wrapper-unwrap-panel .wup-zoom-bar { display: flex; justify-content: space-between; gap: 12px; margin: 0 2px 8px; font-size: 12px; color: #aeb7c2; overflow-wrap: anywhere; }
#wrapper-unwrap-panel .wup-zoom-stage { flex: 1; min-height: 0; overflow: auto; display: flex; }
#wrapper-unwrap-panel .wup-zoom-stage img { display: block; margin: auto; max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; }
#wrapper-unwrap-panel .wup-zoom-stage.wup-actual img { max-width: none; max-height: none; cursor: zoom-out; }
#wrapper-unwrap-panel .wup-zoom-card .wup-actions { justify-content: center; }
#wrapper-unwrap-panel .wup-zoom-card .wup-actions button { background: #262a30; border-color: #3a4048; color: #e4e7eb; }
#wrapper-unwrap-panel .wup-zoom-card .wup-actions button:first-child { background: #262a30; border-color: #3a4048; color: #e4e7eb; font-weight: 400; }
`;
