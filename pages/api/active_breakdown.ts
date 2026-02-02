import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { getBigQueryClient } from './lib/bigquery';

function loadSQL(name: string) {
  const p = path.join(process.cwd(), 'sql', name);
  return fs.readFileSync(p, 'utf8');
}

const UPGRADE_SQL = loadSQL('upgrade_normal.sql');

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({ query: UPGRADE_SQL, location: 'US' });
    const r = (rows as any[])[0] || {};
    res.status(200).json({
      active_upgrade_users: Number(r.active_upgrade_users || 0),
      active_normal_users: Number(r.active_normal_users || 0)
    });
  } catch (err: any) {
    console.error('Error querying BigQuery (active_breakdown):', err);
    res.status(500).json({ error: err.message });
  }
}
