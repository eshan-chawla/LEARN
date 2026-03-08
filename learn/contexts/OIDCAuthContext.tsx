'use client';

import React, { ReactNode } from 'react';
import { AuthProvider as OidcProvider } from 'react-oidc-context';
import { oidcConfig } from '@/lib/oidc-config';

interface OIDCAuthProviderProps {
  children: ReactNode;
}

export function OIDCAuthProvider({ children }: OIDCAuthProviderProps) {
  return (
    <OidcProvider {...oidcConfig}>
      {children}
    </OidcProvider>
  );
}