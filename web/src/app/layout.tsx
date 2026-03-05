import type { Metadata } from 'next'
import { Figtree, Noto_Sans_TC } from 'next/font/google'
import { AppProviders } from '@/components/providers/AppProviders'
import './globals.css'

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
  display: 'swap',
})

const notoSansTC = Noto_Sans_TC({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-noto-sans-tc',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Hippocampus — 醫學知識庫',
    template: '%s — Hippocampus',
  },
  description: '醫學考古題刷題與知識庫共筆系統',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className={`${figtree.variable} ${notoSansTC.variable} font-sans antialiased bg-bg-base text-text-base transition-colors duration-300`}>
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  )
}
