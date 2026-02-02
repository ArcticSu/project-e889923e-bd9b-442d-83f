import { NextResponse } from 'next/server';
import { getBigQueryClient } from '../../../lib/bigquery';

export const runtime = 'nodejs';

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

export async function GET() {
  try {
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({ query: CURRENT_SQL, location: 'US' });
    const r = (rows as any[])[0] || {};
    return NextResponse.json({
      current_live_mrr: Number(r.current_live_mrr) || 0,
      active_subscription_count: Number(r.active_subscription_count) || 0
    });
  } catch (err: any) {
    console.error('Error querying BigQuery (current) [app router]:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
