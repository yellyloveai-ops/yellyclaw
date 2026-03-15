# YellyClaw — Build Spec


*YellyClaw is a local AI agent runtime server. You run it on your laptop; it executes Claude Code sessions on demand, on a schedule, or triggered by a web UI. Think of it as a personal cron-meets-agent-orchestrator.*


---


## [Overview]


YellyClaw is a standalone Node.js HTTP server (default port **2026**) that wraps the `claude-code` CLI into a managed session runtime. It provides:


- A **web UI** (Server Manager) for launching, monitoring, and scheduling agent sessions
- A **REST API** consumed by the YellyRock browser extension to run skills locally
- A **scheduler** for recurring or one-time agent tasks
- **Self-spawn** support so a running agent can create child sessions
- A **self-evolution** ("Evolve Me") flow where the AI improves YellyClaw's own source code


The server is intentionally simple: no database, no auth beyond a per-process CSRF token, sessions stored as flat files under `/tmp/yellyrock/sessions/`.


---


## [Architecture]


```
server.js          → HTTP server, CORS/CSRF/rate-limit, session registry, file I/O
routes.js          → All route handlers, claude-code execution, schedule tick
manager.js         → Server Manager UI (HTML generation, ~1500 lines)
session.js         → HTML page generators (unifiedSessionPage, streamingSessionPage)
shared.js          → HTML helpers, CSS, shared UI components
client.js          → Re-exports (thin shim for browser extension integration)
```


### Request lifecycle


```
Browser / YellyRock extension
 → POST /run  (prompt + options)
 → server.js validates CORS + CSRF + rate limit
 → routes.js: runClaudeCode(prompt, ...) spawns child process
 → session registered → YELLYCLAW_SESSION_ID back-filled into child env
 → stdout/stderr streamed to /tmp/yellyrock/sessions/<date>/<id>/logs.txt
 → GET /sessions/:id/logs streams output to browser
```


### PRG (Post-Redirect-Get) pattern for `/yellyrock`


Used when YellyRock extension opens a session via browser:


```
1. GET /yellyrock?initialPrompt=<text>&agentSpec=<name>&agentRepo=<repo>
  → server generates short token (timestamp36 + random6)
  → stores in pendingTokens Map: { prompt, agentSpec, agentRepo, createdAt, claimed:false }
  → 302 redirect to /yellyrock?sessionId=<token>


2. GET /yellyrock?sessionId=<token>
  → claimToken(token): marks claimed=true, returns entry (or null if expired/missing)
  → if already claimed: show "Session In Progress" page
  → if token expired (>10 min): 410 Gone
  → else: call runClaudeCode(prompt, res, asHtml=true, ...)
    → sends streamingSessionPage HTML immediately
    → browser polls /sessions/:id/logs every 2000ms


3. GET /yellyrock?sessionId=<numericId>  (revisit after session completes)
  → tokenToSessionId.get(token) → numeric id
  → serve unifiedSessionPage for active or history entry
```


Token TTL: 10 minutes (`PENDING_TTL_MS = 10 * 60 * 1000`). Tokens are never reused (claimed flag).


---


## [Types]


### Session object


```js
{
 id: Number,           // auto-increment
 prompt: String,       // full prompt text
 source: 'browser' | 'schedule' | 'spawn',
 startedAt: Number,    // epoch ms
 endedAt: Number,      // epoch ms (null while running)
 exitCode: Number,     // null while running
 killed: Boolean,
 scheduleId: String,   // null if not from a schedule
 parentId: Number,     // null if not spawned
 agentSpec: String,    // agent spec name, e.g. 'yellyrock-default'
 workDir: String,      // /tmp/yellyrock/sessions/YYYY-MM-DD/session-<id>/
}
```


### Schedule object


```js
{
 id: String,           // uuid
 name: String,         // max 40 chars
 prompt: String,
 interval: '30m' | '1h' | '6h' | '12h' | '1d' | '1w' | 'once',
 nextRunAt: Number,    // epoch ms
 lastRunAt: Number,
 lastRunSessionId: Number,
 lastRunFailed: Boolean,
 currentRunSessionId: Number,  // null if not running
 runCount: Number,
 enabled: Boolean,
 autoPause: Boolean,   // pause on failure
 runLate: Boolean,     // run if missed (one-time only)
 allowTools: String[], // extra tool flags for claude-code
 agentSpec: String,    // agent spec name
 cooldownMs: Number,   // ms remaining before manual re-trigger allowed
}
```


### Environment variables injected into every claude-code child process


| Variable | Value | Purpose |
|---|---|---|
| `YELLYCLAW_SESSION_ID` | numeric session id | This session's own id |
| `YELLYCLAW_PORT` | `2026` | Server port |
| `YELLYCLAW_TOKEN` | CSRF token | Required for POST requests back to server |
| `YELLYCLAW_PARENT_ID` | parent session id or `""` | Set when spawned by another session |


---


## [Files]


```
src/
 server.js          → HTTP server entry point
 routes.js          → Route handlers + claude-code execution
 manager.js         → Server Manager page HTML
 session.js         → Session model + file helpers
 shared.js          → Shared HTML/CSS utilities
 client.js          → Thin re-export shim
context/
 self-spawn.md      → Self-spawn API reference (injected into agent context)
 non-interactive-mode.md  → Agent behavior guidelines
 sandbox-control.md → Workspace isolation guidelines
 system-prompt.md   → Base system prompt for sessions
 trust-and-verify-policy.md → Tool trust policy
v2/
 preapproval-rules.json  → URL-pattern → tool preapproval rules
 settings.js             → yellyclawUrl config (default http://localhost:2026)
```


### Session storage layout


```
/tmp/yellyrock/sessions/
 YYYY-MM-DD/
   session-<id>/
     meta.yaml        → id, startedAt, endedAt, durationSeconds, exitCode, killed,
                         agentSpec, agentRepo, source, scheduleName, scheduleId
     prompt.txt       → full prompt text (plain, no YAML encoding)
     logs.txt         → ANSI-stripped stdout+stderr (written on session close)
     error-report.md  → "# Error Report — Session #N\n**Root Cause:** ...\n**Resolution:** ..."
                         (only written for failed sessions, exitCode !== 0 && !killed)
```


