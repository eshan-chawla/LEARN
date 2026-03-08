'use client';

import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { useRouter } from 'next/navigation';

export default function CallbackPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    // The react-oidc-context automatically handles the callback
    // We just need to check if the user is authenticated and redirect
    if (auth.isAuthenticated) {
      router.push('/dashboard');
    } else if (!auth.isLoading && auth.error) {
      console.error('Authentication callback error:', auth.error);
      router.push('/signin');
    }
  }, [auth.isAuthenticated, auth.isLoading, auth.error, router]);

  if (auth.error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Authentication Error</h2>
          <p className="text-gray-600">{auth.error.message}</p>
          <button
            onClick={() => router.push('/signin')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Processing authentication...</h2>
        <p className="text-gray-600">Please wait while we complete the sign-in process.</p>
      </div>
    </div>
  );
}