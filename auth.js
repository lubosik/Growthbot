#!/usr/bin/env node
/**
 * auth.js — One-time OAuth 1.0a setup to get Access Token + Secret.
 *
 * Run once before first bot run:
 *   node auth.js
 *
 * This will:
 *  1. Generate an authorization URL
 *  2. Ask you to visit it and enter the PIN
 *  3. Exchange the PIN for access tokens
 *  4. Fetch your Twitter User ID
 *  5. Save everything to .env
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { TwitterApi } = require('twitter-api-v2');
const readline = require('readline');
const fs = require('fs');

const ENV_PATH = path.join(__dirname, '.env');

// ── Readline helper ───────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

// ── .env updater ─────────────────────────────────────────────────────────────

function updateEnvFile(updates) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  }

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.trimEnd() + `\n${line}\n`;
    }
  }

  fs.writeFileSync(ENV_PATH, content);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   X/Twitter OAuth 1.0a Authorization       ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Validate consumer credentials
  if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_API_SECRET) {
    console.error('Error: TWITTER_API_KEY and TWITTER_API_SECRET must be set in .env\n');
    rl.close();
    process.exit(1);
  }

  // Check if already authenticated
  if (process.env.TWITTER_ACCESS_TOKEN && process.env.TWITTER_ACCESS_SECRET) {
    const ans = await ask('Access tokens already exist in .env. Re-authorize? (y/N): ');
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('\n✓ Using existing tokens. Run: node run.js --dry-run\n');
      rl.close();
      return;
    }
  }

  // ── Step 1: Get request token + authorization URL ─────────────────────────
  console.log('Requesting OAuth token from X...');

  const appClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
  });

  let authLink;
  try {
    authLink = await appClient.generateAuthLink('oob', { linkMode: 'authorize' });
  } catch (err) {
    console.error('\nFailed to get request token:', err.message);
    console.error('Check that your API Key & Secret are correct and your app has Read+Write permissions.\n');
    rl.close();
    process.exit(1);
  }

  // ── Step 2: User visits URL ───────────────────────────────────────────────
  console.log('\n' + '─'.repeat(52));
  console.log('1. Open this URL in your browser:\n');
  console.log(`   ${authLink.url}\n`);
  console.log(`2. Sign in as @${process.env.MY_TWITTER_HANDLE || 'your account'}`);
  console.log('3. Click "Authorize app"');
  console.log('4. Copy the 7-digit PIN shown on screen');
  console.log('─'.repeat(52) + '\n');

  // ── Step 3: Exchange PIN for access tokens ────────────────────────────────
  const pin = (await ask('Enter the PIN: ')).trim();

  if (!pin || !/^\d+$/.test(pin)) {
    console.error('\nInvalid PIN. Please run auth.js again.\n');
    rl.close();
    process.exit(1);
  }

  console.log('\nExchanging PIN for access tokens...');

  const loginClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: authLink.oauth_token,
    accessSecret: authLink.oauth_token_secret,
  });

  let accessToken, accessSecret, authedClient;
  try {
    ({ accessToken, accessSecret, client: authedClient } = await loginClient.login(pin));
  } catch (err) {
    console.error('\nFailed to exchange PIN:', err.message);
    console.error('The PIN may have expired or be incorrect. Try running auth.js again.\n');
    rl.close();
    process.exit(1);
  }

  console.log('✓ Access tokens obtained!');

  // ── Step 4: Fetch user ID via users/me ────────────────────────────────────
  console.log('Fetching your user profile...');

  let userId, username, displayName, followersCount;
  try {
    const me = await authedClient.v2.me({
      'user.fields': ['id', 'username', 'name', 'public_metrics'],
    });
    userId = me.data.id;
    username = me.data.username;
    displayName = me.data.name;
    followersCount = (me.data.public_metrics || {}).followers_count || 0;
  } catch (err) {
    console.error('\nFailed to fetch user profile:', err.message);
    console.error('Tokens saved but user ID not retrieved. You can add it manually.\n');
    // Save tokens even if user lookup fails
    updateEnvFile({ TWITTER_ACCESS_TOKEN: accessToken, TWITTER_ACCESS_SECRET: accessSecret });
    rl.close();
    process.exit(1);
  }

  // ── Step 5: Save to .env ──────────────────────────────────────────────────
  updateEnvFile({
    TWITTER_ACCESS_TOKEN: accessToken,
    TWITTER_ACCESS_SECRET: accessSecret,
    MY_TWITTER_USER_ID: userId,
    MY_TWITTER_HANDLE: username,
  });

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   Authentication Complete ✓                 ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n  Account:    @${username} (${displayName})`);
  console.log(`  User ID:    ${userId}`);
  console.log(`  Followers:  ${followersCount.toLocaleString()}`);
  console.log(`  Token:      ${accessToken.substring(0, 15)}...`);
  console.log('\n  Saved to .env ✓');
  console.log('\n  Next steps:');
  console.log('    npm install                # install dependencies');
  console.log('    node run.js --dry-run      # verify discovery without posting');
  console.log('    node run.js                # full run\n');

  rl.close();
}

main().catch(err => {
  console.error('\nAuth failed:', err.message);
  rl.close();
  process.exit(1);
});
