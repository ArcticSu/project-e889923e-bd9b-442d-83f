'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';

const CHAT_API = '/api/chat';

export type UseChatStreamOptions = {
  api?: string;
  sessionId: string | null;
  initialMessages?: UIMessage[];
};

/**
 * Streaming chat utility: connects to /api/chat with sessionId in body, supports initial messages
 */
export function useChatStream(options: UseChatStreamOptions) {
  const { api = CHAT_API, sessionId, initialMessages } = options;
  return useChat({
    transport: new DefaultChatTransport({
      api,
      body: sessionId ? { sessionId } : undefined,
    }),
    messages: initialMessages ?? [],
  });
}
