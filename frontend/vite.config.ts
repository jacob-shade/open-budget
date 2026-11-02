import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, forward API calls to the Rust backend (cargo run in ../backend).
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
})
