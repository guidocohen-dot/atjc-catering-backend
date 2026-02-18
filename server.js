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
    catererEmail: 'gcohen@atjc.org', // Will be updated later
    nathalieUserId: 'U081RLR5WRW',
    
    // Email configuration (using Gmail as example)
    email: {
        service: 'gmail',
        user: 'your-email@gmail.com',
        pass: 'your-app-specific-password' // Use app-specific password for Gmail
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

// Store pending requests (in production, use a database)
// No longer needed - form data is stored in Slack message buttons
// const pendingRequests = new Map();
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
        
        // Create Slack message with embedded form data
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
                        {
                            type: 'mrkdwn',
                            text: `*Event:*\n${formData.eventName}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Client:*\n${formData.clientName}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Date:*\n${formData.eventDate}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Guests:*\n${formData.expectedGuests}`
                        }
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
                            text: {
                                type: 'plain_text',
                                text: '✅ Approve All',
                                emoji: true
                            },
                            style: 'primary',
                            action_id: 'approve_all',
                            value: JSON.stringify({
                                requestId: requestId,
                                formData: formData
                            })
                        },
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: '⚠️ Partial Approval',
                                emoji: true
                            },
                            action_id: 'partial_approval',
                            value: JSON.stringify({
                                requestId: requestId,
                                formData: formData
                            })
                        },
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: '❌ Deny',
                                emoji: true
                            },
                            style: 'danger',
                            action_id: 'deny_request',
                            value: JSON.stringify({
                                requestId: requestId,
                                formData: formData
                            })
                        }
                    ]
                }
            ]
        };
        
        // Send to Slack
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

// POST endpoint – Handle Slack button interactions
app.post('/api/slack/interactions', async (req, res) => {
    try {
        console.log('=== SLACK INTERACTION RECEIVED ===');
        
        // Verify Slack signature
        if (false && !verifySlackSignature(req)) {
            return res.status(401).send('Invalid signature');
        }
        
        const payload = JSON.parse(req.body.payload);
        const action = payload.actions[0];
        
        console.log('Action ID:', action.action_id);
        
        // Parse form data from button value
        const buttonData = JSON.parse(action.value);
        const requestId = buttonData.requestId;
        const formData = buttonData.formData;
        
        console.log('Request ID:', requestId);
        console.log('Form data found:', !!formData);
        
        // Check if user is authorized (Nathalie)
        if (payload.user.id !== CONFIG.nathalieUserId) {
            return res.json({
                text: "Sorry, only authorized personnel can approve/deny requests."
            });
        }
        
        // Handle different actions
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
    // Send immediate acknowledgment to Slack
    res.status(200).send();
    
    console.log('Approve All clicked for request:', requestId);
    
    // Send approval email
    const emailSubject = `✅ Event Approved: ${formData.eventName}`;
    const emailBody = `
<h2>Catering Event Request APPROVED</h2>

<h3>Event Details</h3>
<p><strong>Event Name:</strong> ${formData.eventName}</p>
<p><strong>Client Name:</strong> ${formData.clientName}</p>
<p><strong>Event Date:</strong> ${formData.eventDate}</p>
<p><strong>Expected Guests:</strong> ${formData.expectedGuests}</p>

<h3>Timeline</h3>
<p><strong>Setup Start:</strong> ${formData.setupStartTime}</p>
<p><strong>Event Time:</strong> ${formData.eventStartTime} - ${formData.eventEndTime}</p>
<p><strong>Teardown Complete:</strong> ${formData.teardownCompleteTime}</p>

<h3>Approved Rooms</h3>
<ul>
${formData.roomsRequested.map(room => `<li>${room}</li>`).join('\n')}
</ul>

<h3>Contact Information</h3>
<p><strong>Party Planner:</strong> ${formData.partyPlannerName}</p>
<p><strong>Email:</strong> ${formData.partyPlannerEmail}</p>
<p><strong>Phone:</strong> ${formData.partyPlannerPhone}</p>

<p><em>Request ID: ${requestId}</em></p>
`;
await sendEmail(
      CONFIG.catererEmail,
      formData.partyPlannerEmail,
      emailSubject,
      emailBody
    );
    
    console.log('Approval email sent successfully');
    
    // Update the Slack message to show it was approved
    const updateResponse = await fetch(payload.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: true,
        text: `✅ *APPROVED* - ${formData.eventName}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '✅ Request Approved',
              emoji: true
            }
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Event:*\n${formData.eventName}`
              },
              {
                type: 'mrkdwn',
                text: `*Client:*\n${formData.clientName}`
              },
              {
                type: 'mrkdwn',
                text: `*Date:*\n${formData.eventDate}`
              },
              {
                type: 'mrkdwn',
                text: `*Guests:*\n${formData.expectedGuests}`
              }
            ]
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Status:* All rooms approved\n*Approved by:* <@${payload.user.id}>`
            }
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Approval email sent to ${CONFIG.catererEmail}`
              }
            ]
          }
        ]
      })
    });
    
    if (!updateResponse.ok) {
      console.error('Failed to update Slack message');
    }
    
    // Remove from pending requests
    pendingRequests.delete(requestId);
    
  } catch (error) {
    console.error('Error in handleApproveAll:', error);
    
    // Try to send error message back to Slack
    try {
      await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '❌ Error processing approval. Please try again or contact support.'
        })
      });
    } catch (e) {
      console.error('Failed to send error message to Slack:', e);
    }
  }
}
      
