import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import VueRouter from 'vue-router/vite'
import ICON_SIZES from './icon/sizes.json'

export default defineConfig({
  plugins: [
    VueRouter({ dts: 'src/typed-router.d.ts' }),
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html', navigateFallbackAllowlist: [/^\/(?!api\/|proto\/)/] },
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Noticer',
        short_name: 'Noticer',
        lang: 'zh-TW',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f4f4f5',
        theme_color: '#ffffff',
        icons: ICON_SIZES.flatMap((size) => [
          { src: `/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' },
          { src: `/icon-monochrome-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'monochrome' },
        ]),
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/proto\//],
      },
    }),
  ],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3040',
    },
  },
})
