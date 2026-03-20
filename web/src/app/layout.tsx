import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { AppProviders } from '@/components/providers/AppProviders'
import './globals.css'

const sourceHanSerif = localFont({
  src: [
    {
      path: './fonts/NotoSerifTC-Regular.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/NotoSerifTC-Medium.ttf',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/NotoSerifTC-SemiBold.ttf',
      weight: '600',
      style: 'normal',
    },
    {
      path: './fonts/NotoSerifTC-Bold.ttf',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-source-han-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Hippocampus — 醫學知識庫',
    template: '%s — Hippocampus',
  },
  description: '醫學考古題刷題與知識庫共筆系統',
}

const themeInitScript = `
  (function() {
    try {
      var store = localStorage.getItem('hippocampus-ui-prefs');
      var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
      var isDark = false;
      
      if (store) {
        var parsed = JSON.parse(store);
        var theme = parsed?.state?.theme;
        if (theme === 'dark') isDark = true;
        else if (theme === 'system' && darkQuery.matches) isDark = true;
      } else if (darkQuery.matches) {
        isDark = true;
      }
      
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
      }
    } catch (_e) { /* theme detection is best-effort */ }
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${sourceHanSerif.variable} font-sans antialiased bg-bg-base text-text-base transition-colors duration-300`}>
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  )
}
