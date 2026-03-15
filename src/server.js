'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config defaults (overridden by CLI flags / env vars)
// ---------------------------------------------------------------------------
const DEFAULT_PORT = 2026;
const DEFAULT_CLAUDE_BIN = 'claude-code';
const DEFAULT_SESSION_DIR = process.env.YELLYCLAW_SESSION_DIR || '/tmp/yellyclaw/sessions';
const DEFAULT_SESSION_TTL_DAYS = parseInt(process.env.YELLYCLAW_SESSION_TTL_DAYS || '7', 10);
const DEFAULT_SCHEDULE_FILE = path.join(os.homedir(), '.yellyclaw', 'schedules.yaml');
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
let CSRF_TOKEN = '';
let PORT = DEFAULT_PORT;
let CLAUDE_BIN = DEFAULT_CLAUDE_BIN;
let SESSION_DIR = DEFAULT_SESSION_DIR;
let SESSION_TTL_DAYS = DEFAULT_SESSION_TTL_DAYS;
let SCHEDULE_FILE = DEFAULT_SCHEDULE_FILE;
let SCHEDULE_REPO = process.env.YELLYCLAW_SCHEDULE_REPO || path.join(os.homedir(), '.yellyclaw', 'schedules-repo');
let ALIAS = process.env.YELLYCLAW_ALIAS || os.userInfo().username;
let INTERACTIVE = false;

// Session registry
let sessionCounter = 0;
const activeSessions = new Map();   // id → session object
const sessionHistory = [];           // max 50, newest first
const pendingTokens = new Map();     // token → { prompt, agentSpec, agentRepo, createdAt, claimed }
const tokenToSessionId = new Map();  // PRG token → numeric id
const pendingInputPrompts = new Map(); // sessionId → { question, timestamp }
const spawnChildCount = new Map();   // parentId → count
const scheduledTasks = [];           // loaded from YAML

// CORS
const ALLOWED_DOMAIN_PATTERNS = [
  'github.com',
  'gitlab.com',
  'localhost',
  '127.0.0.1',
];

// Rate limiting: origin → { count, resetAt }
const rateLimitMap = new Map();

