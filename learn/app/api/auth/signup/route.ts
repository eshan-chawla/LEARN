import { NextRequest, NextResponse } from 'next/server';
import { signUp } from '@/lib/cognito-auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password, givenName, familyName } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const result = await signUp({
      email,
      password,
      givenName,
      familyName,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        userSub: result.userSub,
        userConfirmed: result.userConfirmed,
      });
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Sign up API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}