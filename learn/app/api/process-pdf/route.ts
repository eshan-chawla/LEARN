import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { book_id, storage_path } = body;

    if (!book_id || !storage_path) {
      return NextResponse.json(
        { error: 'Missing required fields: book_id, storage_path' },
        { status: 400 }
      );
    }

    const modalWebhookUrl = process.env.MODAL_WEBHOOK_URL;

    if (!modalWebhookUrl) {
      console.warn('MODAL_WEBHOOK_URL not configured — skipping processing trigger');
      return NextResponse.json(
        { error: 'PDF processing is not configured. Set MODAL_WEBHOOK_URL in environment variables.' },
        { status: 500 }
      );
    }

    // Invoke Modal/Lambda function via webhook
    const modalResponse = await fetch(modalWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id, storage_path }),
    });

    if (!modalResponse.ok) {
      const errorText = await modalResponse.text();
      console.error('Modal invocation failed:', errorText);
      throw new Error('Failed to invoke Modal function');
    }

    return NextResponse.json({ success: true, message: 'PDF processing started' });

  } catch (error: any) {
    console.error('Error invoking PDF processor:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to start PDF processing' },
      { status: 500 }
    );
  }
}

// GET: check processing status from the books table directly
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('book_id');

    if (!bookId) {
      return NextResponse.json({ error: 'Missing book_id parameter' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const response = await fetch(
      `${supabaseUrl}/rest/v1/books?id=eq.${bookId}&select=id,processing_status,error_message`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!response.ok) throw new Error('Failed to fetch book status');

    const books = await response.json();

    if (books.length === 0) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json(books[0]);

  } catch (error: any) {
    console.error('Error fetching book status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
