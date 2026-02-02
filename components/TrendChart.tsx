import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

function parseMonth(m: string) {
  // expect YYYY-MM or full ISO date; make a Date at first of month
  try {
    if (/^\d{4}-\d{2}$/.test(m)) return new Date(`${m}-01T00:00:00Z`);
    return new Date(m);
  } catch {
    return new Date(m);
  }
}

function formatMonthLabel(m: string) {
  const d = parseMonth(m);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`; // e.g. "2025-01"
}

const CustomDot = (props: any) => {
  const { cx, cy, stroke } = props;
  return (
    <circle cx={cx} cy={cy} r={5} stroke={stroke} strokeWidth={2} fill="#fff" />
  );
};

export default function TrendChart({ data }: { data: { month: string; mrr_amount: number }[] }) {
  // sort ascending by month date to ensure left->right is earliest->latest
  const sorted = [...data].sort((a, b) => parseMonth(a.month).getTime() - parseMonth(b.month).getTime());
  const chartData = sorted.map(d => ({ month: d.month, mrr: d.mrr_amount }));

  return (
    <div style={{ background: '#fff', padding: 18, borderRadius: 10, boxShadow: '0 4px 12px rgba(15,23,42,0.06)' }}>
      <h3 style={{ marginTop: 0 }}>MRR Trend (6 months)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 10, right: 16, left: 6, bottom: 6 }}>
          <CartesianGrid strokeDasharray="6 6" stroke="#e6e6e6" />
          <XAxis
            dataKey="month"
            tickFormatter={(v) => formatMonthLabel(String(v))}
            tick={{ fill: '#374151' }}
            axisLine={{ stroke: '#cbd5e1' }}
          />
          <YAxis tickFormatter={(v) => `$${Number(v).toFixed(0)}`} tick={{ fill: '#374151' }} axisLine={false} />
          <Tooltip
            formatter={(value: number) => [`$${Number(value).toFixed(2)}`, 'MRR']}
            labelFormatter={(label) => formatMonthLabel(String(label))}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
          />
          <Line
            type="monotone"
            dataKey="mrr"
            stroke="#0ea5e9"
            strokeWidth={3}
            dot={<CustomDot stroke="#0ea5e9" />}
            activeDot={{ r: 6, stroke: '#0284c7', strokeWidth: 3, fill: '#fff' }}
            animationDuration={800}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