// Handle partial approval
function handlePartialApproval(res, payload, requestId, formData) {
    // Create checkboxes for each requested room
    const roomOptions = formData.rooms.map((room, index) => ({
        text: {
            type: "plain_text",
            text: room
        },
        value: `room_${index}`
    }));
    
    res.json({
        response_action: "push",
        view: {
            type: "modal",
            callback_id: `partial_confirm_${requestId}`,
            title: {
                type: "plain_text",
                text: "Partial Approval"
            },
            submit: {
                type: "plain_text",
                text: "Submit Decision"
            },
            close: {
                type: "plain_text",
                text: "Cancel"
            },
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Event:* ${formData.eventName}\n\n*Select approved rooms:*`
                    }
                },
                {
                    type: "input",
                    block_id: "rooms_block",
                    label: {
                        type: "plain_text",
                        text: "Approved Rooms"
                    },
                    element: {
                        type: "checkboxes",
                        action_id: "rooms_input",
                        options: roomOptions
                    }
                },
                {
                    type: "input",
                    block_id: "explanation_block",
                    label: {
                        type: "plain_text",
                        text: "Explanation / Alternatives"
                    },
                    element: {
                        type: "plain_text_input",
                        action_id: "explanation_input",
                        multiline: true,
                        placeholder: {
                            type: "plain_text",
                            text: "Explain which rooms are not available and suggest alternatives..."
                        }
                    }
                }
            ]
        }
    });
}

// Handle deny
function handleDeny(res, payload, requestId, formData) {
    res.json({
        response_action: "push",
        view: {
            type: "modal",
            callback_id: `deny_confirm_${requestId}`,
            title: {
                type: "plain_text",
                text: "Deny Request"
            },
            submit: {
                type: "plain_text",
                text: "Confirm Denial"
            },
            close: {
                type: "plain_text",
                text: "Cancel"
            },
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Denying:* ${formData.eventName}`
                    }
                },
                {
                    type: "input",
                    block_id: "reason_block",
                    label: {
                        type: "plain_text",
                        text: "Reason for Denial"
                    },
                    element: {
                        type: "plain_text_input",
                        action_id: "reason_input",
                        multiline: true,
                        placeholder: {
                            type: "plain_text",
                            text: "Explain why the request cannot be approved..."
                        }
                    }
                }
            ]
        }
    });
}