**`saveSessionToDisk(hist)`** writes all 3 files on session close. `logs.txt` is ANSI-stripped via `stripAnsi()`. `agentSpec` stored as the agent name; `agentRepo` stored separately when present.


**`loadSessionsFromDisk()`** on startup: reads newest-first up to 50 sessions, populates `sessionHistory` with lazy entries (`prompt: null, output: null, diskDir: <path>`). First line of `prompt.txt` used as `title`. `sessionCounter` advanced past highest loaded id.


**`loadSessionOutput(hist)`** lazy-loads on demand (called by `/sessions/:id/logs`, `/sessions/:id/export`, `/sessions/:id/error-report`): reads `prompt.txt` + `logs.txt` into `hist.prompt` / `hist.output`. No-op if already loaded.


### Schedule storage


Schedules are persisted to `~/.yellyrock/schedules.yaml` (local, always written on every mutation). An optional git-backed remote file at `<SCHEDULE_REPO>/schedules/<ALIAS>.yaml` is synced on startup (pull) and graceful shutdown (push). On first startup with no local file, remote is pulled and merged.


**YAML format** (one block per schedule, separated by `- `):
```yaml
- id: sched_1
 name: Check GitHub issues daily
 prompt: |
   Review my open GitHub issues and summarize action items.
 agentSpec: yellyrock-default
 interval: 1d
 enabled: true
 createdAt: 2026-03-01T09:00:00.000Z
 nextRunAt: 2026-03-15T09:00:00.000Z
 allowTools:
 - "shell"
 autoPause: true
 runLate: null
 lastRunAt: 2026-03-14T09:00:00.000Z
 lastRunFailed: false
 runCount: 13
 lastRunSessionId: 42
```


Persisted keys: `id, name, prompt, agentSpec, interval, enabled, createdAt, nextRunAt, allowTools, runLate, autoPause, lastRunAt, lastRunFailed, runCount, lastRunSessionId`. Runtime-only fields (`currentRunSessionId`, `intervalMs`, `cooldownMs`) are NOT persisted.


---


## [Functions]


### `server.js`


| Function | Purpose |
|---|---|
| `startServer(port)` | Create HTTP server, load schedules, start schedule tick |
| `validateSecurity(req, res)` | CORS origin check, CSRF token check, rate limit (100 req/min/origin) |
| `registerSession(...)` | Full session wiring: allocate id, add to `activeSessions`, tee stdout/stderr, handle close (see [registerSession Internals]) |
| `preAllocateSession()` | Reserve id + create workDir before spawn |
| `saveSessionToDisk(hist)` | Write meta.yaml, prompt.txt, logs.txt (ANSI-stripped) |
| `loadSessionsFromDisk()` | Populate `sessionHistory` with lazy entries on startup |
| `loadSessionOutput(hist)` | Lazy-load prompt.txt + logs.txt on demand |
| `loadSchedules()` | Load local YAML; optionally pull from git remote |
| `saveSchedulesToLocal()` | Write `~/.yellyrock/schedules.yaml` |
| `syncSchedulesToGit()` | git pull + write + git push on graceful shutdown |
| *(inlined)* `moveToHistory(session)` | Remove from active, push to `sessionHistory` (max 50) — inlined in `registerSession` close handler |
| *(inlined)* `generateCsrfToken()` | `crypto.randomBytes(32).toString('hex')` — called once at startup |


### `routes.js`


| Function | Purpose |
|---|---|
| `handleRoutes(req, res)` | Main router — pattern-match path → handler |
| `runClaudeCode(prompt, res, stream, agentSpec, scheduleId, parentId, title, interactive, config)` | Spawn `claude-code` child process, wire stdout/stderr, return sessionId |
| `handleRun(req, res)` | POST /run — parse body, call runClaudeCode |
| `handleSpawn(req, res)` | POST /sessions/:id/spawn — child session, max 5 per parent |
| `handleRerun(req, res)` | POST /sessions/:id/rerun — clone session with same prompt |
| `handleSessionLogs(req, res)` | GET /sessions/:id/logs — stream or JSON |
| `handleSessionInput(req, res)` | GET+POST /sessions/:id/input — interactive stdin |
| `handleKillSession(req, res)` | POST /sessions/:id/kill — SIGTERM child |
| `handleSchedules(req, res)` | GET /schedules — list all |
| `handleCreateSchedule(req, res)` | POST /schedules — create |
| `handleUpdateSchedule(req, res)` | POST /schedules/:id — edit |
| `handleDeleteSchedule(req, res)` | POST /schedules/:id?action=delete |
| `handleRunScheduleNow(req, res)` | POST /schedules/:id/run — immediate trigger |
| `handleRunUntilNoError(req, res)` | POST /schedules/:id/run-until-no-error — auto-fix loop |
| `installAgentIfAbsent(agentName)` | Check agent list; install if missing (called by autoRunUntilNoError) |
| `stripAnsi(s)` | Remove ANSI escape codes from output string |
| `handleEvolve(req, res)` | POST /evolve — launch claude-code to improve YellyClaw source |
| `handleUpdate(req, res)` | POST /update — git pull + restart |
| `handleStop(req, res)` | POST /stop — graceful shutdown |
| `scheduleTick()` | Called every 30s — fire due schedules, clean idle sessions (30 min timeout), purge old session files (7 days) |


### `manager.js` (Server Manager UI)


