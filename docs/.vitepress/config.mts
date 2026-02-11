import { defineConfig } from 'vitepress'
import { withPwa } from '@vite-pwa/vitepress'

export default withPwa(defineConfig({
  title: "Hippocampus",
  description: "Medical Exam Wiki",
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Parasitology', link: '/parasitology/' }
    ],
    sidebar: {
      '/parasitology/': [
        { text: 'Overview', link: '/parasitology/' },
        { text: '2025 Final', link: '/parasitology/2025-final' }
      ]
    },
    search: { provider: 'local' }
  },
  pwa: {
    registerType: 'autoUpdate',
    includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
    manifest: {
      name: 'Hippocampus Wiki',
      short_name: 'Hippocampus',
      description: 'Medical Exam Prep',
      theme_color: '#f472b6',
      icons: [
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    }
  }
}))
