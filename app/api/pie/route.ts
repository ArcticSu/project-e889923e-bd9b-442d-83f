import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getBigQueryClient } from '../../lib/bigquery';

export const runtime = 'nodejs';

function loadSQL(name: string) {
  const p = path.join(process.cwd(), 'sql', name);
  return fs.readFileSync(p, 'utf8');
}

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
