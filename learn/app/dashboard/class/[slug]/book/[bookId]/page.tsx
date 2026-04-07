'use client';

import { BookAskAIPanel } from '@/components/BookAskAIPanel';
import { ProfileMenu } from '@/components/ProfileMenu';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
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

interface OrganizedSidebarSection extends BookSectionData {
  books: SidebarBookData[];
}

const bookStatusAccent: Record<string, string> = {
  completed: 'bg-emerald-500',
  processing: 'bg-amber-500',
  pending: 'bg-stone-400',
  failed: 'bg-rose-500',
};

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
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [bookSections, setBookSections] = useState<BookSectionData[]>([]);
  const [sidebarBooks, setSidebarBooks] = useState<SidebarBookData[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const loadingRef = useRef(false);
  const loadedBookIdRef = useRef<string | null>(null);

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
  const unassignedBooks = sidebarBooks
    .filter((candidate) => candidate.section_id === null)
    .sort((left, right) => left.position - right.position);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(246,243,237,0.94),rgba(240,236,229,0.98))] text-stone-900">
      <header className="z-30 flex-shrink-0 border-b border-stone-200/80 bg-[rgba(248,244,238,0.92)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((current) => !current)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 bg-white/80 text-stone-700 shadow-[0_12px_30px_rgba(28,25,23,0.08)] transition hover:border-stone-300 hover:bg-white"
              aria-label={sidebarOpen ? 'Collapse navigator' : 'Open navigator'}
              title={sidebarOpen ? 'Collapse navigator' : 'Open navigator'}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {sidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M15 19l-7-7 7-7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
            <div className="min-w-0">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500 transition hover:text-stone-700"
              >
                <span>Smart Learn Reader</span>
                <span className="hidden h-1 w-1 rounded-full bg-stone-300 sm:block" />
                <span className="hidden sm:block">{bookResponse.className}</span>
              </Link>
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
                onClick={() => setAiPanelOpen((current) => !current)}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-stone-200 bg-white/80 px-3 text-sm font-medium text-stone-700 shadow-[0_12px_30px_rgba(28,25,23,0.08)] transition hover:border-stone-300 hover:bg-white"
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

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <button
            type="button"
            className="absolute inset-0 z-10 bg-stone-950/20 backdrop-blur-[1px] md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigator"
          />
        )}

        {aiPanelOpen && (
          <button
            type="button"
            className="absolute inset-0 z-10 bg-stone-950/20 backdrop-blur-[1px] md:hidden"
            onClick={() => setAiPanelOpen(false)}
            aria-label="Close Ask AI panel"
          />
        )}

        <aside
          className={`absolute inset-y-0 left-0 z-20 flex w-[19rem] flex-col overflow-hidden bg-[rgba(247,243,236,0.98)] transition-[transform,width,opacity,box-shadow,border-color] duration-300 md:relative md:inset-y-auto md:left-auto md:z-0 md:flex-shrink-0 md:translate-x-0 ${sidebarOpen ? 'pointer-events-auto translate-x-0 border-r border-stone-200/80 opacity-100 shadow-[0_24px_60px_rgba(28,25,23,0.14)] md:w-[19rem] md:shadow-none' : 'pointer-events-none -translate-x-full border-r border-transparent opacity-100 md:w-0 md:translate-x-0 md:border-r-0 md:opacity-0 md:shadow-none'}`}
          aria-hidden={!sidebarOpen}
        >
          <div className="border-b border-stone-200/80 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Modules</p>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Browse the class library from here while keeping the reader in view.
            </p>
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
          bookTitle={bookResponse.book.title}
          open={aiPanelOpen}
          onClose={() => setAiPanelOpen(false)}
          onJumpToPage={jumpToPage}
        />
      </div>
    </div>
  );
}