// ---------------------------------------------------------------------------
// generateCsrfToken
// ---------------------------------------------------------------------------
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// validateSecurity
// ---------------------------------------------------------------------------
function validateSecurity(req, res) {
  // Host validation
  const host = req.headers['host'] || '';
  const hostname = host.split(':')[0];
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden_host' }));
    return false;
  }

  // CORS origin check
  const origin = req.headers['origin'];
  if (origin) {
    let allowed = false;
    try {
      const originHost = new URL(origin).hostname;
      for (const pat of ALLOWED_DOMAIN_PATTERNS) {
        if (originHost === pat || originHost.endsWith('.' + pat)) {
          allowed = true;
          break;
        }
      }
    } catch (_) { /* ignore */ }
    if (!allowed) {
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'null',
      });
      res.end(JSON.stringify({ error: 'forbidden_origin' }));
      return false;
    }
    // Add CORS headers for allowed origins
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-YellyClaw-Token');
  }

  // Rate limit: 100 req/min per origin
  const rateKey = origin || hostname;
  const now = Date.now();
  let rateEntry = rateLimitMap.get(rateKey);
  if (!rateEntry || now >= rateEntry.resetAt) {
    rateEntry = { count: 0, resetAt: now + 60000 };
    rateLimitMap.set(rateKey, rateEntry);
  }
  rateEntry.count++;
  if (rateEntry.count > 100) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'rate_limit_exceeded' }));
    return false;
  }

  // CSRF check for state-changing methods
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT' || req.method === 'PATCH') {
    const token = req.headers['x-yellyclaw-token'];
    if (!token || token !== CSRF_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_csrf_token' }));
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// preAllocateSession
// ---------------------------------------------------------------------------
function preAllocateSession() {
  const id = ++sessionCounter;
  const dateStr = new Date().toISOString().slice(0, 10);
  const workDir = path.join(SESSION_DIR, dateStr, `session-${id}`);
  fs.mkdirSync(workDir, { recursive: true });
  return { id, workDir };
}

// ---------------------------------------------------------------------------
// registerSession
// ---------------------------------------------------------------------------
function registerSession(prompt, proc, label, token, agentSpec, agentRepo, interactive, source, scheduleName, preAllocated, scheduleId) {
  const preId = preAllocated ? preAllocated.id : ++sessionCounter;
  const workDir = preAllocated ? preAllocated.workDir : (() => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const wd = path.join(SESSION_DIR, dateStr, `session-${preId}`);
    fs.mkdirSync(wd, { recursive: true });
    return wd;
  })();

  const session = {
    id: preId,
    prompt,
    source: source || 'browser',
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    killed: false,
    scheduleId: scheduleId || null,
    scheduleName: scheduleName || null,
    parentId: null,
    agentSpec: agentSpec || '',
    agentRepo: agentRepo || '',
    workDir,
    output: '',
    interactive: !!interactive,
    lastActivityAt: Date.now(),
    proc,
  };

  activeSessions.set(preId, session);
  if (token) tokenToSessionId.set(token, preId);

  // Back-fill session id into child env
  if (proc && proc.env) {
    proc.env.YELLYCLAW_SESSION_ID = String(preId);
  }

  // Wire stdout/stderr
  function onData(chunk) {
    const text = chunk.toString();
    session.output += text;
    session.lastActivityAt = Date.now();
    if (interactive) detectInputPrompt(preId, text);
  }

  if (proc.stdout) proc.stdout.on('data', onData);
  if (proc.stderr) proc.stderr.on('data', onData);

  proc.on('close', (code) => {
    activeSessions.delete(preId);
    pendingInputPrompts.delete(preId);

    const endedAt = Date.now();
    const histEntry = {
      id: preId,
      prompt,
      startedAt: session.startedAt,
      endedAt,
      durationSeconds: Math.round((endedAt - session.startedAt) / 1000),
      exitCode: session.killed ? null : code,
      killed: session.killed,
      output: session.output,
      agentSpec: agentSpec || '',
      agentRepo: agentRepo || '',
      source: source || 'browser',
      scheduleName: scheduleName || null,
      scheduleId: scheduleId || null,
      workDir,
      errorReport: null,
    };

    // Generate error report for failures
    if (code !== 0 && !session.killed) {
      histEntry.errorReport = generateErrorReport(session.output, code);
    }

    sessionHistory.unshift(histEntry);
    if (sessionHistory.length > 50) sessionHistory.length = 50;

    saveSessionToDisk(histEntry);

    // Update schedule state
    if (scheduleId) {
      const sched = scheduledTasks.find(s => s.id === scheduleId);
      if (sched) {
        sched.currentRunSessionId = null;
        sched.lastRunFailed = (code !== 0 && !session.killed);
        if (sched.autoPause && sched.lastRunFailed) {
          sched.enabled = false;
        }
        saveSchedulesToLocal();
      }
    }
  });

  return preId;
}

