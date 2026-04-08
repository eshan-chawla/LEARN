'use client';

import { BookAskAIPanel } from '@/components/BookAskAIPanel';
import { BookNotesPanel } from '@/components/BookNotesPanel';
import { ProfileMenu } from '@/components/ProfileMenu';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

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

interface Note {
  id: string;
  class_id: string;
  user_id: string;
  content: string | null;
  updated_at: string;
}

type RightPanelMode = 'ask-ai' | 'notes';

const DEFAULT_AI_PANEL_WIDTH = 384;
const MIN_AI_PANEL_WIDTH = 320;
const MAX_AI_PANEL_WIDTH = 720;
const MIN_VIEWER_WIDTH = 420;
const AI_PANEL_WIDTH_STORAGE_KEY = 'smart-learn-book-ask-ai-width';
const AI_PANEL_OPEN_STORAGE_KEY_PREFIX = 'smart-learn-book-ask-ai-open';
const RIGHT_PANEL_MODE_STORAGE_KEY_PREFIX = 'smart-learn-book-right-panel-mode';

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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'object' && error !== null) {
    if ('message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }

    if ('details' in error) {
      const details = (error as { details?: unknown }).details;
      if (typeof details === 'string' && details.trim()) return details;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Ignore serialization issues and use the fallback below.
    }
  }

  return fallback;
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
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode | null>(null);
  const [aiPanelWidth, setAiPanelWidth] = useState(DEFAULT_AI_PANEL_WIDTH);
  const [isAiPanelResizing, setIsAiPanelResizing] = useState(false);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [notesLoading, setNotesLoading] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadingRef = useRef(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingAiPanelWidthRef = useRef(aiPanelWidth);
  const accessTokenRef = useRef<string | null>(null);
  const classIdRef = useRef<string | null>(null);
  const noteContentRef = useRef('');
  const currentNoteContentRef = useRef('');

  const requestedTimestamp =
    parseTimestampParam(searchParams?.get('t')) ??
    parseTimestampParam(searchParams?.get('timestamp'));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedWidth = window.localStorage.getItem(AI_PANEL_WIDTH_STORAGE_KEY);
    if (!storedWidth) return;

    const parsedWidth = Number(storedWidth);
    if (Number.isFinite(parsedWidth)) {
      setAiPanelWidth(Math.max(MIN_AI_PANEL_WIDTH, Math.min(MAX_AI_PANEL_WIDTH, parsedWidth)));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AI_PANEL_WIDTH_STORAGE_KEY, String(aiPanelWidth));
  }, [aiPanelWidth]);

  useEffect(() => {
    if (typeof window === 'undefined' || !slug) return;

    const shouldOpenFromQuery = searchParams?.get('ask-ai') === 'open';
    if (shouldOpenFromQuery) {
      setRightPanelMode('ask-ai');
      return;
    }

    const modeKey = `${RIGHT_PANEL_MODE_STORAGE_KEY_PREFIX}:${slug}`;
    const storedMode = window.sessionStorage.getItem(modeKey);

    if (storedMode === 'ask-ai' || storedMode === 'notes') {
      setRightPanelMode(storedMode);
      return;
    }

    const legacyValue = window.sessionStorage.getItem(
      `${AI_PANEL_OPEN_STORAGE_KEY_PREFIX}:${slug}`
    );
    setRightPanelMode(legacyValue === 'true' ? 'ask-ai' : null);
  }, [searchParams, slug]);

  useEffect(() => {
    if (typeof window === 'undefined' || !slug) return;

    const modeKey = `${RIGHT_PANEL_MODE_STORAGE_KEY_PREFIX}:${slug}`;
    if (rightPanelMode) {
      window.sessionStorage.setItem(modeKey, rightPanelMode);
    } else {
      window.sessionStorage.removeItem(modeKey);
    }

    window.sessionStorage.setItem(
      `${AI_PANEL_OPEN_STORAGE_KEY_PREFIX}:${slug}`,
      rightPanelMode === 'ask-ai' ? 'true' : 'false'
    );
  }, [rightPanelMode, slug]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    pendingAiPanelWidthRef.current = aiPanelWidth;
  }, [aiPanelWidth]);

  useEffect(() => {
    noteContentRef.current = noteContent;
  }, [noteContent]);

  useEffect(() => {
    currentNoteContentRef.current = currentNote?.content || '';
  }, [currentNote]);

  useEffect(() => {
    classIdRef.current = recordingResponse?.recording.class_id ?? null;
  }, [recordingResponse?.recording.class_id]);

  useEffect(() => {
    let active = true;

    if (!auth.user) {
      accessTokenRef.current = null;
      return;
    }

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) {
        accessTokenRef.current = session?.access_token ?? null;
      }
    });

    return () => {
      active = false;
    };
  }, [auth.user]);

  const loadRecording = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No authentication token');
      }

      accessTokenRef.current = session.access_token;

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

  const loadNote = useCallback(async (classId: string) => {
    if (!auth.user) return;

    try {
      setNotesLoading(true);
      setNoteError(null);

      const { data, error } = await supabase
        .from('notes')
        .select('id, class_id, user_id, content, updated_at')
        .eq('class_id', classId)
        .eq('user_id', auth.user.id)
        .maybeSingle();

      if (error) throw error;

      const nextNote = (data as Note | null) ?? null;
      setCurrentNote(nextNote);
      setNoteContent(nextNote?.content || '');
    } catch (loadNoteError: unknown) {
      console.error('Error loading notes:', loadNoteError);
      setCurrentNote(null);
      setNoteContent('');
      setNoteError(getErrorMessage(loadNoteError, 'Failed to load notes'));
    } finally {
      setNotesLoading(false);
    }
  }, [auth.user]);

  const persistNote = useCallback(async (content: string, options?: { background?: boolean }) => {
    const classId = classIdRef.current;
    if (!classId || !auth.user) return true;

    const payload = {
      classId,
      content,
    };

    if (options?.background) {
      const token = accessTokenRef.current;
      if (!token) return false;

      fetch('/api/notes/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch((backgroundError) => {
        console.error('Background note save error:', backgroundError);
      });

      return true;
    }

    setSavingNote(true);
    setNoteError(null);

    try {
      const { data, error } = await supabase
        .from('notes')
        .upsert(
          {
            class_id: classId,
            user_id: auth.user.id,
            content,
          },
          {
            onConflict: 'class_id,user_id',
          }
        )
        .select()
        .single();

      if (error || !data) throw error || new Error('Failed to save note');

      setCurrentNote(data as Note);
      return true;
    } catch (saveError: unknown) {
      console.error('Error saving note:', saveError);
      setNoteError(getErrorMessage(saveError, 'Failed to save note'));
      return false;
    } finally {
      setSavingNote(false);
    }
  }, [auth.user]);

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  useEffect(() => {
    if (auth.user && recordingId) {
      void loadRecording();
    }
  }, [auth.user, recordingId, loadRecording]);

  useEffect(() => {
    if (auth.user && recordingResponse?.recording.class_id) {
      void loadNote(recordingResponse.recording.class_id);
    }
  }, [auth.user, recordingResponse?.recording.class_id, loadNote]);

  const jumpToTimestamp = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(seconds) || seconds < 0) return;

    const seekToTimestamp = () => {
      const maxTime = Number.isFinite(video.duration)
        ? Math.max(video.duration - 0.25, 0)
        : seconds;
      video.currentTime = Math.max(0, Math.min(seconds, maxTime));
    };

    if (video.readyState >= 1) {
      seekToTimestamp();
      return;
    }

    video.addEventListener('loadedmetadata', seekToTimestamp, { once: true });
  }, []);

  useEffect(() => {
    if (requestedTimestamp !== null) {
      jumpToTimestamp(requestedTimestamp);
    }
  }, [jumpToTimestamp, requestedTimestamp, recordingResponse?.videoUrl]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoAspectRatio(video.videoWidth / video.videoHeight);
    }
  }, []);

  const handleAiPanelResizeStart = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (typeof window === 'undefined') return;

    event.preventDefault();
    setIsAiPanelResizing(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const layoutBounds = layoutRef.current?.getBoundingClientRect();
      if (!layoutBounds) return;

      const maxAvailableWidth = Math.max(
        MIN_AI_PANEL_WIDTH,
        Math.min(MAX_AI_PANEL_WIDTH, layoutBounds.width - MIN_VIEWER_WIDTH)
      );
      const rawWidth = layoutBounds.right - moveEvent.clientX;
      const nextWidth = Math.max(MIN_AI_PANEL_WIDTH, Math.min(maxAvailableWidth, rawWidth));

      pendingAiPanelWidthRef.current = nextWidth;

      if (resizeFrameRef.current !== null) return;

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        setAiPanelWidth(pendingAiPanelWidthRef.current);
      });
    };

    const handleMouseUp = () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }

      setAiPanelWidth(pendingAiPanelWidthRef.current);
      setIsAiPanelResizing(false);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      resizeCleanupRef.current = null;
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    resizeCleanupRef.current = handleMouseUp;
  }, []);

  const savedNoteContent = currentNote?.content || '';
  const hasUnsavedNoteChanges = noteContent !== savedNoteContent;

  const backgroundSaveNote = useCallback(() => {
    const currentClassId = classIdRef.current;
    if (!currentClassId) return;

    const latestContent = noteContentRef.current;
    const storedContent = currentNoteContentRef.current;
    if (latestContent === storedContent) return;

    void persistNote(latestContent, { background: true });
  }, [persistNote]);

  const handleRightPanelModeChange = useCallback(async (nextMode: RightPanelMode | null) => {
    if (nextMode === rightPanelMode) {
      if (rightPanelMode === 'notes' && hasUnsavedNoteChanges) {
        const saved = await persistNote(noteContent);
        if (!saved) return;
      }

      setRightPanelMode(null);
      return;
    }

    if (rightPanelMode === 'notes' && nextMode !== 'notes' && hasUnsavedNoteChanges) {
      const saved = await persistNote(noteContent);
      if (!saved) return;
    }

    setRightPanelMode(nextMode);
  }, [hasUnsavedNoteChanges, noteContent, persistNote, rightPanelMode]);

  const handleSaveNote = useCallback(async () => {
    await persistNote(noteContent);
  }, [noteContent, persistNote]);

  useEffect(() => {
    const handlePageHide = (event?: PageTransitionEvent | Event) => {
      if (event?.type === 'visibilitychange' && document.visibilityState !== 'hidden') {
        return;
      }

      backgroundSaveNote();
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handlePageHide);

    return () => {
      handlePageHide();
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handlePageHide);
    };
  }, [backgroundSaveNote]);

  if (auth.loading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,rgba(246,243,237,0.94),rgba(240,236,229,0.98))]">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-stone-700" />
          <p className="mt-2 text-stone-600">Loading video...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,rgba(246,243,237,0.94),rgba(240,236,229,0.98))] p-4">
        <div className="w-full max-w-md rounded-[28px] border border-stone-200 bg-white/90 p-6 shadow-[0_24px_80px_rgba(28,25,23,0.12)]">
          <div className="mb-4 flex items-center gap-3">
            <svg className="h-12 w-12 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-lg font-semibold text-stone-900">Error Loading Video</h3>
              <p className="mt-1 text-sm text-stone-600">{error}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void loadRecording()}
              className="flex-1 rounded-2xl bg-stone-900 px-4 py-2.5 text-white transition hover:bg-stone-800"
            >
              Retry
            </button>
            <Link
              href={`/dashboard/class/${slug}?tab=recordings`}
              className="flex-1 rounded-2xl border border-stone-300 bg-stone-100 px-4 py-2.5 text-center text-stone-700 transition hover:bg-stone-200"
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

  const notesPanelOpen = rightPanelMode === 'notes';
  const aiPanelOpen = rightPanelMode === 'ask-ai';

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(246,243,237,0.94),rgba(240,236,229,0.98))] text-stone-900">
      <header className="z-30 flex-shrink-0 border-b border-stone-200/80 bg-[rgba(248,244,238,0.92)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Link
              href={`/dashboard/class/${recordingResponse.classSlug || slug}?tab=recordings`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 bg-white/80 text-stone-700 shadow-[0_12px_30px_rgba(28,25,23,0.08)] transition hover:border-stone-300 hover:bg-white"
              title="Back to videos"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">
                <Link href="/dashboard" className="transition hover:text-stone-700">
                  <span>Smart Learn Viewer</span>
                </Link>
                <span className="hidden h-1 w-1 rounded-full bg-stone-300 sm:block" />
                <Link
                  href={`/dashboard/class/${recordingResponse.classSlug || slug}?tab=recordings`}
                  className="hidden transition hover:text-stone-700 sm:block"
                >
                  <span>{recordingResponse.className}</span>
                </Link>
              </div>
              <div className="mt-1 min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-stone-900 sm:text-2xl">
                  {recordingResponse.recording.title}
                </h1>
              </div>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3 self-start md:self-auto">
            <button
              type="button"
              onClick={() => {
                void handleRightPanelModeChange('notes');
              }}
              className={`inline-flex h-11 items-center gap-2 rounded-2xl border px-3 text-sm font-medium shadow-[0_12px_30px_rgba(28,25,23,0.08)] transition ${notesPanelOpen ? 'border-stone-900 bg-stone-900 text-stone-50' : 'border-stone-200 bg-white/80 text-stone-700 hover:border-stone-300 hover:bg-white'}`}
              aria-label={notesPanelOpen ? 'Close Notes panel' : 'Open Notes panel'}
              title={notesPanelOpen ? 'Close Notes panel' : 'Open Notes panel'}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.9}
                  d="M7.75 4.75h7.5A1.75 1.75 0 0 1 17 6.5v11a1.75 1.75 0 0 1-1.75 1.75h-7.5A1.75 1.75 0 0 1 6 17.5v-11a1.75 1.75 0 0 1 1.75-1.75ZM9 8.25h6M9 12h6M9 15.75h3.5"
                />
              </svg>
              <span className="hidden sm:inline">Notes</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void handleRightPanelModeChange('ask-ai');
              }}
              className={`inline-flex h-11 items-center gap-2 rounded-2xl border px-3 text-sm font-medium shadow-[0_12px_30px_rgba(28,25,23,0.08)] transition ${aiPanelOpen ? 'border-stone-900 bg-stone-900 text-stone-50' : 'border-stone-200 bg-white/80 text-stone-700 hover:border-stone-300 hover:bg-white'}`}
              aria-label={aiPanelOpen ? 'Close Ask AI panel' : 'Open Ask AI panel'}
              title={aiPanelOpen ? 'Close Ask AI panel' : 'Open Ask AI panel'}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.9}
                  d="M12 3l1.9 5.85h6.15l-4.98 3.62 1.9 5.85L12 14.7 7.03 18.32l1.9-5.85L3.95 8.85H10.1L12 3z"
                />
              </svg>
              <span className="hidden sm:inline">Ask AI</span>
            </button>
            <ProfileMenu />
          </div>
        </div>
      </header>

      <div ref={layoutRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        {isAiPanelResizing && (
          <div
            className="absolute inset-0 z-10 hidden cursor-col-resize md:block"
            aria-hidden="true"
          />
        )}

        {rightPanelMode !== null && (
          <button
            type="button"
            className="absolute inset-0 z-10 bg-stone-950/20 backdrop-blur-[1px] md:hidden"
            onClick={() => {
              void handleRightPanelModeChange(null);
            }}
            aria-label="Close right panel"
          />
        )}

        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6">
          <div className="flex h-full min-h-0 items-center justify-center">
            <div
              className="w-full max-w-full overflow-hidden rounded-[28px] border border-stone-200/80 bg-black shadow-[0_24px_80px_rgba(28,25,23,0.18)]"
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

        <BookAskAIPanel
          bookId={recordingId}
          classId={recordingResponse.recording.class_id}
          classSlug={slug}
          bookTitle={recordingResponse.recording.title}
          moduleBookIds={[]}
          pdfSourceMeta={{}}
          hasModuleScope={false}
          sourceKind="video"
          askAiPath={`/api/recordings/${recordingId}/ask-ai`}
          open={aiPanelOpen}
          desktopWidth={aiPanelWidth}
          resizing={isAiPanelResizing}
          onClose={() => {
            void handleRightPanelModeChange(null);
          }}
          onJumpToTimestamp={jumpToTimestamp}
          onResizeStart={handleAiPanelResizeStart}
        />

        <BookNotesPanel
          open={notesPanelOpen}
          desktopWidth={aiPanelWidth}
          resizing={isAiPanelResizing}
          loading={notesLoading}
          noteContent={noteContent}
          saving={savingNote}
          error={noteError}
          lastUpdated={currentNote?.updated_at ?? null}
          onClose={() => {
            void handleRightPanelModeChange(null);
          }}
          onChange={(value) => {
            setNoteContent(value);
            if (noteError) setNoteError(null);
          }}
          onSave={() => {
            void handleSaveNote();
          }}
          onResizeStart={handleAiPanelResizeStart}
        />
      </div>
    </div>
  );
}
