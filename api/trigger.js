const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fetch = require('node-fetch');
const storage = require('../lib/storage');

/**
 * POST /api/trigger
 *
 * Dispatches a GitHub Actions workflow_dispatch event to run the bot.
 * Requires header: x-trigger-secret matching TRIGGER_SECRET env var.
 *
 * Query params:
 *   ?dry=1          — dry run (no posting)
 *   ?discover=1     — discover only
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-trigger-secret');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  const secret = req.headers['x-trigger-secret'] || req.body?.secret;
  const expectedSecret = process.env.TRIGGER_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({ ok: false, error: 'TRIGGER_SECRET not configured on server' });
  }

  if (secret !== expectedSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid trigger secret' });
  }

  // ── GitHub dispatch ────────────────────────────────────────────────────
  const repo = process.env.GITHUB_REPO;  // e.g. "lubosi_k/x-engagement-bot"
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    return res.status(500).json({ ok: false, error: 'GITHUB_REPO or GITHUB_TOKEN not configured' });
  }

  const isDry      = req.query?.dry === '1' || req.body?.dry === true;
  const isDiscover = req.query?.discover === '1' || req.body?.discover === true;

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/run.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept':        'application/vnd.github.v3+json',
          'Content-Type':  'application/json',
          'User-Agent':    'x-engagement-bot',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            dry_run:       isDry      ? 'true' : 'false',
            discover_only: isDiscover ? 'true' : 'false',
          },
        }),
      }
    );

    if (resp.status === 204) {
      // Record that a run was triggered
      await storage.set('pipeline:status', {
        status:      'queued',
        dryRun:      isDry,
        triggeredAt: new Date().toISOString(),
        source:      'dashboard',
      }, { ex: 60 * 60 * 2 }); // 2 hour TTL

      return res.json({
        ok:      true,
        message: `${isDry ? 'Dry run' : 'Full run'} queued successfully`,
        repo,
      });
    }

    const body = await resp.text();
    return res.status(resp.status).json({
      ok:    false,
      error: `GitHub API returned ${resp.status}: ${body.substring(0, 200)}`,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
