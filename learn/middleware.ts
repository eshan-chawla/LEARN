import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const publicPaths = ['/signin', '/signup', '/forgot-password', '/reset-password', '/callback'];

  // Allow API routes to be accessed
  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get('accessToken')?.value;
  const idToken = cookieStore.get('idToken')?.value;
  
  // Simple token check - just verify tokens exist (without jwt-decode)
  const isAuthenticated = !!(accessToken && idToken);

  if (isAuthenticated) {
    // If authenticated, redirect from public auth pages to dashboard
    if (publicPaths.includes(pathname)) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  } else {
    // If not authenticated, allow access to public pages
    if (publicPaths.includes(pathname) || pathname === '/') {
      return NextResponse.next();
    }
    // For any other protected route, redirect to sign-in
    return NextResponse.redirect(new URL('/signin', request.url));
  }

  return NextResponse.next();
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