| Function | Purpose |
|---|---|
| `serverManagerPage(PORT, CLAUDE_BIN, WORK_DIR, SCHEDULE_FILE)` | Returns full HTML page string |
| `getManagerPageStyles()` | Catppuccin Mocha dark theme CSS |
| `renderToolbar()` | Top bar: title `🦀 YellyClaw`, health/update/evolve/stop buttons |
| `renderTabs()` | Tab bar: Home (schedules + sessions split), Evolve, per-session tabs |
| `renderEvolvePanel()` | Evolve Me feedback form + history |
| `renderFooter(PORT, CLAUDE_BIN, WORK_DIR, SCHEDULE_FILE)` | Bottom bar with file links |
| `QUICK_ADD_SCHEDULE_SCRIPT` | Browser-side JS: natural-language → AI creates schedule via POST /schedules |
| `LOG_TAIL_TOOLTIP_SCRIPT` | Browser-side JS: hover session row → fetch last 10 log lines as tooltip |


### `session.js`


> **Note**: `session.js` contains only the two HTML page generators. All file I/O (meta.yaml, logs.txt) is handled inline in `server.js` via `saveSessionToDisk`, `loadSessionsFromDisk`, and `loadSessionOutput`.


| Function | Purpose |
|---|---|
| `unifiedSessionPage(opts)` | Full session detail page HTML (running or completed); polls every 3000ms |
| `streamingSessionPage(opts, sessionId)` | Lightweight page sent immediately on session start; polls every 2000ms |


### `shared.js`


| Function | Purpose |
|---|---|
| `escHtml(s)` | XSS-safe HTML escaping |
| `shortenPath(p)` | Replace home dir with `~` |
| `renderSourceBadge(source)` | `⏰ schedule` / `🌱 spawned` / `🌐 browser` pill |
| `renderSessionPage(opts)` | Full session page HTML shell |
| `getSessionPageStyles()` | Dark theme CSS for session pages |
| `renderPromptPanel(prompt, agent, repo)` | Left panel with prompt + copy buttons |
| `renderFooter(PORT, opts)` | Session page footer |
| `renderOpenFolderScript()` | JS snippet: POST /open-folder to open in Finder |
| `COPY_BASH_SCRIPT` | Browser-side JS: copy prompt as `claude-code` CLI command |


---


## [Key Routes Reference]


| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/` or `/yellyrock` | GET | — | Server Manager UI |
| `/run` | POST | CSRF | Execute prompt, return `{sessionId}` |
| `/health` | GET | — | `{status:'ok', sessions:N}` |
| `/token` | GET | — | Fetch CSRF token for browser JS |
| `/sessions` | GET | — | List active sessions |
| `/sessions/:id/logs` | GET | — | View session (HTML or JSON via Accept header) |
| `/sessions/:id/input` | GET/POST | CSRF (POST) | Interactive stdin |
| `/sessions/:id/spawn` | POST | CSRF | Create child session (max 5) |
| `/sessions/:id/rerun` | POST | CSRF | Clone session |
| `/sessions/:id/kill` | POST | CSRF | SIGTERM |
| `/sessions/:id/export` | GET | — | Export as JSON/markdown/text |
| `/sessions/:id/share` | POST | CSRF | Share to paste service |
| `/history` | GET | — | Completed sessions (max 50) |
| `/history/clear` | POST | CSRF | Clear history |
| `/schedules` | GET | — | List schedules |
| `/schedules` | POST | CSRF | Create schedule |
| `/schedules/:id` | POST | CSRF | Update schedule fields OR toggle `enabled` (pause/resume) |
| `/schedules/:id/run` | POST | CSRF | Trigger now (60s cooldown) |
| `/schedules/:id/run-until-no-error` | POST | CSRF | Auto-fix loop |
| `/evolve` | POST | CSRF | Self-improvement session |
| `/update` | POST | CSRF | git pull + restart |
| `/stop` | POST | CSRF | Shutdown |
| `/open-folder` | POST | CSRF | Open path in OS file manager |
| `/agents` | GET | — | List available agent specs |


---


## [Security Model]


- **CORS**: Allowed origins loaded from YellyRock `@match` patterns at startup
- **CSRF**: Single per-process token in `X-YellyRock-Token` header; required for all POST/DELETE
- **Rate limit**: 100 requests/minute per origin (in-memory counter, reset every 60s)
- **Host validation**: Only `localhost` / `127.0.0.1` accepted
- **Tool preapproval**: `v2/preapproval-rules.json` maps URL patterns + prompt keywords → allowed tools; never use `--dangerously-skip-permissions`
- **Child session limit**: Max 5 spawned children per parent session


---


## [Self-Spawn API]


A running session can create child sessions:


```bash
curl -s -X POST \
 -H "Content-Type: application/json" \
 -H "X-YellyRock-Token: $YELLYCLAW_TOKEN" \
 -d '{"prompt":"Do subtask X"}' \
 "http://localhost:$YELLYCLAW_PORT/sessions/$YELLYCLAW_SESSION_ID/spawn"
