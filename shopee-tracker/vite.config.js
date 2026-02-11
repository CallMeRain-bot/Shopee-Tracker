import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [react()],
    // Local dev: base = '/' | VPS production: base = '/tracker/'
    base: command === 'serve' ? '/' : '/tracker/',
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true
            }
        }
    }
}))
