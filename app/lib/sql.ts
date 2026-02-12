import fs from 'fs';
import path from 'path';

interface CacheEntry {
  content: string;
  mtime: number;
}

const sqlCache = new Map<string, CacheEntry>();

/**
 * Load SQL file with caching and auto-refresh on file change
 * @param name SQL filename (e.g., 'users_list.sql')
 * @returns SQL file content
 */
export function loadSQL(name: string): string {
  const filePath = path.join(process.cwd(), 'sql', name);
  const stats = fs.statSync(filePath);
  const currentMtime = stats.mtimeMs;
  
  const cached = sqlCache.get(name);
  if (cached && cached.mtime === currentMtime) {
    return cached.content;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  sqlCache.set(name, { content, mtime: currentMtime });
  
  return content;
}
