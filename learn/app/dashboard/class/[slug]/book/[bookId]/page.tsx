'use client';

import { BookAskAIPanel } from '@/components/BookAskAIPanel';
import { BookNotesPanel } from '@/components/BookNotesPanel';
import { ProfileMenu } from '@/components/ProfileMenu';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { supabase } from '@/lib/supabase';

interface BookData {
  id: string;
  title: string;
  class_id: string;
  section_id?: string | null;
  processing_status: string;
  storage_path: string;
  uploaded_at: string;
}

interface BookSectionData {
  id: string;
  class_id: string;
  title: string;
  position: number;
}

interface SidebarBookData {
  id: string;
  class_id: string;
  section_id: string | null;
  title: string;
  position: number;
  processing_status: string;
  uploaded_at: string;
}

interface BookResponse {
  book: BookData;
  pdfUrl: string;
  expiresAt: string;
  className: string;
  classSlug: string;
}

interface Note {
  id: string;
  class_id: string;
  user_id: string;
  content: string | null;
  updated_at: string;
}

interface OrganizedSidebarSection extends BookSectionData {
  books: SidebarBookData[];
}

type RightPanelMode = 'ask-ai' | 'notes';

const bookStatusAccent: Record<string, string> = {
  completed: 'bg-emerald-500',
  processing: 'bg-amber-500',
  pending: 'bg-stone-400',
  failed: 'bg-rose-500',
};

const DEFAULT_AI_PANEL_WIDTH = 384;
const MIN_AI_PANEL_WIDTH = 320;
const MAX_AI_PANEL_WIDTH = 720;
const MIN_VIEWER_WIDTH = 420;
const AI_PANEL_WIDTH_STORAGE_KEY = 'smart-learn-book-ask-ai-width';
const AI_PANEL_OPEN_STORAGE_KEY_PREFIX = 'smart-learn-book-ask-ai-open';
const RIGHT_PANEL_MODE_STORAGE_KEY_PREFIX = 'smart-learn-book-right-panel-mode';

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

