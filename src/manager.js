'use strict';

const { getManagerPageStyles } = require('./manager-styles');
const { renderToolbar, renderTabs, renderFeedbackPanel, renderManagerFooter } = require('./manager-fragments');
const { buildManagerScript } = require('./manager-client');

// ---------------------------------------------------------------------------
// serverManagerPage — assembles the full manager HTML page
// ---------------------------------------------------------------------------
function serverManagerPage(PORT, CLAUDE_BIN, WORK_DIR, SCHEDULE_FILE) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>YellyClaw</title>
<style>${getManagerPageStyles()}</style>
</head>
<body>
${renderToolbar()}
${renderTabs()}

<!-- Home tab -->
<div class="tab-content active" id="panel-home">
  <!-- View toggle bar at top -->
  <div class="home-topbar">
    <div style="display:flex;gap:4px;">
      <button id="viewListBtn" class="view-toggle active" onclick="setScheduleView('list')" title="Table view">☰ Table</button>
      <button id="viewCalBtn" class="view-toggle" onclick="setScheduleView('cal')" title="Calendar view">📅 Calendar</button>
    </div>
    <input id="quickAddInput" type="text" placeholder="e.g. check my GitHub issues every day at 9am" style="flex:1;min-width:0;" onkeydown="if(event.key==='Enter')quickAddSchedule()">
    <button id="quickAddBtn" onclick="quickAddSchedule()">⚡ Add with AI</button>
    <button onclick="openScheduleModal(null)">➕ Manual</button>
    <span id="scheduleCount" style="font-size:11px;color:var(--ctp-overlay1);white-space:nowrap;"></span>
  </div>
  <!-- Table/list view -->
  <div class="main-area" id="mainArea">
    <div class="panel panel-schedules" id="panelSchedules">
      <!-- Batch bar -->
      <div class="batch-bar" id="batchBar">
        <span id="batchCount">0 selected</span>
        <button class="btn-danger" onclick="batchDeleteSchedules()">🗑 Delete Selected</button>
        <button onclick="clearBatchSelection()">✕ Cancel</button>
      </div>
      <div class="panel-content" id="scheduleTableWrapper">
        <table id="scheduleTable">
          <thead>
            <tr>
              <th><input type="checkbox" id="selectAllChk" onchange="toggleSelectAll(this.checked)" title="Select all"></th>
              <th>✏️</th>
              <th>Name / Agent / Tools</th>
              <th>Prompt</th>
              <th>Freq</th>
              <th>⚡</th>
              <th>Next Run</th>
              <th>Last Run</th>
              <th>Count</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="scheduleTableBody">
            <tr><td colspan="10" style="text-align:center;color:var(--ctp-subtext0);padding:20px;">Loading schedules…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Resizer -->
    <div class="resizer" id="resizer"></div>

    <!-- Sessions panel -->
    <div class="panel panel-sessions" id="panelSessions">
      <div class="panel-header">
        🖥️ Sessions
        <span class="spacer"></span>
        <span id="sessionCount" style="font-size:11px;"></span>
      </div>
      <div class="filter-banner" id="filterBanner">
        <span id="filterLabel"></span>
        <span class="spacer"></span>
        <button onclick="clearFilter()" style="font-size:11px;padding:2px 8px;">✕ Clear filter</button>
      </div>
      <div class="panel-content" id="sessionsContent">
        <div class="sessions-grid" id="sessionsGrid">
          <div style="grid-column:1/-1;text-align:center;color:var(--ctp-subtext0);padding:20px;">Loading sessions…</div>
        </div>
        <div class="cleanup-note">Active sessions idle for 30 min are killed. Completed sessions kept 7 days.</div>
      </div>
    </div>
  </div>
  <!-- Calendar view (sibling of mainArea, shown when toggled) -->
  <div id="calendarFullView">
    <div id="scheduleCalendarView" class="cal5w-wrap"></div>
  </div>
</div>

${renderFeedbackPanel()}

<!-- Schedule Modal -->
<div class="modal-backdrop" id="scheduleModal">
  <div class="modal">
    <h2 id="scheduleModalTitle">➕ New Schedule</h2>
    <div style="display:flex;gap:8px;margin-bottom:4px;">
      <div class="type-toggle" id="typeToggle">
        <button id="typeOnce" onclick="setScheduleType('once')">🕐 One-time</button>
        <button id="typeRepeated" class="active" onclick="setScheduleType('repeated')">🔁 Repeated</button>
      </div>
    </div>
    <div class="form-group">
      <label>Prompt *</label>
      <textarea id="schedPrompt" rows="4" placeholder="What should the agent do?"></textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Name (auto-filled)</label>
        <input id="schedName" type="text" maxlength="40" placeholder="Auto from prompt">
      </div>
      <div class="form-group">
        <label>Agent</label>
        <input id="schedAgent" type="text" list="agentsList" placeholder="yellyrock-default">
        <datalist id="agentsList"></datalist>
      </div>
    </div>
    <div class="form-row" id="repeatOptions">
      <div class="form-group">
        <label>Frequency</label>
        <select id="schedInterval">
          <option value="30m">Every 30 minutes</option>
          <option value="1h">Every hour</option>
          <option value="6h">Every 6 hours</option>
          <option value="12h">Every 12 hours</option>
          <option value="1d" selected>Every day</option>
          <option value="1w">Every week</option>
        </select>
      </div>
      <div class="form-group">
        <label>First Run At</label>
        <input id="schedNextRun" type="datetime-local">
      </div>
    </div>
    <div class="form-group" id="onceOptions" style="display:none;">
      <label>Run At (leave empty to run immediately)</label>
      <input id="schedOnceAt" type="datetime-local">
    </div>
    <div class="form-group">
      <label>Additional Tools</label>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <label><input type="checkbox" name="tool" value="Bash"> Bash</label>
        <label><input type="checkbox" name="tool" value="browser"> browser</label>
        <label><input type="checkbox" name="tool" value="web_search"> web_search</label>
        <label><input type="checkbox" name="tool" value="*"> all (*)</label>
      </div>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="schedAutoPause" checked> Pause on failure</label>
    </div>
    <div class="modal-actions">
      <button id="schedToggleBtn" style="display:none;" onclick="toggleScheduleEnabledFromModal()">▶ Enable</button>
      <button id="schedDeleteBtn" style="color:var(--ctp-red);display:none;" onclick="confirmDeleteScheduleFromModal()">🗑 Delete</button>
      <span style="flex:1"></span>
      <button onclick="closeScheduleModal()">Cancel</button>
      <button class="btn-primary" onclick="saveSchedule()">💾 Save</button>
    </div>
  </div>
</div>

${renderManagerFooter(PORT, CLAUDE_BIN, WORK_DIR, SCHEDULE_FILE)}

<div id="logTooltip" class="log-tooltip" style="display:none;"></div>

<script>
${buildManagerScript()}
</script>
</body>
</html>`;
}

module.exports = { serverManagerPage };
