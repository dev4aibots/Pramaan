import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'PRAMAAN — Secure, permission-aware RAG',
  description: 'Private, verified, role-based retrieval over your documents. BYOK or fully local models.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <style>{`:root{--font-geist-sans:'Geist',ui-sans-serif,system-ui,sans-serif;--font-geist-mono:'Geist Mono',ui-monospace,monospace;}`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
