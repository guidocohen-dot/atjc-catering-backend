// server.js - Backend service for ATJC Catering Request System
// Deploy to Vercel, Netlify Functions, or any Node.js host

const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuration
const CONFIG = {
        slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
        slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
        slackBotToken: process.env.SLACK_BOT_TOKEN,
        catererEmail: 'gcohen@atjc.org',
        nathalieUserId: 'U081RLR5WRW',

        email: {
                    service: 'gmail',
                    user: 'your-email@gmail.com',
                    pass: 'your-app-specific-password'
        }
};

// Email transporter
const transporter = nodemailer.createTransport({
        service: CONFIG.email.service,
        auth: {
                    user: CONFIG.email.user,
                    pass: CONFIG.email.pass
        }
});

// CORS middleware
app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        next();
});

// Verify Slack signature
function verifySlackSignature(req) {
        const slackSignature = req.headers['x-slack-signature'];
        const timestamp = req.headers['x-slack-request-timestamp'];
        const body = JSON.stringify(req.body);

    const time = Math.floor(new Date().getTime() / 1000);
        if (Math.abs(time - timestamp) > 300) {
                    return false;
        }

    const sigBasestring = `v0:${timestamp}:${body}`;
        const mySignature = 'v0=' + crypto
            .createHmac('sha256', CONFIG.slackSigningSecret)
            .update(sigBasestring)
            .digest('hex');

    return crypto.timingSafeEqual(
                Buffer.from(mySignature),
                Buffer.from(slackSignature)
            );
}

// Format date nicely
function formatDate(dateString) {
        const date = new Date(dateString + 'T00:00:00');
        return date.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
        });
}

// Format time nicely
function formatTime(timeString) {
        const [hours, minutes] = timeString.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
}

