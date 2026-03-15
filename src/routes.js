'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const os = require('os');

const { unifiedSessionPage, streamingSessionPage } = require('./session');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (_) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------
function extractKeywords(text) {
  return (text || '').split(/\s+/).filter(w => w.length > 2);
}

// ---------------------------------------------------------------------------
// getPreapprovedTools
// ---------------------------------------------------------------------------
function getPreapprovedTools(url, keywords, preapprovalRules) {
  const tools = new Set(['Bash', 'Read', 'Write']);
  if (!preapprovalRules || !Array.isArray(preapprovalRules.rules)) return [...tools];
  for (const rule of preapprovalRules.rules) {
    let urlMatch = !rule.urlPattern || (url && new RegExp(rule.urlPattern).test(url));
    let kwMatch = !rule.keywords || rule.keywords.some(kw => keywords.includes(kw));
    if (urlMatch && kwMatch && Array.isArray(rule.tools)) {
      for (const t of rule.tools) tools.add(t);
    }
  }
  return [...tools];
}

// ---------------------------------------------------------------------------
// shouldSuppressOutput
// ---------------------------------------------------------------------------
function shouldSuppressOutput(chunk, lastOutput) {
  const text = chunk.toString();
  if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+Thinking/.test(text)) return true;
  if (text === lastOutput) return true;
  return false;
}

// ---------------------------------------------------------------------------
// stripAnsi (local copy used in routes)
// ---------------------------------------------------------------------------
function stripAnsi(s) {
  return (s || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[^[\]]/g, '')
    .replace(/\x1b/g, '');
}

