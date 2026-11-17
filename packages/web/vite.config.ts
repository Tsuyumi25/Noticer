import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import VueRouter from 'vue-router/vite'

export default defineConfig({
  plugins: [VueRouter({ dts: 'src/typed-router.d.ts' }), vue(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3040',
    },
  },
})
