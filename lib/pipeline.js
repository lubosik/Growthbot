/**
 * lib/pipeline.js — Extracted pipeline function.
 *
 * Called by run.js (CLI) and api/trigger.js (Vercel → GitHub Actions).
 * Uses async storage so logs/budget persist to Redis on Vercel or files locally.
 */

const { discoverTweets, loadSeenIds }   = require('../discovery/tweet-search');
const { enrichWithComments }            = require('../discovery/comment-reader');
const { selectTopTweets }               = require('../discovery/scorer');
const { generateReply }                 = require('../ai/reply-generator');
const { enrichWithResearch }            = require('../ai/research');
const { engageTweet }                   = require('../twitter/actions');
const { sendEngagementReport }          = require('../telegram/notifier');
const { buildReport, printConsoleSummary } = require('../tracking/daily-report');
const { getBudgetStatus, incrementRunCount } = require('../tracking/budget');
const storage                           = require('./storage');

// ── Async storage helpers ──────────────────────────────────────────────────

function todayKey() { return new Date().toISOString().split('T')[0]; }
function budgetKey() { return 'budget:current'; }
function logKey(date) { return `log:${date}`; }
function pipelineStatusKey() { return 'pipeline:status'; }

async function loadTodayLog() {
  const data = await storage.get(logKey(todayKey()));
  if (data) return data;
  return {
    date: todayKey(),
    runStarted: new Date().toISOString(),
    runCompleted: null,
    tweetsDiscovered: 0,
    tweetsScored: 0,
    tweetsEngaged: 0,
    mode: 'normal',
    runNumber: 1,
    actions: { replies: 0, likes: 0, retweets: 0, quoteTweets: 0 },
    monthlyBudget: { used: 0, remaining: 0 },
    repliesSent: [],
    contentIdeas: [],
    errors: [],
    cost: { claudeCalls: 0, braveSearches: 0, estimatedCost: '$0.00' },
  };
}

async function saveLog(log) {
  log.runCompleted = new Date().toISOString();
  await storage.set(logKey(log.date || todayKey()), log, { ex: 60 * 60 * 24 * 90 }); // 90 days
}

async function setPipelineStatus(status) {
  await storage.set(pipelineStatusKey(), status, { ex: 60 * 60 * 24 }); // 1 day
}

// ── Main pipeline ──────────────────────────────────────────────────────────

/**
 * Run the full engagement pipeline.
 *
 * @param {object}       opts
 * @param {boolean}      opts.dryRun        - Generate replies but don't post
 * @param {boolean}      opts.discoverOnly  - Just discover and score, don't generate
 * @param {string}       opts.mode          - Override budget mode ('normal'|'reduced')
 * @param {Function}     opts.log           - Progress logger (defaults to console.log)
 * @returns {object}     Final report data
 */
