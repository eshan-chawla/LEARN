'use client';

import { useAuth } from 'react-oidc-context';

interface OIDCAuthButtonsProps {
  className?: string;
}

export default function OIDCAuthButtons({ className = '' }: OIDCAuthButtonsProps) {
  const auth = useAuth();

  const handleSignIn = () => {
    auth.signinRedirect();
  };

  const handleSignOut = () => {
    auth.removeUser();
  };

  if (auth.isLoading) {
    return (
      <div className={`${className}`}>
        <button disabled className="px-4 py-2 bg-gray-400 text-white rounded-md cursor-not-allowed">
          Loading...
        </button>
      </div>
    );
  }

  if (auth.isAuthenticated) {
    return (
      <div className={`${className}`}>
        <button
          onClick={handleSignOut}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      <button
        onClick={handleSignIn}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        Sign In
      </button>
    </div>
  );
}