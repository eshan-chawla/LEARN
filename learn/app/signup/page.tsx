import OIDCSignInForm from '@/components/OIDCSignInForm';

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md text-center">
        <h2 className="text-2xl font-bold mb-4">Sign Up with OIDC</h2>
        <p className="text-gray-600 mb-6">Use Amazon Cognito for secure authentication</p>
        <OIDCSignInForm />
        <div className="mt-4 text-sm text-gray-600">
          <p>Click "Sign In with Cognito" to access the registration flow</p>
        </div>
      </div>
    </div>
  );
}