# Amazon Cognito Authentication Setup

This Next.js application includes complete Amazon Cognito authentication integration with sign-up, sign-in, and protected routes.

## Setup Instructions

### 1. Configure Amazon Cognito

1. Go to the AWS Console and navigate to Amazon Cognito
2. Create a new User Pool or use an existing one
3. Configure the following:
   - **App Client**: Create a new app client
   - **App Client Secret**: Generate and save the secret
   - **Domain**: Set up a domain prefix for your Cognito hosted UI
   - **Callback URLs**: Add `http://localhost:3000/callback`
   - **Sign out URLs**: Add `http://localhost:3000`

### 2. Environment Variables

Copy the `.env.local.example` file to `.env.local` and fill in your Cognito configuration:

```bash
cp .env.local.example .env.local
```

Update the following variables in `.env.local`:

```
NEXT_PUBLIC_AWS_REGION=your-region
NEXT_PUBLIC_COGNITO_USER_POOL_ID=your-user-pool-id
NEXT_PUBLIC_COGNITO_CLIENT_ID=your-client-id
COGNITO_CLIENT_SECRET=your-client-secret
NEXT_PUBLIC_COGNITO_DOMAIN=your-domain-prefix
NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_IN=http://localhost:3000/callback
NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT=http://localhost:3000
```

### 3. Features Implemented

#### Authentication Flows
- **Sign Up**: Users can register with email, password, and optional name fields
- **Email Verification**: Confirmation code sent to user's email
- **Sign In**: Users can sign in with email and password
- **Sign Out**: Secure sign out with token cleanup
- **Protected Routes**: Middleware protects authenticated routes

#### API Routes
- `POST /api/auth/signup` - User registration
- `POST /api/auth/confirm-signup` - Email confirmation
- `POST /api/auth/signin` - User authentication
- `POST /api/auth/signout` - User sign out
- `GET /api/auth/me` - Get current user info

#### Components
- `SignUpForm` - Registration form with validation
- `SignInForm` - Login form
- `DashboardPage` - Protected dashboard for authenticated users

### 4. Usage

#### Sign Up Flow
1. Navigate to `/signup`
2. Fill in the registration form
3. Check your email for confirmation code
4. Enter the confirmation code to complete registration

#### Sign In Flow
1. Navigate to `/signin`
2. Enter your email and password
3. Upon successful authentication, you'll be redirected to `/dashboard`

#### Protected Routes
- `/dashboard` - Requires authentication
- Middleware automatically redirects unauthenticated users to `/signin`
- Authenticated users are redirected away from `/signin` and `/signup` to `/dashboard`

### 5. Security Features

- HTTP-only cookies for secure token storage
- Token expiration checking
- Automatic token cleanup on sign out
- Protected API routes
- Input validation on forms

### 6. Dependencies

The following packages are used for Cognito integration:

```json
{
  "amazon-cognito-identity-js": "^6.3.12",
  "@aws-sdk/client-cognito-identity-provider": "^3.540.0",
  "jwt-decode": "^4.0.0"
}
```

### 7. Next Steps

You can extend this implementation with:

- Password reset functionality
- Social sign-in (Google, Facebook, etc.)
- Multi-factor authentication (MFA)
- User profile management
- Role-based access control
- Custom attributes
- Email templates customization

### 8. Troubleshooting

Common issues and solutions:

1. **"User does not exist" error**: Check if the user pool ID and client ID are correct
2. **"Invalid email" error**: Ensure email format is valid
3. **"Password did not conform with policy"**: Check Cognito password policy settings
4. **CORS errors**: Ensure your Cognito app client settings allow the correct callback URLs
5. **Token expiration**: The middleware automatically handles expired tokens

For more information, refer to the [Amazon Cognito documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html).