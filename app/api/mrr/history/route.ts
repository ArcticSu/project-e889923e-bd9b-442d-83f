import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getBigQueryClient } from '../../../lib/bigquery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function loadSQL(name: string) {
  const p = path.join(process.cwd(), 'sql', name);
  return fs.readFileSync(p, 'utf8');
}

const HISTORICAL_SQL = loadSQL('mrr_3col.sql');

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const months = parseInt(url.searchParams.get('months') || '6', 10) || 6;
    const bigquery = getBigQueryClient();
    const [rows] = await bigquery.query({ query: HISTORICAL_SQL, location: 'US' });

    const sliced = (rows as any[]).slice(0, months).reverse().map(r => ({
      month: r.month && r.month.value ? r.month.value : r.month,
      gross: Number(r.gross_mrr_amount || 0),
      delinquent: Number(r.delinquent_mrr_amount || 0),
      collectible: Number(r.collectible_mrr_amount || 0)
    }));

    return NextResponse.json(sliced);
  } catch (err: any) {
    console.error('Error querying BigQuery (history) [app router]:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
