const { callClaudeJSON, callClaude } = require('./claude');
const persona = require('../config/persona');

// Track last-used styles per session to avoid repetition
const _usedStyles = [];

/**
 * Check a reply text against the persona blacklist.
 */
function hasBlacklistedPhrases(text) {
  const lower = text.toLowerCase();
  return persona.blacklist.some(phrase => lower.includes(phrase.toLowerCase()));
}

/**
 * Generate reply options for a tweet using Claude Haiku.
 *
 * @param {object} tweet         - Normalized tweet object
 * @param {string} researchNotes - Brave Search findings (or empty string)
 * @param {string} voiceProfile  - Real-tweet style profile from voice-sampler
 * @returns {object}             - { selectedReply, style, allOptions, regenerated }
 */
async function generateReply(tweet, researchNotes = '', voiceProfile = '') {
  const lastStyle = _usedStyles[_usedStyles.length - 1] || '';

  const userPrompt = buildPrompt(tweet, researchNotes, lastStyle, voiceProfile);

  let result;
  let regenerated = false;

  // First attempt
  try {
    result = await callClaudeJSON(persona.systemPrompt, userPrompt);
  } catch (err) {
    console.error('[reply-gen] Claude parse error on first attempt:', err.message);
    // Fallback: try with stricter JSON instructions
    const strictPrompt = userPrompt + '\n\nIMPORTANT: Respond with ONLY valid JSON, no other text.';
    result = await callClaudeJSON(persona.systemPrompt, strictPrompt);
  }

  // Validate structure
  if (!result || !result.replies || !Array.isArray(result.replies)) {
    throw new Error('Invalid reply structure from Claude');
  }

  const bestIdx = typeof result.best === 'number' ? result.best : 0;
  const bestReply = result.replies[bestIdx];

  // Check blacklist
  if (hasBlacklistedPhrases(bestReply.text)) {
    console.warn('[reply-gen] Blacklist hit — regenerating with stricter prompt');
    regenerated = true;

    const stricterPrompt = userPrompt + `

CRITICAL REGENERATION: The previous reply contained AI-sounding language. The reply MUST NOT contain any of these phrases or anything similar: ${persona.blacklist.slice(0, 15).join(', ')}.

Be blunt, technical, casual. Sound EXACTLY like the real tweet examples above. Not a language model.`;

    result = await callClaudeJSON(persona.systemPrompt, stricterPrompt, {
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.9,
    });
  }

  const finalBestIdx = typeof result.best === 'number' ? result.best : 0;
  const selectedReply = result.replies[finalBestIdx];

  // Still has blacklisted content — use the option with the fewest violations
  let finalReply = selectedReply;
  if (hasBlacklistedPhrases(selectedReply.text)) {
    console.warn('[reply-gen] Still failing blacklist — selecting cleanest option');
    const sorted = result.replies
      .map((r, i) => ({ ...r, violations: countViolations(r.text) }))
      .sort((a, b) => a.violations - b.violations);
    finalReply = sorted[0];
  }

  // Track used style
  _usedStyles.push(finalReply.style || 'unknown');
  if (_usedStyles.length > 10) _usedStyles.shift();

  return {
    selectedReply: finalReply,
    allOptions: result.replies,
    reason: result.reason || '',
    regenerated,
    charCount: (finalReply.text || '').length,
  };
}

function countViolations(text) {
  const lower = text.toLowerCase();
  return persona.blacklist.filter(p => lower.includes(p.toLowerCase())).length;
}

function buildPrompt(tweet, researchNotes, lastStyle, voiceProfile = '') {
  const sections = [
    `Generate a reply to this tweet on behalf of Lubosi (@lubosi_k).`,
    ``,
    `TWEET:`,
    `"${tweet.text}"`,
    ``,
    `AUTHOR: @${tweet.authorUsername} (${tweet.authorFollowers.toLocaleString()} followers)`,
    `ENGAGEMENT: ${tweet.likes} likes, ${tweet.replies} replies, ${tweet.retweets} retweets`,
    `TWEET URL: ${tweet.url}`,
  ];

  // Inject real writing style from sampled tweets — highest priority signal
  if (voiceProfile) {
    sections.push(
      ``,
      `━━ LUBOSI'S REAL WRITING STYLE (extracted from his actual tweets) ━━`,
      `This is how he ACTUALLY types. Match this exactly — punctuation, sentence length, vocabulary, tone:`,
      voiceProfile,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    );
  }

  if (researchNotes) {
    sections.push('', 'RESEARCH CONTEXT (facts NOT in the tweet — use these to add value):', researchNotes);
  }

  if (tweet.commentSummary) {
    sections.push('', 'COMMENT SECTION:', tweet.commentSummary);
  }

  if (tweet.replyGaps && tweet.replyGaps.length > 0) {
    sections.push('', 'GAPS IN DISCUSSION:', tweet.replyGaps.join('\n'));
  }

  if (lastStyle) {
    sections.push('', `IMPORTANT: The last reply used the "${lastStyle}" style. Use a DIFFERENT style this time.`);
  }

  sections.push(
    '',
    'Generate 3 reply options using different styles from: VALUE ADD, CONTRARIAN, BUILDERS TAKE, THE QUESTION, AMPLIFIER, HUMOR.',
    '',
    'Rules:',
    '- Each reply MUST be under 280 characters',
    '- Do NOT start any reply with "I"',
    '- Do NOT use hashtags',
    '- NEVER use AI-sounding filler phrases',
    '- Sound like a real 20-year-old builder on Twitter',
    '',
    'Return ONLY this JSON (no markdown, no preamble):',
    '{',
    '  "replies": [',
    '    { "style": "VALUE ADD", "text": "...", "chars": 0 },',
    '    { "style": "CONTRARIAN", "text": "...", "chars": 0 },',
    '    { "style": "BUILDERS TAKE", "text": "...", "chars": 0 }',
    '  ],',
    '  "best": 0,',
    '  "reason": "one sentence explaining choice"',
    '}'
  );

  return sections.join('\n');
}

module.exports = { generateReply, hasBlacklistedPhrases };
