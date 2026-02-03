# Data Catalog — Single Source of Truth for Agent SQL

This document is the **canonical reference** for BigQuery tables and metric definitions used by the Dashboard Agent. All SQL and prompts must align with this catalog.

---

## 1. Dataset and Tables

- **Dataset**: `stripe_test` (or the dataset configured in ETL; project may be from env).
- **Tables** (from `scripts/stripe_to_bigquery.py`):
  - `stripe_test.stripe_customers` — customer metadata
  - `stripe_test.stripe_subscriptions` — subscription and plan data (primary for MRR)
  - `stripe_test.stripe_invoices` — invoice and payment status

Always use **fully qualified names**: `<PROJECT_ID>.stripe_test.stripe_subscriptions`, `<PROJECT_ID>.stripe_test.stripe_invoices` (replace PROJECT_ID with the BigQuery project ID you are given).

---

## 2. Table Definitions

### stripe_subscriptions

- **Purpose**: One row per subscription item (usually one per subscription). Used for MRR and active/cancel logic.
- **Key fields**:
  - `subscription_id` (STRING), `customer_id` (STRING)
  - `status` (STRING): e.g. active, canceled, trialing, past_due, unpaid
  - **Time fields (TIMESTAMP)**: `created_ts`, `canceled_at_ts`, `current_period_start_ts`, `current_period_end_ts`
  - **Pricing**: `price_amount` (INTEGER, cents), `price_interval` (STRING: 'month' | 'year'), `quantity` (INTEGER), `currency` (STRING)
- **Join key**: `subscription_id` (to invoices), `customer_id` (to customers).
- **Critical**: There is **no** `invoice_date` or `created` — use `created_ts`, `canceled_at_ts` only.

### stripe_invoices

- **Purpose**: Invoices per customer; used for paid/unpaid and delinquent logic.
- **Key fields**:
  - `invoice_id`, `customer_id`, `subscription_id` (STRING; may be filled by ETL if Stripe left it null)
  - **Time fields (TIMESTAMP)**: `created_ts`, `paid_ts` (from status_transitions.paid_at)
  - `status`, `amount_paid`, `amount_due`, `currency`, `subscription_id_filled` (BOOL)
- **Join key**: `subscription_id` to subscriptions; `customer_id` to customers.
- **Critical**: There is **no** `invoice_date` — use `created_ts` and `paid_ts` only.

### stripe_customers

- **Purpose**: Customer list; used for lookups.
- **Key fields**: `customer_id`, `email`, `created_ts`, `delinquent` (BOOL).

---

## 3. Metric Definitions (aligned with sql/)

### Month-end snapshot (EOD)

- **month_bounds** (from `sql/mrr_3col.sql`, `sql/combine_bar.sql`):
  - `month_start`: first day of month (DATE)
  - `next_month_start_ts`: start of *next* month as TIMESTAMP for EOD comparison:
    `TIMESTAMP(DATE_ADD(m.month_start, INTERVAL 1 MONTH))`
  - Optional: `month_end_date` = last day of month: `DATE_SUB(DATE_ADD(m.month_start, INTERVAL 1 MONTH), INTERVAL 1 DAY)`

### Active at month-end (EOD)

- Subscription counts as **active at month-end** iff:
  - `created_ts < next_month_start_ts`
  - AND `(canceled_at_ts IS NULL OR canceled_at_ts >= next_month_start_ts)`
- Gross MRR row is excluded if: `created_ts >= next_month_start_ts` OR `(canceled_at_ts IS NOT NULL AND canceled_at_ts < next_month_start_ts)`.

### Gross MRR

- **monthly_mrr** per subscription item:
  `(price_amount * quantity) / 100.0 / CASE WHEN price_interval = 'year' THEN 12 ELSE 1 END`
- **Gross MRR (month)**: SUM(monthly_mrr) over subscriptions that are active at month-end (same CASE as above). Use `ROUND(..., 2)`.

### Delinquent MRR (mrr_3col.sql)

- Invoice is **unpaid at month-end** if:
  `inv_created_ts < next_month_start_ts` AND `(inv_paid_ts IS NULL OR inv_paid_ts >= next_month_start_ts)`.
- **delinquency_days** = `DATE_DIFF(month_end_date, DATE(inv_created_ts), DAY)`.
- Subscription is **delinquent** if it has any such unpaid invoice at month-end.

### Collectible MRR (30-day rule)

- **Collectible** = active at month-end AND (no unpaid invoice OR max delinquency_days among unpaid ≤ 30).
  Otherwise that subscription's MRR is not collectible.

### New vs Churned (combine_bar.sql)

