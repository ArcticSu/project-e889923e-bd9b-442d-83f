/**
 * Tool: callDashboardAPI — call dashboard API endpoints instead of writing SQL.
 * This ensures consistency with the dashboard and uses the exact same SQL logic.
 */

import { tool } from 'ai';
import { z } from 'zod';

const DASHBOARD_APIS = {
  'active_breakdown': {
    endpoint: '/api/active_breakdown',
    description: 'Get active user breakdown (normal vs upgrade users)',
    returns: { active_upgrade_users: 'number', active_normal_users: 'number' }
  },
  'combined': {
    endpoint: '/api/combined',
    description: 'Get growth & churn rate data (monthly)',
    returns: 'Array of { month, active_paid_users_eom, new_paid_users_eom, churned_paid_users_eom, growth_rate, churn_rate }'
  },
  'mrr': {
    endpoint: '/api/mrr',
    description: 'Get MRR history (gross, delinquent, collectible)',
    returns: '{ history: Array of { month, gross, delinquent, collectible }, current: { current_live_mrr, active_subscription_count } }'
  },
  'pie': {
    endpoint: '/api/pie',
    description: 'Get subscription status distribution',
    returns: 'Array of { status, cnt }'
  },
  'users': {
    endpoint: '/api/users',
    description: 'Get user list with filters',
    returns: 'Array of user objects'
  }
} as const;

export const callDashboardAPITool = tool({
  description: `Call dashboard API endpoints to get pre-computed metrics. **MANDATORY for dashboard metrics** - Use this INSTEAD of runBigQuery.

Available APIs:
- active_breakdown: For "active breakdown", "active user breakdown", "upgrade users", "normal users", "how many normal/upgrade"
- combined: For "growth rate", "churn rate", "user growth", "active paid users"
- mrr: For "MRR history", "gross MRR", "delinquent MRR", "collectible MRR"
- pie: For "subscription status", "status distribution", "pie chart"
- users: For "user list", "customers", "user details"

**CRITICAL**: If user asks about "active breakdown", "MRR", "growth rate", "churn rate", or "subscription status", you MUST use this tool. Do NOT use runBigQuery for these.`,
  inputSchema: z.object({
    api: z.enum(['active_breakdown', 'combined', 'mrr', 'pie', 'users']).describe('Which dashboard API to call'),
    params: z.record(z.string()).optional().describe('Optional query parameters (e.g., { status: "active", search: "email@example.com" } for users API)'),
  }),
  execute: async ({ api, params = {} }) => {
    const apiConfig = DASHBOARD_APIS[api];
    if (!apiConfig) {
      return { error: `Unknown API: ${api}` };
    }

    try {
      // Build URL with query params
      const queryString = Object.keys(params).length > 0 
        ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString()
        : '';
      
      // In Next.js server-side, we need to construct absolute URL
      // Use VERCEL_URL in production, or localhost in development
      const host = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      const fullUrl = `${host}${apiConfig.endpoint}${queryString}`;

      console.log(`[callDashboardAPI] calling ${fullUrl}`);
      const response = await fetch(fullUrl, {
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { error: `API call failed: ${response.status} ${errorText}` };
      }

      const data = await response.json();
      
      // Format response for agent
      return {
        success: true,
        api: api,
        description: apiConfig.description,
        data: data,
        // For chart generation, provide columns and rows format
        columns: api === 'active_breakdown' 
          ? ['active_upgrade_users', 'active_normal_users']
          : api === 'combined'
          ? ['month', 'active_paid_users_eom', 'new_paid_users_eom', 'churned_paid_users_eom', 'growth_rate', 'churn_rate']
          : api === 'mrr'
          ? ['month', 'gross', 'delinquent', 'collectible']
          : api === 'pie'
          ? ['status', 'cnt']
          : undefined,
        rows: api === 'active_breakdown'
          ? [[data.active_upgrade_users, data.active_normal_users]]
          : api === 'combined'
          ? Array.isArray(data) ? data.map((item: any) => [
              item.month, 
              item.active_paid_users_eom, 
              item.new_paid_users_eom, 
              item.churned_paid_users_eom, 
              item.growth_rate, 
              item.churn_rate
            ]) : []
          : api === 'mrr'
          ? Array.isArray(data.history) ? data.history.map((item: any) => [
              item.month, 
              item.gross, 
              item.delinquent, 
              item.collectible
            ]) : []
          : api === 'pie'
          ? Array.isArray(data) ? data.map((item: any) => [item.status, item.cnt]) : []
          : undefined,
      };
    } catch (err: any) {
      console.error(`[callDashboardAPI] error calling ${api}:`, err);
      return { error: String(err.message || err) };
    }
  },
});