// POST endpoint - Submit catering request
app.post('/api/submit-request', async (req, res) => {
        try {
                    const formData = req.body;
                    const requestId = `req_${Date.now()}`;

            console.log('Received request:', requestId);

            const slackMessage = {
                            text: `New Catering Request: ${formData.eventName}`,
                            blocks: [
                                {
                                                        type: 'header',
                                                        text: {
                                                                                    type: 'plain_text',
                                                                                    text: '🍽️ New Catering Event Request',
                                                                                    emoji: true
                                                        }
                                },
                                {
                                                        type: 'section',
                                                        fields: [
                                                            { type: 'mrkdwn', text: `*Event:*\n${formData.eventName}` },
                                                            { type: 'mrkdwn', text: `*Client:*\n${formData.clientName}` },
                                                            { type: 'mrkdwn', text: `*Date:*\n${formData.eventDate}` },
                                                            { type: 'mrkdwn', text: `*Guests:*\n${formData.expectedGuests}` }
                                                                                ]
                                },
                                {
                                                        type: 'section',
                                                        text: {
                                                                                    type: 'mrkdwn',
                                                                                    text: `*Rooms Requested:*\n${(formData.roomsRequested || formData.rooms || []).join(', ')}`
                                                        }
                                },
                                {
                                                        type: 'section',
                                                        text: {
                                                                                    type: 'mrkdwn',
                                                                                    text: `*Party Planner:*\n${formData.partyPlannerName}\n${formData.partyPlannerEmail}\n${formData.partyPlannerPhone}`
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
                                                                                            value: JSON.stringify({ requestId, formData })
                                                            },
                                                            {
                                                                                            type: 'button',
                                                                                            text: { type: 'plain_text', text: '⚠️ Partial Approval', emoji: true },
                                                                                            action_id: 'partial_approval',
                                                                                            value: JSON.stringify({ requestId, formData })
                                                            },
                                                            {
                                                                                            type: 'button',
                                                                                            text: { type: 'plain_text', text: '❌ Deny', emoji: true },
                                                                                            style: 'danger',
                                                                                            action_id: 'deny_request',
                                                                                            value: JSON.stringify({ requestId, formData })
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

            if (!slackResponse.ok) {
                            throw new Error('Failed to post to Slack');
            }

            res.json({ success: true, requestId });

        } catch (error) {
                    console.error('Error submitting request:', error);
                    res.status(500).json({ success: false, error: error.message });
        }
});

// POST endpoint - Handle Slack button interactions
app.post('/api/slack/interactions', async (req, res) => {
        try {
                    console.log('=== SLACK INTERACTION RECEIVED ===');

            if (false && !verifySlackSignature(req)) {
                            return res.status(401).send('Invalid signature');
            }

            const payload = JSON.parse(req.body.payload);

            // Handle modal view submissions
            if (payload.type === 'view_submission') {
                            await handleViewSubmission(res, payload);
                            return;
            }

            const action = payload.actions[0];
                    console.log('Action ID:', action.action_id);

            const buttonData = JSON.parse(action.value);
                    const requestId = buttonData.requestId;
                    const formData = buttonData.formData;

            console.log('Request ID:', requestId);
                    console.log('Form data found:', !!formData);

            if (payload.user.id !== CONFIG.nathalieUserId) {
                            console.log('Unauthorized user:', payload.user.id);
                            return res.json({ text: "Sorry, only authorized personnel can approve/deny requests." });
            }

            console.log('Auth passed, handling action:', action.action_id);

            if (action.action_id === 'approve_all') {
                            await handleApproveAll(res, payload, requestId, formData);
            } else if (action.action_id === 'partial_approval') {
                            await handlePartialApproval(res, payload, requestId, formData);
            } else if (action.action_id === 'deny_request') {
                            await handleDeny(res, payload, requestId, formData);
            } else {
                            res.status(400).send('Unknown action');
            }

        } catch (error) {
                    console.error('Error handling interaction:', error);
                    res.status(500).json({ error: error.message });
        }
});

// Handle full approval
async function handleApproveAll(res, payload, requestId, formData) {
        try {
                    res.status(200).send();

            console.log('Approve All clicked for request:', requestId);

            const emailSubject = `✅ Event Approved: ${formData.eventName}`;
                    const emailBody = `
                    <h2>Catering Event Request APPROVED</h2>
                    <p><strong>Event Name:</strong> ${formData.eventName}</p>
                    <p><strong>Client Name:</strong> ${formData.clientName}</p>
                    <p><strong>Event Date:</strong> ${formData.eventDate}</p>
                    <p><strong>Expected Guests:</strong> ${formData.expectedGuests}</p>
                    <p><strong>Setup Start:</strong> ${formData.setupStartTime}</p>
                    <p><strong>Event Time:</strong> ${formData.eventStartTime} - ${formData.eventEndTime}</p>
                    <p><strong>Teardown Complete:</strong> ${formData.teardownCompleteTime}</p>
                    <h3>Approved Rooms</h3>
                    <ul>${(formData.roomsRequested || formData.rooms || []).map(room => `<li>${room}</li>`).join('\n')}</ul>
                    <p><strong>Party Planner:</strong> ${formData.partyPlannerName}</p>
                    <p><strong>Email:</strong> ${formData.partyPlannerEmail}</p>
                    <p><strong>Phone:</strong> ${formData.partyPlannerPhone}</p>
                    <p><em>Request ID: ${requestId}</em></p>
                    `;

            await sendEmail(CONFIG.catererEmail, formData.partyPlannerEmail, emailSubject, emailBody);
                    console.log('Approval email sent successfully');

            await fetch(payload.response_url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                                replace_original: true,
                                                text: `✅ *APPROVED* - ${formData.eventName}`,
                                                blocks: [
                                                    {
                                                                                type: 'section',
                                                                                text: {
                                                                                                                type: 'mrkdwn',
                                                                                                                text: `✅ *APPROVED* - ${formData.eventName}\nApproved by <@${payload.user.id}>\nApproval email sent to ${CONFIG.catererEmail}`
                                                                                    }
                                                    }
                                                                    ]
                            })
            });

        } catch (error) {
                    console.error('Error in handleApproveAll:', error);
                    try {
                                    await fetch(payload.response_url, {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ text: '❌ Error processing approval. Please try again.' })
                                    });
                    } catch (e) {
                                    console.error('Failed to send error to Slack:', e);
                    }
        }
}

