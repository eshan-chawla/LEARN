import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { recording_id, class_id, title, storage_path, file_name, duration } = body;

    if (!recording_id || !class_id || !title || !storage_path || !file_name) {
      return NextResponse.json(
        { error: 'Missing required fields: recording_id, class_id, title, storage_path, file_name' },
        { status: 400 }
      );
    }

    const modalWebhookUrl = process.env.MODAL_VIDEO_WEBHOOK_URL;
    const modalWebhookSecret = process.env.MODAL_WEBHOOK_SECRET;

    if (!modalWebhookUrl || !modalWebhookSecret) {
      console.warn('Modal video processing is not fully configured');
      return NextResponse.json(
        {
          error:
            'Video processing is not configured. Set MODAL_VIDEO_WEBHOOK_URL and MODAL_WEBHOOK_SECRET in environment variables.',
        },
        { status: 500 }
      );
    }

    const modalResponse = await fetch(modalWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook_secret: modalWebhookSecret,
        recording_id,
        class_id,
        title,
        storage_path,
        file_name,
        duration,
      }),
    });

    if (!modalResponse.ok) {
      const errorText = await modalResponse.text();
      console.error('Modal video invocation failed:', errorText);
      throw new Error('Failed to invoke Modal function');
    }

    const modalPayload = await modalResponse.json().catch(() => null);
    if (!modalPayload?.success) {
      throw new Error(
        typeof modalPayload?.error === 'string'
          ? modalPayload.error
          : 'Modal rejected the request'
      );
    }

    return NextResponse.json({ success: true, message: 'Video processing started' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to start video processing';
    console.error('Error invoking video processor:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
