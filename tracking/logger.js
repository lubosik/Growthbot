const fs = require('fs');
const path = require('path');
const storage = require('../lib/storage');

const LOGS_DIR = path.join(__dirname, '../logs');

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

function getLogPath(dateKey) {
  return path.join(LOGS_DIR, `${dateKey}.json`);
}

/**
 * Initialize a fresh daily log object.
 */
function initDayLog() {
  return {
    date: getTodayKey(),
    runStarted: new Date().toISOString(),
    runCompleted: null,
    tweetsDiscovered: 0,
    tweetsScored: 0,
    tweetsEngaged: 0,
    mode: 'normal',
    actions: {
      replies: 0,
      likes: 0,
      retweets: 0,
      quoteTweets: 0,
    },
    monthlyBudget: {
      used: 0,
      remaining: 0,
    },
    repliesSent: [],
    contentIdeas: [],
    errors: [],
    cost: {
      claudeCalls: 0,
      braveSearches: 0,
      estimatedCost: '$0.00',
    },
  };
}

/**
 * Load today's existing log if it exists (for continuation).
 * Tries Redis first (production/GH Actions), falls back to local filesystem.
 */
async function loadTodayLog() {
  const key = `log:${getTodayKey()}`;
  if (storage.IS_REDIS) {
    try {
      const data = await storage.get(key);
      if (data) return data;
    } catch (_) {}
  }
  const logPath = getLogPath(getTodayKey());
  try {
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch (_) {}
  return initDayLog();
}

/**
 * Save the daily log to disk and to Redis (so the dashboard can read it).
 */
async function saveLog(log) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  log.runCompleted = new Date().toISOString();
  const dateKey = log.date || getTodayKey();
  const logPath = getLogPath(dateKey);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  // Persist to storage so the dashboard APIs (which read Redis) can see it
  await storage.set(`log:${dateKey}`, log);
}

/**
 * Append a reply record to the log.
 */
function logReply(log, data) {
  log.repliesSent.push({
    tweetId: data.tweetId,
    author: data.author,
    authorHandle: data.authorHandle,
    originalText: data.originalText ? data.originalText.substring(0, 280) : '',
    replyText: data.replyText,
    replyStyle: data.replyStyle || 'unknown',
    replyId: data.replyId || null,
    score: data.score || 0,
    tweetUrl: data.tweetUrl || '',
    timestamp: new Date().toISOString(),
    dryRun: data.dryRun || false,
  });
  log.actions.replies++;
}

/**
 * Log an error.
 */
function logError(log, err) {
  const message = err instanceof Error ? err.message : String(err);
  log.errors.push({
    message: message.substring(0, 500),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Load the last N daily logs for history views.
 */
function loadRecentLogs(days = 7) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logs = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().split('T')[0];
    const logPath = getLogPath(key);

    if (fs.existsSync(logPath)) {
      try {
        logs.push(JSON.parse(fs.readFileSync(logPath, 'utf8')));
      } catch (_) {}
    }
  }

  return logs;
}

module.exports = { initDayLog, loadTodayLog, saveLog, logReply, logError, loadRecentLogs, getLogPath };
