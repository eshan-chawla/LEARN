import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.AWS_S3_RECORDINGS_BUCKET!;

interface BookClass {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const { bookId } = await params;

    // Authenticate via Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Fetch book + class info (RLS enforces ownership)
    const { data: book, error: bookError } = await supabase
      .from('books')
      .select(`
        *,
        classes:class_id (
          id,
          user_id,
          name,
          slug
        )
      `)
      .eq('id', bookId)
      .single();

    if (bookError || !book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookClass = book.classes as unknown as BookClass;

    if (!book.storage_path) {
      return NextResponse.json({ error: 'Book has no storage path' }, { status: 400 });
    }

    // Generate a time-limited S3 pre-signed GET URL (1 hour)
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: book.storage_path,
    });
    const pdfUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    return NextResponse.json({
      book: {
        id: book.id,
        title: book.title,
        class_id: book.class_id,
        processing_status: book.processing_status,
        storage_path: book.storage_path,
        uploaded_at: book.uploaded_at,
      },
      pdfUrl,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      className: bookClass.name,
      classSlug: bookClass.slug,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch book';
    console.error('Error fetching book:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
