'use strict';

const { escHtml, shortenPath } = require('./shared');

// ---------------------------------------------------------------------------
// renderToolbar
// ---------------------------------------------------------------------------
function renderToolbar() {
  return `
<div class="toolbar">
  <h1>🦀 YellyClaw</h1>
  <span class="status" id="serverStatus">⏳ Connecting…</span>
  <span class="spacer"></span>
  <button id="healthBtn" onclick="checkHealth()" title="Check server health">💚 Health</button>
  <button id="updateBtn" onclick="handleUpdate()" title="git pull + restart">⬆️ Update</button>
  <button onclick="openFeedbackDialog()" title="Give feedback to improve YellyClaw">💬 Feedback</button>
  <button id="stopBtn" onclick="handleStop()" title="Stop server" style="color:var(--ctp-red)">⏹ Stop</button>
</div>`;
}

// ---------------------------------------------------------------------------
// renderTabs
// ---------------------------------------------------------------------------
function renderTabs() {
  return `
<div class="tabbar" id="tabbar">
  <div class="tab active" id="tab-home" onclick="switchTab('home')">🏠 Home</div>
  <!-- Session tabs inserted dynamically -->
</div>`;
}

// ---------------------------------------------------------------------------
// renderFeedbackPanel
// ---------------------------------------------------------------------------
function renderFeedbackPanel() {
  return `
<div class="modal-backdrop" id="feedbackModal" onclick="if(event.target===this)closeFeedbackDialog()">
  <div class="modal">
    <h2>💬 Feedback</h2>
    <p style="font-size:13px;color:var(--ctp-subtext0);">Describe an improvement and YellyClaw will implement it autonomously.</p>
    <div class="form-group">
      <textarea id="feedbackTextarea" placeholder="e.g. Add a dark/light theme toggle to the UI" rows="5"></textarea>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn-primary" onclick="submitFeedback()">🚀 Submit</button>
      <button onclick="clearFeedbackText()">✕ Clear</button>
      <span id="feedbackStatus" style="font-size:13px;color:var(--ctp-subtext0);"></span>
    </div>
    <div id="feedbackHistoryList" style="margin-top:16px;"></div>
    <div class="modal-actions">
      <button onclick="closeFeedbackDialog()">Close</button>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// renderManagerFooter
// ---------------------------------------------------------------------------
function renderManagerFooter(PORT, CLAUDE_BIN, WORK_DIR, SCHEDULE_FILE) {
  return `
<div class="footer">
  <span>localhost:${escHtml(String(PORT))}</span>
  <span>·</span>
  <span>${escHtml(CLAUDE_BIN || 'claude-code')}</span>
  <span>·</span>
  <a href="#" onclick="openFolder('${escHtml(SCHEDULE_FILE)}');return false;" title="${escHtml(SCHEDULE_FILE)}">📅 ${escHtml(shortenPath(SCHEDULE_FILE))}</a>
  <span>·</span>
  <a href="#" onclick="openFolder('${escHtml(WORK_DIR)}');return false;" title="${escHtml(WORK_DIR)}">📁 ${escHtml(shortenPath(WORK_DIR))}</a>
</div>`;
}

module.exports = { renderToolbar, renderTabs, renderFeedbackPanel, renderManagerFooter };
