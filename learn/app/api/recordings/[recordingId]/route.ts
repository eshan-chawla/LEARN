import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

interface RecordingClass {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recordingId: string }> }
) {
  try {
    const { recordingId } = await params;

    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: recording, error: recordingError } = await supabase
      .from('recordings')
      .select(`
        *,
        classes:class_id (
          id,
          user_id,
          name,
          slug
        )
      `)
      .eq('id', recordingId)
      .single();

    if (recordingError || !recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const recordingClass = recording.classes as unknown as RecordingClass;

    let videoUrl = recording.video_url;
    let expiresAt: string | null = null;

    if (recording.storage_path) {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: recording.storage_path,
      });

      videoUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      expiresAt = new Date(Date.now() + 3600000).toISOString();
    }

    return NextResponse.json({
      recording: {
        id: recording.id,
        title: recording.title,
        class_id: recording.class_id,
        video_url: recording.video_url,
        storage_path: recording.storage_path,
        duration: recording.duration,
        processing_status: recording.processing_status,
        uploaded_at: recording.uploaded_at,
      },
      videoUrl,
      expiresAt,
      className: recordingClass.name,
      classSlug: recordingClass.slug,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch recording';
    console.error('Error fetching recording:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
