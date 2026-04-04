import { NextRequest } from 'next/server';
import { handleRetrievalSearch } from '@/lib/retrieval/server';

export async function POST(request: NextRequest) {
  return handleRetrievalSearch(request);
}
