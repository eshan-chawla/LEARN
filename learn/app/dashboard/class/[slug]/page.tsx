'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/utils';
import { useAutosave } from '@/hooks/useAutosave';
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator';
import { PdfUploadModal } from '@/components/PdfUploadModal';
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
  uploaded_at: string;
}

interface Book {
  id: string;
  class_id: string;
  title: string;
  pdf_url: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  storage_path: string | null;
  uploaded_at: string;
}

interface Note {
  id: string;
  class_id: string;
  content: string | null;
  updated_at: string;
}

type TabType = 'recordings' | 'books' | 'notes';

export default function ClassPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;

  const [classData, setClassData] = useState<Class | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('recordings');
  const [loading, setLoading] = useState(true);

  // Data for tabs
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Autosave hook for notes
  const autosave = useAutosave({
    onSave: async (content: string) => {
      if (!classData) return;

      if (noteId) {
        // Update existing note
        const { error } = await supabase
          .from('notes')
          .update({ content })
          .eq('id', noteId);

        if (error) throw error;
      } else {
        // Insert new note
        const { data, error } = await supabase
          .from('notes')
          .insert({
            class_id: classData.id,
            content,
          })
          .select()
          .single();

        if (error) throw error;

        // Save the note ID for future updates
        setNoteId(data.id);
        setCurrentNote(data);
      }
    },
    delay: 2000,
    initialValue: '',
  });

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  useEffect(() => {
    if (auth.user && slug) {
      loadClass();
    }
  }, [auth.user, slug]);

  useEffect(() => {
    if (classData) {
      loadRecordings();
      loadBooks();
      if (activeTab === 'notes') {
        loadNote();
      }
    }
  }, [classData]);

  useEffect(() => {
    if (classData && activeTab === 'notes') {
      loadNote();
    }
  }, [activeTab]);

  const loadClass = async () => {
    try {
      setLoading(true);

      // Try to find by slug first
      let { data, error } = await supabase
        .from('classes')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      // If not found by slug, try by ID (fallback for classes without slugs)
      if (!data && !error) {
        const result = await supabase
          .from('classes')
          .select('*')
          .eq('id', slug)
          .single();

        data = result.data;
        error = result.error;
      }

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      if (!data) {
        throw new Error('Class not found');
      }

      setClassData(data);
    } catch (error: any) {
      console.error('Error loading class:', error);
      console.error('Error details:', error?.message, error?.details);
      alert('Class not found. Redirecting to dashboard...');
      router.push('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const loadRecordings = async () => {
    if (!classData) return;

    try {
      const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('class_id', classData.id)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setRecordings(data || []);
    } catch (error) {
      console.error('Error loading recordings:', error);
    }
  };

  const loadBooks = async () => {
    if (!classData) return;

    try {
      const { data, error } = await supabase
        .from('books')
        .select('*')
        .eq('class_id', classData.id)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setBooks(data || []);
    } catch (error) {
      console.error('Error loading books:', error);
    }
  };

  const loadNote = async () => {
    if (!classData) return;

    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('class_id', classData.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setCurrentNote(data);
        setNoteId(data.id);
        autosave.setValue(data.content || '');
      } else {
        setCurrentNote({ id: '', class_id: classData.id, content: '', updated_at: new Date().toISOString() });
        setNoteId(null);
        autosave.setValue('');
      }
    } catch (error) {
      console.error('Error loading note:', error);
    }
  };

  const handleAddRecording = async () => {
    if (!classData) return;

    const title = prompt('Enter recording title:');
    const videoUrl = prompt('Enter video URL:');

    if (title && videoUrl) {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('recordings')
          .insert({
            class_id: classData.id,
            title,
            video_url: videoUrl,
          })
          .select()
          .single();

        if (error) throw error;

        setRecordings([data, ...recordings]);
      } catch (error) {
        console.error('Error adding recording:', error);
        alert('Failed to add recording. Please try again.');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleUploadSuccess = () => {
    // Reload books after successful upload
    loadBooks();
  };


  const handleSignOut = async () => {
    try {
      await auth.signOut();
      router.push('/signin');
    } catch (error) {
      console.error('Sign out error:', error);
    }
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
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
          {/* Class Info Header */}
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

          {/* Tabs */}
          <div className="border-b">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('recordings')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'recordings'
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
                onClick={() => setActiveTab('books')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'books'
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
                onClick={() => setActiveTab('notes')}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'notes'
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
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'recordings' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Class Recordings</h3>
                  <button
                    onClick={handleAddRecording}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Recording
                  </button>
                </div>
                {recordings.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-500">No recordings yet. Add your first recording!</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {recordings.map((recording) => (
                      <div key={recording.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                        <h4 className="font-medium text-gray-900 mb-3">{recording.title}</h4>
                        <video
                          controls
                          className="w-full rounded"
                          src={recording.video_url}
                        >
                          Your browser does not support the video tag.
                        </video>
                        <p className="text-xs text-gray-500 mt-2">
                          Uploaded: {formatDate(recording.uploaded_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'books' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Books & PDFs</h3>
                  <button
                    onClick={() => setUploadModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Upload PDF
                  </button>
                </div>
                {books.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <p className="text-gray-500">No books yet. Add your first book!</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {books.map((book) => (
                      <div key={book.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0">
                            <svg className="w-10 h-10 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-medium text-gray-900">{book.title}</h4>
                            </div>
                            <ProcessingStatusBadge
                              bookId={book.id}
                              initialStatus={book.processing_status}
                              onStatusChange={(status) => {
                                // Update book status in local state
                                setBooks(books.map(b =>
                                  b.id === book.id ? { ...b, processing_status: status } : b
                                ));
                              }}
                            />
                            <p className="text-xs text-gray-500 mt-2 mb-2">
                              Uploaded: {formatDate(book.uploaded_at)}
                            </p>
                            <a
                              href={book.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                            >
                              Open PDF →
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'notes' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Notes</h3>
                  <SaveStatusIndicator status={autosave.status} error={autosave.error} />
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <textarea
                    value={autosave.value}
                    onChange={(e) => autosave.setValue(e.target.value)}
                    placeholder="Write your notes here... (autosaves as you type)"
                    className="w-full h-96 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-gray-900"
                  />
                </div>
                {currentNote && currentNote.updated_at && (
                  <p className="text-xs text-gray-500 mt-2">
                    Last updated: {new Date(currentNote.updated_at).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PDF Upload Modal */}
      {classData && auth.user && (
        <PdfUploadModal
          classId={classData.id}
          userId={auth.user.id}
          isOpen={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}
