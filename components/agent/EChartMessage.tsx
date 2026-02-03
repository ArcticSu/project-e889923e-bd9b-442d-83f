'use client';

import React from 'react';
import ReactECharts from 'echarts-for-react';

export function EChartMessage({
  option,
  explain,
}: {
  option: Record<string, unknown>;
  explain?: string;
}) {
  if (!option || Object.keys(option).length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-500">{explain ?? 'No chart data.'}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="h-[320px] w-full min-w-[280px]">
        <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />
      </div>
      {explain && (
        <p className="mt-3 text-sm text-gray-600">{explain}</p>
      )}
    </div>
  );
}
