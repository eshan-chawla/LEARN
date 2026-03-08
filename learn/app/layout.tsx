import { OIDCAuthProvider } from '@/contexts/OIDCAuthContext';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <title>Learn</title>
        <meta name="description" content="Learning application with OIDC authentication" />
      </head>
      <body>
        <OIDCAuthProvider>
          {children}
        </OIDCAuthProvider>
      </body>
    </html>
  );
}