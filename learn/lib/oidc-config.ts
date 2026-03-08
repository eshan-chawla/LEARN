import { WebStorageStateStore } from 'oidc-client-ts';

const authority = process.env.NEXT_PUBLIC_COGNITO_AUTHORITY || `https://cognito-idp.${process.env.NEXT_PUBLIC_AWS_REGION}.amazoncognito.com/${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}`;

export const oidcConfig = {
  authority,
  client_id: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
  redirect_uri: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN || 'http://localhost:3000/callback',
  response_type: 'code',
  scope: 'email openid phone', // Match your Cognito app client exactly
  post_logout_redirect_uri: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT || 'http://localhost:3000',
  userStore: typeof window !== 'undefined' ? new WebStorageStateStore({ store: window.localStorage }) : undefined,
  automaticSilentRenew: true,
  loadUserInfo: true,
  // For public clients (no client secret)
  metadata: {
    authorization_endpoint: `https://${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}.auth.${process.env.NEXT_PUBLIC_AWS_REGION}.amazoncognito.com/oauth2/authorize`,
    token_endpoint: `https://${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}.auth.${process.env.NEXT_PUBLIC_AWS_REGION}.amazoncognito.com/oauth2/token`,
    userinfo_endpoint: `https://${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}.auth.${process.env.NEXT_PUBLIC_AWS_REGION}.amazoncognito.com/oauth2/userInfo`,
    end_session_endpoint: `https://${process.env.NEXT_PUBLIC_COGNITO_DOMAIN}.auth.${process.env.NEXT_PUBLIC_AWS_REGION}.amazoncognito.com/logout`,
  },
};