-- User List Query
-- Returns customer-level data with subscription and invoice information
-- For MRR Dashboard user list with filtering

WITH subs_mrr AS (
  SELECT
    s.subscription_id,
    s.customer_id,
    s.status,
    s.created_ts,
    s.canceled_at_ts,
    s.current_period_start_ts,
    s.current_period_end_ts,
    s.price_amount,
    s.price_interval,
    s.quantity,
    s.currency
  FROM `project-e889923e-bd9b-442d-83f.stripe_test.stripe_subscriptions` s
  WHERE
    s.subscription_id IS NOT NULL AND s.subscription_id != ''
    AND s.customer_id IS NOT NULL AND s.customer_id != ''
    AND s.price_amount IS NOT NULL
    AND s.quantity IS NOT NULL
    AND s.price_interval IN ('month', 'year')
),

-- Get latest subscription per customer (for current status)
customer_latest_sub AS (
  SELECT
    customer_id,
    subscription_id,
    status,
    created_ts,
    canceled_at_ts,
    price_amount,
    price_interval,
    quantity,
    current_period_start_ts,
    current_period_end_ts,
    currency
  FROM subs_mrr
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_id
    ORDER BY created_ts DESC
  ) = 1
),

-- Check for unpaid invoices (delinquent status)
-- Using latest month-end (2025-06-30) as reference point
customer_unpaid_invoices AS (
  SELECT
    i.customer_id,
    MAX(DATE_DIFF(DATE '2025-06-30', DATE(i.created_ts), DAY)) AS max_delinquency_days,
    COUNT(*) AS unpaid_count
  FROM `project-e889923e-bd9b-442d-83f.stripe_test.stripe_invoices` i
  WHERE
    i.status IN ('open', 'draft')
    AND (i.paid_ts IS NULL OR i.paid_ts > TIMESTAMP('2025-06-30 23:59:59'))
  GROUP BY i.customer_id
),

-- Customer info
customer_info AS (
  SELECT
    c.customer_id,
    c.email,
    c.created_ts AS customer_created_ts,
    c.delinquent AS customer_delinquent
  FROM `project-e889923e-bd9b-442d-83f.stripe_test.stripe_customers` c
)

SELECT
  ci.customer_id,
  ci.email,
  ci.customer_created_ts,
  COALESCE(ci.customer_delinquent, FALSE) AS is_delinquent,
  cls.status AS subscription_status,
  cls.price_amount,
  cls.price_interval,
  cls.quantity,
  cls.created_ts AS subscription_created_ts,
  cls.canceled_at_ts AS subscription_canceled_ts,
  cls.current_period_start_ts,
  cls.current_period_end_ts,
  cls.currency,
  COALESCE(cui.max_delinquency_days, 0) AS max_delinquency_days,
  COALESCE(cui.unpaid_count, 0) AS unpaid_invoice_count
FROM customer_info ci
LEFT JOIN customer_latest_sub cls ON ci.customer_id = cls.customer_id
LEFT JOIN customer_unpaid_invoices cui ON ci.customer_id = cui.customer_id
ORDER BY ci.customer_created_ts DESC;
