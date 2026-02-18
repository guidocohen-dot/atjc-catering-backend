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

// Submit catering request - posts to Slack
app.post('/api/submit-request', async (req, res) => {
            try {
                            const formData = req.body;
                            const requestId = 'req_' + Date.now();
                            console.log('Received request:', requestId);

                const rooms = (formData.roomsRequested || formData.rooms || []).join(', ');

                const slackMessage = {
                                    text: 'New Catering Request: ' + formData.eventName,
                                    blocks: [
                                            {
                                                                        type: 'header',
                                                                        text: { type: 'plain_text', text: 'New Catering Event Request', emoji: true }
                                            },
                                            {
                                                                        type: 'section',
                                                                        fields: [
                                                                                { type: 'mrkdwn', text: '*Event:*\n' + formData.eventName },
                                                                                { type: 'mrkdwn', text: '*Client:*\n' + formData.clientName },
                                                                                { type: 'mrkdwn', text: '*Date:*\n' + formData.eventDate },
                                                                                { type: 'mrkdwn', text: '*Guests:*\n' + formData.expectedGuests }
                                                                                                    ]
                                            },
                                            {
                                                                        type: 'section',
                                                                        text: { type: 'mrkdwn', text: '*Rooms Requested:*\n' + rooms }
                                            },
                                            {
                                                                        type: 'section',
                                                                        text: {
                                                                                                        type: 'mrkdwn',
                                                                                                        text: '*Setup:* ' + formData.setupStartTime +
                                                                                                                                              '\n*Event:* ' + formData.eventStartTime + ' - ' + formData.eventEndTime +
                                                                                                                                              '\n*Teardown:* ' + formData.teardownCompleteTime
                                                                        }
                                            },
                                            {
                                                                        type: 'section',
                                                                        text: {
                                                                                                        type: 'mrkdwn',
                                                                                                        text: '*Party Planner:*\n' + formData.partyPlannerName +
                                                                                                                                              '\n' + formData.partyPlannerEmail +
                                                                                                                                              '\n' + formData.partyPlannerPhone
                                                                        }
                                            },
                                            {
                                                                        type: 'actions',
                                                                        block_id: 'approval_actions',
                                                                        elements: [
                                                                                {
                                                                                                                    type: 'button',
                                                                                                                    text: { type: 'plain_text', text: 'Approve All', emoji: true },
                                                                                                                    style: 'primary',
                                                                                                                    action_id: 'approve_all',
                                                                                                                    value: JSON.stringify({ requestId: requestId, formData: formData })
                                                                                        },
                                                                                {
                                                                                                                    type: 'button',
                                                                                                                    text: { type: 'plain_text', text: 'Partial Approval', emoji: true },
                                                                                                                    action_id: 'partial_approval',
                                                                                                                    value: JSON.stringify({ requestId: requestId, formData: formData })
                                                                                        },
                                                                                {
                                                                                                                    type: 'button',
                                                                                                                    text: { type: 'plain_text', text: 'Deny', emoji: true },
                                                                                                                    style: 'danger',
                                                                                                                    action_id: 'deny_request',
                                                                                                                    value: JSON.stringify({ requestId: requestId, formData: formData })
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

                console.log('Action ID:', action.action_id);
                            console.log('User ID:', payload.user.id);

                const buttonData = JSON.parse(action.value);
                            const formData = buttonData.formData;
                            const requestId = buttonData.requestId;

                console.log('Form data found:', !!formData);

                // Only Nathalie can approve/deny
             

                console.log('Auth passed, processing action');

                // Acknowledge Slack immediately (must respond within 3 seconds)
                res.status(200).send();

                const channelId = payload.channel.id;
                            const messageTs = payload.message.ts;

                const now = new Date().toLocaleString('en-US', {
                                    timeZone: 'America/New_York',
                                    month: 'short', day: 'numeric', year: 'numeric',
                                    hour: 'numeric', minute: '2-digit', hour12: true
                });

                let replyText;
                            let statusLine;

                if (action.action_id === 'approve_all') {
                                    replyText = 'Approved by <@' + payload.user.id + '> on ' + now;
                                    statusLine = 'APPROVED';
                                    console.log('Processing approve_all');
                } else if (action.action_id === 'partial_approval') {
                                    replyText = 'Partial Approval by <@' + payload.user.id + '> on ' + now +
                                                                    '\nPlease reply to this thread specifying which rooms are approved and which are unavailable.';
                                    statusLine = 'PARTIAL APPROVAL';
                                    console.log('Processing partial_approval');
                } else if (action.action_id === 'deny_request') {
                                    replyText = 'Denied by <@' + payload.user.id + '> on ' + now;
                                    statusLine = 'DENIED';
                                    console.log('Processing deny_request');
                } else {
                                    console.log('Unknown action:', action.action_id);
                                    return;
                }

                // Post thread reply
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

                // Update original message to remove buttons
                const updateResponse = await fetch('https://slack.com/api/chat.update', {
                                    method: 'POST',
                                    headers: {
                                                            'Content-Type': 'application/json',
                                                            'Authorization': 'Bearer ' + CONFIG.slackBotToken
                                    },
                                    body: JSON.stringify({
                                                            channel: channelId,
                                                            ts: messageTs,
                                                            text: statusLine + ' - ' + formData.eventName,
                                                            blocks: [
                                                                    {
                                                                                                    type: 'header',
                                                                                                    text: { type: 'plain_text', text: 'Catering Event Request', emoji: true }
                                                                    },
                                                                    {
                                                                                                    type: 'section',
                                                                                                    fields: [
                                                                                                            { type: 'mrkdwn', text: '*Event:*\n' + formData.eventName },
                                                                                                            { type: 'mrkdwn', text: '*Client:*\n' + formData.clientName },
                                                                                                            { type: 'mrkdwn', text: '*Date:*\n' + formData.eventDate },
                                                                                                            { type: 'mrkdwn', text: '*Guests:*\n' + formData.expectedGuests }
                                                                                                                                    ]
                                                                    },
                                                                    {
                                                                                                    type: 'section',
                                                                                                    text: {
                                                                                                                                        type: 'mrkdwn',
                                                                                                                                        text: '*Status:* ' + statusLine + '\n*By:* <@' + payload.user.id + '> on ' + now
                                                                                                            }
                                                                    }
                                                                                    ]
                                    })
                });
                            const updateResult = await updateResponse.json();
                            console.log('Message update result:', JSON.stringify(updateResult));

            } catch (error) {
                            console.error('Error handling interaction:', error);
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
