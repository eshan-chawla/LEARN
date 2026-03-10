import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookId, storagePath } = body;

    // Validate input
    if (!bookId || !storagePath) {
      return NextResponse.json(
        { error: 'Missing required fields: bookId, storagePath' },
        { status: 400 }
      );
    }

    // Get user from authorization header
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

    // Verify user owns the book (fetch with class relationship)
    const { data: book, error: bookError } = await supabase
      .from('books')
      .select(`
        id,
        storage_path,
        classes:class_id (
          user_id
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

    // Verify storage path matches
    if (book.storage_path !== storagePath) {
      return NextResponse.json(
        { error: 'Storage path mismatch' },
        { status: 400 }
      );
    }

    // Generate new signed URL (1 hour expiry)
    const { data: signedData, error: signedError } = await supabase.storage
      .from('books')
      .createSignedUrl(storagePath, 3600);

    if (signedError || !signedData) {
      console.error('Error creating signed URL:', signedError);
      return NextResponse.json(
        { error: 'Failed to generate PDF URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      signedUrl: signedData.signedUrl,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to refresh URL';
    console.error('Error refreshing URL:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
