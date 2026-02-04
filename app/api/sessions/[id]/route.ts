import { NextResponse } from 'next/server';
import { getSession, getSessionMessages, updateSessionTitle, deleteSession } from '../../../lib/agent/store';

/**
 * GET /api/sessions/[id] — Get single session + messages (for loading when switching sessions)
 * Returns { session: { id, title, updatedAt }, messages: ChatMessage[] }
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
    return NextResponse.json({
      session: {
        id: session.id,
        title: session.title ?? undefined,
        updatedAt: session.updatedAt.toISOString(),
      },
      messages,
    });
  } catch (err) {
    console.error('Get session error:', err);
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
  }
}

/**
 * PATCH /api/sessions/[id] — Rename session
 * body: { title: string }
 */
export async function PATCH(
  request: Request,
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
    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title : '';
    await updateSessionTitle(id, title);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Patch session error:', err);
    return NextResponse.json({ error: 'Failed to rename session' }, { status: 500 });
  }
}

/**
 * DELETE /api/sessions/[id] — Delete session (cascades to messages)
 */
export async function DELETE(
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
    await deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete session error:', err);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}
