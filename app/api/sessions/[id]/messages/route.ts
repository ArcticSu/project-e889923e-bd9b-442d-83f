import { NextResponse } from 'next/server';
import { getSession, getSessionMessages } from '../../../../lib/agent/store';

/**
 * GET /api/sessions/[id]/messages — 拉取该 session 全部消息，按 createdAt 升序
 * 返回格式与 useChat 兼容：role + content
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 });
    }
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const messages = await getSessionMessages(id);
    return NextResponse.json({ sessionId: id, messages });
  } catch (err) {
    console.error('Get messages error:', err);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}
