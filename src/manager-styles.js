'use strict';

// ---------------------------------------------------------------------------
// getManagerPageStyles — Catppuccin Latte theme
// ---------------------------------------------------------------------------
function getManagerPageStyles() {
  return `
/* Catppuccin Latte */
:root {
  --ctp-base: #eff1f5;
  --ctp-mantle: #e6e9ef;
  --ctp-crust: #dce0e8;
  --ctp-surface0: #ccd0da;
  --ctp-surface1: #bcc0cc;
  --ctp-surface2: #acb0be;
  --ctp-overlay0: #9ca0b0;
  --ctp-overlay1: #8c8fa1;
  --ctp-overlay2: #7c7f93;
  --ctp-subtext0: #6c6f85;
  --ctp-subtext1: #5c5f77;
  --ctp-text: #4c4f69;
  --ctp-lavender: #7287fd;
  --ctp-blue: #1e66f5;
  --ctp-sapphire: #209fb5;
  --ctp-sky: #04a5e5;
  --ctp-teal: #179299;
  --ctp-green: #40a02b;
  --ctp-yellow: #df8e1d;
  --ctp-peach: #fe640b;
  --ctp-maroon: #e64553;
  --ctp-red: #d20f39;
  --ctp-mauve: #8839ef;
  --ctp-pink: #ea76cb;
  --ctp-flamingo: #dd7878;
  --ctp-rosewater: #dc8a78;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  background: var(--ctp-base);
  color: var(--ctp-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
a { color: var(--ctp-blue); text-decoration: none; }
a:hover { text-decoration: underline; }
button {
  background: var(--ctp-surface0);
  color: var(--ctp-text);
  border: 1px solid var(--ctp-surface1);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
button:hover { background: var(--ctp-surface1); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
input, select, textarea {
  background: var(--ctp-surface0);
  color: var(--ctp-text);
  border: 1px solid var(--ctp-surface1);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--ctp-blue);
  box-shadow: 0 0 0 2px rgba(137, 180, 250, 0.2);
}
label { font-size: 13px; color: var(--ctp-subtext0); }
/* Toolbar */
.toolbar {
  background: var(--ctp-mantle);
  border-bottom: 1px solid var(--ctp-surface0);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.toolbar h1 { font-size: 18px; font-weight: 700; color: var(--ctp-mauve); margin-right: 8px; }
.toolbar .status { font-size: 12px; color: var(--ctp-subtext0); }
.spacer { flex: 1; }
/* Tab bar */
.tabbar {
  background: var(--ctp-crust);
  border-bottom: 1px solid var(--ctp-surface0);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  overflow-x: auto;
  flex-shrink: 0;
}
.tab {
  padding: 8px 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  color: var(--ctp-subtext0);
  white-space: nowrap;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tab.active {
  color: var(--ctp-mauve);
  border-bottom-color: var(--ctp-mauve);
}
.tab:hover { color: var(--ctp-text); }
.tab .close-btn {
  color: var(--ctp-overlay0);
  font-size: 11px;
  cursor: pointer;
  padding: 1px 3px;
  border-radius: 3px;
}
.tab .close-btn:hover { background: var(--ctp-surface1); color: var(--ctp-red); }
/* Main layout */
.main-area {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}
.panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 180px;
}
.panel-schedules { flex: 0 0 50%; }
.panel-sessions { flex: 1; }
.resizer {
  width: 6px;
  background: var(--ctp-surface0);
  cursor: col-resize;
  flex-shrink: 0;
  border-left: 1px solid var(--ctp-surface1);
  border-right: 1px solid var(--ctp-surface1);
}
.resizer:hover, .resizer.dragging { background: var(--ctp-blue); }
.home-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--ctp-mantle);
  border-bottom: 1px solid var(--ctp-surface0);
  flex-shrink: 0;
}
.panel-header {
  padding: 10px 14px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ctp-subtext0);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--ctp-surface0);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.panel-content { flex: 1; overflow-y: auto; }
/* Schedule table */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  background: var(--ctp-crust);
  color: var(--ctp-subtext0);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--ctp-surface0);
  white-space: nowrap;
}
td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--ctp-surface0);
  vertical-align: middle;
}
tr:hover td { background: rgba(255,255,255,0.03); }
.sched-name { font-weight: 500; color: var(--ctp-text); cursor: pointer; }
.sched-name:hover { color: var(--ctp-blue); }
.sched-prompt { color: var(--ctp-subtext0); font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.sched-prompt:hover { color: var(--ctp-text); }
.sched-agent { font-size: 11px; color: var(--ctp-mauve); }
.next-run-urgent { color: var(--ctp-red); font-weight: 600; }
.next-run-soon { color: var(--ctp-peach); font-weight: 500; }
.next-run-near { color: var(--ctp-yellow); }
.next-run-ok { color: var(--ctp-text); }
.next-run-far { color: var(--ctp-subtext0); }
.last-run-fail { color: var(--ctp-red); }
.view-toggle { padding: 3px 8px; font-size:12px; }
.view-toggle.active { background: var(--ctp-mauve); color: var(--ctp-base); border-color: var(--ctp-mauve); }
.cal-grid { display:grid; grid-template-columns: repeat(7,1fr); gap:6px; padding:12px; min-height:200px; }
.cal-day { background:var(--ctp-crust); border-radius:8px; padding:8px; min-height:120px; }
.cal-day-hdr { font-size:11px; color:var(--ctp-subtext0); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.04em; }
.cal-day-hdr .cal-date { font-size:16px; font-weight:600; color:var(--ctp-text); display:block; }
.cal-day.today { border:1px solid var(--ctp-mauve); }
.cal-day.today .cal-date { color:var(--ctp-mauve); }
.cal-chip { font-size:11px; padding:3px 7px; border-radius:5px; margin-bottom:4px; cursor:pointer;
  background:var(--ctp-surface0); color:var(--ctp-text); border:1px solid var(--ctp-surface1);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
.cal-chip:hover { background:var(--ctp-surface1); }
.cal-chip.chip-disabled { opacity:0.4; }
.cal-chip.chip-failed { border-color:var(--ctp-red); color:var(--ctp-red); }
.cal-chip.chip-running { border-color:var(--ctp-green); color:var(--ctp-green); }
.cal-chip-time { font-size:10px; color:var(--ctp-subtext0); margin-right:4px; }
#calendarFullView { display:none; flex:1; flex-direction:column; overflow:hidden; min-height:0; }
#calendarFullView .cal5w-wrap { flex:1; overflow:auto; }
.cal5w-wrap { padding:12px; overflow-x:auto; }
.cal5w-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; min-width:560px; }
.cal5w-dow { font-size:10px; font-weight:600; color:var(--ctp-subtext0); text-align:center; text-transform:uppercase; letter-spacing:0.05em; padding:4px 0; }
.cal5w-cell { background:var(--ctp-crust); border-radius:6px; padding:5px 6px; min-height:72px; border:1px solid transparent; }
.cal5w-cell.today { border-color:var(--ctp-mauve); }
.cal5w-cell.past .cal5w-date { opacity:0.55; }
.cal5w-date { font-size:11px; font-weight:600; color:var(--ctp-subtext1); margin-bottom:4px; }
.cal5w-date-link { cursor:pointer; }
.cal5w-date-link:hover { color:var(--ctp-blue); text-decoration:underline; opacity:1 !important; }
.cal5w-cell.today .cal5w-date { color:var(--ctp-mauve); }
.cal5w-month { font-size:9px; color:var(--ctp-overlay0); font-weight:400; }
.cal5w-more { font-size:10px; color:var(--ctp-overlay1); display:block; margin-top:2px; }
.cal5w-more-btn { cursor:pointer; color:var(--ctp-blue); }
.cal5w-more-btn:hover { color:var(--ctp-mauve); text-decoration:underline; }
.cal5w-cell .cal-chip { font-size:10px; padding:2px 5px; margin-bottom:3px; }
.cal5w-nav {
  display:flex; align-items:center; gap:6px; padding:8px 12px 6px;
  flex-shrink:0; position:sticky; top:0;
  background:var(--ctp-base); z-index:10;
  border-bottom:1px solid var(--ctp-surface0);
}
.cal5w-nav button { padding:3px 8px; font-size:12px; }
.cal5w-nav-label { flex:1; text-align:center; font-size:13px; font-weight:600; color:var(--ctp-text); }
.cal5w-today-btn { margin-left:4px; }
.cal5w-empty { text-align:center; color:var(--ctp-subtext0); padding:48px 20px; font-size:13px; }
.chip-past { border-color:var(--ctp-overlay0); color:var(--ctp-subtext1); }
.badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}
.badge-schedule { background: var(--ctp-surface1); color: var(--ctp-yellow); }
.badge-spawn { background: var(--ctp-surface1); color: var(--ctp-peach); }
.badge-browser { background: var(--ctp-surface1); color: var(--ctp-blue); }
.badge-enabled { background: rgba(64, 160, 43, 0.12); color: var(--ctp-green); }
.badge-disabled { background: rgba(108, 112, 134, 0.15); color: var(--ctp-overlay1); }
/* Filter banner */
.filter-banner {
  display: none;
  background: rgba(30, 102, 245, 0.08);
  border-bottom: 1px solid var(--ctp-blue);
  padding: 6px 14px;
  font-size: 13px;
  color: var(--ctp-blue);
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.filter-banner.visible { display: flex; }
/* Auto-cleanup note */
.cleanup-note {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--ctp-overlay0);
  border-top: 1px solid var(--ctp-surface0);
  flex-shrink: 0;
}
/* Session rows */
.sessions-grid {
  display: grid;
  grid-template-columns: 3em 7em 3em 1fr 6em 4em;
  gap: 0;
}
.sessions-grid .row { display: contents; }
.sessions-grid .row > * {
  padding: 7px 8px;
  border-bottom: 1px solid var(--ctp-surface0);
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.sessions-grid .row:hover > * { background: rgba(0,0,0,0.03); }
.section-header {
  grid-column: 1 / -1;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ctp-subtext0);
  background: var(--ctp-crust);
  border-bottom: 1px solid var(--ctp-surface0);
}
.section-header.active { color: var(--ctp-green); background: rgba(64,160,43,0.07); }
.section-header.completed { color: var(--ctp-subtext0); }
.preview-row {
  grid-column: 1 / -1;
  background: var(--ctp-crust);
  border-bottom: 1px solid var(--ctp-surface0);
  padding: 8px 12px;
  display: none;
}
.preview-row pre {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--ctp-subtext0);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
/* Footer */
.footer {
  background: var(--ctp-mantle);
  border-top: 1px solid var(--ctp-surface0);
  padding: 7px 16px;
  font-size: 12px;
  color: var(--ctp-subtext0);
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}
/* Modal */
.modal-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  align-items: center;
  justify-content: center;
}
.modal-backdrop.open { display: flex; }
.modal {
  background: var(--ctp-mantle);
  border: 1px solid var(--ctp-surface1);
  border-radius: 12px;
  padding: 24px;
  width: min(600px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal h2 { font-size: 16px; color: var(--ctp-mauve); }
.form-group { display: flex; flex-direction: column; gap: 5px; }
.form-group textarea { resize: vertical; min-height: 80px; }
.form-row { display: flex; gap: 10px; }
.form-row .form-group { flex: 1; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.btn-primary { background: var(--ctp-mauve); color: var(--ctp-base); border-color: var(--ctp-mauve); font-weight: 600; }
.btn-primary:hover { background: var(--ctp-lavender); border-color: var(--ctp-lavender); }
.btn-danger { background: transparent; color: var(--ctp-red); border-color: var(--ctp-red); }
.btn-danger:hover { background: rgba(243,139,168,0.1); }
.feedback-history-item { padding: 8px; background: var(--ctp-surface0); border-radius: 6px; margin-bottom: 6px; font-size: 12px; color: var(--ctp-subtext0); }
/* Tab content panels */
.tab-content { display: none; flex: 1; overflow: hidden; }
.tab-content.active { display: flex; flex-direction: column; }
/* Session iframe panel */
.session-frame-panel { flex-direction: column; }
.session-frame-panel iframe { flex: 1; border: none; background: var(--ctp-base); }
/* Batch bar */
.batch-bar {
  display: none;
  background: var(--ctp-surface0);
  border-bottom: 1px solid var(--ctp-surface1);
  padding: 7px 14px;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  flex-shrink: 0;
}
.batch-bar.visible { display: flex; }
/* Tooltip */
.log-tooltip {
  position: fixed;
  background: var(--ctp-crust);
  border: 1px solid var(--ctp-surface1);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: 'SF Mono', monospace;
  font-size: 12px;
  color: var(--ctp-text);
  max-width: 500px;
  white-space: pre-wrap;
  word-break: break-word;
  z-index: 9999;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
/* Type toggle */
.type-toggle {
  display: flex;
  background: var(--ctp-surface0);
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
}
.type-toggle button {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--ctp-subtext0);
  padding: 5px 12px;
  border-radius: 6px;
}
.type-toggle button.active {
  background: var(--ctp-mauve);
  color: var(--ctp-base);
}
/* Checkbox */
input[type=checkbox] { width: 15px; height: 15px; cursor: pointer; }
/* Countdown chip */
.countdown { font-size: 11px; font-weight: 500; }
`;
}

module.exports = { getManagerPageStyles };
