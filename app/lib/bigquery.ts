import { BigQuery } from '@google-cloud/bigquery';

let cachedProjectId: string | undefined;

export const getBigQueryClient = () => {
  const b64 = process.env.BIGQUERY_SA_BASE64;
  if (b64) {
    const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    cachedProjectId = credentials.project_id;
    return new BigQuery({ projectId: credentials.project_id, credentials });
  }
  return new BigQuery();
};

export function getBigQueryProjectId(): string | undefined {
  if (cachedProjectId) return cachedProjectId;
  const b64 = process.env.BIGQUERY_SA_BASE64;
  if (b64) {
    const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    cachedProjectId = credentials.project_id;
    return cachedProjectId;
  }
  return undefined;
}

export default getBigQueryClient;
