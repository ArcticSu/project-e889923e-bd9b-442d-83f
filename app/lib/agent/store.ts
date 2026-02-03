/**
 * Agent 消息存储：Session + Messages 最小逻辑，收敛在 agent 目录
 */

import { prisma } from '../db';

const TITLE_MAX_LEN = 30;

export async function createSession(title?: string) {
  const session = await prisma.chatSession.create({
    data: title ? { title } : {},
  });
  return { sessionId: session.id };
}

export async function getSession(sessionId: string) {
  return prisma.chatSession.findUnique({
    where: { id: sessionId },
  });
}

/** List sessions for sidebar: id, title (first user message or "New chat"), updatedAt, lastMessagePreview */
export async function getSessionsList() {
  const sessions = await prisma.chatSession.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        where: { role: 'user' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { content: true },
      },
    },
  });
  return sessions.map((s) => {
    const firstContent = s.messages[0]?.content;
    return {
      id: s.id,
      title: s.title?.trim() || (firstContent ? firstContent.slice(0, TITLE_MAX_LEN).trim() : null) || 'New chat',
      updatedAt: s.updatedAt.toISOString(),
      lastMessagePreview: firstContent?.slice(0, 60) ?? undefined,
    };
  });
}

/** Update session title (rename) */
export async function updateSessionTitle(sessionId: string, title: string) {
  const trimmed = title.slice(0, TITLE_MAX_LEN).trim();
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { title: trimmed || null, updatedAt: new Date() },
  });
}

/** Delete a session and its messages (cascade) */
export async function deleteSession(sessionId: string) {
  await prisma.chatSession.delete({
    where: { id: sessionId },
  });
}

/** Update session updatedAt (call when a message is added); optionally set title once from first user message */
export async function touchSession(sessionId: string, options?: { titleFromFirstMessage?: string }) {
  const data: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
  if (options?.titleFromFirstMessage) {
    const session = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { title: true } });
    if (session && !session.title?.trim()) {
      data.title = options.titleFromFirstMessage.slice(0, TITLE_MAX_LEN).trim();
    }
  }
  await prisma.chatSession.update({
    where: { id: sessionId },
    data,
  });
}

export async function getSessionMessages(sessionId: string) {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content,
    parts: r.parts as unknown[] | null | undefined,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** 从 UIMessage parts 提取纯文本 content */
export function extractTextFromMessage(msg: { content?: string; parts?: Array<{ type?: string; text?: string }> }): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter((p) => p?.type === 'text' && p.text != null)
      .map((p) => (p as { text: string }).text)
      .join('');
  }
  return '';
}

export async function insertUserMessage(sessionId: string, content: string) {
  const count = await prisma.chatMessage.count({ where: { sessionId } });
  const msg = await prisma.chatMessage.create({
    data: { sessionId, role: 'user', content },
  });
  await touchSession(sessionId, count === 0 ? { titleFromFirstMessage: content } : undefined);
  return msg;
}

export async function insertAssistantMessage(
  sessionId: string,
  content: string,
  parts?: unknown[] | null
) {
  const msg = await prisma.chatMessage.create({
    data: {
      sessionId,
      role: 'assistant',
      content,
      ...(parts != null && parts.length > 0 ? { parts: parts as object } : {}),
    },
  });
  await touchSession(sessionId);
  return msg;
}
