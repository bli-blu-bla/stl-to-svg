import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the same build works at a domain root and under a
  // GitHub Pages project path (/<repo>/) without knowing the repo name.
  base: './',
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // three.js is most of the bundle and changes far less often than the
        // app code; splitting it keeps repeat visits cheap.
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
});
