'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/utils';
import { useAutosave } from '@/hooks/useAutosave';
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator';
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

interface Book {
  id: string;
  class_id: string;
  title: string;
  pdf_url: string;
  file_size: number | null;
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

interface StudentViewer {
  user_id: string;
  email: string;
  name: string;
  can_edit: boolean;
  created_at: string;
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  return fallback;
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

  // Data for tabs
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [videoUploadModalOpen, setVideoUploadModalOpen] = useState(false);
  const [students, setStudents] = useState<StudentViewer[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentEmail, setStudentEmail] = useState('');
  const [studentError, setStudentError] = useState<string | null>(null);
  const [addingStudent, setAddingStudent] = useState(false);

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
      loadClassPermissions();
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

  useEffect(() => {
    if (classData && canEditClass && activeTab === 'students') {
      loadStudents();
    }
  }, [classData, canEditClass, activeTab]);

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

  const loadClassPermissions = async () => {
    if (!classData || !auth.user) return;

    if (classData.user_id === auth.user.id) {
      setCanEditClass(true);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('can_edit_class', {
        target_class_id: classData.id,
      });

      if (error) throw error;
      setCanEditClass(Boolean(data));
    } catch (error) {
      console.error('Error loading class permissions:', error);
      setCanEditClass(false);
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

      // Generate signed URLs for each recording (valid for 1 hour)
      const recordingsWithSignedUrls = await Promise.all(
        (data || []).map(async (recording) => {
          if (recording.storage_path) {
            const { data: signedData, error: signedError } = await supabase.storage
              .from('recordings')
              .createSignedUrl(recording.storage_path, 3600); // 1 hour expiry

            if (!signedError && signedData) {
              return { ...recording, video_url: signedData.signedUrl };
            }
          }
          return recording;
        })
      );

      recordingsWithSignedUrls.sort(
        (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
      );

      setRecordings(recordingsWithSignedUrls);
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

      // pdf_url is now a permanent S3 URL — no signed URL refresh needed
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

  const loadStudents = async () => {
    if (!classData || !canEditClass) return;

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
      loadStudents();
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Failed to add user');
      console.error('Error adding student:', error);
      setStudentError(message);
    } finally {
      setAddingStudent(false);
    }
  };

  const handleVideoUploadSuccess = () => {
    loadRecordings(); // Reload recordings after successful upload
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
                onClick={() => setActiveTab('books')}
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
                onClick={() => setActiveTab('notes')}
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
                  onClick={() => setActiveTab('students')}
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

          {/* Tab Content */}
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
                    <p className="text-gray-500">No recordings yet. Add your first recording!</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Title
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Status
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Duration
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Uploaded
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {recordings.map((recording) => (
                            <tr key={recording.id} className="hover:bg-gray-50">
                              <td className="px-4 py-4 text-sm font-medium text-gray-900">
                                {recording.title}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${recordingStatusStyles[recording.processing_status].className}`}
                                >
                                  {recordingStatusStyles[recording.processing_status].icon}
                                  {recordingStatusStyles[recording.processing_status].label}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                {recording.duration
                                  ? `${Math.floor(recording.duration / 60)}:${(recording.duration % 60).toString().padStart(2, '0')}`
                                  : '—'}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                {formatDate(recording.uploaded_at)}
                              </td>
                              <td className="px-4 py-4 text-right">
                                <Link
                                  href={`/dashboard/class/${slug}/video/${recording.id}`}
                                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M6.3 4.84A1 1 0 017.8 4l6.7 5.16a1 1 0 010 1.68L7.8 16a1 1 0 01-1.5-.84V4.84z" />
                                  </svg>
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
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Books & PDFs</h3>
                  {canEditClass && (
                    <button
                      onClick={() => setUploadModalOpen(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Upload PDF
                    </button>
                  )}
                </div>
                {books.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <p className="text-gray-500">No books yet. Add your first book!</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Title
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Status
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Size
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Uploaded
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {books.map((book) => (
                            <tr key={book.id} className="hover:bg-gray-50">
                              <td className="px-4 py-4 text-sm font-medium text-gray-900">
                                {book.title}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                <ProcessingStatusBadge
                                  bookId={book.id}
                                  initialStatus={book.processing_status}
                                  onStatusChange={(status) => {
                                    setBooks(books.map(b =>
                                      b.id === book.id ? { ...b, processing_status: status } : b
                                    ));
                                  }}
                                />
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                {formatFileSize(book.file_size)}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                {formatDate(book.uploaded_at)}
                              </td>
                              <td className="px-4 py-4 text-right">
                                <Link
                                  href={`/dashboard/class/${slug}/book/${book.id}`}
                                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
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

            {activeTab === 'notes' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Notes</h3>
                  {canEditClass && (
                    <SaveStatusIndicator status={autosave.status} error={autosave.error} />
                  )}
                </div>
                <div className="border rounded-lg overflow-hidden">
                  <textarea
                    value={autosave.value}
                    onChange={(e) => canEditClass && autosave.setValue(e.target.value)}
                    readOnly={!canEditClass}
                    placeholder={canEditClass ? 'Write your notes here... (autosaves as you type)' : 'Notes are view-only for your access level'}
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
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Name
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Email
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Access
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Added
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {students.map((student) => (
                            <tr key={student.user_id} className="hover:bg-gray-50">
                              <td className="px-4 py-4 text-sm font-medium text-gray-900">
                                {student.name}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                {student.email}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                View only
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                {formatDate(student.created_at)}
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

      {/* Video Upload Modal */}
      {classData && auth.user && (
        <VideoUploadModal
          classId={classData.id}
          userId={auth.user.id}
          isOpen={videoUploadModalOpen}
          onClose={() => setVideoUploadModalOpen(false)}
          onSuccess={handleVideoUploadSuccess}
        />
      )}
    </div>
  );
}
