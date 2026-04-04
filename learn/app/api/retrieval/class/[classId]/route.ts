import { NextRequest } from 'next/server';
import { handleRetrievalSearch } from '@/lib/retrieval/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  return handleRetrievalSearch(request, { classId });
}
