"use client";
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import TrendChart from '../components/TrendChart';
import MRR3Chart from '../components/MRR3Chart';
import ActiveBreakdown from '../components/ActiveBreakdown';
import MetricCard from '../components/MetricCard';
import StatusPie from '../components/StatusPie';
import ActiveSizeChart from '../components/ActiveSizeChart';
import GrowthChurnChart from '../components/GrowthChurnChart';
import UserList from '../components/UserList';
import { AgentChat } from '../components/agent/AgentChat';
import { ChatInput } from '../components/agent/ChatInput';
import { SessionList } from '../components/agent/SessionList';
import type { SessionItem } from '../components/agent/SessionList';
import type { UIMessage } from 'ai';

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

function toUIMessages(
  list: Array<{ role: string; content: string; parts?: unknown[]; createdAt?: string }>
): UIMessage[] {
  return list.map((m, i) => {
    const id = `msg-${m.createdAt ?? Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`;
    const role = m.role as 'user' | 'assistant' | 'system';
    const parts = Array.isArray(m.parts) && m.parts.length > 0
      ? m.parts
      : [{ type: 'text' as const, text: m.content ?? '' }];
    return { id, role, parts };
  });
}

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams.get('sessionId');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const mem = memoryCache;
  const [history, setHistory] = useState<HistoryRow[]>(() => mem?.history ?? []);
  const [current, setCurrent] = useState(() => mem?.current ?? emptyCurrent);
  const [pie, setPie] = useState<any[]>(() => mem?.pie ?? []);
  const [combined, setCombined] = useState<any[]>(() => mem?.combined ?? []);
  const [activeBreakdown, setActiveBreakdown] = useState(() => mem?.activeBreakdown ?? emptyBreakdown);
  const [loading, setLoading] = useState(!mem);
  const mounted = useRef(true);

  // Agent states
  const [agentOpen, setAgentOpen] = useState(false);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(null);
  const [emptyInput, setEmptyInput] = useState('');
  const [emptySending, setEmptySending] = useState(false);

  // Load dashboard data
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

  // Agent: Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error('Failed to load sessions');
      const data = (await res.json()) as SessionItem[];
      setSessions(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (agentOpen) {
      loadSessions();
    }
  }, [agentOpen, loadSessions]);

  // Agent: Load session messages
  useEffect(() => {
    let cancelled = false;

    if (!sessionIdFromUrl || !agentOpen) {
      setChatLoading(false);
      setInitialMessages([]);
      return;
    }

    setChatLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionIdFromUrl}`);
        if (res.status === 404) {
          if (!cancelled) {
            setInitialMessages([]);
            setError('Session not found');
          }
          return;
        }
        if (!res.ok) throw new Error('Failed to load session');
        const data = (await res.json()) as {
          session: { id: string; title?: string; updatedAt: string };
          messages: Array<{ role: string; content: string; parts?: unknown[]; createdAt?: string }>;
        };
        if (cancelled) return;
        setInitialMessages(toUIMessages(data.messages ?? []));
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error');
          setInitialMessages([]);
        }
      } finally {
        if (!cancelled) setChatLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionIdFromUrl, agentOpen]);

  // Agent: Handle pending first message
  useEffect(() => {
    if (!sessionIdFromUrl || chatLoading || !agentOpen) return;
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('agent_pending_message');
    if (stored) {
      sessionStorage.removeItem('agent_pending_message');
      setPendingFirstMessage(stored);
    }
  }, [sessionIdFromUrl, chatLoading, agentOpen]);

  // Agent: Handlers
  const handleSelectSession = useCallback(
    (id: string) => {
      if (id === sessionIdFromUrl) return;
      router.push(`/?sessionId=${id}`, { scroll: false });
      setSessionListOpen(false); // 选择会话后自动关闭历史列表
    },
    [sessionIdFromUrl, router]
  );

  const handleNewChat = useCallback(() => {
    router.push('/', { scroll: false });
  }, [router]);

  const handleSendFromEmpty = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      setEmptySending(true);
      setError(null);
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error('Failed to create session');
        const data = (await res.json()) as { sessionId: string };
        sessionStorage.setItem('agent_pending_message', content.trim());
        router.push(`/?sessionId=${data.sessionId}`, { scroll: false });
        await loadSessions();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
        setEmptySending(false);
      }
    },
    [router, loadSessions]
  );

  const handleAfterAction = useCallback(
    (deletedId?: string) => {
      loadSessions();
      if (deletedId && deletedId === sessionIdFromUrl) {
        router.push('/', { scroll: false });
      }
    },
    [loadSessions, sessionIdFromUrl, router]
  );

  const analyzeUser = useCallback(
    async (email: string) => {
      const message = `analyze the behavior of user with email: ${email}`;
      
      // 打开 Agent 侧边栏
      setAgentOpen(true);
      
      // 如果有当前 session，直接设置 pendingFirstMessage
      if (sessionIdFromUrl) {
        setPendingFirstMessage(message);
        return;
      }
      
      // 如果没有 session，创建新 session
      setEmptySending(true);
      setError(null);
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error('Failed to create session');
        const data = (await res.json()) as { sessionId: string };
        sessionStorage.setItem('agent_pending_message', message);
        router.push(`/?sessionId=${data.sessionId}`, { scroll: false });
        await loadSessions();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
        setEmptySending(false);
      }
    },
    [sessionIdFromUrl, router, loadSessions]
  );

  return (
    <div className="relative min-h-screen bg-gray-50">
      {/* Dashboard Content Area */}
      <main 
        className={`
          transition-all duration-300 ease-in-out
          ${agentOpen ? 'mr-0 sm:mr-[400px] lg:mr-[420px] xl:mr-[480px]' : ''}
        `}
      >
        <div className="p-4 sm:p-6 max-w-7xl mx-auto">
          {loading && history.length === 0 && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
              Loading dashboard…
            </div>
          )}
          <header className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold">MRR Dashboard</h1>
            <button
              onClick={() => setAgentOpen(!agentOpen)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              <span aria-hidden>💬</span>
              AI Agent
            </button>
          </header>

          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
            {/* Main Content - Left Side */}
            <div className="flex-1 min-w-0 lg:w-2/3">
              <div className="flex flex-col sm:flex-row gap-4 mb-4">
                <MetricCard label="Current MRR" value={`$${current.current_live_mrr.toFixed(2)}`} />
                <MetricCard label="Active Subs" value={`${current.active_subscription_count}`} />
              </div>

              <div className="mb-6">
                {history && history.length > 0 && history[0].gross !== undefined ? (
                  <MRR3Chart data={history} />
                ) : (
                  <TrendChart data={history as any} />
                )}
              </div>

              <div className="mt-6">
                <UserList onAnalyzeUser={analyzeUser} />
              </div>
            </div>

            {/* Sidebar - Right Side */}
            <aside className="w-full lg:w-1/3 flex-shrink-0">
              <div className="flex flex-col gap-6 lg:gap-7">
                <div className="h-[300px] sm:h-[360px]">
                  <StatusPie data={pie} />
                </div>
                <div>
                  <ActiveBreakdown upgrade={activeBreakdown.upgrade} normal={activeBreakdown.normal} />
                </div>
                <div>
                  <GrowthChurnChart data={combined} />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {/* Agent Sidebar - Always Fixed on Right */}
      {agentOpen && (
        <>
          {/* Backdrop for mobile/tablet */}
          <div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setAgentOpen(false)}
          />
          <div 
            className={`
              fixed
              top-0 right-0 h-screen
              w-full sm:w-[400px] lg:w-[420px] xl:w-[480px]
              bg-white border-l border-gray-200 shadow-xl
              z-50 flex flex-col
              transition-all duration-300 ease-in-out overflow-hidden
            `}
          >
          {/* Session List Toggle Button */}
          <div className="border-b border-gray-200 p-2 flex items-center justify-between bg-white">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSessionListOpen(!sessionListOpen)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                {sessionListOpen ? 'Hide' : 'Show'} History
              </button>
              <a
                href={sessionIdFromUrl ? `/agent?sessionId=${sessionIdFromUrl}` : '/agent'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open in Tab
              </a>
            </div>
            <button
              onClick={() => setAgentOpen(false)}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Chat Area */}
          <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
              {!sessionIdFromUrl ? (
                <>
                  <div className="flex flex-1 items-center justify-center">
                    <p className="text-gray-500 text-sm px-4 text-center">Start a new conversation — type a message below.</p>
                  </div>
                  <ChatInput
                    input={emptyInput}
                    setInput={setEmptyInput}
                    onSend={handleSendFromEmpty}
                    isLoading={emptySending}
                    status={emptySending ? 'submitted' : 'ready'}
                  />
                </>
              ) : (
                <>
                  {error && (
                    <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                      {error}
                    </div>
                  )}
                  {chatLoading ? (
                    <div className="flex flex-1 items-center justify-center">
                      <p className="text-gray-500">Loading chat…</p>
                    </div>
                  ) : (
                    <AgentChat
                      key={sessionIdFromUrl}
                      sessionId={sessionIdFromUrl}
                      initialMessages={initialMessages}
                      onMessageSent={loadSessions}
                      pendingFirstMessage={pendingFirstMessage}
                      onClearPending={() => setPendingFirstMessage(null)}
                      hideTitle={true}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Session List - Floating Overlay */}
      {agentOpen && sessionListOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/20 z-[60] lg:bg-transparent"
            onClick={() => setSessionListOpen(false)}
          />
          {/* Floating Session List - Fixed positioning relative to chat */}
          <div 
            className={`
              fixed top-0 h-screen w-64
              bg-white border-l border-gray-200 shadow-2xl
              z-[70] transition-transform duration-300 ease-in-out
              right-full sm:right-[400px] lg:right-[420px] xl:right-[480px]
              ${sessionListOpen ? 'translate-x-0' : 'translate-x-full'}
            `}
          >
            <SessionList
              sessions={sessions}
              currentId={sessionIdFromUrl}
              loading={sessionsLoading}
              onSelect={handleSelectSession}
              onNewChat={handleNewChat}
              onAfterAction={handleAfterAction}
              hideDashboardLink={true}
            />
          </div>
        </>
      )}
    </div>
  );
}
