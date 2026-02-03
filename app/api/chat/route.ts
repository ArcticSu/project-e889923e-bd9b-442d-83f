/**
 * Chat API (Phase 4: sessionId + 3 tools + data catalog injection)
 */

import { convertToModelMessages, streamText, stepCountIs } from 'ai';
import type { UIMessage } from 'ai';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { NextResponse } from 'next/server';
import { getAgentModel } from '../../lib/agent/streaming';
import { getAgentSystemPrompt } from '../../lib/agent/prompts';
import { getBigQueryProjectId } from '../../lib/bigquery';
import {
  extractTextFromMessage,
  getSession,
  insertUserMessage,
  insertAssistantMessage,
} from '../../lib/agent/store';
import { runBigQueryTool } from '../../lib/agent/tools/runBigQuery';
import { generateEchartsOptionTool } from '../../lib/agent/tools/generateEchartsOption';
import { generateHtmlReportTool } from '../../lib/agent/tools/generateHtmlReport';

export const maxDuration = 60;

function normalizeToUIMessages(raw: unknown): UIMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: UIMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object' || typeof (m as { role?: string }).role !== 'string') continue;
    const role = (m as { role: string }).role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') continue;
    const parts = (m as { parts?: Array<{ type: string; text?: string }> }).parts;
    if (Array.isArray(parts)) {
      out.push({ role, parts });
    } else {
      const content = typeof (m as { content?: string }).content === 'string' ? (m as { content: string }).content : '';
      out.push({ role, parts: [{ type: 'text', text: content }] });
    }
  }
  return out;
}

export async function POST(request: Request) {
  try {
    if (!process.env.AI_GATEWAY_API_KEY) {
      return NextResponse.json(
        {
          error:
            'Server misconfiguration: AI_GATEWAY_API_KEY is not set. See .env.example.',
        },
        { status: 500 }
      );
    }

    let body: { messages?: unknown; sessionId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : undefined;
    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    const uiMessages = normalizeToUIMessages(body.messages);
    if (uiMessages.length === 0 && body.messages != null && Array.isArray(body.messages) && body.messages.length > 0) {
      return NextResponse.json(
        { error: 'Invalid messages: each must have role and content or parts' },
        { status: 400 }
      );
    }

    // 本次发送的 user 消息：取最后一条 user，立刻写入 DB
    const lastUser = [...uiMessages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      const content = extractTextFromMessage(lastUser);
      if (content) {
        await insertUserMessage(sessionId, content);
      }
    }

    console.log('[chat] POST', { sessionId, messageCount: uiMessages.length, lastUserPreview: extractTextFromMessage(lastUser ?? {}).slice(0, 60) });

    const catalogPath = join(process.cwd(), 'docs', 'data_catalog.md');
    const dataCatalog = await readFile(catalogPath, 'utf-8').catch(() => '');
    const projectId = getBigQueryProjectId();
    const systemPrompt = getAgentSystemPrompt(dataCatalog, projectId);

    const model = getAgentModel();
    const result = streamText({
      model,
      system: systemPrompt,
      messages: convertToModelMessages(uiMessages),
      tools: {
        runBigQuery: runBigQueryTool,
        generateEchartsOption: generateEchartsOptionTool,
        generateHtmlReport: generateHtmlReportTool,
      },
      maxSteps: 10,
      // Allow multiple steps so report workflow can run: runBigQuery → generateEchartsOption → generateHtmlReport (default is stepCountIs(1))
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse({
      onFinish: async ({ messages: finishedMessages }) => {
        const lastAssistant = [...finishedMessages].reverse().find((m) => m.role === 'assistant');
        if (!lastAssistant) return;
        const content = extractTextFromMessage(lastAssistant);
        const parts = Array.isArray(lastAssistant.parts) && lastAssistant.parts.length > 0
          ? (JSON.parse(JSON.stringify(lastAssistant.parts)) as unknown[])
          : undefined;
        try {
          await insertAssistantMessage(sessionId, content || '', parts);
        } catch (e) {
          console.error('Failed to save assistant message:', e);
        }
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[chat] error', message, err);
    if (message.includes('AI_GATEWAY_API_KEY')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json(
      { error: 'Gateway or model error. Check server logs.' },
      { status: 500 }
    );
  }
}
