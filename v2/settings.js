'use strict';

// v2/settings.js — YellyRock browser extension configuration
// Includes yellyclawUrl for connecting to the local YellyClaw server

module.exports = {
  // URL of the local YellyClaw agent runtime server
  yellyclawUrl: process.env.YELLYCLAW_URL || 'http://localhost:2026',

  // Default agent spec used for sessions
  defaultAgentSpec: process.env.YELLYCLAW_AGENT_SPEC || 'yellyrock-default',

  // CSRF token header name
  csrfHeader: 'X-AgentRock-Token',

  // Session storage root
  sessionDir: process.env.YELLYCLAW_SESSION_DIR || '/tmp/yellyrock/sessions',

  // Session file TTL in days
  sessionTtlDays: parseInt(process.env.YELLYCLAW_SESSION_TTL_DAYS || '7', 10),

  // Schedule file path
  scheduleFile: process.env.YELLYCLAW_SCHEDULE_FILE || require('path').join(require('os').homedir(), '.yellyrock', 'schedules.yaml'),

  // Schedule git repo for remote sync
  scheduleRepo: process.env.YELLYCLAW_SCHEDULE_REPO || require('path').join(require('os').homedir(), '.yellyrock', 'schedules-repo'),

  // User alias for schedule file naming
  alias: process.env.YELLYCLAW_ALIAS || require('os').userInfo().username,
};
