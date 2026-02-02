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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const months = parseInt(String(req.query.months || '6'), 10) || 6;
    const [rows] = await bigquery.query({ query: HISTORICAL_SQL, location: 'US' });

    const sliced = (rows as any[]).slice(0, months).reverse().map(r => ({
      month: r.month && r.month.value ? r.month.value : r.month,
      gross: Number(r.gross_mrr_amount || 0),
      delinquent: Number(r.delinquent_mrr_amount || 0),
      collectible: Number(r.collectible_mrr_amount || 0)
    }));

    res.status(200).json(sliced);
  } catch (err: any) {
    console.error('Error querying BigQuery (history):', err);
    res.status(500).json({ error: err.message });
  }
}
