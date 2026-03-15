'use strict';

const os = require('os');

// ---------------------------------------------------------------------------
// XSS-safe HTML escaping
// ---------------------------------------------------------------------------
function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Replace home dir with ~
// ---------------------------------------------------------------------------
function shortenPath(p) {
  if (!p) return '';
  const home = os.homedir();
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

// ---------------------------------------------------------------------------
// Source badge pill
// ---------------------------------------------------------------------------
function renderSourceBadge(source) {
  if (source === 'schedule') {
    return `<span class="badge badge-schedule">⏰ schedule</span>`;
  } else if (source === 'spawn') {
    return `<span class="badge badge-spawn">🌱 spawned</span>`;
  } else {
    return `<span class="badge badge-browser">🌐 browser</span>`;
  }
}

// ---------------------------------------------------------------------------
// Light theme CSS for session pages
// ---------------------------------------------------------------------------
function getSessionPageStyles() {
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
body {
  background: var(--ctp-base);
  color: var(--ctp-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
a { color: var(--ctp-blue); text-decoration: none; }
a:hover { text-decoration: underline; }
button {
  background: var(--ctp-surface0);
  color: var(--ctp-text);
  border: 1px solid var(--ctp-surface1);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
button:hover { background: var(--ctp-surface1); }
.toolbar {
  background: var(--ctp-mantle);
  border-bottom: 1px solid var(--ctp-surface0);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar h1 { font-size: 16px; font-weight: 600; color: var(--ctp-mauve); }
.toolbar .spacer { flex: 1; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}
.badge-schedule { background: var(--ctp-surface1); color: var(--ctp-yellow); }
.badge-spawn { background: var(--ctp-surface1); color: var(--ctp-peach); }
.badge-browser { background: var(--ctp-surface1); color: var(--ctp-blue); }
.status-running { color: var(--ctp-yellow); }
.status-ok { color: var(--ctp-green); }
.status-fail { color: var(--ctp-red); }
.status-killed { color: var(--ctp-maroon); }
.session-body {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}
.prompt-panel {
  background: var(--ctp-mantle);
  border-right: 1px solid var(--ctp-surface0);
  padding: 12px 16px;
  width: 340px;
  min-width: 200px;
  max-width: 40%;
  overflow-y: auto;
  flex-shrink: 0;
}
.prompt-panel h3 { font-size: 13px; color: var(--ctp-subtext0); margin-bottom: 6px; }
.prompt-text {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  color: var(--ctp-text);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
}
.output-panel {
  flex: 1;
  padding: 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
pre#out {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--ctp-crust);
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--ctp-surface0);
  flex: 1;
  min-height: 200px;
  color: var(--ctp-text);
}
.footer {
  background: var(--ctp-mantle);
  border-top: 1px solid var(--ctp-surface0);
  padding: 8px 16px;
  font-size: 12px;
  color: var(--ctp-subtext0);
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.error-report {
  border: 1px solid var(--ctp-red);
  border-radius: 8px;
  padding: 12px;
  background: rgba(243, 139, 168, 0.08);
}
.error-report h3 { color: var(--ctp-red); margin-bottom: 8px; font-size: 14px; }
.error-report p { margin-bottom: 6px; font-size: 13px; }
.error-report strong { color: var(--ctp-maroon); }
`;
}

// ---------------------------------------------------------------------------
// Prompt panel HTML
// ---------------------------------------------------------------------------
function renderPromptPanel(prompt, agent, repo) {
  return `
<div class="prompt-panel">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
    <h3 style="margin:0;">📝 Prompt</h3>
    <button onclick="navigator.clipboard.writeText(document.getElementById('promptText').innerText)" style="font-size:11px;padding:2px 7px;">📋 Copy</button>
    <button id="copyClaudeCodeBtn" style="font-size:11px;padding:2px 7px;">📋 claude-code</button>
    ${agent ? `<span style="font-size:12px;color:var(--ctp-mauve);">🤖 ${escHtml(agent)}</span>` : ''}
    ${repo ? `<span style="font-size:12px;color:var(--ctp-subtext0);">📦 ${escHtml(repo)}</span>` : ''}
  </div>
  <pre id="promptText" class="prompt-text">${escHtml(prompt || '')}</pre>
</div>`;
}

// ---------------------------------------------------------------------------
// Footer for session pages
// ---------------------------------------------------------------------------
function renderFooter(PORT, opts) {
  const workDir = opts && opts.workDir ? shortenPath(opts.workDir) : '';
  return `
<div class="footer">
  <span>localhost:${escHtml(String(PORT))}</span>
  ${workDir ? `<span>📁 Session: <a href="#" onclick="openFolder('${escHtml(opts.workDir)}');return false;" title="${escHtml(opts.workDir)}">${escHtml(workDir)}</a></span>` : ''}
</div>`;
}

// ---------------------------------------------------------------------------
// Open folder script
// ---------------------------------------------------------------------------
function renderOpenFolderScript() {
  return `
<script>
function openFolder(p) {
  fetch('/open-folder', {
    method: 'POST',
    headers: {'Content-Type':'application/json', 'X-YellyClaw-Token': window._ycToken || ''},
    body: JSON.stringify({path: p})
  });
}
// Fetch token on load
fetch('/token').then(r=>r.json()).then(d=>{ window._ycToken = d.token; });
// Hide footer when embedded in manager iframe
if (window.parent !== window) { var _f = document.querySelector('.footer'); if (_f) _f.style.display = 'none'; }
</script>`;
}

// ---------------------------------------------------------------------------
// Copy as claude-code CLI command (browser-side JS string)
// ---------------------------------------------------------------------------
const COPY_BASH_SCRIPT = `
<script>
document.getElementById('copyClaudeCodeBtn') && document.getElementById('copyClaudeCodeBtn').addEventListener('click', function() {
  var prompt = document.getElementById('promptText') ? document.getElementById('promptText').innerText : '';
  var agentEl = document.querySelector('[data-agent]');
  var agent = agentEl ? agentEl.dataset.agent : '';
  var cmd = 'claude-code chat --no-interactive';
  if (agent) cmd += ' --agent ' + agent;
  cmd += " '" + prompt.replace(/'/g, "'\\''") + "'";
  navigator.clipboard.writeText(cmd).then(function() {
    document.getElementById('copyClaudeCodeBtn').textContent = '✅ Copied!';
    setTimeout(function(){ document.getElementById('copyClaudeCodeBtn').textContent = '📋 claude-code'; }, 2000);
  });
});
</script>`;

// ---------------------------------------------------------------------------
// Full session page HTML shell
// ---------------------------------------------------------------------------
function renderSessionPage(opts) {
  const {
    title = 'Session',
    toolbarHtml = '',
    bodyHtml = '',
    extraScripts = '',
    PORT = 2026,
  } = opts;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>${getSessionPageStyles()}</style>
</head>
<body>
${toolbarHtml}
${bodyHtml}
${renderOpenFolderScript()}
${COPY_BASH_SCRIPT}
${extraScripts}
</body>
</html>`;
}

module.exports = {
  escHtml,
  shortenPath,
  renderSourceBadge,
  renderSessionPage,
  getSessionPageStyles,
  renderPromptPanel,
  renderFooter,
  renderOpenFolderScript,
  COPY_BASH_SCRIPT,
};