// POST endpoint - Handle modal submissions
app.post('/api/slack/view-submissions', async (req, res) => {
    try {
        const payload = JSON.parse(req.body.payload);
        const callbackId = payload.view.callback_id;
        const [action, , requestId] = callbackId.split('_');
        
        const formData = pendingRequests.get(requestId);
        if (!formData) {
            return res.json({
                response_action: "errors",
                errors: {
                    general: "This request has expired"
                }
            });
        }
        
        // Extract form values from modal
        const values = payload.view.state.values;
        
        let emailSubject, emailBody, slackUpdate;
        
        if (action === 'approve') {
            const notes = values.notes_block?.notes_input?.value || '';
            
            emailSubject = `✅ Event Approved: ${formData.eventName}`;
            emailBody = `
Dear ${formData.plannerName},

Your catering event request has been APPROVED:

Event: ${formData.eventName}
Client: ${formData.clientName}
Date: ${formatDate(formData.eventDate)}
Time: ${formatTime(formData.eventStartTime)} - ${formatTime(formData.eventEndTime)}

All requested rooms have been approved:
${formData.rooms.map(r => `• ${r}`).join('\n')}

${notes ? `Additional Notes:\n${notes}\n` : ''}
If you have any questions, please contact us.

Best regards,
Aventura Turnberry Jewish Center
            `;
            
            slackUpdate = `✅ *APPROVED* by <@${payload.user.id}>\n${notes ? `Notes: ${notes}` : ''}`;
            
        } else if (action === 'partial') {
            const selectedRooms = values.rooms_block.rooms_input.selected_options.map(opt => 
                formData.rooms[parseInt(opt.value.split('_')[1])]
            );
            const explanation = values.explanation_block.explanation_input.value;
            
            const deniedRooms = formData.rooms.filter(r => !selectedRooms.includes(r));
            
            emailSubject = `⚠️ Partial Approval: ${formData.eventName}`;
            emailBody = `
Dear ${formData.plannerName},

Your catering event request has been PARTIALLY APPROVED:

Event: ${formData.eventName}
Client: ${formData.clientName}
Date: ${formatDate(formData.eventDate)}

Approved Rooms:
${selectedRooms.map(r => `• ${r}`).join('\n')}

${deniedRooms.length > 0 ? `\nUnavailable Rooms:\n${deniedRooms.map(r => `• ${r}`).join('\n')}` : ''}

Details:
${explanation}

Please let us know if this works for your event or if you need to discuss alternatives.

Best regards,
Aventura Turnberry Jewish Center
            `;
            
            slackUpdate = `⚠️ *PARTIAL APPROVAL* by <@${payload.user.id}>\nApproved: ${selectedRooms.join(', ')}\n${explanation}`;
            
        } else if (action === 'deny') {
            const reason = values.reason_block.reason_input.value;
            
            emailSubject = `❌ Request Declined: ${formData.eventName}`;
            emailBody = `
Dear ${formData.plannerName},

Unfortunately, we are unable to accommodate your event request:

Event: ${formData.eventName}
Date: ${formatDate(formData.eventDate)}

Reason:
${reason}

We apologize for any inconvenience. Please feel free to contact us to discuss alternatives or future availability.

Best regards,
Aventura Turnberry Jewish Center
            `;
            
            slackUpdate = `❌ *DENIED* by <@${payload.user.id}>\nReason: ${reason}`;
        }
        
        // Send email to caterer
        await transporter.sendMail({
            from: CONFIG.email.user,
            to: CONFIG.catererEmail,
            cc: formData.plannerEmail,
            subject: emailSubject,
            text: emailBody
        });
        
        // Update Slack message (would need to store message_ts from original post)
        // For now, just post a thread reply
        
        // Clean up
        pendingRequests.delete(requestId);
        
        res.json({ response_action: "clear" });
        
    } catch (error) {
        console.error('Error processing submission:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
