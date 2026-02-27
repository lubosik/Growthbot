const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { loadBudget, getBudgetStatus } = require('../tracking/budget');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const budget = loadBudget();
    const status = getBudgetStatus();
    res.json({ ok: true, data: { ...budget, ...status } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
