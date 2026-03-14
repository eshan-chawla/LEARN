import { AuthProvider } from '@/contexts/AuthContext';
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
        <title>Smart Learn</title>
        <meta
          name="description"
          content="Smart Learn is an AI-native learning management system that helps students organize classes, notes, books, and recordings."
        />
      </head>
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