export default function BookViewerPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const bookId = params?.bookId as string;
  const slug = params?.slug as string;

  const [bookResponse, setBookResponse] = useState<BookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState('');
  const [viewerBaseUrl, setViewerBaseUrl] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode | null>(null);
  const [aiPanelWidth, setAiPanelWidth] = useState(DEFAULT_AI_PANEL_WIDTH);
  const [isAiPanelResizing, setIsAiPanelResizing] = useState(false);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [bookSections, setBookSections] = useState<BookSectionData[]>([]);
  const [sidebarBooks, setSidebarBooks] = useState<SidebarBookData[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [notesLoading, setNotesLoading] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const loadedBookIdRef = useRef<string | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingAiPanelWidthRef = useRef(aiPanelWidth);
  const accessTokenRef = useRef<string | null>(null);
  const classIdRef = useRef<string | null>(null);
  const noteContentRef = useRef('');
  const currentNoteContentRef = useRef('');

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

    const nextStorageKey = `${RIGHT_PANEL_MODE_STORAGE_KEY_PREFIX}:${slug}`;
    const storedMode = window.sessionStorage.getItem(nextStorageKey);

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
    classIdRef.current = bookResponse?.book.class_id ?? null;
  }, [bookResponse?.book.class_id]);

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

  const loadSidebar = useCallback(async (classId: string, currentBookId: string) => {
    try {
      setSidebarLoading(true);

      const [sectionsResult, booksResult] = await Promise.all([
        supabase
          .from('book_sections')
          .select('id, class_id, title, position')
          .eq('class_id', classId)
          .order('position', { ascending: true }),
        supabase
          .from('books')
          .select('id, class_id, section_id, title, position, processing_status, uploaded_at')
          .eq('class_id', classId)
          .order('position', { ascending: true })
          .order('uploaded_at', { ascending: true }),
      ]);

      if (sectionsResult.error) throw sectionsResult.error;
      if (booksResult.error) throw booksResult.error;

      const nextSections = (sectionsResult.data || []) as BookSectionData[];
      const nextBooks = (booksResult.data || []) as SidebarBookData[];
      const currentBook = nextBooks.find((candidate) => candidate.id === currentBookId);

      setBookSections(nextSections);
      setSidebarBooks(nextBooks);
      setExpandedSections((current) => {
        const nextState: Record<string, boolean> = {};

        for (const section of nextSections) {
          nextState[section.id] = current[section.id] ?? section.id === currentBook?.section_id;
        }

        if (nextBooks.some((candidate) => candidate.section_id === null)) {
          nextState.unassigned = current.unassigned ?? currentBook?.section_id === null;
        }

        return nextState;
      });
    } catch (sidebarError) {
      console.error('Error loading sidebar:', sidebarError);
    } finally {
      setSidebarLoading(false);
    }
  }, []);

  const loadBook = useCallback(async (forceReload = false) => {
    if (loadingRef.current) return;
    if (!forceReload && loadedBookIdRef.current === bookId) return;

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

      const response = await fetch(`/api/books/${bookId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load book');
      }

      const data: BookResponse = await response.json();

      if (data.book.processing_status === 'processing') {
        setError('This book is currently being processed. Please check back in a few minutes.');
        setLoading(false);
        return;
      }

      if (data.book.processing_status === 'failed') {
        console.warn('Book processing failed, but allowing PDF viewing');
      }

      setBookResponse(data);
      loadedBookIdRef.current = bookId;
      await loadSidebar(data.book.class_id, data.book.id);

      const proxyUrl = `/api/proxy-pdf?url=${encodeURIComponent(data.pdfUrl)}`;
      const encodedProxyUrl = encodeURIComponent(proxyUrl);
      const pageParam = searchParams?.get('page');
      const nextViewerBaseUrl = `/pdfjs/web/viewer.html?file=${encodedProxyUrl}`;

      setViewerBaseUrl(nextViewerBaseUrl);

      if (pageParam) {
        setViewerUrl(`${nextViewerBaseUrl}#page=${pageParam}`);
      } else {
        setViewerUrl(nextViewerBaseUrl);
      }

      setLoading(false);
    } catch (err: unknown) {
      console.error('Error loading book:', err);
      setError(err instanceof Error ? err.message : 'Failed to load book');
      setLoading(false);
    } finally {
      loadingRef.current = false;
    }
  }, [bookId, loadSidebar, searchParams]);

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
    if (auth.user && bookId) {
      void loadBook();
    }
  }, [auth.user, bookId, loadBook]);

  useEffect(() => {
    if (auth.user && bookResponse?.book.class_id) {
      void loadNote(bookResponse.book.class_id);
    }
  }, [auth.user, bookResponse?.book.class_id, loadNote]);

  const toggleSection = (sectionKey: string) => {
    setExpandedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  };

  const jumpToPage = useCallback((pageNumber: number) => {
    if (!viewerBaseUrl || !Number.isFinite(pageNumber) || pageNumber < 1) return;
    setViewerUrl(`${viewerBaseUrl}#page=${Math.trunc(pageNumber)}`);
  }, [viewerBaseUrl]);

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
          <p className="mt-2 text-stone-600">Loading book...</p>
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
              <h3 className="text-lg font-semibold text-stone-900">Error Loading Book</h3>
              <p className="mt-1 text-sm text-stone-600">{error}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void loadBook(true)}
              className="flex-1 rounded-2xl bg-stone-900 px-4 py-2.5 text-white transition hover:bg-stone-800"
            >
              Retry
            </button>
            <Link
              href={`/dashboard/class/${slug}?tab=books`}
              className="flex-1 rounded-2xl border border-stone-300 bg-stone-100 px-4 py-2.5 text-center text-stone-700 transition hover:bg-stone-200"
            >
              Back to Class
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!bookResponse || !auth.user) {
    return null;
  }

  const organizedSections: OrganizedSidebarSection[] = bookSections.map((section) => ({
    ...section,
    books: sidebarBooks
      .filter((candidate) => candidate.section_id === section.id)
      .sort((left, right) => left.position - right.position),
  }));
  const sectionTitleById = Object.fromEntries(
    bookSections.map((section) => [section.id, section.title])
  ) as Record<string, string>;
  const unassignedBooks = sidebarBooks
    .filter((candidate) => candidate.section_id === null)
    .sort((left, right) => left.position - right.position);
  const currentSectionId =
    sidebarBooks.find((candidate) => candidate.id === bookId)?.section_id ??
    bookResponse.book.section_id ??
    null;
  const currentModuleBookIds = currentSectionId
    ? sidebarBooks
        .filter((candidate) => candidate.section_id === currentSectionId)
        .map((candidate) => candidate.id)
    : [];
  const pdfSourceMeta = Object.fromEntries(
    sidebarBooks.map((candidate) => [
      candidate.id,
      {
        title: candidate.title,
        moduleTitle: candidate.section_id ? sectionTitleById[candidate.section_id] || null : 'Unassigned',
      },
    ])
  );
  const notesPanelOpen = rightPanelMode === 'notes';
  const aiPanelOpen = rightPanelMode === 'ask-ai';

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(246,243,237,0.94),rgba(240,236,229,0.98))] text-stone-900">
      <header className="z-30 flex-shrink-0 border-b border-stone-200/80 bg-[rgba(248,244,238,0.92)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/dashboard/class/${bookResponse.classSlug || slug}?tab=books`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 bg-white/80 text-stone-700 shadow-[0_12px_30px_rgba(28,25,23,0.08)] transition hover:border-stone-300 hover:bg-white"
              title="Back to books"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">
                <Link href="/dashboard" className="transition hover:text-stone-700">
                  <span>Smart Learn Reader</span>
                </Link>
                <span className="hidden h-1 w-1 rounded-full bg-stone-300 sm:block" />
                <Link
                  href={`/dashboard/class/${bookResponse.classSlug || slug}?tab=books`}
                  className="hidden transition hover:text-stone-700 sm:block"
                >
                  <span>{bookResponse.className}</span>
                </Link>
              </div>
              <div className="mt-1 min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-stone-900 sm:text-2xl">
                  {bookResponse.book.title}
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center">
            <div className="flex items-center gap-3">
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
        </div>
      </header>

      <div ref={layoutRef} className="relative flex min-h-0 flex-1 overflow-hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen((current) => !current)}
          className="absolute left-0 top-1/2 z-30 inline-flex h-14 w-8 -translate-y-1/2 items-center justify-center rounded-r-2xl border border-l-0 border-stone-200 bg-white/92 text-stone-700 shadow-[0_12px_30px_rgba(28,25,23,0.14)] transition hover:border-stone-300 hover:bg-white"
          aria-label={sidebarOpen ? 'Collapse modules panel' : 'Open modules panel'}
          title={sidebarOpen ? 'Collapse modules panel' : 'Open modules panel'}
        >
          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {sidebarOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M15 19l-7-7 7-7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 5l7 7-7 7" />
            )}
          </svg>
        </button>

        {isAiPanelResizing && (
          <div
            className="absolute inset-0 z-10 hidden cursor-col-resize md:block"
            aria-hidden="true"
          />
        )}

        {sidebarOpen && (
          <button
            type="button"
            className="absolute inset-0 z-10 bg-stone-950/20 backdrop-blur-[1px] md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigator"
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

        <aside
          className={`absolute inset-y-0 left-0 z-20 flex w-[19rem] flex-col overflow-hidden bg-[rgba(247,243,236,0.98)] transition-[transform,width,opacity,box-shadow,border-color] duration-300 md:relative md:inset-y-auto md:left-auto md:z-0 md:flex-shrink-0 md:translate-x-0 ${sidebarOpen ? 'pointer-events-auto translate-x-0 border-r border-stone-200/80 opacity-100 shadow-[0_24px_60px_rgba(28,25,23,0.14)] md:w-[19rem] md:shadow-none' : 'pointer-events-none -translate-x-full border-r border-transparent opacity-100 md:w-0 md:translate-x-0 md:border-r-0 md:opacity-0 md:shadow-none'}`}
          aria-hidden={!sidebarOpen}
        >
          <div className="border-b border-stone-200/80 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Modules</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {sidebarLoading ? (
              <div className="space-y-3 px-2 py-2">
                {[0, 1, 2].map((placeholder) => (
                  <div key={placeholder} className="animate-pulse rounded-2xl border border-stone-200/80 bg-white/70 p-4">
                    <div className="h-3 w-24 rounded-full bg-stone-200" />
                    <div className="mt-3 h-2.5 w-full rounded-full bg-stone-100" />
                    <div className="mt-2 h-2.5 w-4/5 rounded-full bg-stone-100" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {organizedSections.map((section) => {
                  const isExpanded = expandedSections[section.id];

                  return (
                    <section key={section.id} className="overflow-hidden rounded-[24px] border border-stone-200/80 bg-white/78 shadow-[0_12px_30px_rgba(28,25,23,0.05)]">
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-white/75"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">
                            Module
                          </p>
                          <h2 className="mt-1 truncate text-sm font-semibold text-stone-800">
                            {section.title}
                          </h2>
                        </div>
                        <svg
                          className={`h-4 w-4 flex-shrink-0 text-stone-500 transition-transform ${isExpanded ? 'rotate-90' : 'rotate-0'}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>

                      <div className={`grid transition-[grid-template-rows] duration-300 ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className="overflow-hidden">
                          <div className="space-y-1.5 px-3 pb-3">
                            {section.books.length > 0 ? (
                              section.books.map((book) => {
                                const isActive = book.id === bookId;

                                return (
                                  <Link
                                    key={book.id}
                                    href={`/dashboard/class/${slug}/book/${book.id}`}
                                    className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition ${isActive ? 'bg-stone-900 text-stone-50 shadow-[0_16px_30px_rgba(28,25,23,0.22)]' : 'bg-stone-50/80 text-stone-700 hover:bg-white'}`}
                                  >
                                    <span className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${isActive ? 'bg-stone-100' : bookStatusAccent[book.processing_status] || 'bg-stone-400'}`} />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium">
                                        {book.title}
                                      </span>
                                      <span className={`mt-1 block text-xs ${isActive ? 'text-stone-300' : 'text-stone-500'}`}>
                                        {book.processing_status === 'completed' ? 'Ready to read' : book.processing_status}
                                      </span>
                                    </span>
                                  </Link>
                                );
                              })
                            ) : (
                              <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/70 px-3 py-4 text-sm text-stone-500">
                                No books in this module yet.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })}

                {unassignedBooks.length > 0 && (
                  <section className="overflow-hidden rounded-[24px] border border-stone-200/80 bg-white/78 shadow-[0_12px_30px_rgba(28,25,23,0.05)]">
                    <button
                      type="button"
                      onClick={() => toggleSection('unassigned')}
                      className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-white/75"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">Loose books</p>
                        <h2 className="mt-1 truncate text-sm font-semibold text-stone-800">Unassigned</h2>
                      </div>
                      <svg
                        className={`h-4 w-4 flex-shrink-0 text-stone-500 transition-transform ${expandedSections.unassigned ? 'rotate-90' : 'rotate-0'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>

                    <div className={`grid transition-[grid-template-rows] duration-300 ${expandedSections.unassigned ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                      <div className="overflow-hidden">
                        <div className="space-y-1.5 px-3 pb-3">
                          {unassignedBooks.map((book) => {
                            const isActive = book.id === bookId;

                            return (
                              <Link
                                key={book.id}
                                href={`/dashboard/class/${slug}/book/${book.id}`}
                                className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition ${isActive ? 'bg-stone-900 text-stone-50 shadow-[0_16px_30px_rgba(28,25,23,0.22)]' : 'bg-stone-50/80 text-stone-700 hover:bg-white'}`}
                              >
                                <span className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${isActive ? 'bg-stone-100' : bookStatusAccent[book.processing_status] || 'bg-stone-400'}`} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{book.title}</span>
                                  <span className={`mt-1 block text-xs ${isActive ? 'text-stone-300' : 'text-stone-500'}`}>
                                    {book.processing_status === 'completed' ? 'Ready to read' : book.processing_status}
                                  </span>
                                </span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {!sidebarLoading && organizedSections.length === 0 && unassignedBooks.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-stone-200 bg-white/75 px-4 py-5 text-sm leading-6 text-stone-500">
                    This class does not have any other books to browse yet.
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3 sm:p-4">
          <div className="h-full overflow-hidden rounded-[28px] border border-stone-200/80 bg-white shadow-[0_24px_80px_rgba(28,25,23,0.10)]">
            {viewerUrl && (
              <iframe
                key={bookId}
                src={viewerUrl}
                className="h-full w-full border-0"
                title={bookResponse.book.title}
              />
            )}
          </div>
        </div>

        <BookAskAIPanel
          bookId={bookId}
          classId={bookResponse.book.class_id}
          classSlug={slug}
          bookTitle={bookResponse.book.title}
          moduleBookIds={currentModuleBookIds}
          pdfSourceMeta={pdfSourceMeta}
          hasModuleScope={currentSectionId !== null}
          open={aiPanelOpen}
          desktopWidth={aiPanelWidth}
          resizing={isAiPanelResizing}
          onClose={() => {
            void handleRightPanelModeChange(null);
          }}
          onJumpToPage={jumpToPage}
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
