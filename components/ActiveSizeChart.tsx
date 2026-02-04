import React from 'react';

export default function ActiveSizeChart({ data }: { data: any[] }) {
  // This chart is temporarily empty as requested
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-sm text-gray-600 font-medium mb-2">Active Paid Users & Net User Change (Month-end, Gross MRR Basis)</div>
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="text-gray-400 text-sm">(Empty)</div>
      </div>
    </div>
  );
}
