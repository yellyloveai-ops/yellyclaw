'use strict';

const { QUICK_ADD_SCHEDULE_SCRIPT, LOG_TAIL_TOOLTIP_SCRIPT } = require('./manager-scripts');

// ---------------------------------------------------------------------------
// buildManagerScript — returns the full browser-side <script> block content
// ---------------------------------------------------------------------------
function buildManagerScript() {
  return `
var _ycToken = null;
var _schedules = [];
var _activeSessions = [];
var _histSessions = [];
var _lastSchedData = null;
var _lastSessionData = null;
var _filterScheduleId = null;
var _filterScheduleName = null;
var _editingScheduleId = null;
var _scheduleType = 'repeated';
var _selectedSchedules = new Set();

// Load token on startup
fetch('/token').then(r=>r.json()).then(d=>{ _ycToken = d.token; });

// Load agents for datalist
fetch('/agents').then(r=>r.ok?r.json():null).then(function(d) {
  if (!d || !d.agents) return;
  var dl = document.getElementById('agentsList');
  if (!dl) return;
  d.agents.forEach(function(a) {
    var opt = document.createElement('option');
    opt.value = a.name;
    dl.appendChild(opt);
  });
}).catch(function(){});

// Tab switching
function switchTab(id) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(el) { el.classList.remove('active'); });
  var panel = document.getElementById('panel-' + id);
  var tab = document.getElementById('tab-' + id);
  if (panel) panel.classList.add('active');
  if (tab) tab.classList.add('active');
}

function openTab(id) { switchTab(id); }

function openSessionTab(sessionId) {
  // Add or activate a session iframe tab
  var tabId = 'session-' + sessionId;
  var existingTab = document.getElementById('tab-' + tabId);
  if (!existingTab) {
    var tab = document.createElement('div');
    tab.className = 'tab';
    tab.id = 'tab-' + tabId;
    tab.innerHTML = '📄 #' + sessionId + ' <span class="close-btn" onclick="closeSessionTab(\\''+tabId+'\\');event.stopPropagation()">✕</span>';
    tab.onclick = function() { switchTab(tabId); };
    document.getElementById('tabbar').appendChild(tab);

    var panel = document.createElement('div');
    panel.className = 'tab-content session-frame-panel';
    panel.id = 'panel-' + tabId;
    panel.innerHTML = '<iframe src="/sessions/' + sessionId + '/logs" id="frame-' + tabId + '"></iframe>';
    var homePanel = document.getElementById('panel-home');
    homePanel.parentNode.insertBefore(panel, homePanel.nextSibling);
  }
  switchTab(tabId);
}

function closeSessionTab(tabId) {
  var tab = document.getElementById('tab-' + tabId);
  var panel = document.getElementById('panel-' + tabId);
  if (tab) tab.remove();
  if (panel) panel.remove();
  switchTab('home');
}

// Health check
function checkHealth() {
  fetch('/health').then(r=>r.json()).then(function(d) {
    document.getElementById('serverStatus').textContent = '💚 ' + d.sessions + ' sessions';
  }).catch(function() {
    document.getElementById('serverStatus').textContent = '❌ Unreachable';
  });
}

// Update
function handleUpdate() {
  if (!confirm('Pull latest code and restart server?')) return;
  fetch('/update', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({})
  }).then(r=>r.json()).then(function(d) {
    if (d.restarting) {
      document.getElementById('serverStatus').textContent = '🔄 Restarting…';
      var check = setInterval(function() {
        fetch('/health').then(r=>r.json()).then(function() {
          clearInterval(check);
          location.reload();
        }).catch(function(){});
      }, 1000);
    } else {
      alert(d.message || 'Already up to date');
    }
  }).catch(function(e){ alert('Update failed: ' + e.message); });
}

// Stop
function handleStop() {
  if (!confirm('Stop the YellyClaw server?')) return;
  fetch('/stop', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({})
  }).then(function() {
    document.getElementById('serverStatus').textContent = '⏹ Stopped';
  }).catch(function(){});
}

// Open folder
function openFolder(p) {
  if (!p || !_ycToken) return;
  fetch('/open-folder', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({path: p})
  });
}

// --- Schedules ---
function loadSchedules() {
  fetch('/schedules').then(r=>r.json()).then(function(d) {
    var newData = JSON.stringify(d.schedules);
    if (newData === _lastSchedData) return;
    _lastSchedData = newData;
    _schedules = d.schedules || [];
    renderScheduleTable();
    if (_schedViewMode === 'cal') renderScheduleCalendar();
    document.getElementById('scheduleCount').textContent = _schedules.length + ' total';
  }).catch(function(){});
}

function renderScheduleTable() {
  var tbody = document.getElementById('scheduleTableBody');
  var scheds = _schedules.slice().sort(function(a, b) {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (a.nextRunAt || 0) - (b.nextRunAt || 0);
  });
  if (!scheds.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--ctp-subtext0);padding:20px;">No schedules yet. Use Quick Add or ➕ Manual to create one.</td></tr>';
    return;
  }
  var html = '';
  var now = Date.now();
  scheds.forEach(function(s) {
    var nextRunText = '';
    var nextRunClass = 'next-run-far';
    if (s.enabled && s.nextRunAt) {
      var diff = s.nextRunAt - now;
      if (diff <= 0) { nextRunText = 'Now'; nextRunClass = 'next-run-urgent'; }
      else if (diff <= 2*60*1000) { nextRunText = Math.ceil(diff/1000) + 's'; nextRunClass = 'next-run-urgent'; }
      else if (diff <= 15*60*1000) { nextRunText = Math.ceil(diff/60000) + 'm'; nextRunClass = 'next-run-soon'; }
      else if (diff <= 60*60*1000) { nextRunText = Math.ceil(diff/60000) + 'm'; nextRunClass = 'next-run-near'; }
      else if (diff <= 6*60*60*1000) { nextRunText = Math.ceil(diff/3600000) + 'h'; nextRunClass = 'next-run-ok'; }
      else { nextRunText = new Date(s.nextRunAt).toLocaleDateString(); nextRunClass = 'next-run-far'; }
    } else if (!s.enabled) {
      nextRunText = '—';
    }

    var lastRunText = s.lastRunAt ? relativeTime(s.lastRunAt) : '—';
    var lastRunClass = s.lastRunFailed ? 'last-run-fail' : '';
    var lastRunLink = s.lastRunSessionId ? '<a href="#" onclick="openSessionTab(' + s.lastRunSessionId + ');return false;" class="' + lastRunClass + '">' + lastRunText + '</a>' : '<span class="' + lastRunClass + '">' + lastRunText + '</span>';
    if (s.currentRunSessionId) lastRunLink = '🔄 <a href="#" onclick="openSessionTab(' + s.currentRunSessionId + ');return false;">Running</a>';

    var cooldownLeft = s.cooldownMs ? Math.max(0, s.cooldownMs - now) : 0;
    var runBtnDisabled = cooldownLeft > 0 ? 'disabled title="Cooldown: ' + Math.ceil(cooldownLeft/1000) + 's"' : '';
    var checked = _selectedSchedules.has(s.id) ? 'checked' : '';

    var toolsStr = (s.allowTools || []).join(', ') || '';
    html += '<tr id="sched-row-' + escHtmlJs(s.id) + '">';
    html += '<td><input type="checkbox" ' + checked + ' onchange="toggleScheduleSelect(\\''+escHtmlJs(s.id)+'\\',this.checked)"></td>';
    html += '<td><button onclick="openScheduleModal(\\''+escHtmlJs(s.id)+'\\')">✏️</button></td>';
    html += '<td><span class="sched-name" onclick="openScheduleModal(\\''+escHtmlJs(s.id)+'\\')">'+escHtmlJs(s.name)+'</span>'
      + (s.agentSpec ? '<br><span class="sched-agent">🤖 '+escHtmlJs(s.agentSpec)+'</span>' : '')
      + (toolsStr ? '<br><span style="font-size:10px;color:var(--ctp-overlay1);">🔧 '+escHtmlJs(toolsStr)+'</span>' : '')
      + '</td>';
    html += '<td><span class="sched-prompt" onclick="showFilteredSessions(\\''+escHtmlJs(s.id)+'\\',\\''+escHtmlJs(s.name)+'\\')" title="'+escHtmlJs((s.prompt||'').slice(0,300))+'">'+escHtmlJs((s.prompt||'').slice(0,60))+'</span></td>';
    html += '<td style="font-size:12px;color:var(--ctp-subtext0);">'+escHtmlJs(s.interval||'')+'</td>';
    html += '<td><button ' + runBtnDisabled + ' onclick="runScheduleNow(\\''+escHtmlJs(s.id)+'\\')">⚡</button></td>';
    html += '<td class="'+nextRunClass+'">'+escHtmlJs(nextRunText)+'</td>';
    html += '<td>'+lastRunLink+'</td>';
    html += '<td><a href="#" onclick="showFilteredSessions(\\''+escHtmlJs(s.id)+'\\',\\''+escHtmlJs(s.name)+'\\')" style="font-size:12px;">'+(s.runCount||0)+'</a></td>';
    html += '<td>'
      + (s.lastRunFailed ? '<button onclick="autoFixSchedule(\\''+escHtmlJs(s.id)+'\\')">🔁</button>' : '')
      + '</td>';
    html += '</tr>';
  });
  tbody.innerHTML = html;
}

var _schedViewMode = 'list';
function setScheduleView(mode) {
  _schedViewMode = mode;
  document.getElementById('mainArea').style.display = mode === 'list' ? '' : 'none';
  document.getElementById('calendarFullView').style.display = mode === 'cal' ? 'flex' : 'none';
  document.getElementById('viewListBtn').classList.toggle('active', mode === 'list');
  document.getElementById('viewCalBtn').classList.toggle('active', mode === 'cal');
  if (mode === 'cal') renderScheduleCalendar();
}

function renderScheduleCalendar() {
  var container = document.getElementById('scheduleCalendarView');
  var now = Date.now();
  var today = new Date(); today.setHours(0,0,0,0); var todayTs = today.getTime();

  // Anchor: Sunday 5 weeks ago → 10 weeks total (past 5 left, future 5 right)
  var anchor = new Date(today);
  anchor.setDate(today.getDate() - today.getDay() - 35);
  var windowStart = anchor.getTime();
  var totalDays = 70;
  var windowEnd = windowStart + totalDays * 86400000;

  // Day buckets: { past: [sessions], future: [schedule occurrences] }
  var days = [];
  for (var i = 0; i < totalDays; i++) days.push({ past: [], future: [] });

  // Past: real session runs in window (schedule-sourced only)
  var allSessions = _histSessions.concat(_activeSessions);
  allSessions.forEach(function(sess) {
    if (sess.source !== 'schedule' && !sess.scheduleId) return;
    var t = sess.startedAt;
    if (!t || t < windowStart || t >= windowEnd) return;
    var dayIdx = Math.floor((t - windowStart) / 86400000);
    days[dayIdx].past.push(sess);
  });

  // Future: projected schedule runs from today onwards
  _schedules.forEach(function(s) {
    if (!s.nextRunAt) return;
    var t = s.nextRunAt;
    var iv = s.intervalMs || 0;
    if (iv > 0) { while (t < now) t += iv; }
    while (t < windowEnd) {
      if (t >= todayTs) {
        var dayIdx = Math.floor((t - windowStart) / 86400000);
        if (dayIdx >= 0 && dayIdx < totalDays) days[dayIdx].future.push({ s: s, t: t });
      }
      if (iv <= 0) break;
      t += iv;
    }
  });

  var DAY_ABBR = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var maxShow = 3;

  var html = '<div class="cal5w-grid">';
  for (var col = 0; col < 7; col++) {
    html += '<div class="cal5w-dow">' + DAY_ABBR[col] + '</div>';
  }
  for (var d = 0; d < totalDays; d++) {
    var dayTs = windowStart + d * 86400000;
    var dayDate = new Date(dayTs);
    var isToday = dayTs === todayTs;
    var isPast = dayTs < todayTs;
    html += '<div class="cal5w-cell' + (isToday ? ' today' : '') + (isPast ? ' past' : '') + '">';
    html += '<div class="cal5w-date">' + dayDate.getDate()
      + (dayDate.getDate() === 1 ? ' <span class="cal5w-month">' + MONTH_NAMES[dayDate.getMonth()] + '</span>' : '')
      + '</div>';

    var bucket = days[d];
    var allChips = bucket.past.map(function(sess) { return { type: 'past', sess: sess }; })
      .concat(bucket.future.map(function(e) { return { type: 'future', entry: e }; }));

    allChips.slice(0, maxShow).forEach(function(chip) {
      if (chip.type === 'past') {
        var sess = chip.sess;
        var icon = sess.killed ? '🔪' : sess.exitCode === 0 ? '✅' : sess.exitCode != null ? '❌' : '🔄';
        var sched = _schedules.find(function(x){ return x.id === sess.scheduleId; });
        var label = sched ? sched.name : (sess.prompt || sess.title || '#' + sess.id).slice(0, 40);
        html += '<span class="cal-chip chip-past" onclick="openSessionTab(' + sess.id + ')" title="' + escHtmlJs(label) + '">'
          + icon + ' ' + escHtmlJs(label) + '</span>';
      } else {
        var s = chip.entry.s; var t = chip.entry.t;
        var dt = new Date(t);
        var hh = String(dt.getHours()).padStart(2,'0');
        var mm = String(dt.getMinutes()).padStart(2,'0');
        var chipClass = 'cal-chip';
        if (!s.enabled) chipClass += ' chip-disabled';
        else if (s.currentRunSessionId) chipClass += ' chip-running';
        else if (s.lastRunFailed) chipClass += ' chip-failed';
        html += '<span class="' + chipClass + '" onclick="openScheduleModal(\\'' + escHtmlJs(s.id) + '\\')" title="' + escHtmlJs(s.name) + '">'
          + '<span class="cal-chip-time">' + hh + ':' + mm + '</span>' + escHtmlJs(s.name) + '</span>';
      }
    });
    if (allChips.length > maxShow) {
      html += '<span class="cal5w-more">+' + (allChips.length - maxShow) + ' more</span>';
    }
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function toggleScheduleSelect(id, checked) {
  if (checked) _selectedSchedules.add(id);
  else _selectedSchedules.delete(id);
  updateBatchBar();
}

function toggleSelectAll(checked) {
  _selectedSchedules.clear();
  if (checked) _schedules.forEach(function(s){ _selectedSchedules.add(s.id); });
  updateBatchBar();
  renderScheduleTable();
}

function updateBatchBar() {
  var bar = document.getElementById('batchBar');
  var n = _selectedSchedules.size;
  if (n > 0) { bar.classList.add('visible'); document.getElementById('batchCount').textContent = n + ' selected'; }
  else { bar.classList.remove('visible'); }
}

function clearBatchSelection() {
  _selectedSchedules.clear();
  updateBatchBar();
  document.getElementById('selectAllChk').checked = false;
  renderScheduleTable();
}

function batchDeleteSchedules() {
  if (!_selectedSchedules.size) return;
  if (!confirm('Delete ' + _selectedSchedules.size + ' schedule(s)?')) return;
  fetch('/schedules?action=batch-delete', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({ids: [..._selectedSchedules]})
  }).then(r=>r.json()).then(function() {
    clearBatchSelection();
    loadSchedules();
  });
}

function runScheduleNow(id) {
  fetch('/schedules/'+id+'/run', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({})
  }).then(r=>r.json()).then(function(d) {
    if (d.sessionId) { openSessionTab(d.sessionId); loadSchedules(); loadSessions(); }
    else if (d.error === 'cooldown') { alert(d.message || 'Please wait before triggering again'); }
  });
}

function toggleScheduleEnabled(id, enabled) {
  fetch('/schedules/'+id, {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({enabled: enabled})
  }).then(r=>r.json()).then(function() { loadSchedules(); });
}

function confirmDeleteSchedule(id) {
  var sched = _schedules.find(function(s){ return s.id === id; });
  var name = sched ? sched.name : id;
  if (sched && sched.currentRunSessionId) {
    if (!confirm('Schedule "' + name + '" has an active session. Delete anyway?')) return;
  } else {
    if (!confirm('Delete schedule "' + name + '"?')) return;
  }
  fetch('/schedules/'+id+'?action=delete', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({})
  }).then(r=>r.json()).then(function() { loadSchedules(); });
}

function autoFixSchedule(id) {
  fetch('/schedules/'+id+'/run-until-no-error', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({})
  }).then(r=>r.json()).then(function(d) {
    alert('Auto-fix loop started. Check sessions for progress.');
    loadSessions();
  });
}

// --- Schedule Modal ---
function openScheduleModal(scheduleId) {
  _editingScheduleId = scheduleId;
  var modal = document.getElementById('scheduleModal');
  document.getElementById('scheduleModalTitle').textContent = scheduleId ? '✏️ Edit Schedule' : '➕ New Schedule';

  // Reset form
  document.getElementById('schedPrompt').value = '';
  document.getElementById('schedName').value = '';
  document.getElementById('schedAgent').value = '';
  document.getElementById('schedInterval').value = '1d';
  document.getElementById('schedNextRun').value = '';
  document.getElementById('schedOnceAt').value = '';
  document.getElementById('schedAutoPause').checked = true;
  document.querySelectorAll('input[name=tool]').forEach(function(c){ c.checked = false; });
  setScheduleType('repeated');

  if (scheduleId) {
    var s = _schedules.find(function(x){ return x.id === scheduleId; });
    if (s) {
      document.getElementById('schedPrompt').value = s.prompt || '';
      document.getElementById('schedName').value = s.name || '';
      document.getElementById('schedAgent').value = s.agentSpec || '';
      document.getElementById('schedInterval').value = s.interval === 'once' ? '1d' : (s.interval || '1d');
      document.getElementById('schedAutoPause').checked = s.autoPause !== false;
      if (s.interval === 'once') setScheduleType('once');
      if (s.nextRunAt) {
        var dt = new Date(s.nextRunAt);
        document.getElementById('schedNextRun').value = dt.toISOString().slice(0,16);
      }
      (s.allowTools || []).forEach(function(t) {
        var chk = document.querySelector('input[name=tool][value="'+t+'"]');
        if (chk) chk.checked = true;
      });
    }
  }

  // Show/hide edit-only action buttons
  var toggleBtn = document.getElementById('schedToggleBtn');
  var deleteBtn = document.getElementById('schedDeleteBtn');
  if (scheduleId && s) {
    toggleBtn.style.display = '';
    toggleBtn.textContent = s.enabled ? '⏸ Pause' : '▶ Enable';
    deleteBtn.style.display = '';
  } else {
    toggleBtn.style.display = 'none';
    deleteBtn.style.display = 'none';
  }

  modal.classList.add('open');

  // Auto-fill name from prompt
  document.getElementById('schedPrompt').addEventListener('input', function() {
    if (!document.getElementById('schedName').value) {
      document.getElementById('schedName').value = this.value.slice(0, 40);
    }
  });
}

function setScheduleType(type) {
  _scheduleType = type;
  document.getElementById('typeOnce').classList.toggle('active', type === 'once');
  document.getElementById('typeRepeated').classList.toggle('active', type === 'repeated');
  document.getElementById('repeatOptions').style.display = type === 'repeated' ? '' : 'none';
  document.getElementById('onceOptions').style.display = type === 'once' ? '' : 'none';
}

function closeScheduleModal() {
  document.getElementById('scheduleModal').classList.remove('open');
  _editingScheduleId = null;
}

function confirmDeleteScheduleFromModal() {
  var id = _editingScheduleId;
  if (!id) return;
  closeScheduleModal();
  confirmDeleteSchedule(id);
}

function toggleScheduleEnabledFromModal() {
  var id = _editingScheduleId;
  if (!id) return;
  var s = _schedules.find(function(x){ return x.id === id; });
  if (!s) return;
  closeScheduleModal();
  toggleScheduleEnabled(id, !s.enabled);
}

function saveSchedule() {
  var prompt = document.getElementById('schedPrompt').value.trim();
  if (!prompt) { alert('Prompt is required'); return; }
  var name = document.getElementById('schedName').value.trim() || prompt.slice(0, 40);
  var agentSpec = document.getElementById('schedAgent').value.trim();
  var interval = _scheduleType === 'once' ? 'once' : document.getElementById('schedInterval').value;
  var autoPause = document.getElementById('schedAutoPause').checked;
  var tools = [];
  document.querySelectorAll('input[name=tool]:checked').forEach(function(c){ tools.push(c.value); });

  var nextRunAtStr = '';
  if (_scheduleType === 'once') {
    nextRunAtStr = document.getElementById('schedOnceAt').value;
  } else {
    nextRunAtStr = document.getElementById('schedNextRun').value;
  }
  var nextRunAt = nextRunAtStr ? new Date(nextRunAtStr).toISOString() : null;

  var body = { prompt, name, agentSpec, interval, autoPause, allowTools: tools };
  if (nextRunAt) body.nextRunAt = nextRunAt;

  var url = _editingScheduleId ? '/schedules/' + _editingScheduleId : '/schedules';
  fetch(url, {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify(body)
  }).then(r=>r.json()).then(function(d) {
    closeScheduleModal();
    loadSchedules();
    // If one-time with no run-at → trigger immediately
    if (_scheduleType === 'once' && !nextRunAtStr && d.schedule) {
      runScheduleNow(d.schedule.id);
    }
  }).catch(function(e){ alert('Error: ' + e.message); });
}

// --- Sessions ---
function loadSessions() {
  Promise.all([
    fetch('/sessions').then(r=>r.json()),
    fetch('/history').then(r=>r.json()),
  ]).then(function(results) {
    var active = results[0].sessions || [];
    var hist = results[1].history || [];
    var newData = JSON.stringify({active, hist});
    if (newData === _lastSessionData) return;
    _lastSessionData = newData;
    _activeSessions = active;
    _histSessions = hist;
    renderSessionsGrid();
    if (_schedViewMode === 'cal') renderScheduleCalendar();
    document.getElementById('sessionCount').textContent = active.length + ' active, ' + hist.length + ' completed';
  }).catch(function(){});
}

function renderSessionsGrid() {
  var grid = document.getElementById('sessionsGrid');
  var active = _activeSessions;
  var hist = _histSessions;

  if (_filterScheduleId) {
    active = active.filter(function(s){ return s.scheduleId === _filterScheduleId; });
    hist = hist.filter(function(s){ return s.scheduleId === _filterScheduleId; });
  }

  var html = '';
  html += '<div class="section-header active" style="display:block;">⚡ ACTIVE SESSIONS (' + active.length + ')</div>';
  if (!active.length) {
    html += '<div style="grid-column:1/-1;padding:12px 14px;font-size:13px;color:var(--ctp-subtext0);">No active sessions</div>';
  }
  active.forEach(function(s) { html += renderSessionRow(s, true); });

  html += '<div class="section-header completed" style="display:block;">🕑 COMPLETED SESSIONS (' + hist.length + ')</div>';
  if (!hist.length) {
    html += '<div style="grid-column:1/-1;padding:12px 14px;font-size:13px;color:var(--ctp-subtext0);">No completed sessions</div>';
  }
  hist.forEach(function(s) { html += renderSessionRow(s, false); });

  grid.innerHTML = html;
}

function renderSessionRow(s, isActive) {
  var badgeClass = s.source === 'schedule' ? 'badge-schedule' : s.source === 'spawn' ? 'badge-spawn' : 'badge-browser';
  var badgeIcon = s.source === 'schedule' ? '⏰' : s.source === 'spawn' ? '🌱' : '🌐';
  var rel = relativeTime(s.startedAt || s.endedAt);
  var promptText = (s.prompt || s.title || '').slice(0, 300);
  var elapsed = '';
  if (isActive && s.startedAt) {
    elapsed = '<span style="color:var(--ctp-yellow);">⏳ ' + Math.round((Date.now() - s.startedAt)/1000) + 's</span>';
  } else {
    elapsed = s.killed ? '🔪' : s.exitCode === 0 ? '✅' : s.exitCode != null ? '❌ '+s.exitCode : '';
  }
  var actions = isActive
    ? '<button style="font-size:11px;color:var(--ctp-red);" onclick="killSession(' + s.id + ')">✕ Kill</button>'
      + ' <button style="font-size:11px;" onclick="togglePreview(' + s.id + ')">▾</button>'
    : '<a href="#" onclick="openSessionTab(' + s.id + ');return false;"><button style="font-size:11px;">📄 Logs</button></a>'
      + ' <button style="font-size:11px;" onclick="togglePreview(' + s.id + ')">▾</button>';
  return '<div class="row" id="row-'+s.id+'">'
    + '<span><span class="badge '+badgeClass+'">'+badgeIcon+'</span></span>'
    + '<span style="font-size:12px;color:var(--ctp-subtext0);" title="'+new Date(s.startedAt).toLocaleString()+'">'+rel+'</span>'
    + '<span style="font-size:11px;color:var(--ctp-overlay1);">#'+s.id+'</span>'
    + '<span><a href="#" onclick="openSessionTab('+s.id+');return false;" style="color:var(--ctp-text);">'+escHtmlJs(promptText)+'</a></span>'
    + '<span onmouseenter="showLogTooltip('+s.id+',event)" onmouseleave="hideTooltip('+s.id+')" style="font-size:12px;">'+elapsed+'</span>'
    + '<span style="gap:4px;">'+actions+'</span>'
    + '</div>'
    + '<div class="preview-row" id="preview-'+s.id+'"><pre id="preview-pre-'+s.id+'">Loading…</pre></div>';
}

function togglePreview(id) {
  var el = document.getElementById('preview-'+id);
  if (!el) return;
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  fetch('/sessions/'+id+'/logs', {headers:{'Accept':'application/json'}})
    .then(r=>r.json())
    .then(function(d) {
      var lines = (d.output||'').split('\\n').filter(Boolean).slice(-15);
      document.getElementById('preview-pre-'+id).textContent = lines.join('\\n') || '(no output)';
    }).catch(function(){});
}

function killSession(id) {
  if (!confirm('Kill session #'+id+'?')) return;
  fetch('/sessions/'+id+'/kill', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({})
  }).then(r=>r.json()).then(function() { loadSessions(); });
}

function showFilteredSessions(scheduleId, name) {
  _filterScheduleId = scheduleId;
  _filterScheduleName = name;
  document.getElementById('filterLabel').textContent = 'Filtered by: ' + name;
  document.getElementById('filterBanner').classList.add('visible');
  renderSessionsGrid();
}

function clearFilter() {
  _filterScheduleId = null;
  _filterScheduleName = null;
  document.getElementById('filterBanner').classList.remove('visible');
  renderSessionsGrid();
}

// --- Feedback dialog ---
function openFeedbackDialog() {
  document.getElementById('feedbackModal').classList.add('open');
  renderFeedbackHistory();
}

function closeFeedbackDialog() {
  document.getElementById('feedbackModal').classList.remove('open');
  document.getElementById('feedbackStatus').textContent = '';
}

function submitFeedback() {
  var text = document.getElementById('feedbackTextarea').value.trim();
  if (!text) { alert('Please describe the improvement'); return; }
  var status = document.getElementById('feedbackStatus');
  status.textContent = '⏳ Starting…';
  fetch('/feedback', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-AgentRock-Token':_ycToken},
    body: JSON.stringify({prompt: text})
  }).then(r=>r.json()).then(function(d) {
    if (d.sessionId) {
      status.textContent = '✅ Session #' + d.sessionId + ' started';
      saveFeedbackHistory(text);
      closeFeedbackDialog();
      openSessionTab(d.sessionId);
    } else {
      status.textContent = '❌ Error';
    }
  }).catch(function(e){ status.textContent = '❌ ' + e.message; });
}

function clearFeedbackText() {
  document.getElementById('feedbackTextarea').value = '';
  localStorage.removeItem('yellyclaw_feedback_text');
}

function saveFeedbackHistory(text) {
  var hist = JSON.parse(localStorage.getItem('yellyclaw_feedback_history') || '[]');
  hist.unshift({text: text, ts: Date.now()});
  if (hist.length > 5) hist.length = 5;
  localStorage.setItem('yellyclaw_feedback_history', JSON.stringify(hist));
  localStorage.setItem('yellyclaw_feedback_text', text);
  renderFeedbackHistory();
}

function renderFeedbackHistory() {
  var hist = JSON.parse(localStorage.getItem('yellyclaw_feedback_history') || '[]');
  var container = document.getElementById('feedbackHistoryList');
  if (!container) return;
  if (!hist.length) { container.innerHTML = ''; return; }
  var html = '<div style="font-size:12px;color:var(--ctp-subtext0);margin-bottom:6px;">Recent submissions:</div>';
  hist.forEach(function(h) {
    html += '<div class="feedback-history-item">' + escHtmlJs(h.text.slice(0, 100)) + ' <span style="color:var(--ctp-overlay0);">· ' + new Date(h.ts).toLocaleDateString() + '</span></div>';
  });
  container.innerHTML = html;
}

// Restore feedback draft
var _feedbackDraft = localStorage.getItem('yellyclaw_feedback_text');
if (_feedbackDraft) document.getElementById('feedbackTextarea') && (document.getElementById('feedbackTextarea').value = _feedbackDraft);

// Persist feedback textarea
document.getElementById('feedbackTextarea') && document.getElementById('feedbackTextarea').addEventListener('input', function() {
  localStorage.setItem('yellyclaw_feedback_text', this.value);
});

renderFeedbackHistory();

// --- Resizer ---
(function() {
  var resizer = document.getElementById('resizer');
  var left = document.getElementById('panelSchedules');
  var dragging = false;
  var startX, startW;
  resizer.addEventListener('mousedown', function(e) {
    dragging = true;
    startX = e.clientX;
    startW = left.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var newW = Math.max(180, startW + (e.clientX - startX));
    left.style.flex = '0 0 ' + newW + 'px';
  });
  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// --- Utilities ---
function relativeTime(ts) {
  if (!ts) return '—';
  var diff = Date.now() - ts;
  if (diff < 10000) return 'just now';
  if (diff < 3600000) return Math.round(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.round(diff/3600000) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

function escHtmlJs(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

${QUICK_ADD_SCHEDULE_SCRIPT}
${LOG_TAIL_TOOLTIP_SCRIPT}

// Auto-refresh
checkHealth();
loadSchedules();
loadSessions();
setInterval(loadSchedules, 10000);
setInterval(loadSessions, 5000);
setInterval(checkHealth, 30000);
`;
}

module.exports = { buildManagerScript };
