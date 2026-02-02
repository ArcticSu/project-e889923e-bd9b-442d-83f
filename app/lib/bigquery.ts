import { BigQuery } from '@google-cloud/bigquery';

export const getBigQueryClient = () => {
  const b64 = process.env.BIGQUERY_SA_BASE64;
  if (b64) {
    const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return new BigQuery({ projectId: credentials.project_id, credentials });
  }
  return new BigQuery();
};

export default getBigQueryClient;
