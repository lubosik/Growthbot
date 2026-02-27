const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const storage = require('../lib/storage');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const days = Math.min(parseInt(req.query?.days) || 7, 30);
    const logs = [];

    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      const log = await storage.get(`log:${dateKey}`);
      if (log) logs.push(log);
    }

    res.json({ ok: true, data: logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
