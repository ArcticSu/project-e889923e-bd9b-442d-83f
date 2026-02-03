/**
 * Tool: generateHtmlReport — produce an HTML insight report (no <script>).
 * Structure: TL;DR, KPI cards, Insights (what/why/so what/now what), risks, next steps.
 */

import { tool } from 'ai';
import { z } from 'zod';

const reportCellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const reportRowSchema = z.array(reportCellValue);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tableHtml(title: string, columns: string[], rows: unknown[][]): string {
  const head = columns.map((c) => `<th>${escapeHtml(String(c))}</th>`).join('');
  const body = rows
    .slice(0, 20)
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('')}</tr>`
    )
    .join('');
  return `
  <div class="report-section">
    <h3>${escapeHtml(title)}</h3>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </div>`;
}

export const generateHtmlReportTool = tool({
  description:
    'Generate an HTML insight report. For user behavior analysis: use after runBigQuery only (set charts to empty array). For dashboard metrics: use after runBigQuery and generateEchartsOption. All fields except topic are optional but should be provided with meaningful content when available. Do not include <script>.',
  inputSchema: z.object({
    topic: z.string().describe('Report topic / title (REQUIRED)'),
    keyFindings: z.array(z.string()).optional().default([]).describe('Bullet key findings from the data (optional, defaults to empty array)'),
    executiveSummary: z.string().optional().default('').describe('1–2 sentences summarizing the main result (optional)'),
    keyMetricsText: z.string().optional().default('').describe('Short paragraph highlighting main KPIs and numbers from the data (optional)'),
    insightsWhat: z.string().optional().default('').describe('What happened: describe the main trends or changes with numbers (optional)'),
    insightsWhy: z.string().optional().default('').describe('Why it happened: possible drivers (optional)'),
    insightsSoWhat: z.string().optional().default('').describe('So what: business impact (optional)'),
    insightsNowWhat: z.string().optional().default('').describe('Now what: recommended next actions (optional)'),
    risksText: z.string().optional().default('').describe('Risks & data limitations (optional)'),
    nextStepsText: z.string().optional().default('').describe('Concrete recommendations (optional)'),
    dataSnippets: z
      .array(
        z.object({
          title: z.string(),
          columns: z.array(z.string()),
          rows: z.array(reportRowSchema),
        })
      )
      .optional()
      .default([])
      .describe('Array of data tables to include in the report (optional, defaults to empty array)'),
    charts: z
      .array(z.object({ title: z.string(), option: z.record(z.any()) }))
      .optional()
      .default([])
      .describe('Array of charts to reference in the report. For user behavior analysis, set to empty array [] (optional, defaults to empty array)'),
  }),
  execute: async ({
    topic,
    keyFindings = [],
    executiveSummary,
    keyMetricsText,
    insightsWhat,
    insightsWhy,
    insightsSoWhat,
    insightsNowWhat,
    risksText,
    nextStepsText,
    dataSnippets = [],
    charts = [],
  }) => {
    console.log('[generateHtmlReport] input', { topic: topic.slice(0, 60), dataSnippetsCount: dataSnippets.length, chartsCount: charts.length });
    const sections: string[] = [];

    const summaryContent = executiveSummary?.trim() || topic;
    sections.push(`
  <div class="report-section report-tldr">
    <h2>Executive Summary</h2>
    <p>${escapeHtml(summaryContent)}</p>
    ${keyFindings.length ? `<ul>${keyFindings.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
  </div>`);

    sections.push(`
  <div class="report-section">
    <h2>Key Metrics</h2>
    ${keyMetricsText?.trim() ? `<p>${escapeHtml(keyMetricsText)}</p>` : '<p class="report-muted">Key metrics from the data above.</p>'}
  </div>`);

    sections.push(`
  <div class="report-section">
    <h2>Insights</h2>
    <h3>What happened</h3>
    <p>${insightsWhat?.trim() ? escapeHtml(insightsWhat) : '<span class="report-muted">Main trends from the data.</span>'}</p>
    <h3>Why it happened</h3>
    <p>${insightsWhy?.trim() ? escapeHtml(insightsWhy) : '<span class="report-muted">Possible drivers.</span>'}</p>
    <h3>So what</h3>
    <p>${insightsSoWhat?.trim() ? escapeHtml(insightsSoWhat) : '<span class="report-muted">Business impact.</span>'}</p>
    <h3>Now what</h3>
    <p>${insightsNowWhat?.trim() ? escapeHtml(insightsNowWhat) : '<span class="report-muted">Recommended next actions.</span>'}</p>
  </div>`);

    for (const snip of dataSnippets) {
      sections.push(tableHtml(snip.title, snip.columns, snip.rows));
    }

    if (charts.length > 0) {
      sections.push(`
  <div class="report-section">
    <h2>Charts</h2>
    ${charts.map((c) => `<h3>${escapeHtml(c.title)}</h3><p class="report-muted">(Chart rendered in chat)</p>`).join('')}
  </div>`);
    }

    sections.push(`
  <div class="report-section">
    <h2>Risks & Data Limitations</h2>
    <p>${risksText?.trim() ? escapeHtml(risksText) : '<span class="report-muted">Consider data scope and quality.</span>'}</p>
  </div>`);

    sections.push(`
  <div class="report-section">
    <h2>Next Steps</h2>
    <p>${nextStepsText?.trim() ? escapeHtml(nextStepsText) : '<span class="report-muted">Concrete recommendations.</span>'}</p>
  </div>`);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(topic)}</title>
  <style>
    .report-body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1a1a1a; }
    .report-section { margin-bottom: 28px; }
    .report-section h2 { font-size: 1.25rem; margin-bottom: 12px; color: #111; }
    .report-section h3 { font-size: 1rem; margin: 16px 0 8px; color: #333; }
    .report-muted { color: #666; font-size: 0.95rem; }
    .report-tldr { background: #f8f9fa; padding: 16px; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { border: 1px solid #dee2e6; padding: 8px 12px; text-align: left; }
    th { background: #f1f3f5; font-weight: 600; }
  </style>
</head>
<body class="report-body">
${sections.join('')}
</body>
</html>`;

    return { html };
  },
});
