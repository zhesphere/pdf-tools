import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-engine': ['pdf-lib'],
          'pdf-renderer': ['pdfjs-dist'],
          'zip-engine': ['jszip'],
        },
      },
    },
  },
});
