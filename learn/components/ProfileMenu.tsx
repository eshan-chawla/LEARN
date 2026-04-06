'use client';

import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

function getDisplayName(name: unknown, email: string | undefined) {
  if (typeof name === 'string' && name.trim()) return name.trim();
  return email || 'User';
}

export function ProfileMenu() {
  const auth = useAuth();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const displayName = getDisplayName(auth.user?.user_metadata?.name, auth.user?.email);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      setOpen(false);
      router.push('/');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  if (!auth.user) {
    return null;
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-300 bg-white/88 text-stone-700 shadow-[0_12px_30px_rgba(28,25,23,0.08)] transition hover:border-stone-400 hover:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.9}
            d="M15.75 6.75a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 19.25a7.5 7.5 0 0115 0"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-3 w-64 overflow-hidden rounded-[24px] border border-stone-200 bg-[rgba(250,248,244,0.98)] shadow-[0_28px_80px_rgba(28,25,23,0.16)] backdrop-blur-xl">
          <div className="border-b border-stone-200/80 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500">Account</p>
            <p className="mt-2 truncate text-sm font-semibold text-stone-900">{displayName}</p>
            <p className="mt-1 truncate text-xs text-stone-500">{auth.user.email || 'No email available'}</p>
          </div>

          <div className="p-2">
            <Link
              href="/dashboard/profile"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-stone-700 transition hover:bg-white"
            >
              <svg className="h-5 w-5 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.9}
                  d="M15.75 6.75a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 19.25a7.5 7.5 0 0115 0"
                />
              </svg>
              <span>See profile</span>
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
            >
              <svg className="h-5 w-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.9}
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-7.5a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 006 21h7.5a2.25 2.25 0 002.25-2.25V15m-3-3h8.25m0 0l-3-3m3 3l-3 3"
                />
              </svg>
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
