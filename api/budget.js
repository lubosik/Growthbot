const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const storage = require('../lib/storage');

function getMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const month = getMonthKey();

    // Read budget from Redis (written by tracking/budget.js on each run)
    let budget = await storage.get(`budget:${month}`);

    // Fall back to a fresh skeleton if no data yet
    if (!budget) {
      budget = {
        month,
        estimated_spend: 0,
        spend_limit: 5.00,
        hard_stop: 4.50,
        daily_breakdown: {},
        mode: 'normal',
        runCount: 0,
        lastUpdated: null,
      };
    }

    // Compute posts_this_month + last_run + last_run_errors from daily logs
    let postsThisMonth = 0;
    let lastRun = null;
    let lastRunErrors = 0;

    for (let i = 0; i < 31; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      if (!dateKey.startsWith(month)) continue;

      const log = await storage.get(`log:${dateKey}`);
      if (!log) continue;

      const a = log.actions || {};
      postsThisMonth += (a.replies || 0) + (a.quoteTweets || 0);

      const runTime = log.runCompleted || log.runStarted;
      if (runTime && (!lastRun || runTime > lastRun)) {
        lastRun = runTime;
        lastRunErrors = (log.errors || []).length;
      }
    }

    res.json({
      ok: true,
      data: {
        ...budget,
        // camelCase aliases for the dashboard JS
        estimatedSpend: budget.estimated_spend,
        hardStop: budget.hard_stop,
        limit: budget.spend_limit,
        remaining: Math.max(0, budget.hard_stop - budget.estimated_spend),
        // enriched fields
        posts_this_month: postsThisMonth,
        last_run: lastRun,
        last_run_errors: lastRunErrors,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
