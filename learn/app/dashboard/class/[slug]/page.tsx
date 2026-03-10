'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/utils';
import { PdfUploadModal } from '@/components/PdfUploadModal';
import { VideoUploadModal } from '@/components/VideoUploadModal';
import { ProcessingStatusBadge } from '@/components/ProcessingStatusBadge';
import Link from 'next/link';

interface Class {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  user_id: string;
  slug?: string | null;
}

interface Recording {
  id: string;
  class_id: string;
  title: string;
  video_url: string;
  storage_path: string | null;
  duration: number | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  uploaded_at: string;
}

interface BookSection {
  id: string;
  class_id: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface Book {
  id: string;
  class_id: string;
  section_id: string | null;
  title: string;
  pdf_url: string;
  file_size: number | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  storage_path: string | null;
  position: number;
  uploaded_at: string;
}

interface Note {
  id: string;
  class_id: string;
  content: string | null;
  updated_at: string;
}

interface StudentViewer {
  user_id: string;
  email: string;
  name: string;
  can_edit: boolean;
  created_at: string;
}

interface BookUploadTarget {
  sectionId: string | null;
  startingPosition: number;
}

interface OrganizedBookSection extends BookSection {
  books: Book[];
}

type TabType = 'recordings' | 'books' | 'notes' | 'students';

const recordingStatusStyles: Record<Recording['processing_status'], { label: string; className: string; icon: ReactNode }> = {
  pending: {
    label: 'Queued',
    className: 'bg-gray-100 text-gray-700',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  processing: {
    label: 'Processing',
    className: 'bg-blue-100 text-blue-700',
    icon: (
      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    ),
  },
  completed: {
    label: 'Ready',
    className: 'bg-green-100 text-green-700',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-700',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  },
};

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return '—';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDuration(duration: number | null) {
  if (!duration || duration < 0) return '—';

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

    if ('hint' in error) {
      const hint = (error as { hint?: unknown }).hint;
      if (typeof hint === 'string' && hint.trim()) return hint;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Ignore serialization issues and use fallback below.
    }
  }

  return fallback;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function compareSections(a: BookSection, b: BookSection) {
  return a.position - b.position || a.title.localeCompare(b.title);
}

function compareBooks(a: Book, b: Book) {
  return a.position - b.position || new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime();
}

function moveItem<T>(items: T[], currentIndex: number, targetIndex: number) {
  const next = [...items];
  const [item] = next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

export default function ClassPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;

  const [classData, setClassData] = useState<Class | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('recordings');
  const [loading, setLoading] = useState(true);
  const [canEditClass, setCanEditClass] = useState(false);

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [bookSections, setBookSections] = useState<BookSection[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [bookUploadTarget, setBookUploadTarget] = useState<BookUploadTarget | null>(null);
  const [videoUploadModalOpen, setVideoUploadModalOpen] = useState(false);
  const [students, setStudents] = useState<StudentViewer[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentEmail, setStudentEmail] = useState('');
  const [studentError, setStudentError] = useState<string | null>(null);
  const [addingStudent, setAddingStudent] = useState(false);

  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [creatingSection, setCreatingSection] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState('');
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bookTitleDraft, setBookTitleDraft] = useState('');
  const accessTokenRef = useRef<string | null>(null);
  const noteContentRef = useRef('');
  const currentNoteContentRef = useRef('');
  const classIdRef = useRef<string | null>(null);
  const canEditClassRef = useRef(false);

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      accessTokenRef.current = data.session?.access_token || null;
    };

    void loadSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      accessTokenRef.current = session?.access_token || null;
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadClass = async () => {
      if (!auth.user || !slug) return;

      try {
        setLoading(true);

        let { data, error } = await supabase
          .from('classes')
          .select('*')
          .eq('slug', slug)
          .maybeSingle();

        if (!data && !error && isUuid(slug)) {
          const fallback = await supabase
            .from('classes')
            .select('*')
            .eq('id', slug)
            .single();

          data = fallback.data;
          error = fallback.error;
        }

        if (error) throw error;
        if (!data) throw new Error('Class not found');

        setClassData(data);
      } catch (error: unknown) {
        const message = getErrorMessage(error, 'Class not found');
        console.error('Error loading class:', error);
        console.error('Error details:', message);
        alert('Class not found. Redirecting to dashboard...');
        router.push('/dashboard');
      } finally {
        setLoading(false);
      }
    };

    void loadClass();
  }, [auth.user, slug, router]);

