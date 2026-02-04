import { NextResponse } from 'next/server';
import { getSession, getSessionMessages } from '../../../../lib/agent/store';

/**
 * GET /api/sessions/[id]/messages — Fetch all messages for this session, ordered by createdAt ascending
 * Returns format compatible with useChat: role + content
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