# → {"sessionId":42,"parentId":7,"logsUrl":"/sessions/42/logs"}
```


Constraints: max 5 children per parent, child inherits `agentSpec`, idle timeout (30 min) applies independently.


---


## [Evolve Me Flow]


The Evolve Me panel lets users describe improvements in plain English. On submit:


1. Browser POSTs feedback to `/evolve`
2. Server builds a structured prompt: *"You are an AI agent improving YellyClaw… implement the change, check guardrails, raise a PR"*
3. A new claude-code session is spawned with that prompt
4. Session opens in a new tab in the Server Manager UI
5. Feedback text + timestamp saved to `localStorage` under `yellyclaw_evolve_text` / `yellyclaw_evolve_history` (max 5 entries)


---


## [Scheduler]


- Tick runs every **30 seconds** via `setInterval`
- On each tick: find schedules where `enabled && nextRunAt <= now && !currentRunSessionId`
- After run: update `lastRunAt`, `lastRunSessionId`, advance `nextRunAt` by interval
- `autoPause: true` → set `enabled = false` if session exits non-zero
- One-time schedules (`interval: 'once'`) are disabled after first run
- **Cooldown**: 60s after manual trigger before another manual trigger is allowed
- **Mac sleep**: tick freezes during sleep; on wake, missed schedules fire immediately (tick checks `nextRunAt > now` — if overdue, fires once then advances)


---


## [localStorage Keys] (browser-side, Server Manager UI)


| Key | Purpose |
|---|---|
| `yellyclaw_evolve_text` | Draft feedback textarea (persists across page reloads) |
| `yellyclaw_evolve_history` | Last 5 submitted feedbacks (shown in Evolve panel) |


---


## [claude-code CLI Integration]


### Command construction (`runClaudeCode`)


```
claude -p [--dangerously-skip-permissions | --allowedTools <list>] [--agent <name>] -- <prompt>
```


| Arg | When | Value |
|-----|------|-------|
| `-p` | always | print/non-interactive mode; suppresses tool approval prompts |
| `--allowedTools <list>` | default | comma-joined list of pre-approved tools |
| `--dangerously-skip-permissions` | `allowTools` includes `'*'` | bypasses all approval — use with caution |
| `--agent <name>` | `agentSpec` set | e.g. `yellyrock-default` |
| `-- <prompt>` | always | end-of-flags separator followed by prompt text |


### Tool preapproval pipeline


```
prompt text
 → extractKeywords(prompt)          // split on whitespace, filter len>2
 → getPreapprovedTools(url, kws)    // match v2/preapproval-rules.json
 → baseTools (always trusted):
     shell
     read_file
     write_file
 → scheduleTools (from schedule.allowTools[])
 → dedup → --allowedTools a,b,c
```


If `scheduleTools` contains `'*'` → use `--dangerously-skip-permissions` instead (skips `--allowedTools`).


### Process spawn


```js
spawn(CLAUDE_BIN, args, {
 shell: false,           // never use shell: true (injection risk)
 cwd: sessionWorkDir,    // isolated per-session dir under /tmp/yellyrock/sessions/
 env: {
   ...process.env,
   YELLYCLAW_SESSION_ID: '<back-filled after registerSession>',
   YELLYCLAW_PORT: '2026',
   YELLYCLAW_TOKEN: '<csrf-token>',
   YELLYCLAW_PARENT_ID: '<parent id or "">',
 }
})
```


`YELLYCLAW_SESSION_ID` is a placeholder at spawn time; back-filled into `proc.env` immediately after `registerSession()` returns the real id.


### Output streaming — two modes


**Mode A: API/JSON (`asHtml=false`)** — used by POST /run, schedules, evolve
```
proc.stdout.on('data', chunk => { process.stdout.write(chunk); res.write(chunk); })
proc.stderr.on('data', chunk => { process.stderr.write(chunk); res.write(chunk); })
proc.on('close', code => res.end(`\n[done] exit code: ${code}`))
```
- Raw bytes forwarded directly to HTTP response (chunked transfer)
- `registerSession()` in `server.js` also tees output to in-memory buffer + `logs.txt`


**Mode B: HTML polling (`asHtml=true`)** — used by GET /yellyrock (browser entry)
```
1. res.end(streamingSessionPage(...))   // send HTML immediately, close response
2. proc output → registerSession tee → in-memory buffer + logs.txt
3. Browser polls GET /sessions/:id/logs every 2000ms
4. On exitCode present → clearInterval, show Done/Failed status
```


### Output filtering (efficiency)


`shouldSuppressOutput(chunk, lastOutput)` drops:
- Spinner lines matching `/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+Thinking/` — avoids flooding buffer with progress ticks
- Exact duplicate of previous chunk — deduplication


ANSI escape codes stripped before storing/displaying: `stripAnsi(s)` removes `\x1b[...m`, `\x1b]...\x07`, and bare `\x1b` sequences.


### Add-schedule-with-AI flow (Quick Add)


```
User types: "check my GitHub issues every day at 9am"
 → Browser fetches GET /token → {token}
 → Builds prompt:
     "You are a schedule-creation assistant for YellyClaw.
      The user wants: '<text>'
      Run this curl to create the schedule:
        curl -X POST http://localhost:2026/schedules
          -H 'X-YellyRock-Token: <token>'
          -d '{name, prompt, interval, nextRunAt, autoPause:true}'
      Field rules: interval mapping, nextRunAt from user's time hint, ..."
 → POST /run {prompt, allowTools:['shell']}  ← shell needed for curl
 → Returns {sessionId}
 → Opens session tab; polls every 5s to reload schedule list (6 polls)