// Handle partial approval - opens a modal via views.open
async function handlePartialApproval(res, payload, requestId, formData) {
        try {
                    console.log('handlePartialApproval called');

            const rooms = formData.roomsRequested || formData.rooms || [];
                    console.log('Rooms:', rooms);

            const roomOptions = rooms.map((room, index) => ({
                            text: { type: 'plain_text', text: room },
                            value: `room_${index}`
            }));

            // Acknowledge immediately
            res.status(200).send();

            // Open modal via Slack API
            const modalResponse = await fetch('https://slack.com/api/views.open', {
                            method: 'POST',
                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': `Bearer ${CONFIG.slackBotToken}`
                            },
                            body: JSON.stringify({
                                                trigger_id: payload.trigger_id,
                                                view: {
                                                                        type: 'modal',
                                                                        callback_id: `partial_confirm_${requestId}`,
                                                                        private_metadata: JSON.stringify({ requestId, formData }),
                                                                        title: { type: 'plain_text', text: 'Partial Approval' },
                                                                        submit: { type: 'plain_text', text: 'Submit Decision' },
                                                                        close: { type: 'plain_text', text: 'Cancel' },
                                                                        blocks: [
                                                                            {
                                                                                                            type: 'section',
                                                                                                            text: { type: 'mrkdwn', text: `*Event:* ${formData.eventName}\n\n*Select approved rooms:*` }
                                                                                },
                                                                            {
                                                                                                            type: 'input',
                                                                                                            block_id: 'rooms_block',
                                                                                                            label: { type: 'plain_text', text: 'Approved Rooms' },
                                                                                                            element: {
                                                                                                                                                type: 'checkboxes',
                                                                                                                                                action_id: 'rooms_input',
                                                                                                                                                options: roomOptions
                                                                                                                }
                                                                                },
                                                                            {
                                                                                                            type: 'input',
                                                                                                            block_id: 'explanation_block',
                                                                                                            label: { type: 'plain_text', text: 'Explanation / Alternatives' },
                                                                                                            element: {
                                                                                                                                                type: 'plain_text_input',
                                                                                                                                                action_id: 'explanation_input',
                                                                                                                                                multiline: true,
                                                                                                                                                placeholder: {
                                                                                                                                                                                        type: 'plain_text',
                                                                                                                                                                                        text: 'Explain which rooms are not available and suggest alternatives...'
                                                                                                                                                    }
                                                                                                                }
                                                                                }
                                                                                                ]
                                                }
                            })
            });

            const modalResult = await modalResponse.json();
                    console.log('Modal open result:', JSON.stringify(modalResult));

        } catch (error) {
                    console.error('Error in handlePartialApproval:', error);
        }
}

// Handle deny - opens a modal via views.open
async function handleDeny(res, payload, requestId, formData) {
        try {
                    console.log('handleDeny called');

            // Acknowledge immediately
            res.status(200).send();

            const modalResponse = await fetch('https://slack.com/api/views.open', {
                            method: 'POST',
                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': `Bearer ${CONFIG.slackBotToken}`
                            },
                            body: JSON.stringify({
                                                trigger_id: payload.trigger_id,
                                                view: {
                                                                        type: 'modal',
                                                                        callback_id: `deny_confirm_${requestId}`,
                                                                        private_metadata: JSON.stringify({ requestId, formData }),
                                                                        title: { type: 'plain_text', text: 'Deny Request' },
                                                                        submit: { type: 'plain_text', text: 'Confirm Denial' },
                                                                        close: { type: 'plain_text', text: 'Cancel' },
                                                                        blocks: [
                                                                            {
                                                                                                            type: 'section',
                                                                                                            text: { type: 'mrkdwn', text: `*Denying:* ${formData.eventName}` }
                                                                                },
                                                                            {
                                                                                                            type: 'input',
                                                                                                            block_id: 'reason_block',
                                                                                                            label: { type: 'plain_text', text: 'Reason for Denial' },
                                                                                                            element: {
                                                                                                                                                type: 'plain_text_input',
                                                                                                                                                action_id: 'reason_input',
                                                                                                                                                multiline: true,
                                                                                                                                                placeholder: {
                                                                                                                                                                                        type: 'plain_text',
                                                                                                                                                                                        text: 'Explain why the request cannot be approved...'
                                                                                                                                                    }
                                                                                                                }
                                                                                }
                                                                                                ]
                                                }
                            })
            });

            const modalResult = await modalResponse.json();
                    console.log('Modal open result:', JSON.stringify(modalResult));

        } catch (error) {
                    console.error('Error in handleDeny:', error);
        }
}

