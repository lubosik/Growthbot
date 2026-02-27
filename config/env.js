const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const REQUIRED_ALWAYS = [
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'TWITTER_BEARER_TOKEN',
  'ANTHROPIC_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

const REQUIRED_FOR_WRITES = [
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_SECRET',
];

function validateEnv({ requireWriteAccess = true } = {}) {
  const missing = REQUIRED_ALWAYS.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error(`\n[env] Missing required environment variables:\n  ${missing.join('\n  ')}`);
    console.error('\nCheck your .env file.\n');
    process.exit(1);
  }

  if (requireWriteAccess) {
    const missingWrite = REQUIRED_FOR_WRITES.filter(k => !process.env[k]);
    if (missingWrite.length > 0) {
      console.error('\n[env] Missing OAuth access tokens. Run: node auth.js\n');
      process.exit(1);
    }
  }
}

function getEnv() {
  return {
    twitterApiKey: process.env.TWITTER_API_KEY,
    twitterApiSecret: process.env.TWITTER_API_SECRET,
    twitterBearerToken: process.env.TWITTER_BEARER_TOKEN,
    twitterAccessToken: process.env.TWITTER_ACCESS_TOKEN,
    twitterAccessSecret: process.env.TWITTER_ACCESS_SECRET,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    myHandle: process.env.MY_TWITTER_HANDLE || 'lubosi_k',
    myUserId: process.env.MY_TWITTER_USER_ID || null,
  };
}

module.exports = { validateEnv, getEnv };