  useEffect(() => {
    const loadClassData = async () => {
      if (!classData || !auth.user) return;

      try {
        if (classData.user_id === auth.user.id) {
          setCanEditClass(true);
        } else {
          const { data: canEditData, error: canEditError } = await supabase.rpc('can_edit_class', {
            target_class_id: classData.id,
          });

          if (canEditError) throw canEditError;
          setCanEditClass(Boolean(canEditData));
        }

        const [recordingsResult, booksResult, sectionsResult] = await Promise.all([
          supabase
            .from('recordings')
            .select('*')
            .eq('class_id', classData.id)
            .order('uploaded_at', { ascending: false }),
          supabase
            .from('books')
            .select('*')
            .eq('class_id', classData.id),
          supabase
            .from('book_sections')
            .select('*')
            .eq('class_id', classData.id)
            .order('position', { ascending: true }),
        ]);

        if (recordingsResult.error) throw recordingsResult.error;
        if (booksResult.error) throw booksResult.error;
        if (sectionsResult.error) throw sectionsResult.error;

        setRecordings((recordingsResult.data || []) as Recording[]);
        setBooks((booksResult.data || []) as Book[]);
        setBookSections((sectionsResult.data || []) as BookSection[]);
      } catch (error) {
        console.error('Error loading class data:', error);
      }
    };

    void loadClassData();
  }, [classData, auth.user]);

  useEffect(() => {
    noteContentRef.current = noteContent;
  }, [noteContent]);

  useEffect(() => {
    currentNoteContentRef.current = currentNote?.content || '';
  }, [currentNote]);

  useEffect(() => {
    classIdRef.current = classData?.id || null;
  }, [classData]);

  useEffect(() => {
    canEditClassRef.current = canEditClass;
  }, [canEditClass]);

  useEffect(() => {
    const loadNote = async () => {
      if (!classData || activeTab !== 'notes') return;

      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .eq('class_id', classData.id)
          .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
          setCurrentNote(data as Note);
          setNoteContent(data.content || '');
          setNoteError(null);
        } else {
          setCurrentNote({ id: '', class_id: classData.id, content: '', updated_at: new Date().toISOString() });
          setNoteContent('');
          setNoteError(null);
        }
      } catch (error) {
        console.error('Error loading note:', error);
      }
    };

