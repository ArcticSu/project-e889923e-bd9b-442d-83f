import React from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

export default function ActiveSizeChart({ data }: { data: any[] }) {
  if (!data || data.length === 0) return null;

  const sorted = [...data].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const chartData = sorted.map((d) => ({
    month: (d.month || '').toString().slice(0, 7),
    active_paid_users_eom: d.active_paid_users_eom || 0,
    net_user_change: d.net_user_change || 0,
  }));

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-sm text-gray-600 font-medium mb-2">Active Paid Users & Net User Change (Month-end, Gross MRR Basis)</div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left" dataKey="active_paid_users_eom" name="Active Paid Users (EOM)" fill="#60a5fa" barSize={24} />
            <Line yAxisId="right" type="monotone" dataKey="net_user_change" name="Net User Change" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
