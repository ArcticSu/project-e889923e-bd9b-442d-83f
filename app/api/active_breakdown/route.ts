import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getBigQueryClient } from '../../lib/bigquery';

export const runtime = 'nodejs';

function loadSQL(name: string) {
  const p = path.join(process.cwd(), 'sql', name);
  return fs.readFileSync(p, 'utf8');
}

const UPGRADE_SQL = loadSQL('upgrade_normal.sql');

export async function GET() {
  try {
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({ query: UPGRADE_SQL, location: 'US' });
    const r = (rows as any[])[0] || {};
    return NextResponse.json({
      active_upgrade_users: Number(r.active_upgrade_users || 0),
      active_normal_users: Number(r.active_normal_users || 0)
    });
  } catch (err: any) {
    console.error('Error querying BigQuery (active_breakdown) [app router]:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
