'use client';

import ReactMarkdown from 'react-markdown';
import { EChartMessage } from './EChartMessage';
import { HtmlReportMessage } from './HtmlReportMessage';

type Part = {
  type: string;
  text?: string;
  toolName?: string;
  result?: unknown;
  output?: unknown;
  state?: string;
  [key: string]: unknown;
};

function getToolResult(part: Part): Record<string, unknown> | undefined {
  const out = part.result ?? part.output;
  if (out && typeof out === 'object' && !Array.isArray(out)) return out as Record<string, unknown>;
  return undefined;
}

/** Tool name: from part.type "tool-Name" (SDK) or part.toolName (legacy). */
function getToolName(part: Part): string {
  if (part.toolName && typeof part.toolName === 'string') return part.toolName;
  const t = typeof part.type === 'string' ? part.type : '';
  if (t.startsWith('tool-')) return t.slice(5); // e.g. tool-runBigQuery -> runBigQuery
  return '';
}

export function ChatMessage({
  message,
}: {
  message: { role: string; parts?: Part[] };
}) {
  const isUser = message.role === 'user';
  const parts = message.parts ?? [];

  const hasToolResults = parts.some(
    (p) => (p.type === 'tool-result' || (typeof p.type === 'string' && p.type.startsWith('tool-'))) && getToolResult(p)
  );

  const lastHtmlReportIndex = (() => {
    let idx = -1;
    parts.forEach((p, i) => {
      if ((p.type === 'tool-result' || (typeof p.type === 'string' && p.type.startsWith('tool-'))) && getToolName(p) === 'generateHtmlReport' && getToolResult(p)?.html) idx = i;
    });
    return idx;
  })();

  const renderPart = (part: Part, index: number) => {
    if (part.type === 'text') {
      if (lastHtmlReportIndex >= 0 && index > lastHtmlReportIndex) return null;
      const text = (part.text ?? '') as string;
      if (!text.trim() && hasToolResults) return null;
      const looksLikeHtml = /^\s*<(!DOCTYPE|html\b)/i.test(text.trim());
      if (looksLikeHtml) {
        return (
          <div key={index} className="mt-3">
            <HtmlReportMessage html={text} />
          </div>
        );
      }
      return (
        <div key={index} className="prose prose-sm max-w-none break-words">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              code: ({ children }) => (
                <code className="rounded bg-gray-100 px-1 py-0.5 text-sm font-mono">{children}</code>
              ),
              ul: ({ children }) => <ul className="list-disc pl-5 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-1">{children}</li>,
            }}
          >
            {text || '\u00A0'}
          </ReactMarkdown>
        </div>
      );
    }
    if (part.type === 'tool-call') {
      return (
        <div key={index} className="text-sm italic text-gray-500">
          Calling {getToolName(part) || 'tool'}…
        </div>
      );
    }
    const isToolPart = part.type === 'tool-result' || (typeof part.type === 'string' && part.type.startsWith('tool-'));
    if (isToolPart) {
      const name = getToolName(part);
      const result = getToolResult(part);
      if (!result && name) {
        return (
          <div key={index} className="text-sm italic text-gray-500">
            Calling {name}…
          </div>
        );
      }
      if (name === 'generateEchartsOption' && result) {
        return (
          <div key={index} className="mt-3">
            <EChartMessage
              option={(result.option as Record<string, unknown>) ?? {}}
              explain={result.explain as string | undefined}
            />
          </div>
        );
      }
      if (name === 'generateHtmlReport' && result?.html) {
        const fullHtml = String(result.html);
        if (!fullHtml.includes('</html>')) {
          return (
            <div key={index} className="mt-3 py-8 text-center text-sm italic text-gray-500">
              Generating report…
            </div>
          );
        }
        return (
          <div key={index} className="mt-3">
            <HtmlReportMessage html={fullHtml} />
          </div>
        );
      }
      if (name === 'runBigQuery') {
        if (result?.error) {
          return (
            <div key={index} className="mt-2 text-sm text-amber-700">
              BigQuery error: {String(result.error)}
            </div>
          );
        }
        const rowCount = Array.isArray(result?.rows) ? (result.rows as unknown[]).length : 0;
        const colCount = Array.isArray(result?.columns) ? (result.columns as unknown[]).length : 0;
        return (
          <div key={index} className="mt-2 text-sm text-gray-600">
            Queried {rowCount} rows × {colCount} columns
          </div>
        );
      }
      return null;
    }
    return null;
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`w-fit max-w-[85%] rounded-lg px-4 py-2.5 ${
          isUser ? 'bg-blue-600 text-white' : 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
        }`}
      >
        {parts.map((p, i) => renderPart(p, i))}
      </div>
    </div>
  );
}
