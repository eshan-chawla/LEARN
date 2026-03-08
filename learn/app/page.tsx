import OIDCAuthButtons from '@/components/OIDCAuthButtons';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-md text-center">
        <h1 className="text-3xl font-bold mb-4">Welcome to OIDC Auth</h1>
        <p className="text-gray-600 mb-6">Choose an option to get started:</p>
        
        <div className="space-y-4">
          <a
            href="/signin"
            className="block w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Sign In with OIDC
          </a>
          
          <a
            href="/enhanced-dashboard"
            className="block w-full py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            Enhanced OIDC Dashboard
          </a>
          
          <div className="border-t pt-4">
            <p className="text-sm text-gray-600 mb-2">Quick Actions:</p>
            <OIDCAuthButtons className="space-y-2" />
          </div>
        </div>
      </div>
    </div>
  );
}