import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { getBigQueryClient } from './lib/bigquery';

function loadSQL(name: string) {
  const p = path.join(process.cwd(), 'sql', name);
  return fs.readFileSync(p, 'utf8');
}

const COMBINED_SQL = loadSQL('combine_bar.sql');

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({ query: COMBINED_SQL, location: 'US' });
    const out = (rows as any[]).map(r => ({
      month: (r.month && r.month.value) ? r.month.value : r.month,
      active_paid_users_eom: Number(r.active_paid_users_eom || 0),
      new_paid_users_eom: Number(r.new_paid_users_eom || 0),
      churned_paid_users_eom: Number(r.churned_paid_users_eom || 0),
      prev_active_paid_users_eom: r.prev_active_paid_users_eom == null ? null : Number(r.prev_active_paid_users_eom),
      growth_rate: r.growth_rate == null ? null : Number(r.growth_rate),
      churn_rate: r.churn_rate == null ? null : Number(r.churn_rate),
      net_user_change: Number(r.net_user_change || 0)
    }));
    res.status(200).json(out);
  } catch (err: any) {
    console.error('Error querying BigQuery (combined):', err);
    res.status(500).json({ error: err.message });
  }
}
