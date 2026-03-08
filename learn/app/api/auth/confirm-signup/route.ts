import { NextRequest, NextResponse } from 'next/server';
import { confirmSignUp } from '@/lib/cognito-auth';

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json();

    if (!email || !code) {
      return NextResponse.json(
        { error: 'Email and confirmation code are required' },
        { status: 400 }
      );
    }

    const result = await confirmSignUp({ email, code });

    if (result.success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Confirm sign up API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}