import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { getBigQueryClient } from './lib/bigquery';

function loadSQL(name: string) {
  const p = path.join(process.cwd(), 'sql', name);
  return fs.readFileSync(p, 'utf8');
}

const PIE_SQL = loadSQL('pie.sql');

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({ query: PIE_SQL, location: 'US' });
    res.status(200).json(rows);
  } catch (err: any) {
    console.error('Error querying BigQuery (pie):', err);
    res.status(500).json({ error: err.message });
  }
}
