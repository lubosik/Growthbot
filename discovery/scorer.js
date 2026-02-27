const targets = require('../config/targets');
const persona = require('../config/persona');

/**
 * Score a tweet on a 0-100 scale based on engagement opportunity.
 */
function scoreTweet(tweet) {
  let score = 0;
  const reasons = [];

  // ── Like count (up to 30 pts) ──────────────────────────────────────────
  if (tweet.likes >= 1000) {
    score += 30;
    reasons.push('high likes (1k+)');
  } else if (tweet.likes >= 500) {
    score += 20;
    reasons.push('good likes (500+)');
  } else if (tweet.likes >= 100) {
    score += 10;
    reasons.push('decent likes (100+)');
  }

  // ── Reply count / active conversation (up to 20 pts) ──────────────────
  if (tweet.replies >= 100) {
    score += 20;
    reasons.push('very active thread (100+ replies)');
  } else if (tweet.replies >= 20) {
    score += 10;
    reasons.push('active thread (20+ replies)');
  } else if (tweet.replies >= 5) {
    score += 5;
    reasons.push('some replies (5+)');
  }

  // ── Author follower count (up to 15 pts) ──────────────────────────────
  if (tweet.authorFollowers >= 100000) {
    score += 15;
    reasons.push('mega author (100k+ followers)');
  } else if (tweet.authorFollowers >= 10000) {
    score += 10;
    reasons.push('large author (10k+ followers)');
  } else if (tweet.authorFollowers >= 1000) {
    score += 5;
    reasons.push('medium author (1k+ followers)');
  }

  // ── Priority account bonus (up to 10 pts) ─────────────────────────────
  if (targets.priorityAccounts.map(a => a.toLowerCase()).includes(tweet.authorUsername.toLowerCase())) {
    score += 10;
    reasons.push('priority account');
  }

  // ── Relevance to persona interests (up to 20 pts) ─────────────────────
  const text = tweet.text.toLowerCase();
  const relevanceScore = computeRelevanceScore(text);
  score += relevanceScore.points;
  if (relevanceScore.points > 0) {
    reasons.push(relevanceScore.reason);
  }

  // ── Reply opportunity / gap detection (up to 15 pts) ──────────────────
  if (tweet.replyGaps && tweet.replyGaps.length > 0) {
    score += 15;
    reasons.push(`reply gap: ${tweet.replyGaps[0]}`);
  } else if (tweet.replies < 10) {
    score += 8;
    reasons.push('low reply count — early entry');
  }

  // ── Skip filters (hard deductions) ────────────────────────────────────
  const skipTopics = targets.skipTopics || [];
  if (skipTopics.some(t => text.includes(t.toLowerCase()))) {
    score = 0;
    reasons.push('SKIP: political/off-topic content');
  }

  // Deduct for already-replied topics (if author replied to)
  if (tweet._alreadyEngaged) {
    score = 0;
    reasons.push('SKIP: already engaged with author today');
  }

  return {
    ...tweet,
    score: Math.min(100, score),
    scoreReasons: reasons,
  };
}

/**
 * Compute a relevance score based on how well the tweet aligns with persona interests.
 */
function computeRelevanceScore(text) {
  const coreTopics = [
    { terms: ['claude', 'anthropic'], points: 20, label: 'core topic: Anthropic/Claude' },
    { terms: ['ai agent', 'ai agents', 'autonomous agent'], points: 20, label: 'core topic: AI agents' },
    { terms: ['llm', 'language model', 'foundation model'], points: 18, label: 'core topic: LLMs' },
    { terms: ['open source', 'open-source', 'llama', 'mistral', 'gemma'], points: 15, label: 'core topic: open source AI' },
    { terms: ['gpt', 'openai', 'gemini', 'deepmind'], points: 15, label: 'core topic: major AI labs' },
    { terms: ['production', 'deployment', 'inference', 'latency'], points: 15, label: 'core topic: production AI' },
    { terms: ['ai startup', 'ai company', 'funding', 'raised'], points: 10, label: 'adjacent: AI business' },
    { terms: ['coding', 'developer', 'api', 'tool'], points: 10, label: 'adjacent: dev tools' },
    { terms: ['africa', 'zambia', 'nairobi', 'lagos', 'emerging market'], points: 20, label: 'core topic: Africa tech' },
    { terms: ['voice ai', 'tts', 'speech'], points: 12, label: 'adjacent: voice AI' },
    { terms: ['benchmark', 'eval', 'mmlu', 'reasoning'], points: 12, label: 'adjacent: AI benchmarks' },
  ];

  for (const topic of coreTopics) {
    if (topic.terms.some(t => text.includes(t))) {
      return { points: topic.points, reason: topic.label };
    }
  }

  // Generic AI mention
  if (text.includes('artificial intelligence') || text.includes(' ai ') || text.includes(' ai.')) {
    return { points: 8, reason: 'general AI topic' };
  }

  return { points: 0, reason: '' };
}

/**
 * Sort and select the top tweets for engagement.
 */
function selectTopTweets(tweets, mode = 'normal') {
  const limits = {
    normal: { min: 12, max: 15 },
    reduced: { min: 6, max: 8 },
  };
  const limit = limits[mode] || limits.normal;

  const scored = tweets.map(scoreTweet);
  const filtered = scored.filter(t => t.score > 0);
  const sorted = filtered.sort((a, b) => b.score - a.score);

  // Deduplicate by author (max 2 per author per run)
  const authorCounts = {};
  const selected = [];
  for (const tweet of sorted) {
    const author = tweet.authorUsername.toLowerCase();
    if (!authorCounts[author]) authorCounts[author] = 0;
    if (authorCounts[author] < 2) {
      selected.push(tweet);
      authorCounts[author]++;
    }
    if (selected.length >= limit.max) break;
  }

  console.log(`[scorer] Scored ${tweets.length} tweets → selected ${selected.length} (mode: ${mode})`);
  return selected;
}

module.exports = { scoreTweet, selectTopTweets, computeRelevanceScore };
