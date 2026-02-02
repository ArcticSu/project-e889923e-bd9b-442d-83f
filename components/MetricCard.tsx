import React from 'react';
import { Activity } from 'lucide-react';

export default function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex items-center gap-3">
      <div className="p-2 bg-sky-100 rounded-full">
        <Activity className="text-sky-600" />
      </div>
      <div>
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
    </div>
  );
}
