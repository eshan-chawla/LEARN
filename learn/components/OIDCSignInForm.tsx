'use client';

import { useAuth } from 'react-oidc-context';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function OIDCSignInForm() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    // If user is already authenticated, redirect to dashboard
    if (auth.isAuthenticated) {
      router.push('/dashboard');
    }
  }, [auth.isAuthenticated, router]);

  const handleSignIn = async () => {
    try {
      await auth.signinRedirect();
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  if (auth.isLoading) {
    return (
      <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Loading...</h2>
          <p className="text-gray-600">Checking authentication status</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Sign In with OIDC</h2>
      <p className="text-gray-600 mb-6">Sign in using Amazon Cognito OIDC authentication</p>
      
      <button
        onClick={handleSignIn}
        disabled={auth.isLoading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {auth.isLoading ? 'Loading...' : 'Sign In with Cognito'}
      </button>

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-600">
          Don't have an account?{' '}
          <button
            onClick={() => auth.signinRedirect({ extraQueryParams: { screen_hint: 'signup' } })}
            className="text-blue-600 hover:text-blue-500 font-medium"
          >
            Sign Up
          </button>
        </p>
      </div>
    </div>
  );
}