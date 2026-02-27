#!/usr/bin/env node
/**
 * dashboard.js — Web dashboard server.
 * Serves the Apple Liquid Glass UI at http://localhost:3131
 *
 * Usage: node dashboard.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const fs = require('fs');

const { loadRecentLogs } = require('./tracking/logger');
const { getBudgetStatus, loadBudget } = require('./tracking/budget');

const PORT = process.env.DASHBOARD_PORT || 3131;
const app = express();

app.use(express.json());

// ── Serve static UI ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'ui', 'dashboard.html');
  if (!fs.existsSync(htmlPath)) {
    res.status(404).send('Dashboard UI not found. Ensure ui/dashboard.html exists.');
    return;
  }
  res.sendFile(htmlPath);
});

// ── API: today's log ───────────────────────────────────────────────────────
app.get('/api/today', (req, res) => {
  try {
    const logs = loadRecentLogs(1);
    const today = logs[0] || null;
    res.json({ ok: true, data: today });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: last 7 days of logs ───────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const logs = loadRecentLogs(Math.min(days, 30));
    res.json({ ok: true, data: logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: monthly budget ────────────────────────────────────────────────────
app.get('/api/budget', (req, res) => {
  try {
    const budget = loadBudget();
    const status = getBudgetStatus();
    res.json({ ok: true, data: { ...budget, ...status } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: status ────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const status = getBudgetStatus();
  res.json({
    ok: true,
    data: {
      handle: process.env.MY_TWITTER_HANDLE || 'lubosi_k',
      mode: status.mode,
      estimatedSpend: status.estimatedSpend,
      hardStop: status.hardStop,
      remaining: status.remaining,
    },
  });
});

// ── API: all replies from history ─────────────────────────────────────────
app.get('/api/replies', (req, res) => {
  try {
    const logs = loadRecentLogs(7);
    const replies = logs.flatMap(log => (log.repliesSent || []).map(r => ({
      ...r,
      date: log.date,
    })));
    res.json({ ok: true, data: replies });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: content ideas from latest log ────────────────────────────────────
app.get('/api/ideas', (req, res) => {
  try {
    const logs = loadRecentLogs(1);
    const today = logs[0];
    res.json({ ok: true, data: today?.contentIdeas || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║   X Engagement Bot — Dashboard            ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log(`\n  Open: http://localhost:${PORT}\n`);
});
