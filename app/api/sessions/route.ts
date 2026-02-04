import { NextResponse } from 'next/server';
import { createSession, getSessionsList } from '../../lib/agent/store';

/**
 * GET /api/sessions — List sessions (sidebar), ordered by updatedAt descending
 * Returns { id, title, updatedAt, lastMessagePreview? }[]
 */
export async function GET() {
  try {
    const list = await getSessionsList();
    return NextResponse.json(list);
  } catch (err) {
    console.error('List sessions error:', err);
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 });
  }
}

/**
 * POST /api/sessions — Create a ChatSession, returns { sessionId }
 * body optional: { title?: string }
 */
export async function POST(request: Request) {
  try {
    let body: { title?: string } = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text) as { title?: string };
    } catch {
      // empty body ok
    }
    const { sessionId } = await createSession(body.title);
    return NextResponse.json({ sessionId });
  } catch (err) {
    console.error('Create session error:', err);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
