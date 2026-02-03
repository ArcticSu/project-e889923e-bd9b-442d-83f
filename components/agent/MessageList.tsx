'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';

export function MessageList({
  messages,
  isLoading,
}: {
  messages: Array<{ id: string; role: string; parts?: Array<{ type: string; text?: string }> }>;
  isLoading: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500">
            <p className="text-sm">Send a message to see the assistant reply with streaming. You can ask for MRR analysis, charts, or a report.</p>
          </div>
        )}
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400">
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
