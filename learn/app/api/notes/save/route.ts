import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const body = await request.json();
    const { classId, content } = body as {
      classId?: string;
      content?: string;
    };

    if (!classId || typeof content !== 'string') {
      return NextResponse.json({ error: 'Missing required fields: classId, content' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('notes')
      .upsert(
        {
          class_id: classId,
          content,
        },
        {
          onConflict: 'class_id',
        }
      )
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || 'Failed to save note' }, { status: 500 });
    }

    return NextResponse.json({
      note: data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save note';
    console.error('Error saving note:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
