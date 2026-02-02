import { NextApiRequest, NextApiResponse } from 'next';
import { getBigQueryClient } from '../lib/bigquery';

const CURRENT_SQL = `
SELECT
  ROUND(SUM(
    CASE
      WHEN price_interval = 'year' THEN (price_amount * quantity / 100.0) / 12.0
      ELSE (price_amount * quantity / 100.0)
    END
  ), 2) AS current_live_mrr,
  COUNT(DISTINCT customer_id) AS active_subscription_count
FROM ` + "`stripe_test.stripe_subscriptions`" + `
WHERE status IN ('active', 'past_due')
`;

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({ query: CURRENT_SQL, location: 'US' });
    const r = (rows as any[])[0] || {};
    res.status(200).json({
      current_live_mrr: Number(r.current_live_mrr) || 0,
      active_subscription_count: Number(r.active_subscription_count) || 0
    });
  } catch (err: any) {
    console.error('Error querying BigQuery (current):', err);
    res.status(500).json({ error: err.message });
  }
}
