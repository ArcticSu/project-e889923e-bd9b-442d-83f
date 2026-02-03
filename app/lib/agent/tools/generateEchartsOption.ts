/**
 * Tool: generateEchartsOption — build ECharts option JSON from goal + data.
 * Backend does NOT import echarts; only outputs option object for frontend echarts.setOption().
 */

import { tool } from 'ai';
import { z } from 'zod';

function inferChartType(columns: string[], rows: unknown[][]): 'line' | 'bar' | 'pie' {
  if (columns.length < 2 || rows.length === 0) return 'bar';
  const firstCol = columns[0].toLowerCase();
  const hasTime =
    firstCol.includes('date') ||
    firstCol.includes('month') ||
    firstCol.includes('time') ||
    firstCol === 'x';
  if (hasTime && rows.length > 1) return 'line';
  if (columns.length === 2 && rows.length <= 12) return 'pie';
  return 'bar';
}

function buildLineOption(columns: string[], rows: unknown[][], goal: string) {
  const xAxisData = rows.map((r) => String(r[0]));
  const series = columns.slice(1).map((name, i) => ({
    name,
    type: 'line' as const,
    data: rows.map((r) => (typeof r[i + 1] === 'number' ? r[i + 1] : Number(r[i + 1]) || 0)),
    smooth: true,
  }));
  return {
    title: { text: goal.slice(0, 60), left: 'center' },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '15%', top: 40, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: xAxisData },
    yAxis: { type: 'value' },
    series,
  };
}

function buildBarOption(columns: string[], rows: unknown[][], goal: string) {
  const xAxisData = rows.map((r) => String(r[0]));
  const series = columns.slice(1).map((name, i) => ({
    name,
    type: 'bar' as const,
    data: rows.map((r) => (typeof r[i + 1] === 'number' ? r[i + 1] : Number(r[i + 1]) || 0)),
  }));
  return {
    title: { text: goal.slice(0, 60), left: 'center' },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '15%', top: 40, containLabel: true },
    xAxis: { type: 'category', data: xAxisData },
    yAxis: { type: 'value' },
    series,
  };
}

function buildPieOption(columns: string[], rows: unknown[][], goal: string) {
  const nameIdx = columns.length >= 2 ? 0 : -1;
  const valueIdx = columns.length >= 2 ? 1 : 0;
  const data = rows.map((r) => ({
    name: String(r[nameIdx]),
    value: typeof r[valueIdx] === 'number' ? r[valueIdx] : Number(r[valueIdx]) || 0,
  }));
  return {
    title: { text: goal.slice(0, 60), left: 'center' },
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 'left', bottom: 0 },
    series: [{ type: 'pie', radius: '60%', center: ['50%', '55%'], data }],
  };
}

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rowSchema = z.array(cellValue);

// Cache to prevent duplicate calls with identical parameters
// Use a more robust cache that persists across the request lifecycle
const callCache = new Map<string, { option: object; explain: string; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds (longer to catch duplicates in streaming)

function getCacheKey(goal: string, columns: string[], rows: unknown[][]): string {
  // Create a stable cache key
  const normalizedGoal = goal.trim().toLowerCase();
  const normalizedColumns = columns.map(c => c.trim().toLowerCase()).sort().join(',');
  const normalizedRows = JSON.stringify(rows.map(row => row.map(cell => 
    typeof cell === 'number' ? cell : String(cell).trim().toLowerCase()
  )));
  return `${normalizedGoal}|${normalizedColumns}|${normalizedRows}`;
}

// Clean up old cache entries periodically
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of callCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      callCache.delete(key);
    }
  }
}

export const generateEchartsOptionTool = tool({
  description:
    'Generate an ECharts chart option from a goal and tabular data. Use after runBigQuery when you need to visualize data. Time series → line; categories comparison → bar; share/portion → pie (use sparingly). Output is a complete option object for echarts.setOption(). IMPORTANT: Call this tool EXACTLY ONCE per report workflow. Do NOT call it multiple times with the same data. After calling this tool, proceed immediately to generateHtmlReport.',
  inputSchema: z.object({
    goal: z.string().describe('What this chart should show (e.g. "MRR trend by month")'),
    data: z.object({
      columns: z.array(z.string()).describe('Column names'),
      rows: z.array(rowSchema).describe('Rows of values; each row is an array of string/number/boolean/null'),
    }),
  }),
  execute: async ({ goal, data }) => {
    const { columns, rows } = data;
    console.log('[generateEchartsOption] input', { goal: goal.slice(0, 60), columnCount: columns?.length ?? 0, rowCount: rows?.length ?? 0 });
    if (!columns?.length || !Array.isArray(rows)) {
      console.warn('[generateEchartsOption] invalid data');
      return { option: {}, explain: 'Invalid data: need columns and rows.' };
    }

    // Clean up old cache entries
    cleanupCache();

    // Check cache for duplicate calls
    const cacheKey = getCacheKey(goal, columns, rows);
    const cached = callCache.get(cacheKey);
    if (cached) {
      console.warn('[generateEchartsOption] DUPLICATE CALL DETECTED - returning cached result', { 
        goal: goal.slice(0, 60),
        cacheKey: cacheKey.substring(0, 100)
      });
      return { option: cached.option, explain: cached.explain };
    }
    const chartType = inferChartType(columns, rows);
    let option: object;
    if (chartType === 'line') option = buildLineOption(columns, rows, goal);
    else if (chartType === 'pie') option = buildPieOption(columns, rows, goal);
    else option = buildBarOption(columns, rows, goal);

    const explain =
      chartType === 'line'
        ? `Line chart: ${goal}. X-axis: ${columns[0]}; series: ${columns.slice(1).join(', ')}.`
        : chartType === 'pie'
          ? `Pie chart: ${goal}. Segments from ${columns[0]} (values: ${columns[1] ?? 'value'}).`
          : `Bar chart: ${goal}. Categories: ${columns[0]}; values: ${columns.slice(1).join(', ')}.`;

    const result = { option, explain, timestamp: Date.now() };
    
    // Cache the result to prevent duplicate calls
    callCache.set(cacheKey, result);
    console.log('[generateEchartsOption] result cached', { goal: goal.slice(0, 60) });
    
    return { option, explain };
  },
});
