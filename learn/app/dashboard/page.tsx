'use client';

import { ProfileMenu } from '@/components/ProfileMenu';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { generateSlug, formatDate } from '@/lib/utils';
import Link from 'next/link';

interface Class {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  user_id: string;
  slug?: string | null;
  currentRole?: 'owner' | 'manager' | 'student';
  bookCount?: number;
  recordingCount?: number;
}

interface UserProfile {
  id: string;
  email: string;
  name: string;
  is_teacher: boolean;
}

const roleStyles: Record<'owner' | 'manager' | 'student', { label: string; className: string }> = {
  owner: {
    label: 'Owner',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  manager: {
    label: 'Manager',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  student: {
    label: 'Student',
    className: 'border-stone-200 bg-stone-100 text-stone-700',
  },
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  return fallback;
}

export default function DashboardPage() {
  const auth = useAuth();
  const router = useRouter();

  const [classes, setClasses] = useState<Class[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassDescription, setNewClassDescription] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  const loadUserProfile = useCallback(async () => {
    if (!auth.user) return;

    const fallbackProfile = {
      id: auth.user.id,
      email: auth.user.email || '',
      name: auth.user.user_metadata?.name || auth.user.email || 'User',
      is_teacher: false,
    };

    try {
      const profileResult = await supabase
        .from('users')
        .select('id, email, name, is_teacher')
        .eq('id', auth.user.id)
        .maybeSingle();

      if (profileResult.error) throw profileResult.error;

      let data = profileResult.data;

      if (!data) {
        const insertResult = await supabase
          .from('users')
          .insert({
            id: fallbackProfile.id,
            email: fallbackProfile.email,
            name: fallbackProfile.name,
          })
          .select('id, email, name, is_teacher')
          .single();

        if (insertResult.error) throw insertResult.error;
        data = insertResult.data;
      }

      setUserProfile(data ?? fallbackProfile);
    } catch (error) {
      console.error('Error loading user profile:', error);
      setUserProfile(fallbackProfile);
    }
  }, [auth.user]);

  const loadClasses = useCallback(async () => {
    if (!auth.user) return;

    try {
      setLoading(true);
      const [classesResult, membershipsResult, booksResult, recordingsResult] = await Promise.all([
        supabase
          .from('classes')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('user_class')
          .select('class_id, role')
          .eq('user_id', auth.user.id),
        supabase
          .from('books')
          .select('class_id'),
        supabase
          .from('recordings')
          .select('class_id'),
      ]);

      if (classesResult.error) throw classesResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      if (booksResult.error) throw booksResult.error;
      if (recordingsResult.error) throw recordingsResult.error;

      const membershipByClassId = new Map(
        (membershipsResult.data || []).map((membership) => [membership.class_id, membership.role])
      );
      const bookCounts = new Map<string, number>();
      const recordingCounts = new Map<string, number>();

      for (const book of booksResult.data || []) {
        bookCounts.set(book.class_id, (bookCounts.get(book.class_id) || 0) + 1);
      }

      for (const recording of recordingsResult.data || []) {
        recordingCounts.set(recording.class_id, (recordingCounts.get(recording.class_id) || 0) + 1);
      }

      const enrichedClasses = (classesResult.data || []).map((classItem) => ({
        ...classItem,
        currentRole: (membershipByClassId.get(classItem.id) || (classItem.user_id === auth.user?.id ? 'owner' : 'student')) as Class['currentRole'],
        bookCount: bookCounts.get(classItem.id) || 0,
        recordingCount: recordingCounts.get(classItem.id) || 0,
      }));

      setClasses(enrichedClasses);
    } catch (error) {
      console.error('Error loading classes:', error);
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  // Load classes when user is authenticated
  useEffect(() => {
    if (auth.user) {
      loadUserProfile();
      loadClasses();
    }
  }, [auth.user, loadClasses, loadUserProfile]);

  const handleCreateClass = async () => {
    if (!newClassName.trim() || !auth.user) return;
    if (!userProfile?.is_teacher) {
      alert('Only teachers can create classes.');
      return;
    }

    try {
      setLoading(true);
      const slug = generateSlug(newClassName) + '-' + Date.now().toString(36);
      const { data, error } = await supabase.rpc('create_class', {
        class_name: newClassName,
        class_description: newClassDescription || null,
        class_slug: slug,
      });

      if (error || !data) {
        console.error('Supabase error details:', error);
        throw error || new Error('Failed to create class');
      }

      setClasses([data, ...classes]);
      setNewClassName('');
      setNewClassDescription('');
      setShowCreateClass(false);

      // Navigate to the new class page using slug if available, otherwise use ID
      router.push(`/dashboard/class/${data.slug || data.id}`);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unknown error');
      console.error('Error creating class:', error);
      alert(`Failed to create class: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  if (auth.loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  if (!auth.user) {
    return null;
  }

  const displayName = userProfile?.name || auth.user.user_metadata?.name || auth.user.email;
  const canCreateClasses = userProfile?.is_teacher ?? false;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#f3f4f6_48%,_#f8fafc_100%)]">
      {/* Header */}
      <header className="relative z-30 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Smart Learn</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Workspace</h1>
              <p className="text-sm text-stone-600">Welcome back, {displayName}</p>
            </div>
            <ProfileMenu />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8 rounded-[28px] border border-stone-200 bg-white/75 px-6 py-7 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-700">Dashboard</p>
              <h2 className="mt-3 text-4xl font-black tracking-tight text-slate-950">My Classes</h2>
              <p className="mt-2 text-base leading-7 text-stone-600">Keep every class workspace organized around the material students actually use: books, recordings, notes, and access.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-600 md:block">
                {classes.length} class{classes.length === 1 ? '' : 'es'}
              </div>
              {canCreateClasses && (
                <button
                  onClick={() => setShowCreateClass(true)}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Class
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Create Class Modal/Form */}
        {showCreateClass && (
          <div className="mb-8 rounded-[24px] border border-stone-200 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
            <h3 className="mb-4 text-lg font-semibold text-slate-950">Create New Class</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="className" className="mb-1 block text-sm font-medium text-stone-700">
                  Class Name
                </label>
                <input
                  type="text"
                  id="className"
                  placeholder="e.g., Introduction to Python"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label htmlFor="classDescription" className="mb-1 block text-sm font-medium text-stone-700">
                  Description (Optional)
                </label>
                <textarea
                  id="classDescription"
                  placeholder="Brief description of the class..."
                  value={newClassDescription}
                  onChange={(e) => setNewClassDescription(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleCreateClass}
                  disabled={loading}
                  className="flex-1 rounded-xl bg-slate-950 px-4 py-2.5 text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create Class'}
                </button>
                <button
                  onClick={() => {
                    setShowCreateClass(false);
                    setNewClassName('');
                    setNewClassDescription('');
                  }}
                  className="rounded-xl border border-stone-300 bg-white px-6 py-2.5 text-stone-700 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Classes Grid */}
        {loading && classes.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-stone-600">Loading classes...</p>
          </div>
        ) : classes.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-stone-300 bg-white/60 p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-sky-50">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="mb-2 text-xl font-semibold text-slate-950">No classes yet</h3>
            <p className="mx-auto mb-6 max-w-md text-stone-600">
              {canCreateClasses
                ? 'Get started by creating your first class'
                : 'Your classes will appear here once a teacher adds you to one.'}
            </p>
            {canCreateClasses && (
              <button
                onClick={() => setShowCreateClass(true)}
                className="rounded-xl bg-slate-950 px-6 py-3 text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              >
                Create Your First Class
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {classes.map((cls) => (
              <Link
                key={cls.id}
                href={`/dashboard/class/${cls.slug || cls.id}`}
                className="group overflow-hidden rounded-[26px] border border-stone-200 bg-white/85 transition-all duration-200 hover:-translate-y-1 hover:border-sky-300 hover:shadow-[0_22px_60px_rgba(15,23,42,0.1)]"
              >
                <div className="relative p-6">
                  <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/80 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div className="space-y-3">
                      <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">
                        Class Workspace
                      </span>
                      {cls.currentRole && (
                        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${roleStyles[cls.currentRole].className}`}>
                          {roleStyles[cls.currentRole].label}
                        </span>
                      )}
                    </div>
                    <div className="rounded-full border border-stone-200 bg-white/90 p-2 text-stone-400 transition-all duration-200 group-hover:border-sky-200 group-hover:text-sky-600">
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>

                  <div className="mb-5">
                    <h3 className="text-xl font-semibold tracking-tight text-slate-950 transition-colors group-hover:text-sky-700">
                      {cls.name}
                    </h3>
                    <p className="mt-2 text-sm font-medium text-stone-500">
                      {cls.bookCount || cls.recordingCount
                        ? `${cls.bookCount || 0} book${cls.bookCount === 1 ? '' : 's'} and ${cls.recordingCount || 0} recording${cls.recordingCount === 1 ? '' : 's'} ready to study`
                        : 'Start building this workspace with books and recordings.'}
                    </p>
                  </div>

                  {cls.description && (
                    <p className="mb-5 line-clamp-3 text-sm leading-7 text-stone-600">
                      {cls.description}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-stone-200 bg-stone-50/80 px-4 py-3">
                      <div className="flex items-center gap-2 text-stone-500">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <span className="text-xs font-semibold uppercase tracking-[0.16em]">Books</span>
                      </div>
                      <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{cls.bookCount || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-stone-50/80 px-4 py-3">
                      <div className="flex items-center gap-2 text-stone-500">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs font-semibold uppercase tracking-[0.16em]">Recordings</span>
                      </div>
                      <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{cls.recordingCount || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-stone-200 bg-stone-50/80 px-6 py-4 transition-colors group-hover:bg-sky-50/70">
                  <div className="flex items-center justify-between gap-3 text-sm font-medium">
                    <div className="flex items-center gap-2 text-stone-500">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>Created {formatDate(cls.created_at)}</span>
                    </div>
                    <div className="flex items-center text-stone-700 group-hover:text-sky-700">
                      <span>Open workspace</span>
                      <svg className="ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
