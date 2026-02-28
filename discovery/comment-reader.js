const { getBearerClient } = require('../twitter/client');
const { limiter, shortDelay } = require('../twitter/rate-limiter');
const { checkBudget, recordCost } = require('../tracking/budget');

/**
 * Read the comment section of a tweet using its conversation_id.
 * Returns an array of reply objects.
 */
async function readComments(tweet, maxResults = 20) {
  await checkBudget('recentSearch');
  if (!limiter.recordRequest('recentSearch')) {
    console.warn('[comments] Rate limit hit, skipping');
    return [];
  }

  const client = getBearerClient();
  const conversationId = tweet.conversationId || tweet.id;

  // Bail if X API has rate-limited us
  if (limiter.isGloballyBlocked()) {
    return [];
  }

  try {
    const result = await client.v2.search(
      `conversation_id:${conversationId} -is:retweet`,
      {
        max_results: Math.min(maxResults, 100),
        'tweet.fields': ['public_metrics', 'created_at', 'author_id', 'text'],
        'user.fields': ['username', 'name', 'public_metrics'],
        expansions: ['author_id'],
      }
    );

    recordCost('recentSearch');

    // Sync local rate limit state with actual headers
    if (result.rateLimit && result.rateLimit.reset) {
      limiter.syncFromApiHeaders('recentSearch', result.rateLimit);
    }

    if (!result.data || !result.data.data) {
      return [];
    }

    // Build author map
    const authorMap = {};
    if (result.data.includes && result.data.includes.users) {
      result.data.includes.users.forEach(u => { authorMap[u.id] = u; });
    }

    return result.data.data.map(t => {
      const author = authorMap[t.author_id] || {};
      const metrics = t.public_metrics || {};
      return {
        id: t.id,
        text: t.text || '',
        authorUsername: author.username || 'unknown',
        authorFollowers: (author.public_metrics || {}).followers_count || 0,
        likes: metrics.like_count || 0,
        replies: metrics.reply_count || 0,
        createdAt: t.created_at,
      };
    });
  } catch (err) {
    // Propagate rate limit block so comment enrichment stops
    if (err.rateLimitError && err.rateLimit && err.rateLimit.reset) {
      limiter.setGlobalBlock(err.rateLimit.reset);
      return [];
    }
    console.error(`[comments] Failed for tweet ${tweet.id}:`, err.message);
    return [];
  }
}

/**
 * Summarize a comment section for the AI prompt.
 * Returns a short text description of the top replies.
 */
function summarizeComments(comments) {
  if (!comments || comments.length === 0) {
    return 'No replies yet — this is an opportunity to be among the first.';
  }

  // Sort by likes desc
  const sorted = [...comments].sort((a, b) => b.likes - a.likes);
  const top5 = sorted.slice(0, 5);

  const lines = [
    `${comments.length} replies. Top replies by engagement:`,
    ...top5.map((c, i) =>
      `${i + 1}. @${c.authorUsername} (${c.likes} likes): "${c.text.substring(0, 100).replace(/\n/g, ' ')}"`
    ),
  ];

  return lines.join('\n');
}

/**
 * Detect conversation "vibes" — useful angles or gaps in discussion.
 */
function detectReplyGaps(comments, originalTweet) {
  if (!comments || comments.length === 0) {
    return ['No one has replied yet — first mover advantage'];
  }

  const allText = comments.map(c => c.text.toLowerCase()).join(' ');
  const gaps = [];

  // Check if discussion covers technical depth
  const technicalTerms = ['implementation', 'code', 'api', 'latency', 'token', 'inference', 'fine-tun', 'benchmark', 'production'];
  const hasTechnicalDiscussion = technicalTerms.some(t => allText.includes(t));
  if (!hasTechnicalDiscussion) {
    gaps.push('No one is discussing the technical implementation details');
  }

  // Check if any pushback exists
  const skepticTerms = ['but', "doesn't work", "won't", 'overrated', 'hype', 'actually', 'wrong', 'nah', 'tbh'];
  const hasPushback = skepticTerms.some(t => allText.includes(t));
  if (!hasPushback) {
    gaps.push('No contrarian takes — room for a realistic perspective');
  }

  // Check if Africa / emerging markets mentioned
  if (!allText.includes('africa') && !allText.includes('emerging')) {
    gaps.push('Emerging market angle (Africa) missing from discussion');
  }

  // Check reply count (low = opportunity)
  if (comments.length < 5) {
    gaps.push('Low reply count — high visibility for early replies');
  }

  return gaps.slice(0, 3);
}

/**
 * Fetch comment sections for top N tweets in parallel (with small delays).
 */
async function enrichWithComments(tweets, topN = 10) {
  const toEnrich = tweets.slice(0, topN);
  const enriched = [];

  for (const tweet of toEnrich) {
    const comments = await readComments(tweet, 20);
    enriched.push({
      ...tweet,
      commentSection: comments,
      commentSummary: summarizeComments(comments),
      replyGaps: detectReplyGaps(comments, tweet),
    });
    await shortDelay(1500, 3500);
  }

  // Tweets beyond topN don't get comment sections
  for (const tweet of tweets.slice(topN)) {
    enriched.push({
      ...tweet,
      commentSection: [],
      commentSummary: 'Comment section not fetched.',
      replyGaps: [],
    });
  }

  return enriched;
}

module.exports = { readComments, summarizeComments, detectReplyGaps, enrichWithComments };
