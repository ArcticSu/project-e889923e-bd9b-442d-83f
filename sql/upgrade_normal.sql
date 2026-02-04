WITH subs AS (
  SELECT
    subscription_id,
    customer_id,
    status,
    created_ts,
    canceled_at_ts
  FROM `project-e889923e-bd9b-442d-83f.stripe_test.stripe_subscriptions`
  WHERE customer_id IS NOT NULL AND customer_id != ''
    AND subscription_id IS NOT NULL AND subscription_id != ''
),
active_customers AS (
  SELECT DISTINCT customer_id
  FROM subs
  WHERE (canceled_at_ts IS NULL OR canceled_at_ts > CURRENT_TIMESTAMP())
    AND created_ts <= CURRENT_TIMESTAMP()
    AND status IN ('active', 'past_due')
),
upgrade_customers AS (
  SELECT DISTINCT old_sub.customer_id
  FROM subs old_sub
  JOIN subs new_sub
    ON old_sub.customer_id = new_sub.customer_id
   AND old_sub.subscription_id != new_sub.subscription_id
  WHERE old_sub.status = 'canceled'
    AND old_sub.canceled_at_ts IS NOT NULL
    AND new_sub.created_ts BETWEEN
        TIMESTAMP_SUB(old_sub.canceled_at_ts, INTERVAL 5 MINUTE)
        AND TIMESTAMP_ADD(old_sub.canceled_at_ts, INTERVAL 5 MINUTE)
)
SELECT
  COUNT(DISTINCT IF(u.customer_id IS NOT NULL, a.customer_id, NULL)) AS active_upgrade_users,
  COUNT(DISTINCT IF(u.customer_id IS NULL, a.customer_id, NULL)) AS active_normal_users
FROM active_customers a
LEFT JOIN upgrade_customers u
  USING (customer_id);
