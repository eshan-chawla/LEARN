import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isInvalidRefreshTokenError } from '@/lib/supabaseAuth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const publicPaths = ['/signin', '/signup', '/'];
  const isPublicAsset = /\.[^/]+$/.test(pathname);

  // Allow API routes to be accessed
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.startsWith('/favicon') || isPublicAsset) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const applyResponseCookies = (nextResponse: NextResponse) => {
    for (const cookie of response.cookies.getAll()) {
      nextResponse.cookies.set(cookie);
    }

    return nextResponse;
  };

  const redirectWithCookies = (pathnameToRedirect: string) =>
    applyResponseCookies(NextResponse.redirect(new URL(pathnameToRedirect, request.url)));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({
              name,
              value,
              ...options,
            });
          });
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && isInvalidRefreshTokenError(error)) {
    await supabase.auth.signOut({ scope: 'local' });
  }

  if (user) {
    // If authenticated, redirect from public auth pages to dashboard
    if (publicPaths.includes(pathname) && pathname !== '/') {
      return redirectWithCookies('/dashboard');
    }
  } else {
    // If not authenticated, allow access to public pages
    if (publicPaths.includes(pathname)) {
      return applyResponseCookies(response);
    }
    // For any other protected route, redirect to sign-in
    return redirectWithCookies('/signin');
  }

  return applyResponseCookies(response);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|.*\\..*).*)',
  ],
};
