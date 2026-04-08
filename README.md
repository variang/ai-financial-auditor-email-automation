# AI Financial Auditor Email Automation

AI Agent that automates credit card financial audit based on Gmail-triggered, writes to Google Sheets, and replies with a spreadsheet link and a short audit summary.

## Current Scope

- Node 20 + TypeScript strict setup
- Environment validation and fail-fast startup
- Winston structured logging
- Prometheus metrics publishing on /metrics
- Integration contracts for Gmail, Sheets, LLM, and reply dispatch
- LangGraph workflow skeleton with deterministic steps
- LangSmith tracing toggle hooks
- Minimal smoke tests

## Setup

1. Install dependencies

```bash
npm install
```

2. Create local environment file

```bash
cp .env.example .env
```

3. Fill required values in `.env`

- `GOOGLE_OWNER_EMAIL`
- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS_PATH`
- `GMAIL_PUBSUB_TOPIC`
- `GOOGLE_OAUTH_CLIENT_ID` (required for personal Gmail send)
- `GOOGLE_OAUTH_CLIENT_SECRET` (required for personal Gmail send)
- `GOOGLE_OAUTH_REFRESH_TOKEN` (required for personal Gmail send)

4. Run locally

```bash
npm run dev
```

## Gmail + Pub/Sub Integration

Use this section to connect a real Gmail mailbox to the webhook endpoint (`POST /pubsub/push`).

### 1) Enable required Google APIs

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable gmail.googleapis.com pubsub.googleapis.com sheets.googleapis.com
```

### 2) Create Pub/Sub topic for Gmail notifications

```bash
gcloud pubsub topics create gmail-inbox-updates
```

Set this topic in `.env`:

- `GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/gmail-inbox-updates`
- `GOOGLE_CREDENTIALS_PATH=/absolute/path/to/service-account.json`

### 3) Expose your local webhook publicly

If you run locally on `WEBHOOK_PORT=8080`, expose it with a tunnel, for example:

```bash
ngrok http 8080
```

Use your tunnel URL as the push endpoint:

- `https://YOUR_PUBLIC_HOST/pubsub/push`
- If using token verification: `https://YOUR_PUBLIC_HOST/pubsub/push?token=YOUR_TOKEN`

### 4) Create Pub/Sub push subscription

```bash
gcloud pubsub subscriptions create gmail-inbox-updates-push \
	--topic=gmail-inbox-updates \
	--push-endpoint="https://YOUR_PUBLIC_HOST/pubsub/push?token=YOUR_TOKEN"
```

If you use a token in subscription URL, set the same value in `.env`:

- `PUBSUB_VERIFICATION_TOKEN=YOUR_TOKEN`

### 5) Grant Gmail permission to publish to your topic

Gmail pushes using this Google-managed identity:

- `gmail-api-push@system.gserviceaccount.com`

Grant publisher role on the topic:

```bash
gcloud pubsub topics add-iam-policy-binding gmail-inbox-updates \
	--member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
	--role="roles/pubsub.publisher"
```

### 6) Configure OAuth for the Gmail account you want to watch

1. Create OAuth client credentials in Google Cloud (Desktop App or Web App).
2. Add your mailbox as a test user if the consent screen is in testing mode.
3. Request Gmail scopes and obtain an access token for the watched account.
4. For personal-account sending in this app, store the OAuth client and refresh token in `.env`:

```bash
GOOGLE_OAUTH_CLIENT_ID=your-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REFRESH_TOKEN=your-refresh-token
```

Common scopes used for this flow:

- `https://www.googleapis.com/auth/gmail.modify`

### 7) Register Gmail watch

Call Gmail `users.watch` with your topic:

```bash
curl -X POST "https://gmail.googleapis.com/gmail/v1/users/me/watch" \
	-H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{
		"topicName": "projects/YOUR_PROJECT_ID/topics/gmail-inbox-updates",
		"labelIds": ["INBOX"]
	}'
```

Successful response includes `historyId` and `expiration`.

### 8) Run and validate locally

Start server:

```bash
npm run dev
```

Send local simulation payload:

```bash
npm run simulate
```

Validation checks:

- Health endpoint returns OK: `GET /health`
- Metrics endpoint is available when enabled: `http://localhost:${METRICS_PORT}/metrics`
- Logs show push decode/receipt entries (for example `push-handler-event-received`)

### 9) Operational note: renew watch periodically

Gmail watch expires and must be renewed. Re-run `users.watch` on a schedule (at least daily is a safe baseline).

Without renewal, Gmail stops sending push notifications.

## Scripts

- `npm run dev`: Run app with tsx
- `npm run typecheck`: Run TypeScript checks only
- `npm run build`: Emit compiled JavaScript into dist
- `npm test`: Run smoke tests
- `npm run simulate`: Sends a mock Gmail Pub/Sub push payload to the running webhook server

## Metrics

When `METRICS_ENABLED=true` and runtime is not `test`, the app starts an HTTP endpoint for Prometheus scraping:

- `http://localhost:${METRICS_PORT}/metrics`

Tracked metrics include workflow runs, duration, in-flight runs, transactions processed, sheet upserts, and replies sent.

## Planned Next Iterations

- [x] Replace Gmail trigger stub with real Pub/Sub webhook + watch renewal flow
- [x] Replace Sheets stub with real tab creation/writes
- [ ] Add statement parser implementation using LLM provider adapter
- [ ] Add idempotency + retry/backoff policy
