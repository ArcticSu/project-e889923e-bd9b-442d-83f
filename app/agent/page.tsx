'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AgentChat } from '../../components/agent/AgentChat';
import { ChatInput } from '../../components/agent/ChatInput';
import { SessionList } from '../../components/agent/SessionList';
import type { SessionItem } from '../../components/agent/SessionList';
import type { UIMessage } from 'ai';

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

export default function AgentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams.get('sessionId');

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(null);
  const [emptyInput, setEmptyInput] = useState('');
  const [emptySending, setEmptySending] = useState(false);

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
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    let cancelled = false;

    if (!sessionIdFromUrl) {
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
  }, [sessionIdFromUrl]);

  // When we land on a session page after creating from empty state, send the stored first message
  useEffect(() => {
    if (!sessionIdFromUrl || chatLoading) return;
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('agent_pending_message');
    if (stored) {
      sessionStorage.removeItem('agent_pending_message');
      setPendingFirstMessage(stored);
    }
  }, [sessionIdFromUrl, chatLoading]);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (id === sessionIdFromUrl) return;
      router.push(`/agent?sessionId=${id}`, { scroll: false });
    },
    [sessionIdFromUrl, router]
  );

  const handleNewChat = useCallback(() => {
    router.push('/agent', { scroll: false });
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
        router.push(`/agent?sessionId=${data.sessionId}`, { scroll: false });
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
        router.push('/agent', { scroll: false });
      }
    },
    [loadSessions, sessionIdFromUrl, router]
  );

  if (!sessionIdFromUrl) {
    return (
      <main className="flex h-screen bg-gray-50">
        <SessionList
          sessions={sessions}
          currentId={null}
          loading={sessionsLoading}
          onSelect={handleSelectSession}
          onNewChat={handleNewChat}
          onAfterAction={handleAfterAction}
        />
        <div className="flex flex-1 flex-col min-w-0">
          <div className="border-b border-gray-200 bg-white px-4 py-3">
            <h1 className="text-lg font-semibold text-gray-900">Agent Chat</h1>
          </div>
          <div className="flex flex-1 items-center justify-center">
            <p className="text-gray-500">Start a new conversation — type a message below.</p>
          </div>
          <ChatInput
            input={emptyInput}
            setInput={setEmptyInput}
            onSend={handleSendFromEmpty}
            isLoading={emptySending}
            status={emptySending ? 'submitted' : 'ready'}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen bg-gray-50">
      <SessionList
        sessions={sessions}
        currentId={sessionIdFromUrl}
        loading={sessionsLoading}
        onSelect={handleSelectSession}
        onNewChat={handleNewChat}
        onAfterAction={handleAfterAction}
      />
      <div className="flex flex-1 flex-col min-w-0">
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
          />
        )}
      </div>
    </main>
  );
}