// ---------------------------------------------------------------------------
// runClaudeCode
// ---------------------------------------------------------------------------
function runClaudeCode(prompt, res, asHtml, agentSpec, scheduleId, parentId, title, interactive, config, extraAllowTools, source, scheduleName, agentRepo, preAllocated, reqToken) {
  const {
    PORT, CLAUDE_BIN, CSRF_TOKEN,
    activeSessions, scheduledTasks, sessionHistory,
    tokenToSessionId, pendingInputPrompts,
    registerSession, preAllocateSession,
    preapprovalRules, INTERACTIVE,
  } = config;

  if (!prompt) return null;

  // Build tool list
  const keywords = extractKeywords(prompt);
  const baseTools = getPreapprovedTools(null, keywords, preapprovalRules);
  const schedTools = Array.isArray(extraAllowTools) ? extraAllowTools : [];
  const allTools = [...new Set([...baseTools, ...schedTools])];

  // Build args
  const args = ['-p'];
  if (allTools.includes('*')) {
    args.push('--dangerously-skip-permissions');
  } else if (allTools.length > 0) {
    args.push('--allowedTools', allTools.join(','));
  }
  if (agentSpec) args.push('--agent', agentSpec);
  args.push('--', prompt);

  // Pre-allocate session if not provided
  const allocated = preAllocated || preAllocateSession();

  // Strip vars that would make child claude behave as a desktop/subagent
  // (CLAUDECODE=1 triggers stdio permission-prompt protocol which yellyclaw
  // doesn't implement, causing hangs).
  const { CLAUDECODE: _cc, CLAUDE_CODE_ENTRYPOINT: _ce, ...inheritedEnv } = process.env;
  const procEnv = {
    ...inheritedEnv,
    YELLYCLAW_SESSION_ID: String(allocated.id),
    YELLYCLAW_PORT: String(PORT),
    YELLYCLAW_TOKEN: CSRF_TOKEN,
    YELLYCLAW_PARENT_ID: parentId ? String(parentId) : '',
  };

  let proc;
  try {
    proc = spawn(CLAUDE_BIN, args, {
      shell: false,
      cwd: allocated.workDir,
      env: procEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error('[runClaudeCode] spawn error:', e.message);
    // Return a fake proc that immediately emits close with error
    const { EventEmitter } = require('events');
    proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: () => {}, end: () => {} };
    proc.kill = () => {};
    proc.env = procEnv;
    setImmediate(() => {
      proc.stderr.emit('data', Buffer.from('spawn error: ' + e.message));
      proc.emit('close', 127);
    });
  }

  // Handle spawn errors (ENOENT etc.)
  proc.on && proc.on('error', (e) => {
    console.error('[runClaudeCode] process error:', e.message);
  });

  // Token for PRG mapping
  const token = reqToken || (Date.now().toString(36) + crypto.randomBytes(3).toString('hex'));

  const sessionId = registerSession(
    prompt, proc, title || prompt.slice(0, 40), token,
    agentSpec, agentRepo, interactive || INTERACTIVE,
    source || 'browser', scheduleName, allocated, scheduleId
  );

  // Set parentId on session
  const session = activeSessions.get(sessionId);
  if (session && parentId) session.parentId = parentId;

  // Update schedule currentRunSessionId
  if (scheduleId) {
    const sched = scheduledTasks.find(s => s.id === scheduleId);
    if (sched) sched.currentRunSessionId = sessionId;
  }

  if (asHtml && res) {
    // Mode B: send streaming page immediately
    const pageHtml = streamingSessionPage({
      prompt,
      agentSpec,
      agentRepo,
      token: CSRF_TOKEN,
      workDir: allocated.workDir,
      PORT,
    }, sessionId);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(pageHtml);
  } else if (res) {
    // Mode A: stream raw bytes
    let lastOutput = '';
    proc.stdout.on('data', chunk => {
      if (!shouldSuppressOutput(chunk, lastOutput)) {
        process.stdout.write(chunk);
        try { res.write(chunk); } catch (_) {}
        lastOutput = chunk.toString();
      }
    });
    proc.stderr.on('data', chunk => {
      if (!shouldSuppressOutput(chunk, lastOutput)) {
        process.stderr.write(chunk);
        try { res.write(chunk); } catch (_) {}
        lastOutput = chunk.toString();
      }
    });
    proc.on('close', code => {
      try { res.end(`\n[done] exit code: ${code}`); } catch (_) {}
    });
  }

  return sessionId;
}

// ---------------------------------------------------------------------------
// installAgentIfAbsent
// ---------------------------------------------------------------------------
async function installAgentIfAbsent(agentName, config) {
  if (!agentName) return;
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(config.CLAUDE_BIN, ['agent', 'list'], { shell: false });
    } catch (_) { return resolve(); }
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve());
    proc.on('close', code => {
      if (code !== 0) { resolve(); return; }
      const agents = out.split('\n')
        .filter(l => /^\s*[-•*]/.test(l))
        .map(l => l.replace(/^\s*[-•*]\s*/, '').trim());
      if (!agents.includes(agentName)) {
        const install = spawn(config.CLAUDE_BIN, ['agent', 'install', agentName], { shell: false });
        install.on('close', resolve);
      } else {
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// scheduleTick
// ---------------------------------------------------------------------------
function scheduleTick(config) {
  const {
    scheduledTasks, SESSION_DIR, SESSION_TTL_DAYS, sessionHistory,
    activeSessions, saveSchedulesToLocal,
  } = config;
  const now = Date.now();

  for (const sched of scheduledTasks) {
    if (!sched.enabled) continue;
    if (sched.currentRunSessionId) continue;
    if (sched.nextRunAt > now) continue;

    // Fire schedule
    sched.lastRunAt = now;
    sched.runCount = (sched.runCount || 0) + 1;

    const sessionId = runClaudeCode(
      sched.prompt, null, false,
      sched.agentSpec, sched.id, null,
      sched.name, false, config,
      sched.allowTools, 'schedule', sched.name, null, null, null
    );

    sched.lastRunSessionId = sessionId;
    sched.currentRunSessionId = sessionId;

    // Advance nextRunAt
    if (sched.interval === 'once') {
      sched.enabled = false;
    } else {
      const ms = config.intervalToMs(sched.interval);
      sched.nextRunAt = now + ms;
    }

    saveSchedulesToLocal();
  }

  // Purge old session files
  purgeOldSessions(config, SESSION_DIR, SESSION_TTL_DAYS, sessionHistory, activeSessions, now);
}

// ---------------------------------------------------------------------------
// purgeOldSessions
// ---------------------------------------------------------------------------
function purgeOldSessions(config, sessionDir, ttlDays, sessionHistory, activeSessions, now) {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(sessionDir)) return;

  let dateDirs;
  try { dateDirs = fs.readdirSync(sessionDir); } catch (_) { return; }

  for (const dd of dateDirs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dd)) continue;
    const datePath = path.join(sessionDir, dd);
    let sessionDirs;
    try { sessionDirs = fs.readdirSync(datePath); } catch (_) { continue; }

    let allRemoved = true;
    for (const sd of sessionDirs) {
      const sdPath = path.join(datePath, sd);
      // Path traversal guard
      if (!sdPath.startsWith(sessionDir + path.sep)) { allRemoved = false; continue; }

      // Check mtime
      let stat;
      try { stat = fs.statSync(sdPath); } catch (_) { allRemoved = false; continue; }

      const effectiveTtl = ttlMs; // Could be max(config, schedule interval) per spec
      if (now - stat.mtimeMs > effectiveTtl) {
        // Remove from history
        const m = sd.match(/^session-(\d+)$/);
        if (m) {
          const id = parseInt(m[1], 10);
          const idx = sessionHistory.findIndex(h => h.id === id);
          if (idx >= 0) sessionHistory.splice(idx, 1);
        }
        try { fs.rmSync(sdPath, { recursive: true, force: true }); } catch (_) {}
      } else {
        allRemoved = false;
      }
    }

    // Remove empty date dir
    if (allRemoved) {
      try { fs.rmdirSync(datePath); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------------
// autoRunUntilNoError
// ---------------------------------------------------------------------------
async function autoRunUntilNoError(scheduleId, config, maxRetries) {
  maxRetries = maxRetries || 3;
  const sched = config.scheduledTasks.find(s => s.id === scheduleId);
  if (!sched) return { success: false, error: 'not_found' };

  const fixesApplied = [];
  let lastErrorReport = null;
  let lastSessionId = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await installAgentIfAbsent(sched.agentSpec, config);

    const fakeRes = {
      writeHead: () => {},
      write: () => {},
      end: () => {},
    };

    const sessionId = runClaudeCode(
      sched.prompt, fakeRes, false,
      sched.agentSpec, sched.id, null,
      sched.name, false, config,
      sched.allowTools, 'schedule', sched.name, null, null, null
    );
    lastSessionId = sessionId;

    // Wait for session to exit
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (!config.activeSessions.has(sessionId)) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });

    // Find history entry
    const hist = config.sessionHistory.find(h => h.id === sessionId);
    if (!hist) break;

    const report = config.generateErrorReport(hist.output, hist.exitCode);
    lastErrorReport = report;

    if (!report || hist.exitCode === 0) {
      sched.lastRunFailed = false;
      config.saveSchedulesToLocal();
      return { success: true, attempts: attempt, sessionId, fixesApplied, lastErrorReport: null };
    }

    if (report.autoFix && report.autoFix.type === 'add-tool') {
      const tool = report.autoFix.tool;
      if (!sched.allowTools.includes(tool)) {
        sched.allowTools.push(tool);
        config.saveSchedulesToLocal();
        fixesApplied.push({ type: 'add-tool', tool });
      }
    } else {
      break; // No auto-fix available
    }
  }

  sched.lastRunFailed = true;
  config.saveSchedulesToLocal();
  return { success: false, attempts: maxRetries, sessionId: lastSessionId, fixesApplied, lastErrorReport };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleRun(req, res, config) {
  readBody(req).then(body => {
    const prompt = body.prompt;
    if (!prompt) return json(res, 400, { error: 'missing_prompt' });

    // Pass null for res — POST /run returns {sessionId} immediately, not a streaming response
    const sessionId = runClaudeCode(
      prompt, null, false,
      body.agentSpec || '', null, null,
      body.title, false, config,
      body.allowTools || [], 'browser', null, body.agentRepo, null, null
    );
    if (sessionId === null) return json(res, 400, { error: 'missing_prompt' });
    json(res, 200, { sessionId });
  });
}

function handleSpawn(req, res, id, config) {
  const { activeSessions, sessionHistory, spawnChildCount } = config;
  const parentId = parseInt(id, 10);
  const parentSession = activeSessions.get(parentId);
  if (!parentSession) return json(res, 404, { error: 'session_not_found' });

  readBody(req).then(body => {
    const childCount = spawnChildCount.get(parentId) || 0;
    if (childCount >= 5) return json(res, 429, { error: 'max_children', message: 'Max 5 child sessions per parent' });

    const prompt = body.prompt;
    if (!prompt) return json(res, 400, { error: 'missing_prompt' });

    const agentSpec = body.agentSpec || parentSession.agentSpec || '';

    const sessionId = runClaudeCode(
      prompt, null, false,
      agentSpec, null, parentId,
      body.title, false, config,
      body.allowTools || [], 'spawn', null, body.agentRepo, null, null
    );

    spawnChildCount.set(parentId, childCount + 1);

    json(res, 201, { sessionId, parentId, logsUrl: `/sessions/${sessionId}/logs` });
  });
}

function handleRerun(req, res, id, config) {
  const { activeSessions, sessionHistory } = config;
  const sessionId = parseInt(id, 10);
  const session = activeSessions.get(sessionId) || sessionHistory.find(h => h.id === sessionId);
  if (!session) return json(res, 404, { error: 'session_not_found' });

  config.loadSessionOutput(session);
  const prompt = session.prompt || '';
  if (!prompt) return json(res, 400, { error: 'no_prompt' });

  const newSessionId = runClaudeCode(
    prompt, null, false,
    session.agentSpec, null, null,
    null, false, config,
    [], 'browser', null, session.agentRepo, null, null
  );

  json(res, 200, { newSessionId });
}

function handleSessionLogs(req, res, id, config) {
  const { activeSessions, sessionHistory } = config;
  const sessionId = parseInt(id, 10);
  const accept = req.headers['accept'] || '';
  const wantsJson = accept.includes('application/json') || accept.includes('json');

  let session = activeSessions.get(sessionId);
  let hist = null;

  if (!session) {
    hist = sessionHistory.find(h => h.id === sessionId);
    if (!hist) return json(res, 404, { error: 'session_not_found' });
    config.loadSessionOutput(hist);
  }

  const data = session || hist;

  if (wantsJson) {
    return json(res, 200, {
      id: data.id,
      prompt: data.prompt,
      output: stripAnsi(data.output || ''),
      exitCode: data.exitCode,
      killed: data.killed,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      source: data.source,
      agentSpec: data.agentSpec,
    });
  }

  // HTML
  const pageOpts = {
    id: data.id,
    prompt: data.prompt,
    output: stripAnsi(data.output || ''),
    source: data.source,
    agentSpec: data.agentSpec,
    agentRepo: data.agentRepo,
    startedAt: data.startedAt,
    endedAt: data.endedAt,
    exitCode: data.exitCode,
    killed: data.killed,
    scheduleId: data.scheduleId,
    scheduleName: data.scheduleName,
    workDir: data.workDir,
    PORT: config.PORT,
  };
  const html = unifiedSessionPage(pageOpts);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleSessionInput(req, res, id, config) {
  const { activeSessions, pendingInputPrompts } = config;
  const sessionId = parseInt(id, 10);
  const session = activeSessions.get(sessionId);

  if (req.method === 'GET') {
    const pending = pendingInputPrompts.get(sessionId);
    return json(res, 200, {
      pendingInput: !!(session && session.pendingInput),
      question: pending ? pending.question : null,
      timestamp: pending ? pending.timestamp : null,
    });
  }

  // POST
  if (!session) return json(res, 404, { error: 'session_not_found' });
  readBody(req).then(body => {
    const input = body.input;
    if (input == null) return json(res, 400, { error: 'missing_input' });
    if (session.proc && session.proc.stdin) {
      session.proc.stdin.write(input + '\n');
    }
    session.pendingInput = false;
    pendingInputPrompts.delete(sessionId);
    json(res, 200, { ok: true });
  });
}

function handleKillSession(req, res, id, config) {
  const { activeSessions } = config;
  const sessionId = parseInt(id, 10);
  const session = activeSessions.get(sessionId);
  if (!session) return json(res, 404, { error: 'session_not_found' });
  session.killed = true;
  if (session.proc) {
    try { session.proc.kill('SIGTERM'); } catch (_) {}
  }
  json(res, 200, { killed: true });
}

function handleSessionExport(req, res, id, config) {
  const { activeSessions, sessionHistory } = config;
  const sessionId = parseInt(id, 10);
  const url = new URL(req.url, `http://localhost`);
  const format = url.searchParams.get('format') || 'json';

  let session = activeSessions.get(sessionId) || sessionHistory.find(h => h.id === sessionId);
  if (!session) return json(res, 404, { error: 'session_not_found' });
  config.loadSessionOutput(session);

  const output = stripAnsi(session.output || '');

  if (format === 'json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="session-${sessionId}.json"` });
    res.end(JSON.stringify({
      sessionId: session.id,
      prompt: session.prompt,
      output,
      startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : null,
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      exitCode: session.exitCode,
      source: session.source,
      agentSpec: session.agentSpec,
    }, null, 2));
  } else if (format === 'markdown') {
    const sep = '='.repeat(60);
    const md = `# YellyClaw Session #${session.id}\n\n${sep}\n\n## Details\n\n- **Started:** ${session.startedAt ? new Date(session.startedAt).toISOString() : 'N/A'}\n- **Exit Code:** ${session.exitCode}\n- **Source:** ${session.source}\n\n## Prompt\n\n${session.prompt || ''}\n\n## Output\n\n\`\`\`\n${output}\n\`\`\`\n`;
    res.writeHead(200, { 'Content-Type': 'text/markdown', 'Content-Disposition': `attachment; filename="session-${sessionId}.md"` });
    res.end(md);
  } else {
    const sep = '='.repeat(60);
    const text = `YellyClaw Session #${session.id}\n${sep}\nStarted: ${session.startedAt ? new Date(session.startedAt).toISOString() : 'N/A'}\nExit Code: ${session.exitCode}\n${sep}\nPROMPT:\n${session.prompt || ''}\n${sep}\nOUTPUT:\n${output}\n`;
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="session-${sessionId}.txt"` });
    res.end(text);
  }
}

function handleSessionShare(req, res, id, config) {
  // Stub: return a fake URL (no real paste service configured)
  const sessionId = parseInt(id, 10);
  json(res, 200, { url: `https://yellyclaw.app/shared/session-${sessionId}` });
}

function handleSessionErrorReport(req, res, id, config) {
  const { activeSessions, sessionHistory } = config;
  const sessionId = parseInt(id, 10);
  const session = sessionHistory.find(h => h.id === sessionId) || activeSessions.get(sessionId);
  if (!session) return json(res, 404, { error: 'session_not_found' });

  if (session.errorReport) {
    return json(res, 200, session.errorReport);
  }

  // Try reading from disk
  if (session.workDir) {
    try {
      const reportPath = path.join(session.workDir, 'error-report.md');
      if (fs.existsSync(reportPath)) {
        const text = fs.readFileSync(reportPath, 'utf8');
        const rcMatch = text.match(/\*\*Root Cause:\*\*\s*(.+)/);
        const resMatch = text.match(/\*\*Resolution:\*\*\s*(.+)/);
        return json(res, 200, {
          rootCause: rcMatch ? rcMatch[1].trim() : '',
          resolution: resMatch ? resMatch[1].trim() : '',
          autoFix: null,
        });
      }
    } catch (_) {}
  }

  json(res, 200, { rootCause: null, resolution: null, autoFix: null });
}

function handleSchedules(req, res, config) {
  json(res, 200, { schedules: config.scheduledTasks });
}

function handleCreateSchedule(req, res, config) {
  readBody(req).then(body => {
    const prompt = body.prompt;
    if (!prompt) return json(res, 400, { error: 'missing_prompt' });

    const id = `sched_${crypto.randomBytes(6).toString('hex')}`;
    const name = (body.name || prompt).slice(0, 40);
    const interval = body.interval || '1d';
    const intervalMs = config.intervalToMs(interval);
    const nextRunAt = body.nextRunAt ? new Date(body.nextRunAt).getTime() : Date.now() + intervalMs;

    const sched = config.normalizeSchedule({
      id,
      name,
      prompt,
      agentSpec: body.agentSpec || '',
      interval,
      enabled: body.enabled !== false,
      nextRunAt,
      allowTools: body.allowTools || [],
      autoPause: body.autoPause !== undefined ? body.autoPause : true,
      runLate: body.runLate || false,
      createdAt: new Date().toISOString(),
      runCount: 0,
      lastRunAt: null,
      lastRunFailed: false,
      lastRunSessionId: null,
    });

    config.scheduledTasks.push(sched);
    config.saveSchedulesToLocal();
    json(res, 201, { schedule: sched });
  });
}

function handleUpdateSchedule(req, res, id, config) {
  const sched = config.scheduledTasks.find(s => s.id === id);
  if (!sched) return json(res, 404, { error: 'schedule_not_found' });

  readBody(req).then(body => {
    const updatable = ['name', 'prompt', 'agentSpec', 'interval', 'enabled', 'nextRunAt', 'allowTools', 'autoPause', 'runLate'];
    for (const k of updatable) {
      if (body[k] !== undefined) {
        if (k === 'nextRunAt') sched[k] = new Date(body[k]).getTime();
        else sched[k] = body[k];
      }
    }
    if (body.interval) sched.intervalMs = config.intervalToMs(body.interval);
    config.saveSchedulesToLocal();
    json(res, 200, { schedule: sched });
  });
}

function handleDeleteSchedule(req, res, id, config) {
  const idx = config.scheduledTasks.findIndex(s => s.id === id);
  if (idx < 0) return json(res, 404, { error: 'schedule_not_found' });

  // Warn if active session running
  const sched = config.scheduledTasks[idx];
  const hasActive = sched.currentRunSessionId && config.activeSessions.has(sched.currentRunSessionId);

  config.scheduledTasks.splice(idx, 1);
  config.saveSchedulesToLocal();
  json(res, 200, { deleted: true, hadActiveSession: !!hasActive });
}

function handleRunScheduleNow(req, res, id, config) {
  const sched = config.scheduledTasks.find(s => s.id === id);
  if (!sched) return json(res, 404, { error: 'schedule_not_found' });

  // Cooldown check
  if (sched.cooldownMs && sched.cooldownMs > Date.now()) {
    return json(res, 429, { error: 'cooldown', message: `Please wait before triggering again` });
  }

  sched.cooldownMs = Date.now() + 60000;

  const sessionId = runClaudeCode(
    sched.prompt, null, false,
    sched.agentSpec, sched.id, null,
    sched.name, false, config,
    sched.allowTools, 'schedule', sched.name, null, null, null
  );

  sched.lastRunSessionId = sessionId;
  sched.currentRunSessionId = sessionId;
  sched.lastRunAt = Date.now();
  sched.runCount = (sched.runCount || 0) + 1;
  config.saveSchedulesToLocal();

  json(res, 200, { sessionId, cooldown: true });
}

function handleRunUntilNoError(req, res, id, config) {
  const sched = config.scheduledTasks.find(s => s.id === id);
  if (!sched) return json(res, 404, { error: 'schedule_not_found' });

  json(res, 202, { message: 'auto-fix loop started', scheduleId: id });

  // Run in background
  autoRunUntilNoError(id, config, 3).then(result => {
    console.log(`[autoRunUntilNoError] schedule ${id}: ${JSON.stringify(result)}`);
  }).catch(err => {
    console.error('[autoRunUntilNoError] error:', err.message);
  });
}

function handleFeedback(req, res, config) {
  readBody(req).then(body => {
    const feedback = body.prompt || body.feedback;
    if (!feedback) return json(res, 400, { error: 'missing_prompt' });

    const repoRoot = path.join(__dirname, '..');
    const prompt = `You are an AI agent improving YellyClaw — a local AI agent runtime server.

The user has requested the following improvement:
"${feedback}"

Your task:
1. Read the current YellyClaw source code in ${repoRoot}/src/
2. Implement the requested change following the existing code style
3. Check that the change doesn't break existing functionality
4. Create a git commit with a descriptive message
5. If possible, raise a PR

Work in: ${repoRoot}
Source files: src/server.js, src/routes.js, src/manager.js, src/session.js, src/shared.js
Spec: ${repoRoot}/spec.md

Implement the improvement now.`;

    const sessionId = runClaudeCode(
      prompt, null, false,
      '', null, null,
      'Feedback: ' + feedback.slice(0, 30),
      false, config, [], 'browser', null, null, null, null
    );

    json(res, 200, { sessionId });
  });
}

function handleUpdate(req, res, config) {
  const repoRoot = path.join(__dirname, '..');
  let pullOutput = '';
  try {
    pullOutput = execSync('git pull --rebase', { cwd: repoRoot }).toString();
  } catch (err) {
    return json(res, 500, { error: 'git_pull_failed', details: err.message });
  }

  const alreadyUpToDate = /already up.to.date/i.test(pullOutput);

  let changedFiles = [];
  try {
    const diff = execSync('git diff HEAD~1 --name-only', { cwd: repoRoot }).toString();
    changedFiles = diff.split('\n').filter(l => l.startsWith('src/'));
  } catch (_) {}

  if (alreadyUpToDate && changedFiles.length === 0) {
    return json(res, 200, { updated: false, message: 'Already up to date' });
  }

  // Kill active sessions
  for (const [sid, session] of config.activeSessions) {
    session.killed = true;
    try { session.proc.kill('SIGTERM'); } catch (_) {}
  }

  json(res, 200, { updated: true, restarting: true, changedFiles, pullOutput });

  setTimeout(() => {
    const serverScript = path.join(__dirname, 'server.js');
    const child = spawn(process.execPath, [serverScript, ...process.argv.slice(2)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    config._server && config._server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  }, 300);
}

function handleStop(req, res, config) {
  // Kill active sessions
  for (const [sid, session] of config.activeSessions) {
    session.killed = true;
    try { session.proc.kill('SIGTERM'); } catch (_) {}
  }

  config.saveSchedulesToLocal();
  json(res, 200, { stopped: true });

  setTimeout(() => {
    config._server && config._server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  }, 200);
}

function handleOpenFolder(req, res, config) {
  readBody(req).then(body => {
    const p = body.path;
    if (!p) return json(res, 400, { error: 'missing_path' });

    // Path traversal guard
    const safePath = path.resolve(p);
    const allowedPrefixes = ['/tmp/yellyclaw', path.join(os.homedir(), '.yellyclaw')];
    if (!allowedPrefixes.some(prefix => safePath.startsWith(prefix))) {
      return json(res, 403, { error: 'forbidden_path' });
    }

    try {
      if (process.platform === 'darwin') {
        execSync(`open "${safePath}"`);
      } else {
        execSync(`xdg-open "${safePath}"`);
      }
      json(res, 200, { opened: safePath });
    } catch (err) {
      json(res, 500, { error: 'open_failed', details: err.message });
    }
  });
}

function handleAgents(req, res, config) {
  let proc;
  try {
    proc = spawn(config.CLAUDE_BIN, ['agent', 'list'], { shell: false });
  } catch (e) {
    return json(res, 500, { error: 'agent_list_failed', stderr: e.message, agents: [] });
  }
  let out = '';
  let err = '';
  let responded = false;
  proc.stdout.on('data', d => { out += d.toString(); });
  proc.stderr.on('data', d => { err += d.toString(); });
  proc.on('error', e => {
    if (responded) return;
    responded = true;
    json(res, 500, { error: 'agent_list_failed', stderr: e.message, agents: [] });
  });
  proc.on('close', code => {
    if (responded) return;
    responded = true;
    if (code !== 0) return json(res, 500, { error: 'agent_list_failed', stderr: err, agents: [] });
    const agents = out.split('\n')
      .filter(l => /^\s*[-•*]/.test(l))
      .map(l => ({ name: l.replace(/^\s*[-•*]\s*/, '').trim() }))
      .filter(a => a.name);
    json(res, 200, { agents });
  });
}

function handleHistory(req, res, config) {
  json(res, 200, { history: config.sessionHistory });
}

function handleClearHistory(req, res, config) {
  readBody(req).then(body => {
    const days = body.days;
    const now = Date.now();
    let removed = 0;

    if (days != null) {
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      const before = config.sessionHistory.length;
      config.sessionHistory.splice(0, config.sessionHistory.length,
        ...config.sessionHistory.filter(h => h.startedAt > cutoff));
      removed = before - config.sessionHistory.length;
    } else {
      removed = config.sessionHistory.length;
      config.sessionHistory.length = 0;
    }
    json(res, 200, { cleared: true, removed });
  });
}

function handleListSessions(req, res, config) {
  const sessions = [];
  for (const [id, s] of config.activeSessions) {
    sessions.push({
      id: s.id,
      prompt: s.prompt,
      source: s.source,
      agentSpec: s.agentSpec,
      startedAt: s.startedAt,
      parentId: s.parentId,
      scheduleId: s.scheduleId,
    });
  }
  json(res, 200, { sessions });
}

// ---------------------------------------------------------------------------
// YellyClaw PRG pattern
// ---------------------------------------------------------------------------
function handleYellyClaw(req, res, config) {
  const { PENDING_TTL_MS = 10 * 60 * 1000 } = config;
  const url = new URL(req.url, `http://localhost`);
  const initialPrompt = url.searchParams.get('initialPrompt');
  const agentSpec = url.searchParams.get('agentSpec') || '';
  const agentRepo = url.searchParams.get('agentRepo') || '';
  const sessionIdParam = url.searchParams.get('sessionId');

  if (initialPrompt) {
    // Step 1: generate token, redirect
    const token = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    config.pendingTokens.set(token, {
      prompt: initialPrompt,
      agentSpec,
      agentRepo,
      createdAt: Date.now(),
      claimed: false,
    });
    res.writeHead(302, { Location: `/yellyclaw?sessionId=${token}` });
    res.end();
    return;
  }

  if (sessionIdParam) {
    // Check if numeric (revisit after session complete)
    if (/^\d+$/.test(sessionIdParam)) {
      const numId = parseInt(sessionIdParam, 10);
      const session = config.activeSessions.get(numId) || config.sessionHistory.find(h => h.id === numId);
      if (!session) return json(res, 404, { error: 'session_not_found' });
      config.loadSessionOutput(session);
      const html = unifiedSessionPage({ ...session, PORT: config.PORT });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // Token claim
    const entry = config.pendingTokens.get(sessionIdParam);
    if (!entry) {
      res.writeHead(410, { 'Content-Type': 'text/html' });
      res.end('<h1>410 Gone</h1><p>Session token expired or not found.</p>');
      return;
    }
    if (Date.now() - entry.createdAt > PENDING_TTL_MS) {
      config.pendingTokens.delete(sessionIdParam);
      res.writeHead(410, { 'Content-Type': 'text/html' });
      res.end('<h1>410 Gone</h1><p>Session token expired.</p>');
      return;
    }
    if (entry.claimed) {
      // Session in progress — find it
      const mappedId = config.tokenToSessionId.get(sessionIdParam);
      const session = mappedId && (config.activeSessions.get(mappedId) || config.sessionHistory.find(h => h.id === mappedId));
      if (session) {
        config.loadSessionOutput(session);
        const html = unifiedSessionPage({ ...session, PORT: config.PORT });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Session In Progress</h1><p>Session is being processed.</p>');
      }
      return;
    }

    // Claim and start
    entry.claimed = true;
    const sessionId = runClaudeCode(
      entry.prompt, res, true,
      entry.agentSpec, null, null,
      null, false, config, [], 'browser', null, entry.agentRepo, null, sessionIdParam
    );
    return;
  }

  // Fallback: show manager
  const { serverManagerPage } = require('./manager');
  const html = serverManagerPage(config.PORT, config.CLAUDE_BIN, config.SESSION_DIR, config.SCHEDULE_FILE);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

// ---------------------------------------------------------------------------
// handleToken
// ---------------------------------------------------------------------------
function handleToken(req, res, config) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token: config.CSRF_TOKEN }));
}

// ---------------------------------------------------------------------------
// createRouter — main request handler
// ---------------------------------------------------------------------------
function createRouter(config) {
  return function handleRoutes(req, res) {
    const url = new URL(req.url, `http://localhost`);
    const pathname = url.pathname;
    const method = req.method;

    // OPTIONS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': req.headers['origin'] || '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-YellyClaw-Token',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (!config.validateSecurity(req, res)) return;

    // Route matching
    // GET /
    if (pathname === '/' && method === 'GET') {
      const { serverManagerPage } = require('./manager');
      const html = serverManagerPage(config.PORT, config.CLAUDE_BIN, config.SESSION_DIR, config.SCHEDULE_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // GET /yellyclaw
    if (pathname === '/yellyclaw' && method === 'GET') {
      return handleYellyClaw(req, res, config);
    }

    // GET /health
    if (pathname === '/health' && method === 'GET') {
      return json(res, 200, { status: 'ok', sessions: config.activeSessions.size });
    }

    // GET /token
    if (pathname === '/token' && method === 'GET') {
      return handleToken(req, res, config);
    }

    // GET /sessions
    if (pathname === '/sessions' && method === 'GET') {
      return handleListSessions(req, res, config);
    }

    // POST /run
    if (pathname === '/run' && method === 'POST') {
      return handleRun(req, res, config);
    }

    // GET /history
    if (pathname === '/history' && method === 'GET') {
      return handleHistory(req, res, config);
    }

    // POST /history/clear
    if (pathname === '/history/clear' && method === 'POST') {
      return handleClearHistory(req, res, config);
    }

    // GET /schedules
    if (pathname === '/schedules' && method === 'GET') {
      return handleSchedules(req, res, config);
    }

    // POST /schedules
    if (pathname === '/schedules' && method === 'POST') {
      const actionParam = url.searchParams.get('action');
      if (actionParam === 'batch-delete') {
        return readBody(req).then(body => {
          const ids = body.ids || [];
          let deleted = 0;
          for (const id of ids) {
            const idx = config.scheduledTasks.findIndex(s => s.id === id);
            if (idx >= 0) { config.scheduledTasks.splice(idx, 1); deleted++; }
          }
          config.saveSchedulesToLocal();
          json(res, 200, { deleted });
        });
      }
      return handleCreateSchedule(req, res, config);
    }

    // POST /schedules/:id/run
    const schedRunMatch = pathname.match(/^\/schedules\/([^/]+)\/run$/);
    if (schedRunMatch && method === 'POST') {
      return handleRunScheduleNow(req, res, schedRunMatch[1], config);
    }

    // POST /schedules/:id/run-until-no-error
    const schedRunUntilMatch = pathname.match(/^\/schedules\/([^/]+)\/run-until-no-error$/);
    if (schedRunUntilMatch && method === 'POST') {
      return handleRunUntilNoError(req, res, schedRunUntilMatch[1], config);
    }

    // POST /schedules/:id
    const schedMatch = pathname.match(/^\/schedules\/([^/]+)$/);
    if (schedMatch && method === 'POST') {
      const actionParam = url.searchParams.get('action');
      if (actionParam === 'delete') {
        return handleDeleteSchedule(req, res, schedMatch[1], config);
      }
      return handleUpdateSchedule(req, res, schedMatch[1], config);
    }

    // GET /sessions/:id/logs
    const sessionLogsMatch = pathname.match(/^\/sessions\/(\d+)\/logs$/);
    if (sessionLogsMatch && method === 'GET') {
      return handleSessionLogs(req, res, sessionLogsMatch[1], config);
    }

    // GET+POST /sessions/:id/input
    const sessionInputMatch = pathname.match(/^\/sessions\/(\d+)\/input$/);
    if (sessionInputMatch && (method === 'GET' || method === 'POST')) {
      return handleSessionInput(req, res, sessionInputMatch[1], config);
    }

    // POST /sessions/:id/kill
    const sessionKillMatch = pathname.match(/^\/sessions\/(\d+)\/kill$/);
    if (sessionKillMatch && method === 'POST') {
      return handleKillSession(req, res, sessionKillMatch[1], config);
    }

    // POST /sessions/:id/spawn
    const sessionSpawnMatch = pathname.match(/^\/sessions\/(\d+)\/spawn$/);
    if (sessionSpawnMatch && method === 'POST') {
      return handleSpawn(req, res, sessionSpawnMatch[1], config);
    }

    // POST /sessions/:id/rerun
    const sessionRerunMatch = pathname.match(/^\/sessions\/(\d+)\/rerun$/);
    if (sessionRerunMatch && method === 'POST') {
      return handleRerun(req, res, sessionRerunMatch[1], config);
    }

    // GET /sessions/:id/export
    const sessionExportMatch = pathname.match(/^\/sessions\/(\d+)\/export$/);
    if (sessionExportMatch && method === 'GET') {
      return handleSessionExport(req, res, sessionExportMatch[1], config);
    }

    // POST /sessions/:id/share
    const sessionShareMatch = pathname.match(/^\/sessions\/(\d+)\/share$/);
    if (sessionShareMatch && method === 'POST') {
      return handleSessionShare(req, res, sessionShareMatch[1], config);
    }

    // GET /sessions/:id/error-report
    const sessionErrorMatch = pathname.match(/^\/sessions\/(\d+)\/error-report$/);
    if (sessionErrorMatch && method === 'GET') {
      return handleSessionErrorReport(req, res, sessionErrorMatch[1], config);
    }

    // POST /feedback
    if (pathname === '/feedback' && method === 'POST') {
      return handleFeedback(req, res, config);
    }

    // POST /update
    if (pathname === '/update' && method === 'POST') {
      return handleUpdate(req, res, config);
    }

    // POST /stop
    if (pathname === '/stop' && method === 'POST') {
      return handleStop(req, res, config);
    }

    // POST /open-folder
    if (pathname === '/open-folder' && method === 'POST') {
      return handleOpenFolder(req, res, config);
    }

    // GET /agents
    if (pathname === '/agents' && method === 'GET') {
      return handleAgents(req, res, config);
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  };
}

module.exports = {
  createRouter,
  scheduleTick,
  runClaudeCode,
  handleRun,
  handleSpawn,
  handleRerun,
  handleSessionLogs,
  handleSessionInput,
  handleKillSession,
  handleSchedules,
  handleCreateSchedule,
  handleUpdateSchedule,
  handleDeleteSchedule,
  handleRunScheduleNow,
  handleRunUntilNoError,
  handleFeedback,
  handleUpdate,
  handleStop,
  handleAgents,
  installAgentIfAbsent,
  stripAnsi,
  autoRunUntilNoError,
  extractKeywords,
  getPreapprovedTools,
};
