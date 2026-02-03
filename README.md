# MRR Dashboard

A Next.js 14 dashboard for visualizing Stripe subscription MRR (Monthly Recurring Revenue) metrics with an AI-powered analytics agent.

## Features

- **MRR Dashboard** — Real-time MRR, historical trends (Gross/Delinquent/Collectible), user growth/churn, subscription status distribution
- **AI Agent** — Natural language analytics powered by BigQuery, with streaming chat, SQL queries, chart generation, and HTML reports

## Tech Stack

- **Framework**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Data**: Google BigQuery (Stripe subscription data)
- **Agent**: Vercel AI SDK + Prisma (PostgreSQL)
- **Charts**: Recharts + ECharts

---

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment Variables

Create `.env.local` with the following required variables:

```bash
# BigQuery (Dashboard + Agent queries)
BIGQUERY_SA_BASE64=<your-base64-encoded-service-account-json>

# PostgreSQL (Agent session storage)
DATABASE_URL="postgresql://user:password@host:5432/dbname?schema=public"

# Vercel AI Gateway (Agent streaming chat)
AI_GATEWAY_API_KEY=<your-vercel-ai-gateway-api-key>
# AI_GATEWAY_MODEL=openai/gpt-4o-mini  # Optional, defaults to gpt-4o-mini
```

**BigQuery Setup**:
- Create a GCP service account with `BigQuery Data Viewer` + `BigQuery Job User` roles
- Download the JSON key, run `cat key.json | base64`, and paste the output into `BIGQUERY_SA_BASE64`

### 3. Initialize Database

```bash
pnpm run migrate:dev
```

### 4. Start Development Server

```bash
pnpm dev
```

- Dashboard: [http://localhost:3000](http://localhost:3000)
- AI Agent: [http://localhost:3000/agent](http://localhost:3000/agent)

### 5. Production Build

```bash
pnpm build
pnpm start
```

---

## Project Structure

```
mrr_vercel/
├── app/
│   ├── api/                    # API routes (BigQuery queries + Agent Chat)
│   ├── agent/                  # AI Agent page
│   ├── lib/
│   │   ├── agent/              # Agent tools (runBigQuery, generateEchartsOption, generateHtmlReport)
│   │   └── bigquery.ts         # BigQuery client
│   └── page.tsx                # Dashboard home
├── components/                 # Chart components + Agent UI
├── docs/
│   └── data_catalog.md         # Agent data specification (single source of truth)
├── prisma/
│   └── schema.prisma           # Agent session/message storage
└── sql/                        # BigQuery SQL query templates
```

---

## License

MIT
