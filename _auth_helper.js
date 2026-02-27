/**
 * Two-phase OAuth helper.
 * Phase 1 (no args):   generates auth URL, saves temp state
 * Phase 2 (with PIN):  exchanges PIN for tokens, saves to .env
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');

const ENV_PATH  = path.join(__dirname, '.env');
const TMP_PATH  = path.join(__dirname, '_auth_tmp.json');
const PIN       = process.argv[2];

function updateEnv(updates) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line  = `${key}=${value}`;
    content = regex.test(content) ? content.replace(regex, line) : content.trimEnd() + `\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

async function phase1() {
  const appClient = new TwitterApi({
    appKey:    process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
  });
  const authLink = await appClient.generateAuthLink('oob', { linkMode: 'authorize' });
  fs.writeFileSync(TMP_PATH, JSON.stringify({
    oauth_token:        authLink.oauth_token,
    oauth_token_secret: authLink.oauth_token_secret,
  }));
  console.log('\n1. Open this URL:\n');
  console.log('   ' + authLink.url);
  console.log('\n2. Authorize as @' + (process.env.MY_TWITTER_HANDLE || 'lubosi_k'));
  console.log('3. Copy the PIN and run:');
  console.log('   node _auth_helper.js <PIN>\n');
}

async function phase2(pin) {
  if (!fs.existsSync(TMP_PATH)) { console.error('Run without args first to get the URL.'); process.exit(1); }
  const { oauth_token, oauth_token_secret } = JSON.parse(fs.readFileSync(TMP_PATH, 'utf8'));
  fs.unlinkSync(TMP_PATH);

  const loginClient = new TwitterApi({
    appKey:      process.env.TWITTER_API_KEY,
    appSecret:   process.env.TWITTER_API_SECRET,
    accessToken: oauth_token,
    accessSecret: oauth_token_secret,
  });

  const { accessToken, accessSecret, client } = await loginClient.login(pin);
  console.log('✓ Tokens obtained!');

  const me = await client.v2.me({ 'user.fields': ['id','username','name','public_metrics'] });
  const { id: userId, username, name, public_metrics } = me.data;
  const followers = (public_metrics || {}).followers_count || 0;

  updateEnv({
    TWITTER_ACCESS_TOKEN:  accessToken,
    TWITTER_ACCESS_SECRET: accessSecret,
    MY_TWITTER_USER_ID:    userId,
    MY_TWITTER_HANDLE:     username,
  });

  console.log('\n✓ .env updated!\n');
  console.log('  Account:   @' + username + ' (' + name + ')');
  console.log('  User ID:   ' + userId);
  console.log('  Followers: ' + followers.toLocaleString());
  console.log('  Token:     ' + accessToken.substring(0,18) + '...\n');
  console.log('Now add these 3 values to Vercel + GitHub secrets:');
  console.log('  TWITTER_ACCESS_TOKEN  = ' + accessToken);
  console.log('  TWITTER_ACCESS_SECRET = ' + accessSecret);
  console.log('  MY_TWITTER_USER_ID    = ' + userId + '\n');
}

if (PIN) {
  phase2(PIN.trim()).catch(e => { console.error('Failed:', e.message); process.exit(1); });
} else {
  phase1().catch(e => { console.error('Failed:', e.message); process.exit(1); });
}
