import { NextResponse } from 'next/server';
import { getBigQueryClient } from '../../lib/bigquery';
import { loadSQL } from '../../lib/sql';

export const runtime = 'nodejs';

const PIE_SQL = loadSQL('pie.sql');

export async function GET() {
  try {
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({ query: PIE_SQL, location: 'US' });
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('Error querying BigQuery (pie) [app router]:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
