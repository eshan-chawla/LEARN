'use client';

import { ProfileMenu } from '@/components/ProfileMenu';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  is_teacher: boolean;
}

function getDisplayName(profile: UserProfile | null, fallbackName: unknown, email: string | undefined) {
  if (profile?.name?.trim()) return profile.name.trim();
  if (typeof fallbackName === 'string' && fallbackName.trim()) return fallbackName.trim();
  return email || 'User';
}

export default function ProfilePage() {
  const auth = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      router.push('/signin');
    }
  }, [auth.loading, auth.user, router]);

  const loadProfile = useCallback(async () => {
    if (!auth.user) return;

    const fallbackProfile: UserProfile = {
      id: auth.user.id,
      email: auth.user.email || '',
      name:
        typeof auth.user.user_metadata?.name === 'string' && auth.user.user_metadata.name.trim()
          ? auth.user.user_metadata.name.trim()
          : auth.user.email || 'User',
      is_teacher: false,
    };

    try {
      setLoading(true);

      const profileResult = await supabase
        .from('users')
        .select('id, email, name, is_teacher')
        .eq('id', auth.user.id)
        .maybeSingle();

      if (profileResult.error) {
        throw profileResult.error;
      }

      let data = profileResult.data;

      if (!data) {
        const insertResult = await supabase
          .from('users')
          .insert({
            id: fallbackProfile.id,
            email: fallbackProfile.email,
            name: fallbackProfile.name,
          })
          .select('id, email, name, is_teacher')
          .single();

        if (insertResult.error) {
          throw insertResult.error;
        }

        data = insertResult.data;
      }

      setProfile(data ?? fallbackProfile);
    } catch (error) {
      console.error('Error loading profile:', error);
      setProfile(fallbackProfile);
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    if (auth.user) {
      void loadProfile();
    }
  }, [auth.user, loadProfile]);

  if (auth.loading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,_#f8fafc_0%,_#f3f4f6_48%,_#f8fafc_100%)]">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-stone-700" />
          <p className="mt-2 text-stone-600">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!auth.user) {
    return null;
  }

  const displayName = getDisplayName(profile, auth.user.user_metadata?.name, auth.user.email);
  const canCreateClasses = profile?.is_teacher ?? false;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#f3f4f6_48%,_#f8fafc_100%)]">
      <header className="relative z-30 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="rounded-full border border-stone-300 bg-white p-2 text-stone-600 transition-colors hover:bg-stone-100 hover:text-slate-900"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Smart Learn</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Profile</h1>
              <p className="text-sm text-stone-600">Account details and access</p>
            </div>
          </div>
          <ProfileMenu />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[28px] border border-stone-200 bg-white/80 px-6 py-7 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-700">Profile</p>
          <h2 className="mt-3 text-4xl font-black tracking-tight text-slate-950">{displayName}</h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
            Your account details and access level for Smart Learn.
          </p>

          <div className="mt-8 rounded-[24px] border border-stone-200 bg-stone-50/80 px-5 py-3">
            <div className="flex flex-col gap-2 border-b border-stone-200 py-4 sm:flex-row sm:items-start sm:justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Email</p>
              <p className="break-all text-base font-medium text-slate-900">{profile?.email || auth.user.email || '—'}</p>
            </div>
            <div className="flex flex-col gap-2 border-b border-stone-200 py-4 sm:flex-row sm:items-start sm:justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Name</p>
              <p className="text-base font-medium text-slate-900">{displayName}</p>
            </div>
            <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Account Type</p>
              <p className="text-base font-medium text-slate-900">Free</p>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-stone-200 bg-white/75 px-5 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Access</p>
            <p className="mt-3 text-base font-medium text-slate-900">
              {canCreateClasses
                ? 'You can create classes.'
                : 'You cannot create classes with this account.'}
            </p>
            {!canCreateClasses && (
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Contact <a className="font-medium text-sky-700 hover:text-sky-800" href="mailto:eshan.chawla.off@gmail.com">eshan.chawla.off@gmail.com</a> to request access.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
