import fs from 'fs';
import path from 'path';

const sqlCache = new Map<string, string>();

/**
 * Load SQL file with caching
 * @param name SQL filename (e.g., 'users_list.sql')
 * @returns SQL file content
 */
export function loadSQL(name: string): string {
  if (sqlCache.has(name)) {
    return sqlCache.get(name)!;
  }

  const filePath = path.join(process.cwd(), 'sql', name);
  const content = fs.readFileSync(filePath, 'utf8');
  sqlCache.set(name, content);
  
  return content;
}
