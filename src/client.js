'use strict';

// client.js — thin re-export shim for browser extension integration
// Re-exports the public API from server.js and routes.js

const server = require('./server');
const routes = require('./routes');
const shared = require('./shared');
const session = require('./session');

module.exports = {
  // From server.js
  startServer: server.startServer,
  validateSecurity: server.validateSecurity,
  registerSession: server.registerSession,
  preAllocateSession: server.preAllocateSession,
  saveSessionToDisk: server.saveSessionToDisk,
  loadSessionsFromDisk: server.loadSessionsFromDisk,
  loadSessionOutput: server.loadSessionOutput,
  loadSchedules: server.loadSchedules,
  saveSchedulesToLocal: server.saveSchedulesToLocal,
  syncSchedulesToGit: server.syncSchedulesToGit,
  stripAnsi: server.stripAnsi,
  generateErrorReport: server.generateErrorReport,
  parseScheduleYaml: server.parseScheduleYaml,
  normalizeSchedule: server.normalizeSchedule,
  intervalToMs: server.intervalToMs,
  getState: server.getState,

  // From routes.js
  createRouter: routes.createRouter,
  scheduleTick: routes.scheduleTick,
  runClaudeCode: routes.runClaudeCode,

  // From shared.js
  escHtml: shared.escHtml,
  shortenPath: shared.shortenPath,
  renderSourceBadge: shared.renderSourceBadge,

  // From session.js
  unifiedSessionPage: session.unifiedSessionPage,
  streamingSessionPage: session.streamingSessionPage,
};
