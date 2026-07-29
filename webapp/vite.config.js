import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // served from https://freya-gul.github.io/md_plus/ in production, so the
  // build needs the repo name as a base path; dev server stays at root.
  base: command === 'build' ? '/md_plus/' : '/',
  plugins: [react()],
}))
