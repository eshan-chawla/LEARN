export const COGNITO_CONFIG = {
  REGION: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
  USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '',
  CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
  CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET || '',
  DOMAIN: process.env.NEXT_PUBLIC_COGNITO_DOMAIN || '',
  REDIRECT_SIGN_IN: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN || 'http://localhost:3000/callback',
  REDIRECT_SIGN_OUT: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT || 'http://localhost:3000',
};

export const COGNITO_ENDPOINTS = {
  AUTHORIZE: `https://${COGNITO_CONFIG.DOMAIN}.auth.${COGNITO_CONFIG.REGION}.amazoncognito.com/oauth2/authorize`,
  TOKEN: `https://${COGNITO_CONFIG.DOMAIN}.auth.${COGNITO_CONFIG.REGION}.amazoncognito.com/oauth2/token`,
  USER_INFO: `https://${COGNITO_CONFIG.DOMAIN}.auth.${COGNITO_CONFIG.REGION}.amazoncognito.com/oauth2/userInfo`,
  LOGOUT: `https://${COGNITO_CONFIG.DOMAIN}.auth.${COGNITO_CONFIG.REGION}.amazoncognito.com/logout`,
};