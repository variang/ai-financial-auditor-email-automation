/**
 * Local development simulation.
 * Sends a mock Gmail Pub/Sub push payload to the running webhook server.
 *
 * Usage:
 *   1. npm run dev        (start the webhook server in one terminal)
 *   2. npm run simulate   (send a mock push in another terminal)
 */

import { loadConfig } from "./config/env.js";

const config = loadConfig();

const gmailNotification = {
  emailAddress: config.ownerEmail,
  historyId: 99999
};

const mockEnvelope = {
  message: {
    data: Buffer.from(JSON.stringify(gmailNotification)).toString("base64"),
    messageId: `simulate-${Date.now()}`,
    publishTime: new Date().toISOString(),
    attributes: {}
  },
  subscription: `projects/local-dev/subscriptions/gmail-simulate`
};

const tokenParam = config.pubSubVerificationToken
  ? `?token=${encodeURIComponent(config.pubSubVerificationToken)}`
  : "";

const url = `http://localhost:${config.webhookPort}/pubsub/push${tokenParam}`;

console.log(`Sending simulated Pub/Sub push to ${url}`);

const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(mockEnvelope)
});

console.log(`Response: HTTP ${response.status}`);
