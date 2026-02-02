import { NextApiRequest, NextApiResponse } from 'next';
import { BigQuery } from '@google-cloud/bigquery';
import fs from 'fs';
import path from 'path';

const bigquery = new BigQuery();

function loadSQL(name: string) {
  const p = path.join(process.cwd(), 'sql', name);
  return fs.readFileSync(p, 'utf8');
}

const HISTORICAL_SQL = loadSQL('mrr_3col.sql');
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const months = parseInt(String(req.query.months || '6'), 10) || 6;
    const [histRows] = await bigquery.query({ query: HISTORICAL_SQL, location: 'US' });
    const [curRows] = await bigquery.query({ query: CURRENT_SQL, location: 'US' });

    const history = (histRows as any[]).slice(0, months).reverse().map(r => ({
      month: r.month && r.month.value ? r.month.value : r.month,
      gross: Number(r.gross_mrr_amount || 0),
      delinquent: Number(r.delinquent_mrr_amount || 0),
      collectible: Number(r.collectible_mrr_amount || 0)
    }));

    const cur = (curRows as any[])[0] || {};
    const current = {
      current_live_mrr: Number(cur.current_live_mrr) || 0,
      active_subscription_count: Number(cur.active_subscription_count) || 0
    };

    res.status(200).json({ history, current });
  } catch (err: any) {
    console.error('Error querying BigQuery (mrr):', err);
    res.status(500).json({ error: err.message });
  }
}
