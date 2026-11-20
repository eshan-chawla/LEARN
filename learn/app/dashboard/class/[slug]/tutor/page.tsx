'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProfileMenu } from '@/components/ProfileMenu';
import { TutorPanel } from '@/components/TutorPanel';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function TutorPage() {
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;
  const [classInfo, setClassInfo] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.loading && !auth.user) router.push('/signin');
  }, [auth.loading, auth.user, router]);

  useEffect(() => {
    if (!slug || !auth.user) return;
    void (async () => {
      const bySlug = await supabase.from('classes').select('id, name').eq('slug', slug).maybeSingle();
      const found =
        bySlug.data ??
        (UUID_PATTERN.test(slug) ? (await supabase.from('classes').select('id, name').eq('id', slug).maybeSingle()).data : null);
      if (found) setClassInfo(found);
      else setError('Class not found, or you are not a member of it.');
    })();
  }, [slug, auth.user]);

  const getAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#f3f4f6_48%,_#f8fafc_100%)]">
      <header className="border-b border-stone-200/80 bg-stone-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              href={`/dashboard/class/${slug}`}
              aria-label="Back to class"
              className="rounded-full border border-stone-300 bg-white p-2 text-stone-600 transition-colors hover:bg-stone-100 hover:text-slate-900"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Adaptive Tutor</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{classInfo?.name ?? 'Loading…'}</h1>
            </div>
          </div>
          <ProfileMenu />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {error && <p className="text-sm text-rose-700">{error}</p>}
        {classInfo && <TutorPanel classId={classInfo.id} getAccessToken={getAccessToken} />}
      </main>
    </div>
  );
}
