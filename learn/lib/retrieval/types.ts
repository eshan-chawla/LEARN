export type RetrievalContentType = 'pdf' | 'video';

export interface RetrievalSearchFilters {
  contentTypes?: RetrievalContentType[];
  sourceIds?: string[];
}

export interface RetrievalSearchRequest extends RetrievalSearchFilters {
  query: string;
  classId: string;
  limit?: number;
}

export interface RetrievalHit {
  score: number;
  text: string;
  classId: string;
  contentType: RetrievalContentType;
  sourceId: string;
  title: string | null;
  fileName: string | null;
  storagePath: string | null;
  pageNumber: number | null;
  pageChunkIndex: number | null;
  chunkIndex: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  transcriptChunkIndex: number | null;
  transcriptLanguage: string | null;
}

export interface RetrievalSearchResponse {
  query: string;
  classId: string;
  hits: RetrievalHit[];
  total: number;
}
