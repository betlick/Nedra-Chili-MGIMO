import {getTableColumns,sql} from 'drizzle-orm';
import {requests} from './schema.js';

// Never transfer the stored documents or private snapshot when listing requests.
const {documentBase64,documentDocxBase64,draftSnapshot,...columns}=getTableColumns(requests);
export const requestSummaryColumns={...columns,
  docxAvailable:sql<boolean>`(${documentDocxBase64} is not null and ${requests.status} in ('ready','issued'))`,
  preparedAvailable:sql<boolean>`(${requests.aiPreparedAt} is not null and ${documentBase64} is not null and ${documentDocxBase64} is not null and ${requests.type} = 'retake' and ${requests.delivery} = 'pdf' and ${requests.status} in ('submitted','in_progress'))`,
};
