const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const storage = require('../lib/storage');
const { getBudgetStatus } = require('../tracking/budget');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const budget = getBudgetStatus();
    const pipelineStatus = await storage.get('pipeline:status') || { status: 'idle' };

    res.json({
      ok: true,
      data: {
        handle:         process.env.MY_TWITTER_HANDLE || 'lubosi_k',
        mode:           budget.mode,
        estimatedSpend: budget.estimatedSpend,
        hardStop:       budget.hardStop,
        remaining:      budget.remaining,
        pipeline:       pipelineStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
