-- =====================================================
-- MRR 3 Columns (Gross / Delinquent / Collectible)
-- Month-end Snapshot (EOD / 23:59:59 via next_month_start)
-- Range: 2025-01 to 2025-06
--
-- Definitions:
--
-- Month-end(EOD):
--   next_month_start_ts = TIMESTAMP(DATE_ADD(month_start, INTERVAL 1 MONTH))
--
-- Active at month_end(EOD):
--   created_ts <  next_month_start_ts
--   AND (canceled_at_ts IS NULL OR canceled_at_ts >= next_month_start_ts)
--
-- Delinquent at month_end(EOD):
--   exists invoice where
--     inv_created_ts <  next_month_start_ts
--     AND (inv_paid_ts IS NULL OR inv_paid_ts >= next_month_start_ts)
--
-- Collectible (30-day rule):
--   Active at month_end(EOD) AND (
--     no unpaid invoice at EOD
--     OR max delinquency_days among unpaid invoices <= 30
--   )
--
-- delinquency_days = DATE_DIFF(month_end_date, DATE(inv_created_ts), DAY)
-- =====================================================

WITH months AS (
  SELECT month_start
  FROM UNNEST(
    GENERATE_DATE_ARRAY(DATE '2025-01-01', DATE '2025-06-01', INTERVAL 1 MONTH)
  ) AS month_start
),

month_bounds AS (
  SELECT
    m.month_start,
    DATE_SUB(DATE_ADD(m.month_start, INTERVAL 1 MONTH), INTERVAL 1 DAY) AS month_end_date,
    TIMESTAMP(DATE_ADD(m.month_start, INTERVAL 1 MONTH)) AS next_month_start_ts
  FROM months m
),

subs AS (
  SELECT
    s.subscription_id,
    s.created_ts,
    s.canceled_at_ts,
    s.price_amount,
    s.price_interval,
    s.quantity
  FROM `project-e889923e-bd9b-442d-83f.stripe_test.stripe_subscriptions` s
  WHERE
    s.subscription_id IS NOT NULL
    AND s.subscription_id != ''
    AND s.price_amount IS NOT NULL
    AND s.quantity IS NOT NULL
    AND s.price_interval IN ('month', 'year')
),

subs_mrr AS (
  SELECT
    s.subscription_id,
    s.created_ts,
    s.canceled_at_ts,
    (s.price_amount * s.quantity) / 100.0 /
      CASE WHEN s.price_interval = 'year' THEN 12 ELSE 1 END AS monthly_mrr
  FROM subs s
),

inv_base AS (
  SELECT
    i.subscription_id,
    i.invoice_id,
    i.created_ts AS inv_created_ts,
    i.paid_ts    AS inv_paid_ts
  FROM `project-e889923e-bd9b-442d-83f.stripe_test.stripe_invoices` i
  WHERE
    i.subscription_id IS NOT NULL
    AND i.subscription_id != ''
    AND i.created_ts IS NOT NULL
),

-- invoices unpaid at month_end(EOD)
unpaid_asof AS (
  SELECT
    b.month_start,
    b.month_end_date,
    b.next_month_start_ts,
    i.subscription_id,
    DATE_DIFF(b.month_end_date, DATE(i.inv_created_ts), DAY) AS delinquency_days
  FROM month_bounds b
  JOIN inv_base i
    ON i.inv_created_ts < b.next_month_start_ts
   AND (i.inv_paid_ts IS NULL OR i.inv_paid_ts >= b.next_month_start_ts)
),

-- delinquent flag (existence)
delinquent_flag AS (
  SELECT DISTINCT
    month_start,
    subscription_id,
    1 AS is_delinquent
  FROM unpaid_asof
),

-- max delinquency days for collectible logic
max_unpaid_days AS (
  SELECT
    month_start,
    subscription_id,
    MAX(delinquency_days) AS max_unpaid_days
  FROM unpaid_asof
  GROUP BY month_start, subscription_id
),

final_rows AS (
  SELECT
    b.month_start AS month,
    b.month_end_date,
    b.next_month_start_ts,

    s.subscription_id,
    s.monthly_mrr,
    s.created_ts,
    s.canceled_at_ts,

    IFNULL(df.is_delinquent, 0) AS is_delinquent,
    mud.max_unpaid_days
  FROM month_bounds b
  CROSS JOIN subs_mrr s
  LEFT JOIN delinquent_flag df
    ON df.month_start = b.month_start
   AND df.subscription_id = s.subscription_id
  LEFT JOIN max_unpaid_days mud
    ON mud.month_start = b.month_start
   AND mud.subscription_id = s.subscription_id
)

SELECT
  month,

  -- 1) Gross MRR
  ROUND(SUM(
    CASE
      WHEN created_ts >= next_month_start_ts THEN 0
      WHEN canceled_at_ts IS NOT NULL AND canceled_at_ts < next_month_start_ts THEN 0
      ELSE monthly_mrr
    END
  ), 2) AS gross_mrr_amount,

  -- 2) Delinquent MRR
  ROUND(SUM(
    CASE
      WHEN created_ts >= next_month_start_ts THEN 0
      WHEN canceled_at_ts IS NOT NULL AND canceled_at_ts < next_month_start_ts THEN 0
      WHEN is_delinquent = 1 THEN monthly_mrr
      ELSE 0
    END
  ), 2) AS delinquent_mrr_amount,

  -- 3) Collectible MRR (30-day rule)
  ROUND(SUM(
    CASE
      WHEN created_ts >= next_month_start_ts THEN 0
      WHEN canceled_at_ts IS NOT NULL AND canceled_at_ts < next_month_start_ts THEN 0
      WHEN max_unpaid_days IS NULL THEN monthly_mrr
      WHEN max_unpaid_days <= 30 THEN monthly_mrr
      ELSE 0
    END
  ), 2) AS collectible_mrr_amount

FROM final_rows
GROUP BY month
ORDER BY month;
