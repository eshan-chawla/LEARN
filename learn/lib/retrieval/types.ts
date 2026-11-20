export type RetrievalContentType = 'pdf' | 'video';

/** `dense` = Gemini embeddings only (A1 baseline); `hybrid` = BM25 + dense fused with RRF (A2+). */
export type RetrievalMode = 'dense' | 'hybrid';

export interface RetrievalSearchFilters {
  contentTypes?: RetrievalContentType[];
  sourceIds?: string[];
}

export interface RetrievalSearchRequest extends RetrievalSearchFilters {
  query: string;
  classId: string;
  limit?: number;
  /** Omitted → the webhook's default (dense). */
  mode?: RetrievalMode;
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
  /** Concept-graph ids tagged on the chunk (set once concept tagging has run). */
  conceptIds?: string[];
}

export interface RetrievalSearchResponse {
  query: string;
  classId: string;
  hits: RetrievalHit[];
  total: number;
}
