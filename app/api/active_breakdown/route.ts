import { NextResponse } from 'next/server';
import { getBigQueryClient } from '../../lib/bigquery';
import { loadSQL } from '../../lib/sql';

export const runtime = 'nodejs';

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
