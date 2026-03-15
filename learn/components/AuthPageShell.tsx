import Link from 'next/link';
import { ReactNode } from 'react';

interface AuthPageShellProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthPageShell({
  title,
  description,
  children,
  footer,
}: AuthPageShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.16),_transparent_32%),linear-gradient(180deg,_#f8fbff_0%,_#eef4ff_44%,_#f8fafc_100%)] px-4 py-12">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md items-center justify-center">
        <div className="w-full rounded-[28px] border border-white/70 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="mb-6 flex items-center justify-start">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/90 px-3 py-1.5 text-sm font-medium text-stone-600 transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
              aria-label="Go back to Smart Learn home"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Home
            </Link>
          </div>
          <div className="mb-8 text-center">
            <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">
              Smart Learn
            </div>
            <h1 className="mt-4 text-3xl font-bold text-slate-900">{title}</h1>
            <p className="mt-2 text-slate-600">{description}</p>
          </div>

          {children}

          {footer && <div className="mt-6 text-center">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
