import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost',
    port: 5173,
    proxy: {
      // Server-side proxy to YouTube Music InnerTube API
      '/api/ytmusic': {
        target: 'https://music.youtube.com',
        changeOrigin: true,
        secure: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0',
          'Accept': '*/*',
          'Content-Type': 'application/json',
          'Origin': 'https://music.youtube.com',
          'Referer': 'https://music.youtube.com/',
        },
        rewrite: (path) => path.replace(/^\/api\/ytmusic/, '/youtubei/v1'),
      },
      // Server-side proxy to Invidious API (community playlist search & track fetch)
      '/api/invidious': {
        target: 'https://y.com.sb',
        changeOrigin: true,
        secure: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0',
          'Accept': 'application/json',
        },
        rewrite: (path) => path.replace(/^\/api\/invidious/, '/api/v1'),
      },
      // YouTube InnerTube player (direct audio URLs) — browser-dev only
      '/api/youtubei': {
        target: 'https://www.youtube.com',
        changeOrigin: true,
        secure: true,
        headers: {
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/',
        },
        rewrite: (path) => path.replace(/^\/api\/youtubei/, '/youtubei/v1'),
      },
      // Regular YouTube search is used only to locate alternate uploads when
      // a YouTube Music catalog ID has embedding disabled.
      '/api/youtube-search': {
        target: 'https://www.youtube.com',
        changeOrigin: true,
        secure: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        rewrite: (path) => path.replace(/^\/api\/youtube-search/, ''),
      },
    },
  },
})
