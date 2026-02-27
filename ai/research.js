const fetch = require('node-fetch');
const targets = require('../config/targets');

// Track Brave searches per run
let _braveCallCount = 0;
const MAX_BRAVE_PER_RUN = 5;

/**
 * Search Brave for context about a topic.
 * Returns extracted key facts as a formatted string.
 */
async function searchBrave(query, maxResults = 3) {
  if (_braveCallCount >= MAX_BRAVE_PER_RUN) {
    console.log('[research] Brave search limit reached for this run');
    return null;
  }

  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.warn('[research] No BRAVE_SEARCH_API_KEY set');
    return null;
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(maxResults, 10)));
  url.searchParams.set('freshness', 'pw');  // Past week

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!resp.ok) {
      console.error(`[research] Brave returned ${resp.status}: ${resp.statusText}`);
      return null;
    }

    const data = await resp.json();
    _braveCallCount++;

    if (!data.web || !data.web.results || data.web.results.length === 0) {
      return null;
    }

    // Extract key facts from top results
    const facts = data.web.results.slice(0, maxResults).map(r => {
      const desc = r.description || r.extra_snippets?.[0] || '';
      return `• ${r.title}: ${desc.substring(0, 200)}`;
    });

    return facts.join('\n');
  } catch (err) {
    console.error('[research] Brave search failed:', err.message);
    return null;
  }
}

/**
 * Determine the best research query for a tweet.
 */
function buildResearchQuery(tweet) {
  const text = tweet.text.toLowerCase();

  // Check if tweet mentions a paper, launch, benchmark, or news
  const deepTopics = targets.deepResearchTopics || [];
  const matchedTopic = deepTopics.find(t => text.includes(t.toLowerCase()));

  if (!matchedTopic) return null;

  // Extract key nouns for the query
  // Simple heuristic: take first 80 chars and append topic
  const shortText = tweet.text.substring(0, 80).replace(/https?:\/\/\S+/g, '').trim();

  if (matchedTopic === 'new model release') {
    return `${shortText} model release site:arxiv.org OR site:huggingface.co`;
  }
  if (matchedTopic === 'benchmark') {
    return `${shortText} benchmark results 2025 2026`;
  }
  if (matchedTopic === 'paper') {
    return `${shortText} research paper site:arxiv.org`;
  }
  if (matchedTopic === 'funding round') {
    return `${shortText} funding raised 2026`;
  }
  if (matchedTopic === 'open source release') {
    return `${shortText} open source release github`;
  }

  return `${shortText} ${matchedTopic} 2026`;
}

/**
 * Research a tweet if its score warrants it.
 * Returns research notes string or empty string.
 */
async function researchTweet(tweet) {
  if ((tweet.score || 0) < 70) {
    return '';
  }

  const query = buildResearchQuery(tweet);
  if (!query) {
    return '';
  }

  console.log(`[research] Searching: "${query.substring(0, 70)}..."`);
  const results = await searchBrave(query);

  if (!results) {
    return '';
  }

  return results;
}

/**
 * Run research for an array of tweets (respecting per-run limit).
 */
async function enrichWithResearch(tweets) {
  _braveCallCount = 0;  // Reset per run
  const enriched = [];

  for (const tweet of tweets) {
    let research = '';
    if (_braveCallCount < MAX_BRAVE_PER_RUN) {
      research = await researchTweet(tweet);
    }
    enriched.push({ ...tweet, researchNotes: research });
  }

  console.log(`[research] Used ${_braveCallCount}/${MAX_BRAVE_PER_RUN} Brave searches`);
  return enriched;
}

module.exports = { searchBrave, researchTweet, enrichWithResearch, buildResearchQuery };
