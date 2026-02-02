import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

export default function GrowthChurnChart({ data }: { data: any[] }) {
  if (!data || data.length === 0) return null;

  const sorted = [...data].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const chartData = sorted.map((d) => ({
    month: (d.month || '').toString().slice(0, 7),
    growth_rate: d.growth_rate != null ? Number(d.growth_rate) : 0,
    churn_rate: d.churn_rate != null ? Number(d.churn_rate) : 0,
  }));

  const formatPct = (val: any) => {
    if (val == null) return '-';
    return `${(Number(val) * 100).toFixed(1)}%`;
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mt-6">
      <div className="text-sm text-gray-600 font-medium mb-2">Growth Rate vs Churn Rate</div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
            <Tooltip formatter={(value: any) => formatPct(value)} />
            <Legend />
            <Line type="monotone" dataKey="growth_rate" name="Growth Rate" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="churn_rate" name="Churn Rate" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
