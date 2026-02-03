'use client';

import React, { useMemo, useEffect, memo } from 'react';

/**
 * Render HTML report in a sandboxed iframe (no scripts).
 * Blob URL is memoized by html content; component is memoized so same html does not re-render (avoids flicker).
 */
export const HtmlReportMessage = memo(function HtmlReportMessage({ html }: { html: string }) {
  const src = useMemo(() => {
    if (!html || typeof html !== 'string') return '';
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [html]);

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  if (!html || typeof html !== 'string') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No report content.
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl rounded-lg border border-gray-200 bg-white overflow-hidden">
      <iframe
        key={src}
        title="Insight report"
        src={src}
        sandbox="allow-same-origin"
        className="h-[min(80vh,600px)] w-full border-0"
        style={{ minHeight: 400 }}
      />
    </div>
  );
});
