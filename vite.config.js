import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (f) => fileURLToPath(new URL(f, import.meta.url));

// Proxy /ollama -> lokalny serwer Ollama (omija CORS).
// Zmień OLLAMA_HOST, jeśli Ollama działa na innym hoście/porcie.
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: page('./index.html'), arena: page('./arena/index.html') },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ollama': {
        target: OLLAMA_HOST,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ollama/, ''),
      },
    },
  },
});
