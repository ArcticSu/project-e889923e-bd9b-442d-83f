import { useEffect, useState } from 'react';
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
  // legacy single-column MRR
  mrr_amount?: number;
  // new 3-column MRR fields (gross / delinquent / collectible)
  gross?: number;
  delinquent?: number;
  collectible?: number;
};

export default function Home() {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [current, setCurrent] = useState<{ current_live_mrr: number; active_subscription_count: number }>({ current_live_mrr: 0, active_subscription_count: 0 });
  const [pie, setPie] = useState<any[]>([]);
  const [combined, setCombined] = useState<any[]>([]);
  const [activeBreakdown, setActiveBreakdown] = useState<{ upgrade: number; normal: number }>({ upgrade: 0, normal: 0 });
  // If NEXT_PUBLIC_API_URL is not set, use relative path so client calls the
  // same origin Next.js API routes (avoids wrong port / CORS issues).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

  useEffect(() => {
    async function loadAll() {
      try {
        const [mrrRes, pieRes, combRes, actRes] = await Promise.all([
          axios.get(`${apiUrl}/api/mrr?months=6`),
          axios.get(`${apiUrl}/api/pie`),
          axios.get(`${apiUrl}/api/combined`),
          axios.get(`${apiUrl}/api/active_breakdown`),
        ]);

        // debug: log API payload so we can see what the browser received
        // in the devtools console
        // eslint-disable-next-line no-console
        console.log('mrrRes.data', mrrRes.data);

        setHistory(mrrRes.data.history || []);
        setCurrent(mrrRes.data.current || { current_live_mrr: 0, active_subscription_count: 0 });
        setPie(pieRes.data || []);
        setCombined(combRes.data || []);
        setActiveBreakdown({ upgrade: actRes.data.active_upgrade_users || 0, normal: actRes.data.active_normal_users || 0 });
      } catch (err) {
        console.error(err);
      }
    }
    loadAll();
  }, [apiUrl]);

  return (
    <main className="p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">MRR Dashboard</h1>
        </header>

        <div className="md:flex md:gap-6" style={{ display: 'flex', gap: 24 }}>
          <div className="md:w-2/3" style={{ flex: 2 }}>
            <div className="flex gap-4 mb-4 items-start">
              <MetricCard label="Current MRR" value={`$${current.current_live_mrr.toFixed(2)}`} />
              <MetricCard label="Active Subs" value={`${current.active_subscription_count}`} />
            </div>

            {/* MRR trend */}
            {/* Use MRR3Chart when history contains gross/delinquent/collectible */}
            {history && history.length > 0 && history[0].gross !== undefined ? (
              <MRR3Chart data={history} />
            ) : (
              <TrendChart data={history as any} />
            )}

            {/* Active users & rates should be below the MRR trend */}
            <div className="mt-6">
              <ActiveSizeChart data={combined} />
            </div>
          </div>

          {/* Right column: Current Status (pie) placed statically to the right of the MRR chart */}
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
