'use client';

import { useAuth } from 'react-oidc-context';
import { useOIDCAuth } from '@/hooks/useOIDCAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function EnhancedOIDCDashboard() {
  const auth = useAuth();
  const { signOutRedirect } = useOIDCAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.isAuthenticated && !auth.isLoading) {
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

  if (auth.error) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Encountering error...</h2>
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

  if (auth.isAuthenticated && auth.user) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">OIDC Dashboard</h1>
            <div className="space-x-2">
              <button
                onClick={() => auth.removeUser()}
                className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
              >
                Remove User
              </button>
              <button
                onClick={signOutRedirect}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Sign Out Redirect
              </button>
            </div>
          </div>
          
          <div className="space-y-6">
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold mb-2 text-green-800">Hello:</h3>
              <pre className="text-sm text-green-700 bg-white p-2 rounded border">
                {auth.user.profile.email || auth.user.profile.name || 'User'}
              </pre>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-semibold mb-2 text-blue-800">ID Token:</h3>
                <pre className="text-xs text-blue-700 bg-white p-2 rounded border overflow-x-auto">
                  {auth.user.id_token ? `${auth.user.id_token.substring(0, 100)}...` : 'No ID token'}
                </pre>
              </div>

              <div className="bg-purple-50 p-4 rounded-lg">
                <h3 className="font-semibold mb-2 text-purple-800">Access Token:</h3>
                <pre className="text-xs text-purple-700 bg-white p-2 rounded border overflow-x-auto">
                  {auth.user.access_token ? `${auth.user.access_token.substring(0, 100)}...` : 'No access token'}
                </pre>
              </div>

              <div className="bg-orange-50 p-4 rounded-lg">
                <h3 className="font-semibold mb-2 text-orange-800">Refresh Token:</h3>
                <pre className="text-xs text-orange-700 bg-white p-2 rounded border overflow-x-auto">
                  {auth.user.refresh_token ? `${auth.user.refresh_token.substring(0, 100)}...` : 'No refresh token'}
                </pre>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-semibold mb-2 text-gray-800">User Profile:</h3>
              <pre className="text-sm text-gray-700 bg-white p-2 rounded border overflow-x-auto">
                {JSON.stringify(auth.user.profile, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md text-center">
        <h2 className="text-2xl font-bold mb-4">OIDC Authentication</h2>
        <p className="text-gray-600 mb-6">Please sign in to continue</p>
        <div className="space-y-4">
          <button
            onClick={() => auth.signinRedirect()}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Sign In
          </button>
          <button
            onClick={signOutRedirect}
            className="w-full py-2 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Sign Out Redirect
          </button>
        </div>
      </div>
    </div>
  );
}