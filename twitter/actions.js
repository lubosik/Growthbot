const { getRWClient } = require('./client');
const { limiter, randomDelay } = require('./rate-limiter');
const { checkBudget, recordCost } = require('../tracking/budget');

/**
 * Shuffle an array in place (Fisher-Yates).
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Get the authenticated user's ID. Uses env var if set, otherwise fetches.
 */
async function getMyUserId() {
  if (process.env.MY_TWITTER_USER_ID) {
    return process.env.MY_TWITTER_USER_ID;
  }
  const client = getRWClient();
  const me = await client.v2.me();
  return me.data.id;
}

/**
 * Post a reply to a tweet.
 */
async function replyToTweet(tweetId, text) {
  await checkBudget('createTweet');
  if (!limiter.recordRequest('createTweet')) {
    throw new Error('Rate limit reached for createTweet');
  }

  const client = getRWClient();
  const result = await client.v2.tweet({
    text,
    reply: { in_reply_to_tweet_id: tweetId },
  });
  recordCost('createTweet');
  return result.data;
}

/**
 * Like a tweet.
 */
async function likeTweet(tweetId) {
  await checkBudget('like');
  if (!limiter.recordRequest('likes')) {
    throw new Error('Rate limit reached for likes');
  }

  const userId = await getMyUserId();
  const client = getRWClient();
  const result = await client.v2.like(userId, tweetId);
  recordCost('like');
  return result.data;
}

/**
 * Retweet a tweet.
 */
async function retweetTweet(tweetId) {
  await checkBudget('retweet');
  if (!limiter.recordRequest('retweets')) {
    throw new Error('Rate limit reached for retweets');
  }

  const userId = await getMyUserId();
  const client = getRWClient();
  const result = await client.v2.retweet(userId, tweetId);
  recordCost('retweet');
  return result.data;
}

/**
 * Post a quote tweet.
 */
async function quoteTweet(tweetId, text) {
  await checkBudget('createTweet');
  if (!limiter.recordRequest('createTweet')) {
    throw new Error('Rate limit reached for createTweet');
  }

  const client = getRWClient();
  const result = await client.v2.tweet({
    text,
    quote_tweet_id: tweetId,
  });
  recordCost('quoteTweet');
  return result.data;
}

/**
 * Execute a full engagement sequence for a tweet.
 * Actions are randomized in order. Delays are human-like.
 *
 * @param {object} tweet        - Tweet object with id, authorUsername, etc.
 * @param {string} replyText    - Generated reply text
 * @param {object} opts         - { shouldRetweet, shouldQuote, quoteText, dryRun }
 */
async function engageTweet(tweet, replyText, opts = {}) {
  const { shouldRetweet = false, shouldQuote = false, quoteText = null, dryRun = false } = opts;
  const results = { liked: false, replied: false, retweeted: false, quoted: false, errors: [] };

  // Build action sequence
  const actions = ['like', 'reply'];
  if (shouldRetweet) actions.push('retweet');
  if (shouldQuote && quoteText) actions.push('quote');

  // Randomize order (but like usually goes first anyway)
  shuffle(actions);

  for (const action of actions) {
    try {
      if (dryRun) {
        console.log(`[dry-run] Would ${action}: ${tweet.id}`);
        results[`${action}d`] = true;
        continue;
      }

      if (action === 'like') {
        await likeTweet(tweet.id);
        results.liked = true;
        console.log(`[action] Liked @${tweet.authorUsername}'s tweet`);
      } else if (action === 'reply') {
        const posted = await replyToTweet(tweet.id, replyText);
        results.replied = true;
        results.replyId = posted.id;
        console.log(`[action] Replied to @${tweet.authorUsername}`);
      } else if (action === 'retweet') {
        await retweetTweet(tweet.id);
        results.retweeted = true;
        console.log(`[action] Retweeted @${tweet.authorUsername}`);
      } else if (action === 'quote') {
        const posted = await quoteTweet(tweet.id, quoteText);
        results.quoted = true;
        results.quoteId = posted.id;
        console.log(`[action] Quote tweeted @${tweet.authorUsername}`);
      }

      // Random human-like delay between actions (45-120s)
      if (actions.indexOf(action) < actions.length - 1) {
        const delaySec = Math.floor(Math.random() * 75) + 45;
        console.log(`[delay] Waiting ${delaySec}s before next action...`);
        await new Promise(r => setTimeout(r, delaySec * 1000));
      }
    } catch (err) {
      console.error(`[action] Failed to ${action} tweet ${tweet.id}:`);
      console.error(`  Status: ${err.code || err.status || 'unknown'}`);
      console.error(`  Message: ${err.message}`);
      if (err.data) console.error(`  Details: ${JSON.stringify(err.data)}`);
      if (err.errors) console.error(`  Errors: ${JSON.stringify(err.errors)}`);
      const code = err.code || err.status;
      if (code === 403) {
        console.error(`  → 403: Missing write permissions. Re-run: node auth.js`);
        console.error(`  → Or go to developer.x.com → App → Settings → Read+Write permissions → Regenerate tokens`);
      } else if (code === 429) {
        console.error(`  → 429: Rate limited. Wait for rate limit reset before next run.`);
      } else if (code === 401) {
        console.error(`  → 401: Invalid/expired credentials. Re-run: node auth.js`);
      } else if (code === 400) {
        console.error(`  → 400: Bad request. Check tweet ID is valid and not deleted.`);
      }
      results.errors.push({ action, error: err.message });
    }
  }

  return results;
}

module.exports = { replyToTweet, likeTweet, retweetTweet, quoteTweet, engageTweet, getMyUserId };
