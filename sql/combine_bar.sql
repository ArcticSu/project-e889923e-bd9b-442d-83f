-- Combined Bar Metrics (Gross MRR month-end snapshot logic)
-- Output per month:
-- 1) active_paid_users_eom  (bar) - based on gross MRR snapshot
-- 2) new_paid_users_eom     (count of users created in this month, excluding upgrades)
-- 3) churned_paid_users_eom (count of users canceled in this month, excluding upgrades)
-- 4) growth_rate            (line) = new / prev_active
-- 5) churn_rate             (line) = churn / prev_active
--
-- Active at month_end(EOD) uses the SAME logic as gross_mrr:
--   created_ts <  next_month_start_ts
--   AND (canceled_at_ts IS NULL OR canceled_at_ts >= next_month_start_ts)
--
-- Notes:
-- - "user" is customer_id (dedup upgrade automatically).
-- - We count only paying users: monthly_mrr > 0.
-- - Upgrade users: if a customer cancels and creates a new subscription within 5 minutes,
--   it's considered an upgrade (not churn, not growth).

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
    TIMESTAMP(DATE_ADD(m.month_start, INTERVAL 1 MONTH)) AS next_month_start_ts,
    TIMESTAMP(m.month_start) AS month_start_ts
  FROM months m
),

subs AS (
  SELECT
    s.subscription_id,
    s.customer_id,
    s.created_ts,
    s.canceled_at_ts,
    s.price_amount,
    s.price_interval,
    s.quantity
  FROM `project-e889923e-bd9b-442d-83f.stripe_test.stripe_subscriptions` s
  WHERE
    s.subscription_id IS NOT NULL AND s.subscription_id != ''
    AND s.customer_id IS NOT NULL AND s.customer_id != ''
    AND s.price_amount IS NOT NULL
    AND s.quantity IS NOT NULL
    AND s.price_interval IN ('month', 'year')
),

subs_mrr AS (
  SELECT
    subscription_id,
    customer_id,
    created_ts,
    canceled_at_ts,
    (price_amount * quantity) / 100.0 /
      CASE WHEN price_interval = 'year' THEN 12 ELSE 1 END AS monthly_mrr
  FROM subs
),

-- Identify upgrade cancellations: canceled subscription where same customer
-- created a new subscription within 5 minutes
upgrade_canceled_sub_ids AS (
  SELECT DISTINCT
    old_sub.subscription_id
  FROM subs_mrr AS old_sub
  JOIN subs_mrr AS new_sub
    ON old_sub.customer_id = new_sub.customer_id
   AND old_sub.subscription_id != new_sub.subscription_id
   AND old_sub.canceled_at_ts IS NOT NULL
   AND new_sub.created_ts BETWEEN
       TIMESTAMP_SUB(old_sub.canceled_at_ts, INTERVAL 5 MINUTE)
       AND TIMESTAMP_ADD(old_sub.canceled_at_ts, INTERVAL 5 MINUTE)
),

-- Identify upgrade created subscriptions: new subscription created within 5 minutes
-- of a canceled subscription for the same customer
upgrade_created_sub_ids AS (
  SELECT DISTINCT
    new_sub.subscription_id
  FROM subs_mrr AS old_sub
  JOIN subs_mrr AS new_sub
    ON old_sub.customer_id = new_sub.customer_id
   AND old_sub.subscription_id != new_sub.subscription_id
   AND old_sub.canceled_at_ts IS NOT NULL
   AND new_sub.created_ts BETWEEN
       TIMESTAMP_SUB(old_sub.canceled_at_ts, INTERVAL 5 MINUTE)
       AND TIMESTAMP_ADD(old_sub.canceled_at_ts, INTERVAL 5 MINUTE)
),

-- customer is "active & paying" at month-end (gross snapshot)
customer_active_eom AS (
  SELECT
    b.month_start AS month,
    s.customer_id
  FROM month_bounds b
  JOIN subs_mrr s
    ON s.created_ts < b.next_month_start_ts
   AND (s.canceled_at_ts IS NULL OR s.canceled_at_ts >= b.next_month_start_ts)
  WHERE s.monthly_mrr > 0
  GROUP BY 1, 2
),

-- active paid users at EOM
active_users AS (
  SELECT
    month,
    COUNT(DISTINCT customer_id) AS active_paid_users_eom
  FROM customer_active_eom
  GROUP BY 1
),

-- New paid users: created in this month, excluding upgrade subscriptions
new_users_by_month AS (
  SELECT
    b.month_start AS month,
    COUNT(DISTINCT s.customer_id) AS new_paid_users_eom
  FROM month_bounds b
  JOIN subs_mrr s
    ON s.created_ts >= b.month_start_ts
   AND s.created_ts < b.next_month_start_ts
   AND s.monthly_mrr > 0
  LEFT JOIN upgrade_created_sub_ids u
    ON u.subscription_id = s.subscription_id
  WHERE u.subscription_id IS NULL  -- Exclude upgrade subscriptions
  GROUP BY 1
),

-- Churned paid users: canceled in this month, excluding upgrade cancellations
churn_users_by_month AS (
  SELECT
    b.month_start AS month,
    COUNT(DISTINCT s.customer_id) AS churned_paid_users_eom
  FROM month_bounds b
  JOIN subs_mrr s
    ON s.canceled_at_ts >= b.month_start_ts
   AND s.canceled_at_ts < b.next_month_start_ts
   AND s.monthly_mrr > 0
  LEFT JOIN upgrade_canceled_sub_ids u
    ON u.subscription_id = s.subscription_id
  WHERE u.subscription_id IS NULL  -- Exclude upgrade cancellations
  GROUP BY 1
),

-- stitch all together
final AS (
  SELECT
    b.month_start AS month,
    IFNULL(a.active_paid_users_eom, 0) AS active_paid_users_eom,
    IFNULL(n.new_paid_users_eom, 0)    AS new_paid_users_eom,
    IFNULL(c.churned_paid_users_eom, 0) AS churned_paid_users_eom
  FROM month_bounds b
  LEFT JOIN active_users a ON a.month = b.month_start
  LEFT JOIN new_users_by_month n ON n.month = b.month_start
  LEFT JOIN churn_users_by_month c ON c.month = b.month_start
)

SELECT
  month,
  active_paid_users_eom,
  new_paid_users_eom,
  churned_paid_users_eom,

  -- prev month active users
  LAG(active_paid_users_eom) OVER (ORDER BY month) AS prev_active_paid_users_eom,

  -- rates based on prev month active
  SAFE_DIVIDE(new_paid_users_eom,
              LAG(active_paid_users_eom) OVER (ORDER BY month)) AS growth_rate,
  SAFE_DIVIDE(churned_paid_users_eom,
              LAG(active_paid_users_eom) OVER (ORDER BY month)) AS churn_rate
FROM final
ORDER BY month;
