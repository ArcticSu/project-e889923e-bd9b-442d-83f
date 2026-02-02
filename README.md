# MRR Dashboard

A Next.js 14 (App Router) dashboard for visualizing Monthly Recurring Revenue (MRR) metrics from Stripe subscriptions stored in BigQuery.

## Features

- **Real-time MRR tracking** — Current live MRR and active subscription counts
- **Historical trends** — 6-month MRR breakdown (gross/delinquent/collectible)
- **User analytics** — Active paid users, growth/churn rates, upgrade vs. normal users
- **Status distribution** — Subscription status pie chart (active/past_due/canceled)

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Data Source**: Google BigQuery (Stripe data)
- **Deployment**: Vercel

## Project Structure

```
mrr_frontend_next/
├── app/                   # Next.js App Router
│   ├── api/              # API routes (BigQuery queries)
│   ├── lib/              # Shared utilities (BigQuery client)
│   ├── layout.tsx        # Root layout
│   └── page.tsx          # Dashboard home
├── components/           # React chart components
├── sql/                  # BigQuery SQL queries
└── styles/              # Global CSS & Tailwind config
```

## Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Configure BigQuery credentials**:
   - Create a GCP service account with `BigQuery Data Viewer` and `BigQuery Job User` roles
   - Download the JSON key and base64 encode it:
     ```bash
     base64 key.json | tr -d '\n' > key.base64
     ```
   - Add to `.env.local`:
     ```
     BIGQUERY_SA_BASE64=<paste base64 string here>
     ```

3. **Run locally**:
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000)

4. **Build for production**:
   ```bash
   pnpm build
   pnpm start
   ```

## API Routes

- `GET /api/mrr?months=6` — Historical + current MRR
- `GET /api/pie` — Subscription status distribution
- `GET /api/combined` — Active users & growth/churn rates
- `GET /api/active_breakdown` — Upgrade vs. normal users