- **Active paid users (EOM)**: distinct `customer_id` where subscription is active at month-end and `monthly_mrr > 0`.
- **New paid users (EOM)**: first month a customer appears in active-paid-at-EOM.
- **Churned paid users (EOM)**: active paid in previous month-end but not in current month-end.

### Past Due / Status (pie.sql, upgrade_normal.sql)

- **Upgrade**: old subscription canceled and a new one for same customer created within ±5 minutes → treat old as non-canceled for "active" counts where needed.
- **status_effective**: for pie, canceled subs that are "upgrade" are relabeled to 'active'. Customer-level status: one row per customer (e.g. active, trialing, past_due, canceled).

### Data range (fixed period — mandatory)

- **Data exists only from 2025-01 through 2025-06.** There is no data before Jan or after Jun 2025.
- **"Last 3 months"** always means **April, May, June 2025** (the last three months in the data). Use `GENERATE_DATE_ARRAY(DATE '2025-04-01', DATE '2025-06-01', INTERVAL 1 MONTH)`.
- **"Last 1 month"** = June 2025 only. **"All months"** = Jan–Jun 2025 → `GENERATE_DATE_ARRAY(DATE '2025-01-01', DATE '2025-06-01', INTERVAL 1 MONTH)`.
- Do **not** use `CURRENT_DATE()` or "today". Do **not** use January–March when the user says "last 3 months".

---

## 4. Gross MRR by month — SQL template (use this, do not invent)

For **Gross MRR by month** use month-end snapshot logic from `sql/mrr_3col.sql`. Copy and adapt the following; replace `PROJECT_ID` with the BigQuery project ID you are given.

- **Last 3 months**: use `GENERATE_DATE_ARRAY(DATE '2025-04-01', DATE '2025-06-01', INTERVAL 1 MONTH)` in the months CTE.
- **All 6 months**: use `GENERATE_DATE_ARRAY(DATE '2025-01-01', DATE '2025-06-01', INTERVAL 1 MONTH)`.

```sql
WITH months AS (
  SELECT month_start FROM UNNEST(
    GENERATE_DATE_ARRAY(DATE '2025-04-01', DATE '2025-06-01', INTERVAL 1 MONTH)
  ) AS month_start
),
month_bounds AS (
  SELECT
    m.month_start,
    TIMESTAMP(DATE_ADD(m.month_start, INTERVAL 1 MONTH)) AS next_month_start_ts
  FROM months m
),
subs AS (
  SELECT subscription_id, created_ts, canceled_at_ts, price_amount, price_interval, quantity
  FROM `PROJECT_ID.stripe_test.stripe_subscriptions` s
  WHERE s.subscription_id IS NOT NULL AND s.subscription_id != ''
    AND s.price_amount IS NOT NULL AND s.quantity IS NOT NULL
    AND s.price_interval IN ('month', 'year')
),
subs_mrr AS (
  SELECT subscription_id, created_ts, canceled_at_ts,
    (price_amount * quantity) / 100.0 / CASE WHEN price_interval = 'year' THEN 12 ELSE 1 END AS monthly_mrr
  FROM subs
)
SELECT b.month_start AS month,
  ROUND(SUM(CASE
    WHEN s.created_ts >= b.next_month_start_ts THEN 0
    WHEN s.canceled_at_ts IS NOT NULL AND s.canceled_at_ts < b.next_month_start_ts THEN 0
    ELSE s.monthly_mrr END
  ), 2) AS gross_mrr_amount
FROM month_bounds b
CROSS JOIN subs_mrr s
GROUP BY b.month_start
ORDER BY b.month_start;
```

(For delinquent or collectible MRR, use the full logic in `sql/mrr_3col.sql`; only do so when the user explicitly asks for delinquent or collectible.)

---

## 5. Common Pitfalls

- **Wrong field names**: There is no `invoice_date`; use `created_ts` and `paid_ts` on invoices. No `created` or `canceled_at` — use `created_ts`, `canceled_at_ts` on subscriptions.
- **Month-end logic**: Use `next_month_start_ts` (TIMESTAMP) for EOD; do not use `TIMESTAMP_SUB(..., INTERVAL 1 MONTH)` with TIMESTAMP for month arithmetic (use DATE + INTERVAL).
- **Upgrade double-count**: When counting "users" or "MRR", use customer-level or subscription-level logic from sql/ so upgrade (cancel + new sub) does not double-count.
- **Always filter**: `subscription_id IS NOT NULL AND subscription_id != ''`, and for MRR: `price_amount IS NOT NULL AND quantity IS NOT NULL AND price_interval IN ('month', 'year')`.
