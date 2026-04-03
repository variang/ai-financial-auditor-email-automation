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

- `GOOGLE_SPREADSHEET_ID`
- `GMAIL_PUBSUB_TOPIC`

4. Run locally

```bash
npm run dev
```

## Scripts

- `npm run dev`: Run app with tsx
- `npm run typecheck`: Run TypeScript checks only
- `npm run build`: Emit compiled JavaScript into dist
- `npm test`: Run smoke tests

## Metrics

When `METRICS_ENABLED=true` and runtime is not `test`, the app starts an HTTP endpoint for Prometheus scraping:

- `http://localhost:${METRICS_PORT}/metrics`

Tracked metrics include workflow runs, duration, in-flight runs, transactions processed, sheet upserts, and replies sent.

## Planned Next Iterations

- Replace Gmail trigger stub with real Pub/Sub webhook + watch renewal flow
- Replace Sheets stub with real tab creation/writes
- Add statement parser implementation using LLM provider adapter
- Add idempotency + retry/backoff policy
