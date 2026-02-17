import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: '../server/static',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        sw: 'src/sw.js',
      },
      output: {
        entryFileNames: (chunk) => {
          // Service worker must be at root with a stable name
          if (chunk.name === 'sw') return 'sw.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
