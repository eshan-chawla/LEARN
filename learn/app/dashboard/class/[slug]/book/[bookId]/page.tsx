'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

interface BookData {
  id: string;
  title: string;
  class_id: string;
  processing_status: string;
  storage_path: string;
  uploaded_at: string;
}

interface BookResponse {
  book: BookData;
  pdfUrl: string;
  expiresAt: string;
  className: string;
  classSlug: string;
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

  // Redirect if not authenticated
  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  // Load book data
  useEffect(() => {
    if (auth.user && bookId) {
      loadBook();
    }
  }, [auth.user, bookId]);


  const loadBook = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get user session for auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No authentication token');
      }

      // Fetch book data from API
      const response = await fetch(`/api/books/${bookId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load book');
      }

      const data: BookResponse = await response.json();

      console.log('Book data received:', {
        bookId: data.book.id,
        title: data.book.title,
        status: data.book.processing_status,
        hasPdfUrl: !!data.pdfUrl,
        pdfUrlStart: data.pdfUrl?.substring(0, 100)
      });

      // Check processing status (allow viewing even if not completed for PDF viewing)
      // Only block if explicitly in 'processing' state
      if (data.book.processing_status === 'processing') {
        setError('This book is currently being processed. Please check back in a few minutes.');
        setLoading(false);
        return;
      }

      // Warn if failed but allow viewing
      if (data.book.processing_status === 'failed') {
        console.warn('Book processing failed, but allowing PDF viewing');
      }

      setBookResponse(data);
      setLoading(false);
    } catch (err: any) {
      console.error('Error loading book:', err);
      setError(err.message || 'Failed to load book');
      setLoading(false);
    }
  };

  const getPdfJsViewerUrl = () => {
    if (!bookResponse) return '';

    // Use proxy to avoid CORS issues with Supabase signed URLs
    const proxyUrl = `/api/proxy-pdf?url=${encodeURIComponent(bookResponse.pdfUrl)}`;
    const encodedProxyUrl = encodeURIComponent(proxyUrl);
    const pageParam = searchParams?.get('page');

    if (pageParam) {
      return `/pdfjs/web/viewer.html?file=${encodedProxyUrl}#page=${pageParam}`;
    }
    return `/pdfjs/web/viewer.html?file=${encodedProxyUrl}`;
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      router.push('/signin');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  // Loading state
  if (auth.loading || loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-gray-600 mt-2">Loading book...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div className="flex items-center gap-3 mb-4">
            <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Error Loading Book</h3>
              <p className="text-sm text-gray-600 mt-1">{error}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={loadBook}
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

  // Not loaded yet
  if (!bookResponse || !auth.user) {
    return null;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <Link
                href={`/dashboard/class/${slug}`}
                className="text-gray-600 hover:text-gray-900 transition-colors"
                title="Back to class"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <p className="text-sm text-gray-600">{bookResponse.className}</p>
                <h1 className="text-xl font-bold text-gray-900">{bookResponse.book.title}</h1>
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

      {/* PDF.js Viewer (Standard viewer used by most websites) */}
      <div className="flex-1 overflow-hidden">
        <iframe
          src={getPdfJsViewerUrl()}
          className="w-full h-full border-0"
          title={bookResponse.book.title}
        />
      </div>
    </div>
  );
}
