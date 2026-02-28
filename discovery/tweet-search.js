const { getBearerClient } = require('../twitter/client');
const { limiter, shortDelay } = require('../twitter/rate-limiter');
const { checkBudget, recordCost } = require('../tracking/budget');
const targets = require('../config/targets');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// In-memory dedup cache for this session (tweet IDs already seen today)
const _seenTweetIds = new Set();

// Persistent search state: since_id per query to avoid re-fetching old tweets
const SEARCH_STATE_PATH = path.join(__dirname, '../logs/.search-state.json');

function loadSearchState() {
  try {
    if (fs.existsSync(SEARCH_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(SEARCH_STATE_PATH, 'utf8'));
    }
  } catch (_) {}
  return { queryNewestIds: {} };
}

function saveSearchState(state) {
  try {
    fs.mkdirSync(path.dirname(SEARCH_STATE_PATH), { recursive: true });
    fs.writeFileSync(SEARCH_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (_) {}
}

// Short hash to key query newest-IDs without storing massive strings
function queryKey(query) {
  return crypto.createHash('md5').update(query).digest('hex').substring(0, 8);
}

/**
 * Load previously-seen tweet IDs from today's log to avoid re-fetching.
 */
function loadSeenIds(dailyLog) {
  if (dailyLog && dailyLog.repliesSent) {
    dailyLog.repliesSent.forEach(r => _seenTweetIds.add(r.tweetId));
  }
}

/**
 * Search for recent tweets matching a query.
 * Uses since_id to only fetch tweets newer than the last run.
 * Returns array of normalized tweet objects.
 */
async function searchTweets(query, maxResults = 20) {
  // Check if X API has told us to back off
  if (limiter.isGloballyBlocked()) {
    const resetMs = limiter.getBlockedUntil();
    const waitMin = Math.ceil((resetMs - Date.now()) / 60000);
    console.warn(`[search] Skipping — X API rate limited for ~${waitMin} more min`);
    return [];
  }

  await checkBudget('recentSearch');
  if (!limiter.recordRequest('recentSearch')) {
    console.warn('[search] Local rate limit hit, skipping query');
    return [];
  }

  const client = getBearerClient();
  const searchState = loadSearchState();
  const qKey = queryKey(query);
  const sinceId = searchState.queryNewestIds[qKey];

  const params = {
    max_results: Math.min(maxResults, 100),
    'tweet.fields': ['public_metrics', 'created_at', 'conversation_id', 'author_id', 'entities', 'text'],
    'user.fields': ['public_metrics', 'username', 'name', 'verified'],
    expansions: ['author_id'],
    sort_order: 'recency',
  };

  // Only fetch tweets newer than last seen — this is the primary dedup mechanism
  if (sinceId) {
    params.since_id = sinceId;
  }

  try {
    const result = await client.v2.search(query, params);

    recordCost('recentSearch');

    // Sync local rate limit windows with actual X API headers
    if (result.rateLimit && result.rateLimit.reset) {
      limiter.syncFromApiHeaders('recentSearch', result.rateLimit);
    }

    if (!result.data || !result.data.data) {
      return [];
    }

    // Persist the newest tweet ID so next run uses it as since_id
    if (result.data.meta && result.data.meta.newest_id) {
      searchState.queryNewestIds[qKey] = result.data.meta.newest_id;
      saveSearchState(searchState);
    }

    // Build author map from includes
    const authorMap = {};
    if (result.data.includes && result.data.includes.users) {
      result.data.includes.users.forEach(u => {
        authorMap[u.id] = u;
      });
    }

    const tweets = result.data.data
      .filter(t => !_seenTweetIds.has(t.id))
      .map(t => normalizeTweet(t, authorMap));

    // Mark all as seen for this session
    tweets.forEach(t => _seenTweetIds.add(t.id));

    return tweets;
  } catch (err) {
    // X API rate limit — save reset time and stop all further queries this run
    if (err.rateLimitError && err.rateLimit && err.rateLimit.reset) {
      limiter.setGlobalBlock(err.rateLimit.reset);
      return [];
    }
    console.error(`[search] Failed query "${query.substring(0, 60)}...":`, err.message);
    return [];
  }
}

/**
 * Run search queries and combine results, deduplicating by tweet ID.
 * Uses since_id per query so only genuinely new tweets are returned.
 */
async function discoverTweets(mode = 'normal') {
  // Bail immediately if X API has rate limited us
  if (limiter.isGloballyBlocked()) {
    const resetMs = limiter.getBlockedUntil();
    const waitMin = Math.ceil((resetMs - Date.now()) / 60000);
    console.warn(`[search] X API search is rate limited — try again in ~${waitMin} min`);
    return [];
  }

  const queries = targets.tweetSearchQueries;
  const count = targets.queriesPerRun[mode] || 3;

  // Pick queries, rotating based on day of month to get variety
  const dayOfMonth = new Date().getDate();
  const startIdx = dayOfMonth % queries.length;
  const selectedQueries = [];
  for (let i = 0; i < count; i++) {
    selectedQueries.push(queries[(startIdx + i) % queries.length]);
  }

  console.log(`[search] Running ${count} queries in ${mode} mode`);

  const allTweets = [];
  const seenIds = new Set();

  for (const query of selectedQueries) {
    // Stop immediately if we got rate-limited mid-run
    if (limiter.isGloballyBlocked()) {
      console.warn('[search] Rate limit hit mid-run — stopping early');
      break;
    }

    console.log(`[search] Query: ${query.substring(0, 80)}...`);
    const tweets = await searchTweets(query, targets.maxResultsPerQuery);
    console.log(`[search] Found ${tweets.length} new tweets`);

    for (const t of tweets) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        allTweets.push(t);
      }
    }

    // Only delay if we actually got results (skip delay on blocked/empty)
    if (tweets.length > 0 && !limiter.isGloballyBlocked()) {
      await shortDelay(2000, 5000);
    }
  }

  console.log(`[search] Total discovered: ${allTweets.length} tweets`);
  return allTweets;
}

/**
 * Normalize a raw tweet object into a consistent shape.
 */
function normalizeTweet(raw, authorMap = {}) {
  const author = authorMap[raw.author_id] || {};
  const metrics = raw.public_metrics || {};
  const authorMetrics = author.public_metrics || {};

  return {
    id: raw.id,
    text: raw.text || '',
    authorId: raw.author_id,
    authorUsername: author.username || 'unknown',
    authorName: author.name || 'Unknown',
    authorFollowers: authorMetrics.followers_count || 0,
    authorVerified: author.verified || false,
    conversationId: raw.conversation_id || raw.id,
    createdAt: raw.created_at,
    likes: metrics.like_count || 0,
    retweets: metrics.retweet_count || 0,
    replies: metrics.reply_count || 0,
    quotes: metrics.quote_count || 0,
    impressions: metrics.impression_count || 0,
    entities: raw.entities || {},
    url: `https://x.com/${author.username || 'i'}/status/${raw.id}`,
  };
}

module.exports = { discoverTweets, searchTweets, loadSeenIds, normalizeTweet };
