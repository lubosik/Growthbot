/**
 * persona/voice-sampler.js
 *
 * Fetches @lubosi_k's real tweets + replies, passes them to Claude,
 * and extracts a concrete writing style profile. The profile is cached
 * locally and in Redis for 24 hours so the API is only hit once per day.
 *
 * Usage:
 *   const { loadVoiceProfile } = require('./persona/voice-sampler');
 *   const profile = await loadVoiceProfile();   // returns style string or ''
 *
 * Standalone refresh:
 *   node persona/voice-sampler.js
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getRWClient }         = require('../twitter/client');
const { callClaude }          = require('../ai/claude');
const storage                 = require('../lib/storage');

const PROFILE_PATH    = path.join(__dirname, '../logs/voice-profile.json');
const CACHE_KEY       = 'voice:profile';
const CACHE_TTL_HOURS = 24;
const MY_USER_ID      = process.env.MY_TWITTER_USER_ID || '1770504003782336512';
const MY_HANDLE       = process.env.MY_TWITTER_HANDLE  || 'lubosi_k';

// ── Cache helpers ─────────────────────────────────────────────────────────────

function readLocalCache() {
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    }
  } catch (_) {}
  return null;
}

function writeLocalCache(data) {
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(data, null, 2));
}

function isFresh(cached) {
  if (!cached || !cached.fetchedAt) return false;
  const ageHours = (Date.now() - new Date(cached.fetchedAt).getTime()) / 3_600_000;
  return ageHours < CACHE_TTL_HOURS;
}

// ── Tweet fetching ────────────────────────────────────────────────────────────

async function fetchRecentTweets() {
  const client = getRWClient();
  const tweets = [];

  // 1. Own timeline — last 100 tweets, excluding retweets
  try {
    const timeline = await client.v2.userTimeline(MY_USER_ID, {
      max_results: 100,
      exclude: ['retweets'],
      'tweet.fields': ['text', 'created_at', 'in_reply_to_user_id'],
    });
    const items = timeline.data?.data || [];
    items.forEach(t => tweets.push({ text: t.text, isReply: !!t.in_reply_to_user_id }));
    console.log(`[voice] Fetched ${items.length} timeline tweets`);
  } catch (err) {
    console.warn('[voice] Timeline fetch failed:', err.message);
  }

  // 2. Recent replies via search (up to 50 more)
  try {
    const results = await client.v2.search(`from:${MY_HANDLE} is:reply`, {
      max_results: 50,
      'tweet.fields': ['text', 'created_at'],
    });
    const items = results.data?.data || [];
    items.forEach(t => tweets.push({ text: t.text, isReply: true }));
    console.log(`[voice] Fetched ${items.length} reply tweets`);
  } catch (err) {
    console.warn('[voice] Reply search failed:', err.message);
  }

  return tweets;
}

// ── Style extraction via Claude ───────────────────────────────────────────────

async function extractVoiceProfile(tweets) {
  if (tweets.length === 0) return null;

  // Split for the prompt: show organic tweets + replies separately
  const organic = tweets.filter(t => !t.isReply).slice(0, 40).map(t => `  • ${t.text}`).join('\n');
  const replies  = tweets.filter(t =>  t.isReply).slice(0, 40).map(t => `  • ${t.text}`).join('\n');

  const systemPrompt = `You are a writing analyst. Your job is to produce a precise, actionable writing style guide based on real examples.`;

  const userPrompt = `Below are real tweets and replies from @${MY_HANDLE}. Analyse them and produce a compact voice profile that will be used to make AI-generated replies sound EXACTLY like this person.

=== ORGANIC TWEETS (own thoughts) ===
${organic || '(none)'}

=== REPLIES TO OTHERS ===
${replies || '(none)'}

Produce a style profile with these exact sections — be SPECIFIC, not generic. Quote actual patterns you see:

1. SENTENCE STRUCTURE — length, fragments vs full sentences, how they open and close
2. PUNCTUATION HABITS — do they use periods? commas? ellipses? em dashes? all lowercase?
3. VOCABULARY & SLANG — actual words/phrases they use often. Quote them.
4. TONE MARKERS — how they express doubt, agreement, disagreement, excitement
5. WHAT THEY NEVER DO — patterns completely absent from their writing
6. 5 REAL EXAMPLE REPLIES — copy 5 of their best replies verbatim as templates

Keep the whole profile under 600 words. Be brutally specific. No generic advice like "informal tone" — show the actual patterns with quoted examples.`;

  const profile = await callClaude(systemPrompt, userPrompt, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 800,
  });

  return profile;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load the voice profile from cache, or fetch+extract if stale.
 * Returns the profile string, or '' if unavailable.
 */
async function loadVoiceProfile({ forceRefresh = false } = {}) {
  // Check Redis first
  if (!forceRefresh) {
    try {
      const cached = await storage.get(CACHE_KEY);
      if (isFresh(cached)) {
        console.log('[voice] Using cached profile from Redis');
        return cached.profile;
      }
    } catch (_) {}
  }

  // Check local file
  if (!forceRefresh) {
    const local = readLocalCache();
    if (isFresh(local)) {
      console.log('[voice] Using cached profile from disk');
      return local.profile;
    }
  }

  // Fetch fresh
  console.log('[voice] Fetching fresh tweets to build voice profile...');
  let tweets;
  try {
    tweets = await fetchRecentTweets();
  } catch (err) {
    console.warn('[voice] Could not fetch tweets:', err.message);
    // Return stale profile rather than nothing
    const stale = readLocalCache() || await storage.get(CACHE_KEY).catch(() => null);
    return stale?.profile || '';
  }

  if (tweets.length < 5) {
    console.warn('[voice] Too few tweets to build a profile, skipping');
    return '';
  }

  let profile;
  try {
    profile = await extractVoiceProfile(tweets);
  } catch (err) {
    console.warn('[voice] Claude extraction failed:', err.message);
    return '';
  }

  // Save to cache
  const cached = { profile, fetchedAt: new Date().toISOString(), tweetCount: tweets.length };
  writeLocalCache(cached);
  await storage.set(CACHE_KEY, cached, { ex: CACHE_TTL_HOURS * 3600 }).catch(() => {});

  console.log(`[voice] Voice profile built from ${tweets.length} tweets`);
  return profile;
}

module.exports = { loadVoiceProfile };

// ── Standalone run ────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    console.log('Building voice profile for @' + MY_HANDLE + '...\n');
    const profile = await loadVoiceProfile({ forceRefresh: true });
    if (profile) {
      console.log('\n━━ VOICE PROFILE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log(profile);
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('Saved to logs/voice-profile.json');
    } else {
      console.log('Could not build profile.');
    }
  })().catch(console.error);
}
