module.exports = {
  // Rotate 2-3 per run — ordered by priority
  tweetSearchQueries: [
    '(AI OR "artificial intelligence" OR LLM) min_faves:500 lang:en -is:retweet -is:reply',
    '(Claude OR Anthropic) min_faves:100 lang:en -is:retweet',
    '("GPT" OR "OpenAI") min_faves:300 lang:en -is:retweet -is:reply',
    '("open source" AI model) min_faves:200 lang:en -is:retweet',
    '("AI agent" OR "AI agents") min_faves:100 lang:en -is:retweet',
    '(from:AnthropicAI OR from:OpenAI OR from:GoogleDeepMind) -is:retweet',
    '(from:sama OR from:ylecun OR from:DrJimFan OR from:skirano) (AI OR model OR agent) -is:retweet',
  ],

  // Accounts to prioritize when scoring
  priorityAccounts: [
    'AnthropicAI', 'OpenAI', 'GoogleDeepMind',
    'elonmusk', 'sama', 'ylecun', 'AravSrinivas',
    'DrJimFan', 'bindureddy', 'skirano', 'swyx', 'levie',
    'karpathy', 'fchollet', 'random_walker_', 'emollick',
  ],

  // Brave Search research queries (rotate 2-3 per run, max 5/run)
  braveSearchQueries: [
    'site:x.com "AI model" OR "LLM" -is:retweet',
    'site:x.com Claude OR Anthropic AI',
    'site:x.com GPT OR OpenAI new',
    'site:x.com "open source" AI model',
    'site:x.com "AI agent" OR "AI agents"',
    'site:x.com "AI startup" OR "AI company"',
    'site:x.com "foundation model" OR "reasoning model"',
    'site:x.com AI coding OR AI developer tools',
  ],

  // Topics that warrant extra research depth (Brave Search)
  deepResearchTopics: [
    'new model release', 'benchmark', 'paper',
    'acquisition', 'funding round', 'open source release',
    'API pricing change', 'safety', 'regulation', 'layoffs',
  ],

  // Topics to SKIP (political, off-topic)
  skipTopics: [
    'election', 'president', 'democrat', 'republican', 'congress',
    'senate', 'trump', 'biden', 'politics', 'gun control', 'abortion',
    'immigration', 'climate policy',
  ],

  // Number of queries to run per session
  queriesPerRun: {
    normal: 3,
    reduced: 2,
  },

  // Max results per search query
  maxResultsPerQuery: 20,

  // Tweets to engage per run
  engagePerRun: {
    normal: { min: 12, max: 15 },
    reduced: { min: 6, max: 8 },
  },
};
