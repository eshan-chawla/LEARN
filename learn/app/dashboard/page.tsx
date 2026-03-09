'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
}

export default function DashboardPage() {
  const auth = useAuth();
  const router = useRouter();

  const [classes, setClasses] = useState<Class[]>([]);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassDescription, setNewClassDescription] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  // Load classes when user is authenticated
  useEffect(() => {
    if (auth.user) {
      loadClasses();
    }
  }, [auth.user]);

  const loadClasses = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClasses(data || []);
    } catch (error) {
      console.error('Error loading classes:', error);
    } finally {
      setLoading(false);
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

  const handleCreateClass = async () => {
    if (!newClassName.trim() || !auth.user) return;

    try {
      setLoading(true);
      const slug = generateSlug(newClassName) + '-' + Date.now().toString(36);

      // Try to create with slug, fallback to without slug if column doesn't exist
      let insertData: any = {
        name: newClassName,
        description: newClassDescription || null,
        user_id: auth.user.id,
      };

      // First, check if slug column exists by trying to insert with it
      let { data, error } = await supabase
        .from('classes')
        .insert({
          ...insertData,
          slug,
        })
        .select()
        .single();

      // If error is about missing column, try without slug
      if (error && error.message?.includes('column') && error.message?.includes('slug')) {
        console.log('Slug column not found, creating without slug');
        const result = await supabase
          .from('classes')
          .insert(insertData)
          .select()
          .single();

        data = result.data;
        error = result.error;
      }

      if (error) {
        console.error('Supabase error details:', error);
        throw error;
      }

      setClasses([data, ...classes]);
      setNewClassName('');
      setNewClassDescription('');
      setShowCreateClass(false);

      // Navigate to the new class page using slug if available, otherwise use ID
      router.push(`/dashboard/class/${data.slug || data.id}`);
    } catch (error: any) {
      console.error('Error creating class:', error);
      console.error('Error message:', error?.message);
      console.error('Error details:', error?.details);
      console.error('Error hint:', error?.hint);
      alert(`Failed to create class: ${error?.message || 'Unknown error'}`);
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Learning Aid</h1>
              <p className="text-sm text-gray-600">Welcome, {auth.user.user_metadata?.name || auth.user.email}</p>
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
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900">My Classes</h2>
              <p className="text-gray-600 mt-1">Organize your learning materials in one place</p>
            </div>
            <button
              onClick={() => setShowCreateClass(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Class
            </button>
          </div>
        </div>

        {/* Create Class Modal/Form */}
        {showCreateClass && (
          <div className="mb-8 bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New Class</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="className" className="block text-sm font-medium text-gray-700 mb-1">
                  Class Name
                </label>
                <input
                  type="text"
                  id="className"
                  placeholder="e.g., Introduction to Python"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>
              <div>
                <label htmlFor="classDescription" className="block text-sm font-medium text-gray-700 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  id="classDescription"
                  placeholder="Brief description of the class..."
                  value={newClassDescription}
                  onChange={(e) => setNewClassDescription(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleCreateClass}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create Class'}
                </button>
                <button
                  onClick={() => {
                    setShowCreateClass(false);
                    setNewClassName('');
                    setNewClassDescription('');
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
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
            <p className="text-gray-600 mt-2">Loading classes...</p>
          </div>
        ) : classes.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No classes yet</h3>
            <p className="text-gray-600 mb-6">Get started by creating your first class</p>
            <button
              onClick={() => setShowCreateClass(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Create Your First Class
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {classes.map((cls) => (
              <Link
                key={cls.id}
                href={`/dashboard/class/${cls.slug || cls.id}`}
                className="group bg-white rounded-lg shadow-md hover:shadow-xl transition-all duration-200 overflow-hidden border border-gray-200 hover:border-blue-500"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                        {cls.name}
                      </h3>
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {cls.description && (
                    <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                      {cls.description}
                    </p>
                  )}

                  <div className="flex items-center text-xs text-gray-500">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Created {formatDate(cls.created_at)}
                  </div>
                </div>

                <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 group-hover:bg-blue-50 transition-colors">
                  <div className="flex items-center text-sm text-gray-600 group-hover:text-blue-600">
                    <span>View class materials</span>
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
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