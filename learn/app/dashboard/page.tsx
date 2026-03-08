'use client';

import { useAuth } from 'react-oidc-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      router.push('/signin');
    }
  }, [auth.isAuthenticated, auth.isLoading, router]);

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
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <button
            onClick={() => auth.removeUser()}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Sign Out
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold mb-2">Welcome!</h2>
            <p className="text-gray-600">You are successfully logged in with OIDC.</p>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">User Information</h3>
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">Email:</span> {auth.user.profile.email || 'N/A'}</p>
              <p><span className="font-medium">Subject:</span> {auth.user.profile.sub}</p>
              {auth.user.profile.name && (
                <p><span className="font-medium">Name:</span> {auth.user.profile.name}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}