// Handle modal view submissions
async function handleViewSubmission(res, payload) {
        try {
                    const callbackId = payload.view.callback_id;
                    console.log('View submission callback_id:', callbackId);

            const metadata = JSON.parse(payload.view.private_metadata);
                    const { requestId, formData } = metadata;
                    const values = payload.view.state.values;

            let emailSubject, emailBody, slackText;

            if (callbackId.startsWith('partial_confirm_')) {
                            const selectedOptions = values.rooms_block.rooms_input.selected_options || [];
                            const rooms = formData.roomsRequested || formData.rooms || [];
                            const selectedRooms = selectedOptions.map(opt => rooms[parseInt(opt.value.split('_')[1])]);
                            const explanation = values.explanation_block.explanation_input.value;
                            const deniedRooms = rooms.filter(r => !selectedRooms.includes(r));

                        emailSubject = `⚠️ Partial Approval: ${formData.eventName}`;
                            emailBody = `
                            <h2>Catering Event Request PARTIALLY APPROVED</h2>
                            <p><strong>Event:</strong> ${formData.eventName}</p>
                            <p><strong>Client:</strong> ${formData.clientName}</p>
                            <p><strong>Date:</strong> ${formData.eventDate}</p>
                            <h3>Approved Rooms</h3>
                            <ul>${selectedRooms.map(r => `<li>${r}</li>`).join('\n')}</ul>
                            ${deniedRooms.length > 0 ? `<h3>Unavailable Rooms</h3><ul>${deniedRooms.map(r => `<li>${r}</li>`).join('\n')}</ul>` : ''}
                            <p><strong>Details:</strong> ${explanation}</p>
                            <p><em>Request ID: ${requestId}</em></p>
                            `;
                            slackText = `⚠️ *PARTIAL APPROVAL* by <@${payload.user.id}>\nApproved: ${selectedRooms.join(', ')}\n${explanation}`;

            } else if (callbackId.startsWith('deny_confirm_')) {
                            const reason = values.reason_block.reason_input.value;

                        emailSubject = `❌ Request Declined: ${formData.eventName}`;
                            emailBody = `
                            <h2>Catering Event Request DECLINED</h2>
                            <p><strong>Event:</strong> ${formData.eventName}</p>
                            <p><strong>Date:</strong> ${formData.eventDate}</p>
                            <p><strong>Reason:</strong> ${reason}</p>
                            <p><em>Request ID: ${requestId}</em></p>
                            `;
                            slackText = `❌ *DENIED* by <@${payload.user.id}>\nReason: ${reason}`;
            }

            // Send email
            await sendEmail(CONFIG.catererEmail, formData.partyPlannerEmail, emailSubject, emailBody);
                    console.log('Email sent for view submission');

            // Update original Slack message
            // Note: response_url is not available in view_submission for button-triggered modals
            // So we just close the modal
            res.json({ response_action: 'clear' });

        } catch (error) {
                    console.error('Error in handleViewSubmission:', error);
                    res.status(500).json({ error: error.message });
        }
}

// Send email helper
async function sendEmail(to, cc, subject, htmlBody) {
        await transporter.sendMail({
                    from: CONFIG.email.user,
                    to: to,
                    cc: cc,
                    subject: subject,
                    html: htmlBody
        });
}

// Health check
app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
});

module.exports = app;
