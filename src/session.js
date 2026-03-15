'use strict';

const { escHtml, renderSourceBadge, renderPromptPanel, renderFooter, getSessionPageStyles, renderOpenFolderScript, COPY_BASH_SCRIPT, shortenPath } = require('./shared');

// ---------------------------------------------------------------------------
// unifiedSessionPage — full detail page for running or completed sessions
// ---------------------------------------------------------------------------
function unifiedSessionPage(opts) {
  const {
    id,
    prompt = '',
    output = '',
    source = 'browser',
    agentSpec = '',
    agentRepo = '',
    startedAt,
    endedAt,
    exitCode,
    killed,
    scheduleId,
    scheduleName,
    workDir = '',
    PORT = 2026,
  } = opts;

  const isRunning = exitCode == null && !killed;
  const isFailed = exitCode != null && exitCode !== 0 && !killed;
  const isKilled = !!killed;

  let statusIcon = '⏳';
  let statusClass = 'status-running';
  let statusText = 'Running…';
  if (isKilled) { statusIcon = '🔪'; statusClass = 'status-killed'; statusText = 'Killed'; }
  else if (isFailed) { statusIcon = '❌'; statusClass = 'status-fail'; statusText = `Failed (exit ${exitCode})`; }
  else if (!isRunning) { statusIcon = '✅'; statusClass = 'status-ok'; statusText = 'Done'; }

  const startedStr = startedAt ? new Date(startedAt).toLocaleString() : '';
  const endedStr = endedAt ? new Date(endedAt).toLocaleString() : '';
  const elapsed = (startedAt && endedAt)
    ? Math.round((endedAt - startedAt) / 1000) + 's'
    : isRunning ? '<span id="elapsed">…</span>' : '';

  const toolbarHtml = `
<div class="toolbar">
  <h1>${statusIcon} Session #${escHtml(String(id))}</h1>
  ${renderSourceBadge(source)}
  ${scheduleName ? `<span style="font-size:12px;color:var(--ctp-yellow);">⏰ ${escHtml(scheduleName)}</span>` : ''}
  <span class="${statusClass}" style="font-size:13px;">${statusText}</span>
  <span style="font-size:12px;color:var(--ctp-subtext0);">${escHtml(startedStr)}${elapsed ? ' · ' + elapsed : ''}</span>
  <span class="spacer"></span>
  <button onclick="location.reload()">🔄 Refresh</button>
  <a href="/sessions/${escHtml(String(id))}/export?format=markdown" style="font-size:13px;">
    <button>📝 Export</button>
  </a>
  ${isFailed ? `<button onclick="retrySession(${id})">🔁 Retry</button>` : ''}
  <a href="#" onclick="if(window.parent&&window.parent.switchTab){window.parent.switchTab('home');}else{location.href='/';}return false;" style="font-size:13px;color:var(--ctp-subtext0);">← Manager</a>
</div>`;

  const outputHtml = `
<div class="output-panel">
  <pre id="out">${escHtml(output || '')}</pre>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    ${isFailed ? `<button onclick="retrySession(${id})">🔁 Retry</button>` : ''}
    <button onclick="window.scrollTo(0,document.body.scrollHeight)">⬇ Bottom</button>
  </div>
  ${isFailed ? `<div id="errorReport" class="error-report" style="display:none;"></div>` : ''}
</div>`;

  const extraScripts = `
<script>
${isRunning ? `
var _pollTimer = setInterval(function() {
  fetch('/sessions/${id}/logs', {headers:{'Accept':'application/json'}})
    .then(function(r){ return r.json(); })
    .then(function(d) {
      if (d.output != null) document.getElementById('out').textContent = d.output;
      if (d.exitCode != null || d.killed) { clearInterval(_pollTimer); location.reload(); }
    }).catch(function(){});
}, 3000);
document.addEventListener('visibilitychange', function() {
  if (document.hidden) { clearInterval(_pollTimer); }
  else { location.reload(); }
});
// Elapsed counter
var _startedAt = ${startedAt || 0};
if (_startedAt) {
  setInterval(function() {
    var el = document.getElementById('elapsed');
    if (el) el.textContent = Math.round((Date.now() - _startedAt) / 1000) + 's';
  }, 1000);
}
` : ''}
${isFailed ? `
// Load error report
fetch('/sessions/${id}/error-report', {headers:{'Accept':'application/json'}})
  .then(function(r){ return r.json(); })
  .then(function(d) {
    if (d && d.rootCause) {
      var el = document.getElementById('errorReport');
      if (el) {
        el.style.display = 'block';
        el.innerHTML = '<h3>⚠️ Error Report</h3>' +
          '<p><strong>Root Cause:</strong> ' + escHtmlJs(d.rootCause) + '</p>' +
          '<p><strong>Resolution:</strong> ' + escHtmlJs(d.resolution) + '</p>';
      }
    }
  }).catch(function(){});
` : ''}
function retrySession(id) {
  fetch('/token').then(r=>r.json()).then(function(d) {
    fetch('/sessions/' + id + '/rerun', {
      method: 'POST',
      headers: {'Content-Type':'application/json','X-AgentRock-Token':d.token},
      body: JSON.stringify({})
    }).then(r=>r.json()).then(function(result) {
      if (result.newSessionId) window.open('/sessions/' + result.newSessionId + '/logs', '_blank');
    });
  });
}
function escHtmlJs(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session #${escHtml(String(id))} — YellyClaw</title>
<style>${getSessionPageStyles()}</style>
</head>
<body>
${toolbarHtml}
<div class="session-body">
${outputHtml}
</div>
${renderFooter(PORT, { workDir })}
${renderOpenFolderScript()}
${COPY_BASH_SCRIPT}
${extraScripts}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// streamingSessionPage — lightweight page sent immediately on session start
// ---------------------------------------------------------------------------
function streamingSessionPage(opts, sessionId) {
  const {
    prompt = '',
    agentSpec = '',
    agentRepo = '',
    token = '',
    workDir = '',
    PORT = 2026,
  } = opts;

  const toolbarHtml = `
<div class="toolbar">
  <h1>⏳ Session #<span id="sessionIdDisplay">${sessionId ? escHtml(String(sessionId)) : '…'}</span></h1>
  <span class="status-running" id="statusText">Starting…</span>
  <span class="spacer"></span>
  <span id="shareBtn" style="display:none;">
    <button onclick="shareSession()">🔗 Share</button>
  </span>
  <span id="exportBtn" style="display:none;">
    <a id="exportLink" href="#"><button>📝 Export</button></a>
  </span>
  <a href="#" onclick="if(window.parent&&window.parent.switchTab){window.parent.switchTab('home');}else{location.href='/';}return false;" style="font-size:13px;color:var(--ctp-subtext0);">← Manager</a>
</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session — YellyClaw</title>
<style>${getSessionPageStyles()}</style>
</head>
<body>
${toolbarHtml}
<div class="session-body">
<div class="output-panel">
  <pre id="out">Waiting for output…</pre>
  <div style="display:flex;gap:8px;">
    <button onclick="window.scrollTo(0,document.body.scrollHeight)">⬇ Bottom</button>
  </div>
</div>
</div>
${renderFooter(PORT, { workDir })}
${renderOpenFolderScript()}
<script>
var _sid = ${sessionId ? JSON.stringify(String(sessionId)) : 'null'};
var _token = ${JSON.stringify(token || '')};
var _attempts = 0;
var _maxAttempts = 20;
var _pollInterval = 2000;
var _timer = null;
var _paused = false;

function startPolling() {
  if (!_sid) {
    // Try to find the most recent session
    _attempts++;
    if (_attempts > _maxAttempts) {
      document.getElementById('statusText').textContent = 'Session not found';
      return;
    }
    setTimeout(function() {
      fetch('/sessions', {headers:{'Accept':'application/json'}})
        .then(r=>r.json())
        .then(function(d) {
          var sessions = d.sessions || [];
          if (sessions.length > 0) {
            _sid = sessions[sessions.length-1].id;
            document.getElementById('sessionIdDisplay').textContent = _sid;
            document.getElementById('exportLink').href = '/sessions/' + _sid + '/export?format=markdown';
            _attempts = 0;
            _timer = setInterval(poll, _pollInterval);
          } else {
            startPolling();
          }
        }).catch(startPolling);
    }, 500);
    return;
  }
  document.getElementById('exportLink').href = '/sessions/' + _sid + '/export?format=markdown';
  _timer = setInterval(poll, _pollInterval);
}

function poll() {
  if (_paused) return;
  fetch('/sessions/' + _sid + '/logs', {headers:{'Accept':'application/json'}})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.output != null) document.getElementById('out').textContent = d.output;
      if (d.exitCode != null) {
        clearInterval(_timer);
        if (d.exitCode === 0) {
          document.getElementById('statusText').textContent = '✅ Done';
          document.getElementById('statusText').className = 'status-ok';
        } else {
          document.getElementById('statusText').textContent = '❌ exit ' + d.exitCode;
          document.getElementById('statusText').className = 'status-fail';
        }
        document.getElementById('shareBtn').style.display = '';
        document.getElementById('exportBtn').style.display = '';
      } else if (d.killed) {
        clearInterval(_timer);
        document.getElementById('statusText').textContent = '🔪 Killed';
        document.getElementById('statusText').className = 'status-killed';
      } else {
        document.getElementById('statusText').textContent = 'Running…';
      }
    }).catch(function(){});
}

document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    _paused = true;
  } else {
    _paused = false;
  }
});

function shareSession() {
  if (!_sid || !_token) return;
  fetch('/sessions/' + _sid + '/share', {
    method: 'POST',
    headers: {'Content-Type':'application/json', 'X-AgentRock-Token': _token},
    body: JSON.stringify({})
  }).then(r=>r.json()).then(function(d) {
    if (d.url) {
      navigator.clipboard.writeText(d.url);
      alert('Share URL copied: ' + d.url);
    }
  });
}

startPolling();
</script>
</body>
</html>`;
}

module.exports = { unifiedSessionPage, streamingSessionPage };
