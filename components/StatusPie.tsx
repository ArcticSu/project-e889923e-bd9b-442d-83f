import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = ['#10b981', '#60a5fa', '#f59e0b', '#ef4444', '#a78bfa', '#06b6d4'];

export default function StatusPie({ data }: { data: { status: string; cnt: number }[] }) {
  const chartData = (data || []).map(d => ({ name: d.status, value: Number(d.cnt) }));
  const total = chartData.reduce((s, c) => s + (c.value || 0), 0) || 1;

  return (
    <div className="card mt-2">
      <div className="flex justify-between items-start">
        <div>
          <h4 className="text-xl font-semibold">User Subscription Status</h4>
          <div className="text-sm text-gray-500">Distribution by status</div>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center">
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                dataKey="value"
                data={chartData}
                innerRadius={70}
                outerRadius={100}
                paddingAngle={6}
                startAngle={90}
                endAngle={-270}
                cornerRadius={8}
              >
                {chartData.map((entry, idx) => (
                  <Cell key={`c-${idx}`} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v}`, 'count']} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="w-full mt-3 grid grid-cols-2 gap-2 text-sm">
          {chartData.map((c, i) => {
            const pct = total ? Math.round((c.value / total) * 100) : 0;
            return (
              <div key={c.name} className="flex items-center gap-3">
                <span style={{ width: 12, height: 12, background: COLORS[i % COLORS.length], borderRadius: 4, display: 'inline-block' }} />
                <div className="flex-1 text-gray-700">{c.name}</div>
                <div className="font-medium">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
