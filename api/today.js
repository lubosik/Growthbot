const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const storage = require('../lib/storage');

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const data = await storage.get(`log:${todayKey()}`);
    res.json({ ok: true, data: data || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
