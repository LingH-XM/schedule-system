import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = (env.VITE_DEV_API_PROXY_TARGET || 'http://127.0.0.1:8787').trim()
  return {
    plugins: [vue()],
    server: {
      allowedHosts: ['class.suishichuma.com'],
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    }
  }
})