```


The AI parses natural language → calls the REST API itself → schedule appears in UI.


---


## [UI Details]


### Server Manager page (`GET /`)


Single-page app rendered server-side as one HTML string. No framework — vanilla JS + DOM.


**Layout:**
```
┌─ toolbar ──────────────────────────────────────────────────────┐
│ 🦀 YellyClaw   ⏳ status   [💚 health] [⬆️ Update] [🔮 Evolve] [⏹ Stop] │
├─ tab bar ──────────────────────────────────────────────────────┤
│ [🏠 Home] [🔮 Evolve] [📄 #42 ✕] [📄 #43 ✕] ...              │
├─ panel-schedules (50%) ─┬─ resizer ─┬─ panel-sessions (50%) ──┤
│  Quick-add input + btn  │     ║     │  ⚡ ACTIVE SESSIONS      │
│  ➕ Manual              │     ║     │  🕑 COMPLETED SESSIONS   │
│  schedule table         │     ║     │  🧹 auto-cleanup note    │
├─────────────────────────┴───────────┴──────────────────────────┤
│ footer: localhost:2026 · claude-code · 📅 schedules · 📁 sessions │
└────────────────────────────────────────────────────────────────┘
```


Resizer between panels is drag-to-resize (mousedown → mousemove → mouseup, min 180px left).


**Auto-refresh:** schedules every 10s, sessions every 5s via `setInterval`. Deduped by JSON-stringifying the full data payload — only re-renders DOM if data changed.


---


### Schedules panel


**Quick-add bar** (top of panel, always visible):
- `<input>` placeholder: `"e.g. check my GitHub issues every day at 9am"`
- `⚡ Add with AI` button → calls `quickAddSchedule()` (see CLI Integration above)
- `➕ Manual` button → opens full schedule modal


**Schedule table columns:**
```
☐ | ✏️ | Name + Agent + Tools | Prompt (truncated 300w) | Freq | ⚡ | Next Run | Last Run | Count | Actions
```


- **Name cell**: click → edit modal; agent name shown as link
- **Prompt cell**: click → `showFilteredSessions(scheduleId)` — filters sessions panel
- **⚡ run button**: triggers immediate run; disabled during 60s cooldown (live countdown)
- **Next Run**: color-coded urgency — red ≤2min, orange ≤15min, yellow ≤1h, normal ≤6h, dim >6h; live countdown when ≤60s
- **Last Run**: link to session logs; red if `lastRunFailed`; 🔄 if currently running
- **Count**: link → filter sessions by this schedule
- **Actions**: ⏸/▶ toggle, 🗑 delete (with inline confirm + active-session warning), 🔁 auto-fix (shown only when `lastRunFailed`)


**Sort order**: enabled+soonest first, disabled last.


**Batch delete**: select-all checkbox → batch bar appears → `🗑 Delete Selected`.


**Schedule modal** (add/edit):
- Type toggle: `🕐 One-time` / `🔁 Repeated`
- Fields: Prompt*, Name (auto-filled), Agent (typeahead from `/agents`), Frequency (dropdown), First Run At (datetime-local), Pause-on-fail checkbox, Additional Tools checkboxes
- One-time with empty Run At → creates then immediately triggers
- Repeated with empty First Run At → defaults to now+1min


---


### Sessions panel


**Two sections**: `⚡ ACTIVE SESSIONS` (green header) and `🕑 COMPLETED SESSIONS` (grey header).


**Session row columns (grid: 3em 7em 3em 1fr 6em 4em):**
```
[source badge] [relative time] [#id] [prompt link] [elapsed/exit] [actions]
```


- **Source badge**: `⏰` schedule (dark pill), `🌱` spawned (orange), `🌐` browser (blue)
- **Relative time**: `just now` / `Xm ago` / `Xh ago` — full datetime as `title` tooltip
- **Prompt link**: truncated to 300 words; click → opens session in new tab
- **Elapsed/exit**: hover → log-tail tooltip (last 10 lines, fetched from `/sessions/:id/logs`, 250ms debounce, cached per session)
- **Active actions**: `✕ Kill` button + `▾` preview toggle
- **Completed actions**: `📄 Logs` link + `▾` preview toggle; exit icon `✅`/`❌`/`🔪`


**Preview panel** (below row, hidden by default): fetches last 15 lines of `logs.txt`, shown inline.


**Filter banner**: when filtering by schedule — shows schedule name + `✕ Clear filter` button.


**Auto-cleanup note** at bottom: "Active sessions idle for 30 min are killed. Completed sessions kept 7 days."


---


### Session detail page (`GET /sessions/:id/logs`)


Two page variants served from the same route:


**Unified page** (completed or running — served when session exists in memory/history):
```
┌─ toolbar ──────────────────────────────────────────────────────┐
│ ⏳/#✅/❌ Session #N  [⏰ schedule] [name] [status] [time]      │
│                                    [🔄 Refresh] [📝 Export]    │
├─ prompt panel (320px) ──────────────────────────────────────────┤
│ 📝 Prompt  [📋 Copy] [📋 claude-code]                          │
│ 🤖 agent-name  📦 repo-name                                    │
│ <prompt text>                                                   │
├─ output panel (flex:1) ─────────────────────────────────────────┤
│ <pre id="out"> ANSI-stripped output </pre>                     │
│ [🔁 Retry] (on failure)  [⬇ Bottom]                           │
│ ⚠️ Error Report panel (on failure, fetched from /error-report) │
├─ footer ────────────────────────────────────────────────────────┤
│ localhost:2026 · 📁 Session: ~/...                             │
└────────────────────────────────────────────────────────────────┘
```


**Auto-refresh** (running sessions): polls `GET /sessions/:id/logs` (JSON) every **3000ms**:
- Updates `<pre id="out">` with ANSI-stripped output
- Updates elapsed time counter
- On `exitCode` present → `clearInterval` + `location.reload()` (shows completed page)
- On tab hidden → `clearInterval`; on tab visible → `location.reload()`


**Streaming page** (new session started via browser — `asHtml=true`):
- Sent immediately when session starts; browser polls independently
- Polls every **2000ms** via `GET /sessions/:id/logs` (JSON Accept header)
- Finds session by token match or falls back to most-recent session (up to 20 attempts × 500ms)
- On exit: shows `✅ Done` / `❌ exit N`; reveals Share + Export buttons
- On tab hidden → pause polling; on tab visible → resume


**Error report panel** (failed sessions only):
- Fetched from `GET /sessions/:id/error-report` after page load
- Shows `Root Cause` + `Resolution` in a red-bordered panel below output
- Patterns detected: tool approval required, named tool not approved, EACCES, binary not found, rate limit, generic fallback


**Export formats** (via `GET /sessions/:id/export?format=<fmt>`):
- `json` — full metadata + ANSI-stripped output as JSON
- `markdown` — `# YellyClaw Session #N` heading, Details/Prompt/Output sections
- `text` — plain text with `=`.repeat(60) separator


---


## [E2E Test Cases]


End-to-end tests cover the full request lifecycle: real HTTP server → real claude-code process (or stub) → session file on disk → log streaming → cleanup.


### Test file: `tests/yellyclaw-e2e.test.js`


Uses the same minimal harness pattern as `kiro-runtime-server.test.js` (no Jest/Mocha — plain `node tests/yellyclaw-e2e.test.js`).


---


### Suite 1 — Security


| # | Test | Method | Path | Setup | Expected |
|---|------|--------|------|-------|----------|
| 1.1 | Valid host accepted | GET | `/health` | host: `localhost:2026` | 200 `{status:'ok'}` |
| 1.2 | Invalid host rejected | GET | `/health` | host: `evil.com` | 403 |
| 1.3 | POST without CSRF token | POST | `/run` | no `X-YellyRock-Token` | 403 |
| 1.4 | POST with wrong CSRF token | POST | `/run` | wrong token | 403 |
| 1.5 | POST with valid CSRF token | POST | `/run` | correct token, missing prompt | 400 (not 403) |
| 1.6 | Disallowed origin rejected | GET | `/health` | `Origin: https://evil.com` | 403 |
| 1.7 | Allowed origin accepted | GET | `/health` | `Origin: https://github.com` | 200 |
| 1.8 | Rate limit enforced | GET | `/health` | 101 rapid requests from same origin | 101st → 429 |


---


### Suite 2 — Session lifecycle


| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.1 | POST /run creates session | POST `/run` `{prompt:"echo hello"}` | 200 `{sessionId:N}` |
| 2.2 | Active session appears in list | GET `/sessions` after 2.1 | `sessions` array contains `{id:N, source:'browser'}` |
| 2.3 | Session logs endpoint exists | GET `/sessions/N/logs` (JSON) | 200, `{id:N, prompt:'echo hello'}` |
| 2.4 | Session log file written to disk | Check `/tmp/yellyrock/sessions/YYYY-MM-DD/session-N/logs.txt` | File exists, non-empty after process exits |
| 2.5 | Session moves to history on exit | GET `/history` after process exits | `history` contains `{id:N, exitCode:0}` |
| 2.6 | Kill active session | POST `/sessions/N/kill` | 200 `{killed:true}`; session `killed:true` in history |
| 2.7 | Kill non-existent session | POST `/sessions/9999/kill` | 404 |
| 2.8 | Rerun session | POST `/sessions/N/rerun` | 200 `{newSessionId:M}`; new session has same prompt |
| 2.9 | Idle timeout kills session | Session with no output for 30 min | Session killed, `killed:true` in history |


---


### Suite 3 — Self-spawn


| # | Test | Steps | Expected |
|---|------|-------|----------|
| 3.1 | Spawn child session | POST `/sessions/N/spawn` `{prompt:"subtask"}` | 201 `{sessionId:M, parentId:N}` |
| 3.2 | Child appears in active sessions | GET `/sessions` | child has `source:'spawn'` |
| 3.3 | Max 5 children enforced | Spawn 6 children from same parent | 6th → 429 `{error:'max_children'}` |
| 3.4 | Spawn from non-existent parent | POST `/sessions/9999/spawn` | 404 |
| 3.5 | Child inherits parent agentSpec | Spawn without `agentSpec` override | child `agentSpec` === parent `agentSpec` |
| 3.6 | YELLYCLAW_* env vars injected | Inspect child process env (via stub) | `YELLYCLAW_SESSION_ID`, `YELLYCLAW_PORT`, `YELLYCLAW_TOKEN`, `YELLYCLAW_PARENT_ID` all set |


---


### Suite 4 — Scheduler


| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.1 | Create schedule | POST `/schedules` `{name,prompt,interval:'1h',nextRunAt}` | 201 `{schedule:{id,enabled:true}}` |
| 4.2 | List schedules | GET `/schedules` | `schedules` array contains created schedule |
| 4.3 | Auto-name from prompt | POST `/schedules` without `name` | `schedule.name` === prompt text (truncated to 40 chars) |
| 4.4 | Pause schedule | POST `/schedules/:id` `{enabled:false}` | `{schedule:{enabled:false}}` |
| 4.5 | Resume schedule | POST `/schedules/:id` `{enabled:true}` | `{schedule:{enabled:true}}` |
| 4.6 | Edit schedule | POST `/schedules/:id` `{prompt:'new prompt'}` | 200, schedule has updated prompt |
| 4.7 | Delete schedule | POST `/schedules/:id?action=delete` | 200; GET `/schedules` no longer contains it |
| 4.8 | Trigger now | POST `/schedules/:id/run` | 200 `{sessionId:N}`; cooldown set |
| 4.9 | Cooldown blocks re-trigger | POST `/schedules/:id/run` within 60s | 429 `{error:'cooldown', message:'...'}` |
| 4.10 | Schedule tick fires due schedule | Set `nextRunAt` to past, call tick | New session created, `runCount` incremented, `nextRunAt` advanced |
| 4.11 | autoPause on failure | Schedule with `autoPause:true`, session exits non-zero | `enabled:false` after run |
| 4.12 | One-time schedule disabled after run | `interval:'once'`, tick fires | `enabled:false`, no `nextRunAt` advance |
| 4.13 | Batch delete | POST `/schedules` (create 3), then batch delete 2 | 2 deleted, 1 remains |


---


### Suite 5 — Export & history


| # | Test | Steps | Expected |
|---|------|-------|----------|
| 5.1 | Export JSON | GET `/sessions/N/export?format=json` | 200, valid JSON with `sessionId`, `prompt`, `output`, `startedAt` (ISO) |
| 5.2 | Export Markdown | GET `/sessions/N/export?format=markdown` | 200, contains `# YellyClaw Session #N`, `## Prompt`, `## Output` |
| 5.3 | Export text | GET `/sessions/N/export?format=text` | 200, contains `YellyClaw Session #N`, `=`.repeat(60) separator |
| 5.4 | Clear all history | POST `/history/clear` `{}` | `{cleared:true, removed:N}`, GET `/history` → empty |
| 5.5 | Clear history by age | POST `/history/clear` `{days:7}` | Only sessions older than 7 days removed |
| 5.6 | Session lazy-load from disk | History entry with `output:null`, GET `/sessions/N/logs` | 200, `output` populated from `logs.txt` |


---


### Suite 6 — Server Manager UI


| # | Test | Steps | Expected |
|---|------|-------|----------|
| 6.1 | Root returns HTML | GET `/` | 200, `Content-Type: text/html`, body contains `YellyClaw` |
| 6.2 | Title tag correct | GET `/` | body contains `<title>YellyClaw</title>` |
| 6.3 | Toolbar h1 correct | GET `/` | body contains `🦀 YellyClaw` |
| 6.4 | Evolve panel present | GET `/` | body contains `Evolve YellyClaw` |
| 6.5 | YELLYCLAW env vars in page | GET `/` | body does NOT contain `AGENTCLAW` (old name) |


---


### Suite 7 — Evolve Me


| # | Test | Steps | Expected |
|---|------|-------|----------|
| 7.1 | POST /evolve without token | POST `/evolve` | 403 |
| 7.2 | POST /evolve missing prompt | POST `/evolve` `{}` with token | 400 |
| 7.3 | POST /evolve valid | POST `/evolve` `{prompt:"add dark mode"}` with token | 200 `{sessionId:N}` |
| 7.4 | Evolve session has correct source | GET `/sessions` after 7.3 | session `source:'browser'`, prompt contains "YellyClaw" |


---


### Suite 8 — Session purge


| # | Test | Steps | Expected |
|---|------|-------|----------|
| 8.1 | Old session purged | Create session dir with mtime 10 days ago, call purge with TTL=7d | Dir deleted, history entry removed |
| 8.2 | Recent session kept | Create session dir with mtime 1 day ago, call purge with TTL=7d | Dir still exists |
| 8.3 | Path traversal guardrail | Inject history entry pointing outside session root | Dir NOT deleted |
| 8.4 | Empty date dir cleaned up | All sessions in a date dir purged | Date dir itself removed |
| 8.5 | TTL uses max(config, schedule interval) | Schedule interval=10d, config TTL=7d | Effective TTL=10d |


---


### Running E2E tests


```bash
# Unit + route tests (no claude-code needed)
node tests/yellyclaw-e2e.test.js


# Full E2E with real claude-code (requires claude-code in PATH)
YELLYCLAW_REAL_RUNTIME=1 node tests/yellyclaw-e2e.test.js
```


Use `YELLYCLAW_REAL_RUNTIME=1` to skip stub mode and spawn actual `claude-code` processes for suites 2–4.


---


## [registerSession Internals]


`registerSession(prompt, proc, label, token, agentSpec, agentRepo, interactive, source, scheduleName, preAllocated, scheduleId)` in `server.js`:


```
1. Use preAllocated.id/workDir if provided (from preAllocateSession()), else ++sessionCounter
2. Build session object with lastActivityAt = Date.now()
3. activeSessions.set(id, session)
4. tokenToSessionId.set(token, id)  ← maps PRG token → numeric id
5. Back-fill env: proc.env.YELLYCLAW_SESSION_ID = String(id)
6. Wire proc.stdout + proc.stderr:
  - Push chunk to outputChunks[]
  - session.output = outputChunks.join('')  ← live string for polling
  - session.lastActivityAt = Date.now()     ← reset idle timer
  - if interactive: detectInputPrompt(id, text)
7. proc.on('close', code):
  - activeSessions.delete(id)
  - pendingInputPrompts.delete(id)
  - Build histEntry: { id, prompt, startedAt, endedAt, exitCode, killed, output, agentSpec, agentRepo, source, scheduleName, scheduleId, workDir }
  - sessionHistory.unshift(histEntry); if >50 → sessionHistory.length = 50
  - If exitCode !== 0 && !killed: generateErrorReport(output, exitCode) → histEntry.errorReport; write error-report.md to workDir
  - saveSessionToDisk(histEntry)  ← writes meta.yaml, prompt.txt, logs.txt (ANSI-stripped)
  - Update scheduledTasks: clear currentRunSessionId, set lastRunFailed, call saveSchedulesToLocal()
```


**`preAllocateSession()`**: called BEFORE spawn so the process has a valid CWD:
```js
const id = ++sessionCounter;
const workDir = path.join(SESSION_DIR, 'YYYY-MM-DD', `session-${id}`);
fs.mkdirSync(workDir, { recursive: true });
return { id, workDir };
```


**`detectInputPrompt(sessionId, text)`** (interactive mode only):
- Checks last non-empty line of output against 8 patterns: `/?$/`, `/:$/`, `/enter \w+/i`, `/input:/i`, `/provide \w+/i`, `/(y\/n)/i`, `/press enter/i`, `/continue?/i`
- On match: `session.pendingInput = true`; `pendingInputPrompts.set(id, { question, timestamp })`
- GET `/sessions/:id/input` returns `{ pendingInput, question, timestamp }`
- POST `/sessions/:id/input` `{input:"yes"}` → `proc.stdin.write(input + '\n')`; clears `pendingInput`


---


## [generateErrorReport Patterns]


`generateErrorReport(output, exitCode)` returns `null` for exit 0 or killed. For failures, matches in order (most specific first):


| Priority | Regex | rootCause | resolution | autoFix |
|---|---|---|---|---|
| 1 | `tool approval required but --no-interactive` | Tool requires approval, non-interactive mode | Add `'*'` to schedule's allowTools to use `--dangerously-skip-permissions` | `{type:'add-tool', tool:'*'}` |
| 2 | `tool '...' not approved / requires approval` | Named tool not in allowed list | Add tool name to schedule's Additional Tools | `{type:'add-tool', tool:'<name>'}` |
| 3 | `approval required ... '...'` (reversed order) | Same as #2 | Same | Same |
| 4 | `permission denied.*exec\|EACCES.*exec` | Shell execution blocked | Add `shell` to Additional Tools | `{type:'add-tool', tool:'shell'}` |
| 5 | `claude-code.*command not found\|No such file` | CLI binary not found on PATH | Verify `claude-code` installed and in PATH | `null` |
| 6 | `rate limit\|429\|quota exceeded` | API rate limit exceeded | Wait or reduce schedule frequency | `null` |
| fallback | (any non-zero exit) | `Session exited with code N` | Review session logs | `null` |


Return shape: `{ rootCause: string, resolution: string, autoFix: {type:'add-tool', tool:string} | null }`


---


## [autoRunUntilNoError]


`autoRunUntilNoError(scheduleId, config, maxRetries=3)` — async, responds 202 immediately, runs in background:


```
for attempt 1..maxRetries:
 1. installAgentIfAbsent(schedule.agentSpec)
 2. runClaudeCode(schedule.prompt, fakeRes, false, ..., schedule.allowTools, 'schedule', ...)
 3. Wait for session to exit: poll activeSessions.has(sessionId) every 1000ms
 4. generateErrorReport(hist.output, hist.exitCode)
 5. If no error → return { success:true, attempts, sessionId, fixesApplied, lastErrorReport:null }
 6. If autoFix.type === 'add-tool':
      schedule.allowTools.push(tool)
      saveSchedulesToLocal()
      fixesApplied.push({type:'add-tool', tool})
    Else (no auto-fix available) → break early
return { success:false, attempts, sessionId, fixesApplied, lastErrorReport }
```


After loop: `schedule.lastRunFailed = !result.success`. The 🔁 auto-fix button in the UI calls this route.


---


## [/update Route]


`POST /update` — git pull + server restart:


```
1. execSync('git pull --rebase', { cwd: repoRoot })
  → on failure: 500 { error:'git pull failed', details }
2. Check if already up to date (regex /already up.to.date/i)
3. execSync('git diff HEAD~1 --name-only') → filter lines starting with 'src/'
4. If alreadyUpToDate && no server files changed → 200 { updated:false, message:'Already up to date' }
5. Kill all active sessions (SIGTERM), save to history + disk
6. Respond 200 { updated:true, restarting:true, changedFiles, pullOutput }
7. setTimeout(300ms):
  spawn(process.execPath, [serverScript, ...process.argv.slice(2)], { detached:true, stdio:'ignore' })
  child.unref()
  server.close(() => process.exit(0))
  setTimeout(2000ms) → process.exit(0)  ← force exit if close hangs
```


Client should poll `GET /health` after receiving `restarting:true` to detect when new process is up.


---


## [/agents Route]


`GET /agents` — list available agent specs from local agent registry:


```
spawn(CLAUDE_BIN, ['agent', 'list'], { shell: false })
stdout lines matching /^\s*[-•*]/ → strip bullet → { name: string }[]
→ 200 { agents: [{name:'yellyrock-default'}, ...] }
on error/non-zero exit → 500 { error, stderr, agents:[] }
```


Used by schedule modal for agent typeahead. `installAgentIfAbsent(agentName)` checks the list before installing.


---


## [/open-folder Route]


`POST /open-folder` `{path: "/tmp/yellyrock/sessions/..."}`:
- Path restricted to subdirectories of `/tmp/yellyrock` (path traversal guard)
- macOS: `execSync('open "<safePath>"')`; Linux: `xdg-open`
- Returns `{ opened: safePath }`


---


## [CLI Flags]


```
node src/server.js [options]


--port <number>          Server port (default: 2026)
--claude <path>          Path to claude-code binary (default: claude-code)
--interactive            Enable interactive mode (default: non-interactive)
--repo <path>            Git repo for remote schedule sync
                        (default: ~/.yellyrock/schedules-repo)
--alias <string>         User alias for schedule file naming
                        (default: $YELLYCLAW_ALIAS or os.userInfo().username)
--session-dir <path>     Session storage root (default: /tmp/yellyrock/sessions)
--session-ttl-days <n>   Session file TTL in days (default: 7)
--allow-tools <list>     Comma-separated extra tools to pre-approve (future; passed as --allowedTools to claude)
```


Environment variable overrides: `YELLYCLAW_ALIAS`, `YELLYCLAW_SCHEDULE_REPO`, `YELLYCLAW_SESSION_DIR`, `YELLYCLAW_SESSION_TTL_DAYS`.


---


## [Startup & Shutdown]


### Startup sequence
```
1. Parse CLI flags → build config
2. generateCsrfToken() → random 32-byte hex
3. Parse allowed origin patterns from yellyrock.user.js → ALLOWED_DOMAIN_PATTERNS
  (fallback hardcoded list if file not found)
4. Load preapproval-rules.json
5. http.createServer(createRouter(config)).listen(PORT, '127.0.0.1')
6. loadSessionsFromDisk():
  - Read SESSION_DIR/YYYY-MM-DD/session-<id>/meta.yaml (newest-first, max 50)
  - Populate sessionHistory with lazy entries (prompt/output = null, diskDir set)
  - Advance sessionCounter past highest loaded id
7. loadSchedules():
  - Load ~/.yellyrock/schedules.yaml (local)
  - If no local file + SCHEDULE_REPO exists: git pull + load remote, save to local
8. Start schedule tick (setInterval 30s)
9. Start idle/TTL cleanup tick (setInterval 60s)
10. Log startup banner to console
```


### Graceful shutdown (SIGTERM / SIGINT / POST /stop)
```
1. saveSchedulesToLocal()
2. syncSchedulesToGit() ← git pull --rebase, write file, git add/commit/push
3. server.close(() => process.exit(0))
4. setTimeout(5000ms) → process.exit(0)  ← force exit if close hangs
```


On `/stop` and `/update`: active sessions are killed (SIGTERM) and saved to history before exit.


---


## [Implementation Order]


1. `session.js` — HTML page generators: `unifiedSessionPage`, `streamingSessionPage` (no deps)
2. `shared.js` — HTML/CSS utilities (no deps)
3. `server.js` — HTTP server skeleton, CSRF, rate limit, session registry
4. `routes.js` — all route handlers + `runClaudeCode` + schedule tick
5. `manager.js` — Server Manager UI (depends on shared.js)
6. `client.js` — re-export shim
7. `context/self-spawn.md` — update env var names to `YELLYCLAW_*`
8. `v2/settings.js` — add `yellyclawUrl` config key
9. `v2/preapproval-rules.json` — verify tool rules still apply
10. Tests: unit tests for session model, route handlers, schedule tick, CSRF validation
11. Manual smoke test: `node src/server.js` → `curl http://localhost:2026/health`



