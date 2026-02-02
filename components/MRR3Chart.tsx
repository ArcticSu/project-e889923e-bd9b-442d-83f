import React from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

function parseMonth(m: string) {
  try {
    if (/^\d{4}-\d{2}$/.test(m)) return new Date(`${m}-01T00:00:00Z`);
    return new Date(m);
  } catch {
    return new Date(m);
  }
}

function formatMonth(m: string) {
  const d = parseMonth(m);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export default function MRR3Chart({ data }: { data: any[] }) {
  const sorted = (data || []).slice().sort((a, b) => parseMonth(a.month).getTime() - parseMonth(b.month).getTime()).map(r => ({
    month: formatMonth(r.month),
    gross: Number(r.gross || r.gross_mrr_amount || 0),
    delinquent: Number(r.delinquent || r.delinquent_mrr_amount || 0),
    collectible: Number(r.collectible || r.collectible_mrr_amount || 0),
  }));

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-2">MRR Trend (6 months)</h3>
      <div style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart data={sorted} margin={{ top: 8, right: 24, left: 12, bottom: 8 }}>
            <CartesianGrid strokeDasharray="6 6" stroke="#eef2f7" />
            <XAxis dataKey="month" tick={{ fill: '#374151' }} />
            <YAxis tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(value: number, name: string) => [`$${Number(value).toFixed(2)}`, name]} />
            <Legend />

            {/* Gross as area (bottom) */}
            <Area type="monotone" dataKey="gross" stackId="a" fill="#bfdbfe" stroke="#60a5fa" fillOpacity={0.9} />

            {/* Collectible as primary solid line on top */}
            <Line type="monotone" dataKey="collectible" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4 }} name="collectible" />

            {/* Delinquent as dashed line */}
            <Line type="monotone" dataKey="delinquent" stroke="#3b82f6" strokeWidth={2} dot={false} strokeDasharray="6 6" name="delinquent" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
