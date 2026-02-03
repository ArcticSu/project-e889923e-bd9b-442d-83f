import { NextResponse } from 'next/server';
import { createSession, getSessionsList } from '../../lib/agent/store';

/**
 * GET /api/sessions — 会话列表（侧边栏），按 updatedAt 降序
 * 返回 { id, title, updatedAt, lastMessagePreview? }[]
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
 * POST /api/sessions — 创建一个 ChatSession，返回 { sessionId }
 * body 可选：{ title?: string }
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
