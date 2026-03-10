import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { book_id, job_id, storage_path } = body;

    // Validate input
    if (!book_id || !job_id || !storage_path) {
      return NextResponse.json(
        { error: 'Missing required fields: book_id, job_id, storage_path' },
        { status: 400 }
      );
    }

    // Get Modal webhook URL from environment
    const modalWebhookUrl = process.env.MODAL_WEBHOOK_URL;

    if (!modalWebhookUrl) {
      console.error('MODAL_WEBHOOK_URL not configured');
      return NextResponse.json(
        { error: 'PDF processing is not configured. Please set MODAL_WEBHOOK_URL in environment variables.' },
        { status: 500 }
      );
    }

    // Invoke Modal function via webhook
    const modalResponse = await fetch(modalWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        book_id,
        job_id,
        storage_path
      })
    });

    if (!modalResponse.ok) {
      const errorText = await modalResponse.text();
      console.error('Modal invocation failed:', errorText);
      throw new Error('Failed to invoke Modal function');
    }

    const modalResult = await modalResponse.json();

    return NextResponse.json({
      success: true,
      job_id,
      message: 'PDF processing started via Modal'
    });

  } catch (error: any) {
    console.error('Error invoking Lambda:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to start PDF processing' },
      { status: 500 }
    );
  }
}

// GET endpoint to check job status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('job_id');

    if (!jobId) {
      return NextResponse.json(
        { error: 'Missing job_id parameter' },
        { status: 400 }
      );
    }

    // Query the job status from Supabase
    // Note: This will use the user's auth context automatically
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const response = await fetch(
      `${supabaseUrl}/rest/v1/pdf_processing_jobs?id=eq.${jobId}`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch job status');
    }

    const jobs = await response.json();

    if (jobs.length === 0) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(jobs[0]);

  } catch (error: any) {
    console.error('Error fetching job status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch job status' },
      { status: 500 }
    );
  }
}
