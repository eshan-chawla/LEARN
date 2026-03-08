'use client';

import { useAuth } from 'react-oidc-context';
import { COGNITO_CONFIG } from '@/lib/cognito-config';

export function useOIDCAuth() {
  const auth = useAuth();

  const signOutRedirect = () => {
    // For public clients, we don't need client_id in the logout URL
    const logoutUri = COGNITO_CONFIG.REDIRECT_SIGN_OUT;
    const cognitoDomain = `https://${COGNITO_CONFIG.DOMAIN}.auth.${COGNITO_CONFIG.REGION}.amazoncognito.com`;
    
    // Clear local storage first
    auth.removeUser();
    
    // For public clients, use simpler logout URL
    window.location.href = `${cognitoDomain}/logout?client_id=${COGNITO_CONFIG.CLIENT_ID}&logout_uri=${encodeURIComponent(logoutUri)}`;
  };

  return {
    ...auth,
    signOutRedirect,
  };
}