import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const publicPaths = ['/signin', '/signup', '/'];

  // Allow API routes to be accessed
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  // Create a Supabase client for the server
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // If authenticated, redirect from public auth pages to dashboard
    if (publicPaths.includes(pathname) && pathname !== '/') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  } else {
    // If not authenticated, allow access to public pages
    if (publicPaths.includes(pathname)) {
      return response;
    }
    // For any other protected route, redirect to sign-in
    return NextResponse.redirect(new URL('/signin', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).)*',
  ],
};
