const Anthropic = require('@anthropic-ai/sdk');
const { limiter } = require('../twitter/rate-limiter');

let _client = null;

function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Call Claude Haiku (default) or Sonnet.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} opts         - { model, maxTokens, temperature }
 * @returns {string}            - Raw text response
 */
async function callClaude(systemPrompt, userPrompt, opts = {}) {
  const {
    model = 'claude-haiku-4-5-20251001',  // Default: Haiku (cheapest)
    maxTokens = 1024,
    temperature = 0.8,
  } = opts;

  // Record estimated cost
  limiter.recordRequest('claudeHaiku');

  const client = getClient();

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected Claude response type: ' + content.type);
  }

  return content.text;
}

/**
 * Call Claude and parse JSON from the response.
 * Retries once if JSON parse fails.
 */
async function callClaudeJSON(systemPrompt, userPrompt, opts = {}) {
  const text = await callClaude(systemPrompt, userPrompt, opts);

  // Extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    // Try finding the first { ... } block
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (_) {}
    }
    throw new Error(`Failed to parse Claude JSON response: ${err.message}\nRaw: ${text.substring(0, 200)}`);
  }
}

module.exports = { callClaude, callClaudeJSON };
