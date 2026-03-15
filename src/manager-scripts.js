'use strict';

// ---------------------------------------------------------------------------
// QUICK_ADD_SCHEDULE_SCRIPT — browser-side JS for the AI quick-add input
// ---------------------------------------------------------------------------
const QUICK_ADD_SCHEDULE_SCRIPT = `
async function quickAddSchedule() {
  var text = document.getElementById('quickAddInput').value.trim();
  if (!text) { alert('Please enter a schedule description'); return; }
  var btn = document.getElementById('quickAddBtn');
  btn.disabled = true; btn.textContent = '⏳ Creating…';
  try {
    // Use cached token; fall back to fetch only if not yet loaded
    var token = _ycToken;
    if (!token) { var _td = await (await fetch('/token')).json(); token = _ycToken = _td.token; }

    var prompt = 'You are a schedule-creation assistant for YellyClaw.\\nThe user wants: \\'' + text.replace(/'/g, "\\'") + '\\'\\n\\nRun this curl to create the schedule:\\n  curl -s -X POST http://localhost:2026/schedules \\\\\\n    -H \\'Content-Type: application/json\\' \\\\\\n    -H \\'X-YellyRock-Token: ' + token + '\\' \\\\\\n    -d \\'{\\\"name\\\": \\\"<short name>\\\", \\\"prompt\\\": \\\"<agent prompt>\\\", \\\"interval\\\": \\\"<1h|6h|12h|1d|1w|once>\\\", \\\"nextRunAt\\\": \\\"<ISO datetime or empty>\\\", \\\"autoPause\\\": true}\\'\\n\\nField rules:\\n- interval: map natural language (daily=1d, hourly=1h, weekly=1w, once=once, etc)\\n- nextRunAt: ISO datetime from time hint in the message, or null for now+interval\\n- name: max 40 chars, descriptive\\n- prompt: what the agent should actually do\\n\\nCall the REST API now.';

    var runRes = await fetch('/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-YellyRock-Token': token},
      body: JSON.stringify({prompt: prompt, allowTools: ['Bash']})
    });
    var runData = await runRes.json();
    if (runData.sessionId) {
      openSessionTab(runData.sessionId);
      // Poll schedule list 6 times, every 5s
      var polls = 0;
      var pollTimer = setInterval(function() {
        polls++;
        loadSchedules();
        if (polls >= 6) clearInterval(pollTimer);
      }, 5000);
    }
    document.getElementById('quickAddInput').value = '';
  } catch(e) {
    alert('Error: ' + e.message);
  }
  btn.disabled = false; btn.textContent = '⚡ Add with AI';
}
`;

// ---------------------------------------------------------------------------
// LOG_TAIL_TOOLTIP_SCRIPT — browser-side JS for hover log previews
// ---------------------------------------------------------------------------
const LOG_TAIL_TOOLTIP_SCRIPT = `
var _tooltipEl = null;
var _tooltipTimers = {};
var _tooltipCache = {};

function showLogTooltip(sessionId, event) {
  clearTimeout(_tooltipTimers[sessionId]);
  _tooltipTimers[sessionId] = setTimeout(function() {
    if (_tooltipCache[sessionId]) {
      displayTooltip(_tooltipCache[sessionId], event);
      return;
    }
    fetch('/sessions/' + sessionId + '/logs', {headers:{'Accept':'application/json'}})
      .then(r=>r.json())
      .then(function(d) {
        var lines = (d.output || '').split('\\n').filter(Boolean).slice(-10);
        var text = lines.join('\\n') || '(no output)';
        _tooltipCache[sessionId] = text;
        displayTooltip(text, event);
      }).catch(function(){});
  }, 250);
}

function displayTooltip(text, event) {
  hideTooltip();
  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'log-tooltip';
  _tooltipEl.textContent = text;
  document.body.appendChild(_tooltipEl);
  var x = Math.min(event.clientX + 12, window.innerWidth - 520);
  var y = event.clientY + 16;
  if (y + 200 > window.innerHeight) y = event.clientY - 200;
  _tooltipEl.style.left = x + 'px';
  _tooltipEl.style.top = y + 'px';
}

function hideTooltip(sessionId) {
  if (sessionId) clearTimeout(_tooltipTimers[sessionId]);
  if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
}
`;

module.exports = { QUICK_ADD_SCHEDULE_SCRIPT, LOG_TAIL_TOOLTIP_SCRIPT };
