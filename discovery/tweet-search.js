const { getBearerClient } = require('../twitter/client');
const { limiter, shortDelay } = require('../twitter/rate-limiter');
const { checkBudget } = require('../tracking/budget');
const targets = require('../config/targets');

// In-memory dedup cache for this session (tweet IDs already seen today)
const _seenTweetIds = new Set();

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
 * Returns array of normalized tweet objects.
 */
async function searchTweets(query, maxResults = 20) {
  await checkBudget('recentSearch');
  if (!limiter.recordRequest('recentSearch')) {
    console.warn('[search] Rate limit hit, skipping query');
    return [];
  }

  const client = getBearerClient();

  try {
    const result = await client.v2.search(query, {
      max_results: Math.min(maxResults, 100),
      'tweet.fields': ['public_metrics', 'created_at', 'conversation_id', 'author_id', 'entities', 'text'],
      'user.fields': ['public_metrics', 'username', 'name', 'verified'],
      expansions: ['author_id'],
    });

    if (!result.data || !result.data.data) {
      return [];
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

    // Mark all as seen
    tweets.forEach(t => _seenTweetIds.add(t.id));

    return tweets;
  } catch (err) {
    console.error(`[search] Failed query "${query.substring(0, 60)}...":`, err.message);
    return [];
  }
}

/**
 * Run 2-3 search queries and combine results, deduplicating by tweet ID.
 */
async function discoverTweets(mode = 'normal') {
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
    console.log(`[search] Query: ${query.substring(0, 80)}...`);
    const tweets = await searchTweets(query, targets.maxResultsPerQuery);
    console.log(`[search] Found ${tweets.length} new tweets`);

    for (const t of tweets) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        allTweets.push(t);
      }
    }

    await shortDelay(2000, 5000);
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
