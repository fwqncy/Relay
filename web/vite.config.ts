import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The build lands in internal/server/dist, which the Go binary embeds.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../internal/server/dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing', 'postprocessing'],
          gsap: ['gsap', '@gsap/react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
});
