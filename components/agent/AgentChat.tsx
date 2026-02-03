'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useChatStream } from '../../app/lib/agent/useChatStream';
import type { UIMessage } from 'ai';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';

function lastMessageHasCompleteReport(messages: Array<{ parts?: Array<{ type?: string; result?: unknown; output?: unknown }> }>): boolean {
  const last = messages.length > 0 ? messages[messages.length - 1] : null;
  if (!last?.parts) return false;
  for (const p of last.parts) {
    if (typeof p.type === 'string' && p.type.includes('generateHtmlReport')) {
      const out = (p as { result?: { html?: unknown }; output?: { html?: unknown } }).result ?? (p as { output?: { html?: unknown } }).output;
      if (out && typeof out === 'object' && 'html' in out && (out as { html?: unknown }).html) return true;
    }
  }
  return false;
}

export function AgentChat({
  sessionId,
  initialMessages = [],
  onMessageSent,
  pendingFirstMessage = null,
  onClearPending,
}: {
  sessionId: string;
  initialMessages?: UIMessage[];
  onMessageSent?: () => void;
  pendingFirstMessage?: string | null;
  onClearPending?: () => void;
}) {
  const [input, setInput] = useState('');
  const pendingSentRef = useRef(false);
  const { messages, sendMessage, status, error } = useChatStream({
    sessionId,
    initialMessages,
  });

  useEffect(() => {
    if (!pendingFirstMessage?.trim() || pendingSentRef.current || status !== 'ready') return;
    pendingSentRef.current = true;
    sendMessage({ text: pendingFirstMessage.trim() });
    onClearPending?.();
  }, [pendingFirstMessage, status, sendMessage, onClearPending]);

  const handleSend = (content: string) => {
    if (!content.trim() || status !== 'ready') return;
    sendMessage({ text: content });
    setInput('');
    onMessageSent?.();
  };

  const rawLoading = status === 'submitted' || status === 'streaming';
  const hasCompleteReport = useMemo(() => lastMessageHasCompleteReport(messages ?? []), [messages]);
  const isLoading = rawLoading && !hasCompleteReport;

  return (
    <>
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold text-gray-900">Agent Chat</h1>
      </div>
      {error && (
        <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <strong>Error:</strong> {error.message}
        </div>
      )}
      <MessageList messages={messages ?? []} isLoading={isLoading} />
      <ChatInput
        input={input}
        setInput={setInput}
        onSend={handleSend}
        isLoading={isLoading}
        status={status}
      />
    </>
  );
}