async function runPipeline(opts = {}) {
  const {
    dryRun       = false,
    discoverOnly = false,
    log          = console.log,
  } = opts;

  // ── Step 1: Load budget + check hard stop ─────────────────────────────
  log('[1/9] Checking budget...');
  const budgetStatus = getBudgetStatus();

  if (budgetStatus.estimatedSpend >= budgetStatus.hardStop) {
    const msg = `HARD STOP: estimated spend $${budgetStatus.estimatedSpend.toFixed(2)} >= $${budgetStatus.hardStop}`;
    log('[budget] ' + msg);
    throw new Error(msg);
  }

  const mode = budgetStatus.mode || 'normal';
  log(`       Mode: ${mode} | Spend: $${budgetStatus.estimatedSpend.toFixed(4)}`);

  await setPipelineStatus({ status: 'running', mode, dryRun, startedAt: new Date().toISOString() });

  // ── Initialize log ────────────────────────────────────────────────────
  const dailyLog = await loadTodayLog();
  dailyLog.mode = mode;
  dailyLog.runStarted = new Date().toISOString();

  const runNumber = incrementRunCount();
  dailyLog.runNumber = runNumber;

  // ── Step 2: Discover tweets ───────────────────────────────────────────
  log('\n[2/9] Discovering tweets...');
  loadSeenIds(dailyLog);

  let tweets = [];
  try {
    tweets = await discoverTweets(mode);
    dailyLog.tweetsDiscovered = tweets.length;
    log(`       Found ${tweets.length} tweets`);
  } catch (err) {
    dailyLog.errors.push({ message: err.message, timestamp: new Date().toISOString() });
    log('       Discovery failed: ' + err.message);
  }

  if (tweets.length === 0) {
    log('No tweets found. Ending run.');
    await saveLog(dailyLog);
    await setPipelineStatus({ status: 'done', runNumber, actions: dailyLog.actions });
    return buildReport(dailyLog, []);
  }

  // ── Step 3: Score & select ────────────────────────────────────────────
  log('\n[3/9] Scoring tweets...');
  const selected = selectTopTweets(tweets, mode);
  dailyLog.tweetsScored = tweets.length;
  dailyLog.tweetsEngaged = selected.length;
  log(`       Selected ${selected.length} tweets`);

  if (discoverOnly) {
    selected.forEach((t, i) => log(`  ${i + 1}. [${t.score}] @${t.authorUsername}: ${t.text.substring(0, 80)}`));
    await saveLog(dailyLog);
    await setPipelineStatus({ status: 'done', runNumber, actions: dailyLog.actions });
    return buildReport(dailyLog, selected);
  }

  // ── Step 4: Read comment sections ─────────────────────────────────────
  log('\n[4/9] Reading comment sections...');
  let enrichedTweets = selected;
  try {
    enrichedTweets = await enrichWithComments(selected, 10);
    log(`       Read comments for ${Math.min(selected.length, 10)} tweets`);
  } catch (err) {
    dailyLog.errors.push({ message: err.message, timestamp: new Date().toISOString() });
    log('       Comment read failed (non-fatal): ' + err.message);
  }

  // ── Step 5: Research ──────────────────────────────────────────────────
  log('\n[5/9] Researching high-value tweets...');
  let researchedTweets = enrichedTweets;
  try {
    researchedTweets = await enrichWithResearch(enrichedTweets);
    const researched = researchedTweets.filter(t => t.researchNotes).length;
    log(`       Researched ${researched} tweets`);
    dailyLog.cost.braveSearches = researched;
  } catch (err) {
    dailyLog.errors.push({ message: err.message, timestamp: new Date().toISOString() });
    log('       Research failed (non-fatal): ' + err.message);
  }

  // ── Step 6: Generate replies ──────────────────────────────────────────
  log('\n[6/9] Generating replies...');

  const engagementPlan = [];
  let claudeCallCount = 0;

  for (const tweet of researchedTweets) {
    try {
      const result = await generateReply(tweet, tweet.researchNotes || '');
      claudeCallCount++;
      if (result.regenerated) claudeCallCount++;

      engagementPlan.push({
        tweet,
        replyText: result.selectedReply.text,
        replyStyle: result.selectedReply.style,
        shouldRetweet: tweet.score >= 75 && tweet.retweets >= 50,
        shouldQuote: false,
        result,
      });

      log(`       [${tweet.score}] @${tweet.authorUsername}: "${result.selectedReply.text.substring(0, 60)}..." (${result.selectedReply.style})`);
    } catch (err) {
      dailyLog.errors.push({ message: `Reply gen for ${tweet.id}: ${err.message}`, timestamp: new Date().toISOString() });
      log(`       Failed to generate for ${tweet.id}: ` + err.message);
    }
  }

  dailyLog.cost.claudeCalls = claudeCallCount;
  log(`       Generated ${engagementPlan.length} replies`);

  if (dryRun) {
    log('\n── DRY RUN — nothing posted ──────────────────────');
    engagementPlan.forEach((plan, i) => {
      log(`\n${i + 1}. @${plan.tweet.authorUsername} [score:${plan.tweet.score}]`);
      log(`   Tweet: "${plan.tweet.text.substring(0, 100)}"`);
      log(`   Reply (${plan.replyStyle}): "${plan.replyText}"`);
    });
    await saveLog(dailyLog);
    await setPipelineStatus({ status: 'done', runNumber, mode: 'dry-run', actions: dailyLog.actions });
    return buildReport(dailyLog, researchedTweets);
  }

  // ── Step 7: Engage ────────────────────────────────────────────────────
  log('\n[7/9] Engaging with human-like delays...');
  const shuffled = [...engagementPlan].sort(() => Math.random() - 0.5);
  let retweetCount = 0;

  for (let i = 0; i < shuffled.length; i++) {
    const plan = shuffled[i];
    const { tweet, replyText, replyStyle, shouldRetweet } = plan;
    log(`\n  [${i + 1}/${shuffled.length}] @${tweet.authorUsername}...`);

    try {
      const result = await engageTweet(tweet, replyText, {
        shouldRetweet: shouldRetweet && retweetCount < 5,
        shouldQuote: false,
        dryRun: false,
      });

      if (result.liked)     { dailyLog.actions.likes++; }
      if (result.replied)   { dailyLog.actions.replies++; }
      if (result.retweeted) { dailyLog.actions.retweets++; retweetCount++; }
      if (result.quoted)    { dailyLog.actions.quoteTweets++; }

      dailyLog.repliesSent.push({
        tweetId:     tweet.id,
        author:      tweet.authorName,
        authorHandle: tweet.authorUsername,
        originalText: tweet.text.substring(0, 280),
        replyText,
        replyStyle,
        replyId:     result.replyId || null,
        score:       tweet.score,
        tweetUrl:    tweet.url,
        timestamp:   new Date().toISOString(),
        dryRun:      false,
      });

      result.errors.forEach(e => dailyLog.errors.push({ message: `${e.action}: ${e.error}`, timestamp: new Date().toISOString() }));
    } catch (err) {
      dailyLog.errors.push({ message: err.message, timestamp: new Date().toISOString() });
      log(`  Error: ${err.message}`);
    }

    // Between-tweet delay (60-180s)
    if (i < shuffled.length - 1) {
      const delaySec = Math.floor(Math.random() * 120) + 60;
      log(`  Waiting ${delaySec}s...`);
      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }

  // ── Step 8: Telegram ──────────────────────────────────────────────────
  log('\n[8/9] Sending Telegram report...');
  const report = buildReport(dailyLog, researchedTweets);
  try {
    await sendEngagementReport({ ...report, runNumber });
    log('       Sent');
  } catch (err) {
    log('       Telegram failed (non-fatal): ' + err.message);
  }

  // ── Step 9: Save ──────────────────────────────────────────────────────
  log('\n[9/9] Saving log...');
  const finalBudget = getBudgetStatus();
  dailyLog.monthlyBudget = {
    used:      Math.round((finalBudget.estimatedSpend / finalBudget.hardStop) * 100),
    remaining: Math.max(0, finalBudget.hardStop - finalBudget.estimatedSpend),
  };
  dailyLog.cost.estimatedCost = `$${(finalBudget.todayBreakdown?.estimated_cost || 0).toFixed(4)}`;
  await saveLog(dailyLog);

  await setPipelineStatus({
    status:    'done',
    runNumber,
    actions:   dailyLog.actions,
    completedAt: new Date().toISOString(),
  });

  printConsoleSummary(dailyLog, finalBudget);
  return report;
}

module.exports = { runPipeline, loadTodayLog, saveLog, setPipelineStatus };
