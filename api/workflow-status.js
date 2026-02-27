const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fetch = require('node-fetch');
const storage = require('../lib/storage');

/**
 * GET /api/workflow-status
 *
 * Returns the latest GitHub Actions workflow run status + our internal pipeline status.
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const repo  = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  const pipelineStatus = await storage.get('pipeline:status').catch(() => null);

  // If GitHub not configured, just return internal status
  if (!repo || !token) {
    return res.json({ ok: true, data: { pipeline: pipelineStatus, workflow: null } });
  }

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/run.yml/runs?per_page=3`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept':        'application/vnd.github.v3+json',
          'User-Agent':    'x-engagement-bot',
        },
      }
    );

    if (!resp.ok) {
      return res.json({ ok: true, data: { pipeline: pipelineStatus, workflow: null } });
    }

    const data = await resp.json();
    const runs = (data.workflow_runs || []).slice(0, 3).map(r => ({
      id:          r.id,
      status:      r.status,       // queued | in_progress | completed
      conclusion:  r.conclusion,   // success | failure | cancelled | null
      createdAt:   r.created_at,
      updatedAt:   r.updated_at,
      htmlUrl:     r.html_url,
      runDuration: r.updated_at && r.created_at
        ? Math.round((new Date(r.updated_at) - new Date(r.created_at)) / 1000)
        : null,
    }));

    res.json({ ok: true, data: { pipeline: pipelineStatus, workflow: { runs } } });
  } catch (err) {
    res.json({ ok: true, data: { pipeline: pipelineStatus, workflow: null, error: err.message } });
  }
};
