const SHARED_COLLECTION_NAME = 'class_content_embeddings';

type ContentType = 'pdf' | 'video';

interface DeleteContentEmbeddingsInput {
  classId: string;
  contentType: ContentType;
  sourceId: string;
}

export async function deleteContentEmbeddings({
  classId,
  contentType,
  sourceId,
}: DeleteContentEmbeddingsInput) {
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;

  if (!qdrantUrl) {
    throw new Error('Embedding deletion is not configured. Set QDRANT_URL.');
  }

  const response = await fetch(
    `${qdrantUrl.replace(/\/$/, '')}/collections/${SHARED_COLLECTION_NAME}/points/delete?wait=true`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(qdrantApiKey ? { 'api-key': qdrantApiKey } : {}),
      },
      body: JSON.stringify({
        filter: {
          must: [
            { key: 'class_id', match: { value: classId } },
            { key: 'content_type', match: { value: contentType } },
            { key: 'source_id', match: { value: sourceId } },
          ],
        },
      }),
      cache: 'no-store',
    }
  );

  const payload = await response.json().catch(() => null) as
    | { status?: { error?: string } }
    | null;

  if (!response.ok) {
    throw new Error(payload?.status?.error || 'Failed to delete content embeddings');
  }
}
