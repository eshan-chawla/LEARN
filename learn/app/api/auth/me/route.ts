import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { decodeJWT, isTokenExpired } from '@/lib/cognito-utils';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('accessToken')?.value;
    const idToken = cookieStore.get('idToken')?.value;

    if (!accessToken || !idToken) {
      return NextResponse.json({ user: null });
    }

    if (isTokenExpired(accessToken)) {
      // Token is expired, clear cookies
      const response = NextResponse.json({ user: null });
      response.cookies.set('accessToken', '', { maxAge: 0 });
      response.cookies.set('idToken', '', { maxAge: 0 });
      response.cookies.set('refreshToken', '', { maxAge: 0 });
      return response;
    }

    const user = decodeJWT(idToken);
    if (!user) {
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json({ user: null });
  }
}