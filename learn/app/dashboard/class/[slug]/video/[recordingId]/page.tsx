'use client';

import { ProfileMenu } from '@/components/ProfileMenu';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface RecordingData {
  id: string;
  title: string;
  class_id: string;
  video_url: string;
  storage_path: string | null;
  duration: number | null;
  processing_status: string;
  uploaded_at: string;
}

interface RecordingResponse {
  recording: RecordingData;
  videoUrl: string;
  expiresAt: string | null;
  className: string;
  classSlug: string | null;
}

function parseTimestampParam(value: string | null): number | null {
  if (!value) return null;

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const matches = [...trimmed.matchAll(/(\d+)(h|m|s)/g)];
  if (matches.length === 0) return null;

  let totalSeconds = 0;

  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2];

    if (unit === 'h') totalSeconds += amount * 3600;
    if (unit === 'm') totalSeconds += amount * 60;
    if (unit === 's') totalSeconds += amount;
  }

  return totalSeconds;
}

function formatDuration(duration: number | null) {
  if (!duration || duration < 0) return null;

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function VideoViewerPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const recordingId = params?.recordingId as string;
  const slug = params?.slug as string;

  const [recordingResponse, setRecordingResponse] = useState<RecordingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadingRef = useRef(false);

  const requestedTimestamp =
    parseTimestampParam(searchParams?.get('t')) ??
    parseTimestampParam(searchParams?.get('timestamp'));

  const loadRecording = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No authentication token');
      }

      const response = await fetch(`/api/recordings/${recordingId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load recording');
      }

      const data: RecordingResponse = await response.json();

      if (data.recording.processing_status === 'processing') {
        setError('This video is currently being processed. Please check back in a few minutes.');
        setLoading(false);
        loadingRef.current = false;
        return;
      }

      setRecordingResponse(data);
      setLoading(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load recording';
      console.error('Error loading recording:', err);
      setError(message);
      setLoading(false);
    } finally {
      loadingRef.current = false;
    }
  }, [recordingId]);

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  useEffect(() => {
    if (auth.user && recordingId) {
      loadRecording();
    }
  }, [auth.user, recordingId, loadRecording]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || requestedTimestamp === null) return;

    const seekToTimestamp = () => {
      const maxTime = Number.isFinite(video.duration) ? Math.max(video.duration - 0.25, 0) : requestedTimestamp;
      video.currentTime = Math.max(0, Math.min(requestedTimestamp, maxTime));
    };

    if (video.readyState >= 1) {
      seekToTimestamp();
      return;
    }

    video.addEventListener('loadedmetadata', seekToTimestamp, { once: true });
    return () => video.removeEventListener('loadedmetadata', seekToTimestamp);
  }, [requestedTimestamp, recordingResponse?.videoUrl]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoAspectRatio(video.videoWidth / video.videoHeight);
    }
  }, []);

  if (auth.loading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Loading video...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div className="flex items-center gap-3 mb-4">
            <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Error Loading Video</h3>
              <p className="text-sm text-gray-600 mt-1">{error}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={loadRecording}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
            <Link
              href={`/dashboard/class/${slug}`}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-center"
            >
              Back to Class
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!recordingResponse || !auth.user) {
    return null;
  }

  const timestampHint = requestedTimestamp !== null ? `Starting at ${requestedTimestamp}s` : 'Add ?t=90 or ?timestamp=1m30s to jump to a moment';
  const durationLabel = formatDuration(recordingResponse.recording.duration);

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50">
      <header className="bg-white shadow-sm border-b flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <Link
                href={`/dashboard/class/${slug}`}
                className="text-gray-600 hover:text-gray-900 transition-colors"
                title="Back to class"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div className="min-w-0">
                <p className="text-sm text-gray-600">{recordingResponse.className}</p>
                <h1 className="text-xl font-bold text-gray-900 truncate">{recordingResponse.recording.title}</h1>
                <p className="text-sm text-gray-500">
                  {timestampHint}
                  {durationLabel ? ` | ${durationLabel}` : ''}
                </p>
              </div>
            </div>
            <ProfileMenu />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 py-6 flex justify-center">
          <div
            className="w-full max-w-full rounded-xl overflow-hidden bg-black shadow-2xl"
            style={{
              aspectRatio: String(videoAspectRatio),
              width: `min(100%, calc((100vh - 10rem) * ${videoAspectRatio}))`,
            }}
          >
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              className="block h-full w-full bg-black"
              src={recordingResponse.videoUrl}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      </div>
    </div>
  );
}
