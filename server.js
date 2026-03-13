// server.js - ATJC Catering Request System
const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const CONFIG = {
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  slackBotToken: process.env.SLACK_BOT_TOKEN,
};

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Format date: "2026-03-20" -> "Friday, March 20, 2026"
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// Format time: "18:00" -> "6:00 PM"
function formatTime(timeStr) {
  if (!timeStr) return 'N/A';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return hour12 + ':' + m + ' ' + ampm;
}

// Submit catering request - posts to Slack
app.post('/api/submit-request', async (req, res) => {
  try {
    const f = req.body;
    const requestId = 'req_' + Date.now();
    console.log('Received request:', requestId);

    const rooms = Array.isArray(f.rooms) ? f.rooms.join('\n') : (f.rooms || 'N/A');
    const setupDateTime = formatDate(f.setupStartDate) + ' at ' + formatTime(f.setupStartTime);
    const teardownDateTime = formatDate(f.teardownDate) + ' at ' + formatTime(f.teardownTime);
    const rabbiLine = f.officiatingRabbi ? '*Officiating Rabbi:*\n' + f.officiatingRabbi + '\n\n' : '';
    const notesLine = f.additionalNotes ? '\n\n*Additional Notes:*\n' + f.additionalNotes : '';

    const compactData = {
      requestId: requestId,
      eventName:      f.eventName      || 'N/A',
      clientName:     f.clientName     || 'N/A',
      eventDate:      f.eventDate      || '',
      guestCount:     f.guestCount     || 'N/A',
      rooms:          rooms,
      setupDateTime:  setupDateTime,
      teardownDateTime: teardownDateTime,
      eventStartTime: f.eventStartTime || '',
      eventEndTime:   f.eventEndTime   || '',
      plannerName:    f.plannerName    || 'N/A',
      plannerEmail:   f.plannerEmail   || '',
      plannerPhone:   f.plannerPhone   || '',
      valetParking:   f.valetParking   || 'N/A',
      easementParking: f.easementParking || 'N/A',
      loudMusic:      f.loudMusic      || 'N/A',
      officiatingRabbi: f.officiatingRabbi || '',
      additionalNotes: f.additionalNotes || '',
    };
    const buttonValue = JSON.stringify(compactData);

    const slackMessage = {
      text: 'New Catering Request: ' + f.eventName,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🎉 New Catering Event Request', emoji: true }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: '*Event:*\n' + f.eventName },
            { type: 'mrkdwn', text: '*Client:*\n' + f.clientName },
            { type: 'mrkdwn', text: '*Event Date:*\n' + formatDate(f.eventDate) },
            { type: 'mrkdwn', text: '*Guest Count:*\n' + (f.guestCount || 'N/A') }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: rabbiLine + '*📅 Timeline*\n• Setup begins: ' + setupDateTime +
              '\n• Event: ' + formatTime(f.eventStartTime) + ' - ' + formatTime(f.eventEndTime) +
              '\n• Teardown complete: ' + teardownDateTime
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: '*Party Planner:*\n' + (f.plannerName || 'N/A') +
                '\n' + (f.plannerEmail || '') +
                '\n' + (f.plannerPhone || '')
            },
            {
              type: 'mrkdwn',
              text: '*Parking & Music:*\n' +
                'Valet: ' + (f.valetParking || 'N/A') +
                '\nEasement: ' + (f.easementParking || 'N/A') +
                '\nLoud Music (work hours): ' + (f.loudMusic || 'N/A')
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Rooms Requested:*\n' + rooms + notesLine
          }
        },
        {
          type: 'actions',
          block_id: 'approval_actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Approve All', emoji: true },
              style: 'primary',
              action_id: 'approve_all',
              value: buttonValue
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '⚠️ Partial Approval', emoji: true },
              action_id: 'partial_approval',
              value: buttonValue
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '❌ Deny', emoji: true },
              style: 'danger',
              action_id: 'deny_request',
              value: buttonValue
            }
          ]
        }
      ]
    };

    const slackResponse = await fetch(CONFIG.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage)
    });

    if (!slackResponse.ok) throw new Error('Failed to post to Slack');
    res.json({ success: true, requestId: requestId });

  } catch (error) {
    console.error('Error submitting request:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Handle Slack button interactions
app.post('/api/slack/interactions', async (req, res) => {
  try {
    console.log('=== SLACK INTERACTION RECEIVED ===');

    const payload = JSON.parse(req.body.payload);
    const action = payload.actions[0];
    const responseUrl = payload.response_url;

    console.log('Action ID:', action.action_id);
    console.log('User ID:', payload.user.id);
    console.log('Response URL present:', !!responseUrl);

    const parsed = JSON.parse(action.value);
    const f = parsed.formData || parsed;  // backward compat: old format nested under formData
    console.log('Button data found:', !!f);

    const channelId = payload.channel.id;
    const messageTs = payload.message.ts;

    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });

    let replyText;

    if (action.action_id === 'approve_all') {
      replyText = '✅ Approved by <@' + payload.user.id + '> on ' + now + '\nFYI <@U02Q2P46PSQ>';
    } else if (action.action_id === 'partial_approval') {
      replyText = '⚠️ Partial Approval by <@' + payload.user.id + '> on ' + now +
        '\nPlease reply to this thread specifying which rooms are approved and which are unavailable.' +
        '\nFYI <@U02Q2P46PSQ>';
    } else if (action.action_id === 'deny_request') {
      replyText = '❌ Denied by <@' + payload.user.id + '> on ' + now + '\nFYI <@U02Q2P46PSQ>';
    } else {
      console.log('Unknown action:', action.action_id);
      res.status(200).send();
      return;
    }

    // Do all async work BEFORE sending the 200 response
    console.log('Posting thread reply...');
    const replyResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.slackBotToken
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: messageTs,
        text: replyText
      })
    });

    const replyResult = await replyResponse.json();
    console.log('Thread reply result:', JSON.stringify(replyResult));
    console.log('Done! Sending 200 to Slack.');

    res.status(200).send();

  } catch (error) {
    console.error('Error handling interaction:', error);
    res.status(200).send();
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});

module.exports = app;
