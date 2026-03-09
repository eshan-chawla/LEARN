# Authentication Setup - Supabase Auth

This application uses **Supabase Authentication** with email and password.

## Features

✅ Email/Password Authentication
✅ Email Verification
✅ Automatic Session Management
✅ Protected Routes via Middleware
✅ Secure Cookie-based Sessions

## Setup Instructions

### 1. Enable Email Authentication in Supabase

1. Go to your Supabase Dashboard: https://supabase.com
2. Select your project
3. Navigate to **Authentication** → **Providers**
4. Ensure **Email** provider is enabled
5. Configure email templates (optional but recommended)

### 2. Environment Variables

Make sure your `.env.local` has the following:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

You can find these values in:
- Supabase Dashboard → Settings → API

### 3. Run the Application

```bash
npm install
npm run dev
```

## User Flow

### Sign Up
1. User goes to `/signup`
2. Enters email, password, and optional name
3. Submits the form
4. Receives confirmation email from Supabase
5. Clicks the verification link in email
6. Account is verified and ready to use

### Sign In
1. User goes to `/signin`
2. Enters email and password
3. Redirected to `/dashboard` on success

### Protected Routes
- All routes under `/dashboard` require authentication
- Unauthenticated users are redirected to `/signin`
- Authenticated users on `/signin` or `/signup` are redirected to `/dashboard`

## Authentication Files

### Core Files
- `lib/auth.ts` - Auth utility functions
- `contexts/AuthContext.tsx` - React context for auth state
- `middleware.ts` - Server-side route protection

### Pages
- `app/signin/page.tsx` - Sign in form
- `app/signup/page.tsx` - Sign up form
- `app/dashboard/page.tsx` - Protected dashboard

## Database Integration

The user's Supabase auth ID is stored in the `user_id` field of the `classes` table, allowing Row Level Security (RLS) policies to work correctly.

When RLS is enabled, you can use:
```sql
auth.uid() = user_id
```

## Security Features

1. **HTTP-Only Cookies**: Session tokens stored in secure cookies
2. **Middleware Protection**: Server-side route guarding
3. **Email Verification**: Users must verify email before full access
4. **Automatic Token Refresh**: Supabase handles token refreshing
5. **Secure Password Hashing**: Handled by Supabase

## Troubleshooting

### "User not found" Error
- Ensure the user has verified their email
- Check Supabase Dashboard → Authentication → Users

### Email Not Received
- Check spam folder
- Verify email provider settings in Supabase
- Check Supabase logs for delivery issues

### Session Expires Too Quickly
- Configure session duration in Supabase Dashboard
- Authentication → Settings → Session Duration

## Customization

### Email Templates
Customize email templates in:
- Supabase Dashboard → Authentication → Email Templates

Available templates:
- Confirmation email
- Password reset
- Magic link

### Password Requirements
Configure in:
- Supabase Dashboard → Authentication → Policies

## Migration Notes

This application was migrated from AWS Cognito to Supabase Auth for:
- Simpler integration with Supabase database
- Better developer experience
- Unified authentication and database platform
- Built-in email verification flow
