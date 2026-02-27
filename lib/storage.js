/**
 * lib/storage.js — Unified async storage adapter.
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL is set (Vercel / prod).
 * Falls back to local filesystem when running the CLI locally without Redis.
 */

const fs   = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../logs');
const IS_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

let _redis = null;

function getRedis() {
  if (!_redis) {
    const { Redis } = require('@upstash/redis');
    _redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

// ── File path helpers ──────────────────────────────────────────────────────

function keyToPath(key) {
  // "log:2026-02-26" → logs/log_2026-02-26.json
  const safe = key.replace(/[^a-z0-9\-_.]/gi, '_');
  return path.join(LOGS_DIR, `${safe}.json`);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get a value by key. Returns null if not found.
 */
async function get(key) {
  if (IS_REDIS) {
    try {
      return await getRedis().get(key);
    } catch (err) {
      console.error('[storage] Redis get error:', err.message);
      return null;
    }
  }

  const filePath = keyToPath(key);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_) {}
  return null;
}

/**
 * Set a value by key.
 * @param {string} key
 * @param {*}      value   - Will be JSON-serialised in file mode; Redis stores as-is.
 * @param {object} [opts]  - { ex: seconds } — TTL (Redis only; ignored locally)
 */
async function set(key, value, opts = {}) {
  if (IS_REDIS) {
    try {
      const r = getRedis();
      if (opts.ex) {
        await r.set(key, value, { ex: opts.ex });
      } else {
        await r.set(key, value);
      }
    } catch (err) {
      console.error('[storage] Redis set error:', err.message);
    }
    return;
  }

  const filePath = keyToPath(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

/**
 * Delete a key.
 */
async function del(key) {
  if (IS_REDIS) {
    try { await getRedis().del(key); } catch (_) {}
    return;
  }
  const filePath = keyToPath(key);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/**
 * Check if a key exists.
 */
async function exists(key) {
  if (IS_REDIS) {
    try { return (await getRedis().exists(key)) === 1; } catch (_) { return false; }
  }
  return fs.existsSync(keyToPath(key));
}

module.exports = { get, set, del, exists, IS_REDIS };
