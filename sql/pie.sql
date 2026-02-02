WITH subs AS (
  SELECT
    subscription_id,
    customer_id,
    status,
    created_ts,
    canceled_at_ts
  FROM `project-e889923e-bd9b-442d-83f.stripe_test.stripe_subscriptions`
),

upgrade_canceled AS (
  -- 旧订阅是 canceled，且同 customer 在 canceled_at 前后 5 分钟内创建了新订阅 => 视为 upgrade cancel
  SELECT DISTINCT
    old_sub.subscription_id
  FROM subs AS old_sub
  JOIN subs AS new_sub
    ON old_sub.customer_id = new_sub.customer_id
   AND old_sub.subscription_id != new_sub.subscription_id
   AND old_sub.status = 'canceled'
   AND old_sub.canceled_at_ts IS NOT NULL
   AND new_sub.created_ts BETWEEN
       TIMESTAMP_SUB(old_sub.canceled_at_ts, INTERVAL 5 MINUTE)
       AND TIMESTAMP_ADD(old_sub.canceled_at_ts, INTERVAL 5 MINUTE)
),

subs_labeled AS (
  SELECT
    customer_id,
    subscription_id,
    created_ts,
    CASE
      WHEN status = 'canceled'
       AND subscription_id IN (SELECT subscription_id FROM upgrade_canceled)
      THEN 'active'
      ELSE status
    END AS status_effective
  FROM subs
),

customer_one_status AS (
  -- 每个 customer 只选一个“最终状态”
  -- 规则：优先 active，其次 trialing / past_due / unpaid / incomplete / incomplete_expired，最后 canceled
  SELECT
    customer_id,
    status_effective
  FROM subs_labeled
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_id
    ORDER BY
      CASE status_effective
        WHEN 'active' THEN 1
        WHEN 'trialing' THEN 2
        WHEN 'past_due' THEN 3
        WHEN 'unpaid' THEN 4
        WHEN 'incomplete' THEN 5
        WHEN 'incomplete_expired' THEN 6
        WHEN 'canceled' THEN 7
        ELSE 99
      END,
      created_ts DESC
  ) = 1
)

SELECT
  status_effective AS status,
  COUNT(*) AS cnt
FROM customer_one_status
GROUP BY status
ORDER BY cnt DESC;
