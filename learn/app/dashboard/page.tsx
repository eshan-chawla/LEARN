'use client';

import { useAuth } from 'react-oidc-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.isAuthenticated && !auth.isLoading) {
      router.push('/signin');
    }
  }, [auth.isAuthenticated, auth.isLoading, router]);

  const handleSignOut = async () => {
    try {
      await auth.signoutRedirect();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  if (auth.isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!auth.user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg text-center max-w-md w-full">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">You are logged in!</h1>
          <p className="text-gray-600">Welcome to your dashboard</p>
        </div>
        
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Email:</span> {auth.user.profile.email || 'N/A'}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium">Name:</span> {auth.user.profile.name || 'N/A'}
            </p>
          </div>
          
          <button
            onClick={handleSignOut}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}