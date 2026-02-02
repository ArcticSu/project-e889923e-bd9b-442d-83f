import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';

export default function ActiveBreakdown({ upgrade, normal }: { upgrade: number; normal: number }) {
  const data = [
    {
      name: 'Active',
      normal,
      upgrade,
    },
  ];

  const total = upgrade + normal;

  return (
    <div className="bg-white rounded-lg shadow p-4 w-full">
      <div className="text-sm text-gray-500">Active Breakdown</div>
      <div className="flex items-center justify-between mt-2 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm bg-[#fff7ed] border" style={{ boxShadow: 'inset 0 0 0 6px #f97316' }} />
            <div className="text-xs text-gray-600">Normal</div>
            <div className="ml-2 font-semibold">{normal}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm bg-[#ecfeff] border" style={{ boxShadow: 'inset 0 0 0 6px #0ea5e9' }} />
            <div className="text-xs text-gray-600">Upgrade</div>
            <div className="ml-2 font-semibold">{upgrade}</div>
          </div>
        </div>
        <div className="text-xs text-gray-400">Total: <span className="font-semibold text-gray-700">{total}</span></div>
      </div>

      <div style={{ height: 96 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip formatter={(value: any) => [value, 'Count']} />
            {/* render normal first (bottom), then upgrade on top */}
            <Bar dataKey="normal" stackId="a" fill="#f97316" radius={[0, 0, 6, 6]}>
              <Cell />
            </Bar>
            <Bar dataKey="upgrade" stackId="a" fill="#0ea5e9" radius={[6, 6, 0, 0]}>
              <Cell />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
