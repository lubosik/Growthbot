#!/usr/bin/env node
/**
 * run.js — Main pipeline for the X Engagement Bot.
 *
 * Usage:
 *   node run.js                  # Full pipeline
 *   node run.js --dry-run        # Discover + generate, don't post
 *   node run.js --discover-only  # Just find and score tweets
 *   node run.js --notify-only    # Send content ideas to Telegram
 *   node run.js --budget         # Show budget status and exit
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Parse CLI args ─────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const DISCOVER_ONLY = args.has('--discover-only');
const NOTIFY_ONLY = args.has('--notify-only');
const BUDGET_ONLY = args.has('--budget');

// ── Validate environment ───────────────────────────────────────────────────
const { validateEnv } = require('./config/env');
validateEnv({ requireWriteAccess: !DRY_RUN && !DISCOVER_ONLY && !NOTIFY_ONLY && !BUDGET_ONLY });

// ── Module imports ─────────────────────────────────────────────────────────
const { getRWClient }                     = require('./twitter/client');
const { discoverTweets, loadSeenIds }     = require('./discovery/tweet-search');
const { enrichWithComments }              = require('./discovery/comment-reader');
const { selectTopTweets }                 = require('./discovery/scorer');
const { generateReply }                   = require('./ai/reply-generator');
const { enrichWithResearch }              = require('./ai/research');
const { engageTweet }                     = require('./twitter/actions');
const { randomDelay }                     = require('./twitter/rate-limiter');
const { checkBudget, getBudgetStatus,
        incrementRunCount, printBudgetStatus,
        recordCost }                      = require('./tracking/budget');
const { initDayLog, loadTodayLog,
        saveLog, logReply, logError }     = require('./tracking/logger');
const { buildReport, printConsoleSummary } = require('./tracking/daily-report');
const { sendEngagementReport }            = require('./telegram/notifier');

// ── Helpers ────────────────────────────────────────────────────────────────

function pickQuoteCandidates(tweets) {
  return tweets.filter(t => t.score >= 75 && t.replies >= 30).slice(0, 2);
}

function pickRetweetCandidates(tweets, max = 5) {
  return tweets.filter(t => t.score >= 65).slice(0, max);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main pipeline ──────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      X Engagement Bot — @lubosi_k        ║');
  console.log(`║  ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC          ║`);
  console.log('╚══════════════════════════════════════════╝\n');

  // ── --budget flag ────────────────────────────────────────────────────────
  if (BUDGET_ONLY) {
    printBudgetStatus();
    return;
  }

  // ── Step 0: Verify auth ──────────────────────────────────────────────────
  console.log('[ 0/9 ] Verifying auth...');
  try {
    const rwClient = getRWClient();
    const me = await rwClient.v2.me();
    console.log(`        ✓ Authenticated as @${me.data.username} (ID: ${me.data.id})`);
    process.env.MY_TWITTER_USER_ID = me.data.id;
  } catch (err) {
    console.error('❌ AUTH FAILED:', err.message);
    if (err.data) console.error('   Details:', JSON.stringify(err.data));
    if (err.errors) console.error('   Errors:', JSON.stringify(err.errors));
    console.error('');
    console.error('Fix: Check your tokens in .env are correct and have Read+Write permissions.');
    console.error('     Go to developer.x.com → App → Keys & Tokens → Regenerate.');
    console.error('     Then re-run: node auth.js');
    process.exit(1);
  }

  // ── Step 1: Budget check ─────────────────────────────────────────────────
  console.log('[ 1/9 ] Checking budget...');
  let budgetStatus;
  try {
    budgetStatus = await checkBudget();
  } catch (err) {
    console.error('Budget hard stop reached:', err.message);
    process.exit(1);
  }

  const mode = budgetStatus.mode || 'normal';
  console.log(`        Mode: ${mode} | Est. spend: $${(budgetStatus.estimated_spend ?? 0).toFixed(4)}`);

  // ── Initialize log ───────────────────────────────────────────────────────
  const log = await loadTodayLog();
  log.mode = mode;
  log.runStarted = new Date().toISOString();

  const runNumber = incrementRunCount();
  log.runNumber = runNumber;

  // ── --notify-only mode ───────────────────────────────────────────────────
  if (NOTIFY_ONLY) {
    const report = buildReport(log, []);
    await sendEngagementReport({ ...report, runNumber });
    console.log('Notification sent.');
    return;
  }

  // ── Step 2: Discover tweets ──────────────────────────────────────────────
  console.log('\n[ 2/9 ] Discovering tweets...');
  loadSeenIds(log);

  let tweets = [];
  try {
    tweets = await discoverTweets(mode);
    log.tweetsDiscovered = tweets.length;
    console.log(`        Discovered ${tweets.length} tweets`);
  } catch (err) {
    logError(log, err);
    console.error('Discovery failed:', err.message);
  }

  if (tweets.length === 0) {
    console.warn('No tweets found. Ending run.');
    await saveLog(log);
    return;
  }

  // ── Step 3: Score & select ───────────────────────────────────────────────
  console.log('\n[ 3/9 ] Scoring and selecting tweets...');
  const selected = selectTopTweets(tweets, mode);
  log.tweetsScored = tweets.length;
  log.tweetsEngaged = selected.length;
  console.log(`        Selected ${selected.length} tweets`);

  if (DISCOVER_ONLY) {
    console.log('\n── Top tweets ──────────────────────────────────');
    selected.forEach((t, i) => {
      console.log(`${i + 1}. [${t.score}] @${t.authorUsername}: ${t.text.substring(0, 80)}...`);
      console.log(`   Reasons: ${t.scoreReasons.join(', ')}`);
    });
    await saveLog(log);
    return;
  }

  // ── Step 4: Read comment sections ────────────────────────────────────────
  console.log('\n[ 4/9 ] Reading comment sections...');
  let enrichedTweets = [];
  try {
    enrichedTweets = await enrichWithComments(selected, 10);
    console.log(`        Read comments for ${Math.min(selected.length, 10)} tweets`);
  } catch (err) {
    logError(log, err);
    console.error('Comment reading failed:', err.message);
    enrichedTweets = selected;
  }

  // ── Step 5: Research (Brave Search) ──────────────────────────────────────
  console.log('\n[ 5/9 ] Researching high-value tweets...');
  let researchedTweets = [];
  try {
    researchedTweets = await enrichWithResearch(enrichedTweets);
    const researched = researchedTweets.filter(t => t.researchNotes).length;
    console.log(`        Researched ${researched} tweets`);
    log.cost.braveSearches = researchedTweets.filter(t => t.researchNotes).length;
  } catch (err) {
    logError(log, err);
    console.error('Research failed:', err.message);
    researchedTweets = enrichedTweets;
  }

  // ── Step 6: Generate replies ──────────────────────────────────────────────
  console.log('\n[ 6/9 ] Generating replies with Claude...');

  const quoteCandidates = new Set(pickQuoteCandidates(researchedTweets).map(t => t.id));
  const retweetCandidates = new Set(pickRetweetCandidates(researchedTweets).map(t => t.id));

  const engagementPlan = [];
  let claudeCallCount = 0;

  for (const tweet of researchedTweets) {
    try {
      const replyResult = await generateReply(tweet, tweet.researchNotes || '');
      claudeCallCount++;

      if (replyResult.regenerated) claudeCallCount++; // Counted twice if regenerated

      const isQuote = quoteCandidates.has(tweet.id);

      // For quote tweets, generate the quote text using Sonnet
      let quoteText = null;
      if (isQuote) {
        const quoteResult = await generateReply(tweet, tweet.researchNotes || '');
        quoteText = quoteResult.selectedReply.text;
        claudeCallCount++;
      }

      engagementPlan.push({
        tweet,
        replyText: replyResult.selectedReply.text,
        replyStyle: replyResult.selectedReply.style,
        shouldRetweet: retweetCandidates.has(tweet.id),
        shouldQuote: isQuote,
        quoteText,
        replyResult,
      });

      console.log(`        [${tweet.score}] @${tweet.authorUsername}: "${replyResult.selectedReply.text.substring(0, 60)}..." (${replyResult.selectedReply.style})`);
    } catch (err) {
      logError(log, err);
      console.error(`        Failed to generate reply for ${tweet.id}:`, err.message);
    }
  }

  log.cost.claudeCalls = claudeCallCount;
  console.log(`        Generated ${engagementPlan.length} replies (${claudeCallCount} Claude calls)`);

  if (DRY_RUN) {
    console.log('\n── DRY RUN — replies not posted ─────────────────');
    engagementPlan.forEach((plan, i) => {
      console.log(`\n${i + 1}. @${plan.tweet.authorUsername} [score:${plan.tweet.score}]`);
      console.log(`   Tweet: "${plan.tweet.text.substring(0, 100)}..."`);
      console.log(`   Reply (${plan.replyStyle}): "${plan.replyText}"`);
      if (plan.shouldRetweet) console.log('   → Would retweet');
      if (plan.shouldQuote) console.log(`   → Would quote: "${plan.quoteText}"`);
    });
    await saveLog(log);
    return;
  }

  // ── Step 7: Engage (with delays) ─────────────────────────────────────────
  console.log('\n[ 7/9 ] Engaging...');
  console.log('        (random delays between actions — this will take a while)\n');

  // Shuffle engagement order
  const shuffled = [...engagementPlan].sort(() => Math.random() - 0.5);

  let retweetCount = 0;
  const MAX_RETWEETS_PER_RUN = 5;

  for (let i = 0; i < shuffled.length; i++) {
    const plan = shuffled[i];
    const { tweet, replyText, replyStyle, shouldQuote, quoteText } = plan;

    // Cap retweets
    const doRetweet = plan.shouldRetweet && retweetCount < MAX_RETWEETS_PER_RUN;

    console.log(`\n  [${i + 1}/${shuffled.length}] Engaging @${tweet.authorUsername}...`);

    try {
      const result = await engageTweet(tweet, replyText, {
        shouldRetweet: doRetweet,
        shouldQuote,
        quoteText,
        dryRun: false,
      });

      if (result.liked) log.actions.likes++;
      if (result.replied) log.actions.replies++;
      if (result.retweeted) { log.actions.retweets++; retweetCount++; }
      if (result.quoted) log.actions.quoteTweets++;

      logReply(log, {
        tweetId: tweet.id,
        author: tweet.authorName,
        authorHandle: tweet.authorUsername,
        originalText: tweet.text,
        replyText,
        replyStyle,
        replyId: result.replyId || null,
        score: tweet.score,
        tweetUrl: tweet.url,
      });

      if (result.errors.length > 0) {
        result.errors.forEach(e => logError(log, `${e.action}: ${e.error}`));
      }
    } catch (err) {
      logError(log, err);
      console.error(`  Failed to engage ${tweet.id}:`, err.message);
    }

    // Between tweets: 60-180 second delay
    if (i < shuffled.length - 1) {
      const delaySec = Math.floor(Math.random() * 120) + 60;
      console.log(`  Waiting ${delaySec}s before next tweet...`);
      await sleep(delaySec * 1000);
    }
  }

  // ── Step 8: Telegram notification ────────────────────────────────────────
  console.log('\n[ 8/9 ] Sending Telegram report...');
  try {
    const report = buildReport(log, researchedTweets);
    await sendEngagementReport({ ...report, runNumber });
    console.log('        Report sent');
  } catch (err) {
    logError(log, err);
    console.error('        Telegram failed (non-fatal):', err.message);
  }

  // ── Step 9: Save log ──────────────────────────────────────────────────────
  console.log('\n[ 9/9 ] Saving logs...');
  const finalBudget = getBudgetStatus();
  log.monthlyBudget = {
    used: Math.round((finalBudget.estimatedSpend / finalBudget.hardStop) * 100),
    remaining: Math.max(0, finalBudget.hardStop - finalBudget.estimatedSpend),
  };
  log.cost.estimatedCost = `$${(finalBudget.todayBreakdown?.estimated_cost || 0).toFixed(4)}`;
  await saveLog(log);

  printConsoleSummary(log, finalBudget);
}

// ── Run ────────────────────────────────────────────────────────────────────
main().catch(err => {
  console.error('\nFatal error:', err.message);
  if (process.env.NODE_ENV !== 'test') process.exit(1);
});
