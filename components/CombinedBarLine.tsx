import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';

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

export default function CombinedBarLine({ data }: { data: any[] }) {
  const raw = (data || []).map(d => ({
    month: d.month,
    active: Number(d.active_users || 0),
    growth: d.active_mom_growth_rate == null ? null : Number((d.active_mom_growth_rate * 100).toFixed(2)),
    churn: d.churn_rate == null ? null : Number((d.churn_rate * 100).toFixed(2))
  }));

  // sort ascending by month and normalize month label to YYYY-MM
  const sorted = raw.sort((a, b) => parseMonth(a.month).getTime() - parseMonth(b.month).getTime())
    .map((r) => ({ ...r, month: formatMonth(r.month) }));

  // if first month's growth is null, set it to 0 for visual consistency
  if (sorted.length > 0 && (sorted[0].growth == null || Number.isNaN(sorted[0].growth))) {
    sorted[0].growth = 0;
  }

  // also ensure first month's churn is 0 (match active's baseline)
  if (sorted.length > 0 && (sorted[0].churn == null || Number.isNaN(sorted[0].churn))) {
    sorted[0].churn = 0;
  }

  return (
    <div className="card mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-lg font-semibold">Active Users & Rates</h4>
        <div className="text-sm text-gray-500">Monthly breakdown</div>
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={sorted} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="6 6" stroke="#eef2f7" />
            <XAxis dataKey="month" tick={{ fill: '#374151' }} />
            <YAxis yAxisId="left" tick={{ fill: '#374151' }} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fill: '#374151' }} />
            <Tooltip formatter={(v: any, name: string) => (name === 'active' ? v : `${v}%`)} />
            <Legend verticalAlign="bottom" height={36} />
            <Bar yAxisId="left" dataKey="active" barSize={24} fill="#60a5fa" radius={[8, 8, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="growth" stroke="#10b981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#10b981' }} />
            <Line yAxisId="right" type="monotone" dataKey="churn" stroke="#ef4444" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#ef4444' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
