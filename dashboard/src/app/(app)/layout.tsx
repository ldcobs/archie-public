import Sidebar from '@/components/Sidebar';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme-client';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
          <Sidebar />
          <main style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
            {children}
          </main>
        </div>
      </I18nProvider>
    </ThemeProvider>
  );
}
