import type { Metadata } from 'next';
import { Oswald } from 'next/font/google';
import './globals.css';
import { serverConfig } from '@/lib/server-config';

const displayFont = Oswald({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: `${serverConfig.brandName} Monitor`,
  description: 'VPN connection and threat monitoring dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={displayFont.variable}>
        {children}
      </body>
    </html>
  );
}