// ---------------------------------------------------------------------------
// detectInputPrompt
// ---------------------------------------------------------------------------
function detectInputPrompt(sessionId, text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const last = lines[lines.length - 1];
  const patterns = [
    /\?$/,
    /\:$/,
    /enter \w+/i,
    /input:/i,
    /provide \w+/i,
    /\(y\/n\)/i,
    /press enter/i,
    /continue\??/i,
  ];
  const matched = patterns.some(p => p.test(last));
  if (matched) {
    const session = activeSessions.get(sessionId);
    if (session) session.pendingInput = true;
    pendingInputPrompts.set(sessionId, { question: last, timestamp: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// saveSessionToDisk
// ---------------------------------------------------------------------------
function saveSessionToDisk(hist) {
  try {
    const dir = hist.workDir;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });

    // meta.yaml
    const meta = [
      `id: ${hist.id}`,
      `startedAt: ${new Date(hist.startedAt).toISOString()}`,
      `endedAt: ${hist.endedAt ? new Date(hist.endedAt).toISOString() : 'null'}`,
      `durationSeconds: ${hist.durationSeconds || 0}`,
      `exitCode: ${hist.exitCode != null ? hist.exitCode : 'null'}`,
      `killed: ${!!hist.killed}`,
      `agentSpec: ${hist.agentSpec || ''}`,
      `agentRepo: ${hist.agentRepo || ''}`,
      `source: ${hist.source || 'browser'}`,
      `scheduleName: ${hist.scheduleName || 'null'}`,
      `scheduleId: ${hist.scheduleId || 'null'}`,
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'meta.yaml'), meta, 'utf8');

    // prompt.txt
    fs.writeFileSync(path.join(dir, 'prompt.txt'), hist.prompt || '', 'utf8');

    // logs.txt (ANSI-stripped)
    fs.writeFileSync(path.join(dir, 'logs.txt'), stripAnsi(hist.output || ''), 'utf8');

    // error-report.md (only on failure)
    if (hist.errorReport && hist.exitCode !== 0 && !hist.killed) {
      const report = `# Error Report — Session #${hist.id}\n\n**Root Cause:** ${hist.errorReport.rootCause}\n\n**Resolution:** ${hist.errorReport.resolution}\n`;
      fs.writeFileSync(path.join(dir, 'error-report.md'), report, 'utf8');
    }
  } catch (err) {
    console.error('[saveSessionToDisk] error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// loadSessionsFromDisk
// ---------------------------------------------------------------------------
function loadSessionsFromDisk() {
  try {
    if (!fs.existsSync(SESSION_DIR)) return;
    const dateDirs = fs.readdirSync(SESSION_DIR)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();

    const entries = [];
    for (const dateDir of dateDirs) {
      const datePath = path.join(SESSION_DIR, dateDir);
      let sessionDirs;
      try { sessionDirs = fs.readdirSync(datePath); } catch (_) { continue; }
      for (const sd of sessionDirs) {
        const m = sd.match(/^session-(\d+)$/);
        if (!m) continue;
        const id = parseInt(m[1], 10);
        const diskDir = path.join(datePath, sd);
        // Read meta.yaml to get basic info
        let meta = {};
        try {
          const metaText = fs.readFileSync(path.join(diskDir, 'meta.yaml'), 'utf8');
          for (const line of metaText.split('\n')) {
            const colon = line.indexOf(':');
            if (colon < 0) continue;
            const k = line.slice(0, colon).trim();
            const v = line.slice(colon + 1).trim();
            meta[k] = v === 'null' ? null : v;
          }
        } catch (_) { /* no meta */ }

        // First line of prompt.txt as title
        let title = '';
        try {
          const promptText = fs.readFileSync(path.join(diskDir, 'prompt.txt'), 'utf8');
          title = promptText.split('\n')[0].slice(0, 100);
        } catch (_) { /* */ }

        entries.push({
          id,
          prompt: null, // lazy loaded
          output: null, // lazy loaded
          title,
          diskDir,
          startedAt: meta.startedAt ? new Date(meta.startedAt).getTime() : 0,
          endedAt: meta.endedAt ? new Date(meta.endedAt).getTime() : null,
          durationSeconds: meta.durationSeconds ? parseInt(meta.durationSeconds, 10) : 0,
          exitCode: meta.exitCode != null ? parseInt(meta.exitCode, 10) : null,
          killed: meta.killed === 'true',
          agentSpec: meta.agentSpec || '',
          agentRepo: meta.agentRepo || '',
          source: meta.source || 'browser',
          scheduleName: meta.scheduleName || null,
          scheduleId: meta.scheduleId || null,
          workDir: diskDir,
        });

        if (id > sessionCounter) sessionCounter = id;
        if (entries.length >= 50) break;
      }
      if (entries.length >= 50) break;
    }

    // Sort newest-first by id
    entries.sort((a, b) => b.id - a.id);

    for (const e of entries) {
      sessionHistory.push(e);
    }
  } catch (err) {
    console.error('[loadSessionsFromDisk] error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// loadSessionOutput — lazy-load on demand
// ---------------------------------------------------------------------------
function loadSessionOutput(hist) {
  if (hist.prompt !== null && hist.output !== null) return; // already loaded
  try {
    if (!hist.diskDir) return;
    if (hist.prompt === null) {
      try { hist.prompt = fs.readFileSync(path.join(hist.diskDir, 'prompt.txt'), 'utf8'); } catch (_) { hist.prompt = ''; }
    }
    if (hist.output === null) {
      try { hist.output = fs.readFileSync(path.join(hist.diskDir, 'logs.txt'), 'utf8'); } catch (_) { hist.output = ''; }
    }
  } catch (err) {
    console.error('[loadSessionOutput] error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// loadSchedules
// ---------------------------------------------------------------------------
function loadSchedules() {
  // Ensure dir exists
  const dir = path.dirname(SCHEDULE_FILE);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(SCHEDULE_FILE)) {
    // Optionally pull from git remote
    if (SCHEDULE_REPO && fs.existsSync(SCHEDULE_REPO)) {
      try {
        execSync('git pull --rebase', { cwd: SCHEDULE_REPO, stdio: 'ignore' });
        const remoteFile = path.join(SCHEDULE_REPO, 'schedules', `${ALIAS}.yaml`);
        if (fs.existsSync(remoteFile)) {
          fs.copyFileSync(remoteFile, SCHEDULE_FILE);
        }
      } catch (_) { /* ignore */ }
    }
    if (!fs.existsSync(SCHEDULE_FILE)) return;
  }

  try {
    const text = fs.readFileSync(SCHEDULE_FILE, 'utf8');
    const parsed = parseScheduleYaml(text);
    scheduledTasks.length = 0;
    for (const s of parsed) {
      scheduledTasks.push(normalizeSchedule(s));
    }
  } catch (err) {
    console.error('[loadSchedules] error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// parseScheduleYaml — minimal YAML parser for schedule format
// ---------------------------------------------------------------------------
function parseScheduleYaml(text) {
  const results = [];

  // Normalize: ensure each block item starts on its own line
  // Split on lines that start with "- " at column 0 (block list items)
  const lines = text.split('\n');
  const blockStartIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^- /.test(lines[i])) blockStartIndices.push(i);
  }
  if (!blockStartIndices.length) return results;

  for (let b = 0; b < blockStartIndices.length; b++) {
    const startLine = blockStartIndices[b];
    const endLine = blockStartIndices[b + 1] !== undefined ? blockStartIndices[b + 1] : lines.length;
    const blockLines = lines.slice(startLine, endLine);

    const obj = {};
    let currentKey = null;
    let inList = false;
    let listItems = [];
    let inMultilineStr = false;
    let multilineBaseIndent = -1;

    for (let i = 0; i < blockLines.length; i++) {
      const raw = blockLines[i];
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const indent = raw.match(/^(\s*)/)[1].length;

      // Handle multi-line block scalar (prompt: |)
      if (inMultilineStr) {
        if (indent > multilineBaseIndent) {
          obj[currentKey] = (obj[currentKey] || '') + trimmed + '\n';
          continue;
        } else {
          inMultilineStr = false;
          // Fall through to parse this line normally
        }
      }

      // Normalize block-item first line: "- key: val" → "key: val"
      let parseLine = trimmed;
      if (parseLine.startsWith('- ') && i === 0) {
        parseLine = parseLine.slice(2).trim();
      }

      // Detect sub-list items: lines starting with "- " that are NOT key-value
      const subListMatch = parseLine.match(/^- (.+)$/) && !parseLine.match(/^- \w[\w\-]*\s*:/);
      if (subListMatch && inList) {
        // extract value after "- "
        const val = parseLine.slice(2).trim().replace(/^["']|["']$/g, '');
        listItems.push(val);
        continue;
      }

      // Match key: value
      const kvMatch = parseLine.match(/^(\w[\w\-]*)\s*:\s?(.*)?$/);
      if (kvMatch) {
        if (inList && currentKey) { obj[currentKey] = listItems; inList = false; listItems = []; }
        currentKey = kvMatch[1];
        const rawVal = kvMatch[2] !== undefined ? kvMatch[2].trim() : '';

        if (rawVal === '|') {
          inMultilineStr = true;
          multilineBaseIndent = indent;
          obj[currentKey] = '';
        } else if (rawVal === '') {
          inList = true;
          listItems = [];
        } else if (rawVal === 'true') {
          obj[currentKey] = true;
        } else if (rawVal === 'false') {
          obj[currentKey] = false;
        } else if (rawVal === 'null') {
          obj[currentKey] = null;
        } else if (/^\d+$/.test(rawVal)) {
          obj[currentKey] = parseInt(rawVal, 10);
        } else if (/^\d+\.\d+$/.test(rawVal)) {
          obj[currentKey] = parseFloat(rawVal);
        } else {
          obj[currentKey] = rawVal.replace(/^["']|["']$/g, '');
        }
        continue;
      }

      // Sub-list items starting with "- " (for allowTools)
      const subListLine = raw.trim();
      if (subListLine.startsWith('- ') && inList) {
        const val = subListLine.slice(2).trim().replace(/^["']|["']$/g, '');
        listItems.push(val);
      }
    }

    if (inList && currentKey) obj[currentKey] = listItems;
    if (obj.id) results.push(obj);
  }
  return results;
}

// ---------------------------------------------------------------------------
// normalizeSchedule — ensure all runtime fields present
// ---------------------------------------------------------------------------
function normalizeSchedule(s) {
  const intervalMs = intervalToMs(s.interval);
  const result = Object.assign({
    id: s.id || `sched_${crypto.randomBytes(4).toString('hex')}`,
    name: s.name || '',
    prompt: s.prompt || '',
    agentSpec: '',
    interval: s.interval || '1d',
    enabled: s.enabled !== false,
    createdAt: s.createdAt || new Date().toISOString(),
    nextRunAt: s.nextRunAt ? (typeof s.nextRunAt === 'number' ? s.nextRunAt : new Date(s.nextRunAt).getTime()) : Date.now() + intervalMs,
    allowTools: Array.isArray(s.allowTools) ? s.allowTools : [],
    runLate: s.runLate || false,
    autoPause: s.autoPause !== undefined ? s.autoPause : true,
    lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).getTime() : null,
    lastRunFailed: s.lastRunFailed || false,
    runCount: s.runCount || 0,
    lastRunSessionId: s.lastRunSessionId || null,
    // Runtime only
    currentRunSessionId: null,
    intervalMs,
    cooldownMs: 0,
  }, s);
  // Enforce string type — YAML parser may produce an array for agentSpec
  if (Array.isArray(result.agentSpec)) result.agentSpec = '';
  if (Array.isArray(result.allowTools) === false) result.allowTools = [];
  return result;
}

// ---------------------------------------------------------------------------
// intervalToMs
// ---------------------------------------------------------------------------
function intervalToMs(interval) {
  const map = { '30m': 30*60*1000, '1h': 60*60*1000, '6h': 6*60*60*1000, '12h': 12*60*60*1000, '1d': 24*60*60*1000, '1w': 7*24*60*60*1000, 'once': 0 };
  return interval in map ? map[interval] : 24*60*60*1000;
}

// ---------------------------------------------------------------------------
// saveSchedulesToLocal
// ---------------------------------------------------------------------------
function saveSchedulesToLocal() {
  try {
    const dir = path.dirname(SCHEDULE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const yaml = scheduleTasksToYaml(scheduledTasks);
    fs.writeFileSync(SCHEDULE_FILE, yaml, 'utf8');
  } catch (err) {
    console.error('[saveSchedulesToLocal] error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// scheduleTasksToYaml
// ---------------------------------------------------------------------------
function scheduleTasksToYaml(tasks) {
  const lines = [];
  for (const s of tasks) {
    lines.push(`- id: ${s.id}`);
    lines.push(`  name: ${s.name || ''}`);
    lines.push(`  prompt: |`);
    for (const line of (s.prompt || '').split('\n')) {
      lines.push(`    ${line}`);
    }
    lines.push(`  agentSpec: ${s.agentSpec || ''}`);
    lines.push(`  interval: ${s.interval || '1d'}`);
    lines.push(`  enabled: ${!!s.enabled}`);
    lines.push(`  createdAt: ${s.createdAt || new Date().toISOString()}`);
    lines.push(`  nextRunAt: ${s.nextRunAt ? new Date(s.nextRunAt).toISOString() : 'null'}`);
    lines.push(`  allowTools:`);
    for (const t of (s.allowTools || [])) lines.push(`  - "${t}"`);
    lines.push(`  runLate: ${s.runLate || false}`);
    lines.push(`  autoPause: ${s.autoPause !== undefined ? s.autoPause : true}`);
    lines.push(`  lastRunAt: ${s.lastRunAt ? new Date(s.lastRunAt).toISOString() : 'null'}`);
    lines.push(`  lastRunFailed: ${!!s.lastRunFailed}`);
    lines.push(`  runCount: ${s.runCount || 0}`);
    lines.push(`  lastRunSessionId: ${s.lastRunSessionId || 'null'}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// syncSchedulesToGit
// ---------------------------------------------------------------------------
function syncSchedulesToGit() {
  if (!SCHEDULE_REPO || !fs.existsSync(SCHEDULE_REPO)) return;
  try {
    execSync('git pull --rebase', { cwd: SCHEDULE_REPO, stdio: 'ignore' });
    const remoteDir = path.join(SCHEDULE_REPO, 'schedules');
    fs.mkdirSync(remoteDir, { recursive: true });
    const remoteFile = path.join(remoteDir, `${ALIAS}.yaml`);
    fs.copyFileSync(SCHEDULE_FILE, remoteFile);
    execSync(`git add schedules/${ALIAS}.yaml`, { cwd: SCHEDULE_REPO, stdio: 'ignore' });
    execSync(`git commit -m "sync schedules for ${ALIAS}"`, { cwd: SCHEDULE_REPO, stdio: 'ignore' });
    execSync('git push', { cwd: SCHEDULE_REPO, stdio: 'ignore' });
  } catch (_) { /* ignore git errors */ }
}

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------
function stripAnsi(s) {
  return s
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[^[\]]/g, '')
    .replace(/\x1b/g, '');
}

// ---------------------------------------------------------------------------
// generateErrorReport
// ---------------------------------------------------------------------------
function generateErrorReport(output, exitCode) {
  if (exitCode === 0) return null;
  const text = (output || '').toLowerCase();

  if (/tool approval required but --no-interactive/.test(text)) {
    return { rootCause: 'Tool requires approval, non-interactive mode', resolution: 'Enable --trust-all-tools in schedule', autoFix: { type: 'add-tool', tool: '*' } };
  }
  const toolNotApproved = text.match(/tool '([^']+)' not approved|tool '([^']+)' requires approval/);
  if (toolNotApproved) {
    const tool = toolNotApproved[1] || toolNotApproved[2];
    return { rootCause: `Named tool not in allowed list`, resolution: `Add '${tool}' to schedule's Additional Tools`, autoFix: { type: 'add-tool', tool } };
  }
  const approvalReversed = text.match(/approval required[^']*'([^']+)'/);
  if (approvalReversed) {
    const tool = approvalReversed[1];
    return { rootCause: `Named tool not in allowed list`, resolution: `Add '${tool}' to schedule's Additional Tools`, autoFix: { type: 'add-tool', tool } };
  }
  if (/permission denied.*exec|eacces.*exec/.test(text)) {
    return { rootCause: 'Shell execution blocked', resolution: "Add 'Bash' to Additional Tools", autoFix: { type: 'add-tool', tool: 'Bash' } };
  }
  if (/claude-code.*command not found|no such file/.test(text)) {
    return { rootCause: 'CLI binary not found on PATH', resolution: 'Verify claude-code installed and in PATH', autoFix: null };
  }
  if (/rate limit|429|quota exceeded/.test(text)) {
    return { rootCause: 'API rate limit exceeded', resolution: 'Wait or reduce schedule frequency', autoFix: null };
  }
  return { rootCause: `Session exited with code ${exitCode}`, resolution: 'Review session logs', autoFix: null };
}

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------
function startServer(config) {
  PORT = config.port || DEFAULT_PORT;
  CLAUDE_BIN = config.claude || DEFAULT_CLAUDE_BIN;
  SESSION_DIR = config.sessionDir || DEFAULT_SESSION_DIR;
  SESSION_TTL_DAYS = config.sessionTtlDays || DEFAULT_SESSION_TTL_DAYS;
  SCHEDULE_FILE = config.scheduleFile || DEFAULT_SCHEDULE_FILE;
  SCHEDULE_REPO = config.repo || SCHEDULE_REPO;
  ALIAS = config.alias || ALIAS;
  INTERACTIVE = !!config.interactive;

  // Generate CSRF token
  CSRF_TOKEN = generateCsrfToken();

  // Load preapproval rules
  let preapprovalRules = {};
  const rulesPath = path.join(__dirname, '..', 'v2', 'preapproval-rules.json');
  try {
    if (fs.existsSync(rulesPath)) {
      preapprovalRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    }
  } catch (_) { /* ignore */ }

  // Build the server with config context
  const { createRouter } = require('./routes');
  const serverConfig = {
    PORT, CLAUDE_BIN, SESSION_DIR, SESSION_TTL_DAYS, SCHEDULE_FILE,
    CSRF_TOKEN, activeSessions, sessionHistory, scheduledTasks,
    pendingTokens, tokenToSessionId, pendingInputPrompts, spawnChildCount,
    INTERACTIVE, preapprovalRules,
    validateSecurity, registerSession, preAllocateSession,
    saveSessionToDisk, loadSessionOutput, stripAnsi, generateErrorReport,
    saveSchedulesToLocal, scheduleTasksToYaml, intervalToMs, normalizeSchedule,
    SCHEDULE_REPO, ALIAS,
  };

  const server = http.createServer(createRouter(serverConfig));

  server.listen(PORT, '127.0.0.1', () => {
    // Startup banner
    console.log(`\n🦀 YellyClaw server running at http://localhost:${PORT}`);
    console.log(`   CSRF token: ${CSRF_TOKEN}`);
    console.log(`   Session dir: ${SESSION_DIR}`);
    console.log(`   Schedule file: ${SCHEDULE_FILE}`);
    console.log(`   Claude bin: ${CLAUDE_BIN}\n`);
  });

  // Load sessions from disk
  loadSessionsFromDisk();

  // Load schedules
  loadSchedules();

  // Schedule tick every 30s
  const { scheduleTick } = require('./routes');
  setInterval(() => scheduleTick(serverConfig), 30000);

  // Idle/TTL cleanup tick every 60s
  setInterval(() => {
    const now = Date.now();
    const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 min
    for (const [id, session] of activeSessions) {
      if (now - session.lastActivityAt > IDLE_TIMEOUT) {
        session.killed = true;
        if (session.proc) try { session.proc.kill('SIGTERM'); } catch (_) {}
      }
    }
  }, 60000);

  // Graceful shutdown
  function shutdown() {
    console.log('\n[YellyClaw] Shutting down…');
    saveSchedulesToLocal();
    try { syncSchedulesToGit(); } catch (_) {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('uncaughtException', err => {
    console.error('[uncaughtException]', err.message);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

  return server;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const config = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port': config.port = parseInt(args[++i], 10); break;
      case '--claude': config.claude = args[++i]; break;
      case '--interactive': config.interactive = true; break;
      case '--repo': config.repo = args[++i]; break;
      case '--alias': config.alias = args[++i]; break;
      case '--session-dir': config.sessionDir = args[++i]; break;
      case '--session-ttl-days': config.sessionTtlDays = parseInt(args[++i], 10); break;
      case '--trust-tools': config.trustTools = args[++i].split(','); break;
    }
  }

  startServer(config);
}

module.exports = {
  startServer,
  validateSecurity,
  registerSession,
  preAllocateSession,
  saveSessionToDisk,
  loadSessionsFromDisk,
  loadSessionOutput,
  loadSchedules,
  saveSchedulesToLocal,
  syncSchedulesToGit,
  stripAnsi,
  generateErrorReport,
  parseScheduleYaml,
  normalizeSchedule,
  intervalToMs,
  scheduleTasksToYaml,
  // State accessors (for routes.js)
  getState: () => ({
    PORT, CLAUDE_BIN, SESSION_DIR, SESSION_TTL_DAYS, SCHEDULE_FILE,
    CSRF_TOKEN, activeSessions, sessionHistory, scheduledTasks,
    pendingTokens, tokenToSessionId, pendingInputPrompts, spawnChildCount,
    INTERACTIVE, SCHEDULE_REPO, ALIAS,
  }),
};
