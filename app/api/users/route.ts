import { NextResponse } from 'next/server';
import { getBigQueryClient } from '../../lib/bigquery';
import { loadSQL } from '../../lib/sql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERS_SQL = loadSQL('users_list.sql');

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const delinquent = url.searchParams.get('delinquent');
    const search = url.searchParams.get('search');

    const bigquery = getBigQueryClient();
    let query = USERS_SQL;

    // Apply filters (client-side filtering for simplicity, or we can modify SQL)
    const [rows] = await bigquery.query({ query, location: 'US' });
    
    let filtered = (rows as any[]).map(r => ({
      customer_id: r.customer_id || '',
      email: r.email || '',
      customer_created_ts: r.customer_created_ts?.value || r.customer_created_ts,
      is_delinquent: r.is_delinquent || false,
      subscription_status: r.subscription_status || 'none',
      price_amount: r.price_amount != null ? Number(r.price_amount) : null,
      price_interval: r.price_interval || null,
      quantity: r.quantity != null ? Number(r.quantity) : 1,
      subscription_created_ts: r.subscription_created_ts?.value || r.subscription_created_ts,
      subscription_canceled_ts: r.subscription_canceled_ts?.value || r.subscription_canceled_ts,
      current_period_start_ts: r.current_period_start_ts?.value || r.current_period_start_ts,
      current_period_end_ts: r.current_period_end_ts?.value || r.current_period_end_ts,
      currency: r.currency || 'usd',
      max_delinquency_days: Number(r.max_delinquency_days || 0),
      unpaid_invoice_count: Number(r.unpaid_invoice_count || 0),
    }));

    // Apply filters
    if (status && status !== 'all') {
      filtered = filtered.filter(r => r.subscription_status === status);
    }
    if (delinquent === 'true') {
      filtered = filtered.filter(r => r.is_delinquent || r.unpaid_invoice_count > 0);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(r => 
        (r.email && r.email.toLowerCase().includes(searchLower)) ||
        (r.customer_id && r.customer_id.toLowerCase().includes(searchLower))
      );
    }

    return NextResponse.json(filtered);
  } catch (err: any) {
    console.error('Error querying BigQuery (users) [app router]:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
