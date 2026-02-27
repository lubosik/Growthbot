# X Engagement Bot — @lubosi_k

AI-powered X/Twitter engagement bot. Finds viral AI tweets, generates authentic replies, and tracks everything.

## First-time setup

```bash
cd x-engagement-bot
npm install
node auth.js          # OAuth flow — get access tokens (one-time)
node run.js --dry-run # Verify discovery + reply generation without posting
node run.js           # Full run
```

## CLI

| Command | Description |
|---------|-------------|
| `node run.js` | Full pipeline (discover → score → research → reply → notify) |
| `node run.js --dry-run` | Discover + generate replies, **don't post** |
| `node run.js --discover-only` | Find and score tweets, print results |
| `node run.js --notify-only` | Send latest report to Telegram |
| `node run.js --budget` | Show monthly budget status |
| `node auth.js` | One-time OAuth 1.0a setup |
| `node dashboard.js` | Start web dashboard at http://localhost:3131 |

## Budget

- **Hard cap:** $4.50/month (X API + Claude)
- **Estimated daily cost:** ~$0.08–0.14
- The bot checks budget before **every** API call and stops automatically at $4.50
- Switches to reduced mode (8 replies/day, 2 searches) if trending above $3.50 at mid-month
- Set a $5/month limit in X Developer Console as backup

## Architecture

```
run.js                      Main pipeline
auth.js                     One-time OAuth setup
dashboard.js                Web dashboard server

config/
  env.js                    Load + validate .env
  persona.js                Voice, blacklist, hot takes
  targets.js                Search queries, priority accounts

discovery/
  tweet-search.js           X API v2 Recent Search
  comment-reader.js         Read reply sections via conversation_id
  scorer.js                 Score tweets 0-100

twitter/
  client.js                 OAuth 1.0a client (writes) + Bearer (reads)
  actions.js                Reply, like, retweet, quote with delays
  rate-limiter.js           Per-window tracking + cost estimates

ai/
  claude.js                 Anthropic Haiku (default) + Sonnet
  reply-generator.js        Generate 3 options, check blacklist, select best
  research.js               Brave Search for primary sources

telegram/
  notifier.js               Send reports + alerts

tracking/
  budget.js                 Monthly spend tracking with hard stop
  logger.js                 Daily JSON logs
  daily-report.js           Build report + extract content ideas

ui/
  dashboard.html            Apple Liquid Glass dashboard

logs/
  YYYY-MM-DD.json           Daily run logs
  monthly-budget.json       Monthly spend tracker
```

## How a run works

1. **Budget check** — exit immediately if over $4.50
2. **Discover** — 2-3 X API searches → 30-50 candidate tweets
3. **Score** — rank by likes, replies, author size, AI relevance, reply gaps
4. **Comment sections** — read top 10 tweets' replies for context
5. **Research** — Brave Search for top 5 tweets (score ≥ 70) to find facts
6. **Generate** — Claude Haiku → 3 reply options → pick best → check blacklist
7. **Engage** — like + reply (+ optional RT/quote) with 45-120s random delays
8. **Notify** — Telegram report with top reply, budget, content ideas
9. **Log** — save daily JSON + update budget tracker

## Voice rules (short version)

- Extremely informal. Twitter, not LinkedIn.
- Never sound like AI — no "Great point!", "This is fascinating!", "paradigm"
- Contrarian when warranted. Show real builder experience.
- Under 280 chars. No hashtags. Never start with "I".
