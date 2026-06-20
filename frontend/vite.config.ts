import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/trades': 'http://localhost:8000',
      '/symbols': 'http://localhost:8000',
      '/dashboard/bot-analytics': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    },
  },
})
