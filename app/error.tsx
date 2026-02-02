"use client";
import React from 'react';

export default function Error({ error, reset }: { error: Error; reset?: () => void }) {
  console.error(error);
  return (
    <html>
      <body>
        <h1>Something went wrong</h1>
        <pre>{String(error.message)}</pre>
      </body>
    </html>
  );
}
