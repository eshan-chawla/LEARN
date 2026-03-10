import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';

const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

const BUCKET_NAME = process.env.AWS_S3_RECORDINGS_BUCKET!;

export async function POST(req: Request) {
    try {
        const { filename, contentType, classId, type } = await req.json();

        if (!filename || !contentType || !classId || !type) {
            return NextResponse.json(
                { error: 'filename, contentType, classId, and type are required' },
                { status: 400 }
            );
        }

        if (type !== 'video' && type !== 'pdf') {
            return NextResponse.json(
                { error: 'type must be "video" or "pdf"' },
                { status: 400 }
            );
        }

        const timestamp = Date.now();
        const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const folder = type === 'pdf' ? 'books' : 'videos';
        const key = `${folder}/${classId}/${timestamp}_${sanitized}`;

        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            ContentType: contentType,
        });

        // Pre-signed URL valid for 15 minutes — enough for large uploads
        const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

        // Public URL to access the asset after upload
        const publicUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

        return NextResponse.json({ presignedUrl, publicUrl, storagePath: key });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to generate presigned URL';
        console.error('Error generating presigned URL:', error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
