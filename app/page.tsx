"use client";
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import axios from 'axios';
import TrendChart from '../components/TrendChart';
import MRR3Chart from '../components/MRR3Chart';
import ActiveBreakdown from '../components/ActiveBreakdown';
import MetricCard from '../components/MetricCard';
import StatusPie from '../components/StatusPie';
import ActiveSizeChart from '../components/ActiveSizeChart';
import GrowthChurnChart from '../components/GrowthChurnChart';

type HistoryRow = {
  month: string;
  mrr_amount?: number;
  gross?: number;
  delinquent?: number;
  collectible?: number;
};

const CACHE_TTL_MS = 60 * 1000; // 1 minute
const CACHE_KEY = 'mrr_dashboard_cache';

type DashboardCache = {
  history: HistoryRow[];
  current: { current_live_mrr: number; active_subscription_count: number };
  pie: any[];
  combined: any[];
  activeBreakdown: { upgrade: number; normal: number };
  ts: number;
};

function getStoredCache(): DashboardCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardCache;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setStoredCache(cache: DashboardCache) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

let memoryCache: DashboardCache | null = null;

function getCache(): DashboardCache | null {
  return memoryCache ?? getStoredCache();
}

const emptyCurrent = { current_live_mrr: 0, active_subscription_count: 0 };
const emptyBreakdown = { upgrade: 0, normal: 0 };

export default function Home() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const mem = memoryCache;
  const [history, setHistory] = useState<HistoryRow[]>(() => mem?.history ?? []);
  const [current, setCurrent] = useState(() => mem?.current ?? emptyCurrent);
  const [pie, setPie] = useState<any[]>(() => mem?.pie ?? []);
  const [combined, setCombined] = useState<any[]>(() => mem?.combined ?? []);
  const [activeBreakdown, setActiveBreakdown] = useState(() => mem?.activeBreakdown ?? emptyBreakdown);
  const [loading, setLoading] = useState(!mem);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const fresh = getCache();
    if (fresh) {
      setHistory(fresh.history);
      setCurrent(fresh.current);
      setPie(fresh.pie);
      setCombined(fresh.combined);
      setActiveBreakdown(fresh.activeBreakdown);
      setLoading(false);
    }

    async function loadAll() {
      try {
        const [mrrRes, pieRes, combRes, actRes] = await Promise.all([
          axios.get(`${apiUrl}/api/mrr?months=6`),
          axios.get(`${apiUrl}/api/pie`),
          axios.get(`${apiUrl}/api/combined`),
          axios.get(`${apiUrl}/api/active_breakdown`),
        ]);
        if (!mounted.current) return;
        const next: DashboardCache = {
          history: mrrRes.data.history || [],
          current: mrrRes.data.current || { current_live_mrr: 0, active_subscription_count: 0 },
          pie: pieRes.data || [],
          combined: combRes.data || [],
          activeBreakdown: { upgrade: actRes.data.active_upgrade_users || 0, normal: actRes.data.active_normal_users || 0 },
          ts: Date.now(),
        };
        memoryCache = next;
        setStoredCache(next);
        setHistory(next.history);
        setCurrent(next.current);
        setPie(next.pie);
        setCombined(next.combined);
        setActiveBreakdown(next.activeBreakdown);
      } catch (err) {
        console.error(err);
        if (mounted.current) setLoading(false);
      } finally {
        if (mounted.current) setLoading(false);
      }
    }
    loadAll();
    return () => {
      mounted.current = false;
    };
  }, [apiUrl]);

  return (
    <main className="p-6">
      <div className="max-w-6xl mx-auto">
        {loading && history.length === 0 && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
            Loading dashboard…
          </div>
        )}
        <header className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">MRR Dashboard</h1>
          <Link
            href="/agent"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            <span aria-hidden>💬</span>
            AI Agent
          </Link>
        </header>

        <div className="md:flex md:gap-6" style={{ display: 'flex', gap: 24 }}>
          <div className="md:w-2/3" style={{ flex: 2 }}>
            <div className="flex gap-4 mb-4 items-start">
              <MetricCard label="Current MRR" value={`$${current.current_live_mrr.toFixed(2)}`} />
              <MetricCard label="Active Subs" value={`${current.active_subscription_count}`} />
            </div>

            {history && history.length > 0 && history[0].gross !== undefined ? (
              <MRR3Chart data={history} />
            ) : (
              <TrendChart data={history as any} />
            )}

            <div className="mt-6">
              <ActiveSizeChart data={combined} />
            </div>
          </div>

          <aside className="md:w-1/3" style={{ flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28, alignItems: 'stretch' }}>
              <div style={{ height: 360 }}>
                <StatusPie data={pie} />
              </div>
              <div style={{ marginTop: 8 }}>
                <ActiveBreakdown upgrade={activeBreakdown.upgrade} normal={activeBreakdown.normal} />
              </div>
              <div style={{ marginTop: -30 }}>
                <GrowthChurnChart data={combined} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
