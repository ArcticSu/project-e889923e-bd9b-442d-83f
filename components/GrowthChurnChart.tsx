import React from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

export default function GrowthChurnChart({ data }: { data: any[] }) {
  if (!data || data.length === 0) return null;

  const sorted = [...data].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
  const chartData = sorted.map((d) => ({
    month: (d.month || '').toString().slice(0, 7),
    growth_rate: d.growth_rate != null ? Number(d.growth_rate) : 0,
    churn_rate: d.churn_rate != null ? Number(d.churn_rate) : 0,
    active_paid_users_eom: d.active_paid_users_eom || 0,
  }));

  const formatPct = (val: any) => {
    if (val == null) return '-';
    return `${(Number(val) * 100).toFixed(1)}%`;
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mt-2">
      <div className="text-lg text-gray-700 font-semibold mb-3">User Growth vs Churn</div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="month" 
              tick={{ fontSize: 12, fill: '#6b7280' }}
              stroke="#9ca3af"
            />
            <YAxis 
              yAxisId="left" 
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              stroke="#9ca3af"
              label={{ value: 'Rate (%)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: '#6b7280', fontSize: 12 } }}
            />
            <YAxis 
              yAxisId="right" 
              orientation="right"
              tick={{ fontSize: 12, fill: '#6b7280' }}
              stroke="#9ca3af"
              label={{ value: 'Users', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: '#6b7280', fontSize: 12 } }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                padding: '8px 12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
              formatter={(value: any, name: string) => {
                if (name === 'Active Paid Users (EOM)') {
                  return [value, name];
                }
                return [formatPct(value), name];
              }}
              labelStyle={{ fontWeight: 600, marginBottom: '4px', color: '#374151' }}
            />
            <Legend 
              wrapperStyle={{ paddingTop: '10px' }}
              iconType="line"
            />
            {/* 先渲染柱状图（在后面），再渲染折线（在前面） */}
            <Bar 
              yAxisId="right" 
              dataKey="active_paid_users_eom" 
              name="Active Paid Users (EOM)" 
              fill="#60a5fa" 
              fillOpacity={0.6}
              barSize={32}
              radius={[4, 4, 0, 0]}
            />
            <Line 
              yAxisId="left" 
              type="monotone" 
              dataKey="growth_rate" 
              name="Growth Rate" 
              stroke="#10b981" 
              strokeWidth={3}
              dot={{ r: 5, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
              activeDot={{ r: 7 }}
            />
            <Line 
              yAxisId="left" 
              type="monotone" 
              dataKey="churn_rate" 
              name="Churn Rate" 
              stroke="#f97316" 
              strokeWidth={3}
              dot={{ r: 5, fill: '#f97316', strokeWidth: 2, stroke: '#fff' }}
              activeDot={{ r: 7 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
