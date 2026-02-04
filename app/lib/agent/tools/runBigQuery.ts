/**
 * Tool: runBigQuery — run read-only BigQuery SQL (SELECT only), return columns + rows.
 * Uses existing BigQuery client (BIGQUERY_SA_BASE64 or BIGQUERY_PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getBigQueryClient } from '../../bigquery';

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i;

export const runBigQueryTool = tool({
  description:
    'Run a BigQuery Standard SQL query (SELECT only). Use this to fetch MRR, subscriptions, or any analytics data. Think about the business question first; use LIMIT for large tables. Results are for analysis and insights, not to dump raw to the user. **For user behavior analysis**: After this tool completes, you MUST call generateHtmlReport. Do NOT stop after runBigQuery.',
  inputSchema: z.object({
    sql: z.string().describe('Valid BigQuery Standard SQL SELECT statement'),
    dryRun: z.boolean().optional().describe('If true, only validate the query without executing'),
    limit: z.number().min(1).max(500).optional().default(200).describe('Max rows to return (default 200)'),
  }),
  execute: async ({ sql, dryRun, limit = 200 }) => {
    const trimmed = sql.trim();
    console.log('[runBigQuery] input', { sqlPreview: trimmed.slice(0, 120) + (trimmed.length > 120 ? '...' : ''), dryRun, limit });

    if (!process.env.BIGQUERY_SA_BASE64) {
      console.error('[runBigQuery] BIGQUERY_SA_BASE64 is not set');
      return { error: 'BigQuery is not configured: BIGQUERY_SA_BASE64 is missing. Set it in .env.local (see README).' };
    }

    if (FORBIDDEN.test(trimmed)) {
      console.warn('[runBigQuery] rejected: forbidden keyword');
      return {
        error: 'Only SELECT queries are allowed. INSERT, UPDATE, DELETE, DROP, ALTER, CREATE are forbidden.',
      };
    }
    const lower = trimmed.toLowerCase();
    if (!lower.startsWith('select') && !lower.startsWith('with')) {
      console.warn('[runBigQuery] rejected: not SELECT/WITH');
      return { error: 'Only SELECT or WITH (... SELECT) statements are allowed.' };
    }

    try {
      const bigquery = getBigQueryClient();
      if (dryRun) {
        const [job] = await bigquery.createQueryJob({ query: trimmed, dryRun: true });
        const [metadata] = await job.getMetadata();
        const stats = (metadata as { statistics?: { totalBytesProcessed?: string } }).statistics;
        return {
          columns: [],
          rows: [],
          jobId: job.id,
          bytesProcessed: stats?.totalBytesProcessed,
        };
      }

      const [rows] = await bigquery.query({ query: trimmed, location: 'US' });
      const raw = (rows as Record<string, unknown>[]).slice(0, limit);
      const columns = raw.length > 0 ? Object.keys(raw[0]) : [];
      const rowArrays = raw.map((r) => columns.map((c) => r[c]));

      console.log('[runBigQuery] success', { rowCount: rowArrays.length, columns: columns.length });
      const out: { columns: string[]; rows: unknown[][]; bytesProcessed?: string; emptyMessage?: string } = {
        columns,
        rows: rowArrays,
      };
      if (rowArrays.length === 0) {
        out.emptyMessage = 'Query returned 0 rows. No records for the given criteria or period. Tell the user clearly (e.g. "No records found").';
      }
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[runBigQuery] error', message, err);
      return { error: `BigQuery failed: ${message}` };
    }
  },
});
