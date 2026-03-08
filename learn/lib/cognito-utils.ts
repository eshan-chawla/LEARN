import { jwtDecode } from 'jwt-decode';

export interface CognitoUser {
  sub: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
  'cognito:username'?: string;
}

export function decodeJWT(token: string): CognitoUser | null {
  try {
    const decoded = jwtDecode(token) as any;
    return {
      sub: decoded.sub,
      email: decoded.email,
      email_verified: decoded.email_verified,
      given_name: decoded.given_name,
      family_name: decoded.family_name,
      'cognito:username': decoded['cognito:username'],
    };
  } catch (error) {
    console.error('JWT decode error:', error);
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode(token) as any;
    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch (error) {
    return true;
  }
}