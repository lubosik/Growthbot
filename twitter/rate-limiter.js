const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '../logs/.rate-state.json');

// Rate limits per 15-minute window
const LIMITS = {
  recentSearch: { requests: 60, windowMs: 15 * 60 * 1000 },
  tweetLookup: { requests: 300, windowMs: 15 * 60 * 1000 },
  createTweet: { requests: 100, windowMs: 24 * 60 * 60 * 1000 },  // 100/day
  likes: { requests: 1000, windowMs: 24 * 60 * 60 * 1000 },
  retweets: { requests: 5, windowMs: 15 * 60 * 1000 },
};

// Estimated cost per action (USD) — rough estimates for budget tracking
const COST_PER_ACTION = {
  recentSearch: 0.008,   // per search request (returns up to 20 posts)
  tweetLookup: 0.0002,   // per tweet read
  createTweet: 0.003,    // per tweet written (reply/quote)
  like: 0.0001,
  retweet: 0.0001,
  claudeHaiku: 0.001,    // per Claude Haiku call
  braveSearch: 0.0,      // free tier
};

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch (_) {}
  return { windows: {}, dailyCounts: {}, lastReset: {} };
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (_) {}
}

class RateLimiter {
  constructor() {
    this.state = loadState();
    this._sessionCost = 0;
  }

  _getWindow(action) {
    const now = Date.now();
    const limit = LIMITS[action];
    if (!limit) return { count: 0, resetAt: now + 900000 };

    const key = action;
    if (!this.state.windows[key] || now > this.state.windows[key].resetAt) {
      this.state.windows[key] = { count: 0, resetAt: now + limit.windowMs };
    }
    return this.state.windows[key];
  }

  canMakeRequest(action) {
    const limit = LIMITS[action];
    if (!limit) return true;
    const win = this._getWindow(action);
    return win.count < limit.requests;
  }

  /**
   * Record a request and return true if allowed, false if rate-limited.
   */
  recordRequest(action) {
    const limit = LIMITS[action];
    if (!limit) return true;

    const win = this._getWindow(action);
    if (win.count >= limit.requests) {
      const waitSec = Math.ceil((win.resetAt - Date.now()) / 1000);
      console.warn(`[rate] ${action} rate limit hit. Reset in ${waitSec}s`);
      return false;
    }
    win.count++;

    const cost = COST_PER_ACTION[action] || 0;
    this._sessionCost += cost;

    saveState(this.state);
    return true;
  }

  /**
   * Sync local rate limit state from actual X API response headers.
   * Call this after a successful API response.
   * rateLimit = { limit, remaining, reset } where reset is Unix seconds.
   */
  syncFromApiHeaders(action, rateLimit) {
    if (!rateLimit || !rateLimit.reset) return;
    const resetAt = rateLimit.reset * 1000; // seconds → ms
    const count = Math.max(0, (rateLimit.limit || 0) - (rateLimit.remaining || 0));
    this.state.windows[action] = { count, resetAt };
    saveState(this.state);
  }

  /**
   * Set a global search block from a 429 response.
   * resetTimeSec is the Unix timestamp (seconds) when the block lifts.
   */
  setGlobalBlock(resetTimeSec) {
    const resetMs = resetTimeSec * 1000;
    this.state.globalBlockedUntil = resetMs;
    saveState(this.state);
    const waitMin = Math.ceil((resetMs - Date.now()) / 60000);
    console.warn(`[rate] X API 429 — search blocked for ~${waitMin} min (until ${new Date(resetMs).toISOString()})`);
  }

  /**
   * Returns true if X API has told us to back off (from a previous 429).
   */
  isGloballyBlocked() {
    const blockedUntil = this.state.globalBlockedUntil || 0;
    if (Date.now() < blockedUntil) return true;
    // Auto-clear expired block
    if (blockedUntil && Date.now() >= blockedUntil) {
      this.state.globalBlockedUntil = 0;
      saveState(this.state);
    }
    return false;
  }

  getBlockedUntil() {
    return this.state.globalBlockedUntil || 0;
  }

  getSessionCost() {
    return this._sessionCost;
  }

  /**
   * Time to wait (ms) until the rate window resets for an action.
   */
  getWaitTime(action) {
    const win = this._getWindow(action);
    return Math.max(0, win.resetAt - Date.now());
  }

  /**
   * Get estimated cost for a given action type (without recording it).
   */
  estimateCost(action) {
    return COST_PER_ACTION[action] || 0;
  }
}

// Singleton
const limiter = new RateLimiter();

/**
 * Random delay between actions to mimic human timing.
 * @param {number} minMs
 * @param {number} maxMs
 */
function randomDelay(minMs = 45000, maxMs = 120000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Short delay (used between API reads, not writes).
 */
function shortDelay(minMs = 1000, maxMs = 3000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { limiter, randomDelay, shortDelay, COST_PER_ACTION };
