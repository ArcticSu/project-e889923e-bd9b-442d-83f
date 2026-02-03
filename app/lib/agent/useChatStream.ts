'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';

const CHAT_API = '/api/chat';

export type UseChatStreamOptions = {
  api?: string;
  /** 阶段 2：必传，请求 /api/chat 时带上 sessionId */
  sessionId: string | null;
  /** 阶段 2：历史消息，与 useChat 的 messages 格式一致 */
  initialMessages?: UIMessage[];
};

/**
 * 流式 Chat 小工具：对接 /api/chat，body 带 sessionId，支持初始历史消息
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
