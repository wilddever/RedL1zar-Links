import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(import.meta.dirname, 'attached_assets'),
      '@workspace/api-client-react': path.resolve(
        import.meta.dirname,
        'src/cloudflare-api-client.ts',
      ),
      '@workspace/spotify-cover': path.resolve(
        import.meta.dirname,
        '..',
        'lib',
        'spotify-cover',
        'src',
        'index.ts',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});