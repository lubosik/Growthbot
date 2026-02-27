const { TwitterApi } = require('twitter-api-v2');

let _rwClient = null;
let _bearerClient = null;

/**
 * OAuth 1.0a client for all write operations and user-context reads.
 */
function getRWClient() {
  if (!_rwClient) {
    if (!process.env.TWITTER_ACCESS_TOKEN || !process.env.TWITTER_ACCESS_SECRET) {
      throw new Error('Write client requires TWITTER_ACCESS_TOKEN and TWITTER_ACCESS_SECRET. Run: node auth.js');
    }
    const raw = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });
    _rwClient = raw.readWrite;
  }
  return _rwClient;
}

/**
 * App-only Bearer Token client for read endpoints.
 */
function getBearerClient() {
  if (!_bearerClient) {
    const raw = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
    _bearerClient = raw.readOnly;
  }
  return _bearerClient;
}

/**
 * Invalidate cached clients (e.g. after token refresh).
 */
function resetClients() {
  _rwClient = null;
  _bearerClient = null;
}

module.exports = { getRWClient, getBearerClient, resetClients };
