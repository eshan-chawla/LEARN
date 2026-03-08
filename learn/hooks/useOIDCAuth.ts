'use client';

/**
 TODO : Fix logout flow and redirect url
 */

import { useAuth } from 'react-oidc-context';
import { COGNITO_CONFIG } from '@/lib/cognito-config';

export function useOIDCAuth() {
  const auth = useAuth();


  const signOutRedirect = async () => {
    const logoutUri = COGNITO_CONFIG.REDIRECT_SIGN_OUT;
    const cognitoDomain = `https://${COGNITO_CONFIG.DOMAIN}.auth.${COGNITO_CONFIG.REGION}.amazoncognito.com`;
    
    // Clear local storage first (important for oidc-client-ts)
    await auth.removeUser();

    // Directly navigate to the standard Cognito logout endpoint
    window.location.href = `${cognitoDomain}/logout?client_id=${COGNITO_CONFIG.CLIENT_ID}&logout_uri=${encodeURIComponent(logoutUri)}`;
  };

  return {
    ...auth,
    signOutRedirect,
  };
}