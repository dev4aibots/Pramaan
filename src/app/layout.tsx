import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PRAMAAN — Secure, permission-aware RAG',
  description: 'Private, verified, role-based retrieval over your documents. BYOK or fully local models.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
