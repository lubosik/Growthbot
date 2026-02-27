const { getBudgetStatus } = require('./budget');

/**
 * Build content ideas from scored tweets with high-engagement discussion.
 */
function extractContentIdeas(tweets, maxIdeas = 4) {
  const ideas = [];

  for (const tweet of tweets) {
    if (!tweet || !tweet.text) continue;
    if ((tweet.replies || 0) < 10) continue;

    const text = tweet.text.toLowerCase();

    // Detect thread opportunity
    if (tweet.replies >= 50 && tweet.score >= 60) {
      const topic = extractTopic(tweet.text);
      ideas.push({
        type: 'THREAD OPPORTUNITY',
        title: topic,
        description: `@${tweet.authorUsername} posted about this. ${tweet.replies} replies debating it. Your builder perspective would be unique.`,
        url: tweet.url,
        score: tweet.score + tweet.replies,
      });
    }

    // Detect hot take opportunity
    if ((tweet.likes >= 500 || tweet.retweets >= 100) && tweet.score >= 50) {
      const topic = extractTopic(tweet.text);
      ideas.push({
        type: 'HOT TAKE',
        title: topic,
        description: `Big engagement (${tweet.likes} likes, ${tweet.replies} replies). Strong contrarian angle available from a builder perspective.`,
        url: tweet.url,
        score: tweet.score,
      });
    }

    // Africa/emerging markets angle
    if (!tweet.text.toLowerCase().includes('africa') && tweet.score >= 40) {
      const mentions = detectAfricaAngle(tweet.text);
      if (mentions) {
        ideas.push({
          type: 'QUICK POST',
          title: `Africa/emerging markets angle on: ${extractTopic(tweet.text)}`,
          description: `No African voices in this ${tweet.replies}-reply thread. Your perspective would stand out. @${tweet.authorUsername}'s tweet is the spark.`,
          url: tweet.url,
          score: tweet.score,
        });
      }
    }

    if (ideas.length >= maxIdeas * 2) break;
  }

  // Sort by score and deduplicate
  ideas.sort((a, b) => (b.score || 0) - (a.score || 0));
  return ideas.slice(0, maxIdeas);
}

function extractTopic(text) {
  // Strip URLs
  const clean = text.replace(/https?:\/\/\S+/g, '').trim();
  // First 60 chars as topic summary
  return clean.substring(0, 60).replace(/\n/g, ' ') + (clean.length > 60 ? '...' : '');
}

function detectAfricaAngle(text) {
  const lower = text.toLowerCase();
  // If it's a global tech topic, Africa angle is possible
  const globalTopics = ['ai', 'model', 'llm', 'agent', 'startup', 'funding', 'mobile', 'fintech'];
  return globalTopics.some(t => lower.includes(t));
}

/**
 * Build the full report data object for Telegram + logs.
 */
function buildReport(log, tweets = []) {
  const budgetStatus = getBudgetStatus();

  // Find the best reply (highest-scored tweet we replied to)
  let topReply = null;
  if (log.repliesSent && log.repliesSent.length > 0) {
    const sorted = [...log.repliesSent].sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = sorted[0];
    topReply = {
      author: top.authorHandle || top.author || 'unknown',
      text: top.replyText || '',
      url: top.tweetUrl || '',
      style: top.replyStyle || 'unknown',
    };
  }

  const contentIdeas = extractContentIdeas(tweets);

  const today = log.date || new Date().toISOString().split('T')[0];
  const dayBreakdown = budgetStatus.todayBreakdown || {};

  const estimatedCost = (dayBreakdown.estimated_cost || 0).toFixed(4);

  return {
    date: today,
    runNumber: log.runNumber || 1,
    mode: log.mode || 'normal',
    actions: log.actions,
    monthlyBudget: {
      estimatedSpend: budgetStatus.estimatedSpend,
      limit: budgetStatus.hardStop,
      used: Math.round((budgetStatus.estimatedSpend / budgetStatus.hardStop) * 100),
    },
    topReply,
    contentIdeas,
    errors: log.errors || [],
    estimatedCost,
    braveSearches: log.cost?.braveSearches || 0,
    claudeCalls: log.cost?.claudeCalls || 0,
  };
}

/**
 * Print a console summary at the end of a run.
 */
function printConsoleSummary(log, budgetStatus) {
  const { actions, errors, repliesSent, cost } = log;
  console.log('\n' + '━'.repeat(50));
  console.log('  RUN COMPLETE');
  console.log('━'.repeat(50));
  console.log(`  Date:          ${log.date}`);
  console.log(`  Mode:          ${log.mode}`);
  console.log(`  Discovered:    ${log.tweetsDiscovered} tweets`);
  console.log(`  Engaged:       ${log.tweetsEngaged} tweets`);
  console.log('');
  console.log(`  Replies:       ${actions.replies}`);
  console.log(`  Likes:         ${actions.likes}`);
  console.log(`  Retweets:      ${actions.retweets}`);
  console.log(`  Quote tweets:  ${actions.quoteTweets}`);
  console.log('');
  console.log(`  Budget spend:  $${budgetStatus.estimatedSpend.toFixed(4)} / $${budgetStatus.hardStop}`);
  console.log(`  Claude calls:  ${cost?.claudeCalls || 0}`);
  console.log(`  Brave searches:${cost?.braveSearches || 0}`);
  if (errors.length > 0) {
    console.log(`  Errors:        ${errors.length}`);
  }
  console.log('━'.repeat(50) + '\n');
}

module.exports = { buildReport, extractContentIdeas, printConsoleSummary };