    void loadNote();
  }, [activeTab, classData]);

  useEffect(() => {
    const loadStudents = async () => {
      if (!classData || !canEditClass || activeTab !== 'students') return;

      try {
        setStudentsLoading(true);
        setStudentError(null);

        const { data, error } = await supabase.rpc('list_class_viewers', {
          target_class_id: classData.id,
        });

        if (error) throw error;
        setStudents((data || []) as StudentViewer[]);
      } catch (error: unknown) {
        const message = getErrorMessage(error, 'Failed to load students');
        console.error('Error loading students:', error);
        setStudentError(message);
      } finally {
        setStudentsLoading(false);
      }
    };

    void loadStudents();
  }, [classData, canEditClass, activeTab]);

  const loadRecordings = async () => {
    if (!classData) return;

    const { data, error } = await supabase
      .from('recordings')
      .select('*')
      .eq('class_id', classData.id)
      .order('uploaded_at', { ascending: false });

    if (error) throw error;
    setRecordings((data || []) as Recording[]);
  };

  const loadBooks = async () => {
    if (!classData) return;

    const { data, error } = await supabase
      .from('books')
      .select('*')
      .eq('class_id', classData.id);

    if (error) throw error;
    setBooks((data || []) as Book[]);
  };

  const loadBookSections = async () => {
    if (!classData) return;

    const { data, error } = await supabase
      .from('book_sections')
      .select('*')
      .eq('class_id', classData.id)
      .order('position', { ascending: true });

    if (error) throw error;
    setBookSections((data || []) as BookSection[]);
  };

  const loadBooksAndSections = async () => {
    await Promise.all([loadBooks(), loadBookSections()]);
  };

  const loadStudents = async () => {
    if (!classData || !canEditClass) return;

    const { data, error } = await supabase.rpc('list_class_viewers', {
      target_class_id: classData.id,
    });

    if (error) throw error;
    setStudents((data || []) as StudentViewer[]);
  };

  const handleAddStudent = async () => {
    if (!classData || !canEditClass || !studentEmail.trim()) return;

    try {
      setAddingStudent(true);
      setStudentError(null);

      const { error } = await supabase.rpc('add_user_to_class_by_email', {
        target_class_id: classData.id,
        target_email: studentEmail.trim(),
        target_can_edit: false,
      });

      if (error) throw error;

      setStudentEmail('');
      await loadStudents();
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Failed to add user');
      console.error('Error adding student:', error);
      setStudentError(message);
    } finally {
      setAddingStudent(false);
    }
  };

  const handleCreateSection = async () => {
    if (!classData || !canEditClass || !newSectionTitle.trim()) return;

    try {
      setCreatingSection(true);

      const { error } = await supabase
        .from('book_sections')
        .insert({
          class_id: classData.id,
          title: newSectionTitle.trim(),
          position: bookSections.length,
        });

      if (error) throw error;

      setNewSectionTitle('');
      await loadBookSections();
    } catch (error) {
      console.error('Error creating book section:', error);
      alert(getErrorMessage(error, 'Failed to create section'));
    } finally {
      setCreatingSection(false);
    }
  };

  const persistSectionOrder = async (orderedSections: BookSection[]) => {
    await Promise.all(
      orderedSections.map(async (section, index) => {
        if (section.position === index) return;

        const { error } = await supabase
          .from('book_sections')
          .update({ position: index })
          .eq('id', section.id);

        if (error) throw error;
      })
    );

    await loadBookSections();
  };

  const handleMoveSection = async (sectionId: string, direction: 'up' | 'down') => {
    const orderedSections = [...bookSections].sort(compareSections);
    const currentIndex = orderedSections.findIndex((section) => section.id === sectionId);
    if (currentIndex < 0) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedSections.length) return;

    try {
      await persistSectionOrder(moveItem(orderedSections, currentIndex, targetIndex));
    } catch (error) {
      console.error('Error moving section:', error);
      alert(getErrorMessage(error, 'Failed to reorder section'));
    }
  };

  const handleRenameSection = async () => {
    if (!editingSectionId || !sectionTitleDraft.trim()) return;

    try {
      const { error } = await supabase
        .from('book_sections')
        .update({ title: sectionTitleDraft.trim() })
        .eq('id', editingSectionId);

      if (error) throw error;

      setEditingSectionId(null);
      setSectionTitleDraft('');
      await loadBookSections();
    } catch (error) {
      console.error('Error renaming section:', error);
      alert(getErrorMessage(error, 'Failed to rename section'));
    }
  };

  const handleRenameBook = async () => {
    if (!editingBookId || !bookTitleDraft.trim()) return;

    try {
      const { error } = await supabase
        .from('books')
        .update({ title: bookTitleDraft.trim() })
        .eq('id', editingBookId);

      if (error) throw error;

      setEditingBookId(null);
      setBookTitleDraft('');
      await loadBooks();
    } catch (error) {
      console.error('Error renaming book:', error);
      alert(getErrorMessage(error, 'Failed to rename book'));
    }
  };

  const persistBookOrder = async (orderedBooks: Book[]) => {
    await Promise.all(
      orderedBooks.map(async (book, index) => {
        if (book.position === index) return;

        const { error } = await supabase
          .from('books')
          .update({ position: index })
          .eq('id', book.id);

        if (error) throw error;
      })
    );

    await loadBooks();
  };

  const handleMoveBook = async (sectionId: string | null, bookId: string, direction: 'up' | 'down') => {
    const orderedBooks = books
      .filter((book) => book.section_id === sectionId)
      .sort(compareBooks);

    const currentIndex = orderedBooks.findIndex((book) => book.id === bookId);
    if (currentIndex < 0) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedBooks.length) return;

    try {
      await persistBookOrder(moveItem(orderedBooks, currentIndex, targetIndex));
    } catch (error) {
      console.error('Error moving book:', error);
      alert(getErrorMessage(error, 'Failed to reorder book'));
    }
  };

  const handleMoveBookToSection = async (book: Book, nextSectionId: string | null) => {
    if (book.section_id === nextSectionId) return;

    const sourceBooks = books
      .filter((item) => item.section_id === book.section_id && item.id !== book.id)
      .sort(compareBooks);
    const targetBooks = books
      .filter((item) => item.section_id === nextSectionId && item.id !== book.id)
      .sort(compareBooks);

    try {
      const { error } = await supabase
        .from('books')
        .update({
          section_id: nextSectionId,
          position: targetBooks.length,
        })
        .eq('id', book.id);

      if (error) throw error;

      await Promise.all(
        sourceBooks.map(async (item, index) => {
          if (item.position === index) return;

          const { error: updateError } = await supabase
            .from('books')
            .update({ position: index })
            .eq('id', item.id);

          if (updateError) throw updateError;
        })
      );

      await loadBooks();
    } catch (error) {
      console.error('Error moving book to section:', error);
      alert(getErrorMessage(error, 'Failed to move book'));
    }
  };

  const handleVideoUploadSuccess = () => {
    setVideoUploadModalOpen(false);
    void loadRecordings();
  };

  const handleBookUploadSuccess = () => {
    setBookUploadTarget(null);
    void loadBooksAndSections();
  };

  const persistNote = async (content: string, options?: { background?: boolean }) => {
    if (!classData || !canEditClass) return true;

    const payload = {
      classId: classData.id,
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
      }).catch((error) => {
        console.error('Background note save error:', error);
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
            class_id: classData.id,
            content,
          },
          {
            onConflict: 'class_id',
          }
        )
        .select()
        .single();

      if (error || !data) throw error || new Error('Failed to save note');

      setCurrentNote(data as Note);
      return true;
    } catch (error) {
      console.error('Error saving note:', error);
      setNoteError(getErrorMessage(error, 'Failed to save note'));
      return false;
    } finally {
      setSavingNote(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      router.push('/signin');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const savedNoteContent = currentNote?.content || '';
  const hasUnsavedNoteChanges = canEditClass && activeTab === 'notes' && noteContent !== savedNoteContent;

  const handleTabChange = async (nextTab: TabType) => {
    if (nextTab === activeTab) return;

    if (activeTab === 'notes' && hasUnsavedNoteChanges) {
      const saved = await persistNote(noteContent);
      if (!saved) return;
    }

    setActiveTab(nextTab);
  };

  useEffect(() => {
    const handlePageHide = (event?: PageTransitionEvent | Event) => {
      if (event?.type === 'visibilitychange' && document.visibilityState !== 'hidden') {
        return;
      }

      const currentClassId = classIdRef.current;
      if (!currentClassId || !canEditClassRef.current) return;

      const latestContent = noteContentRef.current;
      const savedContent = currentNoteContentRef.current;
      if (latestContent === savedContent) return;

      const token = accessTokenRef.current;
      if (!token) return;

      fetch('/api/notes/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          classId: currentClassId,
          content: latestContent,
        }),
        keepalive: true,
      }).catch((error) => {
        console.error('Background note save error:', error);
      });
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handlePageHide);
    };
  }, []);

  const handleSaveNote = async () => {
    await persistNote(noteContent);
  };

  if (auth.loading || loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  if (!auth.user || !classData) {
    return null;
  }

  const orderedSections = [...bookSections].sort(compareSections);
  const sectionOptions = orderedSections.map((section) => ({
    id: section.id,
    title: section.title,
  }));
  const organizedSections: OrganizedBookSection[] = orderedSections.map((section) => ({
    ...section,
    books: books.filter((book) => book.section_id === section.id).sort(compareBooks),
  }));
  const unassignedBooks = books.filter((book) => book.section_id === null).sort(compareBooks);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{classData.name}</h1>
                <p className="text-sm text-gray-600">{auth.user.user_metadata?.name || auth.user.email}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow">
          <div className="border-b px-6 py-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{classData.name}</h2>
                {classData.description && (
                  <p className="text-gray-600">{classData.description}</p>
                )}
                <p className="text-sm text-gray-500 mt-2">
                  Created {formatDate(classData.created_at)}
                </p>
              </div>
            </div>
          </div>

          <div className="border-b">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => void handleTabChange('recordings')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'recordings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Class Recordings
                </div>
              </button>
              <button
                onClick={() => void handleTabChange('books')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'books'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Books
                </div>
              </button>
              <button
                onClick={() => void handleTabChange('notes')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'notes'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Notes
                </div>
              </button>
              {canEditClass && (
                <button
                  onClick={() => void handleTabChange('students')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'students'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4H2v16h5m10 0v-2a3 3 0 00-3-3H10a3 3 0 00-3 3v2m10 0H7m10-9a3 3 0 11-6 0 3 3 0 016 0zm-8 3a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    See Students
                  </div>
                </button>
              )}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'recordings' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Class Recordings</h3>
                  {canEditClass && (
                    <button
                      onClick={() => setVideoUploadModalOpen(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Upload Video
                    </button>
                  )}
                </div>
                {recordings.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-500">No recordings yet.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Title</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Duration</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Uploaded</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {recordings.map((recording) => (
                            <tr key={recording.id} className="hover:bg-gray-50">
                              <td className="px-4 py-4 text-sm font-medium text-gray-900">{recording.title}</td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${recordingStatusStyles[recording.processing_status].className}`}>
                                  {recordingStatusStyles[recording.processing_status].icon}
                                  {recordingStatusStyles[recording.processing_status].label}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">{formatDuration(recording.duration)}</td>
                              <td className="px-4 py-4 text-sm text-gray-600">{formatDate(recording.uploaded_at)}</td>
                              <td className="px-4 py-4 text-right">
                                <Link
                                  href={`/dashboard/class/${slug}/video/${recording.id}`}
                                  className="inline-flex rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                                >
                                  Open
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'books' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Books</h3>
                    <p className="text-sm text-gray-500">Organize books into sections and order them within each section.</p>
                  </div>
                  {canEditClass && (
                    <button
                      onClick={() => setBookUploadTarget({
                        sectionId: null,
                        startingPosition: unassignedBooks.length,
                      })}
                      className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Upload Books
                    </button>
                  )}
                </div>

                {canEditClass && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end">
                      <div className="flex-1">
                        <label htmlFor="section-title" className="block text-sm font-medium text-gray-700 mb-1">
                          Create Book Section
                        </label>
                        <input
                          id="section-title"
                          type="text"
                          value={newSectionTitle}
                          onChange={(e) => setNewSectionTitle(e.target.value)}
                          placeholder="e.g., Unit 1 Reading"
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <button
                        onClick={handleCreateSection}
                        disabled={creatingSection || !newSectionTitle.trim()}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {creatingSection ? 'Creating...' : 'Add Section'}
                      </button>
                    </div>
                  </div>
                )}

                {organizedSections.length === 0 && unassignedBooks.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">No books yet.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {organizedSections.map((section, sectionIndex) => (
                      <section key={section.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                        <div className="border-b bg-gray-50 px-5 py-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-3">
                                <span className="inline-flex rounded-full bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white">
                                  Section {sectionIndex + 1}
                                </span>
                                {editingSectionId === section.id ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      value={sectionTitleDraft}
                                      onChange={(e) => setSectionTitleDraft(e.target.value)}
                                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <button
                                      onClick={handleRenameSection}
                                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingSectionId(null);
                                        setSectionTitleDraft('');
                                      }}
                                      className="rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <h4 className="truncate text-lg font-semibold text-gray-900">{section.title}</h4>
                                )}
                              </div>
                              <p className="mt-2 text-sm text-gray-600">
                                {section.books.length} book{section.books.length === 1 ? '' : 's'}
                              </p>
                            </div>

                            {canEditClass && (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => setBookUploadTarget({
                                    sectionId: section.id,
                                    startingPosition: section.books.length,
                                  })}
                                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                                >
                                  Add Books
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingSectionId(section.id);
                                    setSectionTitleDraft(section.title);
                                  }}
                                  className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
                                >
                                  Rename
                                </button>
                                <button
                                  onClick={() => void handleMoveSection(section.id, 'up')}
                                  disabled={sectionIndex === 0}
                                  className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                                >
                                  Up
                                </button>
                                <button
                                  onClick={() => void handleMoveSection(section.id, 'down')}
                                  disabled={sectionIndex === orderedSections.length - 1}
                                  className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                                >
                                  Down
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="px-5 py-5">
                          {section.books.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                              No books in this section.
                            </div>
                          ) : (
                            <div className="overflow-hidden rounded-lg border border-gray-200">
                              <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Title</th>
                                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Size</th>
                                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Uploaded</th>
                                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 bg-white">
                                    {section.books.map((book, bookIndex) => (
                                      <tr key={book.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-3 text-sm text-gray-900">
                                          {editingBookId === book.id ? (
                                            <div className="flex items-center gap-2">
                                              <input
                                                value={bookTitleDraft}
                                                onChange={(e) => setBookTitleDraft(e.target.value)}
                                                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                              />
                                              <button
                                                onClick={handleRenameBook}
                                                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                                              >
                                                Save
                                              </button>
                                            </div>
                                          ) : (
                                            <p className="font-medium">{book.title}</p>
                                          )}
                                        </td>
                                        <td className="px-3 py-3 text-sm text-gray-600">
                                          <ProcessingStatusBadge
                                            bookId={book.id}
                                            initialStatus={book.processing_status}
                                            onStatusChange={(status) => {
                                              setBooks((currentBooks) =>
                                                currentBooks.map((currentBook) =>
                                                  currentBook.id === book.id ? { ...currentBook, processing_status: status } : currentBook
                                                )
                                              );
                                            }}
                                          />
                                        </td>
                                        <td className="px-3 py-3 text-sm text-gray-600">{formatFileSize(book.file_size)}</td>
                                        <td className="px-3 py-3 text-sm text-gray-600">{formatDate(book.uploaded_at)}</td>
                                        <td className="px-3 py-3 text-right">
                                          <div className="flex flex-wrap items-center justify-end gap-2">
                                            <Link
                                              href={`/dashboard/class/${slug}/book/${book.id}`}
                                              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                                            >
                                              Open
                                            </Link>
                                            {canEditClass && (
                                              <>
                                                <button
                                                  onClick={() => {
                                                    setEditingBookId(book.id);
                                                    setBookTitleDraft(book.title);
                                                  }}
                                                  className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300"
                                                >
                                                  Rename
                                                </button>
                                                <button
                                                  onClick={() => void handleMoveBook(section.id, book.id, 'up')}
                                                  disabled={bookIndex === 0}
                                                  className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                                                >
                                                  Up
                                                </button>
                                                <button
                                                  onClick={() => void handleMoveBook(section.id, book.id, 'down')}
                                                  disabled={bookIndex === section.books.length - 1}
                                                  className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                                                >
                                                  Down
                                                </button>
                                                <select
                                                  value={book.section_id ?? ''}
                                                  onChange={(e) => void handleMoveBookToSection(book, e.target.value || null)}
                                                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                >
                                                  <option value="">Unassigned</option>
                                                  {sectionOptions.map((option) => (
                                                    <option key={option.id} value={option.id}>
                                                      {option.title}
                                                    </option>
                                                  ))}
                                                </select>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      </section>
                    ))}

                    {unassignedBooks.length > 0 && (
                      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                        <div className="border-b bg-gray-50 px-5 py-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <span className="inline-flex rounded-full bg-gray-600 px-2.5 py-1 text-xs font-semibold text-white">
                                  Unassigned
                                </span>
                                <h4 className="text-lg font-semibold text-gray-900">Unassigned Books</h4>
                              </div>
                              <p className="mt-2 text-sm text-gray-600">
                                {unassignedBooks.length} book{unassignedBooks.length === 1 ? '' : 's'}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="px-5 py-5">
                          <div className="overflow-hidden rounded-lg border border-gray-200">
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Title</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Size</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Uploaded</th>
                                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                  {unassignedBooks.map((book, bookIndex) => (
                                    <tr key={book.id} className="hover:bg-gray-50">
                                      <td className="px-3 py-3 text-sm text-gray-900">
                                        {editingBookId === book.id ? (
                                          <div className="flex items-center gap-2">
                                            <input
                                              value={bookTitleDraft}
                                              onChange={(e) => setBookTitleDraft(e.target.value)}
                                              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                            <button
                                              onClick={handleRenameBook}
                                              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                                            >
                                              Save
                                            </button>
                                          </div>
                                        ) : (
                                          <p className="font-medium">{book.title}</p>
                                        )}
                                      </td>
                                      <td className="px-3 py-3 text-sm text-gray-600">
                                        <ProcessingStatusBadge
                                          bookId={book.id}
                                          initialStatus={book.processing_status}
                                          onStatusChange={(status) => {
                                            setBooks((currentBooks) =>
                                              currentBooks.map((currentBook) =>
                                                currentBook.id === book.id ? { ...currentBook, processing_status: status } : currentBook
                                              )
                                            );
                                          }}
                                        />
                                      </td>
                                      <td className="px-3 py-3 text-sm text-gray-600">{formatFileSize(book.file_size)}</td>
                                      <td className="px-3 py-3 text-sm text-gray-600">{formatDate(book.uploaded_at)}</td>
                                      <td className="px-3 py-3 text-right">
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                          <Link
                                            href={`/dashboard/class/${slug}/book/${book.id}`}
                                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                                          >
                                            Open
                                          </Link>
                                          {canEditClass && (
                                            <>
                                              <button
                                                onClick={() => {
                                                  setEditingBookId(book.id);
                                                  setBookTitleDraft(book.title);
                                                }}
                                                className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300"
                                              >
                                                Rename
                                              </button>
                                              <button
                                                onClick={() => void handleMoveBook(null, book.id, 'up')}
                                                disabled={bookIndex === 0}
                                                className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                                              >
                                                Up
                                              </button>
                                              <button
                                                onClick={() => void handleMoveBook(null, book.id, 'down')}
                                                disabled={bookIndex === unassignedBooks.length - 1}
                                                className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                                              >
                                                Down
                                              </button>
                                              <select
                                                value={book.section_id ?? ''}
                                                onChange={(e) => void handleMoveBookToSection(book, e.target.value || null)}
                                                className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                              >
                                                <option value="">Unassigned</option>
                                                {sectionOptions.map((option) => (
                                                  <option key={option.id} value={option.id}>
                                                    {option.title}
                                                  </option>
                                                ))}
                                              </select>
                                            </>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'notes' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Notes</h3>
                  {canEditClass && (
                    <button
                      onClick={() => void handleSaveNote()}
                      disabled={savingNote}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingNote ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
                {noteError && (
                  <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {noteError}
                  </div>
                )}
                <div className="border rounded-lg overflow-hidden">
                  <textarea
                    value={noteContent}
                    onChange={(e) => canEditClass && setNoteContent(e.target.value)}
                    readOnly={!canEditClass}
                    placeholder={canEditClass ? 'Write your notes here...' : 'Notes are view-only for your access level'}
                    className="w-full h-96 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-900 read-only:bg-gray-50"
                  />
                </div>
                {currentNote && currentNote.updated_at && (
                  <p className="text-xs text-gray-500 mt-2">
                    Last updated: {new Date(currentNote.updated_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {activeTab === 'students' && canEditClass && (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 md:flex-row md:items-end">
                  <div className="flex-1">
                    <label htmlFor="student-email" className="block text-sm font-medium text-gray-700 mb-1">
                      Add User By Email
                    </label>
                    <input
                      id="student-email"
                      type="email"
                      value={studentEmail}
                      onChange={(e) => setStudentEmail(e.target.value)}
                      placeholder="student@example.com"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={handleAddStudent}
                    disabled={addingStudent || !studentEmail.trim()}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {addingStudent ? 'Adding...' : 'Add Student'}
                  </button>
                </div>

                {studentError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {studentError}
                  </div>
                )}

                {studentsLoading ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">Loading students...</p>
                  </div>
                ) : students.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">No view-only students have been added to this class yet.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Name</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Email</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Access</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Added</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {students.map((student) => (
                            <tr key={student.user_id} className="hover:bg-gray-50">
                              <td className="px-4 py-4 text-sm font-medium text-gray-900">{student.name}</td>
                              <td className="px-4 py-4 text-sm text-gray-600">{student.email}</td>
                              <td className="px-4 py-4 text-sm text-gray-600">View only</td>
                              <td className="px-4 py-4 text-sm text-gray-600">{formatDate(student.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {classData && bookUploadTarget && (
        <PdfUploadModal
          classId={classData.id}
          sectionId={bookUploadTarget.sectionId}
          startingPosition={bookUploadTarget.startingPosition}
          isOpen={true}
          onClose={() => setBookUploadTarget(null)}
          onSuccess={handleBookUploadSuccess}
        />
      )}

      {classData && videoUploadModalOpen && (
        <VideoUploadModal
          classId={classData.id}
          isOpen={true}
          onClose={() => setVideoUploadModalOpen(false)}
          onSuccess={handleVideoUploadSuccess}
        />
      )}
    </div>
  );
}
