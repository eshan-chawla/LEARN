import { OIDCAuthProvider } from '@/contexts/OIDCAuthContext';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <OIDCAuthProvider>
          {children}
        </OIDCAuthProvider>
      </body>
    </html>
  );
}