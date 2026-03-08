import { NextRequest, NextResponse } from 'next/server';
import { signIn } from '@/lib/cognito-auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const result = await signIn({ email, password });

    if (result.success && result.authenticationResult) {
      const response = NextResponse.json({
        success: true,
        user: {
          accessToken: result.authenticationResult.AccessToken,
          refreshToken: result.authenticationResult.RefreshToken,
          idToken: result.authenticationResult.IdToken,
        },
      });

      // Set HTTP-only cookies for tokens
      if (result.authenticationResult.AccessToken) {
        response.cookies.set('accessToken', result.authenticationResult.AccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60, // 1 hour
        });
      }

      if (result.authenticationResult.RefreshToken) {
        response.cookies.set('refreshToken', result.authenticationResult.RefreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
      }

      if (result.authenticationResult.IdToken) {
        response.cookies.set('idToken', result.authenticationResult.IdToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60, // 1 hour
        });
      }

      return response;
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Sign in API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}