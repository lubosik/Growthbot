const fetch = require('node-fetch');

/**
 * Send a message to a Telegram chat via the Bot API.
 */
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — skipping notification');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[telegram] Send failed ${resp.status}: ${body.substring(0, 200)}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[telegram] Network error:', err.message);
    return false;
  }
}

/**
 * Build and send the end-of-run engagement report.
 */
async function sendEngagementReport(reportData) {
  const {
    date,
    runNumber,
    actions,
    monthlyBudget,
    topReply,
    contentIdeas,
    errors,
    estimatedCost,
    braveSearches,
    claudeCalls,
    mode,
  } = reportData;

  const modeTag = mode === 'reduced' ? ' ⚡ REDUCED MODE' : '';
  const budgetPercent = monthlyBudget
    ? Math.round((monthlyBudget.used / monthlyBudget.limit) * 100)
    : 0;
  const budgetBar = buildProgressBar(budgetPercent, 20);

  let msg = `<b>━━ X ENGAGEMENT REPORT${modeTag} ━━</b>\n`;
  msg += `📅 ${date} | Run #${runNumber}\n\n`;

  msg += `<b>Actions today:</b>\n`;
  msg += `  💬 Replies: ${actions.replies || 0}  ❤️ Likes: ${actions.likes || 0}  🔁 RTs: ${actions.retweets || 0}  📣 Quotes: ${actions.quoteTweets || 0}\n\n`;

  if (monthlyBudget) {
    msg += `<b>Monthly budget:</b>\n`;
    msg += `  ${budgetBar} ${budgetPercent}%\n`;
    msg += `  Est. spend: $${monthlyBudget.estimatedSpend?.toFixed(2) || '0.00'} / $${monthlyBudget.limit?.toFixed(2) || '4.50'}\n`;
    msg += `  Today's cost: ~$${estimatedCost || '0.00'}\n\n`;
  }

  if (topReply) {
    msg += `<b>Top reply (best engagement potential):</b>\n`;
    msg += `  → Replied to <b>@${topReply.author}</b>\n`;
    msg += `  <i>"${escapeHtml(topReply.text.substring(0, 200))}"</i>\n`;
    if (topReply.url) msg += `  🔗 ${topReply.url}\n`;
    msg += '\n';
  }

  if (contentIdeas && contentIdeas.length > 0) {
    msg += `<b>━━ CONTENT IDEAS ━━</b>\n\n`;
    contentIdeas.slice(0, 3).forEach((idea, i) => {
      msg += `${i + 1}. <b>${idea.type}:</b> ${idea.title}\n`;
      msg += `   ${idea.description}\n`;
      if (idea.url) msg += `   → ${idea.url}\n`;
      msg += '\n';
    });
  }

  if (errors && errors.length > 0) {
    msg += `<b>⚠️ Errors (${errors.length}):</b>\n`;
    errors.slice(0, 3).forEach(e => {
      msg += `  • ${escapeHtml(e.toString().substring(0, 100))}\n`;
    });
    msg += '\n';
  }

  msg += `<i>API calls: ${claudeCalls || 0} Claude | ${braveSearches || 0} Brave Search</i>\n`;
  msg += `<b>━━━━━━━━━━━━━━━━━━━━━━━</b>`;

  return sendTelegram(msg);
}

/**
 * Send a budget warning alert.
 */
async function sendBudgetAlert(estimatedSpend, limit) {
  const msg = `⚠️ <b>X BOT BUDGET ALERT</b>\n\nEstimated spend: <b>$${estimatedSpend.toFixed(2)}</b> / $${limit.toFixed(2)}\n\nApproaching monthly cap. Bot has reduced/stopped activity.`;
  return sendTelegram(msg);
}

/**
 * Send a hard stop notification.
 */
async function sendHardStopAlert(estimatedSpend) {
  const msg = `🛑 <b>X BOT HARD STOP</b>\n\nEstimated spend ($${estimatedSpend.toFixed(2)}) exceeded $4.50 limit.\n\nAll API calls halted. Review usage in X Developer Console.`;
  return sendTelegram(msg);
}

function buildProgressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { sendTelegram, sendEngagementReport, sendBudgetAlert, sendHardStopAlert };
