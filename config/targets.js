module.exports = {
  // Rotate queriesPerRun per session — ordered by priority.
  // NOTE: min_faves/min_retweets are Pro-tier-only operators — not used here.
  // Engagement filtering is done in code via minLikes/minRetweets below.
  tweetSearchQueries: [
    // AI Models & Labs
    '(OpenAI OR GPT OR "GPT-5" OR "o3" OR "o4-mini") lang:en -is:retweet -is:reply',
    '(Claude OR Anthropic OR "Claude Code" OR "Claude Sonnet" OR "Claude Opus") lang:en -is:retweet -is:reply',
    '(Perplexity OR "Perplexity AI") lang:en -is:retweet -is:reply',
    '(DeepSeek OR "DeepSeek R1" OR "DeepSeek V3") lang:en -is:retweet -is:reply',
    '(Gemini OR "Google AI" OR "Google DeepMind") lang:en -is:retweet -is:reply',
    '("open source" AI model OR "open source LLM" OR Llama OR Mistral) lang:en -is:retweet -is:reply',
    '(AI OR "artificial intelligence" OR LLM) lang:en -is:retweet -is:reply has:links',

    // Vibe Coding & Dev Tools
    '("Claude Code" OR "Cursor AI" OR Cursor OR "vibe coding" OR "AI coding") lang:en -is:retweet -is:reply',
    '(Windsurf OR Replit OR "AI IDE" OR Copilot OR "GitHub Copilot") lang:en -is:retweet -is:reply',
    '("v0" OR "bolt.new" OR lovable OR "AI app builder") lang:en -is:retweet -is:reply',

    // AI Automation & Agents
    '("AI automation" OR "AI workflow" OR "agentic" OR "AI agent" OR "AI agents") lang:en -is:retweet -is:reply',
    '(n8n OR "Make.com" OR "Zapier AI" OR "AI pipeline") lang:en -is:retweet -is:reply',
    '("MCP" OR "model context protocol" OR "function calling" OR "tool use") lang:en -is:retweet -is:reply',
    '(Manus OR "Manus AI") lang:en -is:retweet -is:reply',

    // AI UGC & Content Creation
    '("AI UGC" OR "AI content" OR "AI video" OR "AI voice" OR ElevenLabs) lang:en -is:retweet -is:reply',
    '(Midjourney OR "DALL-E" OR "AI image" OR Runway OR Sora OR Kling) lang:en -is:retweet -is:reply',

    // Big Accounts (always check)
    '(from:sama OR from:ylecun OR from:DrJimFan OR from:skirano) (AI OR model OR agent OR code)',
    '(from:AnthropicAI OR from:OpenAI OR from:GoogleDeepMind) -is:retweet',
    '(from:karpathy OR from:swyx OR from:levie OR from:bindureddy) AI',
    '(from:AravSrinivas OR from:emollick OR from:fchollet) AI',
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
    'site:x.com "vibe coding" OR Cursor AI',
    'site:x.com DeepSeek OR Manus AI',
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
    normal: 5,
    reduced: 3,
  },

  // Max results per search query (API max is 100; higher = more scorer candidates)
  maxResultsPerQuery: 50,

  // Post-fetch engagement filters (applied in code, not in query operators)
  minLikes: 100,
  minRetweets: 30,
  minReplies: 10,

  // For "from:" queries — lower threshold since these are key accounts
  priorityAccountMinLikes: 20,

  // Tweets to engage per run
  engagePerRun: {
    normal: { min: 12, max: 15 },
    reduced: { min: 6, max: 8 },
  },
};
