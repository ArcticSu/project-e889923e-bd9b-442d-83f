import { BigQuery } from '@google-cloud/bigquery';

let cachedClient: BigQuery | undefined;
let cachedProjectId: string | undefined;

export const getBigQueryClient = () => {
  if (cachedClient) {
    return cachedClient;
  }

  const b64 = process.env.BIGQUERY_SA_BASE64;
  if (b64) {
    const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    cachedProjectId = credentials.project_id;
    cachedClient = new BigQuery({ projectId: credentials.project_id, credentials });
    return cachedClient;
  }
  
  cachedClient = new BigQuery();
  return cachedClient;
};

export function getBigQueryProjectId(): string | undefined {
  if (cachedProjectId) return cachedProjectId;
  
  if (cachedClient && 'projectId' in cachedClient) {
    cachedProjectId = (cachedClient as any).projectId;
    if (cachedProjectId) return cachedProjectId;
  }
  
  const b64 = process.env.BIGQUERY_SA_BASE64;
  if (b64) {
    const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    cachedProjectId = credentials.project_id;
    return cachedProjectId;
  }
  return undefined;
}

export default getBigQueryClient;
