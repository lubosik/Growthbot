const fs = require('fs');
const path = require('path');
const { sendBudgetAlert, sendHardStopAlert } = require('../telegram/notifier');
const storage = require('../lib/storage');

const BUDGET_FILE = path.join(__dirname, '../logs/monthly-budget.json');

const HARD_STOP_LIMIT = 4.50;   // USD — stop ALL API calls
const REDUCED_THRESHOLD = 3.50; // USD — switch to reduced mode at mid-month

// Cost estimates per action type (USD)
const ACTION_COSTS = {
  recentSearch: 0.008,
  tweetLookup: 0.0002,
  createTweet: 0.003,
  like: 0.0001,
  retweet: 0.0001,
  quoteTweet: 0.003,
  claudeHaiku: 0.001,
  claudeSonnet: 0.005,
  braveSearch: 0.0,
};

function getMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

function loadBudget() {
  const month = getMonthKey();
  try {
    if (fs.existsSync(BUDGET_FILE)) {
      const data = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
      // Reset if new month
      if (data.month !== month) {
        return createFreshBudget(month);
      }
      return data;
    }
  } catch (_) {}
  return createFreshBudget(month);
}

function createFreshBudget(month) {
  return {
    month,
    estimated_spend: 0,
    spend_limit: 5.00,
    hard_stop: HARD_STOP_LIMIT,
    daily_breakdown: {},
    mode: 'normal',
    runCount: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function saveBudget(data) {
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(data, null, 2));
  // Also persist to Redis so the Vercel dashboard can read it
  storage.set(`budget:${data.month}`, data).catch(() => {});
}

/**
 * Check if we're within budget before making an API call.
 * Throws an error if hard stop is reached.
 */
async function checkBudget(actionType = '') {
  const budget = loadBudget();

  if (budget.estimated_spend >= HARD_STOP_LIMIT) {
    console.error(`[budget] HARD STOP: Estimated spend $${budget.estimated_spend.toFixed(2)} >= $${HARD_STOP_LIMIT}`);
    try {
      await sendHardStopAlert(budget.estimated_spend);
    } catch (_) {}
    throw new Error(`Budget hard stop: estimated spend $${budget.estimated_spend.toFixed(2)} >= $${HARD_STOP_LIMIT}`);
  }

  // Warn at reduced threshold (mid-month only)
  const dayOfMonth = new Date().getUTCDate();
  if (budget.estimated_spend >= REDUCED_THRESHOLD && dayOfMonth >= 15 && budget.mode === 'normal') {
    console.warn(`[budget] Switching to REDUCED mode ($${budget.estimated_spend.toFixed(2)} spend at day ${dayOfMonth})`);
    budget.mode = 'reduced';
    saveBudget(budget);
    try {
      await sendBudgetAlert(budget.estimated_spend, HARD_STOP_LIMIT);
    } catch (_) {}
  }

  return budget;
}

/**
 * Record the cost of an action.
 */
function recordCost(actionType, count = 1) {
  const cost = (ACTION_COSTS[actionType] || 0) * count;
  if (cost === 0) return;

  const budget = loadBudget();
  budget.estimated_spend = parseFloat((budget.estimated_spend + cost).toFixed(6));

  const today = getTodayKey();
  if (!budget.daily_breakdown[today]) {
    budget.daily_breakdown[today] = {
      searches: 0, reads: 0, replies: 0, quotes: 0,
      likes: 0, retweets: 0, claudeCalls: 0, estimated_cost: 0,
    };
  }

  const day = budget.daily_breakdown[today];
  day.estimated_cost = parseFloat(((day.estimated_cost || 0) + cost).toFixed(6));

  // Map action type to day counter
  const typeMap = {
    recentSearch: 'searches',
    tweetLookup: 'reads',
    createTweet: 'replies',
    quoteTweet: 'quotes',
    like: 'likes',
    retweet: 'retweets',
    claudeHaiku: 'claudeCalls',
    claudeSonnet: 'claudeCalls',
  };
  const key = typeMap[actionType];
  if (key) day[key] = (day[key] || 0) + count;

  saveBudget(budget);
}

/**
 * Get current budget status for display / reports.
 */
function getBudgetStatus() {
  const budget = loadBudget();
  const today = getTodayKey();
  return {
    estimatedSpend: budget.estimated_spend,
    limit: budget.spend_limit,
    hardStop: budget.hard_stop,
    remaining: Math.max(0, HARD_STOP_LIMIT - budget.estimated_spend),
    mode: budget.mode,
    todayBreakdown: budget.daily_breakdown[today] || {},
    month: budget.month,
  };
}

/**
 * Increment run counter.
 */
function incrementRunCount() {
  const budget = loadBudget();
  budget.runCount = (budget.runCount || 0) + 1;
  saveBudget(budget);
  return budget.runCount;
}

/**
 * Print budget status to console.
 */
function printBudgetStatus() {
  const status = getBudgetStatus();
  console.log('\n━━ BUDGET STATUS ━━');
  console.log(`Month:           ${status.month}`);
  console.log(`Estimated spend: $${status.estimatedSpend.toFixed(4)}`);
  console.log(`Remaining:       $${status.remaining.toFixed(4)} (hard stop at $${status.hardStop})`);
  console.log(`Mode:            ${status.mode}`);
  console.log('Today:', JSON.stringify(status.todayBreakdown, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━\n');
}

module.exports = {
  checkBudget,
  recordCost,
  getBudgetStatus,
  incrementRunCount,
  printBudgetStatus,
  loadBudget,
  ACTION_COSTS,
};
