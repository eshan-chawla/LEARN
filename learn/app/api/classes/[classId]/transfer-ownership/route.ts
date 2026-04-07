import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabaseErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === 'object' && error !== null) {
    if ('message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }

    if ('details' in error) {
      const details = (error as { details?: unknown }).details;
      if (typeof details === 'string' && details.trim()) return details;
    }

    if ('hint' in error) {
      const hint = (error as { hint?: unknown }).hint;
      if (typeof hint === 'string' && hint.trim()) return hint;
    }
  }

  return fallback;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    if (!supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: 'Missing SUPABASE_SERVICE_ROLE_KEY on the server' },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await authSupabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { classId } = await params;
    const body = await request.json();
    const { targetUserId } = body as { targetUserId?: string };

    if (!classId || !targetUserId) {
      return NextResponse.json(
        { error: 'Missing required fields: classId, targetUserId' },
        { status: 400 }
      );
    }

    const { data: roleData, error: roleError } = await authSupabase.rpc('get_class_role', {
      target_class_id: classId,
    });

    if (roleError) {
      return NextResponse.json(
        { error: getSupabaseErrorMessage(roleError, 'Failed to verify class access') },
        { status: 500 }
      );
    }

    if (roleData !== 'owner') {
      return NextResponse.json(
        { error: 'Only the class owner can transfer ownership' },
        { status: 403 }
      );
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { error: transferError } = await adminSupabase.rpc('transfer_class_ownership', {
      target_class_id: classId,
      target_user_id: targetUserId,
    });

    if (transferError) {
      return NextResponse.json(
        { error: getSupabaseErrorMessage(transferError, 'Failed to transfer ownership') },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = getSupabaseErrorMessage(error, 'Failed to transfer ownership');
    console.error('Error transferring class ownership:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
