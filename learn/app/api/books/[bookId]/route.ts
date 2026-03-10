import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const { bookId } = await params;

    // Get user from authorization header (set by middleware/client)
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Create Supabase client with user's token
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // Fetch book with its class to verify ownership
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
      return NextResponse.json(
        { error: 'Book not found' },
        { status: 404 }
      );
    }

    // Verify user owns the class (RLS should handle this, but double-check)
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || (book.classes as any).user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized to access this book' },
        { status: 403 }
      );
    }

    // Generate signed URL for the PDF (1 hour expiry)
    if (!book.storage_path) {
      return NextResponse.json(
        { error: 'Book has no storage path' },
        { status: 400 }
      );
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from('books')
      .createSignedUrl(book.storage_path, 3600); // 1 hour

    if (signedError || !signedData) {
      console.error('Error creating signed URL:', signedError);
      return NextResponse.json(
        { error: 'Failed to generate PDF URL' },
        { status: 500 }
      );
    }

    // Return book data with signed URL
    return NextResponse.json({
      book: {
        id: book.id,
        title: book.title,
        class_id: book.class_id,
        processing_status: book.processing_status,
        storage_path: book.storage_path,
        uploaded_at: book.uploaded_at,
      },
      pdfUrl: signedData.signedUrl,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      className: (book.classes as any).name,
      classSlug: (book.classes as any).slug,
    });

  } catch (error: any) {
    console.error('Error fetching book:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch book' },
      { status: 500 }
    );
  }
}
